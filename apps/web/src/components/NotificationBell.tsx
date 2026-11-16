"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AtSign, Bell, Bot, CheckCheck } from "lucide-react";

interface Notif {
  id: string;
  type: "MENTION" | "ACRIO_REPLY";
  conversationId: string;
  fromName: string;
  customerName: string;
  text: string;
  isRead: boolean;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Bell with unread count for @mentions and ACRIO replies. Updates live through the realtime stream. */
export function NotificationBell({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) {
        setItems(data.notifications || []);
        setUnread(data.unreadCount || 0);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void load();
    const es = new EventSource("/api/realtime/stream");
    const onMention = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        if (data?.payload?.staffId === userId) void load();
      } catch {
        // ignore
      }
    };
    es.addEventListener("staff:mention", onMention);
    return () => {
      es.removeEventListener("staff:mention", onMention);
      es.close();
    };
  }, [load, userId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    void load();
  }

  async function openItem(n: Notif) {
    setOpen(false);
    if (!n.isRead) {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [n.id] }),
      });
      void load();
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer"
        aria-label="Notifications"
      >
        <Bell className="w-4.5 h-4.5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed left-3 right-3 top-14 lg:left-[15.5rem] lg:right-auto lg:top-24 lg:w-96 z-[70] rounded-xl bg-white border border-neutral-200 shadow-2xl overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-neutral-200 flex items-center justify-between bg-slate-50">
            <span className="text-sm font-semibold text-slate-900">Mentions and ACRIO replies</span>
            <button
              type="button"
              onClick={markAllRead}
              disabled={unread === 0}
              className="text-[11px] font-medium text-[#008069] hover:underline disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-neutral-100">
            {items.length === 0 ? (
              <p className="p-5 text-center text-xs text-neutral-500">
                Nothing yet. When a teammate writes @{"{your name}"} in a chat note, or ACRIO answers your
                question, it shows up here.
              </p>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  href={`/dashboard/inbox?chat=${encodeURIComponent(n.conversationId)}`}
                  onClick={() => openItem(n)}
                  className={`flex gap-2.5 px-3.5 py-2.5 hover:bg-slate-50 ${n.isRead ? "" : "bg-emerald-50/50"}`}
                >
                  <span
                    className={`mt-0.5 w-6 h-6 rounded-full shrink-0 flex items-center justify-center ${
                      n.type === "ACRIO_REPLY" ? "bg-violet-100 text-violet-700" : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {n.type === "ACRIO_REPLY" ? <Bot className="w-3.5 h-3.5" /> : <AtSign className="w-3.5 h-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-[11.5px]">
                      <span className="font-semibold text-slate-900 truncate">
                        {n.type === "ACRIO_REPLY" ? "ACRIO answered you" : `${n.fromName} mentioned you`}
                      </span>
                      <span className="text-slate-400 shrink-0">{timeAgo(n.createdAt)}</span>
                    </span>
                    <span className="block text-[11px] text-slate-500 truncate">Chat with {n.customerName}</span>
                    <span className="block text-xs text-slate-700 line-clamp-2 mt-0.5">{n.text}</span>
                  </span>
                  {!n.isRead && <span className="mt-1.5 w-2 h-2 rounded-full bg-rose-500 shrink-0" />}
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
