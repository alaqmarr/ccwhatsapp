import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getSetupStatus } from "@cc/auth";
import { verifyMetaWebhookSignature } from "@cc/connections";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  upsertSyncedContact,
} from "@cc/database";
import { socketHub } from "@cc/sockets";
import {
  applyWhatsAppMessageReceipt,
  logConversationAssignment,
  markPriorOutboundMessagesRead,
  processInboundAutomations,
} from "@cc/workers";

export const dynamic = "force-dynamic";

// Meta Webhook Verification Handshake (`GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const setup = await getSetupStatus();
  if (
    mode === "subscribe" &&
    token &&
    token === setup.facebookConfig.webhookVerifyToken
  ) {
    return new Response(challenge || "OK", { status: 200 });
  }

  return NextResponse.json({ ok: false, error: "Invalid verify token" }, { status: 403 });
}

// Meta Inbound Messages & Delivery Receipts (`POST /api/webhooks/whatsapp`)
export async function POST(req: Request) {
  await ensureDatabasesBootstrapped();
  const rawBody = await req.text();
  const setup = await getSetupStatus();

  const sig = req.headers.get("x-hub-signature-256");
  if (
    setup.facebookConfig.metaAppSecret &&
    !verifyMetaWebhookSignature(rawBody, sig, setup.facebookConfig.metaAppSecret)
  ) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const nowIso = new Date().toISOString();
  const windowExp = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const val = change?.value || {};
      const contacts = val?.contacts || [];

      // 1. Inbound customer messages (initial assignment is ALWAYS ACRIO)
      for (const msg of val?.messages || []) {
        const fromDigits = String(msg?.from || "").replace(/\D/g, "");
        if (!fromDigits) continue;
        const e164 = `+${fromDigits}`;
        const contactName =
          String(contacts[0]?.profile?.name || "").trim() || e164;
        const textBody =
          msg?.text?.body ||
          msg?.button?.text ||
          msg?.interactive?.button_reply?.title ||
          msg?.interactive?.list_reply?.title ||
          "[Media / Attachment]";

        const existingCust = await crm.execute({
          sql: `SELECT id FROM customers WHERE phone = ? LIMIT 1`,
          args: [e164],
        });
        let custId = existingCust.rows[0] ? String(existingCust.rows[0].id) : "";
        if (!custId) {
          custId = `cust_${crypto.randomUUID().slice(0, 8)}`;
          await crm.execute({
            sql: `INSERT INTO customers (id, phone, name, acrio_segment, last_interaction_at, created_at)
                  VALUES (?, ?, ?, 'Inbound WhatsApp Lead', ?, ?)`,
            args: [custId, e164, contactName, nowIso, nowIso],
          });
        }
        await upsertSyncedContact({
          phone: e164,
          name: contactName,
          whatsappName: String(contacts[0]?.profile?.name || "").trim() || undefined,
          source: "WHATSAPP_INBOUND",
          lastContactedAt: nowIso,
        }).catch(() => {});

        const existingConv = await conv.execute({
          sql: `SELECT id, status, assigned_staff_id FROM conversations WHERE customer_phone = ? LIMIT 1`,
          args: [e164],
        });
        const isNew = existingConv.rows.length === 0;
        const prevStatus = existingConv.rows[0] ? String(existingConv.rows[0].status) : "";
        const prevStaffId = existingConv.rows[0]?.assigned_staff_id
          ? String(existingConv.rows[0].assigned_staff_id)
          : null;
        const convId = isNew
          ? `conv_${crypto.randomUUID().slice(0, 8)}`
          : String(existingConv.rows[0].id);

        if (isNew) {
          await conv.execute({
            sql: `INSERT INTO conversations (
              id, customer_phone, customer_name, customer_id, status, priority,
              smart_category, assigned_staff_id, assigned_staff_name, assigned_team_id, assigned_team_name,
              escalation_level, waiting_since, unread_count, last_message_preview, last_message_at, window_expires_at, created_at
            ) VALUES (?, ?, ?, ?, 'OPEN', 'NORMAL', 'General Enquiry', 'ACRIO', 'ACRIO', NULL, 'System (ACRIO)', 'P0', NULL, 1, ?, ?, ?, ?)`,
            args: [convId, e164, contactName, custId, String(textBody).slice(0, 140), nowIso, windowExp, nowIso],
          });
        } else {
          const resetToAcrio = prevStatus === "RESOLVED";
          const isHumanOwned = !resetToAcrio && prevStaffId !== "ACRIO";
          await conv.execute({
            sql: `UPDATE conversations
                  SET status = CASE WHEN status = 'RESOLVED' THEN 'OPEN' ELSE status END,
                      assigned_staff_id = CASE WHEN ? = 1 THEN 'ACRIO' ELSE assigned_staff_id END,
                      assigned_staff_name = CASE WHEN ? = 1 THEN 'ACRIO' ELSE assigned_staff_name END,
                      assigned_team_id = CASE WHEN ? = 1 THEN NULL ELSE assigned_team_id END,
                      assigned_team_name = CASE WHEN ? = 1 THEN 'System (ACRIO)' ELSE assigned_team_name END,
                      escalation_level = CASE WHEN ? = 1 THEN 'P0' ELSE escalation_level END,
                      waiting_since = CASE WHEN ? = 1 THEN COALESCE(waiting_since, ?) ELSE waiting_since END,
                      unread_count = unread_count + 1,
                      last_message_preview = ?,
                      last_message_at = ?,
                      window_expires_at = ?
                  WHERE id = ?`,
            args: [
              resetToAcrio ? 1 : 0,
              resetToAcrio ? 1 : 0,
              resetToAcrio ? 1 : 0,
              resetToAcrio ? 1 : 0,
              resetToAcrio ? 1 : 0,
              isHumanOwned ? 1 : 0,
              nowIso,
              String(textBody).slice(0, 140),
              nowIso,
              windowExp,
              convId,
            ],
          });
        }

        const resetToAcrio = !isNew && prevStatus === "RESOLVED";
        if (isNew || resetToAcrio) {
          const assignTime = new Date(Math.max(0, Date.now() - 2)).toISOString();
          await logConversationAssignment({
            conversationId: convId,
            customerPhone: e164,
            customerName: contactName,
            toStaffId: "ACRIO",
            toStaffName: "ACRIO",
            toTeamId: null,
            toTeamName: "System (ACRIO)",
            escalationLevel: "P0",
            assignmentSource: "INITIAL_SYSTEM",
            assignedByName: "System",
            reason: isNew
              ? "Customer started a new WhatsApp chat"
              : "Customer messaged after previous resolution",
            assignedAt: assignTime,
          });
        }

        // Customer replied -> any earlier outbound messages in this thread were clearly read
        await markPriorOutboundMessagesRead(convId);

        // Resolve quoted reply context if customer swiped/replied to an earlier WhatsApp message
        const contextWaId = String(msg?.context?.id || "").trim();
        let inboundMetadataJson = "{}";
        if (contextWaId) {
          const origRes = await conv.execute({
            sql: `SELECT id, sender_name, sender_type, direction, body
                  FROM messages
                  WHERE wa_message_id = ?
                  LIMIT 1`,
            args: [contextWaId],
          });
          const orig = origRes.rows[0] as Record<string, unknown> | undefined;
          const replyTo = orig
            ? {
                messageId: String(orig.id),
                waMessageId: contextWaId,
                senderName: String(orig.sender_name || "Classic Concepts"),
                senderType: String(orig.sender_type || "STAFF"),
                direction: String(orig.direction || "OUTBOUND"),
                body: String(orig.body || "").slice(0, 280),
              }
            : {
                messageId: null,
                waMessageId: contextWaId,
                senderName: "Earlier WhatsApp message",
                senderType: "STAFF",
                direction: "OUTBOUND",
                body: "Customer replied to an earlier message on WhatsApp",
              };
          inboundMetadataJson = JSON.stringify({ replyTo });
        }

        await conv.execute({
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
          ) VALUES (?, ?, 'INBOUND', 'CUSTOMER', ?, 'TEXT', 'FREE_CHAT', ?, ?, ?, 'DELIVERED', ?)`,
          args: [
            `msg_${crypto.randomUUID().slice(0, 8)}`,
            convId,
            contactName,
            String(textBody),
            inboundMetadataJson,
            String(msg?.id || ""),
            nowIso,
          ],
        });

        await processInboundAutomations({
          conversationId: convId,
          customerPhone: e164,
          inboundText: String(textBody),
          isNewConversation: isNew || prevStatus === "RESOLVED",
        });

        socketHub.emit("message:new", { conversationId: convId, customerName: contactName });
      }

      // 2. Monotonic Delivery & Read Receipts (never downgrades READ -> DELIVERED or DELIVERED -> SENT)
      for (const st of val?.statuses || []) {
        const waId = String(st?.id || "");
        const rawStatus = String(st?.status || "").toUpperCase();
        if (
          waId &&
          (rawStatus === "SENT" ||
            rawStatus === "DELIVERED" ||
            rawStatus === "READ" ||
            rawStatus === "FAILED")
        ) {
          await applyWhatsAppMessageReceipt({
            waMessageId: waId,
            status: rawStatus,
          });
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
