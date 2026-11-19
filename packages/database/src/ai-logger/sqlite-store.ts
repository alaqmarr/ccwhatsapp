import type BetterSqlite3 from "better-sqlite3";
import { getNativeSqliteDb } from "@cc/database/clients/handles";
import {
  formatUtcToIstServer,
  type AiLogsQuerySummary,
  type AiTraceLogEntry,
} from "./types-and-format";

const initializedDbs = new WeakSet<BetterSqlite3.Database>();

function getDb(): BetterSqlite3.Database {
  const db = getNativeSqliteDb("billing_ops");
  if (!initializedDbs.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_trace_logs (
        id TEXT PRIMARY KEY,
        timestamp_utc TEXT NOT NULL,
        website TEXT NOT NULL,
        outcome_source TEXT NOT NULL,
        response_cache_status TEXT NOT NULL,
        catalog_cache_status TEXT NOT NULL,
        product_lookup_triggered INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        thinking_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        error_text TEXT,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ai_trace_ts ON ai_trace_logs (timestamp_utc DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_trace_web_ts ON ai_trace_logs (website, timestamp_utc DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_trace_outcome ON ai_trace_logs (outcome_source);
      CREATE TABLE IF NOT EXISTS ai_log_sync_state (
        file_path TEXT PRIMARY KEY,
        last_byte_offset INTEGER NOT NULL DEFAULT 0,
        last_size_bytes INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);
    initializedDbs.add(db);
  }
  return db;
}

const INSERT_SQL = `
  INSERT OR IGNORE INTO ai_trace_logs (
    id, timestamp_utc, website, outcome_source, response_cache_status,
    catalog_cache_status, product_lookup_triggered, input_tokens, output_tokens,
    thinking_tokens, cache_read_tokens, cache_creation_tokens, error_text, payload_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function entryToParams(entry: AiTraceLogEntry): unknown[] {
  return [
    entry.id,
    entry.timestampUtc,
    entry.website,
    entry.outcomeSource,
    entry.responseCacheStatus,
    entry.catalogCacheStatus,
    entry.productLookupTriggered ? 1 : 0,
    Number(entry.tokenUsage?.inputTokens ?? 0) || 0,
    Number(entry.tokenUsage?.outputTokens ?? 0) || 0,
    Number(entry.tokenUsage?.thinkingTokens ?? 0) || 0,
    Number(entry.tokenUsage?.cacheReadInputTokens ?? 0) || 0,
    Number(entry.tokenUsage?.cacheCreationInputTokens ?? 0) || 0,
    entry.error ? String(entry.error) : null,
    JSON.stringify(entry),
  ];
}

export function insertAiTraceEntrySync(entry: AiTraceLogEntry): boolean {
  const db = getDb();
  const info = db.prepare(INSERT_SQL).run(...entryToParams(entry));
  return Number(info.changes ?? 0) > 0;
}

export function batchInsertAiTraceEntriesSync(entries: AiTraceLogEntry[]): number {
  if (entries.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(INSERT_SQL);
  let inserted = 0;
  const tx = db.transaction(() => {
    for (const e of entries) {
      const info = stmt.run(...entryToParams(e));
      inserted += Number(info.changes ?? 0);
    }
  });
  tx.immediate();
  return inserted;
}

export function hasAnyAiTraceRows(): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT 1 AS ok FROM ai_trace_logs LIMIT 1`).get() as
    | { ok: number }
    | undefined;
  return Boolean(row);
}

export function getSyncStateOffset(filePath: string): {
  lastByteOffset: number;
  lastSizeBytes: number;
} | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT last_byte_offset, last_size_bytes FROM ai_log_sync_state WHERE file_path = ? LIMIT 1`
    )
    .get(filePath) as
    | { last_byte_offset: number; last_size_bytes: number }
    | undefined;
  if (!row) return null;
  return {
    lastByteOffset: Number(row.last_byte_offset ?? 0),
    lastSizeBytes: Number(row.last_size_bytes ?? 0),
  };
}

export function upsertSyncStateOffset(
  filePath: string,
  lastByteOffset: number,
  lastSizeBytes: number
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO ai_log_sync_state (file_path, last_byte_offset, last_size_bytes, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       last_byte_offset = excluded.last_byte_offset,
       last_size_bytes = excluded.last_size_bytes,
       updated_at = excluded.updated_at`
  ).run(filePath, lastByteOffset, lastSizeBytes, new Date().toISOString());
}

export function clearAiTraceSqlite(): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM ai_trace_logs`).run();
    db.prepare(`DELETE FROM ai_log_sync_state`).run();
  });
  tx.immediate();
}

export function queryAiTraceSummaryAndEntries(filters?: {
  website?: string;
  outcome?: string;
  cache?: string;
  search?: string;
  sinceUtc?: string;
  limit?: number;
}): Omit<AiLogsQuerySummary, "filePath" | "fileSizeBytes" | "totalLines" | "rawTail"> {
  const db = getDb();

  const agg = db
    .prepare(
      `SELECT
         COUNT(*) AS totalEntries,
         COALESCE(SUM(CASE WHEN outcome_source = 'LIVE_AI' THEN 1 ELSE 0 END), 0) AS liveAiCount,
         COALESCE(SUM(CASE WHEN outcome_source = 'RESPONSE_CACHE' OR response_cache_status = 'HIT' OR catalog_cache_status = 'HIT' THEN 1 ELSE 0 END), 0) AS cacheHitCount,
         COALESCE(SUM(CASE WHEN outcome_source = 'LOCAL_FALLBACK' THEN 1 ELSE 0 END), 0) AS localFallbackCount,
         COALESCE(SUM(CASE WHEN product_lookup_triggered = 1 THEN 1 ELSE 0 END), 0) AS productLookupCount,
         COALESCE(SUM(CASE WHEN outcome_source = 'ERROR' OR (error_text IS NOT NULL AND error_text != '') THEN 1 ELSE 0 END), 0) AS errorCount,
         COALESCE(SUM(input_tokens), 0) AS totalInputTokens,
         COALESCE(SUM(output_tokens), 0) AS totalOutputTokens,
         COALESCE(SUM(thinking_tokens), 0) AS totalThinkingTokens,
         COALESCE(SUM(cache_read_tokens), 0) AS totalCacheReadInputTokens,
         COALESCE(SUM(cache_creation_tokens), 0) AS totalCacheCreationInputTokens
       FROM ai_trace_logs`
    )
    .get() as Record<string, number>;

  const webRows = db
    .prepare(
      `SELECT
         website,
         COUNT(*) AS cnt,
         COALESCE(SUM(input_tokens), 0) AS inTok,
         COALESCE(SUM(output_tokens), 0) AS outTok
       FROM ai_trace_logs
       GROUP BY website`
    )
    .all() as Array<{ website: string; cnt: number; inTok: number; outTok: number }>;

  const byWebsite = {
    WHATSAPP_HUB: 0,
    CLASSIC_CONCEPTS: 0,
    CLASSIC_EDGE_53: 0,
  };
  const tokensByWebsite = {
    WHATSAPP_HUB: { inputTokens: 0, outputTokens: 0 },
    CLASSIC_CONCEPTS: { inputTokens: 0, outputTokens: 0 },
    CLASSIC_EDGE_53: { inputTokens: 0, outputTokens: 0 },
  };
  for (const r of webRows) {
    if (r.website in byWebsite) {
      const k = r.website as keyof typeof byWebsite;
      byWebsite[k] = Number(r.cnt ?? 0);
      tokensByWebsite[k] = {
        inputTokens: Number(r.inTok ?? 0),
        outputTokens: Number(r.outTok ?? 0),
      };
    }
  }

  const where: string[] = [];
  const args: unknown[] = [];
  const q = (filters?.search || "").trim().toLowerCase();
  const webFilter = (filters?.website || "ALL").toUpperCase();
  const outFilter = (filters?.outcome || "ALL").toUpperCase();
  const cacheFilter = (filters?.cache || "ALL").toUpperCase();
  const sinceUtc = filters?.sinceUtc || "";
  const limit = Math.min(Math.max(filters?.limit ?? 150, 1), 5000);

  if (sinceUtc) {
    where.push("timestamp_utc >= ?");
    args.push(sinceUtc);
  }
  if (webFilter !== "ALL") {
    where.push("website = ?");
    args.push(webFilter);
  }
  if (outFilter !== "ALL") {
    where.push("outcome_source = ?");
    args.push(outFilter);
  }
  if (cacheFilter === "HIT") {
    where.push("(response_cache_status = 'HIT' OR catalog_cache_status = 'HIT')");
  } else if (cacheFilter === "MISS") {
    where.push("(response_cache_status = 'MISS' OR catalog_cache_status = 'MISS')");
  }
  if (q) {
    where.push("INSTR(LOWER(payload_json), ?) > 0");
    args.push(q);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const filtAgg = db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS filteredInputTokens,
         COALESCE(SUM(output_tokens), 0) AS filteredOutputTokens
       FROM ai_trace_logs
       ${whereSql}`
    )
    .get(...args) as { filteredInputTokens: number; filteredOutputTokens: number };

  const entryRows = db
    .prepare(
      `SELECT payload_json
       FROM ai_trace_logs
       ${whereSql}
       ORDER BY timestamp_utc DESC
       LIMIT ?`
    )
    .all(...args, limit) as Array<{ payload_json: string }>;

  const entries: AiTraceLogEntry[] = [];
  for (const row of entryRows) {
    try {
      const parsed = JSON.parse(row.payload_json) as AiTraceLogEntry;
      if (parsed && parsed.id) {
        parsed.timestampIst = formatUtcToIstServer(parsed.timestampUtc);
        entries.push(parsed);
      }
    } catch {
      // Skip malformed JSON
    }
  }

  const totalInputTokens = Number(agg?.totalInputTokens ?? 0);
  const totalOutputTokens = Number(agg?.totalOutputTokens ?? 0);
  const filteredInputTokens = Number(filtAgg?.filteredInputTokens ?? 0);
  const filteredOutputTokens = Number(filtAgg?.filteredOutputTokens ?? 0);

  return {
    totalEntries: Number(agg?.totalEntries ?? 0),
    liveAiCount: Number(agg?.liveAiCount ?? 0),
    cacheHitCount: Number(agg?.cacheHitCount ?? 0),
    localFallbackCount: Number(agg?.localFallbackCount ?? 0),
    productLookupCount: Number(agg?.productLookupCount ?? 0),
    errorCount: Number(agg?.errorCount ?? 0),
    totalInputTokens,
    totalOutputTokens,
    totalThinkingTokens: Number(agg?.totalThinkingTokens ?? 0),
    totalCacheReadInputTokens: Number(agg?.totalCacheReadInputTokens ?? 0),
    totalCacheCreationInputTokens: Number(agg?.totalCacheCreationInputTokens ?? 0),
    totalCombinedTokens: totalInputTokens + totalOutputTokens,
    filteredInputTokens,
    filteredOutputTokens,
    filteredCombinedTokens: filteredInputTokens + filteredOutputTokens,
    byWebsite,
    tokensByWebsite,
    entries,
  };
}
