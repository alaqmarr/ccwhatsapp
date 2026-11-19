import { cleanDisplayProductName, type MainWebsiteProduct } from "@cc/database";
import type { CustomerImageAnalysis } from "@cc/connections/image-intelligence";
import type { AcrioConversationState } from "@cc/connections/helpers.acrio.ai";

export function cacheConversationImageAnalysis(
  state: AcrioConversationState,
  sha256: string,
  analysis: CustomerImageAnalysis,
  recordNewVisionCall: boolean
): void {
  const map = { ...(state.analyzedImagesBySha || {}) };
  map[sha256] = {
    ...analysis,
    sha256,
    analyzedAt: analysis.analyzedAt || new Date().toISOString(),
  };
  const keys = Object.keys(map);
  if (keys.length > 6) {
    keys
      .sort(
        (x, y) =>
          Date.parse(map[x]?.analyzedAt || "1970-01-01T00:00:00Z") -
          Date.parse(map[y]?.analyzedAt || "1970-01-01T00:00:00Z")
      )
      .slice(0, keys.length - 6)
      .forEach((oldKey) => {
        delete map[oldKey];
      });
  }
  state.analyzedImagesBySha = map;
  state.lastImageAnalysis = map[sha256];
  if (recordNewVisionCall) {
    const prev = state.imageAnalysisCountWindow;
    const prevStartMs = prev?.windowStartIso ? Date.parse(prev.windowStartIso) : 0;
    const withinHour = prevStartMs > 0 && Date.now() - prevStartMs <= 3600_000;
    state.imageAnalysisCountWindow = withinHour
      ? { windowStartIso: prev!.windowStartIso, count: Number(prev!.count || 0) + 1 }
      : { windowStartIso: new Date().toISOString(), count: 1 };
  }
}

export function buildPhaseIImageGuidancePrompt(
  analysis: CustomerImageAnalysis,
  fromCache: boolean
): string {
  const parts: string[] = [
    `Analyzed Customer Reference Image (${fromCache ? "per-conversation SHA-256 cache hit" : "fresh Claude Vision analysis"}):`,
    `- Detected item: ${analysis.productType || "unspecified item"} (domain hint: ${analysis.businessDomain})`,
    `- Visual traits: shape="${analysis.shapeAndDesign || "not clear"}", colour="${analysis.colorAppearance || "not clear"}", material appearance="${analysis.materialAppearance || "not clear"}"`,
  ];
  if (analysis.visibleComponents.length > 0) {
    parts.push(`- Visible components: ${analysis.visibleComponents.join(", ")}`);
  }
  if (analysis.readableModelCodes.length > 0) {
    parts.push(`- Clearly readable model codes: ${analysis.readableModelCodes.join(", ")}`);
  }
  if (analysis.readableDimensions) {
    parts.push(`- Clearly legible dimensions: ${analysis.readableDimensions}`);
  }
  if (analysis.unreadableDetails.length > 0) {
    parts.push(
      `- Missing / unclear details in the image: ${analysis.unreadableDetails.join(", ")}`
    );
  }
  parts.push(
    `CRITICAL IMAGE SAFETY & ACCURACY RULES FOR THIS REPLY:
- Do NOT claim you verified exact sheet thickness, dimensions, material grade, or model numbers unless clearly readable above or verified in our catalog.
- Treat visual colour/material observations carefully ("appears clear/frosted/black" rather than promising exact gauge).
- If CLASSIC_CONCEPTS product photo: present up to 3 closest catalog matches, briefly note similarities and differences vs their photo, and mention that exact match or custom tweaks can be confirmed with our team.
- If CLASSIC_EDGE_53 machinery photo and readableModelCodes is empty: list closest Classic Edge 53 machines in that category, NEVER invent or guess an unprinted model code, and clearly ask the customer to share the machine nameplate or model number.
- If design sketch/drawing or unreadable dimensions exist: summarize ONLY what is clearly legible, call out the unreadable/missing specs without inventing numbers, and confirm that you have forwarded the custom fabrication enquiry to our Sales & Fabrication Team ("needsHumanHandoff": true).`
  );
  return parts.join("\n");
}

export function buildPhaseIImageFallbackReply(params: {
  greetOnce: string;
  analysis: CustomerImageAnalysis;
  matches: MainWebsiteProduct[];
  hidePrices: boolean;
}): {
  reply: string;
  handoff: boolean;
  handoffReason: string;
  needsSalesPing: boolean;
  salesPingNote: string;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL";
} {
  const { greetOnce, analysis, matches, hidePrices } = params;
  const domainMatches =
    analysis.businessDomain === "CLASSIC_EDGE_53"
      ? matches.filter((m) => m.brand === "CLASSIC_EDGE_53")
      : analysis.businessDomain === "CLASSIC_CONCEPTS"
      ? matches.filter((m) => m.brand === "CLASSIC_CONCEPTS")
      : matches;
  const shown = (domainMatches.length > 0 ? domainMatches : matches).slice(0, 3);
  const formatMatchLine = (item: MainWebsiteProduct, idx: number) => {
    const title = cleanDisplayProductName(item.name);
    const priceBit =
      !hidePrices && typeof item.basePrice === "number" && item.basePrice > 0
        ? ` (₹${item.basePrice.toLocaleString("en-IN")})`
        : "";
    const link = item.shortUrl || item.url;
    const rawSummary = item.description || item.descriptionHtmlText || "";
    const summaryBit = rawSummary
      ? `: ${rawSummary.replace(/\s+/g, " ").trim().slice(0, 90)}`
      : "";
    return `${idx + 1}. *${title}*${priceBit}${summaryBit}\n   ${link}`;
  };

  if (analysis.isDesignSketchOrDrawing) {
    const legibleParts: string[] = [];
    if (analysis.productType) legibleParts.push(`• Item: *${analysis.productType}*`);
    if (analysis.shapeAndDesign) legibleParts.push(`• Design: ${analysis.shapeAndDesign}`);
    if (analysis.visibleComponents.length > 0) {
      legibleParts.push(`• Features seen: ${analysis.visibleComponents.join(", ")}`);
    }
    if (analysis.readableDimensions) {
      legibleParts.push(`• Readable dimensions: ${analysis.readableDimensions}`);
    }
    const missingText =
      analysis.unreadableDetails.length > 0
        ? analysis.unreadableDetails.join(", ")
        : "exact wall thickness, overall dimensions, and tolerance details";
    const lines = [
      `${greetOnce}Thank you for sharing your drawing/sketch! Here is what I could clearly read from the image:`,
      legibleParts.join("\n") || `• Custom *${analysis.productType || "acrylic fabrication"}* design`,
      `I could not reliably read *${missingText}* from the image alone, so I have avoided guessing those measurements.`,
      shown.length > 0
        ? `\nClosest reference items from our catalog:\n${shown.map(formatMatchLine).join("\n")}`
        : "",
      `\nI have prepared this custom enquiry and forwarded your sketch directly to our *Sales & Fabrication Team* so they can confirm feasibility, exact dimensions, and quotation right away.`,
    ].filter(Boolean);
    return {
      reply: lines.join("\n\n"),
      handoff: true,
      handoffReason: `Customer shared a custom design sketch (${analysis.productType || "custom acrylic item"}). Readable: [${analysis.readableDimensions || "design layout"}]. Unclear/missing: [${missingText}]. Forwarded for engineering & quote.`,
      needsSalesPing: false,
      salesPingNote: "",
      smartCategory: "Custom Fabrication",
      priority: "HIGH",
    };
  }

  if (analysis.businessDomain === "CLASSIC_EDGE_53") {
    const readableCodeLine =
      analysis.readableModelCodes.length > 0
        ? `Model reference visible: *${analysis.readableModelCodes.join(", ")}*.`
        : `The exact model number plate is not clearly readable in the photo, so I will not guess a model code.`;
    const askPlateLine =
      analysis.readableModelCodes.length === 0
        ? `Could you please share a closer photo of the *nameplate / serial sticker* or type the exact model number so I can confirm the right variant and spare parts?`
        : `Let me know if you need pricing, spare parts, or consumables for this model.`;
    const visualNote = [
      analysis.productType ? `Looks like a *${analysis.productType}*` : "Looks like an acrylic fabrication machine",
      analysis.visibleComponents.length > 0 ? `with ${analysis.visibleComponents.slice(0, 3).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const lines = [
      `${greetOnce}${visualNote}. ${readableCodeLine}`,
      shown.length > 0
        ? `Closest *Classic Edge 53* models in this category:\n${shown.map(formatMatchLine).join("\n")}`
        : `Please share the model nameplate so our Classic Edge 53 team can identify the exact model for you.`,
      askPlateLine,
    ];
    return {
      reply: lines.join("\n\n"),
      handoff: false,
      handoffReason: "",
      needsSalesPing: false,
      salesPingNote: "",
      smartCategory: "Acrylic Machines (CE53)",
      priority: "HIGH",
    };
  }

  const appearanceTraits = [
    analysis.colorAppearance ? `looks ${analysis.colorAppearance}` : "",
    analysis.materialAppearance ? `${analysis.materialAppearance}` : "",
    analysis.shapeAndDesign ? `${analysis.shapeAndDesign}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const seenSentence = analysis.productType
    ? `From your photo, this appears to be a *${analysis.productType}*${appearanceTraits ? ` (${appearanceTraits})` : ""}.`
    : `From your photo${appearanceTraits ? `, it ${appearanceTraits}` : ""}.`;
  const intro = `${greetOnce}${seenSentence} Visual appearance alone cannot confirm exact sheet thickness or hidden dimensions, and our team can confirm exact match or custom tweaks if needed.`;
  const matchSection =
    shown.length > 0
      ? `Here are our closest verified *Classic Concepts* matches:\n${shown.map(formatMatchLine).join("\n")}\n\nNote: Ready catalog models may differ slightly in base footprint, front panel styling, or thickness compared to your reference photo.`
      : `I could not find an exact ready match in our catalog for this design, so we can custom-build it to your size and finish.`;
  const closing =
    analysis.needsCustomFabrication
      ? `Would you like me to connect our team for custom dimensions and a quote?`
      : `Let me know which option looks closest, or share your budget/dimensions if you want me to narrow it down!`;
  return {
    reply: `${intro}\n\n${matchSection}\n\n${closing}`,
    handoff: false,
    handoffReason: "",
    needsSalesPing: analysis.needsCustomFabrication,
    salesPingNote: analysis.needsCustomFabrication
      ? `ACRIO Vision flagged potential custom fabrication from customer photo (${analysis.productType || "item"}).`
      : "",
    smartCategory: /podium|pulpit|lectern/i.test(analysis.productType)
      ? "Podiums & Stage"
      : "General Enquiry",
    priority: "NORMAL",
  };
}
