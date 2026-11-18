"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  Clock,
  Copy,
  CornerUpLeft,
  ExternalLink,
  FileText,
  History,
  Loader2,
  Lock,
  MapPin,
  Paperclip,
  Sparkles,
  StickyNote,
  UserCheck,
  X,
} from "lucide-react";
import {
  CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE,
  WhatsAppFormattedText,
  WhatsAppMessageTicks,
  formatTimeIst,
  stripWhatsAppFormatting,
} from "@cc/ui";
import {
  MessageMediaRenderer,
  extractMessageMedia,
  type NormalizedMessageMedia,
} from "@/components/MediaAttachmentTools";
import type {
  ChatMessage,
  QuotedMessageRef,
  StaffOption,
} from "@/lib/inbox-server-data";
import {
  buildClientMergedCorrection,
  emphasizeMentions,
  extractCtaButton,
  extractLocationPin,
  extractQuotedReply,
  formatDateTimeShort,
  formatResponseSpeed,
  formatWaitingDuration,
} from "./inbox-helpers";

type TimelineRow =
  | { key: string; kind: "top_notice" }
  | { key: string; kind: "load_older" }
  | { key: string; kind: "message"; message: ChatMessage }
  | { key: string; kind: "resolved_footer" };

export function MessageTimeline({
  conversationId,
  messages,
  conversationStatus,
  resolvedByName,
  resolutionSummary,
  hasOlderMessages,
  loadingOlderMessages,
  onLoadOlderMessages,
  nowMs,
  staffList,
  isAssignedToCurrentUser,
  highlightedMsgId,
  acrioActionBusyId,
  onStartReplyToMessage,
  onStartNoteReplyToMessage,
  onJumpToQuotedMessage,
  onOpenMediaPreview,
  onOpenNewChatWithPhone,
  onCopyToast,
  onSendNoteInChat,
  onMoveNoteToReplyBox,
  onConfirmAcrioAction,
  onUploadCompanyDocForNote,
  onUseSuggestedReply,
  onReopen,
  scrollTargetRef,
}: {
  conversationId: string;
  messages: ChatMessage[];
  conversationStatus: string;
  resolvedByName: string | null;
  resolutionSummary: string | null;
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  onLoadOlderMessages: () => void;
  nowMs: number;
  staffList: StaffOption[];
  isAssignedToCurrentUser: boolean;
  highlightedMsgId: string | null;
  acrioActionBusyId: string | null;
  onStartReplyToMessage: (m: ChatMessage) => void;
  onStartNoteReplyToMessage: (m: ChatMessage) => void;
  onJumpToQuotedMessage: (quoted: QuotedMessageRef) => void;
  onOpenMediaPreview: (media: NormalizedMessageMedia) => void;
  onOpenNewChatWithPhone: (phone: string, rawDisplay: string) => void;
  onCopyToast: (msg: string) => void;
  onSendNoteInChat: (noteId: string, customText?: string, dismissOnly?: boolean) => void;
  onMoveNoteToReplyBox: (text: string, quoted?: QuotedMessageRef | null) => void;
  onConfirmAcrioAction: (
    noteId: string,
    decision: "CONFIRM" | "CANCEL",
    selectedOptionId?: string
  ) => void;
  onUploadCompanyDocForNote: (
    noteId: string,
    missingDoc: { slug?: string; title?: string; keywords?: string },
    file: File
  ) => void;
  onUseSuggestedReply: (reply: string) => void;
  onReopen: () => void;
  scrollTargetRef?: React.MutableRefObject<((msgId: string) => void) | null>;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const lastConvIdRef = useRef<string | null>(null);
  const prevLenRef = useRef<number>(0);
  const prevFirstIdRef = useRef<string | null>(null);
  const isNearBottomRef = useRef<boolean>(true);

  const rows = useMemo<TimelineRow[]>(() => {
    const out: TimelineRow[] = [{ key: "top_notice", kind: "top_notice" }];
    if (hasOlderMessages) {
      out.push({ key: "load_older", kind: "load_older" });
    }
    for (const m of messages) {
      out.push({ key: m.id, kind: "message", message: m });
    }
    if (conversationStatus === "RESOLVED") {
      out.push({ key: "resolved_footer", kind: "resolved_footer" });
    }
    return out;
  }, [conversationStatus, hasOlderMessages, messages]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (idx) => {
      const row = rows[idx];
      if (!row) return 88;
      if (row.kind === "top_notice" || row.kind === "load_older") return 56;
      if (row.kind === "resolved_footer") return 80;
      if (row.message.messageType === "ASSIGNMENT_EVENT") return 110;
      return 96;
    },
    overscan: 8,
    getItemKey: (idx) => rows[idx]?.key ?? idx,
  });

  if (scrollTargetRef) {
    scrollTargetRef.current = (targetId: string) => {
      const rowIdx = rows.findIndex(
        (r) => r.kind === "message" && r.message.id === targetId
      );
      if (rowIdx >= 0) {
        rowVirtualizer.scrollToIndex(rowIdx, { align: "center", behavior: "smooth" });
      }
    };
  }

  // Track whether viewport is near bottom so older-message loads preserve scroll and new sends scroll smoothly
  const handleScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 180;
  };

  useEffect(() => {
    if (rows.length === 0) return;
    const isSwitching = lastConvIdRef.current !== conversationId;
    const firstMsgId = messages[0]?.id || null;
    const prevFirstId = prevFirstIdRef.current;
    const prevLen = prevLenRef.current;
    const deltaCount = messages.length - prevLen;

    lastConvIdRef.current = conversationId;
    prevLenRef.current = messages.length;
    prevFirstIdRef.current = firstMsgId;

    if (isSwitching) {
      isNearBottomRef.current = true;
      requestAnimationFrame(() => {
        rowVirtualizer.scrollToIndex(rows.length - 1, { align: "end" });
      });
      return;
    }

    // Prepended older messages above the current first message: keep view anchored near previous top item
    if (deltaCount > 0 && prevFirstId && firstMsgId && firstMsgId !== prevFirstId) {
      const anchorIdx = rows.findIndex(
        (r) => r.kind === "message" && r.message.id === prevFirstId
      );
      if (anchorIdx >= 0) {
        requestAnimationFrame(() => {
          rowVirtualizer.scrollToIndex(anchorIdx, { align: "start" });
        });
      }
      return;
    }

    // Appended new message (outbound send or incoming reply when near bottom)
    if (deltaCount > 0 && isNearBottomRef.current) {
      requestAnimationFrame(() => {
        rowVirtualizer.scrollToIndex(rows.length - 1, {
          align: "end",
          behavior: "smooth",
        });
      });
    }
  }, [conversationId, messages, rowVirtualizer, rows]);

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      style={CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE}
      className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 sm:px-5 py-3 sm:py-4 min-h-0"
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="pb-2.5"
            >
              {row.kind === "top_notice" && (
                <div className="flex justify-center pb-1">
                  <div className="px-3 py-1 rounded-md bg-[#fff5c4] border border-[#f2df8d] text-[11px] text-[#54656f] shadow-2xs text-center max-w-xl">
                    <strong>ACRIO</strong> runs only when a chat is assigned to{" "}
                    <strong>System</strong>. Once a chat is assigned to a team
                    member, ACRIO stays paused until assigned back to System.
                  </div>
                </div>
              )}

              {row.kind === "load_older" && (
                <div className="flex justify-center py-1">
                  <button
                    type="button"
                    disabled={loadingOlderMessages}
                    onClick={onLoadOlderMessages}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/95 hover:bg-white border border-[#d1d7db] shadow-2xs text-xs font-semibold text-[#008069] cursor-pointer disabled:opacity-60 transition"
                  >
                    {loadingOlderMessages ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Loading older messages...</span>
                      </>
                    ) : (
                      <>
                        <History className="w-3.5 h-3.5" />
                        <span>Load older messages</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {row.kind === "resolved_footer" && (
                <div className="mx-auto max-w-xl p-3 rounded-lg bg-emerald-50/95 border border-emerald-300 text-xs text-emerald-950 shadow-2xs flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      <span>
                        Resolved by {resolvedByName || "Staff"}
                      </span>
                    </div>
                    {resolutionSummary && (
                      <p className="mt-0.5 text-emerald-900">
                        {resolutionSummary}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={onReopen}
                    className="px-2.5 py-1 rounded bg-white border border-emerald-300 hover:bg-emerald-100 text-[11px] font-semibold text-emerald-900 cursor-pointer shrink-0"
                  >
                    Reopen
                  </button>
                </div>
              )}

              {row.kind === "message" && (() => {
                const m = row.message;
                if (m.messageType === "ASSIGNMENT_EVENT") {
                  const meta = (m.metadata || {}) as Record<string, unknown>;
                  const toStaffId = meta.toStaffId ? String(meta.toStaffId) : "";
                  const toStaffName = meta.toStaffName
                    ? String(meta.toStaffName)
                    : "Staff";
                  const toTeamName = meta.toTeamName
                    ? String(meta.toTeamName)
                    : "Sales Team";
                  const tier = meta.escalationLevel
                    ? String(meta.escalationLevel)
                    : "P0";
                  const assignedAtIso = meta.assignedAt
                    ? String(meta.assignedAt)
                    : m.createdAt;
                  const firstRespIso = meta.firstResponseAt
                    ? String(meta.firstResponseAt)
                    : null;
                  const firstRespSec =
                    typeof meta.firstResponseSeconds === "number"
                      ? meta.firstResponseSeconds
                      : null;
                  const outcome = meta.outcome ? String(meta.outcome) : "ACTIVE";
                  const isSystemAsg = toStaffId === "ACRIO";
                  const livePendingWait =
                    !firstRespIso &&
                    outcome === "ACTIVE" &&
                    !isSystemAsg &&
                    conversationStatus !== "RESOLVED"
                      ? formatWaitingDuration(assignedAtIso, nowMs)
                      : null;

                  return (
                    <div className="flex justify-center my-0.5">
                      <div className="w-full max-w-[94%] sm:max-w-[84%] rounded-lg px-3 sm:px-3.5 py-2.5 bg-white/95 border border-[#d1d7db] shadow-2xs text-[#111b21] min-w-0 [overflow-wrap:anywhere]">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <div className="inline-flex flex-wrap items-center gap-1.5 font-semibold">
                            {isSystemAsg ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200">
                                <Sparkles className="w-3 h-3" />
                                <span>System (ACRIO)</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#e7fce3] text-[#008069] border border-[#b7ebaf]">
                                <UserCheck className="w-3 h-3" />
                                <span>
                                  {toStaffName} • {toTeamName}
                                </span>
                              </span>
                            )}
                            {!isSystemAsg && (
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                                  tier === "P2"
                                    ? "bg-red-600 text-white"
                                    : tier === "P1"
                                    ? "bg-amber-500 text-white"
                                    : "bg-neutral-100 text-neutral-700"
                                }`}
                              >
                                {tier}
                              </span>
                            )}
                          </div>
                          <span className="text-[#54656f] font-medium">
                            Assigned: {formatDateTimeShort(assignedAtIso)}
                          </span>
                        </div>

                        <p className="text-xs text-[#3b4a54] mt-1 leading-snug">
                          {m.body}
                        </p>

                        <div className="mt-1.5 pt-1.5 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          {firstRespIso ? (
                            <span className="inline-flex items-center gap-1 text-emerald-800 font-medium">
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span>
                                First response:{" "}
                                <strong>{formatDateTimeShort(firstRespIso)}</strong>
                                {firstRespSec !== null && (
                                  <>
                                    {" "}
                                    (in{" "}
                                    <strong>
                                      {formatResponseSpeed(firstRespSec)}
                                    </strong>
                                    )
                                  </>
                                )}
                              </span>
                            </span>
                          ) : outcome === "ESCALATED" ? (
                            <span className="inline-flex items-center gap-1 text-red-700 font-medium">
                              <Clock className="w-3 h-3" />
                              <span>Escalated before first response</span>
                            </span>
                          ) : outcome === "REASSIGNED" ? (
                            <span className="text-neutral-500">
                              Reassigned before first response
                            </span>
                          ) : livePendingWait ? (
                            <span
                              suppressHydrationWarning
                              className={`inline-flex items-center gap-1 font-medium ${
                                livePendingWait.minutes >= 5
                                  ? "text-red-700"
                                  : "text-amber-700"
                              }`}
                            >
                              <Clock className="w-3 h-3" />
                              <span suppressHydrationWarning>
                                Awaiting first response ({livePendingWait.text})
                              </span>
                            </span>
                          ) : (
                            <span className="text-neutral-500">
                              {isSystemAsg
                                ? "Standing by for customer message"
                                : "No outbound reply needed"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                const isInternalNote =
                  m.direction === "INTERNAL" ||
                  m.messageType === "INTERNAL_NOTE";
                const isOutbound = m.direction === "OUTBOUND";
                const quotedReply = extractQuotedReply(m);
                const ctaButton = extractCtaButton(m);
                const locationPin = extractLocationPin(m);
                const isHighlighted = highlightedMsgId === m.id;

                if (isInternalNote) {
                  const isAcrioNote = m.senderName === "ACRIO";
                  return (
                    <div
                      id={`chat-msg-${m.id}`}
                      className="flex justify-center my-0.5"
                    >
                      <div
                        className={`w-full max-w-[94%] sm:max-w-[84%] lg:max-w-[78%] rounded-lg px-3 sm:px-3.5 py-2.5 shadow-2xs transition-all duration-300 min-w-0 [overflow-wrap:anywhere] ${
                          isAcrioNote
                            ? "bg-violet-50 border border-violet-300/70 text-violet-950"
                            : "bg-[#fef3c7] border border-[#f59e0b]/45 text-[#78350f]"
                        } ${isHighlighted ? "ring-2 ring-[#00a884]" : ""}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] font-semibold mb-1 min-w-0">
                          <span className="inline-flex items-center gap-1 min-w-0">
                            <Lock className={`w-3 h-3 shrink-0 ${isAcrioNote ? "text-violet-700" : "text-amber-700"}`} />
                            <span className="truncate">
                              {isAcrioNote ? "ACRIO • Private answer for your team" : `Internal Team Note • ${m.senderName}`}
                            </span>
                          </span>
                          <span className={`font-normal ${isAcrioNote ? "text-violet-800/80" : "text-amber-800/80"}`}>
                            {formatTimeIst(m.createdAt)}
                          </span>
                        </div>
                        {quotedReply && (
                          <button
                            type="button"
                            onClick={() => onJumpToQuotedMessage(quotedReply)}
                            className="w-full text-left mb-1.5 rounded-md px-2.5 py-1.5 bg-amber-100/85 hover:bg-amber-200/70 border-l-[3.5px] border-amber-600 transition cursor-pointer"
                          >
                            <div className="text-[11px] font-semibold text-amber-950 truncate">
                              {quotedReply.senderName}
                            </div>
                            <div className="text-[12px] text-amber-900/85 line-clamp-2 leading-snug">
                              {stripWhatsAppFormatting(quotedReply.body)}
                            </div>
                          </button>
                        )}
                        <WhatsAppFormattedText
                          text={emphasizeMentions(m.body, staffList)}
                          className="text-[13px] leading-relaxed"
                          onPhoneClick={onOpenNewChatWithPhone}
                        />
                        {(() => {
                          const noteMedia = extractMessageMedia(m);
                          if (!noteMedia) return null;
                          return (
                            <div className="mt-2">
                              <MessageMediaRenderer
                                media={noteMedia}
                                onOpenPreview={onOpenMediaPreview}
                              />
                            </div>
                          );
                        })()}
                        {isAcrioNote &&
                          m.metadata &&
                          typeof m.metadata.pendingAction === "object" &&
                          m.metadata.pendingAction !== null &&
                          (() => {
                            const pa = m.metadata.pendingAction as {
                              id?: string;
                              status?: string;
                              title?: string;
                              messageText?: string;
                              sourceLabel?: string;
                              decidedByStaffName?: string;
                              error?: string;
                              attachment?: {
                                url?: string;
                                fileName?: string;
                                mediaType?: string;
                              } | null;
                              candidateOptions?: Array<{
                                id: string;
                                title: string;
                                sourceLabel: string;
                                mediaUrl: string;
                                mediaType: string;
                                fileName: string;
                                messageText?: string;
                              }>;
                            };
                            const isBusy = acrioActionBusyId === m.id;
                            const hasChoices =
                              Array.isArray(pa.candidateOptions) &&
                              pa.candidateOptions.length > 1;
                            const isTextChoiceList =
                              hasChoices &&
                              Boolean(
                                pa.candidateOptions?.some(
                                  (o) => Boolean(o.messageText) && !o.mediaUrl
                                )
                              );
                            if (pa.status === "CONFIRMED") {
                              return (
                                <div className="mt-2 pt-2 border-t border-violet-200/70 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
                                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                                  <span>
                                    Confirmed &amp; shared with client
                                    {pa.decidedByStaffName ? ` by ${pa.decidedByStaffName}` : ""}
                                  </span>
                                </div>
                              );
                            }
                            if (pa.status === "CANCELLED") {
                              return (
                                <div className="mt-2 pt-2 border-t border-violet-200/70 flex items-center gap-1.5 text-[11px] font-medium text-neutral-600">
                                  <X className="w-3.5 h-3.5" />
                                  <span>
                                    Action cancelled
                                    {pa.decidedByStaffName ? ` by ${pa.decidedByStaffName}` : ""}
                                  </span>
                                </div>
                              );
                            }
                            return (
                              <div className="mt-2.5 rounded-md bg-white border border-violet-200 p-2.5 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[11px] font-semibold text-violet-950">
                                    {isTextChoiceList
                                      ? "Choose how to send this in the customer's WhatsApp chat:"
                                      : hasChoices
                                      ? "Select which document to confirm & send to client:"
                                      : pa.title || "Confirm client action"}
                                  </span>
                                  {!hasChoices && pa.attachment?.fileName && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-violet-100 text-violet-900 text-[10.5px] font-medium">
                                      <FileText className="w-3 h-3" />
                                      <span>
                                        {pa.attachment.fileName}
                                        {pa.sourceLabel ? ` (${pa.sourceLabel})` : ""}
                                      </span>
                                    </span>
                                  )}
                                </div>

                                {hasChoices && pa.candidateOptions ? (
                                  <div className="space-y-1.5">
                                    {pa.candidateOptions.map((opt, idx) => (
                                      <div
                                        key={opt.id}
                                        className="rounded border border-violet-100 bg-[#faf8ff] px-2.5 py-2 flex flex-wrap items-center justify-between gap-2"
                                      >
                                        <div className="min-w-0 flex-1">
                                          <div className="text-[11.5px] font-semibold text-violet-950 truncate">
                                            {idx + 1}. {opt.title}
                                          </div>
                                          {opt.messageText && !opt.mediaUrl ? (
                                            <div className="mt-1 text-[12px] text-[#111b21] bg-white border border-violet-200/80 rounded px-2 py-1 font-medium">
                                              {opt.messageText}
                                            </div>
                                          ) : (
                                            <div className="text-[10.5px] text-neutral-600 truncate">
                                              Source: {opt.sourceLabel} • {opt.fileName}
                                            </div>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          {opt.mediaUrl && (
                                            <a
                                              href={opt.mediaUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="px-2 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-[10.5px] font-medium text-neutral-700"
                                            >
                                              View
                                            </a>
                                          )}
                                          {opt.messageText && !opt.mediaUrl && (
                                            <button
                                              type="button"
                                              disabled={isBusy}
                                              onClick={() =>
                                                onMoveNoteToReplyBox(
                                                  opt.messageText || "",
                                                  quotedReply
                                                )
                                              }
                                              className="px-2 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-[10.5px] font-medium text-neutral-700 cursor-pointer"
                                            >
                                              Edit in Reply Box
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() =>
                                              onConfirmAcrioAction(m.id, "CONFIRM", opt.id)
                                            }
                                            className="px-2.5 py-1 rounded bg-[#00a884] hover:bg-[#008f6f] text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                          >
                                            {isBusy ? (
                                              <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                              <Check className="w-3 h-3" />
                                            )}
                                            <span>
                                              {isBusy
                                                ? "Sending..."
                                                : opt.messageText && !opt.mediaUrl
                                                ? "Send in Chat"
                                                : "Confirm & Send"}
                                            </span>
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  pa.messageText && (
                                    <p className="text-[12px] text-[#3b4a54] bg-[#f8fafc] border border-neutral-200 rounded px-2 py-1.5">
                                      {pa.messageText}
                                    </p>
                                  )
                                )}

                                {pa.status === "FAILED" && pa.error && (
                                  <p className="text-[11px] text-rose-700">
                                    Previous send failed: {pa.error}
                                  </p>
                                )}
                                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                                  {!hasChoices && (
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => onConfirmAcrioAction(m.id, "CONFIRM")}
                                      className="px-3 py-1.5 rounded bg-[#00a884] hover:bg-[#008f6f] text-white text-[11.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                    >
                                      {isBusy ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      ) : (
                                        <Check className="w-3.5 h-3.5" />
                                      )}
                                      <span>
                                        {isBusy
                                          ? "Sharing with client..."
                                          : "Confirm & Share with Client"}
                                      </span>
                                    </button>
                                  )}
                                  {!hasChoices && pa.attachment?.url && (
                                    <a
                                      href={pa.attachment.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="px-2.5 py-1.5 rounded bg-white hover:bg-neutral-50 border border-neutral-300 text-neutral-700 text-[11px] font-medium"
                                    >
                                      View File
                                    </a>
                                  )}
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => onConfirmAcrioAction(m.id, "CANCEL")}
                                    className="px-2.5 py-1.5 rounded bg-white hover:bg-neutral-100 border border-neutral-300 text-neutral-700 text-[11px] font-medium cursor-pointer disabled:opacity-50"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                        {isAcrioNote &&
                          m.metadata &&
                          typeof m.metadata.missingCompanyDoc === "object" &&
                          m.metadata.missingCompanyDoc !== null &&
                          (m.metadata.missingCompanyDoc as { status?: string }).status ===
                            "NEEDS_UPLOAD" &&
                          (() => {
                            const md = m.metadata.missingCompanyDoc as {
                              slug?: string;
                              title?: string;
                              keywords?: string;
                            };
                            const isBusy = acrioActionBusyId === m.id;
                            return (
                              <div className="mt-2.5 rounded-md bg-white border border-violet-200 p-2.5 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[11px] text-violet-950 font-medium">
                                  Upload once to save permanently &amp; confirm sharing:
                                </span>
                                <label
                                  className={`px-3 py-1.5 rounded bg-violet-700 hover:bg-violet-800 text-white text-[11.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                                    isBusy ? "opacity-50 pointer-events-none" : ""
                                  }`}
                                >
                                  {isBusy ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Paperclip className="w-3.5 h-3.5" />
                                  )}
                                  <span>
                                    {isBusy
                                      ? "Uploading..."
                                      : `Upload ${md.title || "Document"}`}
                                  </span>
                                  <input
                                    type="file"
                                    accept=".pdf,image/*"
                                    className="hidden"
                                    disabled={isBusy}
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      e.target.value = "";
                                      if (f) {
                                        onUploadCompanyDocForNote(m.id, md, f);
                                      }
                                    }}
                                  />
                                </label>
                              </div>
                            );
                          })()}
                        {isAcrioNote &&
                          m.metadata &&
                          Array.isArray(m.metadata.actionsExecuted) &&
                          m.metadata.actionsExecuted.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-violet-200/70 flex flex-wrap gap-1.5">
                              {(m.metadata.actionsExecuted as (Record<string, unknown> | string)[]).map(
                                (act, idx) => (
                                  <span
                                    key={`${m.id}_act_${idx}`}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-200 text-[10.5px] font-semibold"
                                  >
                                    <Check className="w-3 h-3" />
                                    <span>
                                      {typeof act === "string"
                                        ? act
                                        : String(act.detail || act.type || "Action done")}
                                    </span>
                                  </span>
                                )
                              )}
                            </div>
                          )}
                        {isAcrioNote &&
                          m.metadata &&
                          !m.metadata.pendingAction &&
                          !m.metadata.missingCompanyDoc &&
                          typeof m.metadata.suggestedReply === "string" &&
                          m.metadata.suggestedReply.trim() && (
                            <div className="mt-2 pt-2 border-t border-violet-200/70 flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] font-medium text-violet-900">
                                Suggested reply ready:
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void navigator.clipboard?.writeText(
                                      String(m.metadata?.suggestedReply || "")
                                    );
                                    onCopyToast("Suggested reply copied.");
                                  }}
                                  className="px-2 py-1 rounded bg-white border border-violet-200 text-violet-900 text-[11px] font-medium cursor-pointer"
                                >
                                  Copy
                                </button>
                                {isAssignedToCurrentUser && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onUseSuggestedReply(
                                        String(m.metadata?.suggestedReply || "")
                                      )
                                    }
                                    className="px-2.5 py-1 rounded bg-violet-700 hover:bg-violet-800 text-white text-[11px] font-semibold cursor-pointer"
                                  >
                                    Use Reply
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        {!isAcrioNote &&
                          (() => {
                            const rawAcc =
                              m.metadata &&
                              typeof m.metadata.accidentalCustomerReply === "object" &&
                              m.metadata.accidentalCustomerReply !== null
                                ? (m.metadata.accidentalCustomerReply as {
                                    detected?: boolean;
                                    status?: "PENDING" | "SENT" | "DISMISSED";
                                    exactMessageText?: string;
                                    mergedCorrectionText?: string | null;
                                    sentByStaffName?: string;
                                  })
                                : null;
                            const bodyTrimmed = String(m.body || "").trim();
                            const hasAtMention = bodyTrimmed.includes("@");
                            const clientDetectedMistake =
                              !hasAtMention &&
                              (Boolean(quotedReply) ||
                                /^(?:sorry|sry)\b/i.test(bodyTrimmed) ||
                                /\b(?:each\s+one\s+[\d,]+|plus\s+gst|transport\s+charges|\bsir\s*[,!.]*$)/i.test(
                                  bodyTrimmed
                                ));
                            const isMistakePending =
                              rawAcc?.status === "SENT" || rawAcc?.status === "DISMISSED"
                                ? false
                                : Boolean(rawAcc?.detected || clientDetectedMistake);
                            const mergedText =
                              rawAcc?.mergedCorrectionText ||
                              (quotedReply?.body
                                ? buildClientMergedCorrection(bodyTrimmed, quotedReply.body)
                                : null);
                            const isBusy = acrioActionBusyId === m.id;

                            if (rawAcc?.status === "SENT") {
                              return (
                                <div className="mt-2 pt-1.5 border-t border-amber-300/70 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
                                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                                  <span>
                                    Sent to customer in WhatsApp chat
                                    {rawAcc.sentByStaffName ? ` by ${rawAcc.sentByStaffName}` : ""}
                                  </span>
                                </div>
                              );
                            }

                            if (isMistakePending) {
                              return (
                                <div className="mt-2.5 rounded-md bg-white/95 border border-amber-400 p-2.5 space-y-2 shadow-2xs">
                                  <div className="text-[11.5px] font-semibold text-amber-950">
                                    Heads up: This looks like a customer reply saved in an Internal Note (the customer cannot see this).
                                  </div>
                                  {mergedText && (
                                    <div className="rounded bg-emerald-50/80 border border-emerald-200 px-2.5 py-1.5 text-[11.5px] text-emerald-950">
                                      <span className="font-semibold">Smart corrected reply: </span>
                                      <span>{mergedText}</span>
                                    </div>
                                  )}
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {mergedText && (
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => onSendNoteInChat(m.id, mergedText)}
                                        className="px-2.5 py-1 rounded bg-[#00a884] hover:bg-[#008f6f] text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                      >
                                        {isBusy ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <Check className="w-3 h-3" />
                                        )}
                                        <span>
                                          {isBusy
                                            ? "Sending..."
                                            : "Send Corrected Reply in Chat"}
                                        </span>
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => onSendNoteInChat(m.id, bodyTrimmed)}
                                      className={`px-2.5 py-1 rounded text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                                        mergedText
                                          ? "bg-amber-700 hover:bg-amber-800 text-white"
                                          : "bg-[#00a884] hover:bg-[#008f6f] text-white"
                                      }`}
                                    >
                                      {isBusy ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <CornerUpLeft className="w-3 h-3" />
                                      )}
                                      <span>
                                        {isBusy
                                          ? "Sending..."
                                          : mergedText
                                          ? `Send "${bodyTrimmed.slice(0, 28)}" Only`
                                          : "Send in Chat"}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() =>
                                        onMoveNoteToReplyBox(
                                          mergedText || bodyTrimmed,
                                          quotedReply
                                        )
                                      }
                                      className="px-2 py-1 rounded bg-white hover:bg-neutral-50 border border-neutral-300 text-neutral-800 text-[11px] font-medium cursor-pointer"
                                    >
                                      Edit in Reply Box
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => onSendNoteInChat(m.id, undefined, true)}
                                      className="px-2 py-1 rounded bg-white hover:bg-neutral-100 border border-neutral-200 text-neutral-600 text-[10.5px] font-medium cursor-pointer"
                                    >
                                      Keep as Note
                                    </button>
                                  </div>
                                </div>
                              );
                            }

                            if (!hasAtMention && bodyTrimmed.length > 0) {
                              return (
                                <div className="mt-1.5 pt-1 border-t border-amber-300/45 flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() =>
                                      onMoveNoteToReplyBox(bodyTrimmed, quotedReply)
                                    }
                                    className="text-[10.5px] font-medium text-amber-900/80 hover:text-amber-950 underline cursor-pointer"
                                  >
                                    Edit in Reply Box
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => onSendNoteInChat(m.id, bodyTrimmed)}
                                    className="px-2 py-0.5 rounded bg-amber-700/15 hover:bg-amber-700/25 text-amber-950 text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                  >
                                    {isBusy ? (
                                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                    ) : (
                                      <CornerUpLeft className="w-2.5 h-2.5" />
                                    )}
                                    <span>{isBusy ? "Sending..." : "Send in Chat"}</span>
                                  </button>
                                </div>
                              );
                            }
                            return null;
                          })()}
                      </div>
                    </div>
                  );
                }

                const isAcrioBubble = m.billingCategory === "ACRIO";
                const isTemplateBubble = m.messageType === "TEMPLATE";
                const quotedIsAcrio =
                  quotedReply?.senderType === "ACRIO" ||
                  quotedReply?.senderName === "ACRIO";
                const quotedIsOutbound = quotedReply?.direction === "OUTBOUND";

                return (
                  <div
                    id={`chat-msg-${m.id}`}
                    className={`group flex ${
                      isOutbound ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      onDoubleClick={() => onStartReplyToMessage(m)}
                      title="Double-click or press Reply to quote this message"
                      className={`max-w-[92%] sm:max-w-[82%] lg:max-w-[74%] rounded-lg px-2.5 sm:px-3 py-2 shadow-2xs relative transition-all duration-300 min-w-0 [overflow-wrap:anywhere] ${
                        isHighlighted
                          ? "ring-2 ring-[#00a884] bg-[#fff8d6] text-[#111b21]"
                          : isOutbound
                          ? "bg-[#d9fdd3] text-[#111b21] rounded-tr-none"
                          : "bg-white text-[#111b21] rounded-tl-none"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] mb-0.5 min-w-0">
                        <span
                          className={`font-semibold truncate min-w-0 ${
                            isOutbound
                              ? isAcrioBubble
                                ? "text-indigo-800"
                                : "text-[#008069]"
                              : "text-[#e31837]"
                          }`}
                        >
                          {m.senderName}
                        </span>
                        <div className="flex flex-wrap items-center gap-1 shrink-0">
                          {isAcrioBubble && (
                            <span className="px-1.5 py-0.2 rounded bg-white/80 text-indigo-800 text-[10px] font-medium">
                              ACRIO
                            </span>
                          )}
                          {isTemplateBubble && (
                            <span className="px-1.5 py-0.2 rounded bg-white/80 text-[#54656f] text-[10px] font-medium">
                              Template
                            </span>
                          )}
                          <div className="inline-flex items-center gap-0.5 opacity-75 group-hover:opacity-100 transition">
                            <button
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                onStartReplyToMessage(m);
                              }}
                              title="Quote & reply to customer"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium text-[#54656f] hover:text-[#111b21] hover:bg-black/8 cursor-pointer"
                            >
                              <CornerUpLeft className="w-3 h-3" />
                              <span>Reply</span>
                            </button>
                            <button
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                onStartNoteReplyToMessage(m);
                              }}
                              title="Quote this message in a private team note (@mention or @ACRIO)"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium text-amber-800 hover:bg-amber-500/15 cursor-pointer"
                            >
                              <StickyNote className="w-3 h-3" />
                              <span>Note</span>
                            </button>
                            <button
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void navigator.clipboard?.writeText(stripWhatsAppFormatting(m.body));
                                onCopyToast("Message text copied.");
                              }}
                              title="Copy message text"
                              className="p-1 rounded text-[#54656f] hover:text-[#111b21] hover:bg-black/8 cursor-pointer"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {quotedReply && (
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onJumpToQuotedMessage(quotedReply);
                          }}
                          title="Jump to original message"
                          className={`w-full text-left my-1 rounded-md px-2.5 py-1.5 border-l-[3.5px] transition cursor-pointer ${
                            quotedIsAcrio
                              ? "border-indigo-600"
                              : quotedIsOutbound
                              ? "border-[#00a884]"
                              : "border-[#e31837]"
                          } ${
                            isOutbound
                              ? "bg-[#cfe9ba]/75 hover:bg-[#c5e4ae]"
                              : "bg-[#f0f2f5] hover:bg-[#e6eaee]"
                          }`}
                        >
                          <div
                            className={`text-[11px] font-semibold truncate ${
                              quotedIsAcrio
                                ? "text-indigo-800"
                                : quotedIsOutbound
                                ? "text-[#008069]"
                                : "text-[#e31837]"
                            }`}
                          >
                            {quotedReply.senderName}
                          </div>
                          <div className="text-[12px] text-[#54656f] line-clamp-2 leading-snug">
                            {stripWhatsAppFormatting(quotedReply.body)}
                          </div>
                        </button>
                      )}

                      {(() => {
                        const msgMedia = extractMessageMedia(m);
                        if (!msgMedia) return null;
                        return (
                          <MessageMediaRenderer
                            media={msgMedia}
                            onOpenPreview={onOpenMediaPreview}
                          />
                        );
                      })()}

                      {locationPin ? (
                        <div className="mb-1 rounded-md border border-[#00a884]/35 bg-[#f0fdf4] p-2.5 space-y-1.5">
                          <div className="flex items-start gap-2">
                            <span className="w-7 h-7 rounded-full bg-[#00a884] text-white flex items-center justify-center shrink-0 mt-0.5">
                              <MapPin className="w-3.5 h-3.5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold text-[#111b21] truncate">
                                {locationPin.name}
                              </div>
                              {locationPin.address && (
                                <div className="text-[11.5px] text-[#54656f] leading-snug mt-0.5">
                                  {locationPin.address}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 pt-1">
                            <a
                              href={locationPin.mapsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md bg-white hover:bg-emerald-50 border border-[#00a884]/40 text-[#008069] text-xs font-semibold shadow-2xs transition"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                              <span>Open in Google Maps</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard?.writeText(locationPin.mapsUrl);
                                onCopyToast("Copied Google Maps link.");
                              }}
                              title={`Copy ${locationPin.mapsUrl}`}
                              className="p-1.5 rounded-md bg-white hover:bg-neutral-50 border border-black/10 text-[#54656f] hover:text-[#111b21] cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <WhatsAppFormattedText
                          text={m.body}
                          className="text-[14px] leading-[1.52] tracking-[-0.006em]"
                          onPhoneClick={onOpenNewChatWithPhone}
                        />
                      )}

                      {ctaButton && (
                        <div className="mt-2 pt-2 border-t border-black/10 space-y-1.5">
                          {(ctaButton.orderId || ctaButton.providerName) && (
                            <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-[#54656f]">
                              {ctaButton.orderId && (
                                <span className="font-mono font-semibold text-[#111b21]">
                                  Order #{ctaButton.orderId}
                                </span>
                              )}
                              {ctaButton.providerName && (
                                <span className="px-1.5 py-0.5 rounded bg-white/80 text-[#008069] font-medium">
                                  {ctaButton.providerName}
                                  {ctaButton.awbNumber
                                    ? ` • AWB ${ctaButton.awbNumber}`
                                    : ""}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-1.5">
                            <a
                              href={ctaButton.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md bg-white/95 hover:bg-white border border-[#00a884]/35 text-[#008069] text-xs font-semibold shadow-2xs transition"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>{ctaButton.label}</span>
                            </a>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard?.writeText(ctaButton.url);
                                onCopyToast(`Copied ${ctaButton.url}`);
                              }}
                              title={`Copy ${ctaButton.url}`}
                              className="p-1.5 rounded-md bg-white/90 hover:bg-white border border-black/10 text-[#54656f] hover:text-[#111b21] cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="text-[10.5px] font-mono text-[#54656f] truncate">
                            {ctaButton.url}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-end gap-1.5 mt-1 text-[10.5px] tabular-nums text-[#667781]">
                        <span>{formatTimeIst(m.createdAt)}</span>
                        {isOutbound && (
                          <WhatsAppMessageTicks
                            status={m.deliveryStatus}
                            showLabel
                            size={14}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
