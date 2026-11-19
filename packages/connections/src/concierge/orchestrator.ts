import {
  buildEcosystemDeepProductContextAndAnswer,
  buildMultiItemProjectPlan,
  extractCustomerCoreNouns,
  extractExplicitProductOrModelCodes,
  findMatchingAiTrainingGuidance,
  getVerifiedLiveBrandAndTeamInfo,
  loadLiveDatabaseOperationalContext,
  type AiTraceStep,
} from "@cc/database";
import { recordAndBroadcastAiLog } from "@cc/connections/initialise.acrio.ai";
import {
  buildGroupedProductShortLinksSection,
  classifyAcrioInboundIntent,
  detectAcrioCustomerProfile,
  getCachedEcosystemCatalog,
  isListPickText,
  loadConversationAiState,
  normalizeCustomerProductTypos,
  reconstructAcrioConversationState,
  saveConversationAiState,
  stripBurstMediaPlaceholders,
} from "@cc/connections/helpers.acrio.ai";
import {
  type AcrioAutonomousTurnResult,
  type AcrioReplyToMessageContext,
  type AcrioTurnParams,
  type AcrioUiSink,
  ACRIO_TEAM_ASK_TEXT,
  buildTeamConnectInteractive,
  decorateAcrioReplyWithInteractive,
} from "@cc/connections/interactive.acrio.ai";
import { executeConciergeCatalogLookup } from "./catalog-lookup";
import { buildConciergeFallbackReply } from "./fallback-engine";
import {
  handleImmediateHandoffTurn,
  handlePreferenceOnlyFragmentTurn,
} from "./handoff-and-fragments";
import { tryResolveConciergeMediaReply } from "./media-dispatch";
import { runConciergeClaudeTurn } from "./prompt-and-ai";
import { processInboundMediaAndVision } from "./vision-handler";
import { cacheConversationImageAnalysis } from "./vision-prompts";

export async function runAcrioAutonomousTurn(
  params: AcrioTurnParams
): Promise<AcrioAutonomousTurnResult> {
  const sink: AcrioUiSink & { skipInteractiveOverride?: boolean } = params.uiSink || { matches: [] };
  const res = await runAcrioAutonomousTurnCore({ ...params, uiSink: sink });
  if (
    params.enableInteractive === false ||
    res.needsHumanHandoff ||
    res.interactive ||
    sink.skipInteractiveOverride
  ) {
    return res;
  }
  try {
    const extra = decorateAcrioReplyWithInteractive(res, sink, params.inboundText);
    if (extra?.interactive?.kind === "list" && res.conversationState) {
      res.conversationState.lastListedSlugs = extra.interactive.rows.map((r) => r.id.replace(/^acrio:prod:/, ""));
      await saveConversationAiState(params.conversationId, res.conversationState);
    }
    return extra ? { ...res, ...extra } : res;
  } catch {
    return res;
  }
}

async function runAcrioAutonomousTurnCore(
  params: AcrioTurnParams
): Promise<AcrioAutonomousTurnResult> {
  const started = Date.now();
  const steps: AiTraceStep[] = [];
  const addStep = (
    label: string,
    detail?: string,
    status: AiTraceStep["status"] = "OK"
  ) => {
    steps.push({
      stepNumber: steps.length + 1,
      label,
      detail,
      durationMs: Date.now() - started,
      status,
    });
  };

  const originalInboundText = params.inboundText.trim();
  const burstStripped = stripBurstMediaPlaceholders(originalInboundText);
  const cleanCustomerText = normalizeCustomerProductTypos(burstStripped.cleanText).trim();
  const rawText = cleanCustomerText || originalInboundText;
  const rawFirstToken = (params.customerName || "").split(/[\s(]/)[0] || "";
  const firstName =
    !rawFirstToken || /^[\d+\s()+.-]+$/.test(rawFirstToken) ? "there" : rawFirstToken;

  const history = (params.recentMessages || []).filter(
    (m) =>
      (m.direction === "INBOUND" || m.direction === "OUTBOUND") &&
      Boolean(String(m.body || "").trim())
  );

  const alreadyGreeted =
    Boolean(params.hasAlreadyGreeted) ||
    history.some((m) => m.direction === "OUTBOUND");

  const storedState =
    params.persistedState !== undefined
      ? params.persistedState
      : await loadConversationAiState(params.conversationId);

  const mediaStep = await processInboundMediaAndVision({
    params,
    started,
    steps,
    addStep,
    originalInboundText,
    cleanCustomerText,
    rawText,
    firstName,
    alreadyGreeted,
    history,
    storedState,
    burstStripped,
  });
  if (mediaStep.earlyReturn) {
    return mediaStep.earlyReturn;
  }

  const {
    visionAnalysis,
    visionUsage,
    visionFromCache,
    visionSha256,
    visionRecordedNewCall,
    hasBurstReferenceMedia,
    burstMediaLabel,
    burstImages,
  } = mediaStep;

  const recentInboundWindow = [
    ...history
      .filter((m) => m.direction === "INBOUND")
      .slice(-4)
      .map((m) => m.body),
    rawText,
  ].join(" ");
  const contextLower = recentInboundWindow.toLowerCase();

  const latestInboundInHistory = [...history].reverse().find((m) => m.direction === "INBOUND");
  const quotedReplyContext: AcrioReplyToMessageContext | null =
    params.replyToMessage ||
    (latestInboundInHistory && latestInboundInHistory.body.trim() === rawText
      ? latestInboundInHistory.replyTo || null
      : null);
  const quotedBody = String(quotedReplyContext?.body || "").trim();

  let intentInfo = classifyAcrioInboundIntent(
    rawText,
    history.length > 0 || Boolean(storedState?.turnCount) || Boolean(quotedReplyContext)
  );

  const outboundBodies = history
    .filter((m) => m.direction === "OUTBOUND")
    .map((m) => String(m.body || ""))
    .reverse();
  const countAcrioLinks = (b: string) =>
    new Set(b.match(/https?:\/\/ccapl\.cc\/[^\s)*>]+/gi) || []).size;
  const lastOutboundBody =
    quotedBody && countAcrioLinks(quotedBody) >= 1
      ? quotedBody
      : countAcrioLinks(outboundBodies[0] || "") >= 2
      ? outboundBodies[0]
      : outboundBodies.slice(1, 4).find((b) => countAcrioLinks(b) >= 2) || outboundBodies[0] || "";
  const hasListPickWording = isListPickText(rawText);
  if (
    hasListPickWording &&
    (/https?:\/\/ccapl\.cc\//i.test(lastOutboundBody) || /View options/i.test(outboundBodies[0] || "") || Boolean(quotedBody)) &&
    !intentInfo.needsImmediateHandoff &&
    intentInfo.intent !== "TOPIC_RESET" &&
    intentInfo.intent !== "HUMAN_HANDOFF_REQUEST"
  ) {
    intentInfo = {
      ...intentInfo,
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      reason: "Customer picked an item from the list we sent",
    };
  }
  if (params.forcedFocusSlug) {
    intentInfo = {
      ...intentInfo,
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      needsImmediateHandoff: false,
      reason: "Customer tapped a product in the View options list",
    };
  }
  const hasActiveProductMemory = Boolean(
    storedState?.focusProductSlug ||
      (storedState?.lastRecommendedProducts && storedState.lastRecommendedProducts.length > 0) ||
      storedState?.primaryProductQuery ||
      quotedReplyContext?.productSlug ||
      (quotedBody && (/https?:\/\/ccapl\.cc\//i.test(quotedBody) || extractExplicitProductOrModelCodes(quotedBody).length > 0))
  );
  if (
    intentInfo.intent === "CONVERSATIONAL_FOLLOWUP" &&
    !/^\s*\+?\d[\d\s()-]{8,16}\s*$/.test(rawText) &&
    !/^\s*check\s+\+?\d/i.test(rawText) &&
    !/^\s*(?:wrong\s*answer|incorrect\s*answer|that'?s\s*wrong)\b/i.test(rawText) &&
    (Boolean(quotedReplyContext) || (hasActiveProductMemory && rawText.split(/\s+/).length <= 12))
  ) {
    intentInfo = {
      ...intentInfo,
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      reason: quotedReplyContext
        ? "Customer quoted/replied directly to an earlier message"
        : "Short follow-up continuation on active product context",
    };
  }

  if (
    intentInfo.intent === "HUMAN_HANDOFF_REQUEST" &&
    params.enableInteractive !== false &&
    !String(outboundBodies[0] || "").includes(ACRIO_TEAM_ASK_TEXT) &&
    !String(lastOutboundBody || "").includes(ACRIO_TEAM_ASK_TEXT)
  ) {
    const askReply = `Sure ${firstName}, happy to connect you with our team.\n\n${ACRIO_TEAM_ASK_TEXT}`;
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: rawText,
      model: "rule-team-connect-choice",
      outcomeSource: "LIVE_AI",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: "BYPASS",
      cacheDetails: "Offered Chat with team / Request a callback buttons",
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupBudget: null,
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: askReply,
      durationMs: Date.now() - started,
    });
    const askState = reconstructAcrioConversationState({
      persistedState: params.persistedState !== undefined ? params.persistedState : await loadConversationAiState(params.conversationId),
      recentMessages: history,
      currentInboundText: rawText,
    });
    await saveConversationAiState(params.conversationId, askState);
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      customerReply: askReply,
      smartCategory: "General Enquiry",
      priority: "HIGH",
      conversationState: askState,
      interactive: buildTeamConnectInteractive(),
    };
  }

  const convState = reconstructAcrioConversationState({
    persistedState: storedState,
    recentMessages: history,
    currentInboundText: rawText,
  });

  if (visionAnalysis) {
    if (visionSha256) {
      cacheConversationImageAnalysis(
        convState,
        visionSha256,
        visionAnalysis,
        visionRecordedNewCall
      );
    } else {
      convState.lastImageAnalysis = visionAnalysis;
    }

    const visionQuery = (
      visionAnalysis.recommendedSearchQuery ||
      visionAnalysis.productType ||
      ""
    ).trim();
    const isGenericPhotoText =
      !cleanCustomerText ||
      /^\[(?:image|photo)\b/i.test(originalInboundText) ||
      /^(?:do you have|can you make|is this|how much|price|cost|send details|available|looking for this|something like this|similar)/i.test(
        cleanCustomerText
      ) ||
      extractCustomerCoreNouns(cleanCustomerText).length === 0;
    if (visionQuery && isGenericPhotoText) {
      convState.primaryProductQuery = visionQuery;
      convState.focusProductSlug = null;
      convState.lastRecommendedProducts = [];
    }
    if (visionAnalysis.businessDomain === "CLASSIC_EDGE_53") {
      convState.activeBrand = "CLASSIC_EDGE_53";
      convState.activeCategory = "Acrylic Machines (CE53)";
    } else if (visionAnalysis.businessDomain === "CLASSIC_CONCEPTS") {
      convState.activeBrand = "CLASSIC_CONCEPTS";
    }
    if (/podium|pulpit|lectern/i.test(`${visionAnalysis.productType} ${visionQuery}`)) {
      convState.productFamily = "podium";
      if (!convState.activeCategory) {
        convState.activeCategory = "Podiums & Stage";
      }
    }
    const visualPrefMatches =
      `${visionAnalysis.colorAppearance} ${visionAnalysis.materialAppearance}`.match(
        /\b(transparent|clear|frosted|black|white|acrylic|wood|wooden|led|blue)\b/gi
      ) || [];
    for (const p of visualPrefMatches) {
      const normalizedPref = p.toLowerCase();
      if (!convState.preferences.includes(normalizedPref)) {
        convState.preferences.push(normalizedPref);
      }
    }

    if (!intentInfo.needsImmediateHandoff) {
      intentInfo = {
        intent: "PRODUCT_SEARCH",
        requiresProductLookup: true,
        needsImmediateHandoff: false,
        allowRollingContextFallback: false,
        reason: "Analyzed customer reference image via ACRIO Vision",
      };
    }
    await saveConversationAiState(params.conversationId, convState);
  } else if (intentInfo.intent === "TOPIC_RESET") {
    await saveConversationAiState(params.conversationId, convState);
  }

  addStep(
    "Loaded conversation context & state",
    `historyTurns=${history.length}, alreadyGreeted=${alreadyGreeted}, activeProduct="${convState.primaryProductQuery || "none"}", maxPrice=${convState.maxPrice ?? "none"}, prefs=[${convState.preferences.join(",")}]`
  );
  addStep(
    "Classified inbound turn intent",
    `intent=${intentInfo.intent}, requiresProductLookup=${intentInfo.requiresProductLookup}, allowRollingFallback=${intentInfo.allowRollingContextFallback} (${intentInfo.reason})`
  );

  const fragmentRes = await handlePreferenceOnlyFragmentTurn({
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
  });
  if (fragmentRes) return fragmentRes;

  if (intentInfo.needsImmediateHandoff) {
    return handleImmediateHandoffTurn({
      params,
      started,
      steps,
      addStep,
      convState,
      intentInfo,
      rawText,
      firstName,
      alreadyGreeted,
    });
  }

  const fetchedCatalog = await getCachedEcosystemCatalog();
  const allItems = fetchedCatalog.allItems;
  const [liveOperationalContext, liveBrandInfo, trainingGuidance] = await Promise.all([
    loadLiveDatabaseOperationalContext({
      customerPhone: params.customerPhone,
      customerName: params.customerName,
      rawQuery: rawText,
      forStaffCopilot: false,
    }),
    getVerifiedLiveBrandAndTeamInfo().catch(() => null),
    findMatchingAiTrainingGuidance({
      queryText: rawText,
      scope: "CUSTOMER_CHAT",
      activeProductSlug: convState.focusProductSlug,
    }).catch(() => ({ rules: [], examples: [], promptBlock: "" })),
  ]);

  const shortLinkMap: Record<string, string> = {};
  for (const it of allItems) {
    const u = it.shortUrl || it.url;
    if (u) {
      shortLinkMap[`product:${it.slug}`.toLowerCase()] = u;
      shortLinkMap[`product:${it.id}`.toLowerCase()] = u;
    }
  }
  const projectPlan = buildMultiItemProjectPlan(allItems, rawText, shortLinkMap);
  const customerProfileInfo = detectAcrioCustomerProfile(rawText, recentInboundWindow);

  const lookup = await executeConciergeCatalogLookup({
    params,
    allItems,
    fetchedCacheMeta: fetchedCatalog.cacheMeta,
    convState,
    storedState,
    intentInfo,
    projectPlan,
    visionAnalysis,
    cleanCustomerText,
    rawText,
    history,
    outboundBodies,
    lastOutboundBody,
    quotedReplyContext,
    quotedBody,
    addStep,
  });

  const hidePricesActive = Boolean(convState.hidePrices);
  const mediaOutcome = await tryResolveConciergeMediaReply({
    params,
    started,
    steps,
    addStep,
    allItems,
    contextMatches: lookup.contextMatches,
    pinnedFocusItem: lookup.pinnedFocusItem,
    top: lookup.top,
    convState,
    intentInfo,
    projectPlan,
    cacheMeta: lookup.cacheMeta,
    usedLookupQuery: lookup.usedLookupQuery,
    budgetLabel: lookup.budgetLabel,
    rawText,
    recentInboundWindow,
    firstName,
    alreadyGreeted,
    outboundBodies,
    lastOutboundBody,
    smartCategory: lookup.smartCategory,
    priority: lookup.priority,
    hidePricesActive,
    hasBurstReferenceMedia,
  });
  if (mediaOutcome.earlyReturn) {
    return mediaOutcome.earlyReturn;
  }

  const prebuiltGroupedBlock =
    intentInfo.requiresProductLookup && !projectPlan.isMultiItemOrTotalling
      ? buildGroupedProductShortLinksSection({
          allItems,
          matchedItems: lookup.contextMatches,
          smartCategory: lookup.smartCategory,
          excludeConsumables: convState.excludedItemTypes.includes("CONSUMABLE"),
          hasStrictBudget: convState.maxPrice !== null || convState.minPrice !== null,
          hidePrices: hidePricesActive,
          maxItems: 3,
        })
      : "";

  const deepProductInfo =
    intentInfo.requiresProductLookup && !projectPlan.isMultiItemOrTotalling && !lookup.aggregateResult
      ? buildEcosystemDeepProductContextAndAnswer({
          rawQuery: rawText,
          matchedItems: lookup.contextMatches,
          formatItemLink: (it) => it.shortUrl || it.url,
        })
      : null;

  const podiumSubCategoriesText =
    intentInfo.intent === "CATEGORY_OVERVIEW"
      ? [
          `Here are the *4 sub-categories* under our *Acrylic Podiums & Pulpits* range:`,
          `1. *Essential Podiums*${hidePricesActive ? "" : " (₹7,150 to ₹23,650)"}: Compact, lightweight single and double pillar podiums ideal for classrooms, offices, and daily seminars (such as *CCP057S*, *CCP054*, *CCP057*, *CCP060*).`,
          `2. *Classic Signature Podiums*${hidePricesActive ? "" : " (₹19,250 to ₹28,600)"}: Wide-stage auditoria and church pulpits with generous reading tops and front logo panels (such as *CCP065*, *CCP055*, *CCP061*, *CCP064*).`,
          `3. *Premium Podiums*${hidePricesActive ? "" : " (₹28,600 to ₹55,000)"}: Heavy-duty executive, motorized/height-adjustable, LED-lit, and acrylic-plus-wood flagship lecterns (such as *CCP074*, *CCP084*, *CCP094*, *CCP111*).`,
          `4. *Custom-Built Podiums*: Made-to-order stage lecterns crafted to your exact dimensions, tint, LED backlighting, and institution crest.`,
          `\nReply with *1*, *2*, *3*, or *4* (or tell me your venue type) to see the top models in that category!`,
        ].join("\n")
      : "";

  let needsSalesTeamPing = Boolean(projectPlan.needsSalesTeamPing);
  let salesTeamPingNote = projectPlan.needsSalesTeamPing
    ? `ACRIO Consultative Ping: Customer requested multi-item/bulk project pricing ("${rawText.slice(0, 140)}"). ACRIO shared itemized math and remains active on the chat; a single Sales Team reply with bulk discount can resolve this.`
    : "";
  if (
    !needsSalesTeamPing &&
    /\b(bulk\s*discount|discount|negotiate|best\s*rate|final\s*price|custom\s*quote|renovation|proforma|gst\s*quote|\d{2,}\s*(?:pcs|pieces|units|chairs|podiums|signages))\b/i.test(
      rawText
    )
  ) {
    needsSalesTeamPing = true;
    salesTeamPingNote = `ACRIO Consultative Ping: Customer asked about bulk/custom pricing or discount ("${rawText.slice(0, 140)}"). ACRIO stays assigned; drop a single reply if special pricing applies.`;
  }

  const aiTurn = await runConciergeClaudeTurn({
    params,
    started,
    steps,
    addStep,
    allItems,
    contextMatches: lookup.contextMatches,
    pinnedFocusItem: lookup.pinnedFocusItem,
    aggregateResult: lookup.aggregateResult,
    deepProductInfo,
    projectPlan,
    trainingGuidance,
    liveOperationalContext,
    liveBrandInfo,
    customerProfileInfo,
    convState,
    intentInfo,
    cacheMeta: lookup.cacheMeta,
    usedLookupQuery: lookup.usedLookupQuery,
    budgetLabel: lookup.budgetLabel,
    budgetFallbackLowestPrice: lookup.budgetFallbackLowestPrice,
    budgetFallbackLowestItem: lookup.budgetFallbackLowestItem,
    prebuiltGroupedBlock,
    podiumSubCategoriesText,
    smartCategory: lookup.smartCategory,
    priority: lookup.priority,
    hidePricesActive,
    isCustomStructureEnquiry: mediaOutcome.isCustomStructureEnquiry,
    combinedEnquiryProbe: mediaOutcome.combinedEnquiryProbe,
    asksForImages: mediaOutcome.asksForImages,
    resolvedMedia: mediaOutcome.resolvedMedia,
    visionAnalysis,
    visionUsage,
    visionFromCache,
    hasBurstReferenceMedia,
    burstMediaLabel,
    needsSalesTeamPing,
    salesTeamPingNote,
    rawText,
    firstName,
    alreadyGreeted,
    history,
    quotedReplyContext,
    quotedBody,
  });

  if (aiTurn.ok) {
    return aiTurn.result;
  }

  return buildConciergeFallbackReply({
    params,
    started,
    steps,
    addStep,
    allItems,
    contextMatches: lookup.contextMatches,
    pinnedFocusItem: lookup.pinnedFocusItem,
    top: lookup.top,
    aggregateResult: lookup.aggregateResult,
    deepProductInfo,
    projectPlan,
    liveBrandInfo,
    convState,
    intentInfo,
    cacheMeta: lookup.cacheMeta,
    usedLookupQuery: lookup.usedLookupQuery,
    budgetLabel: lookup.budgetLabel,
    budgetFallbackLowestPrice: lookup.budgetFallbackLowestPrice,
    budgetFallbackLowestItem: lookup.budgetFallbackLowestItem,
    prebuiltGroupedBlock,
    podiumSubCategoriesText,
    smartCategory: lookup.smartCategory,
    priority: lookup.priority,
    hidePricesActive,
    isCustomStructureEnquiry: mediaOutcome.isCustomStructureEnquiry,
    visionAnalysis,
    visionUsage,
    hasBurstReferenceMedia,
    burstMediaLabel,
    burstImages,
    needsSalesTeamPing,
    salesTeamPingNote,
    lastAiError: aiTurn.lastAiError,
    lastUsage: aiTurn.lastUsage,
    rawText,
    contextLower,
    firstName,
    alreadyGreeted,
    history,
  });
}
