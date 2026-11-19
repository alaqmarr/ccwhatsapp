import React from "react";
import type { AccountStatus, UserRole } from "@cc/rbac";
import { normalizeWhatsAppDeliveryStatus } from "./helpers";

export function RoleBadge({ role }: { role: UserRole }) {
  const styles: Record<UserRole, string> = {
    DEV: "bg-slate-900 text-white border-slate-900",
    SUPERADMIN: "bg-amber-50 text-amber-900 border-amber-200/90",
    MANAGER: "bg-purple-50 text-purple-900 border-purple-200/90",
    ADMIN: "bg-blue-50 text-blue-800 border-blue-200/90",
    STAFF: "bg-emerald-50 text-emerald-800 border-emerald-200/90",
    CLIENT: "bg-slate-100 text-slate-700 border-slate-300",
  };
  const label: Record<UserRole, string> = {
    DEV: "Dev • Superadmin",
    SUPERADMIN: "Superadmin",
    MANAGER: "Manager",
    ADMIN: "Admin",
    STAFF: "Staff",
    CLIENT: "Client",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-[0.06em] border ${
        styles[role] || styles.STAFF
      }`}
    >
      {label[role] || role}
    </span>
  );
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const styles: Record<AccountStatus, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200/90",
    PENDING_APPROVAL: "bg-amber-50 text-amber-800 border-amber-200/90",
    UNVERIFIED_EMAIL: "bg-slate-100 text-slate-700 border-slate-300",
    REJECTED: "bg-red-50 text-red-700 border-red-200/90",
    SUSPENDED: "bg-red-50 text-red-800 border-red-200/90",
  };
  const labels: Record<AccountStatus, string> = {
    ACTIVE: "Active",
    PENDING_APPROVAL: "Pending Approval",
    UNVERIFIED_EMAIL: "Unverified",
    REJECTED: "Declined",
    SUSPENDED: "Paused",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-[0.055em] border ${styles[status]}`}
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
    <div className="bg-white rounded-xl border border-neutral-200/90 p-4 shadow-2xs">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
        {label}
      </p>
      <p className="metric-value text-[28px] font-bold text-slate-900 mt-1.5">
        {value}
      </p>
      {subtext && (
        <p className="text-xs leading-relaxed text-slate-500 mt-1.5">{subtext}</p>
      )}
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

// ============================================================================
// WHATSAPP DELIVERY & READ TICKS (Single, Double Grey, Double Blue + Status Label)
// ============================================================================

export function WhatsAppMessageTicks({
  status,
  showLabel = true,
  size = 15,
}: {
  status?: string | null;
  showLabel?: boolean;
  size?: number;
}) {
  const stage = normalizeWhatsAppDeliveryStatus(status);

  if (stage === "SENDING") {
    const spinnerPx = Math.max(11, size - 2);
    return (
      <span
        title="Sending message..."
        aria-label="Sending"
        className="inline-flex items-center gap-1 text-[#667781] shrink-0"
      >
        <svg
          width={spinnerPx}
          height={spinnerPx}
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className="animate-spin text-[#00a884]"
        >
          <circle
            cx="8"
            cy="8"
            r="6"
            stroke="currentColor"
            strokeOpacity="0.24"
            strokeWidth="1.9"
          />
          <path
            d="M14 8a6 6 0 0 0-6-6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
        {showLabel && (
          <span className="leading-none font-medium text-[#54656f]">
            Sending
          </span>
        )}
      </span>
    );
  }

  if (stage === "FAILED") {
    return (
      <span
        title="Message failed to deliver"
        aria-label="Failed"
        className="inline-flex items-center gap-1 text-red-600 font-semibold shrink-0"
      >
        <svg
          width={Math.max(12, size - 2)}
          height={Math.max(12, size - 2)}
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M8 4.8V8.6"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="8" cy="11.2" r="0.9" fill="currentColor" />
        </svg>
        {showLabel && <span className="leading-none">Failed</span>}
      </span>
    );
  }

  if (stage === "SENT") {
    return (
      <span
        title="Sent (1 tick)"
        aria-label="Sent"
        className="inline-flex items-center gap-1 text-[#667781] shrink-0"
      >
        <svg
          width={size}
          height={Math.round(size * 0.78)}
          viewBox="0 0 16 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M13.6 2.1L5.8 9.9L2.4 6.5"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {showLabel && <span className="leading-none">Sent</span>}
      </span>
    );
  }

  const isRead = stage === "READ";
  const label = isRead ? "Read" : "Delivered";

  return (
    <span
      title={isRead ? "Read by customer" : "Delivered to customer"}
      aria-label={label}
      className={`inline-flex items-center gap-1 shrink-0 ${
        isRead ? "text-[#0088cc] font-medium" : "text-[#54656f]"
      }`}
    >
      <svg
        width={Math.round(size * 1.24)}
        height={Math.round(size * 0.78)}
        viewBox="0 0 20 12"
        fill="none"
        aria-hidden="true"
        className={isRead ? "text-[#0095f6]" : "text-[#54656f]"}
      >
        <path
          d="M13.2 2.1L5.4 9.9L2.0 6.5"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M18.0 2.1L10.2 9.9L8.4 8.1"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showLabel && <span className="leading-none">{label}</span>}
    </span>
  );
}
