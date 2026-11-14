import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { hasPermission, normalizeWhatsAppNumber } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import { processInboundAutomations } from "@cc/workers";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Active staff access required." }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status") || "ALL";
  const categoryFilter = searchParams.get("category") || "ALL";
  const mineOnly = searchParams.get("mine") === "1";

  const res = await conv.execute(
    `SELECT * FROM conversations ORDER BY
      CASE status WHEN 'OPEN' THEN 0 WHEN 'ASSIGNED' THEN 1 ELSE 2 END,
      last_message_at DESC`
  );

  let items = res.rows.map((r) => ({
    id: String(r.id),
    customerPhone: String(r.customer_phone),
    customerName: String(r.customer_name),
    customerId: r.customer_id ? String(r.customer_id) : null,
    status: String(r.status),
    priority: String(r.priority),
    smartCategory: String(r.smart_category),
    assignedStaffId: r.assigned_staff_id ? String(r.assigned_staff_id) : null,
    assignedStaffName: r.assigned_staff_name ? String(r.assigned_staff_name) : null,
    unreadCount: Number(r.unread_count ?? 0),
    lastMessagePreview: String(r.last_message_preview || ""),
    lastMessageAt: String(r.last_message_at),
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
  }));

  if (statusFilter !== "ALL") {
    items = items.filter((c) => c.status === statusFilter);
  }
  if (categoryFilter !== "ALL") {
    items = items.filter((c) => c.smartCategory === categoryFilter);
  }
  if (mineOnly) {
    items = items.filter((c) => c.assignedStaffId === user.id);
  }

  return NextResponse.json({ ok: true, conversations: items });
}

/**
 * Allows simulating an incoming customer WhatsApp message (for Sandbox testing) or starting a new customer thread.
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
    sql: `SELECT id FROM conversations WHERE customer_phone = ? LIMIT 1`,
    args: [phoneCheck.e164],
  });

  const isNew = existingConv.rows.length === 0;
  const convId = isNew
    ? `conv_${crypto.randomUUID().slice(0, 8)}`
    : String(existingConv.rows[0].id);

  if (isNew) {
    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, customer_id, status, priority, smart_category,
        unread_count, last_message_preview, last_message_at, window_expires_at, created_at
      ) VALUES (?, ?, ?, ?, 'OPEN', 'NORMAL', 'General Enquiry', ?, ?, ?, ?, ?)`,
      args: [
        convId,
        phoneCheck.e164,
        customerName,
        customerId,
        direction === "INBOUND" ? 1 : 0,
        text.slice(0, 140),
        nowIso,
        windowExp,
        nowIso,
      ],
    });
  } else {
    await conv.execute({
      sql: `UPDATE conversations
            SET status = CASE WHEN status = 'RESOLVED' THEN 'OPEN' ELSE status END,
                unread_count = unread_count + ?,
                last_message_preview = ?,
                last_message_at = ?,
                window_expires_at = ?
            WHERE id = ?`,
      args: [direction === "INBOUND" ? 1 : 0, text.slice(0, 140), nowIso, windowExp, convId],
    });
  }

  const msgId = `msg_${crypto.randomUUID().slice(0, 8)}`;
  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, direction, sender_type, sender_name, message_type,
      billing_category, body, delivery_status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'TEXT', 'SERVICE', ?, 'DELIVERED', ?)`,
    args: [
      msgId,
      convId,
      direction,
      direction === "INBOUND" ? "CUSTOMER" : "STAFF",
      direction === "INBOUND" ? customerName : user.name,
      text,
      nowIso,
    ],
  });

  if (direction === "INBOUND") {
    await processInboundAutomations({
      conversationId: convId,
      customerPhone: phoneCheck.e164,
      inboundText: text,
      isNewConversation: isNew,
    });
  }

  socketHub.emit("message:new", { conversationId: convId, customerName, text });
  return NextResponse.json({ ok: true, conversationId: convId });
}
