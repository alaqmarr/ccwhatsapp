import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import type { runAcrioAutonomousTurn } from "@cc/connections";
import { executeAcrioAutonomousPipeline } from "./acrio-turn-runner";
import { performCustomerOptOut, runAutomationRulesForInbound } from "./automations-engine";
import { handleAcrioInteractiveReply } from "./callback-requests";
import { loadPendingInboundBurst, sleepMs, type PendingBurstAttachments } from "./inbound-burst";
import { handleDirectOrderLookupIfApplicable } from "./order-lookup-flow";
import { tryStickyStaffAutoAssign } from "./routing-and-escalation";
import {
  handleInternalStaffInbound,
  handleMetaAlertQuickReplyFallback,
} from "./staff-whatsapp-desk";
import { handleTemplateButtonFlow } from "./template-button-flow";
import {
  claimAutomationWaMessageId,
  getInboundTurnSeq,
  nextInboundTurnSeq,
  withConversationWorkerLock,
} from "./webhook-idempotency";

export interface InboundAutomationParams {
  conversationId: string;
  customerPhone: string;
  inboundText: string;
  isNewConversation: boolean;
  isButtonClick?: boolean;
  buttonPayload?: string;
  buttonText?: string;
  replyToWaMessageId?: string;
  waMessageId?: string;
  attachment?: {
    mediaType?: string;
    filename?: string;
    mimeType?: string;
    caption?: string;
    mediaId?: string;
    sha256?: string;
    isSticker?: boolean;
    buffer?: Buffer;
  } | null;
  onBeforeAcrioSend?: () => Promise<void> | void;
  visionAnalyzerOverride?: Parameters<typeof runAcrioAutonomousTurn>[0]["visionAnalyzerOverride"];
  mediaFetchImpl?: Parameters<typeof runAcrioAutonomousTurn>[0]["mediaFetchImpl"];
}

/**
 * Runs inbound deterministic flows BEFORE ACRIO AI so button actions, order lookups,
 * and auto-replies never get hijacked by AI and AI credits stay strictly protected:
 * 1. Opt-Out (`STOP`) Protection
 * 2. Template Quick-Reply Button Flow Manager
 * 3. Live Order ID & Order Status Lookup across `:3002`, `:3003`, and `:3007` (0 AI credits)
 * 4. Advanced Auto-Reply Rules Engine
 * 5. Multi-Turn ACRIO AI Specialist (`claude-haiku-5-5`) when assigned to System (`ACRIO`)
 */
export async function processInboundAutomations(
  params: InboundAutomationParams
): Promise<void> {
  if (!claimAutomationWaMessageId(params.waMessageId)) {
    return;
  }

  const mySeq = nextInboundTurnSeq(params.conversationId);
  const cleanWaId = String(params.waMessageId || "").trim();

  // Brief debounce window for rapid consecutive WhatsApp bubbles so AI waits and answers all of them once
  const debounceDisabled = process.env.ACRIO_DISABLE_DEBOUNCE === "1";
  const isShortFragmentOrMedia =
    Boolean(params.attachment) ||
    /^\[(?:image|photo|video|document|pdf|file|audio|voice\s*note|sticker|location|message)\b/i.test(
      params.inboundText.trim()
    ) ||
    params.inboundText.trim().split(/\s+/).filter(Boolean).length <= 4;
  const defaultDebounceMs = cleanWaId
    ? isShortFragmentOrMedia
      ? 2600
      : 1600
    : 250;
  const configuredDebounce = Number(
    process.env.ACRIO_INBOUND_DEBOUNCE_MS ?? defaultDebounceMs
  );
  if (!debounceDisabled && !params.isButtonClick && configuredDebounce > 0) {
    await sleepMs(configuredDebounce);
    if (getInboundTurnSeq(params.conversationId) !== mySeq) {
      return;
    }
  }

  await withConversationWorkerLock(params.conversationId, async () => {
    if (getInboundTurnSeq(params.conversationId) !== mySeq) {
      return;
    }
    await processInboundAutomationsLocked(params, mySeq);
  });
}

async function processInboundAutomationsLocked(
  params: InboundAutomationParams,
  entrySeq: number
): Promise<void> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");

  const emptyBurst: PendingBurstAttachments = {
    images: 0,
    documents: 0,
    videos: 0,
    audios: 0,
    unreadable: 0,
    imageItems: [],
    nonImageItems: [],
  };

  // Coalesce multi-bubble bursts (only when not a specific interactive button payload)
  const initialBurst =
    !params.isButtonClick && !params.buttonPayload
      ? await loadPendingInboundBurst(params.conversationId, params.inboundText)
      : {
          coalescedText: params.inboundText,
          latestInboundId: null,
          latestInboundCreatedAt: null,
          count: 1,
          burstAttachments: emptyBurst,
        };
  const workingInboundText = initialBurst.coalescedText || params.inboundText;

  const convRes = await conv.execute({
    sql: `SELECT * FROM conversations WHERE id = ? LIMIT 1`,
    args: [params.conversationId],
  });
  const convRow = (convRes.rows[0] || {}) as Record<string, unknown>;
  const currentAssignedId = convRow.assigned_staff_id
    ? String(convRow.assigned_staff_id)
    : "";
  const currentTeamId = convRow.assigned_team_id
    ? String(convRow.assigned_team_id)
    : "";
  const currentStatus = convRow.status ? String(convRow.status) : "";
  const isHandledByAcrio =
    currentAssignedId === "ACRIO" &&
    currentStatus !== "ASSIGNED" &&
    (!currentTeamId || currentTeamId === "System (ACRIO)");
  const lower = workingInboundText.toLowerCase().trim();
  const nowIso = new Date().toISOString();

  // 0. Internal Staff Identification & Personalized Staff WhatsApp Desk
  const handledAsStaff = await handleInternalStaffInbound({
    conversationId: params.conversationId,
    customerPhone: params.customerPhone,
    workingInboundText,
    isButtonClick: params.isButtonClick,
    buttonPayload: params.buttonPayload,
    buttonText: params.buttonText,
    replyToWaMessageId: params.replyToWaMessageId,
    waMessageId: params.waMessageId,
    hasAttachment: Boolean(params.attachment),
    nowIso,
  });
  if (handledAsStaff) return;

  params = { ...params, inboundText: workingInboundText };

  // 1. Automatic WhatsApp Opt-Out Protection
  if (
    /^(stop|stop\s*promotions|stop\s*offers|unsubscribe|opt\s*out)\W*$/i.test(lower)
  ) {
    await performCustomerOptOut({
      conversationId: params.conversationId,
      customerPhone: params.customerPhone,
      reasonLabel: "Replied STOP on WhatsApp",
    });
    return;
  }

  // 1a. Handle Staff Quick-Reply Taps from Meta Alert Templates
  const incomingBtnText = String(
    params.buttonText || params.buttonPayload || params.inboundText || ""
  ).trim();
  if (
    await handleMetaAlertQuickReplyFallback({
      customerPhone: params.customerPhone,
      incomingBtnText,
      nowIso,
    })
  ) {
    return;
  }

  // 1b. ACRIO's own buttons and "View options" list taps (acrio:* payloads)
  let forcedFocusSlug: string | undefined;
  const acrioPayload = String(params.buttonPayload || "").trim();
  if (acrioPayload.toLowerCase().startsWith("acrio:")) {
    const handledButton = await handleAcrioInteractiveReply({
      conversationId: params.conversationId,
      customerPhone: params.customerPhone,
      payload: acrioPayload,
      isHandledByAcrio,
    });
    if (handledButton) return;
    if (acrioPayload.toLowerCase().startsWith("acrio:prod:")) {
      forcedFocusSlug = acrioPayload.slice("acrio:prod:".length);
      params.inboundText = `Tell me about ${params.buttonText || forcedFocusSlug.replace(/-/g, " ")}`;
    } else if (acrioPayload.toLowerCase() === "acrio:more") {
      params.inboundText = "Show me more options";
    }
  }

  // 1c. Staff Preference, Explicit Person Request, or Previous Handler Sticky Auto-Assign
  if (
    isHandledByAcrio &&
    (await tryStickyStaffAutoAssign({
      conversationId: params.conversationId,
      customerPhone: params.customerPhone,
      inboundText: params.inboundText,
      isNewConversation: params.isNewConversation,
      convRow,
      currentAssignedId,
      nowIso,
    }))
  ) {
    return;
  }

  // 2. Template Quick-Reply Button Flow Engine (Runs BEFORE ACRIO!)
  if (
    await handleTemplateButtonFlow({
      conversationId: params.conversationId,
      customerPhone: params.customerPhone,
      inboundText: params.inboundText,
      isButtonClick: params.isButtonClick,
      buttonPayload: params.buttonPayload,
      buttonText: params.buttonText,
      replyToWaMessageId: params.replyToWaMessageId,
      convRow,
      nowIso,
    })
  ) {
    return;
  }

  // 3. Direct Order ID & Order Status Ecosystem Lookup
  if (
    await handleDirectOrderLookupIfApplicable({
      conversationId: params.conversationId,
      customerPhone: params.customerPhone,
      inboundText: params.inboundText,
      isHandledByAcrio,
    })
  ) {
    return;
  }

  // 4. Advanced Auto-Replies & Routing Rules Engine
  const hasInboundMediaAttachment =
    Boolean(params.attachment) ||
    initialBurst.burstAttachments.images > 0 ||
    initialBurst.burstAttachments.documents > 0 ||
    initialBurst.burstAttachments.videos > 0 ||
    initialBurst.burstAttachments.audios > 0 ||
    initialBurst.burstAttachments.unreadable > 0;

  if (
    await runAutomationRulesForInbound({
      conversationId: params.conversationId,
      customerPhone: params.customerPhone,
      inboundText: params.inboundText,
      isNewConversation: params.isNewConversation,
      buttonPayload: params.buttonPayload,
      isHandledByAcrio,
      hasInboundMediaAttachment,
      nowIso,
    })
  ) {
    return;
  }

  // Case A: Chat is already connected to a human staff member -> keep human owner & start wait timer
  if (!isHandledByAcrio) {
    await conv.execute({
      sql: `UPDATE conversations
            SET waiting_since = COALESCE(waiting_since, ?)
            WHERE id = ?`,
      args: [nowIso, params.conversationId],
    });
    return;
  }

  // Do not waste AI calls replying to automated OTP / verification SMS alerts
  if (
    !params.attachment &&
    /\b\d{4,8}\s+is\s+your\s+(?:facebook|whatsapp|meta|instagram|google|otp|verification|confirmation)\s+code\b/i.test(
      workingInboundText
    )
  ) {
    return;
  }

  // Prevent rapid duplicate identical turns (within 45s) from firing multiple parallel ACRIO replies
  if (!params.isButtonClick && !params.attachment && !params.buttonPayload) {
    const normalizedCurrent = workingInboundText.trim().toLowerCase();
    const dupCheckRes = await conv
      .execute({
        sql: `SELECT direction, body, created_at FROM messages
              WHERE conversation_id = ? AND direction IN ('INBOUND', 'OUTBOUND')
              ORDER BY created_at DESC LIMIT 6`,
        args: [params.conversationId],
      })
      .catch(() => ({ rows: [] as any[] }));
    const nowMs = Date.now();
    let seenLatestMatch = false;
    let sawOutboundBeforePriorMatch = false;
    for (const r of dupCheckRes.rows) {
      const dir = String(r.direction || "");
      const bodyNorm = String(r.body || "").trim().toLowerCase();
      const createdMs = new Date(String(r.created_at || "")).getTime();
      if (!seenLatestMatch && dir === "INBOUND" && bodyNorm === normalizedCurrent) {
        seenLatestMatch = true;
        continue;
      }
      if (seenLatestMatch && dir === "OUTBOUND") {
        sawOutboundBeforePriorMatch = true;
        continue;
      }
      if (
        seenLatestMatch &&
        sawOutboundBeforePriorMatch &&
        dir === "INBOUND" &&
        bodyNorm === normalizedCurrent &&
        Number.isFinite(createdMs) &&
        nowMs - createdMs <= 45_000
      ) {
        return;
      }
    }
  }

  // Case B: Initial / active ACRIO assignment -> ACRIO handles the query automatically!
  await executeAcrioAutonomousPipeline({
    inbound: params,
    convRow,
    workingInboundText,
    forcedFocusSlug,
    initialLatestInboundId: initialBurst.latestInboundId,
    initialBurstAttachments: initialBurst.burstAttachments,
    entrySeq,
  });
}
