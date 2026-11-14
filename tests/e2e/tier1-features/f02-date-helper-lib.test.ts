import {
  describe,
  it,
  assertStrictEqual,
  assertIstFormatted,
  assertUtcIso,
} from "../harness";
import {
  formatTimeIst,
  formatDateIst,
  formatDateTimeIst,
  formatDateShortIst,
  formatDateTimeShortIst,
  parseLocalIstToUtcIso,
  APP_TIMEZONE,
} from "@cc/ui";

describe("F02: Centralized Date Helper Library @cc/ui (Tier 1 Feature Coverage)", () => {
  it("T1-F02-01: formatTimeIst converts UTC ISO string to 12-hour IST format", () => {
    // 05:00 UTC -> 10:30 AM IST
    const utcIso = "2026-11-15T05:00:00.000Z";
    const res = formatTimeIst(utcIso);
    assertStrictEqual(res, "10:30 AM");
    assertIstFormatted(res, { format: "time" });

    // 14:45 UTC -> 08:15 PM IST
    const eveningUtc = "2026-11-15T14:45:00.000Z";
    const eveningRes = formatTimeIst(eveningUtc);
    assertStrictEqual(eveningRes, "08:15 PM");
    assertIstFormatted(eveningRes, { format: "time" });
  });

  it("T1-F02-02: formatDateIst converts UTC ISO string to dd MMM yyyy IST format", () => {
    const utcIso = "2026-11-15T05:00:00.000Z";
    const res = formatDateIst(utcIso);
    assertStrictEqual(res, "15 Nov 2026");
    assertIstFormatted(res, { format: "date" });

    // Edge across midnight boundary: 2026-11-14T20:00:00Z -> 2026-11-15T01:30:00 IST
    const postMidnightUtc = "2026-11-14T20:00:00.000Z";
    const nextDayRes = formatDateIst(postMidnightUtc);
    assertStrictEqual(nextDayRes, "15 Nov 2026");
    assertIstFormatted(nextDayRes, { format: "date" });
  });

  it("T1-F02-03: formatDateTimeIst converts UTC timestamp to combined dd MMM yyyy, hh:mm a IST", () => {
    const utcIso = "2026-11-15T05:00:00.000Z";
    const res = formatDateTimeIst(utcIso);
    assertStrictEqual(res, "15 Nov 2026, 10:30 AM");
    assertIstFormatted(res, { format: "dateTime" });
  });

  it("T1-F02-04: formatDateShortIst and formatDateTimeShortIst generate compact IST strings", () => {
    const utcIso = "2026-11-15T05:00:00.000Z";

    const shortDate = formatDateShortIst(utcIso);
    assertStrictEqual(shortDate, "15 Nov");
    assertIstFormatted(shortDate, { format: "dateShort" });

    const shortDateTime = formatDateTimeShortIst(utcIso);
    assertStrictEqual(shortDateTime, "15 Nov, 10:30 AM");
    assertIstFormatted(shortDateTime, { format: "dateTimeShort" });
  });

  it("T1-F02-05: parseLocalIstToUtcIso parses datetime-local string to UTC ISO preserving Asia/Kolkata", () => {
    assertStrictEqual(APP_TIMEZONE, "Asia/Kolkata");

    // "2026-11-15T10:30" IST -> 05:00 UTC
    const localInput = "2026-11-15T10:30";
    const utcIso = parseLocalIstToUtcIso(localInput);
    assertStrictEqual(utcIso, "2026-11-15T05:00:00.000Z");
    assertUtcIso(utcIso);

    // "2026-12-01T14:30" IST -> 09:00 UTC
    const afternoonInput = "2026-12-01T14:30";
    const afternoonUtc = parseLocalIstToUtcIso(afternoonInput);
    assertStrictEqual(afternoonUtc, "2026-12-01T09:00:00.000Z");
    assertUtcIso(afternoonUtc);
  });
});
