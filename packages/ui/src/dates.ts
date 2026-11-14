import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";

export const APP_TIMEZONE = "Asia/Kolkata";

function toValidDate(
  date: string | number | Date | null | undefined
): Date | null {
  if (date === null || date === undefined || date === "") return null;
  const d =
    typeof date === "string" || typeof date === "number"
      ? new Date(date)
      : date;
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatTimeIst(
  date: string | number | Date | null | undefined
): string {
  const d = toValidDate(date);
  if (!d) return "";
  return formatInTimeZone(d, APP_TIMEZONE, "hh:mm a");
}

export function formatDateIst(
  date: string | number | Date | null | undefined
): string {
  const d = toValidDate(date);
  if (!d) return "";
  return formatInTimeZone(d, APP_TIMEZONE, "dd MMM yyyy");
}

export function formatDateShortIst(
  date: string | number | Date | null | undefined
): string {
  const d = toValidDate(date);
  if (!d) return "";
  return formatInTimeZone(d, APP_TIMEZONE, "dd MMM");
}

export function formatDateTimeIst(
  date: string | number | Date | null | undefined
): string {
  const d = toValidDate(date);
  if (!d) return "";
  return formatInTimeZone(d, APP_TIMEZONE, "dd MMM yyyy, hh:mm a");
}

export function formatDateTimeShortIst(
  date: string | number | Date | null | undefined
): string {
  const d = toValidDate(date);
  if (!d) return "";
  return formatInTimeZone(d, APP_TIMEZONE, "dd MMM, hh:mm a");
}

export function formatThreadTimeIst(
  date: string | number | Date | null | undefined,
  serverNowMs?: number
): string {
  const d = toValidDate(date);
  if (!d) return "";
  const targetDateKey = formatInTimeZone(d, APP_TIMEZONE, "yyyy-MM-dd");
  const nowDate =
    typeof serverNowMs === "number" && !Number.isNaN(serverNowMs)
      ? new Date(serverNowMs)
      : new Date();
  const nowDateKey = formatInTimeZone(nowDate, APP_TIMEZONE, "yyyy-MM-dd");
  if (targetDateKey === nowDateKey) {
    return formatInTimeZone(d, APP_TIMEZONE, "hh:mm a");
  }
  return formatInTimeZone(d, APP_TIMEZONE, "dd MMM");
}

export function parseLocalIstToUtcIso(
  dateTimeLocalStr: string | null | undefined
): string | null {
  if (!dateTimeLocalStr || typeof dateTimeLocalStr !== "string") return null;
  const clean = dateTimeLocalStr.trim();
  if (!clean) return null;
  try {
    const zoned = fromZonedTime(clean, APP_TIMEZONE);
    return Number.isNaN(zoned.getTime()) ? null : zoned.toISOString();
  } catch {
    return null;
  }
}

export function getZonedIstNow(): {
  dateKey: string;
  hour: number;
  minute: number;
} {
  const now = new Date();
  const zoned = toZonedTime(now, APP_TIMEZONE);
  return {
    dateKey: formatInTimeZone(now, APP_TIMEZONE, "yyyy-MM-dd"),
    hour: zoned.getHours(),
    minute: zoned.getMinutes(),
  };
}
