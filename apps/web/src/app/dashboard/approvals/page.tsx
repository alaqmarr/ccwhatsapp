"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Trash2, UserCheck, UserX } from "lucide-react";
import type { AccountStatus, UserRole } from "@cc/rbac";
import {
  AccountStatusBadge,
  CardListSkeleton,
  ElementErrorState,
  RoleBadge,
  TableRowsSkeleton,
} from "@cc/ui";

interface StaffAccountItem {
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
  createdAt: string;
}

type StatusFilter = "ALL" | "ACTIVE" | "REJECTED" | "SUSPENDED" | "UNVERIFIED_EMAIL";

export default function StaffApprovalsPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");

  const [accounts, setAccounts] = useState<StaffAccountItem[]>([]);
  const [viewerRole, setViewerRole] = useState<UserRole>("SUPERADMIN");
  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [busyId, setBusyId] = useState<string>("");
  const [banner, setBanner] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const loadAccounts = useCallback(async () => {
    setRefreshing(true);
    setLoadError("");
    try {
      const res = await fetch("/api/staff", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && Array.isArray(data.staff)) {
        if (data.viewerRole) {
          setViewerRole(data.viewerRole as UserRole);
        }
        setAccounts(data.staff);
        const nextDrafts: Record<string, UserRole> = {};
        for (const acc of data.staff as StaffAccountItem[]) {
          nextDrafts[acc.id] = acc.role || "STAFF";
        }
        setRoleDrafts(nextDrafts);
      } else {
        setLoadError(
          data.error || "Could not load team accounts right now."
        );
      }
    } catch {
      setLoadError(
        "Network error while loading staff approvals. Click Try Again."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  async function handleDecision(
    targetUserId: string,
    decision: "APPROVE" | "REJECT" | "SUSPEND"
  ) {
    setBusyId(targetUserId);
    setBanner("");
    setErrorMsg("");
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId,
          decision,
          assignedRole: roleDrafts[targetUserId] || "STAFF",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setBanner(`Updated ${data.updated?.name || "member"}.`);
        await loadAccounts();
      } else {
        setErrorMsg(data.error || "Could not update member.");
      }
    } finally {
      setBusyId("");
    }
  }

  async function handleDeleteMember(acc: StaffAccountItem) {
    const confirmed = window.confirm(
      `Permanently delete "${acc.name}" (${acc.email}) from the workspace? Their sessions and team memberships will be removed.`
    );
    if (!confirmed) return;

    setBusyId(acc.id);
    setBanner("");
    setErrorMsg("");
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_staff",
          targetUserId: acc.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setBanner(data.message || `Deleted ${acc.name}.`);
        await loadAccounts();
      } else {
        setErrorMsg(data.error || "Could not delete member.");
      }
    } finally {
      setBusyId("");
    }
  }

  const pendingAccounts = useMemo(
    () => accounts.filter((a) => a.status === "PENDING_APPROVAL"),
    [accounts]
  );

  const otherAccounts = useMemo(
    () => accounts.filter((a) => a.status !== "PENDING_APPROVAL"),
    [accounts]
  );

  const counts = useMemo(() => {
    return {
      ALL: otherAccounts.length,
      ACTIVE: otherAccounts.filter((a) => a.status === "ACTIVE").length,
      REJECTED: otherAccounts.filter((a) => a.status === "REJECTED").length,
      SUSPENDED: otherAccounts.filter((a) => a.status === "SUSPENDED").length,
      UNVERIFIED_EMAIL: otherAccounts.filter((a) => a.status === "UNVERIFIED_EMAIL").length,
    };
  }, [otherAccounts]);

  const filteredDirectory = useMemo(() => {
    if (statusFilter === "ALL") return otherAccounts;
    return otherAccounts.filter((a) => a.status === statusFilter);
  }, [otherAccounts, statusFilter]);

  return (
    <div className="w-full px-4 sm:px-6 py-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Team Approvals & Directory
          </h1>
          <p className="text-[13px] leading-relaxed text-slate-500 mt-1">
            Approve verified staff accounts, assign workspace roles, pause access, or permanently delete rejected and inactive members.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {banner && (
            <div className="px-3 py-1.5 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
              {banner}
            </div>
          )}
          {errorMsg && (
            <div className="px-3 py-1.5 rounded-md bg-red-50 border border-red-200 text-xs font-medium text-red-700">
              {errorMsg}
            </div>
          )}
          <button
            type="button"
            onClick={() => loadAccounts()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-neutral-50 border border-neutral-300 text-xs font-semibold text-neutral-700 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Waiting for Approval */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 space-y-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-amber-600" />
            <span>
              Waiting for Approval ({loading ? "..." : pendingAccounts.length})
            </span>
          </h2>
          <span className="text-xs text-neutral-500">
            Approved staff are automatically added to Sales Team (P0)
          </span>
        </div>

        {loading ? (
          <CardListSkeleton rows={2} />
        ) : loadError ? (
          <ElementErrorState
            compact
            title="Could not load pending requests"
            message={loadError}
            onRetry={() => loadAccounts()}
            retrying={refreshing}
          />
        ) : pendingAccounts.length === 0 ? (
          <div className="p-5 rounded-lg bg-neutral-50 text-center text-xs text-neutral-500">
            No pending staff requests right now.
          </div>
        ) : (
          <div className="space-y-3">
            {pendingAccounts.map((acc) => (
              <div
                key={acc.id}
                className="p-4 rounded-lg bg-amber-50/40 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-neutral-900">
                      {acc.name}
                    </span>
                    <AccountStatusBadge status={acc.status} />
                  </div>
                  <div className="text-neutral-700 break-all">
                    {acc.email} • WhatsApp: <strong>{acc.whatsappNumber}</strong>
                    {acc.department ? ` • ${acc.department}` : ""}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={roleDrafts[acc.id] || "STAFF"}
                    onChange={(e) =>
                      setRoleDrafts((prev) => ({
                        ...prev,
                        [acc.id]: e.target.value as UserRole,
                      }))
                    }
                    className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-900"
                  >
                    <option value="STAFF">Staff</option>
                    <option value="ADMIN">Admin</option>
                    <option value="MANAGER">Manager</option>
                    <option value="SUPERADMIN">Superadmin</option>
                    {viewerRole === "DEV" && (
                      <option value="DEV">Dev (Full Platform + Profit)</option>
                    )}
                  </select>

                  <button
                    type="button"
                    disabled={busyId === acc.id}
                    onClick={() => handleDecision(acc.id, "APPROVE")}
                    className="px-4 py-2 rounded-lg bg-[#1da851] hover:bg-[#178c43] text-white font-semibold cursor-pointer"
                  >
                    Approve
                  </button>

                  <button
                    type="button"
                    disabled={busyId === acc.id}
                    onClick={() => handleDecision(acc.id, "REJECT")}
                    className="px-3 py-2 rounded-lg bg-white hover:bg-red-50 border border-red-200 text-red-700 font-semibold cursor-pointer"
                  >
                    Decline
                  </button>

                  <button
                    type="button"
                    disabled={busyId === acc.id}
                    onClick={() => handleDeleteMember(acc)}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white hover:bg-red-50 border border-neutral-300 text-red-700 font-medium cursor-pointer"
                    title="Delete request permanently"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Team Directory with Rejected / Suspended Cleanup */}
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
            onRetry={() => loadAccounts()}
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
                  <th className="py-2.5 pr-3 font-medium">Name & Email</th>
                  <th className="py-2.5 px-3 font-medium">WhatsApp & Dept</th>
                  <th className="py-2.5 px-3 font-medium">Role</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium">Reviewed By</th>
                  <th className="py-2.5 pl-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {filteredDirectory.map((acc) => {
                  const isProtectedDev = acc.role === "DEV" && viewerRole !== "DEV";
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
                              onClick={() => handleDecision(acc.id, "APPROVE")}
                              className="px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium cursor-pointer"
                            >
                              {acc.status === "ACTIVE" ? "Save Role" : "Activate"}
                            </button>

                            {acc.status === "ACTIVE" && (
                              <button
                                type="button"
                                disabled={busyId === acc.id}
                                onClick={() => handleDecision(acc.id, "SUSPEND")}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white hover:bg-amber-50 text-amber-800 border border-amber-200 text-xs font-medium cursor-pointer"
                              >
                                <UserX className="w-3 h-3" />
                                <span>Pause</span>
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={busyId === acc.id}
                              onClick={() => handleDeleteMember(acc)}
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
    </div>
  );
}
