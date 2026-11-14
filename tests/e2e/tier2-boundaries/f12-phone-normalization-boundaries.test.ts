import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";
import { normalizeWhatsAppPhone } from "@cc/database";

describe("F12: Phone Number Normalization - Boundary & Corner Cases", () => {
  it("normalizes 11-digit Indian numbers with leading zero to standard +91", () => {
    const inputWithLeadingZero = "09848011223";
    const normalized = normalizeWhatsAppPhone(inputWithLeadingZero);
    assertStrictEqual(normalized, "+919848011223");
  });

  it("returns empty string for numbers with insufficient digits (9 digits or fewer)", () => {
    // 9 digits (too short for Indian mobile)
    assertStrictEqual(normalizeWhatsAppPhone("984801122"), "");
    // 5 digits
    assertStrictEqual(normalizeWhatsAppPhone("98480"), "");
    // 1 digit
    assertStrictEqual(normalizeWhatsAppPhone("9"), "");
  });

  it("returns empty string for empty, null, or whitespace-only inputs", () => {
    assertStrictEqual(normalizeWhatsAppPhone(""), "");
    assertStrictEqual(normalizeWhatsAppPhone("   "), "");
    assertStrictEqual(normalizeWhatsAppPhone(null as unknown as string), "");
    assertStrictEqual(normalizeWhatsAppPhone(undefined as unknown as string), "");
  });

  it("preserves international non-Indian E.164 numbers without prepending +91", () => {
    // US number (+1 415 555 2671)
    const usNumber = normalizeWhatsAppPhone("+1 415 555 2671");
    assertStrictEqual(usNumber, "+14155552671");

    // UK number (+44 7911 123456)
    const ukNumber = normalizeWhatsAppPhone("+44 7911 123456");
    assertStrictEqual(ukNumber, "+447911123456");

    // UAE number (+971 50 123 4567)
    const uaeNumber = normalizeWhatsAppPhone("+971 50 123 4567");
    assertStrictEqual(uaeNumber, "+971501234567");
  });

  it("handles alphanumeric strings and extracts clean digits or rejects", () => {
    // Alphanumeric string with only 5 digits -> rejects as empty string
    const vanityShort = normalizeWhatsAppPhone("98480-CALL-ME");
    assertStrictEqual(vanityShort, "");

    // Padded 10-digit number with dots and parentheses
    const formattedIndian = normalizeWhatsAppPhone("(98480) 11.223");
    assertStrictEqual(formattedIndian, "+919848011223");
  });
});
