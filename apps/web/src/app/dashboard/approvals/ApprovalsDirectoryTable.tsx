"use client";

import React from "react";
import { Trash2, UserX } from "lucide-react";
import type { AccountStatus, UserRole } from "@cc/rbac";
import {
  AccountStatusBadge,
  ElementErrorState,
  RoleBadge,
  TableRowsSkeleton,
} from "@cc/ui";

export interface StaffAccountItem {
  id: string;
  name: string;
  email: string;
  whatsappNumber: string;
  department: string | null;
  role: UserRole;
  status: AccountStatus;
  emailVerifiedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  onboardingCompletedAt: string | null;
  assignmentsEnabled?: boolean;
  createdAt: string;
}

export type StatusFilter =
  | "ALL"
  | "ACTIVE"
  | "REJECTED"
  | "SUSPENDED"
  | "UNVERIFIED_EMAIL";

export function ApprovalsDirectoryTable({
  loading,
  loadError,
  refreshing,
  filteredDirectory,
  counts,
  statusFilter,
  setStatusFilter,
  viewerRole,
  roleDrafts,
  setRoleDrafts,
  busyId,
  onRetry,
  onDecision,
  onToggleAssignments,
  onDeleteMember,
}: {
  loading: boolean;
  loadError: string;
  refreshing: boolean;
  filteredDirectory: StaffAccountItem[];
  counts: Record<StatusFilter, number>;
  statusFilter: StatusFilter;
  setStatusFilter: (v: StatusFilter) => void;
  viewerRole: UserRole;
  roleDrafts: Record<string, UserRole>;
  setRoleDrafts: React.Dispatch<React.SetStateAction<Record<string, UserRole>>>;
  busyId: string;
  onRetry: () => void;
  onDecision: (
    targetUserId: string,
    decision: "APPROVE" | "REJECT" | "SUSPEND"
  ) => void;
  onToggleAssignments: (acc: StaffAccountItem) => void;
  onDeleteMember: (acc: StaffAccountItem) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 space-y-4 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-900">
          Team Directory ({loading ? "..." : filteredDirectory.length})
        </h2>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(
            [
              { key: "ALL", label: `All (${counts.ALL})` },
              { key: "ACTIVE", label: `Active (${counts.ACTIVE})` },
              { key: "REJECTED", label: `Rejected (${counts.REJECTED})` },
              { key: "SUSPENDED", label: `Paused (${counts.SUSPENDED})` },
              {
                key: "UNVERIFIED_EMAIL",
                label: `Unverified (${counts.UNVERIFIED_EMAIL})`,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`px-2.5 py-1.5 rounded-lg border font-semibold cursor-pointer transition ${
                statusFilter === tab.key
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <TableRowsSkeleton rows={5} cols={5} />
      ) : loadError ? (
        <ElementErrorState
          compact
          title="Could not load team directory"
          message={loadError}
          onRetry={onRetry}
          retrying={refreshing}
        />
      ) : filteredDirectory.length === 0 ? (
        <div className="p-6 rounded-lg bg-neutral-50 text-center text-xs text-neutral-500">
          No team members in this status filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[680px]">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500">
                <th className="py-2.5 pr-3 font-medium">Name &amp; Email</th>
                <th className="py-2.5 px-3 font-medium">
                  WhatsApp &amp; Dept
                </th>
                <th className="py-2.5 px-3 font-medium">Role</th>
                <th className="py-2.5 px-3 font-medium">Status</th>
                <th className="py-2.5 px-3 font-medium">Assignments &amp; Leads</th>
                <th className="py-2.5 px-3 font-medium">Reviewed By</th>
                <th className="py-2.5 pl-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {filteredDirectory.map((acc) => {
                const isProtectedDev =
                  acc.role === "DEV" && viewerRole !== "DEV";
                const isRejectedOrInactive =
                  acc.status === "REJECTED" ||
                  acc.status === "SUSPENDED" ||
                  acc.status === "UNVERIFIED_EMAIL";

                return (
                  <tr
                    key={acc.id}
                    className={
                      acc.status === "REJECTED" ? "bg-red-50/25" : undefined
                    }
                  >
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-neutral-900">
                        {acc.name}
                      </div>
                      <div className="text-neutral-500">{acc.email}</div>
                    </td>
                    <td className="py-3 px-3 text-neutral-700">
                      <div>{acc.whatsappNumber}</div>
                      {acc.department && (
                        <div className="text-[11px] text-neutral-500">
                          {acc.department}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <RoleBadge role={acc.role} />
                    </td>
                    <td className="py-3 px-3">
                      <AccountStatusBadge status={acc.status} />
                    </td>
                    <td className="py-3 px-3">
                      <button
                        type="button"
                        disabled={busyId === acc.id || isProtectedDev}
                        onClick={() => onToggleAssignments(acc)}
                        title={
                          acc.assignmentsEnabled !== false
                            ? "Receiving chats, auto-assignments, and leads. Click to turn off."
                            : "Turned off: never receives assignments, auto-assignments, or leads. Click to turn on."
                        }
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                          acc.assignmentsEnabled !== false
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                            : "bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100"
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            acc.assignmentsEnabled !== false
                              ? "bg-emerald-500"
                              : "bg-rose-500"
                          }`}
                        />
                        <span>
                          {acc.assignmentsEnabled !== false ? "On" : "Off"}
                        </span>
                      </button>
                    </td>
                    <td className="py-3 px-3 text-neutral-500">
                      {acc.approvedByName || "Initial Setup"}
                    </td>
                    <td className="py-3 pl-3 text-right">
                      {isProtectedDev ? (
                        <span className="inline-block px-2.5 py-1 rounded bg-neutral-100 text-neutral-500 text-[11px] font-medium">
                          Managed by Dev
                        </span>
                      ) : (
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <select
                            value={roleDrafts[acc.id] || acc.role}
                            onChange={(e) =>
                              setRoleDrafts((prev) => ({
                                ...prev,
                                [acc.id]: e.target.value as UserRole,
                              }))
                            }
                            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
                          >
                            <option value="STAFF">Staff</option>
                            <option value="ADMIN">Admin</option>
                            <option value="MANAGER">Manager</option>
                            <option value="SUPERADMIN">Superadmin</option>
                            {viewerRole === "DEV" && (
                              <option value="DEV">Dev</option>
                            )}
                          </select>

                          <button
                            type="button"
                            disabled={busyId === acc.id}
                            onClick={() => onDecision(acc.id, "APPROVE")}
                            className="px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium cursor-pointer"
                          >
                            {acc.status === "ACTIVE" ? "Save Role" : "Activate"}
                          </button>

                          {acc.status === "ACTIVE" && (
                            <button
                              type="button"
                              disabled={busyId === acc.id}
                              onClick={() => onDecision(acc.id, "SUSPEND")}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white hover:bg-amber-50 text-amber-800 border border-amber-200 text-xs font-medium cursor-pointer"
                            >
                              <UserX className="w-3 h-3" />
                              <span>Pause</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={busyId === acc.id}
                            onClick={() => onDeleteMember(acc)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer border ${
                              isRejectedOrInactive
                                ? "bg-red-600 hover:bg-red-700 text-white border-red-600"
                                : "bg-white hover:bg-red-50 text-red-700 border-red-200"
                            }`}
                            title="Permanently delete member"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
