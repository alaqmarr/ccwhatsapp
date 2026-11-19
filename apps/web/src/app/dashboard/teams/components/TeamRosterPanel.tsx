"use client";

import React, { useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import type {
  StaffOption,
  TeamItem,
  TeamMemberItem,
  TeamTimerPatch,
} from "@/app/dashboard/teams/types";
import { EscalationRulesPanel } from "./EscalationRulesPanel";
import { StaffListSection } from "./StaffListSection";

interface TeamRosterPanelProps {
  teams: TeamItem[];
  activeStaff: StaffOption[];
  canManage: boolean;
  onUpdateTeamTimers: (team: TeamItem, patch: TeamTimerPatch) => Promise<void>;
  onDeleteTeam: (team: TeamItem) => Promise<void>;
  onAddMember: (
    teamId: string,
    staffId: string,
    tier: "P0" | "P1" | "P2"
  ) => Promise<void>;
  onQuickAddBulk: (
    teamId: string,
    tier: "P0" | "P1" | "P2",
    staffIds: string[],
    maxActiveChats: number
  ) => Promise<boolean>;
  onRemoveMember: (memberId: string) => Promise<void>;
  onToggleAvailability: (member: TeamMemberItem) => Promise<void>;
  onToggleEmailAlerts: (member: TeamMemberItem) => Promise<void>;
  onUpdateCapacity: (
    member: TeamMemberItem,
    maxActiveChats: number,
    tier?: "P0" | "P1" | "P2"
  ) => Promise<void>;
}

export function TeamRosterPanel({
  teams,
  activeStaff,
  canManage,
  onUpdateTeamTimers,
  onDeleteTeam,
  onAddMember,
  onQuickAddBulk,
  onRemoveMember,
  onToggleAvailability,
  onToggleEmailAlerts,
  onUpdateCapacity,
}: TeamRosterPanelProps) {
  const [memberDrafts, setMemberDrafts] = useState<
    Record<string, { staffId: string; tier: "P0" | "P1" | "P2" }>
  >({});
  const [quickAddLane, setQuickAddLane] = useState<{
    teamId: string;
    tier: "P0" | "P1" | "P2";
  } | null>(null);

  return (
    <div className="space-y-5">
      {teams.map((team) => {
        const draft = memberDrafts[team.id] || {
          staffId: activeStaff[0]?.id || "",
          tier: "P0" as const,
        };

        const lanes: Array<{
          tier: "P0" | "P1" | "P2";
          title: string;
          subtitle: string;
          accentClass: string;
          headerBgClass: string;
        }> = [
          {
            tier: "P0",
            title: "First Responder",
            subtitle:
              "Receives new handoffs first and gets an instant assignment email.",
            accentClass: "bg-emerald-600 text-white",
            headerBgClass: "bg-emerald-50/70",
          },
          {
            tier: "P1",
            title: "Backup Responder",
            subtitle: `Steps in automatically if customer waits ${team.p0WaitMinutes} min.`,
            accentClass: "bg-amber-500 text-white",
            headerBgClass: "bg-amber-50/70",
          },
          {
            tier: "P2",
            title: "Team Lead / Urgent",
            subtitle: `Alerted by email if customer waits ${team.p1WaitMinutes} min.`,
            accentClass: "bg-red-600 text-white",
            headerBgClass: "bg-red-50/70",
          },
        ];

        return (
          <div
            key={team.id}
            className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 space-y-4 shadow-2xs"
          >
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 border-b border-neutral-100 pb-3.5">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-neutral-900 text-white text-[11px] font-semibold">
                    Priority #{team.priorityRank}
                  </span>
                  <h2 className="text-base font-bold text-neutral-900">
                    {team.name}
                  </h2>
                  {team.id === "team_sales" && (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 text-[11px] font-semibold">
                      Default Handoff Team
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-700 border border-neutral-200 text-[11px] font-medium">
                    {team.brandScope === "CLASSIC_EDGE_53"
                      ? "Classic Edge 53 (:3002)"
                      : team.brandScope === "CLASSIC_CONCEPTS"
                      ? "Classic Concepts (:3003)"
                      : "Both Websites & WhatsApp"}
                  </span>
                  {team.waitingChatsCount > 0 && (
                    <span className="px-2 py-0.5 rounded-md bg-red-100 text-red-900 text-[11px] font-semibold">
                      {team.waitingChatsCount} waiting right now
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-600">{team.description}</p>
                <p className="text-xs text-neutral-500">
                  <strong>Topic words:</strong>{" "}
                  {team.routingKeywords || "All general enquiries"}
                </p>
              </div>

              {canManage && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <label className="inline-flex items-center gap-1.5 text-xs text-neutral-700 bg-neutral-50 px-2.5 py-1.5 rounded-lg border border-neutral-200">
                    <span>Rank:</span>
                    <select
                      value={team.priorityRank}
                      onChange={(e) =>
                        void onUpdateTeamTimers(team, {
                          priorityRank: Number(e.target.value),
                        })
                      }
                      className="bg-white border border-neutral-300 rounded px-1.5 py-0.5 text-xs font-semibold"
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                        <option key={n} value={n}>
                          #{n}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={() =>
                      void onUpdateTeamTimers(team, {
                        autoAssignEnabled: !team.autoAssignEnabled,
                      })
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                      team.autoAssignEnabled
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : "bg-neutral-100 text-neutral-600 border-neutral-300"
                    }`}
                  >
                    {team.autoAssignEnabled
                      ? "Auto-Assign On"
                      : "Auto-Assign Paused"}
                  </button>

                  {team.id !== "team_sales" && (
                    <button
                      type="button"
                      onClick={() => void onDeleteTeam(team)}
                      title="Delete team"
                      className="p-1.5 rounded-lg border border-neutral-200 text-neutral-400 hover:text-red-600 hover:border-red-200 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>

            <EscalationRulesPanel
              team={team}
              canManage={canManage}
              onUpdateTeamTimers={onUpdateTeamTimers}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
              {lanes.map((lane) => (
                <StaffListSection
                  key={lane.tier}
                  team={team}
                  tier={lane.tier}
                  title={lane.title}
                  subtitle={lane.subtitle}
                  accentClass={lane.accentClass}
                  headerBgClass={lane.headerBgClass}
                  activeStaff={activeStaff}
                  canManage={canManage}
                  isQuickAddOpen={
                    quickAddLane?.teamId === team.id &&
                    quickAddLane?.tier === lane.tier
                  }
                  onToggleQuickAdd={(open) =>
                    setQuickAddLane(
                      open ? { teamId: team.id, tier: lane.tier } : null
                    )
                  }
                  onQuickAddBulk={onQuickAddBulk}
                  onRemoveMember={onRemoveMember}
                  onToggleAvailability={onToggleAvailability}
                  onToggleEmailAlerts={onToggleEmailAlerts}
                  onUpdateCapacity={onUpdateCapacity}
                />
              ))}
            </div>

            {canManage && activeStaff.length > 0 && (
              <div className="pt-3 border-t border-neutral-100 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-neutral-700 flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5 text-[#00a884]" />
                  <span>Add person to {team.name}:</span>
                </span>
                <select
                  value={draft.staffId}
                  onChange={(e) =>
                    setMemberDrafts((prev) => ({
                      ...prev,
                      [team.id]: { ...draft, staffId: e.target.value },
                    }))
                  }
                  className="px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs text-neutral-800"
                >
                  {activeStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.role}) - {s.email}
                    </option>
                  ))}
                </select>

                <select
                  value={draft.tier}
                  onChange={(e) =>
                    setMemberDrafts((prev) => ({
                      ...prev,
                      [team.id]: {
                        ...draft,
                        tier: e.target.value as "P0" | "P1" | "P2",
                      },
                    }))
                  }
                  className="px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-medium text-neutral-800"
                >
                  <option value="P0">P0 (First Responder)</option>
                  <option value="P1">P1 (Backup Escalation)</option>
                  <option value="P2">P2 (Team Lead)</option>
                </select>

                <button
                  type="button"
                  onClick={() =>
                    void onAddMember(team.id, draft.staffId, draft.tier)
                  }
                  className="px-3.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold cursor-pointer"
                >
                  Add to Lane
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
