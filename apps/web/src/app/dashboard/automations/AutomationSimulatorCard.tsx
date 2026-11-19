"use client";

import React from "react";
import { Play, ShieldCheck, Sparkles } from "lucide-react";
import { ACTION_LABELS, type DryRunResult } from "./automations-types";

export function AutomationSimulatorCard({
  simText,
  setSimText,
  simButtonPayload,
  setSimButtonPayload,
  simFirstContact,
  setSimFirstContact,
  simLoading,
  simResult,
  onRunSimulation,
}: {
  simText: string;
  setSimText: (v: string) => void;
  simButtonPayload: string;
  setSimButtonPayload: (v: string) => void;
  simFirstContact: boolean;
  setSimFirstContact: (v: boolean) => void;
  simLoading: boolean;
  simResult: DryRunResult | null;
  onRunSimulation: (e: React.FormEvent) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 space-y-3.5 shadow-2xs">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-neutral-900 flex items-center gap-1.5">
            <Play className="w-4 h-4 text-[#00a884]" />
            <span>Live Rule & Order Lookup Simulator (Zero Credits Used)</span>
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Test what happens when a customer sends a message or taps a button
            before making a rule live.
          </p>
        </div>
      </div>

      <form onSubmit={onRunSimulation} className="space-y-2.5 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            type="text"
            value={simText}
            onChange={(e) => setSimText(e.target.value)}
            placeholder="Type a sample customer message or order ID (e.g. CC-2609)..."
            className="sm:col-span-2 rounded-lg border border-neutral-300 px-3 py-2"
          />
          <input
            type="text"
            value={simButtonPayload}
            onChange={(e) => setSimButtonPayload(e.target.value)}
            placeholder="Optional Button Payload"
            className="rounded-lg border border-neutral-300 px-3 py-2 font-mono"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex items-center gap-1.5 text-neutral-700 cursor-pointer">
            <input
              type="checkbox"
              checked={simFirstContact}
              onChange={(e) => setSimFirstContact(e.target.checked)}
              className="rounded border-neutral-300"
            />
            <span>Simulate first-time new customer</span>
          </label>
          <button
            type="submit"
            disabled={simLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white font-semibold cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{simLoading ? "Testing..." : "Test Pipeline"}</span>
          </button>
        </div>
      </form>

      {simResult && (
        <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {simResult.orderLookupDetected.explicitOrderId ||
            simResult.orderLookupDetected.asksAboutOrder ? (
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-semibold">
                Stage 3 Order Lookup Triggered (
                {simResult.orderLookupDetected.explicitOrderId ||
                  "Order Status Query"}
                )
              </span>
            ) : null}

            <span
              className={`px-2 py-0.5 rounded font-semibold inline-flex items-center gap-1 ${
                simResult.matchedRules.some((m) => m.stopFurtherAi) ||
                simResult.orderLookupDetected.explicitOrderId
                  ? "bg-emerald-100 text-emerald-900"
                  : "bg-indigo-100 text-indigo-900"
              }`}
            >
              {simResult.matchedRules.some((m) => m.stopFurtherAi) ||
              simResult.orderLookupDetected.explicitOrderId ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>ACRIO AI Skipped (0 AI Credits Spent)</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Continues to ACRIO AI (Claude Haiku 5.5)</span>
                </>
              )}
            </span>
          </div>

          {simResult.matchedRules.length === 0 ? (
            <p className="text-neutral-600">
              No custom auto-reply rule matched this text.
            </p>
          ) : (
            <div className="space-y-1.5">
              {simResult.matchedRules.map((m) => (
                <div
                  key={m.id}
                  className="p-2 rounded bg-white border border-neutral-200 space-y-1"
                >
                  <div className="font-semibold text-neutral-900 flex items-center justify-between">
                    <span>Matched: {m.name}</span>
                    <span className="text-[11px] text-neutral-500">
                      {ACTION_LABELS[m.actionType] || m.actionType}
                    </span>
                  </div>
                  {m.simulatedReply && (
                    <p className="text-neutral-700 bg-[#e7fce3]/60 px-2.5 py-1.5 rounded">
                      {m.simulatedReply}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
