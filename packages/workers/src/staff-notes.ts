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

export interface PendingAcrioNoteAction {
  id: string;
  status: "PENDING_CONFIRMATION" | "CONFIRMED" | "CANCELLED" | "FAILED";
  type: "send_customer_reply";
  title: string;
  messageText: string;
  companyDocId?: string;
  companyDocTitle?: string;
  docNumber?: string;
  attachment?: NoteAttachmentPayload | null;
  requestedByStaffId: string;
  requestedByStaffName: string;
  createdAt: string;
  decidedByStaffName?: string;
  decidedAt?: string;
  sentMessageId?: string;
  error?: string;
}

export interface MissingCompanyDocPrompt {
  status: "NEEDS_UPLOAD" | "RESOLVED";
  slug: string;
  title: string;
  keywords: string;
  defaultMessageText: string;
  uploadedDocId?: string;
}

export async function executeAcrioPendingNoteAction(params: {
  conversationId: string;
  noteMessageId: string;
  actorStaffId: string;
  actorStaffName: string;
  decision: "CONFIRM" | "CANCEL";
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
      sql: `SELECT customer_phone, customer_name, assigned_staff_id, assigned_staff_name, assigned_team_id, assigned_team_name
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

    const cancelNoteId = `msg_note_acrio_${crypto.randomUUID().slice(0, 8)}`;
    const cancelBody = `@${params.actorStaffName} Cancelled *${pending.title}*. Nothing was sent to *${customerName}*.`;
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

  const att = pending.attachment || null;
  const text =
    String(pending.messageText || "").trim() ||
    (att?.fileName ? `Please find attached *${att.fileName}* for your reference.` : "");

  if (!text && !att) {
    return { ok: false, error: "Nothing to send in this pending action." };
  }

  const sendRes = await sendWhatsAppCloudMessage({
    toPhone: customerPhone,
    bodyText: text,
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
    sentViaAcrioAction: pending.id,
    confirmedBy: params.actorStaffName,
  };
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
      `${params.actorStaffName} via ACRIO`,
      att ? att.mediaType : "TEXT",
      text,
      JSON.stringify(outMetaObj),
      sendRes.waMessageId,
      sendRes.deliveryStatus,
      nowIso,
    ],
  });

  const shouldAutoAssign =
    !cRow.assigned_staff_id || String(cRow.assigned_staff_id) === "ACRIO";
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
              last_message_at = ?
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
      params.conversationId,
    ],
  });

  pending.status = sendRes.ok ? "CONFIRMED" : "FAILED";
  pending.decidedByStaffName = params.actorStaffName;
  pending.decidedAt = nowIso;
  pending.sentMessageId = outMsgId;
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

  socketHub.emit("message:new", {
    conversationId: params.conversationId,
    senderName: `${params.actorStaffName} via ACRIO`,
    text,
  });
  socketHub.emit("note:new", {
    conversationId: params.conversationId,
    senderName: "ACRIO",
    noteText: doneBody,
  });

  return {
    ok: sendRes.ok,
    actionStatus: pending.status,
    messageId: outMsgId,
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
/** Claims and answers waiting @ACRIO note jobs (also called by the background worker loop). */
export async function claimAndRunStaffNoteJobs(): Promise<number> {
  if (staffNoteDrainRunning) return 0;
  staffNoteDrainRunning = true;
  let done = 0;
  try {
    const jobs = await claimPendingJobs(STAFF_NOTE_QUEUE, 3);
    for (const job of jobs) {
      try {
        await runStaffNoteAnswerJob(job.payload);
        await completeJob(job.id);
        done++;
      } catch (err) {
        await failJob(job, (err as Error)?.message || "ACRIO note answer failed");
      }
    }
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

  // Check whether teammate is confirming or cancelling a pending ACRIO customer action via text reply
  const trimmedCmd = String(params.question || "").trim();
  const isTextConfirm =
    /^(yes|yep|yeah|confirm|confirmed|approve|approved|go ahead|ok|okay|proceed|send|send it|share|share it|do it)\b[.!]?$/i.test(
      trimmedCmd
    );
  const isTextCancel =
    /^(cancel|no|nope|stop|dont send|don't send|abort)\b[.!]?$/i.test(
      trimmedCmd
    );
  if (isTextConfirm || isTextCancel) {
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
        await executeAcrioPendingNoteAction({
          conversationId: params.conversationId,
          noteMessageId: String(r.id),
          actorStaffId: params.author.id,
          actorStaffName: params.author.name,
          decision: isTextCancel ? "CANCEL" : "CONFIRM",
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
          docNumber: act.docNumber || undefined,
          attachment: attachmentPayload,
          requestedByStaffId: params.author.id,
          requestedByStaffName: params.author.name,
          createdAt: nowActionIso,
        };
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

/**
 * Called after a private note is saved. Pings mentioned teammates and, when the note
 * contains "@ACRIO", has ACRIO answer in a new private note for the author.
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
}> {
  await ensureStaffNotificationsTable();
  const conv = getRawLibSqlClient("conversations");
  const { mentions, askAcrio } = parseNoteMentions(params.noteText, params.staff);
  if (mentions.length === 0 && !askAcrio) {
    return { mentioned: [], askedAcrio: false, collaboratorsAdded: [] };
  }

  const convRes = await conv.execute({
    sql: `SELECT customer_name, customer_phone FROM conversations WHERE id = ? LIMIT 1`,
    args: [params.conversationId],
  });
  const customerName = String(convRes.rows[0]?.customer_name || "a customer");
  const customerPhone = String(convRes.rows[0]?.customer_phone || "");

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

  // Save who was mentioned on the note itself (so the chat can highlight them).
  const noteRes = await conv.execute({
    sql: `SELECT metadata_json FROM messages WHERE id = ? LIMIT 1`,
    args: [params.noteId],
  });
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(String(noteRes.rows[0]?.metadata_json || "{}"));
  } catch {
    meta = {};
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
