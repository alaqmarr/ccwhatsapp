import { type AuthenticatedUser } from "@cc/auth";
import {
  getCachedEcosystemCatalog,
  getClaudeUsageAndSpendComparison,
  runAcrioEcosystemIssuesIdentifier,
} from "@cc/connections";
import {
  checkEcosystemBridgesHealth,
  computePerformanceRankedStaff,
  ensureDatabasesBootstrapped,
  fetchLiveEcosystemDocuments,
  getRawLibSqlClient,
  listActiveNonClientStaff,
  listAiTrainingData,
  listCallDispatchQueue,
  listCompanyDocuments,
  listOrderTrackings,
  readAiTraceLogs,
  resolvePublicTrackingOrigin,
  SHIPPING_PROVIDERS,
  syncAndListEcosystemEnquiries,
} from "@cc/database";
import { hasPermission } from "@cc/rbac";

export async function loadAiLogsPayload(opts?: {
  website?: string;
  outcome?: string;
  cache?: string;
  search?: string;
  limit?: number;
}) {
  const limit = Number(opts?.limit ?? 150);
  const summary = readAiTraceLogs({
    website: opts?.website || "ALL",
    outcome: opts?.outcome || "ALL",
    cache: opts?.cache || "ALL",
    search: opts?.search || "",
    limit: Number.isFinite(limit) ? limit : 150,
  });
  return {
    ok: true as const,
    ...summary,
  };
}

export async function loadClaudeUsagePayload(opts?: {
  preset?: string;
  startingAt?: string | null;
  endingAt?: string | null;
  forceRefresh?: boolean;
}) {
  return getClaudeUsageAndSpendComparison({
    preset: opts?.preset || "mtd",
    startingAt: opts?.startingAt ?? null,
    endingAt: opts?.endingAt ?? null,
    forceRefresh: Boolean(opts?.forceRefresh),
  });
}

export async function loadIssuesIdentifierPayload(
  actorName: string,
  forceFresh = false
) {
  const report = await runAcrioEcosystemIssuesIdentifier({
    forceFreshCatalog: forceFresh,
    actorName,
  });
  return {
    ok: true as const,
    report,
  };
}

export async function loadTrackingPayload(opts?: {
  brand?: string;
  customerPhone?: string;
  query?: string;
  limit?: number;
}) {
  await ensureDatabasesBootstrapped();
  const trackings = await listOrderTrackings({
    brand: opts?.brand || "ALL",
    customerPhone: opts?.customerPhone || undefined,
    query: opts?.query || undefined,
    limit: opts?.limit ?? 300,
  });

  return {
    ok: true as const,
    trackingOrigin: resolvePublicTrackingOrigin(),
    providers: SHIPPING_PROVIDERS,
    trackings,
  };
}

export async function loadAutomationsPayload() {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const [res, teamsRes, mktRes] = await Promise.all([
    conv.execute(
      `SELECT * FROM automations ORDER BY COALESCE(priority_order, 10) ASC, created_at DESC`
    ),
    conv.execute(`SELECT id, name FROM teams ORDER BY priority_rank ASC`),
    getRawLibSqlClient("marketing").execute(
      `SELECT id, name, category, approval_status FROM templates WHERE approval_status = 'APPROVED' ORDER BY name ASC`
    ),
  ]);

  return {
    ok: true as const,
    teams: teamsRes.rows.map((t) => ({
      id: String(t.id),
      name: String(t.name),
    })),
    approvedTemplates: mktRes.rows.map((t) => ({
      id: String(t.id),
      name: String(t.name),
      category: String(t.category),
    })),
    automations: res.rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      description: String(r.description),
      triggerType: String(r.trigger_type),
      triggerCondition: String(r.trigger_condition),
      actionType: String(r.action_type),
      actionPayload: (() => {
        try {
          return JSON.parse(String(r.action_payload_json || "{}")) as Record<
            string,
            unknown
          >;
        } catch {
          return {};
        }
      })(),
      priorityOrder: Number(r.priority_order ?? 10),
      isEnabled: Number(r.is_enabled ?? 1) === 1,
      runsCount: Number(r.runs_count ?? 0),
      lastTriggeredAt: r.last_triggered_at ? String(r.last_triggered_at) : null,
      createdAt: String(r.created_at || ""),
    })),
  };
}

export async function loadCompanyDocumentsPayload() {
  await ensureDatabasesBootstrapped();
  const [documents, allEcosystemDocs] = await Promise.all([
    listCompanyDocuments(),
    fetchLiveEcosystemDocuments().catch(() => []),
  ]);
  const websiteDocuments = allEcosystemDocs.filter(
    (d) => d.source !== "HUB_UPLOAD"
  );
  return { ok: true as const, documents, websiteDocuments };
}

export async function loadAiTrainingPayload(user: AuthenticatedUser) {
  await ensureDatabasesBootstrapped();
  const [training, catalog, convRes, companyDocsPayload] = await Promise.all([
    listAiTrainingData(),
    getCachedEcosystemCatalog().catch(() => ({ allItems: [] as any[] })),
    getRawLibSqlClient("conversations")
      .execute(
        `SELECT m.id, m.conversation_id, m.body, m.created_at, c.customer_name
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.direction = 'INBOUND' AND m.message_type = 'TEXT'
         ORDER BY m.created_at DESC LIMIT 25`
      )
      .catch(() => ({ rows: [] as any[] })),
    loadCompanyDocumentsPayload(),
  ]);

  const products = catalog.allItems.slice(0, 300).map((it) => ({
    slug: it.slug,
    name: it.name,
    sku: it.sku,
    brandLabel: it.brandLabel,
    priceInr: it.basePrice,
  }));

  const recentCustomerQuestions = convRes.rows.map((r) => ({
    id: String(r.id),
    conversationId: String(r.conversation_id),
    customerName: String(r.customer_name || "Customer"),
    question: String(r.body || "").slice(0, 220),
    createdAt: String(r.created_at || ""),
  }));

  return {
    ok: true as const,
    canEdit:
      hasPermission(user.role, "acrio:manage_training", user.status) ||
      hasPermission(user.role, "automations:manage", user.status),
    examples: training.examples,
    rules: training.rules,
    products,
    recentCustomerQuestions,
    documents: companyDocsPayload.documents,
    websiteDocuments: companyDocsPayload.websiteDocuments,
  };
}

export async function loadCallQueuePayload(user: AuthenticatedUser) {
  await ensureDatabasesBootstrapped();
  const [items, rankedStaff, allStaff] = await Promise.all([
    listCallDispatchQueue(200),
    computePerformanceRankedStaff(),
    listActiveNonClientStaff(),
  ]);

  return {
    ok: true as const,
    currentUserId: user.id,
    items,
    rankedStaff,
    staffList: allStaff.filter((s) => s.role !== "DEV" || user.role === "DEV"),
  };
}

export async function loadEnquiriesPayload(opts?: {
  brand?: "ALL" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  status?: "ALL" | "New" | "Replied";
  search?: string;
  limit?: number;
}) {
  await ensureDatabasesBootstrapped();
  const brand = opts?.brand || "ALL";
  const status = opts?.status || "ALL";
  const search = (opts?.search || "").trim();
  const limit = Math.min(500, Math.max(1, Number(opts?.limit ?? 250)));

  const [enquiries, allUnfiltered, bridgeHealth] = await Promise.all([
    syncAndListEcosystemEnquiries({ brand, status, search, limit }),
    syncAndListEcosystemEnquiries({ limit: 500 }),
    checkEcosystemBridgesHealth().catch(() => null),
  ]);

  const stats = {
    total: allUnfiltered.length,
    newCount: allUnfiltered.filter((e) => e.status === "New").length,
    repliedCount: allUnfiltered.filter((e) => e.status === "Replied").length,
    ccCount: allUnfiltered.filter((e) => e.brand === "CLASSIC_CONCEPTS").length,
    ce53Count: allUnfiltered.filter((e) => e.brand === "CLASSIC_EDGE_53").length,
  };

  return {
    ok: true as const,
    enquiries,
    stats,
    bridgeHealth,
  };
}
