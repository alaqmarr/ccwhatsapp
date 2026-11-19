"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import {
  BarChart3,
  CheckSquare,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { ClassicConceptsMark, WhatsAppLogoIcon } from "@cc/ui";
import type { StaffOption, TeamOption } from "@/lib/inbox-server-data";
import { useInboxStore } from "@/lib/inbox-store";

export function InboxSidebarHeader({
  waitingThreadsCount,
  acrioThreadsCount,
  leadAssignedCount,
  refreshingThreads,
  isAdminOrSuperadmin,
  staffList,
  teams,
  onRefreshThreads,
  onOpenNewChat,
}: {
  waitingThreadsCount: number;
  acrioThreadsCount: number;
  leadAssignedCount: number;
  refreshingThreads: boolean;
  isAdminOrSuperadmin: boolean;
  staffList: StaffOption[];
  teams: TeamOption[];
  onRefreshThreads: () => void;
  onOpenNewChat: () => void;
}) {
  const quickFilter = useInboxStore((s) => s.quickFilter);
  const setQuickFilter = useInboxStore((s) => s.setQuickFilter);
  const teamFilter = useInboxStore((s) => s.teamFilter);
  const setTeamFilter = useInboxStore((s) => s.setTeamFilter);
  const staffFilter = useInboxStore((s) => s.staffFilter);
  const setStaffFilter = useInboxStore((s) => s.setStaffFilter);
  const searchQuery = useInboxStore((s) => s.searchQuery);
  const setSearchQuery = useInboxStore((s) => s.setSearchQuery);
  const bulkMode = useInboxStore((s) => s.bulkMode);
  const setBulkMode = useInboxStore((s) => s.setBulkMode);
  const setSelectedThreadIds = useInboxStore((s) => s.setSelectedThreadIds);
  const activeFilterButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const el = activeFilterButtonRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [quickFilter]);

  return (
    <>
      <div className="hidden lg:flex min-h-[56px] px-3.5 py-1.5 bg-[#f0f2f5] border-b border-[#d1d7db] items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <ClassicConceptsMark size={26} />
          <div className="min-w-0">
            <h1 className="font-display text-[17px] font-bold tracking-tight text-[#111b21] truncate flex items-center gap-1.5">
              <span className="truncate">Customer Chats</span>
              {waitingThreadsCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-red-600 text-white font-sans text-[10px] font-bold uppercase tracking-[0.04em] tabular-nums shrink-0">
                  {waitingThreadsCount} waiting
                </span>
              )}
            </h1>
            <p className="text-[11.5px] font-medium text-[#667781] truncate">
              System (ACRIO) • Handoff to Sales Team
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onRefreshThreads}
            title="Refresh chats"
            className="p-2 rounded-full hover:bg-[#e9edef] text-[#54656f] cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshingThreads ? "animate-spin" : ""}`}
            />
          </button>
          <Link
            href="/dashboard/analytics"
            title="Assignment & First-Response Analytics"
            className="p-2 rounded-full hover:bg-[#e9edef] text-[#54656f]"
          >
            <BarChart3 className="w-4 h-4" />
          </Link>
          <Link
            href="/dashboard/teams"
            title="Teams & Escalation Flow"
            className="p-2 rounded-full hover:bg-[#e9edef] text-[#54656f]"
          >
            <Users className="w-4 h-4" />
          </Link>
          <button
            type="button"
            onClick={onOpenNewChat}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer whitespace-nowrap"
          >
            <WhatsAppLogoIcon size={13} />
            <span>New Chat</span>
          </button>
        </div>
      </div>

      <div className="px-2.5 sm:px-3 py-2 bg-white border-b border-[#e9edef] space-y-1.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-[#54656f] absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search customer, phone, or product"
              className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-[#f0f2f5] text-xs text-[#111b21] placeholder:text-[#667781] focus:outline-none focus:ring-1 focus:ring-[#00a884]"
            />
          </div>
          <button
            type="button"
            onClick={onRefreshThreads}
            title="Refresh chats"
            className="lg:hidden p-1.5 rounded-lg bg-[#f0f2f5] hover:bg-[#e9edef] text-[#54656f] cursor-pointer shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshingThreads ? "animate-spin" : ""}`}
            />
          </button>
          <button
            type="button"
            onClick={onOpenNewChat}
            className="lg:hidden inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <WhatsAppLogoIcon size={12} />
            <span>New</span>
          </button>
        </div>

        {(isAdminOrSuperadmin || teams.length > 0) && (
          <div className="grid grid-cols-2 gap-1.5">
            {isAdminOrSuperadmin && (
              <select
                value={staffFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setStaffFilter(val);
                  if (val !== "ALL" && quickFilter === "MINE") {
                    setQuickFilter("ACTIVE");
                  }
                }}
                title="Filter active chats by assigned staff or collaborator"
                className={`w-full px-2 py-1.5 rounded-lg bg-[#e7fce3] text-[11px] font-semibold text-[#008069] border border-[#b7ebaf] truncate focus:outline-none ${
                  teams.length === 0 ? "col-span-2" : ""
                }`}
              >
                <option value="ALL">All Staff</option>
                <option value="ACRIO">ACRIO</option>
                {staffList.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            )}

            {teams.length > 0 && (
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                title="Filter by Team"
                className={`w-full px-2 py-1.5 rounded-lg bg-[#f0f2f5] text-[11px] font-medium text-[#3b4a54] border-0 truncate focus:outline-none ${
                  !isAdminOrSuperadmin ? "col-span-2" : ""
                }`}
              >
                <option value="ALL">All Teams</option>
                {teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {(
            [
              { key: "MINE", label: "Mine" },
              { key: "ACTIVE", label: "Active" },
              { key: "ALL", label: "All" },
              {
                key: "LEAD_ASSIGNED",
                label:
                  leadAssignedCount > 0
                    ? `Lead Assigned (${leadAssignedCount})`
                    : "Lead Assigned",
              },
              {
                key: "WAITING",
                label:
                  waitingThreadsCount > 0
                    ? `Needs Staff (${waitingThreadsCount})`
                    : "Needs Staff",
              },
              {
                key: "ACRIO",
                label:
                  acrioThreadsCount > 0 ? `System (${acrioThreadsCount})` : "System",
              },
              { key: "UNREAD", label: "Unread" },
              { key: "RESOLVED", label: "Resolved" },
            ] as const
          ).map((pill) => {
            const active = quickFilter === pill.key;
            return (
              <button
                key={pill.key}
                ref={active ? activeFilterButtonRef : undefined}
                type="button"
                onClick={() => setQuickFilter(pill.key)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  active
                    ? "bg-[#e7fce3] text-[#008069]"
                    : "bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]"
                }`}
              >
                {pill.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setBulkMode((prev) => !prev);
              setSelectedThreadIds([]);
            }}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap cursor-pointer inline-flex items-center gap-1 transition-colors ${
              bulkMode
                ? "bg-neutral-900 text-white"
                : "bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]"
            }`}
          >
            <CheckSquare className="w-3 h-3" />
            <span>{bulkMode ? "Done" : "Bulk"}</span>
          </button>
        </div>
      </div>
    </>
  );
}
