import crypto from "node:crypto";
import {
  addConversationCollaborators,
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  listActiveNonClientStaff,
  resolveStaffMemberByQuery,
  upsertSyncedContact,
  type CompanyDocumentRecord,
} from "@cc/database";
import {
  runAcrioStaffQuestion,
  sendCallbackRequestAlertTemplate,
  sendStaffAlertEmail,
  sendStaffAssignmentEmailNotification,
  sendStaffWhatsAppAlert,
  sendWhatsAppCloudMessage,
} from "@cc/connections";
import { claimPendingJobs, completeJob, enqueueJob, failJob } from "@cc/queue";
import { socketHub } from "@cc/sockets";

export interface MentionableStaff {
  id: string;
  name: string;
  email?: string;
  whatsappNumber?: string;
}

export interface StaffNotification {
  id: string;
  staffId: string;
  type: "MENTION" | "ACRIO_REPLY" | "CALLBACK";
  conversationId: string;
  messageId: string;
  fromName: string;
  customerName: string;
  text: string;
  isRead: boolean;
  createdAt: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let tableReady = false;
export async function ensureStaffNotificationsTable(): Promise<void> {
  if (tableReady) return;
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  await conv.execute(`CREATE TABLE IF NOT EXISTS staff_notifications (
    id TEXT PRIMARY KEY,
    staff_id TEXT NOT NULL,
    type TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);
  await conv.execute(
    `CREATE INDEX IF NOT EXISTS idx_staff_notif_staff ON staff_notifications (staff_id, is_read, created_at)`
  );
  tableReady = true;
}

/**
 * Finds "@Name" mentions of teammates and "@ACRIO" in a note.
 * Matches full names first, then a unique first name, then the email name before the @.
 */
export function parseNoteMentions(
  text: string,
  staff: MentionableStaff[]
): { mentions: MentionableStaff[]; askAcrio: boolean } {
  const lead = "(^|[\\s(,.;:!?])";
  const tail = "(?![A-Za-z0-9_])";
  const askAcrio = new RegExp(`${lead}@acrio${tail}`, "i").test(text);

  const firstNameCounts = new Map<string, number>();
  for (const s of staff) {
    const first = s.name.trim().split(/\s+/)[0]?.toLowerCase();
    if (first) firstNameCounts.set(first, (firstNameCounts.get(first) || 0) + 1);
  }

  const found = new Map<string, MentionableStaff>();
  const byLongestName = [...staff].sort((a, b) => b.name.length - a.name.length);
  let remaining = text;
  for (const s of byLongestName) {
    const candidates: string[] = [s.name.trim()];
    const first = s.name.trim().split(/\s+/)[0];
    if (first && (firstNameCounts.get(first.toLowerCase()) || 0) === 1) candidates.push(first);
    const emailName = (s.email || "").split("@")[0];
    if (emailName) candidates.push(emailName);
    for (const c of candidates) {
      const re = new RegExp(`${lead}@${escapeRe(c)}${tail}`, "i");
      if (re.test(remaining)) {
        found.set(s.id, s);
        // Remove it so a shorter name inside a longer one is not matched twice.
        remaining = remaining.replace(new RegExp(`@${escapeRe(c)}${tail}`, "ig"), " ");
        break;
      }
    }
  }
  return { mentions: Array.from(found.values()), askAcrio };
}

export async function createNotification(params: {
  staffId: string;
  type: StaffNotification["type"];
  conversationId: string;
  messageId: string;
  fromName: string;
  customerName: string;
  text: string;
}): Promise<void> {
  await ensureStaffNotificationsTable();
  const conv = getRawLibSqlClient("conversations");
  const createdAt = new Date().toISOString();
  await conv.execute({
    sql: `INSERT INTO staff_notifications (id, staff_id, type, conversation_id, message_id, from_name, customer_name, text, is_read, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    args: [
      `ntf_${crypto.randomUUID().slice(0, 10)}`,
      params.staffId,
      params.type,
      params.conversationId,
      params.messageId,
      params.fromName,
      params.customerName,
      params.text.slice(0, 400),
      createdAt,
    ],
  });
  socketHub.emit("staff:mention", {
    staffId: params.staffId,
    type: params.type,
    conversationId: params.conversationId,
    fromName: params.fromName,
    customerName: params.customerName,
    text: params.text.slice(0, 200),
  });
}

/** Emails (and optionally WhatsApps) a teammate. Never throws and never blocks the caller. */
async function alertStaffOutsideApp(params: {
  staff: MentionableStaff;
  type: "STAFF_MENTION" | "STAFF_CALLBACK";
  subject: string;
  headline: string;
  detail: string;
  conversationId: string;
}): Promise<void> {
  try {
    if (params.staff.email) {
      await sendStaffAlertEmail({
        staffId: params.staff.id,
        staffEmail: params.staff.email,
        staffName: params.staff.name,
        subject: params.subject,
        headline: params.headline,
        detail: params.detail,
        conversationId: params.conversationId,
        ctaLabel: params.type === "STAFF_CALLBACK" ? "Open the chat" : "Open chat",
        dispatchType: params.type,
      });
    }
    if (params.staff.whatsappNumber) {
      await sendStaffWhatsAppAlert({
        toPhone: params.staff.whatsappNumber,
        staffName: params.staff.name,
        headline: params.headline,
        detail: params.detail,
      });
    }
  } catch (err) {
    console.warn("[notify] staff alert failed:", (err as Error)?.message || err);
  }
}

const STAFF_NOTE_QUEUE = "acrio:staff_note_answer" as const;

export interface NoteAttachmentPayload {
  mediaId?: string;
  waMediaId?: string;
  mediaType: "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO";
  url: string;
  fileName?: string;
  mimeType?: string;
}

export interface PendingAcrioCandidateOption {
  id: string;
  title: string;
  sourceLabel: string;
  mediaUrl: string;
  mediaType: "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO" | "TEXT";
  mediaId?: string;
  waMediaId?: string;
  fileName: string;
  mimeType: string;
  docNumber?: string;
  messageText?: string;
  replyTo?: Record<string, unknown> | null;
}

export interface PendingAcrioNoteAction {
  id: string;
  status: "PENDING_CONFIRMATION" | "CONFIRMED" | "CANCELLED" | "FAILED";
  type: "send_customer_reply";
  title: string;
  messageText: string;
  sourceNoteId?: string;
  replyTo?: Record<string, unknown> | null;
  companyDocId?: string;
  companyDocTitle?: string;
  sourceLabel?: string;
  docNumber?: string;
  attachment?: NoteAttachmentPayload | null;
  candidateOptions?: PendingAcrioCandidateOption[];
  requestedByStaffId: string;
  requestedByStaffName: string;
  createdAt: string;
  decidedByStaffName?: string;
  decidedAt?: string;
  sentMessageId?: string;
  error?: string;
}

export interface AccidentalCustomerReplyMetadata {
  detected: boolean;
  status: "PENDING" | "SENT" | "DISMISSED";
  reason: string;
  exactMessageText: string;
  mergedCorrectionText?: string | null;
  replyTo?: Record<string, unknown> | null;
  sentMessageId?: string;
  sentByStaffName?: string;
  sentAt?: string;
}

export interface MissingCompanyDocPrompt {
  status: "NEEDS_UPLOAD" | "RESOLVED";
  slug: string;
  title: string;
  keywords: string;
  defaultMessageText: string;
  uploadedDocId?: string;
}

async function dispatchStaffCustomerReply(params: {
  conversationId: string;
  customerPhone: string;
  actorStaffId: string;
  actorStaffName: string;
  messageText: string;
  attachment?: NoteAttachmentPayload | null;
  replyTo?: Record<string, unknown> | null;
  actionTagId?: string;
  usePlainStaffSenderName?: boolean;
}): Promise<{ ok: boolean; messageId: string; error?: string }> {
  const conv = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();
  const cRes = await conv.execute({
    sql: `SELECT assigned_staff_id FROM conversations WHERE id = ? LIMIT 1`,
    args: [params.conversationId],
  });
  const cRow = cRes.rows[0] as Record<string, unknown> | undefined;
  const att = params.attachment || null;
  const text =
    String(params.messageText || "").trim() ||
    (att?.fileName ? `Please find attached *${att.fileName}* for your reference.` : "");
  const replyToWaMessageId =
    params.replyTo && typeof params.replyTo.waMessageId === "string" && params.replyTo.waMessageId.trim()
      ? params.replyTo.waMessageId.trim()
      : undefined;

  const sendRes = await sendWhatsAppCloudMessage({
    toPhone: params.customerPhone,
    bodyText: text,
    replyToWaMessageId,
    media: att
      ? {
          type: att.mediaType,
          url: att.url,
          waMediaId: att.waMediaId,
          caption: text,
          fileName: att.fileName,
          mimeType: att.mimeType,
        }
      : undefined,
    simulateAsyncDelivery: true,
  });

  const outMetaObj: Record<string, unknown> = {
    sentViaAcrioAction: params.actionTagId || "acrio_auto",
    confirmedBy: params.actorStaffName,
  };
  if (params.replyTo) {
    outMetaObj.replyTo = params.replyTo;
  }
  if (att) {
    outMetaObj.mediaType = att.mediaType;
    outMetaObj.mediaUrl = att.url;
    if (att.mediaType === "IMAGE") outMetaObj.imageUrl = att.url;
    if (att.mediaId) outMetaObj.mediaId = att.mediaId;
    if (att.waMediaId) outMetaObj.waMediaId = att.waMediaId;
    if (att.fileName) {
      outMetaObj.fileName = att.fileName;
      outMetaObj.filename = att.fileName;
    }
    if (att.mimeType) outMetaObj.mimeType = att.mimeType;
    outMetaObj.media = {
      mediaId: att.mediaId || att.waMediaId || null,
      mimeType: att.mimeType || null,
      filename: att.fileName || null,
      caption: text || null,
      downloadUrl: att.url,
    };
  }

  const outMsgId = `msg_acrio_act_${crypto.randomUUID().slice(0, 8)}`;
  const previewText = att?.fileName
    ? `[${att.mediaType}] ${att.fileName}${text ? `: ${text}` : ""}`.slice(0, 140)
    : text.slice(0, 140);

  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, direction, sender_type, sender_staff_id, sender_name,
      message_type, billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
    ) VALUES (?, ?, 'OUTBOUND', 'STAFF', ?, ?, ?, 'FREE_CHAT', ?, ?, ?, ?, ?)`,
    args: [
      outMsgId,
      params.conversationId,
      params.actorStaffId,
      params.usePlainStaffSenderName ? params.actorStaffName : `${params.actorStaffName} via ACRIO`,
      att ? att.mediaType : "TEXT",
      text,
      JSON.stringify(outMetaObj),
      sendRes.waMessageId,
      sendRes.deliveryStatus,
      nowIso,
    ],
  });

  const shouldAutoAssign =
    !cRow?.assigned_staff_id || String(cRow.assigned_staff_id) === "ACRIO";
  await conv.execute({
    sql: `UPDATE conversations
          SET status = CASE WHEN ? = 1 THEN 'ASSIGNED' ELSE status END,
              assigned_staff_id = CASE WHEN ? = 1 THEN ? ELSE assigned_staff_id END,
              assigned_staff_name = CASE WHEN ? = 1 THEN ? ELSE assigned_staff_name END,
              assigned_team_id = CASE WHEN ? = 1 THEN COALESCE(assigned_team_id, 'team_sales') ELSE assigned_team_id END,
              assigned_team_name = CASE
                WHEN ? = 1 AND (assigned_team_id IS NULL OR assigned_team_name = 'System (ACRIO)') THEN 'Sales Team'
                ELSE assigned_team_name
              END,
              waiting_since = NULL,
              last_message_preview = ?,
              last_message_at = ?,
              last_message_direction = 'OUTBOUND',
              last_message_status = ?
          WHERE id = ?`,
    args: [
      shouldAutoAssign ? 1 : 0,
      shouldAutoAssign ? 1 : 0,
      params.actorStaffId,
      shouldAutoAssign ? 1 : 0,
      params.actorStaffName,
      shouldAutoAssign ? 1 : 0,
      shouldAutoAssign ? 1 : 0,
      previewText,
      nowIso,
      sendRes.deliveryStatus,
      params.conversationId,
    ],
  });

  socketHub.emit("message:new", {
    conversationId: params.conversationId,
    senderName: `${params.actorStaffName} via ACRIO`,
    text,
  });

  return { ok: sendRes.ok, messageId: outMsgId, error: sendRes.error };
}

export async function executeAcrioPendingNoteAction(params: {
  conversationId: string;
  noteMessageId: string;
  actorStaffId: string;
  actorStaffName: string;
  decision: "CONFIRM" | "CANCEL";
  selectedOptionId?: string;
  inReplyToNoteId?: string;
}): Promise<{
  ok: boolean;
  actionStatus?: PendingAcrioNoteAction["status"];
  messageId?: string;
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
      sql: `SELECT customer_phone, customer_name
            FROM conversations WHERE id = ? LIMIT 1`,
      args: [params.conversationId],
    }),
  ]);

  const noteRow = noteRes.rows[0] as Record<string, unknown> | undefined;
  const cRow = convRes.rows[0] as Record<string, unknown> | undefined;
  if (!noteRow || !cRow) {
    return { ok: false, error: "Pending action note or conversation was not found." };
  }

  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(String(noteRow.metadata_json || "{}"));
  } catch {
    meta = {};
  }

  const pending = meta.pendingAction as PendingAcrioNoteAction | undefined;
  if (!pending || pending.status !== "PENDING_CONFIRMATION") {
    return {
      ok: false,
      error: "This ACRIO action has already been confirmed or cancelled.",
    };
  }

  const customerPhone = String(cRow.customer_phone || "");
  const customerName = String(cRow.customer_name || customerPhone || "Customer");

  if (params.decision === "CANCEL") {
    pending.status = "CANCELLED";
    pending.decidedByStaffName = params.actorStaffName;
    pending.decidedAt = nowIso;
    meta.pendingAction = pending;

    await conv.execute({
      sql: `UPDATE messages SET metadata_json = ? WHERE id = ?`,
      args: [JSON.stringify(meta), params.noteMessageId],
    });

    if (pending.sourceNoteId) {
      const origRes = await conv.execute({
        sql: `SELECT metadata_json FROM messages WHERE id = ? LIMIT 1`,
        args: [pending.sourceNoteId],
      });
      if (origRes.rows[0]) {
        try {
          const origMeta = JSON.parse(String(origRes.rows[0].metadata_json || "{}"));
          if (origMeta.accidentalCustomerReply) {
            origMeta.accidentalCustomerReply.status = "DISMISSED";
            await conv.execute({
              sql: `UPDATE messages SET metadata_json = ? WHERE id = ?`,
              args: [JSON.stringify(origMeta), pending.sourceNoteId],
            });
          }
        } catch {
          // ignore
        }
      }
    }

    const cancelNoteId = `msg_note_acrio_${crypto.randomUUID().slice(0, 8)}`;
    const cancelBody = `@${params.actorStaffName} Kept as an internal team note. Nothing was sent to *${customerName}*.`;
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, metadata_json, delivery_status, created_at
      ) VALUES (?, ?, 'INTERNAL', 'ACRIO', 'ACRIO', 'INTERNAL_NOTE', 'INTERNAL', ?, ?, 'SAVED', ?)`,
      args: [
        cancelNoteId,
        params.conversationId,
        cancelBody,
        JSON.stringify({
          acrioReply: true,
          inReplyToNoteId: params.inReplyToNoteId || params.noteMessageId,
          resolvedPendingActionId: pending.id,
        }),
        nowIso,
      ],
    });
    socketHub.emit("note:new", {
      conversationId: params.conversationId,
      senderName: "ACRIO",
      noteText: cancelBody,
    });
    socketHub.emit("conversation:updated", { conversationId: params.conversationId });
    return { ok: true, actionStatus: "CANCELLED" };
  }

  if (params.selectedOptionId && Array.isArray(pending.candidateOptions)) {
    const chosen = pending.candidateOptions.find(
      (opt) => opt.id === params.selectedOptionId
    );
    if (chosen) {
      if (chosen.messageText && !chosen.mediaUrl) {
        pending.title = chosen.title;
        pending.messageText = chosen.messageText;
        if (chosen.replyTo !== undefined) {
          pending.replyTo = chosen.replyTo;
        }
      } else {
        pending.companyDocId = chosen.id;
        pending.companyDocTitle = chosen.title;
        pending.sourceLabel = chosen.sourceLabel;
        pending.docNumber = chosen.docNumber;
        pending.title = `Share ${chosen.title} with ${customerName}`;
        pending.attachment = {
          mediaId: chosen.mediaId,
          waMediaId: chosen.waMediaId,
          mediaType: chosen.mediaType === "TEXT" ? "DOCUMENT" : chosen.mediaType,
          url: chosen.mediaUrl,
          fileName: chosen.fileName,
          mimeType: chosen.mimeType,
        };
        pending.messageText = `Please find attached our *${chosen.title}*${chosen.docNumber ? ` (${chosen.docNumber})` : ""} for your reference. Please let us know if you need anything else.`;
      }
    }
  }

  const att = pending.attachment || null;
  const text =
    String(pending.messageText || "").trim() ||
    (att?.fileName ? `Please find attached *${att.fileName}* for your reference.` : "");

  if (!text && !att) {
    return { ok: false, error: "Nothing to send in this pending action." };
  }

  const sendRes = await dispatchStaffCustomerReply({
    conversationId: params.conversationId,
    customerPhone,
    actorStaffId: params.actorStaffId,
    actorStaffName: params.actorStaffName,
    messageText: text,
    attachment: att,
    replyTo: pending.replyTo || null,
    actionTagId: pending.id,
    usePlainStaffSenderName: Boolean(pending.sourceNoteId),
  });

  if (sendRes.ok && pending.sourceNoteId) {
    const origRes = await conv.execute({
      sql: `SELECT metadata_json FROM messages WHERE id = ? LIMIT 1`,
      args: [pending.sourceNoteId],
    });
    if (origRes.rows[0]) {
      try {
        const origMeta = JSON.parse(String(origRes.rows[0].metadata_json || "{}"));
        origMeta.accidentalCustomerReply = {
          ...(origMeta.accidentalCustomerReply || { detected: true }),
          status: "SENT",
          sentMessageId: sendRes.messageId,
          sentByStaffName: params.actorStaffName,
          sentAt: nowIso,
        };
        await conv.execute({
          sql: `UPDATE messages SET metadata_json = ? WHERE id = ?`,
          args: [JSON.stringify(origMeta), pending.sourceNoteId],
        });
      } catch {
        // ignore
      }
    }
  }

  pending.status = sendRes.ok ? "CONFIRMED" : "FAILED";
  pending.decidedByStaffName = params.actorStaffName;
  pending.decidedAt = nowIso;
  pending.sentMessageId = sendRes.messageId;
  if (!sendRes.ok && sendRes.error) pending.error = sendRes.error;
  meta.pendingAction = pending;
  meta.actionsExecuted = [
    ...(Array.isArray(meta.actionsExecuted) ? meta.actionsExecuted : []),
    att?.fileName ? `Shared ${att.fileName} with customer` : "Sent reply to customer",
  ];
  await conv.execute({
    sql: `UPDATE messages SET metadata_json = ? WHERE id = ?`,
    args: [JSON.stringify(meta), params.noteMessageId],
  });

  const doneNoteId = `msg_note_acrio_${crypto.randomUUID().slice(0, 8)}`;
  const doneBody = sendRes.ok
    ? `@${params.actorStaffName} Confirmed and shared ${att?.fileName ? `*${att.fileName}*` : "the reply"} directly with *${customerName}* on WhatsApp.`
    : `@${params.actorStaffName} Tried to share ${att?.fileName ? `*${att.fileName}*` : "the reply"} with *${customerName}*, but WhatsApp delivery reported: ${sendRes.error || "failed"}.`;

  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, direction, sender_type, sender_name, message_type,
      billing_category, body, metadata_json, delivery_status, created_at
    ) VALUES (?, ?, 'INTERNAL', 'ACRIO', 'ACRIO', 'INTERNAL_NOTE', 'INTERNAL', ?, ?, 'SAVED', ?)`,
    args: [
      doneNoteId,
      params.conversationId,
      doneBody,
      JSON.stringify({
        acrioReply: true,
        inReplyToNoteId: params.inReplyToNoteId || params.noteMessageId,
        resolvedPendingActionId: pending.id,
        actionsExecuted: sendRes.ok
          ? [att?.fileName ? `Shared ${att.fileName} with client` : "Sent client reply"]
          : [],
      }),
      nowIso,
    ],
  });

  socketHub.emit("note:new", {
    conversationId: params.conversationId,
    senderName: "ACRIO",
    noteText: doneBody,
  });

  return {
    ok: sendRes.ok,
    actionStatus: pending.status,
    messageId: sendRes.messageId,
    error: sendRes.error,
  };
}

export async function promoteMissingDocNoteToPendingAction(params: {
  conversationId: string;
  noteMessageId: string;
  doc: CompanyDocumentRecord;
  actorStaffId: string;
  actorStaffName: string;
}): Promise<{ ok: boolean; pendingAction?: PendingAcrioNoteAction; error?: string }> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();

  const [noteRes, convRes] = await Promise.all([
    conv.execute({
      sql: `SELECT id, body, metadata_json FROM messages WHERE id = ? AND conversation_id = ? LIMIT 1`,
      args: [params.noteMessageId, params.conversationId],
    }),
    conv.execute({
      sql: `SELECT customer_name FROM conversations WHERE id = ? LIMIT 1`,
      args: [params.conversationId],
    }),
  ]);
  const noteRow = noteRes.rows[0] as Record<string, unknown> | undefined;
  if (!noteRow) return { ok: false, error: "Internal note not found." };
  const customerName = String(convRes.rows[0]?.customer_name || "the client");

  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(String(noteRow.metadata_json || "{}"));
  } catch {
    meta = {};
  }

  const missing = meta.missingCompanyDoc as MissingCompanyDocPrompt | undefined;
  const caption =
    (missing?.defaultMessageText && missing.defaultMessageText.trim()) ||
    `Please find attached our *${params.doc.title}*${params.doc.docNumber ? ` (${params.doc.docNumber})` : ""} for your reference. Let us know if you need anything else.`;

  const pendingAction: PendingAcrioNoteAction = {
    id: `pact_${crypto.randomUUID().slice(0, 8)}`,
    status: "PENDING_CONFIRMATION",
    type: "send_customer_reply",
    title: `Share ${params.doc.title} with ${customerName}`,
    messageText: caption,
    companyDocId: params.doc.id,
    companyDocTitle: params.doc.title,
    docNumber: params.doc.docNumber || undefined,
    attachment: {
      mediaId: params.doc.mediaId || undefined,
      waMediaId: params.doc.waMediaId || undefined,
      mediaType: params.doc.mediaType,
      url: params.doc.mediaUrl,
      fileName: params.doc.fileName,
      mimeType: params.doc.mimeType,
    },
    requestedByStaffId: params.actorStaffId,
    requestedByStaffName: params.actorStaffName,
    createdAt: nowIso,
  };

  if (missing) {
    meta.missingCompanyDoc = {
      ...missing,
      status: "RESOLVED",
      uploadedDocId: params.doc.id,
    };
  }
  meta.pendingAction = pendingAction;
  delete meta.suggestedReply;

  const updatedBody = `@${params.actorStaffName} Saved *${params.doc.title}* (\`${params.doc.fileName}\`) to Company Documents.\n\nReady to share it with *${customerName}* on WhatsApp. Click *Confirm & Share with Client* below (or reply *@ACRIO confirm*).`;

  await conv.execute({
    sql: `UPDATE messages SET body = ?, metadata_json = ? WHERE id = ?`,
    args: [updatedBody, JSON.stringify(meta), params.noteMessageId],
  });

  socketHub.emit("conversation:updated", { conversationId: params.conversationId });
  return { ok: true, pendingAction };
}

/** Runs one saved "@ACRIO" question job. Safe to run twice: the answer is only written once. */
export async function runStaffNoteAnswerJob(payload: Record<string, unknown>): Promise<void> {
  await answerAcrioNote({
    conversationId: String(payload.conversationId),
    noteId: String(payload.noteId),
    question: String(payload.question || ""),
    author: payload.author as { id: string; name: string },
    customerName: String(payload.customerName || "a customer"),
    customerPhone: String(payload.customerPhone || ""),
    noteAttachment: (payload.noteAttachment as NoteAttachmentPayload | null) || null,
  });
}

/** Jobs stuck in PROCESSING for 3+ minutes (server restarted mid-answer) are put back in line. */
export async function requeueStaleStaffNoteJobs(): Promise<void> {
  await ensureDatabasesBootstrapped();
  const db = getRawLibSqlClient("queue_jobs");
  const cutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  await db
    .execute({
      sql: `UPDATE jobs SET status = 'PENDING', run_after = ?
            WHERE queue_name = ? AND status = 'PROCESSING' AND attempts < max_attempts AND created_at < ?`,
      args: [new Date().toISOString(), STAFF_NOTE_QUEUE, cutoff],
    })
    .catch(() => {});
}

let staffNoteDrainRunning = false;
let staffNoteDrainPending = false;
/** Claims and answers waiting @ACRIO note jobs (also called by the background worker loop). */
export async function claimAndRunStaffNoteJobs(): Promise<number> {
  if (staffNoteDrainRunning) {
    staffNoteDrainPending = true;
    return 0;
  }
  staffNoteDrainRunning = true;
  let done = 0;
  try {
    do {
      staffNoteDrainPending = false;
      const jobs = await claimPendingJobs(STAFF_NOTE_QUEUE, 5);
      for (const job of jobs) {
        try {
          await runStaffNoteAnswerJob(job.payload);
          await completeJob(job.id);
          done++;
        } catch (err) {
          await failJob(job, (err as Error)?.message || "ACRIO note answer failed");
        }
      }
      if (jobs.length > 0) staffNoteDrainPending = true;
    } while (staffNoteDrainPending);
  } finally {
    staffNoteDrainRunning = false;
  }
  return done;
}

/** Tells the assigned sales handler (or single least-loaded sales member if unassigned) about a new callback request. */
export async function notifyCallbackRequest(params: {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  slot: string;
  topic: string;
  requestId: string;
}): Promise<void> {
  try {
    await ensureDatabasesBootstrapped();
    const conv = getRawLibSqlClient("conversations");
    const auth = getRawLibSqlClient("core_auth");

    // 1. If the chat is already assigned to a specific human teammate, notify ONLY them.
    const convRes = await conv
      .execute({
        sql: `SELECT assigned_staff_id, assigned_staff_name FROM conversations WHERE id = ? LIMIT 1`,
        args: [params.conversationId],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const currentAssignedId =
      convRes.rows[0]?.assigned_staff_id &&
      String(convRes.rows[0].assigned_staff_id) !== "ACRIO"
        ? String(convRes.rows[0].assigned_staff_id)
        : "";

    let targetStaff: {
      id: string;
      name: string;
      email: string;
      whatsappNumber: string;
    } | null = null;

    if (currentAssignedId) {
      const uRes = await auth
        .execute({
          sql: `SELECT id, name, email, whatsapp_number, status FROM users WHERE id = ? LIMIT 1`,
          args: [currentAssignedId],
        })
        .catch(() => ({ rows: [] as Record<string, unknown>[] }));
      const u = uRes.rows[0];
      if (u && String(u.status) === "ACTIVE") {
        targetStaff = {
          id: String(u.id),
          name: String(u.name || convRes.rows[0]?.assigned_staff_name || "Team Member"),
          email: String(u.email || ""),
          whatsappNumber: String(u.whatsapp_number || ""),
        };
      }
    }

    // 2. Otherwise pick ONLY ONE least-loaded available Sales Team responder (never blast the entire team).
    if (!targetStaff) {
      const [members, loadRes, devRes] = await Promise.all([
        conv.execute(
          `SELECT staff_id, staff_name, staff_email, tier
           FROM team_members
           WHERE team_id = 'team_sales' AND is_available = 1
           ORDER BY tier ASC, created_at ASC`
        ),
        conv.execute(
          `SELECT assigned_staff_id, COUNT(*) as open_cnt
           FROM conversations
           WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL AND assigned_staff_id != 'ACRIO'
           GROUP BY assigned_staff_id`
        ),
        auth.execute(`SELECT id FROM users WHERE role = 'DEV'`),
      ]);
      const devIds = new Set(devRes.rows.map((d) => String(d.id)));
      const loadMap = new Map<string, number>();
      for (const lr of loadRes.rows) {
        loadMap.set(String(lr.assigned_staff_id), Number(lr.open_cnt ?? 0));
      }
      const candidates = members.rows
        .filter((m) => !devIds.has(String(m.staff_id)))
        .sort((a, b) => {
          const tA = String(a.tier || "P0");
          const tB = String(b.tier || "P0");
          if (tA !== tB) return tA.localeCompare(tB);
          return (loadMap.get(String(a.staff_id)) ?? 0) - (loadMap.get(String(b.staff_id)) ?? 0);
        });
      const chosen = candidates[0] || members.rows[0];
      if (chosen) {
        const sid = String(chosen.staff_id);
        const uRes = await auth
          .execute({
            sql: `SELECT name, email, whatsapp_number, status FROM users WHERE id = ? LIMIT 1`,
            args: [sid],
          })
          .catch(() => ({ rows: [] as Record<string, unknown>[] }));
        const u = uRes.rows[0];
        if (!u || String(u.status) === "ACTIVE") {
          targetStaff = {
            id: sid,
            name: String(u?.name || chosen.staff_name || "Sales Team"),
            email: String(u?.email || chosen.staff_email || ""),
            whatsappNumber: String(u?.whatsapp_number || ""),
          };
        }
      }
    }

    if (!targetStaff) return;

    const detail = `${params.customerName} (${params.customerPhone}) wants a call in the ${params.slot}.\nInterested in: ${params.topic}.`;
    await createNotification({
      staffId: targetStaff.id,
      type: "CALLBACK",
      conversationId: params.conversationId,
      messageId: params.requestId,
      fromName: "ACRIO",
      customerName: params.customerName,
      text: detail,
    }).catch(() => {});

    if (targetStaff.email) {
      void sendStaffAlertEmail({
        staffId: targetStaff.id,
        staffEmail: targetStaff.email,
        staffName: targetStaff.name,
        subject: `Callback request: ${params.customerName} (${params.customerPhone})`,
        headline: "New callback request",
        detail,
        conversationId: params.conversationId,
        ctaLabel: "Open the chat",
        dispatchType: "STAFF_CALLBACK",
      }).catch(() => {});
    }

    if (targetStaff.whatsappNumber) {
      void sendCallbackRequestAlertTemplate({
        toPhone: targetStaff.whatsappNumber,
        staffId: targetStaff.id,
        staffName: targetStaff.name,
        customerName: params.customerName,
        customerPhone: params.customerPhone,
        preferredTime: params.slot || "As soon as possible",
      }).catch(() => {});
    }
  } catch (err) {
    console.warn("[notify] callback notification failed:", (err as Error)?.message || err);
  }
}

async function answerAcrioNote(params: {
  conversationId: string;
  noteId: string;
  question: string;
  author: { id: string; name: string };
  customerName: string;
  customerPhone: string;
  noteAttachment?: NoteAttachmentPayload | null;
}): Promise<void> {
  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");

  // Already answered (for example the job was retried after a restart)? Then do nothing.
  const already = await conv.execute({
    sql: `SELECT id FROM messages WHERE conversation_id = ? AND sender_name = 'ACRIO'
          AND message_type = 'INTERNAL_NOTE' AND metadata_json LIKE ? LIMIT 1`,
    args: [params.conversationId, `%"inReplyToNoteId":"${params.noteId}"%`],
  });
  if (already.rows[0]) return;

  // Check whether teammate is confirming, choosing option #N, or cancelling a pending ACRIO customer action via text reply
  const trimmedCmd = String(params.question || "").trim();
  const isTextConfirm =
    /^(yes|yep|yeah|confirm|confirmed|approve|approved|go ahead|ok|okay|proceed|send|send it|share|share it|do it)\b(?:\s*(?:#|option\s*)?(\d+))?[.!]?$/i.exec(
      trimmedCmd
    );
  const numberOnlyPick = /^(?:#|option\s*)?(\d+)$/i.exec(trimmedCmd);
  const isTextCancel =
    /^(cancel|no|nope|stop|dont send|don't send|abort)\b[.!]?$/i.test(
      trimmedCmd
    );
  if (isTextConfirm || numberOnlyPick || isTextCancel) {
    const pendingNotes = await conv.execute({
      sql: `SELECT id, metadata_json FROM messages
            WHERE conversation_id = ? AND sender_name = 'ACRIO' AND message_type = 'INTERNAL_NOTE'
            ORDER BY created_at DESC LIMIT 12`,
      args: [params.conversationId],
    });
    for (const r of pendingNotes.rows) {
      let parsedMeta: Record<string, unknown> = {};
      try {
        parsedMeta = JSON.parse(String(r.metadata_json || "{}"));
      } catch {
        parsedMeta = {};
      }
      const p = parsedMeta.pendingAction as PendingAcrioNoteAction | undefined;
      if (p && p.status === "PENDING_CONFIRMATION") {
        const idxRaw = isTextConfirm?.[2] || numberOnlyPick?.[1];
        const chosenIdx = idxRaw ? Number(idxRaw) - 1 : -1;
        const selectedOptionId =
          chosenIdx >= 0 && Array.isArray(p.candidateOptions) && p.candidateOptions[chosenIdx]
            ? p.candidateOptions[chosenIdx].id
            : undefined;
        await executeAcrioPendingNoteAction({
          conversationId: params.conversationId,
          noteMessageId: String(r.id),
          actorStaffId: params.author.id,
          actorStaffName: params.author.name,
          decision: isTextCancel ? "CANCEL" : "CONFIRM",
          selectedOptionId,
          inReplyToNoteId: params.noteId,
        });
        return;
      }
    }
  }

  const [msgRes, convRes, availableStaff] = await Promise.all([
    conv.execute({
      sql: `SELECT direction, sender_name, message_type, body FROM messages
            WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 30`,
      args: [params.conversationId],
    }),
    conv.execute({
      sql: `SELECT status, assigned_staff_id, assigned_staff_name, assigned_team_name, priority, smart_category, customer_id
            FROM conversations WHERE id = ? LIMIT 1`,
      args: [params.conversationId],
    }),
    listActiveNonClientStaff().catch(() => []),
  ]);

  const cRow = convRes.rows[0] as Record<string, unknown> | undefined;
  const chatMessages = [...msgRes.rows].reverse().map((m) => ({
    direction: String(m.direction),
    senderName: String(m.sender_name || ""),
    body: String(m.body || ""),
    isNote: String(m.message_type) === "INTERNAL_NOTE",
  }));

  const result = await runAcrioStaffQuestion({
    question: params.question,
    staffName: params.author.name,
    customerName: params.customerName,
    customerPhone: params.customerPhone,
    chatMessages,
    availableStaff: availableStaff.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      department: s.department,
    })),
    currentOwnerName: cRow?.assigned_staff_name ? String(cRow.assigned_staff_name) : null,
    conversationStatus: cRow?.status ? String(cRow.status) : "OPEN",
    noteAttachment: params.noteAttachment || null,
  });

  const executedSummaries: string[] = [];
  const nowActionIso = new Date().toISOString();
  let pendingAction: PendingAcrioNoteAction | null = null;
  let missingCompanyDoc: MissingCompanyDocPrompt | null = null;

  for (const act of result.actions || []) {
    try {
      if (act.type === "assign_staff" && act.staffQuery) {
        if (/^(acrio|system|ai)$/i.test(act.staffQuery.trim())) {
          await conv.execute({
            sql: `UPDATE conversations SET status = 'OPEN', assigned_staff_id = 'ACRIO', assigned_staff_name = 'ACRIO', assigned_team_id = NULL, assigned_team_name = 'System (ACRIO)', waiting_since = NULL WHERE id = ?`,
            args: [params.conversationId],
          });
          executedSummaries.push("Assigned chat back to System (ACRIO)");
          socketHub.emit("conversation:assigned", { conversationId: params.conversationId, staffName: "ACRIO" });
        } else {
          const target = resolveStaffMemberByQuery(act.staffQuery, availableStaff);
          if (target) {
            await conv.execute({
              sql: `UPDATE conversations SET status = 'ASSIGNED', assigned_staff_id = ?, assigned_staff_name = ?, assigned_team_id = COALESCE(assigned_team_id, 'team_sales'), assigned_team_name = COALESCE(NULLIF(assigned_team_name, 'System (ACRIO)'), 'Sales Team') WHERE id = ?`,
              args: [target.id, target.name, params.conversationId],
            });
            executedSummaries.push(`Assigned chat to ${target.name}`);
            socketHub.emit("conversation:assigned", { conversationId: params.conversationId, staffName: target.name });
            if (target.id !== params.author.id) {
              void sendStaffAssignmentEmailNotification({
                staffId: target.id,
                staffName: target.name,
                customerName: params.customerName,
                customerPhone: params.customerPhone,
                smartCategory: cRow?.smart_category ? String(cRow.smart_category) : "General Enquiry",
                priority: cRow?.priority ? String(cRow.priority) : "NORMAL",
                teamName: "Sales Team",
                reason: `Assigned by @ACRIO (requested by ${params.author.name})`,
                latestMessage: params.question,
                conversationId: params.conversationId,
              }).catch(() => {});
            }
          }
        }
      } else if (act.type === "add_collaborator" && act.staffQuery) {
        const target = resolveStaffMemberByQuery(act.staffQuery, availableStaff);
        if (target) {
          await addConversationCollaborators({
            conversationId: params.conversationId,
            members: [{ staffId: target.id, staffName: target.name }],
            addedBy: `ACRIO (requested by ${params.author.name})`,
          });
          executedSummaries.push(`Granted dual access to ${target.name}`);
          socketHub.emit("conversation:updated", { conversationId: params.conversationId });
          if (target.id !== params.author.id) {
            void sendStaffAssignmentEmailNotification({
              staffId: target.id,
              staffName: target.name,
              customerName: params.customerName,
              customerPhone: params.customerPhone,
              smartCategory: cRow?.smart_category ? String(cRow.smart_category) : "General Enquiry",
              priority: cRow?.priority ? String(cRow.priority) : "NORMAL",
              teamName: "Sales Team (Co-handler)",
              reason: `Added as co-handler by @ACRIO (${params.author.name})`,
              latestMessage: params.question,
              conversationId: params.conversationId,
            }).catch(() => {});
          }
        }
      } else if (act.type === "set_priority" && act.priority) {
        const pri = ["URGENT", "HIGH", "NORMAL"].includes(act.priority) ? act.priority : "NORMAL";
        await conv.execute({
          sql: `UPDATE conversations SET priority = ? WHERE id = ?`,
          args: [pri, params.conversationId],
        });
        executedSummaries.push(`Priority set to ${pri}`);
        socketHub.emit("conversation:updated", { conversationId: params.conversationId });
      } else if (act.type === "set_category" && act.category) {
        await conv.execute({
          sql: `UPDATE conversations SET smart_category = ? WHERE id = ?`,
          args: [act.category, params.conversationId],
        });
        executedSummaries.push(`Category set to ${act.category}`);
        socketHub.emit("conversation:updated", { conversationId: params.conversationId });
      } else if (act.type === "resolve_chat") {
        const summary = act.summary?.trim() || `Resolved via ACRIO by ${params.author.name}.`;
        await conv.execute({
          sql: `UPDATE conversations SET status = 'RESOLVED', waiting_since = NULL, resolution_summary = ?, resolved_by_id = ?, resolved_by_name = ?, resolved_at = ? WHERE id = ?`,
          args: [summary, params.author.id, params.author.name, nowActionIso, params.conversationId],
        });
        executedSummaries.push("Marked chat Resolved");
        socketHub.emit("conversation:resolved", { conversationId: params.conversationId, resolvedBy: params.author.name });
      } else if (act.type === "reopen_chat") {
        await conv.execute({
          sql: `UPDATE conversations SET status = 'ASSIGNED', resolved_at = NULL WHERE id = ?`,
          args: [params.conversationId],
        });
        executedSummaries.push("Reopened chat");
        socketHub.emit("conversation:updated", { conversationId: params.conversationId });
      } else if (act.type === "update_customer" && params.customerPhone) {
        const prefStaff = act.preferredStaffQuery
          ? resolveStaffMemberByQuery(act.preferredStaffQuery, availableStaff)
          : null;
        await upsertSyncedContact({
          phone: params.customerPhone,
          companyName: act.companyName || undefined,
          city: act.city || undefined,
          notes: act.notes || undefined,
          preferredStaffId: prefStaff ? prefStaff.id : undefined,
          preferredStaffName: prefStaff ? prefStaff.name : undefined,
        });
        executedSummaries.push("Updated customer CRM profile");
        socketHub.emit("conversation:updated", { conversationId: params.conversationId });
      } else if (act.type === "create_callback" && params.customerPhone) {
        await ensureCallbackRequestsTableInline();
        const cbId = `cb_${crypto.randomUUID().slice(0, 8)}`;
        await conv.execute({
          sql: `INSERT INTO callback_requests (id, conversation_id, customer_phone, customer_name, preferred_slot, topic, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
          args: [
            cbId,
            params.conversationId,
            params.customerPhone,
            params.customerName,
            act.callbackSlot || "Morning (10 AM to 1 PM)",
            act.callbackTopic || "Customer enquiry",
            nowActionIso,
            nowActionIso,
          ],
        });
        executedSummaries.push(`Created callback request (${act.callbackSlot || "Morning"})`);
        socketHub.emit("callback:new", { conversationId: params.conversationId });
      } else if (act.type === "send_customer_reply" && (act.messageText || act.mediaUrl) && params.customerPhone) {
        const attachmentPayload: NoteAttachmentPayload | null = act.mediaUrl
          ? {
              mediaId: act.mediaId || undefined,
              waMediaId: act.waMediaId || undefined,
              mediaType: (["DOCUMENT", "IMAGE", "VIDEO", "AUDIO"].includes(
                String(act.mediaType || "").toUpperCase()
              )
                ? String(act.mediaType).toUpperCase()
                : "DOCUMENT") as NoteAttachmentPayload["mediaType"],
              url: act.mediaUrl,
              fileName: act.fileName || act.companyDocTitle || "Document.pdf",
              mimeType: act.mimeType || "application/pdf",
            }
          : null;
        const msgText =
          String(act.messageText || "").trim() ||
          (attachmentPayload?.fileName
            ? `Please find attached *${attachmentPayload.fileName}* for your reference.`
            : "");
        if (act.autoExecute && act.shareKind === "PRODUCT_DATA") {
          const sentAuto = await dispatchStaffCustomerReply({
            conversationId: params.conversationId,
            customerPhone: params.customerPhone,
            actorStaffId: params.author.id,
            actorStaffName: params.author.name,
            messageText: msgText,
            attachment: attachmentPayload,
            actionTagId: "acrio_product_auto",
          });
          if (sentAuto.ok) {
            executedSummaries.push("Sent product details to customer on WhatsApp");
          } else {
            executedSummaries.push(`Attempted product share (${sentAuto.error || "failed"})`);
          }
        } else {
          pendingAction = {
            id: `pact_${crypto.randomUUID().slice(0, 8)}`,
            status: "PENDING_CONFIRMATION",
            type: "send_customer_reply",
            title: act.companyDocTitle
              ? `Share ${act.companyDocTitle} with ${params.customerName}`
              : attachmentPayload?.fileName
              ? `Share ${attachmentPayload.fileName} with ${params.customerName}`
              : `Send WhatsApp reply to ${params.customerName}`,
            messageText: msgText,
            companyDocId: act.companyDocId || undefined,
            companyDocTitle: act.companyDocTitle || undefined,
            sourceLabel: act.sourceLabel || undefined,
            docNumber: act.docNumber || undefined,
            attachment: attachmentPayload,
            ...(Array.isArray(act.candidateOptions) && act.candidateOptions.length > 0
              ? { candidateOptions: act.candidateOptions }
              : {}),
            requestedByStaffId: params.author.id,
            requestedByStaffName: params.author.name,
            createdAt: nowActionIso,
          };
        }
      } else if (act.type === "request_company_document_upload") {
        const docTitle = String(act.requestedDocTitle || "Company Document").trim();
        const docSlug = String(
          act.requestedDocSlug ||
            docTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
        ).trim();
        missingCompanyDoc = {
          status: "NEEDS_UPLOAD",
          slug: docSlug || "company-document",
          title: docTitle,
          keywords: `${docSlug.replace(/-/g, ", ")}, ${docTitle.toLowerCase()}`,
          defaultMessageText:
            String(act.messageText || "").trim() ||
            `Please find attached our *${docTitle}* for your reference. Let us know if you need anything else.`,
        };
      }
    } catch (err) {
      console.warn("[acrio-staff-action] failed:", act.type, (err as Error)?.message || err);
    }
  }

  const replyId = `msg_note_acrio_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  const actionFooter =
    executedSummaries.length > 0
      ? `\n\n*Actions done:* ${executedSummaries.join(" | ")}`
      : "";
  const effectiveSuggestedReply =
    !pendingAction &&
    !missingCompanyDoc &&
    result.suggestedReply &&
    !executedSummaries.some((s) => s.includes("Sent WhatsApp"))
      ? result.suggestedReply
      : null;
  const suggestedFooter = effectiveSuggestedReply
    ? `\n\n*Suggested reply:*\n${effectiveSuggestedReply}`
    : "";
  const body = `@${params.author.name} ${result.answer}${actionFooter}${suggestedFooter}`;
  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, direction, sender_type, sender_name, message_type,
      billing_category, body, metadata_json, delivery_status, created_at
    ) VALUES (?, ?, 'INTERNAL', 'ACRIO', 'ACRIO', 'INTERNAL_NOTE', 'INTERNAL', ?, ?, 'SAVED', ?)`,
    args: [
      replyId,
      params.conversationId,
      body,
      JSON.stringify({
        acrioReply: true,
        inReplyToNoteId: params.noteId,
        forStaffId: params.author.id,
        forStaffName: params.author.name,
        actionsExecuted: executedSummaries,
        suggestedReply: effectiveSuggestedReply,
        ...(pendingAction ? { pendingAction } : {}),
        ...(missingCompanyDoc ? { missingCompanyDoc } : {}),
      }),
      nowIso,
    ],
  });
  socketHub.emit("note:new", {
    conversationId: params.conversationId,
    senderName: "ACRIO",
    noteText: body,
  });
  await createNotification({
    staffId: params.author.id,
    type: "ACRIO_REPLY",
    conversationId: params.conversationId,
    messageId: replyId,
    fromName: "ACRIO",
    customerName: params.customerName,
    text: `${result.answer}${actionFooter}`.replace(/\s+/g, " "),
  });
}

async function ensureCallbackRequestsTableInline(): Promise<void> {
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
  if (noteDimMatch && refDimMatch && noteDimMatch[1].replace(/\s+/g, "").toLowerCase() !== refDimMatch[1].replace(/\s+/g, "").toLowerCase()) {
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
    const newPrice = /\/-/.test(refPriceMatch[1]) && !/\/-/.test(notePriceMatch[1])
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
  if (replyTo && (replyDirection === "OUTBOUND" || replyDirection === "INBOUND" || replyBody.length > 0)) {
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
    const inferredReplyTo =
      refOutbound
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
  if (CUSTOMER_FACING_NOTE_SIGNAL_RE.test(trimmed) || /\b(?:sir|madam|ma'?am)\s*[,!.]*$/i.test(trimmed)) {
    return {
      isAccidentalCustomerReply: true,
      reason: "Note directly addresses the customer or quotes pricing/GST/transport without @mentioning any teammate",
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
    const question = params.noteText.replace(/(^|[\s(])@acrio\b[:,]?/gi, "$1").trim() || params.noteText;
    // Saved as a queue job first, so a server restart cannot lose the question.
    await enqueueJob("acrio:staff_note_answer", {
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
    mentioned: mentions.filter((m) => m.id !== params.author.id).map((m) => ({ id: m.id, name: m.name })),
    askedAcrio: askAcrio,
    collaboratorsAdded,
  };
}

function rowToNotification(r: Record<string, unknown>): StaffNotification {
  return {
    id: String(r.id),
    staffId: String(r.staff_id),
    type: String(r.type) as StaffNotification["type"],
    conversationId: String(r.conversation_id),
    messageId: String(r.message_id || ""),
    fromName: String(r.from_name || ""),
    customerName: String(r.customer_name || ""),
    text: String(r.text || ""),
    isRead: Number(r.is_read) === 1,
    createdAt: String(r.created_at),
  };
}

export async function listStaffNotifications(
  staffId: string,
  limit = 30
): Promise<{ notifications: StaffNotification[]; unreadCount: number }> {
  await ensureStaffNotificationsTable();
  const conv = getRawLibSqlClient("conversations");
  const [list, unread] = await Promise.all([
    conv.execute({
      sql: `SELECT * FROM staff_notifications WHERE staff_id = ? ORDER BY created_at DESC LIMIT ?`,
      args: [staffId, limit],
    }),
    conv.execute({
      sql: `SELECT COUNT(*) AS c FROM staff_notifications WHERE staff_id = ? AND is_read = 0`,
      args: [staffId],
    }),
  ]);
  return {
    notifications: list.rows.map((r) => rowToNotification(r as Record<string, unknown>)),
    unreadCount: Number(unread.rows[0]?.c || 0),
  };
}

export async function markStaffNotificationsRead(staffId: string, ids?: string[]): Promise<void> {
  await ensureStaffNotificationsTable();
  const conv = getRawLibSqlClient("conversations");
  if (ids && ids.length > 0) {
    const marks = ids.map(() => "?").join(",");
    await conv.execute({
      sql: `UPDATE staff_notifications SET is_read = 1 WHERE staff_id = ? AND id IN (${marks})`,
      args: [staffId, ...ids],
    });
  } else {
    await conv.execute({
      sql: `UPDATE staff_notifications SET is_read = 1 WHERE staff_id = ?`,
      args: [staffId],
    });
  }
}
