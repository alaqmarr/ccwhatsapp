import crypto from "node:crypto";
import {
  addConversationCollaborators,
  getRawLibSqlClient,
} from "@cc/database";
import { enqueueJob } from "@cc/queue";
import { socketHub } from "@cc/sockets";
import {
  buildSmartCorrectedReplyOption,
  detectAccidentalCustomerReplyInNote,
} from "./accidental-reply";
import { claimAndRunStaffNoteJobs } from "./acrio-note-ai";
import {
  alertStaffOutsideApp,
  createNotification,
  ensureStaffNotificationsTable,
  parseNoteMentions,
} from "./notifications";
import {
  STAFF_NOTE_QUEUE,
  type AccidentalCustomerReplyMetadata,
  type MentionableStaff,
  type NoteAttachmentPayload,
  type PendingAcrioCandidateOption,
  type PendingAcrioNoteAction,
} from "./types";

/**
 * Called after a private note is saved.
 * 1. Pings mentioned teammates and, when the note contains "@ACRIO", has ACRIO answer in a private note.
 * 2. Automatically detects when a staff member accidentally writes a customer reply inside an Internal Note
 *    (or when a teammate points out "you have replied in note instead of message reply") and surfaces a
 *    one-click "Send in Chat" smart action card.
 */
export async function processStaffNote(params: {
  conversationId: string;
  noteId: string;
  noteText: string;
  author: { id: string; name: string };
  staff: MentionableStaff[];
  noteAttachment?: NoteAttachmentPayload | null;
}): Promise<{
  mentioned: { id: string; name: string }[];
  askedAcrio: boolean;
  collaboratorsAdded: { staffId: string; staffName: string }[];
  accidentalReplyDetected?: boolean;
}> {
  await ensureStaffNotificationsTable();
  const conv = getRawLibSqlClient("conversations");
  const { mentions, askAcrio } = parseNoteMentions(params.noteText, params.staff);

  const [convRes, noteRes, recentRes] = await Promise.all([
    conv.execute({
      sql: `SELECT customer_name, customer_phone FROM conversations WHERE id = ? LIMIT 1`,
      args: [params.conversationId],
    }),
    conv.execute({
      sql: `SELECT metadata_json FROM messages WHERE id = ? LIMIT 1`,
      args: [params.noteId],
    }),
    conv.execute({
      sql: `SELECT id, wa_message_id, direction, sender_name, sender_type, message_type, body, metadata_json
            FROM messages WHERE conversation_id = ? AND id != ?
            ORDER BY created_at DESC LIMIT 16`,
      args: [params.conversationId, params.noteId],
    }),
  ]);
  const customerName = String(convRes.rows[0]?.customer_name || "a customer");
  const customerPhone = String(convRes.rows[0]?.customer_phone || "");

  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(String(noteRes.rows[0]?.metadata_json || "{}"));
  } catch {
    meta = {};
  }

  const recentMessages = [...recentRes.rows].reverse().map((r) => ({
    id: String(r.id),
    waMessageId: r.wa_message_id ? String(r.wa_message_id) : null,
    direction: String(r.direction || ""),
    senderName: String(r.sender_name || ""),
    senderType: String(r.sender_type || ""),
    messageType: String(r.message_type || ""),
    body: String(r.body || ""),
    metadataJson: r.metadata_json ? String(r.metadata_json) : "",
  }));

  // Case A: No @mentions and no @ACRIO -> check if the staff member accidentally wrote a customer reply in an Internal Note!
  if (mentions.length === 0 && !askAcrio) {
    const detection = detectAccidentalCustomerReplyInNote({
      noteText: params.noteText,
      replyTo: (meta.replyTo as Record<string, unknown> | undefined) || null,
      recentMessages,
    });

    if (detection.isAccidentalCustomerReply) {
      const nowIso = new Date().toISOString();
      const accidentalMeta: AccidentalCustomerReplyMetadata = {
        detected: true,
        status: "PENDING",
        reason: detection.reason,
        exactMessageText: detection.exactMessageText,
        mergedCorrectionText: detection.mergedCorrectionText,
        replyTo: detection.replyTo,
      };
      meta.accidentalCustomerReply = accidentalMeta;
      await conv.execute({
        sql: `UPDATE messages SET metadata_json = ? WHERE id = ?`,
        args: [JSON.stringify(meta), params.noteId],
      });

      const candidateOptions: PendingAcrioCandidateOption[] = detection.mergedCorrectionText
        ? [
            {
              id: "opt_merged_correction",
              title: "Send full corrected message in Chat (Recommended)",
              sourceLabel: "Merged with your previous message",
              mediaUrl: "",
              mediaType: "TEXT",
              fileName: "",
              mimeType: "text/plain",
              messageText: detection.mergedCorrectionText,
              replyTo: detection.replyTo,
            },
            {
              id: "opt_exact_note",
              title: "Send exact note text in Chat",
              sourceLabel: "As written in note",
              mediaUrl: "",
              mediaType: "TEXT",
              fileName: "",
              mimeType: "text/plain",
              messageText: detection.exactMessageText,
              replyTo: detection.replyTo,
            },
          ]
        : [];

      const pendingAction: PendingAcrioNoteAction = {
        id: `pact_note_fix_${crypto.randomUUID().slice(0, 8)}`,
        status: "PENDING_CONFIRMATION",
        type: "send_customer_reply",
        title: `Send in WhatsApp Chat to ${customerName}`,
        messageText: detection.mergedCorrectionText || detection.exactMessageText,
        sourceNoteId: params.noteId,
        replyTo: detection.replyTo,
        ...(candidateOptions.length > 0 ? { candidateOptions } : {}),
        requestedByStaffId: params.author.id,
        requestedByStaffName: params.author.name,
        createdAt: nowIso,
      };

      const acrioWarnId = `msg_note_acrio_${crypto.randomUUID().slice(0, 8)}`;
      const acrioWarnBody = `@${params.author.name} Heads up! It looks like you replied inside an *Internal Team Note* by mistake (*${customerName}* cannot see internal notes).\n\nClick below to send this directly in the customer's WhatsApp chat:`;

      await conv.execute({
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, metadata_json, delivery_status, created_at
        ) VALUES (?, ?, 'INTERNAL', 'ACRIO', 'ACRIO', 'INTERNAL_NOTE', 'INTERNAL', ?, ?, 'SAVED', ?)`,
        args: [
          acrioWarnId,
          params.conversationId,
          acrioWarnBody,
          JSON.stringify({
            acrioReply: true,
            inReplyToNoteId: params.noteId,
            forStaffId: params.author.id,
            forStaffName: params.author.name,
            pendingAction,
          }),
          nowIso,
        ],
      });

      socketHub.emit("note:new", {
        conversationId: params.conversationId,
        senderName: "ACRIO",
        noteText: acrioWarnBody,
      });
      await createNotification({
        staffId: params.author.id,
        type: "ACRIO_REPLY",
        conversationId: params.conversationId,
        messageId: acrioWarnId,
        fromName: "ACRIO",
        customerName,
        text: `Heads up: You replied in an Internal Note instead of the customer chat ("${detection.exactMessageText.slice(0, 80)}"). Click to send it in chat.`,
      }).catch(() => {});

      return {
        mentioned: [],
        askedAcrio: false,
        collaboratorsAdded: [],
        accidentalReplyDetected: true,
      };
    }

    return { mentioned: [], askedAcrio: false, collaboratorsAdded: [] };
  }

  // Dual assignment: grant chat access to every mentioned teammate automatically
  let collaboratorsAdded: { staffId: string; staffName: string }[] = [];
  if (mentions.length > 0) {
    const updatedCollabs = await addConversationCollaborators({
      conversationId: params.conversationId,
      members: mentions.map((m) => ({ staffId: m.id, staffName: m.name })),
      addedBy: params.author.name,
    }).catch(() => []);
    collaboratorsAdded = updatedCollabs.map((c) => ({
      staffId: c.staffId,
      staffName: c.staffName,
    }));
    if (collaboratorsAdded.length > 0) {
      socketHub.emit("conversation:assigned", {
        conversationId: params.conversationId,
        collaborators: updatedCollabs,
      });
    }
  }

  meta.mentions = mentions.map((m) => ({ id: m.id, name: m.name }));
  if (askAcrio) meta.askedAcrio = true;
  await conv.execute({
    sql: `UPDATE messages SET metadata_json = ? WHERE id = ?`,
    args: [JSON.stringify(meta), params.noteId],
  });

  for (const m of mentions) {
    if (m.id === params.author.id) continue;
    await createNotification({
      staffId: m.id,
      type: "MENTION",
      conversationId: params.conversationId,
      messageId: params.noteId,
      fromName: params.author.name,
      customerName,
      text: params.noteText,
    }).catch(() => {});
    // Also reach them outside the app (email, and WhatsApp when a template is configured).
    void alertStaffOutsideApp({
      staff: m,
      type: "STAFF_MENTION",
      subject: `${params.author.name} mentioned you in a chat with ${customerName}`,
      headline: `${params.author.name} mentioned you`,
      detail: `Chat with ${customerName}${customerPhone ? ` (${customerPhone})` : ""}:\n${params.noteText.slice(0, 500)}`,
      conversationId: params.conversationId,
    });
  }

  // Case B: A teammate/manager points out "@Lalitha Barma you have replied in note instead of message reply - please check"
  if (
    !askAcrio &&
    /\b(replied\s+in\s+(?:a\s+|internal\s+)?note|sent\s+in\s+(?:a\s+|internal\s+)?note|wrote\s+in\s+(?:a\s+|internal\s+)?note|note\s+instead\s+of\s+(?:message|chat|reply)|in\s+note\s+by\s+mistake)\b/i.test(
      params.noteText
    )
  ) {
    const targetCandidate = [...recentMessages]
      .reverse()
      .find(
        (m) =>
          m.messageType === "INTERNAL_NOTE" &&
          m.senderName !== "ACRIO" &&
          !m.body.includes("@")
      );
    if (targetCandidate) {
      let targetMeta: Record<string, unknown> = {};
      try {
        targetMeta = JSON.parse(targetCandidate.metadataJson || "{}");
      } catch {
        targetMeta = {};
      }
      const targetReplyTo =
        (targetMeta.replyTo as Record<string, unknown> | undefined) || null;
      const merged =
        targetReplyTo && typeof targetReplyTo.body === "string"
          ? buildSmartCorrectedReplyOption(targetCandidate.body, targetReplyTo.body)
          : null;
      const nowIso = new Date().toISOString();
      targetMeta.accidentalCustomerReply = {
        detected: true,
        status: "PENDING",
        reason: `Flagged by ${params.author.name} as an accidental internal-note reply`,
        exactMessageText: targetCandidate.body,
        mergedCorrectionText: merged,
        replyTo: targetReplyTo,
      };
      await conv.execute({
        sql: `UPDATE messages SET metadata_json = ? WHERE id = ?`,
        args: [JSON.stringify(targetMeta), targetCandidate.id],
      });

      const candidateOptions: PendingAcrioCandidateOption[] = merged
        ? [
            {
              id: "opt_merged_correction",
              title: "Send full corrected message in Chat (Recommended)",
              sourceLabel: "Merged with quoted message",
              mediaUrl: "",
              mediaType: "TEXT",
              fileName: "",
              mimeType: "text/plain",
              messageText: merged,
              replyTo: targetReplyTo,
            },
            {
              id: "opt_exact_note",
              title: "Send exact note text in Chat",
              sourceLabel: "As written in note",
              mediaUrl: "",
              mediaType: "TEXT",
              fileName: "",
              mimeType: "text/plain",
              messageText: targetCandidate.body,
              replyTo: targetReplyTo,
            },
          ]
        : [];

      const pendingAction: PendingAcrioNoteAction = {
        id: `pact_note_fix_${crypto.randomUUID().slice(0, 8)}`,
        status: "PENDING_CONFIRMATION",
        type: "send_customer_reply",
        title: `Send "${targetCandidate.body.slice(0, 60)}" to ${customerName} in Chat`,
        messageText: merged || targetCandidate.body,
        sourceNoteId: targetCandidate.id,
        replyTo: targetReplyTo,
        ...(candidateOptions.length > 0 ? { candidateOptions } : {}),
        requestedByStaffId: params.author.id,
        requestedByStaffName: params.author.name,
        createdAt: nowIso,
      };

      const mentionTags = [
        ...mentions.map((m) => `@${m.name}`),
        `@${params.author.name}`,
      ].join(" ");
      const acrioHelperId = `msg_note_acrio_${crypto.randomUUID().slice(0, 8)}`;
      const acrioHelperBody = `${mentionTags} I prepared ${targetCandidate.senderName}'s note (*"${targetCandidate.body}"*) so you can send it to *${customerName}* on WhatsApp in one click:`;

      await conv.execute({
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, metadata_json, delivery_status, created_at
        ) VALUES (?, ?, 'INTERNAL', 'ACRIO', 'ACRIO', 'INTERNAL_NOTE', 'INTERNAL', ?, ?, 'SAVED', ?)`,
        args: [
          acrioHelperId,
          params.conversationId,
          acrioHelperBody,
          JSON.stringify({
            acrioReply: true,
            inReplyToNoteId: params.noteId,
            forStaffId: mentions[0]?.id || params.author.id,
            forStaffName: mentions[0]?.name || params.author.name,
            pendingAction,
          }),
          nowIso,
        ],
      });
      socketHub.emit("note:new", {
        conversationId: params.conversationId,
        senderName: "ACRIO",
        noteText: acrioHelperBody,
      });
    }
  }

  if (askAcrio) {
    const question =
      params.noteText.replace(/(^|[\s(])@acrio\b[:,]?/gi, "$1").trim() || params.noteText;
    // Saved as a queue job first, so a server restart cannot lose the question.
    await enqueueJob(STAFF_NOTE_QUEUE, {
      conversationId: params.conversationId,
      noteId: params.noteId,
      question,
      author: params.author,
      customerName,
      customerPhone,
      noteAttachment: params.noteAttachment || null,
    });
    void claimAndRunStaffNoteJobs();
  }

  return {
    mentioned: mentions
      .filter((m) => m.id !== params.author.id)
      .map((m) => ({ id: m.id, name: m.name })),
    askedAcrio: askAcrio,
    collaboratorsAdded,
  };
}
