import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";
import { normalizeWhatsAppPhone } from "@cc/database";
import { sendWhatsAppCloudMessage } from "@cc/connections";

describe("F12: WhatsApp Phone Number Normalization (Tier 1 Feature Coverage)", () => {
  it("T1-F12-01: normalizes raw 10-digit Indian mobile number with +91 country prefix", () => {
    const raw = "9848011223";
    const normalized = normalizeWhatsAppPhone(raw);
    assertStrictEqual(normalized, "+919848011223");
  });

  it("T1-F12-02: cleanses formatting characters (spaces, hyphens, brackets) from 10-digit number", () => {
    const formatted = " (98480) 11-223 ";
    const normalized = normalizeWhatsAppPhone(formatted);
    assertStrictEqual(normalized, "+919848011223");
  });

  it("T1-F12-03: normalizes 12-digit Indian number lacking plus sign to standard E.164", () => {
    const input = "919848011223";
    const normalized = normalizeWhatsAppPhone(input);
    assertStrictEqual(normalized, "+919848011223");
  });

  it("T1-F12-04: preserves already normalized E.164 format without double-prepending country code", () => {
    const e164 = "+919848011223";
    const normalized = normalizeWhatsAppPhone(e164);
    assertStrictEqual(normalized, "+919848011223");
  });

  it("T1-F12-05: sendWhatsAppCloudMessage accepts 10-digit number and completes dispatch", async () => {
    const res = await sendWhatsAppCloudMessage({
      toPhone: "9848011223",
      bodyText: "Hello from Classic Concepts phone normalization test",
      forceSandbox: true,
    });

    assertStrictEqual(res.ok, true);
    assertOk(res.waMessageId, "Message ID should be returned");
  });
});
