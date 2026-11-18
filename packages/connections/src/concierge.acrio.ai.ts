import {
  buildCompleteEcosystemDatabaseDirectory,
  buildEcosystemDeepProductContextAndAnswer,
  buildMultiItemProjectPlan,
  cleanDisplayProductName,
  extractCompactDimensionPairsFromText,
  extractExplicitProductOrModelCodes,
  extractCustomerCoreNouns,
  countCoreNounMatches,
  rankItemsByCustomerCoreNouns,
  loadLiveDatabaseOperationalContext,
  findMatchingAiTrainingGuidance,
  getEcosystemBudgetFallbackInfo,
  getVerifiedLiveBrandAndTeamInfo,
  resolvePublicTrackingOrigin,
  resolveSharedAnthropicApiKey,
  searchEcosystemItems,
  type AiTokenUsage,
  type AiTraceStep,
  type MainWebsiteProduct,
} from "@cc/database";
import {
  analyzeCustomerImageWithVision,
  fetchAndValidateWhatsAppImage,
  sanitizeImageFilename,
  validateCustomerImageBuffer,
  type CustomerImageAnalysis,
  type CustomerImageAttachmentInput,
} from "./image-intelligence";
import {
  LOCKED_CLAUDE_MODEL,
  parseClaudeJson,
  callClaudeHaikuMessagesDetailed,
  recordAndBroadcastAiLog,
  mapProductToLogItem,
  formatWhatsAppOutboundText,
  stripRepeatedGreeting,
} from "./initialise.acrio.ai";
import {
  loadMetaWhatsAppSetupConfig,
} from "./whatsapp-cloud.acrio.ai";
import {
  type CatalogCacheMeta,
  getCachedEcosystemCatalog,
  buildGroupedProductShortLinksSection,
  detectAcrioCustomerProfile,
  normalizeCustomerProductTypos,
  stripBurstMediaPlaceholders,
  ACRIO_DOMAIN_PRODUCT_NOUN_RE,
  classifyAcrioInboundIntent,
  type AcrioConversationState,
  extractNormalizedColourTokens,
  matchProductVariantsByColourTokens,
  findCatalogProductsByVariantTokens,
  isMultiProductReference,
  resolveProductsFromOutboundText,
  isProductImageRequest,
  resolveCatalogPdfAttachments,
  resolveProductMediaAttachments,
  resolveMultiProductMediaAttachments,
  isFocusedProductFollowUp,
  buildCatalogAggregateAnswer,
  buildFocusedAttributeAnswer,
  ACRIO_ORDINALS,
  isListPickText,
  resolveListPickFromLastReply,
  reconstructAcrioConversationState,
  buildNormalizedSearchFromState,
  loadConversationAiState,
  saveConversationAiState,
} from "./helpers.acrio.ai";
import {
  type AcrioLocationPin,
  type AcrioAutonomousTurnResult,
  type AcrioUiSink,
  type AcrioReplyToMessageContext,
  type AcrioTurnParams,
  ACRIO_TEAM_ASK_TEXT,
  buildTeamConnectInteractive,
  decorateAcrioReplyWithInteractive,
} from "./interactive.acrio.ai";

export async function runAcrioAutonomousTurn(
  params: AcrioTurnParams
): Promise<AcrioAutonomousTurnResult> {
  const sink: AcrioUiSink & { skipInteractiveOverride?: boolean } = params.uiSink || { matches: [] };
  const res = await runAcrioAutonomousTurnCore({ ...params, uiSink: sink });
  if (
    params.enableInteractive === false ||
    res.needsHumanHandoff ||
    res.interactive ||
    sink.skipInteractiveOverride
  ) {
    return res;
  }
  try {
    const extra = decorateAcrioReplyWithInteractive(res, sink, params.inboundText);
    if (extra?.interactive?.kind === "list" && res.conversationState) {
      res.conversationState.lastListedSlugs = extra.interactive.rows.map((r) => r.id.replace(/^acrio:prod:/, ""));
      await saveConversationAiState(params.conversationId, res.conversationState);
    }
    return extra ? { ...res, ...extra } : res;
  } catch {
    return res;
  }
}

function mergeAiTokenUsage(
  a?: AiTokenUsage | null,
  b?: AiTokenUsage | null
): AiTokenUsage | undefined {
  if (!a && !b) return undefined;
  return {
    inputTokens: Number(a?.inputTokens || 0) + Number(b?.inputTokens || 0),
    outputTokens: Number(a?.outputTokens || 0) + Number(b?.outputTokens || 0),
    thinkingTokens: Number(a?.thinkingTokens || 0) + Number(b?.thinkingTokens || 0),
    cacheReadInputTokens:
      Number(a?.cacheReadInputTokens || 0) + Number(b?.cacheReadInputTokens || 0),
    cacheCreationInputTokens:
      Number(a?.cacheCreationInputTokens || 0) + Number(b?.cacheCreationInputTokens || 0),
  };
}

function cacheConversationImageAnalysis(
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

function buildPhaseIImageGuidancePrompt(
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

function buildPhaseIImageFallbackReply(params: {
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

/**
 * Autonomous ACRIO Backend Handler:
 * Every new/reopened customer chat is initially assigned to ACRIO.
 * - Powered by Claude Haiku 5.5 with Medium adaptive effort (`claude-haiku-5-5`).
 * - Maintains natural multi-turn continuity across messages without repeating "Hi {Name}".
 * - Understands synonyms (`pulpits` -> `podiums`, etc.) and strict budget constraints (`under ₹25,000`).
 * - Formats replies cleanly for WhatsApp (*bold* headers, ₹ prices, numbered shortlinks, bullet points).
 * - Logs every step, cache check, product lookup, and response to `ai.logs`.
 */
async function runAcrioAutonomousTurnCore(
  params: AcrioTurnParams
): Promise<AcrioAutonomousTurnResult> {
  const started = Date.now();
  const steps: AiTraceStep[] = [];
  const addStep = (
    label: string,
    detail?: string,
    status: AiTraceStep["status"] = "OK"
  ) => {
    steps.push({
      stepNumber: steps.length + 1,
      label,
      detail,
      durationMs: Date.now() - started,
      status,
    });
  };

  const originalInboundText = params.inboundText.trim();
  const burstStripped = stripBurstMediaPlaceholders(originalInboundText);
  const cleanCustomerText = normalizeCustomerProductTypos(burstStripped.cleanText).trim();
  const rawText = cleanCustomerText || originalInboundText;
  const lower = rawText.toLowerCase();
  const rawFirstToken = (params.customerName || "").split(/[\s(]/)[0] || "";
  const firstName =
    !rawFirstToken || /^[\d+\s()+.-]+$/.test(rawFirstToken) ? "there" : rawFirstToken;

  const history = (params.recentMessages || []).filter(
    (m) =>
      (m.direction === "INBOUND" || m.direction === "OUTBOUND") &&
      Boolean(String(m.body || "").trim())
  );

  const alreadyGreeted =
    Boolean(params.hasAlreadyGreeted) ||
    history.some((m) => m.direction === "OUTBOUND");

  const storedState =
    params.persistedState !== undefined
      ? params.persistedState
      : await loadConversationAiState(params.conversationId);

  // 0. Detect reference attachments in this turn / multi-message burst
  const attType = String(params.attachment?.mediaType || "").toUpperCase();
  const attName = String(params.attachment?.filename || "").trim();
  const attMime = String(params.attachment?.mimeType || "").trim();
  const attMediaId = String(params.attachment?.mediaId || "").trim();
  const attSha = String(params.attachment?.sha256 || "").trim();
  const isStickerOnly =
    Boolean(params.attachment?.isSticker) &&
    cleanCustomerText.length === 0 &&
    !params.burstAttachments?.documents &&
    !params.burstAttachments?.videos &&
    !params.burstAttachments?.audios;

  if (isStickerOnly) {
    const greetLine = alreadyGreeted ? "" : `Hi ${firstName}! `;
    const stickerReply = formatWhatsAppOutboundText(
      `${greetLine}Tell me what product or machine you are looking for today (for example podiums, furniture, trophies, custom acrylic boxes, or Classic Edge 53 machines) and I will help right away.`
    );
    const stState = reconstructAcrioConversationState({
      persistedState: storedState,
      recentMessages: history,
      currentInboundText: rawText,
    });
    await saveConversationAiState(params.conversationId, stState);
    addStep("Handled sticker-only message without Vision call", attName || attMime || "sticker");
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: originalInboundText,
      model: "rule-sticker-ignore",
      outcomeSource: "LIVE_AI",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: "BYPASS",
      cacheDetails: "Sticker ignored cleanly without burning Vision tokens",
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupBudget: null,
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: stickerReply,
      durationMs: Date.now() - started,
    });
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      customerReply: stickerReply,
      smartCategory: stState.activeCategory || "General Enquiry",
      priority: "NORMAL",
      conversationState: stState,
    };
  }

  const rawImageItems: CustomerImageAttachmentInput[] =
    params.burstAttachments?.imageItems && params.burstAttachments.imageItems.length > 0
      ? params.burstAttachments.imageItems.filter((img) => !img.isSticker)
      : attType === "IMAGE" && !params.attachment?.isSticker
      ? [
          {
            mediaId: attMediaId || undefined,
            mimeType: attMime || undefined,
            filename: attName || undefined,
            caption: params.attachment?.caption || cleanCustomerText || undefined,
            sha256: attSha || undefined,
            buffer: params.attachment?.buffer,
            isSticker: false,
          },
        ]
      : [];
  const rawNonImageItems =
    params.burstAttachments?.nonImageItems && params.burstAttachments.nonImageItems.length > 0
      ? params.burstAttachments.nonImageItems
      : attType === "DOCUMENT" ||
        attType === "VIDEO" ||
        attType === "AUDIO" ||
        attType === "UNSUPPORTED"
      ? [
          {
            mediaType: attType,
            filename: attName || undefined,
            mimeType: attMime || undefined,
            mediaId: attMediaId || undefined,
            sha256: attSha || undefined,
          },
        ]
      : [];

  const burstImages = Math.max(
    burstStripped.images,
    params.burstAttachments?.images || 0,
    rawImageItems.length > 0 ? rawImageItems.length : attType === "IMAGE" && !params.attachment?.isSticker ? 1 : 0
  );
  const burstDocs = Math.max(
    burstStripped.documents,
    params.burstAttachments?.documents || 0,
    attType === "DOCUMENT" ? 1 : 0
  );
  const burstVideos = Math.max(
    burstStripped.videos,
    params.burstAttachments?.videos || 0,
    attType === "VIDEO" ? 1 : 0
  );
  const burstAudios = Math.max(
    burstStripped.audios,
    params.burstAttachments?.audios || 0,
    attType === "AUDIO" ? 1 : 0
  );
  const burstUnsupported = Math.max(
    rawNonImageItems.filter((item) => item.mediaType === "UNSUPPORTED").length,
    attType === "UNSUPPORTED" ? 1 : 0
  );
  const hasNonImageAttachment =
    burstDocs + burstVideos + burstAudios + burstUnsupported > 0 ||
    rawNonImageItems.length > 0;
  const hasBurstReferenceMedia =
    burstImages + burstDocs + burstVideos + burstAudios + burstUnsupported > 0;
  const burstMediaLabel = attName
    ? `*${attName}*`
    : burstDocs > 0
    ? "your PDF / document"
    : burstVideos > 0
    ? "your video"
    : burstAudios > 0
    ? "your voice note / audio"
    : burstUnsupported > 0
    ? "your file attachment"
    : burstImages > 1
    ? `your ${burstImages} reference photos`
    : burstImages === 1
    ? "your reference photo"
    : "your attachment";

  // 0a. Automatic zero-AI staff routing for PDFs, docs, spreadsheets, audio, voice notes, video, and unsupported files
  if (hasNonImageAttachment) {
    const phState = reconstructAcrioConversationState({
      persistedState: storedState,
      recentMessages: history,
      currentInboundText: originalInboundText,
    });
    await saveConversationAiState(params.conversationId, phState);
    const activeReqParts: string[] = [];
    if (phState.preferences.length > 0) {
      activeReqParts.push(phState.preferences.join(" "));
    }
    if (phState.primaryProductQuery) {
      activeReqParts.push(
        phState.primaryProductQuery
          .replace(/\b(photo|photos|image|images|pic|pics|pls|please|share|send|show)\b/gi, "")
          .replace(/\s+/g, " ")
          .trim()
      );
    }
    const activeReqSummary = activeReqParts.join(" ").trim();
    const forRequirementClause =
      activeReqSummary && extractCustomerCoreNouns(activeReqSummary).length > 0
        ? ` for your *${activeReqSummary}* requirement`
        : "";
    const preservedMetaList = rawNonImageItems
      .map((item) => {
        const metaBits = [
          `type=${item.mediaType || attType || "FILE"}`,
          item.filename ? `filename=${sanitizeImageFilename(item.filename)}` : "",
          item.mimeType ? `mime=${item.mimeType}` : "",
          item.mediaId ? `mediaId=${item.mediaId}` : "",
          item.sha256 ? `sha256=${item.sha256}` : "",
        ].filter(Boolean);
        return metaBits.join(", ");
      })
      .filter(Boolean)
      .join(" | ");
    const greetLine = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
    const routeReply = formatWhatsAppOutboundText(
      `${greetLine}Thank you for sharing ${burstMediaLabel}${forRequirementClause}. I have forwarded your original file directly to our team so a specialist can review it and reply to you right away.`
    );
    const handoffReason = `Customer shared non-image attachment (${preservedMetaList || burstMediaLabel})${forRequirementClause}${cleanCustomerText ? ` note="${cleanCustomerText.slice(0, 100)}"` : ""}. Routed directly to human staff preserving original attachment.`;
    addStep("Routed non-image attachment directly to team (0 AI tokens)", handoffReason);
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: originalInboundText,
      model: "rule-attachment-team-handoff",
      outcomeSource: "HUMAN_HANDOFF",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: "BYPASS",
      cacheDetails: `Non-image attachment (${attType || "FILE"}) routed directly to staff with zero AI cost`,
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupBudget: null,
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: routeReply,
      durationMs: Date.now() - started,
    });
    return {
      needsHumanHandoff: true,
      handoffReason,
      customerReply: routeReply,
      smartCategory: phState.activeCategory || "Custom Fabrication",
      priority: "HIGH",
      conversationState: phState,
    };
  }

  // 0b. Phase I Customer Image Intelligence (only when downloadable/buffer image or SHA cache hit exists)
  let visionAnalysis: CustomerImageAnalysis | null = null;
  let visionUsage: AiTokenUsage | null = null;
  let visionFromCache = false;
  let visionSha256: string | null = null;
  let visionRecordedNewCall = false;
  const analyzableImage = rawImageItems.find(
    (img) =>
      !img.isSticker &&
      (Boolean(img.buffer) ||
        Boolean(img.mediaId) ||
        Boolean(img.sha256 && storedState?.analyzedImagesBySha?.[img.sha256]))
  );
  const shouldAttemptVision = Boolean(analyzableImage);

  if (analyzableImage) {
    if (params.uiSink) {
      (params.uiSink as any).skipInteractiveOverride = true;
    }
    const preCacheHit =
      analyzableImage.sha256 && storedState?.analyzedImagesBySha?.[analyzableImage.sha256]
        ? storedState.analyzedImagesBySha[analyzableImage.sha256]
        : null;

    if (preCacheHit) {
      visionAnalysis = { ...preCacheHit, fromCache: true };
      visionSha256 = preCacheHit.sha256;
      visionFromCache = true;
      addStep(
        "Reused per-conversation SHA-256 cached image analysis",
        `sha256=${visionSha256.slice(0, 12)}..., product="${visionAnalysis.productType || "unknown"}"`
      );
    } else {
      const validation = analyzableImage.buffer
        ? validateCustomerImageBuffer({
            buffer: analyzableImage.buffer,
            declaredMimeType: analyzableImage.mimeType,
            filename: analyzableImage.filename,
          })
        : await (async () => {
            const metaCfg = await loadMetaWhatsAppSetupConfig();
            return fetchAndValidateWhatsAppImage({
              attachment: analyzableImage,
              accessToken: String(metaCfg.systemUserAccessToken || ""),
              fetchImpl: params.mediaFetchImpl,
            });
          })();

      if (!validation.ok || !validation.buffer || !validation.mimeType || !validation.sha256) {
        const errState = reconstructAcrioConversationState({
          persistedState: storedState,
          recentMessages: history,
          currentInboundText: rawText,
        });
        await saveConversationAiState(params.conversationId, errState);
        const greetLine = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
        const friendlyErr =
          validation.errorCode === "OVERSIZED_IMAGE"
            ? `${greetLine}The image you shared is larger than our 5 MB limit, so I could not open it here. Could you please send a smaller compressed photo (under 5 MB) or describe the product you need?`
            : validation.errorCode === "INVALID_IMAGE_TYPE" ||
              validation.errorCode === "INVALID_IMAGE_SIGNATURE"
            ? `${greetLine}That file does not appear to be a valid JPEG, PNG, WebP, or GIF photo, so I could not inspect it safely. Please resend it as a standard photo or let me know what product you are looking for.`
            : `${greetLine}I could not download your photo cleanly right now, so I have not guessed what is in it. Please resend the image or share a short text description of what you need and I will help right away.`;
        const formattedErr = formatWhatsAppOutboundText(friendlyErr);
        addStep(
          "Rejected or failed to fetch customer image safely",
          `code=${validation.errorCode || "UNKNOWN"}: ${validation.errorMessage || ""}`,
          "WARN"
        );
        recordAndBroadcastAiLog({
          website: "WHATSAPP_HUB",
          websiteLabel: "Classic Concepts WhatsApp Hub",
          feature: "Autonomous WhatsApp Concierge (ACRIO)",
          actor: params.customerName,
          question: originalInboundText,
          model: "rule-image-validation-guard",
          outcomeSource: "LOCAL_FALLBACK",
          responseCacheStatus: "BYPASS",
          catalogCacheStatus: "BYPASS",
          cacheDetails: `Image safety/fetch guard (${validation.errorCode || "ERROR"}) blocked Vision call (0 tokens)`,
          productLookupTriggered: false,
          productLookupQuery: "",
          productLookupBudget: null,
          productLookupTotalScanned: 0,
          productsLookedUp: [],
          steps,
          response: formattedErr,
          durationMs: Date.now() - started,
        });
        return {
          needsHumanHandoff: false,
          handoffReason: "",
          customerReply: formattedErr,
          smartCategory: errState.activeCategory || "General Enquiry",
          priority: "NORMAL",
          conversationState: errState,
        };
      }

      visionSha256 = validation.sha256;
      const postCacheHit = storedState?.analyzedImagesBySha?.[validation.sha256] || null;
      if (postCacheHit) {
        visionAnalysis = { ...postCacheHit, fromCache: true };
        visionFromCache = true;
        addStep(
          "Reused per-conversation byte SHA-256 cached image analysis",
          `sha256=${validation.sha256.slice(0, 12)}..., product="${visionAnalysis.productType || "unknown"}"`
        );
      } else {
        const maxPerHour = Math.max(
          1,
          Number(process.env.ACRIO_MAX_IMAGES_PER_CONV_HOUR || 10)
        );
        const win = storedState?.imageAnalysisCountWindow;
        const winStartMs = win?.windowStartIso ? Date.parse(win.windowStartIso) : 0;
        const recentImageCount =
          winStartMs > 0 && Date.now() - winStartMs <= 3600_000
            ? Number(win?.count || 0)
            : 0;
        if (recentImageCount >= maxPerHour) {
          const limitState = reconstructAcrioConversationState({
            persistedState: storedState,
            recentMessages: history,
            currentInboundText: rawText,
          });
          await saveConversationAiState(params.conversationId, limitState);
          const greetLine = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
          const rateMsg = formatWhatsAppOutboundText(
            `${greetLine}You have already shared several photos in this chat. To keep responses fast, please share any remaining product details by text or ask to connect with our Sales Team.`
          );
          addStep("Enforced per-conversation hourly image analysis limit", `count=${recentImageCount}/${maxPerHour}`, "WARN");
          return {
            needsHumanHandoff: false,
            handoffReason: "",
            customerReply: rateMsg,
            smartCategory: limitState.activeCategory || "General Enquiry",
            priority: "NORMAL",
            conversationState: limitState,
          };
        }

        const { apiKey: visionKey } = await resolveSharedAnthropicApiKey("client");
        const visionResult: {
          ok: boolean;
          analysis?: CustomerImageAnalysis;
          usage?: AiTokenUsage | null;
          error?: string;
        } = params.visionAnalyzerOverride
          ? await params.visionAnalyzerOverride({
              imageBuffer: validation.buffer,
              mimeType: validation.mimeType,
              caption: analyzableImage.caption || cleanCustomerText || undefined,
              filename: validation.safeFileName,
            })
          : visionKey
          ? await analyzeCustomerImageWithVision({
              validation,
              caption: analyzableImage.caption || cleanCustomerText || undefined,
              callVisionClaude: (callParams) =>
                callClaudeHaikuMessagesDetailed({
                  apiKey: visionKey,
                  system: callParams.system,
                  messages: callParams.messages,
                  maxTokens: callParams.maxTokens,
                  effort: callParams.effort || "low",
                  timeoutMs: callParams.timeoutMs || 18000,
                }),
              parseJson: parseClaudeJson,
            })
          : { ok: false, error: "Client Anthropic API key is not configured." };

        visionUsage =
          visionResult.usage || visionResult.analysis?.analysisTokenUsage || null;
        if (!visionResult.ok || !visionResult.analysis) {
          const failState = reconstructAcrioConversationState({
            persistedState: storedState,
            recentMessages: history,
            currentInboundText: rawText,
          });
          await saveConversationAiState(params.conversationId, failState);
          const greetLine = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
          const failMsg = formatWhatsAppOutboundText(
            `${greetLine}I received your photo, but our image reader could not inspect it right now. Could you briefly tell me what product or machine you are looking for, or ask for our team to review it?`
          );
          addStep(
            "Vision analysis unavailable; returned honest non-hallucinated fallback",
            visionResult.error || "Unknown Vision failure",
            "WARN"
          );
          recordAndBroadcastAiLog({
            website: "WHATSAPP_HUB",
            websiteLabel: "Classic Concepts WhatsApp Hub",
            feature: "Autonomous WhatsApp Concierge (ACRIO)",
            actor: params.customerName,
            question: originalInboundText,
            model: LOCKED_CLAUDE_MODEL,
            outcomeSource: "LOCAL_FALLBACK",
            responseCacheStatus: "BYPASS",
            catalogCacheStatus: "BYPASS",
            cacheDetails: `Vision call failed safely (${visionResult.error || "unavailable"})`,
            productLookupTriggered: false,
            productLookupQuery: "",
            productLookupBudget: null,
            productLookupTotalScanned: 0,
            productsLookedUp: [],
            steps,
            response: failMsg,
            durationMs: Date.now() - started,
            tokenUsage: visionUsage || undefined,
            error: visionResult.error || null,
          });
          return {
            needsHumanHandoff: false,
            handoffReason: "",
            customerReply: failMsg,
            smartCategory: failState.activeCategory || "General Enquiry",
            priority: "NORMAL",
            conversationState: failState,
          };
        }

        visionAnalysis = visionResult.analysis;
        visionRecordedNewCall = true;
        addStep(
          "Analyzed customer image via Claude Haiku 5.5 Vision",
          `sha256=${validation.sha256.slice(0, 12)}..., domain=${visionAnalysis.businessDomain}, product="${visionAnalysis.productType || "unknown"}", sketch=${visionAnalysis.isDesignSketchOrDrawing}`
        );
      }
    }
  }

  const isMediaPlaceholderOnly =
    cleanCustomerText.length === 0 &&
    !shouldAttemptVision &&
    (/^\[(?:image|photo|video|document|pdf|file|audio|voice\s*note|sticker)\b/i.test(
      originalInboundText
    ) ||
      hasBurstReferenceMedia);
  const hasExplicitProductCodeWithImage =
    attType === "IMAGE" &&
    cleanCustomerText.length > 0 &&
    (extractExplicitProductOrModelCodes(cleanCustomerText).length > 0 ||
      Boolean(params.forcedFocusSlug));

  // Route legacy unanalyzable mock images (no mediaId/buffer/cache) at Step 0 when no text enquiry was sent
  const shouldRouteAttachmentImmediately =
    !shouldAttemptVision &&
    (isMediaPlaceholderOnly ||
      (cleanCustomerText.length === 0 &&
        Boolean(params.attachment) &&
        attType === "IMAGE" &&
        !hasExplicitProductCodeWithImage));

  if (shouldRouteAttachmentImmediately) {
    const phState = reconstructAcrioConversationState({
      persistedState: storedState,
      recentMessages: history,
      currentInboundText: originalInboundText,
    });
    await saveConversationAiState(params.conversationId, phState);
    const activeReqParts: string[] = [];
    if (phState.preferences.length > 0) {
      activeReqParts.push(phState.preferences.join(" "));
    }
    if (phState.primaryProductQuery) {
      activeReqParts.push(
        phState.primaryProductQuery
          .replace(/\b(photo|photos|image|images|pic|pics|pls|please|share|send|show)\b/gi, "")
          .replace(/\s+/g, " ")
          .trim()
      );
    }
    const activeReqSummary = activeReqParts.join(" ").trim();
    const forRequirementClause =
      activeReqSummary && extractCustomerCoreNouns(activeReqSummary).length > 0
        ? ` for your *${activeReqSummary}* requirement`
        : "";
    const greetLine = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
    const routeReply = formatWhatsAppOutboundText(
      `${greetLine}Thank you for sharing ${burstMediaLabel}${forRequirementClause}. I have forwarded this directly to our team so a specialist can review it and reply to you right away.`
    );
    const handoffReason = `Customer shared ${attName || burstMediaLabel}${forRequirementClause} (${originalInboundText.slice(0, 100)}) which needs team review.`;
    addStep("Routed attachment directly to team", handoffReason);
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: originalInboundText,
      model: "rule-attachment-team-handoff",
      outcomeSource: "HUMAN_HANDOFF",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: "BYPASS",
      cacheDetails: `Attachment (${attType || "FILE"}) routed directly to human team`,
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupBudget: null,
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: routeReply,
      durationMs: Date.now() - started,
    });
    return {
      needsHumanHandoff: true,
      handoffReason,
      customerReply: routeReply,
      smartCategory: phState.activeCategory || "Custom Fabrication",
      priority: "HIGH",
      conversationState: phState,
    };
  }

  // Handle non-text "[Message]" fallback deterministically when there is no real text in the burst
  if (cleanCustomerText.length === 0 && /^\[message\]$/i.test(originalInboundText)) {
    const greetLine = alreadyGreeted ? "" : `Hi ${firstName}, welcome to *Classic Concepts*!\n\n`;
    const placeholderReply = `${greetLine}What are you looking to explore today?\n1. *Acrylic Podiums & Pulpits* for stages, auditoriums, or classrooms\n2. *Acrylic Furniture, Chairs & Tables* for interiors or events\n3. *Signages, Trophies & Custom Boxes*\n4. *Classic Edge 53 Machines* for acrylic bending and polishing\n\nReply with *1*, *2*, *3*, *4*, or a model code to get started!`;
    const formattedPlaceholder = formatWhatsAppOutboundText(placeholderReply);
    const phState = reconstructAcrioConversationState({
      persistedState: storedState,
      recentMessages: history,
      currentInboundText: rawText,
    });
    await saveConversationAiState(params.conversationId, phState);
    addStep("Handled non-text webhook placeholder", `placeholder="${rawText}"`);
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: rawText,
      model: "rule-webhook-placeholder",
      outcomeSource: "LIVE_AI",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: "BYPASS",
      cacheDetails: `Deterministic reply for webhook placeholder ${rawText}`,
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupBudget: null,
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: formattedPlaceholder,
      durationMs: Date.now() - started,
    });
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      customerReply: formattedPlaceholder,
      smartCategory: phState.activeCategory || "General Enquiry",
      priority: "NORMAL",
      conversationState: phState,
    };
  }

  const recentInboundWindow = [
    ...history
      .filter((m) => m.direction === "INBOUND")
      .slice(-4)
      .map((m) => m.body),
    rawText,
  ].join(" ");
  const contextLower = recentInboundWindow.toLowerCase();

  // Resolve any quoted / replied-to message from params.replyToMessage or the latest inbound message in history
  const latestInboundInHistory = [...history].reverse().find((m) => m.direction === "INBOUND");
  const quotedReplyContext: AcrioReplyToMessageContext | null =
    params.replyToMessage ||
    (latestInboundInHistory && latestInboundInHistory.body.trim() === rawText
      ? latestInboundInHistory.replyTo || null
      : null);
  const quotedBody = String(quotedReplyContext?.body || "").trim();

  // 1. Classify turn intent BEFORE any catalog fetch or product lookup (Phase A)
  let intentInfo = classifyAcrioInboundIntent(
    rawText,
    history.length > 0 || Boolean(storedState?.turnCount) || Boolean(quotedReplyContext)
  );

  // 1a. "the first one" / "option 2" / "the cheaper one": the customer is picking from the list we just sent (or a quoted list).
  // Resolve it from the links in the quoted message or our last outbound message, and make sure it is treated as a product follow-up.
  const outboundBodies = history
    .filter((m) => m.direction === "OUTBOUND")
    .map((m) => String(m.body || ""))
    .reverse();
  const countAcrioLinks = (b: string) =>
    new Set(b.match(/https?:\/\/ccapl\.cc\/[^\s)*>]+/gi) || []).size;
  // If customer quoted a specific message with links, prefer that message; otherwise use latest multi-link outbound message.
  const lastOutboundBody =
    quotedBody && countAcrioLinks(quotedBody) >= 1
      ? quotedBody
      : countAcrioLinks(outboundBodies[0] || "") >= 2
      ? outboundBodies[0]
      : outboundBodies.slice(1, 4).find((b) => countAcrioLinks(b) >= 2) || outboundBodies[0] || "";
  const hasListPickWording = isListPickText(rawText);
  if (
    hasListPickWording &&
    (/https?:\/\/ccapl\.cc\//i.test(lastOutboundBody) || /View options/i.test(outboundBodies[0] || "") || Boolean(quotedBody)) &&
    !intentInfo.needsImmediateHandoff &&
    intentInfo.intent !== "TOPIC_RESET" &&
    intentInfo.intent !== "HUMAN_HANDOFF_REQUEST"
  ) {
    intentInfo = {
      ...intentInfo,
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      reason: "Customer picked an item from the list we sent",
    };
  }
  if (params.forcedFocusSlug) {
    intentInfo = {
      ...intentInfo,
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      needsImmediateHandoff: false,
      reason: "Customer tapped a product in the View options list",
    };
  }
  // If customer quoted/replied to an earlier message OR sent a short follow-up while an active product is in memory,
  // upgrade CONVERSATIONAL_FOLLOWUP to FOLLOW_UP_REFINEMENT so product context is never dropped!
  const hasActiveProductMemory = Boolean(
    storedState?.focusProductSlug ||
      (storedState?.lastRecommendedProducts && storedState.lastRecommendedProducts.length > 0) ||
      storedState?.primaryProductQuery ||
      quotedReplyContext?.productSlug ||
      (quotedBody && (/https?:\/\/ccapl\.cc\//i.test(quotedBody) || extractExplicitProductOrModelCodes(quotedBody).length > 0))
  );
  if (
    intentInfo.intent === "CONVERSATIONAL_FOLLOWUP" &&
    !/^\s*\+?\d[\d\s()-]{8,16}\s*$/.test(rawText) &&
    !/^\s*check\s+\+?\d/i.test(rawText) &&
    !/^\s*(?:wrong\s*answer|incorrect\s*answer|that'?s\s*wrong)\b/i.test(rawText) &&
    (Boolean(quotedReplyContext) || (hasActiveProductMemory && rawText.split(/\s+/).length <= 12))
  ) {
    intentInfo = {
      ...intentInfo,
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      reason: quotedReplyContext
        ? "Customer quoted/replied directly to an earlier message"
        : "Short follow-up continuation on active product context",
    };
  }

  // 1a-2. "Talk to a person": offer Chat / Callback buttons first (unless we just asked, then hand off directly).
  if (
    intentInfo.intent === "HUMAN_HANDOFF_REQUEST" &&
    params.enableInteractive !== false &&
    !String(outboundBodies[0] || "").includes(ACRIO_TEAM_ASK_TEXT) &&
    !String(lastOutboundBody || "").includes(ACRIO_TEAM_ASK_TEXT)
  ) {
    const firstNameForAsk = firstName;
    const askReply = `Sure ${firstNameForAsk}, happy to connect you with our team.\n\n${ACRIO_TEAM_ASK_TEXT}`;
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: rawText,
      model: "rule-team-connect-choice",
      outcomeSource: "LIVE_AI",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: "BYPASS",
      cacheDetails: "Offered Chat with team / Request a callback buttons",
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupBudget: null,
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: askReply,
      durationMs: Date.now() - started,
    });
    const askState = reconstructAcrioConversationState({
      persistedState: params.persistedState !== undefined ? params.persistedState : await loadConversationAiState(params.conversationId),
      recentMessages: history,
      currentInboundText: rawText,
    });
    await saveConversationAiState(params.conversationId, askState);
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      customerReply: askReply,
      smartCategory: "General Enquiry",
      priority: "HIGH",
      conversationState: askState,
      interactive: buildTeamConnectInteractive(),
    };
  }

  // 1b. Reconstruct & update structured per-conversation state (Phase B + Phase I image state)
  const convState = reconstructAcrioConversationState({
    persistedState: storedState,
    recentMessages: history,
    currentInboundText: rawText,
  });

  if (visionAnalysis) {
    if (visionSha256) {
      cacheConversationImageAnalysis(
        convState,
        visionSha256,
        visionAnalysis,
        visionRecordedNewCall
      );
    } else {
      convState.lastImageAnalysis = visionAnalysis;
    }

    const visionQuery = (
      visionAnalysis.recommendedSearchQuery ||
      visionAnalysis.productType ||
      ""
    ).trim();
    const isGenericPhotoText =
      !cleanCustomerText ||
      /^\[(?:image|photo)\b/i.test(originalInboundText) ||
      /^(?:do you have|can you make|is this|how much|price|cost|send details|available|looking for this|something like this|similar)/i.test(
        cleanCustomerText
      ) ||
      extractCustomerCoreNouns(cleanCustomerText).length === 0;
    if (visionQuery && isGenericPhotoText) {
      convState.primaryProductQuery = visionQuery;
      convState.focusProductSlug = null;
      convState.lastRecommendedProducts = [];
    }
    if (visionAnalysis.businessDomain === "CLASSIC_EDGE_53") {
      convState.activeBrand = "CLASSIC_EDGE_53";
      convState.activeCategory = "Acrylic Machines (CE53)";
    } else if (visionAnalysis.businessDomain === "CLASSIC_CONCEPTS") {
      convState.activeBrand = "CLASSIC_CONCEPTS";
    }
    if (/podium|pulpit|lectern/i.test(`${visionAnalysis.productType} ${visionQuery}`)) {
      convState.productFamily = "podium";
      if (!convState.activeCategory) {
        convState.activeCategory = "Podiums & Stage";
      }
    }
    const visualPrefMatches =
      `${visionAnalysis.colorAppearance} ${visionAnalysis.materialAppearance}`.match(
        /\b(transparent|clear|frosted|black|white|acrylic|wood|wooden|led|blue)\b/gi
      ) || [];
    for (const p of visualPrefMatches) {
      const normalizedPref = p.toLowerCase();
      if (!convState.preferences.includes(normalizedPref)) {
        convState.preferences.push(normalizedPref);
      }
    }

    if (!intentInfo.needsImmediateHandoff) {
      intentInfo = {
        intent: "PRODUCT_SEARCH",
        requiresProductLookup: true,
        needsImmediateHandoff: false,
        allowRollingContextFallback: false,
        reason: "Analyzed customer reference image via ACRIO Vision",
      };
    }
    await saveConversationAiState(params.conversationId, convState);
  } else if (intentInfo.intent === "TOPIC_RESET") {
    await saveConversationAiState(params.conversationId, convState);
  }

  addStep(
    "Loaded conversation context & state",
    `historyTurns=${history.length}, alreadyGreeted=${alreadyGreeted}, activeProduct="${convState.primaryProductQuery || "none"}", maxPrice=${convState.maxPrice ?? "none"}, prefs=[${convState.preferences.join(",")}]`
  );

  addStep(
    "Classified inbound turn intent",
    `intent=${intentInfo.intent}, requiresProductLookup=${intentInfo.requiresProductLookup}, allowRollingFallback=${intentInfo.allowRollingContextFallback} (${intentInfo.reason})`
  );

  // 1c. Material / Colour / Dimension-Only Fragment Guard (e.g. customer sends "On black acrylic" first before typing the product name):
  // Never guess a random black catalog product (like a bathroom stool)! Save the preference in convState and ask which item they need.
  const turnCoreNounsEarly = extractCustomerCoreNouns(rawText);
  const stateCoreNounsEarly = extractCustomerCoreNouns(convState.primaryProductQuery || "");
  const isPreferenceOnlyFragment =
    !hasBurstReferenceMedia &&
    !visionAnalysis &&
    !params.forcedFocusSlug &&
    !quotedReplyContext &&
    !intentInfo.needsImmediateHandoff &&
    turnCoreNounsEarly.length === 0 &&
    stateCoreNounsEarly.length === 0 &&
    !convState.focusProductSlug &&
    convState.lastRecommendedProducts.length === 0 &&
    extractExplicitProductOrModelCodes(rawText).length === 0 &&
    intentInfo.intent !== "GREETING" &&
    intentInfo.intent !== "IDENTITY_META" &&
    intentInfo.intent !== "COMPANY_INFO" &&
    intentInfo.intent !== "LEADERSHIP_CONTACT_INFO" &&
    intentInfo.intent !== "CHAT_HISTORY_META" &&
    intentInfo.intent !== "HUMAN_HANDOFF_INFO" &&
    intentInfo.intent !== "OFF_TOPIC" &&
    intentInfo.intent !== "TOPIC_RESET" &&
    (convState.preferences.length > 0 ||
      Boolean(convState.dimensionsOrThickness) ||
      Boolean(convState.quantity) ||
      /\b(acrylic|perspex|pmma|polycarbonate|black|white|clear|transparent|frosted|gold|silver|wood|wooden)\b/i.test(
        rawText
      ));

  if (isPreferenceOnlyFragment) {
    await saveConversationAiState(params.conversationId, convState);
    const notedFinish =
      convState.preferences.length > 0
        ? `${convState.preferences.join(" ")} acrylic`
        : convState.dimensionsOrThickness || rawText;
    const greetPrefix = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
    const fragmentReply = formatWhatsAppOutboundText(
      `${greetPrefix}Noted *${notedFinish}*! Which product or custom item are you looking for in this finish (for example a stage podium, mobile phone locker, signage, display stand, box, or furniture)?\n\nJust share the item name or a reference photo and I will share matching options right away.`
    );
    addStep(
      "Saved colour/material fragment preference and prompted for product noun",
      `noted="${notedFinish}", prefs=[${convState.preferences.join(",")}]`
    );
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: rawText,
      model: "rule-fragment-preference-capture",
      outcomeSource: "LIVE_AI",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: "BYPASS",
      cacheDetails: `Captured colour/material preference (${notedFinish}) without guessing an unrelated product`,
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupBudget: null,
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: fragmentReply,
      durationMs: Date.now() - started,
    });
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      customerReply: fragmentReply,
      smartCategory: convState.activeCategory || "Custom Fabrication",
      priority: "NORMAL",
      conversationState: convState,
    };
  }

  // 2. Immediate deterministic handoff for explicit human requests, support issues, or order tracking
  if (intentInfo.needsImmediateHandoff) {
    let reply = "";
    let reason = "";
    let outPri: "URGENT" | "HIGH" | "NORMAL" = "HIGH";
    let outCat = convState.activeCategory || "General Enquiry";

    const stateParts: string[] = [];
    if (convState.primaryProductQuery) {
      stateParts.push(`product: ${convState.primaryProductQuery}`);
    }
    if (convState.maxPrice !== null && convState.minPrice !== null) {
      stateParts.push(
        `budget: ₹${convState.minPrice.toLocaleString("en-IN")} to ₹${convState.maxPrice.toLocaleString("en-IN")}`
      );
    } else if (convState.maxPrice !== null) {
      stateParts.push(`budget: up to ₹${convState.maxPrice.toLocaleString("en-IN")}`);
    } else if (convState.minPrice !== null) {
      stateParts.push(`budget: from ₹${convState.minPrice.toLocaleString("en-IN")}`);
    }
    if (convState.preferences.length > 0) {
      stateParts.push(`preferences: ${convState.preferences.join(", ")}`);
    }
    if (convState.dimensionsOrThickness) {
      stateParts.push(`size/thickness: ${convState.dimensionsOrThickness}`);
    }
    if (convState.quantity) {
      stateParts.push(`qty: ${convState.quantity}`);
    }
    const stateContextNote =
      stateParts.length > 0 ? ` • Context: ${stateParts.join(", ")}` : "";

    if (intentInfo.intent === "HUMAN_HANDOFF_REQUEST") {
      reply = alreadyGreeted
        ? `Sure, I am connecting you to our *Sales Team* right away.\n\nA team member will pick up this chat from here and help you shortly.`
        : `Hi ${firstName}! Connecting you to our *Sales Team* right away.\n\nA team member will reply to you here shortly.`;
      reason = `Customer asked to speak with our team ("${rawText.slice(0, 120)}")${stateContextNote}.`;
    } else if (intentInfo.intent === "SUPPORT_ISSUE") {
      reply = alreadyGreeted
        ? `I have flagged this directly for our *Sales & Support Team* so a senior team member can check it personally and resolve it for you right away.`
        : `Hi ${firstName}, I am connecting your chat directly to our *Sales & Support Team* so they can check this personally and help you right away.`;
      reason = `Query needs personal assistance from Sales Team ("${rawText.slice(0, 120)}")${stateContextNote}.`;
      outPri = "URGENT";
    } else {
      const trackOrigin = resolvePublicTrackingOrigin();
      reply = alreadyGreeted
        ? `You can check live courier status anytime on our tracking portal:\n${trackOrigin}\n\nI am also connecting our *Sales Team* here so they can verify your dispatch details personally.`
        : `Hi ${firstName}, you can check live courier status anytime here:\n${trackOrigin}\n\nI am also connecting our *Sales Team* so they can check your order status personally.`;
      reason = `Customer asked about a specific order ("${rawText.slice(0, 120)}")${stateContextNote}.`;
      outCat = "Order & Delivery";
    }

    const formatted = formatWhatsAppOutboundText(reply);
    addStep("Triggered immediate human handoff", reason);
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: rawText,
      model: "rule-handoff-guard",
      outcomeSource: "HUMAN_HANDOFF",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: "BYPASS",
      cacheDetails: `Intent=${intentInfo.intent} • Direct human handoff rule matched (skipped catalog lookup)`,
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupBudget: null,
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: formatted,
      durationMs: Date.now() - started,
    });

    return {
      needsHumanHandoff: true,
      handoffReason: reason,
      customerReply: formatted,
      smartCategory: outCat,
      priority: outPri,
      conversationState: convState,
    };
  }

  // 3. Conditional Catalog & Product Retrieval (ONLY when intent requires product lookup)
  let allItems: MainWebsiteProduct[] = [];
  let cacheMeta: CatalogCacheMeta = {
    ccCacheTier: "BYPASS",
    ce53CacheTier: "BYPASS",
    catalogCacheStatus: "BYPASS",
    cacheSummary: `Skipped catalog lookup for non-product intent=${intentInfo.intent}`,
  };
  let budgetLabel: string | null = null;
  let usedLookupQuery = "";
  let contextMatches: MainWebsiteProduct[] = [];
  let pinnedFocusItem: MainWebsiteProduct | null = null;
  let aggregateResult: { answer: string; items: MainWebsiteProduct[] } | null = null;
  let top: MainWebsiteProduct | undefined;
  let budgetFallbackLowestPrice: number | null = null;
  let budgetFallbackLowestItem: MainWebsiteProduct | null = null;

  const fetchedCatalog = await getCachedEcosystemCatalog();
  allItems = fetchedCatalog.allItems;
  const [liveOperationalContext, liveBrandInfo, trainingGuidance] = await Promise.all([
    loadLiveDatabaseOperationalContext({
      customerPhone: params.customerPhone,
      customerName: params.customerName,
      rawQuery: rawText,
      forStaffCopilot: false,
    }),
    getVerifiedLiveBrandAndTeamInfo().catch(() => null),
    findMatchingAiTrainingGuidance({
      queryText: rawText,
      scope: "CUSTOMER_CHAT",
      activeProductSlug: convState.focusProductSlug,
    }).catch(() => ({ rules: [], examples: [], promptBlock: "" })),
  ]);

  // Build shortlink map for multi-item project planner
  const shortLinkMap: Record<string, string> = {};
  for (const it of allItems) {
    const u = it.shortUrl || it.url;
    if (u) {
      shortLinkMap[`product:${it.slug}`.toLowerCase()] = u;
      shortLinkMap[`product:${it.id}`.toLowerCase()] = u;
    }
  }
  const projectPlan = buildMultiItemProjectPlan(allItems, rawText, shortLinkMap);
  const customerProfileInfo = detectAcrioCustomerProfile(rawText, recentInboundWindow);

  // If MENU_SELECTION ("1", "2") and lastMenuOptions wasn't populated, inspect last outbound message for numbered list items!
  if (intentInfo.intent === "MENU_SELECTION") {
    const lastOutbound = [...history].reverse().find((m) => m.direction === "OUTBOUND")?.body || "";
    const numMatch = rawText.trim().match(/^[\s*#]*(?:option\s*|category\s*|number\s*|no\.?\s*)?([1-5])[\s.)*]*$/i);
    const chosenNum = numMatch ? parseInt(numMatch[1], 10) : 1;
    const lineRegex = new RegExp(`(?:^|\\n)\\s*${chosenNum}[.)]\\s*\\*?([^\\n(*:]+)\\*?`, "i");
    const mLine = lastOutbound.match(lineRegex);
    if (mLine && mLine[1]) {
      const extractedOptionTitle = mLine[1].trim();
      convState.primaryProductQuery = extractedOptionTitle;
      if (/essential|signature|premium|custom[-\s]*built|podium/i.test(extractedOptionTitle)) {
        convState.productFamily = "podium";
        convState.activeCategory = "Podiums & Stage";
        convState.activeBrand = "CLASSIC_CONCEPTS";
      }
    }
  }

  if (intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling) {
    cacheMeta = fetchedCatalog.cacheMeta;
    addStep("Checked ecosystem catalog cache", cacheMeta.cacheSummary);

    const normalizedSearch = buildNormalizedSearchFromState(convState, rawText);
    usedLookupQuery = normalizedSearch.searchQuery;
    if (visionAnalysis) {
      const visionLookupTokens = [
        cleanCustomerText && !/^\[(?:image|photo)\b/i.test(cleanCustomerText)
          ? cleanCustomerText
          : "",
        visionAnalysis.recommendedSearchQuery,
        visionAnalysis.productType,
        ...visionAnalysis.readableModelCodes,
        ...visionAnalysis.visibleComponents.slice(0, 3),
      ]
        .map((s) => String(s || "").trim())
        .filter(Boolean);
      if (visionLookupTokens.length > 0) {
        usedLookupQuery = Array.from(new Set(visionLookupTokens)).join(" ");
      }
    }
    budgetLabel = normalizedSearch.budgetLabel;

    const prevMaxPrice = storedState?.maxPrice ?? null;
    const explicitCodesInTurn = extractExplicitProductOrModelCodes(rawText);
    const dimsInTurn = extractCompactDimensionPairsFromText(rawText);
    const hasExplicitCodeOrDimInTurn =
      explicitCodesInTurn.length > 0 ||
      dimsInTurn.pairs.length > 0 ||
      dimsInTurn.ranges.length > 0;
    const budgetChangedInTurn = prevMaxPrice !== convState.maxPrice;

    // Resolve the product the customer is currently talking about (survives across turns, and prioritizes quoted/replied-to messages!).
    const findItemBySlug = (slug?: string | null) =>
      slug ? allItems.find((it) => (it.slug || "").toLowerCase() === slug.toLowerCase()) : undefined;

    let quotedFocusItem: MainWebsiteProduct | undefined;
    let quotedMultipleItems: MainWebsiteProduct[] = [];
    if (quotedReplyContext) {
      if (quotedReplyContext.productSlug) {
        quotedFocusItem = findItemBySlug(quotedReplyContext.productSlug);
      }
      if (!quotedFocusItem && quotedBody) {
        const fromLinks = resolveProductsFromOutboundText(quotedBody, allItems);
        if (fromLinks.length === 1) {
          quotedFocusItem = fromLinks[0];
        } else if (fromLinks.length >= 2) {
          quotedMultipleItems = fromLinks;
        } else {
          const qCodes = extractExplicitProductOrModelCodes(quotedBody);
          if (qCodes.length === 1) {
            quotedFocusItem = allItems.find((it) =>
              `${it.sku || ""} ${it.slug}`
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "")
                .includes(qCodes[0].toLowerCase().replace(/[^a-z0-9]/g, ""))
            );
          }
        }
      }
    }

    let focusItem = visionAnalysis
      ? quotedFocusItem
      : quotedFocusItem || findItemBySlug(convState.focusProductSlug);
    if (
      !visionAnalysis &&
      !focusItem &&
      !convState.switchedThisTurn &&
      !hasExplicitCodeOrDimInTurn &&
      !isMultiProductReference(rawText) &&
      !ACRIO_DOMAIN_PRODUCT_NOUN_RE.test(lower)
    ) {
      // Derive from earlier customer turns ONLY when this turn did NOT introduce a new product or SKU!
      const priorInbound = history.filter((m) => m.direction === "INBOUND").map((m) => m.body);
      for (let i = priorInbound.length - 1; i >= 0 && !focusItem; i--) {
        const codes = extractExplicitProductOrModelCodes(priorInbound[i]);
        if (codes.length === 1) {
          focusItem = allItems.find((it) =>
            `${it.sku || ""} ${it.slug}`.toLowerCase().replace(/[^a-z0-9]/g, "").includes(codes[0].toLowerCase().replace(/[^a-z0-9]/g, ""))
          );
        }
      }
      // Or if the previous turn recommended a single product, use it when the customer asks for "its images" / "this model" / short continuation.
      if (
        !focusItem &&
        convState.lastRecommendedProducts.length === 1 &&
        (isProductImageRequest(rawText) || rawText.split(/\s+/).length <= 8)
      ) {
        focusItem = findItemBySlug(convState.lastRecommendedProducts[0].slug);
      }
    }

    aggregateResult = buildCatalogAggregateAnswer(allItems, rawText);
    const listPickItem =
      (quotedBody ? resolveListPickFromLastReply(rawText, quotedBody, allItems) : null) ||
      resolveListPickFromLastReply(rawText, lastOutboundBody, allItems) ||
      (isListPickText(rawText) && (storedState?.lastListedSlugs || []).length > 0 && /View options/i.test(outboundBodies[0] || "")
        ? (() => {
            const slugs = storedState!.lastListedSlugs!;
            const t = rawText.toLowerCase();
            const word = t.match(/\b(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\b/)?.[1];
            const num = t.match(/(?:option|number|no\.?|#)\s*([1-9])\b/)?.[1] || t.match(/^\s*([1-9])[\s.)!]*$/)?.[1];
            let idx = -2;
            if (word) idx = ACRIO_ORDINALS[word];
            else if (num) idx = parseInt(num, 10) - 1;
            const slug = idx === -1 ? slugs[slugs.length - 1] : idx >= 0 ? slugs[idx] : undefined;
            return slug ? findItemBySlug(slug) || null : null;
          })()
        : null);
    const forcedItem = findItemBySlug(params.forcedFocusSlug);
    if (forcedItem) {
      pinnedFocusItem = forcedItem;
      contextMatches = [forcedItem];
      addStep("Opened product from list", `Customer tapped "${forcedItem.name}" in View options`);
    } else if (aggregateResult && !projectPlan.isMultiItemOrTotalling) {
      contextMatches = aggregateResult.items;
    } else if (listPickItem && !projectPlan.isMultiItemOrTotalling) {
      pinnedFocusItem = listPickItem;
      contextMatches = [listPickItem];
      addStep("Resolved list pick", `Customer picked "${listPickItem.name}" from the list we just sent`);
    } else if (
      focusItem &&
      !projectPlan.isMultiItemOrTotalling &&
      !normalizedSearch.preferCheapest &&
      !normalizedSearch.asksMoreOrAlternative &&
      isFocusedProductFollowUp(rawText, focusItem, Boolean(quotedFocusItem))
    ) {
      pinnedFocusItem = focusItem;
      contextMatches = [focusItem];
      addStep(
        "Pinned focus product",
        quotedFocusItem
          ? `Customer quoted/replied directly to "${focusItem.name}"`
          : `Follow-up refers to "${focusItem.name}" (kept from earlier in the chat)`
      );
    } else if (quotedMultipleItems.length >= 2 && !hasExplicitCodeOrDimInTurn) {
      contextMatches = quotedMultipleItems;
      addStep("Resolved products from quoted message", `matched=${quotedMultipleItems.length} products from quoted reply`);
    } else if (projectPlan.isMultiItemOrTotalling && projectPlan.matchedProducts.length > 0) {
      contextMatches = projectPlan.matchedProducts;
    } else if (intentInfo.intent === "MENU_SELECTION" && /essential\s*podium/i.test(convState.primaryProductQuery || "")) {
      contextMatches = allItems
        .filter(
          (it) =>
            it.brand === "CLASSIC_CONCEPTS" &&
            ((it.podiumSubCategoryNames || []).some((s) => /essential/i.test(s)) ||
              /\b(ccp057s|ccp054|ccp057|ccp058|ccp060)\b/i.test(it.sku || it.name))
        )
        .sort((a, b) => (a.basePrice || 999999) - (b.basePrice || 999999))
        .slice(0, 6);
    } else if (intentInfo.intent === "MENU_SELECTION" && /signature\s*podium/i.test(convState.primaryProductQuery || "")) {
      contextMatches = allItems
        .filter(
          (it) =>
            it.brand === "CLASSIC_CONCEPTS" &&
            (it.podiumSubCategoryNames || []).some((s) => /signature/i.test(s))
        )
        .sort((a, b) => (a.basePrice || 999999) - (b.basePrice || 999999))
        .slice(0, 6);
    } else if (intentInfo.intent === "MENU_SELECTION" && /premium\s*podium/i.test(convState.primaryProductQuery || "")) {
      contextMatches = allItems
        .filter(
          (it) =>
            it.brand === "CLASSIC_CONCEPTS" &&
            (it.podiumSubCategoryNames || []).some((s) => /premium/i.test(s))
        )
        .sort((a, b) => (b.basePrice || 0) - (a.basePrice || 0))
        .slice(0, 6);
    } else if (
      !hasExplicitCodeOrDimInTurn &&
      !budgetChangedInTurn &&
      convState.lastRecommendedProducts.length > 0 &&
      (intentInfo.intent === "PRODUCT_COMPARISON" ||
        intentInfo.intent === "FOLLOW_UP_REFINEMENT") &&
      (isMultiProductReference(rawText) ||
        /\b(first\s*two|top\s*two|both|these|those|them|which\s+one|which\s+of\s+these|wider|widest|larger|largest|bigger|biggest|taller|tallest|reading\s*top|top\s*sheet|dimension|dimensions|spec|specs|specification|specifications|variant|variants|color|colors|colour|colours|feature|features|pillar|pillars|warranty)\b/i.test(
          rawText
        )) &&
      !(
        extractNormalizedColourTokens(rawText).length > 0 &&
        /\b(podiums|pulpits|lecterns|chairs|tables|stands|trophies|awards|boxes|models|options|products|have|with)\b/i.test(
          rawText
        )
      ) &&
      !/\b(any\s*more|more\s*options|other\s*options|cheaper\s*alternative|smaller\s*top|save\s*more)\b/i.test(rawText)
    ) {
      // First check if the last outbound message explicitly listed products (e.g. CCP053, CCP060, CCP055)
      const outboundListed = resolveProductsFromOutboundText(
        outboundBodies[0] || lastOutboundBody,
        allItems
      );
      if (isMultiProductReference(rawText) && outboundListed.length >= 2) {
        const sliceCount = /\b(first\s*two|top\s*two|both|these\s*two|those\s*two)\b/i.test(
          rawText
        )
          ? 2
          : /\b(all\s*three|these\s*three|those\s*three|three)\b/i.test(rawText)
          ? 3
          : outboundListed.length;
        contextMatches = outboundListed.slice(0, sliceCount);
      } else {
        const sliceCount = /\b(first\s*two|top\s*two|both|these\s*two|those\s*two)\b/i.test(
          rawText
        )
          ? 2
          : convState.lastRecommendedProducts.length;
        const targetSlugs = new Set(
          convState.lastRecommendedProducts
            .slice(0, sliceCount)
            .map((p) => p.slug || p.id)
        );
        contextMatches = allItems.filter((it) =>
          targetSlugs.has(it.slug || it.id)
        );
      }
    }

    // If the customer is searching across a category for a specific colour/variant (e.g. "podiums with frost white color" or "podiums that have frosted white variant"), prioritize products that actually have that variant!
    if (
      !pinnedFocusItem &&
      !hasExplicitCodeOrDimInTurn &&
      extractNormalizedColourTokens(rawText).length > 0
    ) {
      const variantCatalogHits = findCatalogProductsByVariantTokens(
        allItems,
        rawText,
        convState.productFamily,
        convState.primaryProductQuery
      );
      if (variantCatalogHits.length > 0) {
        contextMatches = variantCatalogHits.map((h) => h.item).slice(0, 8);
        addStep(
          "Filtered catalog by variant colour tokens",
          `tokens=[${extractNormalizedColourTokens(rawText).join(",")}], matched=${variantCatalogHits.length} (${contextMatches.slice(0, 4).map((m) => m.sku || m.slug).join(", ")})`
        );
      }
    }

    if (contextMatches.length === 0) {
      const budgetRaised =
        prevMaxPrice !== null &&
        convState.maxPrice !== null &&
        convState.maxPrice > prevMaxPrice;
      const rawMatches = searchEcosystemItems(
        allItems,
        usedLookupQuery,
        budgetRaised ? 16 : 12,
        normalizedSearch.searchOptions
      );
      if (budgetRaised) {
        const newlyUnlocked = rawMatches.filter(
          (it) => typeof it.basePrice === "number" && it.basePrice > prevMaxPrice
        );
        const existingTier = rawMatches.filter(
          (it) => !(typeof it.basePrice === "number" && it.basePrice > prevMaxPrice)
        );
        contextMatches = [...newlyUnlocked, ...existingTier].slice(0, 12);
      } else {
        contextMatches = rawMatches;
      }
    }

    if (usedLookupQuery !== rawText) {
      const directFallback = searchEcosystemItems(
        allItems,
        rawText,
        12,
        normalizedSearch.searchOptions
      );
      if (contextMatches.length === 0 && directFallback.length > 0) {
        contextMatches = directFallback;
        usedLookupQuery = rawText;
      } else if (hasExplicitCodeOrDimInTurn && directFallback.length > 0) {
        const seen = new Set<string>();
        contextMatches = [...directFallback, ...contextMatches]
          .filter((it) => {
            const k = `${it.brand}:${it.slug || it.id}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .slice(0, 12);
      }
    }

    // Core-noun relevance guard: never keep unrelated colour/material matches (e.g. "Acrylic Bathroom Stool" for "black acrylic mobile phone locker")!
    if (!pinnedFocusItem && !hasExplicitCodeOrDimInTurn && contextMatches.length > 0 && !aggregateResult) {
      const coreNounProbe = `${convState.primaryProductQuery || ""} ${visionAnalysis?.productType || ""} ${rawText}`.trim();
      const coreRank = rankItemsByCustomerCoreNouns(contextMatches, coreNounProbe);
      if (coreRank.coreNouns.length > 0) {
        if (coreRank.anyMatch) {
          contextMatches = coreRank.ranked.filter(
            (it) => countCoreNounMatches(it, coreRank.coreNouns) > 0
          );
        } else {
          contextMatches = [];
        }
      }
    }

    // Domain isolation guard for image-based product vs machine discovery and follow-up turns
    const desiredBrand =
      visionAnalysis &&
      (visionAnalysis.businessDomain === "CLASSIC_CONCEPTS" ||
        visionAnalysis.businessDomain === "CLASSIC_EDGE_53")
        ? visionAnalysis.businessDomain
        : !convState.switchedThisTurn &&
          (convState.activeBrand === "CLASSIC_CONCEPTS" ||
            convState.activeBrand === "CLASSIC_EDGE_53")
        ? convState.activeBrand
        : null;
    if (desiredBrand && contextMatches.length > 0) {
      const brandOnly = contextMatches.filter((it) => it.brand === desiredBrand);
      if (brandOnly.length > 0) {
        contextMatches = brandOnly;
      }
    }

    if (normalizedSearch.preferCheapest && contextMatches.length > 1) {
      contextMatches = [...contextMatches].sort((a, b) => {
        const pa = typeof a.basePrice === "number" && a.basePrice > 0 ? a.basePrice : Number.MAX_SAFE_INTEGER;
        const pb = typeof b.basePrice === "number" && b.basePrice > 0 ? b.basePrice : Number.MAX_SAFE_INTEGER;
        return pa - pb;
      });
    }

    if (
      contextMatches.length === 0 &&
      (convState.maxPrice !== null || convState.minPrice !== null)
    ) {
      const fbInfo = getEcosystemBudgetFallbackInfo(
        allItems,
        usedLookupQuery,
        normalizedSearch.searchOptions
      );
      budgetFallbackLowestPrice = fbInfo.lowestAvailablePrice;
      budgetFallbackLowestItem = fbInfo.lowestAvailableItem;
    }

    top = contextMatches[0];

    // Remember the single product under discussion so the next message ("this model", "its price") stays on it.
    if (pinnedFocusItem) {
      convState.focusProductSlug = pinnedFocusItem.slug;
    } else if (explicitCodesInTurn.length === 1 && contextMatches.length > 0) {
      const codeKey = explicitCodesInTurn[0].toLowerCase().replace(/[^a-z0-9]/g, "");
      const exact = contextMatches.find((it) =>
        `${it.sku || ""} ${it.slug}`.toLowerCase().replace(/[^a-z0-9]/g, "").includes(codeKey)
      );
      convState.focusProductSlug = (exact || contextMatches[0]).slug;
      top = exact || top;
    } else if (contextMatches.length === 1) {
      convState.focusProductSlug = contextMatches[0].slug;
    } else if (explicitCodesInTurn.length >= 2 || (contextMatches.length > 1 && !aggregateResult)) {
      convState.focusProductSlug = null;
    }

    if (params.uiSink) {
      const focusForUi = convState.focusProductSlug
        ? allItems.find((it) => (it.slug || "").toLowerCase() === String(convState.focusProductSlug).toLowerCase()) || null
        : null;
      Object.assign(params.uiSink, {
        intent: intentInfo.intent,
        matches: contextMatches,
        focus: focusForUi,
        aggregate: Boolean(aggregateResult),
        multiItem: Boolean(projectPlan.isMultiItemOrTotalling),
        explicitCodes: explicitCodesInTurn.length,
        budgetLabel,
        languageMode: convState.languageMode,
      });
    }

    if (contextMatches.length > 0) {
      convState.lastRecommendedProducts = contextMatches.slice(0, 5).map((it) => ({
        id: it.id,
        name: cleanDisplayProductName(it.name),
        slug: it.slug,
        priceInr: it.basePrice,
        shortUrl: it.shortUrl || it.url,
        itemType: it.itemType,
      }));
      const mergedShown = new Set([
        ...(convState.shownProductSlugs || []),
        ...contextMatches.slice(0, 3).map((it) => (it.slug || "").toLowerCase()).filter(Boolean),
      ]);
      convState.shownProductSlugs = Array.from(mergedShown).slice(-18);
    }
    await saveConversationAiState(params.conversationId, convState);

    addStep(
      "Executed catalog product lookup",
      `query="${usedLookupQuery.slice(0, 90)}"${budgetLabel ? `, budget="${budgetLabel}"` : ""}${convState.excludedItemTypes.length ? `, excluded=[${convState.excludedItemTypes.join(",")}]` : ""}, matched=${contextMatches.length} of ${allItems.length} items`
    );
  } else {
    await saveConversationAiState(params.conversationId, convState);
    addStep(
      "Skipped catalog product lookup",
      `Non-product turn (${intentInfo.intent})`
    );
  }

  let smartCategory = convState.activeCategory || "General Enquiry";
  let priority: "URGENT" | "HIGH" | "NORMAL" = "NORMAL";

  if (intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling) {
    const classificationProbe = `${convState.primaryProductQuery || ""} ${rawText}`.toLowerCase();
    if (
      convState.activeCategory === "Acrylic Machines (CE53)" ||
      /machine|laser|router|polish|diamond|bending|bender|heater|yn-|ce53|classic edge|consumable|blade|cutter|flame|buffing|cloudy\s*edge|rough\s*edge/i.test(
        classificationProbe
      )
    ) {
      smartCategory = "Acrylic Machines (CE53)";
      priority = "HIGH";
    } else if (
      convState.activeCategory === "Podiums & Stage" ||
      /podium|podiums|lectern|lecterns|pulpit|pulpits|rostrum|stage|auditorium|conference/i.test(
        classificationProbe
      )
    ) {
      smartCategory = "Podiums & Stage";
      priority = /friday|urgent|tomorrow|today/i.test(lower) ? "URGENT" : "HIGH";
    } else if (
      convState.activeCategory === "Awards & Trophies" ||
      /trophy|trophies|memento|award|student|convocation|plaque|gift|corporate\s*clients?/i.test(classificationProbe)
    ) {
      smartCategory = "Awards & Trophies";
    } else if (
      convState.activeCategory === "Hotel & Banquet" ||
      /hotel|banquet|menu|qr|resort|hospitality|tent\s*card|table\s*stand|sign\s*holder/i.test(
        classificationProbe
      )
    ) {
      smartCategory = "Hotel & Banquet";
      priority = "HIGH";
    } else if (
      convState.activeCategory === "Custom Fabrication" ||
      /cover|guard|enclosure|box|case|display\s*stand|riser|custom|mm|inch|furniture|interior|chair|stool|table|signage|name\s*plate/i.test(
        classificationProbe
      )
    ) {
      smartCategory = "Custom Fabrication";
      priority = "HIGH";
    } else if (/order|dispatch|delivery|tracking|courier|invoice|advance|payment/i.test(classificationProbe)) {
      smartCategory = "Order & Delivery";
    }
  }

  const hidePricesActive = Boolean(convState.hidePrices);

  // 3b. Direct Product & Variant Image / Video / PDF Brochure Sharing from Storage
  const focusForPdf =
    pinnedFocusItem ||
    (convState.focusProductSlug
      ? allItems.find(
          (it) =>
            (it.slug || "").toLowerCase() ===
            String(convState.focusProductSlug).toLowerCase()
        ) || null
      : null);
  const pdfResolved = resolveCatalogPdfAttachments(allItems, rawText, focusForPdf);
  if (pdfResolved && pdfResolved.attachments.length > 0 && !projectPlan.isMultiItemOrTotalling) {
    const greetPrefix = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
    const pdfReply = stripRepeatedGreeting(
      formatWhatsAppOutboundText(`${greetPrefix}${pdfResolved.replyText}`),
      alreadyGreeted,
      params.customerName
    );
    addStep(
      "Resolved official PDF catalogue attachments",
      `attachments=${pdfResolved.attachments.length}`
    );
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: rawText,
      model: "r2-pdf-catalogue-resolver",
      outcomeSource: "LIVE_AI",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: cacheMeta.catalogCacheStatus,
      cacheDetails: `Shared ${pdfResolved.attachments.length} PDF catalogue(s)`,
      productLookupTriggered: true,
      productLookupQuery: rawText,
      productLookupBudget: budgetLabel,
      productLookupTotalScanned: allItems.length,
      productsLookedUp: [],
      steps,
      response: pdfReply,
      durationMs: Date.now() - started,
    });
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      needsSalesTeamPing: false,
      salesTeamPingNote: "",
      customerReply: pdfReply,
      smartCategory,
      priority,
      conversationState: convState,
      mediaAttachments: pdfResolved.attachments,
    };
  }

  const isShortVariantFollowUp =
    Boolean(pinnedFocusItem) &&
    extractNormalizedColourTokens(rawText).length > 0 &&
    rawText.trim().split(/\s+/).length <= 6 &&
    matchProductVariantsByColourTokens(pinnedFocusItem?.variants || [], rawText).length > 0 &&
    (/\b(photos?|images?|pictures?|variant|colour|color)\b/i.test(outboundBodies[0] || "") ||
      !/\b(price|cost|height|size|dimension|warranty)\b/i.test(rawText));

  const asksForImages = isProductImageRequest(rawText) || isShortVariantFollowUp;
  const explicitCodesForImg = extractExplicitProductOrModelCodes(rawText);
  const isMultiImageTurn =
    asksForImages &&
    !projectPlan.isMultiItemOrTotalling &&
    (isMultiProductReference(rawText) ||
      explicitCodesForImg.length >= 2 ||
      (!pinnedFocusItem &&
        explicitCodesForImg.length === 0 &&
        contextMatches.length >= 2 &&
        /\b(podiums|pulpits|lecterns|chairs|tables|stands|trophies|awards|boxes|models|options|products)\b/i.test(
          rawText
        )));

  if (isMultiImageTurn) {
    const outboundListed = resolveProductsFromOutboundText(
      outboundBodies[0] || lastOutboundBody,
      allItems
    );
    let multiTargetItems: MainWebsiteProduct[] = [];
    if (isMultiProductReference(rawText) && outboundListed.length >= 2) {
      const sliceCount = /\b(first\s*two|top\s*two|both|these\s*two|those\s*two)\b/i.test(rawText)
        ? 2
        : /\b(all\s*three|these\s*three|those\s*three|three)\b/i.test(rawText)
        ? 3
        : outboundListed.length;
      multiTargetItems = outboundListed.slice(0, sliceCount);
    } else if (contextMatches.length >= 2) {
      multiTargetItems = contextMatches.slice(0, 3);
    } else if (convState.lastRecommendedProducts.length >= 2) {
      const recSlugs = new Set(convState.lastRecommendedProducts.slice(0, 3).map((p) => p.slug || p.id));
      multiTargetItems = allItems.filter((it) => recSlugs.has(it.slug || it.id)).slice(0, 3);
    }

    if (multiTargetItems.length >= 2) {
      const colourQuerySource =
        extractNormalizedColourTokens(rawText).length > 0
          ? rawText
          : extractNormalizedColourTokens(outboundBodies[0] || "").length > 0
          ? outboundBodies[0] || ""
          : recentInboundWindow;
      const multiMedia = resolveMultiProductMediaAttachments(
        multiTargetItems,
        colourQuerySource,
        hidePricesActive
      );
      if (multiMedia.attachments.length > 0) {
        convState.focusProductSlug = null;
        convState.lastRecommendedProducts = multiTargetItems.map((it) => ({
          id: it.id,
          name: cleanDisplayProductName(it.name),
          slug: it.slug,
          priceInr: it.basePrice,
          shortUrl: it.shortUrl || it.url,
          itemType: it.itemType,
        }));
        await saveConversationAiState(params.conversationId, convState);
        const greetPrefix = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
        const multiReply = stripRepeatedGreeting(
          formatWhatsAppOutboundText(`${greetPrefix}${multiMedia.replyText}`),
          alreadyGreeted,
          params.customerName
        );
        addStep(
          "Resolved multi-product & variant images from R2 storage",
          `products=[${multiTargetItems.map((p) => p.sku || p.slug).join(", ")}], attachments=${multiMedia.attachments.length}`
        );
        recordAndBroadcastAiLog({
          website: "WHATSAPP_HUB",
          websiteLabel: "Classic Concepts WhatsApp Hub",
          feature: "Autonomous WhatsApp Concierge (ACRIO)",
          actor: params.customerName,
          question: rawText,
          model: "r2-multi-product-media-resolver",
          outcomeSource: "LIVE_AI",
          responseCacheStatus: "BYPASS",
          catalogCacheStatus: cacheMeta.catalogCacheStatus,
          cacheDetails: `Shared ${multiMedia.attachments.length} R2 product/variant image(s) across ${multiTargetItems.length} products`,
          productLookupTriggered: true,
          productLookupQuery: usedLookupQuery || rawText,
          productLookupBudget: budgetLabel,
          productLookupTotalScanned: allItems.length,
          productsLookedUp: multiTargetItems.map(mapProductToLogItem),
          steps,
          response: multiReply,
          durationMs: Date.now() - started,
        });
        return {
          needsHumanHandoff: false,
          handoffReason: "",
          needsSalesTeamPing: false,
          salesTeamPingNote: "",
          customerReply: multiReply,
          smartCategory,
          priority,
          conversationState: convState,
          mediaAttachments: multiMedia.attachments,
        };
      }
    }
  }

  const combinedEnquiryProbe = `${convState.primaryProductQuery || ""} ${rawText}`.trim();
  const isCustomStructureEnquiry =
    /\b(locker|lockers|mobile\s*locker|phone\s*locker|cupboard|almirah|wardrobe|pigeon\s*hole|partition|sneeze\s*guard|key\s*cabinet|medicine\s*box)\b/i.test(
      combinedEnquiryProbe
    ) &&
    (!top ||
      !/\b(locker|cupboard|almirah|wardrobe|pigeon\s*hole|partition|sneeze\s*guard|key\s*cabinet|medicine\s*box)\b/i.test(
        top.name
      ));

  const candidateImageTargetItem = asksForImages
    ? pinnedFocusItem ||
      (convState.focusProductSlug
        ? allItems.find(
            (it) =>
              (it.slug || "").toLowerCase() ===
              String(convState.focusProductSlug).toLowerCase()
          ) || null
        : null) ||
      top ||
      (convState.lastRecommendedProducts[0]
        ? allItems.find(
            (it) =>
              (it.slug || "").toLowerCase() ===
              String(convState.lastRecommendedProducts[0].slug).toLowerCase()
          ) || null
        : null)
    : null;
  const turnImgCoreNouns = extractCustomerCoreNouns(rawText);
  const imageTargetMatchesCoreNouns =
    Boolean(pinnedFocusItem) ||
    explicitCodesForImg.length > 0 ||
    turnImgCoreNouns.length === 0 ||
    (Boolean(candidateImageTargetItem) &&
      countCoreNounMatches(candidateImageTargetItem!, turnImgCoreNouns) > 0);
  const imageTargetItem =
    candidateImageTargetItem &&
    imageTargetMatchesCoreNouns &&
    !isCustomStructureEnquiry &&
    !hasBurstReferenceMedia
      ? candidateImageTargetItem
      : null;
  const resolvedMedia =
    asksForImages && imageTargetItem
      ? resolveProductMediaAttachments(imageTargetItem, rawText, hidePricesActive)
      : null;

  if (
    resolvedMedia &&
    resolvedMedia.attachments.length > 0 &&
    imageTargetItem &&
    !projectPlan.isMultiItemOrTotalling &&
    intentInfo.intent !== "PRODUCT_COMPARISON"
  ) {
    convState.focusProductSlug = imageTargetItem.slug;
    if (params.uiSink) {
      params.uiSink.focus = imageTargetItem;
    }
    await saveConversationAiState(params.conversationId, convState);
    const greetPrefix = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
    const mediaReply = stripRepeatedGreeting(
      formatWhatsAppOutboundText(`${greetPrefix}${resolvedMedia.replyText}`),
      alreadyGreeted,
      params.customerName
    );
    addStep(
      "Resolved product & variant images from R2 storage",
      `product="${cleanDisplayProductName(imageTargetItem.name)}", attachments=${resolvedMedia.attachments.length}, matchedVariant=${resolvedMedia.matchedVariant}`
    );
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: rawText,
      model: "r2-product-media-resolver",
      outcomeSource: "LIVE_AI",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: cacheMeta.catalogCacheStatus,
      cacheDetails: `Shared ${resolvedMedia.attachments.length} R2 product/variant image(s) for ${imageTargetItem.slug}`,
      productLookupTriggered: true,
      productLookupQuery: usedLookupQuery || rawText,
      productLookupBudget: budgetLabel,
      productLookupTotalScanned: allItems.length,
      productsLookedUp: [mapProductToLogItem(imageTargetItem)],
      steps,
      response: mediaReply,
      durationMs: Date.now() - started,
    });
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      needsSalesTeamPing: false,
      salesTeamPingNote: "",
      customerReply: mediaReply,
      smartCategory,
      priority,
      conversationState: convState,
      mediaAttachments: resolvedMedia.attachments,
    };
  }

  const prebuiltGroupedBlock =
    intentInfo.requiresProductLookup && !projectPlan.isMultiItemOrTotalling
      ? buildGroupedProductShortLinksSection({
          allItems,
          matchedItems: contextMatches,
          smartCategory,
          excludeConsumables: convState.excludedItemTypes.includes("CONSUMABLE"),
          hasStrictBudget: convState.maxPrice !== null || convState.minPrice !== null,
          hidePrices: hidePricesActive,
          maxItems: 3,
        })
      : "";

  const deepProductInfo =
    intentInfo.requiresProductLookup && !projectPlan.isMultiItemOrTotalling && !aggregateResult
      ? buildEcosystemDeepProductContextAndAnswer({
          rawQuery: rawText,
          matchedItems: contextMatches,
          formatItemLink: (it) => it.shortUrl || it.url,
        })
      : null;

  // Build Podium Sub-Categories Overview when CATEGORY_OVERVIEW is requested
  const podiumSubCategoriesText =
    intentInfo.intent === "CATEGORY_OVERVIEW"
      ? [
          `Here are the *4 sub-categories* under our *Acrylic Podiums & Pulpits* range:`,
          `1. *Essential Podiums*${hidePricesActive ? "" : " (₹7,150 to ₹23,650)"}: Compact, lightweight single and double pillar podiums ideal for classrooms, offices, and daily seminars (such as *CCP057S*, *CCP054*, *CCP057*, *CCP060*).`,
          `2. *Classic Signature Podiums*${hidePricesActive ? "" : " (₹19,250 to ₹28,600)"}: Wide-stage auditoria and church pulpits with generous reading tops and front logo panels (such as *CCP065*, *CCP055*, *CCP061*, *CCP064*).`,
          `3. *Premium Podiums*${hidePricesActive ? "" : " (₹28,600 to ₹55,000)"}: Heavy-duty executive, motorized/height-adjustable, LED-lit, and acrylic-plus-wood flagship lecterns (such as *CCP074*, *CCP084*, *CCP094*, *CCP111*).`,
          `4. *Custom-Built Podiums*: Made-to-order stage lecterns crafted to your exact dimensions, tint, LED backlighting, and institution crest.`,
          `\nReply with *1*, *2*, *3*, or *4* (or tell me your venue type) to see the top models in that category!`,
        ].join("\n")
      : "";

  // Determine if Consultative Sales Team Ping (without transferring chat away from ACRIO) is appropriate (Decision #4)
  let needsSalesTeamPing = Boolean(projectPlan.needsSalesTeamPing);
  let salesTeamPingNote = projectPlan.needsSalesTeamPing
    ? `ACRIO Consultative Ping: Customer requested multi-item/bulk project pricing ("${rawText.slice(0, 140)}"). ACRIO shared itemized math and remains active on the chat; a single Sales Team reply with bulk discount can resolve this.`
    : "";
  if (
    !needsSalesTeamPing &&
    /\b(bulk\s*discount|discount|negotiate|best\s*rate|final\s*price|custom\s*quote|renovation|proforma|gst\s*quote|\d{2,}\s*(?:pcs|pieces|units|chairs|podiums|signages))\b/i.test(
      rawText
    )
  ) {
    needsSalesTeamPing = true;
    salesTeamPingNote = `ACRIO Consultative Ping: Customer asked about bulk/custom pricing or discount ("${rawText.slice(0, 140)}"). ACRIO stays assigned; drop a single reply if special pricing applies.`;
  }

  // 4. Multi-turn Claude Haiku 5.5 (Medium Effort) Diagnostic & Conversational Assistant
  const { apiKey, source: keySource } = await resolveSharedAnthropicApiKey("client");
  const hasLegacyUnanalyzedMedia = hasBurstReferenceMedia && !visionAnalysis;
  const imageNeedsTeamHandoff = Boolean(
    visionAnalysis &&
      visionAnalysis.isDesignSketchOrDrawing &&
      (visionAnalysis.needsCustomFabrication || visionAnalysis.unreadableDetails.length > 0)
  );
  let lastAiError: string | null = null;
  let lastUsage: AiTokenUsage | null = null;

  if (apiKey) {
    try {
      const trimmedHistory = history.slice(-16);
      const lastInHistory = trimmedHistory[trimmedHistory.length - 1];
      const historyWithoutDuplicateCurrent =
        lastInHistory &&
        lastInHistory.direction === "INBOUND" &&
        lastInHistory.body.trim() === rawText
          ? trimmedHistory.slice(0, -1)
          : trimmedHistory;

      const claudeMessages: { role: "user" | "assistant"; content: string }[] = [];
      for (const msg of historyWithoutDuplicateCurrent) {
        const role: "user" | "assistant" =
          msg.direction === "INBOUND" ? "user" : "assistant";
        const body = String(msg.body || "")
          .replace(/93467\s*63253/g, "73372 22876")
          .trim();
        if (!body) continue;
        const prev = claudeMessages[claudeMessages.length - 1];
        if (prev && prev.role === role) {
          prev.content = `${prev.content}\n${body}`;
        } else {
          claudeMessages.push({ role, content: body });
        }
      }

      while (claudeMessages.length > 0 && claudeMessages[0].role !== "user") {
        claudeMessages.shift();
      }

      // Check which closing questions were already asked in the last 2 outbound messages so ACRIO never nags!
      const recentOutboundText = historyWithoutDuplicateCurrent
        .filter((m) => m.direction === "OUTBOUND")
        .slice(-2)
        .map((m) => m.body)
        .join(" ")
        .toLowerCase();
      const alreadyAskedCityRecently = /\b(which\s+city|delivery\s+city|dispatch\s+to|event\s+in)\b/i.test(
        recentOutboundText
      );
      const alreadyAskedLogoRecently = /\b(logo\s+printing|custom\s+front\s+logo|institution\s+logo)\b/i.test(
        recentOutboundText
      );
      const antiRepeatRule =
        alreadyAskedCityRecently || alreadyAskedLogoRecently || customerProfileInfo.customerProfile === "STUDENT_EXPLORER"
          ? `CRITICAL ANTI-REPETITION RULE: You ALREADY asked about ${alreadyAskedCityRecently ? "delivery city" : ""}${alreadyAskedCityRecently && alreadyAskedLogoRecently ? " and " : ""}${alreadyAskedLogoRecently ? "logo printing" : ""} in recent messages (or customer is a student). DO NOT ask "which city" or "do you want logo printing" again in this reply! Instead, end with a fresh, helpful product-specific question or no question at all.`
          : "";

      let catalogContext = "";
      if (projectPlan.isMultiItemOrTotalling) {
        catalogContext = `Turn Intent: MULTI_ITEM_PROJECT (Multi-item quantity and budget totalling).
Verified Multi-Item Project Calculation & Combinations (share these exact unit prices, quantities, line totals, shortlinks, and within-budget options clearly):
${projectPlan.summaryText}`;
      } else if (intentInfo.intent === "CATEGORY_OVERVIEW" && podiumSubCategoriesText) {
        catalogContext = `Turn Intent: CATEGORY_OVERVIEW (Customer asked for the sub-categories under Acrylic Podiums).
Use this exact verified sub-category breakdown:
${podiumSubCategoriesText}`;
      } else if (!intentInfo.requiresProductLookup) {
        if (intentInfo.intent === "LEADERSHIP_CONTACT_INFO") {
          catalogContext = `Turn Intent: LEADERSHIP_CONTACT_INFO (Customer is asking for company leadership, chairperson, marketing, sales, or department-wise contact details).
Answer directly using the exact names, roles/departments, email addresses, and phone/WhatsApp numbers from the [Live Database Operational Context] below! Share all relevant contact numbers and emails clearly.`;
        } else if (intentInfo.intent === "CHAT_HISTORY_META") {
          catalogContext = `Turn Intent: CHAT_HISTORY_META (Customer is asking about their chat history with you, pointing out a context or repetition issue, or sharing that they are a student).
Review the earlier messages in this conversation and answer directly, warmly, and honestly:
- If they ask "Tell me about my chat history with you", summarize the exact topics and products you have discussed together in this chat (podiums, furniture/chairs, corporate gifts, comparisons, etc.) in 4-5 clear bullet points!
- If they say "You lost the context again" or "Why do you keep asking the same city question", apologize briefly in 1 natural sentence, confirm what they were asking about from the previous turn, and answer it without repeating any city question!
- If they say "I am a student", acknowledge warmly that they are welcome to explore all specs and prices for their study or project without any sales pressure.`;
        } else if (intentInfo.intent === "IDENTITY_META") {
          catalogContext = `Turn Intent: IDENTITY_META (The customer is asking who you are or what you can help with).
Answer directly in 2 short lines: you are *ACRIO*, the WhatsApp assistant for *Classic Concepts* (acrylic podiums, displays, custom fabrication: classicconcepts.in) and *Classic Edge 53* (acrylic machines: classicedge.in), and ask briefly how you can help.
CRITICAL: Keep it short and natural. Do NOT list product catalogs, menus, or links from earlier turns!`;
        } else if (intentInfo.intent === "COMPANY_INFO") {
          const isLocationAsk = /\b(where|location|address|map|maps|directions?|visit|reach|office|factory|workshop|pin)\b/i.test(
            rawText
          );
          const mapsUrl = liveBrandInfo?.mapsUrl || "https://maps.google.com/?q=17.4947378,78.496725";
          catalogContext = isLocationAsk
            ? `Turn Intent: COMPANY_INFO (Location / Directions Request).
Reply cleanly in 3 to 4 crisp lines sharing:
1. *Classic Concepts Acrylic Pvt. Ltd.* (also serves *Classic Edge 53*)
2. Exact address: ${liveBrandInfo?.address || "1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015"}
3. Visiting hours & phone: ${liveBrandInfo?.businessHours || "Mon to Sat, 10:00 AM to 7:00 PM"} | ${liveBrandInfo?.officePhones?.[0] || "+91 79016 50662"}
4. Direct Google Maps URL: ${mapsUrl}
CRITICAL: ALWAYS include the clickable Google Maps URL (${mapsUrl}) inside "customerReply"! Never append unrequested product pitches or product links.`
            : `Turn Intent: COMPANY_INFO (The customer is asking about company location, address, timings, shipping, or brand info).
Answer directly and concisely (2 to 4 short lines) using ONLY the verified public company details from classicconcepts.in above (${liveBrandInfo?.headOfficeLine || "Classic Concepts Acrylic Private Limited, Secunderabad, Telangana"} | Google Maps: ${mapsUrl}).
CRITICAL: Do NOT append unrequested product pitches or product links!`;
        } else if (intentInfo.intent === "TOPIC_RESET") {
          catalogContext = `Turn Intent: TOPIC_RESET (The customer wants to ask a different query or start a new topic).
Acknowledge warmly in 1 short line and invite them to share their new question.
CRITICAL: Do NOT carry over, repeat, or pitch any products from earlier messages in the conversation!`;
        } else if (intentInfo.intent === "HUMAN_HANDOFF_INFO") {
          catalogContext = `Turn Intent: HUMAN_HANDOFF_INFO (The customer is asking who you will connect them to).
Answer in 2 short lines that you connect them to our *Classic Concepts & Classic Edge 53 Sales & Fabrication Team* for custom quotes, bulk orders, or dispatch help, and ask if they would like to connect now.
CRITICAL: Set "needsHumanHandoff": false because they are only asking *whom* you connect to!`;
        } else if (intentInfo.intent === "OFF_TOPIC") {
          catalogContext = `Turn Intent: OFF_TOPIC.
Reply politely in 1 to 2 short lines without pushing or listing products. If the sender is an outside supplier or vendor pitching their own goods, rate cards, or services to us, politely acknowledge it for the team without pitching our products back at them.`;
        } else if (intentInfo.intent === "CONVERSATIONAL_FOLLOWUP") {
          const activeRecSummary =
            convState.lastRecommendedProducts.length > 0
              ? `\nActive product(s) in this chat: ${convState.lastRecommendedProducts.map((p) => `*${p.name}*${p.priceInr ? ` (₹${p.priceInr.toLocaleString("en-IN")})` : ""} ${p.shortUrl || ""}`).join(", ")}`
              : "";
          catalogContext = `Turn Intent: CONVERSATIONAL_FOLLOWUP.${activeRecSummary}
Answer ONLY what the customer just asked in 1 to 3 concise lines. Do NOT push unrelated products, menus, or product links.`;
        } else {
          catalogContext = `Turn Intent: GREETING (or simple introduction).
Reply warmly in 1 to 2 short lines and ask how you can help them today.
CRITICAL: Do NOT market products, do NOT send a 4-bullet menu of categories, and do NOT dump links when someone only greets or introduces themselves!`;
        }
      } else {
        const nearestHint =
          budgetFallbackLowestPrice && budgetFallbackLowestItem
            ? ` The lowest verified price in this category is ₹${budgetFallbackLowestPrice.toLocaleString("en-IN")} (*${cleanDisplayProductName(budgetFallbackLowestItem.name)}* - ${budgetFallbackLowestItem.shortUrl || budgetFallbackLowestItem.url}).`
            : "";
        const deepBlock = aggregateResult
          ? `\n\nVerified Catalogue-Wide Count (the customer asked HOW MANY; answer with this exact count and breakdown, do not describe one single product):\n${aggregateResult.answer}`
          : pinnedFocusItem
          ? `\n\nFOCUS PRODUCT (the customer's words like "this model", "it", "the white one" refer to THIS product from earlier in the chat; answer ONLY about it. If they asked one specific thing (colour, price, warranty, size, quantity) answer just that in 2-4 short lines. If they only picked it from a list or asked for more details, give the crisp 5-6 line gist for this one product:\n${cleanDisplayProductName(pinnedFocusItem.name)} | ${pinnedFocusItem.shortUrl || pinnedFocusItem.url}\n${deepProductInfo?.promptCatalogContext || ""}`
          : deepProductInfo?.promptCatalogContext
          ? `\n\nVerified Deep Product Specifications, Dimensions, Variants & Machine Models:\n${deepProductInfo.promptCatalogContext}`
          : "";
        const verifiedDeepReference = deepProductInfo?.deterministicDeepAnswer
          ? `\n\nVerified Concise Gist Reference (use these exact measurements, variant prices, model codes, and links without dumping unrequested panel sizes):\n${deepProductInfo.deterministicDeepAnswer}`
          : "";
        const priceSuppressionNote = hidePricesActive
          ? `\nCRITICAL PRICE SUPPRESSION RULE: The customer explicitly asked NOT to mention prices ("without mentioning prices"). DO NOT include any ₹ prices, MRP, or rupee numbers anywhere in your reply!`
          : "";
        const customStructureNote = isCustomStructureEnquiry
          ? `\nCRITICAL CUSTOM FABRICATION NOTE: The customer is asking for a custom/multi-compartment acrylic structure ("${combinedEnquiryProbe.replace(/\s+/g, " ")}"${convState.preferences.length ? `, preferences: ${convState.preferences.join(", ")}` : ""}). We custom-fabricate *${convState.preferences.includes("black") ? "Black " : ""}Acrylic Lockers / Multi-Compartment Boxes & Enclosures* to exact compartment counts, lock types, and dimensions! Any ready items listed above are desktop/countertop organizers only; do NOT claim a desktop mobile stand is a full locker!`
          : "";
        const burstMediaNote = visionAnalysis
          ? `\n\n${buildPhaseIImageGuidancePrompt(visionAnalysis, visionFromCache)}`
          : hasLegacyUnanalyzedMedia
          ? `\nCRITICAL REFERENCE MEDIA NOTE: In this same message burst, the customer also shared ${burstMediaLabel}! Acknowledge both their text requirement AND ${burstMediaLabel} in one unified reply, confirm that you have forwarded their reference photo(s)/file(s) and requirement to our Sales & Fabrication Team for an exact quote, and set "needsHumanHandoff": true.`
          : "";
        catalogContext = prebuiltGroupedBlock
          ? `Turn Intent: ${intentInfo.intent}\nMatched Products strictly filtered for the customer's query${budgetLabel && !hidePricesActive ? ` (Budget filter applied: ${budgetLabel})` : ""}:\n${prebuiltGroupedBlock}${deepBlock}${verifiedDeepReference}${priceSuppressionNote}${customStructureNote}${burstMediaNote}\n\nIMPORTANT: Format your reply as a crisp, scannable Gist (show at most 3 top matching products unless the user asked for all models; for a single product, show a 5-6 line gist with Height, Top size, Build/Warranty, Variants, 2-3 key highlights, and shortlink). Never dump raw database paragraphs!`
          : `Turn Intent: ${intentInfo.intent}\nNo exact ready-priced product matched "${usedLookupQuery}"${budgetLabel ? ` within budget ${budgetLabel}` : ""}.${nearestHint}${customStructureNote}${burstMediaNote} Explain honestly and helpfully without inventing prices, and share the closest starting option or custom fabrication option.`;
      }

      const stateSummaryLine = `Active Conversation Memory: product="${convState.primaryProductQuery || "unspecified"}", family="${convState.productFamily || "open"}", category="${smartCategory}", budget="${hidePricesActive ? "HIDE_PRICES_ACTIVE" : budgetLabel || "open"}", preferCheapest=${Boolean(convState.preferCheapest)}, switchedProductThisTurn=${Boolean(convState.switchedThisTurn)}, customerProfile="${customerProfileInfo.customerProfile}", languageMode="${customerProfileInfo.languageMode}"`;
      const productHistoryLine =
        (convState.productHistory || []).length > 0
          ? `Previously Discussed Products In Earlier Turns (for comparison/history ONLY. Do NOT mix their prices, sizes, or specs into the CURRENT active product unless asked to compare!): ${(convState.productHistory || []).map((h) => h.label).join(" -> ")}\n`
          : "";

      const completeDatabaseDirectory = buildCompleteEcosystemDatabaseDirectory(allItems);
      const safePromptCustomerName =
        firstName === "there"
          ? "Valued Customer (do NOT greet with a phone number; say 'Hi there' if greeting)"
          : params.customerName;
      const quotedMessagePromptLine = quotedReplyContext
        ? `Customer Swiped / Replied Directly To This Earlier WhatsApp Message (${quotedReplyContext.senderName || "Earlier message"}): "${quotedBody.slice(0, 320)}"${quotedReplyContext.productName ? ` [Referenced Product: ${quotedReplyContext.productName}${quotedReplyContext.variantName ? `, Variant: ${quotedReplyContext.variantName}` : ""}]` : ""}\nCRITICAL QUOTED-REPLY RULE: Interpret the customer's short message below directly as a response to or question about that quoted message!\n`
        : "";
      const latestPromptPayload = `[Internal Context for ACRIO - never echo raw labels]
Customer Name: ${safePromptCustomerName}
Already Greeted Earlier In This Chat: ${alreadyGreeted ? "YES (DO NOT say Hi/Hello or customer's name again! Start directly with the helpful answer.)" : `NO (First reply: greet "${firstName}" warmly once in 1 short line.)`}
Customer Persona & Language Instruction: ${customerProfileInfo.instructionNote}
${quotedMessagePromptLine}${antiRepeatRule ? `${antiRepeatRule}\n` : ""}${stateSummaryLine}
${productHistoryLine}${trainingGuidance.promptBlock ? `\n[AI Training Studio Rules, Action Instructions & Q&A Guidance]:\n${trainingGuidance.promptBlock}\nIMPORTANT ACTION INSTRUCTION RULE: If a matched Situation Instruction tells you what to do (for example: hand over or assign to a staff member, ping the sales team, politely decline vendor pitches, skip product pitches, or ask specific questions), follow that action strictly using "needsHumanHandoff": true / "handoffReason" or "needsSalesTeamPing": true / "salesTeamPingNote" as needed, and write a natural customer-facing WhatsApp reply fitting that instruction (never repeat the raw instruction wording verbatim as your reply).\n` : ""}${catalogContext}${liveOperationalContext ? `\n\n[Live Database Operational Context - Verified Company Summary, Enquiries & Orders]:\n${liveOperationalContext}` : ""}

Customer's latest WhatsApp message:
${rawText}`;

      // NEVER wipe claudeMessages! Preserving multi-turn chat history is essential for "1", "Tell me about my chat history", and natural follow-ups.
      const lastTurn = claudeMessages[claudeMessages.length - 1];
      if (lastTurn && lastTurn.role === "user") {
        lastTurn.content = `${lastTurn.content}\n\n${latestPromptPayload}`;
      } else {
        claudeMessages.push({ role: "user", content: latestPromptPayload });
      }

      const needsMediumReasoning =
        projectPlan.isMultiItemOrTotalling ||
        (!deepProductInfo?.isDeepQuestion && contextMatches.length > 3);
      const turnEffort: "low" | "medium" = needsMediumReasoning ? "medium" : "low";
      const aiCall = await callClaudeHaikuMessagesDetailed({
        apiKey,
        maxTokens: needsMediumReasoning ? 3072 : 1800,
        effort: turnEffort,
        timeoutMs: 26000,
        system: `You are ACRIO, the intelligent WhatsApp product, project & fabrication specialist for Classic Concepts (acrylic products: classicconcepts.in) and Classic Edge 53 (acrylic fabrication machines, tools & hardware accessories: classicedge.in).

CORE CONVERSATION, ACCURACY, GIST FORMATTING & BUSINESS RULES:
1. COMPLETE DATABASE VISIBILITY & ACCURATE PRODUCT MATCHING:
   - You have access to the ENTIRE verified database below: all 189+ Classic Concepts products (including all 31 Acrylic & Wood Podiums CCP053 to CCP111 with 4 sub-categories: Essential Podiums, Classic Signature Podiums, Premium Podiums, Custom-Built Podiums; Acrylic Furniture & Tables including Acrylic Chair ₹15,950 and Acrylic Bar Stool ₹9,350; Signages & Office Name Plates; Trophies, Mementos & Corporate Gifts under ₹5,000; Hotel & Retail Stands; Boxes & Enclosures), all 18 Classic Edge 53 industrial machines & models, all 5 machine consumables, all 188 acrylic hardware accessories, company details, and department-wise staff contacts.
   - ALWAYS check both the Matched Products section AND the Complete Verified Ecosystem Catalog Directory below before ever claiming a product or category does not exist!
   -Cheapest vs Costliest Podiums: Our most affordable ready podium is *Acrylic Podium CCP057S* (₹7,150, Top 18" x 14", Height 40"-42") followed by *Acrylic Podium CCP054* (₹14,999, Top 20" x 15"). Our most premium flagship podiums are *Acrylic & Wood Podium CCP111* (₹55,000, Top 27" x 18", 15mm clear acrylic + wood) and *Acrylic Podium CCP094* (₹52,800).
   - If the customer asks for a "cheaper alternative" or "smaller top to save more", recommend compact lower-priced models (like *CCP057S* ₹7,150, *CCP054* ₹14,999, *CCP058* ₹18,150, *CCP057* ₹19,800) instead of repeating expensive models!
   - If the customer asks about "furniture and interiors" or "they sit / Acrylic chair", show our *Acrylic Chair* (₹15,950), *Acrylic Bar Stool* (₹9,350), *Acrylic Console Table* (₹12,100), and *Acrylic Nesting Tables* (₹8,800). NEVER show podiums when they ask for furniture or chairs!
2. CONCISE, NON-PUSHY WHATSAPP REPLIES (NO OVER-MARKETING):
   - NEVER push, pitch, or market products when the customer only says "Hi", introduces themselves, asks for location/office hours/contacts, shares a phone number, asks to talk to a person, or sends a supplier/vendor message! Reply politely in 1 to 3 short, natural lines and stop there.
   - Do NOT end every reply with menus, product links, or "check out our range" sales pitches unless the customer actually asked to browse or compare products.
   - Keep EVERY reply short, crisp, and directly to the point (typically 2 to 5 lines on WhatsApp; target under 450 characters unless quoting multiple items).
   - NEVER repeat "Hi" or "Hello" if Already Greeted Earlier is YES.
   - Never start every message with robotic templates like "Here are the matching options from our range:".
   - For a single product ("Tell me about CCP111" or "CCP065"), give a crisp 4 to 5 line Gist: Price, Height & Top size, Key highlight/Warranty, Variants, and shortlink. Only list full panel dimensions if specifically asked.
   - When listing multiple options, show at most 3 concise matches (1 line of key size + shortlink each) so mobile users can scan fast.
   - If "HIDE_PRICES_ACTIVE" is set (user asked "without mentioning prices"), DO NOT show any ₹ prices anywhere in the message!
   - Use single asterisks *like this* for WhatsApp bold (NEVER **double asterisks**, NEVER [markdown](links), NEVER ### headings).
3. MULTI-ITEM PROJECT TOTALLING & BUDGET SOLVING:
   - When a customer asks for multiple items with quantities and a budget (e.g. "3 Acrylic podiums, 10 signages for office name plates and 10 chairs within 1 lac rupees"), ALWAYS show the exact unit price × quantity = line total for each item, the grand total, and 2 smart combinations (Option 1: Within-budget combination; Option 2: Full-quantity package with bulk discount check from our Sales Team).
4. COMPANY DETAILS, DIRECTORS & LEADERSHIP CONTACTS (STRICT CLASSICCONCEPTS.IN PUBLIC DIRECTORY RULE):
   - ONLY share company contact details or team names when the customer explicitly asks for company info, address, phone, email, or staff/team contacts. NEVER append unrequested contact directories to normal product replies!
   - When a customer asks about company details, leadership/directors, marketing, or sales staff contacts, use ONLY the verified public professional details from classicconcepts.in provided under [Live Database Operational Context -> VERIFIED LIVE COMPANY & TEAM CONTACTS] above!
   - PRIVATE PLATFORM SAFETY RULE: NEVER share any private/internal WhatsApp Hub (ccwhatsapp) user account numbers, personal logins, internal roles, or unverified contacts with customers. Only share professional details listed on classicconcepts.in.
   - NEVER use any unverified or placeholder names or addresses.
   - PRIVACY RULE: NEVER share any other customer's phone number, email, enquiry, or order details.
   - IMAGE SHARING CAPABILITY: Our system automatically attaches and sends product and variant photos from our Cloudflare R2 storage whenever a customer asks for images/photos. NEVER say "I cannot send images directly here".
5. CONSULTATIVE SALES TEAM PING vs FULL HANDOFF (CRITICAL):
   - You make the best decision possible autonomously and keep handling the conversation ("needsHumanHandoff": false).
   - When a customer needs bulk discount confirmation, multi-item renovation pricing, or custom quote verification, set "needsSalesTeamPing": true and "needsHumanHandoff": false so our Sales Team gets pinged internally to drop a single reply while you remain active on the chat!
   - Set "needsHumanHandoff": true ONLY if the customer explicitly asks to speak to a human/person right now or reports a damaged delivery/dispute.
6. PLAIN EVERYDAY LANGUAGE & ANTI-REPETITION:
   - FOLLOW-UP MEMORY: When the customer says "this model", "it", "its price", "the white one" or asks a short question about colour, warranty, price or size, they mean the FOCUS PRODUCT from earlier in this chat. Answer ONLY that question about THAT product in 2-4 short lines. NEVER switch to a different product and NEVER repeat the full product description again.
   - COUNT QUESTIONS: When asked "how many products ...", use the Verified Catalogue-Wide Count if provided and answer with the number first.
   - NEVER state a technical figure (power, kW, weight, speed, thickness, voltage) unless it appears in the verified product data above. If it is missing, say you do not have it verified and share the right team contact instead.
   - JSON SAFETY: Write inches as the word "inch" or "in" (for example 22 x 16 inch), NEVER with a double quote character inside customerReply, so the JSON stays valid.
   - Primary languages: English and Hindi/Hinglish. Use other languages only if the user clearly does not understand English or Hindi.
   - Zero em-dashes ("—"), zero "--", zero robotic AI buzzwords.
   - Do NOT repeat "which city is the event/delivery in?" or "do you need logo printing?" if it was already asked in recent turns or if the user is a student/exploring.

${completeDatabaseDirectory}

Return ONLY valid JSON:
{
  "needsHumanHandoff": false,
  "handoffReason": "",
  "needsSalesTeamPing": false,
  "salesTeamPingNote": "",
  "smartCategory": "Podiums & Stage | Awards & Trophies | Hotel & Banquet | Acrylic Machines (CE53) | Custom Fabrication | Order & Delivery | General Enquiry",
  "priority": "URGENT | HIGH | NORMAL",
  "customerReply": "Cleanly formatted WhatsApp gist using \\n line breaks, *bold* titles, ₹ prices (unless hidden), and https://ccapl.cc/... shortlinks"
}`,
        messages: claudeMessages,
      });

      lastUsage = aiCall.usage;
      if (aiCall.ok && aiCall.text) {
        addStep(
          `Called Anthropic claude-haiku-5-5 (effort=${turnEffort})`,
          `HTTP ${aiCall.statusCode} in ${aiCall.durationMs}ms (keySource=${keySource}, in=${aiCall.usage?.inputTokens ?? 0}, think=${aiCall.usage?.thinkingTokens ?? 0}, out=${aiCall.usage?.outputTokens ?? 0})`
        );
        const parsed =
          parseClaudeJson<any>(aiCall.text) ??
          (!/[{}]/.test(String(aiCall.text)) && String(aiCall.text).trim().length > 5
            ? { customerReply: String(aiCall.text).trim() }
            : null);
        if (parsed && typeof parsed.customerReply === "string" && parsed.customerReply.trim()) {
          const hasMatchedTrainingInstruction =
            trainingGuidance.examples.some((ex) => ex.guidanceType === "INSTRUCTION") ||
            trainingGuidance.rules.length > 0;
          const handoff =
            hasLegacyUnanalyzedMedia || imageNeedsTeamHandoff
              ? true
              : hasMatchedTrainingInstruction && Boolean(parsed.needsHumanHandoff)
              ? true
              : intentInfo.intent === "HUMAN_HANDOFF_INFO" ||
                intentInfo.intent === "LEADERSHIP_CONTACT_INFO" ||
                intentInfo.intent === "CHAT_HISTORY_META" ||
                intentInfo.intent === "MENU_SELECTION" ||
                intentInfo.intent === "CATEGORY_OVERVIEW" ||
                intentInfo.intent === "MULTI_ITEM_PROJECT" ||
                intentInfo.intent === "CONVERSATIONAL_FOLLOWUP" ||
                intentInfo.intent === "IDENTITY_META" ||
                intentInfo.intent === "COMPANY_INFO" ||
                intentInfo.intent === "TOPIC_RESET" ||
                intentInfo.intent === "GREETING" ||
                intentInfo.intent === "OFF_TOPIC"
              ? false
              : Boolean(parsed.needsHumanHandoff);

          const pingSales =
            !handoff &&
            (needsSalesTeamPing ||
              isCustomStructureEnquiry ||
              Boolean(parsed.needsSalesTeamPing));
          const finalPingNote =
            parsed.salesTeamPingNote ||
            salesTeamPingNote ||
            (pingSales
              ? `ACRIO Consultative Ping: Customer enquiry ("${rawText.slice(0, 120)}") may benefit from a single Sales Team reply.`
              : "");

          let rawFormatted = stripRepeatedGreeting(
            formatWhatsAppOutboundText(parsed.customerReply),
            alreadyGreeted,
            params.customerName
          );
          if (hidePricesActive) {
            rawFormatted = rawFormatted
              .replace(/\s*\((?:₹|Rs\.?|INR)\s*[\d,]+(?:\s*,\s*MRP\s*₹[\d,]+)?\)/gi, "")
              .replace(/\b(?:₹|Rs\.?)\s*[\d,]+(?:\s*to\s*(?:₹|Rs\.?)\s*[\d,]+)?/gi, "available on request");
          }
          const isLocationAskTurn =
            (intentInfo.intent === "COMPANY_INFO" ||
              intentInfo.intent === "LEADERSHIP_CONTACT_INFO") &&
            /\b(where|location|address|map|maps|directions?|visit|reach|office|factory|workshop|pin)\b/i.test(
              rawText
            );
          const verifiedMapsUrl =
            liveBrandInfo?.mapsUrl || "https://maps.google.com/?q=17.4947378,78.496725";
          let cleanedReply =
            !intentInfo.requiresProductLookup && !projectPlan.isMultiItemOrTotalling
              ? rawFormatted
                  .split("\n")
                  .filter((line) => !/https?:\/\/ccapl\.cc\/\S+/i.test(line))
                  .join("\n")
                  .replace(/\n{3,}/g, "\n\n")
                  .trim()
              : rawFormatted;
          if (
            isLocationAskTurn &&
            !/maps\.google\.com|google\.com\/maps|maps\.app\.goo\.gl/i.test(cleanedReply)
          ) {
            cleanedReply = `${cleanedReply}\n\n*Google Maps Location:* ${verifiedMapsUrl}`;
          }
          const resolvedLocationPin: AcrioLocationPin | undefined = isLocationAskTurn
            ? {
                latitude: liveBrandInfo?.latitude ?? 17.4947378,
                longitude: liveBrandInfo?.longitude ?? 78.496725,
                name:
                  liveBrandInfo?.placeName || "Classic Concepts Acrylic Private Limited",
                address:
                  liveBrandInfo?.address ||
                  "1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015",
                mapsUrl: verifiedMapsUrl,
              }
            : undefined;

          // Sync conversation state with the exact products Claude actually listed in cleanedReply
          // so follow-up turns ("Please share images of all three", "the second one") know the exact products shown!
          const linkedInReply = resolveProductsFromOutboundText(cleanedReply, allItems);
          if (linkedInReply.length === 1) {
            convState.focusProductSlug = linkedInReply[0].slug;
            convState.lastRecommendedProducts = [
              {
                id: linkedInReply[0].id,
                name: cleanDisplayProductName(linkedInReply[0].name),
                slug: linkedInReply[0].slug,
                priceInr: linkedInReply[0].basePrice,
                shortUrl: linkedInReply[0].shortUrl || linkedInReply[0].url,
                itemType: linkedInReply[0].itemType,
              },
            ];
            await saveConversationAiState(params.conversationId, convState);
          } else if (linkedInReply.length >= 2) {
            convState.focusProductSlug = null;
            convState.lastRecommendedProducts = linkedInReply.slice(0, 5).map((it) => ({
              id: it.id,
              name: cleanDisplayProductName(it.name),
              slug: it.slug,
              priceInr: it.basePrice,
              shortUrl: it.shortUrl || it.url,
              itemType: it.itemType,
            }));
            await saveConversationAiState(params.conversationId, convState);
          }

          let finalMediaAttachments =
            resolvedMedia && resolvedMedia.attachments.length > 0
              ? resolvedMedia.attachments
              : [];
          if (
            finalMediaAttachments.length === 0 &&
            linkedInReply.length > 0 &&
            !isCustomStructureEnquiry &&
            !hasBurstReferenceMedia &&
            (asksForImages ||
              /\b(photos?|images?|pictures?)\b[^.!?\n]{0,60}\b(coming|attached|shared|here|with\s+this\s+message)\b/i.test(
                cleanedReply
              ))
          ) {
            const autoMulti =
              linkedInReply.length === 1
                ? resolveProductMediaAttachments(linkedInReply[0], rawText, hidePricesActive)
                : resolveMultiProductMediaAttachments(
                    linkedInReply.slice(0, 3),
                    rawText,
                    hidePricesActive
                  );
            if (autoMulti.attachments.length > 0) {
              finalMediaAttachments = autoMulti.attachments;
              addStep(
                "Auto-attached R2 images for products referenced in reply",
                `products=[${linkedInReply.slice(0, 3).map((p) => p.sku || p.slug).join(", ")}], attachments=${finalMediaAttachments.length}`
              );
            }
          }

          addStep(
            "Parsed JSON & formatted WhatsApp outbound message",
            `intent=${intentInfo.intent}, smartCategory="${parsed.smartCategory || smartCategory}", handoff=${handoff}, salesPing=${pingSales}, chars=${cleanedReply.length}`
          );

          recordAndBroadcastAiLog({
            website: "WHATSAPP_HUB",
            websiteLabel: "Classic Concepts WhatsApp Hub",
            feature: "Autonomous WhatsApp Concierge (ACRIO)",
            actor: params.customerName,
            question: rawText,
            model: LOCKED_CLAUDE_MODEL,
            effort: turnEffort,
            outcomeSource: handoff ? "HUMAN_HANDOFF" : "LIVE_AI",
            responseCacheStatus: "BYPASS",
            catalogCacheStatus: cacheMeta.catalogCacheStatus,
            cacheDetails: `${cacheMeta.cacheSummary} • intent=${intentInfo.intent} • effort=${turnEffort}`,
            productLookupTriggered: intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling,
            productLookupQuery: usedLookupQuery,
            productLookupBudget: budgetLabel,
            productLookupTotalScanned:
              intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling
                ? allItems.length
                : 0,
            productsLookedUp:
              intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling
                ? (linkedInReply.length > 0 ? linkedInReply : contextMatches).map(
                    mapProductToLogItem
                  )
                : [],
            steps,
            response: cleanedReply,
            durationMs: Date.now() - started,
            tokenUsage: mergeAiTokenUsage(visionUsage, aiCall.usage),
          });

          return {
            needsHumanHandoff: handoff,
            handoffReason: handoff
              ? parsed.handoffReason ||
                (visionAnalysis
                  ? `Customer shared custom design/reference image (${visionAnalysis.productType || "custom acrylic item"}). Missing/unclear: [${visionAnalysis.unreadableDetails.join(", ") || "none"}].`
                  : `Customer ready for Sales Team follow-up ("${rawText.slice(0, 100)}").`)
              : "",
            needsSalesTeamPing: pingSales,
            salesTeamPingNote: finalPingNote,
            customerReply: cleanedReply,
            smartCategory: parsed.smartCategory || smartCategory,
            priority: parsed.priority || priority,
            conversationState: convState,
            ...(finalMediaAttachments.length > 0
              ? { mediaAttachments: finalMediaAttachments }
              : {}),
            ...(resolvedLocationPin ? { locationPin: resolvedLocationPin } : {}),
          };
        } else {
          lastAiError = "Claude returned text that could not be parsed as JSON.";
          console.warn(`[ACRIO] JSON parse failure. intent=${intentInfo.intent} raw=${String(aiCall.text).slice(0, 400)}`);
          addStep("JSON parse warning", lastAiError, "WARN");
        }
      } else {
        lastAiError = aiCall.error || "Anthropic call failed";
        console.warn(`[ACRIO] Claude call failed. intent=${intentInfo.intent} http=${aiCall.statusCode} err=${lastAiError} ms=${aiCall.durationMs}`);
        addStep(
          "Anthropic claude-haiku-5-5 call failed",
          `HTTP ${aiCall.statusCode}: ${lastAiError}`,
          "ERROR"
        );
      }
    } catch (err: any) {
      lastAiError = err?.message || "Unexpected error in AI turn";
      addStep("Exception during AI turn", lastAiError || undefined, "ERROR");
    }
  } else {
    lastAiError = "Client Anthropic API key is not configured.";
    addStep("Skipped live AI call", lastAiError, "SKIP");
  }

  // 5. Conversational & Diagnostic Fallback Engine (when offline or API error)
  const greetOnce = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
  let fallbackReply = "";
  let fallbackHandoff = false;
  let fallbackReason = "";

  if (projectPlan.isMultiItemOrTotalling && projectPlan.summaryText) {
    fallbackReply = `${greetOnce}${projectPlan.summaryText}`;
    priority = "HIGH";
  } else if (intentInfo.intent === "CATEGORY_OVERVIEW" && podiumSubCategoriesText) {
    fallbackReply = `${greetOnce}${podiumSubCategoriesText}`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "LEADERSHIP_CONTACT_INFO") {
    const publicTeamLines = liveBrandInfo?.leadershipLines?.length
      ? liveBrandInfo.leadershipLines.join("\n")
      : "";
    const officePhoneLine = liveBrandInfo?.officePhones?.length
      ? liveBrandInfo.officePhones.join(" / ")
      : "+91 79016 50662 / +91 79016 50663";
    const officeEmailLine = liveBrandInfo?.officeEmails?.length
      ? liveBrandInfo.officeEmails.join(", ")
      : "sales@classicconcepts.in";
    const officeWa = liveBrandInfo?.officeWhatsapp || "+91 73372 20568";
    fallbackReply = `${greetOnce}Here are our verified professional team and office contact details from *classicconcepts.in*:\n\n${
      publicTeamLines ? `${publicTeamLines}\n\n` : ""
    }• *Head Office & Factory (${liveBrandInfo?.address || "Secunderabad, Telangana"}):* ${officePhoneLine} | Official WhatsApp: ${officeWa} | ${officeEmailLine}`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "CHAT_HISTORY_META") {
    const prevUserTopics = history
      .filter((m) => m.direction === "INBOUND")
      .slice(-6)
      .map((m) => `• "${m.body.slice(0, 80)}"`)
      .join("\n");
    fallbackReply = /student/i.test(lower)
      ? `${greetOnce}Welcome! Since you are a student exploring our range, feel free to ask about any acrylic product dimensions, manufacturing methods, or prices anytime with zero obligation.`
      : `${greetOnce}Here is a quick summary of what we have discussed in this chat:\n${prevUserTopics || "• Exploring Classic Concepts acrylic products and pricing"}\n\nActive focus: *${convState.primaryProductQuery || smartCategory}*. Tell me how you would like to proceed and I will help right away!`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "GREETING") {
    fallbackReply = alreadyGreeted
      ? `How can I help you today?`
      : `Hello ${firstName}! Welcome to *Classic Concepts*. How can I help you today?`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "IDENTITY_META") {
    fallbackReply = `${greetOnce}I am *ACRIO*, the assistant for *Classic Concepts* and *Classic Edge 53*. How can I help you today?`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "COMPANY_INFO") {
    const officePhoneLine = liveBrandInfo?.officePhones?.length
      ? liveBrandInfo.officePhones.join(", ")
      : "+91 79016 50662, +91 79016 50663";
    const officeEmailLine = liveBrandInfo?.officeEmails?.[0] || "sales@classicconcepts.in";
    const officeWa = liveBrandInfo?.officeWhatsapp || "+91 73372 20568";
    const officeAddress =
      liveBrandInfo?.address ||
      "1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015";
    const officeHours =
      liveBrandInfo?.businessHours || "Monday to Saturday, 10:00 AM to 7:00 PM";
    const officeMapsUrl =
      liveBrandInfo?.mapsUrl || "https://maps.google.com/?q=17.4947378,78.496725";
    fallbackReply = `${greetOnce}*Classic Concepts Acrylic Pvt. Ltd.*\n${officeAddress}\n*Hours:* ${officeHours}\n*Phone:* ${officePhoneLine} | *WhatsApp:* ${officeWa} | ${officeEmailLine}\n\n*Google Maps:* ${officeMapsUrl}`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "TOPIC_RESET") {
    fallbackReply = `${greetOnce}Sure, let's start fresh. What can I help you with today?`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "HUMAN_HANDOFF_INFO") {
    fallbackReply = `${greetOnce}When you ask to speak with someone, I connect you to our *Classic Concepts & Classic Edge 53 Sales Team*. Would you like me to connect you now?`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "OFF_TOPIC") {
    fallbackReply = `${greetOnce}Thank you for sharing this with us. I only assist with *Classic Concepts* and *Classic Edge 53* product enquiries, so please let me know if you need help with those.`;
    priority = "NORMAL";
  } else if (/\b(cloudy|white\s*edge|rough\s*edge|dull\s*edge|polish\s*problem|flame|burn|bubble|crack|bend\s*issue|warping|scratch|yellow)\b/i.test(lower)) {
    const issueSolutions: string[] = [];
    if (/cloudy|white|rough|dull|polish/i.test(lower)) {
      issueSolutions.push(
        `• *Cloudy or rough cut edges:* A *Diamond Edge Polishing Machine* gives a crystal-clear flat edge in one pass without flame stress marks.`
      );
    }
    if (/crack|bubble|bend|warp/i.test(lower)) {
      issueSolutions.push(
        `• *Bubbles or cracking while bending:* Using a temperature-controlled *Acrylic Bending Heater* with even heating solves this cleanly.`
      );
    }
    if (issueSolutions.length === 0) {
      issueSolutions.push(
        `• Using *cast clear acrylic* instead of extruded sheet prevents yellowing, burrs, and hairline cracks during fabrication.`
      );
    }
    const machineBlock = prebuiltGroupedBlock
      ? `\n\n${prebuiltGroupedBlock}`
      : top
      ? `\n\n*Matching Machine:*\n1. *${cleanDisplayProductName(top.name)}*\n   ${top.shortUrl || top.url}`
      : "";
    fallbackReply = `${greetOnce}Here is what usually causes that and how to fix it:\n\n${issueSolutions.join("\n\n")}${machineBlock}\n\nWhat *sheet thickness* are you working with, and are you cutting by laser or router?`;
    smartCategory = "Acrylic Machines (CE53)";
    priority = "HIGH";
  } else if (
    /\b(\d+\s*(?:mm|cm|inch|in|ft)\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?\s*x\s*\d+)\b/i.test(lower) &&
    /\b(\d+\s*(?:pcs|pieces|nos|units|qty)|quote|price)\b/i.test(contextLower)
  ) {
    fallbackReply = `${greetOnce}Got your custom size details! I have pinged our *Sales Team* on this chat with your dimensions so they can share exact sheet thickness, fabrication cost, and dispatch time.`;
    needsSalesTeamPing = true;
    salesTeamPingNote = `ACRIO Consultative Ping: Customer shared 3D custom dimensions for quote ("${rawText.slice(0, 120)}").`;
    smartCategory = "Custom Fabrication";
    priority = "HIGH";
  } else if (visionAnalysis) {
    const imgFallback = buildPhaseIImageFallbackReply({
      greetOnce,
      analysis: visionAnalysis,
      matches: contextMatches,
      hidePrices: hidePricesActive,
    });
    fallbackReply = imgFallback.reply;
    fallbackHandoff = imgFallback.handoff;
    fallbackReason = imgFallback.handoffReason;
    if (imgFallback.needsSalesPing) {
      needsSalesTeamPing = true;
      salesTeamPingNote = imgFallback.salesPingNote;
    }
    smartCategory = imgFallback.smartCategory;
    priority = imgFallback.priority;
  } else if (hasLegacyUnanalyzedMedia || isCustomStructureEnquiry) {
    const reqSummary = [
      ...(convState.preferences || []).filter(
        (p) => !rawText.toLowerCase().includes(p.toLowerCase())
      ),
      rawText
        .replace(/\b(photo|photos|image|images|pic|pics|pls|please|share|send|show)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim(),
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    const cleanReqLabel = reqSummary || convState.primaryProductQuery || "custom acrylic item";
    const refMediaLine = hasLegacyUnanalyzedMedia
      ? `Thank you for sharing ${burstMediaLabel} along with your requirement for *${cleanReqLabel}*.\n\n`
      : `Got your requirement for *${cleanReqLabel}*.\n\n`;
    const customBuildLine = isCustomStructureEnquiry
      ? `We custom-fabricate *${convState.preferences.includes("black") ? "Black " : ""}Acrylic Mobile Phone Lockers & Multi-Compartment Cabinets* to your exact compartment count, lock type, and dimensions.`
      : `We can custom-build this in cast acrylic to your exact size and finish.`;
    const closestReadyBlock =
      prebuiltGroupedBlock && contextMatches.length > 0
        ? `\n\nIf you also want to check our ready tabletop organizers in the meantime:\n${prebuiltGroupedBlock}`
        : "";
    if (hasLegacyUnanalyzedMedia) {
      fallbackHandoff = true;
      fallbackReason = `Customer shared ${burstMediaLabel} with enquiry "${cleanReqLabel.slice(0, 100)}" for team review and custom quote.`;
      fallbackReply = `${greetOnce}${refMediaLine}${customBuildLine}${closestReadyBlock}\n\nI have forwarded your ${burstImages > 1 ? "reference photos" : "reference details"} and requirement directly to our *Sales & Fabrication Team* so a specialist can share reference locker photos and an exact quote right away.`;
    } else {
      needsSalesTeamPing = true;
      salesTeamPingNote = `ACRIO Consultative Ping: Customer enquired about custom fabrication ("${cleanReqLabel.slice(0, 120)}").`;
      fallbackReply = `${greetOnce}${refMediaLine}${customBuildLine}${closestReadyBlock}\n\nHow many compartments/slots do you need, and what quantity are you looking for? I have also pinged our *Sales & Fabrication Team* to share reference locker photos and pricing with you here.`;
    }
    smartCategory = "Custom Fabrication";
    priority = "HIGH";
  } else if (aggregateResult) {
    fallbackReply = `${greetOnce}${aggregateResult.answer}`;
  } else if (pinnedFocusItem && buildFocusedAttributeAnswer(pinnedFocusItem, rawText)) {
    fallbackReply = `${greetOnce}${buildFocusedAttributeAnswer(pinnedFocusItem, rawText)}`;
  } else if (deepProductInfo?.deterministicDeepAnswer) {
    fallbackReply = `${greetOnce}${deepProductInfo.deterministicDeepAnswer}`;
  } else if (top && prebuiltGroupedBlock) {
    fallbackReply = `${greetOnce}${prebuiltGroupedBlock}\n\nLet me know which option fits your requirement best, or if you would like to compare sizes!`;
  } else if (budgetLabel && budgetFallbackLowestPrice && budgetFallbackLowestItem) {
    const cleanTitle = cleanDisplayProductName(budgetFallbackLowestItem.name);
    const link = budgetFallbackLowestItem.shortUrl || budgetFallbackLowestItem.url;
    fallbackReply = `${greetOnce}Our starting ready model in this category is:\n\n1. *${cleanTitle}* (₹${budgetFallbackLowestPrice.toLocaleString("en-IN")})\n   ${link}\n\nWould you like to check this model or explore a custom-built option for your budget?`;
  } else {
    fallbackReply = `${greetOnce}I would love to help find the right option for you.\n\nCould you share a little more about what you need?\n• *Stage & Events:* acrylic podiums/pulpits, awards, or plaques\n• *Furniture & Offices:* acrylic chairs, bar stools, tables, or office name plates\n• *Hotels & Retail:* menu/QR stands, risers, or display boxes\n• *Acrylic Machines:* cutting, bending, or diamond polishing`;
    priority = "NORMAL";
  }

  let finalFallback = stripRepeatedGreeting(
    formatWhatsAppOutboundText(fallbackReply),
    alreadyGreeted,
    params.customerName
  );
  if (hidePricesActive) {
    finalFallback = finalFallback
      .replace(/\s*\((?:₹|Rs\.?|INR)\s*[\d,]+(?:\s*,\s*MRP\s*₹[\d,]+)?\)/gi, "")
      .replace(/\b(?:₹|Rs\.?)\s*[\d,]+(?:\s*to\s*(?:₹|Rs\.?)\s*[\d,]+)?/gi, "available on request");
  }
  addStep(
    "Generated deterministic fallback WhatsApp reply",
    `intent=${intentInfo.intent}, matchedProducts=${contextMatches.length}, smartCategory="${smartCategory}", salesPing=${needsSalesTeamPing}`
  );

  recordAndBroadcastAiLog({
    website: "WHATSAPP_HUB",
    websiteLabel: "Classic Concepts WhatsApp Hub",
    feature: "Autonomous WhatsApp Concierge (ACRIO)",
    actor: params.customerName,
    question: rawText,
    model: lastAiError ? `${LOCKED_CLAUDE_MODEL} -> local-fallback` : "local-catalog",
    effort: "medium",
    outcomeSource: fallbackHandoff ? "HUMAN_HANDOFF" : "LOCAL_FALLBACK",
    responseCacheStatus: "BYPASS",
    catalogCacheStatus: cacheMeta.catalogCacheStatus,
    cacheDetails: `${cacheMeta.cacheSummary} • intent=${intentInfo.intent}`,
    productLookupTriggered: intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling,
    productLookupQuery: usedLookupQuery,
    productLookupBudget: budgetLabel,
    productLookupTotalScanned:
      intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling
        ? allItems.length
        : 0,
    productsLookedUp: contextMatches.map(mapProductToLogItem),
    steps,
    response: finalFallback,
    durationMs: Date.now() - started,
    tokenUsage: mergeAiTokenUsage(visionUsage, lastUsage),
    error: lastAiError,
  });

  const fallbackIsLocationAsk =
    (intentInfo.intent === "COMPANY_INFO" ||
      intentInfo.intent === "LEADERSHIP_CONTACT_INFO") &&
    /\b(where|location|address|map|maps|directions?|visit|reach|office|factory|workshop|pin)\b/i.test(
      rawText
    );
  const fallbackLocationPin: AcrioLocationPin | undefined = fallbackIsLocationAsk
    ? {
        latitude: liveBrandInfo?.latitude ?? 17.4947378,
        longitude: liveBrandInfo?.longitude ?? 78.496725,
        name: liveBrandInfo?.placeName || "Classic Concepts Acrylic Private Limited",
        address:
          liveBrandInfo?.address ||
          "1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015",
        mapsUrl:
          liveBrandInfo?.mapsUrl || "https://maps.google.com/?q=17.4947378,78.496725",
      }
    : undefined;

  return {
    needsHumanHandoff: fallbackHandoff,
    handoffReason: fallbackReason,
    needsSalesTeamPing,
    salesTeamPingNote,
    customerReply: finalFallback,
    smartCategory,
    priority,
    conversationState: convState,
    ...(fallbackLocationPin ? { locationPin: fallbackLocationPin } : {}),
  };
}

