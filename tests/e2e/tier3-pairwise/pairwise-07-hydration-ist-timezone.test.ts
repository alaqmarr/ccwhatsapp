import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertIstFormatted,
  assertUtcIso,
} from "../harness";
import {
  formatDateIst,
  formatTimeIst,
  formatDateTimeIst,
  formatDateShortIst,
  formatDateTimeShortIst,
  formatThreadTimeIst,
  getZonedIstNow,
  APP_TIMEZONE,
} from "@cc/ui";
import { formatInTimeZone } from "date-fns-tz";

describe("Pairwise 07: Hydration Consistency & Backend IST Timezone (F3 + F2 + F4)", () => {
  it("generates deterministic IST date and time strings regardless of client machine timezone (F3 + F2)", () => {
    // 2026-11-15 05:00:00 UTC -> 10:30 AM IST
    const testUtcIso = "2026-11-15T05:00:00.000Z";

    const timeIst = formatTimeIst(testUtcIso);
    assertStrictEqual(timeIst, "10:30 AM");
    assertIstFormatted(timeIst, { format: "time" });

    const dateIst = formatDateIst(testUtcIso);
    assertStrictEqual(dateIst, "15 Nov 2026");
    assertIstFormatted(dateIst, { format: "date" });

    const dateTimeIst = formatDateTimeIst(testUtcIso);
    assertStrictEqual(dateTimeIst, "15 Nov 2026, 10:30 AM");
    assertIstFormatted(dateTimeIst, { format: "dateTime" });

    const dateShortIst = formatDateShortIst(testUtcIso);
    assertStrictEqual(dateShortIst, "15 Nov");
    assertIstFormatted(dateShortIst, { format: "dateShort" });

    const dateTimeShortIst = formatDateTimeShortIst(testUtcIso);
    assertStrictEqual(dateTimeShortIst, "15 Nov, 10:30 AM");
    assertIstFormatted(dateTimeShortIst, { format: "dateTimeShort" });
  });

  it("handles exact IST midnight boundaries correctly at 18:30 UTC (F4 + F2)", () => {
    // 18:29:59 UTC on 14 Nov -> 23:59:59 IST on 14 Nov
    const beforeMidnightUtc = "2026-11-14T18:29:59.000Z";
    const dateKeyBefore = formatInTimeZone(new Date(beforeMidnightUtc), APP_TIMEZONE, "yyyy-MM-dd");
    const timeBefore = formatTimeIst(beforeMidnightUtc);
    assertStrictEqual(dateKeyBefore, "2026-11-14");
    assertStrictEqual(timeBefore, "11:59 PM");

    // 18:30:00 UTC on 14 Nov -> 00:00:00 IST on 15 Nov (exact boundary shift)
    const exactMidnightUtc = "2026-11-14T18:30:00.000Z";
    const dateKeyMidnight = formatInTimeZone(new Date(exactMidnightUtc), APP_TIMEZONE, "yyyy-MM-dd");
    const timeMidnight = formatTimeIst(exactMidnightUtc);
    assertStrictEqual(dateKeyMidnight, "2026-11-15");
    assertStrictEqual(timeMidnight, "12:00 AM");
  });

  it("renders thread time correctly distinguishing today from prior days in IST (F3 + F2)", () => {
    // Message sent at 10:30 AM IST today
    const messageUtc = "2026-11-15T05:00:00.000Z";

    // Server reference time is 3:00 PM IST on the same day (09:30 UTC)
    const sameDayNowMs = new Date("2026-11-15T09:30:00.000Z").getTime();
    const todayThreadTime = formatThreadTimeIst(messageUtc, sameDayNowMs);
    assertStrictEqual(todayThreadTime, "10:30 AM", "Same-day messages must render time of day");

    // Server reference time is next day in IST (16 Nov 2026 06:00 UTC -> 11:30 AM IST)
    const nextDayNowMs = new Date("2026-11-16T06:00:00.000Z").getTime();
    const priorDayThreadTime = formatThreadTimeIst(messageUtc, nextDayNowMs);
    assertStrictEqual(priorDayThreadTime, "15 Nov", "Prior-day messages must render short date");
  });

  it("provides getZonedIstNow returning synchronized date key and hour/minute in Asia/Kolkata (F4)", () => {
    const zoned = getZonedIstNow();
    assertOk(zoned.dateKey);
    assertStrictEqual(typeof zoned.hour, "number");
    assertStrictEqual(typeof zoned.minute, "number");
    assertOk(zoned.hour >= 0 && zoned.hour <= 23);
    assertOk(zoned.minute >= 0 && zoned.minute <= 59);

    // Verify formatInTimeZone alignment
    const expectedDateKey = formatInTimeZone(new Date(), APP_TIMEZONE, "yyyy-MM-dd");
    assertStrictEqual(zoned.dateKey, expectedDateKey);
  });

  it("ensures UI date rendering functions produce no client/server mismatch on invalid inputs (F3 + F2)", () => {
    // Both SSR and client safely handle empty/null inputs by returning ""
    assertStrictEqual(formatTimeIst(null), "");
    assertStrictEqual(formatTimeIst(undefined), "");
    assertStrictEqual(formatDateIst(""), "");
    assertStrictEqual(formatDateTimeIst("not-a-date"), "");
    assertStrictEqual(formatThreadTimeIst(null), "");
  });
});
