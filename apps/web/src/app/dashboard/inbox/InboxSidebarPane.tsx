"use client";

import React from "react";
import type { InboxMobilePane } from "@/lib/inbox-store";
import type {
  ConversationSummary,
  StaffOption,
  TeamOption,
} from "@/lib/inbox-server-data";
import { InboxSidebarHeader } from "./InboxSidebarHeader";
import { ThreadListPane } from "./ThreadListPane";

export function InboxSidebarPane({
  mobilePane,
  waitingThreadsCount,
  acrioThreadsCount,
  refreshingThreads,
  isAdminOrSuperadmin,
  staffList,
  teams,
  onRefreshThreads,
  onOpenNewChat,
  filteredThreads,
  selectedId,
  bulkMode,
  selectedThreadIds,
  callbackConvIds,
  unreadMentionConvIds,
  nowMs,
  serverNowMs,
  threadsError,
  onPrefetch,
  onSelect,
  onToggleBulk,
  bulkBusy,
  onBulkAssignToMe,
  onBulkResolveSelected,
}: {
  mobilePane: InboxMobilePane;
  waitingThreadsCount: number;
  acrioThreadsCount: number;
  refreshingThreads: boolean;
  isAdminOrSuperadmin: boolean;
  staffList: StaffOption[];
  teams: TeamOption[];
  onRefreshThreads: () => void;
  onOpenNewChat: () => void;
  filteredThreads: ConversationSummary[];
  selectedId: string | null;
  bulkMode: boolean;
  selectedThreadIds: string[];
  callbackConvIds: string[];
  unreadMentionConvIds: string[];
  nowMs: number;
  serverNowMs: number;
  threadsError: string;
  onPrefetch: (convId: string) => void;
  onSelect: (convId: string) => void;
  onToggleBulk: (convId: string, ev?: React.MouseEvent) => void;
  bulkBusy: boolean;
  onBulkAssignToMe: () => void;
  onBulkResolveSelected: () => void;
}) {
  return (
    <div
      className={`${
        mobilePane === "LIST" ? "flex w-full min-w-0" : "hidden"
      } lg:flex lg:w-[340px] xl:w-[375px] shrink-0 border-r border-[#d1d7db] flex-col bg-white relative`}
    >
      <InboxSidebarHeader
        waitingThreadsCount={waitingThreadsCount}
        acrioThreadsCount={acrioThreadsCount}
        refreshingThreads={refreshingThreads}
        isAdminOrSuperadmin={isAdminOrSuperadmin}
        staffList={staffList}
        teams={teams}
        onRefreshThreads={onRefreshThreads}
        onOpenNewChat={onOpenNewChat}
      />

      <ThreadListPane
        filteredThreads={filteredThreads}
        selectedId={selectedId}
        bulkMode={bulkMode}
        selectedThreadIds={selectedThreadIds}
        callbackConvIds={callbackConvIds}
        unreadMentionConvIds={unreadMentionConvIds}
        nowMs={nowMs}
        serverNowMs={serverNowMs}
        threadsError={threadsError}
        refreshingThreads={refreshingThreads}
        onRetryRefresh={onRefreshThreads}
        onPrefetch={onPrefetch}
        onSelect={onSelect}
        onToggleBulk={onToggleBulk}
      />

      {bulkMode && selectedThreadIds.length > 0 && (
        <div className="border-t border-[#d1d7db] bg-neutral-900 text-white px-3 py-2.5 flex items-center justify-between gap-2 shrink-0">
          <span className="text-xs font-semibold">
            {selectedThreadIds.length} selected
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={onBulkAssignToMe}
              className="px-2.5 py-1 rounded bg-white/15 hover:bg-white/25 text-[11px] font-medium cursor-pointer disabled:opacity-50"
            >
              Assign to Me
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={onBulkResolveSelected}
              className="px-2.5 py-1 rounded bg-[#00a884] hover:bg-[#008f6f] text-[11px] font-semibold cursor-pointer disabled:opacity-50"
            >
              Resolve
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
