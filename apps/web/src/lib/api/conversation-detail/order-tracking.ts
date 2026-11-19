import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { sendWhatsAppCloudMessage } from "@cc/connections";
import { upsertOrderTracking, type ShipmentStatus } from "@cc/database";
import { isDevRole } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import {
  recordAssignedFirstResponse,
  scheduleSandboxDeliveryReceipt,
} from "@cc/workers";
import { resolveQuotedReply, type ConversationActionContext } from "./shared";

export async function handleOrderTrackingAction(
  ctx: ConversationActionContext,
  action: "save_order_tracking" | "send_order_tracking"
) {
  const { id, user, body, conv, cRow, customerPhone, nowMs, nowIso } = ctx;

  const upRes = await upsertOrderTracking({
    orderId: String(body.orderId || ""),
    brand: body.brand ? String(body.brand) : undefined,
    customerName: String(body.customerName || cRow.customer_name || ""),
    customerPhone,
    conversationId: id,
    itemsSummary: body.itemsSummary !== undefined ? String(body.itemsSummary) : undefined,
    providerCode: body.providerCode ? String(body.providerCode) : undefined,
    providerName: body.providerName ? String(body.providerName) : undefined,
    awbNumber: body.awbNumber !== undefined ? String(body.awbNumber) : undefined,
    providerTrackingUrl:
      body.providerTrackingUrl !== undefined
        ? String(body.providerTrackingUrl)
        : undefined,
    shipmentStatus: body.shipmentStatus
      ? (String(body.shipmentStatus) as ShipmentStatus)
      : "DISPATCHED",
    estimatedDelivery:
      body.estimatedDelivery !== undefined ? String(body.estimatedDelivery) : undefined,
    notes: body.notes !== undefined ? String(body.notes) : undefined,
    createdByName: user.name,
  });

  if (!upRes.ok || !upRes.tracking) {
    return NextResponse.json(
      { ok: false, error: upRes.error || "Could not create tracking link." },
      { status: 400 }
    );
  }

  const trk = upRes.tracking;
  if (action === "save_order_tracking") {
    return NextResponse.json({ ok: true, tracking: trk });
  }

  const buttonLabel =
    String(body.buttonLabel || "Track Order")
      .trim()
      .slice(0, 20) || "Track Order";
  const firstName =
    String(cRow.customer_name || "there")
      .trim()
      .split(/\s+/)[0] || "there";
  const customText = String(body.text || "").trim();
  const messageBody =
    customText ||
    `Hello ${firstName}, your ${trk.brandLabel} order ${trk.orderId} is dispatched${
      trk.providerName ? ` via ${trk.providerName}` : ""
    }${trk.awbNumber ? ` (AWB: ${trk.awbNumber})` : ""}. Tap the button below to track live delivery.`;

  const replyMeta = await resolveQuotedReply(conv, id, body);
  const ctaButtonMeta = {
    label: buttonLabel,
    url: trk.publicTrackingUrl,
    orderId: trk.orderId,
    providerName: trk.providerName,
    awbNumber: trk.awbNumber,
  };
  const metaObj: Record<string, unknown> = { ctaButton: ctaButtonMeta };
  if (replyMeta) metaObj.replyTo = replyMeta;

  const sendRes = await sendWhatsAppCloudMessage({
    toPhone: customerPhone,
    bodyText: messageBody,
    replyToWaMessageId: replyMeta?.waMessageId || undefined,
    ctaButton: {
      label: buttonLabel,
      url: trk.publicTrackingUrl,
      footerText: `${trk.brandLabel} Dispatch`,
    },
    simulateAsyncDelivery: true,
    forceSandbox: Boolean(body.forceSandbox),
  });

  let responseSeconds: number | null =
    cRow.last_response_seconds !== null && cRow.last_response_seconds !== undefined
      ? Number(cRow.last_response_seconds)
      : null;
  if (cRow.waiting_since) {
    const waitStart = new Date(String(cRow.waiting_since)).getTime();
    if (!Number.isNaN(waitStart)) {
      responseSeconds = Math.max(1, Math.round((nowMs - waitStart) / 1000));
    }
  }

  const wasAcrioOrUnassigned =
    !cRow.assigned_staff_id || String(cRow.assigned_staff_id) === "ACRIO";
  const shouldAutoAssignSender =
    wasAcrioOrUnassigned ||
    (isDevRole(user.role) && String(cRow.assigned_staff_id || "") !== user.id);

  const msgId = `msg_${crypto.randomUUID().slice(0, 8)}`;
  await conv.batch(
    [
      {
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
        ) VALUES (?, ?, 'OUTBOUND', 'STAFF', ?, 'CUSTOM_LINK', 'FREE_CHAT', ?, ?, ?, ?, ?)`,
        args: [
          msgId,
          id,
          user.name,
          messageBody,
          JSON.stringify(metaObj),
          sendRes.waMessageId,
          sendRes.deliveryStatus,
          nowIso,
        ],
      },
      {
        sql: `UPDATE conversations
              SET status = 'ASSIGNED',
                  assigned_staff_id = CASE WHEN ? = 1 THEN ? ELSE assigned_staff_id END,
                  assigned_staff_name = CASE WHEN ? = 1 THEN ? ELSE assigned_staff_name END,
                  assigned_team_id = CASE WHEN ? = 1 THEN COALESCE(assigned_team_id, 'team_sales') ELSE assigned_team_id END,
                  assigned_team_name = CASE
                    WHEN ? = 1 AND (assigned_team_id IS NULL OR assigned_team_name = 'System (ACRIO)') THEN 'Sales Team'
                    ELSE assigned_team_name
                  END,
                  waiting_since = NULL,
                  last_response_seconds = ?,
                  escalation_level = 'P0',
                  last_message_preview = ?,
                  last_message_at = ?,
                  last_message_direction = 'OUTBOUND',
                  last_message_status = ?
              WHERE id = ?`,
        args: [
          shouldAutoAssignSender ? 1 : 0,
          user.id,
          shouldAutoAssignSender ? 1 : 0,
          user.name,
          shouldAutoAssignSender ? 1 : 0,
          shouldAutoAssignSender ? 1 : 0,
          responseSeconds,
          `[${buttonLabel}] ${messageBody}`.replace(/\s*\n+\s*/g, " ").slice(0, 140),
          nowIso,
          sendRes.deliveryStatus,
          id,
        ],
      },
    ],
    "write"
  );

  await recordAssignedFirstResponse({
    conversationId: id,
    responderId: user.id,
    responderName: user.name,
    responderTeamId: cRow.assigned_team_id
      ? String(cRow.assigned_team_id)
      : "team_sales",
    responderTeamName:
      cRow.assigned_team_name && String(cRow.assigned_team_name) !== "System (ACRIO)"
        ? String(cRow.assigned_team_name)
        : "Sales Team",
    messageId: msgId,
    respondedAt: nowIso,
    overrideWaitSeconds: responseSeconds,
  }).catch(() => null);

  if (sendRes.ok && sendRes.mode === "SANDBOX_SIMULATOR") {
    scheduleSandboxDeliveryReceipt({
      conversationId: id,
      messageId: msgId,
      waMessageId: sendRes.waMessageId,
    });
  }

  socketHub.emit("message:new", {
    conversationId: id,
    messageId: msgId,
    waMessageId: sendRes.waMessageId,
    deliveryStatus: sendRes.deliveryStatus,
    senderName: user.name,
    text: messageBody,
  });

  return NextResponse.json({
    ok: sendRes.ok,
    tracking: trk,
    messageId: msgId,
    waMessageId: sendRes.waMessageId,
    deliveryStatus: sendRes.deliveryStatus,
    mode: sendRes.mode,
    ctaButton: ctaButtonMeta,
    error: sendRes.error,
  });
}
