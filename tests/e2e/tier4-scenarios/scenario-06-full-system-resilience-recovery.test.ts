import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  createTestRequest,
  callRoute,
  mockMeta,
  createTestStaffSession,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import { validateWhatsAppTemplateRules, WhatsAppTemplateDefinition } from "@cc/connections";
import {
  setTestSessionUser,
  generateUniquePhone,
  createSignedWebhookRequest,
} from "../tier3-pairwise/tier3-helper";
import * as whatsappWebhookRoute from "../../../apps/web/src/app/api/webhooks/whatsapp/route";
import * as mediaRoute from "../../../apps/web/src/app/api/media/[id]/route";

describe("Scenario 06: Full System Resilience & Error Recovery (R4 + F6 + F8 + F7 + F10)", () => {
  it("handles corrupted or truncated JSON webhook payloads returning HTTP 400 without crashing server or polluting database", async () => {
    const conv = getRawLibSqlClient("conversations");
    const countBefore = (
      await conv.execute(`SELECT COUNT(*) as cnt FROM messages`)
    ).rows[0]?.cnt;

    // Send malformed non-JSON body with valid HMAC signature
    const malformedRawBody = '{"entry": [{"id": "waba_123", "changes": [MALFORMED_TRUNCATED_JSON...';
    const malformedReq = await createSignedWebhookRequest(malformedRawBody);

    const res = await callRoute(whatsappWebhookRoute, malformedReq);
    assertStrictEqual(res.status, 400, "Malformed JSON must return HTTP 400 Bad Request");

    // Ensure database remained clean with zero new messages added
    const countAfter = (
      await conv.execute(`SELECT COUNT(*) as cnt FROM messages`)
    ).rows[0]?.cnt;
    assertStrictEqual(
      countAfter,
      countBefore,
      "Malformed webhook payload must not write partial or corrupted records to messages"
    );
  });

  it("rejects requests with invalid or forged HMAC signature returning HTTP 401 Unauthorized", async () => {
    const conv = getRawLibSqlClient("conversations");
    const countBefore = (
      await conv.execute(`SELECT COUNT(*) as cnt FROM messages`)
    ).rows[0]?.cnt;

    const fakePayload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_attacker",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                messages: [
                  {
                    from: "919999999999",
                    id: "wamid.forged_001",
                    text: { body: "Injected unauthorized spam" },
                    type: "text",
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    });

    // Send with invalid / forged HMAC signature
    const forgedReq = createTestRequest({
      url: "/api/webhooks/whatsapp",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      },
      body: fakePayload,
    });

    const res = await callRoute(whatsappWebhookRoute, forgedReq);
    assertStrictEqual(res.status, 401, "Forged signature must return HTTP 401 Unauthorized");

    const countAfter = (
      await conv.execute(`SELECT COUNT(*) as cnt FROM messages`)
    ).rows[0]?.cnt;
    assertStrictEqual(
      countAfter,
      countBefore,
      "Forged request must not be written to database"
    );
  });

  it("handles empty or whitespace media IDs safely returning HTTP 400 without uncaught exceptions", async () => {
    const staffSession = await createTestStaffSession();
    setTestSessionUser(staffSession.user);

    const emptyIdReq = createTestRequest({
      url: "/api/media/%20",
      method: "GET",
      sessionToken: staffSession.token,
    });

    const res = await callRoute(mediaRoute, emptyIdReq, { params: { id: "   " } });
    assertStrictEqual(res.status, 400, "Whitespace or empty media ID must return HTTP 400");
    const json = await res.json();
    assertStrictEqual(json.ok, false);
    assertOk(json.error?.toLowerCase().includes("required"));
  });

  it("handles failed delivery receipt for unknown / missing message ID gracefully without data pollution", async () => {
    const unknownWaId = `wamid.missing_msg_${Date.now()}`;

    // Send FAILED status receipt for a message ID that was never sent from our system
    const failedPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_test_123",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "+919876543210", phone_number_id: "phone_id_test_101" },
                statuses: [
                  {
                    id: unknownWaId,
                    status: "failed",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: "919848011223",
                    errors: [
                      {
                        code: 131026,
                        title: "Message undeliverable",
                        message: "Receiver is not registered on WhatsApp",
                      },
                    ],
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };

    const req = await createSignedWebhookRequest(failedPayload);
    const res = await callRoute(whatsappWebhookRoute, req);
    assertStrictEqual(res.status, 200, "Webhook must acknowledge receipt with 200 even if message ID is unknown");
  });

  it("validates template rules and rejects invalid structures (leading variables, unnumbered placeholders) without sending to Meta", () => {
    // 1. Template starting with a variable {{1}} in body (forbidden by Meta)
    const invalidTemplate1: WhatsAppTemplateDefinition = {
      name: "invalid_leading_var",
      language: "en",
      category: "MARKETING",
      bodyText: "{{1}} is your special discount code for acrylic stands.",
      variablesSchema: [{ index: 1, name: "code", sampleValue: "DISC10" }],
      buttons: [],
    };

    const check1 = validateWhatsAppTemplateRules(invalidTemplate1);
    assertStrictEqual(check1.valid, false, "Leading variable must be rejected");
    assertOk(
      check1.errors.some((e) => e.toLowerCase().includes("start") || e.toLowerCase().includes("lead")),
      "Error must explain variable cannot be at the start"
    );

    // 2. Template ending with a variable {{1}} in body (forbidden by Meta)
    const invalidTemplate2: WhatsAppTemplateDefinition = {
      name: "invalid_trailing_var",
      language: "en",
      category: "MARKETING",
      bodyText: "Your delivery date has been scheduled for {{1}}",
      variablesSchema: [{ index: 1, name: "date", sampleValue: "Friday" }],
      buttons: [],
    };

    const check2 = validateWhatsAppTemplateRules(invalidTemplate2);
    assertStrictEqual(check2.valid, false, "Trailing variable must be rejected");
    assertOk(
      check2.errors.some((e) => e.toLowerCase().includes("end") || e.toLowerCase().includes("trail")),
      "Error must explain variable cannot be at the end"
    );

    // 3. Valid template passing all rules
    const validTemplate: WhatsAppTemplateDefinition = {
      name: "valid_acrylic_notification",
      language: "en",
      category: "UTILITY",
      bodyText: "Hello {{1}}, your quotation {{2}} for acrylic podiums is ready.",
      variablesSchema: [
        { index: 1, name: "Name", sampleValue: "Ravi" },
        { index: 2, name: "Quote", sampleValue: "CC-890" },
      ],
      buttons: [],
    };

    const check3 = validateWhatsAppTemplateRules(validTemplate);
    assertStrictEqual(check3.valid, true, "Properly structured template must be accepted");
    assertStrictEqual(check3.errors.length, 0);
  });
});
