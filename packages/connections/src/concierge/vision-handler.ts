import {
  extractCustomerCoreNouns,
  extractExplicitProductOrModelCodes,
  resolveSharedAnthropicApiKey,
  type AiTokenUsage,
  type AiTraceStep,
} from "@cc/database";
import {
  analyzeCustomerImageWithVision,
  fetchAndValidateWhatsAppImage,
  sanitizeImageFilename,
  validateCustomerImageBuffer,
  type CustomerImageAnalysis,
  type CustomerImageAttachmentInput,
} from "@cc/connections/image-intelligence";
import {
  LOCKED_CLAUDE_MODEL,
  parseClaudeJson,
  callClaudeHaikuMessagesDetailed,
  recordAndBroadcastAiLog,
  formatWhatsAppOutboundText,
} from "@cc/connections/initialise.acrio.ai";
import { loadMetaWhatsAppSetupConfig } from "@cc/connections/whatsapp-cloud.acrio.ai";
import {
  type AcrioConversationState,
  reconstructAcrioConversationState,
  saveConversationAiState,
} from "@cc/connections/helpers.acrio.ai";
import type { AcrioAutonomousTurnResult, AcrioTurnParams } from "@cc/connections/interactive.acrio.ai";

export interface InboundMediaStepResult {
  earlyReturn?: AcrioAutonomousTurnResult;
  visionAnalysis: CustomerImageAnalysis | null;
  visionUsage: AiTokenUsage | null;
  visionFromCache: boolean;
  visionSha256: string | null;
  visionRecordedNewCall: boolean;
  hasBurstReferenceMedia: boolean;
  burstMediaLabel: string;
  burstImages: number;
}

export async function processInboundMediaAndVision(ctx: {
  params: AcrioTurnParams;
  started: number;
  steps: AiTraceStep[];
  addStep: (label: string, detail?: string, status?: AiTraceStep["status"]) => void;
  originalInboundText: string;
  cleanCustomerText: string;
  rawText: string;
  firstName: string;
  alreadyGreeted: boolean;
  history: { direction: string; body: string }[];
  storedState: AcrioConversationState | null;
  burstStripped: {
    images: number;
    documents: number;
    videos: number;
    audios: number;
  };
}): Promise<InboundMediaStepResult> {
  const {
    params,
    started,
    steps,
    addStep,
    originalInboundText,
    cleanCustomerText,
    rawText,
    firstName,
    alreadyGreeted,
    history,
    storedState,
    burstStripped,
  } = ctx;

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

  const persistAndReturnEarly = async (opts: {
    stateInputText: string;
    replyText: string;
    stepLabel: string;
    stepDetail?: string;
    stepStatus?: AiTraceStep["status"];
    logQuestion: string;
    model: string;
    outcomeSource: "LIVE_AI" | "HUMAN_HANDOFF" | "LOCAL_FALLBACK";
    cacheDetails: string;
    needsHumanHandoff: boolean;
    handoffReason: string;
    smartCategory?: string;
    priority?: "URGENT" | "HIGH" | "NORMAL";
    tokenUsage?: AiTokenUsage | null;
    error?: string | null;
    hasBurstRef?: boolean;
    mediaLabel?: string;
    imgCount?: number;
  }): Promise<InboundMediaStepResult> => {
    const nextState = reconstructAcrioConversationState({
      persistedState: storedState,
      recentMessages: history,
      currentInboundText: opts.stateInputText,
    });
    await saveConversationAiState(params.conversationId, nextState);
    const formatted = formatWhatsAppOutboundText(opts.replyText);
    addStep(opts.stepLabel, opts.stepDetail, opts.stepStatus || "OK");
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: opts.logQuestion,
      model: opts.model,
      outcomeSource: opts.outcomeSource,
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: "BYPASS",
      cacheDetails: opts.cacheDetails,
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupBudget: null,
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: formatted,
      durationMs: Date.now() - started,
      ...(opts.tokenUsage ? { tokenUsage: opts.tokenUsage } : {}),
      ...(opts.error !== undefined ? { error: opts.error } : {}),
    });
    return {
      earlyReturn: {
        needsHumanHandoff: opts.needsHumanHandoff,
        handoffReason: opts.handoffReason,
        customerReply: formatted,
        smartCategory: opts.smartCategory || nextState.activeCategory || "General Enquiry",
        priority: opts.priority || "NORMAL",
        conversationState: nextState,
      },
      visionAnalysis: null,
      visionUsage: null,
      visionFromCache: false,
      visionSha256: null,
      visionRecordedNewCall: false,
      hasBurstReferenceMedia: Boolean(opts.hasBurstRef),
      burstMediaLabel: opts.mediaLabel || "your attachment",
      burstImages: opts.imgCount || 0,
    };
  };

  if (isStickerOnly) {
    const greetLine = alreadyGreeted ? "" : `Hi ${firstName}! `;
    return persistAndReturnEarly({
      stateInputText: rawText,
      replyText: `${greetLine}Tell me what product or machine you are looking for today (for example podiums, furniture, trophies, custom acrylic boxes, or Classic Edge 53 machines) and I will help right away.`,
      stepLabel: "Handled sticker-only message without Vision call",
      stepDetail: attName || attMime || "sticker",
      logQuestion: originalInboundText,
      model: "rule-sticker-ignore",
      outcomeSource: "LIVE_AI",
      cacheDetails: "Sticker ignored cleanly without burning Vision tokens",
      needsHumanHandoff: false,
      handoffReason: "",
    });
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

  const buildRequirementClause = () => {
    const tmpState = reconstructAcrioConversationState({
      persistedState: storedState,
      recentMessages: history,
      currentInboundText: originalInboundText,
    });
    const parts: string[] = [];
    if (tmpState.preferences.length > 0) parts.push(tmpState.preferences.join(" "));
    if (tmpState.primaryProductQuery) {
      parts.push(
        tmpState.primaryProductQuery
          .replace(/\b(photo|photos|image|images|pic|pics|pls|please|share|send|show)\b/gi, "")
          .replace(/\s+/g, " ")
          .trim()
      );
    }
    const summary = parts.join(" ").trim();
    const clause =
      summary && extractCustomerCoreNouns(summary).length > 0
        ? ` for your *${summary}* requirement`
        : "";
    return { tmpState, clause };
  };

  if (hasNonImageAttachment) {
    const { tmpState, clause } = buildRequirementClause();
    const preservedMetaList = rawNonImageItems
      .map((item) =>
        [
          `type=${item.mediaType || attType || "FILE"}`,
          item.filename ? `filename=${sanitizeImageFilename(item.filename)}` : "",
          item.mimeType ? `mime=${item.mimeType}` : "",
          item.mediaId ? `mediaId=${item.mediaId}` : "",
          item.sha256 ? `sha256=${item.sha256}` : "",
        ]
          .filter(Boolean)
          .join(", ")
      )
      .filter(Boolean)
      .join(" | ");
    const greetLine = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
    const handoffReason = `Customer shared non-image attachment (${preservedMetaList || burstMediaLabel})${clause}${cleanCustomerText ? ` note="${cleanCustomerText.slice(0, 100)}"` : ""}. Routed directly to human staff preserving original attachment.`;
    return persistAndReturnEarly({
      stateInputText: originalInboundText,
      replyText: `${greetLine}Thank you for sharing ${burstMediaLabel}${clause}. I have forwarded your original file directly to our team so a specialist can review it and reply to you right away.`,
      stepLabel: "Routed non-image attachment directly to team (0 AI tokens)",
      stepDetail: handoffReason,
      logQuestion: originalInboundText,
      model: "rule-attachment-team-handoff",
      outcomeSource: "HUMAN_HANDOFF",
      cacheDetails: `Non-image attachment (${attType || "FILE"}) routed directly to staff with zero AI cost`,
      needsHumanHandoff: true,
      handoffReason,
      smartCategory: tmpState.activeCategory || "Custom Fabrication",
      priority: "HIGH",
      hasBurstRef: hasBurstReferenceMedia,
      mediaLabel: burstMediaLabel,
      imgCount: burstImages,
    });
  }

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
        const greetLine = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
        const friendlyErr =
          validation.errorCode === "OVERSIZED_IMAGE"
            ? `${greetLine}The image you shared is larger than our 5 MB limit, so I could not open it here. Could you please send a smaller compressed photo (under 5 MB) or describe the product you need?`
            : validation.errorCode === "INVALID_IMAGE_TYPE" ||
              validation.errorCode === "INVALID_IMAGE_SIGNATURE"
            ? `${greetLine}That file does not appear to be a valid JPEG, PNG, WebP, or GIF photo, so I could not inspect it safely. Please resend it as a standard photo or let me know what product you are looking for.`
            : `${greetLine}I could not download your photo cleanly right now, so I have not guessed what is in it. Please resend the image or share a short text description of what you need and I will help right away.`;
        return persistAndReturnEarly({
          stateInputText: rawText,
          replyText: friendlyErr,
          stepLabel: "Rejected or failed to fetch customer image safely",
          stepDetail: `code=${validation.errorCode || "UNKNOWN"}: ${validation.errorMessage || ""}`,
          stepStatus: "WARN",
          logQuestion: originalInboundText,
          model: "rule-image-validation-guard",
          outcomeSource: "LOCAL_FALLBACK",
          cacheDetails: `Image safety/fetch guard (${validation.errorCode || "ERROR"}) blocked Vision call (0 tokens)`,
          needsHumanHandoff: false,
          handoffReason: "",
          hasBurstRef: hasBurstReferenceMedia,
          mediaLabel: burstMediaLabel,
          imgCount: burstImages,
        });
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
            earlyReturn: {
              needsHumanHandoff: false,
              handoffReason: "",
              customerReply: rateMsg,
              smartCategory: limitState.activeCategory || "General Enquiry",
              priority: "NORMAL",
              conversationState: limitState,
            },
            visionAnalysis: null,
            visionUsage: null,
            visionFromCache: false,
            visionSha256: null,
            visionRecordedNewCall: false,
            hasBurstReferenceMedia,
            burstMediaLabel,
            burstImages,
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
          const greetLine = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
          return persistAndReturnEarly({
            stateInputText: rawText,
            replyText: `${greetLine}I received your photo, but our image reader could not inspect it right now. Could you briefly tell me what product or machine you are looking for, or ask for our team to review it?`,
            stepLabel: "Vision analysis unavailable; returned honest non-hallucinated fallback",
            stepDetail: visionResult.error || "Unknown Vision failure",
            stepStatus: "WARN",
            logQuestion: originalInboundText,
            model: LOCKED_CLAUDE_MODEL,
            outcomeSource: "LOCAL_FALLBACK",
            cacheDetails: `Vision call failed safely (${visionResult.error || "unavailable"})`,
            needsHumanHandoff: false,
            handoffReason: "",
            tokenUsage: visionUsage,
            error: visionResult.error || null,
            hasBurstRef: hasBurstReferenceMedia,
            mediaLabel: burstMediaLabel,
            imgCount: burstImages,
          });
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

  const shouldRouteAttachmentImmediately =
    !shouldAttemptVision &&
    (isMediaPlaceholderOnly ||
      (cleanCustomerText.length === 0 &&
        Boolean(params.attachment) &&
        attType === "IMAGE" &&
        !hasExplicitProductCodeWithImage));

  if (shouldRouteAttachmentImmediately) {
    const { tmpState, clause } = buildRequirementClause();
    const greetLine = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
    const handoffReason = `Customer shared ${attName || burstMediaLabel}${clause} (${originalInboundText.slice(0, 100)}) which needs team review.`;
    return persistAndReturnEarly({
      stateInputText: originalInboundText,
      replyText: `${greetLine}Thank you for sharing ${burstMediaLabel}${clause}. I have forwarded this directly to our team so a specialist can review it and reply to you right away.`,
      stepLabel: "Routed attachment directly to team",
      stepDetail: handoffReason,
      logQuestion: originalInboundText,
      model: "rule-attachment-team-handoff",
      outcomeSource: "HUMAN_HANDOFF",
      cacheDetails: `Attachment (${attType || "FILE"}) routed directly to human team`,
      needsHumanHandoff: true,
      handoffReason,
      smartCategory: tmpState.activeCategory || "Custom Fabrication",
      priority: "HIGH",
      hasBurstRef: hasBurstReferenceMedia,
      mediaLabel: burstMediaLabel,
      imgCount: burstImages,
    });
  }

  if (cleanCustomerText.length === 0 && /^\[message\]$/i.test(originalInboundText)) {
    const greetLine = alreadyGreeted ? "" : `Hi ${firstName}, welcome to *Classic Concepts*!\n\n`;
    return persistAndReturnEarly({
      stateInputText: rawText,
      replyText: `${greetLine}What are you looking to explore today?\n1. *Acrylic Podiums & Pulpits* for stages, auditoriums, or classrooms\n2. *Acrylic Furniture, Chairs & Tables* for interiors or events\n3. *Signages, Trophies & Custom Boxes*\n4. *Classic Edge 53 Machines* for acrylic bending and polishing\n\nReply with *1*, *2*, *3*, *4*, or a model code to get started!`,
      stepLabel: "Handled non-text webhook placeholder",
      stepDetail: `placeholder="${rawText}"`,
      logQuestion: rawText,
      model: "rule-webhook-placeholder",
      outcomeSource: "LIVE_AI",
      cacheDetails: `Deterministic reply for webhook placeholder ${rawText}`,
      needsHumanHandoff: false,
      handoffReason: "",
      hasBurstRef: hasBurstReferenceMedia,
      mediaLabel: burstMediaLabel,
      imgCount: burstImages,
    });
  }

  return {
    visionAnalysis,
    visionUsage,
    visionFromCache,
    visionSha256,
    visionRecordedNewCall,
    hasBurstReferenceMedia,
    burstMediaLabel,
    burstImages,
  };
}
