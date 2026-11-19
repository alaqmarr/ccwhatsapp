"use client";

import React from "react";
import {
  CheckCircle2,
  ExternalLink,
  Info,
  Link2,
  Loader2,
  Search,
  Wrench,
} from "lucide-react";
import {
  categoryLabel,
  severityBadgeStyle,
  siteBadgeStyle,
  type EcosystemDetectedIssue,
} from "./issues-types";

export function IssuesFindingsList({
  severityFilter,
  setSeverityFilter,
  categoryFilter,
  setCategoryFilter,
  siteFilter,
  setSiteFilter,
  searchQuery,
  setSearchQuery,
  loading,
  filteredIssues,
  fixing,
  onAutoFix,
}: {
  severityFilter: string;
  setSeverityFilter: (v: string) => void;
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  siteFilter: string;
  setSiteFilter: (v: string) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  loading: boolean;
  filteredIssues: EcosystemDetectedIssue[];
  fixing: string | null;
  onAutoFix: (fixType: "SYNC_SHORTLINKS" | "REFRESH_CATALOG_CACHE") => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
      <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
        <div className="flex flex-wrap items-center gap-2">
          {(["ALL", "CRITICAL", "WARNING", "INFO"] as const).map((sev) => (
            <button
              key={sev}
              type="button"
              onClick={() => setSeverityFilter(sev)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                severityFilter === sev
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
              }`}
            >
              {sev === "ALL" ? "All Severities" : sev}
            </button>
          ))}

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
          >
            <option value="ALL">All Categories</option>
            <option value="SHORTLINKS_AND_CROSS_SITE">
              Links &amp; Cross-Site
            </option>
            <option value="PRODUCT_MEDIA_AND_R2">Media &amp; R2 Storage</option>
            <option value="PRICING_AND_SPECS">Pricing, SKUs &amp; Specs</option>
            <option value="AI_LOGS_AND_BRIDGES">AI Logs &amp; Bridges</option>
            <option value="TEMPLATES_AND_CONTENT">
              Templates &amp; Content
            </option>
          </select>

          <select
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
          >
            <option value="ALL">All Sites</option>
            <option value="CLASSIC_CONCEPTS">classicconcepts.in</option>
            <option value="CLASSIC_EDGE_53">classicedge.in</option>
            <option value="SHORTLINK_ROUTER">ccapl.cc Shortlinks</option>
            <option value="WHATSAPP_HUB">chat.ccapl.cc Hub</option>
          </select>
        </div>

        <div className="relative min-w-0 w-full sm:min-w-[240px] sm:flex-1 sm:max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by SKU, product name, slug, or URL..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
          <span>
            Scanning Classic Concepts, Classic Edge 53, ccapl.cc shortlinks, and
            R2 media...
          </span>
        </div>
      ) : filteredIssues.length === 0 ? (
        <div className="p-12 text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
          <div className="text-sm font-bold text-slate-800">
            No matching issues or discrepancies found
          </div>
          <p className="text-xs text-slate-500">
            All filtered checks passed across the ecosystem.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {filteredIssues.map((iss) => (
            <div
              key={iss.id}
              className="p-4 hover:bg-slate-50/80 transition-colors flex flex-col lg:flex-row lg:items-start justify-between gap-3"
            >
              <div className="space-y-1.5 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${severityBadgeStyle(
                      iss.severity
                    )}`}
                  >
                    {iss.severity}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border ${siteBadgeStyle(
                      iss.site
                    )}`}
                  >
                    {iss.site}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                    {categoryLabel(iss.category)}
                  </span>
                  {iss.skuOrCode && (
                    <span className="font-mono text-[11px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                      {iss.skuOrCode}
                    </span>
                  )}
                </div>

                <div className="text-sm font-bold text-slate-900">
                  {iss.title}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed break-words">
                  {iss.detail}
                </p>
                <div className="text-[11px] text-indigo-700 font-medium flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  <span>Recommended Fix: {iss.suggestion}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {iss.sourceUrl && (
                  <a
                    href={iss.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Open Page</span>
                  </a>
                )}
                {iss.adminEditUrl && (
                  <a
                    href={iss.adminEditUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Edit in Admin</span>
                  </a>
                )}
                {iss.targetUrl && (
                  <a
                    href={iss.targetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-mono"
                  >
                    <Link2 className="w-3 h-3" />
                    <span>Target Link</span>
                  </a>
                )}
                {iss.autoFixAction && (
                  <button
                    type="button"
                    disabled={Boolean(fixing)}
                    onClick={() => onAutoFix(iss.autoFixAction!)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                  >
                    <Wrench className="w-3 h-3" />
                    <span>Auto-Fix</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
