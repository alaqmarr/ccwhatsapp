"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import {
  formatInt,
  formatUsd,
  statusBadgeMeta,
  type IntegrationUsageAndSpendSummary,
} from "./claude-usage-types";

export function ClaudeUsageIntegrationCard({
  side,
}: {
  side: IntegrationUsageAndSpendSummary;
}) {
  const isAcrio = side.integration === "ACRIO";
  const usageBadge = statusBadgeMeta(side.usageStatus);
  const spendBadge = statusBadgeMeta(side.spendStatus);

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-2xs flex flex-col overflow-hidden">
      <div
        className={`px-4 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 ${
          isAcrio ? "bg-emerald-50/60" : "bg-indigo-50/60"
        }`}
      >
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider ${
                isAcrio ? "bg-emerald-600 text-white" : "bg-indigo-600 text-white"
              }`}
            >
              {side.integration}
            </span>
            <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
              {side.identity.label}
            </h2>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">{side.identity.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${usageBadge.className}`}>
            Usage: {usageBadge.label}
          </span>
          <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${spendBadge.className}`}>
            Spend: {spendBadge.label}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4 flex-1 flex flex-col">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200/80 text-xs">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Anthropic Organization
            </span>
            <span className="font-mono font-semibold text-slate-800 break-all">
              {side.identity.organizationName
                ? `${side.identity.organizationName} (${side.identity.organizationId})`
                : side.identity.organizationId || "Not detected"}
            </span>
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Runtime Inference Key
            </span>
            <span className="font-mono font-semibold text-slate-800">
              {side.identity.runtimeKeyPrefix || "Not configured"}{" "}
              <span className="text-[10px] text-slate-500 font-sans">
                ({side.identity.runtimeKeyType.replace(/_/g, " ")})
              </span>
            </span>
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Spend Attribution Workspace ID
            </span>
            <span className="font-mono font-semibold text-slate-800">
              {side.identity.workspaceId
                ? `${side.identity.workspaceName ? `${side.identity.workspaceName} · ` : ""}${side.identity.workspaceId}`
                : `Unconfigured (${side.identity.workspaceEnvVar})`}
            </span>
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Usage Attribution API Key ID
            </span>
            <span className="font-mono font-semibold text-slate-800">
              {side.identity.apiKeyId
                ? `${side.identity.apiKeyName ? `${side.identity.apiKeyName} · ` : ""}${side.identity.apiKeyId}`
                : `Unconfigured (${side.identity.apiKeyIdEnvVar})`}
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {side.spendLabel}
            </span>
            <span className="text-[11px] font-mono text-slate-400">Currency: USD</span>
          </div>

          {side.perKeySpendAvailable && side.totalSpendUsd !== null ? (
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-black text-slate-900">
                {formatUsd(side.totalSpendUsd)}
              </span>
              <span className="text-xs font-mono text-slate-500">
                ({side.totalSpendCents?.toFixed(2)}¢ USD cents)
              </span>
            </div>
          ) : side.totalSpendUsd !== null && side.identity.sharedWithUnrelatedIntegrations ? (
            <div className="space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-black text-amber-800">
                  {formatUsd(side.totalSpendUsd)}
                </span>
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-bold">
                  Workspace Total (Includes Unrelated Integrations)
                </span>
              </div>
              <p className="text-[11px] text-amber-800">
                Per-key spend is unavailable because this workspace also serves other API keys.
              </p>
            </div>
          ) : (
            <div className="py-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 border border-purple-200 text-purple-900 text-xs font-bold">
                <AlertTriangle className="w-3.5 h-3.5 text-purple-700 shrink-0" />
                <span>Per-Key Spend Unavailable</span>
              </span>
            </div>
          )}

          <p className="text-[11px] text-slate-600 leading-relaxed">{side.spendStatusMessage}</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800">
              Token Consumption (Anthropic usage_report/messages)
            </span>
            <span className="text-[11px] text-slate-500">
              Total: <strong className="text-slate-900">{formatInt(side.tokens.totalTokens)}</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                Uncached Input
              </span>
              <span className="text-sm font-extrabold text-slate-900 font-mono">
                {formatInt(side.tokens.inputTokens)}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                Output Tokens
              </span>
              <span className="text-sm font-extrabold text-slate-900 font-mono">
                {formatInt(side.tokens.outputTokens)}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-50/50 border border-emerald-200/80">
              <span className="text-[10px] font-bold uppercase text-emerald-700 block">
                Cache Read
              </span>
              <span className="text-sm font-extrabold text-emerald-900 font-mono">
                {formatInt(side.tokens.cacheReadTokens)}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-sky-50/50 border border-sky-200/80">
              <span className="text-[10px] font-bold uppercase text-sky-700 block">
                Cache Write
              </span>
              <span className="text-sm font-extrabold text-sky-900 font-mono">
                {formatInt(side.tokens.cacheWriteTokens)}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">{side.usageStatusMessage}</p>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-xs font-bold text-slate-800">Tokens by API Key &amp; Model</h3>
          {side.byKeyAndModel.length === 0 ? (
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500">
              {side.usageStatus === "ZERO_USAGE"
                ? "0 token rows returned for this API key in the selected UTC range."
                : "No attributed API key + model rows available."}
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse text-xs min-w-[560px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                    <th className="py-2 px-2.5">API Key ID</th>
                    <th className="py-2 px-2.5">Model</th>
                    <th className="py-2 px-2.5 text-right">Input</th>
                    <th className="py-2 px-2.5 text-right">Output</th>
                    <th className="py-2 px-2.5 text-right">Cache Read</th>
                    <th className="py-2 px-2.5 text-right">Cache Write</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {side.byKeyAndModel.map((row) => (
                    <tr key={`${row.apiKeyId}-${row.model}`}>
                      <td className="py-1.5 px-2.5 text-slate-800">{row.apiKeyId}</td>
                      <td className="py-1.5 px-2.5 text-indigo-700 font-semibold">{row.model}</td>
                      <td className="py-1.5 px-2.5 text-right">{formatInt(row.inputTokens)}</td>
                      <td className="py-1.5 px-2.5 text-right">{formatInt(row.outputTokens)}</td>
                      <td className="py-1.5 px-2.5 text-right text-emerald-700">
                        {formatInt(row.cacheReadTokens)}
                      </td>
                      <td className="py-1.5 px-2.5 text-right text-sky-700">
                        {formatInt(row.cacheWriteTokens)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {side.dailySpend.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-xs font-bold text-slate-800">
              Daily Spend Breakdown (UTC): {side.spendLabel}
            </h3>
            <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-56 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs min-w-[560px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                    <th className="py-2 px-2.5">Date (UTC)</th>
                    <th className="py-2 px-2.5 text-right">USD Cents</th>
                    <th className="py-2 px-2.5 text-right">Spend (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {side.dailySpend.map((d) => (
                    <tr key={d.dateUtc}>
                      <td className="py-1.5 px-2.5 text-slate-800">{d.dateUtc}</td>
                      <td className="py-1.5 px-2.5 text-right text-slate-600">
                        {d.amountCents.toFixed(2)}¢
                      </td>
                      <td className="py-1.5 px-2.5 text-right font-bold text-slate-900">
                        {formatUsd(d.spendUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
