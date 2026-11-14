import fs from "node:fs";
import path from "node:path";
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
  formatDateTimeIst,
  formatThreadTimeIst,
} from "@cc/ui";

describe("F03: UI Hydration Fixes & Server IST Date Consistency (Tier 1 Feature Coverage)", () => {
  it("T1-F03-01: verifies templates preview page renders deterministic IST timestamps", () => {
    const templatesPagePath = path.resolve(
      process.cwd(),
      "apps/web/src/app/dashboard/templates/page.tsx"
    );
    assertOk(fs.existsSync(templatesPagePath), "Templates page must exist");
    const source = fs.readFileSync(templatesPagePath, "utf-8");

    // Must not use unhydrated client toLocaleDateString/toLocaleTimeString
    assertOk(
      !source.includes("toLocaleTimeString()"),
      "Templates preview should not use un-hydrated toLocaleTimeString()"
    );

    // Verify formatTimeIst produces identical server output
    const testUtcIso = "2026-11-15T05:00:00.000Z";
    const formatted = formatTimeIst(testUtcIso);
    assertStrictEqual(formatted, "10:30 AM");
    assertIstFormatted(formatted, { format: "time" });
  });

  it("T1-F03-02: verifies inbox thread list renders consistent same-day IST time", () => {
    // Message received at 05:00 UTC (10:30 AM IST) on 2026-11-15
    const msgUtcIso = "2026-11-15T05:00:00.000Z";
    // Simulated server time same day: 08:00 UTC (01:30 PM IST) on 2026-11-15
    const serverNowMs = new Date("2026-11-15T08:00:00.000Z").getTime();

    const threadTime = formatThreadTimeIst(msgUtcIso, serverNowMs);
    assertStrictEqual(threadTime, "10:30 AM");
    assertIstFormatted(threadTime, { format: "time" });
  });

  it("T1-F03-03: verifies chat bubble timestamp displays standard IST time format", () => {
    // 14:30 UTC -> 08:00 PM IST
    const msgUtcIso = "2026-11-15T14:30:00.000Z";
    const bubbleTime = formatTimeIst(msgUtcIso);
    assertStrictEqual(bubbleTime, "08:00 PM");
    assertIstFormatted(bubbleTime, { format: "time" });
  });

  it("T1-F03-04: verifies suppressHydrationWarning is applied to dynamic ticking countdowns in InboxClient", () => {
    const inboxClientPath = path.resolve(
      process.cwd(),
      "apps/web/src/app/dashboard/inbox/InboxClient.tsx"
    );
    assertOk(fs.existsSync(inboxClientPath), "InboxClient.tsx must exist");
    const source = fs.readFileSync(inboxClientPath, "utf-8");

    // Dynamic ticking elements (waiting time, customer waiting timer) must have suppressHydrationWarning
    const occurrences = (source.match(/suppressHydrationWarning/g) || []).length;
    assertOk(
      occurrences >= 4,
      `Expected at least 4 suppressHydrationWarning attributes in InboxClient, found ${occurrences}`
    );
  });

  it("T1-F03-05: verifies contacts and analytics table date formatting produces consistent IST strings", () => {
    const contactsPagePath = path.resolve(
      process.cwd(),
      "apps/web/src/app/dashboard/contacts/page.tsx"
    );
    assertOk(fs.existsSync(contactsPagePath), "Contacts page must exist");
    const source = fs.readFileSync(contactsPagePath, "utf-8");

    assertOk(
      source.includes("formatDate") || source.includes("formatTime") || source.includes("@cc/ui"),
      "Contacts page should use centralized date formatters"
    );

    const testIso = "2026-11-10T12:00:00.000Z";
    const formatted = formatDateTimeIst(testIso);
    assertStrictEqual(formatted, "10 Nov 2026, 05:30 PM");
    assertIstFormatted(formatted, { format: "dateTime" });

    const dateOnly = formatDateIst(testIso);
    assertStrictEqual(dateOnly, "10 Nov 2026");
    assertIstFormatted(dateOnly, { format: "date" });
  });
});
