"use client";

import React from "react";
import { formatUsd, type SharedWorkspaceSpendSummary } from "./claude-usage-types";

export function ClaudeUsageSharedWorkspaceCard({
  shared,
}: {
  shared: SharedWorkspaceSpendSummary;
}) {
  return (
    <div className="bg-white border-2 border-purple-200 rounded-xl p-4 sm:p-5 shadow-2xs space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-900 text-[10px] font-extrabold uppercase tracking-wider">
            Shared Workspace Spend
          </span>
          <h2 className="text-base font-extrabold text-slate-900 mt-1">{shared.spendLabel}</h2>
          <p className="text-xs text-slate-600">
            Both Acrio and Acro share workspace{" "}
            <code className="font-mono font-bold">{shared.workspaceId}</code>. Token usage is separated by API key ID below, while spend is reported at the workspace level.
          </p>
        </div>

        <div className="text-right">
          <div className="text-2xl sm:text-3xl font-black text-purple-900">
            {formatUsd(shared.totalSpendUsd)}
          </div>
          <div className="text-xs font-mono text-slate-500">
            ({shared.totalSpendCents.toFixed(2)}¢ USD cents)
          </div>
        </div>
      </div>

      {shared.dailySpend.length > 0 && (
        <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-56 overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[560px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                <th className="py-2 px-3">Date (UTC)</th>
                <th className="py-2 px-3 text-right">USD Cents</th>
                <th className="py-2 px-3 text-right">Shared Workspace Spend (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
              {shared.dailySpend.map((d) => (
                <tr key={d.dateUtc}>
                  <td className="py-1.5 px-3 text-slate-800">{d.dateUtc}</td>
                  <td className="py-1.5 px-3 text-right text-slate-600">
                    {d.amountCents.toFixed(2)}¢
                  </td>
                  <td className="py-1.5 px-3 text-right font-bold text-slate-900">
                    {formatUsd(d.spendUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
