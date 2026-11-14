import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import { applyWhatsAppMessageReceipt } from "@cc/workers";

describe("F13: Receipt Error Logging - Boundary & Corner Cases", () => {
  it("applyWhatsAppMessageReceipt handles missing waMessageId and messageId safely", async () => {
    // Calling with empty IDs
    const res = await applyWhatsAppMessageReceipt({
      waMessageId: "",
      messageId: null,
      status: "FAILED",
    });

    assertStrictEqual(res.updated, false);
    assertStrictEqual(res.conversationId, null);
  });

  it("handles receipt for non-existent wamid gracefully without error", async () => {
    const nonExistentWamid = `wamid.unknown_${Date.now()}_999999`;
    const res = await applyWhatsAppMessageReceipt({
      waMessageId: nonExistentWamid,
      status: "FAILED",
    });

    assertStrictEqual(res.updated, false);
    assertStrictEqual(res.conversationId, null);
  });

  it("prevents status downgrade when late FAILED receipt arrives for a READ message", async () => {
    const conv = getRawLibSqlClient("conversations");
    const testWamid = `wamid.read_guard_${Date.now()}`;
    const msgId = `msg_guard_${Date.now()}`;
    const convId = `conv_guard_${Date.now()}`;

    // Insert message in READ state
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'STAFF', 'Agent', 'TEXT', 'UTILITY', 'Order dispatched', '{}', ?, 'READ', datetime('now'))`,
      args: [msgId, convId, testWamid],
    });

    // Late arriving FAILED receipt should NOT downgrade READ to FAILED
    const res = await applyWhatsAppMessageReceipt({
      waMessageId: testWamid,
      status: "FAILED",
    });

    assertStrictEqual(res.updated, false, "Should not update message status");

    const checkRes = await conv.execute({
      sql: `SELECT delivery_status FROM messages WHERE id = ?`,
      args: [msgId],
    });

    assertStrictEqual(checkRes.rows[0].delivery_status, "READ", "Message must retain READ status");
  });

  it("prevents status downgrade when late FAILED receipt arrives for a DELIVERED message", async () => {
    const conv = getRawLibSqlClient("conversations");
    const testWamid = `wamid.delivered_guard_${Date.now()}`;
    const msgId = `msg_del_guard_${Date.now()}`;
    const convId = `conv_guard_${Date.now()}`;

    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'STAFF', 'Agent', 'TEXT', 'UTILITY', 'Invoice PDF', '{}', ?, 'DELIVERED', datetime('now'))`,
      args: [msgId, convId, testWamid],
    });

    const res = await applyWhatsAppMessageReceipt({
      waMessageId: testWamid,
      status: "FAILED",
    });

    assertStrictEqual(res.updated, false);

    const checkRes = await conv.execute({
      sql: `SELECT delivery_status FROM messages WHERE id = ?`,
      args: [msgId],
    });

    assertStrictEqual(checkRes.rows[0].delivery_status, "DELIVERED");
  });

  it("updates status to FAILED when message is in SENT status", async () => {
    const conv = getRawLibSqlClient("conversations");
    const testWamid = `wamid.sent_to_failed_${Date.now()}`;
    const msgId = `msg_fail_${Date.now()}`;
    const convId = `conv_guard_${Date.now()}`;

    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'STAFF', 'Agent', 'TEXT', 'UTILITY', 'Status check', '{}', ?, 'SENT', datetime('now'))`,
      args: [msgId, convId, testWamid],
    });

    const res = await applyWhatsAppMessageReceipt({
      waMessageId: testWamid,
      status: "FAILED",
    });

    assertStrictEqual(res.updated, true);

    const checkRes = await conv.execute({
      sql: `SELECT delivery_status FROM messages WHERE id = ?`,
      args: [msgId],
    });

    assertStrictEqual(checkRes.rows[0].delivery_status, "FAILED");
  });
});
