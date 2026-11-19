"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Trash2, UserCheck } from "lucide-react";
import type { UserRole } from "@cc/rbac";
import {
  AccountStatusBadge,
  CardListSkeleton,
  ElementErrorState,
} from "@cc/ui";
import {
  ApprovalsDirectoryTable,
  type StaffAccountItem,
  type StatusFilter,
} from "./ApprovalsDirectoryTable";

export function ApprovalsClient({
  initialData,
}: {
  initialData?: {
    viewerRole: UserRole;
    staff: StaffAccountItem[];
  };
}) {
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");

  const [accounts, setAccounts] = useState<StaffAccountItem[]>(
    initialData?.staff ?? []
  );
  const [viewerRole, setViewerRole] = useState<UserRole>(
    initialData?.viewerRole || "SUPERADMIN"
  );
  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>(() => {
    const next: Record<string, UserRole> = {};
    for (const acc of initialData?.staff ?? []) {
      next[acc.id] = acc.role || "STAFF";
    }
    return next;
  });
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
        setLoadError(data.error || "Could not load team accounts right now.");
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
    if (!initialData) {
      void loadAccounts();
    }
  }, [initialData, loadAccounts]);

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
      UNVERIFIED_EMAIL: otherAccounts.filter(
        (a) => a.status === "UNVERIFIED_EMAIL"
      ).length,
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
            Team Approvals &amp; Directory
          </h1>
          <p className="text-[13px] leading-relaxed text-slate-500 mt-1">
            Approve verified staff accounts, assign workspace roles, pause
            access, or permanently delete rejected and inactive members.
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
            onClick={() => void loadAccounts()}
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
            onRetry={() => void loadAccounts()}
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
                    {acc.email} • WhatsApp:{" "}
                    <strong>{acc.whatsappNumber}</strong>
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
                    onClick={() => void handleDecision(acc.id, "APPROVE")}
                    className="px-4 py-2 rounded-lg bg-[#1da851] hover:bg-[#178c43] text-white font-semibold cursor-pointer"
                  >
                    Approve
                  </button>

                  <button
                    type="button"
                    disabled={busyId === acc.id}
                    onClick={() => void handleDecision(acc.id, "REJECT")}
                    className="px-3 py-2 rounded-lg bg-white hover:bg-red-50 border border-red-200 text-red-700 font-semibold cursor-pointer"
                  >
                    Decline
                  </button>

                  <button
                    type="button"
                    disabled={busyId === acc.id}
                    onClick={() => void handleDeleteMember(acc)}
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

      <ApprovalsDirectoryTable
        loading={loading}
        loadError={loadError}
        refreshing={refreshing}
        filteredDirectory={filteredDirectory}
        counts={counts}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        viewerRole={viewerRole}
        roleDrafts={roleDrafts}
        setRoleDrafts={setRoleDrafts}
        busyId={busyId}
        onRetry={() => void loadAccounts()}
        onDecision={(id, decision) => void handleDecision(id, decision)}
        onDeleteMember={(acc) => void handleDeleteMember(acc)}
      />
    </div>
  );
}
