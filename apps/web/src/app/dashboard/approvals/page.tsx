"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
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

export default function StaffApprovalsPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");

  const [accounts, setAccounts] = useState<StaffAccountItem[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});
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

  const pendingAccounts = accounts.filter(
    (a) => a.status === "PENDING_APPROVAL"
  );
  const otherAccounts = accounts.filter((a) => a.status !== "PENDING_APPROVAL");

  return (
    <div className="w-full px-6 py-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Team Approvals & Roles
          </h1>
          <p className="text-[13.5px] leading-relaxed text-slate-500 mt-1 max-w-3xl">
            Approve verified @classiconcepts.in staff accounts and choose their workspace access level (Staff, Admin, Manager, Superadmin, Dev, or Client).
          </p>
        </div>

        <div className="flex items-center gap-2">
          {banner && (
            <div className="px-3.5 py-2 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
              {banner}
            </div>
          )}
          {errorMsg && (
            <div className="px-3.5 py-2 rounded-md bg-red-50 border border-red-200 text-xs font-medium text-red-700">
              {errorMsg}
            </div>
          )}
          <button
            type="button"
            onClick={() => loadAccounts()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white hover:bg-neutral-50 border border-neutral-300 text-xs font-medium text-neutral-700 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Waiting for Approval */}
      <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">
            Waiting for Approval ({loading ? "..." : pendingAccounts.length})
          </h2>
          <span className="text-xs text-neutral-500">
            Email verified • Ready for Superadmin or Dev review
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
          <div className="p-5 rounded-md bg-neutral-50 text-center text-xs text-neutral-500">
            No pending staff requests right now.
          </div>
        ) : (
          <div className="space-y-3">
            {pendingAccounts.map((acc) => (
              <div
                key={acc.id}
                className="p-4 rounded-md bg-amber-50/40 border border-amber-200 flex flex-wrap items-center justify-between gap-4 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-neutral-900">
                      {acc.name}
                    </span>
                    <AccountStatusBadge status={acc.status} />
                  </div>
                  <div className="text-neutral-700">
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
                    className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-900"
                  >
                    <option value="STAFF">Staff</option>
                    <option value="ADMIN">Admin</option>
                    <option value="MANAGER">
                      Manager (Templates & Broadcasts)
                    </option>
                    <option value="CLIENT">Client (Charges View Only)</option>
                    <option value="SUPERADMIN">Superadmin</option>
                    <option value="DEV">Dev (Superadmin + System)</option>
                  </select>

                  <button
                    type="button"
                    disabled={busyId === acc.id}
                    onClick={() => handleDecision(acc.id, "APPROVE")}
                    className="px-4 py-2 rounded-md bg-[#1da851] hover:bg-[#178c43] text-white font-medium cursor-pointer"
                  >
                    Approve
                  </button>

                  <button
                    type="button"
                    disabled={busyId === acc.id}
                    onClick={() => handleDecision(acc.id, "REJECT")}
                    className="px-3 py-2 rounded-md bg-white hover:bg-red-50 border border-red-200 text-red-700 font-medium cursor-pointer"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Team Directory */}
      <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-900">
          Team Members ({loading ? "..." : otherAccounts.length})
        </h2>

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
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 text-neutral-500">
                  <th className="py-2.5 pr-3 font-medium">Name & Email</th>
                  <th className="py-2.5 px-3 font-medium">WhatsApp</th>
                  <th className="py-2.5 px-3 font-medium">Role</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium">Approved By</th>
                  <th className="py-2.5 pl-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {otherAccounts.map((acc) => (
                  <tr key={acc.id}>
                    <td className="py-3 pr-3">
                      <div className="font-medium text-neutral-900">
                        {acc.name}
                      </div>
                      <div className="text-neutral-500">{acc.email}</div>
                    </td>
                    <td className="py-3 px-3 text-neutral-700">
                      {acc.whatsappNumber}
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
                      <div className="inline-flex items-center gap-1.5">
                        <select
                          value={roleDrafts[acc.id] || acc.role}
                          onChange={(e) =>
                            setRoleDrafts((prev) => ({
                              ...prev,
                              [acc.id]: e.target.value as UserRole,
                            }))
                          }
                          className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
                        >
                          <option value="STAFF">Staff</option>
                          <option value="ADMIN">Admin</option>
                          <option value="MANAGER">Manager</option>
                          <option value="CLIENT">Client</option>
                          <option value="SUPERADMIN">Superadmin</option>
                          <option value="DEV">Dev</option>
                        </select>
                        <button
                          type="button"
                          disabled={busyId === acc.id}
                          onClick={() => handleDecision(acc.id, "APPROVE")}
                          className="px-2.5 py-1 rounded bg-neutral-900 text-white text-xs font-medium cursor-pointer"
                        >
                          Save
                        </button>
                        {acc.status === "ACTIVE" && (
                          <button
                            type="button"
                            disabled={busyId === acc.id}
                            onClick={() => handleDecision(acc.id, "SUSPEND")}
                            className="px-2.5 py-1 rounded bg-white text-red-700 border border-red-200 text-xs font-medium cursor-pointer"
                          >
                            Pause
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
