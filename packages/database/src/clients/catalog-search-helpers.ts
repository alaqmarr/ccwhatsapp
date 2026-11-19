import type { MainWebsiteProduct } from "./catalog-types";

export const SEARCH_STOPWORDS = new Set([
  "i", "im", "am", "is", "are", "was", "were", "be", "been", "being",
  "a", "an", "the", "and", "or", "but", "if", "so", "as", "at", "by",
  "for", "from", "in", "into", "of", "on", "onto", "to", "up", "with",
  "about", "above", "after", "again", "all", "also", "any", "around",
  "asking", "asked", "below", "between", "both", "budget", "buy", "can",
  "check", "classic", "concepts", "cost", "costs", "could", "details",
  "do", "does", "doing", "each", "few", "find", "get", "give", "good",
  "best", "great", "had", "has", "have", "having", "hello", "hey", "hi",
  "how", "inr", "item", "items", "just", "know", "less", "like", "list",
  "look", "looking", "make", "many", "max", "maximum", "may", "me", "min",
  "minimum", "more", "most", "much", "must", "my", "need", "needed", "new",
  "no", "not", "now", "only", "option", "options", "order", "our", "out",
  "over", "per", "piece", "pieces", "please", "pls", "plz", "price",
  "priced", "prices", "pricing", "product", "products", "purchase",
  "quote", "range", "rate", "rates", "rs", "rupee", "rupees", "said",
  "same", "say", "see", "send", "share", "show", "some", "something",
  "still", "such", "take", "tell", "than", "thank", "thanks", "that",
  "their", "them", "then", "there", "these", "they", "this", "those",
  "through", "told", "too", "under", "until", "upto", "us", "use", "very",
  "want", "wanted", "we", "what", "when", "where", "which", "while", "who",
  "will", "within", "would", "you", "your", "namaste", "sir", "madam",
]);

export const DOMAIN_SYNONYM_GROUPS: string[][] = [
  ["podium", "podiums", "pulpit", "pulpits", "lectern", "lecterns", "rostrum", "speech", "stage", "auditorium", "ccp"],
  ["trophy", "trophies", "award", "awards", "memento", "mementos", "plaque", "plaques", "shield", "shields", "medal", "gift", "gifts", "gifting"],
  ["menu", "menus", "tent", "qr", "standee", "holder", "holders", "brochure", "leaflet", "pamphlet", "flyer"],
  ["donation", "charity", "ballot", "suggestion", "lottery", "drop"],
  ["saree", "garment", "showcase", "riser", "risers", "turntable", "merchandise", "retail"],
  ["table", "tables", "chair", "chairs", "stool", "stools", "desk", "desks", "furniture", "bedside", "coffee", "dining", "interior", "interiors", "interiora", "furnishings"],
  ["tray", "trays", "dispenser", "dispensers", "candy", "lollipop", "beverage", "juice"],
  ["signage", "signages", "sign", "nameplate", "nameplates", "board", "boards", "keychain", "keychains", "badge", "badges"],
  ["polisher", "polishing", "buffing", "diamond"],
  ["bender", "bending", "heater", "heating"],
  ["router", "cnc", "laser", "cutter", "cutting", "blade", "blades"],
  ["sheet", "sheets", "mirror", "tube", "tubes", "rod", "rods"],
];

export function extractBudgetConstraintsFromQuery(rawQuery: string): {
  maxPrice: number | null;
  minPrice: number | null;
  isPerPiece?: boolean;
  isTotalProjectBudget?: boolean;
} {
  const normalized = String(rawQuery || "").replace(/,/g, "").toLowerCase();
  let maxPrice: number | null = null;
  let minPrice: number | null = null;

  const isPerPiece = /\b(per\s*(?:piece|pc|unit|item|podium|chair|table|gift|memento|plate|sign)|each|apiece)\b/i.test(
    normalized
  );
  const isTotalProjectBudget =
    !isPerPiece &&
    (/\b(total\s*budget|overall\s*budget|project\s*budget|renovat(?:e|ion)|all\s*together|combined|combinations?\s*accordingly)\b/i.test(
      normalized
    ) ||
      /\b(lac|lacs|lakh|lakhs|cr|crore)\b/i.test(normalized));

  const parseAmount = (numStr: string, unitSuffix?: string): number | null => {
    const val = parseFloat(numStr);
    if (!Number.isFinite(val) || val <= 0) return null;
    const suffix = (unitSuffix || "").toLowerCase().trim();
    let multiplier = 1;
    if (suffix === "k" || suffix === "thousand") {
      multiplier = 1000;
    } else if (/^(lac|lacs|lakh|lakhs)$/.test(suffix)) {
      multiplier = 100000;
    } else if (/^(cr|crore|crores)$/.test(suffix)) {
      multiplier = 10000000;
    }
    const computed = Math.round(val * multiplier);
    if (multiplier === 1 && computed < 250) return null;
    return computed;
  };

  const maxRe =
    /\b(?:under|below|within|upto|up\s*to|less\s*than|max|maximum|(?:increase|raise|extend|stretch|push|bump|change|update|set)?\s*(?:the\s*|my\s*|our\s*)?budget(?:\s*(?:of|is|to|upto|up\s*to|around|for))?|(?:stretch|go|increase|raise|make\s*it)(?:\s*up)?\s*to)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|lac|lacs|lakh|lakhs|cr|crore|crores)?\b/gi;
  for (const m of normalized.matchAll(maxRe)) {
    if (m[1]) {
      const parsed = parseAmount(m[1], m[2]);
      if (parsed !== null) maxPrice = parsed;
    }
  }

  if (maxPrice === null) {
    const altMaxRe =
      /(?:(?:rs\.?|inr|₹)\s*(\d+(?:\.\d+)?)\s*(k|thousand|lac|lacs|lakh|lakhs)?\s*(?:max|maximum|budget|limit|or\s*less))|(?:\baround\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|lac|lacs|lakh|lakhs)?\s*(?:rs\.?|inr|rupees|₹)?\b)|(?:\b(\d+(?:\.\d+)?)\s*(lac|lacs|lakh|lakhs)\s*(?:rs\.?|inr|rupees|budget)?\b)/gi;
    for (const m of normalized.matchAll(altMaxRe)) {
      const num = m[1] || m[3] || m[5];
      const unit = m[2] || m[4] || m[6];
      if (num) {
        const parsed = parseAmount(num, unit);
        if (parsed !== null) maxPrice = parsed;
      }
    }
  }

  const minRe =
    /\b(?:above|over|more\s*than|min|minimum|starting(?:\s*from)?|at\s*least)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|lac|lacs|lakh|lakhs)?\b/gi;
  for (const m of normalized.matchAll(minRe)) {
    if (m[1]) {
      const parsed = parseAmount(m[1], m[2]);
      if (parsed !== null) minPrice = parsed;
    }
  }

  const rangeRe =
    /\bbetween\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|lac|lacs|lakh|lakhs)?\s*(?:and|to|-)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|lac|lacs|lakh|lakhs)?\b/gi;
  for (const m of normalized.matchAll(rangeRe)) {
    if (m[1] && m[3]) {
      const pMin = parseAmount(m[1], m[2]);
      const pMax = parseAmount(m[3], m[4]);
      if (pMin !== null) minPrice = pMin;
      if (pMax !== null) maxPrice = pMax;
    }
  }

  return { maxPrice, minPrice, isPerPiece, isTotalProjectBudget };
}

export function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function wordMatchesToken(word: string, token: string): boolean {
  if (word === token) return true;
  if (token.length >= 4 && word.length >= 4) {
    if (word === `${token}s` || token === `${word}s`) return true;
    if (word === `${token}es` || token === `${word}es`) return true;
    if (
      token.length >= 5 &&
      (word.startsWith(token) || (word.length >= 5 && token.startsWith(word)))
    ) {
      return true;
    }
  }
  return false;
}

export function extractExplicitProductOrModelCodes(query: string): string[] {
  const codes = new Set<string>();
  const matches = query.matchAll(
    /\b(ccpo?[-_\s]?\d{2,4}[a-z]?|yn[-_\s]?jw\d{3,4}|abm[-_\s]?\d{3,4}|ce53[-_\s]?[a-z0-9-]+|cw[-_\s]?\d{3,5}|f[-_\s]?(?:308|500)|sd[-_\s]?\d{3,4}[a-z0-9]*|jw[-_\s]?\d{3,4}[a-z]?|zd[-_\s]?\d{3,4}|ce[-_\s]?[a-z]{2,4}[-_\s]?\d{2,4}[a-z]*|a[345][-_\s]?t[-_\s]?stand[-_\s]?\d*|d30)\b/gi
  );
  for (const m of matches) {
    if (m[1]) {
      codes.add(
        m[1]
          .toLowerCase()
          .replace(/[-_\s]+/g, "")
          .replace(/^ccpo(\d)/, "ccp0$1")
      );
    }
  }
  if (/\bc[-\s]*podium\b|\bc[-\s]*shaped\s+pillar/i.test(query)) {
    codes.add("ccp053");
  }
  return Array.from(codes);
}

export function extractCompactDimensionPairsFromText(text: string): {
  pairs: string[];
  ranges: string[];
} {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/[×✕*]/g, "x")
    .replace(/["”″']/g, " ");
  const pairsSet = new Set<string>();
  const rangesSet = new Set<string>();

  const pairRegex = /(\d{1,4}(?:\.\d+)?)\s*(?:inch|inches|in|mm|cm|ft|feet)?\s*(?:x|by)\s*(\d{1,4}(?:\.\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = pairRegex.exec(normalized)) !== null) {
    const a = m[1];
    const b = m[2];
    pairsSet.add(`${a}x${b}`);
    pairsSet.add(`${b}x${a}`);
  }

  const rangeRegex = /(\d{1,4}(?:\.\d+)?)\s*(?:min\.?\s*)?(?:to|-)\s*(\d{1,4}(?:\.\d+)?)\s*(?:max\.?\s*)?(?:inch|inches|in|mm|cm)\b/gi;
  while ((m = rangeRegex.exec(normalized)) !== null) {
    rangesSet.add(`${m[1]}to${m[2]}`);
  }

  return {
    pairs: Array.from(pairsSet),
    ranges: Array.from(rangesSet),
  };
}

/** Words that describe an item but do not name it: colours, materials, filler and request words. */
const CORE_NOUN_IGNORE = new Set([
  "black", "white", "red", "blue", "green", "yellow", "orange", "pink", "purple", "violet", "maroon", "brown",
  "gold", "golden", "silver", "grey", "gray", "clear", "transparent", "frosted", "frost", "smoke", "fluorescent",
  "flourocent", "colour", "colours", "color", "colors", "shade", "shades", "finish", "variant", "variants",
  "acrylic", "acrylics", "perspex", "plastic", "glass",
  "photo", "photos", "phot", "photograph", "pics", "pic", "picture", "pictures", "image", "images", "video",
  "videos", "snap", "snaps", "message", "messages", "attachment", "attached",
  "design", "designs", "model", "models", "size", "sizes", "type", "types", "kind", "similar", "custom",
  "customized", "customised", "logo", "print", "printing", "available", "availability", "required", "requirement",
  "requirements", "enquiry", "inquiry", "regarding", "urgent", "urgently", "quantity", "delivery", "kindly",
  "looking", "wanted", "interested", "details", "detail", "information", "bhejo", "dikhao", "chahiye",
  "budget", "under", "below", "above", "within", "around", "increase", "raise", "stretch", "extend", "option",
  "options", "price", "prices", "cost", "rate", "share", "send", "show", "need", "want", "make", "build",
  "college", "school", "church", "auditorium", "classroom", "hotel", "office", "stage", "conference", "seminar",
  "banquet", "hospital", "event", "rupees", "lakh", "lakhs", "thousand",
]);

function editDistanceAtMost2(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length] <= 2;
}

const SHORT_CORE_DOMAIN_NOUNS = new Set([
  "box", "cnc", "led", "rod", "pen", "key", "tag", "mug", "cup", "cap", "lid", "bar", "mat", "bin", "kit", "qr",
]);

/** The nouns that actually name what the customer wants, for example "mobile phone locker" gives mobile, phone, locker. */
export function extractCustomerCoreNouns(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const cleaned = String(text || "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ");
  for (const tok of cleaned.split(/\s+/)) {
    if ((tok.length < 4 && !SHORT_CORE_DOMAIN_NOUNS.has(tok)) || /^\d/.test(tok)) continue;
    if (SEARCH_STOPWORDS.has(tok) || CORE_NOUN_IGNORE.has(tok)) continue;
    if (editDistanceAtMost2(tok, "acrylic")) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

function coreNounVariants(token: string): string[] {
  const singular = token.replace(/(?:ies)$/, "y").replace(/(?:es|s)$/, "");
  const base = new Set<string>([token, singular].filter((t) => t.length >= 3));
  for (const grp of DOMAIN_SYNONYM_GROUPS) {
    if (grp.some((g) => base.has(g))) for (const g of grp) base.add(g);
  }
  return [...base];
}

/** How many of the customer's core nouns appear in the item's name, category or keywords. */
export function countCoreNounMatches(item: MainWebsiteProduct, coreNouns: string[]): number {
  if (coreNouns.length === 0) return 0;
  const hay = `${item.name || ""} ${item.categoryName || ""} ${item.searchKeywords || ""}`.toLowerCase();
  let hits = 0;
  for (const noun of coreNouns) {
    const variants = coreNounVariants(noun);
    if (variants.some((v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(hay))) hits += 1;
  }
  return hits;
}

/**
 * Puts items that match what the customer actually named ahead of items that only match a colour or the word
 * "acrylic". The order is otherwise unchanged. `anyMatch` is false when nothing in the list matches any named noun.
 */
export function rankItemsByCustomerCoreNouns(
  items: MainWebsiteProduct[],
  text: string
): { ranked: MainWebsiteProduct[]; coreNouns: string[]; anyMatch: boolean } {
  const coreNouns = extractCustomerCoreNouns(text);
  if (coreNouns.length === 0 || items.length === 0) {
    return { ranked: items, coreNouns, anyMatch: true };
  }
  const scored = items.map((item, idx) => ({ item, idx, hits: countCoreNounMatches(item, coreNouns) }));
  const anyMatch = scored.some((s) => s.hits > 0);
  scored.sort((a, b) => b.hits - a.hits || a.idx - b.idx);
  return { ranked: scored.map((s) => s.item), coreNouns, anyMatch };
}
