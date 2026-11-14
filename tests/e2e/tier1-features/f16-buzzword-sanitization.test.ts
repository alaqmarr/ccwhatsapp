import {
  describe,
  it,
  assertStrictEqual,
  assertNoBuzzwords,
  assertNoDashes,
} from "../harness";
import { formatWhatsAppOutboundText } from "@cc/connections";

describe("F16: Anti-AI Buzzword & Punctuation Sanitization (Tier 1 Feature Coverage)", () => {
  it("T1-F16-01: replaces 'bespoke' with 'custom-made' in plain-language outbound text", () => {
    const input = "We provide bespoke acrylic podiums for corporate auditoriums.";
    const sanitized = formatWhatsAppOutboundText(input);

    assertStrictEqual(sanitized, "We provide custom-made acrylic podiums for corporate auditoriums.");
    assertNoBuzzwords(sanitized);
    assertNoDashes(sanitized);
  });

  it("T1-F16-02: sanitizes high-level buzzwords batch 1 (meticulous, seamless, unparalleled)", () => {
    const input = "Meticulous design with seamless integration and unparalleled quality.";
    const sanitized = formatWhatsAppOutboundText(input);

    assertStrictEqual(sanitized, "careful design with smooth integration and top quality.");
    assertNoBuzzwords(sanitized);
    assertNoDashes(sanitized);
  });

  it("T1-F16-03: sanitizes high-level buzzwords batch 2 (state-of-the-art, cutting-edge, optical-grade)", () => {
    const input = "State-of-the-art and cutting-edge optical-grade sheets.";
    const sanitized = formatWhatsAppOutboundText(input);

    assertStrictEqual(sanitized, "modern and modern crystal-clear sheets.");
    assertNoBuzzwords(sanitized);
    assertNoDashes(sanitized);
  });

  it("T1-F16-04: sanitizes high-level buzzwords batch 3 (delve, elevate, robust, utilize, leverage, consultative)", () => {
    const input = "Delve into our catalog, elevate your store, utilize robust displays, and leverage consultative support.";
    const sanitized = formatWhatsAppOutboundText(input);

    assertStrictEqual(
      sanitized,
      "check into our catalog, improve your store, use strong displays, and use helpful support."
    );
    assertNoBuzzwords(sanitized);
    assertNoDashes(sanitized);
  });

  it("T1-F16-05: sanitizes em-dashes, spaced en-dashes, and multi-hyphens with standard commas", () => {
    // Unicode em dash, spaced en dash, and double hyphen patterns
    const input = "Acrylic sheets\u2014clear and durable \u2013 ready for dispatch--order today";
    const sanitized = formatWhatsAppOutboundText(input);

    assertStrictEqual(
      sanitized,
      "Acrylic sheets, clear and durable, ready for dispatch, order today"
    );
    assertNoDashes(sanitized);
  });
});
