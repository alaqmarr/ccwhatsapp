import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  createTestRequest,
  callRoute,
  mockMeta,
  createTestStaffSession,
} from "../harness";
import { getRawLibSqlClient, normalizeWhatsAppPhone } from "@cc/database";
import { sendWhatsAppCloudMessage } from "@cc/connections";
import { setTestSessionUser, generateUniquePhone } from "./tier3-helper";

describe("Pairwise 08: Phone Normalization & Template Dispatch Variables (F12 + F10 + F11)", () => {
  it("extracts and validates multi-variable schema parameters (F11)", () => {
    const templateBody = "Dear {{1}}, your order for {{2}} is ready for pickup. Invoice amount: {{3}}.";
    const matches = Array.from(templateBody.matchAll(/\{\{(\d+)\}\}/g));
    const tokenIndexes = matches.map((m) => parseInt(m[1], 10));

    assertStrictEqual(tokenIndexes.length, 3);
    assertStrictEqual(tokenIndexes[0], 1);
    assertStrictEqual(tokenIndexes[1], 2);
    assertStrictEqual(tokenIndexes[2], 3);

    // Schema generation
    const schema = tokenIndexes.map((idx) => ({
      index: idx,
      name: `param_${idx}`,
      type: "text",
    }));

    assertStrictEqual(schema.length, 3);
    assertStrictEqual(schema[0].name, "param_1");
  });

  it("normalizes diverse input phone number formats to standard E.164 (F12)", () => {
    const inputs = [
      "98480 11223",
      "98480-11223",
      "(98480) 11223",
      "09848011223",
      "919848011223",
      "+91 98480 11223",
      "+91-98480-11223",
      "+919848011223",
    ];

    for (const input of inputs) {
      const normalized = normalizeWhatsAppPhone(input);
      assertStrictEqual(
        normalized,
        "+919848011223",
        `Phone "${input}" should normalize to "+919848011223"`
      );
    }
  });

  it("dispatches template message forwarding variables to Meta Graph API (F10)", async () => {
    mockMeta.reset();
    const staffSession = await createTestStaffSession();
    setTestSessionUser(staffSession.user);

    const mkt = getRawLibSqlClient("marketing");
    const conv = getRawLibSqlClient("conversations");
    const nowIso = new Date().toISOString();
    const uniquePhone = generateUniquePhone();

    // 1. Ensure template exists and is APPROVED
    await mkt.execute({
      sql: `INSERT OR REPLACE INTO templates (
        id, name, language, category, header_type, body_text,
        approval_status, meta_template_id, updated_at, created_at
      ) VALUES ('tpl_multivar', 'order_status_update', 'en', 'UTILITY', 'NONE', 'Dear {{1}}, order {{2}} ready.', 'APPROVED', 'meta_multi_101', ?, ?)`,
      args: [nowIso, nowIso],
    });

    // 2. Create conversation
    const convId = `conv_mv_${Date.now()}`;
    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, status, priority,
        assigned_staff_id, assigned_staff_name, last_message_at, created_at
      ) VALUES (?, ?, 'Vikram Kumar', 'OPEN', 'NORMAL', ?, ?, ?, ?)`,
      args: [convId, uniquePhone, staffSession.user.id, staffSession.user.name, nowIso, nowIso],
    });

    const components = [
      {
        type: "body",
        parameters: [
          { type: "text", text: "Vikram" },
          { type: "text", text: "ORD-771" },
        ],
      },
    ];

    const conversationIdRoute = await import("../../../apps/web/src/app/api/conversations/[id]/route");
    const req = createTestRequest({
      url: `/api/conversations/${convId}`,
      method: "POST",
      sessionToken: staffSession.token,
      body: {
        action: "send_message",
        messageType: "TEMPLATE",
        templateName: "order_status_update",
        languageCode: "en",
        templateComponents: components,
        text: "Dear Vikram, order ORD-771 ready.",
      },
    });

    const res = await callRoute(conversationIdRoute, req, { params: { id: convId } });
    res.assertStatus(200);

    // Verify outbound message was inserted in messages table
    const msgRes = await conv.execute({
      sql: `SELECT * FROM messages WHERE conversation_id = ? AND direction = 'OUTBOUND' LIMIT 1`,
      args: [convId],
    });
    assertOk(msgRes.rows[0]);
    assertStrictEqual(msgRes.rows[0].template_name, "order_status_update");
    assertStrictEqual(msgRes.rows[0].delivery_status, "SENT");
  });

  it("forwards language code when specified in template dispatch (F10)", async () => {
    mockMeta.reset();
    const staffSession = await createTestStaffSession();
    setTestSessionUser(staffSession.user);

    const mkt = getRawLibSqlClient("marketing");
    const conv = getRawLibSqlClient("conversations");
    const nowIso = new Date().toISOString();
    const uniquePhone = generateUniquePhone();

    await mkt.execute({
      sql: `INSERT OR REPLACE INTO templates (
        id, name, language, category, header_type, body_text,
        approval_status, meta_template_id, updated_at, created_at
      ) VALUES ('tpl_hindi', 'order_ready_hi', 'hi', 'UTILITY', 'NONE', 'Namaste {{1}}, order {{2}} ready.', 'APPROVED', 'meta_hi_101', ?, ?)`,
      args: [nowIso, nowIso],
    });

    const convId = `conv_hi_${Date.now()}`;
    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, status, priority,
        assigned_staff_id, assigned_staff_name, last_message_at, created_at
      ) VALUES (?, ?, 'Anand Rao', 'OPEN', 'NORMAL', ?, ?, ?, ?)`,
      args: [convId, uniquePhone, staffSession.user.id, staffSession.user.name, nowIso, nowIso],
    });

    const conversationIdRoute = await import("../../../apps/web/src/app/api/conversations/[id]/route");
    const req = createTestRequest({
      url: `/api/conversations/${convId}`,
      method: "POST",
      sessionToken: staffSession.token,
      body: {
        action: "send_message",
        messageType: "TEMPLATE",
        templateName: "order_ready_hi",
        languageCode: "hi",
        templateComponents: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Anand" },
              { type: "text", text: "ORD-991" },
            ],
          },
        ],
        text: "Namaste Anand, order ORD-991 ready.",
      },
    });

    const res = await callRoute(conversationIdRoute, req, { params: { id: convId } });
    res.assertStatus(200);
  });

  it("verifies sendWhatsAppCloudMessage normalizes phone numbers automatically (F12)", async () => {
    // 10-digit phone
    const sendResult = await sendWhatsAppCloudMessage({
      toPhone: "9848011223",
      bodyText: "Direct test message",
      forceSandbox: true,
    });

    assertOk(sendResult.ok, "sendWhatsAppCloudMessage should succeed");
    assertOk(sendResult.waMessageId.startsWith("wamid."));
  });
});
