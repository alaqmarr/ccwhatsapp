import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  formatWhatsAppOutboundText,
  isWhatsAppServiceWindowOpen,
  sendWhatsAppCloudMessage,
} from "@cc/connections";
import { getRawLibSqlClient, upsertCustomerSharedMedia } from "@cc/database";
import { isDevRole } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import {
  logConversationAssignment,
  recordAssignedFirstResponse,
  recordDualPricingLedgerEntry,
  scheduleSandboxDeliveryReceipt,
  type BillingMessageCategory,
} from "@cc/workers";
import {
  buildOutboundMetadataJson,
  parseLocationPin,
  parseOutboundAttachment,
  resolveOutboundTemplateComponents,
} from "./outbound-payload";
import { resolveQuotedReply, type ConversationActionContext } from "./shared";

export async function handleSendMessage(ctx: ConversationActionContext) {
  const { id, user, body, conv, cRow, customerPhone, nowMs, nowIso } = ctx;

  const rawText = String(body.text || "").trim();
  const attachment = parseOutboundAttachment(body);
  const locationPin = parseLocationPin(body);

  if (!rawText && !attachment && !locationPin) {
    return NextResponse.json(
      { ok: false, error: "Message or attachment cannot be empty." },
      { status: 400 }
    );
  }

  const text =
    rawText ||
    (locationPin
      ? `*${locationPin.name}*\n${locationPin.address}\n\n*Google Maps:* ${locationPin.mapsUrl}`
      : attachment?.mediaType === "DOCUMENT" && attachment.fileName
      ? `[Document] ${attachment.fileName}`
      : attachment?.mediaType === "VIDEO"
      ? `[Video] ${attachment.fileName || "Video"}`
      : attachment?.mediaType === "AUDIO"
      ? `[Audio] ${attachment.fileName || "Audio"}`
      : attachment?.productName
      ? `*${attachment.productName}*${attachment.variantName ? ` (${attachment.variantName})` : ""}`
      : `[${attachment?.mediaType || "Attachment"}]`);

  const templateName = body.templateName ? String(body.templateName).trim() : undefined;
  const isTemplate = body.messageType === "TEMPLATE" || Boolean(templateName);
  if (!isTemplate && !isWhatsAppServiceWindowOpen(cRow.window_expires_at, nowMs)) {
    return NextResponse.json(
      {
        ok: false,
        windowClosed: true,
        error:
          "24-hour customer service window is closed. Choose an approved WhatsApp template instead.",
      },
      { status: 400 }
    );
  }
  let tplRecord: Record<string, unknown> | null = null;
  if (isTemplate && templateName) {
    const mkt = getRawLibSqlClient("marketing");
    const tplCheck = await mkt.execute({
      sql: `SELECT approval_status, language, header_type, header_media_url, variables_schema_json FROM templates WHERE name = ? LIMIT 1`,
      args: [templateName],
    });
    if (tplCheck.rows[0]) {
      tplRecord = tplCheck.rows[0] as Record<string, unknown>;
      if (String(tplRecord.approval_status) !== "APPROVED") {
        return NextResponse.json(
          {
            ok: false,
            error: `Only official Meta-APPROVED templates can be sent on WhatsApp ("${templateName}" is ${String(
              tplRecord.approval_status
            )}).`,
          },
          { status: 400 }
        );
      }
    }
  }

  const templateBillingCategory: BillingMessageCategory =
    body.billingCategory === "MARKETING"
      ? "MARKETING"
      : body.billingCategory === "AUTHENTICATION"
      ? "AUTHENTICATION"
      : "UTILITY";

  const replyMeta = await resolveQuotedReply(conv, id, body);
  const rawCta =
    body.ctaButton && typeof body.ctaButton === "object"
      ? (body.ctaButton as Record<string, unknown>)
      : null;
  const ctaButtonMeta =
    rawCta && String(rawCta.url || "").trim()
      ? {
          label: String(rawCta.label || "Track Order").trim().slice(0, 20),
          url: String(rawCta.url || "").trim(),
          orderId: rawCta.orderId ? String(rawCta.orderId) : undefined,
          providerName: rawCta.providerName ? String(rawCta.providerName) : undefined,
          awbNumber: rawCta.awbNumber ? String(rawCta.awbNumber) : undefined,
        }
      : null;

  const metadataJson = buildOutboundMetadataJson({
    replyMeta,
    ctaButtonMeta,
    locationPin,
    attachment,
    rawText,
  });

  const { templateComponents, languageCode } = resolveOutboundTemplateComponents(
    body,
    tplRecord
  );

  // Send location pin sequentially before follow-up text so messages arrive in order
  const pinSend =
    locationPin && !templateName
      ? await sendWhatsAppCloudMessage({
          toPhone: customerPhone,
          bodyText: `${locationPin.name}\n${locationPin.address}\n${locationPin.mapsUrl}`,
          location: {
            latitude: locationPin.latitude,
            longitude: locationPin.longitude,
            name: locationPin.name,
            address: locationPin.address,
          },
          simulateAsyncDelivery: true,
          forceSandbox: Boolean(body.forceSandbox),
        })
      : null;

  const sendRes = await sendWhatsAppCloudMessage({
    toPhone: customerPhone,
    bodyText: text,
    templateName,
    templateComponents,
    languageCode,
    skipAutoChatRecord: Boolean(templateName),
    replyToWaMessageId: replyMeta?.waMessageId || undefined,
    media: attachment
      ? {
          type: attachment.mediaType,
          url: attachment.url,
          waMediaId: attachment.waMediaId,
          caption: rawText || undefined,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
        }
      : undefined,
    ctaButton: ctaButtonMeta
      ? {
          label: ctaButtonMeta.label,
          url: ctaButtonMeta.url,
          footerText: "Classic Concepts & Classic Edge 53",
        }
      : undefined,
    simulateAsyncDelivery: true,
    forceSandbox: Boolean(body.forceSandbox),
  });

  let pinMsgId: string | null = null;
  if (pinSend && locationPin) {
    pinMsgId = `msg_loc_${crypto.randomUUID().slice(0, 8)}`;
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_staff_id, sender_name, message_type,
        billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'STAFF', ?, ?, 'LOCATION', 'FREE_CHAT', ?, ?, ?, ?, ?)`,
      args: [
        pinMsgId,
        id,
        user.id,
        user.name,
        `Location: ${locationPin.name} (${locationPin.mapsUrl})`,
        JSON.stringify({ locationPin }),
        pinSend.waMessageId,
        pinSend.deliveryStatus,
        nowIso,
      ],
    });
    if (pinSend.ok && pinSend.mode === "SANDBOX_SIMULATOR") {
      scheduleSandboxDeliveryReceipt({
        conversationId: id,
        messageId: pinMsgId,
        waMessageId: pinSend.waMessageId,
      });
    }
    socketHub.emit("message:new", {
      conversationId: id,
      messageId: pinMsgId,
      waMessageId: pinSend.waMessageId,
      deliveryStatus: pinSend.deliveryStatus,
      senderName: user.name,
      text: `Location: ${locationPin.name}`,
    });
  }

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
  const storedBody = isTemplate ? text : formatWhatsAppOutboundText(text);
  const previewBody = storedBody.replace(/\s*\n+\s*/g, " ").slice(0, 140);

  const msgId = `msg_${crypto.randomUUID().slice(0, 8)}`;
  await conv.batch(
    [
      {
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_staff_id, sender_name, message_type,
          billing_category, body, template_name, metadata_json, wa_message_id, delivery_status, created_at
        ) VALUES (?, ?, 'OUTBOUND', 'STAFF', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          msgId,
          id,
          user.id,
          user.name,
          isTemplate ? "TEMPLATE" : attachment ? attachment.mediaType : "TEXT",
          isTemplate ? templateBillingCategory : "FREE_CHAT",
          storedBody,
          templateName || null,
          metadataJson,
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
          previewBody,
          nowIso,
          sendRes.deliveryStatus,
          id,
        ],
      },
    ],
    "write"
  );

  const [, firstRespTrack] = await Promise.all([
    shouldAutoAssignSender
      ? logConversationAssignment({
          conversationId: id,
          customerPhone,
          customerName: String(cRow.customer_name || ""),
          fromStaffId: cRow.assigned_staff_id ? String(cRow.assigned_staff_id) : "ACRIO",
          fromStaffName: cRow.assigned_staff_name
            ? String(cRow.assigned_staff_name)
            : "ACRIO",
          fromTeamName: cRow.assigned_team_name
            ? String(cRow.assigned_team_name)
            : "System (ACRIO)",
          toStaffId: user.id,
          toStaffName: user.name,
          toTeamId: cRow.assigned_team_id ? String(cRow.assigned_team_id) : "team_sales",
          toTeamName:
            cRow.assigned_team_name && String(cRow.assigned_team_name) !== "System (ACRIO)"
              ? String(cRow.assigned_team_name)
              : "Sales Team",
          escalationLevel: "P0",
          assignmentSource: "STAFF_TAKEOVER",
          assignedByName: user.name,
          reason: `${user.name} replied in chat and took ownership`,
          assignedAt: nowIso,
        }).catch(() => {})
      : Promise.resolve(),
    recordAssignedFirstResponse({
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
    }),
    sendRes.ok && isTemplate
      ? recordDualPricingLedgerEntry({
          messageId: msgId,
          conversationId: id,
          customerPhone,
          category: templateBillingCategory,
          staffName: user.name,
          deliveryMode: sendRes.mode,
        })
      : Promise.resolve(),
  ]);

  if (responseSeconds === null && firstRespTrack?.firstResponseSeconds) {
    await conv.execute({
      sql: `UPDATE conversations SET last_response_seconds = ? WHERE id = ?`,
      args: [firstRespTrack.firstResponseSeconds, id],
    });
  }

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
    text,
  });

  if (String(cRow.smart_category || "") !== "Internal Team") {
    if (attachment && !isTemplate) {
      void upsertCustomerSharedMedia({
        customerPhone,
        conversationId: id,
        messageId: msgId,
        waMediaId: attachment.waMediaId || null,
        localMediaId: attachment.mediaId || attachment.waMediaId || null,
        itemKind: attachment.mediaType,
        title: attachment.fileName || attachment.productName || attachment.mediaType,
        caption: rawText,
        mimeType: attachment.mimeType || "",
        fileSizeBytes: attachment.sizeBytes ?? null,
        sourceType: "STAFF_SHARED",
        sourceLabel: `Shared by ${user.name}`,
        receivedViaName: user.name,
        assignedStaffId: user.id,
        assignedStaffName: user.name,
        createdAt: nowIso,
      }).catch(() => {});
    }
    if (locationPin) {
      void upsertCustomerSharedMedia({
        customerPhone,
        conversationId: id,
        messageId: pinMsgId || msgId,
        itemKind: "LOCATION",
        title: locationPin.name,
        caption: rawText,
        latitude: locationPin.latitude,
        longitude: locationPin.longitude,
        locationAddress: locationPin.address,
        mapsUrl: locationPin.mapsUrl,
        sourceType: "STAFF_SHARED",
        sourceLabel: `Location shared by ${user.name}`,
        receivedViaName: user.name,
        assignedStaffId: user.id,
        assignedStaffName: user.name,
        createdAt: nowIso,
      }).catch(() => {});
    }
  }
  return NextResponse.json({
    ok: sendRes.ok,
    messageId: msgId,
    pinMessageId: pinMsgId,
    waMessageId: sendRes.waMessageId,
    deliveryStatus: sendRes.deliveryStatus,
    mode: sendRes.mode,
    billed: sendRes.ok && isTemplate,
    replyTo: replyMeta,
    error: sendRes.error,
  });
}
