import React from "react";
import type { AccountStatus, UserRole } from "@cc/rbac";

export const WHATSAPP_PUBLIC_DOMAIN = "whatsapp.ccapl.cc";
export const WHATSAPP_PUBLIC_ORIGIN = "https://whatsapp.ccapl.cc";

export function WhatsAppLogoIcon({
  size = 18,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M17.498 14.382c-.301-.15-1.767-.867-2.04-.966-.273-.101-.473-.15-.673.15-.197.295-.771.964-.944 1.162-.175.195-.349.21-.646.075-.3-.15-1.263-.465-2.403-1.485-.888-.795-1.484-1.77-1.66-2.07-.174-.3-.019-.465.13-.615.136-.135.301-.345.451-.525.146-.18.194-.3.297-.495.098-.21.046-.39-.034-.54-.075-.15-.673-1.62-.922-2.206-.24-.584-.487-.51-.672-.51-.172-.015-.371-.015-.571-.015-.2 0-.523.074-.797.359-.273.285-1.045 1.02-1.045 2.475s1.07 2.865 1.219 3.075c.149.21 2.095 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.345z" />
      <path d="M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.334.101 11.893c0 2.096.549 4.14 1.595 5.945L0 24l6.335-1.652c1.746.943 3.71 1.444 5.71 1.447h.005c6.585 0 11.944-5.336 11.947-11.896 0-3.181-1.248-6.177-3.477-8.45zM12.045 21.84c-1.774 0-3.51-.47-5.034-1.362l-.36-.21-3.743.975.99-3.633-.234-.37A9.873 9.873 0 0 1 2.095 11.9c.002-5.468 4.475-9.914 9.957-9.914 2.656 0 5.148 1.027 7.018 2.89 1.867 1.864 2.894 4.346 2.893 6.994-.003 5.467-4.477 9.913-9.918 9.913z" />
    </svg>
  );
}

export function RoleBadge({ role }: { role: UserRole }) {
  const styles: Record<UserRole, string> = {
    DEV: "bg-neutral-900 text-white border-neutral-900",
    SUPERADMIN: "bg-amber-50 text-amber-900 border-amber-200",
    ADMIN: "bg-blue-50 text-blue-800 border-blue-200",
    STAFF: "bg-emerald-50 text-emerald-800 border-emerald-200",
    CLIENT: "bg-neutral-100 text-neutral-700 border-neutral-300",
  };
  const label: Record<UserRole, string> = {
    DEV: "Dev (Superadmin)",
    SUPERADMIN: "Superadmin",
    ADMIN: "Admin",
    STAFF: "Staff",
    CLIENT: "Client",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${styles[role]}`}
    >
      {label[role]}
    </span>
  );
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const styles: Record<AccountStatus, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
    PENDING_APPROVAL: "bg-amber-50 text-amber-800 border-amber-200",
    UNVERIFIED_EMAIL: "bg-neutral-100 text-neutral-700 border-neutral-300",
    REJECTED: "bg-red-50 text-red-700 border-red-200",
    SUSPENDED: "bg-red-50 text-red-800 border-red-200",
  };
  const labels: Record<AccountStatus, string> = {
    ACTIVE: "Active",
    PENDING_APPROVAL: "Waiting for Approval",
    UNVERIFIED_EMAIL: "Email Not Verified",
    REJECTED: "Declined",
    SUSPENDED: "Paused",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

export function MetricStatCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string;
  subtext?: string;
  accent?: "blue" | "emerald" | "purple" | "amber";
}) {
  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-4">
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="text-2xl font-semibold text-neutral-900 mt-1">{value}</p>
      {subtext && <p className="text-xs text-neutral-500 mt-1">{subtext}</p>}
    </div>
  );
}
