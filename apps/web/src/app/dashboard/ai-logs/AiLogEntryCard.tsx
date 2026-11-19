"use client";

import React from "react";
import { CheckCircle2, Clock, Copy, ExternalLink, FileCode } from "lucide-react";
import {
  cacheBadgeStyle,
  outcomeBadgeStyle,
  websiteBadgeStyle,
  type AiTraceLogEntry,
} from "./ai-logs-types";

export function AiLogEntryCard({
  entry,
  copiedId,
  onCopyText,
  onInspect,
}: {
  entry: AiTraceLogEntry;
  copiedId: string;
  onCopyText: (id: string, text: string) => void;
  onInspect: (entry: AiTraceLogEntry) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 shadow-2xs overflow-hidden">
      {/* Trace Header */}
      <div className="px-4 py-3 bg-slate-50/80 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${websiteBadgeStyle(
              entry.website
            )}`}
          >
            {entry.websiteLabel}
          </span>
          <span className="text-xs font-bold text-slate-900">
            {entry.feature}
          </span>
          <span
            className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${outcomeBadgeStyle(
              entry.outcomeSource
            )}`}
          >
            {entry.outcomeSource}
          </span>
          <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
            {entry.model}
            {entry.effort ? ` (${entry.effort})` : ""}
          </span>
          <span
            className={`px-2 py-0.5 rounded border text-[10.5px] font-semibold ${cacheBadgeStyle(
              entry.responseCacheStatus
            )}`}
          >
            Resp Cache: {entry.responseCacheStatus}
          </span>
          <span
            className={`px-2 py-0.5 rounded border text-[10.5px] font-semibold ${cacheBadgeStyle(
              entry.catalogCacheStatus
            )}`}
          >
            Catalog Cache: {entry.catalogCacheStatus}
          </span>
          <span className="font-mono text-[10.5px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-900 border border-indigo-200 font-semibold">
            Tokens In:{" "}
            {(entry.tokenUsage?.inputTokens ?? 0).toLocaleString("en-IN")}
          </span>
          <span className="font-mono text-[10.5px] px-2 py-0.5 rounded bg-purple-50 text-purple-900 border border-purple-200 font-semibold">
            Tokens Out:{" "}
            {(entry.tokenUsage?.outputTokens ?? 0).toLocaleString("en-IN")}
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono">
          <span className="inline-flex items-center gap-1 text-slate-700 font-semibold">
            <Clock className="w-3 h-3" />
            {entry.durationMs}ms
          </span>
          <span title={`UTC: ${entry.timestampUtc}`}>{entry.timestampIst}</span>
          <span className="text-slate-400">{entry.id}</span>
          <button
            type="button"
            onClick={() => onInspect(entry)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-sans font-medium"
          >
            <FileCode className="w-3 h-3" />
            JSON
          </button>
        </div>
      </div>

      {/* Body Grid */}
      <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 space-y-3.5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Question / Input • Actor: {entry.actor || "Visitor"}
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-900 whitespace-pre-wrap [overflow-wrap:anywhere] font-medium">
              {entry.question || "(empty)"}
            </div>
          </div>

          <div className="rounded-lg bg-slate-50/70 border border-slate-200 px-3 py-2 text-[11px] text-slate-600 flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong className="text-slate-800">Cache Trace:</strong>{" "}
              {entry.cacheDetails || "Standard"}
            </span>
            <span className="font-mono text-[10.5px] bg-white px-2.5 py-0.5 rounded border border-slate-200 text-slate-800">
              Tokens In:{" "}
              <strong>
                {(entry.tokenUsage?.inputTokens ?? 0).toLocaleString("en-IN")}
              </strong>{" "}
              • Tokens Out:{" "}
              <strong>
                {(entry.tokenUsage?.outputTokens ?? 0).toLocaleString("en-IN")}
              </strong>{" "}
              • Total:{" "}
              <strong>
                {(
                  (entry.tokenUsage?.inputTokens ?? 0) +
                  (entry.tokenUsage?.outputTokens ?? 0)
                ).toLocaleString("en-IN")}
              </strong>
              {entry.tokenUsage?.cacheReadInputTokens
                ? ` • Cache Read: ${entry.tokenUsage.cacheReadInputTokens.toLocaleString("en-IN")}`
                : ""}
            </span>
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center justify-between">
              <span>
                Products Looked Up (
                {entry.productLookupTriggered
                  ? `${entry.productsLookedUp.length} matched of ${entry.productLookupTotalScanned} scanned`
                  : "Lookup Not Triggered"}
                {entry.productLookupBudget
                  ? ` • Budget: ${entry.productLookupBudget}`
                  : ""}
                )
              </span>
              {entry.productLookupQuery && (
                <span className="font-mono text-[10.5px] normal-case text-slate-500">
                  query=&quot;{entry.productLookupQuery.slice(0, 55)}&quot;
                </span>
              )}
            </div>

            {!entry.productLookupTriggered ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500">
                No product catalog lookup needed for this step.
              </div>
            ) : entry.productsLookedUp.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-900">
                Catalog lookup ran against {entry.productLookupTotalScanned}{" "}
                items, and 0 items matched the strict query/budget filter.
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
                {entry.productsLookedUp.map((prod, idx) => (
                  <div
                    key={`${entry.id}_p_${idx}`}
                    className="px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-900 flex items-center gap-1.5 flex-wrap">
                        <span className="text-slate-400 font-mono">
                          {idx + 1}.
                        </span>
                        <span>{prod.name}</span>
                        {typeof prod.priceInr === "number" &&
                          prod.priceInr > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[10.5px]">
                              ₹{prod.priceInr.toLocaleString("en-IN")}
                            </span>
                          )}
                        {prod.sku && (
                          <span className="font-mono text-[10px] text-slate-500">
                            SKU: {prod.sku}
                          </span>
                        )}
                      </div>
                      {prod.reason && (
                        <div className="text-[11px] text-slate-500">
                          {prod.reason}
                        </div>
                      )}
                    </div>

                    {prod.url && (
                      <a
                        href={prod.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-600 hover:underline"
                      >
                        {prod.url.replace(/^https?:\/\//, "").slice(0, 28)}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Execution Steps Followed ({entry.steps.length})
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 space-y-1.5">
              {entry.steps.map((s, idx) => (
                <div
                  key={`${entry.id}_s_${idx}`}
                  className="text-xs flex items-start gap-2"
                >
                  <CheckCircle2
                    className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                      s.status === "ERROR"
                        ? "text-red-600"
                        : s.status === "WARN"
                        ? "text-amber-600"
                        : "text-emerald-600"
                    }`}
                  />
                  <div className="flex-1">
                    <span className="font-semibold text-slate-800">
                      {s.stepNumber || idx + 1}. {s.label}
                    </span>
                    {typeof s.durationMs === "number" && (
                      <span className="ml-1.5 font-mono text-[10.5px] text-slate-400">
                        (+{s.durationMs}ms)
                      </span>
                    )}
                    {s.detail && (
                      <div className="text-[11px] text-slate-600">{s.detail}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col justify-between space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Response Followed / Sent
              </span>
              <button
                type="button"
                onClick={() => onCopyText(entry.id, entry.response || "")}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800"
              >
                <Copy className="w-3 h-3" />
                {copiedId === entry.id ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="rounded-xl bg-[#efeae2] border border-stone-300 p-3.5 text-xs text-slate-900 whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed shadow-inner min-h-[160px]">
              {entry.response || "(empty response)"}
            </div>
          </div>

          {entry.error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <div className="font-bold mb-0.5">
                Diagnostic / Fallback Reason:
              </div>
              <div className="font-mono text-[11px] whitespace-pre-wrap [overflow-wrap:anywhere]">
                {entry.error}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
