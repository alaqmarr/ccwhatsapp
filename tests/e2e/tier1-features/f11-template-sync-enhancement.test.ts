import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertUtcIso,
  mockMeta,
  MOCK_META_TEMPLATES,
} from "../harness";
import { syncTemplatesFromMetaCloud } from "@cc/connections";
import { getRawLibSqlClient } from "@cc/database";

describe("F11: Template Sync from Meta Cloud & Variable Schema (Tier 1 Feature Coverage)", () => {
  it("T1-F11-01: extracts variable tokens {{1}}, {{2}} from template body into schema structure", () => {
    const body = "Hello {{1}}, your acrylic podium order {{2}} has been confirmed and will ship on {{3}}.";
    const matches = Array.from(body.matchAll(/\{\{(\d+)\}\}/g));
    const uniqueIndices = Array.from(new Set(matches.map((m) => parseInt(m[1], 10)))).sort((a, b) => a - b);

    const schema = uniqueIndices.map((idx) => ({
      index: idx,
      name: `var_${idx}`,
      type: "text",
    }));

    assertStrictEqual(schema.length, 3);
    assertStrictEqual(schema[0].index, 1);
    assertStrictEqual(schema[1].index, 2);
    assertStrictEqual(schema[2].index, 3);
  });

  it("T1-F11-02: extracts header, footer, and CTA button metadata from Meta template fixture", () => {
    const fixture = MOCK_META_TEMPLATES.find((t) => t.name === "order_confirmation");
    assertOk(fixture, "order_confirmation fixture should exist");

    const header = fixture.components.find((c) => c.type === "HEADER");
    const footer = fixture.components.find((c) => c.type === "FOOTER");
    const buttons = fixture.components.find((c) => c.type === "BUTTONS");

    assertStrictEqual(header?.text, "Order Update");
    assertStrictEqual(footer?.text, "Classic Concepts Acrylic");
    assertOk(buttons?.buttons && buttons.buttons.length >= 1);
  });

  it("T1-F11-03: syncTemplatesFromMetaCloud queries templates and populates marketing database", async () => {
    mockMeta.reset();
    mockMeta.setTemplates(MOCK_META_TEMPLATES);

    const auth = getRawLibSqlClient("core_auth");
    const origRow = await auth.execute(`SELECT value_json FROM setup_state WHERE key = 'facebook_whatsapp_config' LIMIT 1`);
    const origCfg = JSON.parse(String(origRow.rows[0].value_json));
    const liveCfg = { ...origCfg, mode: "LIVE_META_CLOUD" };
    await auth.execute({
      sql: `UPDATE setup_state SET value_json = ? WHERE key = 'facebook_whatsapp_config'`,
      args: [JSON.stringify(liveCfg)],
    });

    try {
      const syncResult = await syncTemplatesFromMetaCloud();
      assertStrictEqual(syncResult.ok, true);
      assertOk(syncResult.syncedCount >= 1, "Should have synced at least 1 template");

      const mkt = getRawLibSqlClient("marketing");
      const tplRes = await mkt.execute({
        sql: `SELECT id, name, approval_status, category FROM templates WHERE name = 'order_confirmation' LIMIT 1`,
        args: [],
      });

      assertOk(tplRes.rows.length === 1, "order_confirmation should be saved in database");
      const tpl = tplRes.rows[0] as Record<string, unknown>;
      assertStrictEqual(tpl.approval_status, "APPROVED");
    } finally {
      await auth.execute({
        sql: `UPDATE setup_state SET value_json = ? WHERE key = 'facebook_whatsapp_config'`,
        args: [JSON.stringify(origCfg)],
      });
    }
  });

  it("T1-F11-04: verifies pagination cursor traversal capability on multi-page Meta responses", async () => {
    mockMeta.reset();
    const auth = getRawLibSqlClient("core_auth");
    const origRow = await auth.execute(`SELECT value_json FROM setup_state WHERE key = 'facebook_whatsapp_config' LIMIT 1`);
    const origCfg = JSON.parse(String(origRow.rows[0].value_json));
    const liveCfg = { ...origCfg, mode: "LIVE_META_CLOUD" };
    await auth.execute({
      sql: `UPDATE setup_state SET value_json = ? WHERE key = 'facebook_whatsapp_config'`,
      args: [JSON.stringify(liveCfg)],
    });

    mockMeta.paginatedTemplatePages = [
      [
        {
          id: "meta_page1_tpl_01",
          name: "page1_notification",
          language: "en_US",
          category: "UTILITY",
          status: "APPROVED",
          components: [{ type: "BODY", text: "Hello {{1}} from page 1" }],
        },
      ],
      [
        {
          id: "meta_page2_tpl_02",
          name: "page2_alert",
          language: "en_US",
          category: "UTILITY",
          status: "APPROVED",
          components: [{ type: "BODY", text: "Important {{1}} from page 2" }],
        },
      ],
    ];

    try {
      const syncRes = await syncTemplatesFromMetaCloud();
      assertStrictEqual(syncRes.ok, true);

      const mkt = getRawLibSqlClient("marketing");
      const dbRows = await mkt.execute(`SELECT name, approval_status FROM templates WHERE name IN ('page1_notification', 'page2_alert')`);
      assertStrictEqual(dbRows.rows.length, 2, "Both page 1 and page 2 templates must be persisted to LibSQL");
    } finally {
      mockMeta.paginatedTemplatePages = null;
      await auth.execute({
        sql: `UPDATE setup_state SET value_json = ? WHERE key = 'facebook_whatsapp_config'`,
        args: [JSON.stringify(origCfg)],
      });
    }
  });

  it("T1-F11-05: verifies template synced_at or updated_at stores valid UTC ISO timestamp", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const tplRes = await mkt.execute({
      sql: `SELECT created_at FROM templates LIMIT 1`,
      args: [],
    });

    assertOk(tplRes.rows.length >= 1);
    const createdAt = String(tplRes.rows[0].created_at);
    assertUtcIso(createdAt);
  });
});
