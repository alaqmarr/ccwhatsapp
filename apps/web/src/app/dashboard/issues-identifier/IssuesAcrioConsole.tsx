"use client";

import React from "react";
import { Loader2, Sparkles } from "lucide-react";
import {
  QUICK_DIAGNOSTIC_PROMPTS,
  type EcosystemIssuesAuditReport,
} from "./issues-types";

export function IssuesAcrioConsole({
  acrioPrompt,
  setAcrioPrompt,
  askingAcrio,
  report,
  onAskAcrio,
}: {
  acrioPrompt: string;
  setAcrioPrompt: (v: string) => void;
  askingAcrio: boolean;
  report: EcosystemIssuesAuditReport | null;
  onAskAcrio: (promptText?: string) => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xs space-y-3.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-600" />
          <h2 className="text-sm font-bold text-slate-900">
            Run ACRIO Deep Diagnostic Analysis (claude-haiku-5-5)
          </h2>
        </div>
        <span className="text-[11px] text-slate-400">
          ACRIO inspects all live findings, shortlinks, R2 media, and catalog
          specs
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_DIAGNOSTIC_PROMPTS.map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={askingAcrio}
            onClick={() => onAskAcrio(preset)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 text-xs font-medium transition-colors text-left cursor-pointer"
          >
            {preset}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAskAcrio();
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={acrioPrompt}
          onChange={(e) => setAcrioPrompt(e.target.value)}
          placeholder="Ask ACRIO to inspect specific discrepancies, broken links, missing variant photos, or SKU conflicts..."
          className="flex-1 px-3.5 py-2 rounded-lg border border-slate-300 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={askingAcrio || !acrioPrompt.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-bold disabled:opacity-50 shrink-0 cursor-pointer"
        >
          {askingAcrio ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          <span>{askingAcrio ? "Analyzing..." : "Analyze with ACRIO"}</span>
        </button>
      </form>

      {report?.acrioAnalysis && (
        <div className="p-3.5 sm:p-4 rounded-xl bg-slate-900 text-slate-100 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] border border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-800 text-[11px] text-indigo-300 font-bold uppercase tracking-wider">
            <span>ACRIO Ecosystem Diagnostic Report</span>
            <span>Model: {report.acrioModel || "claude-haiku-5-5"}</span>
          </div>
          {report.acrioAnalysis}
        </div>
      )}
    </div>
  );
}
