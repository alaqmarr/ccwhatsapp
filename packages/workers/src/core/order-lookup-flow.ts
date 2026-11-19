import crypto from "node:crypto";
import {
  getRawLibSqlClient,
  lookupCustomerOrdersAcrossEcosystem,
  resolvePublicTrackingOrigin,
  type OrderTrackingRecord,
} from "@cc/database";
import { formatWhatsAppOutboundText, sendWhatsAppCloudMessage } from "@cc/connections";
import { socketHub } from "@cc/sockets";
import { scheduleSandboxDeliveryReceipt } from "./message-receipts";

export function humanizeShipmentStatus(status: string): string {
  switch (status) {
    case "ORDER_CONFIRMED":
      return "Order Confirmed (Queued for Workshop)";
    case "IN_PRODUCTION":
      return "In Production / Fabrication";
    case "READY_FOR_DISPATCH":
      return "Ready & Packed for Dispatch";
    case "DISPATCHED":
      return "Dispatched via Courier";
    case "IN_TRANSIT":
      return "In Transit";
    case "OUT_FOR_DELIVERY":
      return "Out for Delivery Today";
    case "DELIVERED":
      return "Delivered";
    default:
      return status.replace(/_/g, " ");
  }
}

export function formatOrderStatusWhatsAppMessage(order: OrderTrackingRecord): string {
  const lines = [
    `*Order Status: #${order.orderId}* (${order.brandLabel})`,
    `• *Current Stage:* ${humanizeShipmentStatus(order.shipmentStatus)}`,
  ];
  if (order.itemsSummary) {
    lines.push(`• *Items:* ${order.itemsSummary}`);
  }
  if (order.providerName && order.providerCode !== "WORKSHOP") {
    lines.push(
      `• *Courier:* ${order.providerName}${order.awbNumber ? ` (AWB: *${order.awbNumber}*)` : ""}`
    );
  }
  if (order.estimatedDelivery) {
    lines.push(`• *Expected Delivery:* ${order.estimatedDelivery}`);
  }
  lines.push(``, `Live Tracking Link:\n${order.publicTrackingUrl}`);
  return formatWhatsAppOutboundText(lines.join("\n"));
}

export function extractOrderLookupCandidate(rawText: string): {
  explicitOrderId: string | null;
  asksAboutOrder: boolean;
} {
  const trimmed = rawText.trim();
  const lower = trimmed.toLowerCase();

  // Match branded order numbers like CC-1089, CC-ABC123, CE53-401, CE-202, ORD-991, or #CC1089
  const brandedMatch = trimmed.match(
    /\b((?:CC|CE53|CE|ORD)-[A-Z0-9-]{3,18})\b/i
  );
  if (brandedMatch?.[1]) {
    return { explicitOrderId: brandedMatch[1].toUpperCase(), asksAboutOrder: true };
  }

  // Match "order #12345" or "order id: ABC123"
  const labeledMatch = trimmed.match(
    /\b(?:order\s*(?:id|no|number|#)|awb|docket|lr\s*no)\s*[:#-]?\s*([A-Z0-9-]{4,22})\b/i
  );
  if (labeledMatch?.[1] && /\d/.test(labeledMatch[1])) {
    return { explicitOrderId: labeledMatch[1].toUpperCase(), asksAboutOrder: true };
  }

  // Match standalone "#10482" or standalone short code if user only typed an order token
  const hashMatch = trimmed.match(/^#?([A-Z]{0,4}-?\d{4,14}|[A-Z0-9]{6,10})$/i);
  if (
    hashMatch?.[1] &&
    /\d/.test(hashMatch[1]) &&
    !/^\d{10}$/.test(hashMatch[1]) // don't confuse a 10-digit Indian mobile number with an order ID
  ) {
    return { explicitOrderId: hashMatch[1].toUpperCase(), asksAboutOrder: true };
  }

  const asksAboutOrder =
    /\b(where\s+is\s+my\s+order|order\s+status|track\s+(?:my\s+)?order|dispatch\s+status|delivery\s+status|shipment\s+status|tracking\s+link|check\s+my\s+order)\b/i.test(
      lower
    );

  return { explicitOrderId: null, asksAboutOrder };
}

/**
 * Direct Order ID and Order Status Ecosystem Lookup (:3002, :3003, :3007).
 * Runs BEFORE ACRIO with 0 AI credits whenever customer asks order status.
 */
export async function handleDirectOrderLookupIfApplicable(params: {
  conversationId: string;
  customerPhone: string;
  inboundText: string;
  isHandledByAcrio: boolean;
}): Promise<boolean> {
  const orderDetection = extractOrderLookupCandidate(params.inboundText);
  if (
    !params.isHandledByAcrio ||
    (!orderDetection.explicitOrderId && !orderDetection.asksAboutOrder)
  ) {
    return false;
  }

  const conv = getRawLibSqlClient("conversations");
  const ecosystemLookup = await lookupCustomerOrdersAcrossEcosystem({
    orderInput: orderDetection.explicitOrderId || undefined,
    customerPhone: params.customerPhone,
  });

  const primaryOrder =
    ecosystemLookup.exactMatch ||
    (!orderDetection.explicitOrderId ? ecosystemLookup.phoneOrders[0] : null);

  let orderReply = "";
  let ctaButton: { label: string; url: string; footerText?: string } | undefined;

  if (primaryOrder) {
    orderReply = formatOrderStatusWhatsAppMessage(primaryOrder);
    if (
      !orderDetection.explicitOrderId &&
      ecosystemLookup.phoneOrders.length > 1
    ) {
      const extraLines = ecosystemLookup.phoneOrders
        .slice(1, 4)
        .map(
          (o) =>
            `• *#${o.orderId}* (${humanizeShipmentStatus(o.shipmentStatus)}): ${o.publicTrackingUrl}`
        )
        .join("\n");
      orderReply = `${orderReply}\n\n*Other recent orders on your number:*\n${extraLines}`;
    }
    ctaButton = {
      label: "Track Order",
      url: primaryOrder.publicTrackingUrl,
      footerText: primaryOrder.brandLabel,
    };
  } else if (orderDetection.explicitOrderId) {
    const otherOrdersHint =
      ecosystemLookup.phoneOrders.length > 0
        ? `\n\nHowever, we found ${ecosystemLookup.phoneOrders.length === 1 ? "this order" : "these orders"} linked to your WhatsApp number:\n${ecosystemLookup.phoneOrders
            .slice(0, 3)
            .map(
              (o) =>
                `• *#${o.orderId}* (${humanizeShipmentStatus(o.shipmentStatus)}): ${o.publicTrackingUrl}`
            )
            .join("\n")}`
        : "";
    orderReply = formatWhatsAppOutboundText(
      `I checked Classic Concepts and Classic Edge 53 for order *#${orderDetection.explicitOrderId}*, and could not find a matching dispatch record under that ID yet.${otherOrdersHint}\n\nPlease double-check the Order ID on your invoice/confirmation email, or reply *"talk to team"* and our dispatch desk will verify it for you right away.`
    );
    ctaButton = {
      label: "Track Order",
      url: resolvePublicTrackingOrigin(),
      footerText: "Classic Concepts & Classic Edge 53",
    };
  } else {
    orderReply = formatWhatsAppOutboundText(
      `Please share your *Order ID* (for example *CC-1089* or *CE53-401*), and I will look up your live production or courier status immediately!\n\nYou can also check anytime on our tracking portal:\n${resolvePublicTrackingOrigin()}`
    );
    ctaButton = {
      label: "Open Tracking",
      url: resolvePublicTrackingOrigin(),
    };
  }

  const sendRes = await sendWhatsAppCloudMessage({
    toPhone: params.customerPhone,
    bodyText: orderReply,
    ctaButton,
    simulateAsyncDelivery: true,
  });
  const orderMsgId = `msg_ord_${crypto.randomUUID().slice(0, 8)}`;
  const replyIso = new Date().toISOString();
  await conv.batch(
    [
      {
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, wa_message_id, delivery_status, created_at
        ) VALUES (?, ?, 'OUTBOUND', 'AUTOMATION', 'Order Tracker', 'TEXT', 'FREE_CHAT', ?, ?, ?, ?)`,
        args: [
          orderMsgId,
          params.conversationId,
          orderReply,
          sendRes.waMessageId,
          sendRes.deliveryStatus,
          replyIso,
        ],
      },
      {
        sql: `UPDATE conversations
              SET smart_category = 'Order & Delivery',
                  unread_count = 0,
                  waiting_since = NULL,
                  last_message_preview = ?,
                  last_message_at = ?
              WHERE id = ?`,
        args: [orderReply.slice(0, 140), replyIso, params.conversationId],
      },
    ],
    "write"
  );
  if (sendRes.ok && sendRes.mode === "SANDBOX_SIMULATOR") {
    scheduleSandboxDeliveryReceipt({
      conversationId: params.conversationId,
      messageId: orderMsgId,
      waMessageId: sendRes.waMessageId,
    });
  }
  socketHub.emit("message:new", {
    conversationId: params.conversationId,
    senderName: "Order Tracker",
    text: orderReply,
  });
  return true;
}
