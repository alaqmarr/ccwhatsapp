import fs from "node:fs";
import path from "node:path";
import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";
import { formatTimeIst, formatDateIst, formatThreadTimeIst, APP_TIMEZONE } from "@cc/ui";

describe("F03: UI SSR Hydration & Date Consistency - Boundary & Corner Cases", () => {
  it("handles null or missing date fields in message threads without rendering NaN or invalid strings", () => {
    // Null message timestamps in chat bubbles or list views must return empty strings, never "NaN:NaN"
    const formattedNullTime = formatTimeIst(null);
    assertStrictEqual(formattedNullTime, "");
    assertOk(!formattedNullTime.includes("NaN"), "Should not contain NaN");

    const formattedUndefinedDate = formatDateIst(undefined);
    assertStrictEqual(formattedUndefinedDate, "");
    assertOk(!formattedUndefinedDate.includes("NaN"), "Should not contain NaN");

    const formattedNullThread = formatThreadTimeIst(null);
    assertStrictEqual(formattedNullThread, "");
  });

  it("dynamic ticking countdown elements in InboxClient include suppressHydrationWarning attributes", () => {
    const inboxClientPath = path.resolve(
      process.cwd(),
      "apps/web/src/app/dashboard/inbox/InboxClient.tsx"
    );
    assertOk(fs.existsSync(inboxClientPath), "InboxClient.tsx must exist");
    const content = fs.readFileSync(inboxClientPath, "utf8");

    // Must have suppressHydrationWarning on ticking time elements to avoid React hydration mismatches
    const matches = content.match(/suppressHydrationWarning/g);
    assertOk(matches && matches.length >= 5, "InboxClient should have multiple suppressHydrationWarning guards on ticking timers");
  });

  it("templates SSR page renders preview without client toLocaleTimeString or toLocaleDateString", () => {
    const templatesPagePath = path.resolve(
      process.cwd(),
      "apps/web/src/app/dashboard/templates/page.tsx"
    );
    assertOk(fs.existsSync(templatesPagePath), "templates/page.tsx must exist");
    const content = fs.readFileSync(templatesPagePath, "utf8");

    // All dates must use centralized IST formatting helpers instead of browser-dependent toLocale* methods
    assertOk(
      !content.includes("toLocaleTimeString("),
      "templates/page.tsx must not use client-dependent toLocaleTimeString"
    );
    assertOk(
      !content.includes("toLocaleDateString("),
      "templates/page.tsx must not use client-dependent toLocaleDateString"
    );
  });

  it("server and simulated client render identical IST representations regardless of process timezone", () => {
    const testUtcDate = "2026-11-15T05:00:00.000Z";
    // 05:00 UTC is exactly 10:30 AM in Asia/Kolkata
    const timeIst = formatTimeIst(testUtcDate);
    assertStrictEqual(timeIst, "10:30 AM");

    const dateIst = formatDateIst(testUtcDate);
    assertStrictEqual(dateIst, "15 Nov 2026");

    assertStrictEqual(APP_TIMEZONE, "Asia/Kolkata");
  });

  it("rendering empty conversation threads produces deterministic empty outputs", () => {
    assertStrictEqual(formatThreadTimeIst(null, Date.now()), "");
    assertStrictEqual(formatThreadTimeIst(undefined, Date.now()), "");
    assertStrictEqual(formatThreadTimeIst("", Date.now()), "");
  });
});
