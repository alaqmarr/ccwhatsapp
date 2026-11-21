"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BarChart3, Download, RefreshCw } from "lucide-react";
import {
  CardListSkeleton,
  ElementErrorState,
  StatCardsSkeleton,
  TableRowsSkeleton,
} from "@cc/ui";
import {
  exportAssignmentLogsCsv,
  type AnalyticsRange,
  type AnalyticsResponse,
} from "./analytics-types";
import { AnalyticsKpiGrid } from "./AnalyticsKpiGrid";

const AnalyticsVolumeCharts = dynamic(() => import("./AnalyticsVolumeCharts"), {
  loading: () => <CardListSkeleton rows={4} />,
});

const AnalyticsPerformanceTables = dynamic(
  () => import("./AnalyticsPerformanceTables"),
  {
    loading: () => <TableRowsSkeleton rows={6} cols={6} />,
  }
);

const AnalyticsBusinessInsights = dynamic(
  () => import("./AnalyticsBusinessInsights"),
  {
    loading: () => <CardListSkeleton rows={4} />,
  }
);

const AnalyticsCategoriesAndAuditLog = dynamic(
  () => import("./AnalyticsCategoriesAndAuditLog"),
  {
    loading: () => <TableRowsSkeleton rows={6} cols={7} />,
  }
);

export function AnalyticsClient({
  initialData,
}: {
  initialData?: AnalyticsResponse;
}) {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [teamFilter, setTeamFilter] = useState<string>("ALL");
  const [data, setData] = useState<AnalyticsResponse | null>(initialData ?? null);
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const skippedInitialFetchRef = useRef<boolean>(Boolean(initialData));

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
          )}&teamId=${encodeURIComponent(teamFilter)}${manual ? "&refresh=1" : ""}`,
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
    if (skippedInitialFetchRef.current) {
      skippedInitialFetchRef.current = false;
      return;
    }
    void loadAnalytics(false);
  }, [loadAnalytics]);

  const filteredLogs = useMemo(() => {
    const list = data?.assignmentLogs || [];
    return list.filter((item) => {
      if (outcomeFilter !== "ALL") {
        if (outcomeFilter === "SYSTEM" && item.toStaffId !== "ACRIO") return false;
        if (outcomeFilter === "HUMAN" && item.toStaffId === "ACRIO") return false;
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

  return (
    <div className="w-full px-3.5 sm:px-6 py-4 sm:py-5 space-y-5 sm:space-y-6 bg-neutral-50 text-neutral-900">
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
              Tracks exact assignment times, agent first-response speed, P0/P1/P2 escalations, ACRIO automation, message ticks, and revenue.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
            onClick={() => void loadAnalytics(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-800 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => data && exportAssignmentLogsCsv(filteredLogs, range)}
            disabled={!data}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {error && (
        <ElementErrorState
          title="Could not load analytics data"
          message={error}
          onRetry={() => void loadAnalytics(true)}
          retrying={loading || refreshing}
        />
      )}

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
          <AnalyticsKpiGrid data={data} />
          <AnalyticsVolumeCharts data={data} />
          <AnalyticsBusinessInsights data={data} />
          <AnalyticsPerformanceTables data={data} />
          <AnalyticsCategoriesAndAuditLog
            data={data}
            filteredLogs={filteredLogs}
            logSearch={logSearch}
            onLogSearchChange={setLogSearch}
            outcomeFilter={outcomeFilter}
            onOutcomeFilterChange={setOutcomeFilter}
          />
        </>
      ) : null}
    </div>
  );
}
