import crypto from "node:crypto";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { formatWhatsAppOutboundText, sendWhatsAppCloudMessage } from "@cc/connections";
import { socketHub } from "@cc/sockets";
import { scheduleSandboxDeliveryReceipt } from "./message-receipts";
import { extractOrderLookupCandidate } from "./order-lookup-flow";
import { smartAssignConversation } from "./routing-and-escalation";
import { getCurrentIstDateAndTime } from "./time-ist";

export function matchAutomationTrigger(params: {
  triggerType: string;
  triggerCondition: string;
  inboundText: string;
  isNewConversation?: boolean;
  buttonPayload?: string;
}): boolean {
  const tType = String(params.triggerType || "").toUpperCase();
  const rawCond = String(params.triggerCondition || "").trim();
  const condLower = rawCond.toLowerCase();
  const textTrimmed = String(params.inboundText || "").trim();
  const lower = textTrimmed.toLowerCase();

  if (tType === "FIRST_CONTACT") {
    return Boolean(params.isNewConversation);
  }
  if (tType === "OUT_OF_HOURS_IST") {
    const { hour } = getCurrentIstDateAndTime();
    // Outside 9:30 AM - 7:30 PM IST -> hour < 9 or hour >= 20
    return hour < 9 || hour >= 20;
  }
  if (tType === "ORDER_INQUIRY") {
    const det = extractOrderLookupCandidate(textTrimmed);
    return Boolean(det.explicitOrderId || det.asksAboutOrder);
  }
  if (tType === "BUTTON_PAYLOAD" && condLower) {
    const targetPayload = (params.buttonPayload || lower).toLowerCase();
    return condLower
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .some((w) => targetPayload === w || lower === w);
  }
  if (tType === "EXACT" && condLower) {
    return condLower
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .some((w) => lower === w);
  }
  if (tType === "REGEX" && rawCond) {
    try {
      const rx = new RegExp(rawCond, "i");
      return rx.test(textTrimmed);
    } catch {
      return false;
    }
  }
  if ((tType === "KEYWORD" || tType === "CONTAINS") && condLower) {
    const words = condLower
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
    return words.some((w) => lower.includes(w));
  }
  return false;
}

export async function evaluateAutomationRulesDryRun(params: {
  sampleText: string;
  isNewConversation?: boolean;
  buttonPayload?: string;
}): Promise<{
  orderLookupDetected: { explicitOrderId: string | null; asksAboutOrder: boolean };
  matchedRules: {
    id: string;
    name: string;
    triggerType: string;
    actionType: string;
    stopFurtherAi: boolean;
    simulatedReply?: string;
    assignedTeamId?: string;
    smartCategory?: string;
  }[];
  wouldInvokeAcrioAi: boolean;
}> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const rulesRes = await conv.execute(
    `SELECT id, name, trigger_type, trigger_condition, action_type, action_payload_json
     FROM automations
     WHERE is_enabled = 1
     ORDER BY COALESCE(priority_order, 100) ASC, created_at ASC`
  );

  const orderLookupDetected = extractOrderLookupCandidate(params.sampleText);
  const matchedRules: {
    id: string;
    name: string;
    triggerType: string;
    actionType: string;
    stopFurtherAi: boolean;
    simulatedReply?: string;
    assignedTeamId?: string;
    smartCategory?: string;
  }[] = [];

  let stoppedAi = Boolean(
    orderLookupDetected.explicitOrderId || orderLookupDetected.asksAboutOrder
  );

  for (const r of rulesRes.rows) {
    const triggerType = String(r.trigger_type || "");
    const triggerCondition = String(r.trigger_condition || "");
    if (
      !matchAutomationTrigger({
        triggerType,
        triggerCondition,
        inboundText: params.sampleText,
        isNewConversation: params.isNewConversation,
        buttonPayload: params.buttonPayload,
      })
    ) {
      continue;
    }
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(String(r.action_payload_json || "{}"));
    } catch {
      payload = {};
    }
    const actionType = String(r.action_type || "");
    const stopFurtherAi =
      actionType === "AUTO_REPLY" ||
      actionType === "ASSIGN_TEAM" ||
      actionType === "AUTO_ASSIGN" ||
      actionType === "OPT_OUT"
        ? payload.stopFurtherAi !== false
        : Boolean(payload.stopFurtherAi);

    if (stopFurtherAi) stoppedAi = true;

    matchedRules.push({
      id: String(r.id),
      name: String(r.name),
      triggerType,
      actionType,
      stopFurtherAi,
      simulatedReply: payload.replyText ? String(payload.replyText) : undefined,
      assignedTeamId: payload.teamId ? String(payload.teamId) : undefined,
      smartCategory: payload.smartCategory
        ? String(payload.smartCategory)
        : undefined,
    });
  }

  return {
    orderLookupDetected,
    matchedRules,
    wouldInvokeAcrioAi: !stoppedAi,
  };
}

export async function performCustomerOptOut(params: {
  conversationId: string;
  customerPhone: string;
  reasonLabel: string;
}): Promise<void> {
  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const contacts = getRawLibSqlClient("contacts");
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();

  await Promise.all([
    crm.execute({
      sql: `UPDATE customers SET opt_in_marketing = 0, last_interaction_at = ? WHERE phone = ?`,
      args: [nowIso, params.customerPhone],
    }),
    contacts
      .execute({
        sql: `UPDATE contacts SET opt_in_marketing = 0, opt_out_reason = ?, updated_at = ? WHERE phone = ?`,
        args: [params.reasonLabel, nowIso, params.customerPhone],
      })
      .catch(() => {}),
    mkt.execute({
      sql: `UPDATE broadcast_recipients
            SET status = 'SKIPPED',
                skip_or_error_reason = ?
            WHERE customer_phone = ? AND status = 'QUEUED'`,
      args: [params.reasonLabel, params.customerPhone],
    }),
  ]);

  const confirmBody =
    "You have been removed from our promotional messages. You can still message us here anytime for orders or support.";
  const sendRes = await sendWhatsAppCloudMessage({
    toPhone: params.customerPhone,
    bodyText: confirmBody,
    simulateAsyncDelivery: true,
  });
  const optOutMsgId = `msg_optout_${crypto.randomUUID().slice(0, 8)}`;
  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, direction, sender_type, sender_name, message_type,
      billing_category, body, wa_message_id, delivery_status, created_at
    ) VALUES (?, ?, 'OUTBOUND', 'AUTOMATION', 'Opt-Out Protection', 'TEXT', 'FREE_CHAT', ?, ?, ?, ?)`,
    args: [
      optOutMsgId,
      params.conversationId,
      confirmBody,
      sendRes.waMessageId,
      sendRes.deliveryStatus,
      nowIso,
    ],
  });
  if (sendRes.ok && sendRes.mode === "SANDBOX_SIMULATOR") {
    scheduleSandboxDeliveryReceipt({
      conversationId: params.conversationId,
      messageId: optOutMsgId,
      waMessageId: sendRes.waMessageId,
    });
  }
  socketHub.emit("message:new", {
    conversationId: params.conversationId,
    senderName: "Opt-Out Protection",
    text: confirmBody,
  });
}

/**
 * Evaluates and executes enabled automation rules (`EXACT`, `CONTAINS`, `REGEX`, `FIRST_CONTACT`, `OUT_OF_HOURS_IST`, etc.).
 * Returns true if the inbound turn was terminated by an opt-out, team assignment, or `stopFurtherAi` rule.
 */
export async function runAutomationRulesForInbound(params: {
  conversationId: string;
  customerPhone: string;
  inboundText: string;
  isNewConversation: boolean;
  buttonPayload?: string;
  isHandledByAcrio: boolean;
  hasInboundMediaAttachment: boolean;
  nowIso: string;
}): Promise<boolean> {
  const conv = getRawLibSqlClient("conversations");
  const rulesRes = await conv.execute(
    `SELECT id, name, trigger_type, trigger_condition, action_type, action_payload_json
     FROM automations
     WHERE is_enabled = 1
     ORDER BY COALESCE(priority_order, 100) ASC, created_at ASC`
  );

  for (const r of rulesRes.rows) {
    const triggerType = String(r.trigger_type || "");
    const triggerCondition = String(r.trigger_condition || "");
    const actionType = String(r.action_type || "");
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(String(r.action_payload_json || "{}"));
    } catch {
      payload = {};
    }

    const matched = matchAutomationTrigger({
      triggerType,
      triggerCondition,
      inboundText: params.inboundText,
      isNewConversation: params.isNewConversation,
      buttonPayload: params.buttonPayload,
    });

    if (!matched) continue;
    // Never let a generic FIRST_CONTACT greeting intercept an inbound photo, PDF, document, video, or voice note!
    if (
      triggerType === "FIRST_CONTACT" &&
      actionType === "AUTO_REPLY" &&
      params.hasInboundMediaAttachment
    ) {
      continue;
    }

    await conv.execute({
      sql: `UPDATE automations SET runs_count = runs_count + 1, last_triggered_at = ? WHERE id = ?`,
      args: [params.nowIso, String(r.id)],
    });

    if (actionType === "OPT_OUT") {
      await performCustomerOptOut({
        conversationId: params.conversationId,
        customerPhone: params.customerPhone,
        reasonLabel: `Rule: ${String(r.name)}`,
      });
      return true;
    }

    if (actionType === "SMART_TAG") {
      await conv.execute({
        sql: `UPDATE conversations
              SET smart_category = COALESCE(?, smart_category),
                  priority = COALESCE(?, priority)
              WHERE id = ?`,
        args: [
          payload.smartCategory ? String(payload.smartCategory) : null,
          payload.priority ? String(payload.priority) : null,
          params.conversationId,
        ],
      });
    } else if (
      (actionType === "ASSIGN_TEAM" || actionType === "AUTO_ASSIGN") &&
      (params.isHandledByAcrio || payload.forceReassign === true)
    ) {
      if (payload.replyText && String(payload.replyText).trim()) {
        const replyBody = formatWhatsAppOutboundText(String(payload.replyText));
        const sendRes = await sendWhatsAppCloudMessage({
          toPhone: params.customerPhone,
          bodyText: replyBody,
          simulateAsyncDelivery: true,
        });
        const msgId = `msg_rule_${crypto.randomUUID().slice(0, 8)}`;
        await conv.execute({
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, wa_message_id, delivery_status, created_at
          ) VALUES (?, ?, 'OUTBOUND', 'AUTOMATION', ?, 'TEXT', 'FREE_CHAT', ?, ?, ?, ?)`,
          args: [
            msgId,
            params.conversationId,
            String(r.name),
            replyBody,
            sendRes.waMessageId,
            sendRes.deliveryStatus,
            params.nowIso,
          ],
        });
      }
      await smartAssignConversation({
        conversationId: params.conversationId,
        inboundText: params.inboundText,
        preferredTeamId: payload.teamId ? String(payload.teamId) : "team_sales",
        onlyIfUnassigned: false,
        startWaitingTimer: true,
        triggeredByName: `Auto-Rule (${String(r.name)})`,
        handoffReasonFromAcrio: `Matched routing rule "${String(r.name)}"`,
      });
      return true;
    } else if (actionType === "AUTO_REPLY" && payload.replyText) {
      const stopFurtherAi = payload.stopFurtherAi !== false;
      // Fire auto-reply when either stopFurtherAi is enabled (replaces AI to save credits!) or chat is not on ACRIO
      if (stopFurtherAi || !params.isHandledByAcrio) {
        const replyBody = formatWhatsAppOutboundText(String(payload.replyText));
        const sendRes = await sendWhatsAppCloudMessage({
          toPhone: params.customerPhone,
          bodyText: replyBody,
          ctaButton:
            payload.ctaUrl && /^https?:\/\//i.test(String(payload.ctaUrl))
              ? {
                  label: String(payload.ctaLabel || "Open Link"),
                  url: String(payload.ctaUrl),
                }
              : undefined,
          simulateAsyncDelivery: true,
        });
        const msgId = `msg_${crypto.randomUUID().slice(0, 8)}`;
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
                String(r.name),
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
                        last_message_preview = ?,
                        last_message_at = ?
                    WHERE id = ?`,
              args: [
                payload.smartCategory ? String(payload.smartCategory) : null,
                payload.priority ? String(payload.priority) : null,
                replyBody.slice(0, 140),
                params.nowIso,
                params.conversationId,
              ],
            },
          ],
          "write"
        );
        if (sendRes.ok && sendRes.mode === "SANDBOX_SIMULATOR") {
          scheduleSandboxDeliveryReceipt({
            conversationId: params.conversationId,
            messageId: msgId,
            waMessageId: sendRes.waMessageId,
          });
        }
        socketHub.emit("message:new", {
          conversationId: params.conversationId,
          senderName: String(r.name),
          text: replyBody,
        });
        if (stopFurtherAi) {
          return true;
        }
      }
    }
  }

  return false;
}
