import crypto from "node:crypto";
import {
  addConversationCollaborators,
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  listActiveNonClientStaff,
  resolveStaffMemberByQuery,
  upsertSyncedContact,
} from "@cc/database";
import {
  runAcrioStaffQuestion,
  sendStaffAssignmentEmailNotification,
} from "@cc/connections";
import { claimPendingJobs, completeJob, failJob } from "@cc/queue";
import { socketHub } from "@cc/sockets";
import { logConversationAssignment } from "../core/assignment-tracking";
import { assignLeadFromOwner } from "../owner-desk/lead-assign";
import { createNotification } from "./notifications";
import {
  dispatchStaffCustomerReply,
  executeAcrioPendingNoteAction,
} from "./pending-actions";
import {
  STAFF_NOTE_QUEUE,
  type MissingCompanyDocPrompt,
  type NoteAttachmentPayload,
  type PendingAcrioNoteAction,
} from "./types";

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
    /^(cancel|no|nope|stop|dont send|don't send|abort)\b[.!]?$/i.test(trimmedCmd);
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
        const isInternalDeskThread =
          String(cRow?.smart_category || "") === "Internal Team" ||
          String(cRow?.assigned_team_name || "") === "Internal Team Desk";
        if (/^(acrio|system|ai)$/i.test(act.staffQuery.trim())) {
          await conv.execute({
            sql: `UPDATE conversations SET status = 'OPEN', assigned_staff_id = 'ACRIO', assigned_staff_name = 'ACRIO', assigned_team_id = NULL, assigned_team_name = 'System (ACRIO)', waiting_since = NULL WHERE id = ?`,
            args: [params.conversationId],
          });
          executedSummaries.push("Assigned chat back to System (ACRIO)");
          socketHub.emit("conversation:assigned", { conversationId: params.conversationId, staffName: "ACRIO" });
        } else {
          const target = resolveStaffMemberByQuery(act.staffQuery, availableStaff);
          if (target && isInternalDeskThread) {
            const hubBase =
              process.env.NEXT_PUBLIC_APP_URL || "https://chat.ccapl.cc";
            const fwd = await assignLeadFromOwner(
              {
                found: true,
                targetQuery: target.name,
                generic: false,
                verb: "assign",
                leadText: "",
              },
              {
                conversationId: params.conversationId,
                ownerPhone: params.customerPhone,
                ownerName: params.author.name,
                text: params.question,
                hubBase,
                logAssignment: logConversationAssignment,
                targetStaffIdOverride: target.id,
                isStaffForwarder: true,
              }
            );
            executedSummaries.push(
              fwd.assignedStaffName
                ? `Forwarded lead from ${params.author.name} to ${fwd.assignedStaffName}`
                : fwd.reply
            );
          } else if (target) {
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
