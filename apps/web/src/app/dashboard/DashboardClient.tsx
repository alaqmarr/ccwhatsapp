"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Mail, MessageSquare, RefreshCw } from "lucide-react";
import { DashboardKpiStrip } from "./components/DashboardKpiStrip";
import { DashboardLeadsAndCallbacks } from "./components/DashboardLeadsAndCallbacks";
import { DashboardEnquiriesAndTeam } from "./components/DashboardEnquiriesAndTeam";
import { DashboardRightRail } from "./components/DashboardRightRail";
import { useDashboardQuery } from "./components/useDashboardQuery";
import { ago, type DashboardData, type LeadTabKey } from "./components/types";

export function DashboardClient({
  initialData,
}: {
  initialData?: DashboardData;
}) {
  const { data, error, isFetching, refetch, invalidateDashboard } =
    useDashboardQuery(initialData);

  const [leadTab, setLeadTab] = useState<LeadTabKey>(() => {
    if (!initialData) return "ALL";
    if (initialData.openLeads.some((l) => l.isMine)) return "MINE";
    if (initialData.openLeads.length > 0) return "ALL";
    return "RECENT";
  });
  const [didAutoSelectTab, setDidAutoSelectTab] = useState(Boolean(initialData));
  const [busyCb, setBusyCb] = useState<string | null>(null);

  useEffect(() => {
    if (!data || didAutoSelectTab) return;
    setDidAutoSelectTab(true);
    const mineCount = data.openLeads.filter((l) => l.isMine).length;
    if (mineCount > 0) {
      setLeadTab("MINE");
    } else if (data.openLeads.length > 0) {
      setLeadTab("ALL");
    } else {
      setLeadTab("RECENT");
    }
  }, [data, didAutoSelectTab]);

  async function markCallbackDone(id: string) {
    setBusyCb(id);
    try {
      await fetch("/api/callback-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "DONE" }),
      });
      await invalidateDashboard();
    } finally {
      setBusyCb(null);
    }
  }

  async function markNotificationsRead() {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await invalidateDashboard();
  }

  const tabCounts = useMemo<Record<LeadTabKey, number>>(() => {
    if (!data) return { MINE: 0, HOT: 0, WAITING: 0, ALL: 0, RECENT: 0 };
    const all = data.openLeads;
    return {
      MINE: all.filter((l) => l.isMine).length,
      HOT: all.filter((l) => l.heat === "HOT").length,
      WAITING: all.filter((l) => l.waitingSeconds !== null).length,
      ALL: all.length,
      RECENT: (data.recentChats || []).length,
    };
  }, [data]);

  const leads = useMemo(() => {
    if (!data) return [];
    const all = data.openLeads;
    if (leadTab === "MINE") return all.filter((l) => l.isMine);
    if (leadTab === "HOT") return all.filter((l) => l.heat === "HOT");
    if (leadTab === "WAITING") return all.filter((l) => l.waitingSeconds !== null);
    if (leadTab === "RECENT") return data.recentChats || [];
    return all;
  }, [data, leadTab]);

  if (!data) {
    return (
      <div className="p-6 text-sm text-slate-500">
        {error ? <span className="text-rose-600">{error}</span> : "Loading your dashboard..."}
      </div>
    );
  }

  const { snapshot } = data;
  const recentEnquiries = data.recentEnquiries || [];
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="w-full px-4 sm:px-5 py-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-lg md:text-xl font-bold text-slate-900">
            {greeting}, {data.viewer.name.split(" ")[0]}
          </h1>
          <p className="text-xs text-slate-500">
            Live workspace overview • Updated {ago(data.generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </button>
          <Link
            href="/dashboard/enquiries"
            className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
          >
            <Mail className="w-3.5 h-3.5 text-[#008069]" /> Website enquiries
            {(snapshot.websiteEnquiriesNew ?? 0) > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                {snapshot.websiteEnquiriesNew}
              </span>
            )}
          </Link>
          <Link
            href="/dashboard/inbox"
            className="px-3 py-1.5 rounded-lg bg-[#00a884] text-white text-xs font-semibold hover:bg-[#008f6f] inline-flex items-center gap-1.5"
          >
            <MessageSquare className="w-3.5 h-3.5" /> Open chats
          </Link>
        </div>
      </div>

      <DashboardKpiStrip data={data} />

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4">
          <DashboardLeadsAndCallbacks
            callRequests={data.callRequests}
            busyCb={busyCb}
            onMarkCallbackDone={(id) => void markCallbackDone(id)}
            leads={leads}
            leadTab={leadTab}
            onChangeLeadTab={setLeadTab}
            tabCounts={tabCounts}
          />
          <DashboardEnquiriesAndTeam
            recentEnquiries={recentEnquiries}
            websiteEnquiriesTotal={snapshot.websiteEnquiriesTotal}
            canSeeTeam={data.canSeeTeam}
            team={data.team}
            viewerId={data.viewer.id}
          />
        </div>

        <DashboardRightRail
          notifications={data.notifications}
          unreadNotifications={data.unreadNotifications}
          onMarkNotificationsRead={() => void markNotificationsRead()}
          inboundLast7Days={data.inboundLast7Days}
          leadsByCategory={data.leadsByCategory}
        />
      </div>
    </div>
  );
}
