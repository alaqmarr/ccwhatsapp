import { resolveMonorepoRoot, resolveSharedAnthropicApiKey } from "@cc/database";
import {
  aggregateCostForWorkspace,
  buildIntegrationSummary,
} from "./aggregators";
import {
  discoverOrgIdentityFromKey,
  discoverWorkspacesAndKeys,
  fetchPaginatedAnthropicReport,
  loadSavedBillingConfigFromDb,
} from "./api-client";
import {
  REPORT_CACHE_TTL_MS,
  addTokenMetrics,
  classifyKeyType,
  createZeroTokenMetrics,
  extractTokenMetricsFromUsageItem,
  getCachedOrgReport,
  maskKeyPrefix,
  resolveReportWindowUtc,
  setCachedOrgReport,
} from "./cache-and-utils";
import type {
  BillingConfigOverrides,
  CachedOrgReportEntry,
  ClaudeUsageAndSpendComparisonReport,
  FetchLike,
  IntegrationBillingIdentity,
  RawAnthropicCostBucket,
  RawAnthropicUsageBucket,
  ReportDataStatus,
  SharedWorkspaceSpendSummary,
  SpendAttributionMode,
  UsagePresetRange,
} from "./types";

export async function getClaudeUsageAndSpendComparison(params: {
  preset?: UsagePresetRange | string | null;
  startingAt?: string | null;
  endingAt?: string | null;
  forceRefresh?: boolean;
  overrides?: BillingConfigOverrides;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<ClaudeUsageAndSpendComparisonReport> {
  resolveMonorepoRoot();
  const fetchImpl = params.fetchImpl || fetch;
  const windowUtc = resolveReportWindowUtc({
    preset: params.preset,
    startingAt: params.startingAt,
    endingAt: params.endingAt,
    now: params.now,
  });

  const savedDbCfg = params.overrides ? {} : await loadSavedBillingConfigFromDb();
  const [clientRuntime, adminRuntime] =
    params.overrides?.acrioRuntimeApiKey !== undefined
      ? [
          { apiKey: params.overrides.acrioRuntimeApiKey || "", source: "env" },
          { apiKey: params.overrides.acroRuntimeApiKey || "", source: "env" },
        ]
      : await Promise.all([
          resolveSharedAnthropicApiKey("client"),
          resolveSharedAnthropicApiKey("admin"),
        ]);

  const ov = params.overrides || {};

  const envSharedAdminKey = (
    ov.sharedOrgAdminApiKey ??
    savedDbCfg.ANTHROPIC_ORG_ADMIN_API_KEY ??
    process.env.ANTHROPIC_ORG_ADMIN_API_KEY ??
    (String(process.env.ANTHROPIC_ADMIN_API_KEY || "").startsWith("sk-ant-admin")
      ? process.env.ANTHROPIC_ADMIN_API_KEY
      : "") ??
    ""
  ).trim();

  const acrioAdminApiKey = (
    ov.acrioAdminApiKey ??
    savedDbCfg.ACRIO_ANTHROPIC_ORG_ADMIN_API_KEY ??
    process.env.ACRIO_ANTHROPIC_ORG_ADMIN_API_KEY ??
    envSharedAdminKey
  ).trim();

  const acroAdminApiKey = (
    ov.acroAdminApiKey ??
    savedDbCfg.ACRO_ANTHROPIC_ORG_ADMIN_API_KEY ??
    process.env.ACRO_ANTHROPIC_ORG_ADMIN_API_KEY ??
    envSharedAdminKey
  ).trim();

  const acrioHasValidAdminKey = acrioAdminApiKey.startsWith("sk-ant-admin");
  const acroHasValidAdminKey = acroAdminApiKey.startsWith("sk-ant-admin");

  let acrioWorkspaceId =
    (
      ov.acrioWorkspaceId ??
      savedDbCfg.ACRIO_ANTHROPIC_WORKSPACE_ID ??
      process.env.ACRIO_ANTHROPIC_WORKSPACE_ID ??
      ""
    ).trim() || null;

  let acroWorkspaceId =
    (
      ov.acroWorkspaceId ??
      savedDbCfg.ACRO_ANTHROPIC_WORKSPACE_ID ??
      process.env.ACRO_ANTHROPIC_WORKSPACE_ID ??
      ""
    ).trim() || null;

  const acrioApiKeyId =
    (
      ov.acrioApiKeyId ??
      savedDbCfg.ACRIO_ANTHROPIC_API_KEY_ID ??
      process.env.ACRIO_ANTHROPIC_API_KEY_ID ??
      ""
    ).trim() || null;

  const acroApiKeyId =
    (
      ov.acroApiKeyId ??
      savedDbCfg.ACRO_ANTHROPIC_API_KEY_ID ??
      process.env.ACRO_ANTHROPIC_API_KEY_ID ??
      ""
    ).trim() || null;

  let acrioSharedWithOthers = Boolean(
    ov.acrioWorkspaceSharedWithOthers ??
      /^(1|true|yes)$/i.test(
        String(
          savedDbCfg.ACRIO_WORKSPACE_SHARED_WITH_OTHER_INTEGRATIONS ??
            process.env.ACRIO_WORKSPACE_SHARED_WITH_OTHER_INTEGRATIONS ??
            ""
        )
      )
  );

  let acroSharedWithOthers = Boolean(
    ov.acroWorkspaceSharedWithOthers ??
      /^(1|true|yes)$/i.test(
        String(
          savedDbCfg.ACRO_WORKSPACE_SHARED_WITH_OTHER_INTEGRATIONS ??
            process.env.ACRO_WORKSPACE_SHARED_WITH_OTHER_INTEGRATIONS ??
            ""
        )
      )
  );

  const [acrioOrgDiscovered, acroOrgDiscovered] = await Promise.all([
    ov.acrioOrgId
      ? Promise.resolve({ id: ov.acrioOrgId, name: null })
      : discoverOrgIdentityFromKey(
          acrioHasValidAdminKey ? acrioAdminApiKey : clientRuntime.apiKey,
          fetchImpl
        ),
    ov.acroOrgId
      ? Promise.resolve({ id: ov.acroOrgId, name: null })
      : discoverOrgIdentityFromKey(
          acroHasValidAdminKey ? acroAdminApiKey : adminRuntime.apiKey,
          fetchImpl
        ),
  ]);

  const acrioOrgId =
    (
      ov.acrioOrgId ??
      savedDbCfg.ACRIO_ANTHROPIC_ORG_ID ??
      process.env.ACRIO_ANTHROPIC_ORG_ID ??
      acrioOrgDiscovered.id ??
      ""
    ).trim() || null;

  const acroOrgId =
    (
      ov.acroOrgId ??
      savedDbCfg.ACRO_ANTHROPIC_ORG_ID ??
      process.env.ACRO_ANTHROPIC_ORG_ID ??
      acroOrgDiscovered.id ??
      ""
    ).trim() || null;

  const sameOrganization =
    (Boolean(acrioOrgId && acroOrgId) && acrioOrgId === acroOrgId) ||
    (acrioHasValidAdminKey &&
      acroHasValidAdminKey &&
      acrioAdminApiKey === acroAdminApiKey);

  const loadOrgReport = async (
    orgKeyLabel: string,
    adminKey: string,
    knownOrgMeta: { id: string | null; name: string | null }
  ): Promise<{
    entry: CachedOrgReportEntry | null;
    cacheHit: boolean;
    isStale: boolean;
    error: string | null;
  }> => {
    const cacheKey = `${orgKeyLabel}:${adminKey.slice(-8)}:${windowUtc.startingAtUtc}:${windowUtc.endingAtUtc}`;
    const existing = getCachedOrgReport(cacheKey);
    const nowMs = Date.now();

    if (
      !params.forceRefresh &&
      existing &&
      nowMs - existing.fetchedAtMs < REPORT_CACHE_TTL_MS
    ) {
      return {
        entry: existing,
        cacheHit: true,
        isStale: false,
        error: null,
      };
    }

    const [usageRes, costRes, metaMaps] = await Promise.all([
      fetchPaginatedAnthropicReport<RawAnthropicUsageBucket>({
        endpointPath: "/v1/organizations/usage_report/messages",
        adminApiKey: adminKey,
        startingAtUtc: windowUtc.startingAtUtc,
        endingAtUtc: windowUtc.endingAtUtc,
        groupBy: ["api_key_id", "workspace_id", "model"],
        fetchImpl,
      }),
      fetchPaginatedAnthropicReport<RawAnthropicCostBucket>({
        endpointPath: "/v1/organizations/cost_report",
        adminApiKey: adminKey,
        startingAtUtc: windowUtc.startingAtUtc,
        endingAtUtc: windowUtc.endingAtUtc,
        groupBy: ["workspace_id", "description"],
        fetchImpl,
      }),
      discoverWorkspacesAndKeys(adminKey, fetchImpl),
    ]);

    if (!usageRes.ok || !costRes.ok) {
      const combinedErr = [
        !usageRes.ok ? `usage_report: ${usageRes.error}` : "",
        !costRes.ok ? `cost_report: ${costRes.error}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      if (existing) {
        return {
          entry: existing,
          cacheHit: true,
          isStale: true,
          error: combinedErr,
        };
      }
      return {
        entry: null,
        cacheHit: false,
        isStale: false,
        error: combinedErr,
      };
    }

    const freshEntry: CachedOrgReportEntry = {
      fetchedAtMs: nowMs,
      fetchedAtUtc: new Date(nowMs).toISOString(),
      usageBuckets: usageRes.buckets,
      costBuckets: costRes.buckets,
      orgMeta: {
        id: knownOrgMeta.id || usageRes.organizationIdHeader || null,
        name: knownOrgMeta.name,
      },
      workspacesMap: metaMaps.workspacesMap,
      apiKeysMap: metaMaps.apiKeysMap,
    };
    setCachedOrgReport(cacheKey, freshEntry);

    return {
      entry: freshEntry,
      cacheHit: false,
      isStale: false,
      error: null,
    };
  };

  let acrioOrgReport: Awaited<ReturnType<typeof loadOrgReport>> = {
    entry: null,
    cacheHit: false,
    isStale: false,
    error: null,
  };
  let acroOrgReport: Awaited<ReturnType<typeof loadOrgReport>> = {
    entry: null,
    cacheHit: false,
    isStale: false,
    error: null,
  };

  if (acrioHasValidAdminKey && acroHasValidAdminKey && sameOrganization) {
    const shared = await loadOrgReport(
      acrioOrgId || "shared-org",
      acrioAdminApiKey,
      acrioOrgDiscovered
    );
    acrioOrgReport = shared;
    acroOrgReport = shared;
  } else {
    const emptyRes = { entry: null, cacheHit: false, isStale: false, error: null };
    const [r1, r2] = await Promise.all([
      acrioHasValidAdminKey
        ? loadOrgReport(acrioOrgId || "acrio-org", acrioAdminApiKey, acrioOrgDiscovered)
        : Promise.resolve(emptyRes),
      acroHasValidAdminKey
        ? loadOrgReport(acroOrgId || "acro-org", acroAdminApiKey, acroOrgDiscovered)
        : Promise.resolve(emptyRes),
    ]);
    acrioOrgReport = r1;
    acroOrgReport = r2;
  }

  const acrioKeyMeta =
    acrioApiKeyId && acrioOrgReport.entry?.apiKeysMap.get(acrioApiKeyId);
  if (!acrioWorkspaceId && acrioKeyMeta && acrioKeyMeta.workspaceId) {
    acrioWorkspaceId = acrioKeyMeta.workspaceId;
  }

  const acroKeyMeta =
    acroApiKeyId && acroOrgReport.entry?.apiKeysMap.get(acroApiKeyId);
  if (!acroWorkspaceId && acroKeyMeta && acroKeyMeta.workspaceId) {
    acroWorkspaceId = acroKeyMeta.workspaceId;
  }

  const detectUnrelatedKeysInWorkspace = (
    entry: CachedOrgReportEntry | null,
    wsId: string | null
  ): string[] => {
    if (!entry || !wsId) return [];
    const knownIds = new Set(
      [acrioApiKeyId, acroApiKeyId].filter((x): x is string => Boolean(x))
    );
    const otherIds = new Set<string>();
    for (const b of entry.usageBuckets) {
      const items =
        Array.isArray(b.results) && b.results.length > 0 ? b.results : [b];
      for (const it of items) {
        if (
          it.workspace_id === wsId &&
          it.api_key_id &&
          !knownIds.has(String(it.api_key_id))
        ) {
          otherIds.add(String(it.api_key_id));
        }
      }
    }
    return Array.from(otherIds);
  };

  const acrioOtherKeys = detectUnrelatedKeysInWorkspace(acrioOrgReport.entry, acrioWorkspaceId);
  const acroOtherKeys = detectUnrelatedKeysInWorkspace(acroOrgReport.entry, acroWorkspaceId);

  if (acrioOtherKeys.length > 0) acrioSharedWithOthers = true;
  if (acroOtherKeys.length > 0) acroSharedWithOthers = true;

  const isSharedWorkspace = Boolean(
    sameOrganization &&
      acrioWorkspaceId &&
      acroWorkspaceId &&
      acrioWorkspaceId === acroWorkspaceId
  );

  const spendAttributionMode: SpendAttributionMode = isSharedWorkspace
    ? "SHARED_WORKSPACE"
    : acrioWorkspaceId && acroWorkspaceId
    ? "SEPARATE_WORKSPACES"
    : "UNCONFIGURED_WORKSPACE";

  const acrioIdentity: IntegrationBillingIdentity = {
    integration: "ACRIO",
    label: "Acrio (WhatsApp & Client Concierge)",
    description:
      "Customer-facing product concierge on WhatsApp Hub (chat.ccapl.cc) and Classic Concepts website",
    runtimeKeyConfigured: Boolean(clientRuntime.apiKey),
    runtimeKeyPrefix: maskKeyPrefix(clientRuntime.apiKey),
    runtimeKeySource: clientRuntime.source,
    runtimeKeyType: classifyKeyType(clientRuntime.apiKey),
    organizationId: acrioOrgId,
    organizationName:
      acrioOrgDiscovered.name || acrioOrgReport.entry?.orgMeta.name || null,
    adminApiKeyConfigured: acrioHasValidAdminKey,
    adminApiKeyPrefix: acrioHasValidAdminKey ? maskKeyPrefix(acrioAdminApiKey) : null,
    adminApiKeyEnvVar:
      "ANTHROPIC_ORG_ADMIN_API_KEY (or ACRIO_ANTHROPIC_ORG_ADMIN_API_KEY)",
    workspaceId: acrioWorkspaceId,
    workspaceName:
      (acrioWorkspaceId &&
        acrioOrgReport.entry?.workspacesMap.get(acrioWorkspaceId)) ||
      null,
    workspaceEnvVar: "ACRIO_ANTHROPIC_WORKSPACE_ID",
    apiKeyId: acrioApiKeyId,
    apiKeyName: (acrioKeyMeta && acrioKeyMeta.name) || null,
    apiKeyIdEnvVar: "ACRIO_ANTHROPIC_API_KEY_ID",
    sharedWithUnrelatedIntegrations: acrioSharedWithOthers,
  };

  const acroIdentity: IntegrationBillingIdentity = {
    integration: "ACRO",
    label: "Acro (Admin Co-Pilot & Catalog Editor)",
    description:
      "Administrator AI co-pilot for product autofill, inline editing, SEO, and smart customer lists",
    runtimeKeyConfigured: Boolean(adminRuntime.apiKey),
    runtimeKeyPrefix: maskKeyPrefix(adminRuntime.apiKey),
    runtimeKeySource: adminRuntime.source,
    runtimeKeyType: classifyKeyType(adminRuntime.apiKey),
    organizationId: acroOrgId,
    organizationName:
      acroOrgDiscovered.name || acroOrgReport.entry?.orgMeta.name || null,
    adminApiKeyConfigured: acroHasValidAdminKey,
    adminApiKeyPrefix: acroHasValidAdminKey ? maskKeyPrefix(acroAdminApiKey) : null,
    adminApiKeyEnvVar:
      "ANTHROPIC_ORG_ADMIN_API_KEY (or ACRO_ANTHROPIC_ORG_ADMIN_API_KEY)",
    workspaceId: acroWorkspaceId,
    workspaceName:
      (acroWorkspaceId &&
        acroOrgReport.entry?.workspacesMap.get(acroWorkspaceId)) ||
      null,
    workspaceEnvVar: "ACRO_ANTHROPIC_WORKSPACE_ID",
    apiKeyId: acroApiKeyId,
    apiKeyName: (acroKeyMeta && acroKeyMeta.name) || null,
    apiKeyIdEnvVar: "ACRO_ANTHROPIC_API_KEY_ID",
    sharedWithUnrelatedIntegrations: acroSharedWithOthers,
  };

  const acrioSummary = buildIntegrationSummary({
    integration: "ACRIO",
    identity: acrioIdentity,
    orgReport: acrioOrgReport,
    isSharedWorkspace,
    sameOrganization,
  });
  const acroSummary = buildIntegrationSummary({
    integration: "ACRO",
    identity: acroIdentity,
    orgReport: acroOrgReport,
    isSharedWorkspace,
    sameOrganization,
  });

  let sharedWorkspaceSpend: SharedWorkspaceSpendSummary | null = null;
  if (isSharedWorkspace && acrioWorkspaceId && acrioOrgReport.entry) {
    const sharedCost = aggregateCostForWorkspace({
      buckets: acrioOrgReport.entry.costBuckets,
      targetWorkspaceId: acrioWorkspaceId,
      allowOrgTotalWhenNull: false,
    });
    const servesOthers =
      acrioSharedWithOthers || acroSharedWithOthers || acrioOtherKeys.length > 0;
    const wsName =
      acrioOrgReport.entry.workspacesMap.get(acrioWorkspaceId) || null;
    sharedWorkspaceSpend = {
      workspaceId: acrioWorkspaceId,
      workspaceName: wsName,
      sharedBetweenAcrioAndAcro: true,
      servesUnrelatedIntegrations: servesOthers,
      spendLabel: servesOthers
        ? `Workspace Total (${wsName || acrioWorkspaceId} - Includes Acrio, Acro & Unrelated Integrations)`
        : `Shared Workspace Combined Spend (${wsName || acrioWorkspaceId} - Acrio + Acro)`,
      totalSpendUsd: sharedCost.totalSpendUsd,
      totalSpendCents: sharedCost.totalSpendCents,
      dailySpend: sharedCost.dailySpend,
      unattributedKeyIds: acrioOtherKeys,
    };
  }

  let organizationTotalSpendUsd: number | null = null;
  let organizationUnattributedTokens = createZeroTokenMetrics();
  const primaryEntry = acrioOrgReport.entry || acroOrgReport.entry;
  if (primaryEntry) {
    const orgAllCost = aggregateCostForWorkspace({
      buckets: primaryEntry.costBuckets,
      targetWorkspaceId: null,
      allowOrgTotalWhenNull: true,
    });
    organizationTotalSpendUsd = orgAllCost.totalSpendUsd;

    const knownKeys = new Set(
      [acrioApiKeyId, acroApiKeyId].filter((x): x is string => Boolean(x))
    );
    for (const b of primaryEntry.usageBuckets) {
      const items =
        Array.isArray(b.results) && b.results.length > 0 ? b.results : [b];
      for (const it of items) {
        const kid = it.api_key_id ? String(it.api_key_id) : "";
        if (!knownKeys.has(kid)) {
          organizationUnattributedTokens = addTokenMetrics(
            organizationUnattributedTokens,
            extractTokenMetricsFromUsageItem(it)
          );
        }
      }
    }
  }

  const missingVariables: string[] = [];
  if (!acrioHasValidAdminKey && !acroHasValidAdminKey) {
    missingVariables.push("ANTHROPIC_ORG_ADMIN_API_KEY");
  } else {
    if (!acrioHasValidAdminKey) missingVariables.push("ACRIO_ANTHROPIC_ORG_ADMIN_API_KEY");
    if (!acroHasValidAdminKey) missingVariables.push("ACRO_ANTHROPIC_ORG_ADMIN_API_KEY");
  }
  if (!acrioWorkspaceId) missingVariables.push("ACRIO_ANTHROPIC_WORKSPACE_ID");
  if (!acroWorkspaceId) missingVariables.push("ACRO_ANTHROPIC_WORKSPACE_ID");
  if (!acrioApiKeyId) missingVariables.push("ACRIO_ANTHROPIC_API_KEY_ID");
  if (!acroApiKeyId) missingVariables.push("ACRO_ANTHROPIC_API_KEY_ID");

  const warnings: string[] = [];
  if (
    clientRuntime.apiKey.startsWith("sk-ant-svc-") ||
    adminRuntime.apiKey.startsWith("sk-ant-svc-")
  ) {
    warnings.push(
      `Runtime keys are Workspace Service Account keys (sk-ant-svc-...) in Anthropic Organization "${acrioIdentity.organizationName || acrioIdentity.organizationId || "6411698a-79d6-49be-a4e0-a7c9c4cfc8b1"}". Anthropic's /v1/organizations/usage_report/messages and /v1/organizations/cost_report endpoints require an Organization Admin API key (sk-ant-admin...).`
    );
  }
  if (isSharedWorkspace) {
    warnings.push(
      `Acrio and Acro are configured in the same Anthropic workspace (${acrioWorkspaceId}). Token usage is separated by API key ID, while USD spend is reported as the combined workspace total because Anthropic cost_report does not segment by api_key_id.`
    );
  }

  const lastSuccessfulRefreshUtc =
    acrioOrgReport.entry?.fetchedAtUtc || acroOrgReport.entry?.fetchedAtUtc || null;
  const isStale = acrioOrgReport.isStale || acroOrgReport.isStale;
  const cacheHit = acrioOrgReport.cacheHit || acroOrgReport.cacheHit;

  let overallStatus: ReportDataStatus = "LIVE_OK";
  let overallStatusMessage =
    "Live Anthropic Organization usage and cost reports loaded.";

  if (!acrioHasValidAdminKey && !acroHasValidAdminKey) {
    overallStatus = "MISSING_CONFIG";
    overallStatusMessage =
      "Anthropic Organization Admin API key (sk-ant-admin...) is not configured yet. Runtime inference keys (sk-ant-svc-...) cannot access /v1/organizations/usage_report/messages or /v1/organizations/cost_report.";
  } else if (!acrioOrgReport.entry && !acroOrgReport.entry) {
    overallStatus = "FETCH_ERROR";
    overallStatusMessage =
      acrioOrgReport.error ||
      acroOrgReport.error ||
      "Failed to fetch Anthropic organization reports.";
  } else if (isStale) {
    overallStatus = "STALE_DATA";
    overallStatusMessage = `Serving cached report from ${lastSuccessfulRefreshUtc} due to temporary upstream error.`;
  } else if (
    !acrioWorkspaceId ||
    !acroWorkspaceId ||
    !acrioApiKeyId ||
    !acroApiKeyId
  ) {
    overallStatus = "UNAVAILABLE_ATTRIBUTION";
    overallStatusMessage =
      "Admin API report fetched, but workspace IDs or API key IDs need to be mapped to attribute Acrio and Acro side by side.";
  } else if (
    acrioSummary.tokens.totalTokens === 0 &&
    acroSummary.tokens.totalTokens === 0 &&
    (acrioSummary.totalSpendCents ?? 0) === 0 &&
    (acroSummary.totalSpendCents ?? 0) === 0 &&
    (sharedWorkspaceSpend?.totalSpendCents ?? 0) === 0
  ) {
    overallStatus = "ZERO_USAGE";
    overallStatusMessage =
      "Authenticated with Anthropic Admin API: zero token usage and $0.00 spend recorded in the selected UTC window.";
  }

  return {
    ok: true,
    reportingTimeZone: "UTC",
    preset: windowUtc.preset,
    startingAtUtc: windowUtc.startingAtUtc,
    endingAtUtc: windowUtc.endingAtUtc,
    generatedAtUtc: new Date().toISOString(),
    lastSuccessfulRefreshUtc,
    cacheHit,
    isStale,
    sameOrganization,
    spendAttributionMode,
    overallStatus,
    overallStatusMessage,
    acrio: acrioSummary,
    acro: acroSummary,
    sharedWorkspaceSpend,
    organizationTotalSpendUsd,
    organizationUnattributedTokens,
    requiredEnvConfigGuide: {
      missingVariables,
      instructions: [
        `1. Generate an Organization Admin API key (starts with "sk-ant-admin...") in Anthropic Console -> Settings -> Admin Keys for Organization "${acrioIdentity.organizationName || "AL's Individual Org"}" (${acrioIdentity.organizationId || "6411698a-79d6-49be-a4e0-a7c9c4cfc8b1"}).`,
        `2. Set ANTHROPIC_ORG_ADMIN_API_KEY="sk-ant-admin..." in .env (or set ACRIO_ANTHROPIC_ORG_ADMIN_API_KEY and ACRO_ANTHROPIC_ORG_ADMIN_API_KEY if using separate organizations).`,
        `3. Set ACRIO_ANTHROPIC_WORKSPACE_ID="wrkspc_..." and ACRO_ANTHROPIC_WORKSPACE_ID="wrkspc_..." to attribute daily USD spend from GET /v1/organizations/cost_report.`,
        `4. Set ACRIO_ANTHROPIC_API_KEY_ID="apikey_..." (for runtime key ${acrioIdentity.runtimeKeyPrefix || "ANTHROPIC_CLIENT_API_KEY"}) and ACRO_ANTHROPIC_API_KEY_ID="apikey_..." (for runtime key ${acroIdentity.runtimeKeyPrefix || "ANTHROPIC_ADMIN_API_KEY"}) to attribute token usage from GET /v1/organizations/usage_report/messages.`,
      ],
    },
    warnings,
  };
}
