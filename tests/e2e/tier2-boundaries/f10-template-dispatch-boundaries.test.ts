import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  mockMeta,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import { sendWhatsAppCloudMessage } from "@cc/connections";

async function enableLiveMetaMock(fn: () => Promise<void>): Promise<void> {
  const orig = process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS;
  delete process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS;
  const auth = getRawLibSqlClient("core_auth");
  await auth.execute({
    sql: `UPDATE setup_state SET value_json = json_set(value_json, '$.mode', 'LIVE_META_CLOUD', '$.phoneNumberId', 'phone_test_101', '$.systemUserAccessToken', 'token_test_101') WHERE key = 'facebook_whatsapp_config'`,
  });
  try {
    await fn();
  } finally {
    if (orig !== undefined) {
      process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS = orig;
    }
  }
}

describe("F10: Template Dispatch Variables - Boundary & Corner Cases", () => {
  it("rejects dispatch with error when recipient phone has fewer than 10 digits", async () => {
    mockMeta.reset();
    const res = await sendWhatsAppCloudMessage({
      toPhone: "98480", // 5 digits - invalid
      bodyText: "Template body",
      templateName: "order_ready",
    });

    assertStrictEqual(res.ok, false);
    assertOk(res.error, "Should return validation error for short phone number");
  });

  it("handles empty string parameter in template components safely", async () => {
    await enableLiveMetaMock(async () => {
      mockMeta.reset();
      const res = await sendWhatsAppCloudMessage({
        toPhone: "919848011223",
        bodyText: "Hello Rajesh",
        templateName: "order_ready",
        templateComponents: [
          {
            type: "body",
            parameters: [{ type: "text", text: "" }],
          },
        ],
      });

      assertOk(res.ok, "Should dispatch without crashing on empty parameter");
      const lastMsg = mockMeta.getLastSentMessage();
      assertOk(lastMsg);
      assertOk(lastMsg.payload.template?.components !== undefined);
    });
  });

  it("forwards custom language code (e.g. Hindi 'hi') correctly in template payload", async () => {
    await enableLiveMetaMock(async () => {
      mockMeta.reset();
      await sendWhatsAppCloudMessage({
        toPhone: "919848011223",
        bodyText: "आपका आर्डर तैयार है",
        templateName: "order_ready_hi",
        languageCode: "hi",
      });

      const lastMsg = mockMeta.getLastSentMessage();
      assertOk(lastMsg, "Outbound message should be sent to Meta Graph API");
      assertStrictEqual(lastMsg.payload.template?.language.code, "hi");
    });
  });

  it("forwards multiple template parameters eliminating Meta error 132000", async () => {
    await enableLiveMetaMock(async () => {
      mockMeta.reset();
      const components = [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Vikram" },
            { type: "text", text: "ORD-991" },
            { type: "text", text: "Hyderabad Warehouse" },
          ],
        },
      ];

      await sendWhatsAppCloudMessage({
        toPhone: "9848011223",
        bodyText: "Order update",
        templateName: "order_multi_var",
        templateComponents: components,
      });

      const lastMsg = mockMeta.getLastSentMessage();
      assertOk(lastMsg);
      assertStrictEqual(lastMsg.payload.template?.name, "order_multi_var");
      assertStrictEqual(lastMsg.payload.template?.components?.length, 1);
      assertStrictEqual(lastMsg.payload.template?.components?.[0].parameters?.length, 3);
    });
  });

  it("forwards header image/document component parameters accurately", async () => {
    await enableLiveMetaMock(async () => {
      mockMeta.reset();
      const components = [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: { link: "https://ccapl.cc/assets/sample-podium.jpg" },
            },
          ],
        },
        {
          type: "body",
          parameters: [{ type: "text", text: "Customer Name" }],
        },
      ];

      await sendWhatsAppCloudMessage({
        toPhone: "919848011223",
        bodyText: "Header template message",
        templateName: "catalog_promo_header",
        templateComponents: components,
      });

      const lastMsg = mockMeta.getLastSentMessage();
      assertOk(lastMsg);
      assertStrictEqual(lastMsg.payload.template?.components?.length, 2);
      assertStrictEqual(lastMsg.payload.template?.components?.[0].type, "header");
    });
  });
});
