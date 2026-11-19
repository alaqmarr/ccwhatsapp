"use client";

import React from "react";
import { Copy, X } from "lucide-react";
import type { AiTraceLogEntry } from "./ai-logs-types";

export default function AiLogDetailModal({
  entry,
  copiedId,
  onCopy,
  onClose,
}: {
  entry: AiTraceLogEntry;
  copiedId: string;
  onCopy: (id: string, text: string) => void;
  onClose: () => void;
}) {
  const jsonText = JSON.stringify(entry, null, 2);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-2xl w-full max-w-3xl max-h-[85dvh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 bg-slate-50">
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 truncate">
              Trace Payload: {entry.feature} ({entry.id})
            </div>
            <div className="text-[11px] font-mono text-slate-500">
              {entry.timestampIst} | {entry.model} | {entry.durationMs}ms
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onCopy(`json_${entry.id}`, jsonText)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-neutral-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700"
            >
              <Copy className="w-3.5 h-3.5" />
              {copiedId === `json_${entry.id}` ? "Copied" : "Copy JSON"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200"
              aria-label="Close trace detail"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <pre className="p-4 bg-slate-950 text-slate-100 font-mono text-[11.5px] leading-relaxed overflow-auto flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {jsonText}
        </pre>
      </div>
    </div>
  );
}
