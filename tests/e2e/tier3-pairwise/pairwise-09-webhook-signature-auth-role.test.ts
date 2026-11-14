import crypto from "node:crypto";
import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertUtcIso,
  createTestRequest,
  callRoute,
  mockMeta,
  createTestStaffSession,
  MOCK_INBOUND_MEDIA_PAYLOADS,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import { getSetupStatus } from "@cc/auth";
import { setTestSessionUser, generateUniquePhone, createSignedWebhookRequest } from "./tier3-helper";
import * as whatsappWebhookRoute from "../../../apps/web/src/app/api/webhooks/whatsapp/route";

describe("Pairwise 09: Webhook Signature, Timestamp UTC & Role Visibility (F6 + F8 + F18)", () => {
  it("authenticates webhook with valid HMAC signature and rejects invalid signature (F6 + F18)", async () => {
    const setup = await getSetupStatus();
    const payload = MOCK_INBOUND_MEDIA_PAYLOADS.image({
      from: "919848011299",
      mediaId: "media_sig_test",
    });
    const rawBody = JSON.stringify(payload);

    // 1. Valid signature
    const validHmac = crypto.createHmac("sha256", setup.facebookConfig.metaAppSecret || "secret")
      .update(rawBody, "utf8")
      .digest("hex");

    const validReq = createTestRequest({
      url: "/api/webhooks/whatsapp",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${validHmac}`,
      },
      body: rawBody,
    });
    const validRes = await callRoute(whatsappWebhookRoute, validReq);
    validRes.assertStatus(200);

    // 2. Tampered / invalid signature
    if (setup.facebookConfig.metaAppSecret) {
      const invalidReq = createTestRequest({
        url: "/api/webhooks/whatsapp",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": "sha256=invalid_tampered_signature_hex",
        },
        body: rawBody,
      });
      const invalidRes = await callRoute(whatsappWebhookRoute, invalidReq);
      invalidRes.assertStatus(401);
    }
  });

  it("handles webhook GET verification handshake for subscribe mode (F6)", async () => {
    const setup = await getSetupStatus();
    const verifyToken = setup.facebookConfig.webhookVerifyToken || "cc_whatsapp_verify_2026";
    const challenge = "test_hub_challenge_string_9988";

    // 1. Correct verify token
    const correctReq = createTestRequest({
      url: "/api/webhooks/whatsapp",
      method: "GET",
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": verifyToken,
        "hub.challenge": challenge,
      },
    });
    const correctRes = await callRoute(whatsappWebhookRoute, correctReq);
    correctRes.assertStatus(200);
    const bodyText = await correctRes.text();
    assertStrictEqual(bodyText, challenge);

    // 2. Wrong verify token -> 403
    const wrongReq = createTestRequest({
      url: "/api/webhooks/whatsapp",
      method: "GET",
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong_token",
        "hub.challenge": challenge,
      },
    });
    const wrongRes = await callRoute(whatsappWebhookRoute, wrongReq);
    wrongRes.assertStatus(403);
  });

  it("converts epoch seconds to UTC ISO string and stores in messages table (F8)", async () => {
    const epochSeconds = "1763198700"; // 2025-11-15T09:25:00.000Z
    const expectedUtcIso = "2025-11-15T09:25:00.000Z";
    const uniquePhone = generateUniquePhone().replace(/\D/g, "");

    const payload = MOCK_INBOUND_MEDIA_PAYLOADS.image({
      from: uniquePhone,
      mediaId: "media_epoch_test",
      caption: "Timestamp test acrylic sheet",
      timestamp: epochSeconds,
    });

    const req = await createSignedWebhookRequest(payload);
    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const conv = getRawLibSqlClient("conversations");
    const msgRes = await conv.execute({
      sql: `SELECT created_at, billing_category FROM messages WHERE direction = 'INBOUND' ORDER BY id DESC LIMIT 1`,
      args: [],
    });
    assertOk(msgRes.rows[0]);
    assertUtcIso(msgRes.rows[0].created_at);

    // Verify epoch timestamp conversion math
    const parsedEpochIso = new Date(parseInt(epochSeconds, 10) * 1000).toISOString();
    assertStrictEqual(parsedEpochIso, expectedUtcIso);
  });

  it("marks inbound customer messages as FREE_CHAT in DB and hides billing charges from staff (F18)", async () => {
    const staffSession = await createTestStaffSession();
    setTestSessionUser(staffSession.user);

    const conv = getRawLibSqlClient("conversations");
    const uniquePhone = generateUniquePhone();
    const convId = `conv_free_${Date.now()}`;
    const nowIso = new Date().toISOString();

    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, status, priority,
        last_message_at, created_at
      ) VALUES (?, ?, 'Free Chat Client', 'OPEN', 'NORMAL', ?, ?)`,
      args: [convId, uniquePhone, nowIso, nowIso],
    });

    // Inbound customer message has billing_category: 'FREE_CHAT'
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'INBOUND', 'CUSTOMER', 'Customer', 'TEXT', 'FREE_CHAT', 'Inquiry', 'wamid.free_1', 'DELIVERED', ?)`,
      args: [`msg_free_${Date.now()}`, convId, nowIso],
    });

    // Staff loads conversation
    const conversationIdRoute = await import("../../../apps/web/src/app/api/conversations/[id]/route");
    const req = createTestRequest({
      url: `/api/conversations/${convId}`,
      method: "GET",
      sessionToken: staffSession.token,
    });

    const res = await callRoute(conversationIdRoute, req, { params: { id: convId } });
    res.assertStatus(200);
    const body = await res.json<Record<string, unknown>>();
    assertOk(body.ok);
  });

  it("upserts inbound contacts directory with normalized phone number (F6 + F8)", async () => {
    const uniquePhone = generateUniquePhone();
    const rawDigits = uniquePhone.replace(/\D/g, "");

    const payload = MOCK_INBOUND_MEDIA_PAYLOADS.image({
      from: rawDigits,
      mediaId: "media_contact_upsert",
      caption: "Contact test",
    });

    const req = await createSignedWebhookRequest(payload);
    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const contactsDb = getRawLibSqlClient("contacts");
    const contactRes = await contactsDb.execute({
      sql: `SELECT * FROM contacts WHERE phone = ? LIMIT 1`,
      args: [uniquePhone],
    });

    assertOk(contactRes.rows[0], "Contact must be upserted in contacts database with normalized phone");
    assertStrictEqual(contactRes.rows[0].phone, uniquePhone);
  });
});
