"use client";

import React from "react";
import Link from "next/link";
import { Mail, Trophy } from "lucide-react";
import { Panel } from "./DashboardPrimitives";
import { ago, fmtDuration, type Metrics, type RecentEnquiry } from "./types";

export function DashboardEnquiriesAndTeam({
  recentEnquiries,
  websiteEnquiriesTotal,
  canSeeTeam,
  team,
  viewerId,
}: {
  recentEnquiries: RecentEnquiry[];
  websiteEnquiriesTotal?: number;
  canSeeTeam: boolean;
  team: Metrics[];
  viewerId: string;
}) {
  return (
    <>
      {/* Website Enquiries across Classic Concepts & Classic Edge 53 */}
      <Panel
        title="Recent website enquiries (CC + CE53)"
        icon={<Mail className="w-4 h-4 text-[#008069]" />}
        right={
          <Link
            href="/dashboard/enquiries"
            className="text-xs font-semibold text-[#008069] hover:underline"
          >
            Manage & reply ({websiteEnquiriesTotal ?? recentEnquiries.length}) →
          </Link>
        }
      >
        {recentEnquiries.length === 0 ? (
          <p className="p-4 text-center text-xs text-slate-500">
            No website enquiries synced yet.
          </p>
        ) : (
          <div className="divide-y divide-neutral-100 max-h-72 overflow-y-auto">
            {recentEnquiries.map((eq) => (
              <Link
                key={eq.id}
                href="/dashboard/enquiries"
                className="px-4 py-2.5 flex items-start justify-between gap-3 hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        eq.brand === "CLASSIC_EDGE_53"
                          ? "bg-indigo-100 text-indigo-800"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {eq.brand === "CLASSIC_EDGE_53" ? "CE53" : "CC"}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        eq.status === "Replied"
                          ? "bg-slate-100 text-slate-600"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {eq.status}
                    </span>
                    <span className="text-sm font-semibold text-slate-900 truncate">
                      {eq.customerName}
                    </span>
                    {eq.productName && (
                      <span className="text-xs text-slate-500 truncate">
                        • {eq.productName}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-600 truncate mt-0.5">{eq.message}</div>
                </div>
                <span className="text-[11px] text-slate-400 shrink-0">{ago(eq.createdAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </Panel>

      {/* Team performance: placed directly inside the main column to use vertical space cleanly */}
      {canSeeTeam && (
        <Panel title="Team performance" icon={<Trophy className="w-4 h-4 text-amber-600" />}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[540px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-slate-500 bg-slate-50">
                  <th className="px-3.5 py-2 font-semibold">Teammate</th>
                  <th className="px-2 py-2 font-semibold text-right">Open</th>
                  <th className="px-2 py-2 font-semibold text-right">Waiting</th>
                  <th className="px-2 py-2 font-semibold text-right">Today</th>
                  <th className="px-2 py-2 font-semibold text-right">30d</th>
                  <th className="px-2 py-2 font-semibold text-right">Avg 1st reply</th>
                  <th className="px-2 py-2 font-semibold text-right">Replies 7d</th>
                  <th className="px-2 py-2 font-semibold text-right">Assigned</th>
                  <th className="px-3.5 py-2 font-semibold text-right">Calls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {team.map((t) => (
                  <tr key={t.staffId} className={t.staffId === viewerId ? "bg-emerald-50/40" : ""}>
                    <td className="px-3.5 py-2">
                      <div className="font-semibold text-slate-900">{t.name}</div>
                      <div className="text-[10.5px] text-slate-500">{t.role}</div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{t.openChats}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${t.waitingChats > 0 ? "text-amber-700 font-semibold" : ""}`}>
                      {t.waitingChats}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{t.resolvedToday}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold">{t.resolved30d}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtDuration(t.avgFirstResponseSec)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{t.replies7d}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{t.assignments30d}</td>
                    <td className="px-3.5 py-2 text-right tabular-nums">{t.callbacksDone30d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
