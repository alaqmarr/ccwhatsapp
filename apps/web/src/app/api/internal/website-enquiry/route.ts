import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import {
  dispatchSystemEmail,
  evaluateWebsiteEnquiryWithAi,
  extractQuoteRequestDetails,
  sendWebsiteEnquiryReceivedTemplate,
  sendWhatsAppCloudMessage,
} from "@cc/connections";
import {
  checkEcosystemBridgesHealth,
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  isValidEcosystemBridgeKey,
  normalizeWhatsAppPhone,
  syncWebsiteEnquiryStatusAcrossSites,
  upsertEcosystemEnquiry,
  upsertOrderTracking,
  upsertSyncedContact,
  type ShipmentStatus,
} from "@cc/database";
import { socketHub } from "@cc/sockets";
import {
  recordDualPricingLedgerEntry,
  smartAssignConversation,
} from "@cc/workers";

export const dynamic = "force-dynamic";

function isAuthorizedBridgeCall(req: Request): boolean {
  const key = req.headers.get("x-cc-bridge-key")?.trim() || "";
  return isValidEcosystemBridgeKey(key);
}

export async function GET(req: Request) {
  const bridgeOk = isAuthorizedBridgeCall(req);
  if (!bridgeOk) {
    const user = await getCurrentUser();
    if (!user || user.status !== "ACTIVE") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const health = await checkEcosystemBridgesHealth();
  return NextResponse.json({ ok: true, health });
}

export async function POST(req: Request) {
  if (!isAuthorizedBridgeCall(req)) {
    return NextResponse.json(
      { ok: false, error: "Invalid bridge key" },
      { status: 401 }
    );
  }

  await ensureDatabasesBootstrapped();
  const body = await req.json().catch(() => ({}));
  const eventType = String(body.type || body.event || "WEBSITE_ENQUIRY").toUpperCase();

  // 1. Live Order Creation / Status Sync from classicconcepts (:3003) or classicedge (:3002)
  if (eventType === "WEBSITE_ORDER") {
    const orderNumber = String(body.orderNumber || body.displayOrderId || body.orderId || "").trim();
    if (!orderNumber) {
      return NextResponse.json(
        { ok: false, error: "orderNumber is required" },
        { status: 400 }
      );
    }

    const rawStatus = String(body.shipmentStatus || body.status || "ORDER_CONFIRMED").toUpperCase();
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
      customerPhone:
        normalizeWhatsAppPhone(rawCustomerPhone) || rawCustomerPhone,
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

  // 1b. Cross-Site Enquiry Reply Sync (`ENQUIRY_REPLY`) from classicconcepts (:3003) or classicedge (:3002)
  if (eventType === "ENQUIRY_REPLY") {
    const brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" =
      body.brand === "CLASSIC_EDGE_53" ? "CLASSIC_EDGE_53" : "CLASSIC_CONCEPTS";
    const externalId = String(body.enquiryId || "").trim();
    const customerName = String(body.customerName || body.name || "Customer").trim();
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
        subject: `Re: Your Enquiry — ${brandTitle}`,
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

  // 2. Website Form Enquiry: Smart Claude Haiku 5.5 First Evaluation + Sales Team Routing
  const brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" =
    body.brand === "CLASSIC_EDGE_53" ? "CLASSIC_EDGE_53" : "CLASSIC_CONCEPTS";
  const customerName = String(body.customerName || body.name || "Customer").trim();
  const rawPhone = String(body.customerPhone || body.phone || "").trim();
  const customerEmail = String(body.customerEmail || body.email || "").trim();
  const productName = String(body.productName || "").trim();
  const sourceLabel = String(
    body.source ||
      (brand === "CLASSIC_EDGE_53"
        ? "Classic Edge 53 Website"
        : "Classic Concepts Website")
  ).trim();
  const messageText = String(body.message || "").trim();
  const externalId =
    String(body.enquiryId || "").trim() ||
    `ext_${crypto.randomUUID().slice(0, 8)}`;

  if (!messageText) {
    return NextResponse.json(
      { ok: false, error: "Enquiry message is required." },
      { status: 400 }
    );
  }

  const aiEval = await evaluateWebsiteEnquiryWithAi({
    brand,
    customerName,
    customerPhone: rawPhone,
    customerEmail,
    productName,
    message: messageText,
  });

  const normalizedPhone = normalizeWhatsAppPhone(rawPhone);
  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const nowIso = new Date().toISOString();
  let conversationId: string | null = null;
  let whatsappDelivered = false;

  if (normalizedPhone) {
    const syncContact = await upsertSyncedContact({
      phone: normalizedPhone,
      name: customerName,
      email: customerEmail || undefined,
      source:
        brand === "CLASSIC_EDGE_53"
          ? "CLASSICEDGE53_FORM"
          : "CLASSICCONCEPTS_FORM",
      stage: "QUALIFIED",
      acrioSegment: aiEval.smartCategory,
      tags: [
        brand === "CLASSIC_EDGE_53" ? "Classic Edge 53" : "Classic Concepts",
        "Website Enquiry",
      ],
      lastContactedAt: nowIso,
    });

    const existingConv = await conv.execute({
      sql: `SELECT id, window_expires_at FROM conversations WHERE customer_phone = ? LIMIT 1`,
      args: [normalizedPhone],
    });

    const brandTag =
      brand === "CLASSIC_EDGE_53" ? "Classic Edge 53" : "Classic Concepts";
    const inboundDisplayBody = `[Website Enquiry - ${brandTag}]${productName ? `\nProduct: ${productName}` : ""}\n${messageText}`;

    if (existingConv.rows[0]) {
      conversationId = String(existingConv.rows[0].id);
      await conv.execute({
        sql: `UPDATE conversations
              SET status = 'OPEN',
                  customer_name = COALESCE(NULLIF(?, ''), customer_name),
                  priority = ?,
                  smart_category = ?,
                  unread_count = unread_count + 1,
                  last_message_preview = ?,
                  last_message_at = ?,
                  waiting_since = COALESCE(waiting_since, ?)
              WHERE id = ?`,
        args: [
          customerName,
          aiEval.priority,
          aiEval.smartCategory,
          inboundDisplayBody.slice(0, 140),
          nowIso,
          nowIso,
          conversationId,
        ],
      });
    } else {
      conversationId = `conv_${crypto.randomUUID().slice(0, 8)}`;
      await conv.execute({
        sql: `INSERT INTO conversations (
          id, customer_phone, customer_name, customer_id, status, priority, smart_category,
          assigned_staff_id, assigned_staff_name, assigned_team_name, escalation_level,
          unread_count, last_message_preview, last_message_at, waiting_since, window_expires_at,
          tags_json, created_at
        ) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, 'ACRIO', 'ACRIO', 'System (ACRIO)', 'P0', 1, ?, ?, ?, NULL, ?, ?)`,
        args: [
          conversationId,
          normalizedPhone,
          customerName,
          syncContact.id || null,
          aiEval.priority,
          aiEval.smartCategory,
          inboundDisplayBody.slice(0, 140),
          nowIso,
          nowIso,
          JSON.stringify([brandTag, "Website Form"]),
          nowIso,
        ],
      });
    }

    // Record customer's website form enquiry in chat timeline
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, delivery_status, created_at
      ) VALUES (?, ?, 'INBOUND', 'CUSTOMER', ?, 'TEXT', 'SERVICE', ?, 'DELIVERED', ?)`,
      args: [
        `msg_${crypto.randomUUID().slice(0, 10)}`,
        conversationId,
        customerName,
        inboundDisplayBody,
        nowIso,
      ],
    });

    // Check if customer has an open 24h WhatsApp window; if open, send AI smart reply on WhatsApp too!
    const winExp = existingConv.rows[0]?.window_expires_at
      ? new Date(String(existingConv.rows[0].window_expires_at)).getTime()
      : 0;
    const isWindowOpen = winExp > Date.now();

    if (isWindowOpen) {
      const dispatch = await sendWhatsAppCloudMessage({
        toPhone: normalizedPhone,
        bodyText: aiEval.whatsappSummaryText,
      });
      whatsappDelivered = dispatch.ok;
      const outMsgId = `msg_${crypto.randomUUID().slice(0, 10)}`;
      await conv.execute({
        sql: `INSERT INTO messages (
          id, conversation_id, wa_message_id, direction, sender_type, sender_name, message_type,
          billing_category, body, delivery_status, created_at
        ) VALUES (?, ?, ?, 'OUTBOUND', 'AUTOMATION', 'ACRIO Website Concierge', 'TEXT', 'ACRIO', ?, ?, ?)`,
        args: [
          outMsgId,
          conversationId,
          dispatch.waMessageId,
          aiEval.whatsappSummaryText,
          dispatch.deliveryStatus,
          new Date(Date.now() + 250).toISOString(),
        ],
      });
      if (dispatch.ok) {
        await recordDualPricingLedgerEntry({
          messageId: outMsgId,
          conversationId,
          customerPhone: normalizedPhone,
          category: "ACRIO",
          staffName: "ACRIO Website Concierge",
          deliveryMode: dispatch.mode,
        });
      }
    } else {
      // Customer is outside 24h window: send approved Meta template `cc_website_enquiry_received` first!
      const tplDispatch = await sendWebsiteEnquiryReceivedTemplate({
        toPhone: normalizedPhone,
        customerName,
      });
      whatsappDelivered = tplDispatch.ok;
      const outTplMsgId = `msg_${crypto.randomUUID().slice(0, 10)}`;
      await conv.execute({
        sql: `INSERT INTO messages (
          id, conversation_id, wa_message_id, direction, sender_type, sender_name, message_type,
          billing_category, body, template_name, delivery_status, created_at
        ) VALUES (?, ?, ?, 'OUTBOUND', 'AUTOMATION', 'ACRIO Website Concierge', 'TEMPLATE', 'MARKETING', ?, ?, ?, ?)`,
        args: [
          outTplMsgId,
          conversationId,
          tplDispatch.waMessageId,
          tplDispatch.bodyText,
          tplDispatch.templateName,
          tplDispatch.deliveryStatus,
          new Date(Date.now() + 200).toISOString(),
        ],
      });
      if (tplDispatch.ok) {
        await recordDualPricingLedgerEntry({
          messageId: outTplMsgId,
          conversationId,
          customerPhone: normalizedPhone,
          category: "MARKETING",
          staffName: "ACRIO Website Concierge",
          deliveryMode: tplDispatch.mode,
        });
      }

      // Save AI evaluation + confirmation as an internal team note so Sales sees what AI prepared
      await conv.execute({
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, delivery_status, created_at
        ) VALUES (?, ?, 'INTERNAL', 'AUTOMATION', 'ACRIO Website Concierge', 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
        args: [
          `msg_${crypto.randomUUID().slice(0, 10)}`,
          conversationId,
          `Sent WhatsApp template *cc_website_enquiry_received* to ${customerName} (${normalizedPhone}).\n\nPrepared AI summary & emailed ${customerEmail || customerName}:\n${aiEval.whatsappSummaryText}`,
          new Date(Date.now() + 250).toISOString(),
        ],
      });
    }

    // Extract quote details if applicable and route conversation to Sales Team (triggers Email + WhatsApp cc_quote_request_alert / cc_staff_client_assignment!)
    const extractedQuote = extractQuoteRequestDetails({
      text: messageText,
      smartCategory: aiEval.smartCategory,
      productName: productName || aiEval.matchedItems?.[0]?.name || "",
    });
    await smartAssignConversation({
      conversationId,
      inboundText: inboundDisplayBody,
      preferredTeamId: "team_sales",
      startWaitingTimer: true,
      triggeredByName: "Website Enquiry Router",
      quoteProduct: extractedQuote.isQuoteRequest ? extractedQuote.product : productName || undefined,
      quoteQuantity: extractedQuote.isQuoteRequest ? extractedQuote.quantity : undefined,
      handoffReasonFromAcrio: `New ${brandTag} website enquiry evaluated by ACRIO AI and routed to Sales Team for follow-up.`,
    });

    socketHub.emit("message:new", { conversationId, source: "WEBSITE_ENQUIRY" });
    socketHub.emit("conversation:assigned", { conversationId });
  }

  // Log website enquiry sync record & upsert into unified ecosystem_enquiries table
  await upsertEcosystemEnquiry({
    externalId,
    brand,
    customerName,
    customerEmail,
    customerPhone: normalizedPhone || rawPhone,
    productName,
    source: sourceLabel,
    message: messageText,
    status: "New",
    aiSuggestedReply: aiEval.smartReplyText,
    conversationId,
    createdAt: nowIso,
  }).catch(() => {});

  await crm
    .execute({
      sql: `INSERT OR REPLACE INTO website_enquiry_sync_logs (
        id, external_key, brand, customer_name, customer_phone, customer_email,
        enquiry_text, ai_reply_text, conversation_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `wes_${crypto.randomUUID().slice(0, 10)}`,
        `${brand}:${externalId}`,
        brand,
        customerName,
        normalizedPhone || rawPhone,
        customerEmail,
        messageText,
        aiEval.smartReplyText,
        conversationId,
        whatsappDelivered ? "REPLIED_WHATSAPP_AND_EMAIL" : "ROUTED_TO_SALES",
        nowIso,
      ],
    })
    .catch(() => {});

  socketHub.emit("enquiry:updated", {
    externalId,
    brand,
  });

  return NextResponse.json({
    ok: true,
    conversationId,
    whatsappDelivered,
    whatsappDispatched: whatsappDelivered,
    smartCategory: aiEval.smartCategory,
    priority: aiEval.priority,
    smartReplyText: aiEval.smartReplyText,
    whatsappSummaryText: aiEval.whatsappSummaryText,
    matchedItems: aiEval.matchedItems,
  });
}
