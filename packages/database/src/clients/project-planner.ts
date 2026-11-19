import {
  extractBudgetConstraintsFromQuery,
  extractExplicitProductOrModelCodes,
} from "./catalog-search-helpers";
import {
  cleanDisplayProductName,
  type MainWebsiteProduct,
} from "./catalog-types";

export interface MultiItemProjectLine {
  requestedLabel: string;
  quantity: number;
  categoryKey: "podium" | "signage" | "chair_furniture" | "table_furniture" | "trophy_gift" | "stand_display";
  economyMatch?: MainWebsiteProduct;
  economyUnitPrice: number;
  standardMatch?: MainWebsiteProduct;
  standardUnitPrice: number;
}

export interface MultiItemProjectPlanResult {
  isMultiItemOrTotalling: boolean;
  lines: MultiItemProjectLine[];
  budgetLimit: number | null;
  summaryText: string;
  matchedProducts: MainWebsiteProduct[];
  needsSalesTeamPing: boolean;
}

/**
 * Multi-Item Quantity & Project Budget Totalling Engine.
 */
export function buildMultiItemProjectPlan(
  allItems: MainWebsiteProduct[],
  rawQuery: string,
  shortLinkMap?: Record<string, string>
): MultiItemProjectPlanResult {
  const q = String(rawQuery || "").trim();
  const qLower = q.toLowerCase();
  const budgetInfo = extractBudgetConstraintsFromQuery(q);
  const budgetLimit = budgetInfo.maxPrice;

  const getLink = (it: MainWebsiteProduct) => {
    const kSlug = `PRODUCT:${it.slug}`.toLowerCase();
    const kId = `PRODUCT:${it.id}`.toLowerCase();
    return (
      shortLinkMap?.[kSlug] ||
      shortLinkMap?.[kId] ||
      it.shortUrl ||
      it.url ||
      `https://www.classicconcepts.in/products/${it.slug}`
    );
  };

  const explicitCodes = extractExplicitProductOrModelCodes(q);
  const qtyRegexes: Array<{
    key: MultiItemProjectLine["categoryKey"];
    label: string;
    pattern: RegExp;
  }> = [
    {
      key: "podium",
      label: "Acrylic Podiums",
      pattern: /\b(?:approx(?:imately)?\s*|around\s*|about\s*)?(\d{1,3})\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:podiums?|pulpits?|lecterns?|rostrums?)\b/i,
    },
    {
      key: "signage",
      label: "Acrylic Office Name Plates / Signages",
      pattern: /\b(?:approx(?:imately)?\s*|around\s*|about\s*)?(\d{1,3})\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:signages?|signs?|office\s*name\s*plates?|name\s*plates?|nameplates?|name\s*boards?)\b/i,
    },
    {
      key: "chair_furniture",
      label: "Acrylic Chairs / Stools",
      pattern: /\b(?:approx(?:imately)?\s*|around\s*|about\s*)?(\d{1,3})\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:chairs?|stools?|seating)\b/i,
    },
    {
      key: "table_furniture",
      label: "Acrylic Tables / Desks",
      pattern: /\b(?:approx(?:imately)?\s*|around\s*|about\s*)?(\d{1,3})\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:tables?|desks?|consoles?)\b/i,
    },
    {
      key: "trophy_gift",
      label: "Acrylic Trophies / Corporate Gifts",
      pattern: /\b(?:approx(?:imately)?\s*|around\s*|about\s*)?(\d{1,3})\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:trophies|trophy|mementos?|awards?|corporate\s*gifts?|gifts?)\b/i,
    },
    {
      key: "stand_display",
      label: "Acrylic Display / Menu Stands",
      pattern: /\b(?:approx(?:imately)?\s*|around\s*|about\s*)?(\d{1,3})\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:menu\s*stands?|qr\s*stands?|sign\s*holders?|tent\s*cards?|display\s*stands?)\b/i,
    },
  ];

  const lines: MultiItemProjectLine[] = [];
  const matchedProducts: MainWebsiteProduct[] = [];
  const addProductUnique = (p?: MainWebsiteProduct) => {
    if (p && !matchedProducts.some((m) => m.slug === p.slug)) {
      matchedProducts.push(p);
    }
  };

  const pricedPodiums = allItems
    .filter(
      (i) =>
        i.brand === "CLASSIC_CONCEPTS" &&
        typeof i.basePrice === "number" &&
        i.basePrice > 0 &&
        /\b(podium|pulpit|lectern)\b|^ccp\d/i.test(`${i.name} ${i.categoryName} ${i.sku || ""}`)
    )
    .sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));

  const chairsAndStools = allItems
    .filter(
      (i) =>
        i.brand === "CLASSIC_CONCEPTS" &&
        typeof i.basePrice === "number" &&
        i.basePrice > 0 &&
        /\b(chair|stool|bar\s*stool|seating)\b/i.test(`${i.name} ${i.categoryName}`)
    )
    .sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));

  const tablesList = allItems
    .filter(
      (i) =>
        i.brand === "CLASSIC_CONCEPTS" &&
        typeof i.basePrice === "number" &&
        i.basePrice > 0 &&
        /\b(table|desk|console|pedestal)\b/i.test(`${i.name} ${i.categoryName}`) &&
        !/\b(table\s*top|tent\s*card|sign\s*holder|menu)\b/i.test(i.name)
    )
    .sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));

  const signagesList = allItems
    .filter(
      (i) =>
        i.brand === "CLASSIC_CONCEPTS" &&
        /\b(signage|name\s*plate|nameplate|sign\s*holder|frame)\b/i.test(`${i.name} ${i.categoryName}`)
    )
    .sort((a, b) => (a.basePrice || 999999) - (b.basePrice || 999999));

  const trophiesList = allItems
    .filter(
      (i) =>
        i.brand === "CLASSIC_CONCEPTS" &&
        typeof i.basePrice === "number" &&
        i.basePrice > 0 &&
        /\b(trophy|memento|award|plaque)\b/i.test(`${i.name} ${i.categoryName}`)
    )
    .sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));

  const standsList = allItems
    .filter(
      (i) =>
        i.brand === "CLASSIC_CONCEPTS" &&
        typeof i.basePrice === "number" &&
        i.basePrice > 0 &&
        /\b(sign\s*holder|menu|tent\s*card|qr\s*stand|brochure)\b/i.test(`${i.name} ${i.categoryName}`)
    )
    .sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));

  for (const def of qtyRegexes) {
    const m = q.match(def.pattern);
    if (m && m[1]) {
      const qty = parseInt(m[1], 10);
      if (qty > 0 && qty <= 500) {
        if (def.key === "podium") {
          const econ = pricedPodiums[0];
          const std = pricedPodiums.find((p) => (p.basePrice || 0) >= 13500) || pricedPodiums[1] || econ;
          addProductUnique(econ);
          addProductUnique(std);
          lines.push({
            requestedLabel: def.label,
            quantity: qty,
            categoryKey: def.key,
            economyMatch: econ,
            economyUnitPrice: econ?.basePrice || 7150,
            standardMatch: std,
            standardUnitPrice: std?.basePrice || 13750,
          });
        } else if (def.key === "signage") {
          const signMatch = signagesList.find((s) => /signage|name/i.test(s.name)) || signagesList[0];
          const signHolder = standsList[0] || signagesList.find((s) => (s.basePrice || 0) > 0);
          addProductUnique(signMatch);
          addProductUnique(signHolder);
          lines.push({
            requestedLabel: def.label,
            quantity: qty,
            categoryKey: def.key,
            economyMatch: signHolder || signMatch,
            economyUnitPrice: signHolder?.basePrice || 550,
            standardMatch: signMatch,
            standardUnitPrice: 1200,
          });
        } else if (def.key === "chair_furniture") {
          const stoolMatch = chairsAndStools[0];
          const chairMatch =
            chairsAndStools.find((c) => /chair/i.test(c.name)) ||
            chairsAndStools[1] ||
            stoolMatch;
          addProductUnique(chairMatch);
          addProductUnique(stoolMatch);
          lines.push({
            requestedLabel: def.label,
            quantity: qty,
            categoryKey: def.key,
            economyMatch: stoolMatch,
            economyUnitPrice: stoolMatch?.basePrice || 9350,
            standardMatch: chairMatch,
            standardUnitPrice: chairMatch?.basePrice || 15950,
          });
        } else if (def.key === "table_furniture") {
          const econTable = tablesList[0];
          const stdTable = tablesList[1] || econTable;
          addProductUnique(econTable);
          addProductUnique(stdTable);
          lines.push({
            requestedLabel: def.label,
            quantity: qty,
            categoryKey: def.key,
            economyMatch: econTable,
            economyUnitPrice: econTable?.basePrice || 5500,
            standardMatch: stdTable,
            standardUnitPrice: stdTable?.basePrice || 8800,
          });
        } else if (def.key === "trophy_gift") {
          const econTrophy = trophiesList[0];
          const stdTrophy = trophiesList[Math.min(2, trophiesList.length - 1)] || econTrophy;
          addProductUnique(econTrophy);
          addProductUnique(stdTrophy);
          lines.push({
            requestedLabel: def.label,
            quantity: qty,
            categoryKey: def.key,
            economyMatch: econTrophy,
            economyUnitPrice: econTrophy?.basePrice || 950,
            standardMatch: stdTrophy,
            standardUnitPrice: stdTrophy?.basePrice || 1650,
          });
        } else if (def.key === "stand_display") {
          const econStand = standsList[0];
          const stdStand = standsList[1] || econStand;
          addProductUnique(econStand);
          addProductUnique(stdStand);
          lines.push({
            requestedLabel: def.label,
            quantity: qty,
            categoryKey: def.key,
            economyMatch: econStand,
            economyUnitPrice: econStand?.basePrice || 220,
            standardMatch: stdStand,
            standardUnitPrice: stdStand?.basePrice || 550,
          });
        }
      }
    }
  }

  if (lines.length === 0 && explicitCodes.length === 1) {
    const qtyMatch = q.match(/\b(\d{1,3})\s*(?:pcs?|pieces?|units?|nos?|of)?\b/i);
    const asksTotal = /\b(total|cost\s*for|price\s*for|quote\s*for|amount\s*for)\b/i.test(qLower);
    if (qtyMatch && asksTotal) {
      const qty = parseInt(qtyMatch[1], 10);
      const code = explicitCodes[0];
      const hit = allItems.find((it) => {
        const skuC = (it.sku || "").toLowerCase().replace(/[-_\s]+/g, "");
        return skuC === code || skuC.includes(code);
      });
      if (hit && hit.basePrice && qty > 1 && qty <= 500) {
        addProductUnique(hit);
        const lineTotal = hit.basePrice * qty;
        return {
          isMultiItemOrTotalling: true,
          lines: [
            {
              requestedLabel: cleanDisplayProductName(hit.name),
              quantity: qty,
              categoryKey: "podium",
              economyMatch: hit,
              economyUnitPrice: hit.basePrice,
              standardMatch: hit,
              standardUnitPrice: hit.basePrice,
            },
          ],
          budgetLimit,
          summaryText: [
            `Here is the total calculation for *${qty} units* of *${cleanDisplayProductName(hit.name)}*:`,
            `• Unit Price: *₹${hit.basePrice.toLocaleString("en-IN")}*`,
            `• Quantity: *${qty} units*`,
            `• *Estimated Total*: *₹${lineTotal.toLocaleString("en-IN")}* (${getLink(hit)})`,
            `For ${qty} units, our sales team can also offer a bulk order discount. Tell me your delivery city and I will have our sales team share the discounted final quote right here.`,
          ].join("\n"),
          matchedProducts,
          needsSalesTeamPing: qty >= 3,
        };
      }
    }
  }

  const isMultiItem =
    lines.length >= 2 ||
    (lines.length === 1 &&
      lines[0].quantity >= 2 &&
      (budgetLimit !== null || /\b(total|budget|renovation|package|combination|options)\b/i.test(qLower)));
  if (!isMultiItem) {
    return {
      isMultiItemOrTotalling: false,
      lines: [],
      budgetLimit,
      summaryText: "",
      matchedProducts: [],
      needsSalesTeamPing: false,
    };
  }

  let economyGrandTotal = 0;
  let standardGrandTotal = 0;
  const breakdownBullets: string[] = [];

  for (const ln of lines) {
    const econLineTotal = ln.economyUnitPrice * ln.quantity;
    const stdLineTotal = ln.standardUnitPrice * ln.quantity;
    economyGrandTotal += econLineTotal;
    standardGrandTotal += stdLineTotal;

    if (ln.categoryKey === "signage") {
      const refLink = ln.standardMatch ? ` (${getLink(ln.standardMatch)})` : "";
      breakdownBullets.push(
        `• *${ln.quantity} × ${ln.requestedLabel}*: Standard Desk/Door Sign Holders at ₹${ln.economyUnitPrice.toLocaleString("en-IN")} each = *₹${econLineTotal.toLocaleString("en-IN")}*, or Custom Engraved Acrylic Office Name Plates (~₹1,000 to ₹1,500 each) = *₹${(ln.quantity * 1200).toLocaleString("en-IN")}*${refLink}`
      );
    } else {
      const econTitle = ln.economyMatch ? cleanDisplayProductName(ln.economyMatch.name) : ln.requestedLabel;
      const econLink = ln.economyMatch ? ` - ${getLink(ln.economyMatch)}` : "";
      const stdTitle =
        ln.standardMatch && ln.standardMatch.slug !== ln.economyMatch?.slug
          ? cleanDisplayProductName(ln.standardMatch.name)
          : null;
      const stdNote = stdTitle
        ? ` (or *${stdTitle}* at ₹${ln.standardUnitPrice.toLocaleString("en-IN")} × ${ln.quantity} = *₹${stdLineTotal.toLocaleString("en-IN")}*)`
        : "";
      breakdownBullets.push(
        `• *${ln.quantity} × ${ln.requestedLabel}*: *${econTitle}* at ₹${ln.economyUnitPrice.toLocaleString("en-IN")} × ${ln.quantity} = *₹${econLineTotal.toLocaleString("en-IN")}*${stdNote}${econLink}`
      );
    }
  }

  const summaryParts: string[] = [];
  if (budgetLimit !== null) {
    summaryParts.push(
      `Here is the itemized cost breakdown for your project against your *₹${budgetLimit.toLocaleString("en-IN")}* budget:`
    );
  } else {
    summaryParts.push(`Here is the itemized quantity and price breakdown for your requirement:`);
  }
  summaryParts.push(...breakdownBullets);
  summaryParts.push(
    `\n*Standard Catalog Total*: *₹${economyGrandTotal.toLocaleString("en-IN")}*${standardGrandTotal > economyGrandTotal ? ` (up to *₹${standardGrandTotal.toLocaleString("en-IN")}* with full-size models)` : ""}`
  );

  if (budgetLimit !== null && economyGrandTotal > budgetLimit) {
    const chairLine = lines.find((l) => l.categoryKey === "chair_furniture");
    const podiumLine = lines.find((l) => l.categoryKey === "podium");
    const signLine = lines.find((l) => l.categoryKey === "signage");

    const fixedPodiumCost = podiumLine ? podiumLine.economyUnitPrice * podiumLine.quantity : 0;
    const fixedSignCost = signLine ? 1000 * signLine.quantity : 0;
    const remainingForChairs = Math.max(0, budgetLimit - fixedPodiumCost - fixedSignCost);

    if (chairLine && chairLine.economyUnitPrice > 0) {
      const affordableChairQty = Math.max(1, Math.floor(remainingForChairs / chairLine.economyUnitPrice));
      const adjustedChairTotal = affordableChairQty * chairLine.economyUnitPrice;
      const adjustedGrandTotal = fixedPodiumCost + fixedSignCost + adjustedChairTotal;
      summaryParts.push(
        `\n*2 Ways to Plan Within Your ₹${budgetLimit.toLocaleString("en-IN")} Budget:*`,
        `1. *Within-Budget Ready Combination (~₹${adjustedGrandTotal.toLocaleString("en-IN")})*: ${podiumLine ? `${podiumLine.quantity} × ${cleanDisplayProductName(podiumLine.economyMatch?.name || "Acrylic Podium CCP057S")} (₹${fixedPodiumCost.toLocaleString("en-IN")}) + ` : ""}${signLine ? `${signLine.quantity} × Custom Office Name Plates (₹${fixedSignCost.toLocaleString("en-IN")}) + ` : ""}${affordableChairQty} × ${cleanDisplayProductName(chairLine.economyMatch?.name || "Acrylic Bar Stool / Chair")} (₹${adjustedChairTotal.toLocaleString("en-IN")}).`,
        `2. *Full ${chairLine.quantity}-Chair Project Package (₹${economyGrandTotal.toLocaleString("en-IN")} list price)*: Take all ${lines.map((l) => `${l.quantity} ${l.requestedLabel.toLowerCase()}`).join(" + ")} and our sales team can work out a bulk corporate discount for your office renovation.`
      );
    } else {
      summaryParts.push(
        `\nSince the standard catalog total (*₹${economyGrandTotal.toLocaleString("en-IN")}*) is slightly above your *₹${budgetLimit.toLocaleString("en-IN")}* target, our sales team can offer a bulk package discount or customize sheet thickness to fit your budget.`
      );
    }
  }

  summaryParts.push(
    `\nI have also pinged our Sales Team on this chat with your item list so they can share bulk pricing. Which option works best for you, and which city is the delivery for?`
  );

  return {
    isMultiItemOrTotalling: true,
    lines,
    budgetLimit,
    summaryText: summaryParts.join("\n"),
    matchedProducts,
    needsSalesTeamPing: true,
  };
}
