import crypto from "node:crypto";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  type CompanyDocumentRecord,
} from "@cc/database";
import { sendWhatsAppCloudMessage } from "@cc/connections";
import { socketHub } from "@cc/sockets";
import type {
  MissingCompanyDocPrompt,
  NoteAttachmentPayload,
  PendingAcrioNoteAction,
} from "./types";

export async function dispatchStaffCustomerReply(params: {
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
