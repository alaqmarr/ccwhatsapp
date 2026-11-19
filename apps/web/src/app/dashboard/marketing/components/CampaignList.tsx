"use client";

import React from "react";
import {
  AlertTriangle,
  Eye,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  XCircle,
} from "lucide-react";
import {
  ElementErrorState,
  TableRowsSkeleton,
  formatDateTimeIst,
} from "@cc/ui";
import { getStatusBadgeStyle, type BroadcastItem } from "@/app/dashboard/marketing/types";

export function CampaignList({
  initialLoading,
  loadError,
  refreshing,
  hasActiveQueue,
  broadcasts,
  canSendBroadcasts,
  busyCampaignId,
  onRetry,
  onInspect,
  onCampaignControl,
}: {
  initialLoading: boolean;
  loadError: string;
  refreshing: boolean;
  hasActiveQueue: boolean;
  broadcasts: BroadcastItem[];
  canSendBroadcasts: boolean;
  busyCampaignId: string;
  onRetry: () => void;
  onInspect: (b: BroadcastItem) => void;
  onCampaignControl: (
    broadcastId: string,
    action:
      | "pause_broadcast"
      | "resume_broadcast"
      | "retry_failed_broadcast"
      | "cancel_broadcast"
  ) => Promise<void>;
}) {
  return (
    <div className="xl:col-span-7 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">
            Broadcast Queue Monitor
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Track live send progress, pause or resume any queue, retry failed numbers, or inspect individual recipients.
          </p>
        </div>
        {hasActiveQueue && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-medium">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>Paced Queue Running</span>
          </span>
        )}
      </div>

      {initialLoading ? (
        <TableRowsSkeleton rows={5} cols={4} />
      ) : loadError ? (
        <ElementErrorState
          compact
          title="Could not load broadcast queue"
          message={loadError}
          onRetry={onRetry}
          retrying={refreshing}
        />
      ) : broadcasts.length === 0 ? (
        <div className="p-6 rounded-md bg-neutral-50 border border-neutral-200 text-center text-xs text-neutral-500">
          No broadcasts queued yet. Choose a customer list and template on the left to start your first safe queue.
        </div>
      ) : (
        <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
          {broadcasts.map((b) => {
            const processed = b.sentCount + b.skippedCount + b.failedCount;
            const pct =
              b.totalRecipients > 0
                ? Math.min(
                    100,
                    Math.round((processed / b.totalRecipients) * 100)
                  )
                : 100;
            const isActive =
              b.status === "SENDING" ||
              b.status === "QUEUED" ||
              b.status === "SCHEDULED";
            const isPaused = b.status === "PAUSED";
            const busy = busyCampaignId === b.id;

            return (
              <div
                key={b.id}
                className="p-4 rounded-lg border border-neutral-200 bg-neutral-50/70 space-y-3 text-xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-neutral-900 text-sm">
                        {b.name}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${getStatusBadgeStyle(
                          b.status
                        )}`}
                      >
                        {b.status}
                      </span>
                      <span className="text-[11px] text-neutral-500">
                        1 msg / {b.delaySeconds}s
                      </span>
                    </div>
                    <div className="text-neutral-500 mt-0.5">
                      List:{" "}
                      <strong className="text-neutral-700">{b.listName}</strong>{" "}
                      • Template:{" "}
                      <span className="font-mono text-neutral-700">
                        {b.templateName}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-semibold text-neutral-800">
                      {b.totalRecipients} contacts
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      {formatDateTimeIst(b.createdAt)}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="w-full h-2 rounded-full bg-neutral-200 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        isPaused
                          ? "bg-amber-500"
                          : b.failedCount > 0 && b.queuedCount === 0
                          ? "bg-amber-600"
                          : "bg-[#00a884]"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-600">
                    <div className="flex flex-wrap items-center gap-3">
                      <span>
                        <strong className="text-emerald-700">
                          {b.sentCount}
                        </strong>{" "}
                        sent
                      </span>
                      <span>
                        <strong className="text-blue-700">
                          {b.queuedCount}
                        </strong>{" "}
                        waiting in queue
                      </span>
                      {b.skippedCount > 0 && (
                        <span>
                          <strong>{b.skippedCount}</strong> skipped
                        </span>
                      )}
                      {b.failedCount > 0 && (
                        <span className="text-red-700 font-medium">
                          <strong>{b.failedCount}</strong> failed
                        </span>
                      )}
                    </div>
                    <span>
                      {processed}/{b.totalRecipients} ({pct}%)
                    </span>
                  </div>
                </div>

                {b.pausedReason && (
                  <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2 text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                    <span>{b.pausedReason}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-neutral-200/80">
                  <button
                    type="button"
                    onClick={() => onInspect(b)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white hover:bg-neutral-100 border border-neutral-300 text-neutral-800 font-medium cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View Recipients</span>
                  </button>

                  {canSendBroadcasts && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {isActive && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void onCampaignControl(b.id, "pause_broadcast")
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 font-medium cursor-pointer"
                        >
                          <Pause className="w-3 h-3" />
                          <span>Pause</span>
                        </button>
                      )}

                      {isPaused && b.queuedCount > 0 && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void onCampaignControl(b.id, "resume_broadcast")
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium cursor-pointer"
                        >
                          <Play className="w-3 h-3" />
                          <span>Resume Queue</span>
                        </button>
                      )}

                      {b.failedCount > 0 && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void onCampaignControl(
                              b.id,
                              "retry_failed_broadcast"
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white hover:bg-neutral-100 border border-neutral-300 text-neutral-800 font-medium cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Retry Failed ({b.failedCount})</span>
                        </button>
                      )}

                      {(isActive || isPaused) && b.queuedCount > 0 && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void onCampaignControl(b.id, "cancel_broadcast")
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white hover:bg-red-50 border border-red-200 text-red-700 font-medium cursor-pointer"
                        >
                          <XCircle className="w-3 h-3" />
                          <span>Cancel Rest</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
