import { getRawLibSqlClient } from "@cc/database";
import { parseAssignCommand } from "./identity-and-parse";
import { assignLeadFromOwner } from "./lead-assign";
import { handleOwnerReadCommand } from "./owner-commands";
import { ownerDisplayName, type LogAssignmentFn } from "./types";

/**
 * Handles everything the owner can say that is not a normal AI chat. Returns true when the message was fully handled.
 */
export async function handleOwnerDeskMessage(p: {
  conversationId: string;
  ownerPhone: string;
  text: string;
  currentWaMessageId?: string;
  replyToWaMessageId?: string;
  /** True when this message (or the burst it belongs to) carries a voice note, photo, video or file. */
  hasAttachment?: boolean;
  hubBase: string;
  logAssignment: LogAssignmentFn;
  reply: (text: string) => Promise<void>;
}): Promise<boolean> {
  const text = String(p.text || "").trim();
  if (!text) return false;
  const ownerName = ownerDisplayName();

  // 1. "please assign to @staff"
  const parsed = parseAssignCommand(text);
  if (parsed.found) {
    const result = await assignLeadFromOwner(parsed, {
      conversationId: p.conversationId,
      ownerPhone: p.ownerPhone,
      ownerName,
      text,
      currentWaMessageId: p.currentWaMessageId,
      replyToWaMessageId: p.replyToWaMessageId,
      hubBase: p.hubBase,
      logAssignment: p.logAssignment,
    });
    if (result.handled) {
      await p.reply(result.reply);
      return true;
    }
  }

  // 1b. A voice note, photo, video or file (with or without a caption) is part of an enquiry that is still being
  // sent. Keep it with the lead, never run the AI on it, and only acknowledge once so a burst of 3 files is not 3 replies.
  const isMediaDrop =
    Boolean(p.hasAttachment) || /^\[(?:image|document|video|voice note|audio|location)[^\]]*\]/im.test(text);
  if (isMediaDrop) {
    const recent = await getRawLibSqlClient("conversations")
      .execute({
        sql: `SELECT body, created_at FROM messages WHERE conversation_id = ? AND direction = 'OUTBOUND' ORDER BY created_at DESC LIMIT 1`,
        args: [p.conversationId],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const lastOut = recent.rows[0];
    const justAcknowledged =
      Boolean(lastOut) &&
      /keeping your (?:voice notes|locations)/.test(String(lastOut.body || "")) &&
      Date.now() - new Date(String(lastOut.created_at)).getTime() < 90 * 1000;
    if (!justAcknowledged) {
      await p.reply(
        "Got it, sir. I am keeping your locations, photos, files, voice notes and text together for this client. Send the rest, then just reply *assign* (or *assign to <name>*)."
      );
    }
    return true;
  }

  // 2. Read-only owner commands
  if (await handleOwnerReadCommand({ text, hubBase: p.hubBase, reply: p.reply })) return true;

  // 3. A pasted enquiry: keep it quietly until the owner says who should get it. No AI call, no long reply.
  const looksLikeEnquiry =
    !/\?\s*$/.test(text) && (/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/.test(text) || text.length >= 120);
  if (looksLikeEnquiry) {
    await p.reply(
      "Got it, sir. Just reply *assign* (or *assign to <name>*) and I will send it in A-Z sequence."
    );
    return true;
  }

  return false;
}
