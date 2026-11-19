"use client";

import React from "react";
import { CheckCircle2, FlaskConical, Loader2, RotateCcw, Send } from "lucide-react";
import type { SimTurn } from "./ai-training-types";

export default function AiTrainingSimulatorTab({
  simTurns,
  simInput,
  setSimInput,
  simState,
  simBusy,
  onSendTurn,
  onReset,
}: {
  simTurns: SimTurn[];
  simInput: string;
  setSimInput: (v: string) => void;
  simState: Record<string, unknown> | undefined;
  simBusy: boolean;
  onSendTurn: (e: React.FormEvent) => void;
  onReset: () => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 rounded-xl border border-neutral-200 bg-white flex flex-col h-[460px] sm:h-[580px] overflow-hidden shadow-2xs">
        <div className="px-3.5 sm:px-4 py-2.5 sm:py-3 border-b border-neutral-200 bg-[#f0f2f5] flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5 min-w-0">
            <FlaskConical className="w-4 h-4 text-violet-700 shrink-0" />
            <span className="truncate">
              Multi-Turn Conversation Test (Try switching Products A -&gt; B -&gt; C)
            </span>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-neutral-300 text-[11px] font-medium text-neutral-700 cursor-pointer shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Chat</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 bg-[#efeae2]">
          {simTurns.length === 0 ? (
            <div className="text-center py-8 sm:py-12 space-y-2">
              <p className="text-xs font-semibold text-neutral-700">
                Start typing customer messages below to test ACRIO with your latest training pairs and rules.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {[
                  "Tell me about CCP054 podium",
                  "What is the price of CCP065 instead?",
                  "Actually, compare CCP065 and YN-JW1200 machine",
                ].map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => setSimInput(sample)}
                    className="px-3 py-1.5 rounded-full bg-white border border-neutral-300 text-[11px] text-neutral-800 hover:bg-neutral-50 cursor-pointer"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            simTurns.map((t, idx) => (
              <div
                key={idx}
                className={`flex ${t.role === "assistant" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[92%] sm:max-w-[82%] rounded-lg px-3.5 py-2.5 text-xs shadow-2xs space-y-1.5 min-w-0 [overflow-wrap:anywhere] ${
                    t.role === "assistant"
                      ? "bg-[#d9fdd3] text-neutral-900"
                      : "bg-white text-neutral-900"
                  }`}
                >
                  <div className="font-semibold text-[11px] text-neutral-600">
                    {t.role === "assistant" ? "ACRIO AI" : "Test Customer"}
                  </div>
                  <div className="whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed">
                    {t.text}
                  </div>
                  {t.meta && (
                    <div className="pt-1 border-t border-black/10 flex flex-wrap gap-1.5 text-[10px]">
                      {t.meta.activeProduct && (
                        <span className="px-1.5 py-0.5 rounded bg-white/80 font-medium text-neutral-800">
                          Active: {t.meta.activeProduct}
                        </span>
                      )}
                      {t.meta.needsHumanHandoff && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold">
                          Routed to Human Team
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {simBusy && (
            <div className="flex justify-end">
              <div className="px-3 py-2 rounded-lg bg-[#d9fdd3] text-xs text-neutral-700 inline-flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>ACRIO thinking...</span>
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={onSendTurn}
          className="p-3 bg-white border-t border-neutral-200 flex items-center gap-2"
        >
          <input
            type="text"
            value={simInput}
            onChange={(e) => setSimInput(e.target.value)}
            placeholder="Type test customer message (e.g., first ask product A, then switch to product B)..."
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-xs"
          />
          <button
            type="submit"
            disabled={simBusy || !simInput.trim()}
            className="px-4 py-2 rounded-lg bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Test</span>
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3 h-fit shadow-2xs">
        <h3 className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4 text-[#008069]" />
          <span>Live Context State Tracker</span>
        </h3>
        <p className="text-[11px] text-neutral-600">
          Shows what ACRIO currently locks onto as active product versus archived past products so products never mix together.
        </p>
        <div className="rounded-lg bg-neutral-900 text-emerald-300 p-3 font-mono text-[11px] overflow-x-auto max-h-[420px]">
          <pre>{JSON.stringify(simState || { status: "Fresh conversation" }, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}
