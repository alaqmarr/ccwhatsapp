import {
  cleanDisplayProductName,
  type AiTokenUsage,
  type AiTraceStep,
  type MainWebsiteProduct,
} from "@cc/database";
import type {
  DeepProductContextResult,
  LiveBrandTeamDirectory,
  MultiItemProjectPlan,
} from "./types";
import type { CustomerImageAnalysis } from "@cc/connections/image-intelligence";
import {
  LOCKED_CLAUDE_MODEL,
  formatWhatsAppOutboundText,
  mapProductToLogItem,
  recordAndBroadcastAiLog,
  stripRepeatedGreeting,
} from "@cc/connections/initialise.acrio.ai";
import {
  type AcrioConversationState,
  type AcrioIntentClassification,
  type CatalogCacheMeta,
  buildFocusedAttributeAnswer,
} from "@cc/connections/helpers.acrio.ai";
import type {
  AcrioAutonomousTurnResult,
  AcrioLocationPin,
  AcrioTurnParams,
} from "@cc/connections/interactive.acrio.ai";
import { mergeAiTokenUsage } from "./context-builder";
import { buildPhaseIImageFallbackReply } from "./vision-prompts";

export function buildConciergeFallbackReply(ctx: {
  params: AcrioTurnParams;
  started: number;
  steps: AiTraceStep[];
  addStep: (label: string, detail?: string, status?: AiTraceStep["status"]) => void;
  allItems: MainWebsiteProduct[];
  contextMatches: MainWebsiteProduct[];
  pinnedFocusItem: MainWebsiteProduct | null;
  top: MainWebsiteProduct | undefined;
  aggregateResult: { answer: string; items: MainWebsiteProduct[] } | null;
  deepProductInfo: DeepProductContextResult | null;
  projectPlan: MultiItemProjectPlan;
  liveBrandInfo: LiveBrandTeamDirectory | null;
  convState: AcrioConversationState;
  intentInfo: AcrioIntentClassification;
  cacheMeta: CatalogCacheMeta;
  usedLookupQuery: string;
  budgetLabel: string | null;
  budgetFallbackLowestPrice: number | null;
  budgetFallbackLowestItem: MainWebsiteProduct | null;
  prebuiltGroupedBlock: string;
  podiumSubCategoriesText: string;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL";
  hidePricesActive: boolean;
  isCustomStructureEnquiry: boolean;
  visionAnalysis: CustomerImageAnalysis | null;
  visionUsage: AiTokenUsage | null;
  hasBurstReferenceMedia: boolean;
  burstMediaLabel: string;
  burstImages: number;
  needsSalesTeamPing: boolean;
  salesTeamPingNote: string;
  lastAiError: string | null;
  lastUsage: AiTokenUsage | null;
  rawText: string;
  contextLower: string;
  firstName: string;
  alreadyGreeted: boolean;
  history: { direction: string; body: string }[];
}): AcrioAutonomousTurnResult {
  const {
    params,
    started,
    steps,
    addStep,
    allItems,
    contextMatches,
    pinnedFocusItem,
    top,
    aggregateResult,
    deepProductInfo,
    projectPlan,
    liveBrandInfo,
    convState,
    intentInfo,
    cacheMeta,
    usedLookupQuery,
    budgetLabel,
    budgetFallbackLowestPrice,
    budgetFallbackLowestItem,
    prebuiltGroupedBlock,
    podiumSubCategoriesText,
    hidePricesActive,
    isCustomStructureEnquiry,
    visionAnalysis,
    visionUsage,
    hasBurstReferenceMedia,
    burstMediaLabel,
    burstImages,
    lastAiError,
    lastUsage,
    rawText,
    contextLower,
    firstName,
    alreadyGreeted,
    history,
  } = ctx;

  let { smartCategory, priority, needsSalesTeamPing, salesTeamPingNote } = ctx;
  const lower = rawText.toLowerCase();
  const hasLegacyUnanalyzedMedia = hasBurstReferenceMedia && !visionAnalysis;

  const greetOnce = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
  let fallbackReply = "";
  let fallbackHandoff = false;
  let fallbackReason = "";

  if (projectPlan.isMultiItemOrTotalling && projectPlan.summaryText) {
    fallbackReply = `${greetOnce}${projectPlan.summaryText}`;
    priority = "HIGH";
  } else if (intentInfo.intent === "CATEGORY_OVERVIEW" && podiumSubCategoriesText) {
    fallbackReply = `${greetOnce}${podiumSubCategoriesText}`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "LEADERSHIP_CONTACT_INFO") {
    const publicTeamLines = liveBrandInfo?.leadershipLines?.length
      ? liveBrandInfo.leadershipLines.join("\n")
      : "";
    const officePhoneLine = liveBrandInfo?.officePhones?.length
      ? liveBrandInfo.officePhones.join(" / ")
      : "+91 79016 50662 / +91 79016 50663";
    const officeEmailLine = liveBrandInfo?.officeEmails?.length
      ? liveBrandInfo.officeEmails.join(", ")
      : "sales@classicconcepts.in";
    const officeWa = liveBrandInfo?.officeWhatsapp || "+91 73372 20568";
    fallbackReply = `${greetOnce}Here are our verified professional team and office contact details from *classicconcepts.in*:\n\n${
      publicTeamLines ? `${publicTeamLines}\n\n` : ""
    }• *Head Office & Factory (${liveBrandInfo?.address || "Secunderabad, Telangana"}):* ${officePhoneLine} | Official WhatsApp: ${officeWa} | ${officeEmailLine}`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "CHAT_HISTORY_META") {
    const prevUserTopics = history
      .filter((m) => m.direction === "INBOUND")
      .slice(-6)
      .map((m) => `• "${m.body.slice(0, 80)}"`)
      .join("\n");
    fallbackReply = /student/i.test(lower)
      ? `${greetOnce}Welcome! Since you are a student exploring our range, feel free to ask about any acrylic product dimensions, manufacturing methods, or prices anytime with zero obligation.`
      : `${greetOnce}Here is a quick summary of what we have discussed in this chat:\n${prevUserTopics || "• Exploring Classic Concepts acrylic products and pricing"}\n\nActive focus: *${convState.primaryProductQuery || smartCategory}*. Tell me how you would like to proceed and I will help right away!`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "GREETING") {
    fallbackReply = alreadyGreeted
      ? `How can I help you today?`
      : `Hello ${firstName}! Welcome to *Classic Concepts*. How can I help you today?`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "IDENTITY_META") {
    fallbackReply = `${greetOnce}I am *ACRIO*, the assistant for *Classic Concepts* and *Classic Edge 53*. How can I help you today?`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "COMPANY_INFO") {
    const officePhoneLine = liveBrandInfo?.officePhones?.length
      ? liveBrandInfo.officePhones.join(", ")
      : "+91 79016 50662, +91 79016 50663";
    const officeEmailLine = liveBrandInfo?.officeEmails?.[0] || "sales@classicconcepts.in";
    const officeWa = liveBrandInfo?.officeWhatsapp || "+91 73372 20568";
    const officeAddress =
      liveBrandInfo?.address ||
      "1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015";
    const officeHours =
      liveBrandInfo?.businessHours || "Monday to Saturday, 10:00 AM to 7:00 PM";
    const officeMapsUrl =
      liveBrandInfo?.mapsUrl || "https://maps.google.com/?q=17.4947378,78.496725";
    fallbackReply = `${greetOnce}*Classic Concepts Acrylic Pvt. Ltd.*\n${officeAddress}\n*Hours:* ${officeHours}\n*Phone:* ${officePhoneLine} | *WhatsApp:* ${officeWa} | ${officeEmailLine}\n\n*Google Maps:* ${officeMapsUrl}`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "TOPIC_RESET") {
    fallbackReply = `${greetOnce}Sure, let's start fresh. What can I help you with today?`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "HUMAN_HANDOFF_INFO") {
    fallbackReply = `${greetOnce}When you ask to speak with someone, I connect you to our *Classic Concepts & Classic Edge 53 Sales Team*. Would you like me to connect you now?`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "OFF_TOPIC") {
    fallbackReply = `${greetOnce}Thank you for sharing this with us. I only assist with *Classic Concepts* and *Classic Edge 53* product enquiries, so please let me know if you need help with those.`;
    priority = "NORMAL";
  } else if (/\b(cloudy|white\s*edge|rough\s*edge|dull\s*edge|polish\s*problem|flame|burn|bubble|crack|bend\s*issue|warping|scratch|yellow)\b/i.test(lower)) {
    const issueSolutions: string[] = [];
    if (/cloudy|white|rough|dull|polish/i.test(lower)) {
      issueSolutions.push(
        `• *Cloudy or rough cut edges:* A *Diamond Edge Polishing Machine* gives a crystal-clear flat edge in one pass without flame stress marks.`
      );
    }
    if (/crack|bubble|bend|warp/i.test(lower)) {
      issueSolutions.push(
        `• *Bubbles or cracking while bending:* Using a temperature-controlled *Acrylic Bending Heater* with even heating solves this cleanly.`
      );
    }
    if (issueSolutions.length === 0) {
      issueSolutions.push(
        `• Using *cast clear acrylic* instead of extruded sheet prevents yellowing, burrs, and hairline cracks during fabrication.`
      );
    }
    const machineBlock = prebuiltGroupedBlock
      ? `\n\n${prebuiltGroupedBlock}`
      : top
      ? `\n\n*Matching Machine:*\n1. *${cleanDisplayProductName(top.name)}*\n   ${top.shortUrl || top.url}`
      : "";
    fallbackReply = `${greetOnce}Here is what usually causes that and how to fix it:\n\n${issueSolutions.join("\n\n")}${machineBlock}\n\nWhat *sheet thickness* are you working with, and are you cutting by laser or router?`;
    smartCategory = "Acrylic Machines (CE53)";
    priority = "HIGH";
  } else if (
    /\b(\d+\s*(?:mm|cm|inch|in|ft)\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?\s*x\s*\d+)\b/i.test(lower) &&
    /\b(\d+\s*(?:pcs|pieces|nos|units|qty)|quote|price)\b/i.test(contextLower)
  ) {
    fallbackReply = `${greetOnce}Got your custom size details! I have pinged our *Sales Team* on this chat with your dimensions so they can share exact sheet thickness, fabrication cost, and dispatch time.`;
    needsSalesTeamPing = true;
    salesTeamPingNote = `ACRIO Consultative Ping: Customer shared 3D custom dimensions for quote ("${rawText.slice(0, 120)}").`;
    smartCategory = "Custom Fabrication";
    priority = "HIGH";
  } else if (visionAnalysis) {
    const imgFallback = buildPhaseIImageFallbackReply({
      greetOnce,
      analysis: visionAnalysis,
      matches: contextMatches,
      hidePrices: hidePricesActive,
    });
    fallbackReply = imgFallback.reply;
    fallbackHandoff = imgFallback.handoff;
    fallbackReason = imgFallback.handoffReason;
    if (imgFallback.needsSalesPing) {
      needsSalesTeamPing = true;
      salesTeamPingNote = imgFallback.salesPingNote;
    }
    smartCategory = imgFallback.smartCategory;
    priority = imgFallback.priority;
  } else if (hasLegacyUnanalyzedMedia || isCustomStructureEnquiry) {
    const reqSummary = [
      ...(convState.preferences || []).filter(
        (p) => !rawText.toLowerCase().includes(p.toLowerCase())
      ),
      rawText
        .replace(/\b(photo|photos|image|images|pic|pics|pls|please|share|send|show)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim(),
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    const cleanReqLabel = reqSummary || convState.primaryProductQuery || "custom acrylic item";
    const refMediaLine = hasLegacyUnanalyzedMedia
      ? `Thank you for sharing ${burstMediaLabel} along with your requirement for *${cleanReqLabel}*.\n\n`
      : `Got your requirement for *${cleanReqLabel}*.\n\n`;
    const customBuildLine = isCustomStructureEnquiry
      ? `We custom-fabricate *${convState.preferences.includes("black") ? "Black " : ""}Acrylic Mobile Phone Lockers & Multi-Compartment Cabinets* to your exact compartment count, lock type, and dimensions.`
      : `We can custom-build this in cast acrylic to your exact size and finish.`;
    const closestReadyBlock =
      prebuiltGroupedBlock && contextMatches.length > 0
        ? `\n\nIf you also want to check our ready tabletop organizers in the meantime:\n${prebuiltGroupedBlock}`
        : "";
    if (hasLegacyUnanalyzedMedia) {
      fallbackHandoff = true;
      fallbackReason = `Customer shared ${burstMediaLabel} with enquiry "${cleanReqLabel.slice(0, 100)}" for team review and custom quote.`;
      fallbackReply = `${greetOnce}${refMediaLine}${customBuildLine}${closestReadyBlock}\n\nI have forwarded your ${burstImages > 1 ? "reference photos" : "reference details"} and requirement directly to our *Sales & Fabrication Team* so a specialist can share reference locker photos and an exact quote right away.`;
    } else {
      needsSalesTeamPing = true;
      salesTeamPingNote = `ACRIO Consultative Ping: Customer enquired about custom fabrication ("${cleanReqLabel.slice(0, 120)}").`;
      fallbackReply = `${greetOnce}${refMediaLine}${customBuildLine}${closestReadyBlock}\n\nHow many compartments/slots do you need, and what quantity are you looking for? I have also pinged our *Sales & Fabrication Team* to share reference locker photos and pricing with you here.`;
    }
    smartCategory = "Custom Fabrication";
    priority = "HIGH";
  } else if (aggregateResult) {
    fallbackReply = `${greetOnce}${aggregateResult.answer}`;
  } else if (pinnedFocusItem && buildFocusedAttributeAnswer(pinnedFocusItem, rawText)) {
    fallbackReply = `${greetOnce}${buildFocusedAttributeAnswer(pinnedFocusItem, rawText)}`;
  } else if (deepProductInfo?.deterministicDeepAnswer) {
    fallbackReply = `${greetOnce}${deepProductInfo.deterministicDeepAnswer}`;
  } else if (top && prebuiltGroupedBlock) {
    fallbackReply = `${greetOnce}${prebuiltGroupedBlock}\n\nLet me know which option fits your requirement best, or if you would like to compare sizes!`;
  } else if (budgetLabel && budgetFallbackLowestPrice && budgetFallbackLowestItem) {
    const cleanTitle = cleanDisplayProductName(budgetFallbackLowestItem.name);
    const link = budgetFallbackLowestItem.shortUrl || budgetFallbackLowestItem.url;
    fallbackReply = `${greetOnce}Our starting ready model in this category is:\n\n1. *${cleanTitle}* (₹${budgetFallbackLowestPrice.toLocaleString("en-IN")})\n   ${link}\n\nWould you like to check this model or explore a custom-built option for your budget?`;
  } else {
    fallbackReply = `${greetOnce}I would love to help find the right option for you.\n\nCould you share a little more about what you need?\n• *Stage & Events:* acrylic podiums/pulpits, awards, or plaques\n• *Furniture & Offices:* acrylic chairs, bar stools, tables, or office name plates\n• *Hotels & Retail:* menu/QR stands, risers, or display boxes\n• *Acrylic Machines:* cutting, bending, or diamond polishing`;
    priority = "NORMAL";
  }

  let finalFallback = stripRepeatedGreeting(
    formatWhatsAppOutboundText(fallbackReply),
    alreadyGreeted,
    params.customerName
  );
  if (hidePricesActive) {
    finalFallback = finalFallback
      .replace(/\s*\((?:₹|Rs\.?|INR)\s*[\d,]+(?:\s*,\s*MRP\s*₹[\d,]+)?\)/gi, "")
      .replace(/\b(?:₹|Rs\.?)\s*[\d,]+(?:\s*to\s*(?:₹|Rs\.?)\s*[\d,]+)?/gi, "available on request");
  }
  addStep(
    "Generated deterministic fallback WhatsApp reply",
    `intent=${intentInfo.intent}, matchedProducts=${contextMatches.length}, smartCategory="${smartCategory}", salesPing=${needsSalesTeamPing}`
  );

  recordAndBroadcastAiLog({
    website: "WHATSAPP_HUB",
    websiteLabel: "Classic Concepts WhatsApp Hub",
    feature: "Autonomous WhatsApp Concierge (ACRIO)",
    actor: params.customerName,
    question: rawText,
    model: lastAiError ? `${LOCKED_CLAUDE_MODEL} -> local-fallback` : "local-catalog",
    effort: "medium",
    outcomeSource: fallbackHandoff ? "HUMAN_HANDOFF" : "LOCAL_FALLBACK",
    responseCacheStatus: "BYPASS",
    catalogCacheStatus: cacheMeta.catalogCacheStatus,
    cacheDetails: `${cacheMeta.cacheSummary} • intent=${intentInfo.intent}`,
    productLookupTriggered: intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling,
    productLookupQuery: usedLookupQuery,
    productLookupBudget: budgetLabel,
    productLookupTotalScanned:
      intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling
        ? allItems.length
        : 0,
    productsLookedUp: contextMatches.map(mapProductToLogItem),
    steps,
    response: finalFallback,
    durationMs: Date.now() - started,
    tokenUsage: mergeAiTokenUsage(visionUsage, lastUsage),
    error: lastAiError,
  });

  const fallbackIsLocationAsk =
    (intentInfo.intent === "COMPANY_INFO" ||
      intentInfo.intent === "LEADERSHIP_CONTACT_INFO") &&
    /\b(where|location|address|map|maps|directions?|visit|reach|office|factory|workshop|pin)\b/i.test(
      rawText
    );
  const fallbackLocationPin: AcrioLocationPin | undefined = fallbackIsLocationAsk
    ? {
        latitude: liveBrandInfo?.latitude ?? 17.4947378,
        longitude: liveBrandInfo?.longitude ?? 78.496725,
        name: liveBrandInfo?.placeName || "Classic Concepts Acrylic Private Limited",
        address:
          liveBrandInfo?.address ||
          "1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015",
        mapsUrl:
          liveBrandInfo?.mapsUrl || "https://maps.google.com/?q=17.4947378,78.496725",
      }
    : undefined;

  return {
    needsHumanHandoff: fallbackHandoff,
    handoffReason: fallbackReason,
    needsSalesTeamPing,
    salesTeamPingNote,
    customerReply: finalFallback,
    smartCategory,
    priority,
    conversationState: convState,
    ...(fallbackLocationPin ? { locationPin: fallbackLocationPin } : {}),
  };
}
