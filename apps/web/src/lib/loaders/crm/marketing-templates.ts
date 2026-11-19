import type { AuthenticatedUser } from "@cc/auth";
import {
  buildMetaGraphTemplatePayload,
  getCachedEcosystemCatalog,
  type WhatsAppHeaderType,
  type WhatsAppTemplateButton,
  type WhatsAppTemplateCategory,
  type WhatsAppTemplateDefinition,
  type WhatsAppTemplateLocation,
  type WhatsAppTemplateVariableSpec,
} from "@cc/connections";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { hasPermission, isDevRole, isSuperAdminCapable } from "@cc/rbac";
import { listCustomAdminLinks } from "@cc/storage";
import {
  ensureBackgroundWorkersRunning,
  getBroadcastQueueSettings,
  processMarketingBroadcastQueue,
} from "@cc/workers";
import { parseJsonArray, parseJsonSafe } from "./helpers";

export async function loadMarketingPayload(user: AuthenticatedUser) {
  await ensureDatabasesBootstrapped();
  ensureBackgroundWorkersRunning();
  await processMarketingBroadcastQueue().catch(() => {});

  const mkt = getRawLibSqlClient("marketing");
  const bill = getRawLibSqlClient("billing_ops");
  const [tplRes, listRes, bcRes, links, pricingRes, queueSettings] =
    await Promise.all([
      mkt.execute(`SELECT * FROM templates ORDER BY created_at DESC`),
      mkt.execute(`SELECT * FROM marketing_lists ORDER BY updated_at DESC`),
      mkt.execute(`SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 50`),
      listCustomAdminLinks(),
      bill.execute(`SELECT * FROM pricing_config WHERE id = 'default' LIMIT 1`),
      getBroadcastQueueSettings(),
      getCachedEcosystemCatalog().catch(() => null),
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
