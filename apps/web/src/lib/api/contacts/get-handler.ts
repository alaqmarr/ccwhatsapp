import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@cc/auth";
import {
  fetchWebsiteEnquiriesForCustomer,
  getRawLibSqlClient,
} from "@cc/database";
import { loadContactsPayload } from "@/lib/loaders/crm";

export function parseJsonArray(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function handleGetContacts(req: Request, user: AuthenticatedUser) {
  const url = new URL(req.url);
  const contactId = (url.searchParams.get("contactId") || "").trim();

  if (contactId) {
    const contactsDb = getRawLibSqlClient("contacts");
    const convDb = getRawLibSqlClient("conversations");
    const crmDb = getRawLibSqlClient("crm_orders");

    const cRes = await contactsDb.execute({
      sql: `SELECT * FROM contacts WHERE id = ? LIMIT 1`,
      args: [contactId],
    });
    const row = cRes.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return NextResponse.json(
        { ok: false, error: "Contact not found." },
        { status: 404 }
      );
    }
    const phone = String(row.phone);
    const [ordersRes, relationsRes, convRes, webEnquiries] = await Promise.all([
      crmDb.execute({
        sql: `SELECT id, order_number, items_summary, quantity, total_amount_inr, payment_status, fulfillment_status, ordered_at
              FROM customer_orders WHERE customer_phone = ? ORDER BY ordered_at DESC LIMIT 20`,
        args: [phone],
      }),
      crmDb.execute({
        sql: `SELECT id, relation_type, summary, handled_by, occurred_at
              FROM customer_relations WHERE customer_phone = ? ORDER BY occurred_at DESC LIMIT 20`,
        args: [phone],
      }),
      convDb.execute({
        sql: `SELECT id, status, assigned_staff_name, assigned_team_name, unread_count, last_message_preview, last_message_at, window_expires_at
              FROM conversations WHERE customer_phone = ? LIMIT 1`,
        args: [phone],
      }),
      fetchWebsiteEnquiriesForCustomer(phone),
    ]);

    const convRow = convRes.rows[0] as Record<string, unknown> | undefined;

    return NextResponse.json({
      ok: true,
      detail: {
        id: String(row.id),
        phone,
        whatsappName: String(row.whatsapp_name || ""),
        name: String(row.name || phone),
        email: String(row.email || ""),
        companyName: String(row.company_name || ""),
        designation: String(row.designation || ""),
        organizationType: String(row.organization_type || "Business"),
        city: String(row.city || ""),
        state: String(row.state || ""),
        country: String(row.country || "India"),
        gstNumber: String(row.gst_number || ""),
        source: String(row.source || "MANUAL"),
        stage: String(row.stage || "NEW_LEAD"),
        acrioSegment: String(row.acrio_segment || "Active Prospect"),
        tags: parseJsonArray(row.tags_json),
        groups: parseJsonArray(row.groups_json),
        optInMarketing: Number(row.opt_in_marketing ?? 1) === 1,
        optOutReason: String(row.opt_out_reason || ""),
        assignedOwnerId: row.assigned_owner_id ? String(row.assigned_owner_id) : null,
        assignedOwnerName: String(row.assigned_owner_name || ""),
        preferredStaffId: row.preferred_staff_id
          ? String(row.preferred_staff_id)
          : row.assigned_owner_id
          ? String(row.assigned_owner_id)
          : null,
        preferredStaffName: String(
          row.preferred_staff_name || row.assigned_owner_name || ""
        ),
        lifetimeValueInr: Number(row.lifetime_value_inr ?? 0),
        totalOrdersCount: Number(row.total_orders_count ?? 0),
        notes: String(row.notes || ""),
        lastContactedAt: row.last_contacted_at ? String(row.last_contacted_at) : null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        conversation: convRow
          ? {
              id: String(convRow.id),
              status: String(convRow.status),
              assignedTo: String(
                convRow.assigned_staff_name || convRow.assigned_team_name || "System"
              ),
              unreadCount: Number(convRow.unread_count ?? 0),
              lastMessagePreview: String(convRow.last_message_preview || ""),
              lastMessageAt: String(convRow.last_message_at),
              windowExpiresAt: convRow.window_expires_at
                ? String(convRow.window_expires_at)
                : null,
            }
          : null,
        orders: ordersRes.rows.map((o) => ({
          id: String(o.id),
          orderNumber: String(o.order_number),
          itemsSummary: String(o.items_summary),
          quantity: Number(o.quantity ?? 1),
          totalAmountInr: Number(o.total_amount_inr ?? 0),
          paymentStatus: String(o.payment_status),
          fulfillmentStatus: String(o.fulfillment_status),
          orderedAt: String(o.ordered_at),
        })),
        relations: relationsRes.rows.map((rel) => ({
          id: String(rel.id),
          relationType: String(rel.relation_type),
          summary: String(rel.summary),
          handledBy: String(rel.handled_by),
          occurredAt: String(rel.occurred_at),
        })),
        websiteEnquiries: webEnquiries,
      },
    });
  }

  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit ? Number(rawLimit) : undefined;

  const payload = await loadContactsPayload(user, {
    q: url.searchParams.get("q") || "",
    stage: url.searchParams.get("stage") || "ALL",
    optIn: url.searchParams.get("optIn") || "ALL",
    orgType: url.searchParams.get("orgType") || "ALL",
    source: url.searchParams.get("source") || "ALL",
    groupId: url.searchParams.get("groupId") || "ALL",
    tag: url.searchParams.get("tag") || "ALL",
    sort: url.searchParams.get("sort") || "recent",
    limit: limit && Number.isFinite(limit) ? limit : undefined,
  });
  return NextResponse.json(payload);
}
