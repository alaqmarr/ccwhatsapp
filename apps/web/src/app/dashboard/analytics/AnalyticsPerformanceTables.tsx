"use client";

import React from "react";
import Link from "next/link";
import { Sparkles, Users } from "lucide-react";
import { WhatsAppMessageTicks } from "@cc/ui";
import { formatDuration, type AnalyticsResponse } from "./analytics-types";

export default function AnalyticsPerformanceTables({
  data,
}: {
  data: AnalyticsResponse;
}) {
  return (
    <>
      <section className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Individual Staff Performance &amp; First-Response Leaderboard
            </h2>
            <p className="text-xs text-neutral-500">
              Counts assignments, replies sent, response speed, and resolved chats per individual person (kept separate from Team SLA rollups below).
            </p>
          </div>
          <Link
            href="/dashboard/teams"
            className="text-xs font-medium text-[#008069] hover:underline inline-flex items-center gap-1"
          >
            <Users className="w-3.5 h-3.5" />
            <span>Configure P0 / P1 / P2 Tiers</span>
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[600px]">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold">
                <th className="py-3 px-4">Person / Handler</th>
                <th className="py-3 px-3">Role &amp; Team</th>
                <th className="py-3 px-3 text-right">Assigned</th>
                <th className="py-3 px-3 text-right">Responded</th>
                <th className="py-3 px-3 text-right">Avg 1st Response</th>
                <th className="py-3 px-3 text-right">Fastest / Slowest</th>
                <th className="py-3 px-3 text-right">Under 5m SLA</th>
                <th className="py-3 px-3 text-right">Escalated</th>
                <th className="py-3 px-3 text-right">Replies Sent</th>
                <th className="py-3 px-3 text-right">Resolved</th>
                <th className="py-3 px-4 text-right">Live Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.agentLeaderboard.map((ag) => (
                <tr key={ag.staffId} className="hover:bg-neutral-50/80">
                  <td className="py-3 px-4 font-semibold text-neutral-900">
                    <div className="flex items-center gap-2">
                      {ag.isSystem ? (
                        <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 inline-flex items-center justify-center shrink-0">
                          <Sparkles className="w-3.5 h-3.5" />
                        </span>
                      ) : (
                        <span className="w-6 h-6 rounded-full bg-[#e7fce3] text-[#008069] inline-flex items-center justify-center text-[10px] font-bold shrink-0">
                          {ag.staffName.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span>{ag.staffName}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-neutral-600">{ag.department}</td>
                  <td className="py-3 px-3 text-right font-medium">{ag.assignmentsCount}</td>
                  <td className="py-3 px-3 text-right">
                    <span className="font-medium text-neutral-900">{ag.respondedCount}</span>{" "}
                    <span className="text-neutral-500">({ag.responseRatePct}%)</span>
                  </td>
                  <td className="py-3 px-3 text-right font-semibold">
                    <span
                      className={
                        ag.avgFirstResponseSeconds === null
                          ? "text-neutral-400 font-normal"
                          : ag.avgFirstResponseSeconds <= 180
                          ? "text-emerald-700"
                          : ag.avgFirstResponseSeconds <= 420
                          ? "text-amber-700"
                          : "text-red-700"
                      }
                    >
                      {formatDuration(ag.avgFirstResponseSeconds)}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right text-neutral-600">
                    {ag.fastestFirstResponseSeconds !== null
                      ? `${formatDuration(ag.fastestFirstResponseSeconds)} / ${formatDuration(
                          ag.slowestFirstResponseSeconds
                        )}`
                      : "None"}
                  </td>
                  <td className="py-3 px-3 text-right">
                    {ag.respondedCount > 0 ? (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          ag.under5MinPct >= 80
                            ? "bg-emerald-100 text-emerald-800"
                            : ag.under5MinPct >= 50
                            ? "bg-amber-100 text-amber-900"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {ag.under5MinPct}%
                      </span>
                    ) : (
                      <span className="text-neutral-400">None</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right">
                    {ag.escalatedCount > 0 ? (
                      <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 font-semibold">
                        {ag.escalatedCount}
                      </span>
                    ) : (
                      <span className="text-neutral-400">0</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right font-medium text-neutral-800">
                    {ag.outboundRepliesSent}
                  </td>
                  <td className="py-3 px-3 text-right font-semibold text-emerald-700">
                    {ag.resolvedCount}
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-neutral-900">
                    {ag.activeOpenChats}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section className="xl:col-span-7 bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-200">
            <h2 className="text-sm font-semibold text-neutral-900">
              Team SLA & P0 / P1 / P2 Escalation Performance
            </h2>
            <p className="text-xs text-neutral-500">
              Shows how fast each specialist team responds and how often chats escalate past P0.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[600px]">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold">
                  <th className="py-2.5 px-4">Team</th>
                  <th className="py-2.5 px-3">SLA Timers</th>
                  <th className="py-2.5 px-3 text-right">Assigned</th>
                  <th className="py-2.5 px-3 text-right">Avg 1st Reply</th>
                  <th className="py-2.5 px-3 text-right">P0 / P1 / P2</th>
                  <th className="py-2.5 px-4 text-right">Waiting Now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.teamBreakdown.map((tm) => (
                  <tr key={tm.teamId} className="hover:bg-neutral-50/80">
                    <td className="py-3 px-4 font-semibold text-neutral-900">{tm.teamName}</td>
                    <td className="py-3 px-3 text-neutral-600">
                      P0: {tm.p0WaitMinutes}m • P1: {tm.p1WaitMinutes}m
                    </td>
                    <td className="py-3 px-3 text-right font-medium">{tm.assignmentsCount}</td>
                    <td className="py-3 px-3 text-right font-semibold text-emerald-800">
                      {formatDuration(tm.avgFirstResponseSeconds)}
                    </td>
                    <td className="py-3 px-3 text-right text-neutral-700">
                      {tm.p0Count} / {tm.p1Count} / {tm.p2Count}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {tm.currentlyWaitingCount > 0 ? (
                        <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-semibold">
                          {tm.currentlyWaitingCount} waiting
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-medium">0 waiting</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="xl:col-span-5 bg-white rounded-lg border border-neutral-200 p-5 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Outbound WhatsApp Delivery & Read Funnel
            </h2>
            <p className="text-xs text-neutral-500">
              Live receipt status across {data.tickFunnel.totalOutbound} outbound messages.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { status: "SENT", label: "Sent (1 Tick)", count: data.tickFunnel.sent },
              { status: "DELIVERED", label: "Delivered", count: data.tickFunnel.delivered },
              { status: "READ", label: "Read (Blue)", count: data.tickFunnel.read },
              { status: "FAILED", label: "Failed", count: data.tickFunnel.failed },
            ].map((item) => (
              <div
                key={item.status}
                className="p-2.5 rounded-lg bg-neutral-50 border border-neutral-200 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <WhatsAppMessageTicks status={item.status} showLabel={false} size={14} />
                  <span className="text-sm font-bold text-neutral-900">{item.count}</span>
                </div>
                <div className="text-[11px] text-neutral-600">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-neutral-200 space-y-2">
            {data.canViewBilling && data.billingByCategory ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-800">
                    Cost Breakdown by Category
                  </span>
                  <Link
                    href="/dashboard/pricing"
                    className="text-[11px] font-medium text-[#008069] hover:underline"
                  >
                    Full Cost Breakdown
                  </Link>
                </div>
                <div className="space-y-1.5 text-xs">
                  {Object.entries(data.billingByCategory).map(([cat, row]) => (
                    <div
                      key={cat}
                      className="flex items-center justify-between py-1 px-2.5 rounded bg-neutral-50 border border-neutral-200/80"
                    >
                      <span className="font-medium text-neutral-800">
                        {cat === "FREE_CHAT"
                          ? "Staff Chat Replies (24h Window)"
                          : cat === "ACRIO"
                          ? "System (ACRIO) Auto-Replies"
                          : `${cat} Templates`}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="text-neutral-500">{row.count} msgs</span>
                        <strong className="text-neutral-900">
                          ₹{row.clientBilledInr.toFixed(2)}
                        </strong>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="text-xs font-semibold text-neutral-800">
                  Message Volume by Type
                </div>
                <div className="space-y-1.5 text-xs">
                  {[
                    { label: "Staff Chat Replies", count: data.kpis.freeStaffRepliesCount },
                    { label: "System (ACRIO) Auto-Replies", count: data.kpis.acrioRepliesCount },
                    { label: "Template Messages Sent", count: data.kpis.templateMessagesCount },
                    { label: "Private Team Notes", count: data.kpis.internalNotesCount },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between py-1 px-2.5 rounded bg-neutral-50 border border-neutral-200/80"
                    >
                      <span className="font-medium text-neutral-800">{row.label}</span>
                      <strong className="text-neutral-900">{row.count}</strong>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
