import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  ensureDatabasesBootstrapped,
  extractCustomerCoreNouns,
  getRawLibSqlClient,
} from "../packages/database/src/index";
import {
  createEmptyAcrioConversationState,
  normalizeCustomerProductTypos,
  reconstructAcrioConversationState,
  runAcrioAutonomousTurn,
  stripBurstMediaPlaceholders,
} from "../packages/connections/src/index";
import { processInboundAutomations } from "../packages/workers/src/index";

async function main() {
  process.env.WHATSAPP_FORCE_SANDBOX = "1";
  // Test deterministic & state paths without spending live Anthropic tokens
  process.env.CC_CLIENT_ANTHROPIC_API_KEY = "";
  process.env.ANTHROPIC_API_KEY = "";

  await ensureDatabasesBootstrapped();
  let passed = 0;
  const check = (cond: unknown, label: string) => {
    assert.ok(cond, `FAIL: ${label}`);
    passed++;
    console.log(`  [PASS] ${label}`);
  };

  console.log("=== 1. Typo Normalization, Placeholder Stripping & Core-Noun Extraction ===");
  const norm = normalizeCustomerProductTypos("Acylirc Mobile phone lockr photo pls");
  check(
    norm.toLowerCase().includes("acrylic") && norm.toLowerCase().includes("locker"),
    `Normalizes "Acylirc" -> "acrylic" and "lockr" -> "locker" (${norm})`
  );

  const stripped = stripBurstMediaPlaceholders(
    "On black acrylic\nAcylirc Mobile phone locker photo pls\n[Message]\n[Image]\n[Image]\n[Image]"
  );
  check(
    stripped.cleanText === "On black acrylic\nAcylirc Mobile phone locker photo pls",
    `Strips [Message] and [Image] placeholders cleanly from burst text`
  );
  check(
    stripped.images === 3 && stripped.unreadable === 1,
    `Counts 3 images and 1 [Message] placeholder in burst`
  );

  const fragmentNouns = extractCustomerCoreNouns("On black acrylic");
  check(
    fragmentNouns.length === 0,
    `"On black acrylic" has 0 core product nouns (got [${fragmentNouns.join(", ")}])`
  );

  const lockerNouns = extractCustomerCoreNouns(
    "On black acrylic\nAcylirc Mobile phone locker photo pls\n[Image]"
  );
  check(
    lockerNouns.includes("mobile") &&
      lockerNouns.includes("phone") &&
      lockerNouns.includes("locker") &&
      !lockerNouns.includes("image") &&
      !lockerNouns.includes("acylirc"),
    `Extracts ["mobile", "phone", "locker"] without "image" or "acylirc" (got [${lockerNouns.join(", ")}])`
  );

  console.log("\n=== 2. Coalesced 6-Message Burst (Exact Jgd Ashish Sahu Transcript Scenario) ===");
  const convIdBurst = `conv_burst_${crypto.randomUUID().slice(0, 8)}`;
  const burstRes = await runAcrioAutonomousTurn({
    conversationId: convIdBurst,
    customerName: "Jgd Ashish Sahu",
    customerPhone: "+919424959711",
    inboundText:
      "On black acrylic\nAcylirc Mobile phone locker photo pls\n[Message]\n[Image]\n[Image]\n[Image]",
    recentMessages: [
      { direction: "INBOUND", body: "Hi" },
      {
        direction: "OUTBOUND",
        body: "Hi Jgd, welcome to Classic Concepts! What are you looking to display, build, or make today?",
      },
    ],
    hasAlreadyGreeted: true,
    attachment: { mediaType: "IMAGE" },
    burstAttachments: {
      images: 3,
      documents: 0,
      videos: 0,
      audios: 0,
      unreadable: 1,
    },
    enableInteractive: false,
  });

  console.log("  [Burst Reply]:\n" + burstRes.customerReply);
  check(
    !/bathroom\s*stool|yyvuvx/i.test(burstRes.customerReply),
    "NEVER recommends Acrylic Bathroom Stool (yyvuvX) on black acrylic mobile phone locker burst"
  );
  check(
    !/transparent\s*image/i.test(burstRes.customerReply),
    "NEVER matches 'Acrylic Transparent Image' from [Image] placeholder"
  );
  check(
    !(burstRes.mediaAttachments || []).some((a) => /stool/i.test(a.productName)),
    "NEVER attaches R2 photo of Acrylic Bathroom Stool"
  );
  check(
    /locker/i.test(burstRes.customerReply) && /black/i.test(burstRes.customerReply),
    "Acknowledges black acrylic mobile phone locker requirement in the unified reply"
  );
  check(
    /3\s+reference\s+photos|reference\s+photos/i.test(burstRes.customerReply),
    "Acknowledges the customer's 3 reference photos in the same unified reply"
  );
  check(
    burstRes.needsHumanHandoff === true,
    "Routes combined custom locker + reference photos burst to human Sales & Fabrication Team"
  );

  console.log("\n=== 3. Multi-Message Enquiry Sent Across Pauses (Turn-by-Turn Break Continuity) ===");
  const convIdSplit = `conv_split_${crypto.randomUUID().slice(0, 8)}`;
  let state = createEmptyAcrioConversationState();
  const splitHistory: { direction: "INBOUND" | "OUTBOUND"; body: string }[] = [
    { direction: "INBOUND", body: "Hi" },
    {
      direction: "OUTBOUND",
      body: "Hi Jgd, welcome to Classic Concepts! What are you looking to display, build, or make today?",
    },
  ];

  // Turn 1: Customer sends ONLY "On black acrylic" and pauses
  splitHistory.push({ direction: "INBOUND", body: "On black acrylic" });
  const t1 = await runAcrioAutonomousTurn({
    conversationId: convIdSplit,
    customerName: "Jgd Ashish Sahu",
    customerPhone: "+919424959711",
    inboundText: "On black acrylic",
    recentMessages: splitHistory,
    persistedState: state,
    hasAlreadyGreeted: true,
    enableInteractive: false,
  });
  state = t1.conversationState!;
  splitHistory.push({ direction: "OUTBOUND", body: t1.customerReply });
  console.log("  [Turn 1 Reply]: " + t1.customerReply.replace(/\n+/g, " | "));
  check(
    !/bathroom\s*stool|yyvuvx/i.test(t1.customerReply),
    "Turn 1 ('On black acrylic' alone) NEVER guesses Acrylic Bathroom Stool"
  );
  check(
    state.preferences.includes("black"),
    "Turn 1 saves 'black' in conversationState.preferences"
  );
  check(
    state.lastRecommendedProducts.length === 0,
    "Turn 1 does not pollute lastRecommendedProducts with random black items"
  );

  // Turn 2: Customer sends "Acylirc Mobile phone locker photo pls"
  splitHistory.push({ direction: "INBOUND", body: "Acylirc Mobile phone locker photo pls" });
  const t2 = await runAcrioAutonomousTurn({
    conversationId: convIdSplit,
    customerName: "Jgd Ashish Sahu",
    customerPhone: "+919424959711",
    inboundText: "Acylirc Mobile phone locker photo pls",
    recentMessages: splitHistory,
    persistedState: state,
    hasAlreadyGreeted: true,
    enableInteractive: false,
  });
  state = t2.conversationState!;
  splitHistory.push({ direction: "OUTBOUND", body: t2.customerReply });
  console.log("  [Turn 2 Reply]: " + t2.customerReply.replace(/\n+/g, " | "));
  check(
    !/bathroom\s*stool|yyvuvx/i.test(t2.customerReply),
    "Turn 2 ('Acylirc Mobile phone locker photo pls') NEVER returns Acrylic Bathroom Stool"
  );
  check(
    state.preferences.includes("black") && /locker/i.test(state.primaryProductQuery || ""),
    `Turn 2 combines 'black' from Turn 1 with '${state.primaryProductQuery}' from Turn 2`
  );
  check(
    /locker/i.test(t2.customerReply) && /black/i.test(t2.customerReply),
    "Turn 2 addresses Black Acrylic Mobile Phone Locker fabrication"
  );

  // Turn 3: Customer sends 3 reference photos
  splitHistory.push({ direction: "INBOUND", body: "[Image]\n[Image]\n[Image]" });
  const t3 = await runAcrioAutonomousTurn({
    conversationId: convIdSplit,
    customerName: "Jgd Ashish Sahu",
    customerPhone: "+919424959711",
    inboundText: "[Image]\n[Image]\n[Image]",
    recentMessages: splitHistory,
    persistedState: state,
    hasAlreadyGreeted: true,
    attachment: { mediaType: "IMAGE" },
    burstAttachments: { images: 3, documents: 0, videos: 0, audios: 0, unreadable: 0 },
    enableInteractive: false,
  });
  console.log("  [Turn 3 Reply]: " + t3.customerReply.replace(/\n+/g, " | "));
  check(
    /3\s+reference\s+photos/i.test(t3.customerReply) && /locker/i.test(t3.customerReply),
    "Turn 3 connects the 3 reference photos to the active mobile phone locker requirement"
  );
  check(t3.needsHumanHandoff === true, "Turn 3 hands off to Sales Team for review");

  console.log("\n=== 4. 6-Message Split Enquiry Across Breaks (Podium + Finish + Venue + Budget + Raise + Photos) ===");
  const convIdSix = `conv_six_${crypto.randomUUID().slice(0, 8)}`;
  let sixState = createEmptyAcrioConversationState();
  const sixHistory: { direction: "INBOUND" | "OUTBOUND"; body: string }[] = [];
  const sixTurns = [
    "Hi",
    "We need a pulpit",
    "In frosted white or clear",
    "For our college auditorium",
    "Under 25000 budget",
    "We can increase budget to 30000, share options",
  ];
  for (let i = 0; i < sixTurns.length - 1; i++) {
    const msg = sixTurns[i];
    sixHistory.push({ direction: "INBOUND", body: msg });
    sixState = reconstructAcrioConversationState({
      persistedState: sixState,
      recentMessages: sixHistory,
      currentInboundText: msg,
    });
    sixHistory.push({ direction: "OUTBOUND", body: "Noted, here are our options." });
  }
  const finalSixMsg = sixTurns[sixTurns.length - 1];
  sixHistory.push({ direction: "INBOUND", body: finalSixMsg });
  const lastSixRes = await runAcrioAutonomousTurn({
    conversationId: convIdSix,
    customerName: "Dr. Ramesh",
    customerPhone: "+919800011223",
    inboundText: finalSixMsg,
    recentMessages: sixHistory,
    persistedState: sixState,
    hasAlreadyGreeted: true,
    enableInteractive: false,
  });
  sixState = lastSixRes.conversationState!;
  console.log(
    `  [6-Turn State]: family=${sixState.productFamily}, maxPrice=${sixState.maxPrice}, app=${sixState.applicationContext}, prefs=[${sixState.preferences.join(",")}]`
  );
  check(
    sixState.productFamily === "podium" &&
      sixState.maxPrice === 30000 &&
      (sixState.applicationContext === "auditorium" ||
        sixState.applicationContext === "college") &&
      sixState.preferences.includes("frosted"),
    `6-turn split enquiry preserves podium + auditorium/college + frosted + ₹30,000 budget`
  );
  check(
    /podium|ccp/i.test(lastSixRes.customerReply) && !/bathroom\s*stool/i.test(lastSixRes.customerReply),
    "6-turn split enquiry recommends matching podiums within ₹30,000"
  );

  console.log("\n=== 5. End-to-End Worker Debounce & Burst Coalescing (6 Rapid Bubbles -> 1 Unified Reply) ===");
  process.env.ACRIO_DISABLE_DEBOUNCE = "0";
  process.env.ACRIO_INBOUND_DEBOUNCE_MS = "120";
  const convDb = getRawLibSqlClient("conversations");
  const e2eConvId = `conv_e2e_burst_${crypto.randomUUID().slice(0, 8)}`;
  const e2ePhone = `+9194249${Math.floor(10000 + Math.random() * 89999)}`;
  const baseTs = Date.now() - 10_000;

  await convDb.execute({
    sql: `INSERT INTO conversations (
      id, customer_phone, customer_name, status, smart_category, priority,
      assigned_staff_id, assigned_staff_name, assigned_team_name, unread_count,
      last_message_preview, last_message_at, created_at
    ) VALUES (?, ?, 'Jgd Ashish Sahu', 'OPEN', 'General Enquiry', 'NORMAL', 'ACRIO', 'ACRIO', 'System (ACRIO)', 1, 'Hi', ?, ?)`,
    args: [e2eConvId, e2ePhone, new Date(baseTs).toISOString(), new Date(baseTs).toISOString()],
  });

  // Seed initial Hi + greeting
  await convDb.execute({
    sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, body, created_at)
          VALUES (?, ?, 'INBOUND', 'CUSTOMER', 'Jgd Ashish Sahu', 'TEXT', 'Hi', ?)`,
    args: [`m_hi_${e2eConvId}`, e2eConvId, new Date(baseTs + 100).toISOString()],
  });
  await convDb.execute({
    sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, body, created_at)
          VALUES (?, ?, 'OUTBOUND', 'AI', 'ACRIO', 'TEXT', 'Hi Jgd, welcome to Classic Concepts!', ?)`,
    args: [`m_greet_${e2eConvId}`, e2eConvId, new Date(baseTs + 200).toISOString()],
  });

  const rapidBubbles: Array<{
    body: string;
    mType: string;
    att?: { mediaType: string };
  }> = [
    { body: "On black acrylic", mType: "TEXT" },
    { body: "Acylirc Mobile phone locker photo pls", mType: "TEXT" },
    { body: "[Message]", mType: "TEXT" },
    { body: "[Image]", mType: "IMAGE", att: { mediaType: "IMAGE" } },
    { body: "[Image]", mType: "IMAGE", att: { mediaType: "IMAGE" } },
    { body: "[Image]", mType: "IMAGE", att: { mediaType: "IMAGE" } },
  ];

  const pendingPromises: Promise<void>[] = [];
  for (let i = 0; i < rapidBubbles.length; i++) {
    const b = rapidBubbles[i];
    const msgId = `m_b_${i}_${e2eConvId}`;
    const waId = `wamid.burst.${i}.${e2eConvId}`;
    const createdAt = new Date(baseTs + 1000 + i * 10).toISOString();
    await convDb.execute({
      sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, body, wa_message_id, created_at)
            VALUES (?, ?, 'INBOUND', 'CUSTOMER', 'Jgd Ashish Sahu', ?, ?, ?, ?)`,
      args: [msgId, e2eConvId, b.mType, b.body, waId, createdAt],
    });
    pendingPromises.push(
      processInboundAutomations({
        conversationId: e2eConvId,
        customerPhone: e2ePhone,
        inboundText: b.body,
        isNewConversation: false,
        waMessageId: waId,
        attachment: b.att || null,
      })
    );
  }

  await Promise.all(pendingPromises);

  const outRows = await convDb.execute({
    sql: `SELECT body, message_type FROM messages
          WHERE conversation_id = ? AND direction = 'OUTBOUND' AND created_at > ?
          ORDER BY created_at ASC`,
    args: [e2eConvId, new Date(baseTs + 500).toISOString()],
  });

  console.log(
    `  [E2E Outbound Messages Sent After 6-Bubble Burst]: count=${outRows.rows.length}`
  );
  for (const r of outRows.rows) {
    console.log(`    -> (${r.message_type}): ${String(r.body).replace(/\n+/g, " | ")}`);
  }

  check(
    outRows.rows.length === 1,
    `Sent exactly 1 unified outbound reply for the 6-bubble burst (got ${outRows.rows.length})`
  );
  const unifiedOutboundBody = String(outRows.rows[0]?.body || "");
  check(
    !/bathroom\s*stool|yyvuvx/i.test(unifiedOutboundBody),
    "E2E unified outbound reply NEVER mentions Acrylic Bathroom Stool"
  );
  check(
    /locker/i.test(unifiedOutboundBody) &&
      /black/i.test(unifiedOutboundBody) &&
      /reference\s+photos/i.test(unifiedOutboundBody),
    "E2E unified outbound reply acknowledges black acrylic mobile phone locker + reference photos together"
  );

  // Cleanup test conversation rows
  await convDb.execute({
    sql: `DELETE FROM messages WHERE conversation_id IN (?, ?, ?, ?)`,
    args: [convIdBurst, convIdSplit, convIdSix, e2eConvId],
  });
  await convDb.execute({
    sql: `DELETE FROM conversations WHERE id IN (?, ?, ?, ?)`,
    args: [convIdBurst, convIdSplit, convIdSix, e2eConvId],
  });

  console.log(`\nALL ${passed} MULTI-MESSAGE BURST & RELEVANCE CHECKS PASSED!`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
