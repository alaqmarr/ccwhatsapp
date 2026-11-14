import crypto from "node:crypto";
import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertUtcIso,
  createTestRequest,
  callRoute,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import * as whatsappWebhookRoute from "../../../apps/web/src/app/api/webhooks/whatsapp/route";

function parseWaTimestampToUtcIso(rawTimestamp: string | number | undefined | null): string {
  if (rawTimestamp === undefined || rawTimestamp === null || rawTimestamp === "") {
    return new Date().toISOString();
  }

  const num = typeof rawTimestamp === "number" ? rawTimestamp : Number(rawTimestamp);
  if (Number.isNaN(num) || num <= 0) {
    return new Date().toISOString();
  }

  // If already in milliseconds (> 1e11), don't multiply by 1000 again
  const ms = num > 1e11 ? num : num * 1000;
  return new Date(ms).toISOString();
}

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

describe("F08: Webhook Timestamp UTC Conversion - Boundary & Corner Cases", () => {
  it("handles string vs number timestamp equivalence", () => {
    const epochSec = 1763198400; // 2025-11-15T09:20:00.000Z
    const fromNumber = parseWaTimestampToUtcIso(epochSec);
    const fromString = parseWaTimestampToUtcIso("1763198400");

    assertStrictEqual(fromNumber, "2025-11-15T09:20:00.000Z");
    assertStrictEqual(fromString, "2025-11-15T09:20:00.000Z");
    assertUtcIso(fromNumber);
  });

  it("detects and corrects millisecond timestamp magnitude (>1e11)", () => {
    // 1763198400000 passed as milliseconds
    const fromMs = parseWaTimestampToUtcIso(1763198400000);
    assertStrictEqual(fromMs, "2025-11-15T09:20:00.000Z");
    assertUtcIso(fromMs);
  });

  it("falls back safely to valid UTC ISO when timestamp is missing or undefined", () => {
    const fromUndefined = parseWaTimestampToUtcIso(undefined);
    assertOk(fromUndefined.endsWith("Z"), "Should be valid UTC ISO string");
    assertUtcIso(fromUndefined);

    const fromNull = parseWaTimestampToUtcIso(null);
    assertUtcIso(fromNull);
  });

  it("handles non-numeric or malformed timestamp string safely", () => {
    const fromMalformed = parseWaTimestampToUtcIso("invalid-timestamp-string");
    assertUtcIso(fromMalformed);
    assertOk(!fromMalformed.includes("NaN"), "Should not contain NaN");
  });

  it("webhook endpoint processes message with future timestamp without crashing", async () => {
    const futureEpochSec = String(Math.floor(Date.now() / 1000) + 86400 * 30); // 30 days in future
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_test_123",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                contacts: [{ profile: { name: "Future Sender" }, wa_id: "919848011777" }],
                messages: [
                  {
                    from: "919848011777",
                    id: `wamid.future_ts_${Date.now()}`,
                    timestamp: futureEpochSec,
                    type: "text",
                    text: { body: "Testing future timestamp boundary" },
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };

    const req = createSignedWebhookRequest(payload);

    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const conv = getRawLibSqlClient("conversations");
    const msgRes = await conv.execute({
      sql: `SELECT id, created_at FROM messages WHERE wa_message_id = ? LIMIT 1`,
      args: [payload.entry[0].changes[0].value.messages[0].id],
    });

    assertOk(msgRes.rows.length === 1);
    assertUtcIso(String(msgRes.rows[0].created_at));
  });
});
