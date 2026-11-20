import {
  cleanDisplayProductName,
  resolveSharedAnthropicApiKey,
  searchEcosystemItems,
  type AiLogWebsite,
  type AiTokenUsage,
  type AiTraceStep,
} from "@cc/database";
import {
  LOCKED_CLAUDE_MODEL,
  parseClaudeJson,
  callClaudeHaikuMessagesDetailed,
  recordAndBroadcastAiLog,
  mapProductToLogItem,
  formatWhatsAppOutboundText,
  sanitizePlainEnglish,
} from "@cc/connections/initialise.acrio.ai";
import {
  getCachedEcosystemCatalog,
  buildGroupedProductShortLinksSection,
} from "@cc/connections/helpers.acrio.ai";

export async function runGuardedButtonFlowAiReply(params: {
  customerName: string;
  buttonText: string;
  aiInstruction: string;
}): Promise<string> {
  const started = Date.now();
  const firstName = params.customerName.split(/[\s(]/)[0] || "there";
  const { allItems, cacheMeta } = await getCachedEcosystemCatalog();
  const lookupQuery = `${params.buttonText} ${params.aiInstruction}`.trim();
  const matches = searchEcosystemItems(allItems, lookupQuery, 3);
  const catalogLines = matches
    .map(
      (m) =>
        `• *${cleanDisplayProductName(m.name)}*${m.basePrice ? ` (₹${m.basePrice.toLocaleString("en-IN")})` : ""}: ${m.shortUrl || m.url}`
    )
    .join("\n");

  const { apiKey } = await resolveSharedAnthropicApiKey("client");
  if (apiKey) {
    const aiCall = await callClaudeHaikuMessagesDetailed({
      apiKey,
      maxTokens: 1600,
      effort: "medium",
      timeoutMs: 18000,
      system: `You are ACRIO for Classic Concepts & Classic Edge 53. Reply strictly to the button action below in under 75 words using simple everyday English, clean WhatsApp *bold* formatting, ₹ prices, and zero em-dashes or buzzwords.`,
      messages: [
        {
          role: "user",
          content: `Customer: ${firstName}\nClicked Template Button: "${params.buttonText}"\nButton Action Instruction: ${params.aiInstruction}\nCatalog links:\n${catalogLines || "(none)"}`,
        },
      ],
    });
    if (aiCall.ok && aiCall.text) {
      const formatted = formatWhatsAppOutboundText(aiCall.text);
      recordAndBroadcastAiLog({
        website: "WHATSAPP_HUB",
        websiteLabel: "Classic Concepts WhatsApp Hub",
        feature: "Guarded Template Button AI Reply",
        actor: params.customerName,
        question: `[Button: ${params.buttonText}] ${params.aiInstruction}`,
        model: LOCKED_CLAUDE_MODEL,
        effort: "medium",
        outcomeSource: "LIVE_AI",
        responseCacheStatus: "BYPASS",
        catalogCacheStatus: cacheMeta.catalogCacheStatus,
        cacheDetails: cacheMeta.cacheSummary,
        productLookupTriggered: true,
        productLookupQuery: lookupQuery,
        productLookupTotalScanned: allItems.length,
        productsLookedUp: matches.map(mapProductToLogItem),
        steps: [
          { stepNumber: 1, label: "Matched products for button context", detail: `${matches.length} items` },
          { stepNumber: 2, label: "Generated reply with Claude Haiku 5.5 (effort=medium)", detail: `${aiCall.durationMs}ms` },
        ],
        response: formatted,
        durationMs: Date.now() - started,
        tokenUsage: aiCall.usage,
      });
      return formatted;
    }
  }

  const top = matches[0];
  const fallback = formatWhatsAppOutboundText(
    `Thanks for selecting *${params.buttonText}*!${top ? `\n\nTake a look at *${cleanDisplayProductName(top.name)}*:\n${top.shortUrl || top.url}` : ""}\n\nShare your required quantity or size and we will help right away.`
  );
  recordAndBroadcastAiLog({
    website: "WHATSAPP_HUB",
    websiteLabel: "Classic Concepts WhatsApp Hub",
    feature: "Guarded Template Button AI Reply",
    actor: params.customerName,
    question: `[Button: ${params.buttonText}] ${params.aiInstruction}`,
    model: "local-fallback",
    outcomeSource: "LOCAL_FALLBACK",
    responseCacheStatus: "BYPASS",
    catalogCacheStatus: cacheMeta.catalogCacheStatus,
    cacheDetails: cacheMeta.cacheSummary,
    productLookupTriggered: true,
    productLookupQuery: lookupQuery,
    productLookupTotalScanned: allItems.length,
    productsLookedUp: matches.map(mapProductToLogItem),
    steps: [{ stepNumber: 1, label: "Returned deterministic button reply", detail: `${matches.length} items` }],
    response: fallback,
    durationMs: Date.now() - started,
  });
  return fallback;
}

export interface EvaluatedWebsiteEnquiryResult {
  smartReplyText: string;
  whatsappSummaryText: string;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL";
  recommendedTeamId: string;
  matchedItems: {
    name: string;
    brandLabel: string;
    shortUrl: string;
    priceInr: number | null;
  }[];
}

export async function evaluateWebsiteEnquiryWithAi(params: {
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  message: string;
  productName?: string;
  sourcePage?: string;
}): Promise<EvaluatedWebsiteEnquiryResult> {
  const started = Date.now();
  const steps: AiTraceStep[] = [];
  const firstName = params.customerName.split(/[\s(]/)[0] || "there";
  const rawMessage = String(params.message || "");
  const staffNoteMatch = rawMessage.match(/\[Staff Note(?:\s*\/\s*Tone)?:\s*([^\]]+)\]/i);
  const staffNote = staffNoteMatch ? staffNoteMatch[1].trim() : "";
  const cleanCustomerMessage = rawMessage
    .replace(/\[Staff Note(?:\s*\/\s*Tone)?:\s*[^\]]+\]/gi, "")
    .trim();
  const isStaffDecline = Boolean(
    staffNote &&
      /\b(we\s+don'?t\s+deal|do\s+not\s+deal|we\s+do\s+not\s+make|don'?t\s+make|don'?t\s+manufacture|do\s+not\s+manufacture|we\s+don'?t\s+(?:supply|sell|offer|provide)|not\s+in\s+our\s+range|out\s+of\s+scope)\b/i.test(
        staffNote
      )
  );
  const isTestProbe =
    /^(?:test|testing|abcd|dummy|sample|asdf)$/i.test(cleanCustomerMessage) ||
    (/^test$/i.test(cleanCustomerMessage) && !params.productName);
  const combinedQuery = `${params.productName || ""} ${cleanCustomerMessage}`.trim();
  const lower = combinedQuery.toLowerCase();
  const logWebsite: AiLogWebsite =
    params.brand === "CLASSIC_EDGE_53" ? "CLASSIC_EDGE_53" : "CLASSIC_CONCEPTS";
  const logWebsiteLabel =
    params.brand === "CLASSIC_EDGE_53"
      ? "Classic Edge 53 (classicedge53.com -> Hub)"
      : "Classic Concepts (classicconcepts.in -> Hub)";

  const { allItems, cacheMeta } = await getCachedEcosystemCatalog();
  const matches =
    isStaffDecline || isTestProbe
      ? []
      : searchEcosystemItems(allItems, combinedQuery, 4);

  steps.push(
    {
      stepNumber: 1,
      label: "Checked ecosystem catalog cache",
      detail: cacheMeta.cacheSummary,
      durationMs: Date.now() - started,
      status: "OK",
    },
    {
      stepNumber: 2,
      label: "Looked up matching products for website enquiry",
      detail: isStaffDecline
        ? `Skipped product lookup because Staff Note says we do not deal`
        : `query="${combinedQuery.slice(0, 80)}", matched=${matches.length} of ${allItems.length}`,
      durationMs: Date.now() - started,
      status: "OK",
    }
  );

  let smartCategory =
    params.brand === "CLASSIC_EDGE_53"
      ? "Acrylic Machines (CE53)"
      : "General Enquiry";
  let priority: "URGENT" | "HIGH" | "NORMAL" =
    isStaffDecline || isTestProbe ? "NORMAL" : "HIGH";

  if (!isStaffDecline && !isTestProbe) {
    if (/\b(machine|machines|laser|router|polish|polishing|diamond|bending|bender|heater|yn-|ce53|blade|cutter)\b/i.test(lower)) {
      smartCategory = "Acrylic Machines (CE53)";
      priority = "HIGH";
    } else if (/\b(podium|lectern|pulpit|stage|auditorium)\b/i.test(lower)) {
      smartCategory = "Podiums & Stage";
      priority = /urgent|tomorrow|friday|today|week/i.test(lower) ? "URGENT" : "HIGH";
    } else if (/\b(trophy|trophies|memento|mementos|award|plaque)\b/i.test(lower)) {
      smartCategory = "Awards & Trophies";
    } else if (/\b(hotel|banquet|menu|qr|resort|table\s*stand)\b/i.test(lower)) {
      smartCategory = "Hotel & Banquet";
    } else if (/\b(cover|guard|enclosure|box|custom|mm|inch|corian|solid\s*surface|cladding|sheet|block)\b/i.test(lower)) {
      smartCategory = "Custom Fabrication";
    }
  }

  const brandName =
    params.brand === "CLASSIC_EDGE_53" ? "Classic Edge 53" : "Classic Concepts";

  const matchedItems = matches.map((m) => ({
    name: cleanDisplayProductName(m.name),
    brandLabel: m.brandLabel,
    shortUrl: m.shortUrl || m.url,
    priceInr: m.basePrice,
  }));

  const groupedEnquiryBlock =
    isStaffDecline || isTestProbe
      ? ""
      : buildGroupedProductShortLinksSection({
          allItems,
          matchedItems: matches,
          smartCategory,
        });

  if (isTestProbe) {
    const testReplyWa = `Hi ${firstName}, thanks for reaching out to *${brandName}*. Please reply with the product or requirement you need help with.`;
    recordAndBroadcastAiLog({
      website: logWebsite,
      websiteLabel: logWebsiteLabel,
      feature: "Website Form Enquiry AI Evaluator",
      actor: `${params.customerName}${params.customerPhone ? ` (${params.customerPhone})` : ""}`,
      question: cleanCustomerMessage || params.message,
      model: "rule-test-enquiry-guard",
      effort: "low",
      outcomeSource: "LIVE_AI",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: cacheMeta.catalogCacheStatus,
      cacheDetails: "Detected test form submission; skipped live AI call",
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: testReplyWa,
      durationMs: Date.now() - started,
    });
    return {
      smartReplyText: testReplyWa.replace(/\*/g, ""),
      whatsappSummaryText: testReplyWa,
      smartCategory: "General Enquiry",
      priority: "NORMAL",
      recommendedTeamId: "team_sales",
      matchedItems: [],
    };
  }

  const clientKey = await resolveSharedAnthropicApiKey("client");
  const adminKey = await resolveSharedAnthropicApiKey("admin");
  const apiKey = clientKey.apiKey || adminKey.apiKey;
  let lastAiError: string | null = null;
  let lastUsage: AiTokenUsage | null = null;

  if (apiKey) {
    try {
      const aiCall = await callClaudeHaikuMessagesDetailed({
        apiKey,
        maxTokens: 1200,
        effort: "low",
        timeoutMs: 24000,
        system: `You draft concise, plain-English enquiry replies for Classic Concepts (acrylic products) & Classic Edge 53 (acrylic machines) matching the Brand specified in context.
RULES:
1. Address the customer's first name politely in simple everyday English. Keep replies crisp and direct (3 to 6 short lines).
2. If [Staff Note / Instruction] says we do not deal in or cannot make the requested item, politely decline in 2 to 4 short lines and STOP. NEVER pitch or recommend unrelated machines or products!
3. Otherwise answer what they asked using ONLY verified https://ccapl.cc/<id> shortlinks and ₹ prices in context, and ask at most 1 to 2 practical details (quantity, delivery city, or size) so Sales can confirm.
4. Zero em-dashes, zero double-hyphens, zero robotic AI buzzwords (no bespoke, seamless, robust, utilize, leverage, meticulous, elevate).
Return ONLY valid JSON:
{
  "smartCategory": "Default or refined category string",
  "priority": "NORMAL | HIGH | URGENT",
  "smartReplyText": "Concise email-friendly plain text reply",
  "whatsappSummaryText": "Concise WhatsApp-formatted reply (*bold* + shortlinks only if relevant)"
}`,
        messages: [
          {
            role: "user",
            content: `Brand: ${brandName}\nCustomer: ${params.customerName} (First Name: ${firstName})\nDefault Category: ${smartCategory}\nDefault Priority: ${priority}\nProduct Selected: ${params.productName ? cleanDisplayProductName(params.productName) : "General"}\nCustomer Enquiry: ${cleanCustomerMessage || params.message}${staffNote ? `\nStaff Note / Instruction: ${staffNote}` : ""}\n${isStaffDecline ? "Matched Products: NONE (Staff confirmed we do not deal in this item; do NOT pitch any products or machines)." : groupedEnquiryBlock || "No direct ready catalog match; confirm whether custom fabrication applies or ask 1-2 short clarifying details."}`,
          },
        ],
      });

      lastUsage = aiCall.usage;
      if (aiCall.ok && aiCall.text) {
        const parsed = parseClaudeJson<any>(aiCall.text);
        if (parsed && parsed.smartReplyText) {
          const cleanEmailText = sanitizePlainEnglish(
            String(parsed.smartReplyText)
          ).replace(/\*/g, "");
          const cleanWaText = formatWhatsAppOutboundText(
            String(parsed.whatsappSummaryText || parsed.smartReplyText)
          );
          const resolvedCategory = isStaffDecline
            ? "General Enquiry"
            : parsed.smartCategory || smartCategory;

          steps.push({
            stepNumber: 3,
            label: "Evaluated enquiry with Claude Haiku 5.5 (effort=low)",
            detail: `HTTP ${aiCall.statusCode} in ${aiCall.durationMs}ms -> category="${resolvedCategory}"`,
            durationMs: Date.now() - started,
            status: "OK",
          });

          recordAndBroadcastAiLog({
            website: logWebsite,
            websiteLabel: logWebsiteLabel,
            feature: "Website Form Enquiry AI Evaluator",
            actor: `${params.customerName}${params.customerPhone ? ` (${params.customerPhone})` : ""}`,
            question: params.productName
              ? `[Product: ${params.productName}] ${params.message}`
              : params.message,
            model: LOCKED_CLAUDE_MODEL,
            effort: "low",
            outcomeSource: "LIVE_AI",
            responseCacheStatus: "BYPASS",
            catalogCacheStatus: cacheMeta.catalogCacheStatus,
            cacheDetails: cacheMeta.cacheSummary,
            productLookupTriggered: !isStaffDecline,
            productLookupQuery: isStaffDecline ? "" : combinedQuery,
            productLookupTotalScanned: isStaffDecline ? 0 : allItems.length,
            productsLookedUp: isStaffDecline ? [] : matches.map(mapProductToLogItem),
            steps,
            response: cleanWaText,
            durationMs: Date.now() - started,
            tokenUsage: aiCall.usage,
          });

          return {
            smartReplyText: cleanEmailText,
            whatsappSummaryText: cleanWaText,
            smartCategory: resolvedCategory,
            priority: parsed.priority || priority,
            recommendedTeamId: "team_sales",
            matchedItems,
          };
        }
        lastAiError = "Claude website enquiry JSON parse failed.";
      } else {
        lastAiError = aiCall.error || "Anthropic enquiry evaluation failed.";
      }
    } catch (err: any) {
      lastAiError = err?.message || "Enquiry AI exception";
    }
  } else {
    lastAiError = "Anthropic API key not configured.";
  }

  const cleanSelectedProd = params.productName
    ? cleanDisplayProductName(params.productName)
    : "";
  const fallbackWa = formatWhatsAppOutboundText(
    `Hi ${firstName}! Thank you for your enquiry on *${brandName}*${cleanSelectedProd ? ` regarding *${cleanSelectedProd}*` : ""}.\n\n${
      groupedEnquiryBlock ? `${groupedEnquiryBlock}\n\n` : ""
    }To prepare your exact quotation and dispatch timeline, please share:\n• *Quantity needed*\n• *Delivery city / pincode*${
      params.brand === "CLASSIC_EDGE_53"
        ? "\n• *Max acrylic sheet thickness you work with*"
        : "\n• *Any custom size or logo printing needed*"
    }\n\nOur *Sales Team* has also received your enquiry and is ready to assist you.`
  );

  steps.push({
    stepNumber: steps.length + 1,
    label: "Generated deterministic website enquiry reply",
    detail: lastAiError || "Fallback used",
    durationMs: Date.now() - started,
    status: "WARN",
  });

  recordAndBroadcastAiLog({
    website: logWebsite,
    websiteLabel: logWebsiteLabel,
    feature: "Website Form Enquiry AI Evaluator",
    actor: `${params.customerName}${params.customerPhone ? ` (${params.customerPhone})` : ""}`,
    question: params.productName
      ? `[Product: ${params.productName}] ${params.message}`
      : params.message,
    model: `${LOCKED_CLAUDE_MODEL} -> local-fallback`,
    effort: "medium",
    outcomeSource: "LOCAL_FALLBACK",
    responseCacheStatus: "BYPASS",
    catalogCacheStatus: cacheMeta.catalogCacheStatus,
    cacheDetails: cacheMeta.cacheSummary,
    productLookupTriggered: true,
    productLookupQuery: combinedQuery,
    productLookupTotalScanned: allItems.length,
    productsLookedUp: matches.map(mapProductToLogItem),
    steps,
    response: fallbackWa,
    durationMs: Date.now() - started,
    tokenUsage: lastUsage,
    error: lastAiError,
  });

  return {
    smartReplyText: fallbackWa.replace(/\*/g, ""),
    whatsappSummaryText: fallbackWa,
    smartCategory,
    priority,
    recommendedTeamId: "team_sales",
    matchedItems,
  };
}
