import {
  fetchWebsiteEnquiriesForCustomer,
  getRawLibSqlClient,
  getVerifiedLiveBrandAndTeamInfo,
  listCustomerSharedMediaForCustomer,
  listOrderTrackings,
  parseConversationCollaborators,
} from "@cc/database";
import { listCustomAdminLinks, rememberWhatsAppCache } from "@cc/storage";
import type {
  AcrioCopilot,
  ChatMessage,
  ConversationAssignmentItem,
  ConversationDetailBundle,
  CustomerOrder,
  CustomerRelation,
} from "./types";

export async function getConversationDetailServer(
  conversationId: string,
  markRead = true
): Promise<ConversationDetailBundle | null> {
  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");

  const convRes = await conv.execute({
    sql: `SELECT * FROM conversations WHERE id = ? LIMIT 1`,
    args: [conversationId],
  });
  if (!convRes.rows[0]) return null;

  const cRow = convRes.rows[0] as Record<string, unknown>;
  const customerPhone = String(cRow.customer_phone);

  const [
    msgRes,
    assignRes,
    custRes,
    ordersRes,
    relationsRes,
    customLinks,
    orderTrackings,
    liveBrandInfo,
    sharedMediaVault,
  ] = await Promise.all([
    conv.execute({
      sql: `SELECT * FROM (
              SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 251
            ) ORDER BY created_at ASC`,
      args: [conversationId],
    }),
    conv.execute({
      sql: `SELECT * FROM conversation_assignments WHERE conversation_id = ? ORDER BY assigned_at DESC`,
      args: [conversationId],
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
    listOrderTrackings({ customerPhone }).catch(() => []),
    getVerifiedLiveBrandAndTeamInfo().catch(() => null),
    listCustomerSharedMediaForCustomer({ customerPhone, conversationId }).catch(() => []),
    markRead && Number(cRow.unread_count ?? 0) > 0
      ? conv.execute({
          sql: `UPDATE conversations SET unread_count = 0 WHERE id = ?`,
          args: [conversationId],
        })
      : Promise.resolve(null),
  ]);

  const customerRow = custRes.rows[0] as Record<string, unknown> | undefined;
  const lookupKey = customerRow?.email ? String(customerRow.email) : customerPhone;
  const websiteEnquiries = await rememberWhatsAppCache(
    `customer-enq:${lookupKey}`,
    ["customer-history"],
    300,
    () => fetchWebsiteEnquiriesForCustomer(lookupKey)
  );

  const rawMsgRows = msgRes.rows;
  const hasOlderMessages = rawMsgRows.length > 250;
  const trimmedMsgRows = hasOlderMessages
    ? rawMsgRows.slice(rawMsgRows.length - 250)
    : rawMsgRows;

  const messages: ChatMessage[] = trimmedMsgRows.map((m) => {
    let metadata: Record<string, unknown> | null = null;
    if (m.metadata_json) {
      try {
        metadata = JSON.parse(String(m.metadata_json));
      } catch {
        metadata = null;
      }
    }
    return {
      id: String(m.id),
      direction: String(m.direction),
      senderType: String(m.sender_type),
      senderName: String(m.sender_name),
      messageType: String(m.message_type),
      billingCategory: String(m.billing_category),
      body: String(m.body),
      templateName: m.template_name ? String(m.template_name) : null,
      waMessageId: m.wa_message_id ? String(m.wa_message_id) : null,
      deliveryStatus: String(m.delivery_status),
      createdAt: String(m.created_at),
      metadata,
    };
  });

  const assignments: ConversationAssignmentItem[] = assignRes.rows.map((a) => ({
    id: String(a.id),
    conversationId: String(a.conversation_id),
    fromStaffId: a.from_staff_id ? String(a.from_staff_id) : null,
    fromStaffName: a.from_staff_name ? String(a.from_staff_name) : null,
    fromTeamName: a.from_team_name ? String(a.from_team_name) : null,
    toStaffId: a.to_staff_id ? String(a.to_staff_id) : null,
    toStaffName: String(a.to_staff_name || ""),
    toTeamId: a.to_team_id ? String(a.to_team_id) : null,
    toTeamName: String(a.to_team_name || ""),
    escalationLevel: String(a.escalation_level || "P0"),
    assignmentSource: String(a.assignment_source || "MANUAL_ASSIGN"),
    assignedByName: String(a.assigned_by_name || "System"),
    reason: String(a.reason || ""),
    assignedAt: String(a.assigned_at),
    firstResponseAt: a.first_response_at ? String(a.first_response_at) : null,
    firstResponseSeconds:
      a.first_response_seconds !== null && a.first_response_seconds !== undefined
        ? Number(a.first_response_seconds)
        : null,
    firstResponseMessageId: a.first_response_message_id
      ? String(a.first_response_message_id)
      : null,
    endedAt: a.ended_at ? String(a.ended_at) : null,
    outcome: String(a.outcome || "ACTIVE"),
  }));

  const orders: CustomerOrder[] = ordersRes.rows.map((o) => ({
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

  const relations: CustomerRelation[] = relationsRes.rows.map((r) => ({
    id: String(r.id),
    relationType: String(r.relation_type),
    summary: String(r.summary),
    handledBy: String(r.handled_by),
    occurredAt: String(r.occurred_at),
  }));

  const acrio: AcrioCopilot | null = null;

  return {
    conversation: {
      id: String(cRow.id),
      customerPhone,
      customerName: String(cRow.customer_name),
      status: String(cRow.status),
      priority: String(cRow.priority),
      smartCategory: String(cRow.smart_category),
      assignedStaffId: cRow.assigned_staff_id ? String(cRow.assigned_staff_id) : null,
      assignedStaffName: cRow.assigned_staff_name
        ? String(cRow.assigned_staff_name)
        : null,
      assignedTeamId: cRow.assigned_team_id ? String(cRow.assigned_team_id) : null,
      assignedTeamName: cRow.assigned_team_name ? String(cRow.assigned_team_name) : null,
      escalationLevel: String(cRow.escalation_level || "P0"),
      waitingSince: cRow.waiting_since ? String(cRow.waiting_since) : null,
      lastResponseSeconds:
        cRow.last_response_seconds !== null && cRow.last_response_seconds !== undefined
          ? Number(cRow.last_response_seconds)
          : null,
      escalatedAt: cRow.escalated_at ? String(cRow.escalated_at) : null,
      resolutionSummary: cRow.resolution_summary ? String(cRow.resolution_summary) : null,
      resolvedByName: cRow.resolved_by_name ? String(cRow.resolved_by_name) : null,
      windowExpiresAt: cRow.window_expires_at ? String(cRow.window_expires_at) : null,
      collaborators: parseConversationCollaborators(cRow.collaborators_json),
    },
    messages,
    hasOlderMessages,
    oldestMessageCursor: messages[0]?.createdAt || null,
    assignments,
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
          preferredStaffId: customerRow.preferred_staff_id
            ? String(customerRow.preferred_staff_id)
            : null,
          preferredStaffName: customerRow.preferred_staff_name
            ? String(customerRow.preferred_staff_name)
            : null,
          tags: (() => {
            try {
              const p = JSON.parse(String(customerRow.tags_json || "[]"));
              return Array.isArray(p) ? p.map(String).filter(Boolean) : [];
            } catch {
              return [];
            }
          })(),
        }
      : null,
    orders,
    orderTrackings,
    relations,
    websiteEnquiries,
    acrio,
    customLinks,
    sharedMediaVault,
    drawerHydrated: true,
    verifiedLocation: {
      placeName:
        liveBrandInfo?.placeName || "Classic Concepts Acrylic Private Limited",
      address:
        liveBrandInfo?.address ||
        "1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015",
      businessHours:
        liveBrandInfo?.businessHours ||
        "Monday - Saturday: 10:00 AM to 7:00 PM (Sunday: Closed)",
      phone: liveBrandInfo?.officePhones?.[0] || "+91 79016 50662",
      mapsUrl:
        liveBrandInfo?.mapsUrl || "https://maps.google.com/?q=17.4947378,78.496725",
      latitude: liveBrandInfo?.latitude ?? 17.4947378,
      longitude: liveBrandInfo?.longitude ?? 78.496725,
    },
  };
}
