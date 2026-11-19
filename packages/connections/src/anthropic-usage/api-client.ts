import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import {
  clearAnthropicUsageReportCache,
  getCachedOrgIdentity,
  setCachedOrgIdentity,
} from "./cache-and-utils";
import type { FetchLike } from "./types";

const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_PAGINATION_PAGES = 50;

export async function fetchAnthropicWithRetry(
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
    qs.set("limit", params.limit ? String(params.limit) : "31");
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

export async function discoverOrgIdentityFromKey(
  apiKey: string,
  fetchImpl: FetchLike
): Promise<{ id: string | null; name: string | null }> {
  if (!apiKey) return { id: null, name: null };
  const cached = getCachedOrgIdentity(apiKey);
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
    setCachedOrgIdentity(apiKey, info);
    return info;
  }
  const headerOrg = res.headers?.get?.("anthropic-organization-id") || null;
  if (headerOrg) {
    const info = { id: headerOrg, name: null };
    setCachedOrgIdentity(apiKey, info);
    return info;
  }
  return { id: null, name: null };
}

export async function discoverWorkspacesAndKeys(
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

export async function loadSavedBillingConfigFromDb(): Promise<Record<string, string>> {
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
