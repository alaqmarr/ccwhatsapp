import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  createTestRequest,
  callRoute,
  mockMeta,
  MOCK_STATUS_RECEIPTS,
  MOCK_INBOUND_MEDIA_PAYLOADS,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import { applyWhatsAppMessageReceipt } from "@cc/workers";
import { createSignedWebhookRequest, generateUniquePhone } from "./tier3-helper";
import * as whatsappWebhookRoute from "../../../apps/web/src/app/api/webhooks/whatsapp/route";

describe("Pairwise 06: Inbound Media, Receipt Error Logging & Delivery Tracking (F6 + F13 + F14)", () => {
  it("processes failed WhatsApp message status receipt, logging error code (F13)", async () => {
    const conv = getRawLibSqlClient("conversations");
    const nowIso = new Date().toISOString();
    const wamid = `wamid.err_single_${Date.now()}`;
    const convId = `conv_err_${Date.now()}`;
    const uniquePhone = generateUniquePhone();

    // Insert conversation and outbound message
    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, status, priority,
        last_message_at, created_at
      ) VALUES (?, ?, 'Failed Msg Customer', 'OPEN', 'NORMAL', ?, ?)`,
      args: [convId, uniquePhone, nowIso, nowIso],
    });

    const msgId = `msg_err_${Date.now()}`;
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'STAFF', 'System', 'TEXT', 'FREE_CHAT', 'Order update', ?, 'SENT', ?)`,
      args: [msgId, convId, wamid, nowIso],
    });

    // Fire failed status webhook
    const failedPayload = MOCK_STATUS_RECEIPTS.failed(wamid, 131026, "Receiver is incapable of receiving this message");
    const req = await createSignedWebhookRequest(failedPayload);
    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    // Verify delivery status updated to FAILED in messages table
    const checkMsg = await conv.execute({
      sql: `SELECT delivery_status FROM messages WHERE id = ?`,
      args: [msgId],
    });
    assertOk(checkMsg.rows[0]);
    assertStrictEqual(checkMsg.rows[0].delivery_status, "FAILED");
  });

  it("updates broadcast failed_count when a campaign recipient fails (F13 + F14)", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const nowIso = new Date().toISOString();
    const broadcastId = `bc_fail_${Date.now()}`;
    const wamid = `wamid.bc_fail_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category, status,
        total_recipients, queued_count, sent_count, delivered_count, read_count, failed_count,
        created_by_name, created_at
      ) VALUES (?, 'Failed Delivery Campaign', 'lst_all', 'All Clients', 'tpl_promo', 'acrylic_sheet_promo', 'MARKETING', 'SENDING', 1, 0, 1, 0, 0, 0, 'System', ?)`,
      args: [broadcastId, nowIso],
    });

    await mkt.execute({
      sql: `INSERT INTO broadcast_recipients (
        id, broadcast_id, customer_name, customer_phone, status, wa_message_id, scheduled_at, sent_at, created_at
      ) VALUES (?, ?, 'Recipient 1', '+919848011225', 'SENT', ?, ?, ?, ?)`,
      args: [`rec_fail_${Date.now()}`, broadcastId, wamid, nowIso, nowIso, nowIso],
    });

    // Apply failed receipt
    await applyWhatsAppMessageReceipt({
      waMessageId: wamid,
      status: "FAILED",
    });

    const bcRes = await mkt.execute({
      sql: `SELECT sent_count, delivered_count, failed_count FROM broadcasts WHERE id = ?`,
      args: [broadcastId],
    });
    assertStrictEqual(bcRes.rows[0]?.sent_count, 1);
    assertStrictEqual(bcRes.rows[0]?.delivered_count, 0);
    assertStrictEqual(bcRes.rows[0]?.failed_count, 1, "failed_count must increment to 1 on FAILED receipt");

    const recRes = await mkt.execute({
      sql: `SELECT status FROM broadcast_recipients WHERE wa_message_id = ?`,
      args: [wamid],
    });
    assertStrictEqual(recRes.rows[0]?.status, "FAILED");
  });

  it("preserves status monotonicity: prevents late FAILED receipt from downgrading READ message (F13 + F14)", async () => {
    const conv = getRawLibSqlClient("conversations");
    const nowIso = new Date().toISOString();
    const wamid = `wamid.monotonic_${Date.now()}`;
    const convId = `conv_mono_${Date.now()}`;
    const uniquePhone = generateUniquePhone();

    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, status, priority,
        last_message_at, created_at
      ) VALUES (?, ?, 'Monotonic Customer', 'OPEN', 'NORMAL', ?, ?)`,
      args: [convId, uniquePhone, nowIso, nowIso],
    });

    const msgId = `msg_mono_${Date.now()}`;
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'STAFF', 'System', 'TEXT', 'FREE_CHAT', 'Read message', ?, 'READ', ?)`,
      args: [msgId, convId, wamid, nowIso],
    });

    // Late arriving FAILED receipt arrives for a message that is already READ
    await applyWhatsAppMessageReceipt({
      waMessageId: wamid,
      status: "FAILED",
    });

    const checkMsg = await conv.execute({
      sql: `SELECT delivery_status FROM messages WHERE id = ?`,
      args: [msgId],
    });
    assertStrictEqual(checkMsg.rows[0]?.delivery_status, "READ", "READ message must not be downgraded by late FAILED receipt");
  });

  it("handles webhook payload containing multiple error items without crashing (F13)", async () => {
    const multiErrPayload = {
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
                    id: `wamid.multi_err_${Date.now()}`,
                    status: "failed",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: "919848011223",
                    errors: [
                      { code: 131026, title: "Receiver is incapable" },
                      { code: 131048, title: "Spam rate limit" },
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

    const req = await createSignedWebhookRequest(multiErrPayload);
    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);
  });

  it("handles simultaneous inbound media and failed outbound receipt without deadlock (F6 + F13)", async () => {
    const imgPayload = MOCK_INBOUND_MEDIA_PAYLOADS.image({
      from: "919848011227",
      mediaId: "media_concurrent_01",
      caption: "Concurrent test sample",
    });
    const failedReceipt = MOCK_STATUS_RECEIPTS.failed(`wamid.concurrent_${Date.now()}`, 131048, "Rate limited");

    // Send both in parallel
    const [imgReq, failReq] = await Promise.all([
      createSignedWebhookRequest(imgPayload),
      createSignedWebhookRequest(failedReceipt),
    ]);

    const [imgRes, failRes] = await Promise.all([
      callRoute(whatsappWebhookRoute, imgReq),
      callRoute(whatsappWebhookRoute, failReq),
    ]);

    imgRes.assertStatus(200);
    failRes.assertStatus(200);
  });
});
