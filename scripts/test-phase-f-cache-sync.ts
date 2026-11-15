import assert from "node:assert/strict";
import { syncEcosystemRedisCache } from "../packages/connections/src/index";
import { POST as cacheSyncPost } from "../apps/web/src/app/api/cache/sync/route";

async function main() {
  console.log("=== Phase F Regression Tests: WhatsApp Hub Cross-App Cache Sync & Bridge Security ===");

  // 1. Direct selective brand cache invalidation via syncEcosystemRedisCache
  const ccSync = await syncEcosystemRedisCache({ brand: "CLASSIC_CONCEPTS" });
  assert.equal(ccSync.invalidatedBrand, "CLASSIC_CONCEPTS");
  assert.ok(ccSync.classicConceptsCount > 0, "Expected Classic Concepts products loaded after sync");

  const ceSync = await syncEcosystemRedisCache({ brand: "CLASSIC_EDGE_53" });
  assert.equal(ceSync.invalidatedBrand, "CLASSIC_EDGE_53");
  assert.ok(
    ceSync.classicEdgeMachinesCount + ceSync.classicEdgeConsumablesCount > 0,
    "Expected Classic Edge 53 items loaded after sync"
  );
  console.log("[PASS] 1. Selective brand cache sync (CLASSIC_CONCEPTS & CLASSIC_EDGE_53) verified.");

  // 2. Unauthenticated POST /api/cache/sync without bridge key must return 403
  const unauthReq = new Request("http://127.0.0.1:3007/api/cache/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sync", brand: "CLASSIC_CONCEPTS" }),
  });
  const unauthRes = await cacheSyncPost(unauthReq);
  assert.equal(unauthRes.status, 403, `Expected 403 without bridge key, got ${unauthRes.status}`);
  console.log("[PASS] 2. Unauthenticated POST /api/cache/sync without bridge key rejected with HTTP 403.");

  // 3. Bridge-authorized POST /api/cache/sync from Classic Concepts & Classic Edge 53 succeeds
  const bridgeKey = (process.env.CC_ECOSYSTEM_BRIDGE_KEY || "cc_internal_bridge_2026").trim();
  const ccBridgeReq = new Request("http://127.0.0.1:3007/api/cache/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cc-bridge-key": bridgeKey,
    },
    body: JSON.stringify({
      action: "sync",
      brand: "CLASSIC_CONCEPTS",
      reason: "test_phase_f_acro_save",
    }),
  });
  const ccBridgeRes = await cacheSyncPost(ccBridgeReq);
  assert.equal(ccBridgeRes.status, 200);
  const ccBridgeJson = await ccBridgeRes.json();
  assert.equal(ccBridgeJson.ok, true);
  assert.equal(ccBridgeJson.source, "ecosystem-bridge");
  assert.equal(ccBridgeJson.invalidatedBrand, "CLASSIC_CONCEPTS");
  console.log("[PASS] 3. Authenticated ecosystem-bridge POST /api/cache/sync invalidated & warmed catalog cache.");

  // 4. Bridge key must NOT be allowed to call action="save_ai_key" (admin session strictly required)
  const forbiddenKeySaveReq = new Request("http://127.0.0.1:3007/api/cache/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cc-bridge-key": bridgeKey,
    },
    body: JSON.stringify({
      action: "save_ai_key",
      anthropicApiKey: "sk-ant-test-should-be-blocked",
    }),
  });
  const forbiddenKeySaveRes = await cacheSyncPost(forbiddenKeySaveReq);
  assert.equal(
    forbiddenKeySaveRes.status,
    403,
    "Bridge header must never be allowed to overwrite Anthropic API keys"
  );
  console.log("[PASS] 4. Bridge key blocked from action='save_ai_key' with HTTP 403.");

  console.log("=== ALL PHASE F WHATSAPP HUB CACHE SYNC TESTS PASSED ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Phase F WhatsApp Hub cache sync test failed:", err);
  process.exit(1);
});
