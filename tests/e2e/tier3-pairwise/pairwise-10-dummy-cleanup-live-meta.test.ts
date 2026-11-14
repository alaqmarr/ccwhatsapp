import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  mockMeta,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import {
  syncTemplatesFromMetaCloud,
  buildMetaGraphTemplatePayload,
  sendWhatsAppCloudMessage,
} from "@cc/connections";

describe("Pairwise 10: Production Clean State & Live Meta Cloud Pipeline (F20 + F11 + F10)", () => {
  it("verifies clean database state with zero dummy broadcasts or invalid ledger rows (F20)", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const bill = getRawLibSqlClient("billing_ops");

    // In clean test/production initialization, no fake demo marketing broadcasts exist
    const demoBroadcasts = await mkt.execute(
      `SELECT COUNT(*) as cnt FROM broadcasts WHERE name LIKE '%Demo%' OR name LIKE '%Fake%'`
    );
    assertStrictEqual(
      Number(demoBroadcasts.rows[0]?.cnt ?? 0),
      0,
      "Expected zero demo broadcasts in clean state"
    );

    // Verify billing ledger has zero corrupted or negative margin records
    const invalidMargins = await bill.execute(
      `SELECT COUNT(*) as cnt FROM message_billing_ledger WHERE margin_inr < 0 OR client_unit_rate_inr <= 0`
    );
    assertStrictEqual(
      Number(invalidMargins.rows[0]?.cnt ?? 0),
      0,
      "Expected zero invalid or negative margin rows in billing ledger"
    );

    // Verify SEED_DEMO_DATA environment guard strictly controls mock seeding
    assertOk(
      process.env.SEED_DEMO_DATA === "1" || process.env.SEED_DEMO_DATA === "0",
      "SEED_DEMO_DATA must be explicitly defined as 1 or 0"
    );
  });

  it("verifies live Meta Graph API template schema mapping vs sandbox fallback (F10)", async () => {
    mockMeta.reset();

    const auth = getRawLibSqlClient("core_auth");
    await auth.execute({
      sql: `UPDATE setup_state SET value_json = json_set(value_json, '$.mode', 'LIVE_META_CLOUD', '$.wabaId', 'waba_live_p10', '$.systemUserAccessToken', 'EAAB_token_p10') WHERE key = 'facebook_whatsapp_config'`,
      args: [],
    });

    // Provide mock live Meta templates fixture
    mockMeta.templatesFixture = [
      {
        id: "meta_tpl_p10_live",
        name: "production_delivery_alert",
        status: "APPROVED",
        category: "UTILITY",
        language: "en_US",
        components: [
          {
            type: "BODY",
            text: "Hello {{1}}, your acrylic shipment {{2}} is on the way.",
            example: {
              body_text: [["Rahul", "ACR-9921"]],
            },
          },
        ],
      },
    ];

    const result = await syncTemplatesFromMetaCloud();
    assertStrictEqual(result.mode, "LIVE_META_CLOUD");
    assertStrictEqual(result.syncedCount >= 1, true);

    const mkt = getRawLibSqlClient("marketing");
    const tplRow = await mkt.execute({
      sql: `SELECT name, category, approval_status, body_text FROM templates WHERE name = 'production_delivery_alert'`,
      args: [],
    });

    assertStrictEqual(tplRow.rows.length, 1);
    const tpl = tplRow.rows[0] as any;
    assertStrictEqual(tpl.approval_status, "APPROVED");
    assertStrictEqual(tpl.category, "UTILITY");
    assertOk(
      String(tpl.body_text).includes("{{1}}") && String(tpl.body_text).includes("{{2}}"),
      "Template body text must preserve parameter placeholders"
    );
  });

  it("verifies outbound Graph API payload format for template dispatches (F11)", async () => {
    mockMeta.reset();

    // 1. Verify buildMetaGraphTemplatePayload generates correct Meta structure
    const payload = buildMetaGraphTemplatePayload({
      name: "custom_acrylic_quote_v2",
      language: "en",
      category: "MARKETING",
      headerType: "TEXT",
      headerText: "Classic Concepts Quote #{{1}}",
      bodyText: "Dear {{2}}, your quotation for {{3}} is ready.",
      footerText: "Reply STOP to unsubscribe",
      buttons: [
        {
          type: "QUICK_REPLY",
          text: "Approve Quote",
        },
      ],
      variablesSchema: [
        { index: 1, name: "QuoteNo", sampleValue: "CC-901" },
        { index: 2, name: "Name", sampleValue: "Amit" },
        { index: 3, name: "Item", sampleValue: "Acrylic Display" },
      ],
    });

    assertStrictEqual(payload.name, "custom_acrylic_quote_v2");
    assertStrictEqual(payload.category, "MARKETING");
    assertOk(Array.isArray(payload.components), "Components must be an array");

    const header = (payload.components as any[]).find((c) => c.type === "HEADER");
    assertOk(header, "Header component must exist");
    assertStrictEqual(header.format, "TEXT");

    const body = (payload.components as any[]).find((c) => c.type === "BODY");
    assertOk(body, "Body component must exist");

    // 2. Test sendWhatsAppCloudMessage in LIVE_META_CLOUD mode
    const auth = getRawLibSqlClient("core_auth");
    await auth.execute({
      sql: `UPDATE setup_state SET value_json = json_set(value_json, '$.mode', 'LIVE_META_CLOUD', '$.phoneNumberId', 'phone_id_p10', '$.systemUserAccessToken', 'EAAB_token_p10') WHERE key = 'facebook_whatsapp_config'`,
      args: [],
    });

    const prevEnv = process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS;
    delete process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS;

    try {
      const sendRes = await sendWhatsAppCloudMessage({
        toPhone: "+919848011223",
        bodyText: "Template fallback text",
        templateName: "custom_acrylic_quote_v2",
        languageCode: "en",
        templateComponents: [
          {
            type: "header",
            parameters: [{ type: "text", text: "CC-901" }],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: "Amit" },
              { type: "text", text: "Acrylic Display" },
            ],
          },
        ],
      });

      assertStrictEqual(sendRes.ok, true);
      assertStrictEqual(sendRes.mode, "LIVE_META_CLOUD");
      assertOk(mockMeta.sentMessages.length > 0, "Should have recorded outbound message");

      const lastSent = mockMeta.sentMessages[mockMeta.sentMessages.length - 1];
      const sentPayload = lastSent.payload as any;
      assertStrictEqual(sentPayload?.type, "template");
      assertStrictEqual(sentPayload?.template?.name, "custom_acrylic_quote_v2");
      assertStrictEqual(sentPayload?.to, "919848011223");
    } finally {
      if (prevEnv) process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS = prevEnv;
    }
  });

  it("verifies database schema integrity across templates, broadcasts, and messages (F10 + F11)", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const conv = getRawLibSqlClient("conversations");

    // Inspect templates columns
    const tplCols = await mkt.execute(`PRAGMA table_info(templates);`);
    const tplColNames = new Set(tplCols.rows.map((r: any) => r.name));
    assertOk(tplColNames.has("id"), "templates must have id");
    assertOk(tplColNames.has("name"), "templates must have name");
    assertOk(tplColNames.has("category"), "templates must have category");
    assertOk(tplColNames.has("approval_status"), "templates must have approval_status");
    assertOk(tplColNames.has("variables_schema_json"), "templates must have variables_schema_json");

    // Inspect broadcasts columns
    const bcCols = await mkt.execute(`PRAGMA table_info(broadcasts);`);
    const bcColNames = new Set(bcCols.rows.map((r: any) => r.name));
    assertOk(bcColNames.has("id"), "broadcasts must have id");
    assertOk(bcColNames.has("template_id"), "broadcasts must have template_id");
    assertOk(bcColNames.has("status"), "broadcasts must have status");
    assertOk(bcColNames.has("sent_count"), "broadcasts must have sent_count");
    assertOk(bcColNames.has("delivered_count"), "broadcasts must have delivered_count");
    assertOk(bcColNames.has("read_count"), "broadcasts must have read_count");
    assertOk(bcColNames.has("failed_count"), "broadcasts must have failed_count");

    // Inspect messages columns
    const msgCols = await conv.execute(`PRAGMA table_info(messages);`);
    const msgColNames = new Set(msgCols.rows.map((r: any) => r.name));
    assertOk(msgColNames.has("id"), "messages must have id");
    assertOk(msgColNames.has("conversation_id"), "messages must have conversation_id");
    assertOk(msgColNames.has("direction"), "messages must have direction");
    assertOk(msgColNames.has("message_type"), "messages must have message_type");
    assertOk(msgColNames.has("delivery_status"), "messages must have delivery_status");
    assertOk(msgColNames.has("created_at"), "messages must have created_at");
  });

  it("verifies production mode guard preventing mock simulator fallback when live Meta credentials are set (F11 + F20)", async () => {
    mockMeta.reset();

    const auth = getRawLibSqlClient("core_auth");
    await auth.execute({
      sql: `UPDATE setup_state SET value_json = json_set(value_json, '$.mode', 'LIVE_META_CLOUD', '$.phoneNumberId', 'phone_err_test', '$.systemUserAccessToken', 'EAAB_token_err') WHERE key = 'facebook_whatsapp_config'`,
      args: [],
    });

    // Mock Graph API returning Meta HTTP 400 with Graph error
    mockMeta.nextGraphError = {
      message: "(#100) Invalid parameter: template not found",
      type: "OAuthException",
      code: 100,
    };

    const prevEnv = process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS;
    delete process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS;

    try {
      const sendRes = await sendWhatsAppCloudMessage({
        toPhone: "+919848011223",
        bodyText: "Sample test text",
      });

      // Production mode must NOT fall back to simulator and claim success
      assertStrictEqual(sendRes.ok, false);
      assertStrictEqual(sendRes.mode, "LIVE_META_CLOUD");
      assertStrictEqual(sendRes.deliveryStatus, "FAILED");
      assertOk(
        sendRes.error?.includes("Invalid parameter") || sendRes.error?.includes("100"),
        "Must return real Meta Graph API error message"
      );
    } finally {
      if (prevEnv) process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS = prevEnv;
    }
  });
});
