import assert from "node:assert/strict";
import { isDevRole } from "../packages/rbac/src/index";
import {
  clearAnthropicUsageReportCache,
  convertAnthropicCostItemToUsd,
  extractTokenMetricsFromUsageItem,
  fetchPaginatedAnthropicReport,
  getClaudeUsageAndSpendComparison,
  type FetchLike,
} from "../packages/connections/src/index";
import { GET as getClaudeUsageRoute } from "../apps/web/src/app/api/dev/claude-usage/route";

async function main() {
  console.log("=== Phase I: Claude API Usage & Spend (Acrio vs Acro) Verification ===");

  // 1. Developer Authorization Check
  console.log("\n1. Verifying Developer-Only Authorization...");
  assert.equal(isDevRole("DEV"), true, "DEV role must be authorized");
  for (const nonDev of ["SUPERADMIN", "ADMIN", "MANAGER", "AGENT", "CLIENT"] as const) {
    assert.equal(isDevRole(nonDev), false, `${nonDev} must NOT pass isDevRole`);
  }
  const unauthRes = await getClaudeUsageRoute(
    new Request("http://localhost:3000/api/dev/claude-usage?preset=mtd")
  );
  assert.equal(
    unauthRes.status,
    403,
    "Unauthenticated request to /api/dev/claude-usage must return HTTP 403"
  );
  console.log("   [PASS] Developer-only authorization enforced (403 for non-DEV).");

  // 2. USD Cent Conversion & Token Extraction Check
  console.log("\n2. Verifying USD Cent Conversion & Token Metrics Extraction...");
  const c1 = convertAnthropicCostItemToUsd({ amount: "1425.50", currency: "USD" });
  assert.equal(c1.amountCents, 1425.5);
  assert.equal(c1.spendUsd, 14.255);

  const c2 = convertAnthropicCostItemToUsd({ amount: "8.75", currency: "USD" });
  assert.equal(c2.amountCents, 8.75);
  assert.equal(c2.spendUsd, 0.0875);

  const c3 = convertAnthropicCostItemToUsd({ amount: "0", currency: "USD" });
  assert.equal(c3.amountCents, 0);
  assert.equal(c3.spendUsd, 0);

  const tm = extractTokenMetricsFromUsageItem({
    uncached_input_tokens: 12000,
    output_tokens: 3400,
    cache_read_input_tokens: 85000,
    cache_creation: {
      ephemeral_5m_input_tokens: 5000,
      ephemeral_1h_input_tokens: 2500,
    },
  });
  assert.equal(tm.inputTokens, 12000);
  assert.equal(tm.outputTokens, 3400);
  assert.equal(tm.cacheReadTokens, 85000);
  assert.equal(tm.cacheWriteTokens, 7500);
  assert.equal(tm.totalTokens, 107900);
  console.log("   [PASS] USD cents -> USD conversion & 5m+1h cache-write token math verified.");

  // 3. Multi-Page Cursor Pagination Check
  console.log("\n3. Verifying Multi-Page Cursor Pagination...");
  let pageCalls = 0;
  const paginatedMockFetch: FetchLike = async (input) => {
    const url = String(input);
    pageCalls++;
    const parsedUrl = new URL(url);
    const page = parsedUrl.searchParams.get("page");
    if (!page) {
      return new Response(
        JSON.stringify({
          data: [{ starting_at: "2026-11-01T00:00:00Z", ending_at: "2026-11-02T00:00:00Z" }],
          has_more: true,
          next_page: "cursor_page_2",
        }),
        { status: 200, headers: { "anthropic-organization-id": "org_test_123" } }
      );
    }
    if (page === "cursor_page_2") {
      return new Response(
        JSON.stringify({
          data: [{ starting_at: "2026-11-02T00:00:00Z", ending_at: "2026-11-03T00:00:00Z" }],
          has_more: true,
          next_page: "cursor_page_3",
        }),
        { status: 200, headers: { "anthropic-organization-id": "org_test_123" } }
      );
    }
    return new Response(
      JSON.stringify({
        data: [{ starting_at: "2026-11-03T00:00:00Z", ending_at: "2026-11-04T00:00:00Z" }],
        has_more: false,
        next_page: null,
      }),
      { status: 200, headers: { "anthropic-organization-id": "org_test_123" } }
    );
  };

  const pagedRes = await fetchPaginatedAnthropicReport({
    endpointPath: "/v1/organizations/usage_report/messages",
    adminApiKey: "sk-ant-admin01-test-key",
    startingAtUtc: "2026-11-01T00:00:00Z",
    endingAtUtc: "2026-11-04T00:00:00Z",
    groupBy: ["api_key_id", "workspace_id", "model"],
    fetchImpl: paginatedMockFetch,
  });
  assert.equal(pagedRes.ok, true);
  assert.equal(pagedRes.pagesFetched, 3);
  assert.equal(pagedRes.buckets.length, 3);
  assert.equal(pageCalls, 3);
  console.log("   [PASS] Multi-page cursor pagination followed 3 pages and merged all buckets.");

  // 4. Separate Workspaces Attribution + Unrelated Integration Detection
  console.log("\n4. Verifying Separate Workspaces Attribution (Acrio vs Acro)...");
  clearAnthropicUsageReportCache();
  const separateWsMockFetch: FetchLike = async (input) => {
    const url = String(input);
    if (url.includes("/v1/organizations/me")) {
      return new Response(
        JSON.stringify({
          id: "6411698a-79d6-49be-a4e0-a7c9c4cfc8b1",
          type: "organization",
          name: "AL’s Individual Org",
        }),
        { status: 200 }
      );
    }
    if (url.includes("/v1/organizations/workspaces")) {
      return new Response(
        JSON.stringify({
          data: [
            { id: "wrkspc_acrio_prod", name: "Acrio WhatsApp Support" },
            { id: "wrkspc_acro_admin", name: "Acro Admin Workspace" },
          ],
        }),
        { status: 200 }
      );
    }
    if (url.includes("/v1/organizations/api_keys")) {
      return new Response(
        JSON.stringify({
          data: [
            { id: "apikey_acrio_01", name: "acrio-whatsapp-key", workspace_id: "wrkspc_acrio_prod" },
            { id: "apikey_acro_02", name: "acro-admin-key", workspace_id: "wrkspc_acro_admin" },
            { id: "apikey_unrelated_99", name: "other-script-key", workspace_id: "wrkspc_acro_admin" },
          ],
        }),
        { status: 200 }
      );
    }
    if (url.includes("/v1/organizations/usage_report/messages")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              starting_at: "2026-11-15T00:00:00Z",
              ending_at: "2026-11-16T00:00:00Z",
              results: [
                {
                  api_key_id: "apikey_acrio_01",
                  workspace_id: "wrkspc_acrio_prod",
                  model: "claude-haiku-5-5",
                  uncached_input_tokens: 45000,
                  output_tokens: 12000,
                  cache_read_input_tokens: 310000,
                  cache_creation: { ephemeral_5m_input_tokens: 15000, ephemeral_1h_input_tokens: 0 },
                },
                {
                  api_key_id: "apikey_acro_02",
                  workspace_id: "wrkspc_acro_admin",
                  model: "claude-haiku-5-5",
                  uncached_input_tokens: 8000,
                  output_tokens: 2500,
                  cache_read_input_tokens: 20000,
                  cache_creation: { ephemeral_5m_input_tokens: 4000, ephemeral_1h_input_tokens: 1000 },
                },
                {
                  api_key_id: "apikey_unrelated_99",
                  workspace_id: "wrkspc_acro_admin",
                  model: "claude-sonnet-4-5",
                  uncached_input_tokens: 5000,
                  output_tokens: 1000,
                  cache_read_input_tokens: 0,
                  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
                },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        }),
        { status: 200 }
      );
    }
    if (url.includes("/v1/organizations/cost_report")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              starting_at: "2026-11-15T00:00:00Z",
              ending_at: "2026-11-16T00:00:00Z",
              results: [
                {
                  workspace_id: "wrkspc_acrio_prod",
                  description: "claude-haiku-5-5",
                  amount: "345.20", // 345.20 cents = $3.452 USD
                  currency: "USD",
                },
                {
                  workspace_id: "wrkspc_acro_admin",
                  description: "claude-haiku-5-5",
                  amount: "112.80", // 112.80 cents = $1.128 USD
                  currency: "USD",
                },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        }),
        { status: 200 }
      );
    }
    return new Response("Not Found", { status: 404 });
  };

  const sepReport = await getClaudeUsageAndSpendComparison({
    preset: "mtd",
    overrides: {
      sharedOrgAdminApiKey: "sk-ant-admin01-mock-separate",
      acrioWorkspaceId: "wrkspc_acrio_prod",
      acroWorkspaceId: "wrkspc_acro_admin",
      acrioApiKeyId: "apikey_acrio_01",
      acroApiKeyId: "apikey_acro_02",
    },
    fetchImpl: separateWsMockFetch,
  });

  assert.equal(sepReport.spendAttributionMode, "SEPARATE_WORKSPACES");
  assert.equal(sepReport.overallStatus, "LIVE_OK");
  assert.equal(sepReport.acrio.perKeySpendAvailable, true);
  assert.equal(sepReport.acrio.totalSpendUsd, 3.452);
  assert.equal(sepReport.acrio.totalSpendCents, 345.2);
  assert.equal(sepReport.acrio.tokens.inputTokens, 45000);
  assert.equal(sepReport.acrio.tokens.outputTokens, 12000);
  assert.equal(sepReport.acrio.tokens.cacheReadTokens, 310000);
  assert.equal(sepReport.acrio.tokens.cacheWriteTokens, 15000);

  // Acro workspace also had apikey_unrelated_99 active -> must be flagged as shared with unrelated integrations!
  assert.equal(sepReport.acro.identity.sharedWithUnrelatedIntegrations, true);
  assert.equal(sepReport.acro.perKeySpendAvailable, false);
  assert.equal(sepReport.acro.totalSpendUsd, 1.128);
  assert.match(sepReport.acro.spendLabel, /Workspace Total.*Includes Other Integrations/i);
  // Acro's token usage must ONLY include apikey_acro_02 (not apikey_unrelated_99!)
  assert.equal(sepReport.acro.tokens.inputTokens, 8000);
  assert.equal(sepReport.acro.tokens.outputTokens, 2500);
  assert.equal(sepReport.acro.tokens.cacheWriteTokens, 5000);
  console.log("   [PASS] Separate workspaces & unrelated-integration workspace total labeling verified.");

  // 5. Shared Workspace Behavior Check
  console.log("\n5. Verifying Shared Workspace Behavior (Per-Key Usage + Combined Workspace Spend)...");
  clearAnthropicUsageReportCache();
  const sharedWsMockFetch: FetchLike = async (input) => {
    const url = String(input);
    if (url.includes("/v1/organizations/me")) {
      return new Response(
        JSON.stringify({
          id: "6411698a-79d6-49be-a4e0-a7c9c4cfc8b1",
          type: "organization",
          name: "AL’s Individual Org",
        }),
        { status: 200 }
      );
    }
    if (url.includes("/v1/organizations/workspaces")) {
      return new Response(
        JSON.stringify({
          data: [{ id: "wrkspc_shared_default", name: "Default Workspace" }],
        }),
        { status: 200 }
      );
    }
    if (url.includes("/v1/organizations/api_keys")) {
      return new Response(
        JSON.stringify({
          data: [
            { id: "apikey_acrio_01", name: "acrio-client", workspace_id: "wrkspc_shared_default" },
            { id: "apikey_acro_02", name: "acro-admin", workspace_id: "wrkspc_shared_default" },
          ],
        }),
        { status: 200 }
      );
    }
    if (url.includes("/v1/organizations/usage_report/messages")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              starting_at: "2026-11-15T00:00:00Z",
              ending_at: "2026-11-16T00:00:00Z",
              results: [
                {
                  api_key_id: "apikey_acrio_01",
                  workspace_id: "wrkspc_shared_default",
                  model: "claude-haiku-5-5",
                  uncached_input_tokens: 25000,
                  output_tokens: 6000,
                  cache_read_input_tokens: 150000,
                  cache_creation: { ephemeral_5m_input_tokens: 8000 },
                },
                {
                  api_key_id: "apikey_acro_02",
                  workspace_id: "wrkspc_shared_default",
                  model: "claude-haiku-5-5",
                  uncached_input_tokens: 4000,
                  output_tokens: 1200,
                  cache_read_input_tokens: 10000,
                  cache_creation: { ephemeral_5m_input_tokens: 2000 },
                },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        }),
        { status: 200 }
      );
    }
    if (url.includes("/v1/organizations/cost_report")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              starting_at: "2026-11-15T00:00:00Z",
              ending_at: "2026-11-16T00:00:00Z",
              results: [
                {
                  workspace_id: "wrkspc_shared_default",
                  description: "claude-haiku-5-5",
                  amount: "489.00", // $4.89 USD combined
                  currency: "USD",
                },
              ],
            },
          ],
          has_more: false,
          next_page: null,
        }),
        { status: 200 }
      );
    }
    return new Response("Not Found", { status: 404 });
  };

  const sharedReport = await getClaudeUsageAndSpendComparison({
    preset: "7d",
    overrides: {
      sharedOrgAdminApiKey: "sk-ant-admin01-mock-shared",
      acrioWorkspaceId: "wrkspc_shared_default",
      acroWorkspaceId: "wrkspc_shared_default",
      acrioApiKeyId: "apikey_acrio_01",
      acroApiKeyId: "apikey_acro_02",
    },
    fetchImpl: sharedWsMockFetch,
  });

  assert.equal(sharedReport.spendAttributionMode, "SHARED_WORKSPACE");
  assert.equal(sharedReport.acrio.perKeySpendAvailable, false);
  assert.equal(sharedReport.acro.perKeySpendAvailable, false);
  assert.equal(sharedReport.acrio.totalSpendUsd, null);
  assert.equal(sharedReport.acro.totalSpendUsd, null);
  assert.equal(sharedReport.acrio.spendStatus, "UNAVAILABLE_ATTRIBUTION");
  assert.equal(sharedReport.acro.spendStatus, "UNAVAILABLE_ATTRIBUTION");
  // Per-key usage must still be attributed accurately!
  assert.equal(sharedReport.acrio.tokens.totalTokens, 189000);
  assert.equal(sharedReport.acro.tokens.totalTokens, 17200);
  // Shared workspace combined spend must be populated!
  assert.ok(sharedReport.sharedWorkspaceSpend);
  assert.equal(sharedReport.sharedWorkspaceSpend.totalSpendUsd, 4.89);
  assert.equal(sharedReport.sharedWorkspaceSpend.totalSpendCents, 489);
  console.log("   [PASS] Shared workspace behavior verified (per-key spend marked unavailable, combined workspace spend=$4.89, per-key tokens separated).");

  // 6. Server-Side Cache & Stale-Data Fallback Check
  console.log("\n6. Verifying 5-Minute Server Cache & Stale Data Fallback on Upstream Failure...");
  const cachedHitReport = await getClaudeUsageAndSpendComparison({
    preset: "7d",
    overrides: {
      sharedOrgAdminApiKey: "sk-ant-admin01-mock-shared",
      acrioWorkspaceId: "wrkspc_shared_default",
      acroWorkspaceId: "wrkspc_shared_default",
      acrioApiKeyId: "apikey_acrio_01",
      acroApiKeyId: "apikey_acro_02",
    },
    fetchImpl: async () => new Response("Should not be called on cache hit", { status: 500 }),
  });
  assert.equal(cachedHitReport.cacheHit, true);
  assert.equal(cachedHitReport.isStale, false);

  const staleReport = await getClaudeUsageAndSpendComparison({
    preset: "7d",
    forceRefresh: true,
    overrides: {
      sharedOrgAdminApiKey: "sk-ant-admin01-mock-shared",
      acrioWorkspaceId: "wrkspc_shared_default",
      acroWorkspaceId: "wrkspc_shared_default",
      acrioApiKeyId: "apikey_acrio_01",
      acroApiKeyId: "apikey_acro_02",
    },
    fetchImpl: async (input) => {
      if (String(input).includes("/v1/organizations/me")) {
        return new Response(JSON.stringify({ id: "6411698a-79d6-49be-a4e0-a7c9c4cfc8b1" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ error: { message: "Temporary upstream 503 overload" } }),
        { status: 503 }
      );
    },
  });
  assert.equal(staleReport.isStale, true);
  assert.equal(staleReport.overallStatus, "STALE_DATA");
  assert.equal(staleReport.acrio.usageStatus, "STALE_DATA");
  console.log("   [PASS] Server-side cache hit and stale-on-error fallback verified.");

  // 7. Separate Organizations + Zero Usage Check
  console.log("\n7. Verifying Separate Organizations & Zero Usage State...");
  clearAnthropicUsageReportCache();
  const multiOrgZeroMockFetch: FetchLike = async () =>
    new Response(
      JSON.stringify({
        data: [],
        has_more: false,
        next_page: null,
      }),
      { status: 200 }
    );

  const zeroReport = await getClaudeUsageAndSpendComparison({
    preset: "30d",
    overrides: {
      acrioAdminApiKey: "sk-ant-admin01-org-A-key",
      acroAdminApiKey: "sk-ant-admin01-org-B-key",
      acrioOrgId: "org_acrio_separate_A",
      acroOrgId: "org_acro_separate_B",
      acrioWorkspaceId: "wrkspc_A",
      acroWorkspaceId: "wrkspc_B",
      acrioApiKeyId: "apikey_A",
      acroApiKeyId: "apikey_B",
    },
    fetchImpl: multiOrgZeroMockFetch,
  });
  assert.equal(zeroReport.sameOrganization, false);
  assert.equal(zeroReport.overallStatus, "ZERO_USAGE");
  assert.equal(zeroReport.acrio.usageStatus, "ZERO_USAGE");
  assert.equal(zeroReport.acrio.spendStatus, "ZERO_USAGE");
  assert.equal(zeroReport.acrio.totalSpendUsd, 0);
  assert.equal(zeroReport.acro.totalSpendUsd, 0);
  console.log("   [PASS] Separate organizations & ZERO_USAGE state verified.");

  // 8. Live Environment Inspection (Verifying current .env keys & Organization discovery)
  console.log("\n8. Verifying Live Environment Configuration & Auto-Discovered Organization...");
  clearAnthropicUsageReportCache();
  const liveReport = await getClaudeUsageAndSpendComparison({ preset: "mtd" });
  console.log("   Live Org ID (Acrio):", liveReport.acrio.identity.organizationId, "| Name:", liveReport.acrio.identity.organizationName);
  console.log("   Live Org ID (Acro):", liveReport.acro.identity.organizationId, "| Name:", liveReport.acro.identity.organizationName);
  console.log("   Live Overall Status:", liveReport.overallStatus);
  console.log("   Missing Env Vars:", liveReport.requiredEnvConfigGuide.missingVariables);
  assert.equal(liveReport.acrio.identity.organizationId, "6411698a-79d6-49be-a4e0-a7c9c4cfc8b1");
  assert.equal(liveReport.acro.identity.organizationId, "6411698a-79d6-49be-a4e0-a7c9c4cfc8b1");
  assert.equal(liveReport.sameOrganization, true);
  assert.equal(liveReport.overallStatus, "MISSING_CONFIG");
  assert.ok(liveReport.requiredEnvConfigGuide.missingVariables.includes("ANTHROPIC_ORG_ADMIN_API_KEY"));

  console.log("\nALL PHASE I CLAUDE USAGE & SPEND CHECKS PASSED!");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
