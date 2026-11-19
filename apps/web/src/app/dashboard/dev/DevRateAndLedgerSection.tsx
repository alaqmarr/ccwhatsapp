"use client";

import React from "react";
import { Save } from "lucide-react";
import { formatDateTimeIst } from "@cc/ui";
import { friendlyCategoryName, type DevPricingPayload } from "./dev-types";

export interface RateFormState {
  clientMkt: string;
  setClientMkt: (v: string) => void;
  clientOther: string;
  setClientOther: (v: string) => void;
  metaMkt: string;
  setMetaMkt: (v: string) => void;
  metaUtil: string;
  setMetaUtil: (v: string) => void;
  metaAuth: string;
  setMetaAuth: (v: string) => void;
  metaServ: string;
  setMetaServ: (v: string) => void;
  gstRatePct: string;
  setGstRatePct: (v: string) => void;
  usdToInrRate: string;
  setUsdToInrRate: (v: string) => void;
  savingRates: boolean;
  onSaveDevRates: (e: React.FormEvent) => void;
}

export function DevRateAndLedgerSection({
  pricing,
  activeGstPct,
  mktWithGst,
  utilWithGst,
  gstMult,
  rateForm,
}: {
  pricing: DevPricingPayload;
  activeGstPct: number;
  mktWithGst: number;
  utilWithGst: number;
  gstMult: number;
  rateForm: RateFormState;
}) {
  return (
    <>
      <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">
            Configure Client Rates, Meta India Wholesale Rates, GST &amp; USD/INR
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Meta India base rates ex-GST (Marketing ₹0.8631, Utility ₹0.1150, Auth ₹0.1150, 24h Service ₹0.00). Enter base rates below and GST ({activeGstPct}%) is calculated automatically.
          </p>
        </div>

        <form
          onSubmit={rateForm.onSaveDevRates}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs"
        >
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Client Marketing (₹)
            </label>
            <input
              type="number"
              step="0.01"
              value={rateForm.clientMkt}
              onChange={(e) => rateForm.setClientMkt(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Client ACRIO / Utility (₹)
            </label>
            <input
              type="number"
              step="0.01"
              value={rateForm.clientOther}
              onChange={(e) => rateForm.setClientOther(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Meta Marketing Base (₹)
            </label>
            <input
              type="number"
              step="0.0001"
              value={rateForm.metaMkt}
              onChange={(e) => rateForm.setMetaMkt(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
            />
            <span className="block text-[10.5px] text-neutral-500 mt-0.5 font-mono">
              Incl. GST: ₹{mktWithGst.toFixed(4)}
            </span>
          </div>
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Meta Utility Base (₹)
            </label>
            <input
              type="number"
              step="0.0001"
              value={rateForm.metaUtil}
              onChange={(e) => rateForm.setMetaUtil(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
            />
            <span className="block text-[10.5px] text-neutral-500 mt-0.5 font-mono">
              Incl. GST: ₹{utilWithGst.toFixed(4)}
            </span>
          </div>
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Meta Auth Base (₹)
            </label>
            <input
              type="number"
              step="0.0001"
              value={rateForm.metaAuth}
              onChange={(e) => rateForm.setMetaAuth(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
            />
            <span className="block text-[10.5px] text-neutral-500 mt-0.5 font-mono">
              Incl. GST: ₹{(pricing.rates.actualMetaAuthRateInr * gstMult).toFixed(4)}
            </span>
          </div>
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Meta 24h Service Channel Fee (₹)
            </label>
            <input
              type="number"
              step="0.0001"
              value={rateForm.metaServ}
              onChange={(e) => rateForm.setMetaServ(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
            />
            <span className="block text-[10.5px] text-neutral-500 mt-0.5">
              Meta 24h replies = ₹0 (Claude AI billed separately)
            </span>
          </div>
          <div>
            <label className="block font-medium text-neutral-700 mb-1">GST Rate (%)</label>
            <input
              type="number"
              step="0.1"
              value={rateForm.gstRatePct}
              onChange={(e) => rateForm.setGstRatePct(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              USD to INR Rate (₹)
            </label>
            <input
              type="number"
              step="0.05"
              value={rateForm.usdToInrRate}
              onChange={(e) => rateForm.setUsdToInrRate(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-4 flex justify-end pt-1">
            <button
              type="submit"
              disabled={rateForm.savingRates}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{rateForm.savingRates ? "Saving..." : "Save Rates & GST"}</span>
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900">
          Recent Per-Message Profit Ledger (Meta Channel Cost Incl. {activeGstPct}% GST)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[660px]">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500">
                <th className="py-2 pr-3 font-medium">Date & Time</th>
                <th className="py-2 px-3 font-medium">Customer Number</th>
                <th className="py-2 px-3 font-medium">Mode</th>
                <th className="py-2 px-3 font-medium">Type</th>
                <th className="py-2 px-3 font-medium">Sent By</th>
                <th className="py-2 px-3 text-right font-medium">Client Charge</th>
                <th className="py-2 px-3 text-right font-medium">Meta Cost (+GST)</th>
                <th className="py-2 pl-3 text-right font-medium">Net (ex-AI)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {pricing.recentEntries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-neutral-400">
                    No billed messages recorded yet.
                  </td>
                </tr>
              ) : (
                pricing.recentEntries.map((e) => {
                  const mode = e.deliveryMode || "LIVE_META_CLOUD";
                  const margin = e.marginInr ?? 0;
                  return (
                    <tr key={e.id}>
                      <td className="py-2.5 pr-3 text-neutral-500">
                        {formatDateTimeIst(e.billedAt)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-neutral-800">
                        {e.customerPhone}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            mode === "LIVE_META_CLOUD"
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-neutral-100 text-neutral-600"
                          }`}
                        >
                          {mode === "LIVE_META_CLOUD"
                            ? "LIVE"
                            : mode === "SEED"
                            ? "SEED"
                            : "SANDBOX"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-neutral-700">
                        {friendlyCategoryName(e.category)}
                      </td>
                      <td className="py-2.5 px-3 text-neutral-700">{e.staffName}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-medium">
                        ₹{e.clientUnitRateInr.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-neutral-600">
                        ₹{(e.actualMetaUnitWithGstInr ?? e.actualMetaUnitCostInr ?? 0).toFixed(4)}
                      </td>
                      <td
                        className={`py-2.5 pl-3 text-right font-mono font-semibold ${
                          margin >= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {margin >= 0 ? "+" : "-"}₹{Math.abs(margin).toFixed(4)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
