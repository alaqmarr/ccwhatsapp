import React from "react";
import type { AccountStatus, UserRole } from "@cc/rbac";

export const WHATSAPP_PUBLIC_DOMAIN = "chat.ccapl.cc";
export const WHATSAPP_PUBLIC_ORIGIN = "https://chat.ccapl.cc";
export const SHORTLINK_PUBLIC_DOMAIN = "ccapl.cc";
export const SHORTLINK_PUBLIC_ORIGIN = "https://ccapl.cc";
export const TRACKING_PUBLIC_DOMAIN = "track.ccapl.cc";
export const TRACKING_PUBLIC_ORIGIN = "https://track.ccapl.cc";
export const TRACKING_SECONDARY_DOMAIN = "track.ccapl.in";

export function formatShortLinkUrl(code: string): string {
  const clean = String(code || "").trim().replace(/^\/+/, "");
  return `${SHORTLINK_PUBLIC_ORIGIN}/${clean}`;
}

export interface ShippingProviderOption {
  code: string;
  name: string;
  urlTemplate: string;
  placeholder: string;
}

export const SHIPPING_PROVIDER_OPTIONS: ShippingProviderOption[] = [
  {
    code: "DELHIVERY",
    name: "Delhivery",
    urlTemplate: "https://www.delhivery.com/track/package/{awb}",
    placeholder: "AWB / Waybill e.g. 1490827364512",
  },
  {
    code: "BLUEDART",
    name: "Blue Dart",
    urlTemplate: "https://www.bluedart.com/tracking?trackFor=0&trackNo={awb}",
    placeholder: "Waybill e.g. 76901234811",
  },
  {
    code: "SAFEEXPRESS",
    name: "Safexpress",
    urlTemplate: "https://www.safexpress.com/track?waybill={awb}",
    placeholder: "Waybill / LR No. e.g. SFX99201844",
  },
  {
    code: "DTDC",
    name: "DTDC",
    urlTemplate: "https://www.dtdc.in/trace.asp?strCnno={awb}",
    placeholder: "Consignment No. e.g. D82910442",
  },
  {
    code: "VRL",
    name: "VRL Logistics",
    urlTemplate: "https://www.vrlgroup.in/track_consignment.aspx?lrno={awb}",
    placeholder: "LR No. e.g. 1092837465",
  },
  {
    code: "TCIEXPRESS",
    name: "TCI Express",
    urlTemplate: "https://www.tciexpress.in/trackingdocket.asp?docketno={awb}",
    placeholder: "Docket No. e.g. 492018372",
  },
  {
    code: "GATI",
    name: "Gati KWE",
    urlTemplate: "https://www.gati.com/track-by-docket/?dktno={awb}",
    placeholder: "Docket No. e.g. 381920411",
  },
  {
    code: "TRACKON",
    name: "Trackon",
    urlTemplate: "https://trackon.in/Tracking/TrackConsignment?awb={awb}",
    placeholder: "AWB No. e.g. 5002918273",
  },
  {
    code: "SHIPROCKET",
    name: "Shiprocket",
    urlTemplate: "https://shiprocket.co/tracking/{awb}",
    placeholder: "AWB / Tracking ID",
  },
  {
    code: "DHL",
    name: "DHL Express",
    urlTemplate: "https://www.dhl.com/in-en/home/tracking.html?tracking-id={awb}",
    placeholder: "DHL Waybill Number",
  },
  {
    code: "FEDEX",
    name: "FedEx",
    urlTemplate: "https://www.fedex.com/fedextrack/?trknbr={awb}",
    placeholder: "FedEx Tracking Number",
  },
  {
    code: "INDIAPOST",
    name: "India Post",
    urlTemplate:
      "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx",
    placeholder: "Consignment No. e.g. EE123456789IN",
  },
  {
    code: "PORTER",
    name: "Porter / Local Tempo",
    urlTemplate: "",
    placeholder: "Trip ID or Driver Ref",
  },
  {
    code: "CUSTOM",
    name: "Other Courier / Direct Link",
    urlTemplate: "",
    placeholder: "Consignment / Reference No.",
  },
];

export function buildClientProviderTrackingUrl(
  providerCode: string,
  awbNumber: string,
  customUrl?: string
): string {
  const cleanCustom = String(customUrl || "").trim();
  if (/^https?:\/\//i.test(cleanCustom)) return cleanCustom;
  const opt = SHIPPING_PROVIDER_OPTIONS.find(
    (p) => p.code === providerCode.toUpperCase()
  );
  const cleanAwb = String(awbNumber || "").trim();
  if (!opt || !opt.urlTemplate) return cleanCustom;
  if (!cleanAwb && opt.urlTemplate.includes("{awb}")) return "";
  return opt.urlTemplate.replace("{awb}", encodeURIComponent(cleanAwb));
}

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

export type WhatsAppDeliveryStage =
  | "SENDING"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED";

export function normalizeWhatsAppDeliveryStatus(
  raw?: string | null
): WhatsAppDeliveryStage {
  const s = String(raw || "SENT").trim().toUpperCase();
  if (s === "SENDING" || s === "QUEUED" || s === "PENDING") return "SENDING";
  if (s === "FAILED" || s === "UNDELIVERED" || s === "ERROR") return "FAILED";
  if (s === "READ" || s === "SEEN" || s === "PLAYED") return "READ";
  if (s === "DELIVERED") return "DELIVERED";
  return "SENT";
}

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

// ============================================================================
// WHATSAPP RICH MESSAGE FORMATTER (*bold*, _italic_, ~strike~, `code`, \n, URLs)
// ============================================================================

export function stripWhatsAppFormatting(text: string): string {
  if (!text) return "";
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, " ")
    .replace(/```([\s\S]*?)```/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(?<![a-zA-Z0-9])\*([^\s*\n](?:[^*\n]*[^\s*\n])?)\*(?![a-zA-Z0-9])/g, "$1")
    .replace(/(?<![a-zA-Z0-9])_([^\s_\n](?:[^_\n]*[^\s_\n])?)_(?![a-zA-Z0-9])/g, "$1")
    .replace(/(?<![a-zA-Z0-9])~([^\s~\n](?:[^~\n]*[^\s~\n])?)~(?![a-zA-Z0-9])/g, "$1")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeInlinePhoneCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  // Reject currency, dimensions, dates, or order/SKU tokens
  if (/[₹$€£/]/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
    return null;
  }
  if (digits.length === 11 && digits.startsWith("0") && /^[6-9]/.test(digits.slice(1))) {
    return `+91${digits.slice(1)}`;
  }
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]/.test(digits.slice(2))) {
    return `+${digits}`;
  }
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return `+91${digits}`;
  }
  return null;
}

function renderWhatsAppInline(
  input: string,
  keyPrefix: string,
  depth = 0,
  onPhoneClick?: (phone: string, rawDisplay: string) => void
): React.ReactNode[] {
  if (!input) return [];
  if (depth > 2) return [input];

  const nodes: React.ReactNode[] = [];
  const tokenRegex =
    /(`[^`\n]+`)|(https?:\/\/[^\s<]+)|(\*\*[^*\n]+\*\*)|((?<![a-zA-Z0-9])\*[^\s*\n](?:[^*\n]*[^\s*\n])?\*(?![a-zA-Z0-9]))|((?<![a-zA-Z0-9])_[^\s_\n](?:[^_\n]*[^\s_\n])?_(?![a-zA-Z0-9]))|((?<![a-zA-Z0-9])~[^\s~\n](?:[^~\n]*[^\s~\n])?~(?![a-zA-Z0-9]))|((?<![a-zA-Z0-9₹$#/.+-])(?:\+\d{1,3}[\s.-]?(?:\(?\d{2,5}\)?[\s.-]?){2,4}\d{2,5}|(?:0|91[\s.-]?)?[6-9]\d{4}[\s.-]?\d{5}|(?:0|91[\s.-]?)?[6-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{4})(?![a-zA-Z0-9]))/g;

  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let tokenCount = 0;

  while ((match = tokenRegex.exec(input)) !== null) {
    const start = match.index;
    const raw = match[0];

    if (start > lastIdx) {
      nodes.push(input.slice(lastIdx, start));
    }

    const k = `${keyPrefix}_t${tokenCount++}`;

    if (match[1]) {
      // Inline `code`
      nodes.push(
        <code
          key={k}
          className="px-1 py-0.5 rounded bg-black/[0.06] font-mono text-[0.9em] text-gray-900"
        >
          {raw.slice(1, -1)}
        </code>
      );
      lastIdx = start + raw.length;
    } else if (match[2]) {
      // URL - trim trailing punctuation cleanly
      let cleanUrl = raw;
      let trailing = "";
      while (/[.,;:!?)]$/.test(cleanUrl)) {
        if (
          cleanUrl.endsWith(")") &&
          (cleanUrl.match(/\(/g) || []).length >=
            (cleanUrl.match(/\)/g) || []).length
        ) {
          break;
        }
        trailing = cleanUrl.slice(-1) + trailing;
        cleanUrl = cleanUrl.slice(0, -1);
      }
      nodes.push(
        <a
          key={k}
          href={cleanUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[#027eb5] hover:underline break-all font-medium [overflow-wrap:anywhere]"
        >
          {cleanUrl}
        </a>
      );
      if (trailing) nodes.push(trailing);
      lastIdx = start + raw.length;
    } else if (match[3]) {
      // **bold** fallback
      const inner = raw.slice(2, -2);
      nodes.push(
        <strong key={k} className="font-semibold text-gray-950">
          {renderWhatsAppInline(inner, k, depth + 1, onPhoneClick)}
        </strong>
      );
      lastIdx = start + raw.length;
    } else if (match[4]) {
      // WhatsApp *bold*
      const inner = raw.slice(1, -1);
      nodes.push(
        <strong key={k} className="font-semibold text-gray-950">
          {renderWhatsAppInline(inner, k, depth + 1, onPhoneClick)}
        </strong>
      );
      lastIdx = start + raw.length;
    } else if (match[5]) {
      // WhatsApp _italic_
      const inner = raw.slice(1, -1);
      nodes.push(
        <em key={k} className="italic">
          {renderWhatsAppInline(inner, k, depth + 1, onPhoneClick)}
        </em>
      );
      lastIdx = start + raw.length;
    } else if (match[6]) {
      // WhatsApp ~strikethrough~
      const inner = raw.slice(1, -1);
      nodes.push(
        <del key={k} className="line-through opacity-80">
          {renderWhatsAppInline(inner, k, depth + 1, onPhoneClick)}
        </del>
      );
      lastIdx = start + raw.length;
    } else if (match[7]) {
      const normalizedPhone = onPhoneClick ? normalizeInlinePhoneCandidate(raw) : null;
      if (normalizedPhone && onPhoneClick) {
        nodes.push(
          <button
            key={k}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPhoneClick(normalizedPhone, raw.trim());
            }}
            title={`Open or start WhatsApp chat with ${normalizedPhone}`}
            className="inline text-[#008069] hover:text-[#006452] underline decoration-[#00a884]/60 underline-offset-2 font-medium cursor-pointer"
          >
            {raw}
          </button>
        );
      } else {
        nodes.push(raw);
      }
      lastIdx = start + raw.length;
    } else {
      nodes.push(raw);
      lastIdx = start + raw.length;
    }
  }

  if (lastIdx < input.length) {
    nodes.push(input.slice(lastIdx));
  }

  return nodes;
}

export const WhatsAppFormattedText = React.memo(function WhatsAppFormattedText({
  text,
  className = "",
  onPhoneClick,
}: {
  text: string;
  className?: string;
  onPhoneClick?: (phone: string, rawDisplay: string) => void;
}) {
  if (!text) return null;

  const normalized = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n");

  // Split by fenced ```code blocks``` first
  const segments = normalized.split(/(```[\s\S]*?```)/g);

  return (
    <div className={`min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-[1.48] ${className}`}>
      {segments.map((seg, segIdx) => {
        if (seg.startsWith("```") && seg.endsWith("```") && seg.length >= 6) {
          const codeBody = seg.slice(3, -3).replace(/^\n+|\n+$/g, "");
          return (
            <pre
              key={`cb_${segIdx}`}
              className="my-1.5 p-2 rounded-md bg-black/[0.06] font-mono text-[12px] leading-relaxed max-w-full overflow-x-auto whitespace-pre-wrap break-all"
            >
              {codeBody}
            </pre>
          );
        }

        const lines = seg.split("\n");
        return (
          <React.Fragment key={`seg_${segIdx}`}>
            {lines.map((line, lineIdx) => {
              const isLastLine = lineIdx === lines.length - 1;
              const trimmed = line.trimStart();

              // Empty line -> clean paragraph spacing
              if (line.trim() === "") {
                return !isLastLine ? (
                  <div key={`br_${segIdx}_${lineIdx}`} className="h-2" />
                ) : null;
              }

              // Blockquote (> text)
              if (/^>\s+/.test(trimmed)) {
                const quoteText = trimmed.replace(/^>\s+/, "");
                return (
                  <div
                    key={`q_${segIdx}_${lineIdx}`}
                    className="my-0.5 pl-2.5 border-l-2 border-emerald-600/50 text-gray-700 min-w-0 [overflow-wrap:anywhere]"
                  >
                    {renderWhatsAppInline(quoteText, `q_${segIdx}_${lineIdx}`, 0, onPhoneClick)}
                  </div>
                );
              }

              // Bullet list (• text, - text, or * text with space)
              const bulletMatch = trimmed.match(/^(?:[•●▪-]\s+|\*\s+)(.+)$/);
              if (bulletMatch) {
                return (
                  <div
                    key={`ul_${segIdx}_${lineIdx}`}
                    className="flex items-start gap-1.5 my-0.5 min-w-0"
                  >
                    <span className="select-none text-current opacity-75 shrink-0 leading-[1.48]">
                      •
                    </span>
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      {renderWhatsAppInline(
                        bulletMatch[1],
                        `ul_${segIdx}_${lineIdx}`,
                        0,
                        onPhoneClick
                      )}
                    </span>
                  </div>
                );
              }

              // Numbered list (1. text)
              const numMatch = trimmed.match(/^(\d{1,2}[.)])\s+(.+)$/);
              if (numMatch) {
                return (
                  <div
                    key={`ol_${segIdx}_${lineIdx}`}
                    className="flex items-start gap-1.5 my-0.5 min-w-0"
                  >
                    <span className="font-semibold shrink-0 leading-[1.48]">
                      {numMatch[1]}
                    </span>
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      {renderWhatsAppInline(
                        numMatch[2],
                        `ol_${segIdx}_${lineIdx}`,
                        0,
                        onPhoneClick
                      )}
                    </span>
                  </div>
                );
              }

              return (
                <React.Fragment key={`ln_${segIdx}_${lineIdx}`}>
                  {renderWhatsAppInline(line, `ln_${segIdx}_${lineIdx}`, 0, onPhoneClick)}
                  {!isLastLine && lines[lineIdx + 1]?.trim() !== "" && "\n"}
                </React.Fragment>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
});

export * from "./dates";

