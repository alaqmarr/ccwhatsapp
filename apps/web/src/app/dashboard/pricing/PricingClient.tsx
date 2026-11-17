"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";
import {
  ElementErrorState,
  MetricStatCard,
  StatCardsSkeleton,
  TableRowsSkeleton,
  formatDateTimeIst,
} from "@cc/ui";

interface CategoryBreakdown {
  category: string;
  messageCount: number;
  unitRateInr: number;
  totalBilledInr: number;
}

interface LedgerEntry {
  id: string;
  customerPhone: string;
  category: string;
  clientUnitRateInr: number;
  staffName: string;
  billedAt: string;
}

interface CostBreakdownPayload {
  ok: boolean;
  viewMode: "client_set_pricing";
  viewerIsDev?: boolean;
  currency: string;
  rates: {
    marketingRateInr: number;
    otherMessagesRateInr: number;
  };
  totals: {
    totalMessages: number;
    totalBilledInr: number;
  };
  byCategory: CategoryBreakdown[];
  recentEntries: LedgerEntry[];
}

function friendlyCategoryName(cat: string): string {
  switch (cat) {
    case "MARKETING":
      return "Marketing & Offer Templates";
    case "UTILITY":
      return "Order & Delivery Templates";
    case "AUTHENTICATION":
      return "Verification Code Templates";
    case "ACRIO":
      return "ACRIO Automated Replies";
    default:
      return cat;
  }
}

export function PricingClient({
  initialData,
}: {
  initialData?: CostBreakdownPayload;
}) {
  const [data, setData] = useState<CostBreakdownPayload | null>(
    initialData ?? null
  );
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");

  const loadPricing = useCallback(async () => {
    setRefreshing(true);
    setLoadError("");
    try {
      const res = await fetch("/api/pricing", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setData(json);
      } else {
        setLoadError(
          json.error || "Could not load cost breakdown right now."
        );
      }
    } catch {
      setLoadError(
        "Network error while loading cost breakdown. Click Try Again."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!initialData) {
      void loadPricing();
    }
  }, [initialData, loadPricing]);

  if (loading && !data) {
    return (
      <div className="w-full px-6 py-5 space-y-6">
        <div className="border-b border-neutral-200 pb-4">
          <h1 className="text-lg font-semibold text-neutral-900">
            Cost Breakdown
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Loading message rates, category totals, and billed message ledger...
          </p>
        </div>
        <StatCardsSkeleton count={3} />
        <StatCardsSkeleton count={2} />
        <TableRowsSkeleton rows={4} cols={4} />
        <TableRowsSkeleton rows={6} cols={5} />
      </div>
    );
  }

  if (loadError && !data) {
    return (
      <div className="w-full px-6 py-5 space-y-6">
        <div className="border-b border-neutral-200 pb-4">
          <h1 className="text-lg font-semibold text-neutral-900">
            Cost Breakdown
          </h1>
        </div>
        <ElementErrorState
          title="Could not load cost breakdown"
          message={loadError}
          onRetry={() => loadPricing()}
          retrying={refreshing}
        />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="w-full px-6 py-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Cost Breakdown
          </h1>
          <p className="text-[13.5px] leading-relaxed text-slate-500 mt-1">
            Superadmin view of WhatsApp message charges. Normal staff replies inside the 24-hour customer window and internal team notes cost ₹0.00. Charges apply only to ACRIO automated replies and approved WhatsApp templates.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {data.viewerIsDev && (
            <Link
              href="/dashboard/dev"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium"
            >
              <span>Dev Profit & Meta Costs</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
          <button
            type="button"
            onClick={() => loadPricing()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white hover:bg-neutral-50 border border-neutral-300 text-xs font-medium text-neutral-700 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Three Rate Boxes */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-emerald-50/70 rounded-xl border border-emerald-200 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-emerald-800">
            Staff Chat Replies & Internal Notes
          </div>
          <div className="metric-value text-[30px] font-bold text-emerald-950 mt-1.5">
            ₹0.00{" "}
            <span className="font-sans text-xs font-medium tracking-normal text-emerald-700">
              inside 24h window
            </span>
          </div>
          <p className="text-xs leading-relaxed text-emerald-800/90 mt-1.5">
            All regular WhatsApp replies sent by staff and private internal notes
          </p>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            ACRIO & Utility / Auth Templates
          </div>
          <div className="metric-value text-[30px] font-bold text-slate-900 mt-1.5">
            ₹{data.rates.otherMessagesRateInr.toFixed(2)}{" "}
            <span className="font-sans text-xs font-medium tracking-normal text-slate-500">
              per message
            </span>
          </div>
          <p className="text-xs leading-relaxed text-slate-500 mt-1.5">
            ACRIO automatic answers, order update templates, and OTP templates
          </p>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            Marketing Templates
          </div>
          <div className="metric-value text-[30px] font-bold text-slate-900 mt-1.5">
            ₹{data.rates.marketingRateInr.toFixed(2)}{" "}
            <span className="font-sans text-xs font-medium tracking-normal text-slate-500">
              per message
            </span>
          </div>
          <p className="text-xs leading-relaxed text-slate-500 mt-1.5">
            Promotions, seasonal offers, and catalog template broadcasts
          </p>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MetricStatCard
          label="Billed Messages Sent"
          value={String(data.totals.totalMessages)}
          subtext="ACRIO automated replies and templated messages"
        />
        <MetricStatCard
          label="Total Message Cost"
          value={`₹${data.totals.totalBilledInr.toFixed(2)}`}
          subtext={`Calculated at ₹${data.rates.marketingRateInr.toFixed(2)} / ₹${data.rates.otherMessagesRateInr.toFixed(2)}`}
        />
      </div>

      {/* Breakdown by Type */}
      <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900">
          Cost Breakdown by Message Type
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500">
                <th className="py-2.5 pr-3 font-medium">Message Type</th>
                <th className="py-2.5 px-3 font-medium">Count</th>
                <th className="py-2.5 px-3 font-medium">Rate per Message</th>
                <th className="py-2.5 pl-3 text-right font-medium">Total Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {data.byCategory.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-neutral-400">
                    No paid template or ACRIO messages recorded yet.
                  </td>
                </tr>
              ) : (
                data.byCategory.map((c) => (
                  <tr key={c.category}>
                    <td className="py-3 pr-3 font-medium text-neutral-900">
                      {friendlyCategoryName(c.category)}
                    </td>
                    <td className="py-3 px-3 text-neutral-700">{c.messageCount}</td>
                    <td className="py-3 px-3 font-mono">
                      ₹{c.unitRateInr.toFixed(2)}
                    </td>
                    <td className="py-3 pl-3 text-right font-mono font-semibold text-neutral-900">
                      ₹{c.totalBilledInr.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Billed Messages */}
      <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900">
          Recent Billed Messages
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500">
                <th className="py-2 pr-3 font-medium">Date & Time</th>
                <th className="py-2 px-3 font-medium">Customer Number</th>
                <th className="py-2 px-3 font-medium">Type</th>
                <th className="py-2 px-3 font-medium">Sent By</th>
                <th className="py-2 pl-3 text-right font-medium">Charge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {data.recentEntries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-neutral-400">
                    No billed messages yet.
                  </td>
                </tr>
              ) : (
                data.recentEntries.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2.5 pr-3 text-neutral-500">
                      {formatDateTimeIst(e.billedAt)}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-neutral-800">
                      {e.customerPhone}
                    </td>
                    <td className="py-2.5 px-3 text-neutral-700">
                      {friendlyCategoryName(e.category)}
                    </td>
                    <td className="py-2.5 px-3 text-neutral-700">{e.staffName}</td>
                    <td className="py-2.5 pl-3 text-right font-mono font-medium">
                      ₹{e.clientUnitRateInr.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
