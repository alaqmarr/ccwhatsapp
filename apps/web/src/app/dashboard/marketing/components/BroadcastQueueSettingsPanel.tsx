"use client";

import React from "react";
import { ShieldCheck, X } from "lucide-react";
import { WHATSAPP_PUBLIC_DOMAIN } from "@cc/ui";
import type { QueueSafetySettings } from "@/app/dashboard/marketing/types";

export function BroadcastQueueSettingsPanel({
  safetySettings,
  setSafetySettings,
  savingSafety,
  onClose,
  onSubmit,
}: {
  safetySettings: QueueSafetySettings;
  setSafetySettings: React.Dispatch<React.SetStateAction<QueueSafetySettings>>;
  savingSafety: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="bg-white rounded-lg border border-emerald-200 p-5 space-y-4 text-xs"
    >
      <div className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-[#00a884]" />
            <span>Meta Anti-Spam & Account Protection Settings</span>
          </h2>
          <p className="text-neutral-500 mt-0.5">
            Protects {WHATSAPP_PUBLIC_DOMAIN} from Meta quality drops or spam blocks by pacing messages, skipping recent recipients, and auto-pausing on errors.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div>
          <label className="block font-medium text-neutral-700 mb-1">
            Daily Marketing Message Limit
          </label>
          <input
            type="number"
            min={10}
            max={100000}
            value={safetySettings.dailyMarketingCap}
            onChange={(e) =>
              setSafetySettings((prev) => ({
                ...prev,
                dailyMarketingCap: Number(e.target.value),
              }))
            }
            className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
          />
          <p className="text-[11px] text-neutral-500 mt-1">
            Match your Meta Business tier (250, 1,000, or 10,000/day).
          </p>
        </div>

        <div>
          <label className="block font-medium text-neutral-700 mb-1">
            Default Cooldown (Hours)
          </label>
          <input
            type="number"
            min={0}
            max={720}
            value={safetySettings.skipRecentHours}
            onChange={(e) =>
              setSafetySettings((prev) => ({
                ...prev,
                skipRecentHours: Number(e.target.value),
              }))
            }
            className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
          />
          <p className="text-[11px] text-neutral-500 mt-1">
            Skips customers who already received a broadcast recently.
          </p>
        </div>

        <div>
          <label className="block font-medium text-neutral-700 mb-1">
            Auto-Pause After Consecutive Errors
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={safetySettings.autoPauseOnConsecutiveFailures}
            onChange={(e) =>
              setSafetySettings((prev) => ({
                ...prev,
                autoPauseOnConsecutiveFailures: Number(e.target.value),
              }))
            }
            className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
          />
          <p className="text-[11px] text-neutral-500 mt-1">
            Immediately pauses the queue if Meta returns repeated errors.
          </p>
        </div>

        <div className="flex flex-col justify-between">
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Night Quiet Hours (9 PM to 9 AM IST)
            </label>
            <label className="inline-flex items-center gap-2 mt-1.5 cursor-pointer text-neutral-800 font-medium">
              <input
                type="checkbox"
                checked={safetySettings.quietHoursEnabled}
                onChange={(e) =>
                  setSafetySettings((prev) => ({
                    ...prev,
                    quietHoursEnabled: e.target.checked,
                  }))
                }
                className="w-4 h-4 accent-[#00a884]"
              />
              <span>Hold marketing sends overnight</span>
            </label>
          </div>
          <button
            type="submit"
            disabled={savingSafety}
            className="mt-3 w-full py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium cursor-pointer"
          >
            {savingSafety ? "Saving..." : "Save Safety Limits"}
          </button>
        </div>
      </div>
    </form>
  );
}
