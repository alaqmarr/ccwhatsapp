import { formatInTimeZone, toZonedTime } from "date-fns-tz";

export const APP_TIMEZONE = "Asia/Kolkata";

export function getCurrentIstDateAndTime(): {
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
