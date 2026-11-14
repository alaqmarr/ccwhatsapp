import crypto from "node:crypto";
import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  createTestRequest,
  callRoute,
  MOCK_INBOUND_MEDIA_PAYLOADS,
} from "../harness";
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

describe("F06: Inbound Media Webhook Handling (Tier 1 Feature Coverage)", () => {
  it("T1-F06-01: handles inbound image webhook payload and records message in conversation", async () => {
    const fromPhone = "919848011223";
    const mediaId = "media_img_sample_101";
    const caption = "Cast acrylic sheet sample";

    const payload = MOCK_INBOUND_MEDIA_PAYLOADS.image({
      from: fromPhone,
      mediaId,
      caption,
    });
    const waMsgId = payload.entry[0].changes[0].value.messages[0].id;

    const req = createSignedWebhookRequest(payload);
    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const conv = getRawLibSqlClient("conversations");
    const msgRes = await conv.execute({
      sql: `SELECT * FROM messages WHERE wa_message_id = ? LIMIT 1`,
      args: [waMsgId],
    });

    assertOk(msgRes.rows.length === 1, "Inbound image message must be stored in database");
    const msg = msgRes.rows[0] as Record<string, unknown>;
    assertStrictEqual(msg.direction, "INBOUND");
    assertOk(
      msg.body === caption || String(msg.body).includes("Media") || String(msg.body).includes("sample"),
      `Message body should capture image info or caption, got: "${msg.body}"`
    );
  });

  it("T1-F06-02: handles inbound document webhook payload with PDF attachment", async () => {
    const fromPhone = "919848011224";
    const mediaId = "media_doc_po_202";
    const filename = "PO_Acrylic_Podiums_991.pdf";
    const caption = "Purchase order for 5 acrylic podiums";

    const payload = MOCK_INBOUND_MEDIA_PAYLOADS.document({
      from: fromPhone,
      mediaId,
      filename,
      caption,
    });
    const waMsgId = payload.entry[0].changes[0].value.messages[0].id;

    const req = createSignedWebhookRequest(payload);
    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const conv = getRawLibSqlClient("conversations");
    const msgRes = await conv.execute({
      sql: `SELECT * FROM messages WHERE wa_message_id = ? LIMIT 1`,
      args: [waMsgId],
    });

    assertOk(msgRes.rows.length === 1, "Inbound document message must be stored in database");
    const msg = msgRes.rows[0] as Record<string, unknown>;
    assertStrictEqual(msg.direction, "INBOUND");
  });

  it("T1-F06-03: handles inbound video webhook payload", async () => {
    const fromPhone = "919848011225";
    const mediaId = "media_vid_flame_polishing";
    const caption = "Demonstration of acrylic edge flame polishing";

    const payload = MOCK_INBOUND_MEDIA_PAYLOADS.video({
      from: fromPhone,
      mediaId,
      caption,
    });
    const waMsgId = payload.entry[0].changes[0].value.messages[0].id;

    const req = createSignedWebhookRequest(payload);
    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const conv = getRawLibSqlClient("conversations");
    const msgRes = await conv.execute({
      sql: `SELECT * FROM messages WHERE wa_message_id = ? LIMIT 1`,
      args: [waMsgId],
    });

    assertOk(msgRes.rows.length === 1, "Inbound video message must be stored in database");
    const msg = msgRes.rows[0] as Record<string, unknown>;
    assertStrictEqual(msg.direction, "INBOUND");
  });

  it("T1-F06-04: handles inbound audio/voice note webhook payload", async () => {
    const fromPhone = "919848011226";
    const mediaId = "media_aud_voice_note_01";

    const payload = MOCK_INBOUND_MEDIA_PAYLOADS.audio({
      from: fromPhone,
      mediaId,
      voice: true,
    });
    const waMsgId = payload.entry[0].changes[0].value.messages[0].id;

    const req = createSignedWebhookRequest(payload);
    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const conv = getRawLibSqlClient("conversations");
    const msgRes = await conv.execute({
      sql: `SELECT * FROM messages WHERE wa_message_id = ? LIMIT 1`,
      args: [waMsgId],
    });

    assertOk(msgRes.rows.length === 1, "Inbound audio message must be stored in database");
    const msg = msgRes.rows[0] as Record<string, unknown>;
    assertStrictEqual(msg.direction, "INBOUND");
  });

  it("T1-F06-05: emits real-time socket message:new event upon receiving inbound webhook", async () => {
    let capturedEvent: { type: string; payload: unknown } | null = null;
    const unsub = socketHub.subscribe((ev) => {
      if (ev.type === "message:new") {
        capturedEvent = ev;
      }
    });

    try {
      const payload = MOCK_INBOUND_MEDIA_PAYLOADS.image({
        from: "919848011227",
        mediaId: "media_img_socket_test",
        caption: "Socket test image",
      });

      const req = createSignedWebhookRequest(payload);
      const res = await callRoute(whatsappWebhookRoute, req);
      res.assertStatus(200);

      assertOk(capturedEvent, "socketHub should have emitted message:new event");
      assertStrictEqual((capturedEvent as { type: string; payload: unknown }).type, "message:new");
    } finally {
      unsub();
    }
  });
});
