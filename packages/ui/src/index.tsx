import React from "react";
import type { AccountStatus, UserRole } from "@cc/rbac";

export const WHATSAPP_PUBLIC_DOMAIN = "whatsapp.ccapl.cc";
export const WHATSAPP_PUBLIC_ORIGIN = "https://whatsapp.ccapl.cc";

export function WhatsAppLogoIcon({
  size,
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
      className={className || (size ? "" : "w-4 h-4")}
    >
      <path d="M17.498 14.382c-.301-.15-1.767-.867-2.04-.966-.273-.101-.473-.15-.673.15-.197.295-.771.964-.944 1.162-.175.195-.349.21-.646.075-.3-.15-1.263-.465-2.403-1.485-.888-.795-1.484-1.77-1.66-2.07-.174-.3-.019-.465.13-.615.136-.135.301-.345.451-.525.146-.18.194-.3.297-.495.098-.21.046-.39-.034-.54-.075-.15-.673-1.62-.922-2.206-.24-.584-.487-.51-.672-.51-.172-.015-.371-.015-.571-.015-.2 0-.523.074-.797.359-.273.285-1.045 1.02-1.045 2.475s1.07 2.865 1.219 3.075c.149.21 2.095 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.345z" />
      <path d="M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.334.101 11.893c0 2.096.549 4.14 1.595 5.945L0 24l6.335-1.652c1.746.943 3.71 1.444 5.71 1.447h.005c6.585 0 11.944-5.336 11.947-11.896 0-3.181-1.248-6.177-3.477-8.45zM12.045 21.84c-1.774 0-3.51-.47-5.034-1.362l-.36-.21-3.743.975.99-3.633-.234-.37A9.873 9.873 0 0 1 2.095 11.9c.002-5.468 4.475-9.914 9.957-9.914 2.656 0 5.148 1.027 7.018 2.89 1.867 1.864 2.894 4.346 2.893 6.994-.003 5.467-4.477 9.913-9.918 9.913z" />
    </svg>
  );
}

/**
 * Official Classic Concepts 3D multicolor hexagonal emblem PNG.
 */
export function ClassicConceptsMark({
  size = 30,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/classic-concepts-icon.png"
      width={size}
      height={size}
      alt="Classic Concepts"
      className={`object-contain select-none ${className}`}
      draggable={false}
    />
  );
}

/**
 * Official Classic Concepts full logo wordmark (3D emblem + CLASSIC CONCEPTS® + acrylic by design).
 */
export function ClassicConceptsWordmark({
  height = 44,
  variant = "light",
  className = "",
}: {
  height?: number;
  variant?: "light" | "dark";
  className?: string;
}) {
  const src =
    variant === "dark"
      ? "/classic-concepts-logo-dark.png"
      : "/classic-concepts-logo-light.png";
  return (
    <img
      src={src}
      style={{ height, width: "auto" }}
      alt="Classic Concepts - acrylic by design"
      className={`object-contain select-none ${className}`}
      draggable={false}
    />
  );
}

export const CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE: React.CSSProperties = {
  backgroundColor: "#efeae2",
  backgroundImage: 'url("/classic-concepts-chat-tile.png")',
  backgroundRepeat: "repeat",
  backgroundSize: "220px 220px",
};

export function RoleBadge({ role }: { role: UserRole }) {
  const styles: Record<UserRole, string> = {
    DEV: "bg-neutral-900 text-white border-neutral-900",
    SUPERADMIN: "bg-amber-50 text-amber-900 border-amber-200",
    MANAGER: "bg-purple-50 text-purple-900 border-purple-200",
    ADMIN: "bg-blue-50 text-blue-800 border-blue-200",
    STAFF: "bg-emerald-50 text-emerald-800 border-emerald-200",
    CLIENT: "bg-neutral-100 text-neutral-700 border-neutral-300",
  };
  const label: Record<UserRole, string> = {
    DEV: "Dev (Superadmin)",
    SUPERADMIN: "Superadmin",
    MANAGER: "Manager",
    ADMIN: "Admin",
    STAFF: "Staff",
    CLIENT: "Client",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${
        styles[role] || styles.STAFF
      }`}
    >
      {label[role] || role}
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

// ============================================================================
// ELEMENT-WISE LOADING FALLBACKS & ERROR RETRY STATES
// ============================================================================

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-neutral-200/80 ${className}`}
    />
  );
}

export function StatCardsSkeleton({
  count = 4,
  columnsClass = "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
}: {
  count?: number;
  columnsClass?: string;
}) {
  return (
    <div className={`grid ${columnsClass} gap-4`} aria-busy="true">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="bg-white rounded-lg border border-neutral-200 p-4 space-y-2.5"
        >
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-7 w-16" />
          <SkeletonBlock className="h-3 w-36" />
        </div>
      ))}
    </div>
  );
}

export function CardListSkeleton({
  items,
  rows,
  compact = false,
}: {
  items?: number;
  rows?: number;
  compact?: boolean;
}) {
  const count = items ?? rows ?? 3;
  return (
    <div className="space-y-2.5" aria-busy="true">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className={`rounded-lg border border-neutral-200 bg-white ${
            compact ? "p-3 space-y-2" : "p-4 space-y-2.5"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <SkeletonBlock className="h-3.5 w-40" />
            <SkeletonBlock className="h-5 w-16 rounded-full" />
          </div>
          <SkeletonBlock className="h-3 w-3/4" />
          {!compact && <SkeletonBlock className="h-3 w-1/2" />}
        </div>
      ))}
    </div>
  );
}

export function TableRowsSkeleton({
  rows = 5,
  columns,
  cols,
}: {
  rows?: number;
  columns?: number;
  cols?: number;
}) {
  const colCount = columns ?? cols ?? 5;
  return (
    <div className="w-full divide-y divide-neutral-200" aria-busy="true">
      {Array.from({ length: rows }).map((_, rIdx) => (
        <div
          key={rIdx}
          className="py-3 flex items-center justify-between gap-4"
        >
          {Array.from({ length: colCount }).map((__, cIdx) => (
            <SkeletonBlock
              key={cIdx}
              className={`h-3.5 ${
                cIdx === 0
                  ? "w-40"
                  : cIdx === colCount - 1
                  ? "w-20"
                  : "w-24"
              }`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChatThreadListSkeleton({
  rows,
  count,
}: {
  rows?: number;
  count?: number;
}) {
  const total = rows ?? count ?? 6;
  return (
    <div className="divide-y divide-[#f0f2f5]" aria-busy="true">
      {Array.from({ length: total }).map((_, idx) => (
        <div key={idx} className="px-3 py-3 flex items-start gap-3 bg-white">
          <SkeletonBlock className="w-11 h-11 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-2 pt-0.5">
            <div className="flex items-center justify-between gap-2">
              <SkeletonBlock className="h-3.5 w-28" />
              <SkeletonBlock className="h-2.5 w-10" />
            </div>
            <SkeletonBlock className="h-3 w-44" />
            <div className="flex items-center gap-1.5">
              <SkeletonBlock className="h-4 w-16 rounded" />
              <SkeletonBlock className="h-4 w-20 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatMessagesSkeleton({ bubbles = 5 }: { bubbles?: number }) {
  return (
    <div className="space-y-3 py-2" aria-busy="true">
      {Array.from({ length: bubbles }).map((_, idx) => {
        const outbound = idx % 2 === 1;
        return (
          <div
            key={idx}
            className={`flex ${outbound ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`w-[62%] max-w-md rounded-lg p-3 shadow-2xs space-y-2 ${
                outbound ? "bg-[#d9fdd3]/80" : "bg-white/95"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <SkeletonBlock className="h-2.5 w-20" />
                <SkeletonBlock className="h-2.5 w-12" />
              </div>
              <SkeletonBlock className="h-3 w-full" />
              <SkeletonBlock className="h-3 w-2/3" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RightDrawerSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="p-3 rounded-lg bg-[#f8f9fa] border border-[#e9edef] space-y-2">
        <SkeletonBlock className="h-2.5 w-24" />
        <SkeletonBlock className="h-3.5 w-32" />
        <SkeletonBlock className="h-3 w-40" />
      </div>
      <div className="space-y-2">
        <SkeletonBlock className="h-3 w-28" />
        <SkeletonBlock className="h-8 w-full rounded-md" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-2">
          <SkeletonBlock className="h-3 w-20" />
          <SkeletonBlock className="h-8 w-full rounded-md" />
        </div>
        <div className="space-y-2">
          <SkeletonBlock className="h-3 w-16" />
          <SkeletonBlock className="h-8 w-full rounded-md" />
        </div>
      </div>
      <div className="space-y-2">
        <SkeletonBlock className="h-3 w-36" />
        <SkeletonBlock className="h-16 w-full rounded-md" />
      </div>
    </div>
  );
}

export function ElementErrorState({
  title = "Could not load this section",
  message = "Please check your connection and try again.",
  onRetry,
  retrying = false,
  compact = false,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`rounded-lg bg-red-50/80 border border-red-200 text-red-950 ${
        compact ? "p-3" : "p-4"
      } flex flex-wrap items-center justify-between gap-3`}
    >
      <div className="space-y-0.5 min-w-0">
        <p className="text-xs font-semibold text-red-900">{title}</p>
        <p className="text-xs text-red-800">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          disabled={retrying}
          onClick={onRetry}
          className="px-3 py-1.5 rounded-md bg-white hover:bg-red-100/70 border border-red-300 text-red-900 text-xs font-semibold cursor-pointer disabled:opacity-60 shrink-0"
        >
          {retrying ? "Retrying..." : "Try Again"}
        </button>
      )}
    </div>
  );
}
