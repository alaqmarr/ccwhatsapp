"use client";

import React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  IndianRupee,
  Sparkles,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { WhatsAppLogoIcon, WhatsAppMessageTicks } from "@cc/ui";
import { formatDuration, type AnalyticsResponse } from "./analytics-types";

export function AnalyticsKpiGrid({ data }: { data: AnalyticsResponse }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            <span>Avg Human First Response</span>
            <Clock className="w-4 h-4 text-[#00a884]" />
          </div>
          <div className="metric-value text-[28px] font-bold text-slate-900">
            {formatDuration(data.kpis.avgHumanFirstResponseSeconds)}
          </div>
          <div className="text-xs text-slate-500 flex flex-wrap items-center justify-between gap-1 tabular-nums">
            <span>
              Median:{" "}
              <strong className="font-semibold text-slate-700">
                {formatDuration(data.kpis.medianHumanFirstResponseSeconds)}
              </strong>
            </span>
            <span className="text-emerald-700 font-semibold">
              {data.kpis.slaUnder5MinPct}% under 5m
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            <span>Team Assignments & Replies</span>
            <UserCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="metric-value text-[28px] font-bold text-slate-900">
            {data.kpis.humanRespondedCount}{" "}
            <span className="font-sans text-xs font-medium tracking-normal text-slate-500">
              / {data.kpis.humanAssignmentsCount} assigned
            </span>
          </div>
          <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
            <span>Response rate: {data.kpis.humanResponseRatePct}%</span>
            <span
              className={
                data.kpis.autoEscalationsCount > 0
                  ? "text-red-700 font-semibold"
                  : "text-slate-500"
              }
            >
              {data.kpis.autoEscalationsCount} escalated ({data.kpis.escalationRatePct}%)
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            <span>Customer Conversations</span>
            <WhatsAppLogoIcon size={15} className="text-[#25d366]" />
          </div>
          <div className="metric-value text-[28px] font-bold text-slate-900">
            {data.kpis.totalConversations}{" "}
            <span className="font-sans text-xs font-semibold tracking-normal text-emerald-700">
              ({data.kpis.resolutionRatePct}% resolved)
            </span>
          </div>
          <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
            <span>
              Open: {data.kpis.openConversations + data.kpis.assignedConversations}
            </span>
            <span
              className={
                data.kpis.waitingNowCount > 0
                  ? "text-amber-800 font-semibold"
                  : "text-emerald-700 font-semibold"
              }
            >
              Waiting: {data.kpis.waitingNowCount} (P0: {data.kpis.waitingP0Count}, P1:{" "}
              {data.kpis.waitingP1Count}, P2: {data.kpis.waitingP2Count})
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            <span>System (ACRIO) Handling</span>
            <Sparkles className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="metric-value text-[28px] font-bold text-slate-900">
            {data.kpis.acrioAutonomousRatePct}%{" "}
            <span className="font-sans text-xs font-medium tracking-normal text-slate-500">
              handled without handoff
            </span>
          </div>
          <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
            <span>{data.kpis.acrioRepliesCount} ACRIO replies sent</span>
            <span>
              In:{" "}
              <strong className="text-indigo-700">
                {(data.kpis.aiTokensIn ?? 0).toLocaleString("en-IN")}
              </strong>{" "}
              • Out:{" "}
              <strong className="text-purple-700">
                {(data.kpis.aiTokensOut ?? 0).toLocaleString("en-IN")}
              </strong>
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            <span>Messages Sent & Received</span>
            <TrendingUp className="w-4 h-4 text-sky-600" />
          </div>
          <div className="metric-value text-[28px] font-bold text-slate-900">
            {data.kpis.inboundMessagesCount + data.kpis.outboundMessagesCount}
          </div>
          <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
            <span>
              In: {data.kpis.inboundMessagesCount} • Out: {data.kpis.outboundMessagesCount}
            </span>
            <span className="text-emerald-700 font-semibold">
              {data.kpis.freeStaffRepliesCount} staff replies
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            <span>WhatsApp Read & Delivery Rate</span>
            <WhatsAppMessageTicks status="READ" showLabel={false} size={15} />
          </div>
          <div className="metric-value text-[28px] font-bold text-slate-900">
            {data.kpis.outboundReadRatePct}%{" "}
            <span className="font-sans text-xs font-semibold tracking-normal text-[#0088cc]">
              Read
            </span>
          </div>
          <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
            <span>Delivered+: {data.kpis.outboundDeliveryRatePct}%</span>
            <span>Failed: {data.tickFunnel.failed}</span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
            <span>Orders Logged on WhatsApp</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="metric-value text-[28px] font-bold text-slate-900">
            ₹{data.kpis.ordersRevenueInr.toLocaleString("en-IN")}
          </div>
          <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
            <span>{data.kpis.ordersCount} orders in period</span>
            <span className="text-emerald-700 font-semibold">
              {data.kpis.optedInCustomers}/{data.kpis.totalCustomers} opted in
            </span>
          </div>
        </div>

        {data.canViewBilling ? (
          <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
              <span>Message Cost Breakdown</span>
              <IndianRupee className="w-4 h-4 text-slate-700" />
            </div>
            <div className="metric-value text-[28px] font-bold text-slate-900">
              ₹{(data.kpis.clientBilledInr ?? 0).toFixed(2)}
            </div>
            <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
              <span>ACRIO + Templates</span>
              <Link
                href="/dashboard/pricing"
                className="text-[#008069] font-semibold hover:underline"
              >
                Open Cost Breakdown →
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-2 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
              <span>Broadcasts & Short Links</span>
              <ExternalLink className="w-4 h-4 text-[#00a884]" />
            </div>
            <div className="metric-value text-[28px] font-bold text-slate-900">
              {data.topLinks.reduce((sum, l) => sum + l.clicksCount, 0)}{" "}
              <span className="font-sans text-xs font-medium tracking-normal text-slate-500">
                link clicks
              </span>
            </div>
            <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
              <span>{data.broadcastSummary.sent} broadcast msgs sent</span>
              <span className="text-emerald-700 font-semibold">
                {data.kpis.templateMessagesCount} templates
              </span>
            </div>
          </div>
        )}
      </div>

      {data.aiTokenSummary && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 md:p-5 space-y-3 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-semibold text-slate-900">
                AI Token Usage Summary (Claude Haiku 5.5 • Selected Period)
              </h2>
            </div>
            <span className="text-xs text-slate-500 font-mono">
              All-Time Total: In{" "}
              {(data.aiTokenSummary.allTimeTokensIn ?? 0).toLocaleString("en-IN")} • Out{" "}
              {(data.aiTokenSummary.allTimeTokensOut ?? 0).toLocaleString("en-IN")} (
              {(data.aiTokenSummary.allTimeTokensTotal ?? 0).toLocaleString("en-IN")} tokens)
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-indigo-50/50 border border-indigo-200">
              <div className="text-indigo-800 font-semibold uppercase text-[10.5px]">
                Total Tokens In
              </div>
              <div className="text-xl font-bold text-indigo-950 mt-1 font-mono tabular-nums">
                {(data.aiTokenSummary.periodTokensIn ?? 0).toLocaleString("en-IN")}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Prompt + catalog input</div>
            </div>

            <div className="p-3 rounded-lg bg-purple-50/50 border border-purple-200">
              <div className="text-purple-800 font-semibold uppercase text-[10.5px]">
                Total Tokens Out
              </div>
              <div className="text-xl font-bold text-purple-950 mt-1 font-mono tabular-nums">
                {(data.aiTokenSummary.periodTokensOut ?? 0).toLocaleString("en-IN")}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Generated AI output</div>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-slate-600 font-semibold uppercase text-[10.5px]">
                Combined In + Out
              </div>
              <div className="text-xl font-bold text-slate-900 mt-1 font-mono tabular-nums">
                {(data.aiTokenSummary.periodTokensTotal ?? 0).toLocaleString("en-IN")}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {data.aiTokenSummary.periodLiveAiCalls} live AI calls
              </div>
            </div>

            <div className="p-3 rounded-lg bg-emerald-50/50 border border-emerald-200">
              <div className="text-emerald-800 font-semibold uppercase text-[10.5px]">
                WhatsApp Hub (ACRIO)
              </div>
              <div className="text-xs font-bold text-emerald-950 mt-1.5 font-mono tabular-nums">
                In:{" "}
                {(data.aiTokenSummary.byWebsite?.WHATSAPP_HUB?.inputTokens ?? 0).toLocaleString("en-IN")}
              </div>
              <div className="text-xs font-bold text-emerald-950 font-mono tabular-nums">
                Out:{" "}
                {(data.aiTokenSummary.byWebsite?.WHATSAPP_HUB?.outputTokens ?? 0).toLocaleString("en-IN")}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-blue-50/50 border border-blue-200">
              <div className="text-blue-800 font-semibold uppercase text-[10.5px]">
                classicconcepts.in
              </div>
              <div className="text-xs font-bold text-blue-950 mt-1.5 font-mono tabular-nums">
                In:{" "}
                {(data.aiTokenSummary.byWebsite?.CLASSIC_CONCEPTS?.inputTokens ?? 0).toLocaleString("en-IN")}
              </div>
              <div className="text-xs font-bold text-blue-950 font-mono tabular-nums">
                Out:{" "}
                {(data.aiTokenSummary.byWebsite?.CLASSIC_CONCEPTS?.outputTokens ?? 0).toLocaleString("en-IN")}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-amber-50/50 border border-amber-200">
              <div className="text-amber-800 font-semibold uppercase text-[10.5px]">
                classicedge53.com
              </div>
              <div className="text-xs font-bold text-amber-950 mt-1.5 font-mono tabular-nums">
                In:{" "}
                {(data.aiTokenSummary.byWebsite?.CLASSIC_EDGE_53?.inputTokens ?? 0).toLocaleString("en-IN")}
              </div>
              <div className="text-xs font-bold text-amber-950 font-mono tabular-nums">
                Out:{" "}
                {(data.aiTokenSummary.byWebsite?.CLASSIC_EDGE_53?.outputTokens ?? 0).toLocaleString("en-IN")}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
