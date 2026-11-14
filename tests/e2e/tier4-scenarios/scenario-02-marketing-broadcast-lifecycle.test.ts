import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  mockMeta,
  callRoute,
} from "../harness";
import {
  getRawLibSqlClient,
  normalizeWhatsAppPhone,
} from "@cc/database";
import {
  parseLocalIstToUtcIso,
  formatDateTimeIst,
  formatDateIst,
} from "@cc/ui";
import {
  createSignedWebhookRequest,
  generateUniquePhone,
} from "../tier3-pairwise/tier3-helper";
import * as whatsappWebhookRoute from "../../../apps/web/src/app/api/webhooks/whatsapp/route";

describe("Scenario 02: Marketing Broadcast Lifecycle & Delivery Tracking (F5 + F14 + F2 + F4 + F12)", () => {
  it("executes complete broadcast lifecycle: IST schedule parsing -> dispatch with phone norm -> receipt counts -> IST analytics", async () => {
    mockMeta.reset();
    const mkt = getRawLibSqlClient("marketing");
    const broadcastId = `bc_scenario2_${Date.now()}`;
    const nowIso = new Date().toISOString();

    // 1. Staff inputs datetime-local in IST: "2026-12-31T18:30"
    const inputIstDateTime = "2026-12-31T18:30";
    const parsedUtcIso = parseLocalIstToUtcIso(inputIstDateTime);
    assertStrictEqual(
      parsedUtcIso,
      "2026-12-31T13:00:00.000Z",
      "18:30 IST must parse to 13:00 UTC exactly"
    );

    // 2. Prepare 5 contacts with diverse Indian phone number formats
    const rawPhones = [
      "9848011221",
      "+91 98480 11222",
      "09848011223",
      "91-98480-11224",
      "+919848011225",
    ];
    const normalizedPhones = rawPhones.map((p) => normalizeWhatsAppPhone(p));

    // Ensure all 5 normalizations yield valid E.164 strings
    for (const p of normalizedPhones) {
      assertOk(p.startsWith("+91"), `Phone must start with +91, got ${p}`);
      assertStrictEqual(p.length, 13, `E.164 phone must have 13 chars, got ${p}`);
    }

    // 3. Create scheduled broadcast record in database
    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, list_id, list_name, template_id, template_name, name, status, scheduled_for,
        total_recipients, queued_count, sent_count, delivered_count, read_count, failed_count,
        created_by_name, created_at
      ) VALUES (?, 'lst_all_clients', 'All Clients', 'tpl_new_year_catalog', 'new_year_catalog', 'New Year Acrylic Catalog', 'SCHEDULED', ?, 5, 5, 0, 0, 0, 0, 'Marketing Desk', ?)`,
      args: [broadcastId, parsedUtcIso, nowIso],
    });

    // 4. Register recipients in broadcast_recipients table
    const recipientWaIds: Record<string, string> = {};
    for (let i = 0; i < normalizedPhones.length; i++) {
      const p = normalizedPhones[i];
      const recipId = `brecip_sc2_${i}_${Date.now()}`;
      const waMessageId = `wamid.sc2_msg_${i}_${Date.now()}`;
      recipientWaIds[p] = waMessageId;

      await mkt.execute({
        sql: `INSERT INTO broadcast_recipients (
          id, broadcast_id, customer_phone, customer_name, status, scheduled_at, wa_message_id, created_at
        ) VALUES (?, ?, ?, ?, 'QUEUED', ?, ?, ?)`,
        args: [recipId, broadcastId, p, `Client ${i + 1}`, parsedUtcIso, waMessageId, nowIso],
      });
    }

    // 5. Worker dispatches all 5 messages at scheduled time
    await mkt.execute({
      sql: `UPDATE broadcasts SET status = 'COMPLETED', queued_count = 0, sent_count = 5 WHERE id = ?`,
      args: [broadcastId],
    });
    await mkt.execute({
      sql: `UPDATE broadcast_recipients SET status = 'SENT', sent_at = ? WHERE broadcast_id = ?`,
      args: [new Date().toISOString(), broadcastId],
    });

    // Verify initial post-dispatch state: sent=5, delivered=0, read=0, failed=0
    let bc = (
      await mkt.execute({
        sql: `SELECT sent_count, delivered_count, read_count, failed_count FROM broadcasts WHERE id = ?`,
        args: [broadcastId],
      })
    ).rows[0] as any;
    assertStrictEqual(bc.sent_count, 5);
    assertStrictEqual(bc.delivered_count, 0);
    assertStrictEqual(bc.read_count, 0);
    assertStrictEqual(bc.failed_count, 0);

    // 6. Webhook receives 3 DELIVERED receipts (for contacts 0, 1, 2)
    for (let i = 0; i < 3; i++) {
      const p = normalizedPhones[i];
      const waId = recipientWaIds[p];
      const delivPayload = {
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
                      id: waId,
                      status: "delivered",
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      recipient_id: p.replace(/\D/g, ""),
                    },
                  ],
                },
                field: "messages",
              },
            ],
          },
        ],
      };
      const req = await createSignedWebhookRequest(delivPayload);
      const res = await callRoute(whatsappWebhookRoute, req);
      assertStrictEqual(res.status, 200);
    }

    // Check delivered count is now 3
    bc = (
      await mkt.execute({
        sql: `SELECT delivered_count, read_count, failed_count FROM broadcasts WHERE id = ?`,
        args: [broadcastId],
      })
    ).rows[0] as any;
    assertStrictEqual(bc.delivered_count, 3, "Delivered count must be 3");

    // 7. Webhook receives 2 READ receipts (for contacts 0 and 1)
    for (let i = 0; i < 2; i++) {
      const p = normalizedPhones[i];
      const waId = recipientWaIds[p];
      const readPayload = {
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
                      id: waId,
                      status: "read",
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      recipient_id: p.replace(/\D/g, ""),
                    },
                  ],
                },
                field: "messages",
              },
            ],
          },
        ],
      };
      const req = await createSignedWebhookRequest(readPayload);
      const res = await callRoute(whatsappWebhookRoute, req);
      assertStrictEqual(res.status, 200);
    }

    // Check read count is 2 and delivered count remains 3 (no double counting)
    bc = (
      await mkt.execute({
        sql: `SELECT delivered_count, read_count, failed_count FROM broadcasts WHERE id = ?`,
        args: [broadcastId],
      })
    ).rows[0] as any;
    assertStrictEqual(bc.delivered_count, 3, "Delivered count must remain 3");
    assertStrictEqual(bc.read_count, 2, "Read count must be 2");

    // 8. Webhook receives 1 FAILED receipt (for contact 4) with Meta error 131026
    const failedPhone = normalizedPhones[4];
    const failedWaId = recipientWaIds[failedPhone];
    const failedPayload = {
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
                    id: failedWaId,
                    status: "failed",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: failedPhone.replace(/\D/g, ""),
                    errors: [
                      {
                        code: 131026,
                        title: "Message undeliverable",
                        message: "Message undeliverable due to spam / rate limits",
                      },
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
    const failedReq = await createSignedWebhookRequest(failedPayload);
    const failedRes = await callRoute(whatsappWebhookRoute, failedReq);
    assertStrictEqual(failedRes.status, 200);

    // Check failed count is 1
    bc = (
      await mkt.execute({
        sql: `SELECT sent_count, delivered_count, read_count, failed_count FROM broadcasts WHERE id = ?`,
        args: [broadcastId],
      })
    ).rows[0] as any;
    assertStrictEqual(bc.sent_count, 5, "Sent count must be 5");
    assertStrictEqual(bc.delivered_count, 3, "Delivered count must be 3");
    assertStrictEqual(bc.read_count, 2, "Read count must be 2");
    assertStrictEqual(bc.failed_count, 1, "Failed count must be 1");

    // 9. Analytics view in IST
    const scheduledIstDisplay = formatDateTimeIst(parsedUtcIso);
    assertStrictEqual(
      scheduledIstDisplay,
      "31 Dec 2026, 06:30 PM",
      "Analytics card must display scheduled time in IST"
    );
    const scheduledDateOnly = formatDateIst(parsedUtcIso);
    assertStrictEqual(scheduledDateOnly, "31 Dec 2026");
  });

  it("ensures duplicate webhook receipt callbacks do not multiply broadcast delivery metrics", async () => {
    mockMeta.reset();
    const mkt = getRawLibSqlClient("marketing");
    const broadcastId = `bc_dup_test_${Date.now()}`;
    const nowIso = new Date().toISOString();
    const phone = generateUniquePhone();
    const waId = `wamid.dup_msg_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, list_id, list_name, template_id, template_name, name, status, total_recipients, queued_count, sent_count, delivered_count, read_count, failed_count, created_by_name, created_at
      ) VALUES (?, 'lst_1', 'Test List', 'tpl_1', 'test_template', 'Duplicate Test Campaign', 'COMPLETED', 1, 0, 1, 0, 0, 0, 'System', ?)`,
      args: [broadcastId, nowIso],
    });

    await mkt.execute({
      sql: `INSERT INTO broadcast_recipients (
        id, broadcast_id, customer_phone, customer_name, status, scheduled_at, wa_message_id, created_at
      ) VALUES (?, ?, ?, 'Test User', 'SENT', ?, ?, ?)`,
      args: [`recip_dup_${Date.now()}`, broadcastId, phone, nowIso, waId, nowIso],
    });

    const delivPayload = {
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
                    id: waId,
                    status: "delivered",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: phone.replace(/\D/g, ""),
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };

    // Send the exact same delivered callback twice
    const req1 = await createSignedWebhookRequest(delivPayload);
    await callRoute(whatsappWebhookRoute, req1);

    const req2 = await createSignedWebhookRequest(delivPayload);
    await callRoute(whatsappWebhookRoute, req2);

    const bc = (
      await mkt.execute({
        sql: `SELECT delivered_count FROM broadcasts WHERE id = ?`,
        args: [broadcastId],
      })
    ).rows[0] as any;

    assertStrictEqual(
      bc.delivered_count,
      1,
      "Duplicate DELIVERED webhook callbacks must not artificially increment delivered_count"
    );
  });
});
