"use client";

import React from "react";
import { ArrowRight, Clock } from "lucide-react";
import type { TeamItem, TeamTimerPatch } from "@/app/dashboard/teams/types";

export function EscalationRulesPanel({
  team,
  canManage,
  onUpdateTeamTimers,
}: {
  team: TeamItem;
  canManage: boolean;
  onUpdateTeamTimers: (team: TeamItem, patch: TeamTimerPatch) => Promise<void>;
}) {
  return (
    <div className="bg-[#f8faf9] rounded-lg border border-emerald-200/80 px-3.5 py-2.5 flex flex-wrap items-center gap-2 text-xs text-neutral-800">
      <Clock className="w-4 h-4 text-[#00a884] shrink-0" />
      <span className="font-semibold">SLA Escalation Timer:</span>
      <span>
        Starts at <strong>P0</strong> (least busy online person + email alert)
      </span>
      <ArrowRight className="w-3.5 h-3.5 text-neutral-400" />
      <span className="inline-flex items-center gap-1">
        after
        {canManage ? (
          <select
            value={team.p0WaitMinutes}
            onChange={(e) =>
              void onUpdateTeamTimers(team, {
                p0WaitMinutes: Number(e.target.value),
              })
            }
            className="bg-white border border-neutral-300 rounded px-1.5 py-0.5 font-semibold"
          >
            {[2, 3, 4, 5, 8, 10, 15].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        ) : (
          <strong>{team.p0WaitMinutes} min</strong>
        )}
        moves to <strong>P1</strong>
      </span>
      <ArrowRight className="w-3.5 h-3.5 text-neutral-400" />
      <span className="inline-flex items-center gap-1">
        after
        {canManage ? (
          <select
            value={team.p1WaitMinutes}
            onChange={(e) =>
              void onUpdateTeamTimers(team, {
                p1WaitMinutes: Number(e.target.value),
              })
            }
            className="bg-white border border-neutral-300 rounded px-1.5 py-0.5 font-semibold"
          >
            {[5, 8, 10, 12, 15, 20, 30].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        ) : (
          <strong>{team.p1WaitMinutes} min</strong>
        )}
        alerts <strong>P2 Team Lead</strong>
      </span>
    </div>
  );
}
