import assert from "node:assert/strict";
import {
  extractBudgetConstraintsFromQuery,
  getRawLibSqlClient,
  ensureDatabasesBootstrapped,
  searchEcosystemItems,
} from "../packages/database/src/index";
import {
  classifyAcrioInboundIntent,
  createEmptyAcrioConversationState,
  applyTurnToAcrioConversationState,
  reconstructAcrioConversationState,
  buildNormalizedSearchFromState,
  loadConversationAiState,
  saveConversationAiState,
  getCachedEcosystemCatalog,
  runAcrioChatCopilot,
} from "../packages/connections/src/index";

async function main() {
  console.log("=== Phase B Regression Suite (ccwhatsapp): Conversation Memory & Context Management ===");

  // 1. Budget constraint extraction across initial & follow-up phrasings
  const b1 = extractBudgetConstraintsFromQuery("I am looking for pulpits under ₹25,000");
  assert.equal(b1.maxPrice, 25000, "Should extract maxPrice=25000 from 'under ₹25,000'");
  assert.equal(b1.minPrice, null);

  const b2 = extractBudgetConstraintsFromQuery("We can increase the budget to ₹30,000");
  assert.equal(b2.maxPrice, 30000, "Should extract maxPrice=30000 from 'increase the budget to ₹30,000'");

  const b3 = extractBudgetConstraintsFromQuery("Can we stretch our budget to 35k?");
  assert.equal(b3.maxPrice, 35000, "Should extract maxPrice=35000 from 'stretch our budget to 35k'");

  const b4 = extractBudgetConstraintsFromQuery(
    "I am looking for pulpits under ₹25,000 We can increase the budget to ₹30,000"
  );
  assert.equal(
    b4.maxPrice,
    30000,
    "When multiple budgets appear in a rolling window, latest budget (30000) must win"
  );

  const b5 = extractBudgetConstraintsFromQuery("Looking for podiums between ₹15,000 and ₹28,000");
  assert.equal(b5.minPrice, 15000);
  assert.equal(b5.maxPrice, 28000);
  console.log("  [PASS] Budget constraint extraction handles initial, follow-up, k-suffix, and range phrasings");

  // 2. Load catalog for realistic multi-turn product verification
  const { allItems } = await getCachedEcosystemCatalog();
  assert.ok(allItems.length > 50, `Expected ecosystem catalog to load >50 items, got ${allItems.length}`);

  // 3. Multi-turn scenario: "pulpits under ₹25,000" -> "We can increase the budget to ₹30,000" -> "Show me the most premium transparent ones"
  let state = createEmptyAcrioConversationState();

  const turn1Text = "I am looking for pulpits under ₹25,000";
  const turn1Intent = classifyAcrioInboundIntent(turn1Text, false);
  assert.equal(turn1Intent.intent, "PRODUCT_SEARCH");
  state = applyTurnToAcrioConversationState(state, turn1Text, turn1Intent);

  assert.equal(state.productFamily, "podium");
  assert.equal(state.primaryProductQuery, "pulpit podium");
  assert.equal(state.activeCategory, "Podiums & Stage");
  assert.equal(state.maxPrice, 25000);

  const search1 = buildNormalizedSearchFromState(state, turn1Text);
  const matches1 = searchEcosystemItems(allItems, search1.searchQuery, 8, search1.searchOptions);
  assert.ok(matches1.length > 0, "Turn 1 must match podiums <= ₹25,000");
  for (const item of matches1) {
    assert.equal(item.brand, "CLASSIC_CONCEPTS", `Expected CLASSIC_CONCEPTS podium, got ${item.brand}`);
    assert.ok(
      /podium|pulpit|lectern/i.test(`${item.name} ${item.categoryName}`),
      `Expected podium product on Turn 1, got "${item.name}"`
    );
    if (typeof item.basePrice === "number" && item.basePrice > 0) {
      assert.ok(
        item.basePrice <= 25000,
        `Turn 1 matched item "${item.name}" (₹${item.basePrice}) exceeds ₹25,000 budget`
      );
    }
  }
  console.log(
    `  [PASS] Turn 1 ("${turn1Text}") -> matched ${matches1.length} podiums all <= ₹25,000`
  );

  // Turn 2: Follow-up budget increase to ₹30,000 (no product noun repeated)
  const turn2Text = "We can increase the budget to ₹30,000";
  const turn2Intent = classifyAcrioInboundIntent(turn2Text, true);
  assert.equal(turn2Intent.intent, "FOLLOW_UP_REFINEMENT");
  state = applyTurnToAcrioConversationState(state, turn2Text, turn2Intent);

  assert.equal(
    state.productFamily,
    "podium",
    "Product family must remain 'podium' when budget is increased"
  );
  assert.equal(
    state.primaryProductQuery,
    "pulpit podium",
    "Primary product query must remain 'pulpit podium' when budget is increased"
  );
  assert.equal(
    state.activeCategory,
    "Podiums & Stage",
    "Active category must remain 'Podiums & Stage' when budget is increased"
  );
  assert.equal(state.maxPrice, 30000, "Max price must update to 30000");

  const search2 = buildNormalizedSearchFromState(state, turn2Text);
  const matches2 = searchEcosystemItems(allItems, search2.searchQuery, 12, search2.searchOptions);
  assert.ok(matches2.length > 0, "Turn 2 must match podiums <= ₹30,000");
  const hasHigherTierPodium = matches2.some(
    (it) => typeof it.basePrice === "number" && it.basePrice > 25000 && it.basePrice <= 30000
  );
  assert.ok(
    hasHigherTierPodium,
    "Turn 2 (<= ₹30,000) should include podiums priced between ₹25,001 and ₹30,000"
  );
  for (const item of matches2) {
    assert.ok(
      /podium|pulpit|lectern/i.test(`${item.name} ${item.categoryName}`),
      `Expected podium product on Turn 2, got "${item.name}"`
    );
    if (typeof item.basePrice === "number" && item.basePrice > 0) {
      assert.ok(
        item.basePrice <= 30000,
        `Turn 2 matched item "${item.name}" (₹${item.basePrice}) exceeds ₹30,000 budget`
      );
    }
  }
  console.log(
    `  [PASS] Turn 2 ("${turn2Text}") -> preserved podium category, updated budget to ₹30,000, unlocked ₹25k-₹30k models`
  );

  // Turn 3: Follow-up preference refinement ("Show me the most premium transparent ones")
  const turn3Text = "Show me the most premium transparent ones";
  const turn3Intent = classifyAcrioInboundIntent(turn3Text, true);
  assert.equal(turn3Intent.intent, "FOLLOW_UP_REFINEMENT");
  state = applyTurnToAcrioConversationState(state, turn3Text, turn3Intent);

  assert.equal(state.productFamily, "podium");
  assert.equal(state.maxPrice, 30000);
  assert.ok(state.preferences.includes("premium"), "Should record 'premium' preference");
  assert.ok(state.preferences.includes("transparent"), "Should record 'transparent' preference");

  const search3 = buildNormalizedSearchFromState(state, turn3Text);
  assert.equal(search3.searchOptions.preferPremium, true);
  const matches3 = searchEcosystemItems(allItems, search3.searchQuery, 8, search3.searchOptions);
  assert.ok(matches3.length >= 2, "Turn 3 must return at least 2 premium transparent podiums <= ₹30,000");
  assert.ok(
    (matches3[0].basePrice || 0) >= (matches3[1].basePrice || 0),
    `Expected premium sort to rank higher-priced podium first, got ₹${matches3[0].basePrice} before ₹${matches3[1].basePrice}`
  );
  console.log(
    `  [PASS] Turn 3 ("${turn3Text}") -> ranked top podium "${matches3[0].name}" (₹${matches3[0].basePrice}) first within ₹30,000 ceiling`
  );

  // 4. Correction / Negation: "Actually I am not looking for tools, just machines"
  let machineState = createEmptyAcrioConversationState();
  const mTurn1 = "Do you have diamond polishing machines and tools?";
  machineState = applyTurnToAcrioConversationState(
    machineState,
    mTurn1,
    classifyAcrioInboundIntent(mTurn1, false)
  );
  const mTurn2 = "Actually I am not looking for tools, just machines";
  machineState = applyTurnToAcrioConversationState(
    machineState,
    mTurn2,
    classifyAcrioInboundIntent(mTurn2, true)
  );
  assert.equal(machineState.activeCategory, "Acrylic Machines (CE53)");
  assert.equal(machineState.itemTypeFilter, "MACHINE");
  assert.ok(
    machineState.excludedItemTypes.includes("CONSUMABLE"),
    "Correction turn must exclude CONSUMABLE items"
  );
  assert.equal(
    machineState.primaryProductQuery,
    "diamond edge polishing machine",
    "Correction turn must preserve specific machine query"
  );
  const mSearch = buildNormalizedSearchFromState(machineState, mTurn2);
  const mMatches = searchEcosystemItems(allItems, mSearch.searchQuery, 8, mSearch.searchOptions);
  assert.ok(mMatches.length > 0, "Should return matching machines");
  for (const m of mMatches) {
    assert.notEqual(
      m.itemType,
      "CONSUMABLE",
      `Excluded CONSUMABLE item "${m.name}" must not appear after negation`
    );
  }
  console.log(
    `  [PASS] Correction ("${mTurn2}") -> preserved machine query and excluded all CONSUMABLE tools`
  );

  // 5. Genuine topic switch & explicit topic reset
  const switchTurn = "Do you have trophies under ₹1,500 for college students?";
  const switchedState = applyTurnToAcrioConversationState(
    state,
    switchTurn,
    classifyAcrioInboundIntent(switchTurn, true)
  );
  assert.equal(switchedState.productFamily, "trophy", "Should switch productFamily to 'trophy'");
  assert.equal(switchedState.activeCategory, "Awards & Trophies");
  assert.equal(switchedState.maxPrice, 1500, "Should replace old ₹30,000 budget with new ₹1,500 budget");
  assert.deepEqual(switchedState.preferences, [], "Should clear prior podium preferences on topic switch");

  const resetTurn = "I have a different query";
  const resetState = applyTurnToAcrioConversationState(
    switchedState,
    resetTurn,
    classifyAcrioInboundIntent(resetTurn, true)
  );
  assert.equal(resetState.productFamily, null, "Topic reset must clear productFamily");
  assert.equal(resetState.primaryProductQuery, null, "Topic reset must clear primaryProductQuery");
  assert.equal(resetState.maxPrice, null, "Topic reset must clear maxPrice");
  console.log("  [PASS] Genuine topic switches and explicit topic resets clear stale category/budget state");

  // 6. Per-customer isolation in SQLite (conversations.ai_state_json) & Staff Co-Pilot reconstruction
  await ensureDatabasesBootstrapped();
  const convDb = getRawLibSqlClient("conversations");
  const convIdA = "conv_phaseb_test_customer_a";
  const convIdB = "conv_phaseb_test_customer_b";
  const nowIso = new Date().toISOString();

  await convDb.execute({
    sql: `INSERT OR REPLACE INTO conversations (
      id, customer_phone, customer_name, status, unread_count, last_message_at, created_at
    ) VALUES (?, ?, ?, 'OPEN', 0, ?, ?)`,
    args: [convIdA, "919000000001", "Customer A", nowIso, nowIso],
  });
  await convDb.execute({
    sql: `INSERT OR REPLACE INTO conversations (
      id, customer_phone, customer_name, status, unread_count, last_message_at, created_at
    ) VALUES (?, ?, ?, 'OPEN', 0, ?, ?)`,
    args: [convIdB, "919000000002", "Customer B", nowIso, nowIso],
  });

  const stateCustomerA = reconstructAcrioConversationState({
    currentInboundText: "I am looking for pulpits under ₹25,000",
  });
  const stateCustomerB = reconstructAcrioConversationState({
    currentInboundText: "Looking for acrylic trophies under ₹2,000",
  });

  await saveConversationAiState(convIdA, stateCustomerA);
  await saveConversationAiState(convIdB, stateCustomerB);

  const loadedA = await loadConversationAiState(convIdA);
  const loadedB = await loadConversationAiState(convIdB);
  assert.ok(loadedA && loadedB, "Both customer states must load from SQLite");

  const updatedA = reconstructAcrioConversationState({
    persistedState: loadedA,
    currentInboundText: "We can increase the budget to ₹30,000",
  });
  const updatedB = reconstructAcrioConversationState({
    persistedState: loadedB,
    currentInboundText: "Show me the most premium ones",
  });

  assert.equal(updatedA.productFamily, "podium");
  assert.equal(updatedA.maxPrice, 30000);
  assert.equal(updatedB.productFamily, "trophy");
  assert.equal(updatedB.maxPrice, 2000);
  assert.ok(updatedB.preferences.includes("premium"));

  // Clean up temporary test conversation rows
  await convDb.execute({
    sql: `DELETE FROM conversations WHERE id IN (?, ?)`,
    args: [convIdA, convIdB],
  });
  console.log("  [PASS] Per-customer SQLite state persistence is strictly isolated between Customer A and Customer B");

  // 7. Verify Staff Inbox Co-Pilot multi-turn state reconstruction
  const copilotRes = await runAcrioChatCopilot({
    customerName: "Pastor David",
    recentMessages: [
      { direction: "INBOUND", body: "Hi" },
      { direction: "OUTBOUND", body: "Hello! How can I help you today?" },
      { direction: "INBOUND", body: "I am looking for pulpits under ₹25,000" },
      { direction: "OUTBOUND", body: "Here are matching podiums under ₹25,000..." },
      { direction: "INBOUND", body: "We can increase the budget to ₹30,000" },
    ],
  });
  assert.equal(copilotRes.smartCategory, "Podiums & Stage");
  assert.ok(copilotRes.recommendedProducts.length > 0, "Co-pilot should recommend podiums on budget increase");
  for (const prod of copilotRes.recommendedProducts) {
    assert.ok(
      /podium|pulpit|lectern/i.test(prod.name),
      `Co-pilot recommended non-podium "${prod.name}" on pulpit budget follow-up`
    );
    if (typeof prod.priceInr === "number" && prod.priceInr > 0) {
      assert.ok(prod.priceInr <= 30000, `Co-pilot product "${prod.name}" exceeds ₹30,000`);
    }
  }
  console.log("  [PASS] Staff Inbox Co-Pilot reconstructs multi-turn pulpit + ₹30,000 budget state accurately");

  console.log("\nALL PHASE B CONVERSATION MEMORY & CONTEXT TESTS PASSED (ccwhatsapp)!");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Phase B test failed:", err);
    process.exit(1);
  });
