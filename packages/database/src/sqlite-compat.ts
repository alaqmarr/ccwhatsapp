import BetterSqlite3 from "better-sqlite3";
import type {
  Client,
  InArgs,
  InStatement,
  Replicated,
  ResultSet,
  Row,
  Transaction,
  TransactionMode,
} from "@libsql/client";

const DESTRUCTIVE_DDL_RE = /(?:^|;)\s*(ALTER|DROP|DETACH|ATTACH|VACUUM)\b/i;

function normalizeSqlValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint" || typeof v === "number" || typeof v === "string") {
    return v;
  }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
    return Buffer.from(v);
  }
  return String(v);
}

function normalizeBindArgs(args?: InArgs): unknown {
  if (!args) return undefined;
  if (Array.isArray(args)) {
    return args.map(normalizeSqlValue);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = normalizeSqlValue(v);
  }
  return out;
}

function makeEmptyResultSet(): ResultSet {
  return {
    columns: [],
    columnTypes: [],
    rows: [],
    rowsAffected: 0,
    lastInsertRowid: undefined,
    toJSON() {
      return {
        columns: [],
        columnTypes: [],
        rows: [],
        rowsAffected: 0,
        lastInsertRowid: null,
      };
    },
  };
}

function countStatementsOutsideStrings(sql: string): number {
  let count = 0;
  let hasContent = false;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDouble) {
      if (inSingle && sql[i + 1] === "'") {
        i++;
      } else {
        inSingle = !inSingle;
      }
      hasContent = true;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      hasContent = true;
      continue;
    }
    if (!inSingle && !inDouble && ch === ";") {
      if (hasContent) count++;
      hasContent = false;
      continue;
    }
    if (!/\s/.test(ch)) {
      hasContent = true;
    }
  }
  if (hasContent) count++;
  return count;
}

/**
 * Opens a configured better-sqlite3 handle with mandatory concurrency pragmas:
 * journal_mode=WAL, synchronous=NORMAL, busy_timeout=5000, foreign_keys=ON, temp_store=MEMORY.
 */
export function openConfiguredSqliteDb(
  filePath: string,
  options?: { enableWal?: boolean }
): BetterSqlite3.Database {
  const db = new BetterSqlite3(filePath);
  if (options?.enableWal !== false) {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");
  return db;
}

/**
 * Wraps a synchronous globalThis better-sqlite3 singleton into the LibSQL Client interface
 * so every existing async caller benefits from microsecond C++ SQLite queries and BEGIN IMMEDIATE writes.
 */
export function createBetterSqliteCompatClient(db: BetterSqlite3.Database): Client {
  const stmtCache = new Map<string, BetterSqlite3.Statement>();

  const getPrepared = (sql: string): BetterSqlite3.Statement => {
    const existing = stmtCache.get(sql);
    if (existing) {
      stmtCache.delete(sql);
      stmtCache.set(sql, existing);
      return existing;
    }
    const stmt = db.prepare(sql);
    if (stmtCache.size >= 512) {
      const firstKey = stmtCache.keys().next().value;
      if (firstKey !== undefined) stmtCache.delete(firstKey);
    }
    stmtCache.set(sql, stmt);
    return stmt;
  };

  const runStatementSync = (
    stmtOrSql: InStatement | string | [string, InArgs?],
    explicitArgs?: InArgs
  ): ResultSet => {
    let sql: string;
    let args: InArgs | undefined;
    if (typeof stmtOrSql === "string") {
      sql = stmtOrSql;
      args = explicitArgs;
    } else if (Array.isArray(stmtOrSql)) {
      sql = stmtOrSql[0];
      args = stmtOrSql[1];
    } else {
      sql = stmtOrSql.sql;
      args = stmtOrSql.args;
    }

    const trimmed = sql.trim();
    if (!trimmed) return makeEmptyResultSet();

    if (DESTRUCTIVE_DDL_RE.test(trimmed)) {
      stmtCache.clear();
    }

    // Handle multi-statement scripts cleanly without prepare RangeError
    if (!args && countStatementsOutsideStrings(trimmed) > 1) {
      db.exec(trimmed);
      if (DESTRUCTIVE_DDL_RE.test(trimmed)) {
        stmtCache.clear();
      }
      return makeEmptyResultSet();
    }

    const prepared = getPrepared(trimmed);
    const normalized = normalizeBindArgs(args);

    if (prepared.reader) {
      const rawRows =
        normalized === undefined
          ? (prepared.all() as Row[])
          : Array.isArray(normalized)
          ? (prepared.all(...normalized) as Row[])
          : (prepared.all(normalized) as Row[]);
      const cols = prepared.columns().map((c) => c.name);
      return {
        columns: cols,
        columnTypes: cols.map(() => ""),
        rows: rawRows,
        rowsAffected: 0,
        lastInsertRowid: undefined,
        toJSON() {
          return {
            columns: cols,
            columnTypes: cols.map(() => ""),
            rows: rawRows,
            rowsAffected: 0,
            lastInsertRowid: null,
          };
        },
      };
    }

    const info =
      normalized === undefined
        ? prepared.run()
        : Array.isArray(normalized)
        ? prepared.run(...normalized)
        : prepared.run(normalized);
    const lastId =
      typeof info.lastInsertRowid === "bigint"
        ? info.lastInsertRowid
        : BigInt(info.lastInsertRowid || 0);
    return {
      columns: [],
      columnTypes: [],
      rows: [],
      rowsAffected: Number(info.changes ?? 0),
      lastInsertRowid: lastId,
      toJSON() {
        return {
          columns: [],
          columnTypes: [],
          rows: [],
          rowsAffected: Number(info.changes ?? 0),
          lastInsertRowid: lastId.toString(),
        };
      },
    };
  };

  let isClosed = false;

  const client: Client = {
    async execute(stmtOrSql: InStatement | string, args?: InArgs): Promise<ResultSet> {
      return runStatementSync(stmtOrSql, args);
    },

    async batch(
      stmts: Array<InStatement | [string, InArgs?]>,
      mode?: TransactionMode
    ): Promise<Array<ResultSet>> {
      const execAll = () => stmts.map((s) => runStatementSync(s));
      if (mode === "read") {
        const readTx = db.transaction(execAll);
        return readTx();
      }
      // Enforce BEGIN IMMEDIATE for writes to avoid deferred lock upgrade SQLITE_BUSY errors
      const immediateTx = db.transaction(execAll);
      return immediateTx.immediate();
    },

    async migrate(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
      db.pragma("foreign_keys = OFF");
      try {
        const tx = db.transaction(() => stmts.map((s) => runStatementSync(s)));
        return tx.immediate();
      } finally {
        db.pragma("foreign_keys = ON");
      }
    },

    async transaction(mode?: TransactionMode): Promise<Transaction> {
      let txClosed = false;
      const beginSql = mode === "read" ? "BEGIN DEFERRED" : "BEGIN IMMEDIATE";
      db.exec(beginSql);

      const tx: Transaction = {
        async execute(stmt: InStatement): Promise<ResultSet> {
          if (txClosed) throw new Error("Transaction is closed");
          return runStatementSync(stmt);
        },
        async batch(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
          if (txClosed) throw new Error("Transaction is closed");
          return stmts.map((s) => runStatementSync(s));
        },
        async executeMultiple(sql: string): Promise<void> {
          if (txClosed) throw new Error("Transaction is closed");
          db.exec(sql);
          if (DESTRUCTIVE_DDL_RE.test(sql)) {
            stmtCache.clear();
          }
        },
        async rollback(): Promise<void> {
          if (!txClosed) {
            txClosed = true;
            db.exec("ROLLBACK");
          }
        },
        async commit(): Promise<void> {
          if (!txClosed) {
            txClosed = true;
            db.exec("COMMIT");
          }
        },
        close(): void {
          if (!txClosed) {
            txClosed = true;
            try {
              db.exec("ROLLBACK");
            } catch {
              // Ignore if not in active transaction
            }
          }
        },
        get closed(): boolean {
          return txClosed;
        },
      };
      return tx;
    },

    async executeMultiple(sql: string): Promise<void> {
      db.exec(sql);
      if (DESTRUCTIVE_DDL_RE.test(sql)) {
        stmtCache.clear();
      }
    },

    async sync(): Promise<Replicated> {
      return { frame_no: 0, frames_synced: 0 };
    },

    close(): void {
      isClosed = true;
    },

    reconnect(): void {
      isClosed = false;
    },

    get closed(): boolean {
      return isClosed || !db.open;
    },

    protocol: "file",
  };

  return client;
}
