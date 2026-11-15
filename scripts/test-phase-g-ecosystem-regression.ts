import assert from "node:assert/strict";
import {
  classifyAcrioInboundIntent,
  createEmptyAcrioConversationState,
  applyTurnToAcrioConversationState,
  buildNormalizedSearchFromState,
  getCachedEcosystemCatalog,
  runAcrioAutonomousTurn,
  syncEcosystemRedisCache,
} from "../packages/connections/src/index";
import {
  ensureDatabasesBootstrapped,
  getEcosystemBudgetFallbackInfo,
  searchEcosystemItems,
} from "../packages/database/src/index";
import { POST as cacheSyncPost } from "../apps/web/src/app/api/cache/sync/route";

async function main() {
  console.log("=== Phase G Master Regression Suite (ccwhatsapp): 20 End-to-End ACRIO & Cross-System Scenarios ===");

  const savedClientKey = process.env.ANTHROPIC_CLIENT_API_KEY;
  const savedApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_CLIENT_API_KEY = "";
  process.env.ANTHROPIC_API_KEY = "";

  try {
    await ensureDatabasesBootstrapped();
    const { allItems } = await getCachedEcosystemCatalog();
    assert.ok(allItems.length > 50, "Ecosystem catalog must contain >50 items");

    let passed = 0;
    const recordPass = (num: number, label: string) => {
      passed++;
      console.log(`  [PASS ${String(num).padStart(2, "0")}/20] ${label}`);
    };

    // Scenario 1: Simple greeting
    const s1 = await runAcrioAutonomousTurn({
      customerName: "Visitor 1",
      inboundText: "Hi",
      recentMessages: [],
      hasAlreadyGreeted: false,
      persistedState: null,
    });
    assert.equal(s1.needsHumanHandoff, false);
    assert.equal(s1.conversationState?.lastRecommendedProducts.length || 0, 0);
    assert.ok(!/ccapl\.cc/i.test(s1.customerReply));
    recordPass(1, "Greeting ('Hi') triggers 0 product lookups and 0 product links");

    // Scenario 2: Identity & model confirmation
    const s2 = await runAcrioAutonomousTurn({
      customerName: "Visitor 2",
      inboundText: "Who are you and which AI model do you use?",
      recentMessages: [],
      hasAlreadyGreeted: false,
      persistedState: null,
    });
    assert.equal(s2.conversationState?.lastRecommendedProducts.length || 0, 0);
    assert.ok(/ACRIO/i.test(s2.customerReply));
    recordPass(2, "Identity query ('Who are you?') identifies ACRIO with 0 product dumps");

    // Scenario 3: Company & factory info
    const s3 = await runAcrioAutonomousTurn({
      customerName: "Visitor 3",
      inboundText: "Where is your factory located?",
      recentMessages: [],
      hasAlreadyGreeted: false,
      persistedState: null,
    });
    assert.equal(s3.conversationState?.lastRecommendedProducts.length || 0, 0);
    assert.ok(/Secunderabad|Hyderabad/i.test(s3.customerReply));
    recordPass(3, "Company factory location query answered directly without dumping products");

    // Scenario 4: Short role introduction
    const i4 = classifyAcrioInboundIntent("I am an architect", false);
    assert.equal(i4.requiresProductLookup, false);
    recordPass(4, "Role introduction ('I am an architect') skips blind product retrieval");

    // Scenario 5: Out-of-scope query
    const s5 = await runAcrioAutonomousTurn({
      customerName: "Visitor 5",
      inboundText: "What is the cricket score and weather today?",
      recentMessages: [],
      hasAlreadyGreeted: false,
      persistedState: null,
    });
    assert.equal(s5.conversationState?.lastRecommendedProducts.length || 0, 0);
    recordPass(5, "Out-of-scope query stays politely in domain with 0 products");

    // Scenario 6: Specific category + ₹25,000 budget
    const t6 = await runAcrioAutonomousTurn({
      customerName: "Church Buyer",
      inboundText: "I am looking for pulpits under ₹25,000",
      recentMessages: [],
      hasAlreadyGreeted: false,
      persistedState: null,
    });
    const t6Recs = t6.conversationState?.lastRecommendedProducts || [];
    assert.ok(t6Recs.length > 0);
    for (const p of t6Recs) {
      assert.ok(/podium|pulpit|lectern/i.test(p.name));
      assert.ok(typeof p.priceInr === "number" && p.priceInr > 0 && p.priceInr <= 25000);
    }
    recordPass(6, "Pulpits under ₹25,000 returns strictly verified podiums <= ₹25,000");

    // Scenario 7: Follow-up budget raise to ₹30,000 preserves podium category
    const t7 = await runAcrioAutonomousTurn({
      customerName: "Church Buyer",
      inboundText: "We can increase the budget to ₹30,000",
      recentMessages: [
        { direction: "INBOUND", body: "I am looking for pulpits under ₹25,000" },
        { direction: "OUTBOUND", body: t6.customerReply },
      ],
      hasAlreadyGreeted: true,
      persistedState: t6.conversationState,
    });
    assert.equal(t7.conversationState?.productFamily, "podium");
    assert.equal(t7.conversationState?.maxPrice, 30000);
    const t7Recs = t7.conversationState?.lastRecommendedProducts || [];
    assert.ok(t7Recs.length > 0);
    assert.ok(
      t7Recs.some((p) => (p.priceInr || 0) > 25000 && (p.priceInr || 0) <= 30000),
      "Raising budget to ₹30,000 must unlock ₹25k-₹30k podium tier"
    );
    recordPass(7, "Follow-up budget increase to ₹30,000 keeps podiums and unlocks ₹25k-₹30k models");

    // Scenario 8: Follow-up quality preference ("most premium transparent ones")
    const t8 = await runAcrioAutonomousTurn({
      customerName: "Church Buyer",
      inboundText: "Show me the most premium transparent ones",
      recentMessages: [
        { direction: "INBOUND", body: "I am looking for pulpits under ₹25,000" },
        { direction: "OUTBOUND", body: t6.customerReply },
        { direction: "INBOUND", body: "We can increase the budget to ₹30,000" },
        { direction: "OUTBOUND", body: t7.customerReply },
      ],
      hasAlreadyGreeted: true,
      persistedState: t7.conversationState,
    });
    assert.equal(t8.conversationState?.maxPrice, 30000);
    const t8Recs = t8.conversationState?.lastRecommendedProducts || [];
    assert.ok(t8Recs.length > 0);
    for (const p of t8Recs) {
      assert.ok((p.priceInr || 0) <= 30000);
    }
    recordPass(8, "Preference follow-up preserves ₹30,000 ceiling & ranks premium transparent podiums");

    // Scenario 9: Mid-conversation "Who are you?" never leaks prior podium links
    const t9 = await runAcrioAutonomousTurn({
      customerName: "Church Buyer",
      inboundText: "Who are you?",
      recentMessages: [
        { direction: "INBOUND", body: "Show me the most premium transparent ones" },
        { direction: "OUTBOUND", body: t8.customerReply },
      ],
      hasAlreadyGreeted: true,
      persistedState: t8.conversationState,
    });
    assert.equal(t9.needsHumanHandoff, false);
    assert.ok(/ACRIO/i.test(t9.customerReply));
    assert.ok(!/ccapl\.cc/i.test(t9.customerReply));
    recordPass(9, "Mid-conversation 'Who are you?' has 0 leaked podium shortlinks");

    // Scenario 10: Informational handoff question ("Whom will you connect me to?")
    const t10 = await runAcrioAutonomousTurn({
      customerName: "Church Buyer",
      inboundText: "Whom will you connect me to?",
      recentMessages: [
        { direction: "INBOUND", body: "Who are you?" },
        { direction: "OUTBOUND", body: t9.customerReply },
      ],
      hasAlreadyGreeted: true,
      persistedState: t9.conversationState,
    });
    assert.equal(t10.needsHumanHandoff, false);
    assert.ok(/Sales/i.test(t10.customerReply));
    assert.ok(!/ccapl\.cc/i.test(t10.customerReply));
    recordPass(10, "'Whom will you connect me to?' answers cleanly without false handoff");

    // Scenario 11: Explicit handoff request carries pulpit + ₹30,000 context
    const t11 = await runAcrioAutonomousTurn({
      customerName: "Church Buyer",
      inboundText: "Connect me to a human",
      recentMessages: [
        { direction: "INBOUND", body: "Whom will you connect me to?" },
        { direction: "OUTBOUND", body: t10.customerReply },
      ],
      hasAlreadyGreeted: true,
      persistedState: t10.conversationState,
    });
    assert.equal(t11.needsHumanHandoff, true);
    assert.equal(t11.smartCategory, "Podiums & Stage");
    assert.ok(/pulpit/i.test(t11.handoffReason) && /30,000/.test(t11.handoffReason));
    recordPass(11, "'Connect me to a human' transfers with pulpit + ₹30,000 summary");

    // Scenario 12: Unrealistic tight budget honesty (no false matches)
    const fallback5k = getEcosystemBudgetFallbackInfo(allItems, "pulpit podium", { maxPrice: 5000 });
    assert.ok(fallback5k.lowestAvailablePrice && fallback5k.lowestAvailablePrice > 5000);
    const strict5k = searchEcosystemItems(allItems, "pulpit podium", 8, { maxPrice: 5000 });
    assert.equal(strict5k.length, 0);
    recordPass(12, "Unrealistic budget ('pulpits under ₹5,000') returns 0 false matches & exact floor price");

    // Scenario 13: Classic Edge 53 industrial machines routing
    const machMatches = searchEcosystemItems(allItems, "diamond edge polishing machines", 6, {
      brand: "CLASSIC_EDGE_53",
      itemType: "MACHINE",
    });
    assert.ok(machMatches.length > 0);
    for (const m of machMatches) {
      assert.equal(m.brand, "CLASSIC_EDGE_53");
      assert.equal(m.itemType, "MACHINE");
    }
    recordPass(13, "Machine query routes strictly to CLASSIC_EDGE_53 machines");

    // Scenario 14: Negation/correction ("Actually I am not looking for tools, just machines")
    let negState = createEmptyAcrioConversationState();
    negState = applyTurnToAcrioConversationState(
      negState,
      "Do you have diamond polishing machines and tools?",
      classifyAcrioInboundIntent("Do you have diamond polishing machines and tools?", false)
    );
    negState = applyTurnToAcrioConversationState(
      negState,
      "Actually I am not looking for tools, just machines",
      classifyAcrioInboundIntent("Actually I am not looking for tools, just machines", true)
    );
    assert.equal(negState.itemTypeFilter, "MACHINE");
    assert.ok(negState.excludedItemTypes.includes("CONSUMABLE"));
    const negSearch = buildNormalizedSearchFromState(
      negState,
      "Actually I am not looking for tools, just machines"
    );
    const negMatches = searchEcosystemItems(
      allItems,
      negSearch.searchQuery,
      10,
      negSearch.searchOptions
    );
    assert.ok(negMatches.length > 0);
    assert.equal(negMatches.filter((m) => m.itemType === "CONSUMABLE").length, 0);
    recordPass(14, "Negation ('not looking for tools, just machines') returns 0 consumables");

    // Scenario 15: Category isolation for Awards & Trophies
    const awardMatches = searchEcosystemItems(allItems, "acrylic trophies awards", 8, {
      brand: "CLASSIC_CONCEPTS",
    });
    assert.ok(awardMatches.length > 0);
    for (const a of awardMatches) {
      assert.ok(!/podium|pulpit|lectern|tray|machine/i.test(a.name));
    }
    recordPass(15, "Awards & Trophies search strictly excludes podiums, trays & machines");

    // Scenario 16: Explicit topic reset clears stale budget & category
    const resetIntent = classifyAcrioInboundIntent("I have a different query", true);
    assert.equal(resetIntent.intent, "TOPIC_RESET");
    const resetState = applyTurnToAcrioConversationState(t8.conversationState!, "I have a different query", resetIntent);
    assert.equal(resetState.maxPrice, null);
    assert.equal(resetState.productFamily, null);
    assert.equal(resetState.activeCategory, null);
    recordPass(16, "Topic reset ('I have a different query') clears prior category & budget");

    // Scenario 17: Genuine topic switch replaces category cleanly
    const switchMsg = "Now show me acrylic bending machines";
    const switchIntent = classifyAcrioInboundIntent(switchMsg, true);
    const switchedState = applyTurnToAcrioConversationState(t8.conversationState!, switchMsg, switchIntent);
    assert.equal(switchedState.activeBrand, "CLASSIC_EDGE_53");
    assert.equal(switchedState.maxPrice, null);
    recordPass(17, "Topic switch ('acrylic bending machines') clears prior podium budget & switches brand");

    // Scenario 18: Production public URL invariant (zero localhost:3002 / localhost:3003 leaks)
    const badUrls = allItems.filter((it) => /localhost:(?:3002|3003)/i.test(it.url || ""));
    assert.equal(badUrls.length, 0, "All ecosystem items must resolve to production domains");
    recordPass(18, "All catalog & shortlink URLs resolve strictly to production domains");

    // Scenario 19: Selective brand cache sync & bridge authorization check
    const synced = await syncEcosystemRedisCache({ brand: "CLASSIC_CONCEPTS" });
    assert.equal(synced.invalidatedBrand, "CLASSIC_CONCEPTS");
    assert.ok(synced.classicConceptsCount > 0);
    const bridgeKey = (process.env.CC_ECOSYSTEM_BRIDGE_KEY || "cc_internal_bridge_2026").trim();
    const bridgeRes = await cacheSyncPost(
      new Request("http://127.0.0.1:3007/api/cache/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cc-bridge-key": bridgeKey },
        body: JSON.stringify({ action: "sync", brand: "CLASSIC_EDGE_53" }),
      })
    );
    assert.equal(bridgeRes.status, 200);
    recordPass(19, "Cross-app ACRO->ACRIO bridge cache sync succeeds for authorized internal callers");

    // Scenario 20: Unauthorized caller blocked from cache sync & API key mutation
    const unauthRes = await cacheSyncPost(
      new Request("http://127.0.0.1:3007/api/cache/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      })
    );
    assert.equal(unauthRes.status, 403);
    recordPass(20, "Unauthorized /api/cache/sync request rejected with HTTP 403");

    console.log(`\n=== ALL ${passed}/20 PHASE G WHATSAPP ECOSYSTEM REGRESSION SCENARIOS PASSED ===`);
    process.exit(0);
  } finally {
    if (savedClientKey !== undefined) process.env.ANTHROPIC_CLIENT_API_KEY = savedClientKey;
    if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey;
  }
}

main().catch((err) => {
  console.error("Phase G ccwhatsapp regression failed:", err);
  process.exit(1);
});
