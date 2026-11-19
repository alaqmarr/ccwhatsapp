import {
  buildEcosystemDeepProductContextAndAnswer,
  cleanDisplayProductName,
  extractCompactDimensionPairsFromText,
  extractExplicitProductOrModelCodes,
  searchEcosystemItems,
  type MainWebsiteProduct,
} from "@cc/database";
import {
  recordAndBroadcastAiLog,
  mapProductToLogItem,
  formatWhatsAppOutboundText,
  stripRepeatedGreeting,
} from "@cc/connections/initialise.acrio.ai";
import {
  type AcrioRecommendedItem,
  type AcrioChatCopilotResult,
  type CatalogCacheMeta,
  getCachedEcosystemCatalog,
  buildGroupedProductShortLinksSection,
  classifyAcrioInboundIntent,
  reconstructAcrioConversationState,
  buildNormalizedSearchFromState,
} from "@cc/connections/helpers.acrio.ai";

export async function runAcrioChatCopilot(params: {
  customerName: string;
  organizationType?: string;
  recentMessages: { direction: string; body: string }[];
  ordersSummary?: string[];
}): Promise<AcrioChatCopilotResult> {
  const started = Date.now();
  // Exclude internal team notes when suggesting customer replies
  const customerMessages = params.recentMessages.filter(
    (m) => m.direction === "INBOUND" || m.direction === "OUTBOUND"
  );
  const alreadyGreeted = customerMessages.some(
    (m) => m.direction === "OUTBOUND"
  );
  const lastInbound =
    [...customerMessages]
      .reverse()
      .find((m) => m.direction === "INBOUND")?.body ||
    customerMessages[customerMessages.length - 1]?.body ||
    "";

  const recentInboundContext = customerMessages
    .filter((m) => m.direction === "INBOUND")
    .slice(-3)
    .map((m) => m.body)
    .join(" ");

  const intentInfo = classifyAcrioInboundIntent(
    lastInbound,
    customerMessages.length > 1
  );
  const convState = reconstructAcrioConversationState({
    recentMessages: customerMessages,
    currentInboundText: lastInbound,
  });
  const lower = intentInfo.allowRollingContextFallback
    ? `${convState.primaryProductQuery || recentInboundContext} ${lastInbound}`.toLowerCase()
    : lastInbound.toLowerCase();

  let allItems: MainWebsiteProduct[] = [];
  let cacheMeta: CatalogCacheMeta = {
    ccCacheTier: "BYPASS",
    ce53CacheTier: "BYPASS",
    catalogCacheStatus: "BYPASS",
    cacheSummary: `Skipped catalog fetch for intent=${intentInfo.intent}`,
  };
  let catalog: MainWebsiteProduct[] = [];
  let usedQuery = "";

  if (intentInfo.requiresProductLookup) {
    const fetched = await getCachedEcosystemCatalog();
    allItems = fetched.allItems;
    cacheMeta = fetched.cacheMeta;
    const { searchQuery, searchOptions } = buildNormalizedSearchFromState(
      convState,
      lastInbound
    );
    usedQuery = searchQuery;
    catalog = searchEcosystemItems(allItems, searchQuery, 8, searchOptions);
    if (searchQuery !== lastInbound) {
      const directMatches = searchEcosystemItems(allItems, lastInbound, 8, searchOptions);
      if (catalog.length === 0) {
        catalog = directMatches;
      } else if (
        directMatches.length > 0 &&
        (extractExplicitProductOrModelCodes(lastInbound).length > 0 ||
          extractCompactDimensionPairsFromText(lastInbound).pairs.length > 0)
      ) {
        const seen = new Set<string>();
        catalog = [...directMatches, ...catalog].filter((it) => {
          const k = `${it.brand}:${it.slug || it.id}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }).slice(0, 8);
      }
    }
  }

  let smartCategory = convState.activeCategory || "General Enquiry";
  let priority: AcrioChatCopilotResult["priority"] = "NORMAL";

  if (intentInfo.requiresProductLookup) {
    if (/machine|laser|router|polish|diamond|bending|bender|heater|yn-|ce53|classic edge|consumable|blade|cutter/i.test(lower)) {
      smartCategory = "Acrylic Machines (CE53)";
      priority = "HIGH";
    } else if (/podium|lectern|pulpit|stage|auditorium|conference/i.test(lower)) {
      smartCategory = "Podiums & Stage";
      priority = /friday|urgent|tomorrow|week/i.test(lower) ? "URGENT" : "HIGH";
    } else if (/trophy|trophies|memento|award|student|convocation|plaque/i.test(lower)) {
      smartCategory = "Awards & Trophies";
      priority = /\b\d{2,4}\b|bulk/i.test(lower) ? "HIGH" : "NORMAL";
    } else if (/hotel|banquet|menu|qr|resort|hospitality/i.test(lower)) {
      smartCategory = "Hotel & Banquet";
      priority = "HIGH";
    } else if (/cover|guard|enclosure|cnc|drawing|custom|mm|inch/i.test(lower)) {
      smartCategory = "Custom Fabrication";
      priority = "HIGH";
    }
  } else if (intentInfo.intent === "ORDER_STATUS") {
    smartCategory = "Order & Delivery";
  } else if (intentInfo.intent === "SUPPORT_ISSUE" || intentInfo.intent === "HUMAN_HANDOFF_REQUEST") {
    priority = "HIGH";
  }

  const firstName = params.customerName.split(/[\s(]/)[0] || "there";
  const greetPrefix = alreadyGreeted ? "" : `Hi ${firstName},\n\n`;
  const topProduct = catalog[0];

  const mappedRecommendations: AcrioRecommendedItem[] = catalog.map((c) => ({
    name: c.name,
    slug: c.slug,
    sku: c.sku,
    priceInr: c.basePrice,
    url: c.url,
    shortCode: c.shortCode || null,
    shortUrl: c.shortUrl || null,
    brand: c.brand,
    brandLabel: c.brandLabel,
    itemType: c.itemType,
    modelsSummary: c.modelsSummary || null,
  }));

  // Zero Anthropic AI calls here to save AI credits - AI is strictly reserved for
  // runAcrioAutonomousTurn when a chat is assigned to System (ACRIO)!
  const groupedPreview = intentInfo.requiresProductLookup
    ? buildGroupedProductShortLinksSection({
        allItems,
        matchedItems: catalog,
        smartCategory,
        excludeConsumables: convState.excludedItemTypes.includes("CONSUMABLE"),
        hasStrictBudget: convState.maxPrice !== null || convState.minPrice !== null,
      })
    : "";

  const deepCopilotInfo = intentInfo.requiresProductLookup
    ? buildEcosystemDeepProductContextAndAnswer({
        rawQuery: lastInbound,
        matchedItems: catalog,
        formatItemLink: (it) => it.shortUrl || it.url,
      })
    : null;

  const localReplies: string[] = [];
  if (deepCopilotInfo?.deterministicDeepAnswer) {
    localReplies.push(`${greetPrefix}${deepCopilotInfo.deterministicDeepAnswer}`);
  }
  if (intentInfo.intent === "IDENTITY_META") {
    localReplies.push(
      `${greetPrefix}I am *ACRIO*, the WhatsApp product & fabrication assistant for *Classic Concepts* (ready & custom acrylic products) and *Classic Edge 53* (acrylic fabrication machines & tools).\n\nTell me what you want to display, build, or fabricate and I will share matching options right away.`,
      `${greetPrefix}I help you compare ready *acrylic podiums, awards, stands, custom boxes*, and *Classic Edge 53 machines*, and I can connect you to our Sales Team anytime for formal quotes.`
    );
  } else if (intentInfo.intent === "COMPANY_INFO") {
    localReplies.push(
      `${greetPrefix}*Classic Concepts* manufactures clear acrylic podiums, awards, hotel/retail stands, and custom acrylic fabrication, while *Classic Edge 53* supplies industrial acrylic bending, diamond edge polishing, and cutting machines from our Secunderabad / Hyderabad facility with pan-India dispatch.`,
      `${greetPrefix}We dispatch pan-India with full GST billing. Let us know which product or machine you are looking for and your delivery city.`
    );
  } else if (intentInfo.intent === "TOPIC_RESET") {
    localReplies.push(
      `${greetPrefix}Sure, let's start fresh! Tell me what you need help with and I will guide you right away.`,
      `${greetPrefix}Of course! Share your new question or requirement whenever you are ready.`
    );
  } else if (intentInfo.intent === "HUMAN_HANDOFF_INFO") {
    localReplies.push(
      `${greetPrefix}When you ask for a team member, I connect your chat directly to our *Classic Concepts & Classic Edge 53 Sales & Fabrication Team* right here on WhatsApp so a specialist can help with custom quotes, bulk pricing, or order updates.`,
      `${greetPrefix}Would you like me to connect our *Sales Team* to this chat now, or would you like to check any product options first?`
    );
  } else if (smartCategory === "Acrylic Machines (CE53)") {
    localReplies.push(
      groupedPreview
        ? `${greetPrefix}${groupedPreview}\n\nWhat *sheet thickness* and *working width* are you working with?`
        : `${greetPrefix}Please share the *sheet thickness* and *working width* you need, and I will suggest the right Classic Edge 53 machine models and brochure.`,
      `${greetPrefix}Would you like me to share the *spec sheet*, *demo video*, and *landed price* for your city?`,
      `${greetPrefix}We also keep genuine *diamond cutters*, *heaters*, and machine consumables ready in stock. Share your city and required size so we can check dispatch.`
    );
  } else if (smartCategory === "Podiums & Stage") {
    localReplies.push(
      groupedPreview
        ? `${greetPrefix}${groupedPreview}\n\nLet us know your *event date*, *preferred height*, or if you want your *front logo* added before dispatch.`
        : `${greetPrefix}Yes, we have wide-top clear *stage podiums* ready and can add your front logo before dispatch.\n\nShall I share our ready models and sizes?`,
      `${greetPrefix}Share your *event date* and *delivery city* so we can check ready stock and dispatch timing right away.`,
      topProduct
        ? `${greetPrefix}Our *${cleanDisplayProductName(topProduct.name)}* is ready for logo customization:\n${topProduct.shortUrl || topProduct.url}\n\nWould you like a layout preview with your logo?`
        : `${greetPrefix}Please share your logo file and delivery pincode so we can confirm total cost and timeline.`
    );
  } else if (smartCategory === "Awards & Trophies") {
    localReplies.push(
      groupedPreview
        ? `${greetPrefix}${groupedPreview}\n\nRoughly *how many pieces* do you need, and what is your *event date*?`
        : `${greetPrefix}For ceremonies and events, we make clear *acrylic awards and plaques* with custom logo and recipient name printing.`,
      `${greetPrefix}Please share:\n• *Quantity needed*\n• *Event date*\n• *Your logo file*\n\nWe will send matching trophy options with bulk pricing.`,
      topProduct
        ? `${greetPrefix}Our *${cleanDisplayProductName(topProduct.name)}*${topProduct.basePrice ? ` (*₹${topProduct.basePrice.toLocaleString("en-IN")}*)` : ""} is a popular choice:\n${topProduct.shortUrl || topProduct.url}\n\nWould you like a sample layout with your logo?`
        : `${greetPrefix}We can print your logo and recipient names cleanly on clear acrylic awards. Roughly how many pieces do you need?`
    );
  } else if (smartCategory === "Custom Fabrication") {
    localReplies.push(
      groupedPreview
        ? `${greetPrefix}${groupedPreview}\n\nFor custom sizes, share your *length x width x height*, *thickness in mm*, and *quantity* so we can calculate the exact quote.`
        : `${greetPrefix}Please share the approximate *length x width x height*, *thickness in mm*, and *quantity* (or even a quick photo/sketch), and we will work out the exact quote.`,
      `${greetPrefix}Once confirmed, we share a clear size layout for your approval before cutting and bending begins.`,
      `${greetPrefix}We custom-make clear acrylic covers, boxes, stands, and displays to exact sizes. What will you be placing inside or displaying on it?`
    );
  } else {
    localReplies.push(
      groupedPreview
        ? `${greetPrefix}${groupedPreview}\n\nLet me know which option fits best, or share the size and quantity you have in mind.`
        : `${greetPrefix}Tell us a little about what you want to display, build, or solve, and I will suggest the best acrylic product or Classic Edge 53 machine options right away.`,
      `${greetPrefix}Do you need *ready acrylic products* (podiums, stands, awards, custom boxes) or *Classic Edge 53 machines & tools*? Share a few details and we will help you pick the right option.`,
      `${greetPrefix}I am checking this for you now and will share the exact details shortly.`
    );
  }

  const formattedSuggestions = localReplies.map((r) =>
    stripRepeatedGreeting(formatWhatsAppOutboundText(r), alreadyGreeted, params.customerName)
  );

  if (lastInbound.trim()) {
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Staff Inbox Co-Pilot (0-Credit Local)",
      actor: params.customerName,
      question: lastInbound,
      model: "local-catalog",
      outcomeSource: "LOCAL_FALLBACK",
      responseCacheStatus: "LOCAL_ONLY",
      catalogCacheStatus: cacheMeta.catalogCacheStatus,
      cacheDetails: `${cacheMeta.cacheSummary} • intent=${intentInfo.intent} • Zero AI credits used for staff suggestions`,
      productLookupTriggered: intentInfo.requiresProductLookup,
      productLookupQuery: usedQuery,
      productLookupTotalScanned: intentInfo.requiresProductLookup ? allItems.length : 0,
      productsLookedUp: catalog.map(mapProductToLogItem),
      steps: [
        {
          stepNumber: 1,
          label: "Loaded customer chat context",
          detail: `${customerMessages.length} turns, alreadyGreeted=${alreadyGreeted}`,
        },
        {
          stepNumber: 2,
          label: "Classified inbound turn intent",
          detail: `intent=${intentInfo.intent}, requiresProductLookup=${intentInfo.requiresProductLookup} (${intentInfo.reason})`,
        },
        ...(intentInfo.requiresProductLookup
          ? [
              {
                stepNumber: 3,
                label: "Fetched ecosystem catalog & matched products",
                detail: `${cacheMeta.cacheSummary}, matched=${catalog.length} products`,
              },
            ]
          : []),
      ],
      response: formattedSuggestions[0] || "",
      durationMs: Date.now() - started,
    });
  }

  return {
    engineLabel: "ACRIO",
    smartCategory,
    priority,
    suggestedReplies: formattedSuggestions,
    recommendedProducts: mappedRecommendations,
    resolutionDraft: formatWhatsAppOutboundText(
      `Shared ${smartCategory.toLowerCase()} options and pricing details with ${params.customerName}, and updated customer follow-up notes.`
    ),
  };
}
