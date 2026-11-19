import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@cc/auth";
import {
  fetchAllEcosystemWebsiteEnquiries,
  getRawLibSqlClient,
  normalizeWhatsAppPhone,
  upsertSyncedContact,
} from "@cc/database";
import { logConversationAssignment } from "@cc/workers";

export async function handleSyncSources(user: AuthenticatedUser, nowIso: string) {
  const contactsDb = getRawLibSqlClient("contacts");
  const crmDb = getRawLibSqlClient("crm_orders");
  const convDb = getRawLibSqlClient("conversations");

  const [convRows, crmRows, webEnquiries] = await Promise.all([
    convDb.execute(
      `SELECT customer_phone, customer_name, last_message_at FROM conversations`
    ),
    crmDb.execute(
      `SELECT phone, name, email, company_name, organization_type, city, gst_number, acrio_segment, opt_in_marketing, lifetime_value_inr, total_orders_count, notes
       FROM customers`
    ),
    fetchAllEcosystemWebsiteEnquiries(500),
  ]);

  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const c of crmRows.rows) {
    const r = await upsertSyncedContact({
      phone: String(c.phone || ""),
      name: String(c.name || ""),
      email: c.email ? String(c.email) : undefined,
      companyName: c.company_name ? String(c.company_name) : undefined,
      organizationType: c.organization_type ? String(c.organization_type) : undefined,
      city: c.city ? String(c.city) : undefined,
      gstNumber: c.gst_number ? String(c.gst_number) : undefined,
      acrioSegment: c.acrio_segment ? String(c.acrio_segment) : undefined,
      optInMarketing: Number(c.opt_in_marketing ?? 1) === 1,
      lifetimeValueInr: Number(c.lifetime_value_inr ?? 0),
      totalOrdersCount: Number(c.total_orders_count ?? 0),
      notes: c.notes ? String(c.notes) : undefined,
    });
    if (r.ok) {
      if (r.isNew) importedCount++;
      else updatedCount++;
    } else skippedCount++;
  }

  for (const cv of convRows.rows) {
    const r = await upsertSyncedContact({
      phone: String(cv.customer_phone || ""),
      name: String(cv.customer_name || ""),
      whatsappName: String(cv.customer_name || ""),
      source: "WHATSAPP_INBOUND",
      lastContactedAt: String(cv.last_message_at || nowIso),
    });
    if (r.ok) {
      if (r.isNew) importedCount++;
      else updatedCount++;
    } else skippedCount++;
  }

  for (const eq of webEnquiries) {
    const isEdge = eq.source.includes("classicedge53");
    const r = await upsertSyncedContact({
      phone: eq.phone,
      name: eq.name || undefined,
      email: eq.email || undefined,
      source: "WEBSITE_ENQUIRY",
      acrioSegment: isEdge ? "Classic Edge 53 Machine Lead" : "Website Product Lead",
      groups: isEdge ? ["grp_machines"] : undefined,
      notes: eq.message ? `Website enquiry (${eq.source}): ${eq.message.slice(0, 220)}` : undefined,
      lastContactedAt: eq.createdAt || nowIso,
    });
    if (r.ok) {
      if (r.isNew) importedCount++;
      else updatedCount++;
    } else skippedCount++;
  }

  await contactsDb.execute({
    sql: `INSERT INTO contact_import_logs (
      id, source_label, imported_count, updated_count, skipped_count, imported_by_name, created_at
    ) VALUES (?, 'Chats + CRM + Website Enquiries Sync', ?, ?, ?, ?, ?)`,
    args: [
      `imp_${crypto.randomUUID().slice(0, 8)}`,
      importedCount,
      updatedCount,
      skippedCount,
      user.name,
      nowIso,
    ],
  });

  return NextResponse.json({
    ok: true,
    importedCount,
    updatedCount,
    skippedCount,
    websiteEnquiriesScanned: webEnquiries.length,
  });
}

export async function handleCreateGroup(
  user: AuthenticatedUser,
  body: Record<string, unknown>,
  nowIso: string
) {
  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json(
      { ok: false, error: "Group name is required." },
      { status: 400 }
    );
  }
  const contactsDb = getRawLibSqlClient("contacts");
  const id = `grp_${crypto.randomUUID().slice(0, 8)}`;
  await contactsDb.execute({
    sql: `INSERT INTO contact_groups (id, name, description, color, created_by_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(name) DO UPDATE SET description = excluded.description, color = excluded.color, updated_at = excluded.updated_at`,
    args: [
      id,
      name,
      String(body.description || "").trim(),
      String(body.color || "emerald"),
      user.name,
      nowIso,
      nowIso,
    ],
  });
  return NextResponse.json({ ok: true, id });
}

export async function handleDeleteGroup(body: Record<string, unknown>) {
  const groupId = String(body.groupId || "").trim();
  const contactsDb = getRawLibSqlClient("contacts");
  await contactsDb.execute({
    sql: `DELETE FROM contact_groups WHERE id = ?`,
    args: [groupId],
  });
  return NextResponse.json({ ok: true });
}

export async function handleOpenOrCreateChat(
  user: AuthenticatedUser,
  body: Record<string, unknown>,
  nowIso: string
) {
  const phone = normalizeWhatsAppPhone(String(body.phone || ""));
  const contactName = String(body.name || phone).trim() || phone;
  if (!phone) {
    return NextResponse.json(
      { ok: false, error: "Invalid WhatsApp phone number." },
      { status: 400 }
    );
  }

  const convDb = getRawLibSqlClient("conversations");
  const crmDb = getRawLibSqlClient("crm_orders");

  const existingConv = await convDb.execute({
    sql: `SELECT id FROM conversations WHERE customer_phone = ? LIMIT 1`,
    args: [phone],
  });
  if (existingConv.rows[0]) {
    return NextResponse.json({
      ok: true,
      conversationId: String(existingConv.rows[0].id),
    });
  }

  const custRes = await crmDb.execute({
    sql: `SELECT id FROM customers WHERE phone = ? LIMIT 1`,
    args: [phone],
  });
  const custId = custRes.rows[0]
    ? String(custRes.rows[0].id)
    : `cust_${crypto.randomUUID().slice(0, 8)}`;

  const convId = `conv_${crypto.randomUUID().slice(0, 8)}`;
  await convDb.execute({
    sql: `INSERT INTO conversations (
      id, customer_phone, customer_name, customer_id, status, priority, smart_category,
      assigned_staff_id, assigned_staff_name, assigned_team_id, assigned_team_name,
      escalation_level, waiting_since, unread_count, last_message_preview, last_message_at, created_at
    ) VALUES (?, ?, ?, ?, 'ASSIGNED', 'NORMAL', 'General Enquiry', ?, ?, 'team_sales', 'Sales Team', 'P0', NULL, 0, 'Opened from Contacts Database', ?, ?)`,
    args: [convId, phone, contactName, custId, user.id, user.name, nowIso, nowIso],
  });

  await logConversationAssignment({
    conversationId: convId,
    customerPhone: phone,
    customerName: contactName,
    toStaffId: user.id,
    toStaffName: user.name,
    toTeamId: "team_sales",
    toTeamName: "Sales Team",
    escalationLevel: "P0",
    assignmentSource: "OUTBOUND_START",
    assignedByName: user.name,
    reason: `Chat opened from Contacts Database by ${user.name}`,
    assignedAt: nowIso,
  });

  return NextResponse.json({ ok: true, conversationId: convId });
}
