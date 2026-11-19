"use client";

import React from "react";
import Link from "next/link";
import { Activity, CheckCircle2, Mail, Send, ShieldCheck } from "lucide-react";
import { formatDateTimeShortIst } from "@cc/ui";
import type {
  EcosystemHealth,
  EmailDispatchLog,
  SmtpSummary,
  SyncInfo,
} from "@/app/dashboard/teams/types";

export function EmailDispatchPanel({
  canManage,
  smtpSummary,
  emailLogs,
  smtpHost,
  setSmtpHost,
  smtpPort,
  setSmtpPort,
  smtpUser,
  setSmtpUser,
  smtpPass,
  setSmtpPass,
  smtpFrom,
  setSmtpFrom,
  savingSmtp,
  testEmailTarget,
  setTestEmailTarget,
  sendingTestEmail,
  onSaveSmtpConfig,
  onSendTestEmail,
  onReload,
}: {
  canManage: boolean;
  smtpSummary: SmtpSummary | null;
  emailLogs: EmailDispatchLog[];
  smtpHost: string;
  setSmtpHost: (v: string) => void;
  smtpPort: number;
  setSmtpPort: (v: number) => void;
  smtpUser: string;
  setSmtpUser: (v: string) => void;
  smtpPass: string;
  setSmtpPass: (v: string) => void;
  smtpFrom: string;
  setSmtpFrom: (v: string) => void;
  savingSmtp: boolean;
  testEmailTarget: string;
  setTestEmailTarget: (v: string) => void;
  sendingTestEmail: boolean;
  onSaveSmtpConfig: (e: React.FormEvent) => Promise<void>;
  onSendTestEmail: (e: React.FormEvent) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <div className="lg:col-span-5 space-y-4">
        <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 space-y-4 shadow-2xs">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-neutral-900 flex items-center gap-1.5">
                <Mail className="w-4 h-4 text-[#00a884]" />
                <span>Assignment Email Mailer (SMTP)</span>
              </h2>
              <p className="text-xs text-neutral-600 mt-1">
                Whenever a chat is assigned or escalated to a staff member, we send an instant email with customer details and a 1-click Inbox link. If local SMTP is blank, we automatically relay through Classic Concepts (:3003) or Classic Edge (:3002) SMTP.
              </p>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-semibold shrink-0 ${
                smtpSummary?.configured
                  ? "bg-emerald-100 text-emerald-900"
                  : "bg-amber-100 text-amber-900"
              }`}
            >
              {smtpSummary?.configured
                ? `Active (${smtpSummary.source})`
                : "Not Set"}
            </span>
          </div>

          {smtpSummary?.configured && (
            <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 p-3 text-xs text-emerald-950 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                <span>Connected: {smtpSummary.host}</span>
              </div>
              <div className="text-[11px] text-emerald-900">
                Account: {smtpSummary.userMasked} • From: {smtpSummary.from}
              </div>
            </div>
          )}

          {canManage && (
            <form onSubmit={onSaveSmtpConfig} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-neutral-700 mb-1">
                    SMTP Host
                  </label>
                  <input
                    type="text"
                    required
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="smtp.gmail.com"
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-medium text-neutral-700 mb-1">
                    Port
                  </label>
                  <input
                    type="number"
                    required
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(Number(e.target.value))}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  SMTP Username / Email
                </label>
                <input
                  type="text"
                  required
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  placeholder="notifications@classicconcepts.in"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2"
                />
              </div>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  SMTP App Password (leave blank to keep existing)
                </label>
                <input
                  type="password"
                  value={smtpPass}
                  onChange={(e) => setSmtpPass(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2"
                />
              </div>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Sender From Header
                </label>
                <input
                  type="text"
                  value={smtpFrom}
                  onChange={(e) => setSmtpFrom(e.target.value)}
                  placeholder="Classic Concepts WhatsApp <noreply@classicconcepts.in>"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2"
                />
              </div>

              <button
                type="submit"
                disabled={savingSmtp}
                className="w-full py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white font-semibold cursor-pointer"
              >
                {savingSmtp ? "Saving..." : "Save Direct SMTP Credentials"}
              </button>
            </form>
          )}

          <form
            onSubmit={onSendTestEmail}
            className="pt-3 border-t border-neutral-100 space-y-2 text-xs"
          >
            <label className="block font-semibold text-neutral-800">
              Send Live Test Assignment Email
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                value={testEmailTarget}
                onChange={(e) => setTestEmailTarget(e.target.value)}
                placeholder="Staff email (blank sends to your email)"
                className="flex-1 rounded-lg border border-neutral-300 px-3 py-2"
              />
              <button
                type="submit"
                disabled={sendingTestEmail}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white font-semibold cursor-pointer shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{sendingTestEmail ? "Sending..." : "Send Test"}</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="lg:col-span-7 bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 space-y-3 shadow-2xs">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-neutral-900">
            Recent Assignment & System Email Dispatches
          </h2>
          <button
            type="button"
            onClick={() => void onReload()}
            className="text-xs font-medium text-[#008069] hover:underline cursor-pointer"
          >
            Refresh Log
          </button>
        </div>

        {emailLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-neutral-500 border border-dashed border-neutral-200 rounded-lg">
            No email dispatches recorded yet. Assign a chat or click Send Test on the left to verify delivery.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[560px]">
              <thead>
                <tr className="border-b border-neutral-200 text-neutral-500">
                  <th className="py-2 pr-3 font-semibold">Type</th>
                  <th className="py-2 pr-3 font-semibold">Recipient</th>
                  <th className="py-2 pr-3 font-semibold">Subject</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 font-semibold">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {emailLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-neutral-700">
                      {log.dispatchType}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-neutral-900">
                        {log.recipientName || "Staff"}
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        {log.recipientEmail}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 max-w-[230px]">
                      <div className="truncate text-neutral-800" title={log.subject}>
                        {log.subject}
                      </div>
                      {log.conversationId && (
                        <Link
                          href={`/dashboard/inbox?chat=${encodeURIComponent(log.conversationId)}`}
                          className="text-[11px] text-[#008069] hover:underline"
                        >
                          Open Chat →
                        </Link>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10.5px] font-semibold ${
                          log.status === "SENT"
                            ? "bg-emerald-100 text-emerald-900"
                            : log.status === "FAILED"
                            ? "bg-red-100 text-red-900"
                            : "bg-amber-100 text-amber-900"
                        }`}
                      >
                        {log.status}
                      </span>
                      {log.errorMessage && (
                        <div
                          className="text-[10.5px] text-red-600 truncate max-w-[160px]"
                          title={log.errorMessage}
                        >
                          {log.errorMessage}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 text-[11px] text-neutral-500 whitespace-nowrap">
                      {formatDateTimeShortIst(log.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function EcosystemBridgesPanel({
  ecosystemHealth,
  syncInfo,
}: {
  ecosystemHealth: EcosystemHealth | null;
  syncInfo: SyncInfo;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-2.5 shadow-2xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-[#00a884]" />
            <span>Classic Concepts (:3003)</span>
          </span>
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
              ecosystemHealth?.classicConcepts3003.online
                ? "bg-emerald-100 text-emerald-900"
                : "bg-amber-100 text-amber-900"
            }`}
          >
            {ecosystemHealth?.classicConcepts3003.online
              ? `HTTP Live (${ecosystemHealth.classicConcepts3003.latencyMs}ms)`
              : ecosystemHealth?.classicConcepts3003.dbFallbackAvailable
              ? "Local DB Ready"
              : "Standby"}
          </span>
        </div>
        <p className="text-xs text-neutral-600">
          Syncs acrylic product short links (ccapl.cc), live customer orders, contact form enquiries (evaluated by Claude Haiku 5.5), and shared SMTP relay.
        </p>
        <div className="text-[11px] font-mono text-neutral-500">
          {ecosystemHealth?.classicConcepts3003.url || "http://127.0.0.1:3003"} • {syncInfo.classicConceptsCount} products cached
        </div>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-2.5 shadow-2xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-indigo-600" />
            <span>Classic Edge 53 (:3002)</span>
          </span>
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
              ecosystemHealth?.classicEdge3002.online
                ? "bg-emerald-100 text-emerald-900"
                : "bg-amber-100 text-amber-900"
            }`}
          >
            {ecosystemHealth?.classicEdge3002.online
              ? `HTTP Live (${ecosystemHealth.classicEdge3002.latencyMs}ms)`
              : ecosystemHealth?.classicEdge3002.dbFallbackAvailable
              ? "Local DB Ready"
              : "Standby"}
          </span>
        </div>
        <p className="text-xs text-neutral-600">
          Syncs diamond polishing machines, consumables, machine order status lookups, and quote form enquiries into Sales Team Inbox.
        </p>
        <div className="text-[11px] font-mono text-neutral-500">
          {ecosystemHealth?.classicEdge3002.url || "http://127.0.0.1:3002"} • {syncInfo.classicEdgeMachinesCount} machines cached
        </div>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-2.5 shadow-2xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>WhatsApp Hub (:3007)</span>
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[11px] font-semibold">
            Online (:3007)
          </span>
        </div>
        <p className="text-xs text-neutral-600">
          Powers chat.ccapl.cc, track.ccapl.cc/{"{id}"} live order redirects, and ultra-short ccapl.cc/{"{6-char}"} shareable links.
        </p>
        <div className="text-[11px] font-mono text-neutral-500">
          Port 3007 • Bridge endpoint: /api/internal/website-enquiry
        </div>
      </div>
    </div>
  );
}
