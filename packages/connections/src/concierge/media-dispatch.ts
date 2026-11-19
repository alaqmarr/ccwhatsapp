import {
  cleanDisplayProductName,
  countCoreNounMatches,
  extractCustomerCoreNouns,
  extractExplicitProductOrModelCodes,
  type AiTraceStep,
  type MainWebsiteProduct,
} from "@cc/database";
import type { MultiItemProjectPlan } from "./types";
import {
  formatWhatsAppOutboundText,
  mapProductToLogItem,
  recordAndBroadcastAiLog,
  stripRepeatedGreeting,
} from "@cc/connections/initialise.acrio.ai";
import {
  type AcrioConversationState,
  type AcrioIntentClassification,
  type AcrioMediaAttachment,
  type CatalogCacheMeta,
  extractNormalizedColourTokens,
  isMultiProductReference,
  isProductImageRequest,
  matchProductVariantsByColourTokens,
  resolveCatalogPdfAttachments,
  resolveMultiProductMediaAttachments,
  resolveProductMediaAttachments,
  resolveProductsFromOutboundText,
  saveConversationAiState,
} from "@cc/connections/helpers.acrio.ai";
import type { AcrioAutonomousTurnResult, AcrioTurnParams } from "@cc/connections/interactive.acrio.ai";

export interface MediaDispatchOutcome {
  earlyReturn?: AcrioAutonomousTurnResult;
  asksForImages: boolean;
  isCustomStructureEnquiry: boolean;
  combinedEnquiryProbe: string;
  resolvedMedia: {
    attachments: AcrioMediaAttachment[];
    replyText: string;
    matchedVariant: boolean;
  } | null;
}

export async function tryResolveConciergeMediaReply(ctx: {
  params: AcrioTurnParams;
  started: number;
  steps: AiTraceStep[];
  addStep: (label: string, detail?: string, status?: AiTraceStep["status"]) => void;
  allItems: MainWebsiteProduct[];
  contextMatches: MainWebsiteProduct[];
  pinnedFocusItem: MainWebsiteProduct | null;
  top: MainWebsiteProduct | undefined;
  convState: AcrioConversationState;
  intentInfo: AcrioIntentClassification;
  projectPlan: MultiItemProjectPlan;
  cacheMeta: CatalogCacheMeta;
  usedLookupQuery: string;
  budgetLabel: string | null;
  rawText: string;
  recentInboundWindow: string;
  firstName: string;
  alreadyGreeted: boolean;
  outboundBodies: string[];
  lastOutboundBody: string;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL";
  hidePricesActive: boolean;
  hasBurstReferenceMedia: boolean;
}): Promise<MediaDispatchOutcome> {
  const {
    params,
    started,
    steps,
    addStep,
    allItems,
    contextMatches,
    pinnedFocusItem,
    top,
    convState,
    intentInfo,
    projectPlan,
    cacheMeta,
    usedLookupQuery,
    budgetLabel,
    rawText,
    recentInboundWindow,
    firstName,
    alreadyGreeted,
    outboundBodies,
    lastOutboundBody,
    smartCategory,
    priority,
    hidePricesActive,
    hasBurstReferenceMedia,
  } = ctx;

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
      earlyReturn: {
        needsHumanHandoff: false,
        handoffReason: "",
        needsSalesTeamPing: false,
        salesTeamPingNote: "",
        customerReply: pdfReply,
        smartCategory,
        priority,
        conversationState: convState,
        mediaAttachments: pdfResolved.attachments,
      },
      asksForImages: false,
      isCustomStructureEnquiry: false,
      combinedEnquiryProbe: "",
      resolvedMedia: null,
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
          earlyReturn: {
            needsHumanHandoff: false,
            handoffReason: "",
            needsSalesTeamPing: false,
            salesTeamPingNote: "",
            customerReply: multiReply,
            smartCategory,
            priority,
            conversationState: convState,
            mediaAttachments: multiMedia.attachments,
          },
          asksForImages,
          isCustomStructureEnquiry: false,
          combinedEnquiryProbe: "",
          resolvedMedia: null,
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
      earlyReturn: {
        needsHumanHandoff: false,
        handoffReason: "",
        needsSalesTeamPing: false,
        salesTeamPingNote: "",
        customerReply: mediaReply,
        smartCategory,
        priority,
        conversationState: convState,
        mediaAttachments: resolvedMedia.attachments,
      },
      asksForImages,
      isCustomStructureEnquiry,
      combinedEnquiryProbe,
      resolvedMedia,
    };
  }

  return {
    asksForImages,
    isCustomStructureEnquiry,
    combinedEnquiryProbe,
    resolvedMedia,
  };
}
