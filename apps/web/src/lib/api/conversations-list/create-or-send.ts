import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@cc/auth";
import { sendWhatsAppCloudMessage } from "@cc/connections";
import { getRawLibSqlClient, upsertSyncedContact } from "@cc/database";
import { normalizeWhatsAppNumber } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import {
  logConversationAssignment,
  markPriorOutboundMessagesRead,
  processInboundAutomations,
  recordAssignedFirstResponse,
  recordDualPricingLedgerEntry,
  scheduleSandboxDeliveryReceipt,
  type BillingMessageCategory,
} from "@cc/workers";

export async function handleCreateOrSendConversation(
  user: AuthenticatedUser,
  body: Record<string, unknown>,
  nowIso: string
) {
  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");

  const phoneCheck = normalizeWhatsAppNumber(String(body.customerPhone || ""));
  if (!phoneCheck.valid) {
    return NextResponse.json({ ok: false, error: phoneCheck.error }, { status: 400 });
  }

  const customerName = String(body.customerName || phoneCheck.e164).trim();
  const text = String(
    body.messageText || "Hello Classic Concepts, I have a product enquiry."
  ).trim();
  const direction = body.direction === "OUTBOUND" ? "OUTBOUND" : "INBOUND";
  const templateName = body.templateName ? String(body.templateName).trim() : undefined;
  const isTemplate =
    direction === "OUTBOUND" && Boolean(templateName || body.messageType === "TEMPLATE");

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
            error: `Only Meta-approved templates can be sent (template "${templateName}" is ${String(
              tplRecord.approval_status
            )}).`,
          },
          { status: 400 }
        );
      }
    }
  }

  const windowExp = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const existingCust = await crm.execute({
    sql: `SELECT id FROM customers WHERE phone = ? LIMIT 1`,
    args: [phoneCheck.e164],
  });
  let customerId = existingCust.rows[0] ? String(existingCust.rows[0].id) : "";
  if (!customerId) {
    customerId = `cust_${crypto.randomUUID().slice(0, 8)}`;
    await crm.execute({
      sql: `INSERT INTO customers (
        id, phone, name, organization_type, acrio_segment, last_interaction_at, created_at
      ) VALUES (?, ?, ?, ?, 'New WhatsApp Lead', ?, ?)`,
      args: [
        customerId,
        phoneCheck.e164,
        customerName,
        String(body.organizationType || "Business"),
        nowIso,
        nowIso,
      ],
    });
  }

  await upsertSyncedContact({
    phone: phoneCheck.e164,
    name: customerName,
    organizationType: body.organizationType ? String(body.organizationType) : undefined,
    source: direction === "INBOUND" ? "WHATSAPP_INBOUND" : "MANUAL",
    lastContactedAt: nowIso,
  }).catch(() => {});

  const existingConv = await conv.execute({
    sql: `SELECT id, status, assigned_staff_id FROM conversations WHERE customer_phone = ? LIMIT 1`,
    args: [phoneCheck.e164],
  });

  const isNew = existingConv.rows.length === 0;
  const prevStatus = existingConv.rows[0] ? String(existingConv.rows[0].status) : "";
  const prevStaffId = existingConv.rows[0]?.assigned_staff_id
    ? String(existingConv.rows[0].assigned_staff_id)
    : null;
  const convId = isNew
    ? `conv_${crypto.randomUUID().slice(0, 8)}`
    : String(existingConv.rows[0].id);

  if (isNew) {
    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, customer_id, status, priority, smart_category,
        assigned_staff_id, assigned_staff_name, assigned_team_id, assigned_team_name,
        escalation_level, waiting_since, unread_count, last_message_preview, last_message_at, window_expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'NORMAL', 'General Enquiry', ?, ?, ?, ?, 'P0', NULL, ?, ?, ?, ?, ?)`,
      args: [
        convId,
        phoneCheck.e164,
        customerName,
        customerId,
        direction === "INBOUND" ? "OPEN" : "ASSIGNED",
        direction === "INBOUND" ? "ACRIO" : user.id,
        direction === "INBOUND" ? "ACRIO" : user.name,
        direction === "INBOUND" ? null : "team_sales",
        direction === "INBOUND" ? "System (ACRIO)" : "Sales Team",
        direction === "INBOUND" ? 1 : 0,
        text.slice(0, 140),
        nowIso,
        direction === "INBOUND" ? windowExp : null,
        nowIso,
      ],
    });
  } else if (direction === "INBOUND") {
    const resetToAcrio = prevStatus === "RESOLVED";
    const isHumanOwned = !resetToAcrio && prevStaffId !== "ACRIO";
    await conv.execute({
      sql: `UPDATE conversations
            SET status = CASE WHEN status = 'RESOLVED' THEN 'OPEN' ELSE status END,
                assigned_staff_id = CASE WHEN ? = 1 THEN 'ACRIO' ELSE assigned_staff_id END,
                assigned_staff_name = CASE WHEN ? = 1 THEN 'ACRIO' ELSE assigned_staff_name END,
                assigned_team_id = CASE WHEN ? = 1 THEN NULL ELSE assigned_team_id END,
                assigned_team_name = CASE WHEN ? = 1 THEN 'System (ACRIO)' ELSE assigned_team_name END,
                escalation_level = CASE WHEN ? = 1 THEN 'P0' ELSE escalation_level END,
                waiting_since = CASE WHEN ? = 1 THEN COALESCE(waiting_since, ?) ELSE waiting_since END,
                unread_count = unread_count + 1,
                last_message_preview = ?,
                last_message_at = ?,
                window_expires_at = ?
            WHERE id = ?`,
      args: [
        resetToAcrio ? 1 : 0,
        resetToAcrio ? 1 : 0,
        resetToAcrio ? 1 : 0,
        resetToAcrio ? 1 : 0,
        resetToAcrio ? 1 : 0,
        isHumanOwned ? 1 : 0,
        nowIso,
        text.slice(0, 140),
        nowIso,
        windowExp,
        convId,
      ],
    });
  } else {
    await conv.execute({
      sql: `UPDATE conversations
            SET status = 'ASSIGNED',
                assigned_staff_id = ?,
                assigned_staff_name = ?,
                assigned_team_id = COALESCE(assigned_team_id, 'team_sales'),
                assigned_team_name = CASE
                  WHEN assigned_team_id IS NULL THEN 'Sales Team'
                  ELSE assigned_team_name
                END,
                waiting_since = NULL,
                last_message_preview = ?,
                last_message_at = ?
            WHERE id = ?`,
      args: [user.id, user.name, text.slice(0, 140), nowIso, convId],
    });
  }

  const resetToAcrio = !isNew && direction === "INBOUND" && prevStatus === "RESOLVED";
  if (direction === "INBOUND" && (isNew || resetToAcrio)) {
    const assignIso = new Date(Math.max(0, new Date(nowIso).getTime() - 2)).toISOString();
    await logConversationAssignment({
      conversationId: convId,
      customerPhone: phoneCheck.e164,
      customerName,
      toStaffId: "ACRIO",
      toStaffName: "ACRIO",
      toTeamId: null,
      toTeamName: "System (ACRIO)",
      escalationLevel: "P0",
      assignmentSource: "INITIAL_SYSTEM",
      assignedByName: "System",
      reason: isNew
        ? "Customer started a new WhatsApp chat"
        : "Customer messaged after previous resolution",
      assignedAt: assignIso,
    });
  } else if (direction === "OUTBOUND" && isNew) {
    const assignIso = new Date(Math.max(0, new Date(nowIso).getTime() - 2)).toISOString();
    await logConversationAssignment({
      conversationId: convId,
      customerPhone: phoneCheck.e164,
      customerName,
      toStaffId: user.id,
      toStaffName: user.name,
      toTeamId: "team_sales",
      toTeamName: "Sales Team",
      escalationLevel: "P0",
      assignmentSource: "OUTBOUND_START",
      assignedByName: user.name,
      reason: "Staff initiated outbound WhatsApp chat",
      assignedAt: assignIso,
    });
  }

  let deliveryStatus = "DELIVERED";
  let waMessageId: string | null = null;
  let sandboxMode = false;
  if (direction === "OUTBOUND") {
    let templateComponents: Record<string, unknown>[] | undefined = Array.isArray(
      body.templateComponents
    )
      ? (body.templateComponents as Record<string, unknown>[])
      : undefined;

    if (
      !templateComponents &&
      (Array.isArray(body.templateVariables) || Array.isArray(body.variables))
    ) {
      const rawVars = (body.templateVariables || body.variables) as unknown[];
      if (rawVars.length > 0) {
        templateComponents = [
          {
            type: "body",
            parameters: rawVars.map((v) => ({
              type: "text",
              text: String(v ?? ""),
            })),
          },
        ];
      }
    }

    const headerType = String(tplRecord?.header_type || "NONE").toUpperCase();
    const headerMediaUrl = body.headerMediaUrl
      ? String(body.headerMediaUrl).trim()
      : tplRecord?.header_media_url
      ? String(tplRecord.header_media_url).trim()
      : "";
    if (
      (headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT") &&
      headerMediaUrl
    ) {
      if (!templateComponents) templateComponents = [];
      const hasHeader = templateComponents.some(
        (c) => String(c?.type || "").toLowerCase() === "header"
      );
      if (!hasHeader) {
        const mediaKey = headerType.toLowerCase();
        templateComponents.unshift({
          type: "header",
          parameters: [{ type: mediaKey, [mediaKey]: { link: headerMediaUrl } }],
        });
      }
    }

    const languageCode = body.languageCode
      ? String(body.languageCode).trim()
      : tplRecord?.language
      ? String(tplRecord.language).trim()
      : undefined;

    const sendRes = await sendWhatsAppCloudMessage({
      toPhone: phoneCheck.e164,
      bodyText: text,
      templateName,
      templateComponents,
      languageCode,
      skipAutoChatRecord: Boolean(templateName),
      simulateAsyncDelivery: true,
      forceSandbox: Boolean(body.forceSandbox),
    });
    deliveryStatus = sendRes.deliveryStatus;
    waMessageId = sendRes.waMessageId;
    sandboxMode = sendRes.ok && sendRes.mode === "SANDBOX_SIMULATOR";
  } else {
    await markPriorOutboundMessagesRead(convId);
  }

  const templateCategory: BillingMessageCategory =
    body.billingCategory === "MARKETING"
      ? "MARKETING"
      : body.billingCategory === "AUTHENTICATION"
      ? "AUTHENTICATION"
      : "UTILITY";

  const msgId = `msg_${crypto.randomUUID().slice(0, 8)}`;
  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, direction, sender_type, sender_staff_id, sender_name, message_type,
      billing_category, body, template_name, wa_message_id, delivery_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      msgId,
      convId,
      direction,
      direction === "INBOUND" ? "CUSTOMER" : "STAFF",
      direction === "INBOUND" ? null : user.id,
      direction === "INBOUND" ? customerName : user.name,
      isTemplate ? "TEMPLATE" : "TEXT",
      isTemplate ? templateCategory : "FREE_CHAT",
      text,
      templateName || null,
      waMessageId,
      deliveryStatus,
      nowIso,
    ],
  });

  if (direction === "OUTBOUND") {
    await recordAssignedFirstResponse({
      conversationId: convId,
      responderId: user.id,
      responderName: user.name,
      responderTeamId: "team_sales",
      responderTeamName: "Sales Team",
      messageId: msgId,
      respondedAt: nowIso,
    });
  }

  if (direction === "OUTBOUND" && sandboxMode && waMessageId) {
    scheduleSandboxDeliveryReceipt({
      conversationId: convId,
      messageId: msgId,
      waMessageId,
    });
  }

  if (isTemplate) {
    await recordDualPricingLedgerEntry({
      messageId: msgId,
      conversationId: convId,
      customerPhone: phoneCheck.e164,
      category: templateCategory,
      staffName: user.name,
      deliveryMode: sandboxMode ? "SANDBOX_SIMULATOR" : "LIVE_META_CLOUD",
    });
  }

  if (direction === "INBOUND") {
    await processInboundAutomations({
      conversationId: convId,
      customerPhone: phoneCheck.e164,
      inboundText: text,
      isNewConversation: isNew || prevStatus === "RESOLVED",
      isButtonClick: Boolean(body.isButtonClick),
      buttonPayload: body.buttonPayload ? String(body.buttonPayload) : undefined,
      buttonText: body.buttonText ? String(body.buttonText) : undefined,
    });
  }

  socketHub.emit("message:new", { conversationId: convId, customerName, text });
  return NextResponse.json({ ok: true, conversationId: convId });
}
