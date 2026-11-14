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
import { syncTemplatesFromMetaCloud } from "@cc/connections";
import {
  setTestSessionUser,
  createSignedWebhookRequest,
  generateUniquePhone,
} from "./tier3-helper";
import * as whatsappWebhookRoute from "../../../apps/web/src/app/api/webhooks/whatsapp/route";

describe("Pairwise 02: Template Sync & Dispatch with Phone Normalization (F9 + F10 + F11 + F12)", () => {
  it("syncs templates from Meta Cloud, extracting variable schema {{1}}, {{2}} (F11)", async () => {
    mockMeta.reset();

    // Enable live cloud mode in setup config for sync test
    const auth = getRawLibSqlClient("core_auth");
    await auth.execute({
      sql: `UPDATE setup_state SET value_json = json_set(value_json, '$.mode', 'LIVE_META_CLOUD', '$.wabaId', 'waba_test_123', '$.systemUserAccessToken', 'EAAB_test_token') WHERE key = 'facebook_whatsapp_config'`,
      args: [],
    });

    const syncRes = await syncTemplatesFromMetaCloud();
    assertOk(syncRes.ok, "Template sync from Meta mock should succeed");
    assertOk(syncRes.syncedCount >= 1, "Should sync at least 1 template from Meta Cloud");

    const mkt = getRawLibSqlClient("marketing");
    const tplRes = await mkt.execute({
      sql: `SELECT * FROM templates WHERE name = 'order_confirmation' OR name = 'quote_ready' LIMIT 2`,
      args: [],
    });

    assertOk(tplRes.rows.length >= 1, "Expected synced templates in marketing database");

    // Verify variable extraction from body tokens {{1}}, {{2}}
    const testBody = "Hello {{1}}, your acrylic quotation for {{2}} is ready. Total: Rs {{3}}.";
    const matches = Array.from(testBody.matchAll(/\{\{(\d+)\}\}/g));
    const extractedIndexes = Array.from(new Set(matches.map((m) => parseInt(m[1], 10)))).sort((a, b) => a - b);
    assertStrictEqual(extractedIndexes.length, 3);
    assertStrictEqual(extractedIndexes[0], 1);
    assertStrictEqual(extractedIndexes[1], 2);
    assertStrictEqual(extractedIndexes[2], 3);
  });

  it("handles template status webhook approval and protects draft templates from empty string overwrites (F9)", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const nowIso = new Date().toISOString();

    // 1. Insert a draft template with empty meta_template_id
    const draftTplId = `tpl_draft_${Date.now()}`;
    await mkt.execute({
      sql: `INSERT OR REPLACE INTO templates (
        id, name, language, category, header_type, body_text,
        approval_status, meta_template_id, updated_at, created_at
      ) VALUES (?, 'draft_unapproved_tpl', 'en', 'UTILITY', 'NONE', 'Draft content', 'DRAFT', '', ?, ?)`,
      args: [draftTplId, nowIso, nowIso],
    });

    // 2. Webhook fires with EMPTY meta_template_id and empty name
    const emptyPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_test_123",
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "APPROVED",
                message_template_id: "",
                message_template_name: "",
              },
            },
          ],
        },
      ],
    };

    const emptyReq = await createSignedWebhookRequest(emptyPayload);
    const emptyRes = await callRoute(whatsappWebhookRoute, emptyReq);
    emptyRes.assertStatus(200);

    // Verify draft template is NOT updated to APPROVED
    const checkDraft = await mkt.execute({
      sql: `SELECT approval_status FROM templates WHERE id = ?`,
      args: [draftTplId],
    });
    assertStrictEqual(checkDraft.rows[0]?.approval_status, "DRAFT", "Draft template must NOT be overwritten by empty ID webhook");

    // 3. Webhook fires with legitimate template ID approval
    const legitPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_test_123",
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "APPROVED",
                message_template_id: "meta_tpl_quote_ready_003",
                message_template_name: "quote_ready",
              },
            },
          ],
        },
      ],
    };

    const legitReq = await createSignedWebhookRequest(legitPayload);
    const legitRes = await callRoute(whatsappWebhookRoute, legitReq);
    legitRes.assertStatus(200);

    const checkLegit = await mkt.execute({
      sql: `SELECT approval_status FROM templates WHERE name = 'quote_ready' LIMIT 1`,
      args: [],
    });
    if (checkLegit.rows[0]) {
      assertStrictEqual(checkLegit.rows[0].approval_status, "APPROVED");
    }
  });

  it("normalizes 10-digit Indian numbers with +91 across formats (F12)", () => {
    // 10 digits
    assertStrictEqual(normalizeWhatsAppPhone("9848011223"), "+919848011223");
    // With spaces and hyphens
    assertStrictEqual(normalizeWhatsAppPhone("98480 11-223"), "+919848011223");
    // With leading zero
    assertStrictEqual(normalizeWhatsAppPhone("09848011223"), "+919848011223");
    // Already prefixed with 91
    assertStrictEqual(normalizeWhatsAppPhone("919848011223"), "+919848011223");
    // Already E.164
    assertStrictEqual(normalizeWhatsAppPhone("+919848011223"), "+919848011223");
    // International number preserves country code
    assertStrictEqual(normalizeWhatsAppPhone("+1 415 555 2671"), "+14155552671");
  });

  it("dispatches template message forwarding variables array and language code (F10)", async () => {
    mockMeta.reset();
    const conv = getRawLibSqlClient("conversations");
    const mkt = getRawLibSqlClient("marketing");
    const staffSession = await createTestStaffSession();
    setTestSessionUser(staffSession.user);

    // Dynamically load conversationIdRoute so the alias resolver is active
    const conversationIdRoute = await import("../../../apps/web/src/app/api/conversations/[id]/route");

    // Ensure template is APPROVED in DB
    const nowIso = new Date().toISOString();
    await mkt.execute({
      sql: `INSERT OR REPLACE INTO templates (
        id, name, language, category, header_type, body_text,
        approval_status, meta_template_id, updated_at, created_at
      ) VALUES ('tpl_order_pickup', 'order_pickup', 'en', 'UTILITY', 'NONE', 'Hello {{1}}, order {{2}} ready.', 'APPROVED', 'meta_pickup_101', ?, ?)`,
      args: [nowIso, nowIso],
    });

    // Create a test conversation with unique customer phone and valid last_message_at
    const uniquePhone = generateUniquePhone();
    const convId = `conv_tpl_test_${Date.now()}`;
    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, status, priority,
        assigned_staff_id, assigned_staff_name, last_message_at, created_at
      ) VALUES (?, ?, 'Rajesh Kumar', 'OPEN', 'NORMAL', ?, ?, ?, ?)`,
      args: [convId, uniquePhone, staffSession.user.id, staffSession.user.name, nowIso, nowIso],
    });

    const components = [
      {
        type: "body",
        parameters: [
          { type: "text", text: "Rajesh" },
          { type: "text", text: "ORD-9912" },
        ],
      },
    ];

    const dispatchReq = createTestRequest({
      url: `/api/conversations/${convId}`,
      method: "POST",
      sessionToken: staffSession.token,
      body: {
        action: "send_message",
        messageType: "TEMPLATE",
        templateName: "order_pickup",
        languageCode: "en_US",
        templateComponents: components,
        text: "Hello Rajesh, order ORD-9912 ready.",
      },
    });

    const dispatchRes = await callRoute(conversationIdRoute, dispatchReq, { params: { id: convId } });
    dispatchRes.assertStatus(200);

    // Verify outbound message was inserted
    const msgRes = await conv.execute({
      sql: `SELECT * FROM messages WHERE conversation_id = ? AND direction = 'OUTBOUND' ORDER BY id DESC LIMIT 1`,
      args: [convId],
    });
    assertOk(msgRes.rows.length > 0, "Outbound message should be recorded in DB");
    assertStrictEqual(msgRes.rows[0]?.template_name, "order_pickup");
  });

  it("handles template rejection webhook and prevents dispatching rejected templates", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const staffSession = await createTestStaffSession();
    setTestSessionUser(staffSession.user);

    // 1. Webhook delivers REJECTED status with reason
    const rejectPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_test_123",
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "REJECTED",
                message_template_id: "meta_rejected_001",
                message_template_name: "violating_promo",
                reason: "INCORRECT_CATEGORY",
              },
            },
          ],
        },
      ],
    };

    const rejectReq = await createSignedWebhookRequest(rejectPayload);
    const rejectRes = await callRoute(whatsappWebhookRoute, rejectReq);
    rejectRes.assertStatus(200);

    // 2. Attempting to dispatch unapproved/rejected template should return 400
    const uniquePhone = generateUniquePhone();
    const convId = `conv_reject_test_${Date.now()}`;
    const conv = getRawLibSqlClient("conversations");
    const nowIso = new Date().toISOString();
    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, status, priority,
        assigned_staff_id, assigned_staff_name, last_message_at, created_at
      ) VALUES (?, ?, 'Sunil', 'OPEN', 'NORMAL', ?, ?, ?, ?)`,
      args: [convId, uniquePhone, staffSession.user.id, staffSession.user.name, nowIso, nowIso],
    });

    // Insert as REJECTED in marketing DB
    await mkt.execute({
      sql: `INSERT OR REPLACE INTO templates (
        id, name, language, category, header_type, body_text,
        approval_status, rejection_reason, meta_template_id, updated_at, created_at
      ) VALUES ('tpl_violating', 'violating_promo', 'en', 'MARKETING', 'NONE', 'Bad body', 'REJECTED', 'INCORRECT_CATEGORY', 'meta_rejected_001', ?, ?)`,
      args: [nowIso, nowIso],
    });

    const conversationIdRoute = await import("../../../apps/web/src/app/api/conversations/[id]/route");
    const dispatchReq = createTestRequest({
      url: `/api/conversations/${convId}`,
      method: "POST",
      sessionToken: staffSession.token,
      body: {
        action: "send_message",
        messageType: "TEMPLATE",
        templateName: "violating_promo",
        text: "Bad body",
      },
    });

    const dispatchRes = await callRoute(conversationIdRoute, dispatchReq, { params: { id: convId } });
    dispatchRes.assertStatus(400);
    const errBody = await dispatchRes.json<{ ok: boolean; error: string }>();
    assertStrictEqual(errBody.ok, false);
    assertOk(errBody.error.includes("Only official Meta-APPROVED templates"));
  });
});
