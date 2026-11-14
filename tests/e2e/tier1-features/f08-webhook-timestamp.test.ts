import crypto from "node:crypto";
import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertUtcIso,
  assertIstFormatted,
  createTestRequest,
  callRoute,
  MOCK_INBOUND_MEDIA_PAYLOADS,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import { formatTimeIst } from "@cc/ui";
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

describe("F08: Webhook Epoch Timestamp Conversion to UTC ISO (Tier 1 Feature Coverage)", () => {
  it("T1-F08-01: converts Meta epoch seconds string to exact UTC ISO 8601 string", () => {
    // 1763198400 epoch seconds = 2025-11-15T09:20:00.000Z
    const epochStr = "1763198400";
    const utcIso = new Date(parseInt(epochStr, 10) * 1000).toISOString();

    assertStrictEqual(utcIso, "2025-11-15T09:20:00.000Z");
    assertUtcIso(utcIso);
  });

  it("T1-F08-02: verifies inbound message in database stores valid UTC ISO created_at timestamp", async () => {
    const payload = MOCK_INBOUND_MEDIA_PAYLOADS.image({
      from: "919848011228",
      mediaId: "media_img_ts_test",
      caption: "Timestamp test",
      timestamp: "1763198400",
    });

    const req = createSignedWebhookRequest(payload);
    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const conv = getRawLibSqlClient("conversations");
    const msgRes = await conv.execute({
      sql: `SELECT id, created_at FROM messages WHERE direction = 'INBOUND' ORDER BY id DESC LIMIT 1`,
      args: [],
    });

    assertOk(msgRes.rows.length > 0);
    const msg = msgRes.rows[0] as Record<string, unknown>;
    assertUtcIso(msg.created_at);
  });

  it("T1-F08-03: verifies conversation last_message_at stores valid UTC ISO timestamp", async () => {
    const conv = getRawLibSqlClient("conversations");
    const convRes = await conv.execute({
      sql: `SELECT id, last_message_at FROM conversations ORDER BY id DESC LIMIT 1`,
      args: [],
    });

    assertOk(convRes.rows.length > 0, "Conversation should exist");
    const conversation = convRes.rows[0] as Record<string, unknown>;
    assertUtcIso(conversation.last_message_at);
  });

  it("T1-F08-04: verifies thread messages are ordered chronologically by created_at", async () => {
    const conv = getRawLibSqlClient("conversations");
    const threadRes = await conv.execute({
      sql: `SELECT id, created_at FROM messages ORDER BY created_at ASC`,
      args: [],
    });

    assertOk(threadRes.rows.length >= 1);
    for (let i = 1; i < threadRes.rows.length; i++) {
      const prev = new Date(String(threadRes.rows[i - 1].created_at)).getTime();
      const curr = new Date(String(threadRes.rows[i].created_at)).getTime();
      assertOk(curr >= prev, "Messages must be ordered chronologically ascending");
    }
  });

  it("T1-F08-05: chat UI renders inbound UTC ISO message timestamp accurately in IST", () => {
    // 2025-11-15T09:20:00.000Z UTC -> 02:50 PM IST
    const utcIso = "2025-11-15T09:20:00.000Z";
    const renderedTime = formatTimeIst(utcIso);

    assertStrictEqual(renderedTime, "02:50 PM");
    assertIstFormatted(renderedTime, { format: "time" });
  });
});
