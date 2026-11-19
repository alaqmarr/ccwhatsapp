import { getRawLibSqlClient } from "@cc/database/clients/handles";

export async function applyAllDatabasePragmas(): Promise<void> {
  const clients = [
    getRawLibSqlClient("core_auth"),
    getRawLibSqlClient("conversations"),
    getRawLibSqlClient("contacts"),
    getRawLibSqlClient("crm_orders"),
    getRawLibSqlClient("marketing"),
    getRawLibSqlClient("billing_ops"),
    getRawLibSqlClient("queue_jobs"),
  ];

  const pragmas = [
    "PRAGMA journal_mode = WAL;",
    "PRAGMA synchronous = NORMAL;",
    "PRAGMA busy_timeout = 5000;",
    "PRAGMA foreign_keys = ON;",
    "PRAGMA temp_store = MEMORY;",
  ];

  await Promise.all(
    clients.flatMap((c) => pragmas.map((p) => c.execute(p)))
  );
}
