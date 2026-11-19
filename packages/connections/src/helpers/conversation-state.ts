import {
  ensureDatabasesBootstrapped,
  extractBudgetConstraintsFromQuery,
  extractCompactDimensionPairsFromText,
  extractCustomerCoreNouns,
  extractExplicitProductOrModelCodes,
  getRawLibSqlClient,
  type EcosystemSearchOptions,
} from "@cc/database";
import {
  ACRIO_DOMAIN_PRODUCT_NOUN_RE,
  classifyAcrioInboundIntent,
  detectAcrioCustomerProfile,
  normalizeCustomerProductTypos,
  stripBurstMediaPlaceholders,
} from "./intent-classifier";
import {
  detectProductFamilyAndQuery,
  extractMetadataFromTurn,
  extractPreferencesFromTurn,
} from "./state-detectors";
import type { AcrioConversationState, AcrioIntentClassification } from "./types";

export function createEmptyAcrioConversationState(): AcrioConversationState {
  return {
    activeBrand: null,
    activeCategory: null,
    productFamily: null,
    primaryProductQuery: null,
    itemTypeFilter: null,
    excludedItemTypes: [],
    minPrice: null,
    maxPrice: null,
    hidePrices: false,
    preferCheapest: false,
    preferences: [],
    applicationContext: null,
    dimensionsOrThickness: null,
    quantity: null,
    shownProductSlugs: [],
    lastMenuOptions: [],
    askedQuestionsLog: [],
    customerProfile: "EVERYDAY_BUYER",
    languageMode: "ENGLISH",
    lastRecommendedProducts: [],
    productHistory: [],
    lastImageAnalysis: null,
    analyzedImagesBySha: {},
    imageAnalysisCountWindow: undefined,
    switchedThisTurn: false,
    turnCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function applyTurnToAcrioConversationState(
  prevState: AcrioConversationState | null | undefined,
  rawText: string,
  intentInfo: AcrioIntentClassification
): AcrioConversationState {
  const base = prevState
    ? {
        ...createEmptyAcrioConversationState(),
        ...prevState,
        excludedItemTypes: [...(prevState.excludedItemTypes || [])],
        preferences: [...(prevState.preferences || [])],
        shownProductSlugs: [...(prevState.shownProductSlugs || [])],
        lastMenuOptions: [...(prevState.lastMenuOptions || [])],
        askedQuestionsLog: [...(prevState.askedQuestionsLog || [])],
        lastRecommendedProducts: [...(prevState.lastRecommendedProducts || [])],
        productHistory: [...(prevState.productHistory || [])],
        lastImageAnalysis: prevState.lastImageAnalysis || null,
        analyzedImagesBySha: prevState.analyzedImagesBySha
          ? { ...prevState.analyzedImagesBySha }
          : {},
        imageAnalysisCountWindow: prevState.imageAnalysisCountWindow
          ? { ...prevState.imageAnalysisCountWindow }
          : undefined,
      }
    : createEmptyAcrioConversationState();

  base.turnCount = (base.turnCount || 0) + 1;
  base.updatedAt = new Date().toISOString();
  base.switchedThisTurn = false;

  const cleanedTurnText = normalizeCustomerProductTypos(
    stripBurstMediaPlaceholders(rawText).cleanText || String(rawText || "")
  ).trim();
  const effectiveRawText = cleanedTurnText || String(rawText || "").trim();
  const lower = effectiveRawText.toLowerCase();
  const profileInfo = detectAcrioCustomerProfile(effectiveRawText);
  base.customerProfile = profileInfo.customerProfile;
  base.languageMode = profileInfo.languageMode;

  const archivePreviousFocus = () => {
    const label =
      (base.focusProductSlug ? base.focusProductSlug.replace(/-/g, " ") : "") ||
      base.lastRecommendedProducts[0]?.name ||
      base.primaryProductQuery ||
      "";
    if (!label) return;
    const prevHist = base.productHistory || [];
    const lastEntry = prevHist[prevHist.length - 1];
    if (
      !lastEntry ||
      lastEntry.slug !== (base.focusProductSlug || base.lastRecommendedProducts[0]?.slug || null) ||
      lastEntry.label.toLowerCase() !== label.toLowerCase()
    ) {
      prevHist.push({
        label: label.slice(0, 80),
        slug: base.focusProductSlug || base.lastRecommendedProducts[0]?.slug || null,
        family: base.productFamily || null,
        turnNumber: Math.max(1, base.turnCount - 1),
      });
      base.productHistory = prevHist.slice(-10);
    }
  };

  if (/\b(without\s*(?:mentioning\s*)?prices?|no\s*prices?|hide\s*prices?|don'?t\s*(?:mention|show)\s*prices?)\b/i.test(lower)) {
    base.hidePrices = true;
  } else if (intentInfo.intent !== "MENU_SELECTION" && intentInfo.intent !== "CATEGORY_OVERVIEW") {
    base.hidePrices = false;
  }

  if (/\b(cheapest|lowest\s*price|least\s*expensive|cheaper(?:\s+(?:one|ones|model|models|alternative|alternatives|option|options))?|smaller\s*top\s*to\s*save|save\s*more|lower\s*cost|lower\s*price|sasta|sabse\s*sasta)\b/i.test(lower)) {
    base.preferCheapest = true;
    base.preferences = base.preferences.filter((p) => p !== "premium");
    base.minPrice = null;
  } else if (/\b(costliest|most\s*expensive|most\s*premium|premium|flagship|luxury)\b/i.test(lower)) {
    base.preferCheapest = false;
  } else if (!/\b(any\s*more|more\s*options|other\s*options)\b/i.test(lower)) {
    base.preferCheapest = false;
  }

  if (intentInfo.intent === "TOPIC_RESET") {
    archivePreviousFocus();
    return {
      ...createEmptyAcrioConversationState(),
      productHistory: [...(base.productHistory || [])],
      analyzedImagesBySha: { ...(base.analyzedImagesBySha || {}) },
      imageAnalysisCountWindow: base.imageAnalysisCountWindow
        ? { ...base.imageAnalysisCountWindow }
        : undefined,
      switchedThisTurn: true,
      turnCount: base.turnCount,
      updatedAt: base.updatedAt,
    };
  }

  if (intentInfo.intent === "CATEGORY_OVERVIEW") {
    archivePreviousFocus();
    base.activeBrand = "CLASSIC_CONCEPTS";
    base.activeCategory = "Podiums & Stage";
    base.productFamily = "podium";
    base.primaryProductQuery = "acrylic podium categories";
    base.focusProductSlug = null;
    base.lastMenuOptions = [
      "Essential Podiums",
      "Classic Signature Podiums",
      "Premium Podiums",
      "Custom-Built Podiums",
    ];
    return base;
  }

  if (intentInfo.intent === "MENU_SELECTION") {
    const numMatch = rawText.trim().match(/^[\s*#]*(?:option\s*|category\s*|number\s*|no\.?\s*)?([1-5])[\s.)*]*$/i);
    const wordMatch = rawText.trim().match(/^(?:the\s+)?(first|second|third|fourth|1st|2nd|3rd|4th)\b/i);
    let idx = 0;
    if (numMatch) {
      idx = parseInt(numMatch[1], 10) - 1;
    } else if (wordMatch) {
      const w = wordMatch[1].toLowerCase();
      idx = w === "second" || w === "2nd" ? 1 : w === "third" || w === "3rd" ? 2 : w === "fourth" || w === "4th" ? 3 : 0;
    }
    if (base.lastMenuOptions && base.lastMenuOptions[idx]) {
      const chosenOption = base.lastMenuOptions[idx];
      base.primaryProductQuery = `${chosenOption} acrylic podium`;
      base.productFamily = "podium";
      base.activeCategory = "Podiums & Stage";
      base.activeBrand = "CLASSIC_CONCEPTS";
      return base;
    } else if (base.lastRecommendedProducts && base.lastRecommendedProducts[idx]) {
      const chosenProd = base.lastRecommendedProducts[idx];
      base.primaryProductQuery = chosenProd.name;
      base.focusProductSlug = chosenProd.slug;
      return base;
    }
  }

  const detected = detectProductFamilyAndQuery(effectiveRawText);
  const budget = extractBudgetConstraintsFromQuery(effectiveRawText);
  const turnPrefs = extractPreferencesFromTurn(effectiveRawText);
  const meta = extractMetadataFromTurn(effectiveRawText);
  const explicitCodesInTurn = extractExplicitProductOrModelCodes(effectiveRawText);
  const turnCoreNouns = extractCustomerCoreNouns(effectiveRawText);

  if (!intentInfo.requiresProductLookup) {
    if (turnPrefs.length > 0) {
      base.preferences = Array.from(new Set([...base.preferences, ...turnPrefs]));
    }
    if (budget.maxPrice !== null || budget.minPrice !== null) {
      base.maxPrice = budget.maxPrice;
      base.minPrice = budget.minPrice;
    }
    if (meta.applicationContext) base.applicationContext = meta.applicationContext;
    if (meta.dimensionsOrThickness) base.dimensionsOrThickness = meta.dimensionsOrThickness;
    if (meta.quantity) base.quantity = meta.quantity;
    return base;
  }

  const isComparisonTurn =
    intentInfo.intent === "PRODUCT_COMPARISON" ||
    /\b(compare|comparison|vs\.?|versus|difference\s+between|both|all\s+three|earlier|previous)\b/i.test(lower);

  const prevCoreNouns = extractCustomerCoreNouns(base.primaryProductQuery || "");
  const prevHadRealProduct =
    prevCoreNouns.length > 0 || Boolean(base.focusProductSlug);

  const focusCodeNorm = (base.focusProductSlug || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const explicitSwitchedCode =
    !isComparisonTurn &&
    prevHadRealProduct &&
    explicitCodesInTurn.length >= 1 &&
    Boolean(base.focusProductSlug || base.primaryProductQuery) &&
    !explicitCodesInTurn.some((c) => focusCodeNorm.includes(c.toLowerCase().replace(/[^a-z0-9]/g, "")));

  const newNounMatch = lower.match(ACRIO_DOMAIN_PRODUCT_NOUN_RE);
  const distinctNounInTurn = newNounMatch ? newNounMatch[1].toLowerCase().replace(/s$/, "") : "";
  const prevQueryLower = `${base.primaryProductQuery || ""} ${base.focusProductSlug || ""} ${base.productFamily || ""}`.toLowerCase();
  const switchedToUnseenNoun =
    !isComparisonTurn &&
    !detected.isCorrectionOnly &&
    prevHadRealProduct &&
    Boolean(distinctNounInTurn) &&
    Boolean(base.primaryProductQuery || base.focusProductSlug) &&
    !prevQueryLower.includes(distinctNounInTurn) &&
    !/^(acrylic|perspex|pmma|model|option|product|custom\s*size|fabrication)$/i.test(distinctNounInTurn);

  const familyChanged =
    !isComparisonTurn &&
    !detected.isCorrectionOnly &&
    prevHadRealProduct &&
    Boolean(detected.productFamily) &&
    Boolean(base.productFamily) &&
    detected.productFamily !== base.productFamily &&
    !(
      (detected.productFamily === "machine" &&
        (base.productFamily === "polishing_machine" ||
          base.productFamily === "bending_machine")) ||
      ((detected.productFamily === "polishing_machine" ||
        detected.productFamily === "bending_machine") &&
        base.productFamily === "machine")
    );

  const hasExplicitSwitchPhrase =
    !isComparisonTurn &&
    prevHadRealProduct &&
    (Boolean(detected.primaryProductQuery) || explicitCodesInTurn.length > 0 || Boolean(distinctNounInTurn)) &&
    /\b(now\s+(?:tell|show|what\s+about|check)|what\s+about|how\s+about|instead(?:\s+of)?|switch\s+to|other\s+than\s+that|also\s+(?:show|need|check)|next\s+item|another\s+product)\b/i.test(lower);

  const isTopicSwitch =
    familyChanged || explicitSwitchedCode || switchedToUnseenNoun || hasExplicitSwitchPhrase;

  if (isTopicSwitch) {
    archivePreviousFocus();
    base.switchedThisTurn = true;
    base.activeBrand = detected.activeBrand;
    base.activeCategory = detected.activeCategory;
    base.productFamily = detected.productFamily;
    base.primaryProductQuery =
      detected.primaryProductQuery ||
      (turnCoreNouns.length > 0 || explicitCodesInTurn.length > 0 ? effectiveRawText : null);
    base.itemTypeFilter = detected.itemTypeFilter;
    base.excludedItemTypes = [...detected.excludedItemTypes];
    base.minPrice = budget.minPrice;
    base.maxPrice = budget.maxPrice;
    base.preferences = turnPrefs;
    base.applicationContext = meta.applicationContext;
    base.dimensionsOrThickness = meta.dimensionsOrThickness;
    base.quantity = meta.quantity;
    base.lastRecommendedProducts = [];
    base.shownProductSlugs = [];
    base.focusProductSlug = null;
    return base;
  }

  if (!prevHadRealProduct && (turnCoreNouns.length > 0 || Boolean(detected.productFamily))) {
    base.lastRecommendedProducts = [];
    base.shownProductSlugs = [];
    base.focusProductSlug = null;
  }

  if (explicitCodesInTurn.length > 0 && budget.maxPrice === null && budget.minPrice === null) {
    base.maxPrice = null;
    base.minPrice = null;
  }

  if (
    /\b(cheaper\s*alternative|cheaper\s*option|smaller\s*top\s*to\s*save|save\s*more|lower\s*price\s*option)\b/i.test(
      lower
    ) &&
    budget.maxPrice === null
  ) {
    const lastPrice = base.lastRecommendedProducts[0]?.priceInr;
    if (typeof lastPrice === "number" && lastPrice > 8000) {
      base.maxPrice = lastPrice - 1;
    } else {
      base.maxPrice = null;
    }
  }

  if (detected.activeBrand) base.activeBrand = detected.activeBrand;
  if (detected.activeCategory) base.activeCategory = detected.activeCategory;
  if (detected.productFamily && (!base.productFamily || base.productFamily === "machine" || detected.productFamily !== base.productFamily)) {
    base.productFamily = detected.productFamily;
  }
  if (detected.primaryProductQuery && (!base.primaryProductQuery || !prevHadRealProduct || !detected.isCorrectionOnly)) {
    if (
      !base.primaryProductQuery ||
      !prevHadRealProduct ||
      detected.productFamily === "podium" ||
      detected.productFamily === "furniture" ||
      detected.productFamily === "signage" ||
      detected.productFamily === "corporate_gift" ||
      detected.productFamily === "trophy" ||
      detected.productFamily === "polishing_machine" ||
      detected.productFamily === "bending_machine"
    ) {
      base.primaryProductQuery = detected.primaryProductQuery;
    }
  } else if (!base.primaryProductQuery && detected.isCorrectionOnly && detected.activeBrand === "CLASSIC_EDGE_53") {
    base.primaryProductQuery = "acrylic machine";
  } else if (
    (!base.primaryProductQuery || !prevHadRealProduct) &&
    (turnCoreNouns.length > 0 || explicitCodesInTurn.length > 0) &&
    effectiveRawText
  ) {
    base.primaryProductQuery = effectiveRawText;
  } else if (prevCoreNouns.length === 0 && base.primaryProductQuery && turnCoreNouns.length === 0) {
    base.primaryProductQuery = null;
  }

  if (detected.itemTypeFilter) {
    base.itemTypeFilter = detected.itemTypeFilter;
  }
  if (detected.excludedItemTypes.length > 0) {
    const mergedExcl = new Set([...base.excludedItemTypes, ...detected.excludedItemTypes]);
    base.excludedItemTypes = Array.from(mergedExcl);
  }

  if (budget.maxPrice !== null || budget.minPrice !== null) {
    base.maxPrice = budget.maxPrice;
    base.minPrice = budget.minPrice;
  } else if (/\b(no\s*budget|any\s*budget|without\s*budget|ignore\s*budget|no\s*price\s*limit|cheapest|costliest|most\s*expensive)\b/i.test(rawText)) {
    base.maxPrice = null;
    base.minPrice = null;
  }

  if (turnPrefs.length > 0) {
    const mergedPrefs = new Set([...base.preferences, ...turnPrefs]);
    base.preferences = Array.from(mergedPrefs);
  }

  if (meta.applicationContext) base.applicationContext = meta.applicationContext;
  if (meta.dimensionsOrThickness) base.dimensionsOrThickness = meta.dimensionsOrThickness;
  if (meta.quantity) base.quantity = meta.quantity;

  return base;
}

export function reconstructAcrioConversationState(params: {
  persistedState?: AcrioConversationState | null;
  recentMessages?: { direction: string; body: string }[];
  currentInboundText: string;
}): AcrioConversationState {
  const { persistedState, recentMessages = [], currentInboundText } = params;
  const trimmedCurrent = String(currentInboundText || "").trim();

  const inboundTurns = recentMessages
    .filter((m) => m.direction === "INBOUND" && Boolean(String(m.body || "").trim()))
    .map((m) => String(m.body).trim());

  if (
    inboundTurns.length > 0 &&
    inboundTurns[inboundTurns.length - 1] === trimmedCurrent
  ) {
    inboundTurns.pop();
  }

  let state = persistedState
    ? {
        ...createEmptyAcrioConversationState(),
        ...persistedState,
        excludedItemTypes: [...(persistedState.excludedItemTypes || [])],
        preferences: [...(persistedState.preferences || [])],
        lastRecommendedProducts: [...(persistedState.lastRecommendedProducts || [])],
        lastImageAnalysis: persistedState.lastImageAnalysis || null,
        analyzedImagesBySha: persistedState.analyzedImagesBySha
          ? { ...persistedState.analyzedImagesBySha }
          : {},
        imageAnalysisCountWindow: persistedState.imageAnalysisCountWindow
          ? { ...persistedState.imageAnalysisCountWindow }
          : undefined,
      }
    : createEmptyAcrioConversationState();

  if (!persistedState || (state.turnCount === 0 && inboundTurns.length > 0)) {
    state = createEmptyAcrioConversationState();
    for (let i = 0; i < inboundTurns.length; i++) {
      const turnText = inboundTurns[i];
      const turnIntent = classifyAcrioInboundIntent(turnText, i > 0);
      state = applyTurnToAcrioConversationState(state, turnText, turnIntent);
    }
  }

  const currentIntent = classifyAcrioInboundIntent(
    trimmedCurrent,
    inboundTurns.length > 0 || state.turnCount > 0
  );
  return applyTurnToAcrioConversationState(state, trimmedCurrent, currentIntent);
}

export function buildNormalizedSearchFromState(
  state: AcrioConversationState,
  fallbackRawText: string
): {
  searchQuery: string;
  searchOptions: EcosystemSearchOptions;
  budgetLabel: string | null;
  preferCheapest: boolean;
  asksMoreOrAlternative: boolean;
} {
  const parts: string[] = [];
  const rawTrimmed = fallbackRawText.trim();
  const hasExplicitInRaw =
    extractExplicitProductOrModelCodes(rawTrimmed).length > 0 ||
    extractCompactDimensionPairsFromText(rawTrimmed).pairs.length > 0 ||
    extractCompactDimensionPairsFromText(rawTrimmed).ranges.length > 0;

  if (hasExplicitInRaw && rawTrimmed) {
    parts.push(rawTrimmed);
  }
  if (state.primaryProductQuery) {
    if (!parts.some((p) => p.toLowerCase().includes(state.primaryProductQuery!.toLowerCase()))) {
      parts.push(state.primaryProductQuery);
    }
  }
  if (
    rawTrimmed &&
    !parts.some((p) => p.toLowerCase().includes(rawTrimmed.toLowerCase())) &&
    !/\b(not\s+looking\s+for|don'?t\s+want|do\s+not\s+want|just\s+machines|only\s+machines|increase\s+(?:the\s+)?budget|raise\s+(?:the\s+)?budget|stretch\s+(?:the\s+)?budget)\b/i.test(
      rawTrimmed
    )
  ) {
    parts.push(rawTrimmed);
  }

  const nonGenericPrefs = (state.preferences || []).filter(
    (p) => p !== "premium" && p !== "cheapest"
  );
  if (nonGenericPrefs.length > 0) {
    parts.push(nonGenericPrefs.join(" "));
  }
  if (state.applicationContext && !parts.join(" ").toLowerCase().includes(state.applicationContext)) {
    parts.push(state.applicationContext);
  }

  const searchQuery = parts.join(" ").trim() || fallbackRawText.trim();
  const preferCheapest =
    Boolean(state.preferCheapest) ||
    (state.preferences || []).includes("cheapest") ||
    /\b(cheapest|cheaper|lowest\s*price|cheaper\s*alternative|smaller\s*top\s*to\s*save|save\s*more)\b/i.test(
      rawTrimmed
    );
  const preferPremium =
    !preferCheapest && (state.preferences || []).includes("premium");
  const asksMoreOrAlternative =
    /\b(any\s*more|more\s*options|other\s*options|any\s*other|another\s*model|cheaper\s*alternative|smaller\s*top\s*to\s*save|save\s*more)\b/i.test(
      rawTrimmed
    );

  const searchOptions: EcosystemSearchOptions = {
    minPrice: state.minPrice,
    maxPrice: state.maxPrice,
    brand:
      state.activeBrand === "CLASSIC_CONCEPTS" ||
      state.activeBrand === "CLASSIC_EDGE_53"
        ? state.activeBrand
        : undefined,
    itemType: state.itemTypeFilter,
    excludedItemTypes: state.excludedItemTypes,
    productFamily: state.productFamily,
    preferPremium,
    preferCheapest,
    excludeSlugs: asksMoreOrAlternative ? state.shownProductSlugs || [] : undefined,
  };

  const budgetLabel =
    state.maxPrice !== null && state.minPrice !== null
      ? `₹${state.minPrice.toLocaleString("en-IN")} to ₹${state.maxPrice.toLocaleString("en-IN")}`
      : state.maxPrice !== null
      ? `<= ₹${state.maxPrice.toLocaleString("en-IN")}`
      : state.minPrice !== null
      ? `>= ₹${state.minPrice.toLocaleString("en-IN")}`
      : null;

  return { searchQuery, searchOptions, budgetLabel, preferCheapest, asksMoreOrAlternative };
}

let aiStateColumnChecked = false;
async function ensureConversationsAiStateColumn(): Promise<void> {
  if (aiStateColumnChecked) return;
  try {
    await ensureDatabasesBootstrapped();
    const conv = getRawLibSqlClient("conversations");
    await conv
      .execute(`ALTER TABLE conversations ADD COLUMN ai_state_json TEXT`)
      .catch(() => {});
    aiStateColumnChecked = true;
  } catch {
    // Non-fatal
  }
}

export async function loadConversationAiState(
  conversationId?: string
): Promise<AcrioConversationState | null> {
  if (!conversationId) return null;
  try {
    await ensureConversationsAiStateColumn();
    const conv = getRawLibSqlClient("conversations");
    const res = await conv.execute({
      sql: `SELECT ai_state_json FROM conversations WHERE id = ? LIMIT 1`,
      args: [conversationId],
    });
    const raw = res.rows[0]?.ai_state_json;
    if (!raw || typeof raw !== "string") return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        ...createEmptyAcrioConversationState(),
        ...parsed,
      };
    }
  } catch {
    // Ignore parse/DB errors
  }
  return null;
}

export async function saveConversationAiState(
  conversationId: string | undefined,
  state: AcrioConversationState
): Promise<void> {
  if (!conversationId) return;
  try {
    await ensureConversationsAiStateColumn();
    const conv = getRawLibSqlClient("conversations");
    await conv.execute({
      sql: `UPDATE conversations SET ai_state_json = ? WHERE id = ?`,
      args: [JSON.stringify(state), conversationId],
    });
  } catch {
    // Non-fatal
  }
}
