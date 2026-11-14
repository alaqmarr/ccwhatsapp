import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertIstFormatted,
  assertUtcIso,
  createTestRequest,
  callRoute,
  mockMeta,
  createTestStaffSession,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import { parseLocalIstToUtcIso, formatDateTimeIst, formatDateIst, APP_TIMEZONE } from "@cc/ui";
import { applyWhatsAppMessageReceipt } from "@cc/workers";
import { setTestSessionUser, generateUniquePhone } from "./tier3-helper";

describe("Pairwise 03: Marketing Broadcast Schedule & Delivery Tracking (F5 + F14 + F2 + F4)", () => {
  it("parses datetime-local in IST and converts to exact UTC ISO (F5 + F2)", () => {
    // 2:30 PM IST (14:30) on 01 Dec 2026 -> 09:00 UTC
    const localIst = "2026-12-01T14:30";
    const utcIso = parseLocalIstToUtcIso(localIst);
    assertOk(utcIso, "parseLocalIstToUtcIso should return valid UTC ISO string");
    assertUtcIso(utcIso);
    assertStrictEqual(utcIso, "2026-12-01T09:00:00.000Z");

    // Format back to IST to confirm bidirectional roundtrip fidelity
    const formattedBack = formatDateTimeIst(utcIso);
    assertStrictEqual(formattedBack, "01 Dec 2026, 02:30 PM");
    assertIstFormatted(formattedBack, { format: "dateTime" });
  });

  it("stores scheduled broadcast with UTC ISO and renders schedule date in IST (F5 + F4)", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const staffSession = await createTestStaffSession();
    setTestSessionUser(staffSession.user);

    const nowIso = new Date().toISOString();
    const broadcastId = `bc_sched_${Date.now()}`;
    const scheduledLocal = "2026-12-15T18:00"; // 6:00 PM IST -> 12:30 UTC
    const scheduledUtcIso = parseLocalIstToUtcIso(scheduledLocal)!;

    // Insert broadcast directly into marketing database
    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category, status,
        total_recipients, queued_count, sent_count, delivered_count, read_count, failed_count,
        scheduled_for, created_by_name, created_at
      ) VALUES (?, 'Year-End Acrylic Catalog', 'lst_vip', 'VIP Buyers', 'tpl_promo', 'acrylic_sheet_promo', 'MARKETING', 'SCHEDULED', 10, 10, 0, 0, 0, 0, ?, ?, ?)`,
      args: [broadcastId, scheduledUtcIso, staffSession.user.name, nowIso],
    });

    const bRes = await mkt.execute({
      sql: `SELECT scheduled_for FROM broadcasts WHERE id = ? LIMIT 1`,
      args: [broadcastId],
    });
    assertOk(bRes.rows[0]);
    assertStrictEqual(bRes.rows[0].scheduled_for, "2026-12-15T12:30:00.000Z");

    // UI rendering helper verifies 6:00 PM IST
    const uiDate = formatDateTimeIst(String(bRes.rows[0].scheduled_for));
    assertStrictEqual(uiDate, "15 Dec 2026, 06:00 PM");
    assertIstFormatted(uiDate, { format: "dateTime" });
  });

  it("verifies broadcast dispatch sets sent_count and leaves delivered_count at 0 (F14)", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const nowIso = new Date().toISOString();
    const broadcastId = `bc_dispatch_${Date.now()}`;
    const wamid1 = `wamid.bc_test_deliv_${Date.now()}_1`;
    const wamid2 = `wamid.bc_test_deliv_${Date.now()}_2`;

    // 1. Create broadcast in SENDING state with 2 recipients
    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category, status,
        total_recipients, queued_count, sent_count, delivered_count, read_count, failed_count,
        created_by_name, created_at
      ) VALUES (?, 'Display Stands Launch', 'lst_ret', 'Retailers', 'tpl_order', 'order_confirmation', 'MARKETING', 'SENDING', 2, 0, 2, 0, 0, 0, 'System', ?)`,
      args: [broadcastId, nowIso],
    });

    // 2. Insert two recipients in SENT state
    await mkt.execute({
      sql: `INSERT INTO broadcast_recipients (
        id, broadcast_id, customer_name, customer_phone, status, wa_message_id, scheduled_at, sent_at, created_at
      ) VALUES
        (?, ?, 'Buyer 1', '+919848011221', 'SENT', ?, ?, ?, ?),
        (?, ?, 'Buyer 2', '+919848011222', 'SENT', ?, ?, ?, ?)`,
      args: [
        `rec_${Date.now()}_1`, broadcastId, wamid1, nowIso, nowIso, nowIso,
        `rec_${Date.now()}_2`, broadcastId, wamid2, nowIso, nowIso, nowIso,
      ],
    });

    // Check broadcast counters immediately after dispatch
    const initialBc = await mkt.execute({
      sql: `SELECT sent_count, delivered_count, read_count FROM broadcasts WHERE id = ?`,
      args: [broadcastId],
    });
    assertStrictEqual(initialBc.rows[0]?.sent_count, 2);
    assertStrictEqual(initialBc.rows[0]?.delivered_count, 0, "delivered_count must remain 0 until Meta delivery receipt");
    assertStrictEqual(initialBc.rows[0]?.read_count, 0);
  });

  it("increments delivered_count only upon Meta DELIVERED receipt callback (F14)", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const nowIso = new Date().toISOString();
    const broadcastId = `bc_receipt_${Date.now()}`;
    const wamid = `wamid.bc_receipt_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category, status,
        total_recipients, queued_count, sent_count, delivered_count, read_count, failed_count,
        created_by_name, created_at
      ) VALUES (?, 'Acrylic Sheets Catalog', 'lst_arch', 'Architects', 'tpl_quote', 'quote_ready', 'MARKETING', 'SENDING', 1, 0, 1, 0, 0, 0, 'System', ?)`,
      args: [broadcastId, nowIso],
    });

    await mkt.execute({
      sql: `INSERT INTO broadcast_recipients (
        id, broadcast_id, customer_name, customer_phone, status, wa_message_id, scheduled_at, sent_at, created_at
      ) VALUES (?, ?, 'Architect Rao', '+919848011223', 'SENT', ?, ?, ?, ?)`,
      args: [`rec_mkt_${Date.now()}`, broadcastId, wamid, nowIso, nowIso, nowIso],
    });

    // Process DELIVERED receipt
    await applyWhatsAppMessageReceipt({
      waMessageId: wamid,
      status: "DELIVERED",
    });

    // Verify delivered_count is now 1
    const updatedBc = await mkt.execute({
      sql: `SELECT sent_count, delivered_count, read_count FROM broadcasts WHERE id = ?`,
      args: [broadcastId],
    });
    assertStrictEqual(updatedBc.rows[0]?.sent_count, 1);
    assertStrictEqual(updatedBc.rows[0]?.delivered_count, 1, "delivered_count must increment to 1 on DELIVERED receipt");
    assertStrictEqual(updatedBc.rows[0]?.read_count, 0);

    // Verify recipient row status
    const recRow = await mkt.execute({
      sql: `SELECT status FROM broadcast_recipients WHERE wa_message_id = ?`,
      args: [wamid],
    });
    assertStrictEqual(recRow.rows[0]?.status, "DELIVERED");
  });

  it("increments read_count upon READ receipt without double counting delivered_count (F14 + F4)", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const nowIso = new Date().toISOString();
    const broadcastId = `bc_read_${Date.now()}`;
    const wamid = `wamid.bc_read_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category, status,
        total_recipients, queued_count, sent_count, delivered_count, read_count, failed_count,
        created_by_name, created_at
      ) VALUES (?, 'Custom Acrylic Fabrication', 'lst_bld', 'Builders', 'tpl_order', 'order_confirmation', 'MARKETING', 'SENDING', 1, 0, 1, 1, 0, 0, 'System', ?)`,
      args: [broadcastId, nowIso],
    });

    await mkt.execute({
      sql: `INSERT INTO broadcast_recipients (
        id, broadcast_id, customer_name, customer_phone, status, wa_message_id, scheduled_at, sent_at, created_at
      ) VALUES (?, ?, 'Builder Verma', '+919848011224', 'DELIVERED', ?, ?, ?, ?)`,
      args: [`rec_read_${Date.now()}`, broadcastId, wamid, nowIso, nowIso, nowIso],
    });

    // Customer reads message -> Meta fires READ receipt
    await applyWhatsAppMessageReceipt({
      waMessageId: wamid,
      status: "READ",
    });

    const finalBc = await mkt.execute({
      sql: `SELECT sent_count, delivered_count, read_count FROM broadcasts WHERE id = ?`,
      args: [broadcastId],
    });
    assertStrictEqual(finalBc.rows[0]?.sent_count, 1);
    assertStrictEqual(finalBc.rows[0]?.delivered_count, 1, "delivered_count should remain 1, not duplicate");
    assertStrictEqual(finalBc.rows[0]?.read_count, 1, "read_count must increment to 1 on READ receipt");
  });
});
