"use client";

import React from "react";
import { RefreshCw, X } from "lucide-react";
import {
  ElementErrorState,
  TableRowsSkeleton,
  WhatsAppMessageTicks,
  formatTimeIst,
} from "@cc/ui";
import {
  getStatusBadgeStyle,
  type BroadcastItem,
  type RecipientQueueRow,
} from "@/app/dashboard/marketing/types";

export function RecipientQueueModal({
  inspectBroadcast,
  recipientRows,
  recipientsLoading,
  recipientsError,
  onRefresh,
  onClose,
}: {
  inspectBroadcast: BroadcastItem;
  recipientRows: RecipientQueueRow[];
  recipientsLoading: boolean;
  recipientsError: string;
  onRefresh: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-xl border border-neutral-200 sm:max-w-3xl w-full max-h-[90dvh] flex flex-col shadow-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-neutral-900 truncate">
              Recipient Queue Status: {inspectBroadcast.name}
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Individual staggered delivery schedule, opt-out skips, and error reasons.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-700 cursor-pointer"
            >
              <RefreshCw
                className={`w-3 h-3 ${recipientsLoading ? "animate-spin" : ""}`}
              />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {recipientsLoading && recipientRows.length === 0 ? (
            <TableRowsSkeleton rows={6} cols={4} />
          ) : recipientsError ? (
            <ElementErrorState
              title="Could not load recipient queue"
              message={recipientsError}
              onRetry={onRefresh}
              retrying={recipientsLoading}
            />
          ) : recipientRows.length === 0 ? (
            <p className="text-xs text-neutral-500 text-center py-6">
              Legacy broadcast campaign (sent before per-recipient queue logging).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs min-w-[560px]">
                <thead>
                  <tr className="border-b border-neutral-200 text-neutral-500">
                    <th className="py-2 pr-3 font-medium">Customer</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                    <th className="py-2 px-3 font-medium">
                      Scheduled / Sent At
                    </th>
                    <th className="py-2 pl-3 font-medium">
                      Notes / Skip Reason
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {recipientRows.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-neutral-900">
                          {r.customerName || "Customer"}
                        </div>
                        <div className="font-mono text-[11px] text-neutral-500">
                          {r.customerPhone}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        {[
                          "QUEUED",
                          "SENDING",
                          "SENT",
                          "DELIVERED",
                          "READ",
                          "FAILED",
                        ].includes(String(r.status).toUpperCase()) ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] ${getStatusBadgeStyle(
                              r.status
                            )}`}
                          >
                            <WhatsAppMessageTicks
                              status={r.status}
                              showLabel
                              size={13}
                            />
                          </span>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${getStatusBadgeStyle(
                              r.status
                            )}`}
                          >
                            {r.status}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-neutral-600">
                        {r.sentAt
                          ? `Sent ${formatTimeIst(r.sentAt)}`
                          : `Scheduled ${formatTimeIst(r.scheduledAt)}`}
                      </td>
                      <td className="py-2.5 pl-3 text-neutral-600">
                        {r.skipOrErrorReason || "Ready"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
