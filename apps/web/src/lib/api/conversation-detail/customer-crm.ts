import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getRawLibSqlClient, upsertSyncedContact } from "@cc/database";
import { socketHub } from "@cc/sockets";
import type { ConversationActionContext } from "./shared";

export async function handleUpdateCustomerProfile(ctx: ConversationActionContext) {
  const { id, body, crm, customerPhone, nowIso } = ctx;
  let prefStaffId =
    body.preferredStaffId !== undefined
      ? body.preferredStaffId
        ? String(body.preferredStaffId).trim()
        : null
      : undefined;
  let prefStaffName =
    body.preferredStaffName !== undefined
      ? String(body.preferredStaffName || "").trim()
      : undefined;

  if (prefStaffId && !prefStaffName) {
    const auth = getRawLibSqlClient("core_auth");
    const u = await auth
      .execute({ sql: `SELECT name FROM users WHERE id = ? LIMIT 1`, args: [prefStaffId] })
      .catch(() => ({ rows: [] as any[] }));
    prefStaffName = u.rows[0]?.name ? String(u.rows[0].name) : "";
  }
  if (prefStaffId === "") {
    prefStaffId = null;
    prefStaffName = "";
  }

  const tagsArr: string[] | undefined = Array.isArray(body.tags)
    ? body.tags.map(String).map((t: string) => t.trim()).filter(Boolean)
    : undefined;

  await crm.execute({
    sql: `UPDATE customers
          SET name = COALESCE(NULLIF(?, ''), name),
              email = COALESCE(?, email),
              company_name = COALESCE(?, company_name),
              organization_type = COALESCE(?, organization_type),
              city = COALESCE(?, city),
              gst_number = COALESCE(?, gst_number),
              acrio_segment = COALESCE(?, acrio_segment),
              notes = COALESCE(?, notes),
              preferred_staff_id = CASE WHEN ? = 1 THEN ? ELSE preferred_staff_id END,
              preferred_staff_name = CASE WHEN ? = 1 THEN ? ELSE preferred_staff_name END,
              tags_json = CASE WHEN ? = 1 THEN ? ELSE tags_json END,
              last_interaction_at = ?
          WHERE phone = ?`,
    args: [
      body.name !== undefined ? String(body.name || "").trim() : null,
      body.email !== undefined ? (body.email ? String(body.email).trim() : null) : null,
      (body.companyName as string | null) ?? null,
      (body.organizationType as string | null) ?? null,
      (body.city as string | null) ?? null,
      body.gstNumber !== undefined ? String(body.gstNumber || "").trim().toUpperCase() : null,
      (body.acrioSegment as string | null) ?? null,
      (body.notes as string | null) ?? null,
      prefStaffId !== undefined ? 1 : 0,
      prefStaffId ?? null,
      prefStaffId !== undefined || prefStaffName !== undefined ? 1 : 0,
      prefStaffName ?? "",
      tagsArr !== undefined ? 1 : 0,
      tagsArr !== undefined ? JSON.stringify(tagsArr) : "[]",
      nowIso,
      customerPhone,
    ],
  });

  await upsertSyncedContact({
    phone: customerPhone,
    name: body.name !== undefined ? String(body.name || "").trim() : undefined,
    email: body.email !== undefined ? String(body.email || "").trim() : undefined,
    companyName:
      body.companyName !== undefined ? String(body.companyName || "") : undefined,
    organizationType:
      body.organizationType !== undefined
        ? String(body.organizationType || "")
        : undefined,
    city: body.city !== undefined ? String(body.city || "") : undefined,
    gstNumber: body.gstNumber !== undefined ? String(body.gstNumber || "") : undefined,
    acrioSegment:
      body.acrioSegment !== undefined ? String(body.acrioSegment || "") : undefined,
    notes: body.notes !== undefined ? String(body.notes || "") : undefined,
    preferredStaffId: prefStaffId,
    preferredStaffName: prefStaffName,
    tags: tagsArr,
    lastContactedAt: nowIso,
  }).catch(() => {});

  socketHub.emit("conversation:updated", { conversationId: id });
  return NextResponse.json({ ok: true });
}

export async function handleAddOrder(ctx: ConversationActionContext) {
  const { body, crm, customerPhone, nowIso } = ctx;
  const custRes = await crm.execute({
    sql: `SELECT id, lifetime_value_inr, total_orders_count FROM customers WHERE phone = ? LIMIT 1`,
    args: [customerPhone],
  });
  const custId = custRes.rows[0]
    ? String(custRes.rows[0].id)
    : `cust_${crypto.randomUUID().slice(0, 6)}`;
  const prevLtv = custRes.rows[0] ? Number(custRes.rows[0].lifetime_value_inr ?? 0) : 0;
  const prevOrders = custRes.rows[0]
    ? Number(custRes.rows[0].total_orders_count ?? 0)
    : 0;
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

  const nextOrders = prevOrders + 1;
  const nextLtv = prevLtv + amount;
  await upsertSyncedContact({
    phone: customerPhone,
    lifetimeValueInr: nextLtv,
    totalOrdersCount: nextOrders,
    stage:
      nextLtv >= 50000 || nextOrders >= 3
        ? "VIP"
        : nextOrders >= 2
        ? "REPEAT_BUYER"
        : "CUSTOMER",
    lastContactedAt: nowIso,
  }).catch(() => {});

  return NextResponse.json({ ok: true, orderNumber });
}
