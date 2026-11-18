import crypto from "node:crypto";
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";

const APP_TIMEZONE = "Asia/Kolkata";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  lookupCustomerOrdersAcrossEcosystem,
  normalizeWhatsAppPhone,
  resolveInternalStaffCallerByPhone,
  resolvePublicTrackingOrigin,
  resolveRequestedOrPreferredStaffForInbound,
  type OrderTrackingRecord,
} from "@cc/database";
import {
  buildCallbackSlotInteractive,
  buildTeamConnectInteractive,
  describeInteractiveAsText,
  executeMultiDatabaseBackup,
  extractQuoteRequestDetails,
  formatWhatsAppOutboundText,
  loadConversationAiState,
  runAcrioAutonomousTurn,
  runAcrioStaffWhatsAppAssistant,
  runGuardedButtonFlowAiReply,
  sendQuoteRequestAlertTemplate,
  sendStaffAssignmentEmailNotification,
  sendWhatsAppCloudMessage,
  ACRIO_TEAM_ASK_TEXT,
  type AcrioInteractive,
  type AcrioMediaAttachment,
  type CustomerImageAttachmentInput,
  type WhatsAppTemplateButton,
} from "@cc/connections";
import {
  claimPendingJobs,
  completeJob,
  enqueueJob,
  failJob,
  recordWorkerHeartbeat,
} from "@cc/queue";
import { socketHub } from "@cc/sockets";
export {
  createNotification,
  notifyCallbackRequest,
  requeueStaleStaffNoteJobs,
  runStaffNoteAnswerJob,
} from "./staff-notes";
import { notifyCallbackRequest, requeueStaleStaffNoteJobs, runStaffNoteAnswerJob } from "./staff-notes";
import {
  buildOwnerStaffProfile,
  flushPendingLeadForwards,
  handleOwnerDeskMessage,
  handleStaffDeskMessage,
  isOwnerWhatsAppPhone,
  isStaffGreeting,
} from "./owner-desk";

export type BillingMessageCategory =
  | "MARKETING"
  | "UTILITY"
  | "AUTHENTICATION"
  | "ACRIO";

/**
 * Dual-Ledger Billing Engine:
 * - Regular 24h staff chat messages are FREE (₹0.00) and never recorded here!
 * - Charged ONLY on:
 *   1. ACRIO automated replies (`ACRIO` -> ₹0.30)
 *   2. Templated messages (`MARKETING` -> ₹0.95; `UTILITY` / `AUTHENTICATION` -> ₹0.30)
 * - DEV sees actual Meta / AI cost + exact net margin per message!
 */
export async function recordDualPricingLedgerEntry(params: {
  messageId?: string;
  broadcastId?: string;
  conversationId?: string;
  customerPhone: string;
  category: BillingMessageCategory;
  staffName: string;
}): Promise<{
  clientUnitRateInr: number;
  actualMetaUnitCostInr: number;
  marginInr: number;
}> {
  await ensureDatabasesBootstrapped();
  const bill = getRawLibSqlClient("billing_ops");

  const cfgRes = await bill.execute(
    `SELECT * FROM pricing_config WHERE id = 'default' LIMIT 1`
  );
  const cfg = (cfgRes.rows[0] || {}) as Record<string, unknown>;

  const clientMarketing = Number(cfg.client_marketing_rate_inr ?? 0.95);
  const clientOther = Number(cfg.client_other_rate_inr ?? 0.3);

  const metaMarketing = Number(cfg.actual_meta_marketing_rate_inr ?? 0.7846);
  const metaUtility = Number(cfg.actual_meta_utility_rate_inr ?? 0.115);
  const metaAuth = Number(cfg.actual_meta_auth_rate_inr ?? 0.115);
  const metaAcrio = Number(cfg.actual_meta_service_rate_inr ?? 0.04);

  const clientUnitRateInr =
    params.category === "MARKETING" ? clientMarketing : clientOther;

  let actualMetaUnitCostInr = metaUtility;
  if (params.category === "MARKETING") actualMetaUnitCostInr = metaMarketing;
  else if (params.category === "AUTHENTICATION") actualMetaUnitCostInr = metaAuth;
  else if (params.category === "ACRIO") actualMetaUnitCostInr = metaAcrio;

  const marginInr = Number(
    (clientUnitRateInr - actualMetaUnitCostInr).toFixed(4)
  );

  await bill.execute({
    sql: `INSERT INTO message_billing_ledger (
      id, message_id, broadcast_id, conversation_id, customer_phone,
      category, client_unit_rate_inr, actual_meta_unit_cost_inr, margin_inr, staff_name, billed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `ldg_${crypto.randomUUID().slice(0, 10)}`,
      params.messageId || null,
      params.broadcastId || null,
      params.conversationId || null,
      params.customerPhone,
      params.category,
      clientUnitRateInr,
      actualMetaUnitCostInr,
      marginInr,
      params.staffName,
      new Date().toISOString(),
    ],
  });

  return { clientUnitRateInr, actualMetaUnitCostInr, marginInr };
}

/**
 * Runs inbound ACRIO-first backend handling + smart tagging:
 * 1. Initial assignment is ALWAYS `ACRIO`, which answers product & machine queries automatically.
 * 2. If the customer asks to talk to support/staff OR ACRIO is unable to resolve the query,
 *    ACRIO connects the chat to human staff - defaulting ALWAYS to `Sales Team` (`P0 -> P1 -> P2`).
 * 3. If the chat was already handed over to a human staff member, ACRIO steps aside and starts
 *    the customer wait-time clock (`waiting_since`) so P0 -> P1 -> P2 escalation protects wait time.
 */
function humanizeShipmentStatus(status: string): string {
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

function formatOrderStatusWhatsAppMessage(order: OrderTrackingRecord): string {
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

function extractOrderLookupCandidate(rawText: string): {
  explicitOrderId: string | null;
  asksAboutOrder: boolean;
} {
  const trimmed = rawText.trim();
  const lower = trimmed.toLowerCase();

  // Match branded order numbers like CC-1089,CC-ABC123, CE53-401, CE-202, ORD-991, or #CC1089
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
    `SELECT * FROM automations WHERE is_enabled = 1 ORDER BY COALESCE(priority_order, 100) ASC, created_at ASC`
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

async function performCustomerOptOut(params: {
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
 * Runs inbound deterministic flows BEFORE ACRIO AI so button actions, order lookups,
 * and auto-replies never get hijacked by AI and AI credits stay strictly protected:
 * 1. Opt-Out (`STOP`) Protection
 * 2. Template Quick-Reply Button Flow Manager (`AUTO_REPLY`, `ASSIGN_TEAM`, `SEND_ORDER_TRACKING`, `SEND_APPROVED_TEMPLATE`, `OPT_OUT_DND`, `SMART_AI_WITH_GUARD`)
 * 3. Live Order ID & Order Status Lookup across `:3002`, `:3003`, and `:3007` (0 AI credits)
 * 4. Advanced Auto-Reply Rules Engine (`EXACT`, `CONTAINS`, `REGEX`, `FIRST_CONTACT`, `OUT_OF_HOURS_IST`, `BUTTON_PAYLOAD`)
 * 5. Multi-Turn ACRIO AI Specialist (`claude-haiku-5-5`) when assigned to System (`ACRIO`)
 */
const claimedInboundWaIds = new Set<string>();
const processedAutomationWaIds = new Set<string>();

/**
 * Idempotency guard for inbound Meta WhatsApp message IDs (`wamid.*`).
 * Prevents duplicate message inserts, duplicate ACRIO runs, and duplicate ₹0.30 ledger charges
 * when Meta retries a webhook delivery. Empty IDs (e.g. local simulator calls) always return true.
 */
export async function claimInboundWaMessageId(
  waMessageId?: string | null
): Promise<boolean> {
  const cleanId = String(waMessageId || "").trim();
  if (!cleanId) return true;
  if (claimedInboundWaIds.has(cleanId)) return false;

  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const existing = await conv.execute({
    sql: `SELECT id FROM messages WHERE wa_message_id = ? LIMIT 1`,
    args: [cleanId],
  });
  if (existing.rows.length > 0) {
    claimedInboundWaIds.add(cleanId);
    return false;
  }

  claimedInboundWaIds.add(cleanId);
  return true;
}

export function resetClaimedWaMessageIdsForTest(): void {
  claimedInboundWaIds.clear();
  processedAutomationWaIds.clear();
}

/**
 * Sends one ACRIO reply (plain text, or text with WhatsApp buttons / "View options" list),
 * saves it in the chat, schedules the sandbox receipt and records the billing entry.
 */
async function sendAcrioChatMessage(params: {
  conversationId: string;
  customerPhone: string;
  text: string;
  interactive?: AcrioInteractive;
  mediaAttachments?: AcrioMediaAttachment[];
}): Promise<{
  acrioMsgId: string;
  replyIso: string;
  sendRes: Awaited<ReturnType<typeof sendWhatsAppCloudMessage>>;
}> {
  const conv = getRawLibSqlClient("conversations");
  const interactive = params.interactive;
  const mediaAttachments = params.mediaAttachments || [];

  // Send each product / variant image, video, or PDF catalogue directly as a WhatsApp media message first
  for (const att of mediaAttachments) {
    if (!att.imageUrl || !/^https?:\/\//i.test(att.imageUrl)) continue;
    const mType: "IMAGE" | "VIDEO" | "DOCUMENT" = att.mediaType || "IMAGE";
    const imgSendRes = await sendWhatsAppCloudMessage({
      toPhone: params.customerPhone,
      bodyText: att.caption,
      media: {
        type: mType,
        url: att.imageUrl,
        caption: att.caption,
        fileName: att.fileName || undefined,
        mimeType: att.mimeType || undefined,
      },
      simulateAsyncDelivery: true,
    });
    const imgMsgId = `msg_acrio_med_${crypto.randomUUID().slice(0, 8)}`;
    const imgIso = new Date().toISOString();
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'ACRIO', 'ACRIO', ?, 'ACRIO', ?, ?, ?, ?, ?)`,
      args: [
        imgMsgId,
        params.conversationId,
        mType,
        att.caption,
        JSON.stringify({
          mediaType: mType,
          mediaUrl: att.imageUrl,
          ...(mType === "IMAGE" ? { imageUrl: att.imageUrl } : {}),
          fileName: att.fileName || null,
          filename: att.fileName || null,
          mimeType:
            att.mimeType ||
            (mType === "DOCUMENT"
              ? "application/pdf"
              : mType === "VIDEO"
              ? "video/mp4"
              : "image/jpeg"),
          caption: att.caption,
          productName: att.productName,
          productSlug: att.productSlug,
          variantName: att.variantName || null,
        }),
        imgSendRes.waMessageId,
        imgSendRes.deliveryStatus,
        imgIso,
      ],
    });
    if (imgSendRes.ok && imgSendRes.mode === "SANDBOX_SIMULATOR") {
      scheduleSandboxDeliveryReceipt({
        conversationId: params.conversationId,
        messageId: imgMsgId,
        waMessageId: imgSendRes.waMessageId,
      });
    }
  }

  let sendRes: Awaited<ReturnType<typeof sendWhatsAppCloudMessage>>;

  if (interactive) {
    if (params.text.length <= 1000) {
      sendRes = await sendWhatsAppCloudMessage({
        toPhone: params.customerPhone,
        bodyText: params.text,
        interactive,
        simulateAsyncDelivery: true,
      });
    } else {
      // Buttons and lists only allow ~1000 characters of body text, so send the long text first.
      const first = await sendWhatsAppCloudMessage({
        toPhone: params.customerPhone,
        bodyText: params.text,
        simulateAsyncDelivery: true,
      });
      sendRes = first.ok
        ? await sendWhatsAppCloudMessage({
            toPhone: params.customerPhone,
            bodyText: interactive.promptText || "Please choose an option",
            interactive,
            simulateAsyncDelivery: true,
          })
        : first;
    }
  } else {
    sendRes = await sendWhatsAppCloudMessage({
      toPhone: params.customerPhone,
      bodyText: params.text,
      simulateAsyncDelivery: true,
    });
  }

  const acrioMsgId = `msg_acrio_${crypto.randomUUID().slice(0, 8)}`;
  const replyIso = new Date().toISOString();
  const storedBody = interactive
    ? `${params.text}\n\n[${interactive.kind === "list" ? `List: ${interactive.buttonLabel}` : "Buttons"}]\n${describeInteractiveAsText(interactive)}`
    : params.text;

  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, direction, sender_type, sender_name, message_type,
      billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
    ) VALUES (?, ?, 'OUTBOUND', 'ACRIO', 'ACRIO', 'TEXT', 'ACRIO', ?, ?, ?, ?, ?)`,
    args: [
      acrioMsgId,
      params.conversationId,
      storedBody,
      JSON.stringify(interactive ? { interactive } : {}),
      sendRes.waMessageId,
      sendRes.deliveryStatus,
      replyIso,
    ],
  });

  if (sendRes.ok && sendRes.mode === "SANDBOX_SIMULATOR") {
    scheduleSandboxDeliveryReceipt({
      conversationId: params.conversationId,
      messageId: acrioMsgId,
      waMessageId: sendRes.waMessageId,
    });
  }

  await recordDualPricingLedgerEntry({
    messageId: acrioMsgId,
    conversationId: params.conversationId,
    customerPhone: params.customerPhone,
    category: "ACRIO",
    staffName: "ACRIO Auto-Handler",
  });

  return { acrioMsgId, replyIso, sendRes };
}

const CALLBACK_SLOT_LABELS: Record<string, string> = {
  morning: "Morning (10 AM to 1 PM)",
  afternoon: "Afternoon (2 PM to 5 PM)",
  evening: "Evening (5 PM to 8 PM)",
};

async function ensureCallbackRequestsTable(): Promise<void> {
  const conv = getRawLibSqlClient("conversations");
  await conv.execute(`CREATE TABLE IF NOT EXISTS callback_requests (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_name TEXT NOT NULL DEFAULT '',
    preferred_slot TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PENDING',
    handled_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

export async function listCallbackRequests(status?: string): Promise<Record<string, unknown>[]> {
  await ensureDatabasesBootstrapped();
  await ensureCallbackRequestsTable();
  const conv = getRawLibSqlClient("conversations");
  const res = status
    ? await conv.execute({
        sql: `SELECT * FROM callback_requests WHERE status = ? ORDER BY created_at DESC LIMIT 200`,
        args: [status],
      })
    : await conv.execute(`SELECT * FROM callback_requests ORDER BY created_at DESC LIMIT 200`);
  return res.rows.map((r) => ({ ...(r as Record<string, unknown>) }));
}

/**
 * Handles taps on ACRIO's own buttons ("Chat with team", "Request a callback", slots, "Keep browsing").
 * Returns true when the tap was fully handled. Product taps ("acrio:prod:<slug>", "acrio:more") return false
 * so the normal ACRIO flow answers them.
 */
async function handleAcrioInteractiveReply(params: {
  conversationId: string;
  customerPhone: string;
  payload: string;
  isHandledByAcrio: boolean;
}): Promise<boolean> {
  const payload = params.payload.toLowerCase();
  if (payload.startsWith("acrio:prod:") || payload === "acrio:more") return false;

  const conv = getRawLibSqlClient("conversations");
  const convRes = await conv.execute({
    sql: `SELECT customer_name FROM conversations WHERE id = ? LIMIT 1`,
    args: [params.conversationId],
  });
  const customerName = String(convRes.rows[0]?.customer_name || params.customerPhone);

  const say = async (text: string, interactive?: AcrioInteractive) => {
    const sent = await sendAcrioChatMessage({
      conversationId: params.conversationId,
      customerPhone: params.customerPhone,
      text,
      interactive,
    });
    await conv.execute({
      sql: `UPDATE conversations SET last_message_preview = ?, last_message_at = ?, last_message_direction = 'OUTBOUND', last_message_status = 'SENT' WHERE id = ?`,
      args: [`ACRIO: ${text}`.slice(0, 140), sent.replyIso, params.conversationId],
    });
    socketHub.emit("message:new", {
      conversationId: params.conversationId,
      senderName: "ACRIO",
      text,
    });
  };

  // A human already owns this chat: ignore old ACRIO buttons, except callback slots which are still registered.
  if (!params.isHandledByAcrio && !payload.startsWith("acrio:cb:")) return true;

  if (payload === "acrio:team:ask") {
    await say(ACRIO_TEAM_ASK_TEXT, buildTeamConnectInteractive());
    return true;
  }

  if (payload === "acrio:menu:keep") {
    await say(
      "No problem! Tell me what you would like to see next. You can also type a product code like CCP054."
    );
    return true;
  }

  if (payload === "acrio:team:callback") {
    await say(
      `Sure, we will call you on ${params.customerPhone}.\n\nWhen should we call you?`,
      buildCallbackSlotInteractive()
    );
    return true;
  }

  if (payload === "acrio:team:chat") {
    await say(
      "Connecting you to our *Sales Team* right away.\n\nA team member will pick up this chat and reply here shortly."
    );
    const assigned = await smartAssignConversation({
      conversationId: params.conversationId,
      inboundText: "Customer chose Chat with team",
      preferredTeamId: "team_sales",
      onlyIfUnassigned: false,
      startWaitingTimer: true,
      handoffReasonFromAcrio: "Customer tapped 'Chat with team' in WhatsApp.",
    });
    socketHub.emit("conversation:assigned", {
      conversationId: params.conversationId,
      assignedTeamName: assigned.assignedTeamName,
      assignedStaffName: assigned.assignedStaffName,
      escalationLevel: assigned.escalationLevel,
    });
    return true;
  }

  if (payload.startsWith("acrio:cb:")) {
    const slotKey = payload.replace("acrio:cb:", "");
    const slotLabel = CALLBACK_SLOT_LABELS[slotKey] || slotKey;
    await ensureCallbackRequestsTable();
    const nowIso = new Date().toISOString();

    // What was the customer looking at? Use the saved chat memory for a helpful note to the team.
    const aiState = await loadConversationAiState(params.conversationId).catch(() => null);
    const topic =
      aiState?.focusProductSlug?.replace(/-/g, " ") ||
      aiState?.primaryProductQuery ||
      "General enquiry";

    // One open request per chat: update it instead of creating duplicates.
    const existing = await conv.execute({
      sql: `SELECT id FROM callback_requests WHERE conversation_id = ? AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1`,
      args: [params.conversationId],
    });
    let requestId = existing.rows[0] ? String(existing.rows[0].id) : "";
    if (requestId) {
      await conv.execute({
        sql: `UPDATE callback_requests SET preferred_slot = ?, topic = ?, updated_at = ? WHERE id = ?`,
        args: [slotLabel, topic, nowIso, requestId],
      });
    } else {
      requestId = `cb_${crypto.randomUUID().slice(0, 8)}`;
      await conv.execute({
        sql: `INSERT INTO callback_requests (id, conversation_id, customer_phone, customer_name, preferred_slot, topic, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
        args: [requestId, params.conversationId, params.customerPhone, customerName, slotLabel, topic, nowIso, nowIso],
      });
    }

    // Ping the internal team without moving the chat away from ACRIO.
    const pingBody = `CALLBACK REQUEST: ${customerName} (${params.customerPhone}) wants a call in the ${slotLabel}. Interested in: ${topic}. Request ID ${requestId}.`;
    await conv
      .execute({
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, delivery_status, created_at
        ) VALUES (?, ?, 'INTERNAL', 'SYSTEM', 'ACRIO • Callback Request', 'INTERNAL_NOTE', 'FREE', ?, 'DELIVERED', ?)`,
        args: [`msg_cb_${crypto.randomUUID().slice(0, 8)}`, params.conversationId, pingBody, nowIso],
      })
      .catch(() => {});
    await conv
      .execute({
        sql: `UPDATE conversations
              SET priority = 'HIGH',
                  assigned_team_id = NULL,
                  assigned_team_name = 'System (ACRIO) • Callback requested',
                  unread_count = unread_count + 1
              WHERE id = ?`,
        args: [params.conversationId],
      })
      .catch(() => {});
    socketHub.emit("message:new", {
      conversationId: params.conversationId,
      senderName: "ACRIO • Callback Request",
      text: pingBody,
    });
    socketHub.emit("callback:new", {
      conversationId: params.conversationId,
      customerName,
      customerPhone: params.customerPhone,
      slot: slotLabel,
    });
    if (!existing.rows[0]) {
      // Brand new request: tell the sales team (bell, email, optional WhatsApp).
      void notifyCallbackRequest({
        conversationId: params.conversationId,
        customerName,
        customerPhone: params.customerPhone,
        slot: slotLabel,
        topic,
        requestId,
      });
    }

    await say(
      `Done! Your callback is booked for *${slotLabel}*.\n\nOur team will call you on ${params.customerPhone}. Until then, I am right here if you want to look at anything else.`
    );
    return true;
  }

  return false;
}

const gInboundState = globalThis as unknown as {
  __ccInboundSeqMap?: Map<string, number>;
  __ccInboundLockMap?: Map<string, Promise<void>>;
};
const inboundTurnSeqMap = (gInboundState.__ccInboundSeqMap ??= new Map<string, number>());
const conversationWorkerLockMap = (gInboundState.__ccInboundLockMap ??= new Map<string, Promise<void>>());

async function withConversationWorkerLock<T>(
  conversationId: string,
  task: () => Promise<T>
): Promise<T> {
  const prev = conversationWorkerLockMap.get(conversationId) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.catch(() => {}).then(() => next);
  conversationWorkerLockMap.set(conversationId, chained);
  await prev.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (conversationWorkerLockMap.get(conversationId) === chained) {
      conversationWorkerLockMap.delete(conversationId);
    }
  }
}

async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Loads all consecutive un-replied CUSTOMER inbound messages since the last OUTBOUND reply
 * so rapid multi-message bursts are coalesced into one clean turn.
 */
async function loadPendingInboundBurst(
  conversationId: string,
  fallbackText: string
): Promise<{
  coalescedText: string;
  latestInboundId: string | null;
  latestInboundCreatedAt: string | null;
  count: number;
  burstAttachments: {
    images: number;
    documents: number;
    videos: number;
    audios: number;
    unreadable: number;
    imageItems: CustomerImageAttachmentInput[];
    nonImageItems: {
      mediaType: string;
      filename?: string;
      mimeType?: string;
      mediaId?: string;
      sha256?: string;
    }[];
  };
}> {
  const emptyAttachments = {
    images: 0,
    documents: 0,
    videos: 0,
    audios: 0,
    unreadable: 0,
    imageItems: [] as CustomerImageAttachmentInput[],
    nonImageItems: [] as {
      mediaType: string;
      filename?: string;
      mimeType?: string;
      mediaId?: string;
      sha256?: string;
    }[],
  };
  const conv = getRawLibSqlClient("conversations");
  const lastOutRes = await conv
    .execute({
      sql: `SELECT body, created_at FROM messages
            WHERE conversation_id = ? AND direction = 'OUTBOUND'
            ORDER BY created_at DESC LIMIT 2`,
      args: [conversationId],
    })
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));

  let lastOutIso = lastOutRes.rows[0]?.created_at
    ? String(lastOutRes.rows[0].created_at)
    : "";
  const lastOutBody = String(lastOutRes.rows[0]?.body || "");
  if (
    lastOutIso &&
    /^Noted\s+\*/i.test(lastOutBody.trim()) &&
    Date.now() - new Date(lastOutIso).getTime() <= 90_000
  ) {
    lastOutIso = lastOutRes.rows[1]?.created_at
      ? String(lastOutRes.rows[1].created_at)
      : "";
  }

  const pendingRes = await conv
    .execute({
      sql: lastOutIso
        ? `SELECT id, body, message_type, metadata_json, created_at FROM messages
           WHERE conversation_id = ? AND direction = 'INBOUND' AND sender_type = 'CUSTOMER' AND created_at > ?
           ORDER BY created_at ASC LIMIT 16`
        : `SELECT id, body, message_type, metadata_json, created_at FROM messages
           WHERE conversation_id = ? AND direction = 'INBOUND' AND sender_type = 'CUSTOMER'
           ORDER BY created_at ASC LIMIT 16`,
      args: lastOutIso ? [conversationId, lastOutIso] : [conversationId],
    })
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));

  if (pendingRes.rows.length === 0) {
    return {
      coalescedText: fallbackText,
      latestInboundId: null,
      latestInboundCreatedAt: null,
      count: 0,
      burstAttachments: emptyAttachments,
    };
  }

  const textLines: string[] = [];
  const allLines: string[] = [];
  const burstAttachments = {
    images: 0,
    documents: 0,
    videos: 0,
    audios: 0,
    unreadable: 0,
    imageItems: [] as CustomerImageAttachmentInput[],
    nonImageItems: [] as {
      mediaType: string;
      filename?: string;
      mimeType?: string;
      mediaId?: string;
      sha256?: string;
    }[],
  };

  for (const r of pendingRes.rows) {
    const t = String(r.body || "").trim();
    const mType = String(r.message_type || "").toUpperCase();
    let rowMeta: Record<string, any> = {};
    if (r.metadata_json) {
      try {
        rowMeta = JSON.parse(String(r.metadata_json));
      } catch {
        rowMeta = {};
      }
    }
    const mediaObj =
      rowMeta.media && typeof rowMeta.media === "object"
        ? (rowMeta.media as Record<string, any>)
        : {};
    const mediaId = String(
      mediaObj.mediaId || mediaObj.media_id || rowMeta.mediaId || rowMeta.media_id || ""
    ).trim();
    const mimeType = String(
      mediaObj.mimeType || mediaObj.mime_type || rowMeta.mimeType || rowMeta.mime_type || ""
    ).trim();
    const filename = String(mediaObj.filename || rowMeta.filename || "").trim();
    const caption = String(mediaObj.caption || rowMeta.caption || "").trim();
    const sha256 = String(mediaObj.sha256 || rowMeta.sha256 || "").trim();
    const isSticker = Boolean(mediaObj.isSticker || rowMeta.isSticker || /^\[sticker\b/i.test(t));

    if (mType === "IMAGE" || /^\[(?:image|photo|picture|sticker)\b[^\]]*\]$/i.test(t)) {
      if (!isSticker) {
        burstAttachments.images++;
        if (mediaId || mimeType || filename || sha256) {
          burstAttachments.imageItems.push({
            mediaId: mediaId || undefined,
            mimeType: mimeType || undefined,
            filename: filename || undefined,
            caption: caption || undefined,
            sha256: sha256 || undefined,
            isSticker: false,
          });
        }
      }
    } else if (mType === "DOCUMENT" || /^\[(?:document|pdf|file)\b[^\]]*\]$/i.test(t)) {
      burstAttachments.documents++;
      burstAttachments.nonImageItems.push({
        mediaType: "DOCUMENT",
        filename: filename || undefined,
        mimeType: mimeType || undefined,
        mediaId: mediaId || undefined,
        sha256: sha256 || undefined,
      });
    } else if (mType === "VIDEO" || /^\[(?:video)\b[^\]]*\]$/i.test(t)) {
      burstAttachments.videos++;
      burstAttachments.nonImageItems.push({
        mediaType: "VIDEO",
        filename: filename || undefined,
        mimeType: mimeType || undefined,
        mediaId: mediaId || undefined,
        sha256: sha256 || undefined,
      });
    } else if (mType === "AUDIO" || /^\[(?:audio|voice\s*note)\b[^\]]*\]$/i.test(t)) {
      burstAttachments.audios++;
      burstAttachments.nonImageItems.push({
        mediaType: "AUDIO",
        filename: filename || undefined,
        mimeType: mimeType || undefined,
        mediaId: mediaId || undefined,
        sha256: sha256 || undefined,
      });
    } else if (
      rowMeta.unsupportedAttachment ||
      /^\[unsupported\b[^\]]*\]$/i.test(t)
    ) {
      burstAttachments.unreadable++;
      burstAttachments.nonImageItems.push({
        mediaType: "UNSUPPORTED",
        filename: filename || undefined,
        mimeType: mimeType || (rowMeta.rawWaType ? `whatsapp/${String(rowMeta.rawWaType)}` : undefined),
        mediaId: mediaId || undefined,
        sha256: sha256 || undefined,
      });
    } else if (/^\[(?:message|media|attachment)\b[^\]]*\]$/i.test(t)) {
      burstAttachments.unreadable++;
    }

    if (!t) continue;
    if (allLines[allLines.length - 1] !== t) {
      allLines.push(t);
    }
    const isBarePlaceholder =
      /^\[(?:image|photo|picture|sticker|document|pdf|file|video|audio|voice\s*note|message|media|attachment|unsupported(?:\s+attachment)?)\b[^\]]*\]$/i.test(
        t
      );
    if (!isBarePlaceholder && textLines[textLines.length - 1] !== t) {
      textLines.push(t);
    }
  }
  const latest = pendingRes.rows[pendingRes.rows.length - 1];
  const coalescedText =
    (textLines.length > 0 ? textLines.join("\n").trim() : allLines.join("\n").trim()) ||
    fallbackText;
  return {
    coalescedText,
    latestInboundId: latest?.id ? String(latest.id) : null,
    latestInboundCreatedAt: latest?.created_at ? String(latest.created_at) : null,
    count: pendingRes.rows.length,
    burstAttachments,
  };
}

export async function processInboundAutomations(params: {
  conversationId: string;
  customerPhone: string;
  inboundText: string;
  isNewConversation: boolean;
  isButtonClick?: boolean;
  buttonPayload?: string;
  buttonText?: string;
  replyToWaMessageId?: string;
  waMessageId?: string;
  attachment?: {
    mediaType?: string;
    filename?: string;
    mimeType?: string;
    caption?: string;
    mediaId?: string;
    sha256?: string;
    isSticker?: boolean;
    buffer?: Buffer;
  } | null;
  onBeforeAcrioSend?: () => Promise<void> | void;
  visionAnalyzerOverride?: Parameters<typeof runAcrioAutonomousTurn>[0]["visionAnalyzerOverride"];
  mediaFetchImpl?: Parameters<typeof runAcrioAutonomousTurn>[0]["mediaFetchImpl"];
}): Promise<void> {
  const cleanWaId = String(params.waMessageId || "").trim();
  if (cleanWaId) {
    if (processedAutomationWaIds.has(cleanWaId)) {
      return;
    }
    processedAutomationWaIds.add(cleanWaId);
  }

  const mySeq = (inboundTurnSeqMap.get(params.conversationId) || 0) + 1;
  inboundTurnSeqMap.set(params.conversationId, mySeq);

  // Brief debounce window for rapid consecutive WhatsApp bubbles so AI waits and answers all of them once
  const debounceDisabled = process.env.ACRIO_DISABLE_DEBOUNCE === "1";
  const isShortFragmentOrMedia =
    Boolean(params.attachment) ||
    /^\[(?:image|photo|video|document|pdf|file|audio|voice\s*note|sticker|message)\b/i.test(
      params.inboundText.trim()
    ) ||
    params.inboundText.trim().split(/\s+/).filter(Boolean).length <= 4;
  const defaultDebounceMs = cleanWaId
    ? isShortFragmentOrMedia
      ? 2600
      : 1600
    : 250;
  const configuredDebounce = Number(
    process.env.ACRIO_INBOUND_DEBOUNCE_MS ?? defaultDebounceMs
  );
  if (!debounceDisabled && !params.isButtonClick && configuredDebounce > 0) {
    await sleepMs(configuredDebounce);
    if (inboundTurnSeqMap.get(params.conversationId) !== mySeq) {
      return;
    }
  }

  await withConversationWorkerLock(params.conversationId, async () => {
    if (inboundTurnSeqMap.get(params.conversationId) !== mySeq) {
      return;
    }
    await processInboundAutomationsLocked(params, mySeq);
  });
}

async function processInboundAutomationsLocked(
  params: {
    conversationId: string;
    customerPhone: string;
    inboundText: string;
    isNewConversation: boolean;
    isButtonClick?: boolean;
    buttonPayload?: string;
    buttonText?: string;
    replyToWaMessageId?: string;
    waMessageId?: string;
    attachment?: {
      mediaType?: string;
      filename?: string;
      mimeType?: string;
      caption?: string;
      mediaId?: string;
      sha256?: string;
      isSticker?: boolean;
      buffer?: Buffer;
    } | null;
    onBeforeAcrioSend?: () => Promise<void> | void;
    visionAnalyzerOverride?: Parameters<typeof runAcrioAutonomousTurn>[0]["visionAnalyzerOverride"];
    mediaFetchImpl?: Parameters<typeof runAcrioAutonomousTurn>[0]["mediaFetchImpl"];
  },
  entrySeq: number
): Promise<void> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const mkt = getRawLibSqlClient("marketing");

  // Coalesce multi-bubble bursts (only when not a specific interactive button payload)
  const initialBurst = !params.isButtonClick && !params.buttonPayload
    ? await loadPendingInboundBurst(params.conversationId, params.inboundText)
    : {
        coalescedText: params.inboundText,
        latestInboundId: null,
        latestInboundCreatedAt: null,
        count: 1,
        burstAttachments: {
          images: 0,
          documents: 0,
          videos: 0,
          audios: 0,
          unreadable: 0,
        },
      };
  let workingInboundText = initialBurst.coalescedText || params.inboundText;

  const convRes = await conv.execute({
    sql: `SELECT * FROM conversations WHERE id = ? LIMIT 1`,
    args: [params.conversationId],
  });
  const convRow = (convRes.rows[0] || {}) as Record<string, unknown>;
  const currentAssignedId = convRow.assigned_staff_id
    ? String(convRow.assigned_staff_id)
    : "";
  const currentTeamId = convRow.assigned_team_id
    ? String(convRow.assigned_team_id)
    : "";
  const currentStatus = convRow.status ? String(convRow.status) : "";
  const isHandledByAcrio =
    currentAssignedId === "ACRIO" &&
    currentStatus !== "ASSIGNED" &&
    (!currentTeamId || currentTeamId === "System (ACRIO)");
  const lower = workingInboundText.toLowerCase().trim();
  const nowIso = new Date().toISOString();

  // --------------------------------------------------------------------------
  // 0. Internal Staff Identification & Personalized Staff WhatsApp Desk
  // Checks both `core_auth.users.whatsapp_number` AND `classicconcepts.in` team numbers.
  // --------------------------------------------------------------------------
  const isOwnerCaller = isOwnerWhatsAppPhone(params.customerPhone);
  const linkedInternalStaff = await resolveInternalStaffCallerByPhone(params.customerPhone).catch(
    () => null
  );
  // The owner is always treated as internal, even if his number is not linked to a hub login.
  const internalStaff =
    linkedInternalStaff ?? (isOwnerCaller ? buildOwnerStaffProfile(params.customerPhone) : null);
  if (internalStaff) {
    // Ensure internal teammate chats are labeled cleanly & never counted as waiting customer SLAs
    await conv
      .execute({
        sql: `UPDATE conversations
              SET customer_name = CASE
                    WHEN customer_name LIKE '+%' OR TRIM(customer_name) = '' THEN ?
                    ELSE customer_name
                  END,
                  smart_category = 'Internal Team',
                  assigned_staff_id = 'ACRIO',
                  assigned_staff_name = 'ACRIO',
                  assigned_team_id = NULL,
                  assigned_team_name = 'Internal Team Desk',
                  waiting_since = NULL,
                  unread_count = 0
              WHERE id = ?`,
        args: [`${internalStaff.name} (Team)`, params.conversationId],
      })
      .catch(() => {});

    const incomingBtnText = String(
      params.buttonText || params.buttonPayload || workingInboundText || ""
    ).trim();
    const hubBase = process.env.NEXT_PUBLIC_APP_URL || "https://whatsapp.ccapl.cc";

    const sendStaffReply = async (rawBody: string) => {
      const formatted = formatWhatsAppOutboundText(rawBody);
      const outRes = await sendWhatsAppCloudMessage({
        toPhone: params.customerPhone,
        bodyText: formatted,
        simulateAsyncDelivery: true,
      }).catch(() => ({ ok: false, waMessageId: "", deliveryStatus: "FAILED" }));
      const outId = `msg_staffwa_${crypto.randomUUID().slice(0, 8)}`;
      await conv
        .execute({
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, wa_message_id, delivery_status, created_at
          ) VALUES (?, ?, 'OUTBOUND', 'ACRIO', 'ACRIO • Staff Desk', 'TEXT', 'ACRIO', ?, ?, ?, ?)`,
          args: [
            outId,
            params.conversationId,
            formatted,
            outRes.waMessageId || "",
            outRes.deliveryStatus || "SENT",
            new Date().toISOString(),
          ],
        })
        .catch(() => {});
      await conv
        .execute({
          sql: `UPDATE conversations SET last_message_preview = ?, last_message_at = ?, waiting_since = NULL WHERE id = ?`,
          args: [formatted.slice(0, 140), new Date().toISOString(), params.conversationId],
        })
        .catch(() => {});
      socketHub.emit("message:new", {
        conversationId: params.conversationId,
        senderName: "ACRIO • Staff Desk",
        text: formatted,
      });
    };

    // Staff just messaged us, so their 24 hour window is open. Deliver any lead that was waiting on a locked chat.
    // (A plain "hi" is answered first, then the leads follow.)
    const flushLeads = () =>
      flushPendingLeadForwards({
        staffPhone: params.customerPhone,
        conversationId: params.conversationId,
      }).catch((err) => {
        console.warn("[owner-desk] pending lead delivery failed:", err);
        return 0;
      });
    if (!isStaffGreeting(workingInboundText)) {
      await flushLeads();
    }

    // Template quick-reply button taps AND typed first-come, first-serve confirmations ("confirm", "accept", "claim")
    const isClaimConfirmationCmd =
      /^(Accept Assignment|Accept Callback|Accept|Claim|Confirm)$/i.test(incomingBtnText) ||
      /^(confirm|confirmed|accept|accepted|claim|take it|i'?ll take it|pick up|mine|ok confirm|yes confirm|yes accept)\W*$/i.test(
        incomingBtnText
      );

    if (
      isClaimConfirmationCmd ||
      /^(View Client Details|Snooze 30 Minutes)$/i.test(incomingBtnText)
    ) {
      // Find the referenced customer phone/conversation from quoted alert OR latest outbound alert template in this staff chat
      let targetPhoneFromAlert = "";
      let targetCustomerNameHint = "";
      const extractPhoneFromAlertRow = (row: Record<string, unknown> | undefined) => {
        if (!row) return;
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(String(row.metadata_json || "{}"));
        } catch {
          parsed = {};
        }
        if (parsed.alertCustomerPhone) {
          targetPhoneFromAlert = String(parsed.alertCustomerPhone);
          targetCustomerNameHint = String(parsed.alertCustomerName || "");
          return;
        }
        const bodyStr = String(row.body || "");
        const phMatch = bodyStr.match(/(?:\+?91[\s-]?)?[6-9]\d{9}/);
        if (phMatch) {
          targetPhoneFromAlert = normalizeWhatsAppPhone(phMatch[0]) || phMatch[0];
        }
      };

      if (params.replyToWaMessageId) {
        const quotedAlertRes = await conv
          .execute({
            sql: `SELECT body, metadata_json FROM messages WHERE wa_message_id = ? LIMIT 1`,
            args: [params.replyToWaMessageId],
          })
          .catch(() => ({ rows: [] as Record<string, unknown>[] }));
        extractPhoneFromAlertRow(quotedAlertRes.rows[0] as Record<string, unknown> | undefined);
      }

      if (!targetPhoneFromAlert) {
        const recentAlertsRes = await conv
          .execute({
            sql: `SELECT body, metadata_json FROM messages
                  WHERE conversation_id = ? AND direction = 'OUTBOUND' AND message_type = 'TEMPLATE'
                  ORDER BY created_at DESC LIMIT 5`,
            args: [params.conversationId],
          })
          .catch(() => ({ rows: [] as Record<string, unknown>[] }));
        for (const r of recentAlertsRes.rows) {
          extractPhoneFromAlertRow(r as Record<string, unknown>);
          if (targetPhoneFromAlert) break;
        }
      }

      let targetConv: Record<string, unknown> | undefined;
      if (targetPhoneFromAlert) {
        const normPhone = normalizeWhatsAppPhone(targetPhoneFromAlert) || targetPhoneFromAlert;
        const cByPhone = await conv
          .execute({
            sql: `SELECT id, customer_name, customer_phone, smart_category, last_message_preview, assigned_staff_id, assigned_staff_name, status
                  FROM conversations WHERE customer_phone = ? LIMIT 1`,
            args: [normPhone],
          })
          .catch(() => ({ rows: [] as Record<string, unknown>[] }));
        targetConv = cByPhone.rows[0] as Record<string, unknown> | undefined;
      }

      if (!targetConv && internalStaff.hubUserId) {
        const latestAssigned = await conv.execute({
          sql: `SELECT id, customer_name, customer_phone, smart_category, last_message_preview, assigned_staff_id, assigned_staff_name, status
                FROM conversations
                WHERE assigned_staff_id = ? AND status != 'RESOLVED'
                ORDER BY last_message_at DESC LIMIT 1`,
          args: [internalStaff.hubUserId],
        });
        targetConv = latestAssigned.rows[0] as Record<string, unknown> | undefined;
      }

      let replyText = "";
      if (isClaimConfirmationCmd) {
        if (targetConv) {
          const targetConvId = String(targetConv.id);
          const custLabel = String(
            targetConv.customer_name || targetCustomerNameHint || targetConv.customer_phone
          );
          const custPhoneLabel = String(targetConv.customer_phone || targetPhoneFromAlert);
          const curStaffId = targetConv.assigned_staff_id
            ? String(targetConv.assigned_staff_id)
            : "ACRIO";
          const curStaffName = targetConv.assigned_staff_name
            ? String(targetConv.assigned_staff_name)
            : "ACRIO";
          const claimantId = internalStaff.hubUserId || "";
          const claimantName = internalStaff.name;

          if (!claimantId) {
            replyText = `Thanks ${internalStaff.firstName}! Your hub login account is needed to lock assignments. Open Inbox to claim: ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(targetConvId)}`;
          } else if (curStaffId && curStaffId !== "ACRIO" && curStaffId !== claimantId) {
            replyText = `Already claimed, ${internalStaff.firstName}! *${custLabel}* (${custPhoneLabel}) has already been accepted by *${curStaffName}* (first-come, first-serve).\n\nView queue: ${hubBase}/dashboard/inbox`;
          } else if (curStaffId === claimantId) {
            await conv
              .execute({
                sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, delivery_status, created_at)
                      VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', ?, 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
                args: [
                  `msg_ack_${crypto.randomUUID().slice(0, 8)}`,
                  targetConvId,
                  claimantName,
                  `${claimantName} confirmed assignment via WhatsApp.`,
                  nowIso,
                ],
              })
              .catch(() => {});
            replyText = `Confirmed, ${internalStaff.firstName}! *${custLabel}* (${custPhoneLabel}) is assigned to you.\n\nOpen chat: ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(targetConvId)}`;
          } else {
            // Atomic first-come, first-serve claim
            const atomicClaim = await conv.execute({
              sql: `UPDATE conversations
                    SET status = 'ASSIGNED',
                        assigned_staff_id = ?,
                        assigned_staff_name = ?,
                        assigned_team_id = COALESCE(assigned_team_id, 'team_sales'),
                        assigned_team_name = CASE
                          WHEN assigned_team_name IS NULL OR TRIM(assigned_team_name) = '' OR assigned_team_name LIKE 'System (ACRIO)%' OR assigned_team_name = 'ACRIO Assistant' OR assigned_team_name = 'Internal Team Desk'
                          THEN 'Sales Team'
                          ELSE assigned_team_name
                        END,
                        escalation_level = 'P0',
                        waiting_since = NULL
                    WHERE id = ?
                      AND (assigned_staff_id IS NULL OR TRIM(assigned_staff_id) = '' OR assigned_staff_id = 'ACRIO')`,
              args: [claimantId, claimantName, targetConvId],
            });
            if (Number(atomicClaim.rowsAffected ?? 0) === 1) {
              await logConversationAssignment({
                conversationId: targetConvId,
                customerPhone: custPhoneLabel,
                customerName: custLabel,
                fromStaffId: "ACRIO",
                fromStaffName: "ACRIO",
                fromTeamName: "System (ACRIO)",
                toStaffId: claimantId,
                toStaffName: claimantName,
                toTeamId: "team_sales",
                toTeamName: "Sales Team",
                escalationLevel: "P0",
                assignmentSource: "WHATSAPP_FIRST_COME_CLAIM",
                assignedByName: claimantName,
                reason: `${claimantName} accepted first via WhatsApp confirmation`,
                assignedAt: nowIso,
              }).catch(() => {});
              await conv
                .execute({
                  sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, delivery_status, created_at)
                        VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', ?, 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
                  args: [
                    `msg_ack_${crypto.randomUUID().slice(0, 8)}`,
                    targetConvId,
                    claimantName,
                    `${claimantName} accepted and claimed this chat first via WhatsApp.`,
                    nowIso,
                  ],
                })
                .catch(() => {});
              socketHub.emit("conversation:assigned", {
                conversationId: targetConvId,
                staffId: claimantId,
                staffName: claimantName,
                teamName: "Sales Team",
                escalationLevel: "P0",
              });
              replyText = `Confirmed, ${internalStaff.firstName}! You claimed *${custLabel}* (${custPhoneLabel}) first and it is now assigned to you.\n\nOpen chat: ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(targetConvId)}`;
            } else {
              const winnerRes = await conv.execute({
                sql: `SELECT assigned_staff_name FROM conversations WHERE id = ? LIMIT 1`,
                args: [targetConvId],
              });
              const winnerName = String(winnerRes.rows[0]?.assigned_staff_name || "another team member");
              replyText = `Already claimed, ${internalStaff.firstName}! *${custLabel}* (${custPhoneLabel}) was just accepted by *${winnerName}* (first-come, first-serve).\n\nView queue: ${hubBase}/dashboard/inbox`;
            }
          }
        } else {
          replyText = `Thanks ${internalStaff.firstName}! View your open queue here: ${hubBase}/dashboard/inbox`;
        }
      } else if (/View Client Details/i.test(incomingBtnText)) {
        replyText = targetConv
          ? `*Latest Assigned Client:*\n• *Name:* ${String(targetConv.customer_name || "Customer")}\n• *Phone:* ${String(targetConv.customer_phone)}\n• *Topic:* ${String(targetConv.smart_category || "General Enquiry")}\n• *Last message:* ${String(targetConv.last_message_preview || "")}\n\nOpen chat: ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(targetConv.id))}`
          : `No open client chat is waiting for you right now, ${internalStaff.firstName}. Inbox: ${hubBase}/dashboard/inbox`;
      } else {
        replyText = `Alert snoozed for 30 minutes, ${internalStaff.firstName}. Open queue anytime: ${hubBase}/dashboard/inbox`;
      }
      await sendStaffReply(replyText);
      return;
    }

    // Owner desk: "please assign to @staff", lead forwarding, and the owner's read-only admin commands.
    if (isOwnerCaller && !params.isButtonClick) {
      const ownerHandled = await handleOwnerDeskMessage({
        conversationId: params.conversationId,
        ownerPhone: params.customerPhone,
        text: workingInboundText,
        currentWaMessageId: params.waMessageId,
        replyToWaMessageId: params.replyToWaMessageId,
        hasAttachment: Boolean(params.attachment),
        hubBase,
        logAssignment: logConversationAssignment,
        reply: sendStaffReply,
      }).catch(async (err) => {
        console.error("[owner-desk] owner command failed:", err);
        await sendStaffReply(
          "Sorry sir, something went wrong while handling that. Nothing was lost. Please try again in a moment."
        ).catch(() => {});
        return true;
      });
      if (ownerHandled) return;
    }

    // Staff desk: "hi" unlocks the chat, "my leads" lists forwarded leads.
    if (!params.isButtonClick) {
      const staffHandled = await handleStaffDeskMessage({
        staff: internalStaff,
        text: workingInboundText,
        hubBase,
        flushLeads,
        reply: sendStaffReply,
      }).catch(() => false);
      if (staffHandled) return;
    }

    // Fast personalized internal shortcuts: "my chats", "callbacks", "stats", or "check <phone>"
    if (/^(?:my\s*(?:chats?|leads?|open\s*chats?|assigned|queue)|open\s*leads?)\W*$/i.test(lower)) {
      const assignedRows = internalStaff.hubUserId
        ? await conv.execute({
            sql: `SELECT id, customer_name, customer_phone, smart_category, last_message_preview
                  FROM conversations
                  WHERE (assigned_staff_id = ? OR collaborators_json LIKE ?) AND status != 'RESOLVED'
                  ORDER BY last_message_at DESC LIMIT 6`,
            args: [internalStaff.hubUserId, `%"staffId":"${internalStaff.hubUserId}"%`],
          })
        : { rows: [] as Record<string, unknown>[] };
      if (assignedRows.rows.length === 0) {
        await sendStaffReply(
          `Hey *${internalStaff.firstName}*! You have *0 open assigned chats* right now.\n\nCheck open pool or call queue: ${hubBase}/dashboard/inbox`
        );
      } else {
        const items = assignedRows.rows
          .map(
            (r, i) =>
              `${i + 1}. *${String(r.customer_name || r.customer_phone)}* (${String(r.customer_phone)})\n   Topic: ${String(r.smart_category || "Enquiry")} | ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(r.id))}`
          )
          .join("\n\n");
        await sendStaffReply(
          `Hey *${internalStaff.firstName}*, here are your *${assignedRows.rows.length} open chats*:\n\n${items}`
        );
      }
      return;
    }

    if (/^(?:callbacks?|pending\s*callbacks?|calls?)\W*$/i.test(lower)) {
      const cbRows = await conv
        .execute(
          `SELECT conversation_id, customer_name, customer_phone, preferred_slot, topic
           FROM callback_requests WHERE status = 'PENDING' ORDER BY created_at DESC LIMIT 6`
        )
        .catch(() => ({ rows: [] as Record<string, unknown>[] }));
      if (cbRows.rows.length === 0) {
        await sendStaffReply(
          `Hey *${internalStaff.firstName}*, there are *no pending callbacks* right now! Call Queue: ${hubBase}/dashboard/call-queue`
        );
      } else {
        const list = cbRows.rows
          .map(
            (r, i) =>
              `${i + 1}. *${String(r.customer_name || r.customer_phone)}* (${String(r.customer_phone)})\n   Slot: ${String(r.preferred_slot || "ASAP")} | ${String(r.topic || "General")}\n   ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(r.conversation_id))}`
          )
          .join("\n\n");
        await sendStaffReply(
          `Hey *${internalStaff.firstName}*, here are the *pending callbacks (${cbRows.rows.length})*:\n\n${list}`
        );
      }
      return;
    }

    if (/^(?:stats?|summary|today|today'?s?\s*stats?)\W*$/i.test(lower)) {
      const [openCntRes, waitCntRes, cqCntRes] = await Promise.all([
        conv.execute(`SELECT COUNT(*) AS c FROM conversations WHERE status != 'RESOLVED'`),
        conv.execute(`SELECT COUNT(*) AS c FROM conversations WHERE status != 'RESOLVED' AND waiting_since IS NOT NULL`),
        conv.execute(`SELECT COUNT(*) AS c FROM call_dispatch_queue WHERE status != 'RESOLVED'`).catch(() => ({ rows: [{ c: 0 }] })),
      ]);
      await sendStaffReply(
        `*Classic Concepts Live Desk Snapshot* (for ${internalStaff.firstName}):\n\n• *Open Conversations:* ${Number(openCntRes.rows[0]?.c ?? 0)}\n• *Waiting for Staff Reply:* ${Number(waitCntRes.rows[0]?.c ?? 0)}\n• *Open Call Queue Items:* ${Number(cqCntRes.rows[0]?.c ?? 0)}\n\nOpen Dashboard: ${hubBase}/dashboard`
      );
      return;
    }

    const phoneLookupMatch = workingInboundText.match(/(?:check|lookup|find|status|details|who\s+is)?\s*(\+?\d[\d\s-]{8,14}\d)/i);
    if (
      phoneLookupMatch &&
      /\b(check|lookup|find|status|details|client|customer|order|who)\b/i.test(lower)
    ) {
      const lookupDigits = phoneLookupMatch[1].replace(/\D/g, "").slice(-10);
      if (lookupDigits.length === 10) {
        const [cRes, custRes] = await Promise.all([
          conv.execute({
            sql: `SELECT id, customer_name, customer_phone, status, assigned_staff_name, smart_category, last_message_preview
                  FROM conversations WHERE customer_phone LIKE ? ORDER BY last_message_at DESC LIMIT 1`,
            args: [`%${lookupDigits}%`],
          }),
          crm.execute({
            sql: `SELECT name, company_name, city, acrio_segment, total_orders_count, lifetime_value_inr
                  FROM customers WHERE phone LIKE ? LIMIT 1`,
            args: [`%${lookupDigits}%`],
          }),
        ]);
        const cRowFound = cRes.rows[0];
        const custFound = custRes.rows[0];
        if (!cRowFound && !custFound) {
          await sendStaffReply(
            `Hey *${internalStaff.firstName}*, no CRM record or chat was found matching *${phoneLookupMatch[1].trim()}*.`
          );
        } else {
          await sendStaffReply(
            `*Internal CRM Lookup for ${internalStaff.firstName}:*\n• *Client:* ${String(custFound?.name || cRowFound?.customer_name || lookupDigits)}\n• *Phone:* ${String(cRowFound?.customer_phone || lookupDigits)}${custFound?.company_name ? `\n• *Company:* ${String(custFound.company_name)}` : ""}${custFound?.city ? `\n• *City:* ${String(custFound.city)}` : ""}\n• *Assigned to:* ${String(cRowFound?.assigned_staff_name || "ACRIO")}\n• *Status:* ${String(cRowFound?.status || "NEW")}\n• *Orders:* ${Number(custFound?.total_orders_count ?? 0)}${cRowFound?.id ? `\n\nOpen Chat: ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(cRowFound.id))}` : ""}`
          );
        }
        return;
      }
    }

    // Full personalized AI Staff Assistant on WhatsApp
    const recentStaffMsgs = await conv
      .execute({
        sql: `SELECT direction, body FROM messages WHERE conversation_id = ? AND direction IN ('INBOUND', 'OUTBOUND') ORDER BY created_at DESC LIMIT 10`,
        args: [params.conversationId],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const staffResult = await runAcrioStaffWhatsAppAssistant({
      staff: internalStaff,
      inboundText: workingInboundText,
      recentMessages: [...recentStaffMsgs.rows].reverse().map((r) => ({
        direction: String(r.direction),
        body: String(r.body || ""),
      })),
    });
    await sendStaffReply(staffResult.replyText);
    return;
  }

  // Update local param copy to coalesced text for customer pipeline below
  params = { ...params, inboundText: workingInboundText };

  // --------------------------------------------------------------------------
  // 1. Automatic WhatsApp Opt-Out Protection
  // --------------------------------------------------------------------------
  if (
    /^(stop|stop\s*promotions|stop\s*offers|unsubscribe|opt\s*out)\W*$/i.test(
      lower
    )
  ) {
    await performCustomerOptOut({
      conversationId: params.conversationId,
      customerPhone: params.customerPhone,
      reasonLabel: "Replied STOP on WhatsApp",
    });
    return;
  }

  // --------------------------------------------------------------------------
  // 1a. Handle Staff Quick-Reply Taps from Meta Alert Templates
  // (`cc_staff_client_assignment` & `cc_callback_request_alert`)
  // --------------------------------------------------------------------------
  const incomingBtnText = String(params.buttonText || params.buttonPayload || params.inboundText || "").trim();
  if (/^(Accept Assignment|View Client Details|Accept Callback|Snooze 30 Minutes)$/i.test(incomingBtnText)) {
    const auth = getRawLibSqlClient("core_auth");
    const digitsSuffix = params.customerPhone.replace(/\D/g, "").slice(-10);
    const staffRows = digitsSuffix.length >= 10
      ? await auth.execute({
          sql: `SELECT id, name, whatsapp_number FROM users WHERE status = 'ACTIVE' AND whatsapp_number IS NOT NULL AND whatsapp_number != ''`,
        })
      : { rows: [] as Record<string, unknown>[] };
    const staffCaller = staffRows.rows.find(
      (u) => String(u.whatsapp_number || "").replace(/\D/g, "").slice(-10) === digitsSuffix
    );
    if (staffCaller) {
      const sId = String(staffCaller.id);
      const sName = String(staffCaller.name || "Team Member");
      const latestAssigned = await conv.execute({
        sql: `SELECT id, customer_name, customer_phone, smart_category, last_message_preview
              FROM conversations
              WHERE assigned_staff_id = ? AND status != 'RESOLVED'
              ORDER BY last_message_at DESC LIMIT 1`,
        args: [sId],
      });
      const targetConv = latestAssigned.rows[0];
      const hubBase = process.env.NEXT_PUBLIC_APP_URL || "https://whatsapp.ccapl.cc";
      let replyText = "";
      if (/Accept Assignment/i.test(incomingBtnText)) {
        if (targetConv) {
          await conv.execute({
            sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, delivery_status, created_at)
                  VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', ?, 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
            args: [
              `msg_ack_${crypto.randomUUID().slice(0, 8)}`,
              String(targetConv.id),
              sName,
              `${sName} accepted assignment via WhatsApp.`,
              nowIso,
            ],
          }).catch(() => {});
          replyText = `Thanks ${sName}! Confirmed your acceptance for *${String(targetConv.customer_name || targetConv.customer_phone)}*.\n\nOpen chat: ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(targetConv.id))}`;
        } else {
          replyText = `Thanks ${sName}! Open your assigned queue here: ${hubBase}/dashboard/inbox`;
        }
      } else if (/View Client Details/i.test(incomingBtnText)) {
        if (targetConv) {
          replyText = `*Latest Assigned Client:*\n• *Name:* ${String(targetConv.customer_name || "Customer")}\n• *Phone:* ${String(targetConv.customer_phone)}\n• *Topic:* ${String(targetConv.smart_category || "General Enquiry")}\n• *Last msg:* ${String(targetConv.last_message_preview || "")}\n\nOpen chat: ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(targetConv.id))}`;
        } else {
          replyText = `No open client chat is currently waiting for you. Check your inbox: ${hubBase}/dashboard/inbox`;
        }
      } else if (/Accept Callback/i.test(incomingBtnText)) {
        replyText = targetConv
          ? `Callback accepted! Please call *${String(targetConv.customer_name || "")}* at ${String(targetConv.customer_phone)} and log the outcome in ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(targetConv.id))}`
          : `Callback accepted! Check pending callbacks in ${hubBase}/dashboard/inbox`;
      } else {
        replyText = `Snoozed alert for 30 minutes, ${sName}. You can still pick up the client anytime in ${hubBase}/dashboard/inbox`;
      }
      await sendWhatsAppCloudMessage({
        toPhone: params.customerPhone,
        bodyText: replyText,
        simulateAsyncDelivery: true,
      }).catch(() => {});
      return;
    }
  }

  // --------------------------------------------------------------------------
  // 1b. ACRIO's own buttons and "View options" list taps (acrio:* payloads)
  // --------------------------------------------------------------------------
  let forcedFocusSlug: string | undefined;
  const acrioPayload = String(params.buttonPayload || "").trim();
  if (acrioPayload.toLowerCase().startsWith("acrio:")) {
    const handledButton = await handleAcrioInteractiveReply({
      conversationId: params.conversationId,
      customerPhone: params.customerPhone,
      payload: acrioPayload,
      isHandledByAcrio,
    });
    if (handledButton) return;
    if (acrioPayload.toLowerCase().startsWith("acrio:prod:")) {
      forcedFocusSlug = acrioPayload.slice("acrio:prod:".length);
      params.inboundText = `Tell me about ${params.buttonText || forcedFocusSlug.replace(/-/g, " ")}`;
    } else if (acrioPayload.toLowerCase() === "acrio:more") {
      params.inboundText = "Show me more options";
    }
  }

  // --------------------------------------------------------------------------
  // 1c. Staff Preference, Explicit Person Request, or Previous Handler Sticky Auto-Assign
  // --------------------------------------------------------------------------
  if (isHandledByAcrio) {
    const staffPref = await resolveRequestedOrPreferredStaffForInbound({
      customerPhone: params.customerPhone,
      inboundText: params.inboundText,
      conversationId: params.conversationId,
    }).catch(() => null);

    if (
      staffPref &&
      (staffPref.matchType === "REQUESTED_BY_CUSTOMER" ||
        (params.isNewConversation &&
          (staffPref.matchType === "PREFERRED_STAFF" ||
            staffPref.matchType === "PAST_HANDLER")))
    ) {
      await conv.execute({
        sql: `UPDATE conversations
              SET status = 'ASSIGNED',
                  assigned_staff_id = ?,
                  assigned_staff_name = ?,
                  assigned_team_id = 'team_sales',
                  assigned_team_name = 'Sales Team',
                  escalation_level = 'P0',
                  waiting_since = COALESCE(waiting_since, ?)
              WHERE id = ?`,
        args: [staffPref.staffId, staffPref.staffName, nowIso, params.conversationId],
      });

      await logConversationAssignment({
        conversationId: params.conversationId,
        customerPhone: params.customerPhone,
        customerName: String(convRow.customer_name || params.customerPhone),
        fromStaffId: currentAssignedId || "ACRIO",
        fromStaffName: currentAssignedId === "ACRIO" ? "ACRIO" : String(convRow.assigned_staff_name || "System"),
        fromTeamName: String(convRow.assigned_team_name || "System (ACRIO)"),
        toStaffId: staffPref.staffId,
        toStaffName: staffPref.staffName,
        toTeamId: "team_sales",
        toTeamName: "Sales Team",
        escalationLevel: "P0",
        assignmentSource: staffPref.matchType,
        assignedByName: "System (Sticky Routing)",
        reason: staffPref.reason,
        assignedAt: nowIso,
      }).catch(() => {});

      await conv
        .execute({
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, delivery_status, created_at
          ) VALUES (?, ?, 'INTERNAL', 'SYSTEM', 'Auto-Routing', 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
          args: [
            `msg_pref_${crypto.randomUUID().slice(0, 8)}`,
            params.conversationId,
            `Auto-assigned directly to @${staffPref.staffName} (${staffPref.reason}).`,
            nowIso,
          ],
        })
        .catch(() => {});

      void sendStaffAssignmentEmailNotification({
        staffId: staffPref.staffId,
        staffName: staffPref.staffName,
        customerName: String(convRow.customer_name || params.customerPhone),
        customerPhone: params.customerPhone,
        smartCategory: String(convRow.smart_category || "General Enquiry"),
        priority: "HIGH",
        escalationLevel: "P0",
        teamName: "Sales Team",
        reason: staffPref.reason,
        latestMessage: params.inboundText,
        conversationId: params.conversationId,
      }).catch(() => {});

      if (staffPref.matchType === "REQUESTED_BY_CUSTOMER") {
        const confirmText = formatWhatsAppOutboundText(
          `Sure, I have connected you directly with *${staffPref.staffName}* as requested. They will reply to you here shortly.`
        );
        const sendRes = await sendWhatsAppCloudMessage({
          toPhone: params.customerPhone,
          bodyText: confirmText,
          simulateAsyncDelivery: true,
        });
        await conv
          .execute({
            sql: `INSERT INTO messages (
              id, conversation_id, direction, sender_type, sender_name, message_type,
              billing_category, body, wa_message_id, delivery_status, created_at
            ) VALUES (?, ?, 'OUTBOUND', 'AUTOMATION', 'Auto-Routing', 'TEXT', 'FREE_CHAT', ?, ?, ?, ?)`,
            args: [
              `msg_req_${crypto.randomUUID().slice(0, 8)}`,
              params.conversationId,
              confirmText,
              sendRes.waMessageId,
              sendRes.deliveryStatus,
              nowIso,
            ],
          })
          .catch(() => {});
        socketHub.emit("message:new", {
          conversationId: params.conversationId,
          senderName: "Auto-Routing",
          text: confirmText,
        });
      }

      socketHub.emit("conversation:assigned", {
        conversationId: params.conversationId,
        assignedTeamName: "Sales Team",
        assignedStaffName: staffPref.staffName,
        escalationLevel: "P0",
      });
      return;
    }
  }

  // --------------------------------------------------------------------------
  // 2. Template Quick-Reply Button Flow Engine (Runs BEFORE ACRIO!)
  // --------------------------------------------------------------------------
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

  // Execute deterministic Quick Reply Button Flow if matched (or if an explicit WhatsApp button click arrived)
  if (matchedButton || params.isButtonClick) {
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
        await conv.execute({
          sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, wa_message_id, delivery_status, created_at)
                VALUES (?, ?, 'OUTBOUND', 'AUTOMATION', 'Template Flow (View Catalog)', 'TEXT', 'FREE_CHAT', ?, ?, ?, ?)`,
          args: [
            `msg_cat_${crypto.randomUUID().slice(0, 8)}`,
            params.conversationId,
            catalogMsg,
            catSend.waMessageId,
            catSend.deliveryStatus,
            nowIso,
          ],
        }).catch(() => {});
        socketHub.emit("message:new", {
          conversationId: params.conversationId,
          senderName: "Template Flow (View Catalog)",
          text: catalogMsg,
        });
        return;
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
      return;
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
              nowIso,
            ],
          },
          {
            sql: `UPDATE conversations
                  SET smart_category = 'Order & Delivery',
                      unread_count = 0,
                      last_message_preview = ?,
                      last_message_at = ?
                  WHERE id = ?`,
            args: [bodyText.slice(0, 140), nowIso, params.conversationId],
          },
        ],
        "write"
      );
      socketHub.emit("message:new", {
        conversationId: params.conversationId,
        senderName: `Template Flow (${btnLabel})`,
        text: bodyText,
      });
      return;
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
              nowIso,
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
              nowIso,
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
      return;
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
              nowIso,
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
              nowIso,
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
      return;
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
            nowIso,
          ],
        });
        if (sendRes.ok) {
          await recordDualPricingLedgerEntry({
            messageId: msgId,
            conversationId: params.conversationId,
            customerPhone: params.customerPhone,
            category: tplCat,
            staffName: `Template Flow (${btnLabel})`,
          });
        }
        socketHub.emit("message:new", {
          conversationId: params.conversationId,
          senderName: `Template Flow (${btnLabel})`,
          text: tplBody,
        });
        return;
      }
    }

    if (effectiveAction === "SMART_AI_WITH_GUARD") {
      const aiReply = await runGuardedButtonFlowAiReply({
        customerName: String(convRow.customer_name || params.customerPhone),
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
          nowIso,
        ],
      });
      await recordDualPricingLedgerEntry({
        messageId: msgId,
        conversationId: params.conversationId,
        customerPhone: params.customerPhone,
        category: "ACRIO",
        staffName: "ACRIO Button Flow",
      });
      socketHub.emit("message:new", {
        conversationId: params.conversationId,
        senderName: "ACRIO (Button Flow)",
        text: aiReply,
      });
      return;
    }
  }

  // --------------------------------------------------------------------------
  // 3. Direct Order ID & Order Status Ecosystem Lookup (:3002, :3003, :3007)
  //    Runs BEFORE ACRIO with 0 AI credits whenever customer asks order status!
  // --------------------------------------------------------------------------
  const orderDetection = extractOrderLookupCandidate(params.inboundText);
  if (
    isHandledByAcrio &&
    (orderDetection.explicitOrderId || orderDetection.asksAboutOrder)
  ) {
    const ecosystemLookup = await lookupCustomerOrdersAcrossEcosystem({
      orderInput: orderDetection.explicitOrderId || undefined,
      customerPhone: params.customerPhone,
    });

    const primaryOrder =
      ecosystemLookup.exactMatch ||
      (!orderDetection.explicitOrderId ? ecosystemLookup.phoneOrders[0] : null);

    let orderReply = "";
    let ctaButton:
      | { label: string; url: string; footerText?: string }
      | undefined;

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
    return;
  }

  // --------------------------------------------------------------------------
  // 4. Advanced Auto-Replies & Routing Rules Engine
  // --------------------------------------------------------------------------
  const rulesRes = await conv.execute(
    `SELECT * FROM automations WHERE is_enabled = 1 ORDER BY COALESCE(priority_order, 100) ASC, created_at ASC`
  );
  const hasInboundMediaAttachment =
    Boolean(params.attachment) ||
    initialBurst.burstAttachments.images > 0 ||
    initialBurst.burstAttachments.documents > 0 ||
    initialBurst.burstAttachments.videos > 0 ||
    initialBurst.burstAttachments.audios > 0 ||
    initialBurst.burstAttachments.unreadable > 0;
  let ruleStoppedFurtherAi = false;

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
      hasInboundMediaAttachment
    ) {
      continue;
    }

    await conv.execute({
      sql: `UPDATE automations SET runs_count = runs_count + 1, last_triggered_at = ? WHERE id = ?`,
      args: [nowIso, String(r.id)],
    });

    if (actionType === "OPT_OUT") {
      await performCustomerOptOut({
        conversationId: params.conversationId,
        customerPhone: params.customerPhone,
        reasonLabel: `Rule: ${String(r.name)}`,
      });
      return;
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
      (isHandledByAcrio || payload.forceReassign === true)
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
            nowIso,
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
      return;
    } else if (actionType === "AUTO_REPLY" && payload.replyText) {
      const stopFurtherAi = payload.stopFurtherAi !== false;
      // Fire auto-reply when either stopFurtherAi is enabled (replaces AI to save credits!) or chat is not on ACRIO
      if (stopFurtherAi || !isHandledByAcrio) {
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
                nowIso,
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
                nowIso,
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
          ruleStoppedFurtherAi = true;
          break;
        }
      }
    }
  }

  if (ruleStoppedFurtherAi) {
    return;
  }

  // Case A: Chat is already connected to a human staff member -> keep human owner & start wait timer
  if (!isHandledByAcrio) {
    await conv.execute({
      sql: `UPDATE conversations
            SET waiting_since = COALESCE(waiting_since, ?)
            WHERE id = ?`,
      args: [nowIso, params.conversationId],
    });
    return;
  }

  // Case B: Initial / active ACRIO assignment -> ACRIO handles the query automatically in the backend!
  // Anti-distraction loop: if customer sends another message WHILE Claude is thinking,
  // discard the outdated draft, coalesce all new messages, and generate one unified reply!
  let acrioTurn!: Awaited<ReturnType<typeof runAcrioAutonomousTurn>>;
  let finalReplyIso = new Date().toISOString();
  let lastSeenInboundId = initialBurst.latestInboundId;
  let activePromptText = workingInboundText;
  let activeBurstAttachments = initialBurst.burstAttachments;

  for (let aiAttempt = 0; aiAttempt < 3; aiAttempt++) {
    const seqAtAiStart = inboundTurnSeqMap.get(params.conversationId);

    const recentRes = await conv.execute({
      sql: `SELECT direction, sender_type, body, metadata_json, wa_message_id FROM messages
            WHERE conversation_id = ? AND direction IN ('INBOUND', 'OUTBOUND')
            ORDER BY created_at DESC LIMIT 16`,
      args: [params.conversationId],
    });
    const recentMessages = [...recentRes.rows].reverse().map((m) => {
      let parsedMeta: Record<string, any> = {};
      if (m.metadata_json) {
        try {
          parsedMeta = JSON.parse(String(m.metadata_json));
        } catch {
          parsedMeta = {};
        }
      }
      return {
        direction: String(m.direction),
        senderType: String(m.sender_type || ""),
        body: String(m.body),
        productSlug: parsedMeta.productSlug ? String(parsedMeta.productSlug) : null,
        replyTo: parsedMeta.replyTo || null,
      };
    });
    const hasAlreadyGreeted = recentMessages.some(
      (m) => m.direction === "OUTBOUND"
    );

    let replyToMessage =
      recentMessages[recentMessages.length - 1]?.replyTo || null;
    if (!replyToMessage && params.replyToWaMessageId) {
      const quotedRes = await conv
        .execute({
          sql: `SELECT sender_name, direction, body, metadata_json FROM messages WHERE wa_message_id = ? LIMIT 1`,
          args: [params.replyToWaMessageId],
        })
        .catch(() => ({ rows: [] as any[] }));
      const qRow = quotedRes.rows[0];
      if (qRow) {
        let qMeta: Record<string, any> = {};
        if (qRow.metadata_json) {
          try {
            qMeta = JSON.parse(String(qRow.metadata_json));
          } catch {
            qMeta = {};
          }
        }
        replyToMessage = {
          waMessageId: params.replyToWaMessageId,
          senderName: String(qRow.sender_name || "ACRIO"),
          direction: String(qRow.direction || "OUTBOUND"),
          body: String(qRow.body || ""),
          productSlug: qMeta.productSlug ? String(qMeta.productSlug) : null,
          productName: qMeta.productName ? String(qMeta.productName) : null,
          variantName: qMeta.variantName ? String(qMeta.variantName) : null,
        };
      }
    }

    acrioTurn = await runAcrioAutonomousTurn({
      conversationId: params.conversationId,
      customerName: String(convRow.customer_name || params.customerPhone),
      customerPhone: params.customerPhone,
      inboundText: activePromptText,
      recentMessages,
      hasAlreadyGreeted,
      forcedFocusSlug,
      replyToMessage,
      attachment: params.attachment || null,
      burstAttachments: activeBurstAttachments,
      visionAnalyzerOverride: params.visionAnalyzerOverride,
      mediaFetchImpl: params.mediaFetchImpl,
    });

    // Freshness gate: did the customer send another message while AI was generating this reply?
    const latestBurst = await loadPendingInboundBurst(
      params.conversationId,
      activePromptText
    );
    const seqMoved =
      inboundTurnSeqMap.get(params.conversationId) !== seqAtAiStart ||
      inboundTurnSeqMap.get(params.conversationId) !== entrySeq;
    const dbMoved =
      Boolean(latestBurst.latestInboundId) &&
      latestBurst.latestInboundId !== lastSeenInboundId;

    if ((seqMoved || dbMoved) && !params.isButtonClick) {
      if (inboundTurnSeqMap.get(params.conversationId) !== entrySeq) {
        // Another queued call with a newer sequence number is already waiting on the lock to answer cleanly
        return;
      }
      if (aiAttempt < 2) {
        await sleepMs(850);
        const settledBurst = await loadPendingInboundBurst(
          params.conversationId,
          activePromptText
        );
        lastSeenInboundId = settledBurst.latestInboundId;
        activePromptText = settledBurst.coalescedText;
        activeBurstAttachments = settledBurst.burstAttachments;
        continue;
      }
    }

    finalReplyIso = new Date().toISOString();
    break;
  }

  if (params.onBeforeAcrioSend) {
    await params.onBeforeAcrioSend();
  }

  // Re-verify conversation ownership immediately before sending ACRIO's outbound reply
  // so a human staff member who took over while ACRIO was generating its reply is never overwritten.
  const postTurnConvRes = await conv.execute({
    sql: `SELECT status, assigned_staff_id, assigned_team_id FROM conversations WHERE id = ? LIMIT 1`,
    args: [params.conversationId],
  });
  const postTurnRow = (postTurnConvRes.rows[0] || {}) as Record<string, unknown>;
  const postStaffId = postTurnRow.assigned_staff_id
    ? String(postTurnRow.assigned_staff_id)
    : "";
  const postTeamId = postTurnRow.assigned_team_id
    ? String(postTurnRow.assigned_team_id)
    : "";
  const postStatus = postTurnRow.status ? String(postTurnRow.status) : "";
  const stillOwnedByAcrio =
    postStaffId === "ACRIO" &&
    postStatus !== "ASSIGNED" &&
    (!postTeamId || postTeamId === "System (ACRIO)");
  if (!stillOwnedByAcrio) {
    return;
  }
  void finalReplyIso;

  if (!acrioTurn.needsHumanHandoff) {
    // Send ACRIO's automatic WhatsApp reply (text, or text with buttons / "View options" list, plus any product/variant images)
    const { acrioMsgId, replyIso } = await sendAcrioChatMessage({
      conversationId: params.conversationId,
      customerPhone: params.customerPhone,
      text: acrioTurn.customerReply,
      interactive: acrioTurn.interactive,
      mediaAttachments: acrioTurn.mediaAttachments,
    });

    await recordAssignedFirstResponse({
      conversationId: params.conversationId,
      responderId: "ACRIO",
      responderName: "ACRIO",
      responderTeamId: null,
      responderTeamName: "System (ACRIO)",
      messageId: acrioMsgId,
      respondedAt: replyIso,
    });

    // ACRIO answered the query automatically - keep assigned to ACRIO with zero customer wait!
    // When needsSalesTeamPing is true (Decision #4), ping the Sales Team internally without transferring ownership away from ACRIO.
    const teamLabel = acrioTurn.needsSalesTeamPing
      ? "System (ACRIO) • Sales Pinged"
      : "System (ACRIO)";
    await conv.execute({
      sql: `UPDATE conversations
            SET status = 'OPEN',
                assigned_staff_id = 'ACRIO',
                assigned_staff_name = 'ACRIO',
                assigned_team_id = ?,
                assigned_team_name = ?,
                smart_category = ?,
                priority = ?,
                escalation_level = 'P0',
                waiting_since = NULL,
                unread_count = ?,
                last_message_preview = ?,
                last_message_at = ?,
                last_message_direction = 'OUTBOUND',
                last_message_status = 'SENT'
            WHERE id = ?`,
      args: [
        // Keep assigned_team_id empty so ACRIO keeps answering this chat after a Sales Team ping.
        null,
        teamLabel,
        acrioTurn.smartCategory,
        acrioTurn.needsSalesTeamPing ? "HIGH" : acrioTurn.priority,
        acrioTurn.needsSalesTeamPing ? 1 : 0,
        `ACRIO: ${acrioTurn.customerReply}`.slice(0, 140),
        replyIso,
        params.conversationId,
      ],
    });

    if (acrioTurn.needsSalesTeamPing) {
      const pingMsgId = `msg_ping_${crypto.randomUUID().slice(0, 8)}`;
      const pingBody =
        acrioTurn.salesTeamPingNote ||
        `ACRIO Consultative Ping: Customer requested bulk/project pricing ("${params.inboundText.slice(0, 120)}"). ACRIO remains active on this chat; Sales Team can drop a single reply if special pricing applies.`;
      await conv
        .execute({
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, delivery_status, created_at
          ) VALUES (?, ?, 'INTERNAL', 'SYSTEM', 'ACRIO • Sales Ping', 'INTERNAL_NOTE', 'FREE', ?, 'DELIVERED', ?)`,
          args: [pingMsgId, params.conversationId, pingBody, replyIso],
        })
        .catch(() => {});

      socketHub.emit("message:new", {
        conversationId: params.conversationId,
        senderName: "ACRIO • Sales Ping",
        text: pingBody,
      });

      // Notify ONLY the assigned salesperson (or single least-loaded P0 responder) via `cc_quote_request_alert`
      const quoteInfo = extractQuoteRequestDetails({
        text: params.inboundText,
        smartCategory: acrioTurn.smartCategory,
      });
      if (quoteInfo.isQuoteRequest) {
        const assignedHumanId =
          convRow.assigned_staff_id && String(convRow.assigned_staff_id) !== "ACRIO"
            ? String(convRow.assigned_staff_id)
            : "";
        let targetStaffId = assignedHumanId;
        let targetStaffName = String(convRow.assigned_staff_name || "Sales Team");

        if (!targetStaffId) {
          const salesMembersRes = await conv
            .execute(
              `SELECT tm.staff_id, tm.staff_name,
                      (SELECT COUNT(*) FROM conversations c WHERE c.assigned_staff_id = tm.staff_id AND c.status != 'RESOLVED') AS open_cnt
               FROM team_members tm
               WHERE tm.team_id = 'team_sales' AND tm.is_available = 1
               ORDER BY tm.tier ASC, open_cnt ASC
               LIMIT 1`
            )
            .catch(() => ({ rows: [] as Record<string, unknown>[] }));
          if (salesMembersRes.rows[0]) {
            targetStaffId = String(salesMembersRes.rows[0].staff_id);
            targetStaffName = String(salesMembersRes.rows[0].staff_name || "Sales Team");
          }
        }

        if (targetStaffId) {
          void sendQuoteRequestAlertTemplate({
            staffId: targetStaffId,
            staffName: targetStaffName,
            customerName: String(convRow.customer_name || params.customerPhone),
            customerPhone: params.customerPhone,
            productName: quoteInfo.product,
            quantity: quoteInfo.quantity,
          }).catch(() => {});
        }
      }
    }

    socketHub.emit("message:new", {
      conversationId: params.conversationId,
      senderName: "ACRIO",
      text: acrioTurn.customerReply,
    });
    return;
  }

  // Customer shared non-image/sketch attachment, asked to speak to support, or ACRIO escalated -> route to staff FIRST before sending transfer confirmation!
  let assigned: Awaited<ReturnType<typeof smartAssignConversation>> | null = null;
  let routingSucceeded = false;
  try {
    assigned = await smartAssignConversation({
      conversationId: params.conversationId,
      inboundText: params.inboundText,
      preferredTeamId: "team_sales",
      onlyIfUnassigned: true,
      startWaitingTimer: true,
      handoffReasonFromAcrio: acrioTurn.handoffReason,
    });
    routingSucceeded = Boolean(assigned?.assignedTeamId || assigned?.assignedStaffId);
  } catch {
    routingSucceeded = false;
  }

  const outboundHandoffText = routingSucceeded
    ? acrioTurn.customerReply
    : "I could not transfer your message to an available staff member right now. Please contact our Sales Team directly on WhatsApp at +91 73372 20568, call +91 79016 50662, or email sales@classicconcepts.in with your requirement.";

  const { acrioMsgId, replyIso } = await sendAcrioChatMessage({
    conversationId: params.conversationId,
    customerPhone: params.customerPhone,
    text: outboundHandoffText,
    interactive: routingSucceeded ? acrioTurn.interactive : undefined,
    mediaAttachments: routingSucceeded ? acrioTurn.mediaAttachments : undefined,
  });

  await recordAssignedFirstResponse({
    conversationId: params.conversationId,
    responderId: "ACRIO",
    responderName: "ACRIO",
    responderTeamId: null,
    responderTeamName: "System (ACRIO)",
    messageId: acrioMsgId,
    respondedAt: replyIso,
  });

  await conv.execute({
    sql: `UPDATE conversations
          SET smart_category = ?,
              priority = ?,
              last_message_preview = ?,
              last_message_at = ?
          WHERE id = ?`,
    args: [
      acrioTurn.smartCategory,
      acrioTurn.priority,
      params.inboundText.slice(0, 140),
      replyIso,
      params.conversationId,
    ],
  });

  socketHub.emit("message:new", {
    conversationId: params.conversationId,
    senderName: "ACRIO",
    text: outboundHandoffText,
  });

  if (routingSucceeded && assigned) {
    socketHub.emit("conversation:assigned", {
      conversationId: params.conversationId,
      assignedTeamName: assigned.assignedTeamName,
      assignedStaffName: assigned.assignedStaffName,
      escalationLevel: assigned.escalationLevel,
    });
  }
}

/**
 * Smart Team & Least-Loaded Agent Assignment Engine:
 * - Defaults ALWAYS to `Sales Team` (`team_sales`) when connecting from ACRIO or when no team is specified.
 * - Picks the available P0 responder with the fewest active open chats (falling back to P1, then P2).
 * - Starts `waiting_since` so customer wait time and P0 -> P1 -> P2 escalation are tracked automatically.
 */
export async function smartAssignConversation(params: {
  conversationId: string;
  inboundText?: string;
  preferredTeamId?: string;
  preferredTier?: "P0" | "P1" | "P2";
  allowKeywordRouting?: boolean;
  onlyIfUnassigned?: boolean;
  startWaitingTimer?: boolean;
  triggeredByName?: string;
  handoffReasonFromAcrio?: string;
  quoteProduct?: string;
  quoteQuantity?: string;
}): Promise<{
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  escalationLevel: "P0" | "P1" | "P2";
}> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();

  const existingRes = await conv.execute({
    sql: `SELECT * FROM conversations WHERE id = ? LIMIT 1`,
    args: [params.conversationId],
  });
  const current = existingRes.rows[0] as Record<string, unknown> | undefined;
  if (!current) {
    return {
      assignedTeamId: null,
      assignedTeamName: null,
      assignedStaffId: null,
      assignedStaffName: null,
      escalationLevel: "P0",
    };
  }

  const existingStaffId = current.assigned_staff_id
    ? String(current.assigned_staff_id)
    : "";
  if (params.onlyIfUnassigned && existingStaffId && existingStaffId !== "ACRIO") {
    if (params.startWaitingTimer && !current.waiting_since) {
      await conv.execute({
        sql: `UPDATE conversations SET waiting_since = ? WHERE id = ?`,
        args: [nowIso, params.conversationId],
      });
    }
    return {
      assignedTeamId: current.assigned_team_id ? String(current.assigned_team_id) : null,
      assignedTeamName: current.assigned_team_name ? String(current.assigned_team_name) : null,
      assignedStaffId: existingStaffId,
      assignedStaffName: current.assigned_staff_name ? String(current.assigned_staff_name) : null,
      escalationLevel: (String(current.escalation_level || "P0") as "P0" | "P1" | "P2"),
    };
  }

  const teamsRes = await conv.execute(
    `SELECT * FROM teams ORDER BY priority_rank ASC, created_at ASC`
  );
  const allTeams = teamsRes.rows as Record<string, unknown>[];
  if (allTeams.length === 0) {
    return {
      assignedTeamId: null,
      assignedTeamName: null,
      assignedStaffId: null,
      assignedStaffName: null,
      escalationLevel: "P0",
    };
  }

  const salesTeam =
    allTeams.find((t) => String(t.id) === "team_sales") ||
    allTeams.find((t) => /sales/i.test(String(t.name))) ||
    allTeams[0];

  let chosenTeam = params.preferredTeamId
    ? allTeams.find((t) => String(t.id) === params.preferredTeamId)
    : undefined;

  if (!chosenTeam && params.allowKeywordRouting) {
    const textLower = String(
      params.inboundText || current.last_message_preview || ""
    ).toLowerCase();
    for (const t of allTeams) {
      if (Number(t.auto_assign_enabled ?? 1) !== 1) continue;
      const kwList = String(t.routing_keywords || "")
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      if (kwList.some((kw) => textLower.includes(kw))) {
        chosenTeam = t;
        break;
      }
    }
  }

  // Default ALWAYS to Sales Team when connecting to staff
  if (!chosenTeam) {
    chosenTeam = salesTeam;
  }

  const teamId = String(chosenTeam.id);
  const teamName = String(chosenTeam.name);
  const auth = getRawLibSqlClient("core_auth");

  // Load active chat counts per staff member for smart least-loaded balancing (excluding DEV roles from auto-assign)
  const [membersRes, loadRes, devUsersRes] = await Promise.all([
    conv.execute({
      sql: `SELECT * FROM team_members WHERE team_id = ? AND is_available = 1`,
      args: [teamId],
    }),
    conv.execute(
      `SELECT assigned_staff_id, COUNT(*) as open_cnt
       FROM conversations
       WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL AND assigned_staff_id != 'ACRIO'
       GROUP BY assigned_staff_id`
    ),
    auth.execute(`SELECT id FROM users WHERE role = 'DEV'`),
  ]);

  const devUserIds = new Set(devUsersRes.rows.map((u) => String(u.id)));

  const loadMap = new Map<string, number>();
  for (const r of loadRes.rows) {
    loadMap.set(String(r.assigned_staff_id), Number(r.open_cnt ?? 0));
  }

  const tierOrder: ("P0" | "P1" | "P2")[] =
    params.preferredTier === "P1"
      ? ["P1", "P2", "P0"]
      : params.preferredTier === "P2"
      ? ["P2", "P1", "P0"]
      : ["P0", "P1", "P2"];

  let chosenMember: Record<string, unknown> | null = null;
  let chosenTier: "P0" | "P1" | "P2" = params.preferredTier || "P0";
  let stickyReasonOverride: string | null = null;

  // Check if customer requested someone specific, has a preferred staff member, or has an existing previous handler
  const stickyMatch = await resolveRequestedOrPreferredStaffForInbound({
    customerPhone: String(current.customer_phone || ""),
    inboundText: params.inboundText,
    conversationId: params.conversationId,
  }).catch(() => null);
  if (stickyMatch && !devUserIds.has(stickyMatch.staffId)) {
    chosenMember = {
      staff_id: stickyMatch.staffId,
      staff_name: stickyMatch.staffName,
      tier: chosenTier,
    };
    stickyReasonOverride = stickyMatch.reason;
  }

  for (const tier of tierOrder) {
    if (chosenMember) break;
    const candidates = (membersRes.rows as Record<string, unknown>[]).filter(
      (m) => String(m.tier) === tier && !devUserIds.has(String(m.staff_id))
    );
    if (candidates.length === 0) continue;

    candidates.sort((a, b) => {
      const loadA = loadMap.get(String(a.staff_id)) ?? 0;
      const loadB = loadMap.get(String(b.staff_id)) ?? 0;
      return loadA - loadB;
    });

    const underCap = candidates.find(
      (c) => (loadMap.get(String(c.staff_id)) ?? 0) < Number(c.max_active_chats ?? 15)
    );
    chosenMember = underCap || candidates[0];
    chosenTier = tier;
    break;
  }

  // Fallback: if chosenTeam had no available members, check any available non-DEV team member or active non-DEV user
  if (!chosenMember) {
    const anyTeamMemberRes = await conv.execute(
      `SELECT * FROM team_members WHERE is_available = 1`
    );
    const anyPool = (anyTeamMemberRes.rows as Record<string, unknown>[]).filter(
      (m) => !devUserIds.has(String(m.staff_id))
    );
    if (anyPool.length > 0) {
      anyPool.sort(
        (a, b) =>
          (loadMap.get(String(a.staff_id)) ?? 0) -
          (loadMap.get(String(b.staff_id)) ?? 0)
      );
      chosenMember = anyPool[0];
      chosenTier = (String(chosenMember.tier || "P0") as "P0" | "P1" | "P2");
    } else {
      const activeUsersRes = await auth.execute(
        `SELECT id, name FROM users WHERE status = 'ACTIVE' AND role != 'DEV' ORDER BY created_at ASC`
      );
      if (activeUsersRes.rows.length > 0) {
        const sortedUsers = [...activeUsersRes.rows].sort(
          (a, b) =>
            (loadMap.get(String(a.id)) ?? 0) - (loadMap.get(String(b.id)) ?? 0)
        );
        chosenMember = {
          staff_id: String(sortedUsers[0].id),
          staff_name: String(sortedUsers[0].name),
        };
      }
    }
  }

  const staffId = chosenMember ? String(chosenMember.staff_id) : null;
  const staffName = chosenMember ? String(chosenMember.staff_name) : null;

  await conv.execute({
    sql: `UPDATE conversations
          SET status = 'ASSIGNED',
              assigned_team_id = ?,
              assigned_team_name = ?,
              assigned_staff_id = ?,
              assigned_staff_name = ?,
              escalation_level = ?,
              waiting_since = CASE
                WHEN ? = 1 THEN COALESCE(waiting_since, ?)
                ELSE waiting_since
              END
          WHERE id = ?`,
    args: [
      teamId,
      teamName,
      staffId,
      staffName,
      chosenTier,
      params.startWaitingTimer ? 1 : 0,
      nowIso,
      params.conversationId,
    ],
  });

  const assignmentReason =
    stickyReasonOverride ||
    params.handoffReasonFromAcrio ||
    `Smart-assigned to least-loaded ${chosenTier} responder in ${teamName}`;

  await logConversationAssignment({
    conversationId: params.conversationId,
    customerPhone: String(current.customer_phone || ""),
    customerName: String(current.customer_name || ""),
    fromStaffId: current.assigned_staff_id ? String(current.assigned_staff_id) : null,
    fromStaffName: current.assigned_staff_name ? String(current.assigned_staff_name) : null,
    fromTeamName: current.assigned_team_name ? String(current.assigned_team_name) : null,
    toStaffId: staffId,
    toStaffName: staffName || teamName,
    toTeamId: teamId,
    toTeamName: teamName,
    escalationLevel: chosenTier,
    assignmentSource: params.handoffReasonFromAcrio
      ? "ACRIO_HANDOFF"
      : "SMART_ASSIGN",
    assignedByName: params.handoffReasonFromAcrio
      ? "System (ACRIO)"
      : params.triggeredByName || "Smart Router",
    reason: assignmentReason,
    assignedAt: nowIso,
  });

  // Notify assigned individual staff member via email & WhatsApp template (`cc_quote_request_alert` or `cc_staff_client_assignment`)
  if (staffId && staffId !== "ACRIO" && staffId !== existingStaffId) {
    void sendStaffAssignmentEmailNotification({
      staffId,
      staffName: staffName || "Team Member",
      customerName: String(current.customer_name || current.customer_phone || "Customer"),
      customerPhone: String(current.customer_phone || ""),
      smartCategory: String(current.smart_category || "General Enquiry"),
      priority: String(current.priority || "HIGH"),
      escalationLevel: chosenTier,
      teamName,
      reason: assignmentReason,
      latestMessage: String(
        params.inboundText || current.last_message_preview || ""
      ),
      quoteProduct: params.quoteProduct,
      quoteQuantity: params.quoteQuantity,
      conversationId: params.conversationId,
      isEscalation: false,
    }).catch(() => {});
  }

  socketHub.emit("conversation:assigned", {
    conversationId: params.conversationId,
    assignedTeamName: teamName,
    assignedStaffName: staffName,
    escalationLevel: chosenTier,
  });

  return {
    assignedTeamId: teamId,
    assignedTeamName: teamName,
    assignedStaffId: staffId,
    assignedStaffName: staffName,
    escalationLevel: chosenTier,
  };
}

/**
 * Automatic P0 -> P1 -> P2 Wait-Time Escalation Engine:
 * Checks open/assigned chats where `waiting_since` is active.
 * If customer waits past team's P0 threshold -> escalates to P1 responder + logs Internal Team Note.
 * If customer waits past team's P1 threshold -> escalates to P2 lead + logs Internal Team Note.
 */
export async function checkAndEscalateWaitingChats(): Promise<number> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const auth = getRawLibSqlClient("core_auth");
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Only escalate unattended initial leads where NO assigned human staff reply has been sent yet in the active ticket.
  // Once a staff member initiates or replies to the client, the chat stays with them forever unless manually reassigned/taken over.
  const [waitingRes, teamsRes, membersRes, loadRes, devUsersRes] = await Promise.all([
    conv.execute(
      `SELECT c.* FROM conversations c
       WHERE c.status != 'RESOLVED'
         AND c.waiting_since IS NOT NULL
         AND COALESCE(c.assigned_staff_id, '') != 'ACRIO'
         AND NOT EXISTS (
           SELECT 1 FROM messages m
           WHERE m.conversation_id = c.id
             AND m.direction = 'OUTBOUND'
             AND m.sender_type = 'STAFF'
             AND (
               c.resolved_at IS NULL
               OR TRIM(c.resolved_at) = ''
               OR m.created_at > c.resolved_at
             )
         )`
    ),
    conv.execute(`SELECT * FROM teams`),
    conv.execute(`SELECT * FROM team_members WHERE is_available = 1`),
    conv.execute(
      `SELECT assigned_staff_id, COUNT(*) as open_cnt
       FROM conversations
       WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL AND assigned_staff_id != 'ACRIO'
       GROUP BY assigned_staff_id`
    ),
    auth.execute(`SELECT id FROM users WHERE role = 'DEV'`),
  ]);

  if (waitingRes.rows.length === 0) return 0;

  const devUserIds = new Set(devUsersRes.rows.map((u) => String(u.id)));

  const teamMap = new Map<string, Record<string, unknown>>();
  for (const t of teamsRes.rows) {
    teamMap.set(String(t.id), t as Record<string, unknown>);
  }
  const defaultTeam =
    teamMap.get("team_sales") ||
    (teamsRes.rows[0] as Record<string, unknown> | undefined);

  const loadMap = new Map<string, number>();
  for (const r of loadRes.rows) {
    loadMap.set(String(r.assigned_staff_id), Number(r.open_cnt ?? 0));
  }

  let escalatedCount = 0;

  for (const row of waitingRes.rows) {
    const convId = String(row.id);
    const waitingSinceMs = new Date(String(row.waiting_since)).getTime();
    if (Number.isNaN(waitingSinceMs)) continue;

    const waitedMinutes = (nowMs - waitingSinceMs) / 60000;
    const currentLevel = String(row.escalation_level || "P0") as "P0" | "P1" | "P2";
    const teamId = row.assigned_team_id
      ? String(row.assigned_team_id)
      : defaultTeam
      ? String(defaultTeam.id)
      : "";
    const team = teamMap.get(teamId) || defaultTeam;
    const teamName = team ? String(team.name) : "Sales Team";

    const p0Wait = Number(team?.p0_wait_minutes ?? 5);
    const p1Wait = Number(team?.p1_wait_minutes ?? 12);

    let targetTier: "P1" | "P2" | null = null;
    if (currentLevel === "P0" && waitedMinutes >= p0Wait) {
      targetTier = "P1";
    } else if (currentLevel === "P1" && waitedMinutes >= p1Wait) {
      targetTier = "P2";
    }

    if (!targetTier) continue;

    const teamMembers = (membersRes.rows as Record<string, unknown>[]).filter(
      (m) =>
        String(m.team_id) === teamId &&
        String(m.tier) === targetTier &&
        !devUserIds.has(String(m.staff_id))
    );
    const fallbackMembers =
      teamMembers.length > 0
        ? teamMembers
        : (membersRes.rows as Record<string, unknown>[]).filter(
            (m) =>
              String(m.tier) === targetTier &&
              !devUserIds.has(String(m.staff_id))
          );

    fallbackMembers.sort((a, b) => {
      const loadA = loadMap.get(String(a.staff_id)) ?? 0;
      const loadB = loadMap.get(String(b.staff_id)) ?? 0;
      return loadA - loadB;
    });

    const nextResponder = fallbackMembers[0];
    const nextStaffId = nextResponder
      ? String(nextResponder.staff_id)
      : row.assigned_staff_id
      ? String(row.assigned_staff_id)
      : null;
    const nextStaffName = nextResponder
      ? String(nextResponder.staff_name)
      : row.assigned_staff_name
      ? String(row.assigned_staff_name)
      : "Team Lead";

    const nextPriority = targetTier === "P2" ? "URGENT" : "HIGH";
    const roundedMins = Math.max(1, Math.floor(waitedMinutes));

    await conv.execute({
      sql: `UPDATE conversations
            SET status = 'ASSIGNED',
                assigned_team_id = COALESCE(assigned_team_id, ?),
                assigned_team_name = COALESCE(assigned_team_name, ?),
                assigned_staff_id = ?,
                assigned_staff_name = ?,
                escalation_level = ?,
                priority = ?,
                escalated_at = ?
            WHERE id = ?`,
      args: [
        teamId || null,
        teamName,
        nextStaffId,
        nextStaffName,
        targetTier,
        nextPriority,
        nowIso,
        convId,
      ],
    });

    await logConversationAssignment({
      conversationId: convId,
      customerPhone: String(row.customer_phone || ""),
      customerName: String(row.customer_name || ""),
      fromStaffId: row.assigned_staff_id ? String(row.assigned_staff_id) : null,
      fromStaffName: row.assigned_staff_name ? String(row.assigned_staff_name) : null,
      fromTeamName: row.assigned_team_name ? String(row.assigned_team_name) : teamName,
      toStaffId: nextStaffId,
      toStaffName: nextStaffName,
      toTeamId: teamId || null,
      toTeamName: teamName,
      escalationLevel: targetTier,
      assignmentSource: "AUTO_ESCALATION",
      assignedByName: "Wait-Time Escalation",
      reason: `Customer waited ${roundedMins} min without a reply. Escalated from ${currentLevel} to ${targetTier}.`,
      assignedAt: nowIso,
    });

    if (
      nextStaffId &&
      nextStaffId !== "ACRIO" &&
      nextStaffId !== String(row.assigned_staff_id || "")
    ) {
      void sendStaffAssignmentEmailNotification({
        staffId: nextStaffId,
        staffName: nextStaffName,
        customerName: String(row.customer_name || row.customer_phone || "Customer"),
        customerPhone: String(row.customer_phone || ""),
        smartCategory: String(row.smart_category || "General Enquiry"),
        priority: nextPriority,
        escalationLevel: targetTier,
        teamName,
        reason: `Customer waited ${roundedMins} min without a reply. Escalated from ${currentLevel} to ${targetTier}.`,
        latestMessage: String(row.last_message_preview || ""),
        conversationId: convId,
        isEscalation: true,
      }).catch(() => {});
    }

    escalatedCount++;
    socketHub.emit("conversation:escalated", {
      conversationId: convId,
      fromTier: currentLevel,
      toTier: targetTier,
      assignedStaffName: nextStaffName,
      teamName,
      waitedMinutes: roundedMins,
    });
  }

  return escalatedCount;
}

/**
 * Processes pending jobs across queues (`backup:midnight_gdrive`, `whatsapp:broadcast`, etc.)
 */
export async function drainPendingWorkerJobs(): Promise<number> {
  await requeueStaleStaffNoteJobs();
  const jobs = await claimPendingJobs(undefined, 8);
  let processed = 0;

  for (const job of jobs) {
    try {
      if (job.queueName === "backup:midnight_gdrive") {
        const source =
          job.payload.triggerSource === "MANUAL_DEV"
            ? "MANUAL_DEV"
            : "MIDNIGHT_CRON";
        const res = await executeMultiDatabaseBackup(source);
        if (!res.ok) throw new Error(res.detailsMessage);
      } else if (job.queueName === "whatsapp:broadcast") {
        await executeBroadcastJob(job.payload);
      } else if (job.queueName === "acrio:staff_note_answer") {
        await runStaffNoteAnswerJob(job.payload);
      }
      await completeJob(job.id);
      processed++;
    } catch (err: any) {
      await failJob(job, err?.message || "Worker job error");
    }
  }

  await recordWorkerHeartbeat("cc-primary-worker", "ONLINE", processed, {
    lastCheckedAt: new Date().toISOString(),
  });

  if (processed > 0) {
    socketHub.emit("queue:updated", { processed });
  }
  return processed;
}

export type BroadcastPacingMode =
  | "SAFE_STEADY"
  | "EXTRA_CAREFUL"
  | "WARMED_FAST";

export interface BroadcastQueueSafetySettings {
  defaultPacingMode: BroadcastPacingMode;
  delaySeconds: number;
  batchSize: number;
  batchPauseSeconds: number;
  skipRecentHours: number;
  dailyMarketingCap: number;
  autoPauseOnConsecutiveFailures: number;
  quietHoursEnabled: boolean;
  sentTodayMarketingCount: number;
}

export async function getBroadcastQueueSettings(): Promise<BroadcastQueueSafetySettings> {
  await ensureDatabasesBootstrapped();
  const mkt = getRawLibSqlClient("marketing");
  const { dateKey } = getCurrentIstDateAndTime();
  const startOfDayIso = fromZonedTime(`${dateKey} 00:00:00`, APP_TIMEZONE).toISOString();

  const [cfgRes, todayRes] = await Promise.all([
    mkt.execute(
      `SELECT * FROM broadcast_queue_settings WHERE id = 'default' LIMIT 1`
    ),
    mkt.execute({
      sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients r
            JOIN broadcasts b ON b.id = r.broadcast_id
            WHERE b.billing_category = 'MARKETING'
              AND r.status IN ('SENT', 'DELIVERED', 'READ')
              AND r.sent_at >= ?`,
      args: [startOfDayIso],
    }),
  ]);

  const row = (cfgRes.rows[0] || {}) as Record<string, unknown>;
  const modeRaw = String(row.default_pacing_mode || "SAFE_STEADY");
  const defaultPacingMode: BroadcastPacingMode =
    modeRaw === "EXTRA_CAREFUL" || modeRaw === "WARMED_FAST"
      ? modeRaw
      : "SAFE_STEADY";

  return {
    defaultPacingMode,
    delaySeconds: Math.max(1, Number(row.delay_seconds ?? 4)),
    batchSize: Math.max(5, Number(row.batch_size ?? 25)),
    batchPauseSeconds: Math.max(0, Number(row.batch_pause_seconds ?? 20)),
    skipRecentHours: Math.max(0, Number(row.skip_recent_hours ?? 24)),
    dailyMarketingCap: Math.max(10, Number(row.daily_marketing_cap ?? 250)),
    autoPauseOnConsecutiveFailures: Math.max(
      1,
      Number(row.auto_pause_on_consecutive_failures ?? 3)
    ),
    quietHoursEnabled: Number(row.quiet_hours_enabled ?? 0) === 1,
    sentTodayMarketingCount: Number(todayRes.rows[0]?.cnt ?? 0),
  };
}

export async function updateBroadcastQueueSettings(params: {
  defaultPacingMode?: BroadcastPacingMode;
  delaySeconds?: number;
  batchSize?: number;
  batchPauseSeconds?: number;
  skipRecentHours?: number;
  dailyMarketingCap?: number;
  autoPauseOnConsecutiveFailures?: number;
  quietHoursEnabled?: boolean;
  updatedBy: string;
}): Promise<BroadcastQueueSafetySettings> {
  const current = await getBroadcastQueueSettings();
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();

  const nextMode = params.defaultPacingMode || current.defaultPacingMode;
  const nextDelay =
    params.delaySeconds !== undefined
      ? Math.max(1, Math.min(120, Math.round(params.delaySeconds)))
      : current.delaySeconds;
  const nextBatch =
    params.batchSize !== undefined
      ? Math.max(5, Math.min(200, Math.round(params.batchSize)))
      : current.batchSize;
  const nextPause =
    params.batchPauseSeconds !== undefined
      ? Math.max(0, Math.min(600, Math.round(params.batchPauseSeconds)))
      : current.batchPauseSeconds;
  const nextSkipHrs =
    params.skipRecentHours !== undefined
      ? Math.max(0, Math.min(720, Math.round(params.skipRecentHours)))
      : current.skipRecentHours;
  const nextDailyCap =
    params.dailyMarketingCap !== undefined
      ? Math.max(10, Math.min(500000, Math.round(params.dailyMarketingCap)))
      : current.dailyMarketingCap;
  const nextAutoPause =
    params.autoPauseOnConsecutiveFailures !== undefined
      ? Math.max(
          1,
          Math.min(20, Math.round(params.autoPauseOnConsecutiveFailures))
        )
      : current.autoPauseOnConsecutiveFailures;
  const nextQuiet =
    params.quietHoursEnabled !== undefined
      ? params.quietHoursEnabled
      : current.quietHoursEnabled;

  await mkt.execute({
    sql: `UPDATE broadcast_queue_settings
          SET default_pacing_mode = ?,
              delay_seconds = ?,
              batch_size = ?,
              batch_pause_seconds = ?,
              skip_recent_hours = ?,
              daily_marketing_cap = ?,
              auto_pause_on_consecutive_failures = ?,
              quiet_hours_enabled = ?,
              updated_by = ?,
              updated_at = ?
          WHERE id = 'default'`,
    args: [
      nextMode,
      nextDelay,
      nextBatch,
      nextPause,
      nextSkipHrs,
      nextDailyCap,
      nextAutoPause,
      nextQuiet ? 1 : 0,
      params.updatedBy,
      nowIso,
    ],
  });

  return getBroadcastQueueSettings();
}

function pacingDefaultsForMode(
  mode: BroadcastPacingMode,
  fallback: BroadcastQueueSafetySettings
): { delaySeconds: number; batchSize: number; batchPauseSeconds: number } {
  if (mode === "EXTRA_CAREFUL") {
    return { delaySeconds: 8, batchSize: 15, batchPauseSeconds: 30 };
  }
  if (mode === "WARMED_FAST") {
    return { delaySeconds: 2, batchSize: 40, batchPauseSeconds: 15 };
  }
  return {
    delaySeconds: fallback.delaySeconds || 4,
    batchSize: fallback.batchSize || 25,
    batchPauseSeconds: fallback.batchPauseSeconds ?? 20,
  };
}

/**
 * Enqueues a marketing or utility broadcast into the anti-spam recipient queue:
 * - Deduplicates phones
 * - Skips opted-out contacts (`opt_in_marketing = 0`)
 * - Skips contacts already messaged within `skipRecentHours` (for MARKETING)
 * - Enforces `dailyMarketingCap` so Meta's messaging tier limit is never breached
 * - Staggers `scheduled_at` slots across `delaySeconds` + `batchPauseSeconds`
 */
export async function enqueueBroadcastIntoSafeQueue(params: {
  name?: string;
  listId: string;
  templateId: string;
  pacingMode?: BroadcastPacingMode;
  skipRecentHoursOverride?: number;
  scheduledForIso?: string | null;
  customVariablesOverride?: Record<string, string>;
  createdByName: string;
}): Promise<{
  ok: boolean;
  broadcastId?: string;
  queuedCount?: number;
  skippedCount?: number;
  estimatedDurationSeconds?: number;
  error?: string;
}> {
  await ensureDatabasesBootstrapped();
  const mkt = getRawLibSqlClient("marketing");
  const crm = getRawLibSqlClient("crm_orders");

  const [lRes, tRes, settings] = await Promise.all([
    mkt.execute({
      sql: `SELECT * FROM marketing_lists WHERE id = ? LIMIT 1`,
      args: [params.listId],
    }),
    mkt.execute({
      sql: `SELECT * FROM templates WHERE id = ? LIMIT 1`,
      args: [params.templateId],
    }),
    getBroadcastQueueSettings(),
  ]);

  if (!lRes.rows[0] || !tRes.rows[0]) {
    return { ok: false, error: "Please select a valid customer list and template." };
  }

  const listRow = lRes.rows[0] as Record<string, unknown>;
  const tplRow = tRes.rows[0] as Record<string, unknown>;

  if (String(tplRow.approval_status) !== "APPROVED") {
    return {
      ok: false,
      error: `Template "${String(tplRow.name)}" is currently ${String(
        tplRow.approval_status
      )}. Only Approved templates can be sent in broadcasts.`,
    };
  }

  let rawPhones: string[] = [];
  try {
    rawPhones = JSON.parse(String(listRow.member_phones_json || "[]"));
  } catch {
    rawPhones = [];
  }

  // Deduplicate phones while preserving order
  const seenDigits = new Set<string>();
  const uniquePhones: string[] = [];
  for (const p of rawPhones) {
    const d = String(p || "").replace(/\D/g, "");
    if (d.length >= 10 && !seenDigits.has(d)) {
      seenDigits.add(d);
      uniquePhones.push(p.startsWith("+") ? p : `+${d}`);
    }
  }

  if (uniquePhones.length === 0) {
    return { ok: false, error: "This customer list has no valid WhatsApp phone numbers." };
  }

  const mode: BroadcastPacingMode =
    params.pacingMode || settings.defaultPacingMode;
  const pacing = pacingDefaultsForMode(mode, settings);
  const skipRecentHours =
    params.skipRecentHoursOverride !== undefined
      ? Math.max(0, Number(params.skipRecentHoursOverride))
      : settings.skipRecentHours;

  const category = String(tplRow.category || "MARKETING") as BillingMessageCategory;
  const tplBody = String(tplRow.body_text || "");
  let varSpecs: Array<{
    index: number;
    sourceField?: string;
    sampleValue?: string;
  }> = [];
  try {
    varSpecs = JSON.parse(String(tplRow.variables_schema_json || "[]"));
  } catch {
    varSpecs = [];
  }

  // Fetch customer profiles & latest order numbers in bulk
  const [custRes, ordersRes] = await Promise.all([
    crm.execute(`SELECT * FROM customers`),
    crm.execute(`SELECT customer_phone, order_number FROM customer_orders ORDER BY ordered_at DESC`),
  ]);

  const customerByPhone = new Map<string, Record<string, unknown>>();
  for (const c of custRes.rows) {
    const d = String(c.phone || "").replace(/\D/g, "");
    if (d) customerByPhone.set(d, c as Record<string, unknown>);
  }
  const latestOrderByPhone = new Map<string, string>();
  for (const o of ordersRes.rows) {
    const d = String(o.customer_phone || "").replace(/\D/g, "");
    if (d && !latestOrderByPhone.has(d)) {
      latestOrderByPhone.set(d, String(o.order_number));
    }
  }

  // Recent broadcast cooldown lookup
  const recentlyMessagedDigits = new Set<string>();
  if (category === "MARKETING" && skipRecentHours > 0) {
    const cutoffIso = new Date(
      Date.now() - skipRecentHours * 3600 * 1000
    ).toISOString();
    const recentRes = await mkt.execute({
      sql: `SELECT DISTINCT customer_phone FROM broadcast_recipients
            WHERE status IN ('SENT', 'DELIVERED', 'READ') AND sent_at >= ?`,
      args: [cutoffIso],
    });
    for (const r of recentRes.rows) {
      const d = String(r.customer_phone || "").replace(/\D/g, "");
      if (d) recentlyMessagedDigits.add(d);
    }
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const startBaseMs =
    params.scheduledForIso &&
    !Number.isNaN(new Date(params.scheduledForIso).getTime()) &&
    new Date(params.scheduledForIso).getTime() > nowMs
      ? new Date(params.scheduledForIso).getTime()
      : nowMs;
  const isScheduledFuture = startBaseMs > nowMs + 5000;

  const bcId = `bc_${crypto.randomUUID().slice(0, 8)}`;
  const remainingDailyAllowance =
    category === "MARKETING"
      ? Math.max(0, settings.dailyMarketingCap - settings.sentTodayMarketingCount)
      : Number.MAX_SAFE_INTEGER;

  let queuedCount = 0;
  let skippedCount = 0;
  let cumulativeDelaySec = 0;
  const recipientInserts: Array<{ sql: string; args: any[] }> = [];

  const bodyVarIndices = Array.from(
    new Set(Array.from(tplBody.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1])))
  ).sort((a, b) => a - b);

  for (const phone of uniquePhones) {
    const digits = phone.replace(/\D/g, "");
    const cust = customerByPhone.get(digits);
    const custName = cust ? String(cust.name || phone) : phone;
    const firstName = custName.split(/[\s(]/)[0] || "Sir/Madam";
    const optIn = cust ? Number(cust.opt_in_marketing ?? 1) === 1 : true;

    let skipReason: string | null = null;
    if (!optIn && category === "MARKETING") {
      skipReason = "Customer opted out of promotions";
    } else if (category === "MARKETING" && recentlyMessagedDigits.has(digits)) {
      skipReason = `Already received a broadcast in the last ${skipRecentHours}h`;
    } else if (category === "MARKETING" && queuedCount >= remainingDailyAllowance) {
      skipReason = `Daily WhatsApp marketing cap (${settings.dailyMarketingCap}/day) reached`;
    }

    // Resolve personalized variables
    const resolvedVars = bodyVarIndices.map((idx) => {
      const overrideVal = params.customVariablesOverride?.[String(idx)];
      if (overrideVal && overrideVal.trim()) return overrideVal.trim();

      const spec = varSpecs.find((v) => v.index === idx);
      const src = spec?.sourceField || (idx === 1 ? "customer.firstName" : "custom");
      if (src === "customer.firstName") return firstName;
      if (src === "customer.fullName") return custName;
      if (src === "customer.companyName")
        return String(cust?.company_name || firstName);
      if (src === "customer.city") return String(cust?.city || "India");
      if (src === "order.latestNumber")
        return latestOrderByPhone.get(digits) || spec?.sampleValue || "CC-2026";
      return spec?.sampleValue || firstName;
    });

    let renderedBody = tplBody;
    bodyVarIndices.forEach((idx, pos) => {
      renderedBody = renderedBody.replace(
        new RegExp(`\\{\\{${idx}\\}\\}`, "g"),
        resolvedVars[pos] || ""
      );
    });

    if (skipReason) {
      skippedCount++;
      recipientInserts.push({
        sql: `INSERT INTO broadcast_recipients (
          id, broadcast_id, customer_name, customer_phone, variables_json, rendered_body,
          status, skip_or_error_reason, attempts, scheduled_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'SKIPPED', ?, 0, ?, ?)`,
        args: [
          `bcr_${crypto.randomUUID().slice(0, 8)}`,
          bcId,
          custName,
          phone,
          JSON.stringify(resolvedVars),
          renderedBody,
          skipReason,
          nowIso,
          nowIso,
        ],
      });
      continue;
    }

    if (queuedCount > 0) {
      cumulativeDelaySec += pacing.delaySeconds;
      if (queuedCount % pacing.batchSize === 0) {
        cumulativeDelaySec += pacing.batchPauseSeconds;
      }
    }
    const scheduledIso = new Date(
      startBaseMs + cumulativeDelaySec * 1000
    ).toISOString();
    queuedCount++;

    recipientInserts.push({
      sql: `INSERT INTO broadcast_recipients (
        id, broadcast_id, customer_name, customer_phone, variables_json, rendered_body,
        status, attempts, scheduled_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', 0, ?, ?)`,
      args: [
        `bcr_${crypto.randomUUID().slice(0, 8)}`,
        bcId,
        custName,
        phone,
        JSON.stringify(resolvedVars),
        renderedBody,
        scheduledIso,
        nowIso,
      ],
    });
  }

  const initialStatus =
    queuedCount === 0
      ? "COMPLETED"
      : isScheduledFuture
      ? "SCHEDULED"
      : "SENDING";

  await mkt.batch(
    [
      {
        sql: `INSERT INTO broadcasts (
          id, name, list_id, list_name, template_id, template_name, billing_category,
          status, pacing_mode, delay_seconds, batch_size, batch_pause_seconds, skip_recent_hours,
          total_recipients, queued_count, skipped_count, failed_count, sent_count, delivered_count, read_count,
          client_billed_inr, actual_meta_cost_inr, scheduled_for, next_dispatch_at, started_at, completed_at,
          created_by_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?)`,
        args: [
          bcId,
          (params.name || "").trim() || `${String(listRow.name)} Campaign`,
          params.listId,
          String(listRow.name),
          params.templateId,
          String(tplRow.name),
          category,
          initialStatus,
          mode,
          pacing.delaySeconds,
          pacing.batchSize,
          pacing.batchPauseSeconds,
          skipRecentHours,
          uniquePhones.length,
          queuedCount,
          skippedCount,
          isScheduledFuture ? new Date(startBaseMs).toISOString() : null,
          queuedCount > 0 ? new Date(startBaseMs).toISOString() : null,
          !isScheduledFuture && queuedCount > 0 ? nowIso : null,
          queuedCount === 0 ? nowIso : null,
          params.createdByName,
          nowIso,
        ],
      },
      ...recipientInserts,
    ],
    "write"
  );

  ensureBackgroundWorkersRunning();
  if (!isScheduledFuture && queuedCount > 0) {
    void processMarketingBroadcastQueue().catch(() => {});
  }

  socketHub.emit("broadcast:progress", {
    broadcastId: bcId,
    status: initialStatus,
    queuedCount,
    skippedCount,
    sent: 0,
  });

  return {
    ok: true,
    broadcastId: bcId,
    queuedCount,
    skippedCount,
    estimatedDurationSeconds: cumulativeDelaySec,
  };
}

/**
 * Legacy queue job bridge in case `whatsapp:broadcast` job exists in `queue_jobs.db`
 */
async function executeBroadcastJob(_payload: Record<string, unknown>): Promise<void> {
  await processMarketingBroadcastQueue();
}

/**
 * Safe Paced Marketing Broadcast Queue Worker:
 * Sends at most 1 message per active campaign per tick according to `delay_seconds`
 * and `batch_pause_seconds`, with automatic circuit-breaker pause if Meta flags rate/spam errors!
 */
export async function processMarketingBroadcastQueue(): Promise<number> {
  if (globalWorkerRunner.__ccMarketingQueueRunning) return 0;
  globalWorkerRunner.__ccMarketingQueueRunning = true;

  let dispatchedCount = 0;
  try {
    await ensureDatabasesBootstrapped();
    const mkt = getRawLibSqlClient("marketing");
    const settings = await getBroadcastQueueSettings();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // Activate any SCHEDULED broadcasts whose scheduled start time has arrived
    await mkt.execute({
      sql: `UPDATE broadcasts
            SET status = 'SENDING',
                started_at = COALESCE(started_at, ?)
            WHERE status = 'SCHEDULED'
              AND scheduled_for IS NOT NULL
              AND scheduled_for <= ?`,
      args: [nowIso, nowIso],
    });

    const activeRes = await mkt.execute({
      sql: `SELECT * FROM broadcasts
            WHERE status IN ('QUEUED', 'SENDING')
              AND (next_dispatch_at IS NULL OR next_dispatch_at <= ?)
            ORDER BY created_at ASC
            LIMIT 3`,
      args: [nowIso],
    });

    for (const bRow of activeRes.rows) {
      const bcId = String(bRow.id);
      const delaySec = Math.max(1, Number(bRow.delay_seconds ?? 4));
      const batchSize = Math.max(5, Number(bRow.batch_size ?? 25));
      const batchPauseSec = Math.max(0, Number(bRow.batch_pause_seconds ?? 20));
      const category = String(
        bRow.billing_category || "MARKETING"
      ) as BillingMessageCategory;

      // Pick the single next queued recipient due for sending
      const nextRecRes = await mkt.execute({
        sql: `SELECT * FROM broadcast_recipients
              WHERE broadcast_id = ? AND status = 'QUEUED'
              ORDER BY scheduled_at ASC, created_at ASC
              LIMIT 1`,
        args: [bcId],
      });

      const rec = nextRecRes.rows[0] as Record<string, unknown> | undefined;
      if (!rec) {
        // No more QUEUED recipients -> finalize campaign as COMPLETED
        await mkt.execute({
          sql: `UPDATE broadcasts
                SET status = 'COMPLETED',
                    queued_count = 0,
                    next_dispatch_at = NULL,
                    completed_at = COALESCE(completed_at, ?)
                WHERE id = ?`,
          args: [nowIso, bcId],
        });
        socketHub.emit("broadcast:progress", {
          broadcastId: bcId,
          status: "COMPLETED",
        });
        continue;
      }

      // Fetch template details for structured Meta components
      const tplRes = await mkt.execute({
        sql: `SELECT * FROM templates WHERE id = ? LIMIT 1`,
        args: [String(bRow.template_id)],
      });
      const tpl = (tplRes.rows[0] || {}) as Record<string, unknown>;
      const tplName = String(tpl.name || bRow.template_name || "");
      const tplLang = String(tpl.language || "en");
      const headerType = String(tpl.header_type || "NONE");
      const headerMediaUrl = tpl.header_media_url
        ? String(tpl.header_media_url)
        : "";

      let resolvedVars: string[] = [];
      try {
        resolvedVars = JSON.parse(String(rec.variables_json || "[]"));
      } catch {
        resolvedVars = [];
      }

      const templateComponents: Record<string, unknown>[] = [];
      if (
        (headerType === "IMAGE" ||
          headerType === "VIDEO" ||
          headerType === "DOCUMENT") &&
        headerMediaUrl
      ) {
        const mediaKey = headerType.toLowerCase();
        templateComponents.push({
          type: "header",
          parameters: [
            {
              type: mediaKey,
              [mediaKey]: { link: headerMediaUrl },
            },
          ],
        });
      }
      if (resolvedVars.length > 0) {
        templateComponents.push({
          type: "body",
          parameters: resolvedVars.map((val) => ({
            type: "text",
            text: String(val),
          })),
        });
      }

      const recId = String(rec.id);
      const phone = String(rec.customer_phone);
      const renderedBody = String(rec.rendered_body || tpl.body_text || "");

      await mkt.execute({
        sql: `UPDATE broadcast_recipients SET status = 'SENDING', attempts = attempts + 1 WHERE id = ?`,
        args: [recId],
      });

      const out = await sendWhatsAppCloudMessage({
        toPhone: phone,
        bodyText: renderedBody,
        templateName: tplName,
        languageCode: tplLang,
        templateComponents,
      });

      const finishedAtMs = Date.now();
      const finishedIso = new Date(finishedAtMs).toISOString();

      if (out.ok) {
        dispatchedCount++;
        const billed = await recordDualPricingLedgerEntry({
          broadcastId: bcId,
          customerPhone: phone,
          category,
          staffName: `Broadcast: ${String(bRow.name)}`,
        });

        const nextSentCount = Number(bRow.sent_count ?? 0) + 1;
        const isBatchBoundary = nextSentCount % batchSize === 0;
        const waitSeconds =
          delaySec + (isBatchBoundary ? batchPauseSec : 0);
        const nextDispatchIso = new Date(
          finishedAtMs + waitSeconds * 1000
        ).toISOString();

        await mkt.batch(
          [
            {
              sql: `UPDATE broadcast_recipients
                    SET status = ?,
                        sent_at = ?,
                        wa_message_id = ?,
                        skip_or_error_reason = NULL
                    WHERE id = ?`,
              args: [
                out.deliveryStatus === "DELIVERED" ? "DELIVERED" : "SENT",
                finishedIso,
                out.waMessageId,
                recId,
              ],
            },
            {
              sql: `UPDATE templates SET sent_count = sent_count + 1 WHERE id = ?`,
              args: [String(bRow.template_id)],
            },
          ],
          "write"
        );

        // Recount remaining queued items accurately
        const remRes = await mkt.execute({
          sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'QUEUED'`,
          args: [bcId],
        });
        const remainingQueued = Number(remRes.rows[0]?.cnt ?? 0);
        const nextStatus = remainingQueued === 0 ? "COMPLETED" : "SENDING";

        await mkt.execute({
          sql: `UPDATE broadcasts
                SET status = ?,
                    sent_count = sent_count + 1,
                    delivered_count = delivered_count + (CASE WHEN ? = 'DELIVERED' THEN 1 ELSE 0 END),
                    queued_count = ?,
                    consecutive_failures = 0,
                    client_billed_inr = ROUND(client_billed_inr + ?, 2),
                    actual_meta_cost_inr = ROUND(actual_meta_cost_inr + ?, 4),
                    next_dispatch_at = ?,
                    started_at = COALESCE(started_at, ?),
                    completed_at = CASE WHEN ? = 0 THEN ? ELSE completed_at END
                WHERE id = ?`,
          args: [
            nextStatus,
            out.deliveryStatus,
            remainingQueued,
            billed.clientUnitRateInr,
            billed.actualMetaUnitCostInr,
            remainingQueued > 0 ? nextDispatchIso : null,
            finishedIso,
            remainingQueued,
            finishedIso,
            bcId,
          ],
        });

        socketHub.emit("broadcast:progress", {
          broadcastId: bcId,
          status: nextStatus,
          sentCount: nextSentCount,
          queuedCount: remainingQueued,
          nextDispatchAt: remainingQueued > 0 ? nextDispatchIso : null,
        });
      } else {
        const nextConsecutiveFailures =
          Number(bRow.consecutive_failures ?? 0) + 1;
        const shouldCircuitBreak =
          Boolean(out.isRateOrSpamBlock) ||
          nextConsecutiveFailures >= settings.autoPauseOnConsecutiveFailures;

        await mkt.execute({
          sql: `UPDATE broadcast_recipients
                SET status = 'FAILED',
                    skip_or_error_reason = ?
                WHERE id = ?`,
          args: [out.error || "Delivery failed", recId],
        });

        const remRes = await mkt.execute({
          sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'QUEUED'`,
          args: [bcId],
        });
        const remainingQueued = Number(remRes.rows[0]?.cnt ?? 0);

        if (shouldCircuitBreak && remainingQueued > 0) {
          const pauseReason = out.isRateOrSpamBlock
            ? `Paused automatically to protect your WhatsApp number from Meta rate limits (${out.error || "rate limit"}). Wait 15 minutes before resuming.`
            : `Paused automatically after ${nextConsecutiveFailures} failed messages in a row (${out.error || "send error"}). Check settings and click Resume.`;

          await mkt.execute({
            sql: `UPDATE broadcasts
                  SET status = 'PAUSED',
                      failed_count = failed_count + 1,
                      queued_count = ?,
                      consecutive_failures = ?,
                      paused_reason = ?,
                      next_dispatch_at = NULL
                  WHERE id = ?`,
            args: [remainingQueued, nextConsecutiveFailures, pauseReason, bcId],
          });

          socketHub.emit("broadcast:progress", {
            broadcastId: bcId,
            status: "PAUSED",
            pausedReason: pauseReason,
          });
        } else {
          const nextStatus = remainingQueued === 0 ? "COMPLETED" : "SENDING";
          const nextDispatchIso = new Date(
            finishedAtMs + delaySec * 1000
          ).toISOString();
          await mkt.execute({
            sql: `UPDATE broadcasts
                  SET status = ?,
                      failed_count = failed_count + 1,
                      queued_count = ?,
                      consecutive_failures = ?,
                      next_dispatch_at = ?,
                      completed_at = CASE WHEN ? = 0 THEN ? ELSE completed_at END
                  WHERE id = ?`,
            args: [
              nextStatus,
              remainingQueued,
              nextConsecutiveFailures,
              remainingQueued > 0 ? nextDispatchIso : null,
              remainingQueued,
              finishedIso,
              bcId,
            ],
          });
          socketHub.emit("broadcast:progress", {
            broadcastId: bcId,
            status: nextStatus,
            queuedCount: remainingQueued,
          });
        }
      }
    }
  } finally {
    globalWorkerRunner.__ccMarketingQueueRunning = false;
  }

  return dispatchedCount;
}

export async function pauseMarketingBroadcast(
  broadcastId: string,
  reason = "Paused manually by team."
): Promise<void> {
  const mkt = getRawLibSqlClient("marketing");
  await mkt.execute({
    sql: `UPDATE broadcasts
          SET status = 'PAUSED',
              paused_reason = ?,
              next_dispatch_at = NULL
          WHERE id = ? AND status IN ('QUEUED', 'SENDING', 'SCHEDULED')`,
    args: [reason, broadcastId],
  });
  socketHub.emit("broadcast:progress", { broadcastId, status: "PAUSED" });
}

export async function resumeMarketingBroadcast(
  broadcastId: string
): Promise<void> {
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();
  const remRes = await mkt.execute({
    sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'QUEUED'`,
    args: [broadcastId],
  });
  const remaining = Number(remRes.rows[0]?.cnt ?? 0);
  await mkt.execute({
    sql: `UPDATE broadcasts
          SET status = ?,
              paused_reason = NULL,
              consecutive_failures = 0,
              queued_count = ?,
              next_dispatch_at = ?
          WHERE id = ?`,
    args: [
      remaining > 0 ? "SENDING" : "COMPLETED",
      remaining,
      remaining > 0 ? nowIso : null,
      broadcastId,
    ],
  });
  ensureBackgroundWorkersRunning();
  if (remaining > 0) {
    void processMarketingBroadcastQueue().catch(() => {});
  }
  socketHub.emit("broadcast:progress", { broadcastId, status: "SENDING" });
}

export async function retryFailedBroadcastRecipients(
  broadcastId: string
): Promise<number> {
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();
  await mkt.execute({
    sql: `UPDATE broadcast_recipients
          SET status = 'QUEUED',
              skip_or_error_reason = NULL,
              scheduled_at = ?
          WHERE broadcast_id = ? AND status = 'FAILED'`,
    args: [nowIso, broadcastId],
  });
  const remRes = await mkt.execute({
    sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'QUEUED'`,
    args: [broadcastId],
  });
  const remaining = Number(remRes.rows[0]?.cnt ?? 0);
  await mkt.execute({
    sql: `UPDATE broadcasts
          SET status = ?,
              failed_count = 0,
              queued_count = ?,
              paused_reason = NULL,
              consecutive_failures = 0,
              next_dispatch_at = ?
          WHERE id = ?`,
    args: [
      remaining > 0 ? "SENDING" : "COMPLETED",
      remaining,
      remaining > 0 ? nowIso : null,
      broadcastId,
    ],
  });
  ensureBackgroundWorkersRunning();
  if (remaining > 0) {
    void processMarketingBroadcastQueue().catch(() => {});
  }
  socketHub.emit("broadcast:progress", {
    broadcastId,
    status: remaining > 0 ? "SENDING" : "COMPLETED",
  });
  return remaining;
}

export async function cancelMarketingBroadcast(
  broadcastId: string
): Promise<void> {
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();
  await mkt.batch(
    [
      {
        sql: `UPDATE broadcast_recipients
              SET status = 'CANCELLED',
                  skip_or_error_reason = 'Campaign cancelled before sending'
              WHERE broadcast_id = ? AND status = 'QUEUED'`,
        args: [broadcastId],
      },
      {
        sql: `UPDATE broadcasts
              SET status = 'CANCELLED',
                  queued_count = 0,
                  next_dispatch_at = NULL,
                  completed_at = ?
              WHERE id = ?`,
        args: [nowIso, broadcastId],
      },
    ],
    "write"
  );
  socketHub.emit("broadcast:progress", { broadcastId, status: "CANCELLED" });
}

// ============================================================================
// MONOTONIC WHATSAPP RECEIPT PROGRESSION (SENDING -> SENT -> DELIVERED -> READ)
// ============================================================================

const RECEIPT_RANK: Record<string, number> = {
  SENDING: 0,
  QUEUED: 0,
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  SEEN: 3,
  PLAYED: 3,
};

function canAdvanceDeliveryStatus(currentRaw: string, nextRaw: string): boolean {
  const cur = String(currentRaw || "SENT").trim().toUpperCase();
  const next = String(nextRaw || "").trim().toUpperCase();
  if (next === "FAILED") {
    return cur !== "DELIVERED" && cur !== "READ";
  }
  if (cur === "FAILED") {
    // Allow late real delivery/read webhook to recover a transient failed mark
    return next === "DELIVERED" || next === "READ";
  }
  const curRank = RECEIPT_RANK[cur] ?? 1;
  const nextRank = RECEIPT_RANK[next] ?? -1;
  return nextRank > curRank;
}

export async function applyWhatsAppMessageReceipt(params: {
  waMessageId?: string | null;
  messageId?: string | null;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  errorCode?: string | number | null;
  errorMessage?: string | null;
  errorDetails?: string | null;
  timestampIso?: string | null;
}): Promise<{ updated: boolean; conversationId: string | null }> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const mkt = getRawLibSqlClient("marketing");
  const nextStatus = params.status;
  const waId = params.waMessageId ? String(params.waMessageId).trim() : "";
  const msgId = params.messageId ? String(params.messageId).trim() : "";

  let updated = false;
  let conversationId: string | null = null;
  let resolvedMsgId: string | null = msgId || null;
  let resolvedWaId: string | null = waId || null;

  if (waId || msgId) {
    const existingRes = await conv.execute(
      waId
        ? {
            sql: `SELECT id, conversation_id, delivery_status, wa_message_id, metadata_json
                  FROM messages
                  WHERE wa_message_id = ?
                  LIMIT 1`,
            args: [waId],
          }
        : {
            sql: `SELECT id, conversation_id, delivery_status, wa_message_id, metadata_json
                  FROM messages
                  WHERE id = ?
                  LIMIT 1`,
            args: [msgId],
          }
    );

    const row = existingRes.rows[0];
    if (row) {
      conversationId = String(row.conversation_id);
      resolvedMsgId = String(row.id);
      resolvedWaId = row.wa_message_id ? String(row.wa_message_id) : resolvedWaId;
      const currentStatus = String(row.delivery_status || "SENT");

      if (canAdvanceDeliveryStatus(currentStatus, nextStatus)) {
        let meta: Record<string, unknown> = {};
        if (row.metadata_json) {
          try {
            meta = JSON.parse(String(row.metadata_json));
          } catch {
            meta = {};
          }
        }
        if (nextStatus === "FAILED" || params.errorCode || params.errorMessage) {
          meta.errorCode = params.errorCode ? String(params.errorCode) : (meta.errorCode ?? null);
          meta.errorMessage = params.errorMessage ? String(params.errorMessage) : (meta.errorMessage ?? null);
          if (params.errorDetails) meta.errorDetails = String(params.errorDetails);
          meta.failedAt = params.timestampIso || new Date().toISOString();
        }

        await conv.execute({
          sql: `UPDATE messages SET delivery_status = ?, metadata_json = ? WHERE id = ?`,
          args: [nextStatus, JSON.stringify(meta), resolvedMsgId],
        });
        await conv
          .execute({
            sql: `UPDATE conversations
                  SET last_message_status = ?
                  WHERE id = ? AND last_message_direction = 'OUTBOUND'`,
            args: [nextStatus, conversationId],
          })
          .catch(() => {});
        updated = true;
      }
    }
  }

  // Sync broadcast_recipients + broadcasts counters if this wamid belongs to a campaign
  if (resolvedWaId) {
    const recRes = await mkt.execute({
      sql: `SELECT id, broadcast_id, status, skip_or_error_reason
            FROM broadcast_recipients
            WHERE wa_message_id = ?
            LIMIT 1`,
      args: [resolvedWaId],
    });
    const rec = recRes.rows[0];
    if (rec) {
      const broadcastId = String(rec.broadcast_id);
      const curRecStatus = String(rec.status || "SENT");
      if (canAdvanceDeliveryStatus(curRecStatus, nextStatus)) {
        let errorReason = rec.skip_or_error_reason ? String(rec.skip_or_error_reason) : null;
        if (nextStatus === "FAILED") {
          const parts: string[] = [];
          if (params.errorCode) parts.push(`Code ${params.errorCode}`);
          if (params.errorMessage) parts.push(String(params.errorMessage));
          if (params.errorDetails) parts.push(String(params.errorDetails));
          errorReason = parts.length > 0 ? parts.join(": ") : (errorReason || "Delivery failed");
        }

        await mkt.execute({
          sql: `UPDATE broadcast_recipients
                SET status = ?,
                    skip_or_error_reason = COALESCE(?, skip_or_error_reason)
                WHERE id = ?`,
          args: [nextStatus, errorReason, String(rec.id)],
        });
        await mkt.execute({
          sql: `UPDATE broadcasts
                SET delivered_count = (
                      SELECT COUNT(*) FROM broadcast_recipients
                      WHERE broadcast_id = ? AND status IN ('DELIVERED', 'READ')
                    ),
                    read_count = (
                      SELECT COUNT(*) FROM broadcast_recipients
                      WHERE broadcast_id = ? AND status = 'READ'
                    ),
                    failed_count = (
                      SELECT COUNT(*) FROM broadcast_recipients
                      WHERE broadcast_id = ? AND status = 'FAILED'
                    )
                WHERE id = ?`,
          args: [broadcastId, broadcastId, broadcastId, broadcastId],
        });
        socketHub.emit("broadcast:progress", {
          broadcastId,
          waMessageId: resolvedWaId,
          status: nextStatus,
          errorCode: params.errorCode ? String(params.errorCode) : null,
          errorMessage: params.errorMessage ? String(params.errorMessage) : null,
        });
      }
    }
  }

  if (updated) {
    socketHub.emit("message:status", {
      conversationId,
      messageId: resolvedMsgId,
      waMessageId: resolvedWaId,
      status: nextStatus,
      errorCode: params.errorCode ? String(params.errorCode) : null,
      errorMessage: params.errorMessage ? String(params.errorMessage) : null,
    });
  }

  return { updated, conversationId };
}

/**
 * When a customer sends an INBOUND reply in a conversation (or when testing customer read),
 * any prior OUTBOUND messages in that conversation still at SENDING/SENT/DELIVERED are marked READ.
 */
export async function markPriorOutboundMessagesRead(
  conversationId: string
): Promise<number> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const res = await conv.execute({
    sql: `UPDATE messages
          SET delivery_status = 'READ'
          WHERE conversation_id = ?
            AND direction = 'OUTBOUND'
            AND delivery_status IN ('SENDING', 'SENT', 'DELIVERED')`,
    args: [conversationId],
  });
  const changed = Number(res.rowsAffected ?? 0);
  if (changed > 0) {
    socketHub.emit("message:status", {
      conversationId,
      status: "READ",
      markAllOutboundRead: true,
    });
  }
  return changed;
}

/**
 * In Sandbox Simulator mode, simulates authentic WhatsApp Cloud delivery progression:
 * message starts as SENT (single tick) and transitions to DELIVERED (double grey ticks) after ~1.3s.
 */
export function scheduleSandboxDeliveryReceipt(params: {
  conversationId: string;
  messageId: string;
  waMessageId: string;
  delayMs?: number;
}): void {
  const delay = Math.max(350, params.delayMs ?? 1300);
  setTimeout(() => {
    void applyWhatsAppMessageReceipt({
      messageId: params.messageId,
      waMessageId: params.waMessageId,
      status: "DELIVERED",
    }).catch(() => {});
  }, delay);
}

// ============================================================================
// CONVERSATION ASSIGNMENT & FIRST-RESPONSE TRACKING ENGINE
// ============================================================================

export type AssignmentSourceType =
  | "INITIAL_SYSTEM"
  | "ACRIO_HANDOFF"
  | "SMART_ASSIGN"
  | "MANUAL_ASSIGN"
  | "STAFF_TAKEOVER"
  | "AUTO_ESCALATION"
  | "REOPEN"
  | "OUTBOUND_START"
  | "RETURN_TO_SYSTEM"
  | "CALL_DISPATCH_QUEUE"
  | "REQUESTED_BY_CUSTOMER"
  | "PREFERRED_STAFF"
  | "PAST_HANDLER"
  | "WHATSAPP_FIRST_COME_CLAIM";

async function patchAssignmentEventMessageMeta(
  assignmentId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const conv = getRawLibSqlClient("conversations");
  const msgRes = await conv.execute({
    sql: `SELECT id, metadata_json
          FROM messages
          WHERE message_type = 'ASSIGNMENT_EVENT'
            AND metadata_json LIKE ?
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [`%${assignmentId}%`],
  });
  const row = msgRes.rows[0];
  if (!row) return;
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(String(row.metadata_json || "{}"));
  } catch {
    meta = {};
  }
  const merged = { ...meta, ...patch };
  await conv.execute({
    sql: `UPDATE messages SET metadata_json = ? WHERE id = ?`,
    args: [JSON.stringify(merged), String(row.id)],
  });
}

export async function logConversationAssignment(params: {
  conversationId: string;
  customerPhone?: string;
  customerName?: string;
  fromStaffId?: string | null;
  fromStaffName?: string | null;
  fromTeamName?: string | null;
  toStaffId: string | null;
  toStaffName: string;
  toTeamId?: string | null;
  toTeamName: string;
  escalationLevel?: string;
  assignmentSource: AssignmentSourceType;
  assignedByName: string;
  reason?: string;
  assignedAt?: string;
}): Promise<string> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const assignedAt = params.assignedAt || new Date().toISOString();
  const tier = params.escalationLevel || "P0";

  // Resolve customer name/phone if omitted
  let customerPhone = params.customerPhone || "";
  let customerName = params.customerName || "";
  if (!customerPhone || !customerName) {
    const cRes = await conv.execute({
      sql: `SELECT customer_phone, customer_name FROM conversations WHERE id = ? LIMIT 1`,
      args: [params.conversationId],
    });
    if (cRes.rows[0]) {
      customerPhone = customerPhone || String(cRes.rows[0].customer_phone || "");
      customerName = customerName || String(cRes.rows[0].customer_name || "");
    }
  }

  // Close any previous open assignment on this conversation
  const openRes = await conv.execute({
    sql: `SELECT id, first_response_at
          FROM conversation_assignments
          WHERE conversation_id = ? AND ended_at IS NULL`,
    args: [params.conversationId],
  });

  for (const prev of openRes.rows) {
    const prevId = String(prev.id);
    const hadReply = Boolean(prev.first_response_at);
    const prevOutcome = hadReply
      ? "RESPONDED"
      : params.assignmentSource === "AUTO_ESCALATION"
      ? "ESCALATED"
      : "REASSIGNED";
    await conv.execute({
      sql: `UPDATE conversation_assignments
            SET ended_at = ?, outcome = ?
            WHERE id = ?`,
      args: [assignedAt, prevOutcome, prevId],
    });
    await patchAssignmentEventMessageMeta(prevId, {
      endedAt: assignedAt,
      outcome: prevOutcome,
    });
  }

  const assignmentId = `asg_${crypto.randomUUID().slice(0, 10)}`;
  const reason = params.reason || "";

  await conv.execute({
    sql: `INSERT INTO conversation_assignments (
      id, conversation_id, customer_phone, customer_name,
      from_staff_id, from_staff_name, from_team_name,
      to_staff_id, to_staff_name, to_team_id, to_team_name,
      escalation_level, assignment_source, assigned_by_name, reason,
      assigned_at, outcome
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    args: [
      assignmentId,
      params.conversationId,
      customerPhone,
      customerName,
      params.fromStaffId ?? null,
      params.fromStaffName ?? null,
      params.fromTeamName ?? null,
      params.toStaffId,
      params.toStaffName,
      params.toTeamId ?? null,
      params.toTeamName,
      tier,
      params.assignmentSource,
      params.assignedByName,
      reason,
      assignedAt,
    ],
  });

  // Build plain-language timeline message for chat history
  let summaryBody = "";
  if (params.toStaffId === "ACRIO") {
    summaryBody =
      params.assignmentSource === "INITIAL_SYSTEM"
        ? "Assigned to System (ACRIO) for automatic handling."
        : `${params.assignedByName} assigned this chat to System (ACRIO).`;
  } else if (params.assignmentSource === "AUTO_ESCALATION") {
    summaryBody = `${reason} Assigned to ${params.toStaffName} (${params.toTeamName} • ${tier}).`;
  } else if (params.assignmentSource === "ACRIO_HANDOFF") {
    summaryBody = `${reason ? `${reason} ` : ""}Connected by ACRIO to ${params.toTeamName} (${tier}: ${params.toStaffName}).`;
  } else if (params.assignmentSource === "STAFF_TAKEOVER") {
    summaryBody = `${params.toStaffName} took over this chat (${params.toTeamName} • ${tier}).`;
  } else if (params.assignmentSource === "REOPEN") {
    summaryBody = `${params.assignedByName} reopened this chat under ${params.toTeamName} (${params.toStaffName}).`;
  } else if (params.assignmentSource === "OUTBOUND_START") {
    summaryBody = `${params.toStaffName} (${params.toTeamName}) started this outbound chat.`;
  } else {
    summaryBody = `${params.assignedByName} assigned this chat to ${params.toStaffName} (${params.toTeamName} • ${tier}).`;
  }

  const meta = {
    assignmentId,
    fromStaffName: params.fromStaffName ?? null,
    fromTeamName: params.fromTeamName ?? null,
    toStaffId: params.toStaffId,
    toStaffName: params.toStaffName,
    toTeamId: params.toTeamId ?? null,
    toTeamName: params.toTeamName,
    escalationLevel: tier,
    assignmentSource: params.assignmentSource,
    assignedByName: params.assignedByName,
    reason,
    assignedAt,
    firstResponseAt: null,
    firstResponseSeconds: null,
    firstResponderName: null,
    outcome: "ACTIVE",
  };

  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, direction, sender_type, sender_name, message_type,
      billing_category, body, metadata_json, delivery_status, created_at
    ) VALUES (?, ?, 'INTERNAL', 'SYSTEM_EVENT', ?, 'ASSIGNMENT_EVENT', 'INTERNAL', ?, ?, 'SAVED', ?)`,
    args: [
      `msg_asg_${crypto.randomUUID().slice(0, 8)}`,
      params.conversationId,
      params.assignedByName,
      summaryBody,
      JSON.stringify(meta),
      assignedAt,
    ],
  });

  return assignmentId;
}

/**
 * Records the assigned person's first outbound response timestamp and elapsed seconds,
 * updating both `conversation_assignments` and the inline `ASSIGNMENT_EVENT` chat timeline card!
 */
export async function recordAssignedFirstResponse(params: {
  conversationId: string;
  responderId: string;
  responderName: string;
  responderTeamId?: string | null;
  responderTeamName?: string | null;
  messageId: string;
  respondedAt?: string;
  overrideWaitSeconds?: number | null;
}): Promise<{ assignmentId: string; firstResponseSeconds: number } | null> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const respondedAt = params.respondedAt || new Date().toISOString();
  const respondedMs = new Date(respondedAt).getTime();

  const openRes = await conv.execute({
    sql: `SELECT *
          FROM conversation_assignments
          WHERE conversation_id = ? AND ended_at IS NULL
          ORDER BY assigned_at DESC
          LIMIT 1`,
    args: [params.conversationId],
  });

  let activeRow = openRes.rows[0] as Record<string, unknown> | undefined;
  const isHumanReply = params.responderId !== "ACRIO";
  const currentAssigneeId = activeRow?.to_staff_id
    ? String(activeRow.to_staff_id)
    : "";

  // If a human staff member replies directly while chat was on ACRIO or had no open assignment,
  // log their STAFF_TAKEOVER 1ms before their message and record their first response cleanly!
  if (isHumanReply && (!activeRow || currentAssigneeId === "ACRIO")) {
    const takeoverIso = new Date(Math.max(0, respondedMs - 1)).toISOString();
    const newAsgId = await logConversationAssignment({
      conversationId: params.conversationId,
      fromStaffId: currentAssigneeId || null,
      fromStaffName: activeRow?.to_staff_name
        ? String(activeRow.to_staff_name)
        : null,
      fromTeamName: activeRow?.to_team_name
        ? String(activeRow.to_team_name)
        : null,
      toStaffId: params.responderId,
      toStaffName: params.responderName,
      toTeamId: params.responderTeamId ?? "team_sales",
      toTeamName: params.responderTeamName || "Sales Team",
      escalationLevel: "P0",
      assignmentSource: "STAFF_TAKEOVER",
      assignedByName: params.responderName,
      reason: "Replied directly and took ownership from System (ACRIO)",
      assignedAt: takeoverIso,
    });
    const secs =
      params.overrideWaitSeconds !== null &&
      params.overrideWaitSeconds !== undefined &&
      params.overrideWaitSeconds > 0
        ? params.overrideWaitSeconds
        : 1;

    await conv.execute({
      sql: `UPDATE conversation_assignments
            SET first_response_at = ?,
                first_response_seconds = ?,
                first_response_message_id = ?,
                outcome = 'RESPONDED'
            WHERE id = ?`,
      args: [respondedAt, secs, params.messageId, newAsgId],
    });
    await patchAssignmentEventMessageMeta(newAsgId, {
      firstResponseAt: respondedAt,
      firstResponseSeconds: secs,
      firstResponderName: params.responderName,
      outcome: "RESPONDED",
    });
    return { assignmentId: newAsgId, firstResponseSeconds: secs };
  }

  if (!activeRow) return null;

  // Already recorded first response on this assignment
  if (activeRow.first_response_at) {
    return null;
  }

  // If ACRIO replies, only record against an ACRIO assignment
  if (!isHumanReply && currentAssigneeId !== "ACRIO") {
    return null;
  }

  const assignmentId = String(activeRow.id);
  const assignedMs = new Date(String(activeRow.assigned_at)).getTime();
  const computedSecs = Number.isNaN(assignedMs)
    ? 1
    : Math.max(1, Math.round((respondedMs - assignedMs) / 1000));

  // If the chat was queued to a team without a specific person (`to_staff_id IS NULL`),
  // attribute the assignment & conversation directly to the real staff member who answered!
  if (isHumanReply && !currentAssigneeId) {
    await Promise.all([
      conv.execute({
        sql: `UPDATE conversation_assignments
              SET to_staff_id = ?,
                  to_staff_name = ?,
                  first_response_at = ?,
                  first_response_seconds = ?,
                  first_response_message_id = ?,
                  outcome = 'RESPONDED'
              WHERE id = ?`,
        args: [
          params.responderId,
          params.responderName,
          respondedAt,
          computedSecs,
          params.messageId,
          assignmentId,
        ],
      }),
      conv.execute({
        sql: `UPDATE conversations
              SET assigned_staff_id = ?,
                  assigned_staff_name = ?
              WHERE id = ? AND (assigned_staff_id IS NULL OR assigned_staff_id = '')`,
        args: [params.responderId, params.responderName, params.conversationId],
      }),
    ]);
  } else {
    await conv.execute({
      sql: `UPDATE conversation_assignments
            SET first_response_at = ?,
                first_response_seconds = ?,
                first_response_message_id = ?,
                outcome = 'RESPONDED'
            WHERE id = ?`,
      args: [respondedAt, computedSecs, params.messageId, assignmentId],
    });
  }

  await patchAssignmentEventMessageMeta(assignmentId, {
    ...(isHumanReply && !currentAssigneeId
      ? { toStaffId: params.responderId, toStaffName: params.responderName }
      : {}),
    firstResponseAt: respondedAt,
    firstResponseSeconds: computedSecs,
    firstResponderName: params.responderName,
    outcome: "RESPONDED",
  });

  return { assignmentId, firstResponseSeconds: computedSecs };
}

export async function closeActiveAssignmentOnResolve(
  conversationId: string,
  resolvedAt?: string
): Promise<void> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const endIso = resolvedAt || new Date().toISOString();

  const openRes = await conv.execute({
    sql: `SELECT id, first_response_at
          FROM conversation_assignments
          WHERE conversation_id = ? AND ended_at IS NULL`,
    args: [conversationId],
  });

  for (const row of openRes.rows) {
    const asgId = String(row.id);
    const outcome = row.first_response_at ? "RESPONDED" : "RESOLVED";
    await conv.execute({
      sql: `UPDATE conversation_assignments
            SET ended_at = ?, outcome = ?
            WHERE id = ?`,
      args: [endIso, outcome, asgId],
    });
    await patchAssignmentEventMessageMeta(asgId, {
      endedAt: endIso,
      outcome,
    });
  }
}

function getCurrentIstDateAndTime(): {
  dateKey: string;
  hour: number;
  minute: number;
} {
  const now = new Date();
  const zoned = toZonedTime(now, APP_TIMEZONE);
  return {
    dateKey: formatInTimeZone(now, APP_TIMEZONE, "yyyy-MM-dd"),
    hour: zoned.getHours(),
    minute: zoned.getMinutes(),
  };
}

const globalWorkerRunner = globalThis as unknown as {
  __ccBackgroundWorkersStarted?: boolean;
  __ccLastMidnightBackupDate?: string;
  __ccMarketingQueueRunning?: boolean;
};

/**
 * Idempotent in-process background daemon started automatically by the server:
 * 1. Drains safe anti-spam marketing broadcast queue every 2 seconds.
 * 2. Drains LibSQL job queues every 6 seconds.
 * 3. Checks the Midnight IST Google Drive Backup schedule every 30 seconds and triggers backup automatically!
 */
export function ensureBackgroundWorkersRunning(): void {
  if (globalWorkerRunner.__ccBackgroundWorkersStarted) return;
  globalWorkerRunner.__ccBackgroundWorkersStarted = true;

  // Initial heartbeat
  void recordWorkerHeartbeat("midnight-gdrive-scheduler", "ONLINE", 0, {
    schedule: "Daily Midnight IST (Configurable in Dev Panel)",
  });
  void drainPendingWorkerJobs();
  void processMarketingBroadcastQueue().catch(() => {});

  // Safe Paced Marketing Broadcast Queue loop (every 2 seconds)
  setInterval(() => {
    void processMarketingBroadcastQueue().catch(() => {});
  }, 2000);

  // Queue consumer loop
  setInterval(() => {
    void drainPendingWorkerJobs().catch(() => {});
  }, 6000);

  // Automatic P0 -> P1 -> P2 customer wait-time escalation loop (every 15 seconds)
  setInterval(() => {
    void checkAndEscalateWaitingChats().catch(() => {});
  }, 15000);

  // Midnight IST Google Drive Backup scheduler loop
  setInterval(async () => {
    try {
      await ensureDatabasesBootstrapped();
      const bill = getRawLibSqlClient("billing_ops");
      const res = await bill.execute(
        `SELECT * FROM backup_settings WHERE id = 'default' LIMIT 1`
      );
      const cfg = res.rows[0];
      if (!cfg || Number(cfg.enabled ?? 1) !== 1) return;

      const targetHour = Number(cfg.midnight_hour_ist ?? 0);
      const targetMinute = Number(cfg.midnight_minute_ist ?? 0);
      const { dateKey, hour, minute } = getCurrentIstDateAndTime();

      if (
        hour === targetHour &&
        minute === targetMinute &&
        globalWorkerRunner.__ccLastMidnightBackupDate !== dateKey
      ) {
        globalWorkerRunner.__ccLastMidnightBackupDate = dateKey;
        await enqueueJob("backup:midnight_gdrive", {
          triggerSource: "MIDNIGHT_CRON",
          dateKey,
        });
        await drainPendingWorkerJobs();
      }

      await recordWorkerHeartbeat("midnight-gdrive-scheduler", "ONLINE", 0, {
        configuredTimeIst: `${String(targetHour).padStart(2, "0")}:${String(
          targetMinute
        ).padStart(2, "0")} IST`,
        enabled: Number(cfg.enabled ?? 1) === 1,
      });
    } catch {
      // Non-blocking cron guard
    }
  }, 30000);

  // Periodic queue hygiene: prune completed jobs older than 7 days & failed jobs older than 30 days
  const pruneOldJobs = async () => {
    try {
      await ensureDatabasesBootstrapped();
      const qDb = getRawLibSqlClient("queue_jobs");
      const nowMs = Date.now();
      const completedCutoff = new Date(nowMs - 7 * 86400000).toISOString();
      const failedCutoff = new Date(nowMs - 30 * 86400000).toISOString();
      await qDb.execute({
        sql: `DELETE FROM jobs
              WHERE (status = 'COMPLETED' AND created_at < ?)
                 OR (status = 'FAILED' AND created_at < ?)`,
        args: [completedCutoff, failedCutoff],
      });
    } catch {
      // Non-blocking cleanup
    }
  };
  void pruneOldJobs();
  setInterval(() => {
    void pruneOldJobs();
  }, 6 * 60 * 60 * 1000);
}

export * from "./staff-notes";
export * from "./owner-desk";
