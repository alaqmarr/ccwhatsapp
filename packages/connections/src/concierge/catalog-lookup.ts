import {
  cleanDisplayProductName,
  countCoreNounMatches,
  extractCompactDimensionPairsFromText,
  extractCustomerCoreNouns,
  extractExplicitProductOrModelCodes,
  getEcosystemBudgetFallbackInfo,
  rankItemsByCustomerCoreNouns,
  searchEcosystemItems,
  type AiTraceStep,
  type MainWebsiteProduct,
} from "@cc/database";
import type { MultiItemProjectPlan } from "./types";
import type { CustomerImageAnalysis } from "@cc/connections/image-intelligence";
import {
  ACRIO_DOMAIN_PRODUCT_NOUN_RE,
  ACRIO_ORDINALS,
  type AcrioConversationState,
  type AcrioIntentClassification,
  buildCatalogAggregateAnswer,
  buildNormalizedSearchFromState,
  type CatalogCacheMeta,
  extractNormalizedColourTokens,
  findCatalogProductsByVariantTokens,
  isFocusedProductFollowUp,
  isListPickText,
  isMultiProductReference,
  isProductImageRequest,
  resolveListPickFromLastReply,
  resolveProductsFromOutboundText,
  saveConversationAiState,
} from "@cc/connections/helpers.acrio.ai";
import type {
  AcrioReplyToMessageContext,
  AcrioTurnParams,
} from "@cc/connections/interactive.acrio.ai";

export interface ConciergeCatalogLookupResult {
  cacheMeta: CatalogCacheMeta;
  budgetLabel: string | null;
  usedLookupQuery: string;
  contextMatches: MainWebsiteProduct[];
  pinnedFocusItem: MainWebsiteProduct | null;
  aggregateResult: { answer: string; items: MainWebsiteProduct[] } | null;
  top: MainWebsiteProduct | undefined;
  budgetFallbackLowestPrice: number | null;
  budgetFallbackLowestItem: MainWebsiteProduct | null;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL";
}

export async function executeConciergeCatalogLookup(ctx: {
  params: AcrioTurnParams;
  allItems: MainWebsiteProduct[];
  fetchedCacheMeta: CatalogCacheMeta;
  convState: AcrioConversationState;
  storedState: AcrioConversationState | null;
  intentInfo: AcrioIntentClassification;
  projectPlan: MultiItemProjectPlan;
  visionAnalysis: CustomerImageAnalysis | null;
  cleanCustomerText: string;
  rawText: string;
  history: { direction: string; body: string }[];
  outboundBodies: string[];
  lastOutboundBody: string;
  quotedReplyContext: AcrioReplyToMessageContext | null;
  quotedBody: string;
  addStep: (label: string, detail?: string, status?: AiTraceStep["status"]) => void;
}): Promise<ConciergeCatalogLookupResult> {
  const {
    params,
    allItems,
    fetchedCacheMeta,
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
  } = ctx;

  const lower = rawText.toLowerCase();

  let cacheMeta: CatalogCacheMeta = {
    ccCacheTier: "BYPASS",
    ce53CacheTier: "BYPASS",
    catalogCacheStatus: "BYPASS",
    cacheSummary: `Skipped catalog lookup for non-product intent=${intentInfo.intent}`,
  };
  let budgetLabel: string | null = null;
  let usedLookupQuery = "";
  let contextMatches: MainWebsiteProduct[] = [];
  let pinnedFocusItem: MainWebsiteProduct | null = null;
  let aggregateResult: { answer: string; items: MainWebsiteProduct[] } | null = null;
  let top: MainWebsiteProduct | undefined;
  let budgetFallbackLowestPrice: number | null = null;
  let budgetFallbackLowestItem: MainWebsiteProduct | null = null;

  if (intentInfo.intent === "MENU_SELECTION") {
    const lastOutbound = [...history].reverse().find((m) => m.direction === "OUTBOUND")?.body || "";
    const numMatch = rawText.trim().match(/^[\s*#]*(?:option\s*|category\s*|number\s*|no\.?\s*)?([1-5])[\s.)*]*$/i);
    const chosenNum = numMatch ? parseInt(numMatch[1], 10) : 1;
    const lineRegex = new RegExp(`(?:^|\\n)\\s*${chosenNum}[.)]\\s*\\*?([^\\n(*:]+)\\*?`, "i");
    const mLine = lastOutbound.match(lineRegex);
    if (mLine && mLine[1]) {
      const extractedOptionTitle = mLine[1].trim();
      convState.primaryProductQuery = extractedOptionTitle;
      if (/essential|signature|premium|custom[-\s]*built|podium/i.test(extractedOptionTitle)) {
        convState.productFamily = "podium";
        convState.activeCategory = "Podiums & Stage";
        convState.activeBrand = "CLASSIC_CONCEPTS";
      }
    }
  }

  if (intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling) {
    cacheMeta = fetchedCacheMeta;
    addStep("Checked ecosystem catalog cache", cacheMeta.cacheSummary);

    const normalizedSearch = buildNormalizedSearchFromState(convState, rawText);
    usedLookupQuery = normalizedSearch.searchQuery;
    if (visionAnalysis) {
      const visionLookupTokens = [
        cleanCustomerText && !/^\[(?:image|photo)\b/i.test(cleanCustomerText)
          ? cleanCustomerText
          : "",
        visionAnalysis.recommendedSearchQuery,
        visionAnalysis.productType,
        ...visionAnalysis.readableModelCodes,
        ...visionAnalysis.visibleComponents.slice(0, 3),
      ]
        .map((s) => String(s || "").trim())
        .filter(Boolean);
      if (visionLookupTokens.length > 0) {
        usedLookupQuery = Array.from(new Set(visionLookupTokens)).join(" ");
      }
    }
    budgetLabel = normalizedSearch.budgetLabel;

    const prevMaxPrice = storedState?.maxPrice ?? null;
    const explicitCodesInTurn = extractExplicitProductOrModelCodes(rawText);
    const dimsInTurn = extractCompactDimensionPairsFromText(rawText);
    const hasExplicitCodeOrDimInTurn =
      explicitCodesInTurn.length > 0 ||
      dimsInTurn.pairs.length > 0 ||
      dimsInTurn.ranges.length > 0;
    const budgetChangedInTurn = prevMaxPrice !== convState.maxPrice;

    const findItemBySlug = (slug?: string | null) =>
      slug ? allItems.find((it) => (it.slug || "").toLowerCase() === slug.toLowerCase()) : undefined;

    let quotedFocusItem: MainWebsiteProduct | undefined;
    let quotedMultipleItems: MainWebsiteProduct[] = [];
    if (quotedReplyContext) {
      if (quotedReplyContext.productSlug) {
        quotedFocusItem = findItemBySlug(quotedReplyContext.productSlug);
      }
      if (!quotedFocusItem && quotedBody) {
        const fromLinks = resolveProductsFromOutboundText(quotedBody, allItems);
        if (fromLinks.length === 1) {
          quotedFocusItem = fromLinks[0];
        } else if (fromLinks.length >= 2) {
          quotedMultipleItems = fromLinks;
        } else {
          const qCodes = extractExplicitProductOrModelCodes(quotedBody);
          if (qCodes.length === 1) {
            quotedFocusItem = allItems.find((it) =>
              `${it.sku || ""} ${it.slug}`
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "")
                .includes(qCodes[0].toLowerCase().replace(/[^a-z0-9]/g, ""))
            );
          }
        }
      }
    }

    let focusItem = visionAnalysis
      ? quotedFocusItem
      : quotedFocusItem || findItemBySlug(convState.focusProductSlug);
    if (
      !visionAnalysis &&
      !focusItem &&
      !convState.switchedThisTurn &&
      !hasExplicitCodeOrDimInTurn &&
      !isMultiProductReference(rawText) &&
      !ACRIO_DOMAIN_PRODUCT_NOUN_RE.test(lower)
    ) {
      const priorInbound = history.filter((m) => m.direction === "INBOUND").map((m) => m.body);
      for (let i = priorInbound.length - 1; i >= 0 && !focusItem; i--) {
        const codes = extractExplicitProductOrModelCodes(priorInbound[i]);
        if (codes.length === 1) {
          focusItem = allItems.find((it) =>
            `${it.sku || ""} ${it.slug}`.toLowerCase().replace(/[^a-z0-9]/g, "").includes(codes[0].toLowerCase().replace(/[^a-z0-9]/g, ""))
          );
        }
      }
      if (
        !focusItem &&
        convState.lastRecommendedProducts.length === 1 &&
        (isProductImageRequest(rawText) || rawText.split(/\s+/).length <= 8)
      ) {
        focusItem = findItemBySlug(convState.lastRecommendedProducts[0].slug);
      }
    }

    aggregateResult = buildCatalogAggregateAnswer(allItems, rawText);
    const listPickItem =
      (quotedBody ? resolveListPickFromLastReply(rawText, quotedBody, allItems) : null) ||
      resolveListPickFromLastReply(rawText, lastOutboundBody, allItems) ||
      (isListPickText(rawText) && (storedState?.lastListedSlugs || []).length > 0 && /View options/i.test(outboundBodies[0] || "")
        ? (() => {
            const slugs = storedState!.lastListedSlugs!;
            const t = rawText.toLowerCase();
            const word = t.match(/\b(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\b/)?.[1];
            const num = t.match(/(?:option|number|no\.?|#)\s*([1-9])\b/)?.[1] || t.match(/^\s*([1-9])[\s.)!]*$/)?.[1];
            let idx = -2;
            if (word) idx = ACRIO_ORDINALS[word];
            else if (num) idx = parseInt(num, 10) - 1;
            const slug = idx === -1 ? slugs[slugs.length - 1] : idx >= 0 ? slugs[idx] : undefined;
            return slug ? findItemBySlug(slug) || null : null;
          })()
        : null);
    const forcedItem = findItemBySlug(params.forcedFocusSlug);
    if (forcedItem) {
      pinnedFocusItem = forcedItem;
      contextMatches = [forcedItem];
      addStep("Opened product from list", `Customer tapped "${forcedItem.name}" in View options`);
    } else if (aggregateResult && !projectPlan.isMultiItemOrTotalling) {
      contextMatches = aggregateResult.items;
    } else if (listPickItem && !projectPlan.isMultiItemOrTotalling) {
      pinnedFocusItem = listPickItem;
      contextMatches = [listPickItem];
      addStep("Resolved list pick", `Customer picked "${listPickItem.name}" from the list we just sent`);
    } else if (
      focusItem &&
      !projectPlan.isMultiItemOrTotalling &&
      !normalizedSearch.preferCheapest &&
      !normalizedSearch.asksMoreOrAlternative &&
      isFocusedProductFollowUp(rawText, focusItem, Boolean(quotedFocusItem))
    ) {
      pinnedFocusItem = focusItem;
      contextMatches = [focusItem];
      addStep(
        "Pinned focus product",
        quotedFocusItem
          ? `Customer quoted/replied directly to "${focusItem.name}"`
          : `Follow-up refers to "${focusItem.name}" (kept from earlier in the chat)`
      );
    } else if (quotedMultipleItems.length >= 2 && !hasExplicitCodeOrDimInTurn) {
      contextMatches = quotedMultipleItems;
      addStep("Resolved products from quoted message", `matched=${quotedMultipleItems.length} products from quoted reply`);
    } else if (projectPlan.isMultiItemOrTotalling && projectPlan.matchedProducts.length > 0) {
      contextMatches = projectPlan.matchedProducts;
    } else if (intentInfo.intent === "MENU_SELECTION" && /essential\s*podium/i.test(convState.primaryProductQuery || "")) {
      contextMatches = allItems
        .filter(
          (it) =>
            it.brand === "CLASSIC_CONCEPTS" &&
            ((it.podiumSubCategoryNames || []).some((s) => /essential/i.test(s)) ||
              /\b(ccp057s|ccp054|ccp057|ccp058|ccp060)\b/i.test(it.sku || it.name))
        )
        .sort((a, b) => (a.basePrice || 999999) - (b.basePrice || 999999))
        .slice(0, 6);
    } else if (intentInfo.intent === "MENU_SELECTION" && /signature\s*podium/i.test(convState.primaryProductQuery || "")) {
      contextMatches = allItems
        .filter(
          (it) =>
            it.brand === "CLASSIC_CONCEPTS" &&
            (it.podiumSubCategoryNames || []).some((s) => /signature/i.test(s))
        )
        .sort((a, b) => (a.basePrice || 999999) - (b.basePrice || 999999))
        .slice(0, 6);
    } else if (intentInfo.intent === "MENU_SELECTION" && /premium\s*podium/i.test(convState.primaryProductQuery || "")) {
      contextMatches = allItems
        .filter(
          (it) =>
            it.brand === "CLASSIC_CONCEPTS" &&
            (it.podiumSubCategoryNames || []).some((s) => /premium/i.test(s))
        )
        .sort((a, b) => (b.basePrice || 0) - (a.basePrice || 0))
        .slice(0, 6);
    } else if (
      !hasExplicitCodeOrDimInTurn &&
      !budgetChangedInTurn &&
      convState.lastRecommendedProducts.length > 0 &&
      (intentInfo.intent === "PRODUCT_COMPARISON" ||
        intentInfo.intent === "FOLLOW_UP_REFINEMENT") &&
      (isMultiProductReference(rawText) ||
        /\b(first\s*two|top\s*two|both|these|those|them|which\s+one|which\s+of\s+these|wider|widest|larger|largest|bigger|biggest|taller|tallest|reading\s*top|top\s*sheet|dimension|dimensions|spec|specs|specification|specifications|variant|variants|color|colors|colour|colours|feature|features|pillar|pillars|warranty)\b/i.test(
          rawText
        )) &&
      !(
        extractNormalizedColourTokens(rawText).length > 0 &&
        /\b(podiums|pulpits|lecterns|chairs|tables|stands|trophies|awards|boxes|models|options|products|have|with)\b/i.test(
          rawText
        )
      ) &&
      !/\b(any\s*more|more\s*options|other\s*options|cheaper\s*alternative|smaller\s*top|save\s*more)\b/i.test(rawText)
    ) {
      const outboundListed = resolveProductsFromOutboundText(
        outboundBodies[0] || lastOutboundBody,
        allItems
      );
      if (isMultiProductReference(rawText) && outboundListed.length >= 2) {
        const sliceCount = /\b(first\s*two|top\s*two|both|these\s*two|those\s*two)\b/i.test(
          rawText
        )
          ? 2
          : /\b(all\s*three|these\s*three|those\s*three|three)\b/i.test(rawText)
          ? 3
          : outboundListed.length;
        contextMatches = outboundListed.slice(0, sliceCount);
      } else {
        const sliceCount = /\b(first\s*two|top\s*two|both|these\s*two|those\s*two)\b/i.test(
          rawText
        )
          ? 2
          : convState.lastRecommendedProducts.length;
        const targetSlugs = new Set(
          convState.lastRecommendedProducts
            .slice(0, sliceCount)
            .map((p) => p.slug || p.id)
        );
        contextMatches = allItems.filter((it) =>
          targetSlugs.has(it.slug || it.id)
        );
      }
    }

    if (
      !pinnedFocusItem &&
      !hasExplicitCodeOrDimInTurn &&
      extractNormalizedColourTokens(rawText).length > 0
    ) {
      const variantCatalogHits = findCatalogProductsByVariantTokens(
        allItems,
        rawText,
        convState.productFamily,
        convState.primaryProductQuery
      );
      if (variantCatalogHits.length > 0) {
        contextMatches = variantCatalogHits.map((h) => h.item).slice(0, 8);
        addStep(
          "Filtered catalog by variant colour tokens",
          `tokens=[${extractNormalizedColourTokens(rawText).join(",")}], matched=${variantCatalogHits.length} (${contextMatches.slice(0, 4).map((m) => m.sku || m.slug).join(", ")})`
        );
      }
    }

    if (contextMatches.length === 0) {
      const budgetRaised =
        prevMaxPrice !== null &&
        convState.maxPrice !== null &&
        convState.maxPrice > prevMaxPrice;
      const rawMatches = searchEcosystemItems(
        allItems,
        usedLookupQuery,
        budgetRaised ? 16 : 12,
        normalizedSearch.searchOptions
      );
      if (budgetRaised) {
        const newlyUnlocked = rawMatches.filter(
          (it) => typeof it.basePrice === "number" && it.basePrice > prevMaxPrice
        );
        const existingTier = rawMatches.filter(
          (it) => !(typeof it.basePrice === "number" && it.basePrice > prevMaxPrice)
        );
        contextMatches = [...newlyUnlocked, ...existingTier].slice(0, 12);
      } else {
        contextMatches = rawMatches;
      }
    }

    if (usedLookupQuery !== rawText) {
      const directFallback = searchEcosystemItems(
        allItems,
        rawText,
        12,
        normalizedSearch.searchOptions
      );
      if (contextMatches.length === 0 && directFallback.length > 0) {
        contextMatches = directFallback;
        usedLookupQuery = rawText;
      } else if (hasExplicitCodeOrDimInTurn && directFallback.length > 0) {
        const seen = new Set<string>();
        contextMatches = [...directFallback, ...contextMatches]
          .filter((it) => {
            const k = `${it.brand}:${it.slug || it.id}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .slice(0, 12);
      }
    }

    if (!pinnedFocusItem && !hasExplicitCodeOrDimInTurn && contextMatches.length > 0 && !aggregateResult) {
      const coreNounProbe = `${convState.primaryProductQuery || ""} ${visionAnalysis?.productType || ""} ${rawText}`.trim();
      const coreRank = rankItemsByCustomerCoreNouns(contextMatches, coreNounProbe);
      if (coreRank.coreNouns.length > 0) {
        if (coreRank.anyMatch) {
          contextMatches = coreRank.ranked.filter(
            (it) => countCoreNounMatches(it, coreRank.coreNouns) > 0
          );
        } else {
          contextMatches = [];
        }
      }
    }

    const desiredBrand =
      visionAnalysis &&
      (visionAnalysis.businessDomain === "CLASSIC_CONCEPTS" ||
        visionAnalysis.businessDomain === "CLASSIC_EDGE_53")
        ? visionAnalysis.businessDomain
        : !convState.switchedThisTurn &&
          (convState.activeBrand === "CLASSIC_CONCEPTS" ||
            convState.activeBrand === "CLASSIC_EDGE_53")
        ? convState.activeBrand
        : null;
    if (desiredBrand && contextMatches.length > 0) {
      const brandOnly = contextMatches.filter((it) => it.brand === desiredBrand);
      if (brandOnly.length > 0) {
        contextMatches = brandOnly;
      }
    }

    if (normalizedSearch.preferCheapest && contextMatches.length > 1) {
      contextMatches = [...contextMatches].sort((a, b) => {
        const pa = typeof a.basePrice === "number" && a.basePrice > 0 ? a.basePrice : Number.MAX_SAFE_INTEGER;
        const pb = typeof b.basePrice === "number" && b.basePrice > 0 ? b.basePrice : Number.MAX_SAFE_INTEGER;
        return pa - pb;
      });
    }

    if (
      contextMatches.length === 0 &&
      (convState.maxPrice !== null || convState.minPrice !== null)
    ) {
      const fbInfo = getEcosystemBudgetFallbackInfo(
        allItems,
        usedLookupQuery,
        normalizedSearch.searchOptions
      );
      budgetFallbackLowestPrice = fbInfo.lowestAvailablePrice;
      budgetFallbackLowestItem = fbInfo.lowestAvailableItem;
    }

    top = contextMatches[0];

    if (pinnedFocusItem) {
      convState.focusProductSlug = pinnedFocusItem.slug;
    } else if (explicitCodesInTurn.length === 1 && contextMatches.length > 0) {
      const codeKey = explicitCodesInTurn[0].toLowerCase().replace(/[^a-z0-9]/g, "");
      const exact = contextMatches.find((it) =>
        `${it.sku || ""} ${it.slug}`.toLowerCase().replace(/[^a-z0-9]/g, "").includes(codeKey)
      );
      convState.focusProductSlug = (exact || contextMatches[0]).slug;
      top = exact || top;
    } else if (contextMatches.length === 1) {
      convState.focusProductSlug = contextMatches[0].slug;
    } else if (explicitCodesInTurn.length >= 2 || (contextMatches.length > 1 && !aggregateResult)) {
      convState.focusProductSlug = null;
    }

    if (params.uiSink) {
      const focusForUi = convState.focusProductSlug
        ? allItems.find((it) => (it.slug || "").toLowerCase() === String(convState.focusProductSlug).toLowerCase()) || null
        : null;
      Object.assign(params.uiSink, {
        intent: intentInfo.intent,
        matches: contextMatches,
        focus: focusForUi,
        aggregate: Boolean(aggregateResult),
        multiItem: Boolean(projectPlan.isMultiItemOrTotalling),
        explicitCodes: explicitCodesInTurn.length,
        budgetLabel,
        languageMode: convState.languageMode,
      });
    }

    if (contextMatches.length > 0) {
      convState.lastRecommendedProducts = contextMatches.slice(0, 5).map((it) => ({
        id: it.id,
        name: cleanDisplayProductName(it.name),
        slug: it.slug,
        priceInr: it.basePrice,
        shortUrl: it.shortUrl || it.url,
        itemType: it.itemType,
      }));
      const mergedShown = new Set([
        ...(convState.shownProductSlugs || []),
        ...contextMatches.slice(0, 3).map((it) => (it.slug || "").toLowerCase()).filter(Boolean),
      ]);
      convState.shownProductSlugs = Array.from(mergedShown).slice(-18);
    }
    await saveConversationAiState(params.conversationId, convState);

    addStep(
      "Executed catalog product lookup",
      `query="${usedLookupQuery.slice(0, 90)}"${budgetLabel ? `, budget="${budgetLabel}"` : ""}${convState.excludedItemTypes.length ? `, excluded=[${convState.excludedItemTypes.join(",")}]` : ""}, matched=${contextMatches.length} of ${allItems.length} items`
    );
  } else {
    await saveConversationAiState(params.conversationId, convState);
    addStep(
      "Skipped catalog product lookup",
      `Non-product turn (${intentInfo.intent})`
    );
  }

  let smartCategory = convState.activeCategory || "General Enquiry";
  let priority: "URGENT" | "HIGH" | "NORMAL" = "NORMAL";

  if (intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling) {
    const classificationProbe = `${convState.primaryProductQuery || ""} ${rawText}`.toLowerCase();
    if (
      convState.activeCategory === "Acrylic Machines (CE53)" ||
      /machine|laser|router|polish|diamond|bending|bender|heater|yn-|ce53|classic edge|consumable|blade|cutter|flame|buffing|cloudy\s*edge|rough\s*edge/i.test(
        classificationProbe
      )
    ) {
      smartCategory = "Acrylic Machines (CE53)";
      priority = "HIGH";
    } else if (
      convState.activeCategory === "Podiums & Stage" ||
      /podium|podiums|lectern|lecterns|pulpit|pulpits|rostrum|stage|auditorium|conference/i.test(
        classificationProbe
      )
    ) {
      smartCategory = "Podiums & Stage";
      priority = /friday|urgent|tomorrow|today/i.test(lower) ? "URGENT" : "HIGH";
    } else if (
      convState.activeCategory === "Awards & Trophies" ||
      /trophy|trophies|memento|award|student|convocation|plaque|gift|corporate\s*clients?/i.test(classificationProbe)
    ) {
      smartCategory = "Awards & Trophies";
    } else if (
      convState.activeCategory === "Hotel & Banquet" ||
      /hotel|banquet|menu|qr|resort|hospitality|tent\s*card|table\s*stand|sign\s*holder/i.test(
        classificationProbe
      )
    ) {
      smartCategory = "Hotel & Banquet";
      priority = "HIGH";
    } else if (
      convState.activeCategory === "Custom Fabrication" ||
      /cover|guard|enclosure|box|case|display\s*stand|riser|custom|mm|inch|furniture|interior|chair|stool|table|signage|name\s*plate/i.test(
        classificationProbe
      )
    ) {
      smartCategory = "Custom Fabrication";
      priority = "HIGH";
    } else if (/order|dispatch|delivery|tracking|courier|invoice|advance|payment/i.test(classificationProbe)) {
      smartCategory = "Order & Delivery";
    }
  }

  return {
    cacheMeta,
    budgetLabel,
    usedLookupQuery,
    contextMatches,
    pinnedFocusItem,
    aggregateResult,
    top,
    budgetFallbackLowestPrice,
    budgetFallbackLowestItem,
    smartCategory,
    priority,
  };
}
