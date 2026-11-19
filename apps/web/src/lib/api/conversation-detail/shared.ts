import type { AuthenticatedUser } from "@cc/auth";
import type { getRawLibSqlClient } from "@cc/database";

export type DbClient = ReturnType<typeof getRawLibSqlClient>;

export interface ConversationActionContext {
  id: string;
  user: AuthenticatedUser;
  body: Record<string, unknown>;
  conv: DbClient;
  crm: DbClient;
  cRow: Record<string, unknown>;
  customerPhone: string;
  nowMs: number;
  nowIso: string;
}

export async function resolveQuotedReply(
  conv: DbClient,
  conversationId: string,
  body: Record<string, unknown>
) {
  const rawReplyObj =
    body.replyTo && typeof body.replyTo === "object"
      ? (body.replyTo as Record<string, unknown>)
      : null;
  const requestedMsgId = String(
    body.replyToMessageId || rawReplyObj?.messageId || ""
  ).trim();

  if (requestedMsgId && !requestedMsgId.startsWith("optimistic_")) {
    const origRes = await conv.execute({
      sql: `SELECT id, wa_message_id, sender_name, sender_type, direction, body
            FROM messages
            WHERE id = ? AND conversation_id = ?
            LIMIT 1`,
      args: [requestedMsgId, conversationId],
    });
    const orig = origRes.rows[0] as Record<string, unknown> | undefined;
    if (orig) {
      return {
        messageId: String(orig.id),
        waMessageId: orig.wa_message_id ? String(orig.wa_message_id) : null,
        senderName: String(orig.sender_name || ""),
        senderType: String(orig.sender_type || ""),
        direction: String(orig.direction || ""),
        body: String(orig.body || "").slice(0, 280),
      };
    }
  }

  if (rawReplyObj && String(rawReplyObj.body || "").trim()) {
    return {
      messageId: requestedMsgId || null,
      waMessageId: rawReplyObj.waMessageId ? String(rawReplyObj.waMessageId) : null,
      senderName: String(rawReplyObj.senderName || "Message"),
      senderType: rawReplyObj.senderType ? String(rawReplyObj.senderType) : "",
      direction: rawReplyObj.direction ? String(rawReplyObj.direction) : "",
      body: String(rawReplyObj.body || "").slice(0, 280),
    };
  }

  return null;
}
