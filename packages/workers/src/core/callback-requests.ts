import crypto from "node:crypto";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import {
  ACRIO_TEAM_ASK_TEXT,
  buildCallbackSlotInteractive,
  buildTeamConnectInteractive,
  loadConversationAiState,
  type AcrioInteractive,
} from "@cc/connections";
import { socketHub } from "@cc/sockets";
import { notifyCallbackRequest } from "@cc/workers/staff-notes";
import { sendAcrioChatMessage } from "./acrio-chat-sender";
import { smartAssignConversation } from "./routing-and-escalation";

const CALLBACK_SLOT_LABELS: Record<string, string> = {
  morning: "Morning (10 AM to 1 PM)",
  afternoon: "Afternoon (2 PM to 5 PM)",
  evening: "Evening (5 PM to 8 PM)",
};

async function ensureCallbackRequestsTable(): Promise<void> {
  const conv = getRawLibSqlClient("conversations");
  await conv.execute(`CREATE TABLE IF NOT EXISTS callback_requests (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_name TEXT NOT NULL DEFAULT '',
    preferred_slot TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PENDING',
    handled_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

export async function listCallbackRequests(status?: string): Promise<Record<string, unknown>[]> {
  await ensureDatabasesBootstrapped();
  await ensureCallbackRequestsTable();
  const conv = getRawLibSqlClient("conversations");
  const res = status
    ? await conv.execute({
        sql: `SELECT * FROM callback_requests WHERE status = ? ORDER BY created_at DESC LIMIT 200`,
        args: [status],
      })
    : await conv.execute(`SELECT * FROM callback_requests ORDER BY created_at DESC LIMIT 200`);
  return res.rows.map((r) => ({ ...(r as Record<string, unknown>) }));
}

/**
 * Handles taps on ACRIO's own buttons ("Chat with team", "Request a callback", slots, "Keep browsing").
 * Returns true when the tap was fully handled. Product taps ("acrio:prod:<slug>", "acrio:more") return false
 * so the normal ACRIO flow answers them.
 */
export async function handleAcrioInteractiveReply(params: {
  conversationId: string;
  customerPhone: string;
  payload: string;
  isHandledByAcrio: boolean;
}): Promise<boolean> {
  const payload = params.payload.toLowerCase();
  if (payload.startsWith("acrio:prod:") || payload === "acrio:more") return false;

  const conv = getRawLibSqlClient("conversations");
  const convRes = await conv.execute({
    sql: `SELECT customer_name FROM conversations WHERE id = ? LIMIT 1`,
    args: [params.conversationId],
  });
  const customerName = String(convRes.rows[0]?.customer_name || params.customerPhone);

  const say = async (text: string, interactive?: AcrioInteractive) => {
    const sent = await sendAcrioChatMessage({
      conversationId: params.conversationId,
      customerPhone: params.customerPhone,
      text,
      interactive,
    });
    await conv.execute({
      sql: `UPDATE conversations SET last_message_preview = ?, last_message_at = ?, last_message_direction = 'OUTBOUND', last_message_status = 'SENT' WHERE id = ?`,
      args: [`ACRIO: ${text}`.slice(0, 140), sent.replyIso, params.conversationId],
    });
    socketHub.emit("message:new", {
      conversationId: params.conversationId,
      senderName: "ACRIO",
      text,
    });
  };

  // A human already owns this chat: ignore old ACRIO buttons, except callback slots which are still registered.
  if (!params.isHandledByAcrio && !payload.startsWith("acrio:cb:")) return true;

  if (payload === "acrio:team:ask") {
    await say(ACRIO_TEAM_ASK_TEXT, buildTeamConnectInteractive());
    return true;
  }

  if (payload === "acrio:menu:keep") {
    await say(
      "No problem! Tell me what you would like to see next. You can also type a product code like CCP054."
    );
    return true;
  }

  if (payload === "acrio:team:callback") {
    await say(
      `Sure, we will call you on ${params.customerPhone}.\n\nWhen should we call you?`,
      buildCallbackSlotInteractive()
    );
    return true;
  }

  if (payload === "acrio:team:chat") {
    await say(
      "Connecting you to our *Sales Team* right away.\n\nA team member will pick up this chat and reply here shortly."
    );
    const assigned = await smartAssignConversation({
      conversationId: params.conversationId,
      inboundText: "Customer chose Chat with team",
      preferredTeamId: "team_sales",
      onlyIfUnassigned: false,
      startWaitingTimer: true,
      handoffReasonFromAcrio: "Customer tapped 'Chat with team' in WhatsApp.",
    });
    socketHub.emit("conversation:assigned", {
      conversationId: params.conversationId,
      assignedTeamName: assigned.assignedTeamName,
      assignedStaffName: assigned.assignedStaffName,
      escalationLevel: assigned.escalationLevel,
    });
    return true;
  }

  if (payload.startsWith("acrio:cb:")) {
    const slotKey = payload.replace("acrio:cb:", "");
    const slotLabel = CALLBACK_SLOT_LABELS[slotKey] || slotKey;
    await ensureCallbackRequestsTable();
    const nowIso = new Date().toISOString();

    // What was the customer looking at? Use the saved chat memory for a helpful note to the team.
    const aiState = await loadConversationAiState(params.conversationId).catch(() => null);
    const topic =
      aiState?.focusProductSlug?.replace(/-/g, " ") ||
      aiState?.primaryProductQuery ||
      "General enquiry";

    // One open request per chat: update it instead of creating duplicates.
    const existing = await conv.execute({
      sql: `SELECT id FROM callback_requests WHERE conversation_id = ? AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1`,
      args: [params.conversationId],
    });
    let requestId = existing.rows[0] ? String(existing.rows[0].id) : "";
    if (requestId) {
      await conv.execute({
        sql: `UPDATE callback_requests SET preferred_slot = ?, topic = ?, updated_at = ? WHERE id = ?`,
        args: [slotLabel, topic, nowIso, requestId],
      });
    } else {
      requestId = `cb_${crypto.randomUUID().slice(0, 8)}`;
      await conv.execute({
        sql: `INSERT INTO callback_requests (id, conversation_id, customer_phone, customer_name, preferred_slot, topic, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
        args: [requestId, params.conversationId, params.customerPhone, customerName, slotLabel, topic, nowIso, nowIso],
      });
    }

    // Ping the internal team without moving the chat away from ACRIO.
    const pingBody = `CALLBACK REQUEST: ${customerName} (${params.customerPhone}) wants a call in the ${slotLabel}. Interested in: ${topic}. Request ID ${requestId}.`;
    await conv
      .execute({
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, delivery_status, created_at
        ) VALUES (?, ?, 'INTERNAL', 'SYSTEM', 'ACRIO • Callback Request', 'INTERNAL_NOTE', 'FREE', ?, 'DELIVERED', ?)`,
        args: [`msg_cb_${crypto.randomUUID().slice(0, 8)}`, params.conversationId, pingBody, nowIso],
      })
      .catch(() => {});
    await conv
      .execute({
        sql: `UPDATE conversations
              SET priority = 'HIGH',
                  assigned_team_id = NULL,
                  assigned_team_name = 'System (ACRIO) • Callback requested',
                  unread_count = unread_count + 1
              WHERE id = ?`,
        args: [params.conversationId],
      })
      .catch(() => {});
    socketHub.emit("message:new", {
      conversationId: params.conversationId,
      senderName: "ACRIO • Callback Request",
      text: pingBody,
    });
    socketHub.emit("callback:new", {
      conversationId: params.conversationId,
      customerName,
      customerPhone: params.customerPhone,
      slot: slotLabel,
    });
    if (!existing.rows[0]) {
      // Brand new request: tell the sales team (bell, email, optional WhatsApp).
      void notifyCallbackRequest({
        conversationId: params.conversationId,
        customerName,
        customerPhone: params.customerPhone,
        slot: slotLabel,
        topic,
        requestId,
      });
    }

    await say(
      `Done! Your callback is booked for *${slotLabel}*.\n\nOur team will call you on ${params.customerPhone}. Until then, I am right here if you want to look at anything else.`
    );
    return true;
  }

  return false;
}
