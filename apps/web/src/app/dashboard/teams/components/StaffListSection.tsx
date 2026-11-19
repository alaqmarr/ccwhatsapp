"use client";

import React, { useState } from "react";
import { Bell, BellOff, Plus, X } from "lucide-react";
import type { StaffOption, TeamItem, TeamMemberItem } from "@/app/dashboard/teams/types";

interface StaffListSectionProps {
  team: TeamItem;
  tier: "P0" | "P1" | "P2";
  title: string;
  subtitle: string;
  accentClass: string;
  headerBgClass: string;
  activeStaff: StaffOption[];
  canManage: boolean;
  isQuickAddOpen: boolean;
  onToggleQuickAdd: (open: boolean) => void;
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

export function StaffListSection({
  team,
  tier,
  title,
  subtitle,
  accentClass,
  headerBgClass,
  activeStaff,
  canManage,
  isQuickAddOpen,
  onToggleQuickAdd,
  onQuickAddBulk,
  onRemoveMember,
  onToggleAvailability,
  onToggleEmailAlerts,
  onUpdateCapacity,
}: StaffListSectionProps) {
  const [quickAddSelectedIds, setQuickAddSelectedIds] = useState<string[]>([]);
  const [quickAddQuery, setQuickAddQuery] = useState<string>("");
  const [quickAddMaxChats, setQuickAddMaxChats] = useState<number>(15);
  const [savingQuickAdd, setSavingQuickAdd] = useState<boolean>(false);

  const tierMembers = team.members.filter((m) => m.tier === tier);
  const existingInSameTier = new Set(tierMembers.map((m) => m.staffId));
  const existingOtherTierByStaffId = new Map<string, "P0" | "P1" | "P2">();
  for (const m of team.members) {
    if (m.tier !== tier) existingOtherTierByStaffId.set(m.staffId, m.tier);
  }

  const eligibleStaff = activeStaff.filter((s) => {
    if (existingInSameTier.has(s.id)) return false;
    const q = quickAddQuery.trim().toLowerCase();
    if (!q) return true;
    return `${s.name} ${s.email} ${s.role} ${s.department || ""}`
      .toLowerCase()
      .includes(q);
  });

  const openQuickAdd = () => {
    setQuickAddSelectedIds([]);
    setQuickAddQuery("");
    setQuickAddMaxChats(15);
    onToggleQuickAdd(true);
  };

  const closeQuickAdd = () => {
    setQuickAddSelectedIds([]);
    setQuickAddQuery("");
    onToggleQuickAdd(false);
  };

  const submitQuickAdd = async () => {
    if (quickAddSelectedIds.length === 0) return;
    setSavingQuickAdd(true);
    try {
      const ok = await onQuickAddBulk(
        team.id,
        tier,
        quickAddSelectedIds,
        quickAddMaxChats
      );
      if (ok) {
        closeQuickAdd();
      }
    } finally {
      setSavingQuickAdd(false);
    }
  };

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 flex flex-col overflow-hidden">
      <div className={`px-3.5 py-2.5 border-b border-neutral-200/80 ${headerBgClass}`}>
        <div className="flex items-center justify-between gap-2">
          <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${accentClass}`}>
            {tier} • {title}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-neutral-600">
              {tierMembers.length} {tierMembers.length === 1 ? "member" : "members"}
            </span>
            {canManage && (
              <button
                type="button"
                onClick={() => (isQuickAddOpen ? closeQuickAdd() : openQuickAdd())}
                title={`Quickly add one or more staff members to ${tier}`}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border transition cursor-pointer ${
                  isQuickAddOpen
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "bg-white hover:bg-neutral-900 hover:text-white text-neutral-800 border-neutral-300 shadow-2xs"
                }`}
              >
                <Plus className="w-3 h-3" />
                <span>Add</span>
              </button>
            )}
          </div>
        </div>
        <p className="text-[11.5px] text-neutral-600 mt-1">{subtitle}</p>
      </div>

      {canManage && isQuickAddOpen && (
        <div className="p-3 bg-white border-b border-neutral-200 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
              Select staff for {tier} ({quickAddSelectedIds.length} chosen)
            </span>
            <div className="flex items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={() =>
                  setQuickAddSelectedIds(eligibleStaff.map((s) => s.id))
                }
                className="font-semibold text-[#008069] hover:underline cursor-pointer"
              >
                Select all
              </button>
              <span className="text-neutral-300">•</span>
              <button
                type="button"
                onClick={() => setQuickAddSelectedIds([])}
                className="text-neutral-500 hover:text-neutral-800 cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>

          {activeStaff.length > 4 && (
            <input
              type="text"
              value={quickAddQuery}
              onChange={(e) => setQuickAddQuery(e.target.value)}
              placeholder="Search name or email..."
              className="w-full rounded-md border border-neutral-300 px-2.5 py-1 text-xs focus:outline-none focus:border-[#00a884]"
            />
          )}

          {eligibleStaff.length === 0 ? (
            <p className="text-[11px] text-neutral-500 py-2 text-center">
              All eligible staff members are already in {tier}.
            </p>
          ) : (
            <div className="max-h-44 overflow-y-auto divide-y divide-neutral-100 border border-neutral-200 rounded-lg">
              {eligibleStaff.map((s) => {
                const checked = quickAddSelectedIds.includes(s.id);
                const otherTier = existingOtherTierByStaffId.get(s.id);
                return (
                  <label
                    key={s.id}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs cursor-pointer transition ${
                      checked ? "bg-emerald-50/70" : "hover:bg-neutral-50"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setQuickAddSelectedIds((prev) => [...prev, s.id]);
                          } else {
                            setQuickAddSelectedIds((prev) =>
                              prev.filter((id) => id !== s.id)
                            );
                          }
                        }}
                        className="rounded border-neutral-300 accent-[#00a884]"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-neutral-900 truncate">
                          {s.name}{" "}
                          <span className="font-normal text-[10.5px] text-neutral-500">
                            ({s.role})
                          </span>
                        </div>
                        <div className="text-[10.5px] text-neutral-500 truncate">
                          {s.email}
                        </div>
                      </div>
                    </div>
                    {otherTier && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold shrink-0">
                        Move from {otherTier}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <select
              value={quickAddMaxChats}
              onChange={(e) => setQuickAddMaxChats(Number(e.target.value))}
              className="px-2 py-1 rounded-md border border-neutral-300 bg-neutral-50 text-[11px] font-medium text-neutral-700"
            >
              {[5, 10, 15, 25, 40, 60].map((lim) => (
                <option key={lim} value={lim}>
                  Max {lim} chats
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={closeQuickAdd}
                className="px-2.5 py-1 rounded-md text-xs text-neutral-600 hover:bg-neutral-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingQuickAdd || quickAddSelectedIds.length === 0}
                onClick={() => void submitQuickAdd()}
                className="px-3 py-1 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
              >
                {savingQuickAdd
                  ? "Adding..."
                  : `Add ${quickAddSelectedIds.length || ""} to ${tier}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-3 space-y-2 flex-1">
        {tierMembers.length === 0 ? (
          <button
            type="button"
            disabled={!canManage}
            onClick={openQuickAdd}
            className="w-full rounded-lg border border-dashed border-neutral-300 bg-white/70 hover:bg-white hover:border-[#00a884] p-4 text-center text-xs text-neutral-500 hover:text-neutral-800 transition cursor-pointer disabled:cursor-default"
          >
            No {tier} responder assigned yet. Click <strong>+ Add</strong> to select one or more teammates.
          </button>
        ) : (
          tierMembers.map((m) => {
            const cap = Math.max(1, m.maxActiveChats || 15);
            const pct = Math.min(100, Math.round((m.activeOpenChats / cap) * 100));
            const emailOn = m.emailAlertsEnabled !== false;
            return (
              <div
                key={m.id}
                className="bg-white rounded-lg border border-neutral-200 p-2.5 space-y-2 shadow-2xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-neutral-900 truncate flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          m.isAvailable ? "bg-emerald-500" : "bg-neutral-400"
                        }`}
                      />
                      <span className="truncate">{m.staffName}</span>
                    </div>
                    <div className="text-[11px] text-neutral-500 truncate">
                      {m.staffEmail || "No email on file"}
                    </div>
                  </div>

                  {canManage && (
                    <button
                      type="button"
                      onClick={() => void onRemoveMember(m.id)}
                      title="Remove from this team"
                      className="p-1 rounded text-neutral-400 hover:text-red-600 hover:bg-red-50 cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-neutral-600 font-medium">
                      Active load:{" "}
                      <strong className="text-neutral-900">
                        {m.activeOpenChats}
                      </strong>{" "}
                      / {cap} chats
                    </span>
                    <span
                      className={`font-semibold ${
                        pct >= 85
                          ? "text-red-700"
                          : pct >= 55
                          ? "text-amber-700"
                          : "text-emerald-700"
                      }`}
                    >
                      {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        pct >= 85
                          ? "bg-red-500"
                          : pct >= 55
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                </div>

                <div className="pt-1.5 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={!canManage}
                      onClick={() => void onToggleAvailability(m)}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold border cursor-pointer disabled:cursor-default ${
                        m.isAvailable
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                          : "bg-neutral-100 text-neutral-600 border-neutral-300"
                      }`}
                    >
                      {m.isAvailable ? "Online" : "Away"}
                    </button>

                    <button
                      type="button"
                      disabled={!canManage}
                      onClick={() => void onToggleEmailAlerts(m)}
                      title={
                        emailOn
                          ? "Instant email sent when assigned a chat (click to pause)"
                          : "Email alerts paused (click to enable)"
                      }
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer disabled:cursor-default ${
                        emailOn
                          ? "bg-blue-50 text-blue-800 border-blue-200"
                          : "bg-neutral-100 text-neutral-500 border-neutral-200"
                      }`}
                    >
                      {emailOn ? (
                        <Bell className="w-3 h-3" />
                      ) : (
                        <BellOff className="w-3 h-3" />
                      )}
                      <span>{emailOn ? "Mail On" : "Mail Off"}</span>
                    </button>
                  </div>

                  {canManage && (
                    <div className="flex items-center gap-1">
                      <select
                        value={m.tier}
                        onChange={(e) =>
                          void onUpdateCapacity(
                            m,
                            cap,
                            e.target.value as "P0" | "P1" | "P2"
                          )
                        }
                        title="Move member to another escalation lane"
                        className="px-1.5 py-0.5 rounded border border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-700"
                      >
                        <option value="P0">P0</option>
                        <option value="P1">P1</option>
                        <option value="P2">P2</option>
                      </select>
                      <select
                        value={cap}
                        onChange={(e) =>
                          void onUpdateCapacity(m, Number(e.target.value))
                        }
                        title="Max concurrent open chats"
                        className="px-1.5 py-0.5 rounded border border-neutral-200 bg-neutral-50 text-[11px] text-neutral-700"
                      >
                        {[5, 10, 15, 25, 40, 60].map((limit) => (
                          <option key={limit} value={limit}>
                            Max {limit}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
