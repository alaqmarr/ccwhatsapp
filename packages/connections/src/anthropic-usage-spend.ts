import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolveMonorepoRoot,
  resolveSharedAnthropicApiKey,
} from "@cc/database";

const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const REPORT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes short server-side cache
const MAX_PAGINATION_PAGES = 50;

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

interface CachedOrgReportEntry {
  fetchedAtMs: number;
  fetchedAtUtc: string;
  usageBuckets: RawAnthropicUsageBucket[];
  costBuckets: RawAnthropicCostBucket[];
  orgMeta: { id: string | null; name: string | null };
  workspacesMap: Map<string, string>;
  apiKeysMap: Map<string, { name: string; workspaceId: string | null }>;
}

const orgReportCache = new Map<string, CachedOrgReportEntry>();
const orgIdentityCache = new Map<string, { id: string | null; name: string | null }>();

export function clearAnthropicUsageReportCache(): void {
  orgReportCache.clear();
  orgIdentityCache.clear();
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

/**
 * Converts an Anthropic `cost_report` item into USD cents and USD dollars.
 * Official Anthropic `GET /v1/organizations/cost_report` returns `amount` as a decimal string
 * in the lowest currency unit (USD cents, e.g. `"123.45"` = 123.45 cents = `$1.2345` USD).
 * Also supports `cost_usd` if provided directly in dollars.
 */
export function convertAnthropicCostItemToUsd(
  item: RawAnthropicCostResultItem
): { amountCents: number; spendUsd: number } {
  if (item.amount !== undefined && item.amount !== null && item.amount !== "") {
    const cents = Number(item.amount);
    if (Number.isFinite(cents)) {
      const spendUsd = Number((cents / 100).toFixed(6));
      return { amountCents: Number(cents.toFixed(4)), spendUsd };
    }
  }
  if (
    item.cost_usd !== undefined &&
    item.cost_usd !== null &&
    item.cost_usd !== ""
  ) {
    const usd = Number(item.cost_usd);
    if (Number.isFinite(usd)) {
      return {
        amountCents: Number((usd * 100).toFixed(4)),
        spendUsd: Number(usd.toFixed(6)),
      };
    }
  }
  return { amountCents: 0, spendUsd: 0 };
}

export function extractTokenMetricsFromUsageItem(
  item: RawAnthropicUsageResultItem
): TokenMetrics {
  const inputTokens = Number(
    item.uncached_input_tokens ?? item.input_tokens ?? 0
  );
  const outputTokens = Number(item.output_tokens ?? 0);
  const cacheReadTokens = Number(item.cache_read_input_tokens ?? 0);
  const cacheWriteFromObj =
    Number(item.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
    Number(item.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  const cacheWriteTokens =
    cacheWriteFromObj > 0
      ? cacheWriteFromObj
      : Number(item.cache_creation_input_tokens ?? 0);

  const safeIn = Number.isFinite(inputTokens) ? inputTokens : 0;
  const safeOut = Number.isFinite(outputTokens) ? outputTokens : 0;
  const safeRead = Number.isFinite(cacheReadTokens) ? cacheReadTokens : 0;
  const safeWrite = Number.isFinite(cacheWriteTokens) ? cacheWriteTokens : 0;

  return {
    inputTokens: safeIn,
    outputTokens: safeOut,
    cacheReadTokens: safeRead,
    cacheWriteTokens: safeWrite,
    totalTokens: safeIn + safeOut + safeRead + safeWrite,
  };
}

export function createZeroTokenMetrics(): TokenMetrics {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  };
}

export function addTokenMetrics(a: TokenMetrics, b: TokenMetrics): TokenMetrics {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

function maskKeyPrefix(key: string | null | undefined): string | null {
  const clean = String(key || "").trim();
  if (!clean) return null;
  if (clean.length <= 16) return `${clean.slice(0, 6)}...`;
  return `${clean.slice(0, 14)}...${clean.slice(-4)}`;
}

function classifyKeyType(
  key: string | null | undefined
): IntegrationBillingIdentity["runtimeKeyType"] {
  const clean = String(key || "").trim();
  if (!clean) return "missing";
  if (clean.startsWith("sk-ant-admin")) return "admin_key";
  if (clean.startsWith("sk-ant-svc-")) return "service_key";
  return "standard_api_key";
}

export function resolveReportWindowUtc(params: {
  preset?: UsagePresetRange | string | null;
  startingAt?: string | null;
  endingAt?: string | null;
  now?: Date;
}): {
  preset: UsagePresetRange;
  startingAtUtc: string;
  endingAtUtc: string;
} {
  const now = params.now || new Date();
  const todayTomorrowUtc = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0
    )
  );

  const rawPreset = String(params.preset || "mtd").toLowerCase();
  const preset: UsagePresetRange =
    rawPreset === "7d" || rawPreset === "30d" || rawPreset === "custom"
      ? (rawPreset as UsagePresetRange)
      : "mtd";

  if (preset === "custom" && params.startingAt && params.endingAt) {
    const sDate = new Date(
      params.startingAt.includes("T")
        ? params.startingAt
        : `${params.startingAt}T00:00:00Z`
    );
    let eDate = new Date(
      params.endingAt.includes("T")
        ? params.endingAt
        : `${params.endingAt}T00:00:00Z`
    );
    // If YYYY-MM-DD was provided for endingAt, make the exclusive upper bound the end of that UTC day (+1 day at 00:00:00Z)
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.endingAt.trim())) {
      eDate = new Date(eDate.getTime() + 24 * 3600 * 1000);
    }
    if (
      !Number.isNaN(sDate.getTime()) &&
      !Number.isNaN(eDate.getTime()) &&
      eDate > sDate
    ) {
      return {
        preset: "custom",
        startingAtUtc: sDate.toISOString().replace(/\.\d{3}Z$/, "Z"),
        endingAtUtc: eDate.toISOString().replace(/\.\d{3}Z$/, "Z"),
      };
    }
  }

  if (preset === "7d") {
    const start7 = new Date(todayTomorrowUtc.getTime() - 7 * 24 * 3600 * 1000);
    return {
      preset: "7d",
      startingAtUtc: start7.toISOString().replace(/\.\d{3}Z$/, "Z"),
      endingAtUtc: todayTomorrowUtc.toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
  }

  if (preset === "30d") {
    const start30 = new Date(
      todayTomorrowUtc.getTime() - 30 * 24 * 3600 * 1000
    );
    return {
      preset: "30d",
      startingAtUtc: start30.toISOString().replace(/\.\d{3}Z$/, "Z"),
      endingAtUtc: todayTomorrowUtc.toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
  }

  // Default: Month-to-date (1st of current UTC month at 00:00:00Z -> tomorrow 00:00:00Z)
  const startMtd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  );
  return {
    preset: "mtd",
    startingAtUtc: startMtd.toISOString().replace(/\.\d{3}Z$/, "Z"),
    endingAtUtc: todayTomorrowUtc.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

async function fetchAnthropicWithRetry(
  url: string,
  apiKey: string,
  fetchImpl: FetchLike
): Promise<{ ok: boolean; status: number; json: any; headers: Headers; error?: string }> {
  const delays = [400, 1100];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (
        (res.status === 429 || res.status >= 500) &&
        attempt < delays.length
      ) {
        const retryAfterSec = Number(res.headers.get("retry-after") || "0");
        const waitMs =
          retryAfterSec > 0 && retryAfterSec <= 5
            ? retryAfterSec * 1000
            : delays[attempt];
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const errMsg =
          json?.error?.message ||
          `Anthropic API returned HTTP ${res.status}`;
        return {
          ok: false,
          status: res.status,
          json,
          headers: res.headers,
          error: errMsg,
        };
      }
      return { ok: true, status: res.status, json, headers: res.headers };
    } catch (err: any) {
      if (attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      return {
        ok: false,
        status: 0,
        json: null,
        headers: new Headers(),
        error: err?.message || "Network error contacting Anthropic API.",
      };
    }
  }
  return {
    ok: false,
    status: 0,
    json: null,
    headers: new Headers(),
    error: "Retries exhausted contacting Anthropic API.",
  };
}

/**
 * Fetches all paginated buckets from an Anthropic organization reporting endpoint
 * (`GET /v1/organizations/usage_report/messages` or `GET /v1/organizations/cost_report`).
 */
export async function fetchPaginatedAnthropicReport<T>(params: {
  endpointPath:
    | "/v1/organizations/usage_report/messages"
    | "/v1/organizations/cost_report";
  adminApiKey: string;
  startingAtUtc: string;
  endingAtUtc: string;
  groupBy: string[];
  workspaceIds?: string[];
  apiKeyIds?: string[];
  limit?: number;
  fetchImpl?: FetchLike;
}): Promise<{
  ok: boolean;
  status: number;
  buckets: T[];
  pagesFetched: number;
  organizationIdHeader: string | null;
  error?: string;
}> {
  const fetchImpl = params.fetchImpl || fetch;
  const buckets: T[] = [];
  let nextPage: string | null = null;
  let pagesFetched = 0;
  let organizationIdHeader: string | null = null;

  while (pagesFetched < MAX_PAGINATION_PAGES) {
    const qs = new URLSearchParams();
    qs.set("starting_at", params.startingAtUtc);
    qs.set("ending_at", params.endingAtUtc);
    qs.set("bucket_width", "1d");
    if (params.limit) {
      qs.set("limit", String(params.limit));
    } else {
      qs.set("limit", "31");
    }
    for (const g of params.groupBy) {
      qs.append("group_by[]", g);
    }
    if (params.workspaceIds && params.workspaceIds.length > 0) {
      for (const wid of params.workspaceIds) {
        qs.append("workspace_ids[]", wid);
      }
    }
    if (params.apiKeyIds && params.apiKeyIds.length > 0) {
      for (const kid of params.apiKeyIds) {
        qs.append("api_key_ids[]", kid);
      }
    }
    if (nextPage) {
      qs.set("page", nextPage);
    }

    const url = `${ANTHROPIC_API_BASE}${params.endpointPath}?${qs.toString()}`;
    const res = await fetchAnthropicWithRetry(url, params.adminApiKey, fetchImpl);
    pagesFetched++;

    const headerOrg = res.headers?.get?.("anthropic-organization-id") || null;
    if (headerOrg && !organizationIdHeader) {
      organizationIdHeader = headerOrg;
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        buckets,
        pagesFetched,
        organizationIdHeader,
        error: res.error,
      };
    }

    const pageData = Array.isArray(res.json?.data) ? (res.json.data as T[]) : [];
    buckets.push(...pageData);

    const hasMore = Boolean(res.json?.has_more);
    const nextToken =
      typeof res.json?.next_page === "string" && res.json.next_page.trim()
        ? res.json.next_page.trim()
        : null;

    if (!hasMore || !nextToken || nextToken === nextPage) {
      break;
    }
    nextPage = nextToken;
  }

  return {
    ok: true,
    status: 200,
    buckets,
    pagesFetched,
    organizationIdHeader,
  };
}

async function discoverOrgIdentityFromKey(
  apiKey: string,
  fetchImpl: FetchLike
): Promise<{ id: string | null; name: string | null }> {
  if (!apiKey) return { id: null, name: null };
  const cached = orgIdentityCache.get(apiKey);
  if (cached && cached.id) return cached;

  const res = await fetchAnthropicWithRetry(
    `${ANTHROPIC_API_BASE}/v1/organizations/me`,
    apiKey,
    fetchImpl
  );
  if (res.ok && res.json?.id) {
    const info = {
      id: String(res.json.id),
      name: res.json.name ? String(res.json.name) : null,
    };
    orgIdentityCache.set(apiKey, info);
    return info;
  }
  const headerOrg = res.headers?.get?.("anthropic-organization-id") || null;
  if (headerOrg) {
    const info = { id: headerOrg, name: null };
    orgIdentityCache.set(apiKey, info);
    return info;
  }
  return { id: null, name: null };
}

async function discoverWorkspacesAndKeys(
  adminApiKey: string,
  fetchImpl: FetchLike
): Promise<{
  workspacesMap: Map<string, string>;
  apiKeysMap: Map<string, { name: string; workspaceId: string | null }>;
}> {
  const workspacesMap = new Map<string, string>();
  const apiKeysMap = new Map<
    string,
    { name: string; workspaceId: string | null }
  >();
  if (!adminApiKey) return { workspacesMap, apiKeysMap };

  const [wsRes, keysRes] = await Promise.all([
    fetchAnthropicWithRetry(
      `${ANTHROPIC_API_BASE}/v1/organizations/workspaces?limit=100`,
      adminApiKey,
      fetchImpl
    ),
    fetchAnthropicWithRetry(
      `${ANTHROPIC_API_BASE}/v1/organizations/api_keys?limit=100`,
      adminApiKey,
      fetchImpl
    ),
  ]);

  if (wsRes.ok && Array.isArray(wsRes.json?.data)) {
    for (const w of wsRes.json.data) {
      if (w?.id) {
        workspacesMap.set(String(w.id), String(w.name || w.id));
      }
    }
  }
  if (keysRes.ok && Array.isArray(keysRes.json?.data)) {
    for (const k of keysRes.json.data) {
      if (k?.id) {
        apiKeysMap.set(String(k.id), {
          name: String(k.name || k.id),
          workspaceId: k.workspace_id ? String(k.workspace_id) : null,
        });
      }
    }
  }

  return { workspacesMap, apiKeysMap };
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

async function loadSavedBillingConfigFromDb(): Promise<Record<string, string>> {
  try {
    await ensureDatabasesBootstrapped();
    const auth = getRawLibSqlClient("core_auth");
    const row = await auth.execute(
      `SELECT value_json FROM setup_state WHERE key = 'anthropic_billing_config' LIMIT 1`
    );
    if (row.rows[0]?.value_json) {
      const parsed = JSON.parse(String(row.rows[0].value_json));
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, string>;
      }
    }
  } catch {
    // Non-blocking
  }
  return {};
}

export async function saveAnthropicBillingConfigToDb(
  config: Record<string, string | boolean | null | undefined>
): Promise<void> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const existing = await loadSavedBillingConfigFromDb();
  const merged: Record<string, string> = { ...existing };
  for (const [k, v] of Object.entries(config)) {
    if (v === undefined) continue;
    if (v === null || v === "") {
      delete merged[k];
    } else {
      merged[k] = String(v).trim();
    }
  }
  await auth.execute({
    sql: `INSERT INTO setup_state (key, value_json, updated_at)
          VALUES ('anthropic_billing_config', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    args: [JSON.stringify(merged), new Date().toISOString()],
  });
  clearAnthropicUsageReportCache();
}

function normalizeDateDayUtc(isoTimestamp: string): string {
  const m = String(isoTimestamp || "").match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(isoTimestamp);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return String(isoTimestamp || "").slice(0, 10);
}

function aggregateUsageForTarget(params: {
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

function aggregateCostForWorkspace(params: {
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
  const [clientRuntime, adminRuntime] = params.overrides?.acrioRuntimeApiKey !== undefined
    ? [
        { apiKey: params.overrides.acrioRuntimeApiKey || "", source: "env" },
        { apiKey: params.overrides.acroRuntimeApiKey || "", source: "env" },
      ]
    : await Promise.all([
        resolveSharedAnthropicApiKey("client"),
        resolveSharedAnthropicApiKey("admin"),
      ]);

  const ov = params.overrides || {};

  // Resolve Admin API keys (must start with sk-ant-admin...)
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

  let acrioApiKeyId =
    (
      ov.acrioApiKeyId ??
      savedDbCfg.ACRIO_ANTHROPIC_API_KEY_ID ??
      process.env.ACRIO_ANTHROPIC_API_KEY_ID ??
      ""
    ).trim() || null;

  let acroApiKeyId =
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

  // Discover organization IDs from configured keys
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

  // Fetch org report helper with short server-side cache & stale fallback
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
    const existing = orgReportCache.get(cacheKey);
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
    orgReportCache.set(cacheKey, freshEntry);

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
    const [r1, r2] = await Promise.all([
      acrioHasValidAdminKey
        ? loadOrgReport(
            acrioOrgId || "acrio-org",
            acrioAdminApiKey,
            acrioOrgDiscovered
          )
        : Promise.resolve({
            entry: null,
            cacheHit: false,
            isStale: false,
            error: null,
          }),
      acroHasValidAdminKey
        ? loadOrgReport(
            acroOrgId || "acro-org",
            acroAdminApiKey,
            acroOrgDiscovered
          )
        : Promise.resolve({
            entry: null,
            cacheHit: false,
            isStale: false,
            error: null,
          }),
    ]);
    acrioOrgReport = r1;
    acroOrgReport = r2;
  }

  // If API key IDs exist in the discovered apiKeysMap and workspace ID wasn't explicitly set, infer workspaceId from the API key metadata
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

  // Detect if a workspace also has other active API keys in usage_report beyond Acrio and Acro
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

  const acrioOtherKeys = detectUnrelatedKeysInWorkspace(
    acrioOrgReport.entry,
    acrioWorkspaceId
  );
  const acroOtherKeys = detectUnrelatedKeysInWorkspace(
    acroOrgReport.entry,
    acroWorkspaceId
  );

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
    adminApiKeyPrefix: acrioHasValidAdminKey
      ? maskKeyPrefix(acrioAdminApiKey)
      : null,
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
    adminApiKeyPrefix: acroHasValidAdminKey
      ? maskKeyPrefix(acroAdminApiKey)
      : null,
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

  const buildIntegrationSummary = (
    integration: "ACRIO" | "ACRO",
    identity: IntegrationBillingIdentity,
    orgReport: Awaited<ReturnType<typeof loadOrgReport>>
  ): IntegrationUsageAndSpendSummary => {
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

    // 1. Token Usage Attribution (by api_key_id, or workspace_id when api_key_id is not set and workspaces are separate)
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

    // 2. Spend Attribution (by workspace_id)
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
  };

  const acrioSummary = buildIntegrationSummary(
    "ACRIO",
    acrioIdentity,
    acrioOrgReport
  );
  const acroSummary = buildIntegrationSummary(
    "ACRO",
    acroIdentity,
    acroOrgReport
  );

  // Build Shared Workspace Spend summary if both share a workspace
  let sharedWorkspaceSpend: SharedWorkspaceSpendSummary | null = null;
  if (isSharedWorkspace && acrioWorkspaceId && acrioOrgReport.entry) {
    const sharedCost = aggregateCostForWorkspace({
      buckets: acrioOrgReport.entry.costBuckets,
      targetWorkspaceId: acrioWorkspaceId,
      allowOrgTotalWhenNull: false,
    });
    const servesOthers =
      acrioSharedWithOthers ||
      acroSharedWithOthers ||
      acrioOtherKeys.length > 0;
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

  // Compute organization-wide total spend & unattributed tokens if an org report is loaded
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
    if (!acrioHasValidAdminKey) {
      missingVariables.push("ACRIO_ANTHROPIC_ORG_ADMIN_API_KEY");
    }
    if (!acroHasValidAdminKey) {
      missingVariables.push("ACRO_ANTHROPIC_ORG_ADMIN_API_KEY");
    }
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
    acrioOrgReport.entry?.fetchedAtUtc ||
    acroOrgReport.entry?.fetchedAtUtc ||
    null;

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
        `1. Generate an Organization Admin API key (starts with "sk-ant-admin...") in Anthropic Console -> Settings -> Admin Keys for Organization "${acrioIdentity.organizationName || "AL’s Individual Org"}" (${acrioIdentity.organizationId || "6411698a-79d6-49be-a4e0-a7c9c4cfc8b1"}).`,
        `2. Set ANTHROPIC_ORG_ADMIN_API_KEY="sk-ant-admin..." in .env (or set ACRIO_ANTHROPIC_ORG_ADMIN_API_KEY and ACRO_ANTHROPIC_ORG_ADMIN_API_KEY if using separate organizations).`,
        `3. Set ACRIO_ANTHROPIC_WORKSPACE_ID="wrkspc_..." and ACRO_ANTHROPIC_WORKSPACE_ID="wrkspc_..." to attribute daily USD spend from GET /v1/organizations/cost_report.`,
        `4. Set ACRIO_ANTHROPIC_API_KEY_ID="apikey_..." (for runtime key ${acrioIdentity.runtimeKeyPrefix || "ANTHROPIC_CLIENT_API_KEY"}) and ACRO_ANTHROPIC_API_KEY_ID="apikey_..." (for runtime key ${acroIdentity.runtimeKeyPrefix || "ANTHROPIC_ADMIN_API_KEY"}) to attribute token usage from GET /v1/organizations/usage_report/messages.`,
      ],
    },
    warnings,
  };
}
