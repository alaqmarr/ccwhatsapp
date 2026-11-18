"use client";

import React, { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AtSign, Check, Clock, PhoneCall, Sparkles } from "lucide-react";
import {
  ElementErrorState,
  WhatsAppLogoIcon,
  WhatsAppMessageTicks,
  formatThreadTimeIst,
  stripWhatsAppFormatting,
} from "@cc/ui";
import type { ConversationSummary } from "@/lib/inbox-server-data";
import { formatWaitingDuration, getInitials } from "./inbox-helpers";

interface ThreadRowProps {
  t: ConversationSummary;
  active: boolean;
  bulkMode: boolean;
  isBulkChecked: boolean;
  hasThreadCallback: boolean;
  hasUnreadMention: boolean;
  nowMs: number;
  serverNowMs: number;
  onPrefetch: (id: string) => void;
  onSelect: (id: string) => void;
  onToggleBulk: (id: string, ev?: React.MouseEvent) => void;
}

const ThreadRow = React.memo(function ThreadRow({
  t,
  active,
  bulkMode,
  isBulkChecked,
  hasThreadCallback,
  hasUnreadMention,
  nowMs,
  serverNowMs,
  onPrefetch,
  onSelect,
  onToggleBulk,
}: ThreadRowProps) {
  const isAcrio = t.assignedStaffId === "ACRIO";
  const waitObj =
    t.status !== "RESOLVED" && !isAcrio
      ? formatWaitingDuration(t.waitingSince, nowMs)
      : null;
  const isOverdue = waitObj && waitObj.minutes >= 5;
  const leftBorderClass = hasThreadCallback
    ? "border-l-[3.5px] border-l-rose-500"
    : hasUnreadMention
    ? "border-l-[3.5px] border-l-violet-500"
    : isOverdue
    ? "border-l-[3.5px] border-l-red-500"
    : waitObj
    ? "border-l-[3.5px] border-l-amber-500"
    : active
    ? "border-l-[3.5px] border-l-[#00a884]"
    : "border-l-[3.5px] border-l-transparent";

  return (
    <button
      type="button"
      onMouseEnter={() => onPrefetch(t.id)}
      onPointerDown={() => onPrefetch(t.id)}
      onClick={() => (bulkMode ? onToggleBulk(t.id) : onSelect(t.id))}
      className={`w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors cursor-pointer border-b border-[#f0f2f5] ${leftBorderClass} ${
        active ? "bg-[#f0f2f5]" : "hover:bg-[#f5f6f6]"
      }`}
    >
      {bulkMode && (
        <span
          onClick={(ev) => onToggleBulk(t.id, ev)}
          className={`mt-3 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
            isBulkChecked
              ? "bg-[#00a884] border-[#00a884] text-white"
              : "bg-white border-neutral-400"
          }`}
        >
          {isBulkChecked && <Check className="w-3 h-3" />}
        </span>
      )}

      <div
        className={`w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-xs font-semibold relative ${
          t.status === "RESOLVED"
            ? "bg-neutral-200 text-neutral-600"
            : isOverdue
            ? "bg-red-100 text-red-800 ring-2 ring-red-300"
            : isAcrio
            ? "bg-[#eef2ff] text-[#3730a3]"
            : "bg-[#dfe5e7] text-[#3b4a54]"
        }`}
      >
        {getInitials(t.customerName)}
        <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#25d366] text-white flex items-center justify-center ring-2 ring-white">
          <WhatsAppLogoIcon size={9} />
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14px] font-semibold tracking-[-0.015em] text-[#111b21] truncate">
            {t.customerName}
          </span>
          <span
            className={`text-[11px] tabular-nums shrink-0 ${
              t.unreadCount > 0
                ? "text-[#00a884] font-semibold"
                : "text-[#667781] font-medium"
            }`}
          >
            {formatThreadTimeIst(t.lastMessageAt, serverNowMs)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-[12.5px] leading-snug text-[#54656f] truncate flex items-center gap-1 min-w-0">
            {t.lastMessageDirection === "OUTBOUND" && (
              <WhatsAppMessageTicks
                status={t.lastMessageStatus || "SENT"}
                showLabel={false}
                size={13}
              />
            )}
            <span className="truncate">
              {stripWhatsAppFormatting(t.lastMessagePreview) || t.customerPhone}
            </span>
          </p>
          {t.unreadCount > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#25d366] text-white text-[10px] font-bold tabular-nums flex items-center justify-center shrink-0">
              {t.unreadCount}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          {hasThreadCallback && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200 font-semibold inline-flex items-center gap-0.5">
              <PhoneCall className="w-2.5 h-2.5" />
              <span>Callback</span>
            </span>
          )}
          {hasUnreadMention && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 border border-violet-200 font-semibold inline-flex items-center gap-0.5">
              <AtSign className="w-2.5 h-2.5" />
              <span>You</span>
            </span>
          )}
          {t.status === "RESOLVED" ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">
              Resolved
            </span>
          ) : isAcrio ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 font-medium inline-flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5" />
              <span>System (ACRIO)</span>
            </span>
          ) : (
            <>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  t.escalationLevel === "P2"
                    ? "bg-red-600 text-white"
                    : t.escalationLevel === "P1"
                    ? "bg-amber-500 text-white"
                    : "bg-[#e9edef] text-[#3b4a54]"
                }`}
              >
                {t.escalationLevel || "P0"}
              </span>

              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 font-medium truncate max-w-[105px]">
                {t.assignedTeamName || "Sales Team"}
              </span>

              {t.assignedStaffName && (
                <span className="text-[10px] text-[#54656f] truncate max-w-[85px]">
                  • {t.assignedStaffName.split(" ")[0]}
                </span>
              )}

              {t.collaborators && t.collaborators.length > 0 && (
                <span
                  title={t.collaborators.map((c) => c.staffName).join(", ")}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 font-medium"
                >
                  +{t.collaborators.length}
                </span>
              )}

              {waitObj && (
                <span
                  suppressHydrationWarning
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-0.5 ${
                    waitObj.minutes >= 8
                      ? "bg-red-100 text-red-800"
                      : waitObj.minutes >= 3
                      ? "bg-amber-100 text-amber-900"
                      : "bg-emerald-50 text-emerald-800"
                  }`}
                >
                  <Clock className="w-2.5 h-2.5" />
                  <span suppressHydrationWarning>Wait {waitObj.text}</span>
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </button>
  );
});

export function ThreadListPane({
  filteredThreads,
  selectedId,
  bulkMode,
  selectedThreadIds,
  callbackConvIds,
  unreadMentionConvIds,
  nowMs,
  serverNowMs,
  threadsError,
  refreshingThreads,
  onRetryRefresh,
  onPrefetch,
  onSelect,
  onToggleBulk,
}: {
  filteredThreads: ConversationSummary[];
  selectedId: string | null;
  bulkMode: boolean;
  selectedThreadIds: string[];
  callbackConvIds: string[];
  unreadMentionConvIds: string[];
  nowMs: number;
  serverNowMs: number;
  threadsError: string;
  refreshingThreads: boolean;
  onRetryRefresh: () => void;
  onPrefetch: (id: string) => void;
  onSelect: (id: string) => void;
  onToggleBulk: (id: string, ev?: React.MouseEvent) => void;
}) {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const selectedThreadIdSet = React.useMemo(
    () => new Set(selectedThreadIds),
    [selectedThreadIds]
  );
  const callbackSet = React.useMemo(
    () => new Set(callbackConvIds),
    [callbackConvIds]
  );
  const mentionSet = React.useMemo(
    () => new Set(unreadMentionConvIds),
    [unreadMentionConvIds]
  );

  const rowVirtualizer = useVirtualizer({
    count: filteredThreads.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 86,
    overscan: 8,
    getItemKey: (idx) => filteredThreads[idx]?.id ?? idx,
  });

  return (
    <div
      ref={scrollParentRef}
      className="flex-1 overflow-y-auto min-h-0"
    >
      {threadsError && (
        <div className="p-3">
          <ElementErrorState
            compact
            title="Could not refresh chats"
            message={threadsError}
            onRetry={onRetryRefresh}
            retrying={refreshingThreads}
          />
        </div>
      )}
      {filteredThreads.length === 0 ? (
        <div className="p-6 text-center text-xs text-[#667781]">
          No chats match this filter.
        </div>
      ) : (
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const t = filteredThreads[virtualRow.index];
            if (!t) return null;
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
              >
                <ThreadRow
                  t={t}
                  active={t.id === selectedId}
                  bulkMode={bulkMode}
                  isBulkChecked={selectedThreadIdSet.has(t.id)}
                  hasThreadCallback={callbackSet.has(t.id)}
                  hasUnreadMention={mentionSet.has(t.id)}
                  nowMs={nowMs}
                  serverNowMs={serverNowMs}
                  onPrefetch={onPrefetch}
                  onSelect={onSelect}
                  onToggleBulk={onToggleBulk}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
