import crypto from "node:crypto";
import {
  cleanDisplayProductName,
  extractCompactDimensionPairsFromText,
  extractExplicitProductOrModelCodes,
  extractCustomerCoreNouns,
  countCoreNounMatches,
  ensureDatabasesBootstrapped,
  extractBudgetConstraintsFromQuery,
  getRawLibSqlClient,
  loadAllClassicConceptsProducts,
  loadAllClassicEdgeItems,
  resolveWhatsAppWebAppOrigin,
  searchEcosystemItems,
  type EcosystemSearchOptions,
  type MainWebsiteProduct,
} from "@cc/database";
import { invalidateWhatsAppCacheTags, rememberWhatsAppCacheWithMeta } from "@cc/storage";
import {
  type CustomerImageAnalysis,
} from "./image-intelligence";

// ============================================================================
// 2. ACRIO WHATSAPP AI CO-PILOT (Redis-Cached Classic Concepts + Classic Edge 53)
// ============================================================================
export interface AcrioRecommendedItem {
  name: string;
  slug: string;
  sku: string | null;
  priceInr: number | null;
  url: string;
  shortCode?: string | null;
  shortUrl?: string | null;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  brandLabel: string;
  itemType: "PRODUCT" | "MACHINE" | "CONSUMABLE";
  modelsSummary?: string | null;
}

export interface AcrioChatCopilotResult {
  engineLabel: string;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL" | "LOW";
  suggestedReplies: string[];
  recommendedProducts: AcrioRecommendedItem[];
  resolutionDraft: string;
}

export interface CatalogCacheMeta {
  ccCacheTier: string;
  ce53CacheTier: string;
  catalogCacheStatus: "HIT" | "MISS" | "BYPASS";
  cacheSummary: string;
}

export async function getCachedEcosystemCatalog(): Promise<{
  classicConceptsProducts: MainWebsiteProduct[];
  classicEdgeItems: MainWebsiteProduct[];
  allItems: MainWebsiteProduct[];
  cacheMeta: CatalogCacheMeta;
}> {
  const [ccRes, ceRes] = await Promise.all([
    rememberWhatsAppCacheWithMeta(
      "ecosystem:cc-products:v9",
      ["cc-products"],
      3600,
      () => loadAllClassicConceptsProducts()
    ),
    rememberWhatsAppCacheWithMeta(
      "ecosystem:ce53-items:v9",
      ["ce53-machines"],
      3600,
      () => loadAllClassicEdgeItems()
    ),
  ]);

  const classicConceptsProducts = ccRes.value;
  const classicEdgeItems = ceRes.value;
  const bothHit = ccRes.cacheStatus !== "MISS" && ceRes.cacheStatus !== "MISS";

  return {
    classicConceptsProducts,
    classicEdgeItems,
    allItems: [...classicConceptsProducts, ...classicEdgeItems],
    cacheMeta: {
      ccCacheTier: ccRes.cacheStatus,
      ce53CacheTier: ceRes.cacheStatus,
      catalogCacheStatus: bothHit ? "HIT" : "MISS",
      cacheSummary: `CC Catalog=${ccRes.cacheStatus} (${classicConceptsProducts.length} items) • CE53 Catalog=${ceRes.cacheStatus} (${classicEdgeItems.length} items)`,
    },
  };
}

/**
 * Formats ONLY genuinely matched products/machines into a clean, WhatsApp-ready grouped list
 * using ultra-short `https://ccapl.cc/<6-char-id>` links and `₹` Indian Rupee formatting.
 * Never pads with unrelated catalog items!
 */
export function buildGroupedProductShortLinksSection(params: {
  allItems: MainWebsiteProduct[];
  matchedItems: MainWebsiteProduct[];
  smartCategory: string;
  excludeConsumables?: boolean;
  hasStrictBudget?: boolean;
  hidePrices?: boolean;
  maxItems?: number;
}): string {
  const {
    matchedItems,
    smartCategory,
    excludeConsumables,
    hasStrictBudget,
    hidePrices = false,
    maxItems = 3,
  } = params;
  if (matchedItems.length === 0) return "";

  const usedKeys = new Set<string>();
  const keyOf = (it: MainWebsiteProduct) => `${it.brand}:${it.slug || it.id}`;

  const uniqueMatches: MainWebsiteProduct[] = [];
  for (const item of matchedItems) {
    if (excludeConsumables && item.itemType === "CONSUMABLE") continue;
    const k = keyOf(item);
    if (!usedKeys.has(k)) {
      usedKeys.add(k);
      uniqueMatches.push(item);
    }
  }
  if (uniqueMatches.length === 0) return "";

  const primaryLabel =
    smartCategory === "Podiums & Stage"
      ? "Acrylic Podiums & Pulpits"
      : smartCategory === "Awards & Trophies"
      ? "Acrylic Awards & Corporate Gifts"
      : smartCategory === "Hotel & Banquet"
      ? "Hotel & Display Stands"
      : smartCategory === "Acrylic Machines (CE53)"
      ? "Classic Edge 53 Machines"
      : smartCategory === "Custom Fabrication"
      ? "Matching Acrylic Options"
      : uniqueMatches[0]?.categoryName
      ? cleanDisplayProductName(uniqueMatches[0].categoryName)
      : "Matching Products";

  let primaryGroup: MainWebsiteProduct[] = [];
  let secondaryGroup: MainWebsiteProduct[] = [];
  let secondaryLabel = "Customisable Options";

  if (smartCategory === "Acrylic Machines (CE53)") {
    secondaryLabel = "Tools & Consumables";
    primaryGroup = uniqueMatches
      .filter((it) => it.itemType !== "CONSUMABLE")
      .slice(0, maxItems);
    secondaryGroup = excludeConsumables
      ? []
      : uniqueMatches
          .filter((it) => it.itemType === "CONSUMABLE")
          .slice(0, 2);
    if (primaryGroup.length === 0) {
      primaryGroup = uniqueMatches.slice(0, maxItems);
      secondaryGroup = [];
    }
  } else {
    const pricedReady = uniqueMatches.filter(
      (it) => typeof it.basePrice === "number" && it.basePrice > 0
    );
    const customQuoteOnly = uniqueMatches.filter(
      (it) => !(typeof it.basePrice === "number" && it.basePrice > 0)
    );

    if (pricedReady.length > 0) {
      primaryGroup = pricedReady.slice(0, maxItems);
      secondaryGroup = hasStrictBudget || primaryGroup.length >= maxItems ? [] : customQuoteOnly.slice(0, 2);
    } else {
      primaryGroup = uniqueMatches.slice(0, maxItems);
      secondaryGroup = [];
    }
  }

  const formatLine = (it: MainWebsiteProduct, idx: number) => {
    const cleanTitle = cleanDisplayProductName(it.name);
    const hasMrp = it.regularPrice && it.basePrice && it.regularPrice > it.basePrice;
    const priceTag = hidePrices
      ? ""
      : typeof it.basePrice === "number" && it.basePrice > 0
      ? ` (₹${it.basePrice.toLocaleString("en-IN")}${hasMrp ? `, MRP ₹${it.regularPrice!.toLocaleString("en-IN")}` : ""})`
      : " (Custom Quote)";
    const heightDim = (it.dimensions || []).find((d) => /height/i.test(d.label || d.key || ""));
    const topDim = (it.dimensions || []).find((d) => /top\s*sheet|reading\s*top|top\s*surface|size/i.test(d.label || d.key || ""));
    const gistDims: string[] = [];
    if (heightDim) gistDims.push(`Height: ${heightDim.value}`);
    if (topDim && topDim !== heightDim) gistDims.push(`Top: ${topDim.value}`);
    if (gistDims.length === 0 && it.dimensions && it.dimensions.length > 0) {
      for (const d of it.dimensions.slice(0, 2)) {
        gistDims.push(`${d.label || d.key}: ${d.value}`);
      }
    }
    const dimTag = gistDims.length > 0 ? `\n   ${gistDims.join(" | ")}` : "";
    const link = it.shortUrl || it.url;
    return `${idx + 1}. *${cleanTitle}*${priceTag}${dimTag}\n   ${link}`;
  };

  const blocks: string[] = [
    `*${primaryLabel}:*\n${primaryGroup.map(formatLine).join("\n")}`,
  ];

  if (secondaryGroup.length > 0) {
    blocks.push(
      `*${secondaryLabel}:*\n${secondaryGroup.map(formatLine).join("\n")}`
    );
  }

  return blocks.join("\n\n");
}

export async function syncEcosystemRedisCache(options?: {
  brand?: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | "ALL";
}): Promise<{
  invalidatedBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | "ALL";
  classicConceptsCount: number;
  classicEdgeMachinesCount: number;
  classicEdgeConsumablesCount: number;
  autoShortLinksCount: number;
  syncedAt: string;
}> {
  const brand =
    options?.brand === "CLASSIC_CONCEPTS" || options?.brand === "CLASSIC_EDGE_53"
      ? options.brand
      : "ALL";

  const tagsToInvalidate: (
    | "cc-products"
    | "ce53-machines"
    | "customer-history"
    | "acrio-replies"
  )[] =
    brand === "CLASSIC_CONCEPTS"
      ? ["cc-products", "acrio-replies"]
      : brand === "CLASSIC_EDGE_53"
      ? ["ce53-machines", "acrio-replies"]
      : ["cc-products", "ce53-machines", "acrio-replies"];

  await invalidateWhatsAppCacheTags(tagsToInvalidate);
  const { classicConceptsProducts, classicEdgeItems, allItems } = await getCachedEcosystemCatalog();
  return {
    invalidatedBrand: brand,
    classicConceptsCount: classicConceptsProducts.length,
    classicEdgeMachinesCount: classicEdgeItems.filter((i) => i.itemType === "MACHINE").length,
    classicEdgeConsumablesCount: classicEdgeItems.filter((i) => i.itemType === "CONSUMABLE").length,
    autoShortLinksCount: allItems.filter((i) => Boolean(i.shortCode)).length,
    syncedAt: new Date().toISOString(),
  };
}

export type AcrioTurnIntent =
  | "GREETING"
  | "IDENTITY_META"
  | "COMPANY_INFO"
  | "LEADERSHIP_CONTACT_INFO"
  | "CHAT_HISTORY_META"
  | "MENU_SELECTION"
  | "CATEGORY_OVERVIEW"
  | "MULTI_ITEM_PROJECT"
  | "CONVERSATIONAL_FOLLOWUP"
  | "TOPIC_RESET"
  | "HUMAN_HANDOFF_INFO"
  | "HUMAN_HANDOFF_REQUEST"
  | "SUPPORT_ISSUE"
  | "ORDER_STATUS"
  | "OFF_TOPIC"
  | "PRODUCT_SEARCH"
  | "FOLLOW_UP_REFINEMENT"
  | "PRODUCT_COMPARISON"
  | "CUSTOM_QUOTE";

export interface AcrioIntentClassification {
  intent: AcrioTurnIntent;
  requiresProductLookup: boolean;
  allowRollingContextFallback: boolean;
  needsImmediateHandoff: boolean;
  reason: string;
}

export interface AcrioCustomerProfileInfo {
  customerProfile: "SIMPLE_LAYMAN" | "STUDENT_EXPLORER" | "EVERYDAY_BUYER" | "BUSINESS_INSTITUTIONAL" | "TECHNICAL_GRADUATE";
  languageMode: "ENGLISH" | "HINDI_HINGLISH" | "OTHER_FALLBACK";
  instructionNote: string;
}

/**
 * Adaptive Customer Persona & Language Detector (Decision #1 + Universal Buyer Support):
 * - Primary languages: English and Hindi/Hinglish. Uses another regional language ONLY if the customer writes in that script or clearly does not understand English/Hindi.
 * - Adapts tone from simple layman/broken-English buyers ("they sit, do your hand Acrylic chair", "interiora") to students, corporate/institutional buyers, and technical graduates.
 */
export function detectAcrioCustomerProfile(
  rawText: string,
  recentInboundText = ""
): AcrioCustomerProfileInfo {
  const combined = `${recentInboundText} ${rawText}`.trim();
  const lower = combined.toLowerCase();

  // Language detection: Devanagari or Romanized Hindi/Hinglish vs non-Hindi regional scripts
  const hasDevanagari = /[\u0900-\u097F]/.test(rawText);
  const hasOtherIndianScript = /[\u0980-\u0DFF]/.test(rawText);
  const hasHinglishTokens =
    /\b(kya|hai|hain|chahiye|kitna|kitne|ka\s+hai|milega|batao|bataiye|dikhao|sasta|mehenga|aur\s+dikhao|humko|mujhe|dukaan|bhaiya|rate\s+kya|kaisa)\b/i.test(
      rawText
    );

  const languageMode: AcrioCustomerProfileInfo["languageMode"] = hasOtherIndianScript
    ? "OTHER_FALLBACK"
    : hasDevanagari || hasHinglishTokens
    ? "HINDI_HINGLISH"
    : "ENGLISH";

  // Persona detection
  const isStudent = /\b(i\s+am\s+a\s+student|for\s+my\s+college\s+project|school\s+project|just\s+learning|student\s+here)\b/i.test(lower);
  const isBusinessInstitutional =
    /\b(renovation|office|corporate\s*clients?|bulk|gst|invoice|quotation|proforma|company|hospital|hotel|church|school|college|university|auditorium|\d+\s*(?:podiums?|signages?|chairs?|tables?|trophies))\b/i.test(
      lower
    );
  const isTechnical =
    /\b(ccp\d{2,4}|yn[-_\s]?jw|abm[-_\s]?\d|ce53|\d+\s*[x×]\s*\d+|mm\b|thickness|cast\s*acrylic|extruded|rpm|wattage)\b/i.test(
      lower
    );
  const isBrokenOrShortLayman =
    /\b(do\s+your\s+hand|interiora|they\s+sit)\b/i.test(lower) ||
    (rawText.split(/\s+/).length <= 5 && !isTechnical);

  const customerProfile: AcrioCustomerProfileInfo["customerProfile"] = isStudent
    ? "STUDENT_EXPLORER"
    : isBusinessInstitutional
    ? "BUSINESS_INSTITUTIONAL"
    : isTechnical
    ? "TECHNICAL_GRADUATE"
    : isBrokenOrShortLayman
    ? "SIMPLE_LAYMAN"
    : "EVERYDAY_BUYER";

  const langRule =
    languageMode === "HINDI_HINGLISH"
      ? "Reply in simple, natural Hindi/Hinglish (or clear English with Hindi terms) so the customer understands effortlessly."
      : languageMode === "OTHER_FALLBACK"
      ? "The customer does not appear comfortable in English or Hindi; reply in their language alongside simple English."
      : "Reply in clear, simple everyday English (never use other languages unless the customer asks or does not understand English/Hindi).";

  const personaRule =
    customerProfile === "SIMPLE_LAYMAN"
      ? "Customer writes in short or broken phrases: infer their real meaning charitably (e.g. 'they sit, do your hand Acrylic chair' = asking if we have Acrylic Chairs for sitting), use very simple words, and show 2-3 clear options."
      : customerProfile === "STUDENT_EXPLORER"
      ? "Customer is a student: be warm, helpful, and educational without pressuring them for a delivery city or bulk order."
      : customerProfile === "BUSINESS_INSTITUTIONAL"
      ? "Customer is a business/institutional buyer: provide structured itemized numbers, unit price × quantity totals, and practical组合/package options."
      : "Provide a concise, scannable gist with exact specs and prices.";

  return {
    customerProfile,
    languageMode,
    instructionNote: `${langRule} ${personaRule}`,
  };
}

/**
 * Normalizes common customer product/material spelling mistakes (such as "Acylirc" -> "Acrylic",
 * "poduim" -> "podium", "lockr" -> "locker") so intent detection and catalog search never miss a noun.
 */
export function normalizeCustomerProductTypos(text: string): string {
  return String(text || "")
    .replace(/\b(?:acylirc|acyrlic|acrilic|acrlic|acrylc|ackrylic|acraylic|acrylik|acralic)\b/gi, "acrylic")
    .replace(/\b(?:poduim|podiym|podiam|podiumn)\b/gi, "podium")
    .replace(/\b(?:pulpet|pulpitt)\b/gi, "pulpit")
    .replace(/\b(?:lectren|lecturn)\b/gi, "lectern")
    .replace(/\b(?:lockr|lokcer|locekr)\b/gi, "locker")
    .replace(/\b(?:trophie|trofy|tropy)\b/gi, "trophy")
    .replace(/\b(?:momento|momentos|momemto|momemtos|mementoes)\b/gi, "memento")
    .replace(/\b(?:locking)\s+for\b/gi, "looking for")
    .replace(/\b(?:enquery|enqury|inquiery)\b/gi, "enquiry")
    .replace(/\b(?:flourocent|fluroscent)\b/gi, "fluorescent")
    .replace(/\b(?:brocher|brochur|brocure)\b/gi, "brochure")
    .replace(/\b(?:catlog|catalouge|catelogue)\b/gi, "catalogue");
}

/**
 * Separates bare WhatsApp media/webhook placeholders (`[Image]`, `[Message]`, `[Audio]`, `[Document]`, `[Video]`)
 * from actual customer text lines in a multi-message burst so `[Image]` never pollutes catalog search.
 */
export function stripBurstMediaPlaceholders(rawText: string): {
  cleanText: string;
  images: number;
  documents: number;
  videos: number;
  audios: number;
  unreadable: number;
  totalMediaPlaceholders: number;
} {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let images = 0;
  let documents = 0;
  let videos = 0;
  let audios = 0;
  let unreadable = 0;
  const textLines: string[] = [];

  for (const line of lines) {
    if (/^\[(?:image|photo|picture|sticker)\b[^\]]*\]$/i.test(line)) {
      images++;
    } else if (/^\[(?:document|pdf|file)\b[^\]]*\]$/i.test(line)) {
      documents++;
    } else if (/^\[(?:video)\b[^\]]*\]$/i.test(line)) {
      videos++;
    } else if (/^\[(?:audio|voice\s*note)\b[^\]]*\]$/i.test(line)) {
      audios++;
    } else if (/^\[(?:message|media|attachment|unsupported)\b[^\]]*\]$/i.test(line)) {
      unreadable++;
    } else {
      const strippedInline = line
        .replace(/\[(?:image|photo|video|document|pdf|file|audio|voice\s*note|sticker|message)\]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (strippedInline) {
        textLines.push(strippedInline);
      }
    }
  }

  return {
    cleanText: textLines.join("\n").trim(),
    images,
    documents,
    videos,
    audios,
    unreadable,
    totalMediaPlaceholders: images + documents + videos + audios + unreadable,
  };
}

export const ACRIO_DOMAIN_PRODUCT_NOUN_RE =
  /\b(ccpo?[-_\s]?\d{2,4}[a-z]?|yn[-_\s]?jw\d{3,4}|abm[-_\s]?\d{3,4}|ce53[-_\s]?[a-z0-9-]+|cw[-_\s]?\d{3,5}|f[-_\s]?(?:308|500)|sd[-_\s]?\d{3,4}|jw[-_\s]?\d{3,4}|zd[-_\s]?\d{3,4}|d30|ce[-_\s]?(?:lc|cnc|fp|to)\d{2,4}|c[-\s]*podium|podium|podiums|pulpit|pulpits|lectern|lecterns|rostrum|rostrums|trophy|trophies|memento|mementos|award|awards|plaque|plaques|medal|medals|gift|gifts|gifting|corporate\s*gift|corporate\s*clients?|souvenir|souvenirs|paper\s*weight|paperweight|pen\s*stand|stand|stands|holder|holders|riser|risers|menu|qr|tent\s*card|brochure|leaflet|pamphlet|tray|trays|coaster|coasters|tissue|napkin|box|boxes|case|cases|cover|covers|enclosure|enclosures|guard|guards|display|displays|cabinet|cabinets|locker|lockers|mobile\s*locker|phone\s*locker|cell\s*phone|mobile|mobiles|phone|phones|tablet|tablets|compartment|compartments|pigeon\s*hole|rack|racks|shelf|shelves|caddy|counter|counters|partition|partitions|shield|shields|sneeze\s*guard|key\s*box|key\s*cabinet|medicine\s*box|first\s*aid\s*box|showcase|vitrine|frame|frames|easel|signage|signages|sign|signs|name\s*plate|name\s*plates|nameplate|nameplates|name\s*board|board|sheet|sheets|rod|rods|tube|tubes|pipe|pipes|ball|balls|sphere|turntable|rotating\s*disc|machine|machines|polisher|polishing|bender|bending|heater|laser|router|cnc|cutter|blade|consumable|consumables|carbide|collet|chiller|compressor|solvent|chloroform|glue|adhesive|buffing|flame|oven|thermoforming|accessor(?:y|ies)|add[-\s]?ons?|hinge|hinges|camlock|camlocks|standoff|standoffs|spacer|spacers|knob|knobs|handle|handles|latch|latches|catch|catches|hasp|staple|screw|screws|bolt|nut|washer|bracket|brackets|photo\s*magnet|radeon|glitter|mirror|metallic|keychain|keychains|keyring|bookmark|globe|hanger|organizer|organiser|dispenser|glove|mask|shoe|table|tables|stool|stools|chair|chairs|desk|desks|furniture|interior|interiors|interiora|decor|furnishing|seating|sit|sitting|donation|suggestion\s*box|ballot|cake\s*stand|cupcake|cosmetic|makeup|lipstick|jewelry|jewellery|watch\s*stand|eyewear|sunglass|mobile\s*stand|laptop\s*stand|book\s*stand|quran|rehal|bible|photo\s*frame|poster|wall\s*mount|keyway|lockable|custom\s*size|fabrication|cast\s*acrylic|extruded\s*acrylic|acrylic\s*sheet)\b/i;

const ACRIO_FOLLOW_UP_REFINEMENT_RE =
  /\b(under|below|above|over|between|within|around|budget|price|cost|rate|mrp|how\s*much|kitna|kitne|cheaper|cheapest|lowest\s*price|costliest|most\s*expensive|smaller\s*top|save\s*more|lower\s*price|higher\s*budget|increase\s*(?:the\s*)?budget|raise\s*(?:the\s*)?budget|stretch\s*(?:the\s*)?budget|extend\s*(?:the\s*)?budget|without\s*(?:mentioning\s*)?prices?|no\s*prices?|hide\s*prices?|premium|most\s*premium|high\s*end|flagship|best\s*one|best\s*ones|first\s*two|top\s*two|both\s*of\s*them|all\s*(?:three|two|four|five|of\s*them)|rs\.?|inr|₹|\d+\s*(?:k|lac|lacs|lakh|lakhs|cr|crore)\b|\d{4,7}\b|\d+\s*(?:pcs?|pieces?|nos?|units?|qty|quantity|sets?)\b|single\s*piece|just\s*one|transparent|clear|frost|frosted|black|white|gold|golden|silver|stainless|colored|coloured|color|colors|colour|colours|variant|variants|finish|finishes|imag[a-z]*|phot[a-z]*|phto[a-z]*|pics?|pictures?|snaps?|visuals?|videos?|pdf|brochure|catalogue|catalog|dikha[a-z]*|photo\s*bhejo|bhejo\s*photo|close[-\s]*up|how\s+does\s+(?:it|this|that)\s+look|look\s+like|dimension|dimensions|size|sizes|height|width|depth|reading\s*top|top\s*sheet|bottom\s*sheet|front\s*panel|shelf\s*size|logo\s*panel|spec|specs|specification|specifications|feature|features|details?|pillar|pillars|warranty|wheel|wheels|weight|assembly|diy|thick|thickness|available|availability|in\s*stock|stock|delivery|shipping|dispatch|gst|tax|invoice|how\s+to\s+(?:order|buy|book)|order\s+this|buy\s+this|book\s+this|i\s+want\s+this|this\s+one|that\s+one|same\s+one|\d+\s*(?:mm|cm|inch|inches|in|ft)\b|bigger|biggest|larger|largest|smaller|wider|widest|taller|tallest|compact|portable|foldable|wheeled|castor|led|light|backlit|logo|branding|print|engraving|uv\s*print|without\s*logo|no\s*logo|with\s*logo|show\s*more|more\s*options|any\s*more|other\s*options|any\s*other|another\s*model|different\s*size|different\s*model|which\s*one|which\s*of\s*these|alternative|alternatives)\b/i;

const ACRIO_SHORT_CITY_OR_REPLY_RE =
  /\b(hyderabad|secunderabad|mumbai|bangalore|bengaluru|delhi|new\s*delhi|noida|gurgaon|gurugram|chennai|pune|kolkata|ahmedabad|surat|vadodara|jaipur|lucknow|kanpur|nagpur|indore|bhopal|visakhapatnam|vizag|vijayawada|guntur|warangal|tirupati|coimbatore|madurai|kochi|ernakulam|trivandrum|patna|ranchi|bhubaneswar|guwahati|chandigarh|ludhiana|amritsar|dehradun|raipur|mysore|mangalore|hubli|belgaum|nashik|aurangabad|thane|navi\s*mumbai|faridabad|ghaziabad|\d{6})\b/i;

/**
 * Deterministic Turn-Level Intent Classifier (Phase A).
 * Runs BEFORE any catalog fetch or product lookup so non-product turns
 * never trigger unnecessary product retrieval or leak prior-turn products,
 * while NEVER wiping conversation history on numbered replies ("1") or follow-ups!
 */
export function classifyAcrioInboundIntent(
  rawText: string,
  hasConversationHistory = false
): AcrioIntentClassification {
  const strippedBurst = stripBurstMediaPlaceholders(rawText);
  const effectiveText = normalizeCustomerProductTypos(
    strippedBurst.cleanText || String(rawText || "")
  ).trim();
  const trimmed = effectiveText;
  const lower = trimmed.toLowerCase();

  if (!trimmed) {
    return {
      intent: "GREETING",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Empty or whitespace message",
    };
  }

  const hasDomainProductNoun = ACRIO_DOMAIN_PRODUCT_NOUN_RE.test(lower);

  // 1. Leadership / Chairperson / Marketing / Department-wise staff contact lookup (Decision #7)
  if (
    /\b(chairperson|chairman|chairwoman|director|directors|founder|ceo|owner|proprietor|managing\s*director|president|marketing\s*(?:head|person|team|manager|contact|department|number|email|executive)|sales\s*(?:head|manager|person|contact|number|email|department)|department\s*(?:wise|contact|contacts|head|heads|people|number|numbers|email|emails|list)|(?:staff|team)\s*(?:details|contacts?|numbers?|emails?|list)|(?:share|send|give)\s*(?:me\s*)?(?:your\s*)?(?:staff|team)\s*(?:details|contacts?|info|numbers?)|contact\s*(?:person|details|number|email)\s*(?:for|of)\s*(?:marketing|sales|machines|dispatch|fabrication|management|chairperson|director)|who\s+(?:is|are)\s+(?:the|your)\s+(?:chairperson|chairman|director|founder|ceo|owner|marketing\s*head|sales\s*head|department\s*heads?))\b/i.test(
      lower
    )
  ) {
    return {
      intent: "LEADERSHIP_CONTACT_INFO",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer asked for chairperson, leadership, marketing, or staff/team contact details",
    };
  }

  // 2. Informational question about human handoff ("Whom will you connect me to?", "Who handles custom quotes?")
  if (
    /\b(?:who|whom|which\s*(?:team|person|department|member|specialist)|what\s*(?:team|department))\s+(?:will|would|do|can|are)\s+you\s+(?:connect|transfer|assign|hand\s*over|forward)\b|\b(?:to\s+whom|with\s+whom)\s+(?:will|would|do|can)\s+you\s+connect\b|\b(?:who|whom)\s+(?:handles|takes\s*care\s*of|manages|looks\s*after|is\s+in|is\s+your)\s+(?:this|my\s*chat|custom|orders|sales|support|enquiries|inquiries|team|manager|executive)\b|\b(?:can\s+i\s+know|tell\s+me)\s+(?:who|whom)\s+(?:you\s+will\s+connect|i\s+will\s+(?:talk|speak)\s+(?:to|with))\b|\bhow\s+does\s+(?:the\s+)?(?:handoff|human\s*support|sales\s*team)\s+work\b/i.test(
      lower
    )
  ) {
    return {
      intent: "HUMAN_HANDOFF_INFO",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer asked an informational question about who handles handoffs",
    };
  }

  // 3. Explicit request to be connected to a human / sales person right now
  if (
    !/^(?:who|whom|which\s+team|what\s+team|how\s+does)\b/i.test(lower) &&
    /\b(talk\s*to\s*(?:a\s*|the\s*|your\s*|some\s*)?(?:team|human|person|agent|staff|sales|someone|manager|executive)|speak\s*(?:to|with)\s*(?:a\s*|the\s*|your\s*|some\s*)?(?:team|human|person|agent|staff|sales|someone|manager|executive)|connect\s*(?:me\s*)?(?:now|right\s*away|please)?(?:\s*(?:to|with)\s*(?:a\s*|the\s*|your\s*|some\s*)?(?:team|human|person|agent|staff|sales|someone|manager|executive))?|connect\s*me|yes\s*,?\s*(?:please\s*)?connect\s*me|human\s*agent|real\s*person|call\s*me|can\s+someone\s+call|please\s*call|need\s*a\s*call|want\s*a\s*call|transfer\s*(?:me|chat)\s*to\s*(?:human|sales|team|person)|assign\s*(?:to\s*)?(?:human|sales|team))\b/i.test(
      lower
    ) &&
    !/\bconnect\b/i.test(lower.replace(/\bconnect\s*(?:me|to|with)\b/gi, ""))
  ) {
    return {
      intent: "HUMAN_HANDOFF_REQUEST",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: true,
      reason: "Customer explicitly requested to speak with human sales/support staff",
    };
  }

  // 4. Support / complaint / damaged delivery / refund / CAD file
  if (
    /\b(complaint|damaged|cracked\s*on\s*delivery|broken\s*item|wrong\s*item|refund|cancel\s*my\s*order|dispute|drawing\s*attached|cad\s*file|dxf\s*file|gst\s*mismatch|payment\s*stuck|payment\s*failed)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "SUPPORT_ISSUE",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: true,
      reason: "Customer reported a support, delivery, payment, or CAD file issue requiring human attention",
    };
  }

  // 5. Specific order status / tracking lookup
  if (
    /\b(?:order\s*(?:id|no|number|#)?\s*[:#-]?\s*[a-z0-9-]*\d{3,}|cc-\d+|ce-\d+|track\s+my\s+order|where\s+is\s+my\s+order|order\s+status|status\s+(?:on|of)\s+my\s+order|check\s+my\s+order|update\s+on\s+my\s+order|dispatch\s+status)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "ORDER_STATUS",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: true,
      reason: "Customer asked for order tracking or dispatch status",
    };
  }

  // 6. Chat history / Meta / Feedback / Student declaration ("Tell me about my chat history with you", "You lost the context again", "Why do you keep asking the same city question", "I am a student")
  if (
    /\b(chat\s*history|my\s*history|our\s*chat|what\s+did\s+i\s+(?:ask|say)|what\s+have\s+we\s+discussed|summary\s+of\s+(?:our|my)\s+(?:chat|conversation)|you\s+lost\s+(?:the\s*)?context|lost\s+context|forgot\s+(?:the\s*)?context|keep\s+asking\s+(?:the\s*)?same|same\s+city\s+question|asking\s+the\s+same\s+question|excellent\s+reply\s+fool|you\s+are\s+a\s+fool|bad\s+reply|useless\s+bot|i\s+am\s+a\s+student|i'm\s+a\s+student)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "CHAT_HISTORY_META",
      requiresProductLookup: false,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer asked about conversation history, context continuity, repeated questions, or shared persona context",
    };
  }

  // 7. Numbered menu / option selection ("1", "2", "Option 1", "the first one")
  if (
    hasConversationHistory &&
    (/^[\s*#]*(?:option\s*|category\s*|number\s*|no\.?\s*)?([1-5])[\s.)*]*$/i.test(trimmed) ||
      /^(?:the\s+)?(first|second|third|fourth|1st|2nd|3rd|4th)\s*(?:one|option|category|model)?[\s.!]*$/i.test(
        trimmed
      ))
  ) {
    return {
      intent: "MENU_SELECTION",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer selected a numbered menu/category/product option from the previous turn",
    };
  }

  // 8. Category / Sub-category overview ("What all categories do you have under the podiums category?")
  if (
    /\b(what\s+(?:all\s+)?(?:sub[-\s]*)?categories|which\s+(?:sub[-\s]*)?categories|all\s+categories\s+under|categories\s+(?:under|in|of)\s+(?:the\s+)?podiums?|types\s+of\s+podiums?\s+categories|podium\s+sub[-\s]*categories)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "CATEGORY_OVERVIEW",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer asked for the sub-categories/types under a product category",
    };
  }

  // 9. Multi-item project or bulk quantity + budget totalling ("3 Acrylic podiums, 10 signages ... and 10 chairs ... budget 1 lac")
  const qtyMatches = lower.match(/\b\d{1,3}\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:podiums?|pulpits?|lecterns?|signages?|signs?|name\s*plates?|nameplates?|chairs?|stools?|tables?|trophies|awards?|stands?)\b/gi);
  if (
    (qtyMatches && qtyMatches.length >= 2) ||
    (/\b(renovation|office\s+project|complete\s+package|total\s+cost|total\s+price)\b/i.test(lower) &&
      Boolean(qtyMatches && qtyMatches.length >= 1))
  ) {
    return {
      intent: "MULTI_ITEM_PROJECT",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer requested multi-item quantities or project budget totalling",
    };
  }

  // 10. Explicit Topic Reset / switching query ("I have a different query", "Forget that, let's start over")
  if (
    !hasDomainProductNoun &&
    /\b(different\s*(?:query|question|requirement|topic|thing|enquiry|inquiry)|another\s*(?:query|question|requirement|topic|enquiry|inquiry)|something\s*else|forget\s*(?:that|it|previous|the\s*last)|start\s*over|start\s*afresh|change\s*(?:of\s*)?(?:topic|subject)|leave\s*(?:that|it)|never\s*mind(?:\s*(?:that|it))?|new\s*(?:query|question|topic|requirement|enquiry|inquiry))\b/i.test(
      lower
    )
  ) {
    return {
      intent: "TOPIC_RESET",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer explicitly signalled a topic reset or new unspecified query",
    };
  }

  // 11. Identity / AI / Bot capability questions ("Who are you?", "What can you help me with?", "Are you a bot?")
  if (
    !hasDomainProductNoun &&
    /\b(who\s+are\s+you|what\s+are\s+you|what\s+is\s+your\s+name|your\s+name|are\s+you\s+(?:a\s+)?(?:bot|ai|human|real\s+person|robot|assistant|automated)|which\s+(?:ai|model|llm)|what\s+(?:ai|model|llm)|what\s+can\s+you\s+(?:do|help\s*(?:me\s*)?with)|how\s+can\s+you\s+help(?:\s+me)?|tell\s+me\s+about\s+yourself|what\s+is\s+acrio|who\s+is\s+acrio)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "IDENTITY_META",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer asked about ACRIO's identity, AI model, or capabilities",
    };
  }

  // 12. Company / Factory / Location / Brand info questions ("Where is your factory?", "Share location", "Directions")
  if (
    /\b(where\s+(?:are\s+you|is\s+your)\s*(?:located|based|factory|office|workshop|shop|company|plant|unit|showroom|from)?|(?:what\s+is|share|send|give|need|want|drop|ping)\s*(?:me\s*|us\s*)?(?:your\s*|the\s*)?(?:location|map\s*location|google\s*map|maps\s*(?:link|url)?|directions?|pin|address|factory\s*address|office\s*address|office\s*location|factory\s*location|company\s*details)|how\s+(?:to|do\s+i)\s+(?:reach|visit|come\s+to)\s+(?:your\s+)?(?:factory|office|shop|unit|showroom)|^\s*(?:map\s*location|location|your\s*location|address|office\s*address|google\s*maps?|directions)\s*\??$|your\s+(?:factory\s+location|office\s+location|company\s+address|working\s+hours|opening\s+hours)|what\s+(?:does|is)\s+classic\s+(?:concepts|edge(?:\s*53)?)(?:\s+do)?|difference\s+between\s+classic\s+concepts\s+and\s+classic\s+edge|tell\s+me\s+about\s+(?:your\s+company|classic\s+concepts|classic\s+edge(?:\s*53)?)|do\s+you\s+(?:ship|deliver)\s+(?:across|all\s+over|pan)\s+india|do\s+you\s+provide\s+gst(?:\s+invoice|\s+bill)?)\b/i.test(
      lower
    ) &&
    !/\b(under|below|above|price\s+of|cost\s+of|buy|order\s+a|looking\s+for\s+a)\b/i.test(lower)
  ) {
    return {
      intent: "COMPANY_INFO",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer asked about company, location, timings, shipping, or brand overview",
    };
  }

  // 12b. Inbound B2B Vendor / Supplier cold pitch (offering materials/services TO us, not buying our products)
  if (
    /\b(tried\s+reaching\s+you|rate\s*card|drop\s+samples|turnkey\s+contractors|we\s+are\s+supporting|factory[- ]direct\s+b2b\s+rates|estimation\s+team|when\s+would\s+be\s+a\s+good\s+time\s+to\s+connect|looking\s+to\s+empanel|vendor\s+registration)\b/i.test(
      lower
    ) &&
    !/\b(price\s+of|quote\s+for|looking\s+for\s+(?:a|an|your)|buy|order|podium|pulpit|trophy|memento|polishing\s+machine|bending\s+machine)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "OFF_TOPIC",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Inbound supplier or B2B sales outreach; acknowledge politely without marketing products",
    };
  }

  // 12c. Self-Introduction or forwarded company intro blurb without an actual product request
  const looksLikeIntroduction =
    /^(?:hi+|hello+|hey+|hii+|good\s*(?:morning|afternoon|evening))[\s,!.]*(?:sir|madam|mam|there|team)?[\s,!.\n]*(?:this\s+is\b|i\s+am\b|i'?m\b|myself\b|we\s+are\b|classic\s+concepts\s+acrylic)/i.test(
      trimmed
    ) ||
    (/\b(whatsapp\.com\/channel|follow\s+the\s+classic\s+concepts|manufacturers?\s+of\s+acrylic\s+products\s+based\s+in)\b/i.test(
      lower
    ) &&
      trimmed.split(/\s+/).length <= 55);
  const asksBuyingOrProductQuestion =
    /\b(looking\s+for|need\s+(?:a|an|some|\d+)|want\s+(?:to\s+(?:buy|order|enquire|get)|a|an|some)|price|cost|rate|quote|quotation|how\s+much|share\s+(?:options|details|photos|catalogue|catalog)|can\s+you\s+(?:make|supply|provide|share)|ccp\d{2,4}|yn[-_\s]?jw\d{3,4})\b/i.test(
      lower
    );
  if (looksLikeIntroduction && !asksBuyingOrProductQuestion) {
    return {
      intent: "GREETING",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Self-introduction or intro blurb without an active buying enquiry; reply politely without pushing products",
    };
  }

  // 12d. Standalone callback phone number, another-number privacy check, or simple correction feedback ("Wrong answer")
  if (
    /^\s*\+?\d[\d\s()-]{8,16}\s*$/.test(trimmed) ||
    /^\s*check\s+\+?\d[\d\s-]{6,16}\s*$/i.test(trimmed) ||
    /^\s*(?:wrong\s*answer|incorrect\s*answer|that'?s\s*wrong|not\s*correct)\s*[.!]?\s*$/i.test(
      trimmed
    )
  ) {
    return {
      intent: "CONVERSATIONAL_FOLLOWUP",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Phone number callback, lookup guard, or correction note; handle concisely without catalog dump",
    };
  }

  // 13. Pure greeting / pleasantry / thanks
  if (
    /^[\s\W]*(hi+|hello+|hey+|hii+|heyy+|good\s*(?:morning|afternoon|evening|day)|namaste|greetings|hi\s+there|hello\s+there|hey\s+there|hi\s+acrio|hello\s+acrio|thanks|thank\s+you|thank\s+you\s+so\s+much|many\s+thanks|ok\s+thanks|okay\s+thanks|can\s+you\s+help(?:\s+me)?)[\s\W]*$/i.test(
      trimmed
    )
  ) {
    return {
      intent: "GREETING",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Greeting or conversational pleasantry",
    };
  }

  // 14. Obvious off-topic queries with zero domain nouns
  if (
    !hasDomainProductNoun &&
    /\b(weather|forecast|cricket|ipl|football|soccer|movie|film|song|lyrics|recipe|biryani|pizza|burger|bitcoin|crypto|stock\s*market|nifty|sensex|python\s*code|javascript|leetcode|math\s*homework|election|minister|politics|tell\s*me\s*a\s*joke|write\s*a\s*poem|horoscope|astrology)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "OFF_TOPIC",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Off-topic message outside acrylic products and fabrication machines",
    };
  }

  // 15. Custom fabrication quote with explicit 3D dimensions or custom fabrication phrasing
  if (
    /\b(\d+\s*(?:mm|cm|inch|in|ft)?\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?)\b/i.test(
      lower
    ) ||
    /\b(custom\s*(?:size|dimension|fabrication|box|cover|enclosure)|made\s*to\s*order|as\s*per\s*(?:my\s*)?(?:drawing|size|sketch))\b/i.test(
      lower
    )
  ) {
    return {
      intent: "CUSTOM_QUOTE",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer requested custom fabrication or shared specific dimensions",
    };
  }

  // 16. Product comparison
  if (
    /\b(compare|comparison|vs\.?|versus|difference\s+between|differ\s+between|which\s+(?:one|of\s+these|of\s+them|model|podium|pulpit|machine)\s+(?:is|has)\s+(?:better|wider|widest|larger|largest|bigger|biggest|taller|tallest|more))\b/i.test(
      lower
    )
  ) {
    return {
      intent: "PRODUCT_COMPARISON",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer asked to compare products or models",
    };
  }

  // 17. Follow-up refinement (budget change, color/material/size filter, "show me more", "without mentioning prices", "cheaper alternative")
  if (!hasDomainProductNoun && ACRIO_FOLLOW_UP_REFINEMENT_RE.test(lower)) {
    return {
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer refined budget, size, finish, quantity, or pricing on prior product context",
    };
  }

  // 18. Direct product search or problem/use-case description (e.g. "pulpits under 25000", "furniture and interiora", "small classroom", "corporate clients")
  if (
    hasDomainProductNoun ||
    /\b(stage|auditorium|church|school|classroom|college|university|conference|seminar|hotel|restaurant|cafe|banquet|hospital|clinic|retail|shop|showroom|exhibition|event|ceremony|convocation|wedding|office|reception|counter|cloudy|rough\s*edge|white\s*edge|bubble|crack|warping|scratch|yellow)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "PRODUCT_SEARCH",
      requiresProductLookup: true,
      allowRollingContextFallback: hasConversationHistory && !hasDomainProductNoun,
      needsImmediateHandoff: false,
      reason: "Customer searched for a product, fabrication machine, or venue/application use case",
    };
  }

  // 19. Short confirmation, city/quantity/preference answer, or quoted-message reply in active conversation
  if (
    hasConversationHistory &&
    (/\b(yes|yeah|yep|yup|no|nope|sure|ok|okay|fine|go\s*ahead|please\s*share|send\s*(?:links|details|options|photos|images|catalogue|catalog|quote)|show\s*(?:me|them|options|details)|tell\s*me(?:\s*more|\s*about\s*(?:this|it|that))?|what\s+about\s+(?:this|that|it)|is\s+(?:it|this)\s+available|can\s+(?:you|we)\s+(?:customize|customise|print|deliver|ship))\b/i.test(
      lower
    ) ||
      ACRIO_SHORT_CITY_OR_REPLY_RE.test(lower) ||
      /^\s*\d{1,3}\s*(?:pcs?|pieces?|nos?|units?|sets?)?\s*$/i.test(trimmed))
  ) {
    return {
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer sent a short confirmation, quantity, city, or follow-up reply in the active conversation",
    };
  }

  // 20. Preserve context on any other conversational turn instead of wiping convState!
  return {
    intent: hasConversationHistory ? "CONVERSATIONAL_FOLLOWUP" : "GREETING",
    requiresProductLookup: false,
    allowRollingContextFallback: hasConversationHistory,
    needsImmediateHandoff: false,
    reason: "Conversational follow-up or general turn; preserving conversation memory without dumping unrelated products",
  };
}

/**
 * Phase B: Structured Per-Conversation State Object (`AcrioConversationState`).
 */
export interface AcrioConversationState {
  activeBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | "BOTH" | null;
  activeCategory: string | null;
  productFamily: string | null;
  primaryProductQuery: string | null;
  itemTypeFilter: "PRODUCT" | "MACHINE" | "CONSUMABLE" | null;
  excludedItemTypes: ("PRODUCT" | "MACHINE" | "CONSUMABLE")[];
  minPrice: number | null;
  maxPrice: number | null;
  hidePrices?: boolean;
  preferCheapest?: boolean;
  preferences: string[];
  applicationContext: string | null;
  dimensionsOrThickness: string | null;
  quantity: string | null;
  shownProductSlugs?: string[];
  lastMenuOptions?: string[];
  /** Slug of the single product the customer is currently talking about ("this model", "it", "the white one"). */
  focusProductSlug?: string | null;
  /** Slugs shown in the last "View options" list, in order, so "the second one" still works after it. */
  lastListedSlugs?: string[];
  askedQuestionsLog?: string[];
  customerProfile?: string;
  languageMode?: string;
  lastRecommendedProducts: {
    id: string;
    name: string;
    slug: string;
    priceInr: number | null;
    shortUrl: string | null;
    itemType?: "PRODUCT" | "MACHINE" | "CONSUMABLE";
  }[];
  /** Chronological history of distinct products/topics discussed earlier in this chat (prevents A->B->C leaks while keeping comparison context). */
  productHistory?: {
    label: string;
    slug?: string | null;
    family?: string | null;
    turnNumber: number;
  }[];
  /** Most recent image-understanding summary from an uploaded customer photo in this conversation (scoped strictly to this chat). */
  lastImageAnalysis?: CustomerImageAnalysis | null;
  /** Per-conversation cache of already-analyzed images keyed by SHA-256 to prevent duplicate Vision calls. */
  analyzedImagesBySha?: Record<string, CustomerImageAnalysis>;
  /** Rolling 1-hour counter for Vision analysis rate limiting inside this conversation. */
  imageAnalysisCountWindow?: {
    windowStartIso: string;
    count: number;
  };
  switchedThisTurn?: boolean;
  turnCount: number;
  updatedAt: string;
}

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

function detectProductFamilyAndQuery(rawText: string): {
  productFamily: string | null;
  primaryProductQuery: string | null;
  activeCategory: string | null;
  activeBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | null;
  itemTypeFilter: "PRODUCT" | "MACHINE" | "CONSUMABLE" | null;
  excludedItemTypes: ("PRODUCT" | "MACHINE" | "CONSUMABLE")[];
  isCorrectionOnly: boolean;
} {
  const cleanedRaw = normalizeCustomerProductTypos(
    stripBurstMediaPlaceholders(rawText).cleanText || String(rawText || "")
  ).trim();
  const lower = cleanedRaw.toLowerCase();

  const excludesConsumables =
    /\b(?:not\s+looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|exclude|excluding|skip)\s+(?:any\s+)?(?:tools?|consumables?|blades?|cutters?|solvents?|accessories)\b|\b(?:just|only)\s+machines?\b/i.test(
      lower
    );
  const excludesMachines =
    /\b(?:not\s+looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|exclude)\s+(?:any\s+)?machines?\b|\b(?:just|only)\s+(?:tools?|consumables?|blades?|cutters?)\b/i.test(
      lower
    );

  const strippedForCheck = lower
    .replace(
      /\b(actually|i\s+said|i\s+am|i'm|im|we\s+are|not\s+looking\s+for|looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|just|only|tools?|consumables?|machines?|please|show\s+me|need|want)\b/gi,
      " "
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const isCorrectionOnly =
    (excludesConsumables || excludesMachines) && strippedForCheck.length === 0;

  // Furniture / Interiors / Chairs / Tables / Stools ("furniture and interiora", "they sit, do your hand Acrylic chair")
  if (
    /\b(furniture|interior|interiors|interiora|decor|furnishing|chair|chairs|stool|stools|bar\s*stool|table|tables|desk|desks|console|bench|seating|they\s+sit|for\s+sitting)\b/i.test(
      lower
    ) &&
    !/\b(table\s*top\s*podium|table\s*stand|tent\s*card)\b/i.test(lower)
  ) {
    const wantsChairSpecifically = /\b(chair|chairs|stool|stools|seating|sit|sitting)\b/i.test(lower);
    return {
      productFamily: "furniture",
      primaryProductQuery: wantsChairSpecifically
        ? "acrylic chair bar stool furniture seating"
        : "acrylic furniture table chair stool console interior",
      activeCategory: "Custom Fabrication",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  // Signage / Name plates / Name boards
  if (
    /\b(signage|signages|name\s*plate|name\s*plates|nameplate|nameplates|name\s*board|door\s*sign|directional\s*sign)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "signage",
      primaryProductQuery: `${rawText.trim()} acrylic signage name plate sign holder`,
      activeCategory: "Custom Fabrication",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  // Corporate Gifts / Souvenirs / Paperweights / Pen Stands / Keychains
  if (
    /\b(gift|gifts|gifting|corporate\s*gift|corporate\s*clients?|souvenir|souvenirs|paper\s*weight|paperweight|pen\s*stand|keychain|keychains)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "corporate_gift",
      primaryProductQuery: `${rawText.trim()} acrylic memento trophy paperweight pen stand keychain coaster tray`,
      activeCategory: "Awards & Trophies",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  // Podiums / Pulpits / Lecterns / Classroom Podium
  if (
    /\b(pulpit|pulpits|podium|podiums|lectern|lecterns|rostrum|rostrums|ccpo?[-_\s]?\d{2,4}|small\s+classroom|classroom|auditorium|church)\b/i.test(
      lower
    )
  ) {
    const isClassroom = /\b(classroom|school|teacher|compact)\b/i.test(lower);
    return {
      productFamily: "podium",
      primaryProductQuery: isClassroom
        ? "compact essential acrylic podium CCP057S CCP054 classroom"
        : `${rawText.trim()} pulpit podium`,
      activeCategory: "Podiums & Stage",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (/\b(trophy|trophies|memento|mementos|award|awards|plaque|plaques|medal|medals)\b/i.test(lower)) {
    return {
      productFamily: "trophy",
      primaryProductQuery: `${rawText.trim()} acrylic trophy award memento`,
      activeCategory: "Awards & Trophies",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (
    /\b(diamond\s*(?:edge\s*)?polish(?:er|ing)?|edge\s*polish(?:er|ing)?|cloudy\s*edge|rough\s*edge|white\s*edge)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "polishing_machine",
      primaryProductQuery: `${rawText.trim()} diamond edge polishing machine`,
      activeCategory: "Acrylic Machines (CE53)",
      activeBrand: "CLASSIC_EDGE_53",
      itemTypeFilter: excludesMachines ? "CONSUMABLE" : "MACHINE",
      excludedItemTypes: excludesConsumables ? ["CONSUMABLE"] : [],
      isCorrectionOnly: false,
    };
  }

  if (/\b(bender|bending\s*(?:machine|heater)?|strip\s*heater|line\s*bending)\b/i.test(lower)) {
    return {
      productFamily: "bending_machine",
      primaryProductQuery: `${rawText.trim()} acrylic bending machine heater`,
      activeCategory: "Acrylic Machines (CE53)",
      activeBrand: "CLASSIC_EDGE_53",
      itemTypeFilter: excludesMachines ? "CONSUMABLE" : "MACHINE",
      excludedItemTypes: excludesConsumables ? ["CONSUMABLE"] : [],
      isCorrectionOnly: false,
    };
  }

  if (
    !excludesConsumables &&
    !/\b(machine|machines)\b/i.test(lower) &&
    /\b(blade|blades|cutter|cutters|router\s*bit|router\s*bits|carbide|collet|collect|consumable|consumables|solvent|chloroform|glue|adhesive|buffing|accessor(?:y|ies)|add[-\s]?ons?|hinge|hinges|camlock|camlocks|standoff|standoffs|spacer|spacers|knob|knobs|handle|handles|latch|latches|catch|catches|hasp|staple|screw|screws|bolt|nut|washer|bracket|brackets|ball|balls|sphere|turntable|rotating\s*disc|photo\s*magnet|radeon|glitter\s*sheet|mirror\s*sheet|metallic\s*sheet)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "consumable",
      primaryProductQuery: rawText.trim(),
      activeCategory: "Acrylic Machines (CE53)",
      activeBrand: "CLASSIC_EDGE_53",
      itemTypeFilter: "CONSUMABLE",
      excludedItemTypes: excludesMachines ? ["MACHINE"] : [],
      isCorrectionOnly: false,
    };
  }

  if (
    /\b(machine|machines|laser|router|cnc|polisher|polishing|thermoforming|oven|chiller|compressor|yn-|ce53|cw[-_\s]?\d{3,5}|f[-_\s]?(?:308|500)|sd[-_\s]?\d{3,4}|jw[-_\s]?\d{3,4}|zd[-_\s]?\d{3,4}|classic\s*edge)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "machine",
      primaryProductQuery: isCorrectionOnly ? null : rawText.trim(),
      activeCategory: "Acrylic Machines (CE53)",
      activeBrand: "CLASSIC_EDGE_53",
      itemTypeFilter: excludesMachines ? "CONSUMABLE" : "MACHINE",
      excludedItemTypes: excludesConsumables ? ["CONSUMABLE"] : [],
      isCorrectionOnly,
    };
  }

  if (/\b(menu|qr\s*stand|tent\s*card|table\s*stand|sign\s*holder|brochure|leaflet|pamphlet)\b/i.test(lower)) {
    return {
      productFamily: "stand",
      primaryProductQuery: rawText.trim(),
      activeCategory: "Hotel & Banquet",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (/\b(tray|trays|coaster|coasters|tissue|napkin)\b/i.test(lower)) {
    return {
      productFamily: "tray_hospitality",
      primaryProductQuery: rawText.trim(),
      activeCategory: "Hotel & Banquet",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (
    /\b(box|boxes|case|cases|cover|covers|enclosure|enclosures|guard|guards|display\s*stand|riser|risers|cabinet|cabinets|locker|lockers|mobile\s*locker|phone\s*locker|cell\s*phone|mobile|mobiles|phone|phones|tablet|tablets|compartment|compartments|pigeon\s*hole|organizer|organiser|rack|racks|shelf|shelves|caddy|counter|counters|partition|partitions|shield|shields|sneeze\s*guard|key\s*box|key\s*cabinet|medicine\s*box|first\s*aid\s*box|showcase|frame|frames|sheet|rod|tube|donation|suggestion\s*box|ballot|cake\s*stand|cosmetic|makeup|jewelry|jewellery|watch\s*stand|eyewear|mobile\s*stand|laptop\s*stand|book\s*stand|quran|rehal|bible)\b/i.test(
      lower
    )
  ) {
    const nounMatch = lower.match(ACRIO_DOMAIN_PRODUCT_NOUN_RE);
    return {
      productFamily: nounMatch ? nounMatch[1].toLowerCase() : "custom_display",
      primaryProductQuery: cleanedRaw || rawText.trim(),
      activeCategory: "Custom Fabrication",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  return {
    productFamily: null,
    primaryProductQuery: null,
    activeCategory: null,
    activeBrand: null,
    itemTypeFilter: excludesConsumables ? "MACHINE" : excludesMachines ? "CONSUMABLE" : null,
    excludedItemTypes: excludesConsumables
      ? ["CONSUMABLE"]
      : excludesMachines
      ? ["MACHINE"]
      : [],
    isCorrectionOnly,
  };
}

function extractPreferencesFromTurn(rawText: string): string[] {
  const lower = String(rawText || "").toLowerCase();
  const prefs: string[] = [];
  if (/\b(most\s*premium|premium|high\s*end|flagship|top\s*end|best|luxury|heavy\s*duty|costliest|most\s*expensive)\b/i.test(lower)) {
    prefs.push("premium");
  }
  if (/\b(cheapest|lowest\s*price|least\s*expensive|cheaper|smaller\s*top|save\s*more|sasta|sabse\s*sasta)\b/i.test(lower)) {
    prefs.push("cheapest");
  }
  if (/\b(transparent|clear|crystal\s*clear|see\s*through)\b/i.test(lower)) {
    prefs.push("transparent");
  }
  if (/\b(frosted|matte|satin)\b/i.test(lower)) {
    prefs.push("frosted");
  }
  if (/\b(black|white|gold|silver|colored|coloured|tinted)\b/i.test(lower)) {
    const m = lower.match(/\b(black|white|gold|silver|colored|coloured|tinted)\b/i);
    if (m) prefs.push(m[1].toLowerCase());
  }
  if (/\b(led|light|backlit|illuminated)\b/i.test(lower)) {
    prefs.push("led");
  }
  if (/\b(logo|branding|print|engraving|uv\s*print)\b/i.test(lower)) {
    prefs.push("logo");
  }
  if (/\b(wheel|wheeled|castor|portable|foldable|compact|wide|tall)\b/i.test(lower)) {
    const m = lower.match(/\b(wheel|wheeled|castor|portable|foldable|compact|wide|tall)\b/i);
    if (m) prefs.push(m[1].toLowerCase());
  }
  return prefs;
}

function extractMetadataFromTurn(rawText: string): {
  applicationContext: string | null;
  dimensionsOrThickness: string | null;
  quantity: string | null;
} {
  const lower = String(rawText || "").toLowerCase();
  const appMatch = lower.match(
    /\b(church|school|classroom|college|university|auditorium|conference|seminar|hotel|restaurant|cafe|banquet|hospital|clinic|retail|showroom|exhibition|event|ceremony|convocation|wedding|office|reception)\b/i
  );
  const dimMatch =
    rawText.match(
      /\b(\d+\s*(?:mm|cm|inch|in|ft)?\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?(?:\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?)?)\b/i
    ) || rawText.match(/\b(\d+(?:\.\d+)?\s*(?:mm|cm|inch|in|ft))\b/i);
  const qtyMatch = rawText.match(/\b(\d+\s*(?:pcs|pieces|nos|units|sets|qty))\b/i);

  return {
    applicationContext: appMatch ? appMatch[1].toLowerCase() : null,
    dimensionsOrThickness: dimMatch ? dimMatch[1].trim() : null,
    quantity: qtyMatch ? qtyMatch[1].trim() : null,
  };
}

const ACRIO_COLOUR_WORDS = [
  "black", "white", "clear", "transparent", "gold", "golden", "silver", "blue", "yellow",
  "red", "green", "grey", "gray", "orange", "pink", "frost", "frosted", "wood", "wooden", "brown",
];

function normalizeColourToken(word: string): string {
  const w = word.toLowerCase().trim();
  if (w === "frost" || w === "frosted") return "frosted";
  if (w === "golden" || w === "gold") return "gold";
  if (w === "transparent" || w === "clear") return "clear";
  if (w === "wooden" || w === "wood") return "wood";
  if (w === "gray" || w === "grey") return "grey";
  return w;
}

/**
 * Extracts normalized colour/finish tokens from any text ("frost white" -> ["frosted", "white"],
 * "White Frosted" -> ["white", "frosted"]) so variant matching is 100% word-order independent!
 */
export function extractNormalizedColourTokens(text: string): string[] {
  const lower = String(text || "").toLowerCase();
  const found: string[] = [];
  for (const cw of ACRIO_COLOUR_WORDS) {
    if (new RegExp(`\\b${cw}\\b`, "i").test(lower)) {
      const norm = normalizeColourToken(cw);
      if (!found.includes(norm)) found.push(norm);
    }
  }
  return found;
}

/**
 * Word-order-independent variant matcher:
 * - For "frost white" / "frosted white" (tokens=["frosted","white"]), matches ONLY variants
 *   that contain BOTH "white" and "frosted" (e.g. "White Frosted"), and NEVER matches plain "White"!
 * - For single-token "black" (tokens=["black"]), prefers exact single-token variant "Black" over "Black Clear" / "Black Frosted".
 */
export function matchProductVariantsByColourTokens(
  variants: { id?: string; name: string; price: number | null; imageUrl?: string | null }[],
  queryText: string
): { id?: string; name: string; price: number | null; imageUrl?: string | null }[] {
  const queryTokens = extractNormalizedColourTokens(queryText);
  if (queryTokens.length === 0 || !variants || variants.length === 0) return [];

  // 1. Variants that contain EVERY requested colour/finish token (word-order independent!)
  const fullMatches = variants.filter((v) => {
    const vTokens = extractNormalizedColourTokens(v.name);
    return queryTokens.every((qt) => vTokens.includes(qt));
  });

  if (fullMatches.length === 0) return [];

  // 2. Prefer exact token-set match (e.g. if user asked for ["black"], prefer "Black" ["black"] over "Black Frosted" ["black","frosted"])
  const exactTokenCountMatches = fullMatches.filter(
    (v) => extractNormalizedColourTokens(v.name).length === queryTokens.length
  );
  return exactTokenCountMatches.length > 0 ? exactTokenCountMatches : fullMatches;
}

/**
 * Finds all products in the catalog (optionally filtered by family like "podium") that have a variant
 * matching ALL colour/finish tokens in `rawText` (e.g. "podiums with frost white color" -> CCP053, CCP060, CCP055).
 */
export function findCatalogProductsByVariantTokens(
  allItems: MainWebsiteProduct[],
  rawText: string,
  productFamily?: string | null,
  activeProductQuery?: string | null
): { item: MainWebsiteProduct; matchedVariant: { name: string; price: number | null; imageUrl?: string | null } }[] {
  const queryTokens = extractNormalizedColourTokens(rawText);
  if (queryTokens.length === 0) return [];
  const lower = normalizeCustomerProductTypos(rawText).toLowerCase();
  const wantsPodium =
    productFamily === "podium" ||
    /\b(podiums?|pulpits?|lecterns?|rostrums?)\b/i.test(lower);
  const coreNouns = extractCustomerCoreNouns(
    `${activeProductQuery || ""} ${rawText}`
  );

  // Never scan the open catalog for random colour variants when the customer hasn't named a product family or core product noun!
  if (!wantsPodium && coreNouns.length === 0) {
    return [];
  }

  const results: {
    item: MainWebsiteProduct;
    matchedVariant: { name: string; price: number | null; imageUrl?: string | null };
    nounHits: number;
  }[] = [];

  for (const it of allItems) {
    if (it.brand !== "CLASSIC_CONCEPTS" || it.itemType !== "PRODUCT") continue;
    if (
      wantsPodium &&
      !/podium|pulpit|lectern/i.test(`${it.name} ${it.categoryName || ""}`)
    ) {
      continue;
    }
    const nounHits = coreNouns.length > 0 ? countCoreNounMatches(it, coreNouns) : 0;
    if (!wantsPodium && coreNouns.length > 0 && nounHits === 0) {
      continue;
    }
    const matchedVars = matchProductVariantsByColourTokens(it.variants || [], rawText);
    if (matchedVars.length > 0) {
      results.push({ item: it, matchedVariant: matchedVars[0], nounHits });
    }
  }
  return results
    .sort((a, b) => {
      if (b.nounHits !== a.nounHits) return b.nounHits - a.nounHits;
      return (a.item.basePrice || 999999) - (b.item.basePrice || 999999);
    })
    .map(({ item, matchedVariant }) => ({ item, matchedVariant }));
}

/** True when the customer refers to multiple products from the previous reply ("all three", "both", "these three", "all of them"). */
export function isMultiProductReference(rawText: string): boolean {
  return /\b(all\s+(?:three|two|four|five|\d+|of\s+them)|both(?:\s+of\s+them)?|(?:these|those|the)\s+(?:two|three|four|five|\d+)|each\s+of\s+them|their\s+(?:imag[a-z]*|phot[a-z]*|pics?|pictures?))\b/i.test(
    String(rawText || "")
  );
}

/** Resolves all products whose `ccapl.cc` shortlinks appeared in an outbound message, in order. */
export function resolveProductsFromOutboundText(
  outboundText: string,
  allItems: MainWebsiteProduct[]
): MainWebsiteProduct[] {
  if (!outboundText) return [];
  const links = Array.from(
    outboundText.matchAll(/https?:\/\/ccapl\.cc\/[^\s)*>,]+/gi)
  ).map((m) => m[0].replace(/[.,;!?]+$/, ""));
  const seen = new Set<string>();
  const resolved: MainWebsiteProduct[] = [];
  for (const link of links) {
    if (seen.has(link)) continue;
    seen.add(link);
    const found = allItems.find(
      (it) => (it.shortUrl || "").replace(/[.,;!?]+$/, "") === link
    );
    if (found) resolved.push(found);
  }
  return resolved;
}

/** "how many products have a black variant?" style questions need a catalogue-wide count, not a single product. */
export function isCatalogAggregateQuestion(rawText: string): boolean {
  return /\b(how\s+many|number\s+of|count\s+of|total\s+(?:number|products|models)|kitne|kitni|list\s+all|all\s+the\s+products|all\s+products)\b/i.test(
    rawText
  );
}

/** True when the customer is asking for product or variant photos/images/pictures (including common typos like "imagea", "imags", "phto"). */
export function isProductImageRequest(rawText: string): boolean {
  return /\b(imag[a-z]*|phot[a-z]*|phto[a-z]*|pics?|pictures?|snaps?|visuals?|videos?|dikha[a-z]*|photo\s*bhejo|bhejo\s*photo|how\s+does\s+(?:it|this|that)\s+look|look\s+like|close[-\s]*up)\b/i.test(
    String(rawText || "")
  );
}

export function isCatalogPdfRequest(rawText: string): boolean {
  const text = String(rawText || "").trim();
  const lower = text.toLowerCase();
  if (!/\b(pdf|brochures?|catalogues?|catalogs?)\b/i.test(lower)) {
    return false;
  }
  // Never fire official brochure PDFs when customer uploaded a document or asks for a quote on THEIR PDF
  if (/^\s*\[(?:document|pdf|file)\b/i.test(text)) {
    return false;
  }
  if (
    /\b(?:i\s+(?:gave|sent|shared|attached)|attached|uploaded|my|that|this|ok+a)\s+pdf\b|\bpdf\s+(?:ki\s+)?(?:quotation|quote|price|cost|rate|estimate)\b/i.test(
      lower
    ) &&
    !/\b(?:your|company|product|podium|machine|classic\s*concepts|official)\s+(?:pdf|brochure|catalogue|catalog)\b/i.test(
      lower
    )
  ) {
    return false;
  }
  return true;
}

export interface AcrioMediaAttachment {
  mediaType?: "IMAGE" | "VIDEO" | "DOCUMENT";
  imageUrl: string;
  caption: string;
  fileName?: string | null;
  mimeType?: string | null;
  productName: string;
  productSlug: string;
  variantName?: string | null;
}

/**
 * Resolves official PDF brochures / catalogues (or a single product's PDF spec sheet) from the
 * ecosystem catalog when a customer asks for a PDF, brochure, catalogue, or spec sheet.
 */
export function resolveCatalogPdfAttachments(
  allItems: MainWebsiteProduct[],
  rawText: string,
  focusItem?: MainWebsiteProduct | null
): { attachments: AcrioMediaAttachment[]; replyText: string } | null {
  if (!isCatalogPdfRequest(rawText)) return null;
  const lower = String(rawText || "").toLowerCase();
  const appOrigin = resolveWhatsAppWebAppOrigin();

  // If the customer is asking for the PDF / brochure of a specific focus product
  if (
    focusItem &&
    /\b(this|it|its|model|podium|machine|spec\s*sheet|datasheet|ccpo?\d{2,4})\b/i.test(lower)
  ) {
    const cleanName = cleanDisplayProductName(focusItem.name);
    const link = focusItem.shortUrl || focusItem.url;
    const prodRes = (focusItem.resources || []).find(
      (r) => r.url && /^https?:\/\//i.test(r.url)
    );
    const pdfUrl =
      prodRes?.url ||
      `${appOrigin}/api/media/pdf_spec_${encodeURIComponent(focusItem.slug)}`;
    const safeFile = `${focusItem.slug || "product"}-spec-sheet.pdf`;
    return {
      attachments: [
        {
          mediaType: "DOCUMENT",
          imageUrl: pdfUrl,
          caption: `*${cleanName}* - Official Specification Sheet (PDF)\n${link}`,
          fileName: safeFile,
          mimeType: "application/pdf",
          productName: cleanName,
          productSlug: focusItem.slug,
          variantName: null,
        },
      ],
      replyText: `Here is the *PDF Specification Sheet* for *${cleanName}*.\n• *Product page:* ${link}`,
    };
  }

  const seenUrls = new Set<string>();
  const allResources: { name: string; url: string }[] = [];

  for (const it of allItems) {
    const itemResList = [
      ...(it.resources || []),
      ...(it.models || []).flatMap((m) => m.resources || []),
    ];
    for (const r of itemResList) {
      const name = String(r.title || r.name || "").trim();
      const url = String(r.url || "").trim();
      if (!name || !url || !/^https?:\/\//i.test(url) || seenUrls.has(url)) continue;
      seenUrls.add(url);
      allResources.push({ name, url });
    }
  }

  // Always include the built-in live-generated PDF catalogues so PDF requests never fail when DB Resource table is empty
  const builtinCatalogues = [
    {
      name: "Classic Concepts - Acrylic Podiums & Pulpits Catalogue",
      url: `${appOrigin}/api/media/pdf_podium_catalogue`,
    },
    {
      name: "Classic Concepts - Acrylic Furniture, Chairs & Tables Catalogue",
      url: `${appOrigin}/api/media/pdf_furniture_catalogue`,
    },
    {
      name: "Classic Concepts - Acrylic Trophies, Mementos & Corporate Gifts Catalogue",
      url: `${appOrigin}/api/media/pdf_memento_catalogue`,
    },
    {
      name: "Classic Edge 53 - Industrial Acrylic Machines & Tools Catalogue",
      url: `${appOrigin}/api/media/pdf_machines_catalogue`,
    },
    {
      name: "Classic Concepts - Complete Product & Display Catalogue",
      url: `${appOrigin}/api/media/pdf_full_catalogue`,
    },
  ];
  for (const b of builtinCatalogues) {
    if (!seenUrls.has(b.url)) {
      seenUrls.add(b.url);
      allResources.push(b);
    }
  }

  const matched = allResources.filter((r) => {
    const rn = r.name.toLowerCase();
    if (/podium|pulpit|lectern/.test(lower) && /podium/.test(rn)) return true;
    if (/furniture|chair|table|stool/.test(lower) && /furniture/.test(rn)) return true;
    if (/trophy|trophies|memento|award|gift/.test(lower) && /memento|award|trophy/.test(rn)) return true;
    if (/machine|polisher|bender|ce53/.test(lower) && /machine|edge|polish|bend/.test(rn)) return true;
    return false;
  });

  const chosen = (matched.length > 0 ? matched : [builtinCatalogues[4], builtinCatalogues[0]]).slice(0, 3);
  const attachments: AcrioMediaAttachment[] = chosen.map((r) => {
    const safeName = r.name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    const fileName = /\.pdf$/i.test(safeName) ? safeName : `${safeName || "Catalogue"}.pdf`;
    return {
      mediaType: "DOCUMENT",
      imageUrl: r.url,
      caption: `*${r.name}* (PDF)`,
      fileName,
      mimeType: "application/pdf",
      productName: r.name,
      productSlug: safeName.toLowerCase(),
      variantName: null,
    };
  });

  const listLines = chosen.map((r) => `• *${r.name}*`).join("\n");
  return {
    attachments,
    replyText: `Here ${attachments.length === 1 ? "is our official PDF catalogue" : "are our official PDF catalogues"}:\n${listLines}\n\nLet me know if you would like details, photos, or pricing for any specific model inside!`,
  };
}

/**
 * Resolves the exact product or variant R2 image URLs (or product video) + WhatsApp captions
 * when a customer asks for images/videos of a product or a photo of a specific colour/variant.
 */
export function resolveProductMediaAttachments(
  item: MainWebsiteProduct,
  rawText: string,
  hidePrices = false
): { attachments: AcrioMediaAttachment[]; replyText: string; matchedVariant: boolean } {
  const name = cleanDisplayProductName(item.name);
  const link = item.shortUrl || item.url;
  const basePriceStr =
    !hidePrices && typeof item.basePrice === "number" && item.basePrice > 0
      ? `₹${item.basePrice.toLocaleString("en-IN")}`
      : "";
  const variants = item.variants || [];
  const galleryUrls = Array.from(
    new Set(
      [item.mainImage, ...(item.images || [])]
        .map((u) => String(u || "").trim())
        .filter((u) => /^https?:\/\//i.test(u))
    )
  );

  const lower = String(rawText || "").toLowerCase();

  // Case 0: Customer asked specifically for a video of this product
  if (/\bvideos?\b/i.test(lower) && !/\b(images?|photos?|pics?|pictures?)\b/i.test(lower)) {
    const vidUrl = String(item.videoUrl || "").trim();
    if (vidUrl && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(vidUrl)) {
      return {
        attachments: [
          {
            mediaType: "VIDEO",
            imageUrl: vidUrl,
            caption: `*${name}* - Product Video${basePriceStr ? ` (${basePriceStr})` : ""}\n${link}`,
            fileName: `${item.slug || "product"}.mp4`,
            mimeType: "video/mp4",
            productName: name,
            productSlug: item.slug,
            variantName: null,
          },
        ],
        replyText: `Here is the video of *${name}*${basePriceStr ? ` (*${basePriceStr}*)` : ""}.\n• *Product page:* ${link}`,
        matchedVariant: false,
      };
    }
    if (vidUrl && /^https?:\/\//i.test(vidUrl)) {
      const previewAttachments: AcrioMediaAttachment[] = galleryUrls[0]
        ? [
            {
              mediaType: "IMAGE",
              imageUrl: galleryUrls[0],
              caption: `*${name}*${basePriceStr ? ` (${basePriceStr})` : ""}\nVideo: ${vidUrl}\n${link}`,
              productName: name,
              productSlug: item.slug,
              variantName: null,
            },
          ]
        : [];
      return {
        attachments: previewAttachments,
        replyText: `Here is the video link and photo for *${name}*${basePriceStr ? ` (*${basePriceStr}*)` : ""}:\n• *Watch video:* ${vidUrl}\n• *Product page:* ${link}`,
        matchedVariant: false,
      };
    }
  }
  const queryColourTokens = extractNormalizedColourTokens(rawText);
  const matchedVariants = matchProductVariantsByColourTokens(variants, rawText);
  const requestedColourLabel = queryColourTokens.join(" ");

  // Case 1: Customer asked for a specific variant/colour that exists on this product
  if (matchedVariants.length > 0) {
    const attachments: AcrioMediaAttachment[] = [];
    const seenKeys = new Set<string>();
    for (const v of matchedVariants.slice(0, 4)) {
      const imgUrl =
        (v.imageUrl && /^https?:\/\//i.test(v.imageUrl)
          ? v.imageUrl.trim()
          : galleryUrls[0]) || "";
      if (!imgUrl) continue;
      const key = `${imgUrl}#${v.name.toLowerCase()}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const effPrice = !hidePrices
        ? typeof v.price === "number" && v.price > 0
          ? v.price
          : item.basePrice
        : null;
      const pricePart =
        typeof effPrice === "number" && effPrice > 0
          ? ` (₹${effPrice.toLocaleString("en-IN")})`
          : "";
      attachments.push({
        mediaType: "IMAGE",
        imageUrl: imgUrl,
        caption: `*${name}* - *${v.name}* variant${pricePart}\n${link}`,
        productName: name,
        productSlug: item.slug,
        variantName: v.name,
      });
    }

    const allVarNames = variants.map((v) => v.name).join(", ");
    const firstV = matchedVariants[0];
    const firstPrice = !hidePrices
      ? typeof firstV.price === "number" && firstV.price > 0
        ? firstV.price
        : item.basePrice
      : null;
    const priceNote =
      typeof firstPrice === "number" && firstPrice > 0
        ? ` (*₹${firstPrice.toLocaleString("en-IN")}*)`
        : "";
    const replyText =
      matchedVariants.length === 1
        ? `Here is the photo of *${name}* in the *${firstV.name}* variant${priceNote}.\n• *All available variants:* ${allVarNames}\n• *Product page:* ${link}`
        : `Here are the photos of the ${matchedVariants
            .map((v) => `*${v.name}*`)
            .join(", ")} variants of *${name}*.\n• *All available variants:* ${allVarNames}\n• *Product page:* ${link}`;

    return { attachments, replyText, matchedVariant: true };
  }

  // Case 2: Customer asked for a colour/finish combination (e.g. "frost white") that is NOT listed on this product
  if (queryColourTokens.length > 0) {
    const attachments: AcrioMediaAttachment[] = galleryUrls[0]
      ? [
          {
            mediaType: "IMAGE",
            imageUrl: galleryUrls[0],
            caption: `*${name}*${basePriceStr ? ` (${basePriceStr})` : ""}\n${link}`,
            productName: name,
            productSlug: item.slug,
            variantName: null,
          },
        ]
      : [];
    const availLine =
      variants.length > 0
        ? `Available variants for *${name}* are: *${variants.map((v) => v.name).join(", ")}*.`
        : `*${name}* comes in one standard finish.`;
    return {
      attachments,
      replyText: `*${name}* does not come in *${requestedColourLabel}*. ${availLine}\n\nI have shared the standard product photo here, and our Sales Team can also check custom colour fabrication if needed.\n${link}`,
      matchedVariant: false,
    };
  }

  // Case 3: General product images request ("send me its images", "show photos of CCP054")
  const attachments: AcrioMediaAttachment[] = [];
  const usedUrls = new Set<string>();

  if (galleryUrls[0]) {
    usedUrls.add(galleryUrls[0]);
    attachments.push({
      imageUrl: galleryUrls[0],
      caption: `*${name}*${basePriceStr ? ` (${basePriceStr})` : ""}\n${link}`,
      productName: name,
      productSlug: item.slug,
      variantName: null,
    });
  }

  // Include distinct variant photos with their variant labels
  for (const v of variants) {
    if (attachments.length >= 4) break;
    const vUrl = String(v.imageUrl || "").trim();
    if (!vUrl || !/^https?:\/\//i.test(vUrl) || usedUrls.has(vUrl)) continue;
    usedUrls.add(vUrl);
    const vPrice = !hidePrices
      ? typeof v.price === "number" && v.price > 0
        ? v.price
        : item.basePrice
      : null;
    const vPricePart =
      typeof vPrice === "number" && vPrice > 0
        ? ` (₹${vPrice.toLocaleString("en-IN")})`
        : "";
    attachments.push({
      imageUrl: vUrl,
      caption: `*${name}* - *${v.name}* variant${vPricePart}\n${link}`,
      productName: name,
      productSlug: item.slug,
      variantName: v.name,
    });
  }

  // Fill remaining slots (up to 4 total) from gallery images
  for (const gUrl of galleryUrls.slice(1)) {
    if (attachments.length >= 4) break;
    if (usedUrls.has(gUrl)) continue;
    usedUrls.add(gUrl);
    attachments.push({
      imageUrl: gUrl,
      caption: `*${name}* (Photo ${attachments.length + 1})\n${link}`,
      productName: name,
      productSlug: item.slug,
      variantName: null,
    });
  }

  const allVarNames = variants.map((v) => v.name).join(", ");
  const replyText =
    variants.length > 0
      ? `Here ${attachments.length === 1 ? "is the photo" : `are the photos`} of *${name}*${basePriceStr ? ` (*${basePriceStr}*)` : ""}.\n• *Available variants:* ${allVarNames}\n• *Product page:* ${link}\n\nTell me if you want a photo of a specific variant (such as *${variants[0].name}*)!`
      : `Here ${attachments.length === 1 ? "is the photo" : `are the photos`} of *${name}*${basePriceStr ? ` (*${basePriceStr}*)` : ""}.\n• *Product page:* ${link}`;

  return { attachments, replyText, matchedVariant: false };
}

/**
 * Builds media attachments for a list of multiple products (e.g. when the customer says
 * "Please share images of all three" or "Can you share images of podiums with frost white color?").
 */
export function resolveMultiProductMediaAttachments(
  items: MainWebsiteProduct[],
  colourContextText: string,
  hidePrices = false
): { attachments: AcrioMediaAttachment[]; replyText: string } {
  const attachments: AcrioMediaAttachment[] = [];
  const lineSummaries: string[] = [];

  for (const it of items.slice(0, 4)) {
    const cleanName = cleanDisplayProductName(it.name);
    const link = it.shortUrl || it.url;
    const matchedVars = matchProductVariantsByColourTokens(
      it.variants || [],
      colourContextText
    );
    const chosenVar = matchedVars[0] || null;
    const effPrice = !hidePrices
      ? chosenVar && typeof chosenVar.price === "number" && chosenVar.price > 0
        ? chosenVar.price
        : it.basePrice
      : null;
    const priceTag =
      typeof effPrice === "number" && effPrice > 0
        ? ` (₹${effPrice.toLocaleString("en-IN")})`
        : "";
    const imgUrl =
      (chosenVar?.imageUrl && /^https?:\/\//i.test(chosenVar.imageUrl)
        ? chosenVar.imageUrl.trim()
        : it.mainImage || it.images?.[0] || "") || "";
    if (!imgUrl) continue;

    const varLabel = chosenVar ? ` - *${chosenVar.name}* variant` : "";
    attachments.push({
      mediaType: "IMAGE",
      imageUrl: imgUrl,
      caption: `*${cleanName}*${varLabel}${priceTag}\n${link}`,
      productName: cleanName,
      productSlug: it.slug,
      variantName: chosenVar?.name || null,
    });
    lineSummaries.push(
      `${attachments.length}. *${cleanName}*${varLabel}${priceTag}\n   ${link}`
    );
  }

  const replyText =
    attachments.length > 0
      ? `Here are the photos for the *${attachments.length} matching models*:\n\n${lineSummaries.join(
          "\n\n"
        )}\n\nLet me know which one you would like to check in detail!`
      : "";

  return { attachments, replyText };
}

/**
 * Does this turn refer back to the SINGLE product we were already discussing?
 * ("in this model", "its warranty", "the white one", "send me its images", "Black please")
 * NEVER returns true when the customer asks for plural/category-wide items ("podiums with frost white",
 * "podiums that have...", "all three", "both").
 */
export function isFocusedProductFollowUp(
  rawText: string,
  focusItem?: MainWebsiteProduct | null,
  hasQuotedFocusProduct = false
): boolean {
  const t = rawText.toLowerCase().trim();
  if (isCatalogAggregateQuestion(t)) return false;
  if (extractExplicitProductOrModelCodes(rawText).length > 0) return false;
  if (isMultiProductReference(t)) return false;

  // Plural product nouns ("podiums with frost white", "I want podiums that have...") ask for a catalog search across models!
  const hasPluralFamilyNoun =
    /\b(podiums|pulpits|lecterns|rostrums|chairs|stools|tables|desks|machines|polishers|benders|trophies|mementos|awards|plaques|signages|signs|nameplates|boxes|cases|covers|stands|holders|risers|models|options|products)\b/i.test(
      t
    );
  const hasExplicitSingularPointer =
    /\b(this\s+(?:model|podium|pulpit|product|one|item|piece|machine)|that\s+(?:model|podium|pulpit|product|one|item|piece|machine)|in\s+this|of\s+this|for\s+this|its)\b/i.test(
      t
    );
  if (hasPluralFamilyNoun && !hasExplicitSingularPointer) {
    return false;
  }

  // If the customer directly swiped/quoted a message for this specific product, keep focus on it unless they asked for cheaper/other options!
  const asksForImages = isProductImageRequest(rawText);
  if (
    !asksForImages &&
    /\b(cheaper|alternative|other\s+options?|more\s+options?|any\s+more|similar|something\s+else|different|another|compare|comparison|suggest|recommend|budget|under\s+(?:rs|inr|₹|\d))\b/i.test(
      t
    )
  ) {
    return false;
  }

  if (hasQuotedFocusProduct) {
    return true;
  }

  // If the user specifies a colour/finish (e.g. "frosted white") alongside a general noun ("podium") without "this/its",
  // and the current focusItem does NOT have that variant, do not stay locked on focusItem!
  const colourTokens = extractNormalizedColourTokens(t);
  const hasAnyFamilyNoun =
    /\b(podiums?|pulpits?|lecterns?|chairs?|stools?|tables?|machines?|trophy|trophies|signages?|boxes|stands?)\b/i.test(
      t
    );
  if (
    focusItem &&
    colourTokens.length > 0 &&
    hasAnyFamilyNoun &&
    !hasExplicitSingularPointer &&
    matchProductVariantsByColourTokens(focusItem.variants || [], t).length === 0
  ) {
    return false;
  }

  // True singular anaphora (NOTE: bare "that" in "podiums that have..." is a relative pronoun, NOT anaphora!)
  const anaphora =
    /\b(this|it|its|same|above|(?:this|that|the)\s+(?:one|model|product|podium|pulpit|item|piece|variant|colou?r)|(?:of|for|about|in|on)\s+that\b|(?:black|white|clear|gold|silver|blue|yellow|red|green|frosted|frost|led)\s+(?:one|variant|colou?r|photo|image|pic|picture))\b/i.test(
      t
    );
  const attribute =
    /\b(variants?|colou?rs?|imag[a-z]*|phot[a-z]*|phto[a-z]*|pics?|pictures?|warranty|price|cost|rate|mrp|how\s*much|kitna|size|dimensions?|height|width|weight|logo|led|delivery|shipping|dispatch|gst|invoice|order|buy|book|material|pillars?|shelf|wheels?|assembly|available|stock|details?|specs?|in\s+(?:black|white|clear|gold|silver|frost|frosted))\b/i.test(
      t
    );
  // Short variant reply (e.g. "Black please", "White", "Black Clear", "White Frosted")
  const isShortVariantReply =
    colourTokens.length > 0 &&
    !hasAnyFamilyNoun &&
    t.split(/\s+/).length <= 5 &&
    (!focusItem ||
      matchProductVariantsByColourTokens(focusItem.variants || [], t).length > 0);

  // Short city, quantity, or yes/no continuation when a single product is already in focus (e.g. "Hyderabad", "2 pieces", "Yes with logo")
  const isShortContextualContinuation =
    Boolean(focusItem) &&
    !hasAnyFamilyNoun &&
    t.split(/\s+/).length <= 7 &&
    (ACRIO_SHORT_CITY_OR_REPLY_RE.test(t) ||
      /^\s*\d{1,3}\s*(?:pcs?|pieces?|nos?|units?|sets?)?\s*$/i.test(t) ||
      /\b(yes|yeah|yep|no|nope|ok|okay|sure|with\s+logo|without\s+logo|no\s+logo|with\s+led|no\s+led|with\s+wheels)\b/i.test(t));

  return (
    anaphora ||
    isShortVariantReply ||
    isShortContextualContinuation ||
    (asksForImages && !hasAnyFamilyNoun) ||
    (attribute && !hasAnyFamilyNoun && t.split(/\s+/).length <= 12)
  );
}

/** Catalogue-wide count for questions like "how many products do you have with black variant?" */
export function buildCatalogAggregateAnswer(
  allItems: MainWebsiteProduct[],
  rawText: string
): { answer: string; items: MainWebsiteProduct[] } | null {
  if (!isCatalogAggregateQuestion(rawText)) return null;
  const lower = rawText.toLowerCase();
  const colour = ACRIO_COLOUR_WORDS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(lower));
  if (!colour) return null;
  const re = new RegExp(`\\b${colour}\\b`, "i");
  const hits = allItems.filter(
    (it) =>
      it.brand === "CLASSIC_CONCEPTS" &&
      it.itemType === "PRODUCT" &&
      ((it.variants || []).some((v) => re.test(v.name || "")) || re.test(it.name || ""))
  );
  if (hits.length === 0) {
    return {
      answer: `I checked our full Classic Concepts catalogue and found no products listed in ${colour}. We can still make custom colours, so I can check that with our Sales Team if you like.`,
      items: [],
    };
  }
  const byCat = new Map<string, number>();
  for (const it of hits) {
    const cat = it.categoryName || "Other";
    byCat.set(cat, (byCat.get(cat) || 0) + 1);
  }
  const catLines = Array.from(byCat.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([c, n]) => `• ${c}: ${n}`);
  const sample = hits.slice(0, 3);
  const sampleLines = sample.map(
    (it) => `• *${cleanDisplayProductName(it.name)}* ${it.shortUrl || it.url}`
  );
  return {
    answer: `*${hits.length} products* in our Classic Concepts catalogue come in *${colour}*:\n${catLines.join("\n")}\n\nA few examples:\n${sampleLines.join("\n")}\n\nTell me which type you want (podium, chair, signage, etc.) and I will narrow it down.`,
    items: sample,
  };
}

/** Short, direct answer about ONE product (variant, warranty, price, size) instead of a full spec dump. */
export function buildFocusedAttributeAnswer(item: MainWebsiteProduct, rawText: string): string | null {
  const t = rawText.toLowerCase();
  const name = cleanDisplayProductName(item.name);
  const link = item.shortUrl || item.url;
  const priceText =
    typeof item.basePrice === "number" && item.basePrice > 0
      ? `₹${item.basePrice.toLocaleString("en-IN")}`
      : "price on request";
  const variants = item.variants || [];
  const colourAsked = ACRIO_COLOUR_WORDS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(t));

  if (/\b(variants?|colou?rs?|finish|available\s+in)\b/i.test(t) || colourAsked) {
    if (variants.length === 0) {
      return `*${name}* is sold in one standard finish. ${link}`;
    }
    const names = variants.map((v) => v.name).join(", ");
    if (colourAsked) {
      const re = new RegExp(`\\b${colourAsked}\\b`, "i");
      const match = variants.filter((v) => re.test(v.name || ""));
      if (match.length > 0) {
        const m = match[0];
        const price =
          typeof m.price === "number" && m.price > 0 ? ` at ₹${m.price.toLocaleString("en-IN")}` : "";
        return `Yes, *${name}* comes in *${match.map((v) => v.name).join(", ")}*${price}.\n\nAll options: ${names}.\n${link}`;
      }
      return `*${name}* is not listed in ${colourAsked}. Available options: ${names}.\n${link}`;
    }
    return `*${name}* is available in: ${names}.\n${link}`;
  }
  if (/\bwarranty\b/i.test(t)) {
    const w = (item.specifications || []).find((s) => /warranty/i.test(s.label || s.key || ""));
    if (w) return `*${name}* comes with a *${w.value}* warranty.\n${link}`;
  }
  if (/\b(price|cost|rate|mrp)\b/i.test(t)) {
    const mrp =
      item.regularPrice && item.basePrice && item.regularPrice > item.basePrice
        ? ` (MRP ₹${item.regularPrice.toLocaleString("en-IN")})`
        : "";
    return `*${name}* is *${priceText}*${mrp}.\n${link}`;
  }
  return null;
}

export const ACRIO_ORDINALS: Record<string, number> = {
  first: 0, "1st": 0, one: 0, second: 1, "2nd": 1, two: 1, third: 2, "3rd": 2, three: 2,
  fourth: 3, "4th": 3, four: 3, fifth: 4, "5th": 4, five: 4, last: -1,
};

/** True when the text looks like picking from a list we sent ("the first one", "option 2", "the cheaper one"). */
export function isListPickText(rawText: string): boolean {
  const t = rawText.toLowerCase().trim();
  if (t.split(/\s+/).length > 10) return false;
  if (extractExplicitProductOrModelCodes(rawText).length > 0) return false;
  if (/\b(first\s*two|top\s*two|both|these\s*two|those\s*two|all\s*of\s*them)\b/.test(t)) return false;
  return (
    /\b(?:the\s+)?(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\s*(?:one|option|model|product|podium|item|choice)?\b/.test(t) ||
    /\b(?:option|number|no\.?|#)\s*[1-5]\b/.test(t) ||
    /\b(?:the\s+)?(cheaper|cheapest|costlier|costliest|pricier|more\s+expensive|bigger|biggest|larger|largest|smaller|smallest|taller|tallest)\s+one\b/.test(t) ||
    /^\s*[1-5][\s.)!]*$/.test(t)
  );
}

/** Resolve which product from the last outbound list the customer means. Uses the order of links we actually sent. */
export function resolveListPickFromLastReply(
  rawText: string,
  lastOutboundBody: string,
  allItems: MainWebsiteProduct[]
): MainWebsiteProduct | null {
  if (!isListPickText(rawText)) return null;
  const links = Array.from(lastOutboundBody.matchAll(/https?:\/\/ccapl\.cc\/[^\s)*>]+/gi)).map((m) =>
    m[0].replace(/[.,;!?]+$/, "")
  );
  const seen = new Set<string>();
  const listed: MainWebsiteProduct[] = [];
  for (const link of links) {
    if (seen.has(link)) continue;
    seen.add(link);
    const item = allItems.find((it) => (it.shortUrl || "").replace(/[.,;!?]+$/, "") === link);
    if (item) listed.push(item);
  }
  if (listed.length === 0) return null;
  if (listed.length === 1) return listed[0];

  const t = rawText.toLowerCase();
  const price = (it: MainWebsiteProduct) => (typeof it.basePrice === "number" && it.basePrice > 0 ? it.basePrice : null);
  const priced = listed.filter((it) => price(it) !== null);
  if (/\b(cheaper|cheapest|smaller|smallest)\s+one\b/.test(t) && priced.length > 0) {
    return [...priced].sort((a, b) => price(a)! - price(b)!)[0];
  }
  if (/\b(costlier|costliest|pricier|more\s+expensive|bigger|biggest|larger|largest|taller|tallest)\s+one\b/.test(t) && priced.length > 0) {
    return [...priced].sort((a, b) => price(b)! - price(a)!)[0];
  }
  const word = t.match(/\b(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\b/)?.[1];
  const num = t.match(/(?:option|number|no\.?|#)\s*([1-5])\b/)?.[1] || t.match(/^\s*([1-5])[\s.)!]*$/)?.[1];
  let idx = -2;
  if (word) idx = ACRIO_ORDINALS[word];
  else if (num) idx = parseInt(num, 10) - 1;
  if (idx === -1) return listed[listed.length - 1];
  if (idx >= 0 && idx < listed.length) return listed[idx];
  return null;
}

/**
 * Deterministically updates `AcrioConversationState` for a single customer inbound turn.
 */
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

  // Track "without mentioning prices" / "hide prices" preference on the current turn and its immediate MENU_SELECTION follow-up
  if (/\b(without\s*(?:mentioning\s*)?prices?|no\s*prices?|hide\s*prices?|don'?t\s*(?:mention|show)\s*prices?)\b/i.test(lower)) {
    base.hidePrices = true;
  } else if (intentInfo.intent !== "MENU_SELECTION" && intentInfo.intent !== "CATEGORY_OVERVIEW") {
    base.hidePrices = false;
  }

  // Track cheapest / smaller top preference
  if (/\b(cheapest|lowest\s*price|least\s*expensive|cheaper(?:\s+(?:one|ones|model|models|alternative|alternatives|option|options))?|smaller\s*top\s*to\s*save|save\s*more|lower\s*cost|lower\s*price|sasta|sabse\s*sasta)\b/i.test(lower)) {
    base.preferCheapest = true;
    base.preferences = base.preferences.filter((p) => p !== "premium");
    // If customer had a high podium price or is asking for a cheaper alternative to a specific model, clear minPrice
    base.minPrice = null;
  } else if (/\b(costliest|most\s*expensive|most\s*premium|premium|flagship|luxury)\b/i.test(lower)) {
    base.preferCheapest = false;
  } else if (!/\b(any\s*more|more\s*options|other\s*options)\b/i.test(lower)) {
    base.preferCheapest = false;
  }

  // Explicit topic reset clears active product/budget/image state while keeping archived productHistory & sha analysis cache
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

  // Handle CATEGORY_OVERVIEW (e.g. "What all categories do you have under the podiums category?")
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

  // Handle MENU_SELECTION ("1", "2", "Option 1")
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

  // Non-product informational/greeting turns do not mutate active product state,
  // EXCEPT when the customer sends a colour/material/size/quantity fragment ("On black acrylic") in a multi-message enquiry!
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

  // Detect product switch even within the same family (e.g. CCP054 -> CCP065 -> CCP094) OR from a product to any new distinct item/noun!
  // However, if the previous state had ZERO core product nouns (e.g. Turn 1 was a fragment like "On black acrylic"),
  // then Turn 2 ("Acylirc Mobile phone locker photo pls") is completing the same requirement, NOT switching away from a product!
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

  // If the previous state had no real product noun (e.g. "On black acrylic") and this turn now supplies the product noun
  // ("Acylirc Mobile phone locker photo pls"), clear any bogus recommendations from the fragment turn while KEEPING preferences!
  if (!prevHadRealProduct && (turnCoreNouns.length > 0 || Boolean(detected.productFamily))) {
    base.lastRecommendedProducts = [];
    base.shownProductSlugs = [];
    base.focusProductSlug = null;
  }

  // If customer explicitly names SKU codes (e.g. "CCP057S and CCP054" or "Tell me about CCP111") without a budget in this turn, clear any stale budget from an earlier turn!
  if (explicitCodesInTurn.length > 0 && budget.maxPrice === null && budget.minPrice === null) {
    base.maxPrice = null;
    base.minPrice = null;
  }

  // If customer asks for a cheaper alternative after looking at a high-end product, set maxPrice below the last recommended product's price!
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

  // Merge product family & query if not already set or if this turn specifies a family
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
    // Never keep a colour/material-only fragment like "On black acrylic" as primaryProductQuery!
    base.primaryProductQuery = null;
  }

  if (detected.itemTypeFilter) {
    base.itemTypeFilter = detected.itemTypeFilter;
  }
  if (detected.excludedItemTypes.length > 0) {
    const mergedExcl = new Set([...base.excludedItemTypes, ...detected.excludedItemTypes]);
    base.excludedItemTypes = Array.from(mergedExcl);
  }

  // Budget updates: preserve product category & requirements while updating price ceiling/floor!
  if (budget.maxPrice !== null || budget.minPrice !== null) {
    base.maxPrice = budget.maxPrice;
    base.minPrice = budget.minPrice;
  } else if (/\b(no\s*budget|any\s*budget|without\s*budget|ignore\s*budget|no\s*price\s*limit|cheapest|costliest|most\s*expensive)\b/i.test(rawText)) {
    base.maxPrice = null;
    base.minPrice = null;
  }

  // Preferences merge
  if (turnPrefs.length > 0) {
    const mergedPrefs = new Set([...base.preferences, ...turnPrefs]);
    base.preferences = Array.from(mergedPrefs);
  }

  if (meta.applicationContext) base.applicationContext = meta.applicationContext;
  if (meta.dimensionsOrThickness) base.dimensionsOrThickness = meta.dimensionsOrThickness;
  if (meta.quantity) base.quantity = meta.quantity;

  return base;
}

/**
 * Reconstructs `AcrioConversationState` across an inbound/outbound history array
 * combined with an optional persisted `ai_state_json` snapshot.
 */
export function reconstructAcrioConversationState(params: {
  persistedState?: AcrioConversationState | null;
  recentMessages?: { direction: string; body: string }[];
  currentInboundText: string;
}): AcrioConversationState {
  const { persistedState, recentMessages = [], currentInboundText } = params;
  const trimmedCurrent = String(currentInboundText || "").trim();

  // Extract inbound history excluding duplicate trailing currentInboundText
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

  // If no persisted state had an active query (or turnCount === 0), replay prior inbound turns
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

/**
 * Builds the clean, normalized catalog search query and structured `EcosystemSearchOptions`
 * from `AcrioConversationState` so follow-up turns ("We can increase the budget to ₹30,000",
 * "Show me the most premium transparent ones", "Actually I am not looking for tools, just machines")
 * never feed noisy multi-turn chat sentences into `searchEcosystemItems`.
 */
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

