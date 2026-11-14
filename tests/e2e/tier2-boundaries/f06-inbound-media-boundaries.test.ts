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

describe("F06: Inbound Media Webhook Handling - Boundary & Corner Cases", () => {
  it("handles inbound image webhook with undefined or empty caption safely", async () => {
    const payload = MOCK_INBOUND_MEDIA_PAYLOADS.image({
      caption: "",
      mediaId: "media_img_empty_caption_01",
    });

    const req = createSignedWebhookRequest(payload);

    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    // Verify database inserted the message without failing on empty caption
    const conv = getRawLibSqlClient("conversations");
    const msgRes = await conv.execute({
      sql: `SELECT id, body, message_type FROM messages WHERE wa_message_id = ? LIMIT 1`,
      args: [payload.entry[0].changes[0].value.messages[0].id],
    });

    assertOk(msgRes.rows.length === 1, "Message should be saved in DB");
    assertOk(String(msgRes.rows[0].body).length > 0, "Body should have fallback placeholder");
  });

  it("handles inbound document webhook with missing filename safely", async () => {
    const payload = MOCK_INBOUND_MEDIA_PAYLOADS.document({
      filename: "",
      caption: "Important Document",
      mediaId: "media_doc_no_filename_02",
    });

    const req = createSignedWebhookRequest(payload);

    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const conv = getRawLibSqlClient("conversations");
    const msgRes = await conv.execute({
      sql: `SELECT id, body FROM messages WHERE wa_message_id = ? LIMIT 1`,
      args: [payload.entry[0].changes[0].value.messages[0].id],
    });

    assertOk(msgRes.rows.length === 1);
  });

  it("handles inbound payload with empty or missing media object without throwing", async () => {
    const malformedPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_test_123",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                contacts: [{ profile: { name: "Test Contact" }, wa_id: "919848011999" }],
                messages: [
                  {
                    from: "919848011999",
                    id: `wamid.empty_media_${Date.now()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "image",
                    image: null,
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };

    const req = createSignedWebhookRequest(malformedPayload);

    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);
  });

  it("handles extremely large media caption (10,000 characters) without DB crash", async () => {
    const longCaption = "A".repeat(10000);
    const payload = MOCK_INBOUND_MEDIA_PAYLOADS.image({
      caption: longCaption,
      mediaId: "media_img_large_caption_03",
    });

    const req = createSignedWebhookRequest(payload);

    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const conv = getRawLibSqlClient("conversations");
    const msgRes = await conv.execute({
      sql: `SELECT body FROM messages WHERE wa_message_id = ? LIMIT 1`,
      args: [payload.entry[0].changes[0].value.messages[0].id],
    });

    assertOk(msgRes.rows.length === 1);
    assertOk(String(msgRes.rows[0].body).length >= 20, "Should store body safely without truncation error");
  });

  it("handles unsupported or unknown media types (e.g. location, sticker) gracefully", async () => {
    const unsupportedPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_test_123",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                contacts: [{ profile: { name: "Location User" }, wa_id: "919848011888" }],
                messages: [
                  {
                    from: "919848011888",
                    id: `wamid.unsupported_${Date.now()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "location",
                    location: {
                      latitude: 17.385,
                      longitude: 78.4867,
                      name: "Hyderabad Warehouse",
                    },
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };

    const req = createSignedWebhookRequest(unsupportedPayload);

    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);
  });
});
