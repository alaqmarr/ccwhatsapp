"use client";

import React from "react";
import type { EcosystemIssuesAuditReport } from "./issues-types";

export function IssuesSiteHealthCards({
  report,
  siteFilter,
  onToggleSite,
}: {
  report: EcosystemIssuesAuditReport;
  siteFilter: string;
  onToggleSite: (site: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3.5">
      <div className="bg-slate-900 text-white rounded-xl p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Ecosystem Health
          </span>
          <span className="text-[11px] font-mono text-slate-400">
            {report.durationMs}ms
          </span>
        </div>
        <div className="my-2 flex items-baseline gap-2">
          <span
            className={`text-3xl font-black ${
              report.healthScore >= 85
                ? "text-emerald-400"
                : report.healthScore >= 65
                ? "text-amber-300"
                : "text-red-400"
            }`}
          >
            {report.healthScore}%
          </span>
          <span className="text-xs text-slate-300">
            ({report.totals.totalIssues} total findings)
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 font-bold">
            {report.totals.critical} Critical
          </span>
          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 font-bold">
            {report.totals.warning} Warn
          </span>
          <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-200 font-bold">
            {report.totals.info} Info
          </span>
        </div>
      </div>

      {report.siteSummaries.map((s) => (
        <button
          key={s.site}
          type="button"
          onClick={() => onToggleSite(s.site)}
          className={`text-left bg-white rounded-xl p-4 border transition-all cursor-pointer ${
            siteFilter === s.site
              ? "border-indigo-600 ring-2 ring-indigo-600/15"
              : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] font-bold text-indigo-600">
              {s.publicDomain}
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                s.criticalCount > 0
                  ? "bg-red-500"
                  : s.warningCount > 0
                  ? "bg-amber-500"
                  : "bg-emerald-500"
              }`}
            />
          </div>
          <div className="font-bold text-sm text-slate-900 mt-1 truncate">
            {s.label}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Scanned:{" "}
            <strong className="text-slate-700">{s.totalItemsScanned}</strong>{" "}
            records
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold">
            {s.criticalCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                {s.criticalCount} Crit
              </span>
            )}
            {s.warningCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                {s.warningCount} Warn
              </span>
            )}
            {s.infoCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                {s.infoCount} Info
              </span>
            )}
            {s.criticalCount === 0 &&
              s.warningCount === 0 &&
              s.infoCount === 0 && (
                <span className="text-emerald-700">All clear</span>
              )}
          </div>
        </button>
      ))}
    </div>
  );
}
