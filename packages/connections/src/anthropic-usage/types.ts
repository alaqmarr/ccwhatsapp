export type UsagePresetRange = "mtd" | "7d" | "30d" | "custom";

export type ReportDataStatus =
  | "LIVE_OK"
  | "ZERO_USAGE"
  | "MISSING_CONFIG"
  | "UNAVAILABLE_ATTRIBUTION"
  | "STALE_DATA"
  | "FETCH_ERROR";

export type SpendAttributionMode =
  | "SEPARATE_WORKSPACES"
  | "SHARED_WORKSPACE"
  | "UNCONFIGURED_WORKSPACE";

export interface TokenMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

export interface KeyModelTokenBreakdown extends TokenMetrics {
  apiKeyId: string;
  workspaceId: string | null;
  model: string;
}

export interface DailyTokenPoint extends TokenMetrics {
  dateUtc: string; // YYYY-MM-DD (UTC)
}

export interface DailySpendPoint {
  dateUtc: string; // YYYY-MM-DD (UTC)
  amountCents: number;
  spendUsd: number;
  byDescription: Record<string, number>; // description -> USD
}

export interface IntegrationBillingIdentity {
  integration: "ACRIO" | "ACRO";
  label: string;
  description: string;
  runtimeKeyConfigured: boolean;
  runtimeKeyPrefix: string | null;
  runtimeKeySource: string;
  runtimeKeyType: "service_key" | "standard_api_key" | "admin_key" | "missing";
  organizationId: string | null;
  organizationName: string | null;
  adminApiKeyConfigured: boolean;
  adminApiKeyPrefix: string | null;
  adminApiKeyEnvVar: string;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceEnvVar: string;
  apiKeyId: string | null;
  apiKeyName: string | null;
  apiKeyIdEnvVar: string;
  sharedWithUnrelatedIntegrations: boolean;
}

export interface IntegrationUsageAndSpendSummary {
  integration: "ACRIO" | "ACRO";
  identity: IntegrationBillingIdentity;
  usageStatus: ReportDataStatus;
  usageStatusMessage: string;
  spendStatus: ReportDataStatus;
  spendStatusMessage: string;
  perKeySpendAvailable: boolean;
  spendLabel: string;
  totalSpendUsd: number | null;
  totalSpendCents: number | null;
  dailySpend: DailySpendPoint[];
  tokens: TokenMetrics;
  byKeyAndModel: KeyModelTokenBreakdown[];
  dailyTokens: DailyTokenPoint[];
}

export interface SharedWorkspaceSpendSummary {
  workspaceId: string;
  workspaceName: string | null;
  sharedBetweenAcrioAndAcro: boolean;
  servesUnrelatedIntegrations: boolean;
  spendLabel: string;
  totalSpendUsd: number;
  totalSpendCents: number;
  dailySpend: DailySpendPoint[];
  unattributedKeyIds: string[];
}

export interface ClaudeUsageAndSpendComparisonReport {
  ok: boolean;
  reportingTimeZone: "UTC";
  preset: UsagePresetRange;
  startingAtUtc: string;
  endingAtUtc: string;
  generatedAtUtc: string;
  lastSuccessfulRefreshUtc: string | null;
  cacheHit: boolean;
  isStale: boolean;
  sameOrganization: boolean;
  spendAttributionMode: SpendAttributionMode;
  overallStatus: ReportDataStatus;
  overallStatusMessage: string;
  acrio: IntegrationUsageAndSpendSummary;
  acro: IntegrationUsageAndSpendSummary;
  sharedWorkspaceSpend: SharedWorkspaceSpendSummary | null;
  organizationTotalSpendUsd: number | null;
  organizationUnattributedTokens: TokenMetrics;
  requiredEnvConfigGuide: {
    missingVariables: string[];
    instructions: string[];
  };
  warnings: string[];
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface CachedOrgReportEntry {
  fetchedAtMs: number;
  fetchedAtUtc: string;
  usageBuckets: RawAnthropicUsageBucket[];
  costBuckets: RawAnthropicCostBucket[];
  orgMeta: { id: string | null; name: string | null };
  workspacesMap: Map<string, string>;
  apiKeysMap: Map<string, { name: string; workspaceId: string | null }>;
}

export interface RawAnthropicUsageResultItem {
  uncached_input_tokens?: number | null;
  input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
  output_tokens?: number | null;
  api_key_id?: string | null;
  workspace_id?: string | null;
  model?: string | null;
}

export interface RawAnthropicUsageBucket extends RawAnthropicUsageResultItem {
  starting_at: string;
  ending_at: string;
  results?: RawAnthropicUsageResultItem[];
}

export interface RawAnthropicCostResultItem {
  amount?: string | number | null;
  cost_usd?: string | number | null;
  currency?: string | null;
  workspace_id?: string | null;
  description?: string | null;
  model?: string | null;
}

export interface RawAnthropicCostBucket extends RawAnthropicCostResultItem {
  starting_at: string;
  ending_at: string;
  results?: RawAnthropicCostResultItem[];
}

export interface BillingConfigOverrides {
  acrioAdminApiKey?: string | null;
  acroAdminApiKey?: string | null;
  sharedOrgAdminApiKey?: string | null;
  acrioOrgId?: string | null;
  acroOrgId?: string | null;
  acrioWorkspaceId?: string | null;
  acroWorkspaceId?: string | null;
  acrioApiKeyId?: string | null;
  acroApiKeyId?: string | null;
  acrioWorkspaceSharedWithOthers?: boolean;
  acroWorkspaceSharedWithOthers?: boolean;
  acrioRuntimeApiKey?: string | null;
  acroRuntimeApiKey?: string | null;
}
