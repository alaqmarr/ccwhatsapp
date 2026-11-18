"use client";

import React from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { canAssignToDev, type UserRole } from "@cc/rbac";
import type { StaffOption, TeamOption } from "@/lib/inbox-server-data";

export function AssignTeamModal({
  open,
  teams,
  staffList,
  currentUserRole,
  assignTeamId,
  setAssignTeamId,
  assignStaffId,
  setAssignStaffId,
  assignTier,
  setAssignTier,
  onSubmit,
  onClose,
}: {
  open: boolean;
  teams: TeamOption[];
  staffList: StaffOption[];
  currentUserRole: UserRole;
  assignTeamId: string;
  setAssignTeamId: (id: string) => void;
  assignStaffId: string;
  setAssignStaffId: (id: string) => void;
  assignTier: "P0" | "P1" | "P2";
  setAssignTier: (tier: "P0" | "P1" | "P2") => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <form
        onSubmit={onSubmit}
        className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-lg border border-neutral-200 p-4 sm:p-5 space-y-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-900">
            Assign Team &amp; Escalation Priority
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-neutral-600">
          Sales Team is our default handoff team (ACRIO stays off on staff-assigned
          chats so your teammate handles the customer directly). Choose{" "}
          <strong>System (ACRIO)</strong> under Assignee only if you want ACRIO to
          answer incoming customer messages automatically.
        </p>

        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Team
          </label>
          <select
            value={assignTeamId}
            disabled={assignStaffId === "ACRIO"}
            onChange={(e) => setAssignTeamId(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-xs bg-white disabled:opacity-50"
          >
            {teams.map((tm) => (
              <option key={tm.id} value={tm.id}>
                {tm.name} (P0 {tm.p0WaitMinutes}m -&gt; P1 {tm.p1WaitMinutes}m)
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              Escalation Level
            </label>
            <select
              value={assignTier}
              disabled={assignStaffId === "ACRIO"}
              onChange={(e) =>
                setAssignTier(e.target.value as "P0" | "P1" | "P2")
              }
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-xs bg-white disabled:opacity-50"
            >
              <option value="P0">P0 (First Responder)</option>
              <option value="P1">P1 (Escalation Backup)</option>
              <option value="P2">P2 (Lead / Urgent)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              Assignee
            </label>
            <select
              value={assignStaffId}
              onChange={(e) => setAssignStaffId(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-xs bg-white"
            >
              <option value="">Auto-pick least busy in team</option>
              <option value="ACRIO">System (ACRIO)</option>
              {staffList
                .filter(
                  (st) => st.role !== "DEV" || canAssignToDev(currentUserRole)
                )
                .map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                    {st.role === "DEV" ? " (Dev)" : ""}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <Link
            href="/dashboard/teams"
            className="text-xs font-medium text-[#008069] hover:underline"
          >
            Configure teams &amp; wait limits
          </Link>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-md border border-neutral-300 text-xs font-medium text-neutral-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer"
            >
              Save Assignment
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function ResolveChatModal({
  open,
  resolveSummary,
  setResolveSummary,
  onResolve,
  onClose,
}: {
  open: boolean;
  resolveSummary: string;
  setResolveSummary: (v: string) => void;
  onResolve: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-lg border border-neutral-200 p-4 sm:p-5 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-900">
            Mark Chat Resolved
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-neutral-600">
          Save a short closing summary so the next team member immediately sees what
          was agreed.
        </p>
        <textarea
          rows={3}
          value={resolveSummary}
          onChange={(e) => setResolveSummary(e.target.value)}
          className="w-full rounded-md border border-neutral-300 p-2.5 text-xs"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-md border border-neutral-300 text-xs font-medium text-neutral-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onResolve}
            className="px-4 py-2 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer"
          >
            Save &amp; Close Chat
          </button>
        </div>
      </div>
    </div>
  );
}
