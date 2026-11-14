import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  mockMeta,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import {
  callClaudeHaikuMessages,
  formatWhatsAppOutboundText,
  runAcrioChatCopilot,
  sendWhatsAppCloudMessage,
} from "@cc/connections";
import { generateUniquePhone } from "../tier3-pairwise/tier3-helper";

describe("Scenario 03: AI Copilot Support Interaction & Buzzword Sanitization (F15 + F16 + R3)", () => {
  it("processes customer acrylic question, invokes Claude Haiku 5.5, sanitizes forbidden buzzwords, and dispatches clean message", async () => {
    mockMeta.reset();
    const phone = generateUniquePhone();

    // 1. Set mock Claude response containing multiple forbidden AI buzzwords, em-dashes, and complex English
    const mockRawAiResponse =
      "We utilize bespoke optical-grade acrylic to elevate your banquet showroom — delivering seamless, state-of-the-art results with meticulous craftsmanship.";
    mockMeta.setClaudeResponse(mockRawAiResponse);

    // 2. Customer question triggers AI response generation via callClaudeHaikuMessages
    const rawAiReply = await callClaudeHaikuMessages({
      apiKey: "test_anthropic_api_key_valid",
      system: "You are Classic Concepts client support assistant. Reply in simple plain English.",
      messages: [
        {
          role: "user",
          content: "Hello, what acrylic display stands and podiums do you make for banquet halls?",
        },
      ],
    });

    // 3. Verify Claude API call is strictly locked to model "claude-haiku-5-5"
    assertOk(mockMeta.claudeCalls.length > 0, "Claude API messages endpoint must have been called");
    const lastCall = mockMeta.getLastClaudeCall();
    assertOk(lastCall, "Should record outbound Claude call in mockMeta");
    assertStrictEqual(
      lastCall.model,
      "claude-haiku-5-5",
      "AI model MUST be strictly locked to claude-haiku-5-5"
    );

    // 4. Verify text sanitizer formatWhatsAppOutboundText eliminated all buzzwords and em-dashes
    const sanitizedText = formatWhatsAppOutboundText(rawAiReply);

    // Forbidden buzzwords checks
    assertOk(!sanitizedText.toLowerCase().includes("bespoke"), "Must not contain 'bespoke'");
    assertOk(!sanitizedText.toLowerCase().includes("optical-grade"), "Must not contain 'optical-grade'");
    assertOk(!sanitizedText.toLowerCase().includes("utilize"), "Must not contain 'utilize'");
    assertOk(!sanitizedText.toLowerCase().includes("elevate"), "Must not contain 'elevate'");
    assertOk(!sanitizedText.toLowerCase().includes("meticulous"), "Must not contain 'meticulous'");
    assertOk(!sanitizedText.toLowerCase().includes("seamless"), "Must not contain 'seamless'");
    assertOk(!sanitizedText.toLowerCase().includes("state-of-the-art"), "Must not contain 'state-of-the-art'");

    // Punctuation checks: zero em-dashes or double hyphens
    assertOk(!sanitizedText.includes("—"), "Must not contain em-dash '—'");
    assertOk(!sanitizedText.includes("--"), "Must not contain double hyphens '--'");

    // 5. Verify plain-language substitutions exist
    assertOk(sanitizedText.includes("custom-made") || sanitizedText.includes("custom"), "Must use 'custom-made' or 'custom'");
    assertOk(sanitizedText.includes("crystal-clear"), "Must use 'crystal-clear'");
    assertOk(sanitizedText.includes("use"), "Must use 'use'");
    assertOk(sanitizedText.includes("improve"), "Must use 'improve'");
    assertOk(sanitizedText.includes("smooth"), "Must use 'smooth'");

    // 6. Dispatch reply to customer
    const sendResult = await sendWhatsAppCloudMessage({
      toPhone: phone,
      bodyText: sanitizedText,
    });
    assertStrictEqual(sendResult.ok, true, "Outbound WhatsApp send must succeed");
    assertStrictEqual(sendResult.deliveryStatus, "DELIVERED");

    // 7. Verify sent message in conversations database
    const conv = getRawLibSqlClient("conversations");
    const convId = `conv_ai_${Date.now()}`;
    const nowIso = new Date().toISOString();

    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, status, priority, last_message_preview, last_message_at, created_at
      ) VALUES (?, ?, 'Vikram Reddy', 'OPEN', 'NORMAL', ?, ?, ?)`,
      args: [convId, phone, sanitizedText.slice(0, 80), nowIso, nowIso],
    });

    const msgId = `msg_ai_reply_${Date.now()}`;
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'STAFF', 'ACRIO Copilot', 'TEXT', 'FREE_CHAT', ?, 'DELIVERED', ?)`,
      args: [msgId, convId, sanitizedText, nowIso],
    });

    const savedMsg = await conv.execute({
      sql: `SELECT body FROM messages WHERE id = ?`,
      args: [msgId],
    });
    assertStrictEqual(savedMsg.rows[0]?.body, sanitizedText);

    // 8. Test Acrio Chat Copilot category and priority determination
    const copilotResult = await runAcrioChatCopilot({
      customerName: "Vikram Reddy",
      organizationType: "Hotel/Hospitality",
      recentMessages: [
        {
          direction: "INBOUND",
          body: "We need 2 acrylic banquet podiums with gold logo for our conference hall.",
        },
      ],
    });

    assertStrictEqual(copilotResult.smartCategory, "Podiums & Stage");
    assertOk(Array.isArray(copilotResult.suggestedReplies), "Must return array of suggested replies");
    assertOk(copilotResult.suggestedReplies.length > 0, "Must have at least one suggested reply");
  });

  it("verifies direct callClaudeHaikuMessages enforces claude-haiku-5-5 and system prompt plain language rules", async () => {
    mockMeta.reset();
    mockMeta.setClaudeResponse("Here are our clear acrylic menu stands for your banquet tables.");

    const res = await callClaudeHaikuMessages({
      apiKey: "test_anthropic_api_key_valid",
      system: "You are Classic Concepts client support assistant. Reply in simple plain English.",
      messages: [{ role: "user", content: "Do you have A5 size stands?" }],
    });

    assertStrictEqual(mockMeta.claudeCalls.length, 1);
    assertStrictEqual(mockMeta.claudeCalls[0].model, "claude-haiku-5-5");
    assertOk(res.includes("clear acrylic menu stands"));
  });
});
