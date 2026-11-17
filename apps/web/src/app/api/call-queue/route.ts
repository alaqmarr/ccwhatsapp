import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { sendStaffAssignmentEmailNotification } from "@cc/connections";
import {
  claimCallDispatchItem,
  createCallDispatchItem,
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  listActiveNonClientStaff,
  listCallDispatchQueue,
  normalizeWhatsAppPhone,
  updateCallDispatchItem,
  upsertSyncedContact,
  type CallQueueAssignmentMode,
} from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import { createNotification, logConversationAssignment } from "@cc/workers";
import { loadCallQueuePayload } from "@/lib/loaders/operations";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "call_queue:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const payload = await loadCallQueuePayload(user);
  return NextResponse.json(payload);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "call_queue:manage", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "create");
  const nowIso = new Date().toISOString();

  if (action === "create") {
    const rawPhone = String(body.customerPhone || "").trim();
    const notes = String(body.notes || "").trim();
    const productTopic = String(body.productTopic || "").trim();
    const recordingUrl = String(body.recordingUrl || "").trim();

    if (!rawPhone && !notes && !recordingUrl) {
      return NextResponse.json(
        { ok: false, error: "Enter customer phone, notes, or attach a call recording." },
        { status: 400 }
      );
    }

    const modeRaw = String(body.assignmentMode || "AUTO_PERFORMANCE");
    const assignmentMode: CallQueueAssignmentMode = (
      ["AUTO_PERFORMANCE", "AUTO_RANDOM", "PREFERRED_OR_PAST", "OPEN_POOL", "MANUAL"].includes(
        modeRaw
      )
        ? modeRaw
        : "AUTO_PERFORMANCE"
    ) as CallQueueAssignmentMode;

    const created = await createCallDispatchItem({
      customerPhone: rawPhone,
      customerName: String(body.customerName || "").trim(),
      source: String(body.source || "Direct Call").trim(),
      productTopic,
      notes,
      recordingUrl,
      recordingFileName: String(body.recordingFileName || "").trim(),
      recordingMimeType: String(body.recordingMimeType || "").trim(),
      attachmentUrl: String(body.attachmentUrl || "").trim(),
      attachmentName: String(body.attachmentName || "").trim(),
      assignmentMode,
      manualStaffId: body.manualStaffId ? String(body.manualStaffId) : undefined,
      priority:
        body.priority === "URGENT" || body.priority === "HIGH" ? body.priority : "NORMAL",
      submittedById: user.id,
      submittedByName: user.name,
    });

    if (created.customerPhone && normalizeWhatsAppPhone(created.customerPhone)) {
      await upsertSyncedContact({
        phone: created.customerPhone,
        name: created.customerName || undefined,
        source: "MANUAL",
        notes: created.notes ? `Call Queue (${created.source}): ${created.notes}` : undefined,
        lastContactedAt: nowIso,
      }).catch(() => {});
    }

    if (created.assignedStaffId && created.assignedStaffId !== user.id) {
      await createNotification({
        staffId: created.assignedStaffId,
        type: "CALLBACK",
        conversationId: created.conversationId || "/dashboard/call-queue",
        messageId: created.id,
        fromName: user.name,
        customerName: created.customerName || created.customerPhone,
        text: `Call query from ${created.source}: ${created.productTopic || created.notes || "See recording"} (${created.assignmentReason})`,
      }).catch(() => {});

      void sendStaffAssignmentEmailNotification({
        staffId: created.assignedStaffId,
        staffName: created.assignedStaffName || "Team Member",
        customerName: created.customerName || created.customerPhone || "Caller",
        customerPhone: created.customerPhone,
        smartCategory: created.productTopic || created.source,
        priority: created.priority,
        escalationLevel: "P0",
        teamName: "Call Dispatch Queue",
        reason: created.assignmentReason,
        latestMessage: `${created.notes}${created.recordingUrl ? " (Call recording attached)" : ""}`,
        conversationId: created.conversationId || "",
      }).catch(() => {});
    }

    socketHub.emit("call_queue:updated", { id: created.id, action: "created" });
    return NextResponse.json({ ok: true, item: created });
  }

  if (action === "pick_up") {
    const id = String(body.id || "").trim();
    const claimRes = await claimCallDispatchItem({
      id,
      actorId: user.id,
      actorName: user.name,
    });
    if (!claimRes.item) {
      return NextResponse.json({ ok: false, error: "Queue item not found." }, { status: 404 });
    }
    if (!claimRes.ok || claimRes.conflict) {
      return NextResponse.json(
        {
          ok: false,
          alreadyClaimed: true,
          claimedByStaffName: claimRes.claimedByStaffName || claimRes.item.assignedStaffName,
          error:
            claimRes.error ||
            `Already accepted by ${claimRes.item.assignedStaffName || "another team member"} (first-come, first-serve).`,
          item: claimRes.item,
        },
        { status: 409 }
      );
    }
    socketHub.emit("call_queue:updated", { id: claimRes.item.id, action: "picked_up" });
    return NextResponse.json({ ok: true, item: claimRes.item });
  }

  if (action === "reassign") {
    const id = String(body.id || "").trim();
    const targetStaffId = String(body.targetStaffId || "").trim();
    const allStaff = await listActiveNonClientStaff();
    const target = allStaff.find((s) => s.id === targetStaffId);
    if (!target) {
      return NextResponse.json({ ok: false, error: "Select a valid teammate." }, { status: 400 });
    }
    const updated = await updateCallDispatchItem({
      id,
      action: "reassign",
      actorId: user.id,
      actorName: user.name,
      targetStaffId: target.id,
      targetStaffName: target.name,
    });
    if (!updated) {
      return NextResponse.json({ ok: false, error: "Queue item not found." }, { status: 404 });
    }
    if (target.id !== user.id) {
      await createNotification({
        staffId: target.id,
        type: "CALLBACK",
        conversationId: updated.conversationId || "/dashboard/call-queue",
        messageId: updated.id,
        fromName: user.name,
        customerName: updated.customerName || updated.customerPhone,
        text: `Call query reassigned to you by ${user.name}: ${updated.productTopic || updated.notes}`,
      }).catch(() => {});
    }
    socketHub.emit("call_queue:updated", { id: updated.id, action: "reassigned" });
    return NextResponse.json({ ok: true, item: updated });
  }

  if (action === "resolve" || action === "reopen") {
    const id = String(body.id || "").trim();
    const updated = await updateCallDispatchItem({
      id,
      action,
      actorId: user.id,
      actorName: user.name,
      resolutionNotes: body.resolutionNotes ? String(body.resolutionNotes) : undefined,
    });
    if (!updated) {
      return NextResponse.json({ ok: false, error: "Queue item not found." }, { status: 404 });
    }
    socketHub.emit("call_queue:updated", { id: updated.id, action });
    return NextResponse.json({ ok: true, item: updated });
  }

  // Convert / Open in WhatsApp Inbox with Call Notes & Recording Link posted as an Internal Note
  if (action === "open_in_inbox") {
    const id = String(body.id || "").trim();
    const items = await listCallDispatchQueue(250);
    let item = items.find((i) => i.id === id);
    if (!item) {
      return NextResponse.json({ ok: false, error: "Queue item not found." }, { status: 404 });
    }
    if (!item.assignedStaffId) {
      const claimRes = await claimCallDispatchItem({
        id,
        actorId: user.id,
        actorName: user.name,
      });
      if (!claimRes.ok || claimRes.conflict) {
        return NextResponse.json(
          {
            ok: false,
            alreadyClaimed: true,
            error:
              claimRes.error ||
              `Already accepted by ${claimRes.claimedByStaffName || "another team member"} (first-come, first-serve).`,
          },
          { status: 409 }
        );
      }
      if (claimRes.item) item = claimRes.item;
    }
    const phone = normalizeWhatsAppPhone(item.customerPhone);
    if (!phone) {
      return NextResponse.json(
        { ok: false, error: "This call query has no valid WhatsApp phone number." },
        { status: 400 }
      );
    }

    const conv = getRawLibSqlClient("conversations");
    const crm = getRawLibSqlClient("crm_orders");

    await upsertSyncedContact({
      phone,
      name: item.customerName || phone,
      source: "MANUAL",
      preferredStaffId: item.assignedStaffId || user.id,
      preferredStaffName: item.assignedStaffName || user.name,
      lastContactedAt: nowIso,
    }).catch(() => {});

    const existingConv = await conv.execute({
      sql: `SELECT id FROM conversations WHERE customer_phone = ? LIMIT 1`,
      args: [phone],
    });
    const custRes = await crm.execute({
      sql: `SELECT id FROM customers WHERE phone = ? LIMIT 1`,
      args: [phone],
    });
    const custId = custRes.rows[0]?.id ? String(custRes.rows[0].id) : null;

    let convId = existingConv.rows[0]?.id ? String(existingConv.rows[0].id) : "";
    const ownerId = item.assignedStaffId || user.id;
    const ownerName = item.assignedStaffName || user.name;

    if (!convId) {
      convId = `conv_${crypto.randomUUID().slice(0, 8)}`;
      await conv.execute({
        sql: `INSERT INTO conversations (
          id, customer_phone, customer_name, customer_id, status, priority, smart_category,
          assigned_staff_id, assigned_staff_name, assigned_team_id, assigned_team_name,
          escalation_level, waiting_since, unread_count, last_message_preview, last_message_at, created_at
        ) VALUES (?, ?, ?, ?, 'ASSIGNED', ?, 'General Enquiry', ?, ?, 'team_sales', 'Sales Team', 'P0', NULL, 0, ?, ?, ?)`,
        args: [
          convId,
          phone,
          item.customerName || phone,
          custId,
          item.priority,
          ownerId,
          ownerName,
          `Call Queue (${item.source}): ${item.productTopic || item.notes}`.slice(0, 140),
          nowIso,
          nowIso,
        ],
      });
      await logConversationAssignment({
        conversationId: convId,
        customerPhone: phone,
        customerName: item.customerName || phone,
        toStaffId: ownerId,
        toStaffName: ownerName,
        toTeamId: "team_sales",
        toTeamName: "Sales Team",
        escalationLevel: "P0",
        assignmentSource: "CALL_DISPATCH_QUEUE",
        assignedByName: user.name,
        reason: item.assignmentReason || `Picked up from Call Dispatch Queue by ${user.name}`,
        assignedAt: nowIso,
      });
    }

    // Post call details + recording link as an Internal Team Note inside the chat
    const noteLines = [
      `*Call / External Query Intake (${item.source})*`,
      `• *Dropped by:* ${item.submittedByName}`,
      item.productTopic ? `• *Topic / Product:* ${item.productTopic}` : "",
      item.notes ? `• *Notes:* ${item.notes}` : "",
      item.recordingUrl ? `• *Call Recording (${item.recordingFileName || "Audio"}):* ${item.recordingUrl}` : "",
      item.attachmentUrl ? `• *Attachment (${item.attachmentName || "File"}):* ${item.attachmentUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, metadata_json, delivery_status, created_at
      ) VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', ?, 'INTERNAL_NOTE', 'INTERNAL', ?, ?, 'SAVED', ?)`,
      args: [
        `msg_cq_${crypto.randomUUID().slice(0, 8)}`,
        convId,
        user.name,
        noteLines,
        JSON.stringify({
          callQueueId: item.id,
          ...(item.recordingUrl
            ? {
                mediaType: "AUDIO",
                mediaUrl: item.recordingUrl,
                fileName: item.recordingFileName || "Call Recording",
                mimeType: item.recordingMimeType || "audio/mpeg",
              }
            : {}),
        }),
        nowIso,
      ],
    });

    await updateCallDispatchItem({
      id: item.id,
      action: "link_conversation",
      actorId: user.id,
      actorName: user.name,
      conversationId: convId,
    });
    socketHub.emit("call_queue:updated", { id: item.id, action: "linked", conversationId: convId });
    socketHub.emit("note:new", { conversationId: convId, senderName: user.name, noteText: noteLines });

    return NextResponse.json({ ok: true, conversationId: convId });
  }

  return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
}
