import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { sendWhatsAppCloudMessage } from "@cc/connections";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { hasPermission, normalizeWhatsAppNumber } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import {
  checkAndEscalateWaitingChats,
  ensureBackgroundWorkersRunning,
  markPriorOutboundMessagesRead,
  processInboundAutomations,
  recordDualPricingLedgerEntry,
  scheduleSandboxDeliveryReceipt,
  type BillingMessageCategory,
} from "@cc/workers";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Active staff access required." }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  ensureBackgroundWorkersRunning();
  await checkAndEscalateWaitingChats().catch(() => {});

  const conv = getRawLibSqlClient("conversations");
  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status") || "ALL";
  const categoryFilter = searchParams.get("category") || "ALL";
  const teamFilter = searchParams.get("teamId") || "ALL";
  const waitingOnly = searchParams.get("waiting") === "1";
  const acrioOnly = searchParams.get("acrio") === "1";
  const mineOnly = searchParams.get("mine") === "1";

  const [res, latestMsgRes] = await Promise.all([
    conv.execute(
      `SELECT * FROM conversations ORDER BY
        CASE WHEN status != 'RESOLVED' AND waiting_since IS NOT NULL THEN 0
             WHEN status != 'RESOLVED' THEN 1
             ELSE 2 END,
        last_message_at DESC`
    ),
    conv.execute(
      `SELECT conversation_id, direction, delivery_status
       FROM messages
       WHERE direction IN ('INBOUND', 'OUTBOUND')
       ORDER BY created_at DESC, rowid DESC`
    ),
  ]);

  const latestByConv = new Map<
    string,
    { direction: string; deliveryStatus: string }
  >();
  for (const m of latestMsgRes.rows) {
    const cid = String(m.conversation_id);
    if (!latestByConv.has(cid)) {
      latestByConv.set(cid, {
        direction: String(m.direction),
        deliveryStatus: String(m.delivery_status || "SENT"),
      });
    }
  }

  let items = res.rows.map((r) => {
    const cid = String(r.id);
    const latest = latestByConv.get(cid);
    return {
      id: cid,
      customerPhone: String(r.customer_phone),
      customerName: String(r.customer_name),
      customerId: r.customer_id ? String(r.customer_id) : null,
      status: String(r.status),
      priority: String(r.priority),
      smartCategory: String(r.smart_category),
      assignedStaffId: r.assigned_staff_id ? String(r.assigned_staff_id) : null,
      assignedStaffName: r.assigned_staff_name ? String(r.assigned_staff_name) : null,
      assignedTeamId: r.assigned_team_id ? String(r.assigned_team_id) : null,
      assignedTeamName: r.assigned_team_name ? String(r.assigned_team_name) : null,
      escalationLevel: String(r.escalation_level || "P0"),
      waitingSince: r.waiting_since ? String(r.waiting_since) : null,
      lastResponseSeconds:
        r.last_response_seconds !== null && r.last_response_seconds !== undefined
          ? Number(r.last_response_seconds)
          : null,
      escalatedAt: r.escalated_at ? String(r.escalated_at) : null,
      unreadCount: Number(r.unread_count ?? 0),
      lastMessagePreview: String(r.last_message_preview || ""),
      lastMessageAt: String(r.last_message_at),
      lastMessageDirection: latest?.direction || null,
      lastMessageStatus: latest?.deliveryStatus || null,
      windowExpiresAt: r.window_expires_at ? String(r.window_expires_at) : null,
      resolutionSummary: r.resolution_summary ? String(r.resolution_summary) : null,
      resolvedByName: r.resolved_by_name ? String(r.resolved_by_name) : null,
      tags: (() => {
        try {
          return JSON.parse(String(r.tags_json || "[]"));
        } catch {
          return [];
        }
      })(),
    };
  });

  if (statusFilter !== "ALL") {
    items = items.filter((c) => c.status === statusFilter);
  }
  if (categoryFilter !== "ALL") {
    items = items.filter((c) => c.smartCategory === categoryFilter);
  }
  if (teamFilter !== "ALL") {
    items = items.filter((c) => c.assignedTeamId === teamFilter);
  }
  if (waitingOnly) {
    items = items.filter((c) => c.status !== "RESOLVED" && Boolean(c.waitingSince));
  }
  if (acrioOnly) {
    items = items.filter((c) => c.status !== "RESOLVED" && c.assignedStaffId === "ACRIO");
  }
  if (mineOnly) {
    items = items.filter((c) => c.assignedStaffId === user.id);
  }

  return NextResponse.json({ ok: true, conversations: items });
}

/**
 * Simulates an incoming customer WhatsApp message (for Test Mode) or starts a new outbound customer thread.
 * Initial inbound assignment is ALWAYS ACRIO, which handles the query automatically in the backend and
 * hands off to Sales Team (P0) only if the customer asks for staff or ACRIO cannot resolve.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:reply", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const body = await req.json().catch(() => ({}));
  const phoneCheck = normalizeWhatsAppNumber(String(body.customerPhone || ""));
  if (!phoneCheck.valid) {
    return NextResponse.json({ ok: false, error: phoneCheck.error }, { status: 400 });
  }

  const customerName = String(body.customerName || phoneCheck.e164).trim();
  const text = String(body.messageText || "Hello Classic Concepts, I have a product enquiry.").trim();
  const direction = body.direction === "OUTBOUND" ? "OUTBOUND" : "INBOUND";
  const templateName = body.templateName ? String(body.templateName).trim() : undefined;
  const isTemplate = direction === "OUTBOUND" && Boolean(templateName || body.messageType === "TEMPLATE");

  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const nowIso = new Date().toISOString();
  const windowExp = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Upsert CRM customer
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
    // Only assign to System (ACRIO) when customer initiates a fresh conversation after RESOLVED.
    // If already open with human staff/team, NEVER switch back to ACRIO automatically!
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

  let deliveryStatus = "DELIVERED";
  let waMessageId: string | null = null;
  let sandboxMode = false;
  if (direction === "OUTBOUND") {
    const sendRes = await sendWhatsAppCloudMessage({
      toPhone: phoneCheck.e164,
      bodyText: text,
      templateName,
      simulateAsyncDelivery: true,
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
      id, conversation_id, direction, sender_type, sender_name, message_type,
      billing_category, body, template_name, wa_message_id, delivery_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      msgId,
      convId,
      direction,
      direction === "INBOUND" ? "CUSTOMER" : "STAFF",
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

  if (direction === "OUTBOUND" && sandboxMode && waMessageId) {
    scheduleSandboxDeliveryReceipt({
      conversationId: convId,
      messageId: msgId,
      waMessageId,
    });
  }

  // Charge ONLY if an outbound Template message was sent! Regular chat is ₹0.00 (Free).
  if (isTemplate) {
    await recordDualPricingLedgerEntry({
      messageId: msgId,
      conversationId: convId,
      customerPhone: phoneCheck.e164,
      category: templateCategory,
      staffName: user.name,
    });
  }

  if (direction === "INBOUND") {
    await processInboundAutomations({
      conversationId: convId,
      customerPhone: phoneCheck.e164,
      inboundText: text,
      isNewConversation: isNew || prevStatus === "RESOLVED",
    });
  }

  socketHub.emit("message:new", { conversationId: convId, customerName, text });
  return NextResponse.json({ ok: true, conversationId: convId });
}
