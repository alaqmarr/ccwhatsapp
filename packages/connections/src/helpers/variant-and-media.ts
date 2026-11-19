import {
  cleanDisplayProductName,
  extractCustomerCoreNouns,
  countCoreNounMatches,
  resolveWhatsAppWebAppOrigin,
  type MainWebsiteProduct,
} from "@cc/database";
import { normalizeCustomerProductTypos } from "./intent-classifier";
import type { AcrioMediaAttachment } from "./types";

export const ACRIO_COLOUR_WORDS = [
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

export function matchProductVariantsByColourTokens(
  variants: { id?: string; name: string; price: number | null; imageUrl?: string | null }[],
  queryText: string
): { id?: string; name: string; price: number | null; imageUrl?: string | null }[] {
  const queryTokens = extractNormalizedColourTokens(queryText);
  if (queryTokens.length === 0 || !variants || variants.length === 0) return [];

  const fullMatches = variants.filter((v) => {
    const vTokens = extractNormalizedColourTokens(v.name);
    return queryTokens.every((qt) => vTokens.includes(qt));
  });

  if (fullMatches.length === 0) return [];

  const exactTokenCountMatches = fullMatches.filter(
    (v) => extractNormalizedColourTokens(v.name).length === queryTokens.length
  );
  return exactTokenCountMatches.length > 0 ? exactTokenCountMatches : fullMatches;
}

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

export function isMultiProductReference(rawText: string): boolean {
  return /\b(all\s+(?:three|two|four|five|\d+|of\s+them)|both(?:\s+of\s+them)?|(?:these|those|the)\s+(?:two|three|four|five|\d+)|each\s+of\s+them|their\s+(?:imag[a-z]*|phot[a-z]*|pics?|pictures?))\b/i.test(
    String(rawText || "")
  );
}

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

export function isCatalogAggregateQuestion(rawText: string): boolean {
  return /\b(how\s+many|number\s+of|count\s+of|total\s+(?:number|products|models)|kitne|kitni|list\s+all|all\s+the\s+products|all\s+products)\b/i.test(
    rawText
  );
}

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

export function resolveCatalogPdfAttachments(
  allItems: MainWebsiteProduct[],
  rawText: string,
  focusItem?: MainWebsiteProduct | null
): { attachments: AcrioMediaAttachment[]; replyText: string } | null {
  if (!isCatalogPdfRequest(rawText)) return null;
  const lower = String(rawText || "").toLowerCase();
  const appOrigin = resolveWhatsAppWebAppOrigin();

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
