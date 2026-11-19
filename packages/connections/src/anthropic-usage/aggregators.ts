import {
  addTokenMetrics,
  convertAnthropicCostItemToUsd,
  createZeroTokenMetrics,
  extractTokenMetricsFromUsageItem,
  normalizeDateDayUtc,
} from "./cache-and-utils";
import type {
  CachedOrgReportEntry,
  DailySpendPoint,
  DailyTokenPoint,
  IntegrationBillingIdentity,
  IntegrationUsageAndSpendSummary,
  KeyModelTokenBreakdown,
  RawAnthropicCostBucket,
  RawAnthropicCostResultItem,
  RawAnthropicUsageBucket,
  RawAnthropicUsageResultItem,
  ReportDataStatus,
  TokenMetrics,
} from "./types";

export function aggregateUsageForTarget(params: {
  buckets: RawAnthropicUsageBucket[];
  targetApiKeyId: string | null;
  targetWorkspaceId: string | null;
  allowAllWhenSingleIntegrationInOrg: boolean;
}): {
  tokens: TokenMetrics;
  byKeyAndModel: KeyModelTokenBreakdown[];
  dailyTokens: DailyTokenPoint[];
} {
  let tokens = createZeroTokenMetrics();
  const keyModelMap = new Map<string, KeyModelTokenBreakdown>();
  const dailyMap = new Map<string, TokenMetrics>();

  for (const bucket of params.buckets) {
    const dateUtc = normalizeDateDayUtc(bucket.starting_at);
    const items: RawAnthropicUsageResultItem[] =
      Array.isArray(bucket.results) && bucket.results.length > 0
        ? bucket.results
        : [bucket];

    for (const item of items) {
      const itemKeyId = item.api_key_id ? String(item.api_key_id) : null;
      const itemWsId = item.workspace_id ? String(item.workspace_id) : null;

      let matches = false;
      if (params.targetApiKeyId) {
        matches = itemKeyId === params.targetApiKeyId;
      } else if (params.targetWorkspaceId) {
        matches = itemWsId === params.targetWorkspaceId;
      } else if (params.allowAllWhenSingleIntegrationInOrg) {
        matches = true;
      }

      if (!matches) continue;

      const m = extractTokenMetricsFromUsageItem(item);
      if (m.totalTokens === 0) continue;

      tokens = addTokenMetrics(tokens, m);

      const prevDay = dailyMap.get(dateUtc) || createZeroTokenMetrics();
      dailyMap.set(dateUtc, addTokenMetrics(prevDay, m));

      const modelName = item.model ? String(item.model) : "claude-haiku-5-5";
      const keyLabel = itemKeyId || params.targetApiKeyId || "unattributed_key";
      const kmKey = `${keyLabel}::${modelName}`;
      const existingKm = keyModelMap.get(kmKey);
      if (existingKm) {
        const summed = addTokenMetrics(existingKm, m);
        keyModelMap.set(kmKey, {
          ...existingKm,
          ...summed,
        });
      } else {
        keyModelMap.set(kmKey, {
          apiKeyId: keyLabel,
          workspaceId: itemWsId || params.targetWorkspaceId || null,
          model: modelName,
          ...m,
        });
      }
    }
  }

  const dailyTokens: DailyTokenPoint[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateUtc, tm]) => ({
      dateUtc,
      ...tm,
    }));

  const byKeyAndModel = Array.from(keyModelMap.values()).sort(
    (a, b) => b.totalTokens - a.totalTokens
  );

  return { tokens, byKeyAndModel, dailyTokens };
}

export function aggregateCostForWorkspace(params: {
  buckets: RawAnthropicCostBucket[];
  targetWorkspaceId: string | null;
  allowOrgTotalWhenNull: boolean;
}): {
  totalSpendUsd: number;
  totalSpendCents: number;
  dailySpend: DailySpendPoint[];
} {
  let totalCents = 0;
  const dailyMap = new Map<
    string,
    { amountCents: number; byDescription: Record<string, number> }
  >();

  for (const bucket of params.buckets) {
    const dateUtc = normalizeDateDayUtc(bucket.starting_at);
    const items: RawAnthropicCostResultItem[] =
      Array.isArray(bucket.results) && bucket.results.length > 0
        ? bucket.results
        : [bucket];

    for (const item of items) {
      const itemWsId = item.workspace_id ? String(item.workspace_id) : null;
      const matches = params.targetWorkspaceId
        ? itemWsId === params.targetWorkspaceId
        : params.allowOrgTotalWhenNull;
      if (!matches) continue;

      const { amountCents, spendUsd } = convertAnthropicCostItemToUsd(item);
      if (amountCents === 0 && spendUsd === 0) continue;

      totalCents += amountCents;
      const entry = dailyMap.get(dateUtc) || {
        amountCents: 0,
        byDescription: {},
      };
      entry.amountCents = Number((entry.amountCents + amountCents).toFixed(4));
      const desc = String(
        item.description || item.model || "Claude API Usage"
      ).trim();
      entry.byDescription[desc] = Number(
        ((entry.byDescription[desc] || 0) + spendUsd).toFixed(6)
      );
      dailyMap.set(dateUtc, entry);
    }
  }

  const dailySpend: DailySpendPoint[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateUtc, d]) => ({
      dateUtc,
      amountCents: Number(d.amountCents.toFixed(4)),
      spendUsd: Number((d.amountCents / 100).toFixed(6)),
      byDescription: d.byDescription,
    }));

  const roundedCents = Number(totalCents.toFixed(4));
  const roundedUsd = Number((roundedCents / 100).toFixed(6));

  return {
    totalSpendUsd: roundedUsd,
    totalSpendCents: roundedCents,
    dailySpend,
  };
}

export function buildIntegrationSummary(params: {
  integration: "ACRIO" | "ACRO";
  identity: IntegrationBillingIdentity;
  orgReport: {
    entry: CachedOrgReportEntry | null;
    cacheHit: boolean;
    isStale: boolean;
    error: string | null;
  };
  isSharedWorkspace: boolean;
  sameOrganization: boolean;
}): IntegrationUsageAndSpendSummary {
  const { integration, identity, orgReport, isSharedWorkspace, sameOrganization } = params;

  if (!identity.adminApiKeyConfigured) {
    return {
      integration,
      identity,
      usageStatus: "MISSING_CONFIG",
      usageStatusMessage: `Missing Anthropic Admin API key (sk-ant-admin...). Set ${identity.adminApiKeyEnvVar}.`,
      spendStatus: "MISSING_CONFIG",
      spendStatusMessage: `Missing Anthropic Admin API key (sk-ant-admin...). Set ${identity.adminApiKeyEnvVar}.`,
      perKeySpendAvailable: false,
      spendLabel: "Admin API Key Required",
      totalSpendUsd: null,
      totalSpendCents: null,
      dailySpend: [],
      tokens: createZeroTokenMetrics(),
      byKeyAndModel: [],
      dailyTokens: [],
    };
  }

  if (!orgReport.entry) {
    return {
      integration,
      identity,
      usageStatus: "FETCH_ERROR",
      usageStatusMessage:
        orgReport.error || "Failed to fetch usage report from Anthropic.",
      spendStatus: "FETCH_ERROR",
      spendStatusMessage:
        orgReport.error || "Failed to fetch cost report from Anthropic.",
      perKeySpendAvailable: false,
      spendLabel: "Fetch Error",
      totalSpendUsd: null,
      totalSpendCents: null,
      dailySpend: [],
      tokens: createZeroTokenMetrics(),
      byKeyAndModel: [],
      dailyTokens: [],
    };
  }

  const canAttributeUsage =
    Boolean(identity.apiKeyId) ||
    (Boolean(identity.workspaceId) && !isSharedWorkspace) ||
    !sameOrganization;

  let usageResult = {
    tokens: createZeroTokenMetrics(),
    byKeyAndModel: [] as KeyModelTokenBreakdown[],
    dailyTokens: [] as DailyTokenPoint[],
  };
  let usageStatus: ReportDataStatus = "UNAVAILABLE_ATTRIBUTION";
  let usageStatusMessage = `Set ${identity.apiKeyIdEnvVar} (e.g. apikey_...) to attribute token usage to ${integration}.`;

  if (canAttributeUsage) {
    usageResult = aggregateUsageForTarget({
      buckets: orgReport.entry.usageBuckets,
      targetApiKeyId: identity.apiKeyId,
      targetWorkspaceId: isSharedWorkspace ? null : identity.workspaceId,
      allowAllWhenSingleIntegrationInOrg:
        !sameOrganization && !identity.apiKeyId && !identity.workspaceId,
    });
    if (orgReport.isStale) {
      usageStatus = "STALE_DATA";
      usageStatusMessage = `Showing cached usage data from ${orgReport.entry.fetchedAtUtc} (upstream refresh error: ${orgReport.error}).`;
    } else if (usageResult.tokens.totalTokens === 0) {
      usageStatus = "ZERO_USAGE";
      usageStatusMessage = `0 tokens recorded for ${integration} in this UTC period.`;
    } else {
      usageStatus = "LIVE_OK";
      usageStatusMessage = identity.apiKeyId
        ? `Attributed by API Key ID (${identity.apiKeyId}).`
        : identity.workspaceId
        ? `Attributed by Workspace ID (${identity.workspaceId}).`
        : `Attributed by dedicated Organization (${identity.organizationId}).`;
    }
  }

  if (isSharedWorkspace) {
    return {
      integration,
      identity,
      usageStatus,
      usageStatusMessage,
      spendStatus: "UNAVAILABLE_ATTRIBUTION",
      spendStatusMessage: `Per-key spend is unavailable because Acrio and Acro share workspace ${identity.workspaceId}. Anthropic cost_report groups spend by workspace_id, not api_key_id. See Shared Workspace Spend below.`,
      perKeySpendAvailable: false,
      spendLabel: "Per-Key Spend Unavailable (Shared Workspace)",
      totalSpendUsd: null,
      totalSpendCents: null,
      dailySpend: [],
      tokens: usageResult.tokens,
      byKeyAndModel: usageResult.byKeyAndModel,
      dailyTokens: usageResult.dailyTokens,
    };
  }

  if (!identity.workspaceId && sameOrganization) {
    return {
      integration,
      identity,
      usageStatus,
      usageStatusMessage,
      spendStatus: "UNAVAILABLE_ATTRIBUTION",
      spendStatusMessage: `Set ${identity.workspaceEnvVar} (e.g. wrkspc_...) to attribute organization spend to ${integration}.`,
      perKeySpendAvailable: false,
      spendLabel: "Workspace ID Required for Spend Attribution",
      totalSpendUsd: null,
      totalSpendCents: null,
      dailySpend: [],
      tokens: usageResult.tokens,
      byKeyAndModel: usageResult.byKeyAndModel,
      dailyTokens: usageResult.dailyTokens,
    };
  }

  const costResult = aggregateCostForWorkspace({
    buckets: orgReport.entry.costBuckets,
    targetWorkspaceId: identity.workspaceId,
    allowOrgTotalWhenNull: !sameOrganization && !identity.workspaceId,
  });

  const spendLabel = identity.sharedWithUnrelatedIntegrations
    ? `Workspace Total (${identity.workspaceName || identity.workspaceId || "Shared"} - Includes Other Integrations)`
    : identity.workspaceId
    ? `Dedicated Workspace Spend (${identity.workspaceName || identity.workspaceId})`
    : `Dedicated Organization Spend (${identity.organizationName || identity.organizationId})`;

  const spendStatus: ReportDataStatus = orgReport.isStale
    ? "STALE_DATA"
    : costResult.totalSpendCents === 0
    ? "ZERO_USAGE"
    : "LIVE_OK";

  const spendStatusMessage = orgReport.isStale
    ? `Showing cached cost report from ${orgReport.entry.fetchedAtUtc}.`
    : costResult.totalSpendCents === 0
    ? `$0.00 spend recorded for ${spendLabel} in this UTC period.`
    : identity.sharedWithUnrelatedIntegrations
    ? `Workspace also serves other API keys; showing full workspace total.`
    : `Attributed via Anthropic cost_report (${identity.workspaceId || identity.organizationId}).`;

  return {
    integration,
    identity,
    usageStatus,
    usageStatusMessage,
    spendStatus,
    spendStatusMessage,
    perKeySpendAvailable: !identity.sharedWithUnrelatedIntegrations,
    spendLabel,
    totalSpendUsd: costResult.totalSpendUsd,
    totalSpendCents: costResult.totalSpendCents,
    dailySpend: costResult.dailySpend,
    tokens: usageResult.tokens,
    byKeyAndModel: usageResult.byKeyAndModel,
    dailyTokens: usageResult.dailyTokens,
  };
}
