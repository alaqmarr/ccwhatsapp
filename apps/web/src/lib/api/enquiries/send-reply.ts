import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@cc/auth";
import { dispatchSystemEmail, sendWhatsAppCloudMessage } from "@cc/connections";
import {
  getRawLibSqlClient,
  normalizeWhatsAppPhone,
  syncWebsiteEnquiryStatusAcrossSites,
  upsertEcosystemEnquiry,
  upsertSyncedContact,
} from "@cc/database";
import { socketHub } from "@cc/sockets";

export async function handleEnquirySendReply(
  user: AuthenticatedUser,
  body: Record<string, unknown>
) {
  const id = String(body.id || "").trim();
  const replyMessage = String(body.replyMessage || "").trim();
  const channelRaw = String(body.channel || "EMAIL").toUpperCase();
  const channel: "EMAIL" | "WHATSAPP" | "BOTH" =
    channelRaw === "WHATSAPP"
      ? "WHATSAPP"
      : channelRaw === "BOTH"
      ? "BOTH"
      : "EMAIL";

  if (!id || !replyMessage) {
    return NextResponse.json(
      { ok: false, error: "Enquiry ID and reply message are required." },
      { status: 400 }
    );
  }

  const crm = getRawLibSqlClient("crm_orders");
  const conv = getRawLibSqlClient("conversations");
  const rowRes = await crm.execute({
    sql: `SELECT * FROM ecosystem_enquiries WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const row = rowRes.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "Enquiry not found." },
      { status: 404 }
    );
  }

  const brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" =
    String(row.brand) === "CLASSIC_EDGE_53"
      ? "CLASSIC_EDGE_53"
      : "CLASSIC_CONCEPTS";
  const externalId = String(row.external_id || id.replace(/^(cc_|ce53_|ce_)/, ""));
  const customerName = String(row.customer_name || "Customer");
  const customerEmail = String(row.customer_email || "").trim();
  const rawPhone = String(row.customer_phone || "").trim();
  const normalizedPhone = normalizeWhatsAppPhone(rawPhone);
  const productName = String(row.product_name || "");
  const originalMessage = String(row.message || "");
  const nowIso = new Date().toISOString();

  let emailDelivered = false;
  let emailError: string | undefined;
  let whatsappDelivered = false;
  let whatsappError: string | undefined;
  let conversationId: string | null = row.conversation_id
    ? String(row.conversation_id)
    : null;

  const wantsEmail = channel === "EMAIL" || channel === "BOTH";
  const wantsWhatsApp = channel === "WHATSAPP" || channel === "BOTH";

  const siteSync = await syncWebsiteEnquiryStatusAcrossSites({
    brand,
    externalId,
    replyMessage,
    sendEmailOnSite: wantsEmail,
  });

  if (wantsEmail) {
    if (siteSync.emailDeliveredBySite) {
      emailDelivered = true;
    } else if (customerEmail) {
      const brandTitle =
        brand === "CLASSIC_EDGE_53" ? "Classic Edge 53" : "Classic Concepts";
      const mailRes = await dispatchSystemEmail({
        to: customerEmail,
        recipientName: customerName,
        subject: `Re: Your Enquiry - ${brandTitle}`,
        text: `Hello ${customerName},\n\n${replyMessage}\n\nYour original enquiry:\n${originalMessage}\n\nWarm regards,\n${user.name}\nThe ${brandTitle} Team\nPhone: +91 79016 50662 | WhatsApp: +91 73372 20568`,
        dispatchType: "WEBSITE_ENQUIRY_REPLY",
        conversationId,
      });
      emailDelivered = mailRes.ok;
      if (!mailRes.ok) {
        emailError = mailRes.error || siteSync.emailError || "Email dispatch failed";
      }
    } else {
      emailError = "Customer email address is missing on this enquiry.";
    }
  }

  if (normalizedPhone) {
    const syncContact = await upsertSyncedContact({
      phone: normalizedPhone,
      name: customerName,
      email: customerEmail || undefined,
      source:
        brand === "CLASSIC_EDGE_53"
          ? "CLASSICEDGE53_FORM"
          : "CLASSICCONCEPTS_FORM",
      lastContactedAt: nowIso,
    }).catch(() => ({ id: null }));

    const existingConv = await conv.execute({
      sql: `SELECT id FROM conversations WHERE customer_phone = ? LIMIT 1`,
      args: [normalizedPhone],
    });
    if (existingConv.rows[0]) {
      conversationId = String(existingConv.rows[0].id);
    } else {
      conversationId = `conv_${crypto.randomUUID().slice(0, 8)}`;
      const brandTag =
        brand === "CLASSIC_EDGE_53" ? "Classic Edge 53" : "Classic Concepts";
      await conv.execute({
        sql: `INSERT INTO conversations (
          id, customer_phone, customer_name, customer_id, status, priority, smart_category,
          assigned_staff_id, assigned_staff_name, assigned_team_name, escalation_level,
          unread_count, last_message_preview, last_message_at, waiting_since, window_expires_at,
          tags_json, created_at
        ) VALUES (?, ?, ?, ?, 'OPEN', 'NORMAL', 'General Enquiry', ?, ?, 'Sales Team', 'P0', 0, ?, ?, NULL, NULL, ?, ?)`,
        args: [
          conversationId,
          normalizedPhone,
          customerName,
          syncContact?.id || null,
          user.id,
          user.name,
          replyMessage.slice(0, 140),
          nowIso,
          JSON.stringify([brandTag, "Website Enquiry"]),
          nowIso,
        ],
      });
    }

    if (wantsWhatsApp) {
      const waRes = await sendWhatsAppCloudMessage({
        toPhone: normalizedPhone,
        bodyText: replyMessage,
      });
      whatsappDelivered = waRes.ok;
      if (!waRes.ok) {
        whatsappError = waRes.error || "WhatsApp send failed";
      }
      const outMsgId = `msg_${crypto.randomUUID().slice(0, 10)}`;
      await conv.execute({
        sql: `INSERT INTO messages (
          id, conversation_id, wa_message_id, direction, sender_type, sender_name, sender_staff_id,
          message_type, billing_category, body, delivery_status, created_at
        ) VALUES (?, ?, ?, 'OUTBOUND', 'STAFF', ?, ?, 'TEXT', 'FREE_CHAT', ?, ?, ?)`,
        args: [
          outMsgId,
          conversationId,
          waRes.waMessageId,
          user.name,
          user.id,
          replyMessage,
          waRes.deliveryStatus,
          nowIso,
        ],
      });
      await conv.execute({
        sql: `UPDATE conversations
              SET last_message_preview = ?,
                  last_message_at = ?,
                  waiting_since = NULL,
                  unread_count = 0
              WHERE id = ?`,
        args: [`${user.name}: ${replyMessage}`.slice(0, 140), nowIso, conversationId],
      });
    } else if (conversationId) {
      await conv.execute({
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, sender_staff_id,
          message_type, billing_category, body, delivery_status, created_at
        ) VALUES (?, ?, 'INTERNAL', 'STAFF', ?, ?, 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
        args: [
          `msg_${crypto.randomUUID().slice(0, 10)}`,
          conversationId,
          user.name,
          user.id,
          `[Website Enquiry Email Reply Sent by ${user.name}]:\n${replyMessage}`,
          nowIso,
        ],
      });
    }
  } else if (wantsWhatsApp && !normalizedPhone) {
    whatsappError = "Customer phone number is missing or invalid for WhatsApp.";
  }

  if (wantsEmail && !emailDelivered && (!wantsWhatsApp || !whatsappDelivered)) {
    return NextResponse.json(
      { ok: false, error: emailError || whatsappError || "Failed to send reply." },
      { status: 500 }
    );
  }

  if (wantsWhatsApp && !wantsEmail && !whatsappDelivered) {
    return NextResponse.json(
      { ok: false, error: whatsappError || "Failed to send WhatsApp reply." },
      { status: 500 }
    );
  }

  const updatedEnquiry = await upsertEcosystemEnquiry({
    externalId,
    brand,
    customerName,
    customerEmail,
    customerPhone: normalizedPhone || rawPhone,
    productName,
    source: String(row.source || "Website Form"),
    message: originalMessage,
    status: "Replied",
    lastReplyText: replyMessage,
    lastReplyChannel: channel,
    repliedByName: user.name,
    repliedAt: nowIso,
    conversationId,
    createdAt: String(row.created_at || nowIso),
  });

  socketHub.emit("enquiry:updated", { enquiry: updatedEnquiry });
  if (conversationId) {
    socketHub.emit("message:new", {
      conversationId,
      senderName: user.name,
      text: replyMessage,
    });
  }

  return NextResponse.json({
    ok: true,
    enquiry: updatedEnquiry,
    emailDelivered,
    whatsappDelivered,
    bridgeUpdated: siteSync.bridgeUpdated,
    dbUpdated: siteSync.dbUpdated,
    emailError,
    whatsappError,
  });
}
