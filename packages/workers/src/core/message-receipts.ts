import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { socketHub } from "@cc/sockets";

// Monotonic WhatsApp receipt progression (SENDING -> SENT -> DELIVERED -> READ)

const RECEIPT_RANK: Record<string, number> = {
  SENDING: 0,
  QUEUED: 0,
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  SEEN: 3,
  PLAYED: 3,
};

function canAdvanceDeliveryStatus(currentRaw: string, nextRaw: string): boolean {
  const cur = String(currentRaw || "SENT").trim().toUpperCase();
  const next = String(nextRaw || "").trim().toUpperCase();
  if (next === "FAILED") {
    return cur !== "DELIVERED" && cur !== "READ";
  }
  if (cur === "FAILED") {
    // Allow late real delivery/read webhook to recover a transient failed mark
    return next === "DELIVERED" || next === "READ";
  }
  const curRank = RECEIPT_RANK[cur] ?? 1;
  const nextRank = RECEIPT_RANK[next] ?? -1;
  return nextRank > curRank;
}

export async function applyWhatsAppMessageReceipt(params: {
  waMessageId?: string | null;
  messageId?: string | null;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  errorCode?: string | number | null;
  errorMessage?: string | null;
  errorDetails?: string | null;
  timestampIso?: string | null;
}): Promise<{ updated: boolean; conversationId: string | null }> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const mkt = getRawLibSqlClient("marketing");
  const nextStatus = params.status;
  const waId = params.waMessageId ? String(params.waMessageId).trim() : "";
  const msgId = params.messageId ? String(params.messageId).trim() : "";

  let updated = false;
  let conversationId: string | null = null;
  let resolvedMsgId: string | null = msgId || null;
  let resolvedWaId: string | null = waId || null;

  if (waId || msgId) {
    const existingRes = await conv.execute(
      waId
        ? {
            sql: `SELECT id, conversation_id, delivery_status, wa_message_id, metadata_json
                  FROM messages
                  WHERE wa_message_id = ?
                  LIMIT 1`,
            args: [waId],
          }
        : {
            sql: `SELECT id, conversation_id, delivery_status, wa_message_id, metadata_json
                  FROM messages
                  WHERE id = ?
                  LIMIT 1`,
            args: [msgId],
          }
    );

    const row = existingRes.rows[0];
    if (row) {
      conversationId = String(row.conversation_id);
      resolvedMsgId = String(row.id);
      resolvedWaId = row.wa_message_id ? String(row.wa_message_id) : resolvedWaId;
      const currentStatus = String(row.delivery_status || "SENT");

      if (canAdvanceDeliveryStatus(currentStatus, nextStatus)) {
        let meta: Record<string, unknown> = {};
        if (row.metadata_json) {
          try {
            meta = JSON.parse(String(row.metadata_json));
          } catch {
            meta = {};
          }
        }
        if (nextStatus === "FAILED" || params.errorCode || params.errorMessage) {
          meta.errorCode = params.errorCode ? String(params.errorCode) : (meta.errorCode ?? null);
          meta.errorMessage = params.errorMessage ? String(params.errorMessage) : (meta.errorMessage ?? null);
          if (params.errorDetails) meta.errorDetails = String(params.errorDetails);
          meta.failedAt = params.timestampIso || new Date().toISOString();
        }

        await conv.execute({
          sql: `UPDATE messages SET delivery_status = ?, metadata_json = ? WHERE id = ?`,
          args: [nextStatus, JSON.stringify(meta), resolvedMsgId],
        });
        await conv
          .execute({
            sql: `UPDATE conversations
                  SET last_message_status = ?
                  WHERE id = ? AND last_message_direction = 'OUTBOUND'`,
            args: [nextStatus, conversationId],
          })
          .catch(() => {});
        updated = true;
      }
    }
  }

  // Sync broadcast_recipients + broadcasts counters if this wamid belongs to a campaign
  if (resolvedWaId) {
    const recRes = await mkt.execute({
      sql: `SELECT id, broadcast_id, status, skip_or_error_reason
            FROM broadcast_recipients
            WHERE wa_message_id = ?
            LIMIT 1`,
      args: [resolvedWaId],
    });
    const rec = recRes.rows[0];
    if (rec) {
      const broadcastId = String(rec.broadcast_id);
      const curRecStatus = String(rec.status || "SENT");
      if (canAdvanceDeliveryStatus(curRecStatus, nextStatus)) {
        let errorReason = rec.skip_or_error_reason ? String(rec.skip_or_error_reason) : null;
        if (nextStatus === "FAILED") {
          const parts: string[] = [];
          if (params.errorCode) parts.push(`Code ${params.errorCode}`);
          if (params.errorMessage) parts.push(String(params.errorMessage));
          if (params.errorDetails) parts.push(String(params.errorDetails));
          errorReason = parts.length > 0 ? parts.join(": ") : (errorReason || "Delivery failed");
        }

        await mkt.execute({
          sql: `UPDATE broadcast_recipients
                SET status = ?,
                    skip_or_error_reason = COALESCE(?, skip_or_error_reason)
                WHERE id = ?`,
          args: [nextStatus, errorReason, String(rec.id)],
        });
        await mkt.execute({
          sql: `UPDATE broadcasts
                SET delivered_count = (
                      SELECT COUNT(*) FROM broadcast_recipients
                      WHERE broadcast_id = ? AND status IN ('DELIVERED', 'READ')
                    ),
                    read_count = (
                      SELECT COUNT(*) FROM broadcast_recipients
                      WHERE broadcast_id = ? AND status = 'READ'
                    ),
                    failed_count = (
                      SELECT COUNT(*) FROM broadcast_recipients
                      WHERE broadcast_id = ? AND status = 'FAILED'
                    )
                WHERE id = ?`,
          args: [broadcastId, broadcastId, broadcastId, broadcastId],
        });
        socketHub.emit("broadcast:progress", {
          broadcastId,
          waMessageId: resolvedWaId,
          status: nextStatus,
          errorCode: params.errorCode ? String(params.errorCode) : null,
          errorMessage: params.errorMessage ? String(params.errorMessage) : null,
        });
      }
    }
  }

  if (updated) {
    socketHub.emit("message:status", {
      conversationId,
      messageId: resolvedMsgId,
      waMessageId: resolvedWaId,
      status: nextStatus,
      errorCode: params.errorCode ? String(params.errorCode) : null,
      errorMessage: params.errorMessage ? String(params.errorMessage) : null,
    });
  }

  return { updated, conversationId };
}

/**
 * When a customer sends an INBOUND reply in a conversation (or when testing customer read),
 * any prior OUTBOUND messages in that conversation still at SENDING/SENT/DELIVERED are marked READ.
 */
export async function markPriorOutboundMessagesRead(
  conversationId: string
): Promise<number> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const res = await conv.execute({
    sql: `UPDATE messages
          SET delivery_status = 'READ'
          WHERE conversation_id = ?
            AND direction = 'OUTBOUND'
            AND delivery_status IN ('SENDING', 'SENT', 'DELIVERED')`,
    args: [conversationId],
  });
  const changed = Number(res.rowsAffected ?? 0);
  if (changed > 0) {
    socketHub.emit("message:status", {
      conversationId,
      status: "READ",
      markAllOutboundRead: true,
    });
  }
  return changed;
}

/**
 * In Sandbox Simulator mode, simulates authentic WhatsApp Cloud delivery progression:
 * message starts as SENT (single tick) and transitions to DELIVERED (double grey ticks) after ~1.3s.
 */
export function scheduleSandboxDeliveryReceipt(params: {
  conversationId: string;
  messageId: string;
  waMessageId: string;
  delayMs?: number;
}): void {
  const delay = Math.max(350, params.delayMs ?? 1300);
  const timer = setTimeout(() => {
    void applyWhatsAppMessageReceipt({
      messageId: params.messageId,
      waMessageId: params.waMessageId,
      status: "DELIVERED",
    }).catch(() => {});
  }, delay);
  timer.unref();
}
