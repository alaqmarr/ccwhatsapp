import {
  cleanDisplayProductName,
  extractExplicitProductOrModelCodes,
  type MainWebsiteProduct,
} from "@cc/database";
import { ACRIO_SHORT_CITY_OR_REPLY_RE } from "./intent-classifier";
import {
  ACRIO_COLOUR_WORDS,
  extractNormalizedColourTokens,
  isCatalogAggregateQuestion,
  isMultiProductReference,
  isProductImageRequest,
  matchProductVariantsByColourTokens,
} from "./variant-and-media";

export function isFocusedProductFollowUp(
  rawText: string,
  focusItem?: MainWebsiteProduct | null,
  hasQuotedFocusProduct = false
): boolean {
  const t = rawText.toLowerCase().trim();
  if (isCatalogAggregateQuestion(t)) return false;
  if (extractExplicitProductOrModelCodes(rawText).length > 0) return false;
  if (isMultiProductReference(t)) return false;

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

  const anaphora =
    /\b(this|it|its|same|above|(?:this|that|the)\s+(?:one|model|product|podium|pulpit|item|piece|variant|colou?r)|(?:of|for|about|in|on)\s+that\b|(?:black|white|clear|gold|silver|blue|yellow|red|green|frosted|frost|led)\s+(?:one|variant|colou?r|photo|image|pic|picture))\b/i.test(
      t
    );
  const attribute =
    /\b(variants?|colou?rs?|imag[a-z]*|phot[a-z]*|phto[a-z]*|pics?|pictures?|warranty|price|cost|rate|mrp|how\s*much|kitna|size|dimensions?|height|width|weight|logo|led|delivery|shipping|dispatch|gst|invoice|order|buy|book|material|pillars?|shelf|wheels?|assembly|available|stock|details?|specs?|in\s+(?:black|white|clear|gold|silver|frost|frosted))\b/i.test(
      t
    );
  const isShortVariantReply =
    colourTokens.length > 0 &&
    !hasAnyFamilyNoun &&
    t.split(/\s+/).length <= 5 &&
    (!focusItem ||
      matchProductVariantsByColourTokens(focusItem.variants || [], t).length > 0);

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
