import crypto from "node:crypto";
import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  createTestRequest,
  callRoute,
  MOCK_STATUS_RECEIPTS,
} from "../harness";
import { applyWhatsAppMessageReceipt } from "@cc/workers";
import { getRawLibSqlClient } from "@cc/database";
import { socketHub } from "@cc/sockets";
import * as whatsappWebhookRoute from "../../../apps/web/src/app/api/webhooks/whatsapp/route";

function createSignedWebhookRequest(body: unknown, secret = "c8d985700cd2266bc184703d329722e7") {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return createTestRequest({
    url: "/api/webhooks/whatsapp",
    method: "POST",
    body: rawBody,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sig,
    },
  });
}

describe("F13: WhatsApp Receipt Error Logging (Tier 1 Feature Coverage)", () => {
  it("T1-F13-01: applyWhatsAppMessageReceipt transitions message status to FAILED", async () => {
    const conv = getRawLibSqlClient("conversations");
    const testWaId = `wamid.receipt_err_${Date.now()}`;

    // Insert a pending sent message
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, wa_message_id, delivery_status, created_at
      ) VALUES (?, 'conv_test_err_rec', 'OUTBOUND', 'STAFF', 'Staff', 'TEXT', 'UTILITY', 'Quote msg', ?, 'SENT', datetime('now'))`,
      args: [`msg_${Date.now()}`, testWaId],
    });

    const res = await applyWhatsAppMessageReceipt({
      waMessageId: testWaId,
      status: "FAILED",
    });

    assertStrictEqual(res.updated, true);

    const checkRes = await conv.execute({
      sql: `SELECT delivery_status FROM messages WHERE wa_message_id = ? LIMIT 1`,
      args: [testWaId],
    });

    assertOk(checkRes.rows.length === 1);
    assertStrictEqual(checkRes.rows[0].delivery_status, "FAILED");
  });

  it("T1-F13-02: handles webhook failed status delivery receipt payload", async () => {
    const testWaId = `wamid.webhook_fail_${Date.now()}`;
    const conv = getRawLibSqlClient("conversations");

    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, wa_message_id, delivery_status, created_at
      ) VALUES (?, 'conv_test_err_rec', 'OUTBOUND', 'STAFF', 'Staff', 'TEXT', 'UTILITY', 'Quote msg', ?, 'SENT', datetime('now'))`,
      args: [`msg_${Date.now() + 1}`, testWaId],
    });

    const payload = MOCK_STATUS_RECEIPTS.failed(
      testWaId,
      131026,
      "Receiver is incapable of receiving this message"
    );

    const req = createSignedWebhookRequest(payload);
    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const checkRes = await conv.execute({
      sql: `SELECT delivery_status FROM messages WHERE wa_message_id = ? LIMIT 1`,
      args: [testWaId],
    });

    assertOk(checkRes.rows.length === 1);
    assertStrictEqual(checkRes.rows[0].delivery_status, "FAILED");
  });

  it("T1-F13-03: increments broadcast failed_count when campaign recipient fails", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const bcId = `bc_fail_track_${Date.now()}`;
    const testWaId = `wamid.bc_fail_${Date.now()}`;

    // Seed campaign and recipient with created_by_name and created_at included
    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category,
        total_recipients, queued_count, sent_count, delivered_count, read_count, failed_count, status, created_by_name, created_at
      ) VALUES (?, 'Fail Track Campaign', 'lst_hotels', 'Hotels', 'tpl_1', 'Template', 'MARKETING', 1, 0, 1, 0, 0, 0, 'RUNNING', 'Admin', datetime('now'))`,
      args: [bcId],
    });

    await mkt.execute({
      sql: `INSERT INTO broadcast_recipients (
        id, broadcast_id, customer_phone, customer_name, status, wa_message_id, scheduled_at, created_at
      ) VALUES (?, ?, '919848011223', 'Rajesh', 'SENT', ?, datetime('now'), datetime('now'))`,
      args: [`rec_${Date.now()}`, bcId, testWaId],
    });

    await applyWhatsAppMessageReceipt({
      waMessageId: testWaId,
      status: "FAILED",
    });

    const bcRes = await mkt.execute({
      sql: `SELECT failed_count, delivered_count FROM broadcasts WHERE id = ? LIMIT 1`,
      args: [bcId],
    });

    assertOk(bcRes.rows.length === 1);
    const bc = bcRes.rows[0] as Record<string, unknown>;
    assertStrictEqual(Number(bc.failed_count), 1);
    assertStrictEqual(Number(bc.delivered_count), 0);
  });

  it("T1-F13-04: emits real-time socket message:status event on failed receipt", async () => {
    let capturedStatus: { type: string; payload: { status: string } } | null = null;
    const unsub = socketHub.subscribe((ev) => {
      if (ev.type === "message:status") {
        capturedStatus = ev as { type: string; payload: { status: string } };
      }
    });

    try {
      const conv = getRawLibSqlClient("conversations");
      const testWaId = `wamid.socket_fail_${Date.now()}`;

      await conv.execute({
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, wa_message_id, delivery_status, created_at
        ) VALUES (?, 'conv_test_socket', 'OUTBOUND', 'STAFF', 'Staff', 'TEXT', 'UTILITY', 'Test', ?, 'SENT', datetime('now'))`,
        args: [`msg_${Date.now() + 2}`, testWaId],
      });

      await applyWhatsAppMessageReceipt({
        waMessageId: testWaId,
        status: "FAILED",
      });

      assertOk(capturedStatus, "socketHub should emit message:status event");
      assertStrictEqual(capturedStatus!.payload.status, "FAILED");
    } finally {
      unsub();
    }
  });

  it("T1-F13-05: verifies error code payload representation matches standard Meta status error shape", async () => {
    const conv = getRawLibSqlClient("conversations");
    const testMsgId = `msg_err_test_${Date.now()}`;
    const testWaId = `wamid.test_err_code_${Date.now()}`;
    const nowIso = new Date().toISOString();

    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, delivery_status, wa_message_id, created_at
      ) VALUES (?, 'conv_test_err_log', 'OUTBOUND', 'STAFF', 'Agent', 'TEXT', 'UTILITY', 'Hello', 'SENT', ?, ?)`,
      args: [testMsgId, testWaId, nowIso],
    });

    const receiptResult = await applyWhatsAppMessageReceipt({
      waMessageId: testWaId,
      status: "FAILED",
      errorCode: 131026,
      errorMessage: "Receiver is incapable of receiving this message",
      timestampIso: nowIso,
    });

    assertStrictEqual(receiptResult.updated, true, "Receipt handler should update existing message");

    const rowRes = await conv.execute({
      sql: `SELECT delivery_status, metadata_json FROM messages WHERE id = ? LIMIT 1`,
      args: [testMsgId],
    });

    assertOk(rowRes.rows.length === 1);
    const row = rowRes.rows[0] as Record<string, unknown>;
    assertStrictEqual(row.delivery_status, "FAILED");

    const metadata = JSON.parse(String(row.metadata_json || "{}"));
    assertStrictEqual(String(metadata.errorCode), "131026");
    assertOk(String(metadata.errorMessage).includes("Receiver is incapable"));
  });
});
