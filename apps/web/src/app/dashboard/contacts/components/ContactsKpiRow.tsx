"use client";

import React from "react";
import { CheckCircle2, Contact2, IndianRupee, Sparkles } from "lucide-react";
import { StatCardsSkeleton } from "@cc/ui";
import type { ContactsPayload } from "@/app/dashboard/contacts/types";

export function ContactsKpiRow({
  loading,
  data,
}: {
  loading: boolean;
  data: ContactsPayload | null;
}) {
  if (loading && !data) {
    return <StatCardsSkeleton count={4} />;
  }
  if (!data) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-1.5 shadow-2xs">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
          <span>Total Contacts</span>
          <Contact2 className="w-4 h-4 text-[#00a884]" />
        </div>
        <div className="metric-value text-[28px] font-bold text-slate-900">
          {data.kpis.totalContacts}
        </div>
        <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
          <span>{data.kpis.withActiveChatCount} with chat thread</span>
          <span className="text-slate-600 font-medium">
            Showing {data.contacts.length}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-1.5 shadow-2xs">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
          <span>Broadcast Opted-In</span>
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        </div>
        <div className="metric-value text-[28px] font-bold text-slate-900">
          {data.kpis.optedInCount}{" "}
          <span className="font-sans text-xs font-semibold tracking-normal text-emerald-700">
            ({data.kpis.optInRatePct}%)
          </span>
        </div>
        <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
          <span>Safe for WhatsApp templates</span>
          <span className="text-red-700 font-medium">
            {data.kpis.optedOutCount} opted out
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-1.5 shadow-2xs">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
          <span>Buyers & Repeat Accounts</span>
          <Sparkles className="w-4 h-4 text-purple-600" />
        </div>
        <div className="metric-value text-[28px] font-bold text-slate-900">
          {data.kpis.customersCount}
        </div>
        <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
          <span>Ordering customers</span>
          <span className="text-purple-700 font-semibold">
            {data.kpis.repeatAndVipCount} Repeat / VIP
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-1.5 shadow-2xs">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
          <span>Recorded Order Value</span>
          <IndianRupee className="w-4 h-4 text-emerald-700" />
        </div>
        <div className="metric-value text-[28px] font-bold text-slate-900">
          ₹{data.kpis.totalLifetimeValueInr.toLocaleString("en-IN")}
        </div>
        <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
          <span>Synced with CRM Orders</span>
          <span className="text-emerald-700 font-medium">
            {data.groups.length} groups
          </span>
        </div>
      </div>
    </div>
  );
}
