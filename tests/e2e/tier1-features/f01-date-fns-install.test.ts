import fs from "node:fs";
import path from "node:path";
import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertIstFormatted,
} from "../harness";
import { formatInTimeZone } from "date-fns-tz";
import { APP_TIMEZONE, formatTimeIst } from "@cc/ui";

describe("F01: Date-fns & Date-fns-tz Installation (Tier 1 Feature Coverage)", () => {
  it("T1-F01-01: verifies root package.json declares date-fns ^4.1.0 and date-fns-tz ^3.2.0", () => {
    const rootPkgPath = path.resolve(process.cwd(), "package.json");
    assertOk(fs.existsSync(rootPkgPath), "Root package.json must exist");

    const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
    const deps = pkg.dependencies || {};

    assertOk(deps["date-fns"], "Root package.json must declare date-fns dependency");
    assertOk(deps["date-fns-tz"], "Root package.json must declare date-fns-tz dependency");

    assertOk(
      /^\^?4\./.test(deps["date-fns"]),
      `date-fns version should be ^4.x, got: ${deps["date-fns"]}`
    );
    assertOk(
      /^\^?3\./.test(deps["date-fns-tz"]),
      `date-fns-tz version should be ^3.x, got: ${deps["date-fns-tz"]}`
    );
  });

  it("T1-F01-02: verifies web app workspace declares date-fns dependencies and @cc/ui", () => {
    const webPkgPath = path.resolve(process.cwd(), "apps/web/package.json");
    assertOk(fs.existsSync(webPkgPath), "apps/web/package.json must exist");

    const webPkg = JSON.parse(fs.readFileSync(webPkgPath, "utf-8"));
    const deps = webPkg.dependencies || {};

    assertOk(deps["@cc/ui"], "@cc/web must depend on shared @cc/ui package");
    assertOk(deps["date-fns"], "@cc/web must declare date-fns");
    assertOk(deps["date-fns-tz"], "@cc/web must declare date-fns-tz");
  });

  it("T1-F01-03: verifies UI package resolves date-fns-tz formatInTimeZone function", () => {
    assertStrictEqual(typeof formatInTimeZone, "function");

    const testDate = new Date("2026-11-15T05:00:00.000Z");
    const formatted = formatInTimeZone(testDate, "Asia/Kolkata", "hh:mm a");
    assertStrictEqual(formatted, "10:30 AM");
    assertIstFormatted(formatted, { format: "time" });
  });

  it("T1-F01-04: verifies Node runtime resolves date-fns and date-fns-tz filesystem paths", () => {
    const dateFnsPath = require.resolve("date-fns");
    const dateFnsTzPath = require.resolve("date-fns-tz");

    assertOk(fs.existsSync(dateFnsPath), `date-fns module file must exist at ${dateFnsPath}`);
    assertOk(fs.existsSync(dateFnsTzPath), `date-fns-tz module file must exist at ${dateFnsTzPath}`);
  });

  it("T1-F01-05: verifies pure formatInTimeZone execution with standard Indian Standard Time offset (+05:30)", () => {
    // 05:00 UTC + 5:30 = 10:30 IST on 2026-11-15
    const utcDate = new Date("2026-11-15T05:00:00.000Z");
    const res = formatInTimeZone(utcDate, APP_TIMEZONE, "yyyy-MM-dd HH:mm");
    assertStrictEqual(res, "2026-11-15 10:30");

    const helperRes = formatTimeIst(utcDate);
    assertStrictEqual(helperRes, "10:30 AM");
    assertIstFormatted(helperRes, { format: "time" });
  });
});
