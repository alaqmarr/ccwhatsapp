import {
  buildCompleteEcosystemDatabaseDirectory,
  cleanDisplayProductName,
  resolveSharedAnthropicApiKey,
  type AiTokenUsage,
  type AiTraceStep,
  type MainWebsiteProduct,
} from "@cc/database";
import type {
  DeepProductContextResult,
  LiveBrandTeamDirectory,
  MultiItemProjectPlan,
} from "./types";
import type { CustomerImageAnalysis } from "@cc/connections/image-intelligence";
import {
  LOCKED_CLAUDE_MODEL,
  parseClaudeJson,
  callClaudeHaikuMessagesDetailed,
  recordAndBroadcastAiLog,
  mapProductToLogItem,
  formatWhatsAppOutboundText,
  stripRepeatedGreeting,
} from "@cc/connections/initialise.acrio.ai";
import {
  type AcrioConversationState,
  type AcrioCustomerProfileInfo,
  type AcrioIntentClassification,
  type AcrioMediaAttachment,
  type CatalogCacheMeta,
  resolveMultiProductMediaAttachments,
  resolveProductMediaAttachments,
  resolveProductsFromOutboundText,
  saveConversationAiState,
} from "@cc/connections/helpers.acrio.ai";
import type {
  AcrioAutonomousTurnResult,
  AcrioLocationPin,
  AcrioReplyToMessageContext,
  AcrioTurnParams,
} from "@cc/connections/interactive.acrio.ai";
import {
  buildConciergeCatalogContext,
  buildConciergeSystemPrompt,
  mergeAiTokenUsage,
} from "./context-builder";

export async function runConciergeClaudeTurn(ctx: {
  params: AcrioTurnParams;
  started: number;
  steps: AiTraceStep[];
  addStep: (label: string, detail?: string, status?: AiTraceStep["status"]) => void;
  allItems: MainWebsiteProduct[];
  contextMatches: MainWebsiteProduct[];
  pinnedFocusItem: MainWebsiteProduct | null;
  aggregateResult: { answer: string; items: MainWebsiteProduct[] } | null;
  deepProductInfo: DeepProductContextResult | null;
  projectPlan: MultiItemProjectPlan;
  trainingGuidance: {
    rules: unknown[];
    examples: { guidanceType?: string }[];
    promptBlock: string;
  };
  liveOperationalContext: string;
  liveBrandInfo: LiveBrandTeamDirectory | null;
  customerProfileInfo: AcrioCustomerProfileInfo;
  convState: AcrioConversationState;
  intentInfo: AcrioIntentClassification;
  cacheMeta: CatalogCacheMeta;
  usedLookupQuery: string;
  budgetLabel: string | null;
  budgetFallbackLowestPrice: number | null;
  budgetFallbackLowestItem: MainWebsiteProduct | null;
  prebuiltGroupedBlock: string;
  podiumSubCategoriesText: string;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL";
  hidePricesActive: boolean;
  isCustomStructureEnquiry: boolean;
  combinedEnquiryProbe: string;
  asksForImages: boolean;
  resolvedMedia: { attachments: AcrioMediaAttachment[] } | null;
  visionAnalysis: CustomerImageAnalysis | null;
  visionUsage: AiTokenUsage | null;
  visionFromCache: boolean;
  hasBurstReferenceMedia: boolean;
  burstMediaLabel: string;
  needsSalesTeamPing: boolean;
  salesTeamPingNote: string;
  rawText: string;
  firstName: string;
  alreadyGreeted: boolean;
  history: { direction: string; body: string }[];
  quotedReplyContext: AcrioReplyToMessageContext | null;
  quotedBody: string;
}): Promise<
  | { ok: true; result: AcrioAutonomousTurnResult }
  | { ok: false; lastAiError: string | null; lastUsage: AiTokenUsage | null }
> {
  const {
    params,
    started,
    steps,
    addStep,
    allItems,
    contextMatches,
    pinnedFocusItem,
    aggregateResult,
    deepProductInfo,
    projectPlan,
    trainingGuidance,
    liveOperationalContext,
    liveBrandInfo,
    customerProfileInfo,
    convState,
    intentInfo,
    cacheMeta,
    usedLookupQuery,
    budgetLabel,
    budgetFallbackLowestPrice,
    budgetFallbackLowestItem,
    prebuiltGroupedBlock,
    podiumSubCategoriesText,
    smartCategory,
    priority,
    hidePricesActive,
    isCustomStructureEnquiry,
    combinedEnquiryProbe,
    asksForImages,
    resolvedMedia,
    visionAnalysis,
    visionUsage,
    visionFromCache,
    hasBurstReferenceMedia,
    burstMediaLabel,
    needsSalesTeamPing,
    salesTeamPingNote,
    rawText,
    firstName,
    alreadyGreeted,
    history,
    quotedReplyContext,
    quotedBody,
  } = ctx;

  const { apiKey, source: keySource } = await resolveSharedAnthropicApiKey("client");
  const hasLegacyUnanalyzedMedia = hasBurstReferenceMedia && !visionAnalysis;
  const imageNeedsTeamHandoff = Boolean(
    visionAnalysis &&
      visionAnalysis.isDesignSketchOrDrawing &&
      (visionAnalysis.needsCustomFabrication || visionAnalysis.unreadableDetails.length > 0)
  );
  let lastAiError: string | null = null;
  let lastUsage: AiTokenUsage | null = null;

  if (!apiKey) {
    lastAiError = "Client Anthropic API key is not configured.";
    addStep("Skipped live AI call", lastAiError, "SKIP");
    return { ok: false, lastAiError, lastUsage };
  }

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

    const catalogContext = buildConciergeCatalogContext({
      intentInfo,
      projectPlan,
      podiumSubCategoriesText,
      liveBrandInfo,
      rawText,
      convState,
      budgetFallbackLowestPrice,
      budgetFallbackLowestItem,
      aggregateResult,
      pinnedFocusItem,
      deepProductInfo,
      hidePricesActive,
      isCustomStructureEnquiry,
      combinedEnquiryProbe,
      visionAnalysis,
      visionFromCache,
      hasLegacyUnanalyzedMedia,
      burstMediaLabel,
      prebuiltGroupedBlock,
      budgetLabel,
      usedLookupQuery,
    });

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
      system: buildConciergeSystemPrompt(completeDatabaseDirectory),
      cacheSystem: true,
      cacheLastCompletedTurn: claudeMessages.length >= 3,
      messages: claudeMessages,
    });

    lastUsage = aiCall.usage;
    if (aiCall.ok && aiCall.text) {
      addStep(
        `Called Anthropic claude-haiku-5-5 (effort=${turnEffort})`,
        `HTTP ${aiCall.statusCode} in ${aiCall.durationMs}ms (keySource=${keySource}, in=${aiCall.usage?.inputTokens ?? 0}, cacheRead=${aiCall.usage?.cacheReadInputTokens ?? 0}, cacheWrite=${aiCall.usage?.cacheCreationInputTokens ?? 0}, think=${aiCall.usage?.thinkingTokens ?? 0}, out=${aiCall.usage?.outputTokens ?? 0})`
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
          ok: true,
          result: {
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
          },
        };
      }
      lastAiError = "Claude returned text that could not be parsed as JSON.";
      console.warn(`[ACRIO] JSON parse failure. intent=${intentInfo.intent} raw=${String(aiCall.text).slice(0, 400)}`);
      addStep("JSON parse warning", lastAiError, "WARN");
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

  return { ok: false, lastAiError, lastUsage };
}
