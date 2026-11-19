import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { listAllStaffAccounts } from "@cc/auth";
import { runAcrioConversationSummary } from "@cc/connections";
import { listCompanyDocuments, upsertCompanyDocument } from "@cc/database";
import { socketHub } from "@cc/sockets";
import {
  convertInternalNoteToCustomerMessage,
  executeAcrioPendingNoteAction,
  markPriorOutboundMessagesRead,
  processStaffNote,
  promoteMissingDocNoteToPendingAction,
  type NoteAttachmentPayload,
} from "@cc/workers";
import { resolveQuotedReply, type ConversationActionContext } from "./shared";

export async function handleSimulateCustomerRead(id: string) {
  const updatedCount = await markPriorOutboundMessagesRead(id);
  return NextResponse.json({ ok: true, updatedCount });
}

export async function handleAddInternalNote(ctx: ConversationActionContext) {
  const { id, user, body, conv, nowIso } = ctx;
  const rawNoteAtt =
    body.attachment && typeof body.attachment === "object"
      ? (body.attachment as Record<string, unknown>)
      : null;
  const noteAttachment: NoteAttachmentPayload | null =
    rawNoteAtt && String(rawNoteAtt.url || "").trim()
      ? {
          mediaId: rawNoteAtt.mediaId ? String(rawNoteAtt.mediaId).trim() : undefined,
          waMediaId: rawNoteAtt.waMediaId
            ? String(rawNoteAtt.waMediaId).trim()
            : undefined,
          mediaType: (["IMAGE", "VIDEO", "DOCUMENT", "AUDIO"].includes(
            String(rawNoteAtt.mediaType || "").toUpperCase()
          )
            ? String(rawNoteAtt.mediaType).toUpperCase()
            : "DOCUMENT") as NoteAttachmentPayload["mediaType"],
          url: String(rawNoteAtt.url).trim(),
          fileName: rawNoteAtt.fileName ? String(rawNoteAtt.fileName).trim() : undefined,
          mimeType: rawNoteAtt.mimeType ? String(rawNoteAtt.mimeType).trim() : undefined,
        }
      : null;

  const noteText =
    String(body.noteText || body.text || "").trim() ||
    (noteAttachment?.fileName ? `Attached ${noteAttachment.fileName}` : "");
  if (!noteText) {
    return NextResponse.json(
      { ok: false, error: "Internal note cannot be empty." },
      { status: 400 }
    );
  }

  const replyMeta = await resolveQuotedReply(conv, id, body);
  const noteMetaObj: Record<string, unknown> = {};
  if (replyMeta) noteMetaObj.replyTo = replyMeta;
  if (noteAttachment) {
    noteMetaObj.mediaType = noteAttachment.mediaType;
    noteMetaObj.mediaUrl = noteAttachment.url;
    if (noteAttachment.mediaType === "IMAGE") noteMetaObj.imageUrl = noteAttachment.url;
    if (noteAttachment.mediaId) noteMetaObj.mediaId = noteAttachment.mediaId;
    if (noteAttachment.waMediaId) noteMetaObj.waMediaId = noteAttachment.waMediaId;
    if (noteAttachment.fileName) {
      noteMetaObj.fileName = noteAttachment.fileName;
      noteMetaObj.filename = noteAttachment.fileName;
    }
    if (noteAttachment.mimeType) noteMetaObj.mimeType = noteAttachment.mimeType;
    noteMetaObj.media = {
      mediaId: noteAttachment.mediaId || noteAttachment.waMediaId || null,
      mimeType: noteAttachment.mimeType || null,
      filename: noteAttachment.fileName || null,
      downloadUrl: noteAttachment.url,
    };
  }

  const noteId = `msg_note_${crypto.randomUUID().slice(0, 8)}`;
  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, direction, sender_type, sender_name, message_type,
      billing_category, body, metadata_json, delivery_status, created_at
    ) VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', ?, 'INTERNAL_NOTE', 'INTERNAL', ?, ?, 'SAVED', ?)`,
    args: [noteId, id, user.name, noteText, JSON.stringify(noteMetaObj), nowIso],
  });

  socketHub.emit("note:new", { conversationId: id, senderName: user.name, noteText });

  let mentioned: { id: string; name: string }[] = [];
  let askedAcrio = false;
  let accidentalReplyDetected = false;
  try {
    const accounts = noteText.includes("@") ? await listAllStaffAccounts() : [];
    const staff = accounts
      .filter((a) => a.status === "ACTIVE" && a.role !== "CLIENT")
      .map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        whatsappNumber: a.whatsappNumber,
      }));
    const processed = await processStaffNote({
      conversationId: id,
      noteId,
      noteText,
      author: { id: user.id, name: user.name },
      staff,
      noteAttachment,
    });
    mentioned = processed.mentioned;
    askedAcrio = processed.askedAcrio;
    accidentalReplyDetected = Boolean(processed.accidentalReplyDetected);
  } catch (err) {
    console.warn("[notes] note processing failed:", (err as Error)?.message || err);
  }

  return NextResponse.json({
    ok: true,
    noteId,
    replyTo: replyMeta,
    mentioned,
    askedAcrio,
    accidentalReplyDetected,
  });
}

export async function handleSendNoteInChat(ctx: ConversationActionContext) {
  const { id, user, body } = ctx;
  const noteMessageId = String(body.noteMessageId || "").trim();
  const customText = body.customText ? String(body.customText).trim() : undefined;
  const dismissOnly = Boolean(body.dismissOnly);
  if (!noteMessageId) {
    return NextResponse.json(
      { ok: false, error: "noteMessageId is required." },
      { status: 400 }
    );
  }
  const res = await convertInternalNoteToCustomerMessage({
    conversationId: id,
    noteMessageId,
    actorStaffId: user.id,
    actorStaffName: user.name,
    customText,
    dismissOnly,
  });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error || "Could not send note in chat." },
      { status: 400 }
    );
  }
  const { ok: _ignoredOk, ...rest } = res;
  return NextResponse.json({ ok: true, ...rest });
}

export async function handleConfirmAcrioNoteAction(ctx: ConversationActionContext) {
  const { id, user, body } = ctx;
  const noteMessageId = String(body.noteMessageId || "").trim();
  const decision = body.decision === "CANCEL" ? "CANCEL" : "CONFIRM";
  const selectedOptionId = body.selectedOptionId
    ? String(body.selectedOptionId).trim()
    : undefined;
  if (!noteMessageId) {
    return NextResponse.json(
      { ok: false, error: "noteMessageId is required." },
      { status: 400 }
    );
  }
  const res = await executeAcrioPendingNoteAction({
    conversationId: id,
    noteMessageId,
    actorStaffId: user.id,
    actorStaffName: user.name,
    decision,
    selectedOptionId,
  });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error || "Action failed." },
      { status: 400 }
    );
  }
  const { ok: _ignoredOk, ...rest } = res;
  return NextResponse.json({ ok: true, ...rest });
}

export async function handleAttachCompanyDocToAcrioNote(ctx: ConversationActionContext) {
  const { id, user, body } = ctx;
  const noteMessageId = String(body.noteMessageId || "").trim();
  if (!noteMessageId) {
    return NextResponse.json(
      { ok: false, error: "noteMessageId is required." },
      { status: 400 }
    );
  }
  let doc = null;
  if (body.companyDocId) {
    const docs = await listCompanyDocuments();
    doc = docs.find((d) => d.id === String(body.companyDocId)) || null;
  } else if (body.mediaUrl && body.title) {
    doc = await upsertCompanyDocument({
      slug: body.slug ? String(body.slug) : undefined,
      title: String(body.title),
      category: "COMPLIANCE",
      docNumber: body.docNumber ? String(body.docNumber) : undefined,
      mediaId: body.mediaId ? String(body.mediaId) : undefined,
      waMediaId: body.waMediaId ? String(body.waMediaId) : undefined,
      mediaUrl: String(body.mediaUrl),
      mediaType: body.mediaType ? (String(body.mediaType).toUpperCase() as any) : "DOCUMENT",
      fileName: body.fileName ? String(body.fileName) : undefined,
      mimeType: body.mimeType ? String(body.mimeType) : undefined,
      keywords: body.keywords ? String(body.keywords) : undefined,
      uploadedBy: user.name,
    });
  }
  if (!doc) {
    return NextResponse.json(
      { ok: false, error: "Company document file and title are required." },
      { status: 400 }
    );
  }
  const promo = await promoteMissingDocNoteToPendingAction({
    conversationId: id,
    noteMessageId,
    doc,
    actorStaffId: user.id,
    actorStaffName: user.name,
  });
  if (!promo.ok) {
    return NextResponse.json(
      { ok: false, error: promo.error || "Could not prepare share." },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, document: doc, pendingAction: promo.pendingAction });
}

export async function handleGenerateSummary(ctx: ConversationActionContext) {
  const { id, user, conv, cRow, customerPhone, nowIso } = ctx;
  const msgRes = await conv.execute({
    sql: `SELECT direction, sender_name, message_type, body, created_at
          FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 60`,
    args: [id],
  });
  const chatMessages = msgRes.rows.map((m) => ({
    direction: String(m.direction),
    senderName: String(m.sender_name || ""),
    body: String(m.body || ""),
    isNote: String(m.message_type) === "INTERNAL_NOTE",
    createdAt: String(m.created_at || ""),
  }));

  const sumRes = await runAcrioConversationSummary({
    customerName: String(cRow.customer_name || customerPhone),
    customerPhone,
    requestedByName: user.name,
    chatMessages,
  });

  const summaryNoteId = `msg_note_sum_${crypto.randomUUID().slice(0, 8)}`;
  const noteBody = `*Quick Chat Summary* (requested by @${user.name})\n\n${sumRes.summaryText}`;
  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, direction, sender_type, sender_name, message_type,
      billing_category, body, metadata_json, delivery_status, created_at
    ) VALUES (?, ?, 'INTERNAL', 'ACRIO', 'ACRIO', 'INTERNAL_NOTE', 'INTERNAL', ?, ?, 'SAVED', ?)`,
    args: [
      summaryNoteId,
      id,
      noteBody,
      JSON.stringify({
        acrioReply: true,
        acrioSummary: true,
        requestedByStaffId: user.id,
        requestedByStaffName: user.name,
        model: sumRes.model,
      }),
      nowIso,
    ],
  });
  socketHub.emit("note:new", {
    conversationId: id,
    senderName: "ACRIO",
    noteText: noteBody,
  });
  return NextResponse.json({ ok: true, noteId: summaryNoteId, summaryText: noteBody });
}
