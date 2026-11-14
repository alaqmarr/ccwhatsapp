import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertUtcIso,
} from "../harness";
import { parseLocalIstToUtcIso } from "@cc/ui";

describe("F05: Marketing Datetime-Local Parsing - Boundary & Corner Cases", () => {
  it("rejects or returns null for non-ISO malformed separator strings", () => {
    // Slash separator is not valid datetime-local
    const slashSeparated = parseLocalIstToUtcIso("2026/12/01 14:30");
    // Should be null or fail validation
    assertStrictEqual(slashSeparated, null);

    // Missing time component
    const dateOnly = parseLocalIstToUtcIso("2026-12-01");
    // Depending on parser, date without T time might parse to midnight or null
    if (dateOnly) {
      assertUtcIso(dateOnly);
    }

    // Completely invalid text
    assertStrictEqual(parseLocalIstToUtcIso("gibberish-string"), null);
  });

  it("handles leading and trailing whitespace around datetime-local strings", () => {
    const padded = "   2026-12-01T14:30   ";
    const utcIso = parseLocalIstToUtcIso(padded);
    assertOk(utcIso, "Whitespace should be trimmed");
    assertStrictEqual(utcIso, "2026-12-01T09:00:00.000Z");
    assertUtcIso(utcIso);
  });

  it("handles far future calendar schedules without integer overflow", () => {
    // Year 2035 far future schedule
    const futureSchedule = parseLocalIstToUtcIso("2035-12-01T10:00");
    assertOk(futureSchedule, "Far future date should parse safely");
    assertStrictEqual(futureSchedule, "2035-12-01T04:30:00.000Z");
    assertUtcIso(futureSchedule);
  });

  it("handles leap year schedule (2028-02-29) preserving exact minute", () => {
    // 2028 is a leap year, Feb 29 18:30 IST is 13:00 UTC
    const leapSchedule = parseLocalIstToUtcIso("2028-02-29T18:30");
    assertOk(leapSchedule, "Valid leap day must parse successfully");
    assertStrictEqual(leapSchedule, "2028-02-29T13:00:00.000Z");
    assertUtcIso(leapSchedule);
  });

  it("correctly identifies past scheduled times when compared to current UTC epoch", () => {
    const pastUtcIso = parseLocalIstToUtcIso("2020-01-01T10:00");
    assertOk(pastUtcIso);
    assertStrictEqual(pastUtcIso, "2020-01-01T04:30:00.000Z");

    const pastEpoch = new Date(pastUtcIso).getTime();
    const nowEpoch = Date.now();
    assertOk(pastEpoch < nowEpoch, "Past schedule should be strictly less than now");
  });
});
