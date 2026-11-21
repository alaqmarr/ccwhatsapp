"use client";

import React, { useEffect, useState } from "react";
import { Check, Loader2, Send, X } from "lucide-react";
import { WhatsAppLogoIcon } from "@cc/ui";

export interface MessagePolishModalState {
  convId: string;
  recipientName: string;
  originalText: string;
  enhancedText: string;
  loading: boolean;
  changed: boolean;
}

export function MessagePolishModal({
  state,
  onSendChosen,
  onCancel,
}: {
  state: MessagePolishModalState | null;
  onSendChosen: (chosenText: string) => void;
  onCancel: () => void;
}) {
  const [editedEnhanced, setEditedEnhanced] = useState("");

  useEffect(() => {
    if (state) {
      setEditedEnhanced(state.enhancedText || state.originalText);
    }
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, onCancel]);

  if (!state) return null;

  const trimmedEnhanced = editedEnhanced.trim() || state.enhancedText || state.originalText;

  return (
    <div
      className="fixed inset-0 z-[910] flex items-end sm:items-center justify-center bg-slate-900/45 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Review and format reply"
    >
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-white border border-neutral-200 shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 bg-neutral-50">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-neutral-900 truncate">
              Quick Spelling &amp; Tone Check
            </h3>
            <p className="text-[11px] text-neutral-500 truncate">
              Choose which version to send to {state.recipientName}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-neutral-200/70 text-neutral-500 cursor-pointer shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 bg-white">
          {/* Option 1: Enhanced Version */}
          <div className="rounded-xl border border-[#00a884]/50 bg-emerald-50/45 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#008069] inline-flex items-center gap-1.5">
                {state.loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Formatting your reply...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Enhanced Reply (Recommended)</span>
                  </>
                )}
              </span>
              {!state.loading && (
                <span className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-white border border-emerald-200 text-emerald-800">
                  {state.changed ? "Polished" : "Already clean"}
                </span>
              )}
            </div>

            {state.loading ? (
              <div className="space-y-2 py-1">
                <div className="h-4 w-5/6 rounded bg-emerald-200/60 animate-pulse" />
                <div className="h-4 w-2/3 rounded bg-emerald-200/50 animate-pulse" />
              </div>
            ) : (
              <textarea
                rows={3}
                value={editedEnhanced}
                onChange={(e) => setEditedEnhanced(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSendChosen(trimmedEnhanced);
                  }
                }}
                className="w-full rounded-lg border border-emerald-300 bg-white px-2.5 py-2 text-[13.5px] text-neutral-900 leading-relaxed focus:outline-none focus:border-[#00a884] resize-none"
              />
            )}

            <div className="flex justify-end">
              <button
                type="button"
                disabled={state.loading || !trimmedEnhanced}
                onClick={() => onSendChosen(trimmedEnhanced)}
                className="h-8 px-3.5 rounded-lg bg-[#00a884] hover:bg-[#008f6f] disabled:opacity-45 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <WhatsAppLogoIcon size={13} />
                <span>Send Enhanced</span>
              </button>
            </div>
          </div>

          {/* Option 2: Original Message */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-neutral-700">
                Your Original Message
              </span>
            </div>
            <p className="text-[13px] text-neutral-700 whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed bg-white rounded-lg border border-neutral-200 px-2.5 py-2">
              {state.originalText}
            </p>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="text-xs font-medium text-neutral-600 hover:text-neutral-900 px-2 py-1 rounded hover:bg-neutral-200/60 cursor-pointer"
              >
                Back to edit
              </button>
              <button
                type="button"
                onClick={() => onSendChosen(state.originalText)}
                className="h-8 px-3.5 rounded-lg bg-white hover:bg-neutral-100 border border-neutral-300 text-neutral-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3 h-3" />
                <span>Send Original</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
