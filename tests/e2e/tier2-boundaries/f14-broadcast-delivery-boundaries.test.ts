import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import { applyWhatsAppMessageReceipt, cancelMarketingBroadcast } from "@cc/workers";

describe("F14: Broadcast Delivery Tracking - Boundary & Corner Cases", () => {
  it("duplicate DELIVERED receipts do NOT double-increment broadcast delivered_count", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const bcId = `bc_dup_test_${Date.now()}`;
    const recId = `rec_dup_${Date.now()}`;
    const testWamid = `wamid.bc_dup_${Date.now()}`;

    // Create a broadcast campaign with all required NOT NULL columns
    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category,
        status, total_recipients, sent_count, delivered_count, read_count, failed_count, created_by_name, created_at
      ) VALUES (?, 'Dup Receipt Campaign', 'lst_1', 'VIPs', 'tpl_1', 'promo_v1', 'MARKETING', 'SENDING', 1, 1, 0, 0, 0, 'Admin', datetime('now'))`,
      args: [bcId],
    });

    // Create recipient in SENT status with required scheduled_at
    await mkt.execute({
      sql: `INSERT INTO broadcast_recipients (id, broadcast_id, customer_phone, wa_message_id, status, scheduled_at, created_at)
            VALUES (?, ?, '+919848011223', ?, 'SENT', datetime('now'), datetime('now'))`,
      args: [recId, bcId, testWamid],
    });

    // First DELIVERED receipt
    await applyWhatsAppMessageReceipt({
      waMessageId: testWamid,
      status: "DELIVERED",
    });

    // Second (duplicate) DELIVERED receipt from Meta retry
    await applyWhatsAppMessageReceipt({
      waMessageId: testWamid,
      status: "DELIVERED",
    });

    const checkRes = await mkt.execute({
      sql: `SELECT delivered_count, read_count FROM broadcasts WHERE id = ?`,
      args: [bcId],
    });

    // delivered_count must be 1, never 2
    assertStrictEqual(checkRes.rows[0].delivered_count, 1, "Delivered count must not double-increment on duplicate receipt");
  });

  it("READ receipt increments read_count without double-counting delivered_count", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const bcId = `bc_read_test_${Date.now()}`;
    const recId = `rec_read_${Date.now()}`;
    const testWamid = `wamid.bc_read_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category,
        status, total_recipients, sent_count, delivered_count, read_count, failed_count, created_by_name, created_at
      ) VALUES (?, 'Read Count Campaign', 'lst_1', 'VIPs', 'tpl_1', 'promo_v1', 'MARKETING', 'SENDING', 1, 1, 0, 0, 0, 'Admin', datetime('now'))`,
      args: [bcId],
    });

    await mkt.execute({
      sql: `INSERT INTO broadcast_recipients (id, broadcast_id, customer_phone, wa_message_id, status, scheduled_at, created_at)
            VALUES (?, ?, '+919848011224', ?, 'SENT', datetime('now'), datetime('now'))`,
      args: [recId, bcId, testWamid],
    });

    // Delivered receipt arrives
    await applyWhatsAppMessageReceipt({
      waMessageId: testWamid,
      status: "DELIVERED",
    });

    // Read receipt arrives
    await applyWhatsAppMessageReceipt({
      waMessageId: testWamid,
      status: "READ",
    });

    const checkRes = await mkt.execute({
      sql: `SELECT delivered_count, read_count FROM broadcasts WHERE id = ?`,
      args: [bcId],
    });

    assertStrictEqual(checkRes.rows[0].delivered_count, 1);
    assertStrictEqual(checkRes.rows[0].read_count, 1);
  });

  it("out-of-order receipt: DELIVERED arriving after READ preserves READ status", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const bcId = `bc_ooo_test_${Date.now()}`;
    const recId = `rec_ooo_${Date.now()}`;
    const testWamid = `wamid.bc_ooo_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category,
        status, total_recipients, sent_count, delivered_count, read_count, failed_count, created_by_name, created_at
      ) VALUES (?, 'Out Of Order Campaign', 'lst_1', 'VIPs', 'tpl_1', 'promo_v1', 'MARKETING', 'SENDING', 1, 1, 0, 0, 0, 'Admin', datetime('now'))`,
      args: [bcId],
    });

    await mkt.execute({
      sql: `INSERT INTO broadcast_recipients (id, broadcast_id, customer_phone, wa_message_id, status, scheduled_at, created_at)
            VALUES (?, ?, '+919848011225', ?, 'SENT', datetime('now'), datetime('now'))`,
      args: [recId, bcId, testWamid],
    });

    // READ arrives first (e.g. fast user opening WhatsApp on desktop)
    await applyWhatsAppMessageReceipt({
      waMessageId: testWamid,
      status: "READ",
    });

    // Late DELIVERED packet arrives
    await applyWhatsAppMessageReceipt({
      waMessageId: testWamid,
      status: "DELIVERED",
    });

    const recRes = await mkt.execute({
      sql: `SELECT status FROM broadcast_recipients WHERE id = ?`,
      args: [recId],
    });

    assertStrictEqual(recRes.rows[0].status, "READ", "Recipient status must not downgrade from READ to DELIVERED");
  });

  it("broadcast cancellation transitions status to CANCELLED", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const bcId = `bc_cancel_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category,
        status, total_recipients, sent_count, delivered_count, read_count, failed_count, created_by_name, created_at
      ) VALUES (?, 'Cancel Me Campaign', 'lst_1', 'VIPs', 'tpl_1', 'promo_v1', 'MARKETING', 'PAUSED', 10, 0, 0, 0, 0, 'Admin', datetime('now'))`,
      args: [bcId],
    });

    await cancelMarketingBroadcast(bcId);

    const checkRes = await mkt.execute({
      sql: `SELECT status FROM broadcasts WHERE id = ?`,
      args: [bcId],
    });

    assertStrictEqual(checkRes.rows[0].status, "CANCELLED");
  });

  it("accurately updates failed_count when recipient fails delivery", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const bcId = `bc_fail_test_${Date.now()}`;
    const recId = `rec_fail_${Date.now()}`;
    const testWamid = `wamid.bc_fail_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category,
        status, total_recipients, sent_count, delivered_count, read_count, failed_count, created_by_name, created_at
      ) VALUES (?, 'Failed Receipt Campaign', 'lst_1', 'VIPs', 'tpl_1', 'promo_v1', 'MARKETING', 'SENDING', 1, 1, 0, 0, 0, 'Admin', datetime('now'))`,
      args: [bcId],
    });

    await mkt.execute({
      sql: `INSERT INTO broadcast_recipients (id, broadcast_id, customer_phone, wa_message_id, status, scheduled_at, created_at)
            VALUES (?, ?, '+919848011226', ?, 'SENT', datetime('now'), datetime('now'))`,
      args: [recId, bcId, testWamid],
    });

    await applyWhatsAppMessageReceipt({
      waMessageId: testWamid,
      status: "FAILED",
    });

    const checkRes = await mkt.execute({
      sql: `SELECT failed_count, delivered_count FROM broadcasts WHERE id = ?`,
      args: [bcId],
    });

    assertStrictEqual(checkRes.rows[0].failed_count, 1);
    assertStrictEqual(checkRes.rows[0].delivered_count, 0);
  });
});
