import {
  ensureDatabasesBootstrapped,
  fetchWebsiteEnquiriesForCustomer,
  getRawLibSqlClient,
  getVerifiedLiveBrandAndTeamInfo,
  listOrderTrackings,
  parseConversationCollaborators,
  resolveSharedAnthropicApiKey,
  type ConversationCollaborator,
  type OrderTrackingRecord,
} from "@cc/database";
import { getCachedEcosystemCatalog } from "@cc/connections";
import { canAssignToDev, type UserRole } from "@cc/rbac";
import {
  getWhatsAppCacheSummary,
  listCustomAdminLinks,
  rememberWhatsAppCache,
} from "@cc/storage";
import { ensureBackgroundWorkersRunning } from "@cc/workers";

export interface ConversationSummary {
  id: string;
  customerPhone: string;
  customerName: string;
  customerId: string | null;
  status: string;
  priority: string;
  smartCategory: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  escalationLevel: string;
  waitingSince: string | null;
  lastResponseSeconds: number | null;
  escalatedAt: string | null;
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageAt: string;
  lastMessageDirection: string | null;
  lastMessageStatus: string | null;
  windowExpiresAt: string | null;
  resolutionSummary: string | null;
  resolvedByName: string | null;
  tags: string[];
  collaborators: ConversationCollaborator[];
}

export interface QuotedMessageRef {
  messageId?: string | null;
  waMessageId?: string | null;
  senderName: string;
  senderType?: string;
  direction?: string;
  body: string;
}

export interface ChatMessage {
  id: string;
  direction: string;
  senderType: string;
  senderName: string;
  messageType: string;
  billingCategory: string;
  body: string;
  templateName: string | null;
  waMessageId?: string | null;
  deliveryStatus: string;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface ConversationAssignmentItem {
  id: string;
  conversationId: string;
  fromStaffId: string | null;
  fromStaffName: string | null;
  fromTeamName: string | null;
  toStaffId: string | null;
  toStaffName: string;
  toTeamId: string | null;
  toTeamName: string;
  escalationLevel: string;
  assignmentSource: string;
  assignedByName: string;
  reason: string;
  assignedAt: string;
  firstResponseAt: string | null;
  firstResponseSeconds: number | null;
  firstResponseMessageId: string | null;
  endedAt: string | null;
  outcome: string;
}

export interface CustomerProfile {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  companyName: string | null;
  organizationType: string;
  city: string | null;
  gstNumber: string | null;
  acrioSegment: string;
  lifetimeValueInr: number;
  totalOrdersCount: number;
  notes: string;
  preferredStaffId?: string | null;
  preferredStaffName?: string | null;
  tags?: string[];
}

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  itemsSummary: string;
  quantity: number;
  totalAmountInr: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  invoiceUrl: string | null;
  orderedAt: string;
}

export interface CustomerRelation {
  id: string;
  relationType: string;
  summary: string;
  handledBy: string;
  occurredAt: string;
}

export interface WebsiteEnquiry {
  id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  source: string;
  status: string;
  createdAt: string;
}

export interface AcrioRecommendedItem {
  name: string;
  slug: string;
  sku: string | null;
  priceInr: number | null;
  url: string;
  brand?: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  brandLabel?: string;
  itemType?: "PRODUCT" | "MACHINE" | "CONSUMABLE";
  modelsSummary?: string | null;
}

export interface AcrioCopilot {
  engineLabel: string;
  smartCategory: string;
  priority: string;
  suggestedReplies: string[];
  recommendedProducts: AcrioRecommendedItem[];
  resolutionDraft: string;
}

export interface TeamOption {
  id: string;
  name: string;
  brandScope: string;
  priorityRank: number;
  p0WaitMinutes: number;
  p1WaitMinutes: number;
}

export interface StaffOption {
  id: string;
  name: string;
  role: string;
  department: string;
}

export interface TemplateVariableSpecOption {
  index: number;
  label: string;
  sourceField: string;
  sampleValue: string;
}

export interface ApprovedTemplateOption {
  id: string;
  name: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  headerText: string | null;
  headerType: string;
  bodyText: string;
  footerText: string | null;
  ctaUrl: string | null;
  buttons: { type: string; text: string }[];
  variablesSchema: TemplateVariableSpecOption[];
}

export interface CustomLinkItem {
  id: string;
  code: string;
  title: string;
  targetUrl: string;
  utmCampaign?: string | null;
  clicksCount: number;
}

export interface VerifiedCompanyLocation {
  placeName: string;
  address: string;
  businessHours: string;
  phone: string;
  mapsUrl: string;
  latitude: number;
  longitude: number;
}

export interface ConversationDetailBundle {
  conversation: {
    id: string;
    customerPhone: string;
    customerName: string;
    status: string;
    priority: string;
    smartCategory: string;
    assignedStaffId: string | null;
    assignedStaffName: string | null;
    assignedTeamId: string | null;
    assignedTeamName: string | null;
    escalationLevel: string;
    waitingSince: string | null;
    lastResponseSeconds: number | null;
    escalatedAt: string | null;
    resolutionSummary: string | null;
    resolvedByName: string | null;
    windowExpiresAt: string | null;
    collaborators: ConversationCollaborator[];
  };
  messages: ChatMessage[];
  hasOlderMessages?: boolean;
  oldestMessageCursor?: string | null;
  assignments?: ConversationAssignmentItem[];
  customer: CustomerProfile | null;
  orders: CustomerOrder[];
  orderTrackings?: OrderTrackingRecord[];
  relations: CustomerRelation[];
  websiteEnquiries: WebsiteEnquiry[];
  acrio: AcrioCopilot | null;
  customLinks: CustomLinkItem[];
  verifiedLocation?: VerifiedCompanyLocation;
}

export interface QuickReplyItem {
  id: string;
  staffId: string;
  staffName: string;
  cmd: string;
  title: string;
  body: string;
  isShared: boolean;
  isMine: boolean;
}

export interface InitialInboxPayload {
  currentUserId: string;
  currentUserName: string;
  currentUserRole: UserRole;
  serverNowMs: number;
  threads: ConversationSummary[];
  initialSelectedId: string | null;
  initialDetail: ConversationDetailBundle | null;
  teams: TeamOption[];
  staffList: StaffOption[];
  templates: ApprovedTemplateOption[];
  quickReplies: QuickReplyItem[];
}

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

  const [msgRes, assignRes, custRes, ordersRes, relationsRes, customLinks, orderTrackings, liveBrandInfo] =
    await Promise.all([
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
  const trimmedMsgRows = hasOlderMessages ? rawMsgRows.slice(rawMsgRows.length - 250) : rawMsgRows;

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

  // Never invoke ACRIO on UI chat loads/polls - ACRIO only runs in the backend when assigned to System (ACRIO)
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
      assignedStaffName: cRow.assigned_staff_name ? String(cRow.assigned_staff_name) : null,
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

export async function getInitialInboxPayload(params: {
  userId: string;
  userName: string;
  userRole: UserRole;
  selectedConversationId?: string;
}): Promise<InitialInboxPayload> {
  await ensureDatabasesBootstrapped();
  ensureBackgroundWorkersRunning();

  const conv = getRawLibSqlClient("conversations");
  const auth = getRawLibSqlClient("core_auth");
  const mkt = getRawLibSqlClient("marketing");

  const [threadsRes, teamsRes, staffRes, templatesRes, quickRepliesRes] =
    await Promise.all([
      conv.execute(
        `SELECT c.*,
           COALESCE(
             c.last_message_direction,
             (
               SELECT m.direction FROM messages m
               WHERE m.conversation_id = c.id AND m.direction IN ('INBOUND', 'OUTBOUND')
               ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1
             )
           ) AS resolved_last_dir,
           COALESCE(
             c.last_message_status,
             (
               SELECT m.delivery_status FROM messages m
               WHERE m.conversation_id = c.id AND m.direction IN ('INBOUND', 'OUTBOUND')
               ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1
             )
           ) AS resolved_last_status
         FROM conversations c
         ORDER BY
           CASE WHEN c.status != 'RESOLVED' AND c.waiting_since IS NOT NULL THEN 0
                WHEN c.status != 'RESOLVED' THEN 1
                ELSE 2 END,
           c.last_message_at DESC
         LIMIT 400`
      ),
      conv.execute(`SELECT * FROM teams ORDER BY priority_rank ASC, name ASC`),
      auth.execute(
        `SELECT id, name, role, department
         FROM users
         WHERE status = 'ACTIVE' AND role != 'CLIENT'
         ORDER BY name ASC`
      ),
      mkt.execute(
        `SELECT id, name, category, language, header_text, header_type, body_text, footer_text, cta_url, buttons_json, variables_schema_json
         FROM templates
         WHERE approval_status = 'APPROVED'
         ORDER BY category ASC, name ASC`
      ),
      conv
        .execute({
          sql: `SELECT * FROM staff_quick_replies WHERE staff_id = ? OR is_shared = 1 ORDER BY usage_count DESC, updated_at DESC`,
          args: [params.userId],
        })
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    ]);

  const threads: ConversationSummary[] = threadsRes.rows.map((r) => {
    const cid = String(r.id);
    return {
      id: cid,
      customerPhone: String(r.customer_phone),
      customerName: String(r.customer_name),
      customerId: r.customer_id ? String(r.customer_id) : null,
      status: String(r.status),
      priority: String(r.priority),
      smartCategory: String(r.smart_category),
      assignedStaffId: r.assigned_staff_id ? String(r.assigned_staff_id) : null,
      assignedStaffName: r.assigned_staff_name
        ? String(r.assigned_staff_name)
        : null,
      assignedTeamId: r.assigned_team_id ? String(r.assigned_team_id) : null,
      assignedTeamName: r.assigned_team_name
        ? String(r.assigned_team_name)
        : null,
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
      lastMessageDirection: r.resolved_last_dir ? String(r.resolved_last_dir) : null,
      lastMessageStatus: r.resolved_last_status ? String(r.resolved_last_status) : null,
      windowExpiresAt: r.window_expires_at ? String(r.window_expires_at) : null,
      resolutionSummary: r.resolution_summary
        ? String(r.resolution_summary)
        : null,
      resolvedByName: r.resolved_by_name ? String(r.resolved_by_name) : null,
      tags: (() => {
        try {
          return JSON.parse(String(r.tags_json || "[]"));
        } catch {
          return [];
        }
      })(),
      collaborators: parseConversationCollaborators(r.collaborators_json),
    };
  });

  const teams: TeamOption[] = teamsRes.rows.map((t) => ({
    id: String(t.id),
    name: String(t.name),
    brandScope: String(t.brand_scope || "ALL"),
    priorityRank: Number(t.priority_rank ?? 10),
    p0WaitMinutes: Number(t.p0_wait_minutes ?? 5),
    p1WaitMinutes: Number(t.p1_wait_minutes ?? 12),
  }));

  const allowDevAssign = canAssignToDev(params.userRole);
  const staffList: StaffOption[] = staffRes.rows
    .filter(
      (s) =>
        String(s.role) !== "DEV" ||
        allowDevAssign ||
        String(s.id) === params.userId
    )
    .map((s) => ({
      id: String(s.id),
      name: String(s.name),
      role: String(s.role),
      department: String(s.department || "Operations"),
    }));

  const templates: ApprovedTemplateOption[] = templatesRes.rows.map((tpl) => {
    const rawCat = String(tpl.category || "UTILITY");
    const category: "MARKETING" | "UTILITY" | "AUTHENTICATION" =
      rawCat === "MARKETING" || rawCat === "AUTHENTICATION" ? rawCat : "UTILITY";
    let buttons: { type: string; text: string }[] = [];
    try {
      const parsed = JSON.parse(String(tpl.buttons_json || "[]"));
      if (Array.isArray(parsed)) {
        buttons = parsed
          .map((b: Record<string, unknown>) => ({ type: String(b.type || ""), text: String(b.text || "") }))
          .filter((b) => b.text);
      }
    } catch {
      buttons = [];
    }
    let variablesSchema: TemplateVariableSpecOption[] = [];
    try {
      const parsed = JSON.parse(String(tpl.variables_schema_json || "[]"));
      if (Array.isArray(parsed)) {
        variablesSchema = parsed.map((v: Record<string, unknown>) => ({
          index: Number(v.index),
          label: String(v.label || ""),
          sourceField: String(v.sourceField || "custom"),
          sampleValue: String(v.sampleValue || ""),
        }));
      }
    } catch {
      variablesSchema = [];
    }
    return {
      id: String(tpl.id),
      name: String(tpl.name),
      category,
      language: String(tpl.language || "en"),
      headerText: tpl.header_text ? String(tpl.header_text) : null,
      headerType: String(tpl.header_type || "NONE"),
      bodyText: String(tpl.body_text || ""),
      footerText: tpl.footer_text ? String(tpl.footer_text) : null,
      ctaUrl: tpl.cta_url ? String(tpl.cta_url) : null,
      buttons,
      variablesSchema,
    };
  });

  const quickReplies: QuickReplyItem[] = quickRepliesRes.rows.map((qr) => ({
    id: String(qr.id),
    staffId: String(qr.staff_id),
    staffName: String(qr.staff_name || ""),
    cmd: String(qr.cmd),
    title: String(qr.title),
    body: String(qr.body),
    isShared: Number(qr.is_shared ?? 0) === 1,
    isMine: String(qr.staff_id) === params.userId,
  }));

  const mineFirst = threads.find(
    (t) =>
      t.assignedStaffId === params.userId ||
      t.collaborators.some((c) => c.staffId === params.userId)
  );
  const preferredId =
    params.selectedConversationId &&
    threads.some((t) => t.id === params.selectedConversationId)
      ? params.selectedConversationId
      : mineFirst?.id || threads[0]?.id || null;

  const initialDetail = preferredId
    ? await getConversationDetailServer(preferredId, true)
    : null;

  if (preferredId) {
    const target = threads.find((t) => t.id === preferredId);
    if (target) target.unreadCount = 0;
  }

  return {
    currentUserId: params.userId,
    currentUserName: params.userName,
    currentUserRole: params.userRole,
    serverNowMs: Date.now(),
    threads,
    initialSelectedId: preferredId,
    initialDetail,
    teams,
    staffList,
    templates,
    quickReplies,
  };
}

export async function getInitialTeamsPayload(canManage: boolean) {
  await ensureDatabasesBootstrapped();
  ensureBackgroundWorkersRunning();

  const conv = getRawLibSqlClient("conversations");
  const auth = getRawLibSqlClient("core_auth");

  const [teamsRes, membersRes, staffRes, activeLoadsRes, catalog, aiKey] =
    await Promise.all([
      conv.execute(`SELECT * FROM teams ORDER BY priority_rank ASC, name ASC`),
      conv.execute(
        `SELECT * FROM team_members
         ORDER BY CASE tier WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 ELSE 3 END ASC, staff_name ASC`
      ),
      auth.execute(
        `SELECT id, name, email, whatsapp_number, role, department
         FROM users
         WHERE status = 'ACTIVE' AND role NOT IN ('CLIENT', 'DEV')
         ORDER BY name ASC`
      ),
      conv.execute(
        `SELECT assigned_staff_id, assigned_team_id, waiting_since
         FROM conversations
         WHERE status != 'RESOLVED'`
      ),
      getCachedEcosystemCatalog(),
      resolveSharedAnthropicApiKey(),
    ]);

  const loadByStaff = new Map<string, number>();
  const waitingByTeam = new Map<string, number>();
  for (const r of activeLoadsRes.rows) {
    if (r.assigned_staff_id) {
      const sid = String(r.assigned_staff_id);
      loadByStaff.set(sid, (loadByStaff.get(sid) || 0) + 1);
    }
    if (r.assigned_team_id && r.waiting_since) {
      const tid = String(r.assigned_team_id);
      waitingByTeam.set(tid, (waitingByTeam.get(tid) || 0) + 1);
    }
  }

  const members = membersRes.rows.map((m) => ({
    id: String(m.id),
    teamId: String(m.team_id),
    staffId: String(m.staff_id),
    staffName: String(m.staff_name),
    staffEmail: String(m.staff_email || ""),
    tier: (String(m.tier || "P0") as "P0" | "P1" | "P2"),
    maxActiveChats: Number(m.max_active_chats ?? 8),
    isAvailable: Number(m.is_available ?? 1) === 1,
    activeOpenChats: loadByStaff.get(String(m.staff_id)) || 0,
  }));

  const teams = teamsRes.rows.map((t) => {
    const id = String(t.id);
    return {
      id,
      name: String(t.name),
      description: String(t.description || ""),
      brandScope: String(t.brand_scope || "ALL"),
      routingKeywords: String(t.routing_keywords || ""),
      priorityRank: Number(t.priority_rank ?? 10),
      p0WaitMinutes: Number(t.p0_wait_minutes ?? 5),
      p1WaitMinutes: Number(t.p1_wait_minutes ?? 12),
      autoAssignEnabled: Number(t.auto_assign_enabled ?? 1) === 1,
      waitingChatsCount: waitingByTeam.get(id) || 0,
      members: members.filter((m) => m.teamId === id),
    };
  });

  const activeStaff = staffRes.rows.map((s) => ({
    id: String(s.id),
    name: String(s.name),
    email: String(s.email),
    whatsappNumber: String(s.whatsapp_number),
    role: String(s.role),
    department: String(s.department || "Operations"),
    activeOpenChats: loadByStaff.get(String(s.id)) || 0,
  }));

  const cacheSummary = getWhatsAppCacheSummary();

  return {
    canManage,
    teams,
    activeStaff,
    syncInfo: {
      classicConceptsCount: catalog.classicConceptsProducts.length,
      classicEdgeMachinesCount: catalog.classicEdgeItems.filter((i) => i.itemType === "MACHINE").length,
      classicEdgeConsumablesCount: catalog.classicEdgeItems.filter((i) => i.itemType === "CONSUMABLE").length,
      lastSyncedAt: cacheSummary.lastSyncedAt,
      aiConnected: Boolean(aiKey.apiKey),
      aiKeySource: aiKey.source,
      aiMaskedKey: aiKey.apiKey
        ? `${aiKey.apiKey.slice(0, 10)}...${aiKey.apiKey.slice(-4)}`
        : "",
    },
  };
}
