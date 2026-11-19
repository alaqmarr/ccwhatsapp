import {
  cleanDisplayProductName,
  loadAllClassicConceptsProducts,
  loadAllClassicEdgeItems,
  type MainWebsiteProduct,
} from "@cc/database";
import { invalidateWhatsAppCacheTags, rememberWhatsAppCacheWithMeta } from "@cc/storage";
import type { CatalogCacheMeta } from "./types";

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
      () => loadAllClassicConceptsProducts(),
      { skipClone: true }
    ),
    rememberWhatsAppCacheWithMeta(
      "ecosystem:ce53-items:v9",
      ["ce53-machines"],
      3600,
      () => loadAllClassicEdgeItems(),
      { skipClone: true }
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
