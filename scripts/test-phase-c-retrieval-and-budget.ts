import assert from "node:assert/strict";
import {
  searchEcosystemItems,
  getEcosystemBudgetFallbackInfo,
} from "../packages/database/src/index";
import {
  getCachedEcosystemCatalog,
  buildGroupedProductShortLinksSection,
} from "../packages/connections/src/index";

async function main() {
  console.log("=== Phase C Regression Suite (ccwhatsapp): Retrieval, Business Routing, Budget & Relevance ===");

  const { allItems } = await getCachedEcosystemCatalog();
  assert.ok(allItems.length > 50, `Expected >50 ecosystem items, got ${allItems.length}`);

  // 1. Strict Business Routing: Classic Concepts vs Classic Edge 53
  const pulpitMatches = searchEcosystemItems(allItems, "I am looking for pulpits", 10);
  assert.ok(pulpitMatches.length > 0, "Should match podiums for 'pulpits'");
  for (const item of pulpitMatches) {
    assert.equal(
      item.brand,
      "CLASSIC_CONCEPTS",
      `Pulpit query must never return Classic Edge 53 item "${item.name}"`
    );
    assert.ok(
      /\b(podium|podiums|pulpit|pulpits|lectern|rostrum)\b|^ccp\d/i.test(
        `${item.name} ${item.categoryName} ${item.sku || ""}`
      ),
      `Pulpit query returned unrelated item "${item.name}" (${item.categoryName})`
    );
  }
  console.log(
    `  [PASS] Pulpit query strictly isolated to CLASSIC_CONCEPTS podiums (${pulpitMatches.length} items, 0 trays/tubes/machines)`
  );

  const machineMatches = searchEcosystemItems(
    allItems,
    "diamond edge polishing machines",
    8
  );
  assert.ok(machineMatches.length > 0, "Should match CE53 polishing machines");
  for (const item of machineMatches) {
    assert.equal(
      item.brand,
      "CLASSIC_EDGE_53",
      `Machine query must only return CLASSIC_EDGE_53 items, got "${item.name}" (${item.brand})`
    );
  }
  console.log(
    `  [PASS] Machine query strictly routed to CLASSIC_EDGE_53 (${machineMatches.length} items)`
  );

  const trophyMatches = searchEcosystemItems(
    allItems,
    "acrylic trophies and mementos for college event",
    8
  );
  assert.ok(trophyMatches.length > 0, "Should match trophies/awards");
  for (const item of trophyMatches) {
    assert.equal(item.brand, "CLASSIC_CONCEPTS");
    assert.ok(
      /\b(trophy|trophies|award|awards|memento|mementos|plaque|plaques|medal|shield)\b/i.test(
        `${item.name} ${item.categoryName}`
      ),
      `Trophy query returned non-award item "${item.name}"`
    );
  }
  console.log(
    `  [PASS] Award/trophy query strictly isolated to Awards & Trophies (${trophyMatches.length} items)`
  );

  // 2. Strict Budget Enforcement & Exclusion of Unknown-Price (basePrice === null) Items
  const pulpitsUnder25k = searchEcosystemItems(
    allItems,
    "I am looking for pulpits under ₹25,000",
    15
  );
  assert.ok(pulpitsUnder25k.length > 0, "Should return podiums <= ₹25,000");
  for (const item of pulpitsUnder25k) {
    assert.ok(
      typeof item.basePrice === "number" && item.basePrice > 0,
      `Unpriced item "${item.name}" (basePrice=${item.basePrice}) must not appear in strict budget results`
    );
    assert.ok(
      item.basePrice! <= 25000,
      `Item "${item.name}" (₹${item.basePrice}) exceeds ₹25,000 ceiling`
    );
  }
  console.log(
    `  [PASS] Budget <= ₹25,000 returned ${pulpitsUnder25k.length} verified priced podiums (0 unpriced items, 0 >₹25k items)`
  );

  const pulpitsUnder30k = searchEcosystemItems(
    allItems,
    "I am looking for pulpits under ₹30,000",
    15
  );
  assert.ok(
    pulpitsUnder30k.length > pulpitsUnder25k.length,
    "Increasing budget from ₹25,000 to ₹30,000 must unlock additional podiums in ₹25,001-₹30,000 range"
  );
  for (const item of pulpitsUnder30k) {
    assert.ok(
      typeof item.basePrice === "number" && item.basePrice > 0 && item.basePrice <= 30000,
      `Item "${item.name}" (₹${item.basePrice}) must have a verified price <= ₹30,000`
    );
  }
  console.log(
    `  [PASS] Budget <= ₹30,000 returned ${pulpitsUnder30k.length} verified priced podiums (up from ${pulpitsUnder25k.length} at <= ₹25,000)`
  );

  // 3. Impossible / Tight Budget (< ₹5,000 for podiums) -> 0 false matches + accurate lowest starting price fallback
  const pulpitsUnder5k = searchEcosystemItems(
    allItems,
    "I am looking for pulpits under ₹5,000",
    10
  );
  assert.equal(
    pulpitsUnder5k.length,
    0,
    "Pulpits under ₹5,000 must return 0 items (never return unpriced or >₹5,000 podiums as false matches)"
  );
  const fbInfo = getEcosystemBudgetFallbackInfo(
    allItems,
    "I am looking for pulpits under ₹5,000"
  );
  assert.ok(
    typeof fbInfo.lowestAvailablePrice === "number" && fbInfo.lowestAvailablePrice > 5000,
    `Expected lowest podium price > 5000, got ${fbInfo.lowestAvailablePrice}`
  );
  assert.ok(fbInfo.lowestAvailableItem, "Should identify the starting podium model");
  console.log(
    `  [PASS] Tight budget 'pulpits under ₹5,000' returned 0 false matches and identified starting model "${fbInfo.lowestAvailableItem?.name}" at ₹${fbInfo.lowestAvailablePrice}`
  );

  // 4. Inline Negation & Item-Type Filtering ("not looking for tools, just machines")
  const machinesOnlyDirect = searchEcosystemItems(
    allItems,
    "Actually I am not looking for tools, just machines",
    10
  );
  assert.ok(machinesOnlyDirect.length > 0, "Should return machines when user says 'not looking for tools, just machines'");
  for (const item of machinesOnlyDirect) {
    assert.equal(item.brand, "CLASSIC_EDGE_53");
    assert.equal(
      item.itemType,
      "MACHINE",
      `Negation query must exclude CONSUMABLE "${item.name}"`
    );
  }

  const groupedBlockNoTools = buildGroupedProductShortLinksSection({
    allItems,
    matchedItems: machinesOnlyDirect,
    smartCategory: "Acrylic Machines (CE53)",
    excludeConsumables: true,
  });
  assert.ok(
    !groupedBlockNoTools.includes("Tools & Consumables"),
    "Grouped WhatsApp block must suppress '*Tools & Consumables:*' when consumables are excluded"
  );
  console.log(
    `  [PASS] Direct negation ("Actually I am not looking for tools, just machines") returned ${machinesOnlyDirect.length} MACHINE items and 0 CONSUMABLE items`
  );

  console.log("\nALL PHASE C RETRIEVAL, BUSINESS ROUTING & BUDGET TESTS PASSED (ccwhatsapp)!");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Phase C test failed:", err);
    process.exit(1);
  });
