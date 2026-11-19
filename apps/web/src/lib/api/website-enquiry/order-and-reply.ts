import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { dispatchSystemEmail, sendWhatsAppCloudMessage } from "@cc/connections";
import {
  getRawLibSqlClient,
  normalizeWhatsAppPhone,
  syncWebsiteEnquiryStatusAcrossSites,
  upsertEcosystemEnquiry,
  upsertOrderTracking,
  type ShipmentStatus,
} from "@cc/database";
import { socketHub } from "@cc/sockets";

export async function handleWebsiteOrder(body: Record<string, unknown>) {
  const orderNumber = String(
    body.orderNumber || body.displayOrderId || body.orderId || ""
  ).trim();
  if (!orderNumber) {
    return NextResponse.json(
      { ok: false, error: "orderNumber is required" },
      { status: 400 }
    );
  }

  const rawStatus = String(
    body.shipmentStatus || body.status || "ORDER_CONFIRMED"
  ).toUpperCase();
  const mappedStatus: ShipmentStatus = /DELIVER/.test(rawStatus)
    ? "DELIVERED"
    : /OUT_FOR_DELIVERY/.test(rawStatus)
    ? "OUT_FOR_DELIVERY"
    : /IN_TRANSIT/.test(rawStatus)
    ? "IN_TRANSIT"
    : /DISPATCH|SHIP/.test(rawStatus)
    ? "DISPATCHED"
    : /READY/.test(rawStatus)
    ? "READY_FOR_DISPATCH"
    : /PROD|PROCESS|PAID/.test(rawStatus)
    ? "IN_PRODUCTION"
    : "ORDER_CONFIRMED";

  const rawCustomerPhone = String(body.customerPhone || body.phone || "");
  const upserted = await upsertOrderTracking({
    orderId: orderNumber,
    brand:
      body.brand === "CLASSIC_EDGE_53" ? "CLASSIC_EDGE_53" : "CLASSIC_CONCEPTS",
    customerName: String(body.customerName || body.name || ""),
    customerPhone: normalizeWhatsAppPhone(rawCustomerPhone) || rawCustomerPhone,
    itemsSummary: String(body.itemsSummary || "Website Order"),
    providerCode: String(body.providerCode || "WORKSHOP"),
    providerName: String(body.providerName || "Workshop Dispatch"),
    awbNumber: String(body.awbNumber || ""),
    providerTrackingUrl: String(body.providerTrackingUrl || ""),
    shipmentStatus: mappedStatus,
    createdByName:
      body.brand === "CLASSIC_EDGE_53"
        ? "Classic Edge 53 (:3002)"
        : "Classic Concepts (:3003)",
  });

  return NextResponse.json({
    ok: upserted.ok,
    tracking: upserted.tracking,
    error: upserted.error,
  });
}

export async function handleEnquiryReply(body: Record<string, unknown>) {
  const brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" =
    body.brand === "CLASSIC_EDGE_53" ? "CLASSIC_EDGE_53" : "CLASSIC_CONCEPTS";
  const externalId = String(body.enquiryId || "").trim();
  const customerName = String(
    body.customerName || body.name || "Customer"
  ).trim();
  const customerEmail = String(body.customerEmail || body.email || "").trim();
  const rawPhone = String(body.customerPhone || body.phone || "").trim();
  const normalizedPhone = normalizeWhatsAppPhone(rawPhone);
  const replyMessage = String(body.replyMessage || "").trim();
  const originalMessage = String(body.originalMessage || "").trim();
  const productName = String(body.productName || "").trim();
  const channel = String(body.channel || "EMAIL").toUpperCase();
  const repliedByName = String(body.repliedByName || "Admin").trim();
  const nowIso = new Date().toISOString();

  let emailDispatchedByHub = false;
  let whatsappDispatchedByHub = false;

  if (body.dispatchEmailViaHub && customerEmail && replyMessage) {
    const brandTitle =
      brand === "CLASSIC_EDGE_53" ? "Classic Edge 53" : "Classic Concepts";
    const mailRes = await dispatchSystemEmail({
      to: customerEmail,
      recipientName: customerName,
      subject: `Re: Your Enquiry - ${brandTitle}`,
      text: `Hello ${customerName},\n\n${replyMessage}\n\nWarm regards,\nThe ${brandTitle} Team`,
      dispatchType: "WEBSITE_ENQUIRY_REPLY",
    });
    emailDispatchedByHub = mailRes.ok;
  }

  let conversationId: string | null = null;
  const conv = getRawLibSqlClient("conversations");
  if (normalizedPhone) {
    const existingConv = await conv.execute({
      sql: `SELECT id FROM conversations WHERE customer_phone = ? LIMIT 1`,
      args: [normalizedPhone],
    });
    if (existingConv.rows[0]) {
      conversationId = String(existingConv.rows[0].id);
    }

    if (channel === "WHATSAPP" && replyMessage) {
      const waRes = await sendWhatsAppCloudMessage({
        toPhone: normalizedPhone,
        bodyText: replyMessage,
      });
      whatsappDispatchedByHub = waRes.ok;
      if (conversationId) {
        await conv.execute({
          sql: `INSERT INTO messages (
            id, conversation_id, wa_message_id, direction, sender_type, sender_name, message_type,
            billing_category, body, delivery_status, created_at
          ) VALUES (?, ?, ?, 'OUTBOUND', 'STAFF', ?, 'TEXT', 'FREE_CHAT', ?, ?, ?)`,
          args: [
            `msg_${crypto.randomUUID().slice(0, 10)}`,
            conversationId,
            waRes.waMessageId,
            repliedByName,
            replyMessage,
            waRes.deliveryStatus,
            nowIso,
          ],
        });
      }
    } else if (conversationId && replyMessage) {
      await conv.execute({
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, delivery_status, created_at
        ) VALUES (?, ?, 'INTERNAL', 'STAFF', ?, 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
        args: [
          `msg_${crypto.randomUUID().slice(0, 10)}`,
          conversationId,
          repliedByName,
          `[Website Enquiry Replied via ${channel}]:\n${replyMessage}`,
          nowIso,
        ],
      });
    }
  }

  const updatedEnq = await upsertEcosystemEnquiry({
    externalId: externalId || `ext_${crypto.randomUUID().slice(0, 8)}`,
    brand,
    customerName,
    customerEmail,
    customerPhone: normalizedPhone || rawPhone,
    productName,
    message: originalMessage,
    status: "Replied",
    lastReplyText: replyMessage,
    lastReplyChannel: channel,
    repliedByName,
    repliedAt: nowIso,
    conversationId,
  });

  await syncWebsiteEnquiryStatusAcrossSites({
    brand,
    externalId,
    replyMessage,
    sendEmailOnSite: false,
  });

  socketHub.emit("enquiry:updated", {
    enquiry: updatedEnq,
  });

  return NextResponse.json({
    ok: true,
    enquiry: updatedEnq,
    emailDispatchedByHub,
    whatsappDispatchedByHub,
  });
}
