"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AtSign,
  Bot,
  CheckCircle2,
  Clock,
  Flame,
  MessageSquare,
  PhoneCall,
  RefreshCw,
  Reply,
  Timer,
  Trophy,
  Users,
} from "lucide-react";

interface Metrics {
  staffId: string;
  name: string;
  role: string;
  openChats: number;
  waitingChats: number;
  resolvedToday: number;
  resolved7d: number;
  resolved30d: number;
  avgFirstResponseSec: number | null;
  medianFirstResponseSec: number | null;
  repliesToday: number;
  replies7d: number;
  assignments30d: number;
  callbacksDone30d: number;
}
interface Lead {
  id: string;
  customerName: string;
  customerPhone: string;
  category: string;
  priority: string;
  owner: string;
  isMine: boolean;
  isAcrio: boolean;
  waitingSeconds: number | null;
  unread: number;
  lastMessage: string;
  lastMessageAt: string;
  hasCallback: boolean;
  heat: "HOT" | "WARM" | "NEW";
}
interface CallReq {
  id: string;
  conversationId: string;
  customerName: string;
  customerPhone: string;
  slot: string;
  topic: string;
  createdAt: string;
  ownerName: string;
  ageSeconds: number;
}
interface Notif {
  id: string;
  type: "MENTION" | "ACRIO_REPLY" | "CALLBACK";
  conversationId: string;
  fromName: string;
  customerName: string;
  text: string;
  isRead: boolean;
  createdAt: string;
}
interface DashboardData {
  generatedAt: string;
  viewer: { id: string; name: string; role: string };
  canSeeTeam: boolean;
  me: Metrics;
  snapshot: {
    openChats: number;
    newChatsToday: number;
    waitingForHuman: number;
    acrioHandling: number;
    unreadMessages: number;
    callbacksPending: number;
    callbacksDoneToday: number;
    hotLeads: number;
  };
  openLeads: Lead[];
  callRequests: CallReq[];
  team: Metrics[];
  notifications: Notif[];
  unreadNotifications: number;
  inboundLast7Days: { day: string; count: number }[];
  leadsByCategory: { category: string; count: number }[];
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "n/a";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}
function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? "just now" : `${fmtDuration(s)} ago`;
}
function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return d.toLocaleDateString("en-IN", { weekday: "short" });
}

function Kpi({
  label,
  value,
  hint,
  icon,
  tone = "slate",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ReactNode;
  tone?: "slate" | "emerald" | "amber" | "rose" | "violet" | "sky";
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-800",
    rose: "bg-rose-100 text-rose-700",
    violet: "bg-violet-100 text-violet-700",
    sky: "bg-sky-100 text-sky-700",
  };
  return (
    <div className="rounded-xl bg-white border border-neutral-200 p-3.5 shadow-2xs">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${tones[tone]}`}>{icon}</span>
      </div>
      <div className="mt-1.5 text-2xl font-bold text-slate-900 tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function Panel({
  title,
  icon,
  right,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-white border border-neutral-200 shadow-2xs overflow-hidden">
      <header className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {right}
      </header>
      {children}
    </section>
  );
}

const heatStyle: Record<string, string> = {
  HOT: "bg-rose-100 text-rose-700",
  WARM: "bg-amber-100 text-amber-800",
  NEW: "bg-sky-100 text-sky-700",
};

export function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [leadTab, setLeadTab] = useState<"MINE" | "HOT" | "WAITING" | "ALL">("MINE");
  const [busyCb, setBusyCb] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Could not load dashboard");
      setData(json);
      setError("");
    } catch (e) {
      setError((e as Error).message || "Could not load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 30000);
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const es = new EventSource("/api/realtime/stream");
    const refresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void load(true), 800);
    };
    for (const t of [
      "message:new",
      "note:new",
      "conversation:assigned",
      "conversation:resolved",
      "conversation:updated",
      "callback:new",
      "staff:mention",
    ]) {
      es.addEventListener(t, refresh);
    }
    return () => {
      clearInterval(timer);
      if (debounce) clearTimeout(debounce);
      es.close();
    };
  }, [load]);

  async function markCallbackDone(id: string) {
    setBusyCb(id);
    try {
      await fetch("/api/callback-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "DONE" }),
      });
      await load(true);
    } finally {
      setBusyCb(null);
    }
  }

  async function markNotificationsRead() {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await load(true);
  }

  const leads = useMemo(() => {
    if (!data) return [];
    const all = data.openLeads;
    if (leadTab === "MINE") return all.filter((l) => l.isMine);
    if (leadTab === "HOT") return all.filter((l) => l.heat === "HOT");
    if (leadTab === "WAITING") return all.filter((l) => l.waitingSeconds !== null);
    return all;
  }, [data, leadTab]);

  if (!data) {
    return (
      <div className="p-6 text-sm text-slate-500">
        {error ? <span className="text-rose-600">{error}</span> : "Loading your dashboard..."}
      </div>
    );
  }

  const { me, snapshot } = data;
  const maxInbound = Math.max(1, ...data.inboundLast7Days.map((d) => d.count));
  const maxCat = Math.max(1, ...data.leadsByCategory.map((c) => c.count));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl md:text-2xl font-bold text-slate-900">
            {greeting}, {data.viewer.name.split(" ")[0]}
          </h1>
          <p className="text-xs text-slate-500">
            Your work, open leads and call requests. Updated {ago(data.generatedAt)}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <Link
            href="/dashboard/inbox"
            className="px-3 py-1.5 rounded-lg bg-[#00a884] text-white text-xs font-semibold hover:bg-[#008f6f] inline-flex items-center gap-1.5"
          >
            <MessageSquare className="w-3.5 h-3.5" /> Open chats
          </Link>
        </div>
      </div>

      {/* My performance */}
      <div>
        <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400 mb-2">My performance</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="My open chats" value={me.openChats} hint={`${me.waitingChats} waiting for my reply`} icon={<MessageSquare className="w-4 h-4" />} tone="emerald" />
          <Kpi label="Resolved today" value={me.resolvedToday} hint={`${me.resolved7d} in 7 days`} icon={<CheckCircle2 className="w-4 h-4" />} tone="sky" />
          <Kpi label="Avg first reply" value={fmtDuration(me.avgFirstResponseSec)} hint={`Median ${fmtDuration(me.medianFirstResponseSec)} (30d)`} icon={<Timer className="w-4 h-4" />} tone="violet" />
          <Kpi label="Replies sent" value={me.repliesToday} hint={`${me.replies7d} in 7 days`} icon={<Reply className="w-4 h-4" />} tone="slate" />
          <Kpi label="Chats received" value={me.assignments30d} hint="Assigned to me, 30 days" icon={<Users className="w-4 h-4" />} tone="amber" />
          <Kpi label="Calls done" value={me.callbacksDone30d} hint="Callback requests, 30d" icon={<PhoneCall className="w-4 h-4" />} tone="rose" />
        </div>
      </div>

      {/* Team snapshot */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Open leads" value={snapshot.openChats} hint={`${snapshot.newChatsToday} new chats today`} icon={<MessageSquare className="w-4 h-4" />} tone="emerald" />
        <Kpi label="Hot leads" value={snapshot.hotLeads} hint="Callback, high priority or sales pinged" icon={<Flame className="w-4 h-4" />} tone="rose" />
        <Kpi label="Call requests" value={snapshot.callbacksPending} hint={`${snapshot.callbacksDoneToday} done today`} icon={<PhoneCall className="w-4 h-4" />} tone="amber" />
        <Kpi label="ACRIO handling" value={snapshot.acrioHandling} hint={`${snapshot.waitingForHuman} waiting for a human`} icon={<Bot className="w-4 h-4" />} tone="violet" />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* Call request leads */}
          <Panel
            title={`Call request leads (${data.callRequests.length})`}
            icon={<PhoneCall className="w-4 h-4 text-amber-700" />}
          >
            {data.callRequests.length === 0 ? (
              <p className="p-5 text-center text-xs text-slate-500">
                No pending call requests. Customers who tap "Request a callback" in WhatsApp show up here.
              </p>
            ) : (
              <div className="divide-y divide-neutral-100">
                {data.callRequests.map((c) => (
                  <div key={c.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
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
                        About: {c.topic || "General enquiry"} • Asked {ago(c.createdAt)} • Chat owner: {c.ownerName}
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
                        onClick={() => void markCallbackDone(c.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#00a884] text-white text-xs font-semibold hover:bg-[#008f6f] disabled:opacity-50 cursor-pointer"
                      >
                        Mark called
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Open leads */}
          <Panel
            title="Open leads"
            icon={<Flame className="w-4 h-4 text-rose-600" />}
            right={
              <div className="flex items-center gap-1 text-[11px]">
                {(
                  [
                    ["MINE", "Mine"],
                    ["HOT", "Hot"],
                    ["WAITING", "Waiting"],
                    ["ALL", "All"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setLeadTab(key)}
                    className={`px-2.5 py-1 rounded-full font-semibold cursor-pointer ${
                      leadTab === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            {leads.length === 0 ? (
              <p className="p-5 text-center text-xs text-slate-500">Nothing here right now.</p>
            ) : (
              <div className="divide-y divide-neutral-100 max-h-[28rem] overflow-y-auto">
                {leads.map((l) => (
                  <Link
                    key={l.id}
                    href={`/dashboard/inbox?chat=${encodeURIComponent(l.id)}`}
                    className="px-4 py-2.5 flex items-start gap-3 hover:bg-slate-50"
                  >
                    <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${heatStyle[l.heat]}`}>{l.heat}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span className="truncate">{l.customerName}</span>
                        {l.hasCallback && <PhoneCall className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                        {l.unread > 0 && (
                          <span className="px-1.5 rounded-full bg-[#00a884] text-white text-[10px] font-bold tabular-nums">{l.unread}</span>
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
        </div>

        <div className="space-y-5">
          {/* Mentions */}
          <Panel
            title={`Mentions and ACRIO replies${data.unreadNotifications ? ` (${data.unreadNotifications})` : ""}`}
            icon={<AtSign className="w-4 h-4 text-amber-700" />}
            right={
              data.unreadNotifications > 0 ? (
                <button type="button" onClick={() => void markNotificationsRead()} className="text-[11px] font-medium text-[#008069] hover:underline cursor-pointer">
                  Mark read
                </button>
              ) : undefined
            }
          >
            {data.notifications.length === 0 ? (
              <p className="p-4 text-center text-xs text-slate-500">
                Type @ in a chat note to ping a teammate, or @ACRIO to ask ACRIO a question.
              </p>
            ) : (
              <div className="divide-y divide-neutral-100">
                {data.notifications.map((n) => (
                  <Link
                    key={n.id}
                    href={`/dashboard/inbox?chat=${encodeURIComponent(n.conversationId)}`}
                    className={`block px-4 py-2.5 hover:bg-slate-50 ${n.isRead ? "" : "bg-emerald-50/50"}`}
                  >
                    <span className="flex items-center justify-between text-[11.5px]">
                      <span className="font-semibold text-slate-900">
                        {n.type === "ACRIO_REPLY"
                          ? "ACRIO answered you"
                          : n.type === "CALLBACK"
                          ? "New callback request"
                          : `${n.fromName} mentioned you`}
                      </span>
                      <span className="text-slate-400">{ago(n.createdAt)}</span>
                    </span>
                    <span className="block text-[11px] text-slate-500">Chat with {n.customerName}</span>
                    <span className="block text-xs text-slate-700 line-clamp-2">{n.text}</span>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          {/* Inbound chart */}
          <Panel title="Customer messages, last 7 days" icon={<MessageSquare className="w-4 h-4 text-sky-600" />}>
            <div className="p-4 flex items-end gap-2 h-36">
              {data.inboundLast7Days.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                  <span className="text-[10px] font-semibold text-slate-600 tabular-nums">{d.count}</span>
                  <div
                    className="w-full rounded-t bg-[#00a884]/80"
                    style={{ height: `${Math.max(4, (d.count / maxInbound) * 100)}%` }}
                  />
                  <span className="text-[10px] text-slate-500">{dayLabel(d.day)}</span>
                </div>
              ))}
            </div>
          </Panel>

          {/* Category bars */}
          <Panel title="Open leads by topic" icon={<Flame className="w-4 h-4 text-rose-600" />}>
            <div className="p-4 space-y-2">
              {data.leadsByCategory.length === 0 ? (
                <p className="text-xs text-slate-500 text-center">No open leads.</p>
              ) : (
                data.leadsByCategory.slice(0, 7).map((c) => (
                  <div key={c.category}>
                    <div className="flex justify-between text-[11px] text-slate-600 mb-0.5">
                      <span className="truncate">{c.category}</span>
                      <span className="font-semibold tabular-nums">{c.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full bg-violet-500" style={{ width: `${(c.count / maxCat) * 100}%` }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>

      {/* Team performance */}
      {data.canSeeTeam && (
        <Panel title="Team performance" icon={<Trophy className="w-4 h-4 text-amber-600" />}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-slate-500 bg-slate-50">
                  <th className="px-4 py-2 font-semibold">Teammate</th>
                  <th className="px-2 py-2 font-semibold text-right">Open</th>
                  <th className="px-2 py-2 font-semibold text-right">Waiting</th>
                  <th className="px-2 py-2 font-semibold text-right">Resolved today</th>
                  <th className="px-2 py-2 font-semibold text-right">Resolved 30d</th>
                  <th className="px-2 py-2 font-semibold text-right">Avg first reply</th>
                  <th className="px-2 py-2 font-semibold text-right">Replies 7d</th>
                  <th className="px-2 py-2 font-semibold text-right">Chats received</th>
                  <th className="px-4 py-2 font-semibold text-right">Calls done</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.team.map((t) => (
                  <tr key={t.staffId} className={t.staffId === data.viewer.id ? "bg-emerald-50/40" : ""}>
                    <td className="px-4 py-2">
                      <div className="font-semibold text-slate-900">{t.name}</div>
                      <div className="text-[10.5px] text-slate-500">{t.role}</div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{t.openChats}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${t.waitingChats > 0 ? "text-amber-700 font-semibold" : ""}`}>{t.waitingChats}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{t.resolvedToday}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold">{t.resolved30d}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtDuration(t.avgFirstResponseSec)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{t.replies7d}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{t.assignments30d}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{t.callbacksDone30d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
