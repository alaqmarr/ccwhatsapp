export interface MainWebsiteEnquiry {
  id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  source: string;
  status: string;
  createdAt: string;
}

export interface EcosystemSpecItem {
  key?: string;
  label?: string;
  value: string;
  type?: "dimension" | "specification" | string;
}

export interface EcosystemVariantItem {
  id?: string;
  name: string;
  price: number | null;
  imageUrl?: string | null;
}

export interface EcosystemModelItem {
  id: string;
  modelName: string;
  specifications: { key?: string; label?: string; value: string }[];
  resources?: { name?: string; title?: string; type?: string; url: string }[];
  consumables?: (
    | {
        id: string;
        name: string;
        category?: string | null;
        description?: string | null;
      }
    | string
  )[];
}

export interface MainWebsiteProduct {
  id: string;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  brandLabel: string;
  itemType: "PRODUCT" | "MACHINE" | "CONSUMABLE";
  name: string;
  slug: string;
  sku: string | null;
  categoryName: string;
  description?: string | null;
  basePrice: number | null;
  mainImage: string | null;
  url: string;
  shortCode?: string;
  shortUrl?: string;
  modelsSummary?: string | null;
  specsSummary?: string | null;
  images?: string[];
  features?: string[];
  dimensions?: EcosystemSpecItem[];
  specifications?: EcosystemSpecItem[];
  variants?: EcosystemVariantItem[];
  descriptionHtmlText?: string | null;
  importantNoteText?: string | null;
  searchKeywords?: string | null;
  podiumSubCategory?: string | null;
  podiumSubCategoryNames?: string[];
  regularPrice?: number | null;
  isRegisteredDesign?: boolean;
  designRegistrationNo?: string | null;
  ipProtectionText?: string | null;
  videoUrl?: string | null;
  industries?: ({ name: string; slug: string; description?: string } | string)[];
  problemStatements?: ({ name: string; slug: string; description?: string } | string)[];
  resources?: { name?: string; title?: string; type?: string; url: string }[];
  models?: EcosystemModelItem[];
  relatedConsumables?: (
    | {
        id: string;
        name: string;
        category?: string | null;
        description?: string | null;
      }
    | string
  )[];
  searchBlob?: string;
}

export interface EcosystemSearchOptions {
  minPrice?: number | null;
  maxPrice?: number | null;
  brand?: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | null;
  itemType?: "PRODUCT" | "MACHINE" | "CONSUMABLE" | null;
  excludedItemTypes?: ("PRODUCT" | "MACHINE" | "CONSUMABLE")[];
  productFamily?: string | null;
  preferPremium?: boolean;
  preferCheapest?: boolean;
  includeUnpricedOnBudget?: boolean;
  excludeSlugs?: string[];
}

export function cleanDisplayProductName(raw: string): string {
  let text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Acrylic Product";

  // Strip pipe-separated SEO suffixes e.g. "| Custom Cut Sizes Available..."
  text = text.split("|")[0].trim();

  // Strip scraped conversational tails or stray questions e.g. "Do you like this personality?"
  text = text
    .replace(/\b(?:do you like|would you like|what do you think)[^?]*\??/gi, "")
    .replace(/\s*\?+$/, "")
    .trim();

  // Strip em-dashes / en-dashes / spaced hyphens if verbose
  if (text.length > 52 && /\s[\u2014\u2013-]\s/.test(text)) {
    text = text.split(/\s[\u2014\u2013-]\s/)[0].trim();
  }

  // If comma-stuffed SEO title, keep the primary name
  if (text.includes(",")) {
    const firstPart = text.split(",")[0].trim();
    if (firstPart.length >= 14) {
      text = firstPart;
    }
  }

  // Hard cap at 64 chars on word boundary
  if (text.length > 64) {
    text = text.slice(0, 62).replace(/\s+\S*$/, "").trim();
  }

  return text || "Acrylic Product";
}

export function normalizePublicEcosystemUrl(
  rawUrl: string,
  brandHint?: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | string | null
): string {
  const clean = String(rawUrl || "").trim();
  if (!clean) return "https://classicconcepts.in/shop";

  const isEdge =
    brandHint === "CLASSIC_EDGE_53" ||
    /:3002\b/i.test(clean) ||
    /classicedge53\.com/i.test(clean) ||
    /auto_classicedge53/i.test(clean) ||
    /^\/?(?:products|consumables)\//i.test(clean.replace(/^https?:\/\/[^/]+/i, ""));

  const prodOrigin = isEdge
    ? "https://classicedge53.com"
    : "https://classicconcepts.in";

  if (clean.startsWith("/")) {
    return `${prodOrigin}${clean}`;
  }

  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(\/.*|$)/i.test(clean)) {
    return clean.replace(
      /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i,
      prodOrigin
    );
  }

  return clean;
}

export function isDummyPlaceholderRow(id: unknown, name: unknown): boolean {
  const cleanId = String(id || "").trim().toLowerCase();
  const cleanName = String(name || "").trim().toLowerCase();
  return (
    cleanId === "test" ||
    cleanName === "test" ||
    cleanName === "test product" ||
    /^test\s+product\b/i.test(cleanName)
  );
}

export function normalizeCatalogHtmlToText(
  html: string | null | undefined
): string {
  if (!html) return "";
  let text = String(html);
  text = text
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\s*\/\s*li\s*>/gi, "\n")
    .replace(/<\s*\/\s*(?:td|th)\s*>/gi, " | ")
    .replace(
      /<\s*\/\s*(?:tr|p|div|h[1-6]|ul|ol|table|blockquote|section)\s*>/gi,
      "\n"
    )
    .replace(/<[^>]+>/g, " ");

  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&times;/gi, "×")
    .replace(/&ndash;|&mdash;|[\u2014\u2013]/gi, "-")
    .replace(/&#8377;/gi, "₹")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : " ";
    });

  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\s*\|\s*\|\s*/g, " | ")
        .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
        .replace(/[ \t\u00A0]+/g, " ")
        .trim()
    )
    .filter((line) => line.length > 0 && line !== "•")
    .join("\n");
}

export function isEcosystemDimensionSpec(spec: {
  key?: string;
  label?: string;
  value: string;
  type?: string | null;
}): boolean {
  const k = String(spec.label || spec.key || "").trim();
  const v = String(spec.value || "").trim();
  if (/^model$/i.test(k)) return false;
  if (String(spec.type || "").toLowerCase() === "dimension") return true;
  if (
    /\b(height|width|depth|length|size|top\s*sheet|bottom\s*sheet|front\s*panel|shelf\s*size|logo\s*panel|base\s*size|reading\s*top|overall\s*size|dimension|dimensions|diameter|thickness)\b/i.test(
      k
    )
  ) {
    return true;
  }
  return /\b\d+(?:\.\d+)?\s*(?:×|x|\*)\s*\d+(?:\.\d+)?\s*(?:inch|inches|in|mm|cm|ft|")\b/i.test(
    v
  );
}

export function buildEcosystemItemSearchBlob(item: MainWebsiteProduct): string {
  const featStr = (item.features || []).join(" ");
  const dimStr = (item.dimensions || [])
    .map((d) => `${d.label || d.key || ""} ${d.value}`)
    .join(" ");
  const specStr = (item.specifications || [])
    .map((s) => `${s.label || s.key || ""} ${s.value}`)
    .join(" ");
  const varStr = (item.variants || [])
    .map((v) => `${v.name} ${v.price ? `₹${v.price} ${v.price}` : ""}`)
    .join(" ");
  const modelStr = (item.models || [])
    .map(
      (m) =>
        `${m.modelName} ${(m.specifications || [])
          .map((s) => `${s.label || s.key || ""} ${s.value}`)
          .join(" ")}`
    )
    .join(" ");
  const indStr = (item.industries || [])
    .map((i) => (typeof i === "string" ? i : `${i.name} ${i.description || ""}`))
    .join(" ");
  const probStr = (item.problemStatements || [])
    .map((ps) => (typeof ps === "string" ? ps : `${ps.name} ${ps.description || ""}`))
    .join(" ");
  const resStr = (item.resources || [])
    .map((r) => r.title || r.name || "")
    .join(" ");

  return [
    item.name,
    item.slug.replace(/-/g, " "),
    item.sku || "",
    item.categoryName,
    item.podiumSubCategory || "",
    item.description || "",
    item.descriptionHtmlText || "",
    item.importantNoteText || "",
    item.searchKeywords || "",
    item.modelsSummary || "",
    item.specsSummary || "",
    featStr,
    dimStr,
    specStr,
    varStr,
    modelStr,
    indStr,
    probStr,
    resStr,
    item.designRegistrationNo || "",
    item.ipProtectionText || "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
