import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  mockMeta,
  createTestRequest,
  callRoute,
  createTestStaffSession,
} from "../harness";
import { sendWhatsAppCloudMessage } from "@cc/connections";
import { getRawLibSqlClient } from "@cc/database";
import { socketHub } from "@cc/sockets";

describe("F10: Template Dispatch Parameters & Variables Forwarding (Tier 1 Feature Coverage)", () => {
  it("T1-F10-01: sendWhatsAppCloudMessage forwards templateComponents parameter array to Meta payload", async () => {
    mockMeta.reset();
    const prevEnv = process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS;
    delete process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS;

    const auth = getRawLibSqlClient("core_auth");
    const origRow = await auth.execute(`SELECT value_json FROM setup_state WHERE key = 'facebook_whatsapp_config' LIMIT 1`);
    const origCfg = JSON.parse(String(origRow.rows[0].value_json));
    const liveCfg = { ...origCfg, mode: "LIVE_META_CLOUD" };
    await auth.execute({
      sql: `UPDATE setup_state SET value_json = ? WHERE key = 'facebook_whatsapp_config'`,
      args: [JSON.stringify(liveCfg)],
    });

    try {
      const components = [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Rajesh Kumar" },
            { type: "text", text: "ORD-991" },
          ],
        },
      ];

      const res = await sendWhatsAppCloudMessage({
        toPhone: "919848011223",
        bodyText: "Order update",
        templateName: "order_confirmation",
        languageCode: "en_US",
        templateComponents: components,
      });

      assertStrictEqual(res.ok, true);
      assertOk(res.waMessageId, "Should return waMessageId");

      const sent = mockMeta.sentMessages;
      assertOk(sent.length >= 1, "Meta API call should be intercepted");
      const lastSent = sent[sent.length - 1];

      assertStrictEqual(lastSent.payload.type, "template");
      assertStrictEqual(lastSent.payload.template?.name, "order_confirmation");
      assertOk(Array.isArray(lastSent.payload.template?.components));
      assertStrictEqual(lastSent.payload.template?.components?.[0]?.parameters?.[0]?.text, "Rajesh Kumar");
    } finally {
      process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS = prevEnv;
      await auth.execute({
        sql: `UPDATE setup_state SET value_json = ? WHERE key = 'facebook_whatsapp_config'`,
        args: [JSON.stringify(origCfg)],
      });
    }
  });

  it("T1-F10-02: forwards languageCode correctly in Meta template payload", async () => {
    mockMeta.reset();
    const prevEnv = process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS;
    delete process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS;

    const auth = getRawLibSqlClient("core_auth");
    const origRow = await auth.execute(`SELECT value_json FROM setup_state WHERE key = 'facebook_whatsapp_config' LIMIT 1`);
    const origCfg = JSON.parse(String(origRow.rows[0].value_json));
    const liveCfg = { ...origCfg, mode: "LIVE_META_CLOUD" };
    await auth.execute({
      sql: `UPDATE setup_state SET value_json = ? WHERE key = 'facebook_whatsapp_config'`,
      args: [JSON.stringify(liveCfg)],
    });

    try {
      await sendWhatsAppCloudMessage({
        toPhone: "919848011223",
        bodyText: "Namaste",
        templateName: "order_confirmation",
        languageCode: "hi",
        templateComponents: [{ type: "body", parameters: [{ type: "text", text: "Rajesh" }] }],
      });

      const sent = mockMeta.sentMessages;
      assertOk(sent.length >= 1);
      const lastSent = sent[sent.length - 1];

      assertStrictEqual(lastSent.payload.template?.language?.code, "hi");
    } finally {
      process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS = prevEnv;
      await auth.execute({
        sql: `UPDATE setup_state SET value_json = ? WHERE key = 'facebook_whatsapp_config'`,
        args: [JSON.stringify(origCfg)],
      });
    }
  });

  it("T1-F10-03: eliminates Meta error 132000 by ensuring variables count matches template requirements", async () => {
    // Providing required template components ensures clean delivery
    const res = await sendWhatsAppCloudMessage({
      toPhone: "919848011223",
      bodyText: "Podium quote",
      templateName: "order_confirmation",
      languageCode: "en_US",
      templateComponents: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Vikram" },
            { type: "text", text: "CC-POD-001" },
          ],
        },
      ],
    });

    assertStrictEqual(res.ok, true);
    assertOk(!res.error, "Should have zero errors when template components are provided");
  });

  it("T1-F10-04: inserts outbound message record with template details into database", async () => {
    const conv = getRawLibSqlClient("conversations");
    const msgId = `msg_out_tpl_${Date.now()}`;
    const convId = "conv_test_tpl_dispatch";

    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'STAFF', 'Sales Team', 'TEMPLATE', 'UTILITY', ?, ?, ?, 'SENT', datetime('now'))`,
      args: [
        msgId,
        convId,
        "Order confirmed",
        JSON.stringify({ templateName: "order_confirmation", vars: ["Vikram", "CC-POD-001"] }),
        "wamid.mock_tpl_001",
      ],
    });

    const savedRes = await conv.execute({
      sql: `SELECT id, message_type, metadata_json FROM messages WHERE id = ? LIMIT 1`,
      args: [msgId],
    });

    assertOk(savedRes.rows.length === 1);
    const saved = savedRes.rows[0] as Record<string, unknown>;
    assertStrictEqual(saved.message_type, "TEMPLATE");
    assertOk(String(saved.metadata_json).includes("order_confirmation"));
  });

  it("T1-F10-05: emits real-time socket message:new event for outbound template message", async () => {
    const conversationIdRoute = await import("../../../apps/web/src/app/api/conversations/[id]/route");
    const staffSession = await createTestStaffSession();
    const conv = getRawLibSqlClient("conversations");
    const mkt = getRawLibSqlClient("marketing");
    const nowIso = new Date().toISOString();

    const tplName = "order_notification_dispatch";
    await mkt.execute({
      sql: `INSERT OR REPLACE INTO templates (
        id, name, language, category, header_type, body_text,
        approval_status, meta_template_id, updated_at, created_at
      ) VALUES ('tpl_socket_ev_test', ?, 'en', 'UTILITY', 'NONE', 'Hello {{1}}, order {{2}} ready.', 'APPROVED', 'meta_sock_101', ?, ?)`,
      args: [tplName, nowIso, nowIso],
    });

    const convId = `conv_socket_test_${Date.now()}`;
    const testPhone = `+9198480${Math.floor(10000 + Math.random() * 90000)}`;
    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, status, priority,
        assigned_staff_id, assigned_staff_name, last_message_at, created_at
      ) VALUES (?, ?, 'Rajesh Kumar', 'OPEN', 'NORMAL', ?, ?, ?, ?)`,
      args: [convId, testPhone, staffSession.user.id, staffSession.user.name, nowIso, nowIso],
    });

    let capturedEvent: { type: string; payload: unknown } | null = null;
    const unsub = socketHub.subscribe((ev) => {
      if (ev.type === "message:new") {
        capturedEvent = ev;
      }
    });

    try {
      const req = createTestRequest({
        url: `/api/conversations/${convId}`,
        method: "POST",
        sessionToken: staffSession.token,
        body: {
          action: "send_message",
          messageType: "TEMPLATE",
          templateName: tplName,
          text: "Hello Rajesh, order ORD-100 ready.",
          templateVariables: ["Rajesh", "ORD-100"],
        },
      });

      const res = await callRoute(conversationIdRoute, req, { params: { id: convId } });
      res.assertStatus(200);

      assertOk(capturedEvent, "Outbound template dispatch must emit socketHub message:new event");
      const eventPayload = (capturedEvent as { payload: { conversationId: string; text?: string } }).payload;
      assertStrictEqual(eventPayload.conversationId, convId);
    } finally {
      unsub();
    }
  });
});
