import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import { APP_TIMEZONE } from "@cc/ui";

describe("F04: Backend IST Calculations - Boundary & Corner Cases", () => {
  it("leap year day IST start-of-day calculation converts to exact UTC boundary", () => {
    // Leap day in IST: 2028-02-29 00:00:00 IST
    // Midnight in IST (+5:30) is 18:30 UTC on the previous day (2028-02-28)
    const startOfIstLeapDay = fromZonedTime("2028-02-29 00:00:00", APP_TIMEZONE);
    assertStrictEqual(startOfIstLeapDay.toISOString(), "2028-02-28T18:30:00.000Z");

    const formattedBack = formatInTimeZone(startOfIstLeapDay, APP_TIMEZONE, "yyyy-MM-dd HH:mm");
    assertStrictEqual(formattedBack, "2028-02-29 00:00");
  });

  it("midnight IST month rollover boundary transitions date keys precisely", () => {
    // 23:59:59.999 IST on Oct 31, 2026 -> UTC: 18:29:59.999Z on Oct 31
    const tMinus1ms = new Date("2026-10-31T18:29:59.999Z");
    const dateKeyOct = formatInTimeZone(tMinus1ms, APP_TIMEZONE, "yyyy-MM-dd");
    assertStrictEqual(dateKeyOct, "2026-10-31");

    // 00:00:00.000 IST on Nov 01, 2026 -> UTC: 18:30:00.000Z on Oct 31
    const tZero = new Date("2026-10-31T18:30:00.000Z");
    const dateKeyNov = formatInTimeZone(tZero, APP_TIMEZONE, "yyyy-MM-dd");
    assertStrictEqual(dateKeyNov, "2026-11-01");
  });

  it("handles negative timestamps near epoch 0 boundary without runtime crash", () => {
    // 1 second before epoch 0: 1969-12-31T23:59:59.000Z
    // In IST (+5:30), this is 1970-01-01 05:29:59 AM
    const negativeTimestamp = new Date(-1000);
    const dateKey = formatInTimeZone(negativeTimestamp, APP_TIMEZONE, "yyyy-MM-dd");
    assertStrictEqual(dateKey, "1970-01-01");

    const timeString = formatInTimeZone(negativeTimestamp, APP_TIMEZONE, "hh:mm:ss a");
    assertStrictEqual(timeString, "05:29:59 AM");
  });

  it("hour boundary rollover across midnight IST maps to hour 23 and hour 0", () => {
    // 23:59 IST is 18:29 UTC
    const dateHour23 = new Date("2026-11-15T18:29:00.000Z");
    const zoned23 = toZonedTime(dateHour23, APP_TIMEZONE);
    assertStrictEqual(zoned23.getHours(), 23);

    // 00:00 IST is 18:30 UTC
    const dateHour0 = new Date("2026-11-15T18:30:00.000Z");
    const zoned0 = toZonedTime(dateHour0, APP_TIMEZONE);
    assertStrictEqual(zoned0.getHours(), 0);
  });

  it("analytics 7-day bucket alignment initializes all 7 days in IST with zero counts", () => {
    const chartDays = 7;
    const nowMs = new Date("2026-11-15T10:00:00.000Z").getTime();
    const dailyMap = new Map<string, { date: string; label: string; count: number }>();

    for (let i = chartDays - 1; i >= 0; i--) {
      const dMs = nowMs - i * 24 * 60 * 60 * 1000;
      const key = formatInTimeZone(new Date(dMs), APP_TIMEZONE, "yyyy-MM-dd");
      const parsed = fromZonedTime(`${key} 00:00:00`, APP_TIMEZONE);
      const label = formatInTimeZone(parsed, APP_TIMEZONE, "d MMM");
      dailyMap.set(key, { date: key, label, count: 0 });
    }

    assertStrictEqual(dailyMap.size, 7);
    for (const bucket of dailyMap.values()) {
      assertStrictEqual(bucket.count, 0);
      assertOk(/^\d{4}-\d{2}-\d{2}$/.test(bucket.date));
    }
  });
});
