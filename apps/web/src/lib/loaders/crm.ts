import type { AuthenticatedUser } from "@cc/auth";
import { getCachedEcosystemCatalog } from "@cc/connections";
import {
  ensureDatabasesBootstrapped,
  getMultiDatabaseDiagnostics,
  getRawLibSqlClient,
  listActiveNonClientStaff,
} from "@cc/database";
import { getQueueTelemetry } from "@cc/queue";
import { hasPermission, isDevRole, isSuperAdminCapable } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import { listCustomAdminLinks } from "@cc/storage";
import {
  buildMetaGraphTemplatePayload,
  type WhatsAppHeaderType,
  type WhatsAppTemplateButton,
  type WhatsAppTemplateCategory,
  type WhatsAppTemplateDefinition,
  type WhatsAppTemplateLocation,
  type WhatsAppTemplateVariableSpec,
} from "@cc/connections";
import {
  ensureBackgroundWorkersRunning,
  getBroadcastQueueSettings,
  processMarketingBroadcastQueue,
} from "@cc/workers";

function parseJsonArray(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

export async function loadContactsPayload(
  user: AuthenticatedUser,
  filters?: {
    q?: string;
    stage?: string;
    optIn?: string;
    orgType?: string;
    source?: string;
    groupId?: string;
    tag?: string;
    sort?: string;
  }
) {
  await ensureDatabasesBootstrapped();
  const contactsDb = getRawLibSqlClient("contacts");
  const convDb = getRawLibSqlClient("conversations");
  const crmDb = getRawLibSqlClient("crm_orders");
  const mktDb = getRawLibSqlClient("marketing");

  const q = (filters?.q || "").trim().toLowerCase();
  const stageFilter = (filters?.stage || "ALL").trim();
  const optInFilter = (filters?.optIn || "ALL").trim();
  const orgFilter = (filters?.orgType || "ALL").trim();
  const sourceFilter = (filters?.source || "ALL").trim();
  const groupFilter = (filters?.groupId || "ALL").trim();
  const tagFilter = (filters?.tag || "ALL").trim();
  const sortBy = (filters?.sort || "recent").trim();

  const [contactsRes, groupsRes, logsRes, convRes, msgCntRes, listsRes, ordersAggRes, allStaff] =
    await Promise.all([
      contactsDb.execute(`SELECT * FROM contacts ORDER BY updated_at DESC`),
      contactsDb.execute(`SELECT * FROM contact_groups ORDER BY name ASC`),
      contactsDb.execute(`SELECT * FROM contact_import_logs ORDER BY created_at DESC LIMIT 10`),
      convDb.execute(
        `SELECT id, customer_phone, status, unread_count, last_message_at, window_expires_at, assigned_staff_name, assigned_team_name
         FROM conversations`
      ),
      convDb.execute(
        `SELECT c.customer_phone as phone, COUNT(m.id) as cnt
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id AND m.direction IN ('INBOUND', 'OUTBOUND')
         GROUP BY c.customer_phone`
      ),
      mktDb.execute(`SELECT id, name, members_count FROM marketing_lists ORDER BY updated_at DESC`),
      crmDb.execute(
        `SELECT customer_phone as phone, COUNT(*) as orders_cnt, COALESCE(SUM(total_amount_inr), 0) as total_inr
         FROM customer_orders
         GROUP BY customer_phone`
      ),
      listActiveNonClientStaff(),
    ]);

  const nowMs = Date.now();
  const convByPhone = new Map<
    string,
    {
      id: string;
      status: string;
      unreadCount: number;
      lastMessageAt: string;
      windowOpen: boolean;
      assignedTo: string;
    }
  >();
  for (const c of convRes.rows) {
    const ph = String(c.customer_phone || "");
    const exp = c.window_expires_at ? new Date(String(c.window_expires_at)).getTime() : 0;
    convByPhone.set(ph, {
      id: String(c.id),
      status: String(c.status),
      unreadCount: Number(c.unread_count ?? 0),
      lastMessageAt: String(c.last_message_at),
      windowOpen: exp > nowMs,
      assignedTo: String(c.assigned_staff_name || c.assigned_team_name || "System"),
    });
  }

  const msgCountByPhone = new Map<string, number>();
  for (const m of msgCntRes.rows) {
    msgCountByPhone.set(String(m.phone || ""), Number(m.cnt ?? 0));
  }

  const ordersByPhone = new Map<string, { count: number; ltv: number }>();
  for (const o of ordersAggRes.rows) {
    ordersByPhone.set(String(o.phone || ""), {
      count: Number(o.orders_cnt ?? 0),
      ltv: Number(o.total_inr ?? 0),
    });
  }

  const groupMemberCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  let optedInCount = 0;
  let optedOutCount = 0;
  let customersCount = 0;
  let repeatAndVipCount = 0;
  let totalLifetimeValueInr = 0;
  let withActiveChatCount = 0;

  const allContacts = contactsRes.rows.map((r) => {
    const phone = String(r.phone);
    const tags = parseJsonArray(r.tags_json);
    const groups = parseJsonArray(r.groups_json);
    const convInfo = convByPhone.get(phone) || null;
    const ordAgg = ordersByPhone.get(phone);

    const totalOrdersCount = Math.max(
      Number(r.total_orders_count ?? 0),
      ordAgg?.count ?? 0
    );
    const lifetimeValueInr = Math.max(
      Number(r.lifetime_value_inr ?? 0),
      ordAgg?.ltv ?? 0
    );
    const totalMessagesCount = Math.max(
      Number(r.total_messages_count ?? 0),
      msgCountByPhone.get(phone) ?? 0
    );
    const optInMarketing = Number(r.opt_in_marketing ?? 1) === 1;
    const stage = String(r.stage || "NEW_LEAD");

    if (optInMarketing) optedInCount++;
    else optedOutCount++;

    if (totalOrdersCount > 0 || ["CUSTOMER", "REPEAT_BUYER", "VIP"].includes(stage)) {
      customersCount++;
    }
    if (stage === "REPEAT_BUYER" || stage === "VIP" || totalOrdersCount >= 2) {
      repeatAndVipCount++;
    }
    if (convInfo) withActiveChatCount++;
    totalLifetimeValueInr += lifetimeValueInr;

    for (const gid of groups) {
      groupMemberCounts.set(gid, (groupMemberCounts.get(gid) || 0) + 1);
    }
    for (const t of tags) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }

    const lastContactedAt =
      convInfo?.lastMessageAt &&
      (!r.last_contacted_at || convInfo.lastMessageAt > String(r.last_contacted_at))
        ? convInfo.lastMessageAt
        : r.last_contacted_at
        ? String(r.last_contacted_at)
        : String(r.updated_at);

    return {
      id: String(r.id),
      phone,
      whatsappName: String(r.whatsapp_name || ""),
      name: String(r.name || phone),
      email: String(r.email || ""),
      companyName: String(r.company_name || ""),
      designation: String(r.designation || ""),
      organizationType: String(r.organization_type || "Business"),
      city: String(r.city || ""),
      state: String(r.state || ""),
      country: String(r.country || "India"),
      gstNumber: String(r.gst_number || ""),
      source: String(r.source || "MANUAL"),
      stage,
      acrioSegment: String(r.acrio_segment || "Active Prospect"),
      tags,
      groups,
      optInMarketing,
      optOutReason: String(r.opt_out_reason || ""),
      assignedOwnerName: String(r.assigned_owner_name || convInfo?.assignedTo || ""),
      preferredStaffId: r.preferred_staff_id
        ? String(r.preferred_staff_id)
        : r.assigned_owner_id
        ? String(r.assigned_owner_id)
        : null,
      preferredStaffName: String(
        r.preferred_staff_name || r.assigned_owner_name || ""
      ),
      lifetimeValueInr,
      totalOrdersCount,
      totalMessagesCount,
      notes: String(r.notes || ""),
      lastContactedAt,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      conversationId: convInfo?.id || null,
      chatStatus: convInfo?.status || null,
      unreadCount: convInfo?.unreadCount ?? 0,
      windowOpen: convInfo?.windowOpen ?? false,
    };
  });

  let filtered = allContacts.filter((c) => {
    if (stageFilter !== "ALL") {
      if (stageFilter === "BUYERS_ALL") {
        if (
          c.totalOrdersCount === 0 &&
          !["CUSTOMER", "REPEAT_BUYER", "VIP"].includes(c.stage)
        ) {
          return false;
        }
      } else if (c.stage !== stageFilter) {
        return false;
      }
    }
    if (optInFilter === "OPTED_IN" && !c.optInMarketing) return false;
    if (optInFilter === "OPTED_OUT" && c.optInMarketing) return false;
    if (orgFilter !== "ALL" && c.organizationType !== orgFilter) return false;
    if (sourceFilter !== "ALL" && c.source !== sourceFilter) return false;
    if (groupFilter !== "ALL" && !c.groups.includes(groupFilter)) return false;
    if (tagFilter !== "ALL" && !c.tags.includes(tagFilter)) return false;

    if (q) {
      const hay = [
        c.name,
        c.whatsappName,
        c.phone,
        c.email,
        c.companyName,
        c.designation,
        c.organizationType,
        c.city,
        c.state,
        c.gstNumber,
        c.acrioSegment,
        c.notes,
        ...c.tags,
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered = [...filtered].sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    if (sortBy === "ltv") return b.lifetimeValueInr - a.lifetimeValueInr;
    if (sortBy === "orders") return b.totalOrdersCount - a.totalOrdersCount;
    if (sortBy === "created") return b.createdAt.localeCompare(a.createdAt);
    return (b.lastContactedAt || "").localeCompare(a.lastContactedAt || "");
  });

  return {
    ok: true as const,
    permissions: {
      canManage: hasPermission(user.role, "contacts:manage", user.status),
      canDelete: hasPermission(user.role, "contacts:delete", user.status),
      canManageLists: hasPermission(user.role, "marketing:manage_lists", user.status),
    },
    kpis: {
      totalContacts: allContacts.length,
      optedInCount,
      optedOutCount,
      optInRatePct:
        allContacts.length > 0
          ? Math.round((optedInCount / allContacts.length) * 100)
          : 0,
      customersCount,
      repeatAndVipCount,
      totalLifetimeValueInr,
      withActiveChatCount,
    },
    groups: groupsRes.rows.map((g) => ({
      id: String(g.id),
      name: String(g.name),
      description: String(g.description || ""),
      color: String(g.color || "emerald"),
      membersCount: groupMemberCounts.get(String(g.id)) ?? 0,
    })),
    allTags: Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    marketingLists: listsRes.rows.map((l) => ({
      id: String(l.id),
      name: String(l.name),
      membersCount: Number(l.members_count ?? 0),
    })),
    importLogs: logsRes.rows.map((l) => ({
      id: String(l.id),
      sourceLabel: String(l.source_label),
      importedCount: Number(l.imported_count ?? 0),
      updatedCount: Number(l.updated_count ?? 0),
      skippedCount: Number(l.skipped_count ?? 0),
      importedByName: String(l.imported_by_name),
      createdAt: String(l.created_at),
    })),
    staffList: allStaff.filter((s) => s.role !== "DEV" || user.role === "DEV"),
    contacts: filtered,
  };
}

export async function loadMarketingPayload(user: AuthenticatedUser) {
  await ensureDatabasesBootstrapped();
  ensureBackgroundWorkersRunning();
  await processMarketingBroadcastQueue().catch(() => {});

  const mkt = getRawLibSqlClient("marketing");
  const bill = getRawLibSqlClient("billing_ops");
  await getCachedEcosystemCatalog().catch(() => null);
  const [tplRes, listRes, bcRes, links, pricingRes, queueSettings] =
    await Promise.all([
      mkt.execute(`SELECT * FROM templates ORDER BY created_at DESC`),
      mkt.execute(`SELECT * FROM marketing_lists ORDER BY updated_at DESC`),
      mkt.execute(`SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 50`),
      listCustomAdminLinks(),
      bill.execute(`SELECT * FROM pricing_config WHERE id = 'default' LIMIT 1`),
      getBroadcastQueueSettings(),
    ]);

  const pRow = (pricingRes.rows[0] || {}) as Record<string, unknown>;
  const clientMarketingRateInr = Number(pRow.client_marketing_rate_inr ?? 0.95);
  const clientOtherRateInr = Number(pRow.client_other_rate_inr ?? 0.3);

  return {
    ok: true as const,
    canManageTemplates: hasPermission(user.role, "templates:manage", user.status),
    canSendBroadcasts: hasPermission(
      user.role,
      "marketing:send_broadcasts",
      user.status
    ),
    rates: {
      marketingRateInr: clientMarketingRateInr,
      otherRateInr: clientOtherRateInr,
    },
    queueSettings,
    templates: tplRes.rows.map((t) => ({
      id: String(t.id),
      name: String(t.name),
      language: String(t.language || "en"),
      category: String(t.category),
      headerType: String(t.header_type || (t.header_text ? "TEXT" : "NONE")),
      headerText: t.header_text ? String(t.header_text) : null,
      bodyText: String(t.body_text),
      footerText: t.footer_text ? String(t.footer_text) : null,
      ctaLabel: t.cta_label ? String(t.cta_label) : null,
      ctaUrl: t.cta_url ? String(t.cta_url) : null,
      approvalStatus: String(t.approval_status),
      sentCount: Number(t.sent_count ?? 0),
    })),
    lists: listRes.rows.map((l) => ({
      id: String(l.id),
      name: String(l.name),
      description: String(l.description),
      sourceType: String(l.source_type),
      acrioPrompt: l.acrio_prompt ? String(l.acrio_prompt) : null,
      membersCount: Number(l.members_count ?? 0),
      memberPhones: parseJsonArray(l.member_phones_json),
      createdByName: String(l.created_by_name),
      updatedAt: String(l.updated_at),
    })),
    broadcasts: bcRes.rows.map((b) => ({
      id: String(b.id),
      name: String(b.name),
      listName: String(b.list_name),
      templateName: String(b.template_name),
      billingCategory: String(b.billing_category),
      status: String(b.status),
      pacingMode: String(b.pacing_mode || "SAFE_STEADY"),
      delaySeconds: Number(b.delay_seconds ?? 4),
      batchSize: Number(b.batch_size ?? 25),
      batchPauseSeconds: Number(b.batch_pause_seconds ?? 20),
      totalRecipients: Number(b.total_recipients ?? 0),
      queuedCount: Number(b.queued_count ?? 0),
      skippedCount: Number(b.skipped_count ?? 0),
      failedCount: Number(b.failed_count ?? 0),
      sentCount: Number(b.sent_count ?? 0),
      deliveredCount: Number(b.delivered_count ?? 0),
      readCount: Number(b.read_count ?? 0),
      pausedReason: b.paused_reason ? String(b.paused_reason) : null,
      scheduledFor: b.scheduled_for ? String(b.scheduled_for) : null,
      nextDispatchAt: b.next_dispatch_at ? String(b.next_dispatch_at) : null,
      completedAt: b.completed_at ? String(b.completed_at) : null,
      clientBilledInr: Number(b.client_billed_inr ?? 0),
      createdByName: String(b.created_by_name),
      createdAt: String(b.created_at),
    })),
    customLinks: links,
  };
}

export async function loadTemplatesPayload(user: AuthenticatedUser) {
  await ensureDatabasesBootstrapped();
  const mkt = getRawLibSqlClient("marketing");
  const bill = getRawLibSqlClient("billing_ops");
  const conv = getRawLibSqlClient("conversations");

  const [catalog, tplRes, pricingRes, customLinks, teamsRes] = await Promise.all([
    getCachedEcosystemCatalog().catch(() => ({
      classicConceptsProducts: [],
      classicEdgeItems: [],
      allItems: [],
    })),
    mkt.execute(`SELECT * FROM templates ORDER BY COALESCE(updated_at, created_at) DESC`),
    bill.execute(`SELECT * FROM pricing_config WHERE id = 'default' LIMIT 1`),
    listCustomAdminLinks(),
    conv.execute(`SELECT id, name FROM teams ORDER BY priority_rank ASC, name ASC`),
  ]);

  const pRow = (pricingRes.rows[0] || {}) as Record<string, unknown>;
  const marketingRateInr = Number(pRow.client_marketing_rate_inr ?? 0.95);
  const otherRateInr = Number(pRow.client_other_rate_inr ?? 0.3);

  const templates = tplRes.rows.map((t) => {
    const buttons = parseJsonSafe<WhatsAppTemplateButton[]>(t.buttons_json, []);
    const variablesSchema = parseJsonSafe<WhatsAppTemplateVariableSpec[]>(
      t.variables_schema_json,
      []
    );
    const headerLocation = parseJsonSafe<WhatsAppTemplateLocation | null>(
      t.header_location_json,
      null
    );
    const category = String(t.category || "MARKETING") as WhatsAppTemplateCategory;
    const headerType = String(
      t.header_type || (t.header_text ? "TEXT" : "NONE")
    ) as WhatsAppHeaderType;

    const def: WhatsAppTemplateDefinition = {
      id: String(t.id),
      name: String(t.name),
      language: String(t.language || "en"),
      category,
      headerType,
      headerText: t.header_text ? String(t.header_text) : null,
      headerMediaUrl: t.header_media_url ? String(t.header_media_url) : null,
      headerLocation,
      bodyText: String(t.body_text || ""),
      footerText: t.footer_text ? String(t.footer_text) : null,
      buttons,
      variablesSchema,
      allowCategoryChange: Number(t.allow_category_change ?? 1) === 1,
      codeExpirationMinutes: t.code_expiration_minutes
        ? Number(t.code_expiration_minutes)
        : null,
    };

    return {
      ...def,
      id: String(t.id),
      ctaLabel: t.cta_label ? String(t.cta_label) : null,
      ctaUrl: t.cta_url ? String(t.cta_url) : null,
      approvalStatus: String(t.approval_status || "APPROVED"),
      metaTemplateId: t.meta_template_id ? String(t.meta_template_id) : null,
      metaQualityScore: String(t.meta_quality_score || "GREEN"),
      rejectionReason: t.rejection_reason ? String(t.rejection_reason) : null,
      sentCount: Number(t.sent_count ?? 0),
      createdByName: String(t.created_by_name || "System"),
      createdAt: String(t.created_at),
      updatedAt: String(t.updated_at || t.created_at),
      metaPayloadPreview: buildMetaGraphTemplatePayload(def),
    };
  });

  const catalogMediaItems = catalog.allItems
    .filter((i) => Boolean(i.mainImage))
    .slice(0, 24)
    .map((i) => {
      const rawImg = String(i.mainImage || "");
      const origin =
        i.brand === "CLASSIC_EDGE_53"
          ? "https://www.classicedge53.com"
          : "https://www.classicconcepts.in";
      const imageUrl = /^https?:\/\//i.test(rawImg)
        ? rawImg
        : `${origin}${rawImg.startsWith("/") ? "" : "/"}${rawImg}`;
      return {
        name: i.name,
        brandLabel: i.brandLabel,
        url: i.url,
        imageUrl,
      };
    });

  return {
    ok: true as const,
    canManage: hasPermission(user.role, "templates:manage", user.status),
    isDev: isDevRole(user.role),
    isSuperAdmin: isSuperAdminCapable(user.role),
    currentUserRole: user.role,
    rates: {
      marketingRateInr,
      otherRateInr,
    },
    templates,
    customLinks,
    catalogMediaItems,
    teams: teamsRes.rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
    })),
  };
}

export async function loadDevBackupsPayload() {
  await ensureDatabasesBootstrapped();
  const bill = getRawLibSqlClient("billing_ops");

  const [databases, queue, cfgRes, logsRes] = await Promise.all([
    getMultiDatabaseDiagnostics(),
    getQueueTelemetry(),
    bill.execute(`SELECT * FROM backup_settings WHERE id = 'default' LIMIT 1`),
    bill.execute(`SELECT * FROM backup_logs ORDER BY started_at DESC LIMIT 12`),
  ]);

  const cfg = (cfgRes.rows[0] || {}) as Record<string, unknown>;

  return {
    ok: true as const,
    databases,
    queue,
    socketsConnected: socketHub.getConnectedCount(),
    recentEvents: socketHub.getRecentEvents(10),
    backupConfig: {
      enabled: Number(cfg.enabled ?? 1) === 1,
      midnightHourIst: Number(cfg.midnight_hour_ist ?? 0),
      midnightMinuteIst: Number(cfg.midnight_minute_ist ?? 0),
      timezone: String(cfg.timezone || "Asia/Kolkata"),
      googleDriveFolderId: String(cfg.google_drive_folder_id || ""),
      googleServiceAccountEmail: String(cfg.google_service_account_email || ""),
      hasPrivateKey: Boolean(String(cfg.google_private_key || "").trim()),
      hasOauthRefreshToken: Boolean(
        String(cfg.google_oauth_refresh_token || "").trim()
      ),
      googleClientId: String(cfg.google_client_id || ""),
      retentionDays: Number(cfg.retention_days ?? 30),
      includeMainWebsiteDb: Number(cfg.include_main_website_db ?? 1) === 1,
      lastRunAt: cfg.last_run_at ? String(cfg.last_run_at) : null,
      lastRunStatus: cfg.last_run_status ? String(cfg.last_run_status) : null,
    },
    backupLogs: logsRes.rows.map((l) => ({
      id: String(l.id),
      startedAt: String(l.started_at),
      completedAt: String(l.completed_at),
      triggerSource: String(l.trigger_source),
      status: String(l.status),
      databasesCount: Number(l.databases_count ?? 0),
      totalBytes: Number(l.total_bytes ?? 0),
      localFolderPath: String(l.local_folder_path),
      googleDriveFileId: l.google_drive_file_id ? String(l.google_drive_file_id) : null,
      googleDriveLink: l.google_drive_link ? String(l.google_drive_link) : null,
      detailsMessage: String(l.details_message),
    })),
  };
}
