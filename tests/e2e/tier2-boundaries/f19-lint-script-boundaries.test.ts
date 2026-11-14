import fs from "node:fs";
import path from "node:path";
import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";

describe("F19: Lint Script & Workspace Verification - Boundary & Corner Cases", () => {
  it("root package.json defines verification scripts including typecheck and optional lint", () => {
    const rootPkgPath = path.resolve(process.cwd(), "package.json");
    assertOk(fs.existsSync(rootPkgPath));
    const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));

    assertOk(pkg.scripts, "scripts object must be defined");
    if (pkg.scripts.lint !== undefined) {
      assertStrictEqual(typeof pkg.scripts.lint, "string", "lint script must be a string");
      assertOk(pkg.scripts.lint.length > 0, "lint script must not be empty");
    } else {
      assertStrictEqual(typeof pkg.scripts.typecheck, "string");
      assertOk(pkg.scripts.typecheck.length > 0);
    }
  });

  it("apps/web package.json defines web verification scripts", () => {
    const webPkgPath = path.resolve(process.cwd(), "apps/web/package.json");
    assertOk(fs.existsSync(webPkgPath));
    const webPkg = JSON.parse(fs.readFileSync(webPkgPath, "utf8"));

    assertOk(webPkg.scripts, "web scripts object must be defined");
    if (webPkg.scripts.lint !== undefined) {
      assertStrictEqual(typeof webPkg.scripts.lint, "string");
    } else {
      assertStrictEqual(typeof webPkg.scripts.typecheck, "string");
    }
  });

  it("root package.json defines a typecheck script that covers workspaces", () => {
    const rootPkgPath = path.resolve(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));

    assertStrictEqual(typeof pkg.scripts.typecheck, "string");
    assertOk(pkg.scripts.typecheck.length > 0);
  });

  it("root package.json defines a build script", () => {
    const rootPkgPath = path.resolve(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));

    assertStrictEqual(typeof pkg.scripts.build, "string");
    assertOk(pkg.scripts.build.length > 0);
  });

  it("all workspace package.json files conform to valid JSON format", () => {
    const workspacePackages = [
      "packages/database/package.json",
      "packages/connections/package.json",
      "packages/workers/package.json",
      "packages/ui/package.json",
      "packages/auth/package.json",
      "packages/rbac/package.json",
    ];

    for (const relPath of workspacePackages) {
      const fullPath = path.resolve(process.cwd(), relPath);
      assertOk(fs.existsSync(fullPath), `${relPath} must exist`);
      const raw = fs.readFileSync(fullPath, "utf8");
      const parsed = JSON.parse(raw);
      assertOk(parsed.name, `${relPath} must have a name`);
    }
  });
});
