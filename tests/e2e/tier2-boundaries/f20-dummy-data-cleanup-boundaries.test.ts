import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";
import { getRawLibSqlClient, ensureDatabasesBootstrapped } from "@cc/database";

describe("F20: Dummy Data Cleanup & Production Hygiene - Boundary & Corner Cases", () => {
  it("ensureDatabasesBootstrapped is idempotent and does not throw on repeated calls", async () => {
    // Calling bootstrap multiple times concurrently or sequentially
    await ensureDatabasesBootstrapped();
    await ensureDatabasesBootstrapped();
    await ensureDatabasesBootstrapped();
    assertOk(true, "Multiple calls must resolve cleanly without schema errors");
  });

  it("core_auth setup_state contains valid configuration records", async () => {
    const auth = getRawLibSqlClient("core_auth");
    const res = await auth.execute({
      sql: `SELECT key, value_json FROM setup_state WHERE key = 'facebook_whatsapp_config' LIMIT 1`,
      args: [],
    });

    assertStrictEqual(res.rows.length, 1);
    const parsed = JSON.parse(String(res.rows[0].value_json));
    assertOk(parsed.verifiedName, "verifiedName should be defined");
    assertOk(parsed.webhookVerifyToken, "webhookVerifyToken should be defined");
  });

  it("billing_ops contains pricing_config with positive rates", async () => {
    const bill = getRawLibSqlClient("billing_ops");
    const res = await bill.execute({
      sql: `SELECT * FROM pricing_config WHERE id = 'default' LIMIT 1`,
      args: [],
    });

    assertStrictEqual(res.rows.length, 1);
    const cfg = res.rows[0];
    assertOk(Number(cfg.client_marketing_rate_inr) > 0, "Marketing rate should be positive");
    assertOk(Number(cfg.client_other_rate_inr) > 0, "Other rate should be positive");
  });

  it("marketing templates table exists and maintains valid structure without mock corruption", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const res = await mkt.execute({
      sql: `SELECT id, name, category, language, body_text FROM templates LIMIT 10`,
      args: [],
    });

    assertOk(res.rows.length >= 1, "Expected baseline seeded templates in database");
    for (const tpl of res.rows) {
      assertOk(tpl.id, "Template must have an id");
      assertOk(tpl.name, "Template must have a name");
      assertOk(tpl.body_text, "Template must have body_text");
    }
  });

  it("broadcast queue settings table has valid default pacing configuration", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const res = await mkt.execute({
      sql: `SELECT id, default_pacing_mode, delay_seconds, batch_size FROM broadcast_queue_settings WHERE id = 'default' LIMIT 1`,
      args: [],
    });

    assertStrictEqual(res.rows.length, 1);
    assertStrictEqual(res.rows[0].default_pacing_mode, "SAFE_STEADY");
    assertOk(Number(res.rows[0].delay_seconds) > 0);
  });
});
