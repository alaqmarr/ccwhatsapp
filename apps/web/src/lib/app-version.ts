import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const globalVersionStore = globalThis as unknown as {
  __ccResolvedBuildId?: string;
  __ccProcessBootId?: string;
};

function findFirstExistingBuildId(startDir: string): string {
  const candidates = [
    path.join(startDir, ".next", "BUILD_ID"),
    path.join(startDir, "apps", "web", ".next", "BUILD_ID"),
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const val = fs.readFileSync(filePath, "utf8").trim();
        if (val) return val;
      }
    } catch {
      // Ignore unreadable build id file
    }
  }
  return "";
}

function readGitCommitSha(startDir: string): string {
  let dir = startDir;
  for (let depth = 0; depth < 6; depth++) {
    const gitDir = path.join(dir, ".git");
    const headFile = path.join(gitDir, "HEAD");
    try {
      if (fs.existsSync(headFile)) {
        const headContent = fs.readFileSync(headFile, "utf8").trim();
        if (!headContent) return "";
        if (!headContent.startsWith("ref:")) {
          return headContent.slice(0, 12);
        }
        const refPath = headContent.replace(/^ref:\s*/i, "").trim();
        const fullRefFile = path.join(gitDir, refPath);
        if (fs.existsSync(fullRefFile)) {
          const sha = fs.readFileSync(fullRefFile, "utf8").trim();
          if (sha) return sha.slice(0, 12);
        }
        const packedRefsFile = path.join(gitDir, "packed-refs");
        if (fs.existsSync(packedRefsFile)) {
          const packed = fs.readFileSync(packedRefsFile, "utf8");
          for (const line of packed.split(/\r?\n/)) {
            if (!line || line.startsWith("#") || line.startsWith("^")) continue;
            const [sha, ref] = line.trim().split(/\s+/);
            if (ref === refPath && sha) return sha.slice(0, 12);
          }
        }
        return "";
      }
    } catch {
      // Ignore unreadable git metadata
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}

/**
 * Resolves a stable build/release identifier for the currently running server process.
 * Locked once per server boot in globalThis so rolling/restarted processes cleanly
 * report a distinct ID as soon as an update goes live.
 */
export function resolveServerReleaseVersion(opts?: {
  cwd?: string;
  env?: Record<string, string | undefined>;
  fallbackBootId?: string;
}): string {
  const cwd = opts?.cwd || process.cwd();
  const env = opts?.env || process.env;

  const nextBuildId = findFirstExistingBuildId(cwd);
  if (nextBuildId) return nextBuildId;

  const envBuild =
    env.APP_BUILD_ID ||
    env.NEXT_BUILD_ID ||
    env.SOURCE_COMMIT ||
    env.GIT_COMMIT_SHA ||
    env.RAILWAY_GIT_COMMIT_SHA ||
    env.VERCEL_GIT_COMMIT_SHA ||
    env.COMMIT_SHA ||
    "";
  if (envBuild.trim()) return envBuild.trim().slice(0, 24);

  const gitSha = readGitCommitSha(cwd);
  if (gitSha) return `git-${gitSha}`;

  if (opts?.fallbackBootId) return opts.fallbackBootId;
  if (!globalVersionStore.__ccProcessBootId) {
    globalVersionStore.__ccProcessBootId = `boot-${crypto.randomUUID().slice(0, 12)}`;
  }
  return globalVersionStore.__ccProcessBootId;
}

export function getServerReleaseVersion(): string {
  if (!globalVersionStore.__ccResolvedBuildId) {
    globalVersionStore.__ccResolvedBuildId = resolveServerReleaseVersion();
  }
  return globalVersionStore.__ccResolvedBuildId;
}
