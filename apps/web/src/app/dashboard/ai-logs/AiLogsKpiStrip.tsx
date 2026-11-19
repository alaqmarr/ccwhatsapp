"use client";

import React from "react";
import {
  Activity,
  AlertTriangle,
  Database,
  PackageSearch,
  Sparkles,
} from "lucide-react";
import type { AiLogsResponse } from "./ai-logs-types";

export function AiLogsKpiStrip({
  data,
  hasActiveFilters,
}: {
  data: AiLogsResponse;
  hasActiveFilters: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="bg-white rounded-xl border border-neutral-200 p-3.5">
          <div className="text-[11px] font-semibold text-slate-500 uppercase">
            Total Logged Traces
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {data.totalEntries}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            WA: {data.byWebsite.WHATSAPP_HUB} • CC:{" "}
            {data.byWebsite.CLASSIC_CONCEPTS} • CE53:{" "}
            {data.byWebsite.CLASSIC_EDGE_53}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-indigo-200 bg-indigo-50/30 p-3.5">
          <div className="text-[11px] font-semibold text-indigo-700 uppercase">
            Total Tokens In
          </div>
          <div className="text-2xl font-bold text-indigo-950 mt-1 font-mono tabular-nums">
            {(data.totalInputTokens ?? 0).toLocaleString("en-IN")}
          </div>
          <div className="text-[11px] text-slate-600 mt-0.5 font-mono">
            Cache Read:{" "}
            {(data.totalCacheReadInputTokens ?? 0).toLocaleString("en-IN")}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-purple-200 bg-purple-50/30 p-3.5">
          <div className="text-[11px] font-semibold text-purple-700 uppercase">
            Total Tokens Out
          </div>
          <div className="text-2xl font-bold text-purple-950 mt-1 font-mono tabular-nums">
            {(data.totalOutputTokens ?? 0).toLocaleString("en-IN")}
          </div>
          <div className="text-[11px] text-slate-600 mt-0.5 font-mono">
            In + Out:{" "}
            {(data.totalCombinedTokens ?? 0).toLocaleString("en-IN")}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 p-3.5">
          <div className="text-[11px] font-semibold text-violet-700 uppercase flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" />
            Live Claude Haiku 5.5
          </div>
          <div className="text-2xl font-bold text-violet-900 mt-1">
            {data.liveAiCount}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Medium adaptive effort
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 p-3.5">
          <div className="text-[11px] font-semibold text-emerald-700 uppercase flex items-center gap-1">
            <Database className="w-3.5 h-3.5" />
            Cache Hits
          </div>
          <div className="text-2xl font-bold text-emerald-800 mt-1">
            {data.cacheHitCount}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Response & catalog cache
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 p-3.5">
          <div className="text-[11px] font-semibold text-blue-700 uppercase flex items-center gap-1">
            <PackageSearch className="w-3.5 h-3.5" />
            Product Lookups
          </div>
          <div className="text-2xl font-bold text-blue-900 mt-1">
            {data.productLookupCount}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Catalog queries traced
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 p-3.5">
          <div className="text-[11px] font-semibold text-slate-600 uppercase flex items-center gap-1">
            <Activity className="w-3.5 h-3.5" />
            Local / 0-Credit
          </div>
          <div className="text-2xl font-bold text-slate-800 mt-1">
            {data.localFallbackCount}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Instant deterministic runs
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 p-3.5">
          <div className="text-[11px] font-semibold text-red-700 uppercase flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            Warnings / Errors
          </div>
          <div className="text-2xl font-bold text-red-700 mt-1">
            {data.errorCount}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            API / parse diagnostics
          </div>
        </div>
      </div>

      {/* Per-Website Token Breakdown Strip */}
      <div className="bg-white rounded-xl border border-neutral-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-semibold text-slate-800">
            Tokens by Website:
          </span>
          <span className="font-mono text-[11.5px] text-emerald-900 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md">
            WhatsApp Hub: In{" "}
            {(
              data.tokensByWebsite?.WHATSAPP_HUB?.inputTokens ?? 0
            ).toLocaleString("en-IN")}{" "}
            • Out{" "}
            {(
              data.tokensByWebsite?.WHATSAPP_HUB?.outputTokens ?? 0
            ).toLocaleString("en-IN")}
          </span>
          <span className="font-mono text-[11.5px] text-blue-900 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-md">
            classicconcepts.in: In{" "}
            {(
              data.tokensByWebsite?.CLASSIC_CONCEPTS?.inputTokens ?? 0
            ).toLocaleString("en-IN")}{" "}
            • Out{" "}
            {(
              data.tokensByWebsite?.CLASSIC_CONCEPTS?.outputTokens ?? 0
            ).toLocaleString("en-IN")}
          </span>
          <span className="font-mono text-[11.5px] text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-md">
            classicedge53.com: In{" "}
            {(
              data.tokensByWebsite?.CLASSIC_EDGE_53?.inputTokens ?? 0
            ).toLocaleString("en-IN")}{" "}
            • Out{" "}
            {(
              data.tokensByWebsite?.CLASSIC_EDGE_53?.outputTokens ?? 0
            ).toLocaleString("en-IN")}
          </span>
        </div>
        {hasActiveFilters && (
          <div className="font-mono text-[11.5px] text-slate-700">
            Filtered View: In{" "}
            <strong>
              {(data.filteredInputTokens ?? 0).toLocaleString("en-IN")}
            </strong>{" "}
            • Out{" "}
            <strong>
              {(data.filteredOutputTokens ?? 0).toLocaleString("en-IN")}
            </strong>
          </div>
        )}
      </div>
    </div>
  );
}
