import type BetterSqlite3 from "better-sqlite3";
import type { Client } from "@libsql/client";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  createBetterSqliteCompatClient,
  openConfiguredSqliteDb,
} from "@cc/database/sqlite-compat";
import {
  type DatabaseDomain,
  getDatabaseFilePath,
  resolveClassicEdgeDbPath,
  resolveMainWebsiteDbPath,
} from "./env-config";

interface CachedMultiDb {
  nativeDbs: Partial<Record<DatabaseDomain, BetterSqlite3.Database>>;
  rawClients: Partial<Record<DatabaseDomain, Client>>;
  drizzleClients: Partial<Record<DatabaseDomain, BetterSQLite3Database>>;
  bootstrapped?: Promise<void>;
  mainCatalogNativeDb?: BetterSqlite3.Database | null;
  classicEdgeNativeDb?: BetterSqlite3.Database | null;
  mainCatalogClient?: Client | null;
  classicEdgeClient?: Client | null;
}

const globalDbHolder = globalThis as unknown as {
  __ccMultiSqlite?: CachedMultiDb;
};

function getHolder(): CachedMultiDb {
  if (!globalDbHolder.__ccMultiSqlite) {
    globalDbHolder.__ccMultiSqlite = {
      nativeDbs: {},
      rawClients: {},
      drizzleClients: {},
    };
  }
  return globalDbHolder.__ccMultiSqlite;
}

/**
 * Returns the single globalThis better-sqlite3 instance for a domain, initialized once with
 * WAL mode, synchronous=NORMAL, busy_timeout=5000, foreign_keys=ON, and temp_store=MEMORY.
 */
export function getNativeSqliteDb(domain: DatabaseDomain): BetterSqlite3.Database {
  const holder = getHolder();
  if (!holder.nativeDbs[domain] || !holder.nativeDbs[domain]!.open) {
    const filePath = getDatabaseFilePath(domain);
    holder.nativeDbs[domain] = openConfiguredSqliteDb(filePath, { enableWal: true });
    // Clear derived wrappers if handle had to be re-opened
    delete holder.rawClients[domain];
    delete holder.drizzleClients[domain];
  }
  return holder.nativeDbs[domain]!;
}

/**
 * Runs a synchronous write transaction with BEGIN IMMEDIATE (`tx.immediate()`) to prevent SQLITE_BUSY upgrades.
 * Never await network calls inside `fn`.
 */
export function runImmediateTransaction<T>(
  domain: DatabaseDomain,
  fn: (db: BetterSqlite3.Database) => T
): T {
  const db = getNativeSqliteDb(domain);
  const tx = db.transaction(() => fn(db));
  return tx.immediate();
}

export function getRawLibSqlClient(domain: DatabaseDomain): Client {
  const holder = getHolder();
  if (!holder.rawClients[domain]) {
    const db = getNativeSqliteDb(domain);
    holder.rawClients[domain] = createBetterSqliteCompatClient(db);
  }
  return holder.rawClients[domain]!;
}

export function getDrizzleDb(domain: DatabaseDomain): BetterSQLite3Database {
  const holder = getHolder();
  if (!holder.drizzleClients[domain]) {
    holder.drizzleClients[domain] = drizzle(getNativeSqliteDb(domain));
  }
  return holder.drizzleClients[domain]!;
}

export const authDb = () => getDrizzleDb("core_auth");
export const conversationsDb = () => getDrizzleDb("conversations");
export const contactsDb = () => getDrizzleDb("contacts");
export const crmDb = () => getDrizzleDb("crm_orders");
export const marketingDb = () => getDrizzleDb("marketing");
export const billingDb = () => getDrizzleDb("billing_ops");
export const queueDb = () => getDrizzleDb("queue_jobs");

export function getMainCatalogClient(): Client | null {
  const holder = getHolder();
  if (holder.mainCatalogClient !== undefined) return holder.mainCatalogClient;
  const dbPath = resolveMainWebsiteDbPath();
  if (!dbPath) {
    holder.mainCatalogClient = null;
    return null;
  }
  const db = openConfiguredSqliteDb(dbPath, { enableWal: false });
  holder.mainCatalogNativeDb = db;
  holder.mainCatalogClient = createBetterSqliteCompatClient(db);
  return holder.mainCatalogClient;
}

export function getClassicEdgeClient(): Client | null {
  const holder = getHolder();
  if (holder.classicEdgeClient !== undefined) return holder.classicEdgeClient;
  const dbPath = resolveClassicEdgeDbPath();
  if (!dbPath) {
    holder.classicEdgeClient = null;
    return null;
  }
  const db = openConfiguredSqliteDb(dbPath, { enableWal: false });
  holder.classicEdgeNativeDb = db;
  holder.classicEdgeClient = createBetterSqliteCompatClient(db);
  return holder.classicEdgeClient;
}
