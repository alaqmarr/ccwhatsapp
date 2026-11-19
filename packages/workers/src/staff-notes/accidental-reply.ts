import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { socketHub } from "@cc/sockets";
import { dispatchStaffCustomerReply } from "./pending-actions";

const INTERNAL_MEMO_ONLY_RE =
  /\b(customer\s+(?:is|wants|asked|said|called|will|needs)|client\s+(?:is|wants|asked|said|called|will|needs)|spoke\s+(?:to|with)\s+(?:him|her|client|customer)|called\s+(?:him|her|client|customer)|internal\s+note|team\s+note|assign(?:ed)?\s+to|follow\s*up\s+tomorrow|fake\s+lead|spam|wrong\s+number|do\s+not\s+reply|don'?t\s+reply|waiting\s+for\s+po|payment\s+received\s+from\s+client|replied\s+in\s+note|note\s+instead\s+of)\b/i;

const CUSTOMER_FACING_NOTE_SIGNAL_RE =
  /\b(dear\s+sir|dear\s+madam|yes\s+sir|no\s+sir|ok\s+sir|okay\s+sir|sorry\s+sir|hello\s+sir|hi\s+sir|sir\s*[,!.]$|madam\s*[,!.]$|ma'?am\s*[,!.]$|thank\s+you\s+for\s+contacting|each\s+one\s+[\d,]+|\d[\d,]*\s*\/-\s*plus\s*gst|plus\s+gst(?:\s+and\s+transport)?|transport\s+charges|delivery\s+charges|please\s+let\s+us\s+know|please\s+share\s+your\s+gst|we\s+can\s+dispatch|working\s+days)\b/i;

const SHORT_CORRECTION_SIGNAL_RE =
  /^(?:sorry|sry|apologies|by\s+mistake|correction|it\s+is|actually|mean|meant)\b|\b(?:sorry|sry)\s+\d+(?:\.\d+)?\s*(?:mm|cm|inch|in|ft|rs\.?|₹|\/-|\s*thickness)\b/i;

/**
 * When a staff member accidentally writes a short correction in an Internal Note (e.g. "sorry 3mm thickness")
 * quoting or following their own outbound message (e.g. "5mm thickness Each one 3,220/- plus Gst and Transport charges sir,"),
 * builds a complete corrected customer message alongside the raw note text.
 */
export function buildSmartCorrectedReplyOption(
  noteText: string,
  referenceOutboundBody: string
): string | null {
  const cleanNote = String(noteText || "").trim();
  const cleanRef = String(referenceOutboundBody || "").trim();
  if (!cleanNote || !cleanRef || cleanNote.toLowerCase() === cleanRef.toLowerCase()) {
    return null;
  }

  // Case 1: Thickness / dimension replacement (e.g. "sorry 3mm thickness" -> replaces "5mm thickness" in reference)
  const noteDimMatch = cleanNote.match(
    /\b(\d+(?:\.\d+)?\s*(?:mm|cm|inch|inches|in|ft))(?:\s*(thickness|thick))?\b/i
  );
  const refDimMatch = cleanRef.match(
    /\b(\d+(?:\.\d+)?\s*(?:mm|cm|inch|inches|in|ft))(?:\s*(thickness|thick))?\b/i
  );
  if (
    noteDimMatch &&
    refDimMatch &&
    noteDimMatch[1].replace(/\s+/g, "").toLowerCase() !==
      refDimMatch[1].replace(/\s+/g, "").toLowerCase()
  ) {
    const newDim = noteDimMatch[2]
      ? `${noteDimMatch[1]} ${noteDimMatch[2]}`
      : refDimMatch[2]
      ? `${noteDimMatch[1]} ${refDimMatch[2]}`
      : noteDimMatch[1];
    const replaced = cleanRef
      .replace(refDimMatch[0], newDim)
      .replace(/[,;\s]+$/, "");
    return /^sorry\b/i.test(cleanNote) && !/^sorry\b/i.test(replaced)
      ? `Sorry, ${replaced}`
      : replaced;
  }

  // Case 2: Price replacement (e.g. "sorry 3,500/-" -> replaces "3,220/-" in reference)
  const notePriceMatch = cleanNote.match(/\b((?:₹|rs\.?\s*)?\d[\d,]*(?:\s*\/-)?)\b/i);
  const refPriceMatch = cleanRef.match(/\b((?:₹|rs\.?\s*)?\d[\d,]*(?:\s*\/-))\b/i);
  if (
    notePriceMatch &&
    refPriceMatch &&
    !noteDimMatch &&
    notePriceMatch[1].replace(/[^\d]/g, "") !== refPriceMatch[1].replace(/[^\d]/g, "") &&
    notePriceMatch[1].replace(/[^\d]/g, "").length >= 3
  ) {
    const newPrice =
      /\/-/.test(refPriceMatch[1]) && !/\/-/.test(notePriceMatch[1])
        ? `${notePriceMatch[1]}/-`
        : notePriceMatch[1];
    const replaced = cleanRef
      .replace(refPriceMatch[0], newPrice)
      .replace(/[,;\s]+$/, "");
    return /^sorry\b/i.test(cleanNote) && !/^sorry\b/i.test(replaced)
      ? `Sorry, ${replaced}`
      : replaced;
  }

  return null;
}

/**
 * Detects when a staff member accidentally writes a reply or correction intended for the customer
 * inside an Internal Team Note instead of the WhatsApp reply box.
 */
export function detectAccidentalCustomerReplyInNote(params: {
  noteText: string;
  replyTo?: Record<string, unknown> | null;
  recentMessages?: Array<{
    id?: string;
    waMessageId?: string | null;
    direction: string;
    senderName: string;
    senderType?: string;
    messageType?: string;
    body: string;
  }>;
}): {
  isAccidentalCustomerReply: boolean;
  reason: string;
  exactMessageText: string;
  mergedCorrectionText: string | null;
  replyTo: Record<string, unknown> | null;
} {
  const trimmed = String(params.noteText || "").trim();
  const emptyResult = {
    isAccidentalCustomerReply: false,
    reason: "",
    exactMessageText: trimmed,
    mergedCorrectionText: null,
    replyTo: params.replyTo || null,
  };

  if (!trimmed || trimmed.includes("@")) {
    return emptyResult;
  }

  // Do not flag short confirmation/cancellation keywords meant for pending ACRIO actions
  if (
    /^(?:yes|yep|yeah|confirm|confirmed|approve|approved|go ahead|ok|okay|proceed|send|send it|share|share it|do it|cancel|no|nope|stop|abort|#[1-9]|[1-9])[.!]*$/i.test(
      trimmed
    )
  ) {
    return emptyResult;
  }

  if (INTERNAL_MEMO_ONLY_RE.test(trimmed)) {
    return emptyResult;
  }

  const replyTo = params.replyTo || null;
  const replyDirection = String(replyTo?.direction || "").toUpperCase();
  const replyBody = String(replyTo?.body || "").trim();
  const recent = params.recentMessages || [];
  const lastNonNoteMsg = [...recent]
    .reverse()
    .find(
      (m) =>
        (m.direction === "OUTBOUND" || m.direction === "INBOUND") &&
        m.messageType !== "INTERNAL_NOTE"
    );

  // Signal 1: Staff clicked "Note" on an OUTBOUND or INBOUND WhatsApp bubble (quoting it) and typed a message/correction without @mention
  if (
    replyTo &&
    (replyDirection === "OUTBOUND" || replyDirection === "INBOUND" || replyBody.length > 0)
  ) {
    const merged =
      replyDirection === "OUTBOUND" || (!replyDirection && replyBody)
        ? buildSmartCorrectedReplyOption(trimmed, replyBody)
        : null;
    return {
      isAccidentalCustomerReply: true,
      reason:
        replyDirection === "OUTBOUND"
          ? "Staff quoted an outbound WhatsApp message inside an Internal Note without @mentioning a teammate"
          : "Staff quoted a customer WhatsApp message inside an Internal Note without @mentioning a teammate",
      exactMessageText: trimmed,
      mergedCorrectionText: merged,
      replyTo,
    };
  }

  // Signal 2: Staff wrote a short correction ("sorry 3mm thickness", "sorry 4,500/-") right after an outbound message
  if (SHORT_CORRECTION_SIGNAL_RE.test(trimmed)) {
    const refOutbound =
      lastNonNoteMsg?.direction === "OUTBOUND"
        ? lastNonNoteMsg
        : [...recent]
            .reverse()
            .find((m) => m.direction === "OUTBOUND" && m.messageType !== "INTERNAL_NOTE");
    const inferredReplyTo = refOutbound
      ? {
          messageId: refOutbound.id || null,
          waMessageId: refOutbound.waMessageId || null,
          senderName: refOutbound.senderName,
          senderType: refOutbound.senderType || "STAFF",
          direction: "OUTBOUND",
          body: refOutbound.body.slice(0, 280),
        }
      : null;
    const merged = refOutbound
      ? buildSmartCorrectedReplyOption(trimmed, refOutbound.body)
      : null;
    return {
      isAccidentalCustomerReply: true,
      reason: "Staff wrote a customer correction inside an Internal Note instead of the chat reply",
      exactMessageText: trimmed,
      mergedCorrectionText: merged,
      replyTo: inferredReplyTo,
    };
  }

  // Signal 3: Direct customer-facing quote or salutation ("5mm thickness Each one 3,220/- plus Gst and Transport charges sir")
  if (
    CUSTOMER_FACING_NOTE_SIGNAL_RE.test(trimmed) ||
    /\b(?:sir|madam|ma'?am)\s*[,!.]*$/i.test(trimmed)
  ) {
    return {
      isAccidentalCustomerReply: true,
      reason:
        "Note directly addresses the customer or quotes pricing/GST/transport without @mentioning any teammate",
      exactMessageText: trimmed,
      mergedCorrectionText: null,
      replyTo: null,
    };
  }

  return emptyResult;
}

/**
 * Directly sends an existing Internal Team Note (or its merged correction) to the customer on WhatsApp
 * when a staff member clicks "Send in Chat" on the note bubble.
 */
export async function convertInternalNoteToCustomerMessage(params: {
  conversationId: string;
  noteMessageId: string;
  actorStaffId: string;
  actorStaffName: string;
  customText?: string;
  dismissOnly?: boolean;
}): Promise<{
  ok: boolean;
  messageId?: string;
  status?: "SENT" | "DISMISSED";
  error?: string;
}> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();

  const [noteRes, convRes] = await Promise.all([
    conv.execute({
      sql: `SELECT id, body, metadata_json FROM messages WHERE id = ? AND conversation_id = ? LIMIT 1`,
      args: [params.noteMessageId, params.conversationId],
    }),
    conv.execute({
      sql: `SELECT customer_phone, customer_name FROM conversations WHERE id = ? LIMIT 1`,
      args: [params.conversationId],
    }),
  ]);

  const noteRow = noteRes.rows[0] as Record<string, unknown> | undefined;
  const cRow = convRes.rows[0] as Record<string, unknown> | undefined;
  if (!noteRow || !cRow) {
    return { ok: false, error: "Internal note or conversation not found." };
  }

  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(String(noteRow.metadata_json || "{}"));
  } catch {
    meta = {};
  }

  if (params.dismissOnly) {
    meta.accidentalCustomerReply = {
      ...(typeof meta.accidentalCustomerReply === "object" && meta.accidentalCustomerReply
        ? (meta.accidentalCustomerReply as Record<string, unknown>)
        : { detected: true, exactMessageText: String(noteRow.body || "") }),
      status: "DISMISSED",
    };
    await conv.execute({
      sql: `UPDATE messages SET metadata_json = ? WHERE id = ?`,
      args: [JSON.stringify(meta), params.noteMessageId],
    });
    socketHub.emit("conversation:updated", { conversationId: params.conversationId });
    return { ok: true, status: "DISMISSED" };
  }

  const customerPhone = String(cRow.customer_phone || "");
  const textToSend = String(params.customText || noteRow.body || "").trim();
  if (!textToSend) {
    return { ok: false, error: "Note text is empty." };
  }

  const replyTo =
    (meta.replyTo as Record<string, unknown> | undefined) ||
    ((meta.accidentalCustomerReply as Record<string, unknown> | undefined)?.replyTo as
      | Record<string, unknown>
      | undefined) ||
    null;

  const sendRes = await dispatchStaffCustomerReply({
    conversationId: params.conversationId,
    customerPhone,
    actorStaffId: params.actorStaffId,
    actorStaffName: params.actorStaffName,
    messageText: textToSend,
    replyTo,
    actionTagId: `note_to_chat_${params.noteMessageId}`,
    usePlainStaffSenderName: true,
  });

  if (sendRes.ok) {
    meta.accidentalCustomerReply = {
      ...(typeof meta.accidentalCustomerReply === "object" && meta.accidentalCustomerReply
        ? (meta.accidentalCustomerReply as Record<string, unknown>)
        : {
            detected: true,
            reason: "Converted from Internal Note to WhatsApp Chat",
            exactMessageText: String(noteRow.body || ""),
          }),
      status: "SENT",
      sentMessageId: sendRes.messageId,
      sentByStaffName: params.actorStaffName,
      sentAt: nowIso,
    };
    await conv.execute({
      sql: `UPDATE messages SET metadata_json = ? WHERE id = ?`,
      args: [JSON.stringify(meta), params.noteMessageId],
    });

    // Also mark any linked ACRIO pendingAction note for this sourceNoteId as CONFIRMED
    const acrioNotes = await conv.execute({
      sql: `SELECT id, metadata_json FROM messages
            WHERE conversation_id = ? AND sender_name = 'ACRIO' AND message_type = 'INTERNAL_NOTE'
            AND metadata_json LIKE ? LIMIT 5`,
      args: [params.conversationId, `%"sourceNoteId":"${params.noteMessageId}"%`],
    });
    for (const r of acrioNotes.rows) {
      try {
        const am = JSON.parse(String(r.metadata_json || "{}"));
        if (am.pendingAction && am.pendingAction.status === "PENDING_CONFIRMATION") {
          am.pendingAction.status = "CONFIRMED";
          am.pendingAction.decidedByStaffName = params.actorStaffName;
          am.pendingAction.decidedAt = nowIso;
          am.pendingAction.sentMessageId = sendRes.messageId;
          await conv.execute({
            sql: `UPDATE messages SET metadata_json = ? WHERE id = ?`,
            args: [JSON.stringify(am), String(r.id)],
          });
        }
      } catch {
        // ignore
      }
    }
  }

  return {
    ok: sendRes.ok,
    messageId: sendRes.messageId,
    status: sendRes.ok ? "SENT" : undefined,
    error: sendRes.error,
  };
}
