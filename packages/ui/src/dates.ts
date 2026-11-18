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

export function getIstDateKey(
  date: string | number | Date | null | undefined
): string {
  const d = toValidDate(date);
  if (!d) return "";
  return formatInTimeZone(d, APP_TIMEZONE, "yyyy-MM-dd");
}

function getReferenceIstDateKeys(serverNowMs?: number): {
  nowDate: Date;
  todayKey: string;
  yesterdayKey: string;
  currentYear: string;
} {
  const nowDate =
    typeof serverNowMs === "number" && !Number.isNaN(serverNowMs)
      ? new Date(serverNowMs)
      : new Date();
  const todayKey = formatInTimeZone(nowDate, APP_TIMEZONE, "yyyy-MM-dd");
  const noonUtcMs = new Date(`${todayKey}T12:00:00+05:30`).getTime();
  const yesterdayKey = formatInTimeZone(
    new Date(noonUtcMs - 86_400_000),
    APP_TIMEZONE,
    "yyyy-MM-dd"
  );
  const currentYear = todayKey.slice(0, 4);
  return { nowDate, todayKey, yesterdayKey, currentYear };
}

export function formatChatDateDividerIst(
  date: string | number | Date | null | undefined,
  serverNowMs?: number
): string {
  const d = toValidDate(date);
  if (!d) return "";
  const targetDateKey = formatInTimeZone(d, APP_TIMEZONE, "yyyy-MM-dd");
  const { todayKey, yesterdayKey } = getReferenceIstDateKeys(serverNowMs);
  if (targetDateKey === todayKey) return "Today";
  if (targetDateKey === yesterdayKey) return "Yesterday";
  return formatInTimeZone(d, APP_TIMEZONE, "dd MMM yyyy");
}

export function formatThreadTimeIst(
  date: string | number | Date | null | undefined,
  serverNowMs?: number
): string {
  const d = toValidDate(date);
  if (!d) return "";
  const targetDateKey = formatInTimeZone(d, APP_TIMEZONE, "yyyy-MM-dd");
  const { todayKey, yesterdayKey, currentYear } =
    getReferenceIstDateKeys(serverNowMs);
  if (targetDateKey === todayKey) {
    return formatInTimeZone(d, APP_TIMEZONE, "hh:mm a");
  }
  if (targetDateKey === yesterdayKey) {
    return "Yesterday";
  }
  if (targetDateKey.slice(0, 4) === currentYear) {
    return formatInTimeZone(d, APP_TIMEZONE, "dd MMM");
  }
  return formatInTimeZone(d, APP_TIMEZONE, "dd MMM yyyy");
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
