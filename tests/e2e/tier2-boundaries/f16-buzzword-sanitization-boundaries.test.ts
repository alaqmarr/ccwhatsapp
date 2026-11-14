import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertNoBuzzwords,
  assertNoDashes,
} from "../harness";
import { formatWhatsAppOutboundText } from "@cc/connections";

describe("F16: Anti-AI Buzzword & Punctuation Sanitization (Tier 2 Boundary Cases)", () => {
  it("case-insensitive buzzword matching handles uppercase, lowercase, and mixed case", () => {
    const inputUpper = "WE PROVIDE BESPOKE ACRYLIC PODIUMS WITH OPTICAL-GRADE CLARITY.";
    const sanitizedUpper = formatWhatsAppOutboundText(inputUpper);
    assertOk(!sanitizedUpper.toLowerCase().includes("bespoke"));
    assertOk(!sanitizedUpper.toLowerCase().includes("optical-grade"));
    assertNoBuzzwords(sanitizedUpper);

    const inputMixed = "Our BeSpoke craftsmanship will ElEvAtE your store.";
    const sanitizedMixed = formatWhatsAppOutboundText(inputMixed);
    assertOk(!sanitizedMixed.toLowerCase().includes("bespoke"));
    assertOk(!sanitizedMixed.toLowerCase().includes("elevate"));
    assertNoBuzzwords(sanitizedMixed);
  });

  it("word boundary enforcement prevents false-positive substring replacement", () => {
    // "telescope" contains letters of "scope", not "bespoke"
    const inputTelescope = "The telescope stand is crafted from acrylic.";
    const sanitizedTelescope = formatWhatsAppOutboundText(inputTelescope);
    assertOk(sanitizedTelescope.includes("telescope"), "Legitimate word 'telescope' should not be corrupted");

    // "delve" -> "check", but "delved" or unrelated words
    const inputClean = "Delivery schedule for clear display sheets.";
    assertStrictEqual(formatWhatsAppOutboundText(inputClean), "Delivery schedule for clear display sheets.");
  });

  it("sanitizes em-dashes, spaced en-dashes, and variable-length multi-hyphens", () => {
    // Unicode em dash pattern
    const emDashText = "Cast acrylic sheets\u2014crystal clear and durable.";
    const sanitizedEm = formatWhatsAppOutboundText(emDashText);
    assertOk(!sanitizedEm.includes("\u2014"));
    assertNoDashes(sanitizedEm);

    // Spaced en dash pattern
    const enDashText = "Podium dimensions \u2013 24x48 inches.";
    const sanitizedEn = formatWhatsAppOutboundText(enDashText);
    assertOk(!sanitizedEn.includes("\u2013"));
    assertNoDashes(sanitizedEn);

    // Variable multi-hyphen test patterns
    const multiHyphenText = "Item 1--Item 2------Item 3";
    const sanitizedHyphens = formatWhatsAppOutboundText(multiHyphenText);
    assertOk(!sanitizedHyphens.includes("--"));
    assertNoDashes(sanitizedHyphens);
  });

  it("sanitizes consecutive adjacent buzzwords in rapid succession", () => {
    const adjacentBuzzwords = "Seamless, cutting-edge, state-of-the-art, robust solutions.";
    const sanitized = formatWhatsAppOutboundText(adjacentBuzzwords);
    assertNoBuzzwords(sanitized);
    assertStrictEqual(sanitized, "smooth, modern, modern, strong solutions.");
  });

  it("handles null, undefined, empty, or non-string inputs safely without throwing", () => {
    assertStrictEqual(formatWhatsAppOutboundText(""), "");
    assertStrictEqual(formatWhatsAppOutboundText(null as unknown as string), "");
    assertStrictEqual(formatWhatsAppOutboundText(undefined as unknown as string), "");
    assertStrictEqual(formatWhatsAppOutboundText("   "), "");
  });
});
