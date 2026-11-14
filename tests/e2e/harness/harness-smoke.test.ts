import {
  describe,
  it,
  assertStrictEqual,
  assertDeepStrictEqual,
  assertOk,
  assertThrows,
  assertIstFormatted,
  assertUtcIso,
  assertNoBuzzwords,
  assertNoDashes,
  createTestRequest,
  createJsonRequest,
  callRoute,
  mockMeta,
  getSandboxDataDir,
  createTestDevSession,
  createTestStaffSession,
  MOCK_META_TEMPLATES,
  MOCK_INBOUND_MEDIA_PAYLOADS,
  MOCK_STATUS_RECEIPTS,
} from "./index";
import { getRawLibSqlClient } from "@cc/database";
import * as whatsappWebhookRoute from "../../../apps/web/src/app/api/webhooks/whatsapp/route";

describe("Harness Smoke Test Suite", () => {
  it("verifies isolated SQLite sandbox environment is active", async () => {
    const sandboxDir = getSandboxDataDir();
    assertOk(sandboxDir, "Sandbox directory should be active");
    assertStrictEqual(process.env.APP_TIMEZONE, "Asia/Kolkata");
    assertStrictEqual(process.env.WHATSAPP_MODE, "SANDBOX_SIMULATOR");

    // Verify core_auth database has seeded users
    const auth = getRawLibSqlClient("core_auth");
    const res = await auth.execute({
      sql: `SELECT id, role, status FROM users WHERE status = 'ACTIVE'`,
      args: [],
    });
    assertOk(res.rows.length >= 1, "Expected at least 1 active user in seeded sandbox DB");
  });

  it("verifies test session creation for DEV and STAFF roles", async () => {
    const devSession = await createTestDevSession();
    assertOk(devSession.token, "DEV session token should be generated");
    assertStrictEqual(devSession.user.role, "DEV");

    const staffSession = await createTestStaffSession();
    assertOk(staffSession.token, "STAFF session token should be generated");
    assertStrictEqual(staffSession.user.role, "STAFF");
  });

  it("verifies in-process Next.js App Router route execution without TCP ports", async () => {
    // GET verification handshake with incorrect token -> should return 403
    const req = createTestRequest({
      url: "/api/webhooks/whatsapp",
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "intentionally_wrong_token",
        "hub.challenge": "challenge_12345",
      },
    });

    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(403);
    const body = await res.json<{ ok: boolean; error: string }>();
    assertStrictEqual(body.ok, false);
  });

  it("verifies custom IST date formatting assertions", () => {
    // Valid IST formats
    assertIstFormatted("10:30 AM", { format: "time" });
    assertIstFormatted("08:15 PM", { format: "time" });
    assertIstFormatted("15 Nov 2026", { format: "date" });
    assertIstFormatted("15 Nov 2026, 10:30 AM", { format: "dateTime" });
    assertIstFormatted("15 Nov", { format: "dateShort" });
    assertIstFormatted("15 Nov, 10:30 AM", { format: "dateTimeShort" });
    assertIstFormatted("Yesterday", { format: "threadTime" });

    // Invalid formats should throw AssertionError
    assertThrows(() => {
      assertIstFormatted("2026-11-15T10:30:00Z", { format: "time" });
    });
  });

  it("verifies UTC ISO timestamp assertions", () => {
    // Valid UTC ISO strings
    assertUtcIso("2026-11-15T05:00:00.000Z");
    assertUtcIso("2026-11-15T10:30:00Z");

    // Invalid non-UTC strings should throw AssertionError
    assertThrows(() => {
      assertUtcIso("2026-11-15 10:30:00");
    });
    assertThrows(() => {
      assertUtcIso("2026-11-15T10:30:00+05:30");
    });
  });

  it("verifies anti-AI buzzword and plain-language assertions", () => {
    // Valid plain English copy
    assertNoBuzzwords("We supply acrylic podiums and laser-cut clear display sheets.");
    assertNoBuzzwords("Check our product catalog for strong and modern acrylic stands.");

    // Copy with forbidden buzzwords should throw AssertionError
    assertThrows(() => {
      assertNoBuzzwords("We craft bespoke acrylic podiums for corporate events.");
    });
    assertThrows(() => {
      assertNoBuzzwords("Elevate your store with seamless and optical-grade acrylic displays.");
    });
  });

  it("verifies forbidden punctuation assertions (zero em-dashes or double-hyphens)", () => {
    // Valid punctuation
    assertNoDashes("Cast acrylic sheets, clear and durable, ready for dispatch.");

    // Em-dash should throw
    assertThrows(() => {
      assertNoDashes("Cast acrylic sheets\u2014clear and durable.");
    });

    // Spaced en-dash should throw
    assertThrows(() => {
      assertNoDashes("Cast acrylic sheets \u2013 clear and durable.");
    });

    // Double hyphen should throw
    assertThrows(() => {
      assertNoDashes("Cast acrylic sheets--clear and durable.");
    });
  });

  it("verifies Mock Meta API and Claude API interception", async () => {
    mockMeta.reset();
    mockMeta.setClaudeResponse("We offer crystal-clear acrylic sheet fabrication.");

    // Simulated fetch call to Anthropic Messages API
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        messages: [{ role: "user", content: "What products do you supply?" }],
      }),
    });

    assertStrictEqual(claudeRes.status, 200);
    const claudeData = await claudeRes.json();
    assertStrictEqual(claudeData.content[0].text, "We offer crystal-clear acrylic sheet fabrication.");

    const lastClaudeCall = mockMeta.getLastClaudeCall();
    assertOk(lastClaudeCall);
    assertStrictEqual(lastClaudeCall.model, "claude-haiku-5-5");

    // Simulated fetch call to Meta Graph API
    const metaRes = await fetch("https://graph.facebook.com/v21.0/123456/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: "919848011223",
        type: "text",
        text: { body: "Your order is ready." },
      }),
    });

    assertStrictEqual(metaRes.status, 200);
    const metaData = await metaRes.json();
    assertOk(metaData.messages[0].id.startsWith("wamid."));

    const lastMetaMessage = mockMeta.getLastSentMessage();
    assertOk(lastMetaMessage);
    assertStrictEqual(lastMetaMessage.payload.to, "919848011223");
  });

  it("verifies mock fixtures and media payloads availability", () => {
    assertOk(MOCK_META_TEMPLATES.length >= 3);
    const imgPayload = MOCK_INBOUND_MEDIA_PAYLOADS.image();
    assertStrictEqual(imgPayload.entry[0].changes[0].value.messages[0].type, "image");

    const docPayload = MOCK_INBOUND_MEDIA_PAYLOADS.document();
    assertStrictEqual(docPayload.entry[0].changes[0].value.messages[0].type, "document");

    const deliveredReceipt = MOCK_STATUS_RECEIPTS.delivered("wamid.test_101");
    assertStrictEqual(deliveredReceipt.entry[0].changes[0].value.statuses[0].status, "delivered");
  });
});
