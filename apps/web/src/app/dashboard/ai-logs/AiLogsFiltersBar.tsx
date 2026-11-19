"use client";

import React from "react";
import { Search } from "lucide-react";

export function AiLogsFiltersBar({
  viewMode,
  setViewMode,
  entriesCount,
  searchQuery,
  setSearchQuery,
  websiteFilter,
  setWebsiteFilter,
  outcomeFilter,
  setOutcomeFilter,
  cacheFilter,
  setCacheFilter,
}: {
  viewMode: "structured" | "raw";
  setViewMode: (v: "structured" | "raw") => void;
  entriesCount: number;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  websiteFilter: string;
  setWebsiteFilter: (v: string) => void;
  outcomeFilter: string;
  setOutcomeFilter: (v: string) => void;
  cacheFilter: string;
  setCacheFilter: (v: string) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-3.5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setViewMode("structured")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              viewMode === "structured"
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Structured Flight Explorer ({entriesCount})
          </button>
          <button
            type="button"
            onClick={() => setViewMode("raw")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              viewMode === "raw"
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Raw ai.logs File Viewer
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 flex-1 justify-end w-full">
          <div className="relative min-w-0 w-full sm:min-w-[220px] sm:flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search question, product, SKU, step, response..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-neutral-200 focus:outline-none focus:border-slate-400"
            />
          </div>

          <select
            value={websiteFilter}
            onChange={(e) => setWebsiteFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-neutral-200 bg-white font-medium text-slate-700"
          >
            <option value="ALL">All Websites</option>
            <option value="WHATSAPP_HUB">WhatsApp Hub (ACRIO)</option>
            <option value="CLASSIC_CONCEPTS">Classic Concepts (.in)</option>
            <option value="CLASSIC_EDGE_53">Classic Edge 53 (.com)</option>
          </select>

          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-neutral-200 bg-white font-medium text-slate-700"
          >
            <option value="ALL">All Outcomes</option>
            <option value="LIVE_AI">Live Claude Haiku 5.5</option>
            <option value="RESPONSE_CACHE">Response Cache Hit</option>
            <option value="LOCAL_FALLBACK">Local Catalog / Fallback</option>
            <option value="HUMAN_HANDOFF">Human Handoff</option>
            <option value="ORDER_LOOKUP">Live Order Lookup</option>
            <option value="ERROR">Errors</option>
          </select>

          <select
            value={cacheFilter}
            onChange={(e) => setCacheFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-neutral-200 bg-white font-medium text-slate-700"
          >
            <option value="ALL">All Cache States</option>
            <option value="HIT">Cache HIT</option>
            <option value="MISS">Cache MISS</option>
          </select>
        </div>
      </div>
    </div>
  );
}
