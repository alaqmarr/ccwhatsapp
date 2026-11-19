"use client";

import React from "react";
import Link from "next/link";
import { ExternalLink, Search } from "lucide-react";
import { formatShortLinkUrl } from "@cc/ui";
import {
  formatDateTimeIst,
  formatDuration,
  formatSourceLabel,
  type AnalyticsResponse,
} from "./analytics-types";

export default function AnalyticsCategoriesAndAuditLog({
  data,
  filteredLogs,
  logSearch,
  onLogSearchChange,
  outcomeFilter,
  onOutcomeFilterChange,
}: {
  data: AnalyticsResponse;
  filteredLogs: AnalyticsResponse["assignmentLogs"];
  logSearch: string;
  onLogSearchChange: (val: string) => void;
  outcomeFilter: string;
  onOutcomeFilterChange: (val: string) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section className="xl:col-span-4 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Enquiries by Product Category
            </h2>
            <p className="text-xs text-neutral-500">
              Auto-tagged across Classic Concepts & Classic Edge 53.
            </p>
          </div>
          <div className="space-y-2">
            {data.categories.map((cat) => {
              const pct =
                data.kpis.totalConversations > 0
                  ? Math.round((cat.count / data.kpis.totalConversations) * 100)
                  : 0;
              return (
                <div key={cat.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-neutral-800">{cat.name}</span>
                    <span className="text-neutral-600">
                      {cat.count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
                    <div
                      style={{ width: `${Math.max(4, pct)}%` }}
                      className="h-full bg-[#00a884] rounded-full"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="xl:col-span-4 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Broadcasts & Top Templates
              </h2>
              <p className="text-xs text-neutral-500">
                {data.broadcastSummary.campaignsCount} campaigns •{" "}
                {data.broadcastSummary.sent} sent • {data.broadcastSummary.read} read
              </p>
            </div>
            <Link
              href="/dashboard/templates"
              className="text-xs font-medium text-[#008069] hover:underline"
            >
              Templates
            </Link>
          </div>

          <div className="space-y-2">
            {data.topTemplates.map((tpl) => (
              <div
                key={tpl.id}
                className="p-2.5 rounded-md bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-mono font-semibold text-neutral-900 truncate">
                    {tpl.name}
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    {tpl.category} • {tpl.approvalStatus}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-white border border-neutral-200 font-semibold text-neutral-800 shrink-0">
                  {tpl.sentCount} sent
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="xl:col-span-4 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Short Links Clicks (ccapl.cc)
              </h2>
              <p className="text-xs text-neutral-500">
                Tracks customer clicks on 6-character catalog &amp; quote links.
              </p>
            </div>
            <Link
              href="/dashboard/marketing"
              className="text-xs font-medium text-[#008069] hover:underline"
            >
              Manage Links
            </Link>
          </div>

          <div className="space-y-2">
            {data.topLinks.map((lnk) => (
              <div
                key={lnk.id}
                className="p-2.5 rounded-md bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-neutral-900 truncate">{lnk.title}</div>
                  <div className="text-[11px] font-mono text-[#008069] truncate">
                    {formatShortLinkUrl(lnk.code)}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold shrink-0">
                  {lnk.clicksCount} clicks
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Complete Assignment & First-Response History Log
            </h2>
            <p className="text-xs text-neutral-500">
              Every chat assignment with exact assigned timestamp, first response timestamp, elapsed time, and outcome.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => onLogSearchChange(e.target.value)}
                placeholder="Search customer, phone, or agent..."
                className="pl-8 pr-3 py-1.5 rounded-md border border-neutral-300 text-xs w-60"
              />
            </div>

            <select
              value={outcomeFilter}
              onChange={(e) => onOutcomeFilterChange(e.target.value)}
              className="px-2.5 py-1.5 rounded-md border border-neutral-300 bg-white text-xs text-neutral-800"
            >
              <option value="ALL">All Assignments</option>
              <option value="HUMAN">Human Staff Only</option>
              <option value="SYSTEM">System (ACRIO) Only</option>
              <option value="RESPONDED">Responded</option>
              <option value="ACTIVE">Awaiting Reply / Active</option>
              <option value="ESCALATED">Escalated (Missed Timer)</option>
              <option value="REASSIGNED">Reassigned</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[600px]">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold">
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-3">Assigned To</th>
                <th className="py-3 px-3">How Assigned</th>
                <th className="py-3 px-3">Assigned At</th>
                <th className="py-3 px-3">First Response At</th>
                <th className="py-3 px-3 text-right">Response Time</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-4 text-right">Chat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-neutral-500">
                    No assignment records match your filter.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isSys = log.toStaffId === "ACRIO";
                  return (
                    <tr key={log.id} className="hover:bg-neutral-50/80">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-neutral-900">
                          {log.customerName || log.customerPhone}
                        </div>
                        <div className="text-[11px] font-mono text-neutral-500">
                          {log.customerPhone}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-neutral-900 flex items-center gap-1.5">
                          <span>{isSys ? "System (ACRIO)" : log.toStaffName}</span>
                          {!isSys && (
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                                log.escalationLevel === "P2"
                                  ? "bg-red-600 text-white"
                                  : log.escalationLevel === "P1"
                                  ? "bg-amber-500 text-white"
                                  : "bg-neutral-100 text-neutral-700"
                              }`}
                            >
                              {log.escalationLevel}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-neutral-500">{log.toTeamName}</div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="text-neutral-800">
                          {formatSourceLabel(log.assignmentSource)}
                        </div>
                        <div className="text-[11px] text-neutral-500">by {log.assignedByName}</div>
                      </td>
                      <td className="py-3 px-3 font-medium text-neutral-800">
                        {formatDateTimeIst(log.assignedAt)}
                      </td>
                      <td className="py-3 px-3">
                        {log.firstResponseAt ? (
                          <span className="font-medium text-emerald-800">
                            {formatDateTimeIst(log.firstResponseAt)}
                          </span>
                        ) : (
                          <span className="text-neutral-400">No reply yet</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-semibold">
                        {log.firstResponseSeconds !== null ? (
                          <span
                            className={
                              log.firstResponseSeconds <= 180
                                ? "text-emerald-700"
                                : log.firstResponseSeconds <= 420
                                ? "text-amber-700"
                                : "text-red-700"
                            }
                          >
                            {formatDuration(log.firstResponseSeconds)}
                          </span>
                        ) : (
                          <span className="text-neutral-400">None</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${
                            log.outcome === "RESPONDED"
                              ? "bg-emerald-100 text-emerald-800"
                              : log.outcome === "ESCALATED"
                              ? "bg-red-100 text-red-800"
                              : log.outcome === "ACTIVE"
                              ? "bg-amber-100 text-amber-900"
                              : "bg-neutral-100 text-neutral-700"
                          }`}
                        >
                          {log.outcome}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Link
                          href={`/dashboard/inbox?chat=${encodeURIComponent(log.conversationId)}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-[11px] font-medium text-neutral-800"
                        >
                          <span>Open Chat</span>
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
