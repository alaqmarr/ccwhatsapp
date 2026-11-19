import {
  extractCustomerCoreNouns,
  extractExplicitProductOrModelCodes,
  resolvePublicTrackingOrigin,
  type AiTraceStep,
} from "@cc/database";
import type { CustomerImageAnalysis } from "@cc/connections/image-intelligence";
import {
  formatWhatsAppOutboundText,
  recordAndBroadcastAiLog,
} from "@cc/connections/initialise.acrio.ai";
import {
  type AcrioConversationState,
  type AcrioIntentClassification,
  saveConversationAiState,
} from "@cc/connections/helpers.acrio.ai";
import type {
  AcrioAutonomousTurnResult,
  AcrioReplyToMessageContext,
  AcrioTurnParams,
} from "@cc/connections/interactive.acrio.ai";

export async function handlePreferenceOnlyFragmentTurn(ctx: {
  params: AcrioTurnParams;
  started: number;
  steps: AiTraceStep[];
  addStep: (label: string, detail?: string, status?: AiTraceStep["status"]) => void;
  convState: AcrioConversationState;
  intentInfo: AcrioIntentClassification;
  hasBurstReferenceMedia: boolean;
  visionAnalysis: CustomerImageAnalysis | null;
  quotedReplyContext: AcrioReplyToMessageContext | null;
  rawText: string;
  firstName: string;
  alreadyGreeted: boolean;
}): Promise<AcrioAutonomousTurnResult | null> {
  const {
    params,
    started,
    steps,
    addStep,
    convState,
    intentInfo,
    hasBurstReferenceMedia,
    visionAnalysis,
    quotedReplyContext,
    rawText,
    firstName,
    alreadyGreeted,
  } = ctx;

  const turnCoreNounsEarly = extractCustomerCoreNouns(rawText);
  const stateCoreNounsEarly = extractCustomerCoreNouns(convState.primaryProductQuery || "");
  const isPreferenceOnlyFragment =
    !hasBurstReferenceMedia &&
    !visionAnalysis &&
    !params.forcedFocusSlug &&
    !quotedReplyContext &&
    !intentInfo.needsImmediateHandoff &&
    turnCoreNounsEarly.length === 0 &&
    stateCoreNounsEarly.length === 0 &&
    !convState.focusProductSlug &&
    convState.lastRecommendedProducts.length === 0 &&
    extractExplicitProductOrModelCodes(rawText).length === 0 &&
    intentInfo.intent !== "GREETING" &&
    intentInfo.intent !== "IDENTITY_META" &&
    intentInfo.intent !== "COMPANY_INFO" &&
    intentInfo.intent !== "LEADERSHIP_CONTACT_INFO" &&
    intentInfo.intent !== "CHAT_HISTORY_META" &&
    intentInfo.intent !== "HUMAN_HANDOFF_INFO" &&
    intentInfo.intent !== "OFF_TOPIC" &&
    intentInfo.intent !== "TOPIC_RESET" &&
    (convState.preferences.length > 0 ||
      Boolean(convState.dimensionsOrThickness) ||
      Boolean(convState.quantity) ||
      /\b(acrylic|perspex|pmma|polycarbonate|black|white|clear|transparent|frosted|gold|silver|wood|wooden)\b/i.test(
        rawText
      ));

  if (!isPreferenceOnlyFragment) return null;

  await saveConversationAiState(params.conversationId, convState);
  const notedFinish =
    convState.preferences.length > 0
      ? `${convState.preferences.join(" ")} acrylic`
      : convState.dimensionsOrThickness || rawText;
  const greetPrefix = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
  const fragmentReply = formatWhatsAppOutboundText(
    `${greetPrefix}Noted *${notedFinish}*! Which product or custom item are you looking for in this finish (for example a stage podium, mobile phone locker, signage, display stand, box, or furniture)?\n\nJust share the item name or a reference photo and I will share matching options right away.`
  );
  addStep(
    "Saved colour/material fragment preference and prompted for product noun",
    `noted="${notedFinish}", prefs=[${convState.preferences.join(",")}]`
  );
  recordAndBroadcastAiLog({
    website: "WHATSAPP_HUB",
    websiteLabel: "Classic Concepts WhatsApp Hub",
    feature: "Autonomous WhatsApp Concierge (ACRIO)",
    actor: params.customerName,
    question: rawText,
    model: "rule-fragment-preference-capture",
    outcomeSource: "LIVE_AI",
    responseCacheStatus: "BYPASS",
    catalogCacheStatus: "BYPASS",
    cacheDetails: `Captured colour/material preference (${notedFinish}) without guessing an unrelated product`,
    productLookupTriggered: false,
    productLookupQuery: "",
    productLookupBudget: null,
    productLookupTotalScanned: 0,
    productsLookedUp: [],
    steps,
    response: fragmentReply,
    durationMs: Date.now() - started,
  });
  return {
    needsHumanHandoff: false,
    handoffReason: "",
    customerReply: fragmentReply,
    smartCategory: convState.activeCategory || "Custom Fabrication",
    priority: "NORMAL",
    conversationState: convState,
  };
}

export function handleImmediateHandoffTurn(ctx: {
  params: AcrioTurnParams;
  started: number;
  steps: AiTraceStep[];
  addStep: (label: string, detail?: string, status?: AiTraceStep["status"]) => void;
  convState: AcrioConversationState;
  intentInfo: AcrioIntentClassification;
  rawText: string;
  firstName: string;
  alreadyGreeted: boolean;
}): AcrioAutonomousTurnResult {
  const { params, started, steps, addStep, convState, intentInfo, rawText, firstName, alreadyGreeted } = ctx;

  let reply = "";
  let reason = "";
  let outPri: "URGENT" | "HIGH" | "NORMAL" = "HIGH";
  let outCat = convState.activeCategory || "General Enquiry";

  const stateParts: string[] = [];
  if (convState.primaryProductQuery) stateParts.push(`product: ${convState.primaryProductQuery}`);
  if (convState.maxPrice !== null && convState.minPrice !== null) {
    stateParts.push(
      `budget: ₹${convState.minPrice.toLocaleString("en-IN")} to ₹${convState.maxPrice.toLocaleString("en-IN")}`
    );
  } else if (convState.maxPrice !== null) {
    stateParts.push(`budget: up to ₹${convState.maxPrice.toLocaleString("en-IN")}`);
  } else if (convState.minPrice !== null) {
    stateParts.push(`budget: from ₹${convState.minPrice.toLocaleString("en-IN")}`);
  }
  if (convState.preferences.length > 0) stateParts.push(`preferences: ${convState.preferences.join(", ")}`);
  if (convState.dimensionsOrThickness) stateParts.push(`size/thickness: ${convState.dimensionsOrThickness}`);
  if (convState.quantity) stateParts.push(`qty: ${convState.quantity}`);
  const stateContextNote = stateParts.length > 0 ? ` • Context: ${stateParts.join(", ")}` : "";

  if (intentInfo.intent === "HUMAN_HANDOFF_REQUEST") {
    reply = alreadyGreeted
      ? `Sure, I am connecting you to our *Sales Team* right away.\n\nA team member will pick up this chat from here and help you shortly.`
      : `Hi ${firstName}! Connecting you to our *Sales Team* right away.\n\nA team member will reply to you here shortly.`;
    reason = `Customer asked to speak with our team ("${rawText.slice(0, 120)}")${stateContextNote}.`;
  } else if (intentInfo.intent === "SUPPORT_ISSUE") {
    reply = alreadyGreeted
      ? `I have flagged this directly for our *Sales & Support Team* so a senior team member can check it personally and resolve it for you right away.`
      : `Hi ${firstName}, I am connecting your chat directly to our *Sales & Support Team* so they can check this personally and help you right away.`;
    reason = `Query needs personal assistance from Sales Team ("${rawText.slice(0, 120)}")${stateContextNote}.`;
    outPri = "URGENT";
  } else {
    const trackOrigin = resolvePublicTrackingOrigin();
    reply = alreadyGreeted
      ? `You can check live courier status anytime on our tracking portal:\n${trackOrigin}\n\nI am also connecting our *Sales Team* here so they can verify your dispatch details personally.`
      : `Hi ${firstName}, you can check live courier status anytime here:\n${trackOrigin}\n\nI am also connecting our *Sales Team* so they can check your order status personally.`;
    reason = `Customer asked about a specific order ("${rawText.slice(0, 120)}")${stateContextNote}.`;
    outCat = "Order & Delivery";
  }

  const formatted = formatWhatsAppOutboundText(reply);
  addStep("Triggered immediate human handoff", reason);
  recordAndBroadcastAiLog({
    website: "WHATSAPP_HUB",
    websiteLabel: "Classic Concepts WhatsApp Hub",
    feature: "Autonomous WhatsApp Concierge (ACRIO)",
    actor: params.customerName,
    question: rawText,
    model: "rule-handoff-guard",
    outcomeSource: "HUMAN_HANDOFF",
    responseCacheStatus: "BYPASS",
    catalogCacheStatus: "BYPASS",
    cacheDetails: `Intent=${intentInfo.intent} • Direct human handoff rule matched (skipped catalog lookup)`,
    productLookupTriggered: false,
    productLookupQuery: "",
    productLookupBudget: null,
    productLookupTotalScanned: 0,
    productsLookedUp: [],
    steps,
    response: formatted,
    durationMs: Date.now() - started,
  });

  return {
    needsHumanHandoff: true,
    handoffReason: reason,
    customerReply: formatted,
    smartCategory: outCat,
    priority: outPri,
    conversationState: convState,
  };
}
