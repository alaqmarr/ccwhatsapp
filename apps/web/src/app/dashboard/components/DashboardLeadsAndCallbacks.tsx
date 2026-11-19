"use client";

import React from "react";
import Link from "next/link";
import { Clock, Flame, PhoneCall } from "lucide-react";
import { Panel } from "./DashboardPrimitives";
import { ago, fmtDuration, heatStyle, type CallReq, type Lead, type LeadTabKey } from "./types";

export function DashboardLeadsAndCallbacks({
  callRequests,
  busyCb,
  onMarkCallbackDone,
  leads,
  leadTab,
  onChangeLeadTab,
  tabCounts,
}: {
  callRequests: CallReq[];
  busyCb: string | null;
  onMarkCallbackDone: (id: string) => void;
  leads: Lead[];
  leadTab: LeadTabKey;
  onChangeLeadTab: (tab: LeadTabKey) => void;
  tabCounts: Record<LeadTabKey, number>;
}) {
  return (
    <>
      {/* Call request leads: only expanded when pending callbacks exist */}
      {callRequests.length > 0 && (
        <Panel
          title={`Pending callback requests (${callRequests.length})`}
          icon={<PhoneCall className="w-4 h-4 text-amber-700" />}
        >
          <div className="divide-y divide-neutral-100">
            {callRequests.map((c) => (
              <div key={c.id} className="px-4 py-2.5 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className="truncate">{c.customerName || c.customerPhone}</span>
                    {c.ageSeconds > 7200 && (
                      <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold uppercase">
                        Overdue
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    <a href={`tel:${c.customerPhone}`} className="text-[#008069] font-medium hover:underline">
                      {c.customerPhone}
                    </a>
                    {" • "}Wants a call: <strong>{c.slot}</strong>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    About: {c.topic || "General enquiry"} • Asked {ago(c.createdAt)} • Owner: {c.ownerName}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`/dashboard/inbox?chat=${encodeURIComponent(c.conversationId)}`}
                    className="px-2.5 py-1.5 rounded-lg border border-neutral-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Open chat
                  </Link>
                  <button
                    type="button"
                    disabled={busyCb === c.id}
                    onClick={() => onMarkCallbackDone(c.id)}
                    className="px-2.5 py-1.5 rounded-lg bg-[#00a884] text-white text-xs font-semibold hover:bg-[#008f6f] disabled:opacity-50 cursor-pointer"
                  >
                    Mark called
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Open leads & recent chats */}
      <Panel
        title="Customer chats & open leads"
        icon={<Flame className="w-4 h-4 text-rose-600" />}
        right={
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            {(
              [
                ["MINE", `Mine (${tabCounts.MINE})`],
                ["HOT", `Hot (${tabCounts.HOT})`],
                ["WAITING", `Waiting (${tabCounts.WAITING})`],
                ["ALL", `Open (${tabCounts.ALL})`],
                ["RECENT", `Recent (${tabCounts.RECENT})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => onChangeLeadTab(key)}
                className={`px-2.5 py-1 rounded-full font-semibold cursor-pointer transition-colors ${
                  leadTab === key
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        {leads.length === 0 ? (
          <div className="p-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>No chats in this filter right now.</span>
            {tabCounts.RECENT > 0 && leadTab !== "RECENT" && (
              <button
                type="button"
                onClick={() => onChangeLeadTab("RECENT")}
                className="text-[#008069] font-semibold hover:underline cursor-pointer"
              >
                View {tabCounts.RECENT} recent customer chats →
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-neutral-100 max-h-80 overflow-y-auto">
            {leads.map((l) => (
              <Link
                key={l.id}
                href={`/dashboard/inbox?chat=${encodeURIComponent(l.id)}`}
                className="px-4 py-2.5 flex items-start gap-3 hover:bg-slate-50"
              >
                <span
                  className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    l.status === "RESOLVED" ? "bg-slate-100 text-slate-600" : heatStyle[l.heat]
                  }`}
                >
                  {l.status === "RESOLVED" ? "DONE" : l.heat}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className="truncate">{l.customerName}</span>
                    {l.hasCallback && <PhoneCall className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                    {l.unread > 0 && (
                      <span className="px-1.5 rounded-full bg-[#00a884] text-white text-[10px] font-bold tabular-nums">
                        {l.unread}
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] text-slate-500 truncate">
                    {l.category} • Owner: {l.isAcrio ? "ACRIO" : l.owner}
                  </span>
                  <span className="block text-xs text-slate-600 truncate">{l.lastMessage}</span>
                </span>
                <span className="text-right shrink-0">
                  {l.waitingSeconds !== null ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                      <Clock className="w-3 h-3" /> {fmtDuration(l.waitingSeconds)}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">{ago(l.lastMessageAt)}</span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
