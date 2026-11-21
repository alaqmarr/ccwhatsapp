"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle, Clock, ExternalLink, TrendingUp, UserCheck } from "lucide-react";
import type { AnalyticsResponse } from "./analytics-types";

export default function AnalyticsBusinessInsights({
  data,
}: {
  data: AnalyticsResponse;
}) {
  const insights = data.businessInsights;
  if (!insights) return null;

  const {
    templateInsights,
    leadSourceBreakdown,
    followUpInsights,
    slaBreachHoursIst,
  } = insights;

  return (
    <div className="space-y-6">
      {/* Follow-Up Opportunities & SLA Gap Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-neutral-200 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-neutral-600">
            <span>24h Free Window Closing Soon</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900">
            {followUpInsights.expiringWindowCount}
          </div>
          <p className="text-[11px] text-slate-500">
            Active chats expiring within 2 hours. Reply now without paying for a template.
          </p>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-neutral-600">
            <span>Hot Leads Needing Follow-Up</span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900">
            {followUpInsights.staleHotLeadsCount}
          </div>
          <p className="text-[11px] text-slate-500">
            Open prospects untouched for 3+ days across Contacts Database.
          </p>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-neutral-600">
            <span>Contacts Missing Preferred Staff</span>
            <UserCheck className="w-4 h-4 text-[#008069]" />
          </div>
          <div className="text-2xl font-bold text-slate-900">
            {followUpInsights.missingPreferredStaffCount}
          </div>
          <div className="text-[11px] text-slate-500 flex items-center justify-between gap-2">
            <span>Assign owners for sticky routing.</span>
            <Link
              href="/dashboard/contacts"
              className="text-[#008069] font-semibold hover:underline shrink-0"
            >
              Open Contacts
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-neutral-600">
            <span>Top Delayed Response Hours (IST)</span>
            <TrendingUp className="w-4 h-4 text-sky-600" />
          </div>
          {slaBreachHoursIst.length === 0 ? (
            <div className="text-sm font-semibold text-emerald-700 pt-1">
              All busy hours within 5m SLA
            </div>
          ) : (
            <div className="space-y-1 pt-0.5">
              {slaBreachHoursIst.slice(0, 3).map((hr) => (
                <div
                  key={hr.hour}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="font-medium text-slate-800">{hr.label}</span>
                  <span className="text-rose-700 font-semibold">
                    {hr.over5MinCount}/{hr.assignmentsCount} over 5m ({hr.breachRatePct}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actionable Queues: Expiring Windows & Stale Hot Leads */}
      {(followUpInsights.expiringWindowChats.length > 0 ||
        followUpInsights.staleHotLeads.length > 0) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-200">
              <h3 className="text-sm font-semibold text-neutral-900">
                Free Reply Window Closing Soon (Under 2 Hours Left)
              </h3>
              <p className="text-xs text-neutral-500">
                Jump in and reply before these chats lock and require a paid template.
              </p>
            </div>
            {followUpInsights.expiringWindowChats.length === 0 ? (
              <div className="p-5 text-xs text-neutral-500">
                No active chat windows expiring in the next 2 hours.
              </div>
            ) : (
              <div className="divide-y divide-neutral-100">
                {followUpInsights.expiringWindowChats.map((chat) => (
                  <div
                    key={chat.conversationId}
                    className="px-5 py-3 flex items-center justify-between gap-3 text-xs hover:bg-neutral-50"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">
                        {chat.customerName}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {chat.customerPhone} · Owner: {chat.assignedStaffName}
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-semibold text-[11px]">
                        {chat.minutesRemaining}m left
                      </span>
                      <Link
                        href={`/dashboard/inbox?chat=${encodeURIComponent(
                          chat.conversationId
                        )}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#00a884] hover:bg-[#008f6f] text-white font-semibold text-[11px]"
                      >
                        <span>Reply</span>
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-200 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Hot Leads Untouched for 3+ Days
                </h3>
                <p className="text-xs text-neutral-500">
                  Prospects in New Lead, Qualified, or Negotiation stage ready for a check-in.
                </p>
              </div>
              <Link
                href="/dashboard/contacts"
                className="text-xs font-semibold text-[#008069] hover:underline shrink-0"
              >
                View All
              </Link>
            </div>
            {followUpInsights.staleHotLeads.length === 0 ? (
              <div className="p-5 text-xs text-neutral-500">
                Great job! No hot leads waiting longer than 3 days.
              </div>
            ) : (
              <div className="divide-y divide-neutral-100">
                {followUpInsights.staleHotLeads.map((lead) => (
                  <div
                    key={lead.contactId}
                    className="px-5 py-3 flex items-center justify-between gap-3 text-xs hover:bg-neutral-50"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">
                        {lead.name}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {lead.phone} · Stage: {lead.stage}
                        {lead.preferredStaffName
                          ? ` · Staff: ${lead.preferredStaffName}`
                          : ""}
                      </div>
                    </div>
                    <Link
                      href={
                        lead.conversationId
                          ? `/dashboard/inbox?chat=${encodeURIComponent(
                              lead.conversationId
                            )}`
                          : "/dashboard/contacts"
                      }
                      className="px-2.5 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-slate-800 font-semibold text-[11px] shrink-0"
                    >
                      {lead.conversationId ? "Open Chat" : "Open Contacts"}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Template Engagement & Lead Source ROI */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-neutral-200">
            <h3 className="text-sm font-semibold text-neutral-900">
              Template Read Rate, Reply Rate &amp; Meta Frequency Blocks
            </h3>
            <p className="text-xs text-neutral-500">
              Shows which WhatsApp templates customers actually read and reply to, plus Meta error 131049 blocks.
            </p>
          </div>
          {templateInsights.length === 0 ? (
            <div className="p-5 text-xs text-neutral-500">
              No outbound templates sent in this period yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold">
                    <th className="py-2.5 px-4">Template Name</th>
                    <th className="py-2.5 px-3 text-right">Sent</th>
                    <th className="py-2.5 px-3 text-right">Read %</th>
                    <th className="py-2.5 px-3 text-right">Client Reply %</th>
                    <th className="py-2.5 px-4 text-right">Failed / 131049</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {templateInsights.map((t) => (
                    <tr key={t.templateName} className="hover:bg-neutral-50">
                      <td className="py-2.5 px-4 font-semibold text-slate-900 truncate max-w-[200px]">
                        {t.templateName}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium">
                        {t.sentCount}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="font-semibold text-sky-700">
                          {t.readRatePct}%
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                          {t.replyRatePct}% ({t.repliedCount})
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {t.failedCount > 0 ? (
                          <span className="text-rose-700 font-semibold">
                            {t.failedCount}
                            {t.err131049Count > 0
                              ? ` (${t.err131049Count} cap)`
                              : ""}
                          </span>
                        ) : (
                          <span className="text-neutral-400">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-neutral-200">
            <h3 className="text-sm font-semibold text-neutral-900">
              Lead Source Conversion &amp; Order Value
            </h3>
            <p className="text-xs text-neutral-500">
              Compares contact channels by total leads captured, paying customers, and order value.
            </p>
          </div>
          {leadSourceBreakdown.length === 0 ? (
            <div className="p-5 text-xs text-neutral-500">
              No contact source records found yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold">
                    <th className="py-2.5 px-4">Lead Source</th>
                    <th className="py-2.5 px-3 text-right">Contacts</th>
                    <th className="py-2.5 px-3 text-right">Opted In</th>
                    <th className="py-2.5 px-3 text-right">Customers</th>
                    <th className="py-2.5 px-4 text-right">Order Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {leadSourceBreakdown.map((src) => (
                    <tr key={src.source} className="hover:bg-neutral-50">
                      <td className="py-2.5 px-4 font-semibold text-slate-900">
                        {src.label}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium">
                        {src.totalContacts}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600">
                        {src.optedInCount}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="font-semibold text-emerald-700">
                          {src.convertedCount} ({src.conversionRatePct}%)
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold text-slate-900">
                        ₹{src.lifetimeValueInr.toLocaleString("en-IN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
