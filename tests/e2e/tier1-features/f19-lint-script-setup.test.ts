import fs from "node:fs";
import path from "node:path";
import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";

describe("F19: Monorepo Scripts & Typecheck Verification Setup (Tier 1 Feature Coverage)", () => {
  it("T1-F19-01: verifies root package.json declares valid project scripts for verification and execution", () => {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    assertOk(fs.existsSync(pkgPath), "Root package.json must exist");

    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    assertOk(pkg.scripts && typeof pkg.scripts === "object", "Scripts object must exist in package.json");
    assertStrictEqual(typeof pkg.scripts.dev, "string");
    assertStrictEqual(typeof pkg.scripts.build, "string");
    assertStrictEqual(typeof pkg.scripts.typecheck, "string");
    assertStrictEqual(typeof pkg.scripts["test:e2e"], "string");
  });

  it("T1-F19-02: verifies typecheck script is defined in root scripts and targets workspace @cc/web", () => {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

    assertOk(
      pkg.scripts.typecheck.includes("@cc/web") && pkg.scripts.typecheck.includes("typecheck"),
      "Root typecheck script must invoke @cc/web typecheck"
    );

    const webPkgPath = path.resolve(process.cwd(), "apps/web/package.json");
    assertOk(fs.existsSync(webPkgPath), "apps/web/package.json must exist");
    const webPkg = JSON.parse(fs.readFileSync(webPkgPath, "utf-8"));
    assertStrictEqual(webPkg.scripts.typecheck, "tsc --noEmit");
  });

  it("T1-F19-03: verifies monorepo workspace configuration declares apps/* and packages/* targets", () => {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

    assertOk(Array.isArray(pkg.workspaces), "workspaces array must be defined in root package.json");
    assertOk(pkg.workspaces.includes("apps/*"), "workspaces must include apps/*");
    assertOk(pkg.workspaces.includes("packages/*"), "workspaces must include packages/*");

    const appsDir = path.resolve(process.cwd(), "apps");
    const packagesDir = path.resolve(process.cwd(), "packages");
    assertOk(fs.existsSync(appsDir), "apps folder must exist on disk");
    assertOk(fs.existsSync(packagesDir), "packages folder must exist on disk");
  });

  it("T1-F19-04: verifies TypeScript base configuration is valid across root and workspace", () => {
    const tsconfigBasePath = path.resolve(process.cwd(), "tsconfig.base.json");
    assertOk(fs.existsSync(tsconfigBasePath), "tsconfig.base.json must exist in root");

    const tsconfigBase = JSON.parse(fs.readFileSync(tsconfigBasePath, "utf-8"));
    assertOk(tsconfigBase.compilerOptions, "compilerOptions must be configured");
    assertStrictEqual(tsconfigBase.compilerOptions.strict, true);
    assertStrictEqual(tsconfigBase.compilerOptions.noEmit, true);

    const webTsconfigPath = path.resolve(process.cwd(), "apps/web/tsconfig.json");
    assertOk(fs.existsSync(webTsconfigPath), "apps/web/tsconfig.json must exist");
    const webTsconfig = JSON.parse(fs.readFileSync(webTsconfigPath, "utf-8"));
    assertStrictEqual(webTsconfig.extends, "../../tsconfig.base.json");
  });

  it("T1-F19-05: verifies all workspace packages have valid source entries and package configs", () => {
    const expectedPackages = [
      "auth",
      "connections",
      "database",
      "queue",
      "rbac",
      "sockets",
      "storage",
      "ui",
      "workers",
    ];

    for (const pkgName of expectedPackages) {
      const pkgJsonPath = path.resolve(process.cwd(), `packages/${pkgName}/package.json`);
      assertOk(fs.existsSync(pkgJsonPath), `packages/${pkgName}/package.json must exist`);

      const pkgData = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      assertStrictEqual(pkgData.name, `@cc/${pkgName}`);

      const srcDir = path.resolve(process.cwd(), `packages/${pkgName}/src`);
      assertOk(fs.existsSync(srcDir), `packages/${pkgName}/src folder must exist`);
    }
  });
});
