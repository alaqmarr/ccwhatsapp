import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  ensureDatabasesBootstrapped,
  fetchWebsiteEnquiriesForCustomer,
  getRawLibSqlClient,
} from "@cc/database";
import {
  runAcrioChatCopilot,
  sendWhatsAppCloudMessage,
} from "@cc/connections";
import { hasPermission } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import { listCustomAdminLinks } from "@cc/storage";
import {
  recordDualPricingLedgerEntry,
  type BillingMessageCategory,
} from "@cc/workers";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const { id } = await context.params;
  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");

  const convRes = await conv.execute({
    sql: `SELECT * FROM conversations WHERE id = ? LIMIT 1`,
    args: [id],
  });
  if (!convRes.rows[0]) {
    return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }
  const cRow = convRes.rows[0] as Record<string, unknown>;
  const customerPhone = String(cRow.customer_phone);

  // Reset unread count on open
  await conv.execute({
    sql: `UPDATE conversations SET unread_count = 0 WHERE id = ?`,
    args: [id],
  });

  const [msgRes, custRes, ordersRes, relationsRes, customLinks] = await Promise.all([
    conv.execute({
      sql: `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      args: [id],
    }),
    crm.execute({
      sql: `SELECT * FROM customers WHERE phone = ? LIMIT 1`,
      args: [customerPhone],
    }),
    crm.execute({
      sql: `SELECT * FROM customer_orders WHERE customer_phone = ? ORDER BY ordered_at DESC`,
      args: [customerPhone],
    }),
    crm.execute({
      sql: `SELECT * FROM customer_relations WHERE customer_phone = ? ORDER BY occurred_at DESC`,
      args: [customerPhone],
    }),
    listCustomAdminLinks(),
  ]);

  const customerRow = custRes.rows[0] as Record<string, unknown> | undefined;
  const websiteEnquiries = await fetchWebsiteEnquiriesForCustomer(
    customerRow?.email ? String(customerRow.email) : customerPhone
  );

  const messages = msgRes.rows.map((m) => ({
    id: String(m.id),
    direction: String(m.direction),
    senderType: String(m.sender_type),
    senderName: String(m.sender_name),
    messageType: String(m.message_type),
    billingCategory: String(m.billing_category),
    body: String(m.body),
    templateName: m.template_name ? String(m.template_name) : null,
    deliveryStatus: String(m.delivery_status),
    createdAt: String(m.created_at),
  }));

  const orders = ordersRes.rows.map((o) => ({
    id: String(o.id),
    orderNumber: String(o.order_number),
    itemsSummary: String(o.items_summary),
    quantity: Number(o.quantity ?? 1),
    totalAmountInr: Number(o.total_amount_inr ?? 0),
    paymentStatus: String(o.payment_status),
    fulfillmentStatus: String(o.fulfillment_status),
    invoiceUrl: o.invoice_url ? String(o.invoice_url) : null,
    orderedAt: String(o.ordered_at),
  }));

  const relations = relationsRes.rows.map((r) => ({
    id: String(r.id),
    relationType: String(r.relation_type),
    summary: String(r.summary),
    handledBy: String(r.handled_by),
    occurredAt: String(r.occurred_at),
  }));

  const acrio = await runAcrioChatCopilot({
    customerName: String(cRow.customer_name),
    organizationType: customerRow?.organization_type
      ? String(customerRow.organization_type)
      : undefined,
    recentMessages: messages.map((m) => ({ direction: m.direction, body: m.body })),
    ordersSummary: orders.map((o) => `${o.orderNumber}: ${o.itemsSummary} (${o.fulfillmentStatus})`),
  });

  return NextResponse.json({
    ok: true,
    conversation: {
      id: String(cRow.id),
      customerPhone,
      customerName: String(cRow.customer_name),
      status: String(cRow.status),
      priority: String(cRow.priority),
      smartCategory: String(cRow.smart_category),
      assignedStaffId: cRow.assigned_staff_id ? String(cRow.assigned_staff_id) : null,
      assignedStaffName: cRow.assigned_staff_name ? String(cRow.assigned_staff_name) : null,
      resolutionSummary: cRow.resolution_summary ? String(cRow.resolution_summary) : null,
      resolvedByName: cRow.resolved_by_name ? String(cRow.resolved_by_name) : null,
      windowExpiresAt: cRow.window_expires_at ? String(cRow.window_expires_at) : null,
    },
    messages,
    customer: customerRow
      ? {
          id: String(customerRow.id),
          phone: String(customerRow.phone),
          name: String(customerRow.name),
          email: customerRow.email ? String(customerRow.email) : null,
          companyName: customerRow.company_name ? String(customerRow.company_name) : null,
          organizationType: String(customerRow.organization_type || "Business"),
          city: customerRow.city ? String(customerRow.city) : null,
          gstNumber: customerRow.gst_number ? String(customerRow.gst_number) : null,
          acrioSegment: String(customerRow.acrio_segment || "Active Lead"),
          lifetimeValueInr: Number(customerRow.lifetime_value_inr ?? 0),
          totalOrdersCount: Number(customerRow.total_orders_count ?? 0),
          notes: String(customerRow.notes || ""),
        }
      : null,
    orders,
    relations,
    websiteEnquiries,
    acrio,
    customLinks,
  });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:reply", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "send_message");

  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const nowIso = new Date().toISOString();

  const cRes = await conv.execute({
    sql: `SELECT * FROM conversations WHERE id = ? LIMIT 1`,
    args: [id],
  });
  if (!cRes.rows[0]) {
    return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }
  const cRow = cRes.rows[0] as Record<string, unknown>;
  const customerPhone = String(cRow.customer_phone);

  if (action === "send_message") {
    const text = String(body.text || "").trim();
    if (!text) {
      return NextResponse.json({ ok: false, error: "Message cannot be empty." }, { status: 400 });
    }

    const billingCategory: BillingMessageCategory =
      body.billingCategory === "MARKETING" ||
      body.billingCategory === "AUTHENTICATION" ||
      body.billingCategory === "SERVICE"
        ? body.billingCategory
        : "UTILITY";

    const messageType = body.messageType ? String(body.messageType) : "TEXT";
    const templateName = body.templateName ? String(body.templateName) : undefined;

    const sendRes = await sendWhatsAppCloudMessage({
      toPhone: customerPhone,
      bodyText: text,
      templateName,
    });

    const msgId = `msg_${crypto.randomUUID().slice(0, 8)}`;
    await conv.batch(
      [
        {
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, template_name, wa_message_id, delivery_status, created_at
          ) VALUES (?, ?, 'OUTBOUND', 'STAFF', ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            msgId,
            id,
            user.name,
            messageType,
            billingCategory,
            text,
            templateName || null,
            sendRes.waMessageId,
            sendRes.deliveryStatus,
            nowIso,
          ],
        },
        {
          sql: `UPDATE conversations
                SET status = CASE WHEN status = 'OPEN' THEN 'ASSIGNED' ELSE status END,
                    assigned_staff_id = COALESCE(assigned_staff_id, ?),
                    assigned_staff_name = COALESCE(assigned_staff_name, ?),
                    last_message_preview = ?,
                    last_message_at = ?
                WHERE id = ?`,
          args: [user.id, user.name, text.slice(0, 140), nowIso, id],
        },
      ],
      "write"
    );

    await recordDualPricingLedgerEntry({
      messageId: msgId,
      conversationId: id,
      customerPhone,
      category: billingCategory,
      staffName: user.name,
    });

    socketHub.emit("message:new", { conversationId: id, senderName: user.name, text });
    return NextResponse.json({ ok: true, messageId: msgId, mode: sendRes.mode });
  }

  if (action === "assign_staff") {
    const staffId = body.staffId ? String(body.staffId) : user.id;
    const staffName = body.staffName ? String(body.staffName) : user.name;
    await conv.execute({
      sql: `UPDATE conversations
            SET assigned_staff_id = ?, assigned_staff_name = ?, status = 'ASSIGNED'
            WHERE id = ?`,
      args: [staffId, staffName, id],
    });
    socketHub.emit("conversation:assigned", { conversationId: id, staffName });
    return NextResponse.json({ ok: true });
  }

  if (action === "smart_resolve") {
    const summary = String(body.resolutionSummary || "Resolved customer enquiry.").trim();
    const nextCategory = body.smartCategory ? String(body.smartCategory) : String(cRow.smart_category);

    await conv.execute({
      sql: `UPDATE conversations
            SET status = 'RESOLVED',
                smart_category = ?,
                resolution_summary = ?,
                resolved_by_name = ?,
                resolved_at = ?
            WHERE id = ?`,
      args: [nextCategory, summary, user.name, nowIso, id],
    });

    // Also append to Customer Relations timeline so future agents see what happened!
    if (cRow.customer_id) {
      await crm.execute({
        sql: `INSERT INTO customer_relations (
          id, customer_id, customer_phone, relation_type, summary, handled_by, occurred_at
        ) VALUES (?, ?, ?, 'WHATSAPP_RESOLVED', ?, ?, ?)`,
        args: [
          `rel_${crypto.randomUUID().slice(0, 8)}`,
          String(cRow.customer_id),
          customerPhone,
          summary,
          user.name,
          nowIso,
        ],
      });
    }

    socketHub.emit("conversation:resolved", { conversationId: id, resolvedBy: user.name });
    return NextResponse.json({ ok: true });
  }

  if (action === "reopen") {
    await conv.execute({
      sql: `UPDATE conversations SET status = 'OPEN' WHERE id = ?`,
      args: [id],
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "update_customer_profile") {
    await crm.execute({
      sql: `UPDATE customers
            SET company_name = COALESCE(?, company_name),
                organization_type = COALESCE(?, organization_type),
                city = COALESCE(?, city),
                acrio_segment = COALESCE(?, acrio_segment),
                notes = COALESCE(?, notes),
                last_interaction_at = ?
            WHERE phone = ?`,
      args: [
        body.companyName ?? null,
        body.organizationType ?? null,
        body.city ?? null,
        body.acrioSegment ?? null,
        body.notes ?? null,
        nowIso,
        customerPhone,
      ],
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "add_order") {
    const custRes = await crm.execute({
      sql: `SELECT id FROM customers WHERE phone = ? LIMIT 1`,
      args: [customerPhone],
    });
    const custId = custRes.rows[0] ? String(custRes.rows[0].id) : `cust_${crypto.randomUUID().slice(0, 6)}`;
    const amount = Number(body.totalAmountInr || 0);
    const orderNumber =
      String(body.orderNumber || "").trim() ||
      `CC-2026-${Math.floor(1100 + Math.random() * 8900)}`;

    await crm.batch(
      [
        {
          sql: `INSERT INTO customer_orders (
            id, order_number, customer_id, customer_phone, items_summary, quantity,
            total_amount_inr, payment_status, fulfillment_status, ordered_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            `ord_${crypto.randomUUID().slice(0, 8)}`,
            orderNumber,
            custId,
            customerPhone,
            String(body.itemsSummary || "Custom Acrylic Order"),
            Number(body.quantity || 1),
            amount,
            String(body.paymentStatus || "ADVANCE_PAID"),
            String(body.fulfillmentStatus || "IN_PRODUCTION"),
            nowIso,
          ],
        },
        {
          sql: `UPDATE customers
                SET lifetime_value_inr = lifetime_value_inr + ?,
                    total_orders_count = total_orders_count + 1,
                    last_interaction_at = ?
                WHERE phone = ?`,
          args: [amount, nowIso, customerPhone],
        },
      ],
      "write"
    );
    return NextResponse.json({ ok: true, orderNumber });
  }

  return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
}
