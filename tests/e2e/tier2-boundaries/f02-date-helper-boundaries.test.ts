import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertIstFormatted,
} from "../harness";
import {
  formatTimeIst,
  formatDateIst,
  formatDateShortIst,
  formatDateTimeIst,
  formatDateTimeShortIst,
  formatThreadTimeIst,
  parseLocalIstToUtcIso,
  APP_TIMEZONE,
} from "@cc/ui";

describe("F02: Centralized Date Helper Library - Boundary & Corner Cases", () => {
  it("formatTimeIst and formatDateIst boundary handling for null, undefined, and empty string", () => {
    assertStrictEqual(formatTimeIst(null), "");
    assertStrictEqual(formatTimeIst(undefined), "");
    assertStrictEqual(formatTimeIst(""), "");

    assertStrictEqual(formatDateIst(null), "");
    assertStrictEqual(formatDateIst(undefined), "");
    assertStrictEqual(formatDateIst(""), "");

    assertStrictEqual(formatDateShortIst(null), "");
    assertStrictEqual(formatDateTimeIst(null), "");
    assertStrictEqual(formatDateTimeShortIst(null), "");
    assertStrictEqual(formatThreadTimeIst(null), "");
  });

  it("parseLocalIstToUtcIso returns null on invalid or non-existent calendar dates", () => {
    // 2026 is not a leap year, February 29 does not exist
    const nonLeapDay = parseLocalIstToUtcIso("2026-02-29T10:00");
    assertStrictEqual(nonLeapDay, null, "Non-existent calendar date should yield null");

    // Completely malformed string
    const malformed = parseLocalIstToUtcIso("not-a-datetime");
    assertStrictEqual(malformed, null);

    // Empty or non-string input
    assertStrictEqual(parseLocalIstToUtcIso(""), null);
    assertStrictEqual(parseLocalIstToUtcIso(null as unknown as string), null);
    assertStrictEqual(parseLocalIstToUtcIso(undefined as unknown as string), null);
  });

  it("parseLocalIstToUtcIso trims whitespace and correctly converts valid boundaries", () => {
    const paddedInput = "   2026-12-01T14:30   ";
    const utcIso = parseLocalIstToUtcIso(paddedInput);
    // 14:30 IST is 09:00 UTC (14:30 - 5:30)
    assertStrictEqual(utcIso, "2026-12-01T09:00:00.000Z");

    // Midnight IST boundary: 00:00 IST is 18:30 UTC previous day
    const midnightIst = parseLocalIstToUtcIso("2026-11-15T00:00");
    assertStrictEqual(midnightIst, "2026-11-14T18:30:00.000Z");
  });

  it("formatThreadTimeIst handles midnight day rollover between consecutive seconds", () => {
    // 23:59:59 IST on Nov 14 is 18:29:59 UTC on Nov 14
    const msgDateUtc = "2026-11-14T18:29:59.000Z";
    // 00:00:01 IST on Nov 15 is 18:30:01 UTC on Nov 14
    const serverNowMs = new Date("2026-11-14T18:30:01.000Z").getTime();

    // Since in IST msgDate was on 14 Nov and serverNow is on 15 Nov, it must show date "14 Nov", not time
    const threadTime = formatThreadTimeIst(msgDateUtc, serverNowMs);
    assertStrictEqual(threadTime, "14 Nov");

    // Same day IST (e.g. 01:00 IST on Nov 15 vs 02:00 IST on Nov 15) must show time
    const sameDayMsg = "2026-11-14T19:30:00.000Z"; // 01:00 IST on Nov 15
    const sameDayNow = new Date("2026-11-14T20:30:00.000Z").getTime(); // 02:00 IST on Nov 15
    const sameDayTime = formatThreadTimeIst(sameDayMsg, sameDayNow);
    assertStrictEqual(sameDayTime, "01:00 AM");
    assertIstFormatted(sameDayTime, { format: "time" });
  });

  it("formatDateTimeIst and formatDateTimeShortIst handle epoch 0 and year boundaries", () => {
    // Epoch 0: 1970-01-01T00:00:00.000Z is 05:30 AM IST on 01 Jan 1970
    assertStrictEqual(formatDateTimeIst("1970-01-01T00:00:00.000Z"), "01 Jan 1970, 05:30 AM");
    assertStrictEqual(formatDateTimeShortIst("1970-01-01T00:00:00.000Z"), "01 Jan, 05:30 AM");

    // New Year Eve rollover in IST: 2025-12-31T18:29:59.000Z is 23:59:59 IST on 31 Dec 2025
    assertStrictEqual(formatDateTimeIst("2025-12-31T18:29:59.000Z"), "31 Dec 2025, 11:59 PM");

    // 1 second later: 2025-12-31T18:30:00.000Z is 00:00:00 IST on 01 Jan 2026
    assertStrictEqual(formatDateTimeIst("2025-12-31T18:30:00.000Z"), "01 Jan 2026, 12:00 AM");
    assertStrictEqual(APP_TIMEZONE, "Asia/Kolkata");
  });
});
