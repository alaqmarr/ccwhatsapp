"use client";

import React from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import {
  CardListSkeleton,
  ElementErrorState,
  WhatsAppFormattedText,
  WhatsAppLogoIcon,
} from "@cc/ui";
import {
  estimateSafeQueueDuration,
  formatDurationLabel,
  type MarketingListItem,
  type PacingMode,
  type TemplateItem,
} from "@/app/dashboard/marketing/types";

export function BroadcastComposer({
  initialLoading,
  loadError,
  refreshing,
  canManageTemplates,
  canSendBroadcasts,
  lists,
  templates,
  approvedTemplates,
  bcName,
  setBcName,
  bcListId,
  setBcListId,
  bcTemplateId,
  setBcTemplateId,
  bcPacingMode,
  setBcPacingMode,
  bcSkipRecentHours,
  setBcSkipRecentHours,
  bcScheduledFor,
  setBcScheduledFor,
  launching,
  onRetry,
  onSubmit,
}: {
  initialLoading: boolean;
  loadError: string;
  refreshing: boolean;
  canManageTemplates: boolean;
  canSendBroadcasts: boolean;
  lists: MarketingListItem[];
  templates: TemplateItem[];
  approvedTemplates: TemplateItem[];
  bcName: string;
  setBcName: (v: string) => void;
  bcListId: string;
  setBcListId: (v: string) => void;
  bcTemplateId: string;
  setBcTemplateId: (v: string) => void;
  bcPacingMode: PacingMode;
  setBcPacingMode: (v: PacingMode) => void;
  bcSkipRecentHours: number;
  setBcSkipRecentHours: (v: number) => void;
  bcScheduledFor: string;
  setBcScheduledFor: (v: string) => void;
  launching: boolean;
  onRetry: () => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
}) {
  const selectedList = lists.find((l) => l.id === bcListId);
  const selectedTpl =
    approvedTemplates.find((t) => t.id === bcTemplateId) ||
    templates.find((t) => t.id === bcTemplateId);
  const estCount = selectedList?.membersCount || 0;
  const estSeconds = estimateSafeQueueDuration(estCount, bcPacingMode);

  return (
    <div className="xl:col-span-5 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[#25d366] text-white inline-flex items-center justify-center shrink-0">
            <WhatsAppLogoIcon size={11} />
          </span>
          <span>Queue Safe WhatsApp Broadcast</span>
        </h2>
        <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium">
          Staggered Queue
        </span>
      </div>

      {initialLoading ? (
        <CardListSkeleton rows={3} />
      ) : loadError ? (
        <ElementErrorState
          compact
          title="Broadcast form unavailable"
          message="Reload your lists and templates to queue a campaign."
          onRetry={onRetry}
          retrying={refreshing}
        />
      ) : (
        <form onSubmit={onSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Campaign Name
            </label>
            <input
              type="text"
              value={bcName}
              onChange={(e) => setBcName(e.target.value)}
              placeholder="e.g. Banquet Podium & Risers Collection"
              className="w-full rounded-md border border-neutral-300 px-3 py-2"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Customer List
              </label>
              <select
                value={bcListId}
                onChange={(e) => setBcListId(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.membersCount} contacts)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-medium text-neutral-700">
                  Approved Template
                </label>
                {canManageTemplates && (
                  <Link
                    href="/dashboard/templates"
                    className="text-[11px] text-[#008069] font-medium hover:underline"
                  >
                    + New / Edit
                  </Link>
                )}
              </div>
              <select
                value={bcTemplateId}
                onChange={(e) => setBcTemplateId(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
              >
                {approvedTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.category})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Send Speed (Anti-Spam Queue Pacing)
            </label>
            <select
              value={bcPacingMode}
              onChange={(e) => setBcPacingMode(e.target.value as PacingMode)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white font-medium"
            >
              <option value="SAFE_STEADY">
                Safe Steady (Recommended: 1 msg every 4s, 20s breather every 25 msgs)
              </option>
              <option value="EXTRA_CAREFUL">
                Extra Careful for New Numbers (1 msg every 8s, 30s breather every 15 msgs)
              </option>
              <option value="WARMED_FAST">
                Warmed High-Volume Number (1 msg every 2s, 15s breather every 50 msgs)
              </option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Skip Contacts Messaged Within
              </label>
              <select
                value={bcSkipRecentHours}
                onChange={(e) => setBcSkipRecentHours(Number(e.target.value))}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
              >
                <option value={0}>Send to everyone opted in (0 hrs)</option>
                <option value={12}>Last 12 hours</option>
                <option value={24}>Last 24 hours (Recommended)</option>
                <option value={72}>Last 3 days</option>
                <option value={168}>Last 7 days</option>
              </select>
            </div>

            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Start Time (Optional Schedule)
              </label>
              <input
                type="datetime-local"
                value={bcScheduledFor}
                onChange={(e) => setBcScheduledFor(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-1.5 bg-white"
              />
            </div>
          </div>

          {selectedTpl && (
            <div className="p-3 rounded-md bg-[#efeae2]/60 border border-neutral-200 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-neutral-500">
                <span className="font-medium">Template Preview</span>
                <span>
                  {selectedTpl.category} • {selectedTpl.language}
                </span>
              </div>
              {selectedTpl.headerText && (
                <div className="font-semibold text-neutral-900">
                  {selectedTpl.headerText}
                </div>
              )}
              <WhatsAppFormattedText
                text={selectedTpl.bodyText}
                className="text-neutral-800"
              />
              {selectedTpl.footerText && (
                <div className="text-[11px] text-neutral-500">
                  {selectedTpl.footerText}
                </div>
              )}
            </div>
          )}

          <div className="p-3 rounded-md bg-neutral-50 border border-neutral-200 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-neutral-600">
                Safe queue duration ({estCount} contacts):
              </span>
              <span className="font-semibold text-neutral-900 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-[#00a884]" />
                <span>{formatDurationLabel(estSeconds)}</span>
              </span>
            </div>
            <p className="text-[11px] text-neutral-500">
              Contacts who replied STOP or were messaged recently are skipped automatically.
            </p>
          </div>

          <button
            type="submit"
            disabled={launching || !canSendBroadcasts || !bcTemplateId}
            className="w-full py-2.5 rounded-md bg-[#1da851] hover:bg-[#178c43] disabled:opacity-50 text-white font-medium inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <WhatsAppLogoIcon size={14} />
            <span>
              {launching
                ? "Adding to Safe Queue..."
                : bcScheduledFor
                ? "Schedule Safe Broadcast"
                : "Start Safe Broadcast Queue"}
            </span>
          </button>
        </form>
      )}
    </div>
  );
}
