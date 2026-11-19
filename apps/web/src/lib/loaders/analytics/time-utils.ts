import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";

export const APP_TIMEZONE = "Asia/Kolkata";

export function computeMedian(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

export function computeAverage(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sum = nums.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / nums.length);
}

export function toIstDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatInTimeZone(d, APP_TIMEZONE, "yyyy-MM-dd");
}

export function toIstHour(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const zoned = toZonedTime(d, APP_TIMEZONE);
  return zoned.getHours();
}

export function formatHourLabel(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

export function resolveAnalyticsCutoff(rawRange?: string): {
  range: string;
  cutoffIso: string;
  daysSpan: number;
  nowMs: number;
} {
  const range = (rawRange || "30d").toLowerCase();
  const nowMs = Date.now();
  let cutoffIso = "1970-01-01T00:00:00.000Z";
  let daysSpan = 30;

  if (range === "today") {
    const dateKey = formatInTimeZone(new Date(nowMs), APP_TIMEZONE, "yyyy-MM-dd");
    const startOfIstDay = fromZonedTime(`${dateKey} 00:00:00`, APP_TIMEZONE);
    cutoffIso = startOfIstDay.toISOString();
    daysSpan = 1;
  } else if (range === "7d") {
    cutoffIso = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
    daysSpan = 7;
  } else if (range === "30d") {
    cutoffIso = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
    daysSpan = 30;
  } else if (range === "90d") {
    cutoffIso = new Date(nowMs - 90 * 24 * 60 * 60 * 1000).toISOString();
    daysSpan = 90;
  }

  return { range, cutoffIso, daysSpan, nowMs };
}
