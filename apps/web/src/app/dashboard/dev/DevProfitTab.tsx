"use client";

import React from "react";
import Link from "next/link";
import { MetricStatCard } from "@cc/ui";
import {
  friendlyCategoryName,
  type DevAnalyticsSlice,
  type DevPricingPayload,
} from "./dev-types";
import {
  DevRateAndLedgerSection,
  type RateFormState,
} from "./DevRateAndLedgerSection";

export default function DevProfitTab({
  pricing,
  analytics,
  range,
  onRangeChange,
  rateForm,
}: {
  pricing: DevPricingPayload;
  analytics: DevAnalyticsSlice | null;
  range: string;
  onRangeChange: (r: string) => void;
  rateForm: RateFormState;
}) {
  const activeGstPct = pricing.rates.gstRatePct ?? 18;
  const gstMult = 1 + activeGstPct / 100;
  const mktWithGst = pricing.rates.actualMetaMarketingRateInr * gstMult;
  const utilWithGst = pricing.rates.actualMetaUtilityRateInr * gstMult;
  const netProfit = pricing.totals.totalNetMarginInr;
  const netProfitPositive = netProfit >= 0;
  const aiWa = pricing.aiCosts?.whatsappHub;
  const aiWeb = pricing.aiCosts?.websitesOnly;
  const aiAll = pricing.aiCosts?.allEcosystem;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricStatCard
          label="Client Billed Total"
          value={`₹${pricing.totals.totalBilledInr.toFixed(2)}`}
          subtext={`Live: ₹${(pricing.totals.liveClientBilledInr ?? 0).toFixed(2)} (${pricing.totals.liveMessagesCount ?? 0}) • Sandbox/Seed: ${pricing.totals.sandboxOrSeedMessagesCount ?? 0}`}
        />
        <MetricStatCard
          label={`Actual Cost (incl. ${activeGstPct}% GST)`}
          value={`₹${pricing.totals.totalActualMetaCostInr.toFixed(2)}`}
          subtext={`Meta ₹${(pricing.totals.totalMetaWithGstInr ?? 0).toFixed(2)} + WA AI ₹${(aiWa?.totalWithGstInr ?? 0).toFixed(2)} (ex-GST ₹${(pricing.totals.totalActualCostExGstInr ?? 0).toFixed(2)})`}
        />
        <MetricStatCard
          label={`WhatsApp Net Profit (incl. ${activeGstPct}% GST)`}
          value={`${netProfitPositive ? "+" : "-"}₹${Math.abs(netProfit).toFixed(2)}`}
          subtext={`Ex-GST: ${(pricing.totals.totalNetMarginExGstInr ?? 0) >= 0 ? "+" : "-"}₹${Math.abs(pricing.totals.totalNetMarginExGstInr ?? 0).toFixed(2)} • Margin ${pricing.totals.marginPercentage}%`}
        />
        <MetricStatCard
          label={`Full Ecosystem AI + Meta (${activeGstPct}% GST)`}
          value={`₹${(pricing.totals.totalEcosystemCostWithGstInr ?? pricing.totals.totalActualMetaCostInr).toFixed(2)}`}
          subtext={`WA AI $${(aiWa?.totalUsd ?? 0).toFixed(2)} + Sites AI $${(aiWeb?.totalUsd ?? 0).toFixed(2)} (@ ₹${(pricing.aiCosts?.usdToInrRate ?? 93.4).toFixed(2)}/$)`}
        />
      </div>

      {mktWithGst > pricing.rates.marketingRateInr && (
        <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900">
          <strong>Wholesale Margin Alert ({activeGstPct}% GST included):</strong> Meta India Marketing (₹{pricing.rates.actualMetaMarketingRateInr.toFixed(4)} + {activeGstPct}% GST = <strong>₹{mktWithGst.toFixed(4)}</strong>) exceeds your current Client Marketing charge of <strong>₹{pricing.rates.marketingRateInr.toFixed(2)}</strong> by <strong>₹{(mktWithGst - pricing.rates.marketingRateInr).toFixed(4)}/msg</strong> (if GST Input Credit is not reclaimed).
        </div>
      )}

      {aiAll && (
        <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Actual Claude Haiku AI Cost Breakdown (from ai.logs @ ₹{pricing.aiCosts?.usdToInrRate.toFixed(2)}/USD + {activeGstPct}% GST)
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                Includes uncached input ($1/M), 5-min cache write ($1.25/M), cache read ($0.10/M), and output ($5/M) across all traces.
              </p>
            </div>
            <Link
              href="/dashboard/claude-usage"
              className="text-xs font-semibold text-indigo-700 hover:underline"
            >
              Compare with Anthropic Live Billing API
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3.5 rounded-lg bg-indigo-50/70 border border-indigo-200 space-y-1">
              <div className="font-semibold text-indigo-950">WhatsApp Hub (ACRIO)</div>
              <div className="text-base font-bold text-indigo-950 font-mono">
                ₹{(aiWa?.totalWithGstInr ?? 0).toFixed(2)}{" "}
                <span className="text-[11px] font-normal text-indigo-800">
                  (Base ₹{(aiWa?.baseInr ?? 0).toFixed(2)} + GST ₹{(aiWa?.gstInr ?? 0).toFixed(2)} | ${(aiWa?.totalUsd ?? 0).toFixed(4)})
                </span>
              </div>
              <div className="text-[11px] text-indigo-800">
                {aiWa?.billedCalls ?? 0} calls • In {(aiWa?.inputTokens ?? 0).toLocaleString("en-IN")} • Cache W {(aiWa?.cacheWriteTokens ?? 0).toLocaleString("en-IN")} • R {(aiWa?.cacheReadTokens ?? 0).toLocaleString("en-IN")} • Out {(aiWa?.outputTokens ?? 0).toLocaleString("en-IN")}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-amber-50/70 border border-amber-200 space-y-1">
              <div className="font-semibold text-amber-950">Websites (classicconcepts.in + CE53)</div>
              <div className="text-base font-bold text-amber-950 font-mono">
                ₹{(aiWeb?.totalWithGstInr ?? 0).toFixed(2)}{" "}
                <span className="text-[11px] font-normal text-amber-800">
                  (Base ₹{(aiWeb?.baseInr ?? 0).toFixed(2)} + GST ₹{(aiWeb?.gstInr ?? 0).toFixed(2)} | ${(aiWeb?.totalUsd ?? 0).toFixed(4)})
                </span>
              </div>
              <div className="text-[11px] text-amber-800">
                {aiWeb?.billedCalls ?? 0} calls • In {(aiWeb?.inputTokens ?? 0).toLocaleString("en-IN")} • Cache W {(aiWeb?.cacheWriteTokens ?? 0).toLocaleString("en-IN")} • R {(aiWeb?.cacheReadTokens ?? 0).toLocaleString("en-IN")} • Out {(aiWeb?.outputTokens ?? 0).toLocaleString("en-IN")}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-300 space-y-1">
              <div className="font-semibold text-slate-900">All Ecosystem AI Total</div>
              <div className="text-base font-bold text-slate-900 font-mono">
                ₹{aiAll.totalWithGstInr.toFixed(2)}{" "}
                <span className="text-[11px] font-normal text-slate-600">
                  (Base ₹{aiAll.baseInr.toFixed(2)} + GST ₹{aiAll.gstInr.toFixed(2)} | ${aiAll.totalUsd.toFixed(4)})
                </span>
              </div>
              <div className="text-[11px] text-slate-600">
                {aiAll.billedCalls} billed calls ({aiAll.tracesCount} traces) • Avg ₹{aiAll.billedCalls > 0 ? (aiAll.totalWithGstInr / aiAll.billedCalls).toFixed(2) : "0.00"}/call incl. GST
              </div>
            </div>
          </div>
        </div>
      )}

      {analytics && (
        <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Period Profit & Traffic Analytics
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                Compare message volume, client billing, actual Meta + WhatsApp AI spend (incl. {activeGstPct}% GST), and net profit by time window.
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {[
                { id: "today", label: "Today" },
                { id: "7d", label: "7 Days" },
                { id: "30d", label: "30 Days" },
                { id: "90d", label: "90 Days" },
                { id: "all", label: "All Time" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onRangeChange(opt.id)}
                  className={`px-2.5 py-1.5 rounded text-xs font-medium cursor-pointer ${
                    range === opt.id
                      ? "bg-slate-900 text-white"
                      : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
              <div className="text-neutral-500">Period Client Billed</div>
              <div className="text-base font-bold text-neutral-900 mt-1 font-mono">
                ₹{(analytics.kpis.clientBilledInr ?? 0).toFixed(2)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
              <div className="text-neutral-500">Meta + {activeGstPct}% GST</div>
              <div className="text-base font-bold text-neutral-900 mt-1 font-mono">
                ₹{(analytics.kpis.metaWholesaleWithGstInr ?? 0).toFixed(2)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-indigo-50/60 border border-indigo-200">
              <div className="text-indigo-800 font-medium">WA AI + {activeGstPct}% GST</div>
              <div className="text-base font-bold text-indigo-950 mt-1 font-mono">
                ₹{(analytics.kpis.whatsappAiCostWithGstInr ?? 0).toFixed(2)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-amber-50/60 border border-amber-200">
              <div className="text-amber-800 font-medium">Sites AI + {activeGstPct}% GST</div>
              <div className="text-base font-bold text-amber-950 mt-1 font-mono">
                ₹{((analytics.kpis.ecosystemAiCostWithGstInr ?? 0) - (analytics.kpis.whatsappAiCostWithGstInr ?? 0)).toFixed(2)}
              </div>
            </div>
            <div
              className={`p-3 rounded-lg border ${
                (analytics.kpis.netMarginInr ?? 0) >= 0
                  ? "bg-emerald-50 border-emerald-200"
                  : "bg-rose-50 border-rose-200"
              }`}
            >
              <div
                className={`font-medium ${
                  (analytics.kpis.netMarginInr ?? 0) >= 0 ? "text-emerald-800" : "text-rose-800"
                }`}
              >
                Period Net Profit
              </div>
              <div
                className={`text-base font-bold mt-1 font-mono ${
                  (analytics.kpis.netMarginInr ?? 0) >= 0 ? "text-emerald-900" : "text-rose-900"
                }`}
              >
                {(analytics.kpis.netMarginInr ?? 0) >= 0 ? "+" : "-"}₹
                {Math.abs(analytics.kpis.netMarginInr ?? 0).toFixed(2)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-indigo-50/40 border border-indigo-200">
              <div className="text-indigo-800 font-medium">AI Tokens In / Out</div>
              <div className="text-sm font-bold text-indigo-950 mt-1 font-mono">
                {(analytics.kpis.aiTokensIn ?? 0).toLocaleString("en-IN")} /{" "}
                {(analytics.kpis.aiTokensOut ?? 0).toLocaleString("en-IN")}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
              <div className="text-neutral-500">ACRIO Turns</div>
              <div className="text-base font-bold text-neutral-900 mt-1 font-mono">
                {analytics.kpis.acrioRepliesCount}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
              <div className="text-neutral-500">Templates / Staff</div>
              <div className="text-base font-bold text-neutral-900 mt-1 font-mono">
                {analytics.kpis.templateMessagesCount} / {analytics.kpis.freeStaffRepliesCount}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900">
          Profit & Margin by Message Category (Meta Rates + Actual AI + {activeGstPct}% GST)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[740px]">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500">
                <th className="py-2.5 pr-3 font-medium">Message Type</th>
                <th className="py-2.5 px-3 font-medium">Count</th>
                <th className="py-2.5 px-3 font-medium">Client Rate</th>
                <th className="py-2.5 px-3 font-medium">Client Total</th>
                <th className="py-2.5 px-3 font-medium">Base Cost</th>
                <th className="py-2.5 px-3 font-medium">{activeGstPct}% GST</th>
                <th className="py-2.5 px-3 font-medium">Total Cost Incl. GST</th>
                <th className="py-2.5 pl-3 text-right font-medium">Net Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {pricing.byCategory.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-neutral-400">
                    No paid messages recorded yet.
                  </td>
                </tr>
              ) : (
                pricing.byCategory.map((c) => {
                  const baseCost = (c.metaBaseCostInr ?? 0) + (c.aiBaseCostInr ?? 0);
                  const gstCost = (c.metaGstInr ?? 0) + (c.aiGstInr ?? 0);
                  const totalCost = c.actualMetaCostInr ?? 0;
                  const margin = c.netMarginInr ?? 0;
                  return (
                    <tr key={c.category}>
                      <td className="py-3 pr-3 font-medium text-neutral-900">
                        {friendlyCategoryName(c.category)}
                        {c.category === "ACRIO" && (
                          <span className="block text-[10.5px] font-normal text-indigo-700">
                            Meta 24h fee ₹0 + Real WhatsApp Claude Haiku tokens
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-neutral-700">{c.messageCount}</td>
                      <td className="py-3 px-3 font-mono">₹{c.unitRateInr.toFixed(2)}</td>
                      <td className="py-3 px-3 font-mono font-semibold text-neutral-900">
                        ₹{c.totalBilledInr.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 font-mono text-neutral-600">
                        ₹{baseCost.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 font-mono text-neutral-600">
                        ₹{gstCost.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 font-mono font-medium text-neutral-900">
                        ₹{totalCost.toFixed(2)}
                      </td>
                      <td
                        className={`py-3 pl-3 text-right font-mono font-semibold ${
                          margin >= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {margin >= 0 ? "+" : "-"}₹{Math.abs(margin).toFixed(2)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DevRateAndLedgerSection
        pricing={pricing}
        activeGstPct={activeGstPct}
        mktWithGst={mktWithGst}
        utilWithGst={utilWithGst}
        gstMult={gstMult}
        rateForm={rateForm}
      />
    </div>
  );
}
