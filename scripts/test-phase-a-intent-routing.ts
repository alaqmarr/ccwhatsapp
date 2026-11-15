import assert from "node:assert/strict";
import {
  classifyAcrioInboundIntent,
  runAcrioChatCopilot,
} from "../packages/connections/src/index";
import { readAiTraceLogs } from "../packages/database/src/ai-logger";

async function main() {
  console.log("=== Phase A Regression Tests: WhatsApp Hub Intent Routing & Retrieval Gate ===");

  // 1. Non-product intents must set requiresProductLookup = false
  const nonProductCases: Array<{
    text: string;
    hasHistory?: boolean;
    expectedIntent: string;
    expectedHandoff: boolean;
  }> = [
    { text: "Hi", expectedIntent: "GREETING", expectedHandoff: false },
    { text: "Hello!", expectedIntent: "GREETING", expectedHandoff: false },
    { text: "Good morning", expectedIntent: "GREETING", expectedHandoff: false },
    { text: "Namaste", expectedIntent: "GREETING", expectedHandoff: false },
    { text: "Who are you?", hasHistory: true, expectedIntent: "IDENTITY_META", expectedHandoff: false },
    { text: "What can you help me with?", hasHistory: true, expectedIntent: "IDENTITY_META", expectedHandoff: false },
    { text: "Which AI model are you using?", expectedIntent: "IDENTITY_META", expectedHandoff: false },
    { text: "Are you a bot?", expectedIntent: "IDENTITY_META", expectedHandoff: false },
    { text: "Where is your factory?", hasHistory: true, expectedIntent: "COMPANY_INFO", expectedHandoff: false },
    { text: "Where are you located?", expectedIntent: "COMPANY_INFO", expectedHandoff: false },
    { text: "What does Classic Concepts do?", expectedIntent: "COMPANY_INFO", expectedHandoff: false },
    { text: "Do you ship across India?", expectedIntent: "COMPANY_INFO", expectedHandoff: false },
    { text: "I have a different query", hasHistory: true, expectedIntent: "TOPIC_RESET", expectedHandoff: false },
    { text: "Forget that, let's start over", hasHistory: true, expectedIntent: "TOPIC_RESET", expectedHandoff: false },
    { text: "Something else", hasHistory: true, expectedIntent: "TOPIC_RESET", expectedHandoff: false },
    { text: "Whom will you connect me to?", hasHistory: true, expectedIntent: "HUMAN_HANDOFF_INFO", expectedHandoff: false },
    { text: "Who will you connect me to?", hasHistory: true, expectedIntent: "HUMAN_HANDOFF_INFO", expectedHandoff: false },
    { text: "Who handles custom quotes?", hasHistory: true, expectedIntent: "HUMAN_HANDOFF_INFO", expectedHandoff: false },
    { text: "Connect me to a human", hasHistory: true, expectedIntent: "HUMAN_HANDOFF_REQUEST", expectedHandoff: true },
    { text: "I want to talk to sales team", hasHistory: true, expectedIntent: "HUMAN_HANDOFF_REQUEST", expectedHandoff: true },
    { text: "Please call me", hasHistory: true, expectedIntent: "HUMAN_HANDOFF_REQUEST", expectedHandoff: true },
    { text: "The item arrived cracked on delivery", hasHistory: true, expectedIntent: "SUPPORT_ISSUE", expectedHandoff: true },
    { text: "Where is my order CC-1042?", hasHistory: true, expectedIntent: "ORDER_STATUS", expectedHandoff: true },
    { text: "Track my order", hasHistory: true, expectedIntent: "ORDER_STATUS", expectedHandoff: true },
    { text: "What is the weather in Mumbai today?", hasHistory: true, expectedIntent: "OFF_TOPIC", expectedHandoff: false },
  ];

  for (const tc of nonProductCases) {
    const res = classifyAcrioInboundIntent(tc.text, tc.hasHistory ?? false);
    assert.equal(
      res.intent,
      tc.expectedIntent,
      `Expected "${tc.text}" -> ${tc.expectedIntent}, got ${res.intent} (${res.reason})`
    );
    assert.equal(
      res.requiresProductLookup,
      false,
      `Expected requiresProductLookup=false for "${tc.text}", got true`
    );
    assert.equal(
      res.allowRollingContextFallback,
      false,
      `Expected allowRollingContextFallback=false for "${tc.text}", got true`
    );
    assert.equal(
      res.needsImmediateHandoff,
      tc.expectedHandoff,
      `Expected needsImmediateHandoff=${tc.expectedHandoff} for "${tc.text}", got ${res.needsImmediateHandoff}`
    );
  }
  console.log(`PASS: ${nonProductCases.length} non-product intents classified with requiresProductLookup=false`);

  // 2. Product-seeking intents must set requiresProductLookup = true
  const productCases: Array<{
    text: string;
    hasHistory?: boolean;
    expectedIntent: string;
    expectedRollingFallback: boolean;
  }> = [
    {
      text: "I am looking for pulpits under ₹25,000",
      hasHistory: true,
      expectedIntent: "PRODUCT_SEARCH",
      expectedRollingFallback: false,
    },
    {
      text: "Do you have diamond edge polishing machines?",
      hasHistory: false,
      expectedIntent: "PRODUCT_SEARCH",
      expectedRollingFallback: false,
    },
    {
      text: "We can increase the budget to ₹30,000",
      hasHistory: true,
      expectedIntent: "FOLLOW_UP_REFINEMENT",
      expectedRollingFallback: true,
    },
    {
      text: "Show me transparent ones under 18k",
      hasHistory: true,
      expectedIntent: "FOLLOW_UP_REFINEMENT",
      expectedRollingFallback: true,
    },
    {
      text: "Compare CCP057S vs CCP032",
      hasHistory: true,
      expectedIntent: "PRODUCT_COMPARISON",
      expectedRollingFallback: true,
    },
    {
      text: "Need 10 pieces of 300mm x 200mm x 150mm box",
      hasHistory: true,
      expectedIntent: "CUSTOM_QUOTE",
      expectedRollingFallback: true,
    },
  ];

  for (const tc of productCases) {
    const res = classifyAcrioInboundIntent(tc.text, tc.hasHistory ?? false);
    assert.equal(
      res.intent,
      tc.expectedIntent,
      `Expected "${tc.text}" -> ${tc.expectedIntent}, got ${res.intent}`
    );
    assert.equal(
      res.requiresProductLookup,
      true,
      `Expected requiresProductLookup=true for "${tc.text}", got false`
    );
    assert.equal(
      res.allowRollingContextFallback,
      tc.expectedRollingFallback,
      `Expected allowRollingContextFallback=${tc.expectedRollingFallback} for "${tc.text}"`
    );
  }
  console.log(`PASS: ${productCases.length} product-seeking intents classified with requiresProductLookup=true`);

  // 3. Multi-turn contamination test: prior turns mention polishing machines & pulpits,
  //    followed by "Who are you?", "I have a different query", and "Whom will you connect me to?"
  const priorTurns = [
    { direction: "INBOUND", body: "Do you have acrylic diamond polishing machines?" },
    { direction: "OUTBOUND", body: "Here are our Classic Edge 53 diamond polishing machines..." },
    { direction: "INBOUND", body: "I am looking for pulpits under ₹25,000" },
    { direction: "OUTBOUND", body: "Here are our stage podiums under ₹25,000..." },
  ];

  for (const metaFollowUp of [
    "Who are you?",
    "I have a different query",
    "Where is your factory?",
    "Whom will you connect me to?",
  ]) {
    const copilotRes = await runAcrioChatCopilot({
      customerName: "Test Customer",
      recentMessages: [...priorTurns, { direction: "INBOUND", body: metaFollowUp }],
    });

    assert.equal(
      copilotRes.recommendedProducts.length,
      0,
      `Expected 0 recommendedProducts on "${metaFollowUp}" despite prior product history, got ${copilotRes.recommendedProducts.length}`
    );
    assert.ok(
      !copilotRes.suggestedReplies[0].includes("https://ccapl.cc/"),
      `Expected suggestedReply on "${metaFollowUp}" not to dump product shortlinks, got:\n${copilotRes.suggestedReplies[0]}`
    );

    const recentLogs = readAiTraceLogs({ limit: 5 }).entries;
    const matchingLog = recentLogs.find((l) => l.question === metaFollowUp);
    assert.ok(matchingLog, `Expected ai.logs entry for "${metaFollowUp}"`);
    assert.equal(
      matchingLog.productLookupTriggered,
      false,
      `Expected productLookupTriggered=false in ai.logs for "${metaFollowUp}"`
    );
    assert.equal(
      matchingLog.productLookupTotalScanned,
      0,
      `Expected productLookupTotalScanned=0 in ai.logs for "${metaFollowUp}"`
    );
    assert.equal(
      matchingLog.productsLookedUp.length,
      0,
      `Expected productsLookedUp=[] in ai.logs for "${metaFollowUp}"`
    );
  }
  console.log("PASS: Multi-turn non-product turns trigger zero product lookups and zero prior-product leakage");
  console.log("=== ALL PHASE A WHATSAPP HUB TESTS PASSED ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Phase A test failed:", err);
  process.exit(1);
});
