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
import {
  getRawLibSqlClient,
  normalizeWhatsAppPhone,
} from "@cc/database";
import { formatTimeIst, formatDateIst } from "@cc/ui";
import {
  setTestSessionUser,
  createSignedWebhookRequest,
  generateUniquePhone,
} from "../tier3-pairwise/tier3-helper";
import * as whatsappWebhookRoute from "../../../apps/web/src/app/api/webhooks/whatsapp/route";
import * as mediaRoute from "../../../apps/web/src/app/api/media/[id]/route";
import { sendWhatsAppCloudMessage } from "@cc/connections";

describe("Scenario 01: Inbound Media Customer Journey & Staff Chat Lifecycle (F6 + F7 + F8 + F10 + F14)", () => {
  it("executes full multi-turn journey: inbound photo -> IST display -> staff media download -> template reply -> read receipt", async () => {
    mockMeta.reset();
    const phone = generateUniquePhone();
    const e164 = normalizeWhatsAppPhone(phone);
    const mediaId = "media_sample_journey_01";
    const inboundWaMessageId = `wamid.inbound_scenario1_${Date.now()}`;
    const epochTimestamp = "1763198400"; // UTC 2025-11-15T09:20:00.000Z -> IST 02:50 PM

    // Step 1: Customer sends WhatsApp photo of custom acrylic sheet sample
    const inboundPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_test_123",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+919876543210",
                  phone_number_id: "phone_id_test_101",
                },
                contacts: [{ profile: { name: "Vikram Acrylic Buyer" }, wa_id: e164.replace(/\D/g, "") }],
                messages: [
                  {
                    from: e164.replace(/\D/g, ""),
                    id: inboundWaMessageId,
                    timestamp: epochTimestamp,
                    type: "image",
                    image: {
                      id: mediaId,
                      mime_type: "image/jpeg",
                      sha256: "mock_sha256_journey_01",
                      caption: "Can you manufacture 50 of these?",
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

    const webhookReq = await createSignedWebhookRequest(inboundPayload);
    const webhookRes = await callRoute(whatsappWebhookRoute, webhookReq);
    assertStrictEqual(webhookRes.status, 200, "Webhook must accept inbound image");

    // Step 2: Verify database records
    const conv = getRawLibSqlClient("conversations");
    const convRow = await conv.execute({
      sql: `SELECT id, customer_phone, last_message_preview FROM conversations WHERE customer_phone = ? LIMIT 1`,
      args: [e164],
    });
    assertStrictEqual(convRow.rows.length, 1, "Conversation must be upserted");
    const conversationId = String(convRow.rows[0].id);

    const msgRow = await conv.execute({
      sql: `SELECT id, message_type, body, metadata_json, created_at, billing_category FROM messages WHERE wa_message_id = ? LIMIT 1`,
      args: [inboundWaMessageId],
    });
    assertStrictEqual(msgRow.rows.length, 1, "Message must be stored");
    const inboundMsg = msgRow.rows[0] as any;
    assertStrictEqual(inboundMsg.message_type, "IMAGE");
    assertStrictEqual(inboundMsg.body, "Can you manufacture 50 of these?");
    assertStrictEqual(inboundMsg.created_at, "2025-11-15T09:20:00.000Z");

    const meta = JSON.parse(String(inboundMsg.metadata_json || "{}"));
    assertStrictEqual(meta.mediaId, mediaId);
    assertStrictEqual(meta.mimeType, "image/jpeg");

    // Step 3: Staff views chat in IST (02:50 PM)
    const formattedTime = formatTimeIst(inboundMsg.created_at);
    assertStrictEqual(formattedTime, "02:50 PM", "Inbound time must format to 02:50 PM IST");
    const formattedDate = formatDateIst(inboundMsg.created_at);
    assertStrictEqual(formattedDate, "15 Nov 2025", "Inbound date must format to 15 Nov 2025 IST");

    // Step 4: Staff downloads / views media via GET /api/media/[id]
    const staffSession = await createTestStaffSession();
    setTestSessionUser(staffSession.user);

    const mediaReq = createTestRequest({
      url: `/api/media/${mediaId}`,
      method: "GET",
      sessionToken: staffSession.token,
    });
    const mediaRes = await callRoute(mediaRoute, mediaReq, { params: { id: mediaId } });
    assertStrictEqual(mediaRes.status, 200, "Staff must be able to view/stream inbound media");
    assertOk(
      mediaRes.headers.get("content-type")?.includes("image/jpeg"),
      "Media route must return image/jpeg content type"
    );

    // Step 5: Staff replies with template and variables
    const outboundSend = await sendWhatsAppCloudMessage({
      toPhone: e164,
      bodyText: "Quotation for 50 Units Cast Acrylic: ₹14,500. Dispatch in 2 days.",
      templateName: "quote_dispatch",
      languageCode: "en",
      templateComponents: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "50 Units Cast Acrylic" },
            { type: "text", text: "₹14,500" },
          ],
        },
      ],
    });
    assertStrictEqual(outboundSend.ok, true, "Outbound reply must succeed");
    const outboundWaId = outboundSend.waMessageId || `wamid.outbound_${Date.now()}`;

    // Store outbound message in conversation thread
    const outboundMsgId = `msg_reply_${Date.now()}`;
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, template_name, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'STAFF', 'Sales Desk', 'TEMPLATE', 'UTILITY', ?, 'quote_dispatch', ?, 'SENT', ?)`,
      args: [
        outboundMsgId,
        conversationId,
        "Quotation for 50 Units Cast Acrylic: ₹14,500. Dispatch in 2 days.",
        outboundWaId,
        new Date().toISOString(),
      ],
    });

    // Step 6: Meta delivers status receipt DELIVERED
    const deliveredReceipt = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_test_123",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+919876543210",
                  phone_number_id: "phone_id_test_101",
                },
                statuses: [
                  {
                    id: outboundWaId,
                    status: "delivered",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: e164.replace(/\D/g, ""),
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };

    const delivReq = await createSignedWebhookRequest(deliveredReceipt);
    const delivRes = await callRoute(whatsappWebhookRoute, delivReq);
    assertStrictEqual(delivRes.status, 200);

    const checkDelivered = await conv.execute({
      sql: `SELECT delivery_status FROM messages WHERE id = ?`,
      args: [outboundMsgId],
    });
    assertStrictEqual(checkDelivered.rows[0]?.delivery_status, "DELIVERED");

    // Step 7: Customer opens chat -> Meta delivers status receipt READ
    const readReceipt = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_test_123",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+919876543210",
                  phone_number_id: "phone_id_test_101",
                },
                statuses: [
                  {
                    id: outboundWaId,
                    status: "read",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: e164.replace(/\D/g, ""),
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };

    const readReq = await createSignedWebhookRequest(readReceipt);
    const readRes = await callRoute(whatsappWebhookRoute, readReq);
    assertStrictEqual(readRes.status, 200);

    const checkRead = await conv.execute({
      sql: `SELECT delivery_status FROM messages WHERE id = ?`,
      args: [outboundMsgId],
    });
    assertStrictEqual(checkRead.rows[0]?.delivery_status, "READ");

    // Step 8: Verify staff view confirms FREE_CHAT billing category on inbound
    assertStrictEqual(
      inboundMsg.billing_category,
      "FREE_CHAT",
      "Customer-initiated messages must be tagged as FREE_CHAT with zero staff charge"
    );
  });

  it("handles inbound PDF purchase order document journey with filename in metadata", async () => {
    mockMeta.reset();
    const phone = generateUniquePhone();
    const e164 = normalizeWhatsAppPhone(phone);
    const mediaId = "media_doc_po_9001";
    const inboundWaId = `wamid.inbound_doc_${Date.now()}`;

    const docPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_test_123",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+919876543210",
                  phone_number_id: "phone_id_test_101",
                },
                contacts: [{ profile: { name: "Anil Procurement" }, wa_id: e164.replace(/\D/g, "") }],
                messages: [
                  {
                    from: e164.replace(/\D/g, ""),
                    id: inboundWaId,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "document",
                    document: {
                      id: mediaId,
                      mime_type: "application/pdf",
                      filename: "PO_ClassicConcepts_500Pcs.pdf",
                      sha256: "mock_doc_hash_po_9001",
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

    const docReq = await createSignedWebhookRequest(docPayload);
    const docRes = await callRoute(whatsappWebhookRoute, docReq);
    assertStrictEqual(docRes.status, 200);

    const conv = getRawLibSqlClient("conversations");
    const docRow = await conv.execute({
      sql: `SELECT message_type, metadata_json FROM messages WHERE wa_message_id = ? LIMIT 1`,
      args: [inboundWaId],
    });
    assertStrictEqual(docRow.rows.length, 1);
    assertStrictEqual(docRow.rows[0]?.message_type, "DOCUMENT");

    const meta = JSON.parse(String(docRow.rows[0]?.metadata_json || "{}"));
    assertStrictEqual(meta.filename, "PO_ClassicConcepts_500Pcs.pdf");
    assertStrictEqual(meta.mimeType, "application/pdf");
  });

  it("verifies unauthenticated requests to media download route are rejected with HTTP 401 or 403", async () => {
    setTestSessionUser(null);
    const unauthReq = createTestRequest({
      url: `/api/media/media_unauth_999`,
      method: "GET",
    });
    const res = await callRoute(mediaRoute, unauthReq, { params: { id: "media_unauth_999" } });
    assertOk(
      res.status === 401 || res.status === 403,
      `Unauthenticated media fetch must return 401 or 403, got ${res.status}`
    );
  });
});
