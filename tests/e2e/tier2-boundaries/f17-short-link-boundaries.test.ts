import fs from "node:fs";
import path from "node:path";
import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";
import {
  formatShortLinkUrl,
  SHORTLINK_PUBLIC_DOMAIN,
  SHORTLINK_PUBLIC_ORIGIN,
} from "@cc/ui";
import { createCustomAdminLink } from "@cc/storage";

describe("F17: Short Link Standardization - Boundary & Corner Cases", () => {
  it("formatShortLinkUrl formats URL strictly with domain ccapl.cc", () => {
    assertStrictEqual(SHORTLINK_PUBLIC_DOMAIN, "ccapl.cc");
    assertStrictEqual(SHORTLINK_PUBLIC_ORIGIN, "https://ccapl.cc");

    const url = formatShortLinkUrl("x7K9pQ");
    assertStrictEqual(url, "https://ccapl.cc/x7K9pQ");
  });

  it("trims leading slashes, extra slashes, and whitespace in short link codes", () => {
    assertStrictEqual(formatShortLinkUrl("/x7K9pQ"), "https://ccapl.cc/x7K9pQ");
    assertStrictEqual(formatShortLinkUrl("///aB3x9Z"), "https://ccapl.cc/aB3x9Z");
    assertStrictEqual(formatShortLinkUrl("   m4N2qR   "), "https://ccapl.cc/m4N2qR");
  });

  it("createCustomAdminLink rejects open redirect and malicious protocols (javascript:, data:)", async () => {
    const maliciousScript = await createCustomAdminLink({
      title: "Attack Link",
      targetUrl: "javascript:alert(document.cookie)",
      createdByName: "Test Admin",
    });

    assertStrictEqual(maliciousScript.ok, false);
    assertOk(maliciousScript.error?.includes("Target URL must start with"));

    const dataUri = await createCustomAdminLink({
      title: "Phishing Data URI",
      targetUrl: "data:text/html;base64,PHNjcmlwdD5...",
      createdByName: "Test Admin",
    });

    assertStrictEqual(dataUri.ok, false);
  });

  it("allowedDevOrigins in next.config.ts contains ccapl.cc", () => {
    const nextConfigPath = path.resolve(process.cwd(), "apps/web/next.config.ts");
    assertOk(fs.existsSync(nextConfigPath), "next.config.ts must exist");
    const content = fs.readFileSync(nextConfigPath, "utf8");

    // ccapl.cc must be explicitly allowed for development proxy resolution
    assertOk(
      content.includes("ccapl.cc"),
      "next.config.ts must declare ccapl.cc in allowedDevOrigins"
    );
  });

  it("handles empty or null code inputs safely", () => {
    assertStrictEqual(formatShortLinkUrl(""), "https://ccapl.cc/");
    assertStrictEqual(formatShortLinkUrl(null as unknown as string), "https://ccapl.cc/");
    assertStrictEqual(formatShortLinkUrl(undefined as unknown as string), "https://ccapl.cc/");
  });
});
