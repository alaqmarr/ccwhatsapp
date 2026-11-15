import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  classifyAcrioInboundIntent,
  runAcrioAutonomousTurn,
} from "../packages/connections/src/index";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
} from "../packages/database/src/index";
import {
  claimInboundWaMessageId,
  processInboundAutomations,
  resetClaimedWaMessageIdsForTest,
} from "../packages/workers/src/index";

async function main() {
  console.log(
    "=== Phase D Regression Suite (ccwhatsapp): Response Relevance, WhatsApp Handoff, Idempotency & Human Takeover ==="
  );

  // Temporarily disable live API keys so deterministic turn tests verify fast local & guard paths without spending credits
  const savedClientKey = process.env.ANTHROPIC_CLIENT_API_KEY;
  const savedApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_CLIENT_API_KEY = "";
  process.env.ANTHROPIC_API_KEY = "";

  try {
    await ensureDatabasesBootstrapped();
    const conv = getRawLibSqlClient("conversations");

    // ------------------------------------------------------------------------
    // 1. Informational Handoff Questions vs Explicit Human Handoff Requests
    // ------------------------------------------------------------------------
    const infoQuestions = [
      "Whom will you connect me to?",
      "Who handles custom quotes?",
      "Who is your sales manager?",
      "What team will you connect me to?",
      "Can I know who I will talk to?",
      "How does human support work?",
    ];
    for (const q of infoQuestions) {
      const res = classifyAcrioInboundIntent(q, true);
      assert.equal(
        res.intent,
        "HUMAN_HANDOFF_INFO",
        `Expected HUMAN_HANDOFF_INFO for "${q}", got ${res.intent}`
      );
      assert.equal(
        res.needsImmediateHandoff,
        false,
        `"${q}" must NOT trigger immediate human handoff`
      );
      assert.equal(res.requiresProductLookup, false);
    }

    const handoffRequests = [
      "Connect me to a human",
      "Can you connect me to a human?",
      "Talk to sales team",
      "Can someone call me?",
      "Yes, please connect me",
      "Connect me now",
      "I want to speak with a person",
    ];
    for (const q of handoffRequests) {
      const res = classifyAcrioInboundIntent(q, true);
      assert.equal(
        res.intent,
        "HUMAN_HANDOFF_REQUEST",
        `Expected HUMAN_HANDOFF_REQUEST for "${q}", got ${res.intent}`
      );
      assert.equal(
        res.needsImmediateHandoff,
        true,
        `"${q}" MUST trigger immediate human handoff`
      );
      assert.equal(res.requiresProductLookup, false);
    }
    console.log(
      "  [PASS] Informational handoff questions vs explicit human handoff requests classified accurately"
    );

    // ------------------------------------------------------------------------
    // 2. Response Relevance After Active Product Conversation (Zero Product Leakage) & Context-Preserving Handoff
    // ------------------------------------------------------------------------
    const turn1 = await runAcrioAutonomousTurn({
      customerName: "Pastor David",
      inboundText: "I am looking for pulpits under ₹25,000",
      recentMessages: [],
      hasAlreadyGreeted: false,
      persistedState: null,
    });
    assert.equal(turn1.needsHumanHandoff, false);
    assert.ok(turn1.conversationState);

    const turn2 = await runAcrioAutonomousTurn({
      customerName: "Pastor David",
      inboundText: "We can increase the budget to ₹30,000",
      recentMessages: [
        { direction: "INBOUND", body: "I am looking for pulpits under ₹25,000" },
        { direction: "OUTBOUND", body: turn1.customerReply },
      ],
      hasAlreadyGreeted: true,
      persistedState: turn1.conversationState,
    });
    assert.equal(turn2.needsHumanHandoff, false);
    assert.equal(turn2.conversationState?.maxPrice, 30000);

    // Turn 3: "Who are you?" after pulpit discussion -> must answer directly with 0 ccapl.cc product links
    const turn3Who = await runAcrioAutonomousTurn({
      customerName: "Pastor David",
      inboundText: "Who are you?",
      recentMessages: [
        { direction: "INBOUND", body: "I am looking for pulpits under ₹25,000" },
        { direction: "OUTBOUND", body: turn1.customerReply },
        { direction: "INBOUND", body: "We can increase the budget to ₹30,000" },
        { direction: "OUTBOUND", body: turn2.customerReply },
      ],
      hasAlreadyGreeted: true,
      persistedState: turn2.conversationState,
    });
    assert.equal(turn3Who.needsHumanHandoff, false);
    assert.ok(/ACRIO/i.test(turn3Who.customerReply));
    assert.ok(
      !/ccapl\.cc/i.test(turn3Who.customerReply),
      `"Who are you?" must not leak product shortlinks: ${turn3Who.customerReply}`
    );

    // Turn 4: "Whom will you connect me to?" -> must NOT handoff, must explain Sales Team with 0 product links
    const turn4Whom = await runAcrioAutonomousTurn({
      customerName: "Pastor David",
      inboundText: "Whom will you connect me to?",
      recentMessages: [
        { direction: "INBOUND", body: "We can increase the budget to ₹30,000" },
        { direction: "OUTBOUND", body: turn2.customerReply },
        { direction: "INBOUND", body: "Who are you?" },
        { direction: "OUTBOUND", body: turn3Who.customerReply },
      ],
      hasAlreadyGreeted: true,
      persistedState: turn3Who.conversationState,
    });
    assert.equal(
      turn4Whom.needsHumanHandoff,
      false,
      `"Whom will you connect me to?" must keep needsHumanHandoff=false`
    );
    assert.ok(/Sales/i.test(turn4Whom.customerReply));
    assert.ok(!/ccapl\.cc/i.test(turn4Whom.customerReply));

    // Turn 5: "Connect me to a human" -> MUST trigger handoff and preserve pulpit + ₹30,000 context in handoffReason & smartCategory!
    const turn5Handoff = await runAcrioAutonomousTurn({
      customerName: "Pastor David",
      inboundText: "Connect me to a human",
      recentMessages: [
        { direction: "INBOUND", body: "Whom will you connect me to?" },
        { direction: "OUTBOUND", body: turn4Whom.customerReply },
      ],
      hasAlreadyGreeted: true,
      persistedState: turn4Whom.conversationState,
    });
    assert.equal(turn5Handoff.needsHumanHandoff, true);
    assert.equal(turn5Handoff.smartCategory, "Podiums & Stage");
    assert.ok(
      /pulpit/i.test(turn5Handoff.handoffReason) &&
        /30,000/.test(turn5Handoff.handoffReason),
      `Expected handoffReason to carry over pulpit + ₹30,000 context, got: "${turn5Handoff.handoffReason}"`
    );
    console.log(
      "  [PASS] Multi-turn non-product replies have 0 leaked product links and handoff preserves customer requirement context"
    );

    // ------------------------------------------------------------------------
    // 3. Webhook wamid Idempotency & Duplicate Prevention
    // ------------------------------------------------------------------------
    resetClaimedWaMessageIdsForTest();
    const testConvId = `conv_phased_${crypto.randomUUID().slice(0, 8)}`;
    const testPhone = `+919900${Math.floor(100000 + Math.random() * 899999)}`;
    const nowIso = new Date().toISOString();

    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, status, priority, smart_category,
        assigned_staff_id, assigned_staff_name, assigned_team_id, assigned_team_name,
        escalation_level, unread_count, last_message_preview, last_message_at, created_at
      ) VALUES (?, ?, 'Phase D Test Customer', 'OPEN', 'NORMAL', 'General Enquiry', 'ACRIO', 'ACRIO', NULL, 'System (ACRIO)', 'P0', 1, 'Hi', ?, ?)`,
      args: [testConvId, testPhone, nowIso, nowIso],
    });

    const dupWamid = `wamid.PHASED_${crypto.randomUUID().slice(0, 8)}`;
    const firstClaim = await claimInboundWaMessageId(dupWamid);
    const secondClaim = await claimInboundWaMessageId(dupWamid);
    assert.equal(firstClaim, true, "First wamid delivery must be claimed");
    assert.equal(secondClaim, false, "Duplicate wamid retry must be rejected");

    // Also verify processInboundAutomations deduplicates repeated calls with the same waMessageId
    const autoWamid = `wamid.AUTO_${crypto.randomUUID().slice(0, 8)}`;
    await processInboundAutomations({
      conversationId: testConvId,
      customerPhone: testPhone,
      inboundText: "Hello",
      isNewConversation: true,
      waMessageId: autoWamid,
    });
    await processInboundAutomations({
      conversationId: testConvId,
      customerPhone: testPhone,
      inboundText: "Hello",
      isNewConversation: true,
      waMessageId: autoWamid,
    });

    const msgsAfterDup = await conv.execute({
      sql: `SELECT id, direction, sender_type FROM messages WHERE conversation_id = ?`,
      args: [testConvId],
    });
    assert.equal(
      msgsAfterDup.rows.length,
      1,
      `Expected exactly 1 outbound ACRIO message after duplicate wamid retry, got ${msgsAfterDup.rows.length}`
    );
    console.log(
      "  [PASS] Webhook wamid idempotency prevents duplicate message inserts and duplicate ACRIO replies"
    );

    // ------------------------------------------------------------------------
    // 4. Mid-Flight Human Takeover Race Protection & Post-Takeover AI Suspension
    // ------------------------------------------------------------------------
    await processInboundAutomations({
      conversationId: testConvId,
      customerPhone: testPhone,
      inboundText: "I am looking for pulpits under ₹25,000",
      isNewConversation: false,
      waMessageId: `wamid.RACE_${crypto.randomUUID().slice(0, 8)}`,
      onBeforeAcrioSend: async () => {
        // Simulate a human staff member taking over the chat while ACRIO was generating its reply
        await conv.execute({
          sql: `UPDATE conversations
                SET status = 'ASSIGNED',
                    assigned_staff_id = 'staff_human_1',
                    assigned_staff_name = 'Rahul (Sales)',
                    assigned_team_id = 'team_sales',
                    assigned_team_name = 'Sales Team'
                WHERE id = ?`,
          args: [testConvId],
        });
      },
    });

    const msgsAfterMidFlightTakeover = await conv.execute({
      sql: `SELECT id FROM messages WHERE conversation_id = ?`,
      args: [testConvId],
    });
    assert.equal(
      msgsAfterMidFlightTakeover.rows.length,
      1,
      "Mid-flight human takeover must suppress ACRIO's in-flight outbound reply"
    );

    const convAfterTakeover = await conv.execute({
      sql: `SELECT status, assigned_staff_id, waiting_since FROM conversations WHERE id = ? LIMIT 1`,
      args: [testConvId],
    });
    assert.equal(
      String(convAfterTakeover.rows[0]?.assigned_staff_id),
      "staff_human_1",
      "Mid-flight takeover must NOT be overwritten back to ACRIO"
    );

    // Subsequent customer message while human-owned must NOT trigger ACRIO and must start waiting_since
    await processInboundAutomations({
      conversationId: testConvId,
      customerPhone: testPhone,
      inboundText: "Can you share the quotation today?",
      isNewConversation: false,
      waMessageId: `wamid.POST_TAKEOVER_${crypto.randomUUID().slice(0, 8)}`,
    });

    const msgsAfterHumanOwnedTurn = await conv.execute({
      sql: `SELECT id FROM messages WHERE conversation_id = ?`,
      args: [testConvId],
    });
    assert.equal(
      msgsAfterHumanOwnedTurn.rows.length,
      1,
      "Human-owned conversation must not trigger ACRIO auto-replies"
    );

    const convAfterHumanWait = await conv.execute({
      sql: `SELECT waiting_since FROM conversations WHERE id = ? LIMIT 1`,
      args: [testConvId],
    });
    assert.ok(
      convAfterHumanWait.rows[0]?.waiting_since,
      "Human-owned conversation must set waiting_since on new customer message"
    );
    console.log(
      "  [PASS] Mid-flight human takeover race protection and post-takeover AI suspension verified"
    );

    // Cleanup test conversation
    await conv.execute({
      sql: `DELETE FROM messages WHERE conversation_id = ?`,
      args: [testConvId],
    });
    await conv.execute({
      sql: `DELETE FROM conversations WHERE id = ?`,
      args: [testConvId],
    });

    console.log(
      "\nALL PHASE D RESPONSE RELEVANCE, HANDOFF, IDEMPOTENCY & HUMAN TAKEOVER TESTS PASSED (ccwhatsapp)!"
    );
  } finally {
    if (savedClientKey !== undefined) {
      process.env.ANTHROPIC_CLIENT_API_KEY = savedClientKey;
    }
    if (savedApiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedApiKey;
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Phase D test failed:", err);
  process.exit(1);
});
