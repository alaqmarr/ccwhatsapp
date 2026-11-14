"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  IndianRupee,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import {
  CardListSkeleton,
  ElementErrorState,
  StatCardsSkeleton,
  TableRowsSkeleton,
  WHATSAPP_PUBLIC_ORIGIN,
  WhatsAppLogoIcon,
  WhatsAppMessageTicks,
} from "@cc/ui";

interface AnalyticsResponse {
  ok: boolean;
  range: string;
  teamFilter: string;
  pricingMode: "dev_actual_and_margin" | "client_set_pricing";
  generatedAt: string;
  teams: { id: string; name: string }[];
  kpis: {
    totalConversations: number;
    openConversations: number;
    assignedConversations: number;
    resolvedConversations: number;
    resolutionRatePct: number;
    acrioLiveChatsCount: number;
    waitingNowCount: number;
    waitingP0Count: number;
    waitingP1Count: number;
    waitingP2Count: number;
    humanAssignmentsCount: number;
    humanRespondedCount: number;
    humanResponseRatePct: number;
    avgHumanFirstResponseSeconds: number | null;
    medianHumanFirstResponseSeconds: number | null;
    fastestHumanFirstResponseSeconds: number | null;
    slowestHumanFirstResponseSeconds: number | null;
    slaUnder5MinPct: number;
    autoEscalationsCount: number;
    escalationRatePct: number;
    acrioAssignmentsCount: number;
    acrioAutonomousChats: number;
    acrioAutonomousRatePct: number;
    acrioAvgResponseSeconds: number | null;
    inboundMessagesCount: number;
    outboundMessagesCount: number;
    freeStaffRepliesCount: number;
    acrioRepliesCount: number;
    templateMessagesCount: number;
    internalNotesCount: number;
    outboundDeliveryRatePct: number;
    outboundReadRatePct: number;
    totalCustomers: number;
    optedInCustomers: number;
    optedOutCustomers: number;
    ordersCount: number;
    ordersRevenueInr: number;
    paidOrdersRevenueInr: number;
    clientBilledInr: number;
    actualMetaCostInr?: number;
    netMarginInr?: number;
  };
  tickFunnel: {
    sending: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    totalOutbound: number;
    deliveryRatePct: number;
    readRatePct: number;
  };
  dailySeries: {
    date: string;
    label: string;
    inboundMessages: number;
    outboundMessages: number;
    newConversations: number;
    resolvedConversations: number;
    humanAssignments: number;
    avgFirstResponseSeconds: number | null;
  }[];
  hourlyIst: {
    hour: number;
    label: string;
    inboundCount: number;
    outboundCount: number;
  }[];
  agentLeaderboard: {
    staffId: string;
    staffName: string;
    role: string;
    department: string;
    isSystem: boolean;
    assignmentsCount: number;
    respondedCount: number;
    responseRatePct: number;
    avgFirstResponseSeconds: number | null;
    medianFirstResponseSeconds: number | null;
    fastestFirstResponseSeconds: number | null;
    slowestFirstResponseSeconds: number | null;
    under5MinPct: number;
    escalatedCount: number;
    reassignedCount: number;
    activeOpenChats: number;
    outboundRepliesSent: number;
    resolvedCount: number;
  }[];
  teamBreakdown: {
    teamId: string;
    teamName: string;
    brandScope: string;
    p0WaitMinutes: number;
    p1WaitMinutes: number;
    assignmentsCount: number;
    respondedCount: number;
    avgFirstResponseSeconds: number | null;
    p0Count: number;
    p1Count: number;
    p2Count: number;
    escalatedCount: number;
    openChatsCount: number;
    currentlyWaitingCount: number;
  }[];
  categories: { name: string; count: number }[];
  priorities: { name: string; count: number }[];
  segments: { name: string; count: number }[];
  billingByCategory: Record<
    string,
    {
      count: number;
      clientBilledInr: number;
      actualMetaCostInr?: number;
      marginInr?: number;
    }
  >;
  broadcastSummary: {
    campaignsCount: number;
    totalRecipients: number;
    sent: number;
    delivered: number;
    read: number;
    skipped: number;
    failed: number;
  };
  topTemplates: {
    id: string;
    name: string;
    category: string;
    approvalStatus: string;
    qualityScore: string;
    sentCount: number;
  }[];
  topLinks: {
    id: string;
    code: string;
    title: string;
    targetUrl: string;
    linkType: string;
    clicksCount: number;
    lastClickedAt: string | null;
  }[];
  assignmentLogs: {
    id: string;
    conversationId: string;
    customerPhone: string;
    customerName: string;
    fromStaffName: string | null;
    fromTeamName: string | null;
    toStaffId: string | null;
    toStaffName: string;
    toTeamId: string | null;
    toTeamName: string;
    escalationLevel: string;
    assignmentSource: string;
    assignedByName: string;
    reason: string;
    assignedAt: string;
    firstResponseAt: string | null;
    firstResponseSeconds: number | null;
    endedAt: string | null;
    outcome: string;
  }[];
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "None";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
  }
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatDateTimeIst(iso: string | null | undefined): string {
  if (!iso) return "Pending";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSourceLabel(src: string): string {
  switch (src) {
    case "INITIAL_SYSTEM":
      return "Customer Started (System)";
    case "ACRIO_HANDOFF":
      return "ACRIO Handoff";
    case "SMART_ASSIGN":
      return "Smart Team Assign";
    case "MANUAL_ASSIGN":
      return "Manual Assign";
    case "STAFF_TAKEOVER":
      return "Staff Takeover";
    case "AUTO_ESCALATION":
      return "Auto Escalated (Wait Timeout)";
    case "REOPEN":
      return "Reopened Chat";
    case "OUTBOUND_START":
      return "Staff Outbound Start";
    case "RETURN_TO_SYSTEM":
      return "Returned to System";
    default:
      return src;
  }
}

export default function AnalyticsDashboardPage() {
  const [range, setRange] = useState<"today" | "7d" | "30d" | "90d" | "all">(
    "30d"
  );
  const [teamFilter, setTeamFilter] = useState<string>("ALL");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Assignment audit log search & outcome filter
  const [logSearch, setLogSearch] = useState<string>("");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("ALL");

  const loadAnalytics = useCallback(
    async (manual = false) => {
      if (manual) setRefreshing(true);
      else setLoading(true);
      setError("");

      try {
        const res = await fetch(
          `/api/analytics?range=${encodeURIComponent(
            range
          )}&teamId=${encodeURIComponent(teamFilter)}`,
          { cache: "no-store" }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          setError(json.error || "Could not load analytics report.");
          return;
        }
        setData(json as AnalyticsResponse);
      } catch {
        setError("Network error while loading analytics. Click Try Again.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [range, teamFilter]
  );

  useEffect(() => {
    void loadAnalytics(false);
  }, [loadAnalytics]);

  const filteredLogs = useMemo(() => {
    const list = data?.assignmentLogs || [];
    return list.filter((item) => {
      if (outcomeFilter !== "ALL") {
        if (outcomeFilter === "SYSTEM" && item.toStaffId !== "ACRIO") {
          return false;
        }
        if (outcomeFilter === "HUMAN" && item.toStaffId === "ACRIO") {
          return false;
        }
        if (
          outcomeFilter !== "SYSTEM" &&
          outcomeFilter !== "HUMAN" &&
          item.outcome !== outcomeFilter
        ) {
          return false;
        }
      }
      if (logSearch.trim()) {
        const q = logSearch.toLowerCase();
        const hay = `${item.customerName} ${item.customerPhone} ${item.toStaffName} ${item.toTeamName} ${item.assignedByName} ${item.reason} ${item.escalationLevel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, logSearch, outcomeFilter]);

  function handleExportCsv() {
    if (!data) return;
    const rows: string[][] = [
      [
        "Assignment ID",
        "Customer Name",
        "Customer Phone",
        "Assigned To",
        "Team",
        "Tier",
        "Assignment Source",
        "Assigned By",
        "Assigned At (ISO)",
        "First Response At (ISO)",
        "First Response Seconds",
        "First Response Formatted",
        "Outcome",
      ],
      ...filteredLogs.map((l) => [
        l.id,
        l.customerName,
        l.customerPhone,
        l.toStaffId === "ACRIO" ? "System (ACRIO)" : l.toStaffName,
        l.toTeamName,
        l.escalationLevel,
        formatSourceLabel(l.assignmentSource),
        l.assignedByName,
        l.assignedAt,
        l.firstResponseAt || "",
        l.firstResponseSeconds !== null ? String(l.firstResponseSeconds) : "",
        formatDuration(l.firstResponseSeconds),
        l.outcome,
      ]),
    ];

    const csv = rows
      .map((r) =>
        r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ccwhatsapp_assignments_analytics_${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const maxDailyMsg = useMemo(() => {
    if (!data || data.dailySeries.length === 0) return 1;
    return Math.max(
      1,
      ...data.dailySeries.map((d) => d.inboundMessages + d.outboundMessages)
    );
  }, [data]);

  const maxHourlyCount = useMemo(() => {
    if (!data || data.hourlyIst.length === 0) return 1;
    return Math.max(
      1,
      ...data.hourlyIst.map((h) => Math.max(h.inboundCount, h.outboundCount))
    );
  }, [data]);

  const isDev = data?.pricingMode === "dev_actual_and_margin";

  return (
    <div className="w-full px-6 py-5 space-y-6 bg-neutral-50 text-neutral-900">
      {/* Top Header & Filter Controls */}
      <div className="bg-white rounded-lg border border-neutral-200 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-[#e7fce3] text-[#008069] flex items-center justify-center shrink-0">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              <span>WhatsApp Analytics, Assignments & First-Response SLA</span>
            </h1>
            <p className="text-[13px] leading-relaxed text-slate-500 mt-0.5">
              Tracks exact assignment times, agent first-response speed, P0/P1/P2
              escalations, ACRIO automation, message ticks, and revenue.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Date Range Filter */}
          <div className="inline-flex rounded-md bg-neutral-100 p-0.5 border border-neutral-200">
            {(
              [
                { id: "today", label: "Today" },
                { id: "7d", label: "7 Days" },
                { id: "30d", label: "30 Days" },
                { id: "90d", label: "90 Days" },
                { id: "all", label: "All Time" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setRange(opt.id)}
                className={`px-2.5 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors ${
                  range === opt.id
                    ? "bg-white text-neutral-900 shadow-2xs"
                    : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Team Filter */}
          {data && data.teams.length > 0 && (
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="px-3 py-1.5 rounded-md border border-neutral-300 bg-white text-xs font-medium text-neutral-800"
            >
              <option value="ALL">All Teams & System</option>
              {data.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => loadAnalytics(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-800 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!data}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Error Fallback with Retry */}
      {error && (
        <ElementErrorState
          title="Could not load analytics data"
          message={error}
          onRetry={() => loadAnalytics(true)}
          retrying={loading || refreshing}
        />
      )}

      {/* Loading Skeletons */}
      {loading && !data ? (
        <div className="space-y-6">
          <StatCardsSkeleton count={4} />
          <StatCardsSkeleton count={4} />
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-7">
              <CardListSkeleton rows={4} />
            </div>
            <div className="xl:col-span-5">
              <CardListSkeleton rows={4} />
            </div>
          </div>
          <TableRowsSkeleton rows={6} cols={6} />
        </div>
      ) : data ? (
        <>
          {/* ROW 1: 8 Executive KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* 1. Avg Human First Response */}
            <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                <span>Avg Human First Response</span>
                <Clock className="w-4 h-4 text-[#00a884]" />
              </div>
              <div className="metric-value text-[28px] font-bold text-slate-900">
                {formatDuration(data.kpis.avgHumanFirstResponseSeconds)}
              </div>
              <div className="text-xs text-slate-500 flex flex-wrap items-center justify-between gap-1 tabular-nums">
                <span>
                  Median:{" "}
                  <strong className="font-semibold text-slate-700">
                    {formatDuration(data.kpis.medianHumanFirstResponseSeconds)}
                  </strong>
                </span>
                <span className="text-emerald-700 font-semibold">
                  {data.kpis.slaUnder5MinPct}% under 5m
                </span>
              </div>
            </div>

            {/* 2. Human Assignments & Response Rate */}
            <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                <span>Team Assignments & Replies</span>
                <UserCheck className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="metric-value text-[28px] font-bold text-slate-900">
                {data.kpis.humanRespondedCount}{" "}
                <span className="font-sans text-xs font-medium tracking-normal text-slate-500">
                  / {data.kpis.humanAssignmentsCount} assigned
                </span>
              </div>
              <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
                <span>Response rate: {data.kpis.humanResponseRatePct}%</span>
                <span
                  className={
                    data.kpis.autoEscalationsCount > 0
                      ? "text-red-700 font-semibold"
                      : "text-slate-500"
                  }
                >
                  {data.kpis.autoEscalationsCount} escalated (
                  {data.kpis.escalationRatePct}%)
                </span>
              </div>
            </div>

            {/* 3. Conversations & Live Waiting Queue */}
            <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                <span>Customer Conversations</span>
                <WhatsAppLogoIcon size={15} className="text-[#25d366]" />
              </div>
              <div className="metric-value text-[28px] font-bold text-slate-900">
                {data.kpis.totalConversations}{" "}
                <span className="font-sans text-xs font-semibold tracking-normal text-emerald-700">
                  ({data.kpis.resolutionRatePct}% resolved)
                </span>
              </div>
              <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
                <span>
                  Open: {data.kpis.openConversations + data.kpis.assignedConversations}
                </span>
                <span
                  className={
                    data.kpis.waitingNowCount > 0
                      ? "text-amber-800 font-semibold"
                      : "text-emerald-700 font-semibold"
                  }
                >
                  Waiting: {data.kpis.waitingNowCount} (P0:{" "}
                  {data.kpis.waitingP0Count}, P1: {data.kpis.waitingP1Count}, P2:{" "}
                  {data.kpis.waitingP2Count})
                </span>
              </div>
            </div>

            {/* 4. ACRIO Autonomous Resolution */}
            <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                <span>System (ACRIO) Handling</span>
                <Sparkles className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="metric-value text-[28px] font-bold text-slate-900">
                {data.kpis.acrioAutonomousRatePct}%{" "}
                <span className="font-sans text-xs font-medium tracking-normal text-slate-500">
                  handled without handoff
                </span>
              </div>
              <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
                <span>{data.kpis.acrioRepliesCount} ACRIO replies sent</span>
                <span>
                  Avg speed: {formatDuration(data.kpis.acrioAvgResponseSeconds)}
                </span>
              </div>
            </div>

            {/* 5. Message Volume & Free Chat Savings */}
            <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                <span>Messages Sent & Received</span>
                <TrendingUp className="w-4 h-4 text-sky-600" />
              </div>
              <div className="metric-value text-[28px] font-bold text-slate-900">
                {data.kpis.inboundMessagesCount + data.kpis.outboundMessagesCount}
              </div>
              <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
                <span>
                  In: {data.kpis.inboundMessagesCount} • Out:{" "}
                  {data.kpis.outboundMessagesCount}
                </span>
                <span className="text-emerald-700 font-semibold">
                  {data.kpis.freeStaffRepliesCount} Free staff replies
                </span>
              </div>
            </div>

            {/* 6. Outbound Delivery & Read Rate */}
            <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                <span>WhatsApp Read & Delivery Rate</span>
                <WhatsAppMessageTicks status="READ" showLabel={false} size={15} />
              </div>
              <div className="metric-value text-[28px] font-bold text-slate-900">
                {data.kpis.outboundReadRatePct}%{" "}
                <span className="font-sans text-xs font-semibold tracking-normal text-[#0088cc]">
                  Read
                </span>
              </div>
              <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
                <span>Delivered+: {data.kpis.outboundDeliveryRatePct}%</span>
                <span>Failed: {data.tickFunnel.failed}</span>
              </div>
            </div>

            {/* 7. WhatsApp Orders & Revenue */}
            <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                <span>Orders Logged on WhatsApp</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="metric-value text-[28px] font-bold text-slate-900">
                ₹{data.kpis.ordersRevenueInr.toLocaleString("en-IN")}
              </div>
              <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
                <span>{data.kpis.ordersCount} orders in period</span>
                <span className="text-emerald-700 font-semibold">
                  {data.kpis.optedInCustomers}/{data.kpis.totalCustomers} opted in
                </span>
              </div>
            </div>

            {/* 8. Message Charges (Role-Isolated Dual Pricing!) */}
            <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                <span>
                  {isDev ? "Billed vs Meta Cost (Dev)" : "Paid Message Charges"}
                </span>
                <IndianRupee className="w-4 h-4 text-slate-700" />
              </div>
              <div className="metric-value text-[28px] font-bold text-slate-900">
                ₹{data.kpis.clientBilledInr.toFixed(2)}
              </div>
              {isDev ? (
                <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
                  <span>
                    Meta: ₹{(data.kpis.actualMetaCostInr ?? 0).toFixed(2)}
                  </span>
                  <span className="text-emerald-700 font-semibold">
                    Margin: ₹{(data.kpis.netMarginInr ?? 0).toFixed(2)}
                  </span>
                </div>
              ) : (
                <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
                  <span>ACRIO + Templates only</span>
                  <span className="text-emerald-700 font-semibold">
                    Regular chat: ₹0.00
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ROW 2: Daily Volume & First-Response Trend + 24-Hour IST Enquiry Heatmap */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            {/* Daily Message & Response Trend */}
            <section className="xl:col-span-7 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">
                    Daily Customer & Outbound Message Volume
                  </h2>
                  <p className="text-xs text-neutral-500">
                    Daily inbound vs outbound messages and average human first-response
                    speed (IST).
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-neutral-600">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-[#00a884]" />
                    <span>Customer Inbound</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-sky-500" />
                    <span>Team / ACRIO Outbound</span>
                  </span>
                </div>
              </div>

              <div className="h-52 flex items-end gap-1.5 pt-4 pb-1 border-b border-neutral-200 overflow-x-auto">
                {data.dailySeries.map((day) => {
                  const total = day.inboundMessages + day.outboundMessages;
                  const inPct = Math.round(
                    (day.inboundMessages / maxDailyMsg) * 100
                  );
                  const outPct = Math.round(
                    (day.outboundMessages / maxDailyMsg) * 100
                  );
                  return (
                    <div
                      key={day.date}
                      className="flex-1 min-w-[24px] h-full flex flex-col justify-end items-center group relative"
                      title={`${day.label}: ${day.inboundMessages} inbound, ${day.outboundMessages} outbound${
                        day.avgFirstResponseSeconds !== null
                          ? `, Avg 1st reply: ${formatDuration(
                              day.avgFirstResponseSeconds
                            )}`
                          : ""
                      }`}
                    >
                      {total > 0 && (
                        <span className="text-[9px] text-neutral-500 mb-0.5">
                          {total}
                        </span>
                      )}
                      <div className="w-full max-w-[18px] flex flex-col justify-end rounded-t overflow-hidden bg-neutral-100 h-[145px]">
                        <div
                          style={{ height: `${outPct}%` }}
                          className="w-full bg-sky-500 transition-all"
                        />
                        <div
                          style={{ height: `${inPct}%` }}
                          className="w-full bg-[#00a884] transition-all"
                        />
                      </div>
                      <span className="text-[9px] text-neutral-500 mt-1.5 truncate max-w-full">
                        {day.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 24-Hour IST Peak Customer Hours */}
            <section className="xl:col-span-5 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">
                  Peak Customer Hours (India Standard Time)
                </h2>
                <p className="text-xs text-neutral-500">
                  Helps schedule Sales & Machine specialists during busy WhatsApp hours.
                </p>
              </div>

              <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                {data.hourlyIst.map((hr) => {
                  const ratio = hr.inboundCount / maxHourlyCount;
                  const tone =
                    hr.inboundCount === 0
                      ? "bg-neutral-50 border-neutral-200 text-neutral-400"
                      : ratio >= 0.65
                      ? "bg-[#00a884] border-[#008f6f] text-white"
                      : ratio >= 0.3
                      ? "bg-[#d9fdd3] border-[#a9e5a0] text-[#005c4b]"
                      : "bg-emerald-50/70 border-emerald-200 text-emerald-900";
                  return (
                    <div
                      key={hr.hour}
                      className={`p-2 rounded-md border text-center ${tone}`}
                      title={`${hr.label} IST: ${hr.inboundCount} customer messages, ${hr.outboundCount} replies`}
                    >
                      <div className="text-[10px] font-medium">{hr.label}</div>
                      <div className="text-xs font-bold mt-0.5">
                        {hr.inboundCount}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* ROW 3: Agent Assignment & First-Response Leaderboard */}
          <section className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">
                  Agent & System First-Response Leaderboard
                </h2>
                <p className="text-xs text-neutral-500">
                  Measures exact time from when a chat is assigned to an agent until
                  their first WhatsApp reply.
                </p>
              </div>
              <Link
                href="/dashboard/teams"
                className="text-xs font-medium text-[#008069] hover:underline inline-flex items-center gap-1"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Configure P0 / P1 / P2 Tiers</span>
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold">
                    <th className="py-3 px-4">Agent / Handler</th>
                    <th className="py-3 px-3">Department</th>
                    <th className="py-3 px-3 text-right">Assigned</th>
                    <th className="py-3 px-3 text-right">Responded</th>
                    <th className="py-3 px-3 text-right">Avg 1st Response</th>
                    <th className="py-3 px-3 text-right">Fastest / Slowest</th>
                    <th className="py-3 px-3 text-right">Under 5m SLA</th>
                    <th className="py-3 px-3 text-right">Escalated</th>
                    <th className="py-3 px-3 text-right">Replies Sent</th>
                    <th className="py-3 px-4 text-right">Live Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {data.agentLeaderboard.map((ag) => (
                    <tr key={ag.staffId} className="hover:bg-neutral-50/80">
                      <td className="py-3 px-4 font-semibold text-neutral-900">
                        <div className="flex items-center gap-2">
                          {ag.isSystem ? (
                            <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 inline-flex items-center justify-center shrink-0">
                              <Sparkles className="w-3.5 h-3.5" />
                            </span>
                          ) : (
                            <span className="w-6 h-6 rounded-full bg-[#e7fce3] text-[#008069] inline-flex items-center justify-center text-[10px] font-bold shrink-0">
                              {ag.staffName.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                          <span>{ag.staffName}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-neutral-600">
                        {ag.department}
                      </td>
                      <td className="py-3 px-3 text-right font-medium">
                        {ag.assignmentsCount}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="font-medium text-neutral-900">
                          {ag.respondedCount}
                        </span>{" "}
                        <span className="text-neutral-500">
                          ({ag.responseRatePct}%)
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-semibold">
                        <span
                          className={
                            ag.avgFirstResponseSeconds === null
                              ? "text-neutral-400 font-normal"
                              : ag.avgFirstResponseSeconds <= 180
                              ? "text-emerald-700"
                              : ag.avgFirstResponseSeconds <= 420
                              ? "text-amber-700"
                              : "text-red-700"
                          }
                        >
                          {formatDuration(ag.avgFirstResponseSeconds)}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right text-neutral-600">
                        {ag.fastestFirstResponseSeconds !== null
                          ? `${formatDuration(
                              ag.fastestFirstResponseSeconds
                            )} / ${formatDuration(
                              ag.slowestFirstResponseSeconds
                            )}`
                          : "None"}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {ag.respondedCount > 0 ? (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                              ag.under5MinPct >= 80
                                ? "bg-emerald-100 text-emerald-800"
                                : ag.under5MinPct >= 50
                                ? "bg-amber-100 text-amber-900"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {ag.under5MinPct}%
                          </span>
                        ) : (
                          <span className="text-neutral-400">None</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {ag.escalatedCount > 0 ? (
                          <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 font-semibold">
                            {ag.escalatedCount}
                          </span>
                        ) : (
                          <span className="text-neutral-400">0</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-neutral-800">
                        {ag.outboundRepliesSent}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-neutral-900">
                        {ag.activeOpenChats}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ROW 4: Team SLA Breakdown + Outbound Tick Funnel & Message Billing */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            {/* Team SLA & Escalation Table */}
            <section className="xl:col-span-7 bg-white rounded-lg border border-neutral-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-200">
                <h2 className="text-sm font-semibold text-neutral-900">
                  Team SLA & P0 / P1 / P2 Escalation Performance
                </h2>
                <p className="text-xs text-neutral-500">
                  Shows how fast each specialist team responds and how often chats
                  escalate past P0.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold">
                      <th className="py-2.5 px-4">Team</th>
                      <th className="py-2.5 px-3">SLA Timers</th>
                      <th className="py-2.5 px-3 text-right">Assigned</th>
                      <th className="py-2.5 px-3 text-right">Avg 1st Reply</th>
                      <th className="py-2.5 px-3 text-right">P0 / P1 / P2</th>
                      <th className="py-2.5 px-4 text-right">Waiting Now</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {data.teamBreakdown.map((tm) => (
                      <tr key={tm.teamId} className="hover:bg-neutral-50/80">
                        <td className="py-3 px-4 font-semibold text-neutral-900">
                          {tm.teamName}
                        </td>
                        <td className="py-3 px-3 text-neutral-600">
                          P0: {tm.p0WaitMinutes}m • P1: {tm.p1WaitMinutes}m
                        </td>
                        <td className="py-3 px-3 text-right font-medium">
                          {tm.assignmentsCount}
                        </td>
                        <td className="py-3 px-3 text-right font-semibold text-emerald-800">
                          {formatDuration(tm.avgFirstResponseSeconds)}
                        </td>
                        <td className="py-3 px-3 text-right text-neutral-700">
                          {tm.p0Count} / {tm.p1Count} / {tm.p2Count}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {tm.currentlyWaitingCount > 0 ? (
                            <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-semibold">
                              {tm.currentlyWaitingCount} waiting
                            </span>
                          ) : (
                            <span className="text-emerald-700 font-medium">
                              0 waiting
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Outbound WhatsApp Tick Funnel + Paid vs Free Breakdown */}
            <section className="xl:col-span-5 bg-white rounded-lg border border-neutral-200 p-5 space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">
                  Outbound WhatsApp Tick Funnel & Message Billing
                </h2>
                <p className="text-xs text-neutral-500">
                  Live receipt status across {data.tickFunnel.totalOutbound} outbound
                  messages.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  {
                    status: "SENT",
                    label: "Sent (1 Tick)",
                    count: data.tickFunnel.sent,
                  },
                  {
                    status: "DELIVERED",
                    label: "Delivered",
                    count: data.tickFunnel.delivered,
                  },
                  {
                    status: "READ",
                    label: "Read (Blue)",
                    count: data.tickFunnel.read,
                  },
                  {
                    status: "FAILED",
                    label: "Failed",
                    count: data.tickFunnel.failed,
                  },
                ].map((item) => (
                  <div
                    key={item.status}
                    className="p-2.5 rounded-lg bg-neutral-50 border border-neutral-200 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <WhatsAppMessageTicks
                        status={item.status}
                        showLabel={false}
                        size={14}
                      />
                      <span className="text-sm font-bold text-neutral-900">
                        {item.count}
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-600">
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-neutral-200 space-y-2">
                <div className="text-xs font-semibold text-neutral-800">
                  Billing Category Breakdown
                </div>
                <div className="space-y-1.5 text-xs">
                  {Object.entries(data.billingByCategory).map(([cat, row]) => (
                    <div
                      key={cat}
                      className="flex items-center justify-between py-1 px-2.5 rounded bg-neutral-50 border border-neutral-200/80"
                    >
                      <span className="font-medium text-neutral-800">
                        {cat === "FREE_CHAT"
                          ? "Staff Free Chat (24h Window)"
                          : cat === "ACRIO"
                          ? "System (ACRIO) Auto-Replies"
                          : `${cat} Templates`}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="text-neutral-500">{row.count} msgs</span>
                        <strong className="text-neutral-900">
                          ₹{row.clientBilledInr.toFixed(2)}
                        </strong>
                        {isDev && row.marginInr !== undefined && (
                          <span className="text-emerald-700 font-semibold">
                            (+₹{row.marginInr.toFixed(2)})
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* ROW 5: Product Categories, Short Links (/l/...), and Templates */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            {/* Product Enquiry Categories & Customer Segments */}
            <section className="xl:col-span-4 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">
                  Enquiries by Product Category
                </h2>
                <p className="text-xs text-neutral-500">
                  Auto-tagged across Classic Concepts & Classic Edge 53.
                </p>
              </div>
              <div className="space-y-2">
                {data.categories.map((cat) => {
                  const pct =
                    data.kpis.totalConversations > 0
                      ? Math.round(
                          (cat.count / data.kpis.totalConversations) * 100
                        )
                      : 0;
                  return (
                    <div key={cat.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-neutral-800">
                          {cat.name}
                        </span>
                        <span className="text-neutral-600">
                          {cat.count} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
                        <div
                          style={{ width: `${Math.max(4, pct)}%` }}
                          className="h-full bg-[#00a884] rounded-full"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Top Templates & Broadcast Queue Stats */}
            <section className="xl:col-span-4 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">
                    Broadcasts & Top Templates
                  </h2>
                  <p className="text-xs text-neutral-500">
                    {data.broadcastSummary.campaignsCount} campaigns •{" "}
                    {data.broadcastSummary.sent} sent •{" "}
                    {data.broadcastSummary.read} read
                  </p>
                </div>
                <Link
                  href="/dashboard/templates"
                  className="text-xs font-medium text-[#008069] hover:underline"
                >
                  Templates
                </Link>
              </div>

              <div className="space-y-2">
                {data.topTemplates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="p-2.5 rounded-md bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-neutral-900 truncate">
                        {tpl.name}
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        {tpl.category} • {tpl.approvalStatus}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-white border border-neutral-200 font-semibold text-neutral-800 shrink-0">
                      {tpl.sentCount} sent
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Short Links Click Performance */}
            <section className="xl:col-span-4 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">
                    Short Links Clicks (/l/...)
                  </h2>
                  <p className="text-xs text-neutral-500">
                    Tracks customer clicks on catalog & quote links.
                  </p>
                </div>
                <Link
                  href="/dashboard/marketing"
                  className="text-xs font-medium text-[#008069] hover:underline"
                >
                  Manage Links
                </Link>
              </div>

              <div className="space-y-2">
                {data.topLinks.map((lnk) => (
                  <div
                    key={lnk.id}
                    className="p-2.5 rounded-md bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-neutral-900 truncate">
                        {lnk.title}
                      </div>
                      <div className="text-[11px] font-mono text-[#008069] truncate">
                        {WHATSAPP_PUBLIC_ORIGIN}/l/{lnk.code}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold shrink-0">
                      {lnk.clicksCount} clicks
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* ROW 6: Searchable Assignment & First-Response Audit Log */}
          <section className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">
                  Complete Assignment & First-Response History Log
                </h2>
                <p className="text-xs text-neutral-500">
                  Every chat assignment with exact assigned timestamp, first
                  response timestamp, elapsed time, and outcome.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    placeholder="Search customer, phone, or agent..."
                    className="pl-8 pr-3 py-1.5 rounded-md border border-neutral-300 text-xs w-60"
                  />
                </div>

                <select
                  value={outcomeFilter}
                  onChange={(e) => setOutcomeFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-md border border-neutral-300 bg-white text-xs text-neutral-800"
                >
                  <option value="ALL">All Assignments</option>
                  <option value="HUMAN">Human Staff Only</option>
                  <option value="SYSTEM">System (ACRIO) Only</option>
                  <option value="RESPONDED">Responded</option>
                  <option value="ACTIVE">Awaiting Reply / Active</option>
                  <option value="ESCALATED">Escalated (Missed Timer)</option>
                  <option value="REASSIGNED">Reassigned</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold">
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-3">Assigned To</th>
                    <th className="py-3 px-3">How Assigned</th>
                    <th className="py-3 px-3">Assigned At</th>
                    <th className="py-3 px-3">First Response At</th>
                    <th className="py-3 px-3 text-right">Response Time</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-4 text-right">Chat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-8 text-center text-neutral-500"
                      >
                        No assignment records match your filter.
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => {
                      const isSys = log.toStaffId === "ACRIO";
                      return (
                        <tr key={log.id} className="hover:bg-neutral-50/80">
                          <td className="py-3 px-4">
                            <div className="font-semibold text-neutral-900">
                              {log.customerName || log.customerPhone}
                            </div>
                            <div className="text-[11px] font-mono text-neutral-500">
                              {log.customerPhone}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-neutral-900 flex items-center gap-1.5">
                              <span>
                                {isSys ? "System (ACRIO)" : log.toStaffName}
                              </span>
                              {!isSys && (
                                <span
                                  className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                                    log.escalationLevel === "P2"
                                      ? "bg-red-600 text-white"
                                      : log.escalationLevel === "P1"
                                      ? "bg-amber-500 text-white"
                                      : "bg-neutral-100 text-neutral-700"
                                  }`}
                                >
                                  {log.escalationLevel}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-neutral-500">
                              {log.toTeamName}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="text-neutral-800">
                              {formatSourceLabel(log.assignmentSource)}
                            </div>
                            <div className="text-[11px] text-neutral-500">
                              by {log.assignedByName}
                            </div>
                          </td>
                          <td className="py-3 px-3 font-medium text-neutral-800">
                            {formatDateTimeIst(log.assignedAt)}
                          </td>
                          <td className="py-3 px-3">
                            {log.firstResponseAt ? (
                              <span className="font-medium text-emerald-800">
                                {formatDateTimeIst(log.firstResponseAt)}
                              </span>
                            ) : (
                              <span className="text-neutral-400">
                                No reply yet
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-semibold">
                            {log.firstResponseSeconds !== null ? (
                              <span
                                className={
                                  log.firstResponseSeconds <= 180
                                    ? "text-emerald-700"
                                    : log.firstResponseSeconds <= 420
                                    ? "text-amber-700"
                                    : "text-red-700"
                                }
                              >
                                {formatDuration(log.firstResponseSeconds)}
                              </span>
                            ) : (
                              <span className="text-neutral-400">None</span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${
                                log.outcome === "RESPONDED"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : log.outcome === "ESCALATED"
                                  ? "bg-red-100 text-red-800"
                                  : log.outcome === "ACTIVE"
                                  ? "bg-amber-100 text-amber-900"
                                  : "bg-neutral-100 text-neutral-700"
                              }`}
                            >
                              {log.outcome}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Link
                              href={`/dashboard/inbox?c=${encodeURIComponent(
                                log.conversationId
                              )}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-[11px] font-medium text-neutral-800"
                            >
                              <span>Open Chat</span>
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
