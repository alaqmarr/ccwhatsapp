import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertNoBuzzwords,
  assertNoDashes,
  createTestRequest,
  callRoute,
  mockMeta,
  createTestStaffSession,
  createTestDevSession,
} from "../harness";
import { callClaudeHaikuMessages, formatWhatsAppOutboundText } from "@cc/connections";
import { setTestSessionUser } from "./tier3-helper";

describe("Pairwise 04: AI Model Lock, Buzzword Sanitization & Role Visibility (F15 + F16 + F18)", () => {
  it("strictly locks AI model to claude-haiku-5-5 when calling Anthropic API (F15)", async () => {
    mockMeta.reset();
    mockMeta.setClaudeResponse("We manufacture acrylic displays and podiums.");

    const reply = await callClaudeHaikuMessages({
      apiKey: "test_anthropic_api_key_valid",
      system: "You are Classic Concepts client support assistant.",
      messages: [{ role: "user", content: "What products do you make?" }],
    });

    assertOk(reply, "callClaudeHaikuMessages should return assistant response");
    const lastCall = mockMeta.getLastClaudeCall();
    assertOk(lastCall, "Should record outbound Claude call in mockMeta");
    assertStrictEqual(lastCall.model, "claude-haiku-5-5", "Outbound model must strictly be claude-haiku-5-5");
  });

  it("sanitizes all 13 forbidden AI buzzwords to everyday plain English (F16)", () => {
    const rawAiText1 =
      "We utilize bespoke optical-grade acrylic to elevate your displays\u2014delivering seamless, state-of-the-art results.";
    const sanitized1 = formatWhatsAppOutboundText(rawAiText1);

    // Verify all buzzwords removed
    assertNoBuzzwords(sanitized1);
    assertStrictEqual(
      sanitized1,
      "We use custom-made crystal-clear acrylic to improve your displays, delivering smooth, modern results."
    );

    const rawAiText2 =
      "Delve into our catalog, leverage consultative support, and utilize robust cutting-edge sheets with unparalleled, meticulous clarity.";
    const sanitized2 = formatWhatsAppOutboundText(rawAiText2);
    assertNoBuzzwords(sanitized2);
    assertStrictEqual(
      sanitized2,
      "check into our catalog, use helpful support, and use strong modern sheets with top, careful clarity."
    );
  });

  it("sanitizes em-dashes, spaced en-dashes, and double hyphens without breaking commas (F16)", () => {
    const rawPunctuation =
      "Acrylic sheets\u2014clear and durable \u2013 ready for dispatch--order today";
    const sanitized = formatWhatsAppOutboundText(rawPunctuation);

    assertNoDashes(sanitized);
    assertStrictEqual(
      sanitized,
      "Acrylic sheets, clear and durable, ready for dispatch, order today"
    );
  });

  it("hides billing rates and cost breakdown from regular staff users (F18)", async () => {
    const staffSession = await createTestStaffSession();
    setTestSessionUser(staffSession.user);

    const pricingRoute = await import("../../../apps/web/src/app/api/pricing/route");

    const req = createTestRequest({
      url: "/api/pricing",
      method: "GET",
      sessionToken: staffSession.token,
    });

    const res = await callRoute(pricingRoute, req);
    res.assertStatus(403);
    const body = await res.json<{ ok: boolean; error: string }>();
    assertStrictEqual(body.ok, false);
    assertOk(body.error.includes("Cost breakdown requires Superadmin or Dev access"));
  });

  it("permits DEV role access to pricing API and wholesale cost logs (F18)", async () => {
    const devSession = await createTestDevSession();
    setTestSessionUser(devSession.user);

    const pricingRoute = await import("../../../apps/web/src/app/api/pricing/route");

    const req = createTestRequest({
      url: "/api/pricing?scope=dev",
      method: "GET",
      sessionToken: devSession.token,
    });

    const res = await callRoute(pricingRoute, req);
    res.assertStatus(200);
    const body = await res.json<{ ok: boolean; viewMode: string }>();
    assertStrictEqual(body.ok, true);
    assertStrictEqual(body.viewMode, "dev_actual_and_margin", "DEV role must see dev_actual_and_margin viewMode");
  });
});
