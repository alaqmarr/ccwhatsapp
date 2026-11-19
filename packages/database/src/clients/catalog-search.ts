import { loadAllClassicConceptsProducts } from "./catalog-loader-cc";
import { loadAllClassicEdgeItems } from "./catalog-loader-ce";
import {
  DOMAIN_SYNONYM_GROUPS,
  SEARCH_STOPWORDS,
  extractBudgetConstraintsFromQuery,
  extractCompactDimensionPairsFromText,
  extractExplicitProductOrModelCodes,
  tokenizeWords,
  wordMatchesToken,
} from "./catalog-search-helpers";
import {
  isDummyPlaceholderRow,
  type EcosystemSearchOptions,
  type MainWebsiteProduct,
} from "./catalog-types";

export function searchEcosystemItems(
  items: MainWebsiteProduct[],
  searchQuery: string,
  limit = 6,
  options?: EcosystemSearchOptions
): MainWebsiteProduct[] {
  const q = searchQuery.trim().toLowerCase();
  const explicitCodes = extractExplicitProductOrModelCodes(searchQuery);

  const inlineExcludeConsumables =
    /\b(?:not\s+looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|exclude|excluding|skip)\s+(?:any\s+)?(?:tools?|consumables?|blades?|cutters?|solvents?|accessories)\b|\b(?:just|only)\s+machines?\b/i.test(
      q
    );
  const inlineExcludeMachines =
    /\b(?:not\s+looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|exclude)\s+(?:any\s+)?machines?\b|\b(?:just|only)\s+(?:tools?|consumables?|blades?|cutters?)\b/i.test(
      q
    );
  const mentionsMachineExplicitly =
    /\b(machine|machines|polisher|polishing\s+machine|bender|bending\s+machine|line\s+bender|laser\s+cutter|laser\s+cutting|cnc\s+router\s+machine|flame\s+polish|thermoforming\s+oven|chiller|compressor|yn[-_\s]?jw\d+|abm[-_\s]?\d+|ce53[-_\s]?[a-z0-9-]+|cw[-_\s]?\d{3,5}|f[-_\s]?(?:308|500)|sd[-_\s]?\d{3,4}|jw[-_\s]?\d{3,4}|zd[-_\s]?\d{3,4}|ce[-_\s]?(?:lc|cnc|fp|to)\d+)\b/i.test(
      q
    ) ||
    (/\b(cnc\s+router|router|laser)\b/i.test(q) &&
      !/\b(bit|bits|tool|tools|blade|blades|cutter|cutters|carbide|collet|collect|consumable|consumables|accessor(?:y|ies))\b/i.test(
        q
      ));
  const mentionsConsumablesExplicitly =
    /\b(consumable|consumables|tool|tools|blade|blades|cutter|cutters|router\s+bit|router\s+bits|carbide|collet|collect|solvent|glue|bonding|buffing|heating\s+wire|spare\s+part|accessor(?:y|ies)|add[-\s]?ons?|hinge|hinges|camlock|camlocks|standoff|standoffs|spacer|spacers|knob|knobs|handle|handles|latch|latches|catch|catches|hasp|staple|screw|screws|bolt|nut|washer|bracket|brackets|rod|rods|tube|tubes|ball|balls|sphere|turntable|rotating\s+disc|key\s*ring|photo\s*magnet|radeon|glitter\s+sheet|mirror\s+sheet|metallic\s+sheet)\b/i.test(
      q
    );

  let cleanItems = items.filter((i) => !isDummyPlaceholderRow(i.id, i.name));
  if (options?.brand) {
    cleanItems = cleanItems.filter((i) => i.brand === options.brand);
  }
  const effectiveItemType =
    options?.itemType ??
    (inlineExcludeConsumables
      ? "MACHINE"
      : inlineExcludeMachines
      ? "CONSUMABLE"
      : mentionsMachineExplicitly && !mentionsConsumablesExplicitly
      ? "MACHINE"
      : null);
  if (effectiveItemType) {
    cleanItems = cleanItems.filter((i) => i.itemType === effectiveItemType);
  }

  const excludedSet = new Set<"PRODUCT" | "MACHINE" | "CONSUMABLE">(
    options?.excludedItemTypes || []
  );
  if (inlineExcludeConsumables || (mentionsMachineExplicitly && !mentionsConsumablesExplicitly)) {
    excludedSet.add("CONSUMABLE");
  }
  if (inlineExcludeMachines) excludedSet.add("MACHINE");
  if (excludedSet.size > 0) {
    cleanItems = cleanItems.filter((i) => !excludedSet.has(i.itemType));
  }

  if (!q && options?.maxPrice === undefined && options?.minPrice === undefined) {
    return cleanItems.slice(0, limit);
  }

  const extractedBudget = extractBudgetConstraintsFromQuery(searchQuery);
  const maxPrice =
    options?.maxPrice !== undefined ? options.maxPrice : extractedBudget.maxPrice;
  const minPrice =
    options?.minPrice !== undefined ? options.minPrice : extractedBudget.minPrice;
  const preferCheapest =
    options?.preferCheapest ??
    /\b(cheapest|lowest\s*price|least\s*expensive|minimum\s*price|starting\s*(?:price|model|range)|most\s*affordable|economy\s*model|sasta|sabse\s*sasta|kam\s*price|smaller\s*top\s*to\s*save|save\s*more|cheaper\s*alternative|cheaper\s*option|lower\s*cost)\b/i.test(
      q
    );
  const preferPremium =
    !preferCheapest &&
    (options?.preferPremium ??
      /\b(costliest|most\s*expensive|highest\s*price|most\s*premium|premium|high\s*end|best\s*quality|top\s*model|flagship|luxury|heaviest|mehenga|sabse\s*mehenga)\b/i.test(
        q
      ));
  const excludeSlugSet = new Set<string>(
    (options?.excludeSlugs || []).map((s) => s.toLowerCase().trim())
  );

  const queryWithoutPricesAndNegations = q
    .replace(
      /\b(?:not\s+looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|exclude|excluding|skip)\s+(?:any\s+)?(?:tools?|consumables?|blades?|cutters?|solvents?|accessories|machines?)\b/gi,
      " "
    )
    .replace(/(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?\s*(?:k|thousand|lac|lacs|lakh|lakhs|cr|crore|crores)?\b/gi, " ")
    .replace(
      /\b(?:under|below|within|upto|up\s*to|above|over|around|budget(?:\s*(?:of|is|to|around))?|increase|raise|extend|stretch)\s*(?:the\s*|my\s*|our\s*)?(?:budget\s*(?:to|of|is|around)?\s*)?(?:rs\.?|inr|₹)?\s*[\d,]+(?:\.\d+)?\s*(?:k|thousand|lac|lacs|lakh|lakhs|cr|crore|crores)?\s*(?:rupees|rs\.?|inr|₹)?\b/gi,
      " "
    );

  const measurementTokens: string[] = [];
  for (const m of queryWithoutPricesAndNegations.matchAll(
    /\b(\d{2,4})\s*(?:x|×|by)\s*(\d{2,4})\b|\b(\d{3,4})\s*mm\b/gi
  )) {
    if (m[1] && m[2]) {
      measurementTokens.push(m[1], m[2]);
    } else if (m[3]) {
      measurementTokens.push(m[3]);
    }
  }

  const rawTokens = tokenizeWords(queryWithoutPricesAndNegations).filter(
    (t) =>
      t.length >= 2 &&
      !SEARCH_STOPWORDS.has(t) &&
      !/^\d+$/.test(t) &&
      t !== "acrylic" &&
      t !== "increase" &&
      t !== "extend" &&
      t !== "raise" &&
      t !== "stretch" &&
      t !== "premium" &&
      t !== "cheapest" &&
      t !== "cheaper" &&
      t !== "alternative" &&
      t !== "ones" &&
      t !== "actually" &&
      t !== "compare" &&
      t !== "difference" &&
      t !== "between"
  );

  const directTokens =
    rawTokens.length > 0
      ? rawTokens
      : explicitCodes.length > 0
      ? explicitCodes
      : q.includes("acrylic")
      ? ["acrylic"]
      : [];

  if (directTokens.length === 0 && explicitCodes.length === 0) {
    if (maxPrice !== null || minPrice !== null || preferCheapest || preferPremium) {
      const pricedPool = cleanItems.filter((it) => {
        if (typeof it.basePrice !== "number" || it.basePrice <= 0) return false;
        if (maxPrice !== null && it.basePrice > maxPrice) return false;
        if (minPrice !== null && it.basePrice < minPrice) return false;
        return true;
      });
      pricedPool.sort((a, b) =>
        preferPremium
          ? (b.basePrice || 0) - (a.basePrice || 0)
          : (a.basePrice || 0) - (b.basePrice || 0)
      );
      return pricedPool.slice(0, limit);
    }
    if (effectiveItemType === "MACHINE" || effectiveItemType === "CONSUMABLE") {
      return cleanItems.slice(0, limit);
    }
    return [];
  }

  const expandedSynonyms = new Set<string>();
  for (const tok of directTokens) {
    for (const grp of DOMAIN_SYNONYM_GROUPS) {
      if (grp.some((g) => wordMatchesToken(g, tok))) {
        for (const syn of grp) {
          if (!directTokens.includes(syn)) expandedSynonyms.add(syn);
        }
      }
    }
  }

  const queryDims = extractCompactDimensionPairsFromText(searchQuery);
  const wantsTopSurface = /\b(top\s*surface|top\s*sheet|reading\s*top|reading\s*surface|top\s*panel|top\s*size|top)\b/i.test(q);
  const wantsSmallerTop = /\b(smaller\s*top|compact\s*top|narrow\s*top|single\s*pillar|save\s*more|cheaper\s*alternative)\b/i.test(q);
  const hasExplicitEdgeModel = explicitCodes.some((c) =>
    /^(ynjw|abm|ce53|cw\d|f308|f500|sd\d|jw\d|zd\d|d30|celc|cecnc|cefp|ceto)/.test(c)
  );
  const hasExplicitCcCode = explicitCodes.some((c) => /^ccp\d/.test(c));

  const wantsFurniture =
    options?.productFamily === "furniture" ||
    /\b(furniture|interior|interiors|interiora|decor|table|tables|chair|chairs|stool|stools|desk|desks|console|bench|seating|sit)\b/i.test(
      queryWithoutPricesAndNegations
    );
  const wantsSignage =
    options?.productFamily === "signage" ||
    /\b(signage|signages|name\s*plate|name\s*plates|nameplate|nameplates|name\s*board|door\s*sign|directional\s*sign)\b/i.test(
      queryWithoutPricesAndNegations
    );
  const wantsCorporateGift =
    options?.productFamily === "corporate_gift" ||
    /\b(gift|gifts|gifting|corporate\s*gift|corporate\s*clients?|souvenir|souvenirs|paper\s*weight|paperweight|pen\s*stand|keychain|keychains|coaster|coasters|desk\s*organizer)\b/i.test(
      queryWithoutPricesAndNegations
    );
  const wantsPodium =
    (!wantsFurniture && !wantsSignage && !wantsCorporateGift && options?.productFamily === "podium") ||
    hasExplicitCcCode ||
    /\b(pulpit|pulpits|podium|podiums|lectern|lecterns|rostrum|rostrums)\b/i.test(
      queryWithoutPricesAndNegations
    );
  const wantsAward =
    options?.productFamily === "trophy" ||
    (!wantsPodium &&
      !wantsFurniture &&
      /\b(trophy|trophies|memento|mementos|award|awards|plaque|plaques|medal|medals|shield|shields)\b/i.test(
        queryWithoutPricesAndNegations
      ));
  const wantsTray =
    options?.productFamily === "tray_hospitality" ||
    (!wantsCorporateGift && /\b(tray|trays|coaster|coasters)\b/i.test(queryWithoutPricesAndNegations));
  const wantsStandOrHolder =
    options?.productFamily === "stand" ||
    /\b(menu|qr\s*stand|tent\s*card|table\s*stand|sign\s*holder|brochure|leaflet|pamphlet)\b/i.test(
      queryWithoutPricesAndNegations
    );
  const wantsMachineOrTool =
    options?.brand === "CLASSIC_EDGE_53" ||
    hasExplicitEdgeModel ||
    effectiveItemType === "MACHINE" ||
    effectiveItemType === "CONSUMABLE" ||
    mentionsMachineExplicitly ||
    mentionsConsumablesExplicitly ||
    /\b(machine|machines|laser|cnc|router|polisher|polishing|diamond|bending|bender|heater|blade|blades|cutter|consumable|consumables|ce53|yn-|abm-|thermoforming|oven|chiller|compressor)\b/i.test(
      queryWithoutPricesAndNegations
    );
  const wantsDisplayProduct =
    options?.brand === "CLASSIC_CONCEPTS" ||
    wantsPodium ||
    wantsFurniture ||
    wantsSignage ||
    wantsCorporateGift ||
    wantsAward ||
    wantsTray ||
    wantsStandOrHolder ||
    /\b(saree|donation|ballot|table|chair|stool|furniture|interior|interiora|riser|signage|nameplate|keychain|cake\s*stand|cosmetic|jewelry|jewellery|watch\s*stand|eyewear|book\s*stand|quran|rehal|bible)\b/i.test(
      queryWithoutPricesAndNegations
    );

  const scored: { item: MainWebsiteProduct; score: number }[] = [];

  for (const item of cleanItems) {
    const skuLower = (item.sku || "").toLowerCase();
    const skuCompact = skuLower.replace(/[-_\s]+/g, "").replace(/^ccpo(\d)/, "ccp0$1");
    const slugCompact = (item.slug || "").toLowerCase().replace(/[-_\s]+/g, "");
    const modelLower = (
      item.modelsSummary ||
      (item.models || []).map((m) => m.modelName).join(" ") ||
      ""
    ).toLowerCase();
    const modelCompact = modelLower.replace(/[-_\s]+/g, "");

    const isExplicitCodeHit =
      explicitCodes.length > 0 &&
      explicitCodes.some(
        (code) =>
          skuCompact === code ||
          skuCompact.includes(code) ||
          slugCompact.includes(code) ||
          modelCompact.includes(code)
      );

    if (!isExplicitCodeHit) {
      if (wantsDisplayProduct && !wantsMachineOrTool && item.brand !== "CLASSIC_CONCEPTS") {
        continue;
      }
      if (wantsMachineOrTool && !wantsDisplayProduct && item.brand !== "CLASSIC_EDGE_53") {
        continue;
      }
    }

    const combinedTaxonomy = `${item.name} ${item.categoryName} ${item.sku || ""}`;
    if (!isExplicitCodeHit) {
      if (wantsPodium && !wantsFurniture && !wantsSignage && !wantsCorporateGift) {
        if (!/\b(podium|podiums|pulpit|pulpits|lectern|lecterns|rostrum)\b|^ccp\d/i.test(combinedTaxonomy)) {
          continue;
        }
      }
      if (wantsFurniture && !wantsPodium) {
        if (
          !/\b(furniture|table|tables|chair|chairs|stool|stools|desk|console|bench|pedestal)\b/i.test(
            combinedTaxonomy
          ) ||
          /\b(podium|pulpit|lectern|rostrum|machine|oven)\b/i.test(combinedTaxonomy)
        ) {
          continue;
        }
      }
      if (wantsSignage && !wantsPodium && !wantsFurniture) {
        if (
          !/\b(sign|signage|name\s*plate|nameplate|name\s*board|frame|holder|display)\b/i.test(
            combinedTaxonomy
          ) ||
          /\b(podium|pulpit|lectern|machine|oven)\b/i.test(combinedTaxonomy)
        ) {
          continue;
        }
      }
      if (wantsCorporateGift && !wantsPodium && !wantsFurniture) {
        if (
          !/\b(trophy|trophies|memento|mementos|award|awards|plaque|gift|paper\s*weight|paperweight|pen\s*stand|keychain|coaster|tray|organizer|tissue|frame|stand|holder)\b/i.test(
            combinedTaxonomy
          ) ||
          /\b(podium|pulpit|lectern|machine|oven|sheet|rod|tube)\b/i.test(combinedTaxonomy)
        ) {
          continue;
        }
      }
      if (
        wantsAward &&
        !wantsCorporateGift &&
        (!/\b(trophy|trophies|award|awards|memento|mementos|plaque|plaques|medal|medals|shield|shields)\b/i.test(
          combinedTaxonomy
        ) ||
          /\b(podium|pulpit|lectern|tray|machine|oven)\b/i.test(combinedTaxonomy))
      ) {
        continue;
      }
      if (
        wantsTray &&
        /\b(podium|pulpit|lectern|trophy|award|machine|oven|tube|keyway)\b/i.test(
          combinedTaxonomy
        )
      ) {
        continue;
      }
    }

    if (!isExplicitCodeHit && (maxPrice !== null || minPrice !== null)) {
      const hasValidPrice = typeof item.basePrice === "number" && item.basePrice > 0;
      if (!hasValidPrice) {
        if (
          !options?.includeUnpricedOnBudget &&
          !wantsCorporateGift &&
          !wantsAward &&
          !wantsSignage
        ) {
          continue;
        }
      } else {
        if (maxPrice !== null && item.basePrice! > maxPrice) continue;
        if (minPrice !== null && item.basePrice! < minPrice) continue;
      }
    }

    const nameWords = tokenizeWords(item.name);
    const catWords = tokenizeWords(
      `${item.categoryName} ${(item.podiumSubCategoryNames || []).join(" ")}`
    );
    const deepText = `${item.description || ""} ${item.descriptionHtmlText || ""} ${item.importantNoteText || ""} ${item.specsSummary || ""} ${(item.features || []).join(" ")} ${(item.variants || []).map((v) => v.name).join(" ")} ${(item.industries || []).map((ind) => (typeof ind === "string" ? ind : `${ind.name} ${ind.description || ""}`)).join(" ")} ${(item.problemStatements || []).map((ps) => (typeof ps === "string" ? ps : `${ps.name} ${ps.description || ""}`)).join(" ")} ${(item.models || []).map((m) => m.specifications.map((s) => `${s.label || s.key || ""} ${s.value}`).join(" ")).join(" ")}`;
    const descWords = tokenizeWords(deepText);

    let matchScore = 0;

    if (explicitCodes.length > 0) {
      for (const code of explicitCodes) {
        if (
          skuCompact === code ||
          skuCompact.includes(code) ||
          slugCompact.includes(code) ||
          modelCompact.includes(code)
        ) {
          matchScore += skuCompact === code || slugCompact.endsWith(code) ? 520 : 320;
        }
      }
    }

    if (queryDims.pairs.length > 0 || queryDims.ranges.length > 0) {
      const topSheetSpec = (item.dimensions || []).find((d) =>
        /top\s*sheet|reading\s*top|top\s*surface|top/i.test(d.label || d.key || "")
      );
      const topSheetDims = extractCompactDimensionPairsFromText(topSheetSpec?.value || "");
      const allStructDims = extractCompactDimensionPairsFromText(
        `${(item.dimensions || []).map((d) => `${d.label || d.key || ""} ${d.value}`).join(" ")} ${(item.specifications || []).map((s) => `${s.label || s.key || ""} ${s.value}`).join(" ")}`
      );
      const allDescDims = extractCompactDimensionPairsFromText(deepText);

      for (const qPair of queryDims.pairs) {
        if (topSheetDims.pairs.includes(qPair)) {
          matchScore += wantsTopSurface ? 380 : 280;
        } else if (allStructDims.pairs.includes(qPair)) {
          matchScore += 240;
        } else if (allDescDims.pairs.includes(qPair)) {
          matchScore += 160;
        }
      }

      for (const qRange of queryDims.ranges) {
        if (allStructDims.ranges.includes(qRange) || allDescDims.ranges.includes(qRange)) {
          matchScore += 220;
        }
      }
    }

    if (wantsSmallerTop && wantsPodium) {
      const topSpec = (item.dimensions || []).find((d) =>
        /top\s*sheet|reading\s*top/i.test(d.label || d.key || "")
      );
      if (topSpec && /\b(18\s*[x×]\s*1[2456]|19\s*[x×]\s*15|20\s*[x×]\s*15|20\s*[x×]\s*16)\b/i.test(topSpec.value)) {
        matchScore += 45;
      }
      if ((item.podiumSubCategoryNames || []).some((sub) => /essential/i.test(sub))) {
        matchScore += 30;
      }
    }

    for (const tok of directTokens) {
      const tokCompact = tok.replace(/[-_\s]+/g, "");
      if (skuLower && (skuLower.includes(tok) || skuCompact.includes(tokCompact)) && tok.length >= 3) {
        matchScore += 32;
      } else if (modelLower && (modelLower.includes(tok) || modelCompact.includes(tokCompact)) && tok.length >= 3) {
        matchScore += 30;
      }
      if (nameWords.some((w) => wordMatchesToken(w, tok))) {
        matchScore += 24;
      }
      if (catWords.some((w) => wordMatchesToken(w, tok))) {
        matchScore += 18;
      }
      if (descWords.some((w) => wordMatchesToken(w, tok))) {
        matchScore += 7;
      }
    }

    if (measurementTokens.length > 0) {
      const dimAndModelBlob = `${(item.dimensions || []).map((d) => `${d.label || d.key || ""} ${d.value}`).join(" ")} ${item.descriptionHtmlText || ""} ${modelLower} ${(item.models || []).map((m) => m.specifications.map((s) => `${s.label || s.key || ""} ${s.value}`).join(" ")).join(" ")}`.toLowerCase();
      let matchedMeasurements = 0;
      for (const mTok of measurementTokens) {
        if (dimAndModelBlob.includes(mTok)) {
          matchedMeasurements++;
        }
      }
      if (matchedMeasurements > 0) {
        matchScore += matchedMeasurements * 14;
      }
    }

    for (const syn of expandedSynonyms) {
      if (nameWords.some((w) => wordMatchesToken(w, syn))) {
        matchScore += 18;
      } else if (catWords.some((w) => wordMatchesToken(w, syn))) {
        matchScore += 14;
      } else if (skuLower && syn.length >= 3 && skuLower.startsWith(syn)) {
        matchScore += 12;
      }
    }

    if (matchScore < 14) continue;

    if (
      item.itemType === "CONSUMABLE" &&
      !mentionsConsumablesExplicitly &&
      !isExplicitCodeHit &&
      effectiveItemType !== "CONSUMABLE"
    ) {
      matchScore -= 22;
      if (matchScore < 14) continue;
    }

    if (wantsMachineOrTool && item.brand === "CLASSIC_EDGE_53") {
      matchScore += 10;
    }

    if (maxPrice !== null || minPrice !== null || preferCheapest || preferPremium) {
      if (typeof item.basePrice === "number" && item.basePrice > 0) {
        matchScore += 18;
      }
    }

    if (
      !isExplicitCodeHit &&
      excludeSlugSet.size > 0 &&
      (excludeSlugSet.has((item.slug || "").toLowerCase()) ||
        excludeSlugSet.has((item.sku || "").toLowerCase()))
    ) {
      matchScore -= 80;
    }

    scored.push({ item, score: matchScore });
  }

  scored.sort((a, b) => {
    const aHasPrice = typeof a.item.basePrice === "number" && a.item.basePrice > 0;
    const bHasPrice = typeof b.item.basePrice === "number" && b.item.basePrice > 0;
    if ((maxPrice !== null || minPrice !== null || preferCheapest || preferPremium) && aHasPrice !== bHasPrice) {
      return aHasPrice ? -1 : 1;
    }
    if (preferCheapest && aHasPrice && bHasPrice) {
      const aExcluded = excludeSlugSet.has((a.item.slug || "").toLowerCase());
      const bExcluded = excludeSlugSet.has((b.item.slug || "").toLowerCase());
      if (aExcluded !== bExcluded) return aExcluded ? 1 : -1;
      return (a.item.basePrice || 0) - (b.item.basePrice || 0);
    }
    if (preferPremium && aHasPrice && bHasPrice) {
      if (Math.abs(b.score - a.score) <= 40) {
        return (b.item.basePrice || 0) - (a.item.basePrice || 0);
      }
    }
    if (b.score !== a.score) return b.score - a.score;
    const aP = aHasPrice ? a.item.basePrice! : Infinity;
    const bP = bHasPrice ? b.item.basePrice! : Infinity;
    return preferPremium ? bP - aP : aP - bP;
  });

  return scored.slice(0, limit).map((s) => s.item);
}

/**
 * When a strict budget query (e.g. "pulpits under Rs 5,000") yields 0 verified within-budget matches,
 * returns the lowest verified starting price in that category and any custom-quote alternatives
 * so ACRIO can explain honestly without returning over-budget or unpriced items as false matches.
 */
export function getEcosystemBudgetFallbackInfo(
  items: MainWebsiteProduct[],
  searchQuery: string,
  options?: EcosystemSearchOptions
): {
  lowestAvailablePrice: number | null;
  lowestAvailableItem: MainWebsiteProduct | null;
  customQuoteCount: number;
} {
  const withoutBudgetMatches = searchEcosystemItems(items, searchQuery, 25, {
    ...options,
    minPrice: null,
    maxPrice: null,
  });
  const priced = withoutBudgetMatches
    .filter((it) => typeof it.basePrice === "number" && it.basePrice > 0)
    .sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));
  const unpriced = withoutBudgetMatches.filter(
    (it) => !(typeof it.basePrice === "number" && it.basePrice > 0)
  );
  return {
    lowestAvailablePrice: priced[0]?.basePrice ?? null,
    lowestAvailableItem: priced[0] ?? null,
    customQuoteCount: unpriced.length,
  };
}

export async function fetchClassicCatalogProducts(
  searchQuery = "",
  limit = 12
): Promise<MainWebsiteProduct[]> {
  const [ccItems, ceItems] = await Promise.all([
    loadAllClassicConceptsProducts(),
    loadAllClassicEdgeItems(),
  ]);
  return searchEcosystemItems([...ccItems, ...ceItems], searchQuery, limit);
}
