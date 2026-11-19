import {
  SHIPPING_PROVIDER_OPTIONS,
  SHORTLINK_PUBLIC_ORIGIN,
} from "./domain-constants";

export function formatShortLinkUrl(code: string): string {
  const clean = String(code || "").trim().replace(/^\/+/, "");
  return `${SHORTLINK_PUBLIC_ORIGIN}/${clean}`;
}

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

export function normalizeInlinePhoneCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  // Reject currency, dimensions, dates, or order/SKU tokens
  if (/[₹$€£/]/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
    return null;
  }
  if (
    digits.length === 11 &&
    digits.startsWith("0") &&
    /^[6-9]/.test(digits.slice(1))
  ) {
    return `+91${digits.slice(1)}`;
  }
  if (
    digits.length === 12 &&
    digits.startsWith("91") &&
    /^[6-9]/.test(digits.slice(2))
  ) {
    return `+${digits}`;
  }
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return `+91${digits}`;
  }
  return null;
}
