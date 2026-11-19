"use client";

import React from "react";
import Link from "next/link";
import { AtSign, Flame, MessageSquare } from "lucide-react";
import { Panel } from "./DashboardPrimitives";
import { ago, dayLabel, type Notif } from "./types";

export function DashboardRightRail({
  notifications,
  unreadNotifications,
  onMarkNotificationsRead,
  inboundLast7Days,
  leadsByCategory,
}: {
  notifications: Notif[];
  unreadNotifications: number;
  onMarkNotificationsRead: () => void;
  inboundLast7Days: { day: string; count: number }[];
  leadsByCategory: { category: string; count: number }[];
}) {
  const maxInbound = Math.max(1, ...inboundLast7Days.map((d) => d.count));
  const maxCat = Math.max(1, ...leadsByCategory.map((c) => c.count));

  return (
    <div className="space-y-4">
      <Panel
        title={`Mentions & ACRIO replies${unreadNotifications ? ` (${unreadNotifications})` : ""}`}
        icon={<AtSign className="w-4 h-4 text-amber-700" />}
        right={
          unreadNotifications > 0 ? (
            <button
              type="button"
              onClick={onMarkNotificationsRead}
              className="text-[11px] font-medium text-[#008069] hover:underline cursor-pointer"
            >
              Mark read
            </button>
          ) : undefined
        }
      >
        {notifications.length === 0 ? (
          <p className="p-4 text-center text-xs text-slate-500">
            Type @ in a chat note to ping a teammate, or @ACRIO to ask ACRIO a question.
          </p>
        ) : (
          <div className="divide-y divide-neutral-100 max-h-72 overflow-y-auto">
            {notifications.map((n) => (
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

      <Panel title="Customer messages, last 7 days" icon={<MessageSquare className="w-4 h-4 text-sky-600" />}>
        <div className="p-4 flex items-end gap-2 h-32">
          {inboundLast7Days.map((d) => (
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

      <Panel title="Leads & enquiries by topic" icon={<Flame className="w-4 h-4 text-rose-600" />}>
        <div className="p-4 space-y-2">
          {leadsByCategory.length === 0 ? (
            <p className="text-xs text-slate-500 text-center">No recent topic activity.</p>
          ) : (
            leadsByCategory.slice(0, 7).map((c) => (
              <div key={c.category}>
                <div className="flex justify-between text-[11px] text-slate-600 mb-0.5">
                  <span className="truncate">{c.category}</span>
                  <span className="font-semibold tabular-nums">{c.count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100">
                  <div
                    className="h-1.5 rounded-full bg-violet-500"
                    style={{ width: `${(c.count / maxCat) * 100}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
