"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import {
  ElementErrorState,
  MetricStatCard,
  StatCardsSkeleton,
  TableRowsSkeleton,
} from "@cc/ui";

interface CategoryBreakdown {
  category: string;
  messageCount: number;
  unitRateInr: number;
  totalBilledInr: number;
  actualMetaCostInr?: number;
  netMarginInr?: number;
}

interface LedgerEntry {
  id: string;
  customerPhone: string;
  category: string;
  clientUnitRateInr: number;
  actualMetaUnitCostInr?: number;
  marginInr?: number;
  staffName: string;
  billedAt: string;
}

interface PricingPayload {
  ok: boolean;
  viewMode: "client_set_pricing" | "dev_actual_and_margin";
  currency: string;
  rates: {
    marketingRateInr: number;
    otherMessagesRateInr: number;
    actualMetaMarketingRateInr?: number;
    actualMetaUtilityRateInr?: number;
    actualMetaAuthRateInr?: number;
    actualMetaServiceRateInr?: number;
  };
  totals: {
    totalMessages: number;
    totalBilledInr: number;
    totalActualMetaCostInr?: number;
    totalNetMarginInr?: number;
    marginPercentage?: number;
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

export default function PricingDashboardPage() {
  const [data, setData] = useState<PricingPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [savedNotice, setSavedNotice] = useState<string>("");

  // DEV rate editor state
  const [clientMkt, setClientMkt] = useState<string>("0.95");
  const [clientOther, setClientOther] = useState<string>("0.30");
  const [metaMkt, setMetaMkt] = useState<string>("0.7846");
  const [metaUtil, setMetaUtil] = useState<string>("0.1150");
  const [metaAuth, setMetaUtilAuth] = useState<string>("0.1150");
  const [metaServ, setMetaServ] = useState<string>("0.0800");

  const loadPricing = useCallback(async () => {
    setRefreshing(true);
    setLoadError("");
    try {
      const res = await fetch("/api/pricing", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setData(json);
        setClientMkt(String(json.rates.marketingRateInr ?? 0.95));
        setClientOther(String(json.rates.otherMessagesRateInr ?? 0.3));
        if (json.viewMode === "dev_actual_and_margin") {
          setMetaMkt(String(json.rates.actualMetaMarketingRateInr ?? 0.7846));
          setMetaUtil(String(json.rates.actualMetaUtilityRateInr ?? 0.115));
          setMetaUtilAuth(String(json.rates.actualMetaAuthRateInr ?? 0.115));
          setMetaServ(String(json.rates.actualMetaServiceRateInr ?? 0.08));
        }
      } else {
        setLoadError(
          json.error || "Could not load message rates and usage right now."
        );
      }
    } catch {
      setLoadError(
        "Network error while loading message charges. Click Try Again."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadPricing();
  }, [loadPricing]);

  async function handleSaveDevRates(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientMarketingRateInr: Number(clientMkt),
          clientOtherRateInr: Number(clientOther),
          actualMetaMarketingRateInr: Number(metaMkt),
          actualMetaUtilityRateInr: Number(metaUtil),
          actualMetaAuthRateInr: Number(metaAuth),
          actualMetaServiceRateInr: Number(metaServ),
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (out.ok) {
        setSavedNotice("Rates updated.");
        setTimeout(() => setSavedNotice(""), 3500);
        await loadPricing();
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="w-full px-6 py-5 space-y-6">
        <div className="border-b border-neutral-200 pb-4">
          <h1 className="text-lg font-semibold text-neutral-900">
            WhatsApp Message Rates & Usage
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Loading current rates, category totals, and recent message ledger...
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
            WhatsApp Message Rates & Usage
          </h1>
        </div>
        <ElementErrorState
          title="Could not load message charges"
          message={loadError}
          onRetry={() => loadPricing()}
          retrying={refreshing}
        />
      </div>
    );
  }

  if (!data) return null;

  const isDev = data.viewMode === "dev_actual_and_margin";

  return (
    <div className="w-full px-6 py-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            {isDev
              ? "Developer Pricing: Actual Meta Cost vs Client Rate"
              : "WhatsApp Message Rates & Usage"}
          </h1>
          <p className="text-[13.5px] leading-relaxed text-slate-500 mt-1 max-w-3xl">
            {isDev
              ? "Normal staff chat replies and internal notes are free (₹0.00). Charges apply only to ACRIO automated replies (₹0.30) and templated messages (₹0.95 Marketing, ₹0.30 Utility/Auth)."
              : "Normal staff chat replies inside the 24-hour window are completely free (₹0.00). Charges apply only to ACRIO automated replies (₹0.30) and templated messages (₹0.95 Marketing, ₹0.30 Utility/Verification)."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {savedNotice && (
            <div className="px-3.5 py-2 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
              {savedNotice}
            </div>
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

      {/* Three Rate Boxes: Free Staff Chat, ACRIO & Utility Templates, Marketing Templates */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-emerald-50/70 rounded-xl border border-emerald-200 p-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-emerald-800">
              Staff Chat Replies & Internal Notes
            </div>
            <div className="metric-value text-[30px] font-bold text-emerald-950 mt-1.5">
              ₹0.00{" "}
              <span className="font-sans text-xs font-medium tracking-normal text-emerald-700">
                free inside 24h window
              </span>
            </div>
            <p className="text-xs leading-relaxed text-emerald-800/90 mt-1.5">
              All normal WhatsApp chat replies by staff and private team notes
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 p-5 flex items-center justify-between gap-4 shadow-2xs">
          <div>
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
              ACRIO automatic answers, order templates, and OTP templates
            </p>
          </div>
          {isDev && (
            <div className="text-right bg-slate-50 border border-neutral-200 rounded-lg p-3 shrink-0 text-xs tabular-nums">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-500">
                Actual Wholesale
              </div>
              <div className="font-semibold text-slate-900 mt-1">
                Utility / Auth: ₹{(data.rates.actualMetaUtilityRateInr ?? 0).toFixed(3)}
              </div>
              <div className="font-semibold text-slate-900">
                ACRIO Cost: ₹0.040
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 p-5 flex items-center justify-between gap-4 shadow-2xs">
          <div>
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
              Promotions, festival offers, and catalog template broadcasts
            </p>
          </div>
          {isDev && (
            <div className="text-right bg-neutral-50 border border-neutral-200 rounded-md p-3 shrink-0">
              <div className="text-[11px] text-neutral-500">Actual Meta Cost</div>
              <div className="text-base font-semibold text-neutral-900">
                ₹{(data.rates.actualMetaMarketingRateInr ?? 0).toFixed(4)}
              </div>
              <div className="text-xs font-medium text-emerald-700">
                +₹
                {(
                  data.rates.marketingRateInr -
                  (data.rates.actualMetaMarketingRateInr ?? 0)
                ).toFixed(4)}{" "}
                margin
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Totals */}
      <div
        className={`grid grid-cols-1 ${
          isDev ? "sm:grid-cols-4" : "sm:grid-cols-2"
        } gap-4`}
      >
        <MetricStatCard
          label="Messages Sent"
          value={String(data.totals.totalMessages)}
          subtext="All outbound messages"
        />
        <MetricStatCard
          label={isDev ? "Client Billed Total" : "Total Amount"}
          value={`₹${data.totals.totalBilledInr.toFixed(2)}`}
          subtext="Calculated at ₹0.95 / ₹0.30"
        />
        {isDev && (
          <>
            <MetricStatCard
              label="Actual Meta Cost"
              value={`₹${(data.totals.totalActualMetaCostInr ?? 0).toFixed(2)}`}
              subtext="Direct Meta charges"
            />
            <MetricStatCard
              label="Net Margin"
              value={`₹${(data.totals.totalNetMarginInr ?? 0).toFixed(2)}`}
              subtext={`${data.totals.marginPercentage ?? 0}% margin`}
            />
          </>
        )}
      </div>

      {/* Breakdown by Type */}
      <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900">
          Summary by Message Type
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500">
                <th className="py-2.5 pr-3 font-medium">Message Type</th>
                <th className="py-2.5 px-3 font-medium">Count</th>
                <th className="py-2.5 px-3 font-medium">Rate per Message</th>
                <th className="py-2.5 px-3 font-medium">Total</th>
                {isDev && (
                  <>
                    <th className="py-2.5 px-3 font-medium">Actual Meta Cost</th>
                    <th className="py-2.5 pl-3 text-right font-medium">Margin</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {data.byCategory.map((c) => (
                <tr key={c.category}>
                  <td className="py-3 pr-3 font-medium text-neutral-900">
                    {friendlyCategoryName(c.category)}
                  </td>
                  <td className="py-3 px-3 text-neutral-700">{c.messageCount}</td>
                  <td className="py-3 px-3 font-mono">
                    ₹{c.unitRateInr.toFixed(2)}
                  </td>
                  <td className="py-3 px-3 font-semibold text-neutral-900">
                    ₹{c.totalBilledInr.toFixed(2)}
                  </td>
                  {isDev && (
                    <>
                      <td className="py-3 px-3 font-mono text-neutral-700">
                        ₹{(c.actualMetaCostInr ?? 0).toFixed(4)}
                      </td>
                      <td className="py-3 pl-3 text-right font-semibold text-emerald-700">
                        +₹{(c.netMarginInr ?? 0).toFixed(4)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Light-Mode DEV Rate Editor */}
      {isDev && (
        <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Edit Client & Meta Rates (Dev Only)
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Changes apply to future messages. Admins, Superadmins, and Clients only see the two Client rates.
            </p>
          </div>

          <form
            onSubmit={handleSaveDevRates}
            className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs"
          >
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Client Marketing (₹)
              </label>
              <input
                type="number"
                step="0.01"
                value={clientMkt}
                onChange={(e) => setClientMkt(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Client Other / Auth (₹)
              </label>
              <input
                type="number"
                step="0.01"
                value={clientOther}
                onChange={(e) => setClientOther(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Meta Marketing (₹)
              </label>
              <input
                type="number"
                step="0.0001"
                value={metaMkt}
                onChange={(e) => setMetaMkt(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Meta Order Update (₹)
              </label>
              <input
                type="number"
                step="0.0001"
                value={metaUtil}
                onChange={(e) => setMetaUtil(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Meta Auth (₹)
              </label>
              <input
                type="number"
                step="0.0001"
                value={metaAuth}
                onChange={(e) => setMetaUtilAuth(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Meta Support (₹)
              </label>
              <input
                type="number"
                step="0.0001"
                value={metaServ}
                onChange={(e) => setMetaServ(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
            </div>

            <div className="sm:col-span-3 lg:col-span-6 flex justify-end pt-1">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? "Saving..." : "Save Rates"}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Recent Messages */}
      <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900">
          Recent Sent Messages
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500">
                <th className="py-2 pr-3 font-medium">Date & Time</th>
                <th className="py-2 px-3 font-medium">Customer Number</th>
                <th className="py-2 px-3 font-medium">Type</th>
                <th className="py-2 px-3 font-medium">Sent By</th>
                <th className="py-2 px-3 text-right font-medium">Charge</th>
                {isDev && (
                  <>
                    <th className="py-2 px-3 text-right font-medium">
                      Actual Meta
                    </th>
                    <th className="py-2 pl-3 text-right font-medium">Margin</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {data.recentEntries.map((e) => (
                <tr key={e.id}>
                  <td className="py-2.5 pr-3 text-neutral-500">
                    {new Date(e.billedAt).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-neutral-800">
                    {e.customerPhone}
                  </td>
                  <td className="py-2.5 px-3 text-neutral-700">
                    {friendlyCategoryName(e.category)}
                  </td>
                  <td className="py-2.5 px-3 text-neutral-700">{e.staffName}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-medium">
                    ₹{e.clientUnitRateInr.toFixed(2)}
                  </td>
                  {isDev && (
                    <>
                      <td className="py-2.5 px-3 text-right font-mono text-neutral-600">
                        ₹{(e.actualMetaUnitCostInr ?? 0).toFixed(4)}
                      </td>
                      <td className="py-2.5 pl-3 text-right font-mono font-medium text-emerald-700">
                        +₹{(e.marginInr ?? 0).toFixed(4)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
