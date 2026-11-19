import {
  extractCompactDimensionPairsFromText,
  extractExplicitProductOrModelCodes,
} from "./catalog-search-helpers";
import {
  cleanDisplayProductName,
  type MainWebsiteProduct,
} from "./catalog-types";

function parseMeasurementValuesFromSpec(val: string): {
  numbers: number[];
  area: number | null;
  maxNumber: number | null;
} {
  const nums = Array.from(val.matchAll(/\d+(?:\.\d+)?/g))
    .map((m) => Number(m[0]))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return { numbers: [], area: null, maxNumber: null };
  const areaMatch = val.match(/(\d+(?:\.\d+)?)\s*(?:x|×|by|\*)\s*(\d+(?:\.\d+)?)/i);
  const area = areaMatch ? Number(areaMatch[1]) * Number(areaMatch[2]) : null;
  const maxNumber = Math.max(...nums);
  return { numbers: nums, area, maxNumber };
}

/**
 * Stage 2 Question-Aware Deep Product Context & Deterministic Answer Builder for WhatsApp & Admin Copilot.
 * Formats only the relevant deep fields (dimensions, specifications, variants, features, models, notes, resources)
 * for Claude Haiku 5.5 and produces a verified factual answer for comparisons, dimensions, variants, and unverified specs.
 */
export function buildEcosystemDeepProductContextAndAnswer(params: {
  rawQuery: string;
  matchedItems: MainWebsiteProduct[];
  formatItemLink?: (item: MainWebsiteProduct) => string;
}): {
  promptCatalogContext: string;
  deterministicDeepAnswer: string | null;
  isDeepQuestion: boolean;
} {
  const { rawQuery, matchedItems, formatItemLink } = params;
  const q = rawQuery.trim().toLowerCase();
  const getLink = (it: MainWebsiteProduct) =>
    formatItemLink ? formatItemLink(it) : it.url;

  const isComparison =
    /\b(compare|comparison|difference|differences|differ|vs\.?|versus|between|wider|widest|larger|largest|bigger|biggest|taller|tallest|heavier|heaviest|which\s+one|which\s+of\s+these|which\s+podium|which\s+machine|which\s+model)\b/i.test(
      q
    );
  const isDimensionQuery =
    /\b(dimension|dimensions|size|sizes|height|width|wide|wider|depth|length|top\s*sheet|reading\s*top|reading\s*surface|bottom\s*sheet|base\s*size|front\s*panel|shelf\s*size|logo\s*panel|inch|inches|mm|cm|feet|ft|footprint)\b/i.test(
      q
    );
  const isVariantQuery =
    /\b(variant|variants|color|colors|colour|colours|finish|finishes|led|frosted|black|white|clear|silver|golden|gold|stainless|price\s+difference)\b/i.test(
      q
    );
  const isFeatureOrSpecQuery =
    /\b(spec|specs|specification|specifications|feature|features|material|pillar|pillars|wheel|wheels|warranty|weight|assembly|diy|note|notes|packaging|delivery|application|applications|industry|industries|brochure|manual|datasheet|video|consumable|consumables|model|models|spindle|power|thickness|working\s*length|working\s*area|bending\s*width)\b/i.test(
      q
    );
  const unverifiedThicknessOrSpecMatch = q.match(
    /\b(?:can\s+(?:this|the|it)|does\s+(?:this|the|it)|process|bend|cut|polish|support|handle)\b.*?\b(\d+)\s*(mm|inch|inches|kw|w|rpm|v|volt)\b|\b(motor\s+brand|power\s+consumption|exact\s+sheet\s+thickness|sheet\s+thickness\s+of\s+ccp\d+)\b/i
  );

  const explicitCodesInQuery = extractExplicitProductOrModelCodes(rawQuery);
  const queryDimsInDeep = extractCompactDimensionPairsFromText(rawQuery);
  const isSpecificModelOrTellMeQuery =
    explicitCodesInQuery.length > 0 ||
    queryDimsInDeep.pairs.length > 0 ||
    queryDimsInDeep.ranges.length > 0 ||
    /\b(tell\s+me\s+about|details\s+of|details\s+for|info\s+about|information\s+on|describe|what\s+is|everything\s+about)\b/i.test(
      q
    );

  const isDeepQuestion =
    isSpecificModelOrTellMeQuery ||
    isComparison ||
    isDimensionQuery ||
    isVariantQuery ||
    isFeatureOrSpecQuery ||
    Boolean(unverifiedThicknessOrSpecMatch);

  const promptLines = matchedItems.slice(0, 12).map((it, idx) => {
    const priceLabel =
      typeof it.basePrice === "number" && it.basePrice > 0
        ? `₹${it.basePrice.toLocaleString("en-IN")}${
            it.regularPrice && it.regularPrice > it.basePrice
              ? ` (MRP ₹${it.regularPrice.toLocaleString("en-IN")})`
              : ""
          }`
        : "Custom Quote on Request";
    const lines: string[] = [
      `${idx + 1}. [${it.brandLabel}] *${it.name}*${it.sku ? ` (SKU/Model: ${it.sku})` : ""} | Category: ${it.categoryName} | Price: ${priceLabel} | Link: ${getLink(it)}`,
    ];

    if (it.dimensions && it.dimensions.length > 0) {
      lines.push(
        `   - Verified Dimensions: ${it.dimensions.map((d) => `${d.label || d.key || ""}: ${d.value}`).join("; ")}`
      );
    }
    const techSpecs = (it.specifications || []).filter((s) => s.type !== "dimension");
    if (techSpecs.length > 0) {
      lines.push(
        `   - Verified Technical Specifications: ${techSpecs.map((s) => `${s.label || s.key || ""}: ${s.value}`).join("; ")}`
      );
    } else if (it.specsSummary && (!it.dimensions || it.dimensions.length === 0)) {
      lines.push(`   - Verified Specifications: ${it.specsSummary}`);
    }
    if (it.variants && it.variants.length > 0) {
      lines.push(
        `   - Variants & Option Prices: ${it.variants
          .map((v) =>
            typeof v.price === "number" && v.price > 0
              ? `${v.name} (₹${v.price.toLocaleString("en-IN")})`
              : v.name
          )
          .join(", ")}`
      );
    }
    if (it.features && it.features.length > 0) {
      lines.push(`   - Key Features: ${it.features.slice(0, 8).join(" | ")}`);
    }
    if (it.models && it.models.length > 0) {
      for (const m of it.models) {
        const mSpecs = m.specifications.map((s) => `${s.label || s.key || ""}: ${s.value}`).join("; ");
        lines.push(`   - Machine Model [${m.modelName}]: ${mSpecs || "Standard configuration"}`);
      }
    }
    if (it.descriptionHtmlText || it.description) {
      lines.push(
        `   - Detailed Description: ${(it.descriptionHtmlText || it.description || "").slice(0, 420)}`
      );
    }
    if (it.importantNoteText) {
      lines.push(`   - Important Note: ${it.importantNoteText.slice(0, 260)}`);
    }
    if (it.industries && it.industries.length > 0) {
      lines.push(
        `   - Applications / Industries: ${it.industries
          .map((ind) => (typeof ind === "string" ? ind : ind.name))
          .join(", ")}`
      );
    }
    if (it.relatedConsumables && it.relatedConsumables.length > 0) {
      lines.push(
        `   - Compatible Consumables: ${it.relatedConsumables
          .map((c) => (typeof c === "string" ? c : c.name))
          .join(", ")}`
      );
    }
    if (it.resources && it.resources.length > 0) {
      lines.push(
        `   - Technical Resources: ${it.resources.map((r) => `${r.title || r.name || "Resource"}${r.type ? ` (${r.type})` : ""}`).join(", ")}`
      );
    }
    return lines.join("\n");
  });

  const promptCatalogContext = promptLines.join("\n\n");

  if (!isDeepQuestion || matchedItems.length === 0) {
    return {
      promptCatalogContext,
      deterministicDeepAnswer: null,
      isDeepQuestion,
    };
  }

  if (unverifiedThicknessOrSpecMatch) {
    const primary = matchedItems[0];
    const requestedNum = unverifiedThicknessOrSpecMatch[1]
      ? Number(unverifiedThicknessOrSpecMatch[1])
      : null;
    const requestedUnit = (unverifiedThicknessOrSpecMatch[2] || "").toLowerCase();

    if (primary.brand === "CLASSIC_EDGE_53") {
      const targetModel =
        (primary.models || []).find((m) =>
          q.replace(/[-_\s]+/g, "").includes(m.modelName.toLowerCase().replace(/[-_\s]+/g, ""))
        ) || (primary.models || [])[0];
      const allSpecs = [
        ...(targetModel?.specifications || []),
        ...(primary.specifications || []),
      ];
      const thicknessSpec = allSpecs.find((s) =>
        /thickness/i.test(s.label || s.key || "")
      );
      if (thicknessSpec && requestedNum && requestedUnit === "mm") {
        const parsed = parseMeasurementValuesFromSpec(thicknessSpec.value);
        if (parsed.maxNumber !== null && requestedNum > parsed.maxNumber) {
          const otherModel = (primary.models || []).find(
            (m) => m.modelName !== targetModel?.modelName
          );
          const otherThickness = otherModel?.specifications.find((s) =>
            /thickness/i.test(s.label || s.key || "")
          );
          const lines: string[] = [
            `Based on our verified catalog specifications for the *${primary.name}*${targetModel ? ` (*${targetModel.modelName}*)` : ""}, its rated sheet thickness capacity is *${thicknessSpec.value}*, so *${requestedNum} mm* exceeds the verified limit for that model.`,
          ];
          if (otherModel && otherThickness) {
            lines.push(
              `• *${otherModel.modelName}* supports *${otherThickness.value}*.`
            );
          }
          lines.push(
            `• Product Specs: ${primary.specsSummary || thicknessSpec.value}`,
            `• View details: ${getLink(primary)}`,
            `\nIf you need to process *${requestedNum} mm* acrylic sheets, please share your application and our Classic Edge 53 engineering team will confirm the right heavy-duty machine or custom heating/cutting setup.`
          );
          return {
            promptCatalogContext,
            deterministicDeepAnswer: lines.join("\n"),
            isDeepQuestion: true,
          };
        }
      }
    }

    if (
      primary.brand === "CLASSIC_CONCEPTS" &&
      /\b(thickness\s+in\s+mm|sheet\s+thickness|how\s+many\s+mm\s+thick|motor\s+brand|wattage)\b/i.test(
        q
      )
    ) {
      const hasThicknessInSpecs = (primary.specifications || []).some((s) =>
        /\b\d+\s*mm\b/i.test(`${s.label || s.key || ""} ${s.value}`)
      );
      if (!hasThicknessInSpecs) {
        const verifiedDims = (primary.dimensions || [])
          .map((d) => `${d.label || d.key || ""}: ${d.value}`)
          .join(", ");
        const verifiedSpecs = (primary.specifications || [])
          .filter((s) => s.type !== "dimension")
          .map((s) => `${s.label || s.key || ""}: ${s.value}`)
          .join(", ");
        return {
          promptCatalogContext,
          deterministicDeepAnswer: [
            `The exact acrylic sheet thickness in millimetres is not listed in the stored specifications for *${primary.name}* (${getLink(primary)}), so I will not guess that figure.`,
            verifiedDims ? `• *Verified Dimensions:* ${verifiedDims}` : "",
            verifiedSpecs ? `• *Verified Specifications:* ${verifiedSpecs}` : "",
            `\nReply here if you would like our manufacturing team in Hyderabad to confirm the exact sheet gauge for each panel or customize the thickness for your order.`,
          ]
            .filter(Boolean)
            .join("\n"),
          isDeepQuestion: true,
        };
      }
    }
  }

  const machineWithModels = matchedItems.find(
    (it) => it.brand === "CLASSIC_EDGE_53" && (it.models || []).length >= 2
  );
  if (
    machineWithModels &&
    (isComparison ||
      (machineWithModels.models || []).some((m) =>
        q.replace(/[-_\s]+/g, "").includes(m.modelName.toLowerCase().replace(/[-_\s]+/g, ""))
      ))
  ) {
    const models = machineWithModels.models || [];
    const prodSpecs = (machineWithModels.specifications || [])
      .map((s) => `${s.label || s.key || ""}: ${s.value}`)
      .join(", ");
    const modelLines = models.map((m) => {
      const mSpecText = m.specifications.map((s) => `${s.label || s.key || ""}: ${s.value}`).join(" | ");
      return `• *${m.modelName}*: ${mSpecText}`;
    });
    const featureLine =
      machineWithModels.features && machineWithModels.features.length > 0
        ? `• *Key Highlights*: ${machineWithModels.features.slice(0, 3).join("; ")}`
        : "";
    return {
      promptCatalogContext,
      deterministicDeepAnswer: [
        `Here are the verified specifications for the *${machineWithModels.name}* (${getLink(machineWithModels)}):`,
        prodSpecs ? `• *General Machine Specs*: ${prodSpecs}` : "",
        ...modelLines,
        featureLine,
        machineWithModels.relatedConsumables && machineWithModels.relatedConsumables.length > 0
          ? `• *Compatible Consumables*: ${machineWithModels.relatedConsumables.map((c) => (typeof c === "string" ? c : c.name)).join(", ")}`
          : "",
        `\nClassic Edge 53 machines are quoted based on the model and factory configuration. Share your preferred model (*${models.map((m) => m.modelName).join("* or *")}*) and city for an official quotation.`,
      ]
        .filter(Boolean)
        .join("\n"),
      isDeepQuestion: true,
    };
  }

  if (isComparison && matchedItems.length >= 2) {
    const explicitCodes = extractExplicitProductOrModelCodes(q);
    const explicitMatched =
      explicitCodes.length >= 2
        ? matchedItems.filter((it) => {
            const skuText = `${it.sku || ""} ${it.name} ${it.slug}`.toLowerCase();
            return explicitCodes.some((c: string) =>
              new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(skuText)
            );
          })
        : [];
    const candidates =
      explicitMatched.length >= 2 ? explicitMatched : matchedItems.slice(0, 3);
    const wantsReadingTop = /\b(reading\s*top|top\s*sheet|reading\s*surface|top\s*size)\b/i.test(q);
    const wantsWider = /\b(wider|widest|width|larger|largest|bigger|biggest)\b/i.test(q);

    let winnerNote = "";
    if (wantsReadingTop || wantsWider) {
      let bestItem: MainWebsiteProduct | null = null;
      let bestSpecValue = "";
      let bestMetric = -1;

      for (const it of candidates) {
        const allDims = it.dimensions || [];
        const targetSpec = wantsReadingTop
          ? allDims.find((d) => /top\s*sheet|reading/i.test(d.label || d.key || "")) || allDims[0]
          : allDims.find((d) => /top\s*sheet|bottom\s*sheet|front\s*panel|width/i.test(d.label || d.key || "")) ||
            allDims[0];
        if (targetSpec) {
          const parsed = parseMeasurementValuesFromSpec(targetSpec.value);
          const metric = wantsReadingTop
            ? parsed.area ?? parsed.maxNumber ?? -1
            : parsed.maxNumber ?? parsed.area ?? -1;
          if (metric > bestMetric) {
            bestMetric = metric;
            bestItem = it;
            bestSpecValue = `${targetSpec.label || targetSpec.key || ""}: ${targetSpec.value}`;
          }
        }
      }
      if (bestItem) {
        winnerNote = wantsReadingTop
          ? `*${bestItem.name}* has the largest reading top among these options (*${bestSpecValue}*).`
          : `*${bestItem.name}* has the wider dimensions among these options (*${bestSpecValue}*).`;
      }
    }

    const itemLines = candidates.map((it) => {
      const priceText =
        typeof it.basePrice === "number" && it.basePrice > 0
          ? `₹${it.basePrice.toLocaleString("en-IN")}`
          : "Custom Quote";
      const dims = (it.dimensions || [])
        .map((d) => `${d.label || d.key || ""}: ${d.value}`)
        .join(", ");
      const tech = (it.specifications || [])
        .filter((s) => s.type !== "dimension")
        .map((s) => `${s.label || s.key || ""}: ${s.value}`)
        .join(", ");
      const vars =
        it.variants && it.variants.length > 0
          ? `Variants: ${it.variants
              .map((v) =>
                typeof v.price === "number" && v.price > 0
                  ? `${v.name} (₹${v.price.toLocaleString("en-IN")})`
                  : v.name
              )
              .join(", ")}`
          : "";
      return [
        `• *${it.name}* (${priceText}) - ${getLink(it)}`,
        dims ? `  Dimensions: ${dims}` : "",
        tech ? `  Specs: ${tech}` : "",
        vars ? `  ${vars}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    });

    return {
      promptCatalogContext,
      deterministicDeepAnswer: [
        winnerNote || `Here is a side-by-side comparison from our verified catalog:`,
        ...itemLines,
        `\nLet me know which model or variant you prefer and I can share delivery timelines or prepare a quote.`,
      ]
        .filter(Boolean)
        .join("\n"),
      isDeepQuestion: true,
    };
  }

  const item = matchedItems[0];
  const cleanTitle = cleanDisplayProductName(item.name);
  const hasMrp = item.regularPrice && item.basePrice && item.regularPrice > item.basePrice;
  const priceStr =
    typeof item.basePrice === "number" && item.basePrice > 0
      ? `₹${item.basePrice.toLocaleString("en-IN")}${hasMrp ? ` (MRP ₹${item.regularPrice!.toLocaleString("en-IN")})` : ""}`
      : "Custom Quote on Request";
  const asksExhaustivePanelSpecs =
    /\b(all\s*dimensions|full\s*dimensions|every\s*dimension|panel\s*sizes?|bottom\s*sheet|front\s*panel|shelf\s*size|logo\s*panel|sheet\s*thickness|all\s*specs|complete\s*specs)\b/i.test(
      q
    );

  const detailLines: string[] = [
    `*${cleanTitle}* (${priceStr})`,
  ];

  if (asksExhaustivePanelSpecs) {
    if (item.dimensions && item.dimensions.length > 0) {
      detailLines.push(
        `• *Full Dimensions*: ${item.dimensions.map((d) => `${d.label || d.key || ""}: ${d.value}`).join(" | ")}`
      );
    }
    const techSpecs = (item.specifications || []).filter((s) => s.type !== "dimension");
    if (techSpecs.length > 0) {
      detailLines.push(
        `• *Technical Specs*: ${techSpecs.map((s) => `${s.label || s.key || ""}: ${s.value}`).join(" | ")}`
      );
    } else if (item.specsSummary) {
      detailLines.push(`• *Specifications*: ${item.specsSummary}`);
    }
  } else {
    const heightDim = (item.dimensions || []).find((d) => /height/i.test(d.label || d.key || ""));
    const topDim = (item.dimensions || []).find((d) => /top\s*sheet|reading\s*top|top\s*surface|size/i.test(d.label || d.key || ""));
    const otherDims = (item.dimensions || []).slice(0, 2);
    const keySizeParts: string[] = [];
    if (heightDim) keySizeParts.push(`Height ${heightDim.value}`);
    if (topDim && topDim !== heightDim) keySizeParts.push(`Top ${topDim.value}`);
    if (keySizeParts.length === 0 && otherDims.length > 0) {
      for (const d of otherDims) {
        keySizeParts.push(`${d.label || d.key || "Size"}: ${d.value}`);
      }
    }
    if (keySizeParts.length > 0) {
      detailLines.push(`• *Key Size*: ${keySizeParts.join(" | ")}`);
    }

    const techSpecs = (item.specifications || []).filter((s) => s.type !== "dimension");
    const keyTech = techSpecs
      .filter((s) => /material|pillar|warranty|power|work\s*area|thickness|finish|capacity/i.test(s.label || s.key || ""))
      .slice(0, 3);
    if (keyTech.length > 0) {
      detailLines.push(
        `• *Build & Specs*: ${keyTech.map((s) => `${s.label || s.key || ""}: ${s.value}`).join(" | ")}`
      );
    } else if (item.specsSummary) {
      detailLines.push(`• *Specs*: ${item.specsSummary}`);
    }
  }

  if (item.variants && item.variants.length > 0) {
    detailLines.push(
      `• *Options / Variants*: ${item.variants
        .slice(0, 6)
        .map((v) =>
          typeof v.price === "number" && v.price > 0 && v.price !== item.basePrice
            ? `${v.name} (₹${v.price.toLocaleString("en-IN")})`
            : v.name
        )
        .join(", ")}`
    );
  }
  if (item.features && item.features.length > 0) {
    detailLines.push(`• *Highlights*: ${item.features.slice(0, 3).join("; ")}`);
  }
  if (item.models && item.models.length > 0) {
    for (const m of item.models.slice(0, 3)) {
      detailLines.push(
        `• *Model ${m.modelName}*: ${m.specifications.slice(0, 4).map((s) => `${s.label || s.key || ""}: ${s.value}`).join(" | ")}`
      );
    }
  }
  detailLines.push(`• *Link*: ${getLink(item)}`);

  return {
    promptCatalogContext,
    deterministicDeepAnswer: detailLines.join("\n"),
    isDeepQuestion: true,
  };
}
