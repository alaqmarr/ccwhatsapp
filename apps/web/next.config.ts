import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const monorepoRoot = path.resolve(__dirname, "..", "..");

// Load monorepo-root .env files so pasting .env.production at repo root works for build & runtime
function loadRootEnvFiles() {
  const files =
    process.env.NODE_ENV === "production"
      ? [".env.production.local", ".env.production", ".env.local", ".env"]
      : [".env.local", ".env", ".env.production"];

  for (const name of files) {
    const fullPath = path.join(/*turbopackIgnore: true*/ monorepoRoot, name);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const content = fs.readFileSync(fullPath, "utf8");
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eqIdx = line.indexOf("=");
        if (eqIdx <= 0) continue;
        const key = line
          .slice(0, eqIdx)
          .replace(/^export\s+/, "")
          .trim();
        if (!key || process.env[key] !== undefined) continue;
        let val = line.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    } catch {
      // Ignore unreadable env file
    }
  }
}

loadRootEnvFiles();

const nextConfig: NextConfig = {
  compress: true,
  turbopack: {
    root: monorepoRoot,
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  outputFileTracingRoot: monorepoRoot,
  allowedDevOrigins: [
    "chat.ccapl.cc",
    "whatsapp.ccapl.cc",
    "track.ccapl.cc",
    "track.ccapl.in",
    "ccapl.cc",
    "www.ccapl.cc",
  ],
  transpilePackages: [
    "@cc/auth",
    "@cc/connections",
    "@cc/database",
    "@cc/queue",
    "@cc/rbac",
    "@cc/sockets",
    "@cc/storage",
    "@cc/ui",
    "@cc/workers",
  ],
  serverExternalPackages: ["@libsql/client", "nodemailer", "ioredis"],
};

export default nextConfig;
