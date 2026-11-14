import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import { APP_TIMEZONE, getZonedIstNow } from "@cc/ui";

describe("F04: Backend IST Calculations via date-fns-tz (Tier 1 Feature Coverage)", () => {
  it("T1-F04-01: getZonedIstNow calculates correct current IST dateKey, hour, and minute", () => {
    const zoned = getZonedIstNow();
    assertOk(zoned.dateKey, "dateKey should be present");
    assertOk(/^\d{4}-\d{2}-\d{2}$/.test(zoned.dateKey), "dateKey should match YYYY-MM-DD pattern");
    assertOk(zoned.hour >= 0 && zoned.hour <= 23, "hour should be between 0 and 23");
    assertOk(zoned.minute >= 0 && zoned.minute <= 59, "minute should be between 0 and 59");

    // Cross-verify with date-fns-tz direct zoned conversion
    const expected = toZonedTime(new Date(), APP_TIMEZONE);
    assertStrictEqual(zoned.hour, expected.getHours());
    assertStrictEqual(zoned.minute, expected.getMinutes());
  });

  it("T1-F04-02: fromZonedTime accurately derives UTC ISO for start of IST day (midnight)", () => {
    // 2026-11-15 00:00:00 IST is 2026-11-14 18:30:00 UTC
    const startOfIstDayUtc = fromZonedTime("2026-11-15 00:00:00", APP_TIMEZONE).toISOString();
    assertStrictEqual(startOfIstDayUtc, "2026-11-14T18:30:00.000Z");

    // 2026-01-01 00:00:00 IST is 2025-12-31 18:30:00 UTC
    const yearStartOfIstDay = fromZonedTime("2026-01-01 00:00:00", APP_TIMEZONE).toISOString();
    assertStrictEqual(yearStartOfIstDay, "2025-12-31T18:30:00.000Z");
  });

  it("T1-F04-03: converts millisecond timestamps to exact IST date keys", () => {
    // Epoch timestamp 1763198400000 = 2025-11-15T09:20:00.000Z -> IST is 14:50 on 2025-11-15
    const ms = 1763198400000;
    const dateKey = formatInTimeZone(new Date(ms), APP_TIMEZONE, "yyyy-MM-dd");
    assertStrictEqual(dateKey, "2025-11-15");
  });

  it("T1-F04-04: converts UTC moment to accurate IST hour without manual millisecond math", () => {
    // 06:00 UTC + 5:30 = 11:30 IST -> hour is 11
    const testDate = new Date("2026-11-15T06:00:00.000Z");
    const zoned = toZonedTime(testDate, APP_TIMEZONE);
    assertStrictEqual(zoned.getHours(), 11);

    // 20:00 UTC + 5:30 = 01:30 IST next day -> hour is 1
    const lateUtc = new Date("2026-11-15T20:00:00.000Z");
    const nextDayZoned = toZonedTime(lateUtc, APP_TIMEZONE);
    assertStrictEqual(nextDayZoned.getHours(), 1);
  });

  it("T1-F04-05: verifies 7-day analytics bucket range generation aligned to IST boundaries", () => {
    const now = new Date();
    const buckets: Array<{ date: string; label: string }> = [];

    for (let i = 6; i >= 0; i--) {
      const dMs = now.getTime() - i * 24 * 60 * 60 * 1000;
      const key = formatInTimeZone(new Date(dMs), APP_TIMEZONE, "yyyy-MM-dd");
      const parsed = fromZonedTime(`${key} 00:00:00`, APP_TIMEZONE);
      const label = formatInTimeZone(parsed, APP_TIMEZONE, "d MMM");
      buckets.push({ date: key, label });
    }

    assertStrictEqual(buckets.length, 7, "Should generate exactly 7 daily buckets");
    for (const bucket of buckets) {
      assertOk(/^\d{4}-\d{2}-\d{2}$/.test(bucket.date), `Bucket date "${bucket.date}" must match YYYY-MM-DD`);
      assertOk(bucket.label, "Bucket label must be non-empty");
    }

    // Verify chronological order
    for (let i = 1; i < buckets.length; i++) {
      assertOk(buckets[i].date >= buckets[i - 1].date, "Buckets must be in chronological order");
    }
  });
});
