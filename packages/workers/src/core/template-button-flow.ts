import crypto from "node:crypto";
import {
  getRawLibSqlClient,
  lookupCustomerOrdersAcrossEcosystem,
  resolvePublicTrackingOrigin,
} from "@cc/database";
import {
  formatWhatsAppOutboundText,
  runGuardedButtonFlowAiReply,
  sendWhatsAppCloudMessage,
  type WhatsAppTemplateButton,
} from "@cc/connections";
import { socketHub } from "@cc/sockets";
import { performCustomerOptOut } from "./automations-engine";
import { recordDualPricingLedgerEntry, type BillingMessageCategory } from "./billing-ledger";
import { formatOrderStatusWhatsAppMessage } from "./order-lookup-flow";
import { smartAssignConversation } from "./routing-and-escalation";

/**
 * Template Quick-Reply Button Flow Engine (runs BEFORE ACRIO).
 * Returns true if the inbound turn was handled deterministically.
 */
export async function handleTemplateButtonFlow(params: {
  conversationId: string;
  customerPhone: string;
  inboundText: string;
  isButtonClick?: boolean;
  buttonPayload?: string;
  buttonText?: string;
  replyToWaMessageId?: string;
  convRow: Record<string, unknown>;
  nowIso: string;
}): Promise<boolean> {
  const conv = getRawLibSqlClient("conversations");
  const mkt = getRawLibSqlClient("marketing");
  const clickedText = (params.buttonText || params.inboundText || "").trim();
  let matchedTemplateRow: Record<string, unknown> | undefined;
  let matchedButton: WhatsAppTemplateButton | undefined;

  // Check if customer replied directly to a specific outbound TEMPLATE message (via context.id) or recent template in last 72h
  const tplMsgRes = params.replyToWaMessageId
    ? await conv.execute({
        sql: `SELECT template_name, body, created_at FROM messages
              WHERE conversation_id = ? AND wa_message_id = ? AND message_type = 'TEMPLATE'
              LIMIT 1`,
        args: [params.conversationId, params.replyToWaMessageId],
      })
    : await conv.execute({
        sql: `SELECT template_name, body, created_at FROM messages
              WHERE conversation_id = ? AND direction = 'OUTBOUND' AND message_type = 'TEMPLATE'
              ORDER BY created_at DESC LIMIT 1`,
        args: [params.conversationId],
      });

  const recentTplMsg = tplMsgRes.rows[0] as Record<string, unknown> | undefined;
  if (recentTplMsg?.template_name) {
    const tplAgeHours =
      (Date.now() - new Date(String(recentTplMsg.created_at || 0)).getTime()) /
      3600000;
    if (params.isButtonClick || params.replyToWaMessageId || tplAgeHours <= 72) {
      const tplDbRes = await mkt.execute({
        sql: `SELECT * FROM templates WHERE name = ? LIMIT 1`,
        args: [String(recentTplMsg.template_name)],
      });
      if (tplDbRes.rows[0]) {
        matchedTemplateRow = tplDbRes.rows[0] as Record<string, unknown>;
        try {
          const parsedBtns: WhatsAppTemplateButton[] = JSON.parse(
            String(matchedTemplateRow.buttons_json || "[]")
          );
          matchedButton = parsedBtns.find(
            (b) =>
              b.type === "QUICK_REPLY" &&
              (b.text.trim().toLowerCase() === clickedText.toLowerCase() ||
                (params.buttonPayload &&
                  b.id.toLowerCase() === params.buttonPayload.toLowerCase()))
          );
        } catch {
          matchedButton = undefined;
        }
      }
    }
  }

  if (!matchedButton && !params.isButtonClick) {
    return false;
  }

  const btnLabel = matchedButton?.text || clickedText;
  const flow = matchedButton?.flowAction;
  let effectiveAction = flow?.actionType || "NONE";

  // Smart zero-credit default action when a Quick Reply button has no explicit flow configured yet
  if (effectiveAction === "NONE" && (matchedButton || params.isButtonClick)) {
    if (/stop|opt\s*out|unsubscribe/i.test(btnLabel)) {
      effectiveAction = "OPT_OUT_DND";
    } else if (/track|order\s*status|where\s*is/i.test(btnLabel)) {
      effectiveAction = "SEND_ORDER_TRACKING";
    } else if (/view\s*catalog|browse\s*catalog|catalogue/i.test(btnLabel)) {
      const catalogMsg = formatWhatsAppOutboundText(
        `Here are our full product websites:\n\n• *Classic Concepts* (Acrylic Podiums, Stands, Trophies, Furniture, Signages): https://classicconcepts.in\n• *Classic Edge 53* (Polishing & Bending Machines, Diamond Tools & Hardware): https://classicedge.in\n\nTell me which category or model you are looking for and I will share pricing and details right away.`
      );
      const catSend = await sendWhatsAppCloudMessage({
        toPhone: params.customerPhone,
        bodyText: catalogMsg,
        simulateAsyncDelivery: true,
      });
      await conv
        .execute({
          sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, wa_message_id, delivery_status, created_at)
                VALUES (?, ?, 'OUTBOUND', 'AUTOMATION', 'Template Flow (View Catalog)', 'TEXT', 'FREE_CHAT', ?, ?, ?, ?)`,
          args: [
            `msg_cat_${crypto.randomUUID().slice(0, 8)}`,
            params.conversationId,
            catalogMsg,
            catSend.waMessageId,
            catSend.deliveryStatus,
            params.nowIso,
          ],
        })
        .catch(() => {});
      socketHub.emit("message:new", {
        conversationId: params.conversationId,
        senderName: "Template Flow (View Catalog)",
        text: catalogMsg,
      });
      return true;
    } else if (/sales|talk|speak|call|quote|team|support|agent|book/i.test(btnLabel)) {
      effectiveAction = "ASSIGN_TEAM";
    } else if (flow?.replyText?.trim()) {
      effectiveAction = "AUTO_REPLY";
    }
  }

  if (effectiveAction === "OPT_OUT_DND") {
    await performCustomerOptOut({
      conversationId: params.conversationId,
      customerPhone: params.customerPhone,
      reasonLabel: `Clicked Quick Reply "${btnLabel}"`,
    });
    return true;
  }

  if (effectiveAction === "SEND_ORDER_TRACKING") {
    const lookup = await lookupCustomerOrdersAcrossEcosystem({
      customerPhone: params.customerPhone,
    });
    const latestOrder = lookup.exactMatch || lookup.phoneOrders[0] || null;
    const bodyText = latestOrder
      ? formatOrderStatusWhatsAppMessage(latestOrder)
      : formatWhatsAppOutboundText(
          `Please reply with your *Order ID* (for example *CC-1089* or *CE53-401*), and I will pull up your live dispatch status and tracking link right away.\n\nYou can also track anytime at:\n${resolvePublicTrackingOrigin()}`
        );
    const sendRes = await sendWhatsAppCloudMessage({
      toPhone: params.customerPhone,
      bodyText,
      ctaButton: latestOrder
        ? {
            label: "Track Order",
            url: latestOrder.publicTrackingUrl,
            footerText: latestOrder.brandLabel,
          }
        : undefined,
      simulateAsyncDelivery: true,
    });
    const msgId = `msg_flow_${crypto.randomUUID().slice(0, 8)}`;
    await conv.batch(
      [
        {
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, wa_message_id, delivery_status, created_at
          ) VALUES (?, ?, 'OUTBOUND', 'AUTOMATION', ?, 'TEXT', 'FREE_CHAT', ?, ?, ?, ?)`,
          args: [
            msgId,
            params.conversationId,
            `Template Flow (${btnLabel})`,
            bodyText,
            sendRes.waMessageId,
            sendRes.deliveryStatus,
            params.nowIso,
          ],
        },
        {
          sql: `UPDATE conversations
                SET smart_category = 'Order & Delivery',
                    unread_count = 0,
                    last_message_preview = ?,
                    last_message_at = ?
                WHERE id = ?`,
          args: [bodyText.slice(0, 140), params.nowIso, params.conversationId],
        },
      ],
      "write"
    );
    socketHub.emit("message:new", {
      conversationId: params.conversationId,
      senderName: `Template Flow (${btnLabel})`,
      text: bodyText,
    });
    return true;
  }

  if (effectiveAction === "ASSIGN_TEAM") {
    const ackReply = formatWhatsAppOutboundText(
      flow?.replyText?.trim() ||
        `Got your selection (*${btnLabel}*). I am connecting you to our *Sales Team* right now so a specialist can help you directly.`
    );
    const sendRes = await sendWhatsAppCloudMessage({
      toPhone: params.customerPhone,
      bodyText: ackReply,
      ctaButton:
        flow?.ctaUrl && /^https?:\/\//i.test(flow.ctaUrl)
          ? { label: flow.ctaLabel || "View Details", url: flow.ctaUrl }
          : undefined,
      simulateAsyncDelivery: true,
    });
    const msgId = `msg_flow_${crypto.randomUUID().slice(0, 8)}`;
    await conv.batch(
      [
        {
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, wa_message_id, delivery_status, created_at
          ) VALUES (?, ?, 'OUTBOUND', 'AUTOMATION', ?, 'TEXT', 'FREE_CHAT', ?, ?, ?, ?)`,
          args: [
            msgId,
            params.conversationId,
            `Template Flow (${btnLabel})`,
            ackReply,
            sendRes.waMessageId,
            sendRes.deliveryStatus,
            params.nowIso,
          ],
        },
        {
          sql: `UPDATE conversations
                SET smart_category = COALESCE(?, smart_category),
                    priority = COALESCE(?, priority),
                    last_message_preview = ?,
                    last_message_at = ?
                WHERE id = ?`,
          args: [
            flow?.smartCategory || null,
            flow?.priority || "HIGH",
            ackReply.slice(0, 140),
            params.nowIso,
            params.conversationId,
          ],
        },
      ],
      "write"
    );
    await smartAssignConversation({
      conversationId: params.conversationId,
      inboundText: btnLabel,
      preferredTeamId: flow?.teamId || "team_sales",
      onlyIfUnassigned: false,
      startWaitingTimer: true,
      triggeredByName: `Template Button (${btnLabel})`,
      handoffReasonFromAcrio: `Customer tapped template quick reply "${btnLabel}"`,
    });
    socketHub.emit("message:new", {
      conversationId: params.conversationId,
      senderName: `Template Flow (${btnLabel})`,
      text: ackReply,
    });
    return true;
  }

  if (effectiveAction === "AUTO_REPLY" && flow?.replyText?.trim()) {
    const replyBody = formatWhatsAppOutboundText(flow.replyText.trim());
    const sendRes = await sendWhatsAppCloudMessage({
      toPhone: params.customerPhone,
      bodyText: replyBody,
      ctaButton:
        flow.ctaUrl && /^https?:\/\//i.test(flow.ctaUrl)
          ? { label: flow.ctaLabel || "Open Link", url: flow.ctaUrl }
          : undefined,
      simulateAsyncDelivery: true,
    });
    const msgId = `msg_flow_${crypto.randomUUID().slice(0, 8)}`;
    await conv.batch(
      [
        {
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, wa_message_id, delivery_status, created_at
          ) VALUES (?, ?, 'OUTBOUND', 'AUTOMATION', ?, 'TEXT', 'FREE_CHAT', ?, ?, ?, ?)`,
          args: [
            msgId,
            params.conversationId,
            `Template Flow (${btnLabel})`,
            replyBody,
            sendRes.waMessageId,
            sendRes.deliveryStatus,
            params.nowIso,
          ],
        },
        {
          sql: `UPDATE conversations
                SET smart_category = COALESCE(?, smart_category),
                    priority = COALESCE(?, priority),
                    unread_count = 0,
                    last_message_preview = ?,
                    last_message_at = ?
                WHERE id = ?`,
          args: [
            flow.smartCategory || null,
            flow.priority || null,
            replyBody.slice(0, 140),
            params.nowIso,
            params.conversationId,
          ],
        },
      ],
      "write"
    );
    socketHub.emit("message:new", {
      conversationId: params.conversationId,
      senderName: `Template Flow (${btnLabel})`,
      text: replyBody,
    });
    return true;
  }

  if (effectiveAction === "SEND_APPROVED_TEMPLATE" && flow?.templateName) {
    const targetTplRes = await mkt.execute({
      sql: `SELECT * FROM templates WHERE name = ? AND approval_status = 'APPROVED' LIMIT 1`,
      args: [flow.templateName],
    });
    const targetTpl = targetTplRes.rows[0] as Record<string, unknown> | undefined;
    if (targetTpl) {
      const tplBody = String(targetTpl.body_text || "");
      const tplCat = String(targetTpl.category || "UTILITY") as BillingMessageCategory;
      const sendRes = await sendWhatsAppCloudMessage({
        toPhone: params.customerPhone,
        bodyText: tplBody,
        templateName: String(targetTpl.name),
        languageCode: String(targetTpl.language || "en"),
        simulateAsyncDelivery: true,
      });
      const msgId = `msg_flowtpl_${crypto.randomUUID().slice(0, 8)}`;
      await conv.execute({
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          template_name, billing_category, body, wa_message_id, delivery_status, created_at
        ) VALUES (?, ?, 'OUTBOUND', 'AUTOMATION', ?, 'TEMPLATE', ?, ?, ?, ?, ?, ?)`,
        args: [
          msgId,
          params.conversationId,
          `Template Flow (${btnLabel})`,
          String(targetTpl.name),
          tplCat,
          tplBody,
          sendRes.waMessageId,
          sendRes.deliveryStatus,
          params.nowIso,
        ],
      });
      if (sendRes.ok) {
        await recordDualPricingLedgerEntry({
          messageId: msgId,
          conversationId: params.conversationId,
          customerPhone: params.customerPhone,
          category: tplCat,
          staffName: `Template Flow (${btnLabel})`,
          deliveryMode: sendRes.mode,
        });
      }
      socketHub.emit("message:new", {
        conversationId: params.conversationId,
        senderName: `Template Flow (${btnLabel})`,
        text: tplBody,
      });
      return true;
    }
  }

  if (effectiveAction === "SMART_AI_WITH_GUARD") {
    const aiReply = await runGuardedButtonFlowAiReply({
      customerName: String(params.convRow.customer_name || params.customerPhone),
      buttonText: btnLabel,
      aiInstruction:
        flow?.aiInstruction ||
        `Answer the customer's button tap "${btnLabel}" concisely and ask 1 practical next step.`,
    });
    const sendRes = await sendWhatsAppCloudMessage({
      toPhone: params.customerPhone,
      bodyText: aiReply,
      simulateAsyncDelivery: true,
    });
    const msgId = `msg_flowai_${crypto.randomUUID().slice(0, 8)}`;
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'ACRIO', 'ACRIO (Button Flow)', 'TEXT', 'ACRIO', ?, ?, ?, ?)`,
      args: [
        msgId,
        params.conversationId,
        aiReply,
        sendRes.waMessageId,
        sendRes.deliveryStatus,
        params.nowIso,
      ],
    });
    if (sendRes.ok) {
      await recordDualPricingLedgerEntry({
        messageId: msgId,
        conversationId: params.conversationId,
        customerPhone: params.customerPhone,
        category: "ACRIO",
        staffName: "ACRIO Button Flow",
        deliveryMode: sendRes.mode,
      });
    }
    socketHub.emit("message:new", {
      conversationId: params.conversationId,
      senderName: "ACRIO (Button Flow)",
      text: aiReply,
    });
    return true;
  }

  return false;
}
