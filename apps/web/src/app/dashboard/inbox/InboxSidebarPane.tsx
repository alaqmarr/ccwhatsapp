"use client";

import React, { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import type { InboxMobilePane } from "@/lib/inbox-store";
import type {
  ConversationSummary,
  StaffOption,
  TeamOption,
} from "@/lib/inbox-server-data";
import {
  dismissChromeNotificationBanner,
  dispatchChromeNotification,
  getBrowserNotificationPreferences,
  requestChromeNotificationPermission,
} from "@/lib/browser-notifications";
import { InboxSidebarHeader } from "./InboxSidebarHeader";
import { ThreadListPane } from "./ThreadListPane";

export function InboxSidebarPane({
  mobilePane,
  waitingThreadsCount,
  acrioThreadsCount,
  leadAssignedCount,
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
  isMyLeadsSelected,
  myLeadsCount,
  myLeadsPendingCount,
  myLeadsPreview,
  myLeadsLatestAt,
  onSelectMyLeads,
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
  leadAssignedCount: number;
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
  isMyLeadsSelected: boolean;
  myLeadsCount: number;
  myLeadsPendingCount: number;
  myLeadsPreview: string;
  myLeadsLatestAt: string | null;
  onSelectMyLeads: () => void;
  onPrefetch: (convId: string) => void;
  onSelect: (convId: string) => void;
  onToggleBulk: (convId: string, ev?: React.MouseEvent) => void;
  bulkBusy: boolean;
  onBulkAssignToMe: () => void;
  onBulkResolveSelected: () => void;
}) {
  const [showNotifPrompt, setShowNotifPrompt] = useState(false);

  useEffect(() => {
    const sync = () => {
      const prefs = getBrowserNotificationPreferences();
      setShowNotifPrompt(
        prefs.supported && prefs.permission === "default" && !prefs.bannerDismissed
      );
    };
    sync();
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);

  return (
    <div
      className={`${
        mobilePane === "LIST" ? "flex w-full min-w-0" : "hidden"
      } lg:flex lg:w-[340px] xl:w-[375px] shrink-0 border-r border-[#d1d7db] flex-col bg-white relative`}
    >
      <InboxSidebarHeader
        waitingThreadsCount={waitingThreadsCount}
        acrioThreadsCount={acrioThreadsCount}
        leadAssignedCount={leadAssignedCount}
        refreshingThreads={refreshingThreads}
        isAdminOrSuperadmin={isAdminOrSuperadmin}
        staffList={staffList}
        teams={teams}
        onRefreshThreads={onRefreshThreads}
        onOpenNewChat={onOpenNewChat}
      />

      {showNotifPrompt && (
        <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-6 h-6 rounded-full bg-[#00a884] text-white flex items-center justify-center shrink-0">
              <Bell className="w-3.5 h-3.5" />
            </span>
            <span className="text-emerald-950 font-medium truncate">
              Get Chrome notifications for new messages
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={async () => {
                const res = await requestChromeNotificationPermission();
                setShowNotifPrompt(false);
                if (res === "granted") {
                  await dispatchChromeNotification({
                    title: "Classic Concepts WhatsApp",
                    body: "Chrome notifications are active for new customer messages.",
                    tag: "cc-notif-enabled",
                    dedupKey: `enabled:${Date.now()}`,
                  });
                }
              }}
              className="px-2.5 py-1 rounded bg-[#00a884] hover:bg-[#008f6f] text-white text-[11px] font-semibold cursor-pointer"
            >
              Turn on
            </button>
            <button
              type="button"
              onClick={() => {
                dismissChromeNotificationBanner();
                setShowNotifPrompt(false);
              }}
              aria-label="Dismiss notification prompt"
              className="p-1 rounded text-emerald-800 hover:bg-emerald-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

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
        isMyLeadsSelected={isMyLeadsSelected}
        myLeadsCount={myLeadsCount}
        myLeadsPendingCount={myLeadsPendingCount}
        myLeadsPreview={myLeadsPreview}
        myLeadsLatestAt={myLeadsLatestAt}
        onSelectMyLeads={onSelectMyLeads}
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
