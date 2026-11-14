import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";
import { applyWhatsAppMessageReceipt } from "@cc/workers";
import { getRawLibSqlClient } from "@cc/database";
import { socketHub } from "@cc/sockets";

describe("F14: Broadcast Delivery Tracking Separation (Tier 1 Feature Coverage)", () => {
  it("T1-F14-01: initial campaign dispatch records sent_count without prematurely marking delivered_count", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const bcId = `bc_deliv_track_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category,
        total_recipients, queued_count, sent_count, delivered_count, read_count, failed_count, status, created_by_name, created_at
      ) VALUES (?, 'Delivery Separation Test', 'lst_hotels', 'Hotels', 'tpl_1', 'Template', 'MARKETING', 5, 0, 5, 0, 0, 0, 'RUNNING', 'Admin', datetime('now'))`,
      args: [bcId],
    });

    const bcRes = await mkt.execute({
      sql: `SELECT sent_count, delivered_count, read_count FROM broadcasts WHERE id = ? LIMIT 1`,
      args: [bcId],
    });

    assertOk(bcRes.rows.length === 1);
    const bc = bcRes.rows[0] as Record<string, unknown>;
    assertStrictEqual(Number(bc.sent_count), 5);
    assertStrictEqual(Number(bc.delivered_count), 0);
    assertStrictEqual(Number(bc.read_count), 0);
  });

  it("T1-F14-02: DELIVERED receipt callback increments delivered_count", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const bcId = `bc_delivered_${Date.now()}`;
    const testWaId = `wamid.bc_deliv_${Date.now()}`;
    const recId = `rec_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category,
        total_recipients, queued_count, sent_count, delivered_count, read_count, failed_count, status, created_by_name, created_at
      ) VALUES (?, 'Delivered Receipt Test', 'lst_hotels', 'Hotels', 'tpl_1', 'Template', 'MARKETING', 1, 0, 1, 0, 0, 0, 'RUNNING', 'Admin', datetime('now'))`,
      args: [bcId],
    });

    await mkt.execute({
      sql: `INSERT INTO broadcast_recipients (
        id, broadcast_id, customer_phone, customer_name, status, wa_message_id, scheduled_at, created_at
      ) VALUES (?, ?, '919848011223', 'Rajesh', 'SENT', ?, datetime('now'), datetime('now'))`,
      args: [recId, bcId, testWaId],
    });

    await applyWhatsAppMessageReceipt({
      waMessageId: testWaId,
      status: "DELIVERED",
    });

    const bcRes = await mkt.execute({
      sql: `SELECT sent_count, delivered_count, read_count FROM broadcasts WHERE id = ? LIMIT 1`,
      args: [bcId],
    });

    assertOk(bcRes.rows.length === 1);
    const bc = bcRes.rows[0] as Record<string, unknown>;
    assertStrictEqual(Number(bc.sent_count), 1);
    assertStrictEqual(Number(bc.delivered_count), 1);
    assertStrictEqual(Number(bc.read_count), 0);
  });

  it("T1-F14-03: READ receipt increments read_count while keeping delivered_count accurate", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const bcId = `bc_read_${Date.now()}`;
    const testWaId = `wamid.bc_read_${Date.now()}`;
    const recId = `rec_${Date.now() + 1}`;

    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category,
        total_recipients, queued_count, sent_count, delivered_count, read_count, failed_count, status, created_by_name, created_at
      ) VALUES (?, 'Read Receipt Test', 'lst_hotels', 'Hotels', 'tpl_1', 'Template', 'MARKETING', 1, 0, 1, 1, 0, 0, 'RUNNING', 'Admin', datetime('now'))`,
      args: [bcId],
    });

    await mkt.execute({
      sql: `INSERT INTO broadcast_recipients (
        id, broadcast_id, customer_phone, customer_name, status, wa_message_id, scheduled_at, created_at
      ) VALUES (?, ?, '919848011223', 'Rajesh', 'DELIVERED', ?, datetime('now'), datetime('now'))`,
      args: [recId, bcId, testWaId],
    });

    await applyWhatsAppMessageReceipt({
      waMessageId: testWaId,
      status: "READ",
    });

    const bcRes = await mkt.execute({
      sql: `SELECT sent_count, delivered_count, read_count FROM broadcasts WHERE id = ? LIMIT 1`,
      args: [bcId],
    });

    assertOk(bcRes.rows.length === 1);
    const bc = bcRes.rows[0] as Record<string, unknown>;
    assertStrictEqual(Number(bc.delivered_count), 1);
    assertStrictEqual(Number(bc.read_count), 1);
  });

  it("T1-F14-04: recipient status advances monotonically (SENT -> DELIVERED -> READ)", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const testWaId = `wamid.mono_${Date.now()}`;
    const recId = `rec_mono_${Date.now()}`;
    const bcId = `bc_mono_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category,
        total_recipients, queued_count, sent_count, delivered_count, read_count, failed_count, status, created_by_name, created_at
      ) VALUES (?, 'Monotonic Campaign', 'lst_hotels', 'Hotels', 'tpl_1', 'Template', 'MARKETING', 1, 0, 1, 0, 0, 0, 'RUNNING', 'Admin', datetime('now'))`,
      args: [bcId],
    });

    await mkt.execute({
      sql: `INSERT INTO broadcast_recipients (
        id, broadcast_id, customer_phone, customer_name, status, wa_message_id, scheduled_at, created_at
      ) VALUES (?, ?, '919848011223', 'Rajesh', 'SENT', ?, datetime('now'), datetime('now'))`,
      args: [recId, bcId, testWaId],
    });

    // 1. Advance to DELIVERED
    await applyWhatsAppMessageReceipt({ waMessageId: testWaId, status: "DELIVERED" });
    const rec1 = await mkt.execute({ sql: `SELECT status FROM broadcast_recipients WHERE id = ?`, args: [recId] });
    assertStrictEqual(rec1.rows[0].status, "DELIVERED");

    // 2. Advance to READ
    await applyWhatsAppMessageReceipt({ waMessageId: testWaId, status: "READ" });
    const rec2 = await mkt.execute({ sql: `SELECT status FROM broadcast_recipients WHERE id = ?`, args: [recId] });
    assertStrictEqual(rec2.rows[0].status, "READ");

    // 3. Stale DELIVERED receipt must NOT regress status backwards to DELIVERED
    await applyWhatsAppMessageReceipt({ waMessageId: testWaId, status: "DELIVERED" });
    const rec3 = await mkt.execute({ sql: `SELECT status FROM broadcast_recipients WHERE id = ?`, args: [recId] });
    assertStrictEqual(rec3.rows[0].status, "READ");
  });

  it("T1-F14-05: emits real-time broadcast:progress socket notification on delivery receipt", async () => {
    let capturedEvent: { type: string; payload: { status: string } } | null = null;
    const unsub = socketHub.subscribe((ev) => {
      if (ev.type === "broadcast:progress") {
        capturedEvent = ev as { type: string; payload: { status: string } };
      }
    });

    try {
      const mkt = getRawLibSqlClient("marketing");
      const bcId = `bc_socket_${Date.now()}`;
      const testWaId = `wamid.socket_bc_${Date.now()}`;
      const recId = `rec_socket_${Date.now()}`;

      await mkt.execute({
        sql: `INSERT INTO broadcasts (
          id, name, list_id, list_name, template_id, template_name, billing_category,
          total_recipients, queued_count, sent_count, delivered_count, read_count, failed_count, status, created_by_name, created_at
        ) VALUES (?, 'Socket Campaign', 'lst_hotels', 'Hotels', 'tpl_1', 'Template', 'MARKETING', 1, 0, 1, 0, 0, 0, 'RUNNING', 'Admin', datetime('now'))`,
        args: [bcId],
      });

      await mkt.execute({
        sql: `INSERT INTO broadcast_recipients (
          id, broadcast_id, customer_phone, customer_name, status, wa_message_id, scheduled_at, created_at
        ) VALUES (?, ?, '919848011223', 'Rajesh', 'SENT', ?, datetime('now'), datetime('now'))`,
        args: [recId, bcId, testWaId],
      });

      await applyWhatsAppMessageReceipt({
        waMessageId: testWaId,
        status: "DELIVERED",
      });

      assertOk(capturedEvent, "socketHub should emit broadcast:progress");
      assertStrictEqual(capturedEvent!.payload.status, "DELIVERED");
    } finally {
      unsub();
    }
  });
});
