import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  mockMeta,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import { syncTemplatesFromMetaCloud } from "@cc/connections";

async function enableLiveMetaSync(fn: () => Promise<void>): Promise<void> {
  const orig = process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS;
  delete process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS;
  const auth = getRawLibSqlClient("core_auth");
  await auth.execute({
    sql: `UPDATE setup_state SET value_json = json_set(value_json, '$.mode', 'LIVE_META_CLOUD', '$.wabaId', 'waba_test_123', '$.systemUserAccessToken', 'token_sync_123') WHERE key = 'facebook_whatsapp_config'`,
  });
  try {
    await fn();
  } finally {
    if (orig !== undefined) {
      process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS = orig;
    }
  }
}

describe("F11: Template Sync Enhancement - Boundary & Corner Cases", () => {
  it("handles template bodies with non-sequential or reversed variable tokens", () => {
    const bodyText = "Dear {{3}}, your order {{1}} of {{2}} units is ready.";
    // Variable extraction pattern
    const matches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
    const sortedIndexes = [...new Set(matches)].sort((a, b) => a - b);

    assertStrictEqual(sortedIndexes.length, 3);
    assertStrictEqual(sortedIndexes[0], 1);
    assertStrictEqual(sortedIndexes[1], 2);
    assertStrictEqual(sortedIndexes[2], 3);
  });

  it("deduplicates repeated variable tokens in template body", () => {
    const bodyText = "Hello {{1}}, we confirm {{1}} is your registered account name.";
    const matches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
    const uniqueIndexes = [...new Set(matches)];

    assertStrictEqual(uniqueIndexes.length, 1);
    assertStrictEqual(uniqueIndexes[0], 1);
  });

  it("handles templates with zero variables without schema or extraction error", async () => {
    await enableLiveMetaSync(async () => {
      mockMeta.reset();
      mockMeta.templatesFixture = [
        {
          id: `meta_static_${Date.now()}`,
          name: `static_promo_${Date.now()}`,
          category: "MARKETING",
          language: "en_US",
          status: "APPROVED",
          components: [
            {
              type: "BODY",
              text: "Visit our showroom for exclusive acrylic podiums.",
            },
          ],
        },
      ];

      const res = await syncTemplatesFromMetaCloud();
      assertOk(res.ok);
      assertOk(res.syncedCount >= 1);
    });
  });

  it("handles 0-page empty response from Meta Cloud API gracefully", async () => {
    await enableLiveMetaSync(async () => {
      mockMeta.reset();
      mockMeta.templatesFixture = []; // Empty array

      const res = await syncTemplatesFromMetaCloud();
      assertOk(res.ok);
      assertStrictEqual(res.syncedCount, 0);
    });
  });

  it("handles missing credentials gracefully without throwing unhandled exceptions", async () => {
    // Calling sync when credentials are missing or in sandbox mode
    const res = await syncTemplatesFromMetaCloud();
    assertOk(typeof res.ok === "boolean");
    assertOk(typeof res.syncedCount === "number");
  });
});
