import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertThrows,
  assertIstFormatted,
} from "../harness";
import { formatInTimeZone } from "date-fns-tz";
import { formatTimeIst, formatDateIst, APP_TIMEZONE } from "@cc/ui";

describe("F01: Date-fns & Date-fns-tz Installation - Boundary & Corner Cases", () => {
  it("rejects invalid or non-existent timezone strings in formatInTimeZone", () => {
    assertThrows(() => {
      formatInTimeZone(new Date("2026-11-15T05:00:00Z"), "Invalid/NonExistentZone", "yyyy-MM-dd");
    }, RangeError);
  });

  it("handles null or undefined date inputs gracefully via helper without uncaught process crash", () => {
    // Falsy inputs should safely return empty string without throwing
    assertStrictEqual(formatTimeIst(null), "");
    assertStrictEqual(formatTimeIst(undefined), "");
    assertStrictEqual(formatTimeIst(""), "");
  });

  it("handles NaN and invalid date strings gracefully without throwing", () => {
    assertStrictEqual(formatDateIst("invalid-date-string"), "");
    assertStrictEqual(formatDateIst(NaN), "");
  });

  it("handles extreme epoch boundary (epoch 0: 1970-01-01T00:00:00Z)", () => {
    const epochZero = new Date(0);
    // In IST (+05:30), 1970-01-01T00:00:00Z is 05:30 AM
    const formatted = formatInTimeZone(epochZero, APP_TIMEZONE, "yyyy-MM-dd HH:mm");
    assertStrictEqual(formatted, "1970-01-01 05:30");

    const timeIst = formatTimeIst(epochZero);
    assertStrictEqual(timeIst, "05:30 AM");
    assertIstFormatted(timeIst, { format: "time" });
  });

  it("handles sub-millisecond ISO timestamp parsing and formatting", () => {
    // High-precision ISO string with microseconds
    const isoWithMicroseconds = "2026-11-15T05:00:00.123456Z";
    const parsedDate = new Date(isoWithMicroseconds);
    assertOk(!Number.isNaN(parsedDate.getTime()), "Sub-millisecond timestamp should parse validly");

    const timeIst = formatTimeIst(isoWithMicroseconds);
    assertStrictEqual(timeIst, "10:30 AM");
    assertIstFormatted(timeIst, { format: "time" });
  });
});
