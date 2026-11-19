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
  dateUtc: string;
}

export interface DailySpendPoint {
  dateUtc: string;
  amountCents: number;
  spendUsd: number;
  byDescription: Record<string, number>;
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
  error?: string;
}

export function formatUsd(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) {
    return "Unavailable";
  }
  if (usd === 0) return "$0.00";
  if (usd > 0 && usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatInt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-US");
}

export function statusBadgeMeta(status: ReportDataStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "LIVE_OK":
      return {
        label: "Live Anthropic Data",
        className: "bg-emerald-50 text-emerald-800 border-emerald-200",
      };
    case "ZERO_USAGE":
      return {
        label: "Zero Usage in Period",
        className: "bg-slate-100 text-slate-700 border-slate-300",
      };
    case "MISSING_CONFIG":
      return {
        label: "Missing Configuration",
        className: "bg-amber-50 text-amber-800 border-amber-200",
      };
    case "UNAVAILABLE_ATTRIBUTION":
      return {
        label: "Attribution Unavailable",
        className: "bg-purple-50 text-purple-800 border-purple-200",
      };
    case "STALE_DATA":
      return {
        label: "Stale Cached Data",
        className: "bg-orange-50 text-orange-800 border-orange-200",
      };
    case "FETCH_ERROR":
    default:
      return {
        label: "Upstream Fetch Error",
        className: "bg-red-50 text-red-800 border-red-200",
      };
  }
}
