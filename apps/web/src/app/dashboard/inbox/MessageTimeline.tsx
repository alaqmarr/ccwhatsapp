"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, History, Loader2 } from "lucide-react";
import {
  CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE,
  formatChatDateDividerIst,
  getIstDateKey,
} from "@cc/ui";
import type { NormalizedMessageMedia } from "@/components/MediaAttachmentTools";
import type {
  ChatMessage,
  QuotedMessageRef,
  StaffOption,
} from "@/lib/inbox-server-data";
import { AssignmentEventCard } from "./AssignmentEventCard";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { InternalNoteBubble } from "./InternalNoteBubble";

type TimelineRow =
  | { key: string; kind: "top_notice" }
  | { key: string; kind: "load_older" }
  | { key: string; kind: "date_separator"; dateKey: string; label: string }
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

  const todayKey = getIstDateKey(nowMs);
  const todayRefMs = useMemo(
    () => (todayKey ? new Date(`${todayKey}T12:00:00+05:30`).getTime() : undefined),
    [todayKey]
  );

  const rows = useMemo<TimelineRow[]>(() => {
    const out: TimelineRow[] = [{ key: "top_notice", kind: "top_notice" }];
    if (hasOlderMessages) {
      out.push({ key: "load_older", kind: "load_older" });
    }
    let lastDayKey = "";
    for (const m of messages) {
      const dayKey = getIstDateKey(m.createdAt);
      if (dayKey && dayKey !== lastDayKey) {
        lastDayKey = dayKey;
        const label = formatChatDateDividerIst(m.createdAt, todayRefMs);
        if (label) {
          out.push({
            key: `date_sep_${dayKey}`,
            kind: "date_separator",
            dateKey: dayKey,
            label,
          });
        }
      }
      out.push({ key: m.id, kind: "message", message: m });
    }
    if (conversationStatus === "RESOLVED") {
      out.push({ key: "resolved_footer", kind: "resolved_footer" });
    }
    return out;
  }, [conversationStatus, hasOlderMessages, messages, todayRefMs]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (idx) => {
      const row = rows[idx];
      if (!row) return 88;
      if (row.kind === "top_notice" || row.kind === "load_older") return 56;
      if (row.kind === "date_separator") return 42;
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

              {row.kind === "date_separator" && (
                <div className="flex justify-center py-1 select-none">
                  <span
                    suppressHydrationWarning
                    className="px-3 py-1 rounded-lg bg-white/95 border border-[#e2e5e9] text-[11.5px] font-medium text-[#54656f] shadow-2xs"
                  >
                    {row.label}
                  </span>
                </div>
              )}

              {row.kind === "resolved_footer" && (
                <div className="mx-auto max-w-xl p-3 rounded-lg bg-emerald-50/95 border border-emerald-300 text-xs text-emerald-950 shadow-2xs flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Resolved by {resolvedByName || "Staff"}</span>
                    </div>
                    {resolutionSummary && (
                      <p className="mt-0.5 text-emerald-900">{resolutionSummary}</p>
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

              {row.kind === "message" &&
                (row.message.messageType === "ASSIGNMENT_EVENT" ? (
                  <AssignmentEventCard
                    message={row.message}
                    conversationStatus={conversationStatus}
                    nowMs={nowMs}
                  />
                ) : row.message.direction === "INTERNAL" ||
                  row.message.messageType === "INTERNAL_NOTE" ? (
                  <InternalNoteBubble
                    message={row.message}
                    staffList={staffList}
                    isHighlighted={highlightedMsgId === row.message.id}
                    isAssignedToCurrentUser={isAssignedToCurrentUser}
                    acrioActionBusyId={acrioActionBusyId}
                    onJumpToQuotedMessage={onJumpToQuotedMessage}
                    onOpenMediaPreview={onOpenMediaPreview}
                    onOpenNewChatWithPhone={onOpenNewChatWithPhone}
                    onCopyToast={onCopyToast}
                    onSendNoteInChat={onSendNoteInChat}
                    onMoveNoteToReplyBox={onMoveNoteToReplyBox}
                    onConfirmAcrioAction={onConfirmAcrioAction}
                    onUploadCompanyDocForNote={onUploadCompanyDocForNote}
                    onUseSuggestedReply={onUseSuggestedReply}
                  />
                ) : (
                  <ChatMessageBubble
                    message={row.message}
                    isHighlighted={highlightedMsgId === row.message.id}
                    onStartReplyToMessage={onStartReplyToMessage}
                    onStartNoteReplyToMessage={onStartNoteReplyToMessage}
                    onJumpToQuotedMessage={onJumpToQuotedMessage}
                    onOpenMediaPreview={onOpenMediaPreview}
                    onOpenNewChatWithPhone={onOpenNewChatWithPhone}
                    onCopyToast={onCopyToast}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
