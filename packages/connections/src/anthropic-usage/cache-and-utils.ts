import type {
  CachedOrgReportEntry,
  IntegrationBillingIdentity,
  RawAnthropicCostResultItem,
  RawAnthropicUsageResultItem,
  TokenMetrics,
  UsagePresetRange,
} from "./types";

export const REPORT_CACHE_TTL_MS = 5 * 60 * 1000;
const IDENTITY_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_REPORT_CACHE_ENTRIES = 100;
const MAX_IDENTITY_CACHE_ENTRIES = 100;

interface CachedIdentityEntry {
  id: string | null;
  name: string | null;
  cachedAtMs: number;
}

const orgReportCache = new Map<string, CachedOrgReportEntry>();
const orgIdentityCache = new Map<string, CachedIdentityEntry>();

function setBoundedLru<V>(map: Map<string, V>, key: string, value: V, maxEntries: number): void {
  if (map.has(key)) {
    map.delete(key);
  }
  while (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
  map.set(key, value);
}

export function getCachedOrgReport(key: string): CachedOrgReportEntry | undefined {
  const entry = orgReportCache.get(key);
  if (!entry) return undefined;
  // Refresh LRU order
  orgReportCache.delete(key);
  orgReportCache.set(key, entry);
  return entry;
}

export function setCachedOrgReport(key: string, entry: CachedOrgReportEntry): void {
  setBoundedLru(orgReportCache, key, entry, MAX_REPORT_CACHE_ENTRIES);
}

export function getCachedOrgIdentity(
  apiKey: string
): { id: string | null; name: string | null } | undefined {
  const entry = orgIdentityCache.get(apiKey);
  if (!entry) return undefined;
  if (Date.now() - entry.cachedAtMs > IDENTITY_CACHE_TTL_MS) {
    orgIdentityCache.delete(apiKey);
    return undefined;
  }
  orgIdentityCache.delete(apiKey);
  orgIdentityCache.set(apiKey, entry);
  return { id: entry.id, name: entry.name };
}

export function setCachedOrgIdentity(
  apiKey: string,
  info: { id: string | null; name: string | null }
): void {
  setBoundedLru(
    orgIdentityCache,
    apiKey,
    { id: info.id, name: info.name, cachedAtMs: Date.now() },
    MAX_IDENTITY_CACHE_ENTRIES
  );
}

export function clearAnthropicUsageReportCache(): void {
  orgReportCache.clear();
  orgIdentityCache.clear();
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

export function maskKeyPrefix(key: string | null | undefined): string | null {
  const clean = String(key || "").trim();
  if (!clean) return null;
  if (clean.length <= 16) return `${clean.slice(0, 6)}...`;
  return `${clean.slice(0, 14)}...${clean.slice(-4)}`;
}

export function classifyKeyType(
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
    const start30 = new Date(todayTomorrowUtc.getTime() - 30 * 24 * 3600 * 1000);
    return {
      preset: "30d",
      startingAtUtc: start30.toISOString().replace(/\.\d{3}Z$/, "Z"),
      endingAtUtc: todayTomorrowUtc.toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
  }

  const startMtd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  );
  return {
    preset: "mtd",
    startingAtUtc: startMtd.toISOString().replace(/\.\d{3}Z$/, "Z"),
    endingAtUtc: todayTomorrowUtc.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

export function normalizeDateDayUtc(isoTimestamp: string): string {
  const m = String(isoTimestamp || "").match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(isoTimestamp);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return String(isoTimestamp || "").slice(0, 10);
}
