import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import module from "node:module";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resetBootstrapCache,
} from "@cc/database";
import {
  createSessionForUser,
  createInitialDevAccount,
  type AuthenticatedUser,
} from "@cc/auth";

// Hook Node module resolution so routes using @/ aliases work smoothly in e2e tests
const originalResolve = (module as any)._resolveFilename;
if (originalResolve && !(globalThis as any).__aliasResolverRegistered) {
  (globalThis as any).__aliasResolverRegistered = true;
  (module as any)._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
    if (request === "@/lib/session" || request === "@/lib/session.ts") {
      return path.resolve(__dirname, "session-shim.ts");
    }
    if (request.startsWith("@/")) {
      const resolvedPath = path.resolve(process.cwd(), "apps/web/src", request.slice(2));
      return originalResolve.call(this, resolvedPath, parent, isMain, options);
    }
    return originalResolve.call(this, request, parent, isMain, options);
  };
}

export interface TestSandboxOptions {
  dataDirPrefix?: string;
  cleanEnv?: boolean;
  initialEnv?: Record<string, string>;
  seedDemoData?: boolean;
}

export interface TestSandbox {
  dataDir: string;
  cleanup: () => Promise<void>;
  reset: () => Promise<void>;
}

let activeSandboxDir: string | null = null;
let originalDataDirEnv: string | undefined = undefined;

/**
 * Closes all cached LibSQL raw clients in global storage and resets bootstrap cache.
 * Essential on Windows to release locked file handles before deleting temp directories.
 */
export function closeActiveDatabaseConnections(): void {
  const holder = (globalThis as unknown as {
    __ccMultiLibSql?: {
      rawClients?: Record<string, unknown>;
      mainCatalogClient?: { close?: () => void } | null;
      classicEdgeClient?: { close?: () => void } | null;
    };
  }).__ccMultiLibSql;

  if (holder) {
    if (holder.rawClients) {
      for (const client of Object.values(holder.rawClients)) {
        try {
          (client as { close?: () => void })?.close?.();
        } catch {
          // Ignore errors during closure
        }
      }
    }
    try {
      holder.mainCatalogClient?.close?.();
    } catch {}
    try {
      holder.classicEdgeClient?.close?.();
    } catch {}
    delete (globalThis as unknown as { __ccMultiLibSql?: unknown }).__ccMultiLibSql;
  }
  resetBootstrapCache();
}

/**
 * Returns the currently active sandbox data directory path, or null if none active.
 */
export function getSandboxDataDir(): string | null {
  return activeSandboxDir;
}

/**
 * Sets up an isolated test SQLite sandbox in a unique temporary folder.
 * Bootstraps all 7 LibSQL databases with schemas and seeds demo staff & initial dev user.
 */
export async function setupTestSandbox(options?: TestSandboxOptions): Promise<TestSandbox> {
  // If a previous sandbox was active, close connections first
  if (activeSandboxDir) {
    closeActiveDatabaseConnections();
  } else {
    originalDataDirEnv = process.env.DATABASE_DATA_DIR;
  }

  // Clean up any stale orphaned test DB directories older than 10 minutes
  try {
    const tmp = os.tmpdir();
    const now = Date.now();
    for (const entry of fs.readdirSync(tmp)) {
      if (entry.startsWith("ccwa-test-db-")) {
        const full = path.join(tmp, entry);
        try {
          const stat = fs.statSync(full);
          if (now - stat.mtimeMs > 10 * 60 * 1000) {
            fs.rmSync(full, { recursive: true, force: true });
          }
        } catch {}
      }
    }
  } catch {}

  const prefix = options?.dataDirPrefix || "ccwa-test-db";
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sandboxDir = path.join(os.tmpdir(), `${prefix}-${uniqueId}`);

  fs.mkdirSync(sandboxDir, { recursive: true });
  process.env.DATABASE_DATA_DIR = sandboxDir;
  activeSandboxDir = sandboxDir;

  // Set standard test environment variables
  process.env.APP_TIMEZONE = "Asia/Kolkata";
  process.env.WHATSAPP_MODE = process.env.WHATSAPP_MODE || "SANDBOX_SIMULATOR";
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-for-ccwhatsapp-e2e-32-chars";
  process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS = "1";
  process.env.SEED_DEMO_DATA = options?.seedDemoData === false ? "0" : "1";

  if (options?.initialEnv) {
    for (const [key, value] of Object.entries(options.initialEnv)) {
      process.env[key] = value;
    }
  }

  // Ensure bootstrap cache is fresh for the new directory
  closeActiveDatabaseConnections();
  await ensureDatabasesBootstrapped();

  // Ensure an active DEV user exists in core_auth
  const auth = getRawLibSqlClient("core_auth");
  const devCheck = await auth.execute({
    sql: `SELECT id FROM users WHERE role = 'DEV' AND status = 'ACTIVE' LIMIT 1`,
    args: [],
  });

  if (devCheck.rows.length === 0) {
    try {
      await createInitialDevAccount({
        name: "Test Dev",
        email: "dev@classiconcepts.in",
        whatsappNumber: "+919848011222",
        password: "test-dev-password-123",
      });
    } catch {
      const nowIso = new Date().toISOString();
      await auth.execute({
        sql: `INSERT OR IGNORE INTO users (
          id, name, email, whatsapp_number, password_hash, role, status,
          department, email_verified_at, onboarding_completed_at, approved_by_name, approved_at, created_at
        ) VALUES ('usr_dev_test', 'Test Dev', 'dev@classiconcepts.in', '+919848011222', 'hash', 'DEV', 'ACTIVE', 'Engineering', ?, ?, 'System', ?, ?)`,
        args: [nowIso, nowIso, nowIso, nowIso],
      });
    }
  }

  const cleanup = async () => {
    await teardownTestSandbox(sandboxDir);
  };

  const reset = async () => {
    closeActiveDatabaseConnections();
    await ensureDatabasesBootstrapped();
  };

  return {
    dataDir: sandboxDir,
    cleanup,
    reset,
  };
}

/**
 * Tears down a test sandbox: closes database connections, resets caches,
 * and deletes the temporary database folder.
 */
export async function teardownTestSandbox(sandboxDir?: string): Promise<void> {
  const dirToRemove = sandboxDir || activeSandboxDir;

  closeActiveDatabaseConnections();

  if (originalDataDirEnv !== undefined) {
    process.env.DATABASE_DATA_DIR = originalDataDirEnv;
  } else {
    delete process.env.DATABASE_DATA_DIR;
  }

  if (activeSandboxDir === dirToRemove) {
    activeSandboxDir = null;
  }

  if (dirToRemove && fs.existsSync(dirToRemove)) {
    // Windows file locks may take a brief moment to release
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.rmSync(dirToRemove, { recursive: true, force: true });
        break;
      } catch (err) {
        if (attempt === 4) {
          // Non-fatal warning if Windows keeps file lock temporarily
          // Operating system will clean up OS tmpdir upon process termination
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }
  }
}

/**
 * Helper to run a test block within an automatically managed isolated sandbox.
 */
export async function withTestSandbox<T>(
  fn: (sandbox: TestSandbox) => Promise<T>,
  options?: TestSandboxOptions
): Promise<T> {
  const sandbox = await setupTestSandbox(options);
  try {
    return await fn(sandbox);
  } finally {
    await sandbox.cleanup();
  }
}

/**
 * Creates or retrieves a seeded DEV user session token for authenticated test requests.
 */
export async function createTestDevSession(): Promise<{ user: AuthenticatedUser; token: string }> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const res = await auth.execute({
    sql: `SELECT * FROM users WHERE role = 'DEV' AND status = 'ACTIVE' LIMIT 1`,
    args: [],
  });

  if (res.rows.length === 0) {
    throw new Error("No active DEV user found in bootstrapped test database");
  }

  const row = res.rows[0] as Record<string, unknown>;
  const userId = String(row.id);
  const token = await createSessionForUser(userId);

  return {
    user: {
      id: userId,
      name: String(row.name || "Test Dev"),
      email: String(row.email || "dev@test.local"),
      whatsappNumber: String(row.whatsapp_number || "+919876543210"),
      role: "DEV",
      status: "ACTIVE",
      department: String(row.department || "Engineering"),
      emailVerifiedAt: row.email_verified_at ? String(row.email_verified_at) : null,
      onboardingCompletedAt: row.onboarding_completed_at ? String(row.onboarding_completed_at) : null,
      onboardingSteps: [],
      approvedByName: null,
      approvedAt: null,
      rejectionReason: null,
      createdAt: String(row.created_at || new Date().toISOString()),
    },
    token,
  };
}

/**
 * Creates or retrieves a seeded STAFF user session token for authenticated test requests.
 */
export async function createTestStaffSession(): Promise<{ user: AuthenticatedUser; token: string }> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const res = await auth.execute({
    sql: `SELECT * FROM users WHERE role = 'STAFF' AND status = 'ACTIVE' LIMIT 1`,
    args: [],
  });

  if (res.rows.length === 0) {
    throw new Error("No active STAFF user found in bootstrapped test database");
  }

  const row = res.rows[0] as Record<string, unknown>;
  const userId = String(row.id);
  const token = await createSessionForUser(userId);

  return {
    user: {
      id: userId,
      name: String(row.name || "Test Staff"),
      email: String(row.email || "staff@test.local"),
      whatsappNumber: String(row.whatsapp_number || "+919876543211"),
      role: "STAFF",
      status: "ACTIVE",
      department: String(row.department || "Operations"),
      emailVerifiedAt: row.email_verified_at ? String(row.email_verified_at) : null,
      onboardingCompletedAt: row.onboarding_completed_at ? String(row.onboarding_completed_at) : null,
      onboardingSteps: [],
      approvedByName: null,
      approvedAt: null,
      rejectionReason: null,
      createdAt: String(row.created_at || new Date().toISOString()),
    },
    token,
  };
}
