import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getSetupStatus } from "@cc/auth";
import { verifyMetaWebhookSignature } from "@cc/connections";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { socketHub } from "@cc/sockets";
import { processInboundAutomations } from "@cc/workers";

export const dynamic = "force-dynamic";

// Meta Webhook Verification Handshake (`GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const setup = await getSetupStatus();
  if (
    mode === "subscribe" &&
    token &&
    token === setup.facebookConfig.webhookVerifyToken
  ) {
    return new Response(challenge || "OK", { status: 200 });
  }

  return NextResponse.json({ ok: false, error: "Invalid verify token" }, { status: 403 });
}

// Meta Inbound Messages & Delivery Receipts (`POST /api/webhooks/whatsapp`)
export async function POST(req: Request) {
  await ensureDatabasesBootstrapped();
  const rawBody = await req.text();
  const setup = await getSetupStatus();

  const sig = req.headers.get("x-hub-signature-256");
  if (
    setup.facebookConfig.metaAppSecret &&
    !verifyMetaWebhookSignature(rawBody, sig, setup.facebookConfig.metaAppSecret)
  ) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const nowIso = new Date().toISOString();
  const windowExp = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const val = change?.value || {};
      const contacts = val?.contacts || [];

      // 1. Inbound customer messages
      for (const msg of val?.messages || []) {
        const fromDigits = String(msg?.from || "").replace(/\D/g, "");
        if (!fromDigits) continue;
        const e164 = `+${fromDigits}`;
        const contactName =
          String(contacts[0]?.profile?.name || "").trim() || e164;
        const textBody =
          msg?.text?.body ||
          msg?.button?.text ||
          msg?.interactive?.button_reply?.title ||
          "[Media / Attachment]";

        const existingCust = await crm.execute({
          sql: `SELECT id FROM customers WHERE phone = ? LIMIT 1`,
          args: [e164],
        });
        let custId = existingCust.rows[0] ? String(existingCust.rows[0].id) : "";
        if (!custId) {
          custId = `cust_${crypto.randomUUID().slice(0, 8)}`;
          await crm.execute({
            sql: `INSERT INTO customers (id, phone, name, acrio_segment, last_interaction_at, created_at)
                  VALUES (?, ?, ?, 'Inbound WhatsApp Lead', ?, ?)`,
            args: [custId, e164, contactName, nowIso, nowIso],
          });
        }

        const existingConv = await conv.execute({
          sql: `SELECT id FROM conversations WHERE customer_phone = ? LIMIT 1`,
          args: [e164],
        });
        const isNew = existingConv.rows.length === 0;
        const convId = isNew
          ? `conv_${crypto.randomUUID().slice(0, 8)}`
          : String(existingConv.rows[0].id);

        if (isNew) {
          await conv.execute({
            sql: `INSERT INTO conversations (
              id, customer_phone, customer_name, customer_id, status, priority,
              smart_category, unread_count, last_message_preview, last_message_at, window_expires_at, created_at
            ) VALUES (?, ?, ?, ?, 'OPEN', 'NORMAL', 'General Enquiry', 1, ?, ?, ?, ?)`,
            args: [convId, e164, contactName, custId, String(textBody).slice(0, 140), nowIso, windowExp, nowIso],
          });
        } else {
          await conv.execute({
            sql: `UPDATE conversations
                  SET status = CASE WHEN status = 'RESOLVED' THEN 'OPEN' ELSE status END,
                      unread_count = unread_count + 1,
                      last_message_preview = ?,
                      last_message_at = ?,
                      window_expires_at = ?
                  WHERE id = ?`,
            args: [String(textBody).slice(0, 140), nowIso, windowExp, convId],
          });
        }

        await conv.execute({
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, wa_message_id, delivery_status, created_at
          ) VALUES (?, ?, 'INBOUND', 'CUSTOMER', ?, 'TEXT', 'SERVICE', ?, ?, 'DELIVERED', ?)`,
          args: [
            `msg_${crypto.randomUUID().slice(0, 8)}`,
            convId,
            contactName,
            String(textBody),
            String(msg?.id || ""),
            nowIso,
          ],
        });

        await processInboundAutomations({
          conversationId: convId,
          customerPhone: e164,
          inboundText: String(textBody),
          isNewConversation: isNew,
        });

        socketHub.emit("message:new", { conversationId: convId, customerName: contactName });
      }

      // 2. Delivery & Read Receipts
      for (const st of val?.statuses || []) {
        const waId = String(st?.id || "");
        const nextStatus = String(st?.status || "").toUpperCase();
        if (waId && ["SENT", "DELIVERED", "READ", "FAILED"].includes(nextStatus)) {
          await conv.execute({
            sql: `UPDATE messages SET delivery_status = ? WHERE wa_message_id = ?`,
            args: [nextStatus, waId],
          });
          socketHub.emit("message:status", { waMessageId: waId, status: nextStatus });
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
