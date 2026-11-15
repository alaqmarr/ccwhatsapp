import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { formatInTimeZone } from "date-fns-tz";
import {
  resolveClassicEdgeDbPath,
  resolveMainWebsiteDbPath,
  resolveMonorepoRoot,
} from "./clients";

export type AiLogWebsite =
  | "WHATSAPP_HUB"
  | "CLASSIC_CONCEPTS"
  | "CLASSIC_EDGE_53";

export type AiLogCacheStatus = "HIT" | "MISS" | "BYPASS" | "LOCAL_ONLY";

export type AiLogOutcomeSource =
  | "LIVE_AI"
  | "RESPONSE_CACHE"
  | "LOCAL_FALLBACK"
  | "ORDER_LOOKUP"
  | "HUMAN_HANDOFF"
  | "ERROR";

export interface AiLookedUpProduct {
  name: string;
  slug?: string;
  sku?: string | null;
  brand?: string;
  itemType?: string;
  priceInr?: number | null;
  url?: string | null;
  reason?: string | null;
}

export interface AiTraceStep {
  stepNumber: number;
  label: string;
  detail?: string;
  durationMs?: number;
  status?: "OK" | "WARN" | "SKIP" | "ERROR";
}

export interface AiTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface AiTraceLogEntry {
  id: string;
  timestampUtc: string;
  timestampIst: string;
  website: AiLogWebsite;
  websiteLabel: string;
  feature: string;
  actor: string;
  question: string;
  model: string;
  effort?: string;
  outcomeSource: AiLogOutcomeSource;
  responseCacheStatus: AiLogCacheStatus;
  catalogCacheStatus: AiLogCacheStatus;
  cacheDetails: string;
  productLookupTriggered: boolean;
  productLookupQuery: string;
  productLookupBudget?: string | null;
  productLookupTotalScanned: number;
  productsLookedUp: AiLookedUpProduct[];
  steps: AiTraceStep[];
  response: string;
  durationMs: number;
  tokenUsage?: AiTokenUsage | null;
  error?: string | null;
}

const MAX_AI_LOG_BYTES = 16 * 1024 * 1024; // 16 MB rolling cap

export function formatUtcToIstServer(utcIso?: string): string {
  try {
    const dt = utcIso ? new Date(utcIso) : new Date();
    if (Number.isNaN(dt.getTime())) {
      return formatInTimeZone(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss 'IST'");
    }
    return formatInTimeZone(dt, "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss 'IST'");
  } catch {
    return new Date().toISOString();
  }
}

export function resolveMasterAiLogFilePath(): string {
  if (process.env.AI_LOGS_FILE_PATH) {
    return path.resolve(/*turbopackIgnore: true*/ process.env.AI_LOGS_FILE_PATH);
  }
  return path.join(/*turbopackIgnore: true*/ resolveMonorepoRoot(), "ai.logs");
}

function resolveSiblingAiLogFilePaths(): string[] {
  const root = resolveMonorepoRoot();
  const candidates = new Set<string>();

  const ccDb = resolveMainWebsiteDbPath();
  if (ccDb) {
    const ccDir = path.basename(ccDb).toLowerCase() === "dev.db"
      ? path.dirname(/*turbopackIgnore: true*/ ccDb)
      : path.dirname(/*turbopackIgnore: true*/ path.dirname(/*turbopackIgnore: true*/ ccDb));
    candidates.add(path.join(/*turbopackIgnore: true*/ ccDir, "ai.logs"));
  }

  const ceDb = resolveClassicEdgeDbPath();
  if (ceDb) {
    const ceDir = path.basename(ceDb).toLowerCase() === "dev.db"
      ? path.dirname(/*turbopackIgnore: true*/ ceDb)
      : path.dirname(/*turbopackIgnore: true*/ path.dirname(/*turbopackIgnore: true*/ ceDb));
    candidates.add(path.join(/*turbopackIgnore: true*/ ceDir, "ai.logs"));
  }

  // Common sibling & desktop workspaces
  for (const rel of [
    path.resolve(/*turbopackIgnore: true*/ root, "..", "classicconcepts", "ai.logs"),
    path.resolve(/*turbopackIgnore: true*/ root, "..", "classicedge", "ai.logs"),
    "C:/Users/DELL/Desktop/classicconcepts/ai.logs",
    "C:/Users/DELL/Desktop/classicedge/ai.logs",
  ]) {
    candidates.add(path.resolve(/*turbopackIgnore: true*/ rel));
  }

  const master = path.resolve(/*turbopackIgnore: true*/ resolveMasterAiLogFilePath());
  candidates.delete(master);
  return Array.from(candidates).filter((p) => fs.existsSync(/*turbopackIgnore: true*/ p));
}

export function formatAiTraceBlock(entry: AiTraceLogEntry): string {
  const ist = formatUtcToIstServer(entry.timestampUtc);
  const normalizedEntry: AiTraceLogEntry = {
    ...entry,
    timestampIst: ist,
  };

  const indentLines = (raw: string, prefix = "  "): string =>
    String(raw || "(empty)")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");

  const productsLines =
    !normalizedEntry.productLookupTriggered
      ? "  (No product lookup executed for this step)"
      : normalizedEntry.productsLookedUp.length === 0
      ? `  (0 matching items found across ${normalizedEntry.productLookupTotalScanned} scanned items for query="${normalizedEntry.productLookupQuery}")`
      : normalizedEntry.productsLookedUp
          .map((p, idx) => {
            const priceStr =
              typeof p.priceInr === "number" && p.priceInr > 0
                ? `₹${p.priceInr.toLocaleString("en-IN")}`
                : "Custom / On Request";
            const brandStr = p.brand ? `[${p.brand}] ` : "";
            const skuStr = p.sku ? ` | SKU: ${p.sku}` : "";
            const slugStr = p.slug ? ` | slug: ${p.slug}` : "";
            const urlStr = p.url ? ` | ${p.url}` : "";
            const reasonStr = p.reason ? ` - ${p.reason}` : "";
            return `  ${idx + 1}. ${brandStr}${p.name} (${priceStr}${skuStr}${slugStr}${urlStr})${reasonStr}`;
          })
          .join("\n");

  const stepsLines =
    normalizedEntry.steps.length === 0
      ? "  1. [OK] Completed execution"
      : normalizedEntry.steps
          .map((s, idx) => {
            const st = s.status || "OK";
            const dur =
              typeof s.durationMs === "number" ? ` (+${s.durationMs}ms)` : "";
            const det = s.detail ? ` -> ${s.detail}` : "";
            return `  ${s.stepNumber || idx + 1}. [${st}]${dur} ${s.label}${det}`;
          })
          .join("\n");

  const tokenStr = normalizedEntry.tokenUsage
    ? ` | TOKENS: in=${normalizedEntry.tokenUsage.inputTokens ?? 0}, think=${normalizedEntry.tokenUsage.thinkingTokens ?? 0}, out=${normalizedEntry.tokenUsage.outputTokens ?? 0}, cache_read=${normalizedEntry.tokenUsage.cacheReadInputTokens ?? 0}, cache_write=${normalizedEntry.tokenUsage.cacheCreationInputTokens ?? 0}`
    : "";

  const errLine = normalizedEntry.error
    ? `\nERROR / DIAGNOSTIC:\n${indentLines(normalizedEntry.error)}`
    : "";

  return [
    "================================================================================",
    `[${ist} | ${normalizedEntry.timestampUtc}] TRACE_ID: ${normalizedEntry.id}`,
    `WEBSITE: ${normalizedEntry.websiteLabel} (${normalizedEntry.website}) | FEATURE: ${normalizedEntry.feature}`,
    `ACTOR: ${normalizedEntry.actor || "Anonymous"} | MODEL: ${normalizedEntry.model}${normalizedEntry.effort ? ` (effort=${normalizedEntry.effort})` : ""} | OUTCOME: ${normalizedEntry.outcomeSource} (${normalizedEntry.durationMs}ms)${tokenStr}`,
    `CACHE: response=${normalizedEntry.responseCacheStatus} | catalog=${normalizedEntry.catalogCacheStatus} | ${normalizedEntry.cacheDetails}`,
    `QUESTION / INPUT:\n${indentLines(normalizedEntry.question)}`,
    `PRODUCT LOOKUP (triggered=${normalizedEntry.productLookupTriggered}, query="${normalizedEntry.productLookupQuery || ""}"${normalizedEntry.productLookupBudget ? `, budget="${normalizedEntry.productLookupBudget}"` : ""}, matched=${normalizedEntry.productsLookedUp.length} of ${normalizedEntry.productLookupTotalScanned}):\n${productsLines}`,
    `STEPS FOLLOWED:\n${stepsLines}`,
    `RESPONSE FOLLOWED:\n${indentLines(normalizedEntry.response)}${errLine}`,
    `META_JSON: ${JSON.stringify(normalizedEntry)}`,
    "",
  ].join("\n");
}

function ensureLogFileInitialized(filePath: string): void {
  const dir = path.dirname(/*turbopackIgnore: true*/ filePath);
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
    const header = [
      "# ==============================================================================",
      "# CLASSIC CONCEPTS ECOSYSTEM — UNIFIED AI & PRODUCT LOOKUP FLIGHT LOG (ai.logs)",
      "# Websites Monitored: WhatsApp Hub (ACRIO) • classicconcepts.in • classicedge53.com",
      "# Timestamps stored in UTC ISO-8601 and formatted in IST (Asia/Kolkata) on server",
      "# ==============================================================================",
      "",
    ].join("\n");
    fs.writeFileSync(/*turbopackIgnore: true*/ filePath, header, "utf8");
  }
}

function rotateLogFileIfNeeded(filePath: string): void {
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) return;
    const stat = fs.statSync(/*turbopackIgnore: true*/ filePath);
    if (stat.size <= MAX_AI_LOG_BYTES) return;
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8");
    // Keep newest ~60% of the log file aligned to block separator
    const sliceStart = Math.floor(raw.length * 0.4);
    const nextBoundary = raw.indexOf(
      "================================================================================",
      sliceStart
    );
    const trimmed =
      nextBoundary !== -1 ? raw.slice(nextBoundary) : raw.slice(sliceStart);
    fs.writeFileSync(
      /*turbopackIgnore: true*/ filePath,
      `# [Rotated ai.logs at ${new Date().toISOString()}]\n\n${trimmed}`,
      "utf8"
    );
  } catch {
    // Non-blocking
  }
}

export function appendAiTraceLog(
  input: Omit<AiTraceLogEntry, "id" | "timestampUtc" | "timestampIst"> & {
    id?: string;
    timestampUtc?: string;
  }
): AiTraceLogEntry {
  const timestampUtc = input.timestampUtc || new Date().toISOString();
  const timestampIst = formatUtcToIstServer(timestampUtc);
  const entry: AiTraceLogEntry = {
    ...input,
    id: input.id || `ail_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
    timestampUtc,
    timestampIst,
  };

  try {
    const filePath = resolveMasterAiLogFilePath();
    ensureLogFileInitialized(filePath);
    rotateLogFileIfNeeded(filePath);

    // Prevent duplicate IDs when both HTTP bridge push and sibling file sync run
    if (input.id && fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
      const existingRaw = fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8");
      if (existingRaw.includes(`"id":"${entry.id}"`)) {
        return entry;
      }
    }

    const block = formatAiTraceBlock(entry);
    fs.appendFileSync(/*turbopackIgnore: true*/ filePath, `${block}\n`, "utf8");
  } catch {
    // Never crash caller on logging I/O
  }

  return entry;
}

function extractEntriesFromRawContent(raw: string): AiTraceLogEntry[] {
  const entries: AiTraceLogEntry[] = [];
  if (!raw) return entries;
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("META_JSON: ")) continue;
    try {
      const parsed = JSON.parse(line.slice("META_JSON: ".length)) as AiTraceLogEntry;
      if (parsed && parsed.id) {
        parsed.timestampIst = formatUtcToIstServer(parsed.timestampUtc);
        entries.push(parsed);
      }
    } catch {
      // Skip malformed line
    }
  }
  return entries;
}

/**
 * Merges any unseen trace entries from sibling websites (`classicconcepts/ai.logs`, `classicedge/ai.logs`)
 * into the master `ccwhatsapp/ai.logs` file so Dev sees 100% of cross-website activity even if a site wrote locally.
 */
export function syncSiblingWebsiteAiLogs(): number {
  let importedCount = 0;
  try {
    const masterPath = resolveMasterAiLogFilePath();
    ensureLogFileInitialized(masterPath);
    const masterRaw = fs.readFileSync(/*turbopackIgnore: true*/ masterPath, "utf8");
    const knownIds = new Set(
      extractEntriesFromRawContent(masterRaw).map((e) => e.id)
    );

    const siblingPaths = resolveSiblingAiLogFilePaths();
    const blocksToAppend: string[] = [];

    for (const sibPath of siblingPaths) {
      try {
        const sibRaw = fs.readFileSync(/*turbopackIgnore: true*/ sibPath, "utf8");
        const sibEntries = extractEntriesFromRawContent(sibRaw);
        for (const entry of sibEntries) {
          if (!knownIds.has(entry.id)) {
            knownIds.add(entry.id);
            blocksToAppend.push(formatAiTraceBlock(entry));
            importedCount++;
          }
        }
      } catch {
        // Ignore unreadable sibling log
      }
    }

    if (blocksToAppend.length > 0) {
      fs.appendFileSync(/*turbopackIgnore: true*/ masterPath, `${blocksToAppend.join("\n")}\n`, "utf8");
    }
  } catch {
    // Non-blocking
  }
  return importedCount;
}

export interface AiLogsQuerySummary {
  filePath: string;
  fileSizeBytes: number;
  totalLines: number;
  totalEntries: number;
  liveAiCount: number;
  cacheHitCount: number;
  localFallbackCount: number;
  productLookupCount: number;
  errorCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalThinkingTokens: number;
  totalCacheReadInputTokens: number;
  totalCacheCreationInputTokens: number;
  totalCombinedTokens: number;
  filteredInputTokens: number;
  filteredOutputTokens: number;
  filteredCombinedTokens: number;
  byWebsite: {
    WHATSAPP_HUB: number;
    CLASSIC_CONCEPTS: number;
    CLASSIC_EDGE_53: number;
  };
  tokensByWebsite: {
    WHATSAPP_HUB: { inputTokens: number; outputTokens: number };
    CLASSIC_CONCEPTS: { inputTokens: number; outputTokens: number };
    CLASSIC_EDGE_53: { inputTokens: number; outputTokens: number };
  };
  entries: AiTraceLogEntry[];
  rawTail: string;
}

export function readAiTraceLogs(filters?: {
  website?: string;
  outcome?: string;
  cache?: string;
  search?: string;
  sinceUtc?: string;
  limit?: number;
}): AiLogsQuerySummary {
  syncSiblingWebsiteAiLogs();
  const filePath = resolveMasterAiLogFilePath();
  ensureLogFileInitialized(filePath);

  const raw = fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8");
  const stat = fs.statSync(/*turbopackIgnore: true*/ filePath);
  const allLines = raw.split(/\r?\n/);

  const allEntries = extractEntriesFromRawContent(raw).sort((a, b) =>
    b.timestampUtc.localeCompare(a.timestampUtc)
  );

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
  let liveAiCount = 0;
  let cacheHitCount = 0;
  let localFallbackCount = 0;
  let productLookupCount = 0;
  let errorCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalThinkingTokens = 0;
  let totalCacheReadInputTokens = 0;
  let totalCacheCreationInputTokens = 0;

  for (const e of allEntries) {
    const inTok = Number(e.tokenUsage?.inputTokens ?? 0) || 0;
    const outTok = Number(e.tokenUsage?.outputTokens ?? 0) || 0;
    const thinkTok = Number(e.tokenUsage?.thinkingTokens ?? 0) || 0;
    const cacheReadTok = Number(e.tokenUsage?.cacheReadInputTokens ?? 0) || 0;
    const cacheWriteTok = Number(e.tokenUsage?.cacheCreationInputTokens ?? 0) || 0;

    totalInputTokens += inTok;
    totalOutputTokens += outTok;
    totalThinkingTokens += thinkTok;
    totalCacheReadInputTokens += cacheReadTok;
    totalCacheCreationInputTokens += cacheWriteTok;

    if (e.website in byWebsite) {
      byWebsite[e.website]++;
      tokensByWebsite[e.website].inputTokens += inTok;
      tokensByWebsite[e.website].outputTokens += outTok;
    }
    if (e.outcomeSource === "LIVE_AI") liveAiCount++;
    if (
      e.outcomeSource === "RESPONSE_CACHE" ||
      e.responseCacheStatus === "HIT" ||
      e.catalogCacheStatus === "HIT"
    ) {
      cacheHitCount++;
    }
    if (e.outcomeSource === "LOCAL_FALLBACK") localFallbackCount++;
    if (e.productLookupTriggered) productLookupCount++;
    if (e.outcomeSource === "ERROR" || Boolean(e.error)) errorCount++;
  }

  const q = (filters?.search || "").trim().toLowerCase();
  const webFilter = (filters?.website || "ALL").toUpperCase();
  const outFilter = (filters?.outcome || "ALL").toUpperCase();
  const cacheFilter = (filters?.cache || "ALL").toUpperCase();
  const sinceUtc = filters?.sinceUtc || "";
  const limit = Math.min(Math.max(filters?.limit ?? 150, 1), 5000);

  const filtered = allEntries.filter((e) => {
    if (sinceUtc && e.timestampUtc < sinceUtc) return false;
    if (webFilter !== "ALL" && e.website !== webFilter) return false;
    if (outFilter !== "ALL" && e.outcomeSource !== outFilter) return false;
    if (cacheFilter === "HIT") {
      if (e.responseCacheStatus !== "HIT" && e.catalogCacheStatus !== "HIT") {
        return false;
      }
    } else if (cacheFilter === "MISS") {
      if (e.responseCacheStatus !== "MISS" && e.catalogCacheStatus !== "MISS") {
        return false;
      }
    }
    if (q) {
      const hay = [
        e.id,
        e.websiteLabel,
        e.feature,
        e.actor,
        e.question,
        e.response,
        e.cacheDetails,
        e.productLookupQuery,
        e.error || "",
        ...e.productsLookedUp.map((p) => `${p.name} ${p.slug || ""} ${p.sku || ""}`),
        ...e.steps.map((s) => `${s.label} ${s.detail || ""}`),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  let filteredInputTokens = 0;
  let filteredOutputTokens = 0;
  for (const e of filtered) {
    filteredInputTokens += Number(e.tokenUsage?.inputTokens ?? 0) || 0;
    filteredOutputTokens += Number(e.tokenUsage?.outputTokens ?? 0) || 0;
  }

  const tailLines = allLines.slice(-600).join("\n");

  return {
    filePath,
    fileSizeBytes: stat.size,
    totalLines: allLines.length,
    totalEntries: allEntries.length,
    liveAiCount,
    cacheHitCount,
    localFallbackCount,
    productLookupCount,
    errorCount,
    totalInputTokens,
    totalOutputTokens,
    totalThinkingTokens,
    totalCacheReadInputTokens,
    totalCacheCreationInputTokens,
    totalCombinedTokens: totalInputTokens + totalOutputTokens,
    filteredInputTokens,
    filteredOutputTokens,
    filteredCombinedTokens: filteredInputTokens + filteredOutputTokens,
    byWebsite,
    tokensByWebsite,
    entries: filtered.slice(0, limit),
    rawTail: tailLines,
  };
}

export function readRawAiLogFile(): { filePath: string; content: string } {
  syncSiblingWebsiteAiLogs();
  const filePath = resolveMasterAiLogFilePath();
  ensureLogFileInitialized(filePath);
  return {
    filePath,
    content: fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8"),
  };
}

export function clearAiTraceLogs(): { filePath: string } {
  const filePath = resolveMasterAiLogFilePath();
  if (fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
    fs.unlinkSync(/*turbopackIgnore: true*/ filePath);
  }
  // Also clear sibling files so syncSiblingWebsiteAiLogs doesn't immediately re-import cleared logs
  for (const sib of resolveSiblingAiLogFilePaths()) {
    try {
      fs.unlinkSync(/*turbopackIgnore: true*/ sib);
    } catch {
      // Ignore
    }
  }
  ensureLogFileInitialized(filePath);
  return { filePath };
}
