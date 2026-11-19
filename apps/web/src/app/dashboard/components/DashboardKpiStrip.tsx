"use client";

import React from "react";
import { Bot, CheckCircle2, Flame, Mail, MessageSquare, Reply, Timer } from "lucide-react";
import { Kpi } from "./DashboardPrimitives";
import { fmtDuration, type DashboardData } from "./types";

export function DashboardKpiStrip({ data }: { data: DashboardData }) {
  const { me, snapshot } = data;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5">
      <Kpi
        label="My open chats"
        value={me.openChats}
        hint={`${me.waitingChats} waiting`}
        icon={<MessageSquare className="w-3.5 h-3.5" />}
        tone="emerald"
        href="/dashboard/inbox?filter=MINE"
      />
      <Kpi
        label="Resolved today"
        value={me.resolvedToday}
        hint={`${me.resolved7d} in 7d`}
        icon={<CheckCircle2 className="w-3.5 h-3.5" />}
        tone="sky"
      />
      <Kpi
        label="Avg first reply"
        value={fmtDuration(me.avgFirstResponseSec)}
        hint={`Med ${fmtDuration(me.medianFirstResponseSec)}`}
        icon={<Timer className="w-3.5 h-3.5" />}
        tone="violet"
      />
      <Kpi
        label="Replies sent"
        value={me.repliesToday}
        hint={`${me.replies7d} in 7d`}
        icon={<Reply className="w-3.5 h-3.5" />}
        tone="slate"
      />
      <Kpi
        label="All open leads"
        value={snapshot.openChats}
        hint={`${snapshot.newChatsToday} new today`}
        icon={<MessageSquare className="w-3.5 h-3.5" />}
        tone="emerald"
        href="/dashboard/inbox?filter=ACTIVE"
      />
      <Kpi
        label="Hot leads"
        value={snapshot.hotLeads}
        hint={`${snapshot.callbacksPending} call reqs`}
        icon={<Flame className="w-3.5 h-3.5" />}
        tone="rose"
      />
      <Kpi
        label="Web enquiries"
        value={snapshot.websiteEnquiriesNew ?? 0}
        hint={`${snapshot.websiteEnquiriesTotal ?? 0} total (CC+CE53)`}
        icon={<Mail className="w-3.5 h-3.5" />}
        tone="amber"
        href="/dashboard/enquiries"
      />
      <Kpi
        label="ACRIO handling"
        value={snapshot.acrioHandling}
        hint={`${snapshot.waitingForHuman} need human`}
        icon={<Bot className="w-3.5 h-3.5" />}
        tone="violet"
        href="/dashboard/inbox?filter=ACRIO"
      />
    </div>
  );
}
