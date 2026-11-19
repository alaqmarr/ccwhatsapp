import fs from "node:fs";
import path from "node:path";
import { formatInTimeZone } from "date-fns-tz";
import {
  resolveClassicEdgeDbPath,
  resolveMainWebsiteDbPath,
  resolveMonorepoRoot,
} from "@cc/database/clients/env-config";

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

export const AI_LOGS_FILE_HEADER = [
  "# ==============================================================================",
  "# CLASSIC CONCEPTS ECOSYSTEM - UNIFIED AI & PRODUCT LOOKUP FLIGHT LOG (ai.logs)",
  "# Websites Monitored: WhatsApp Hub (ACRIO) • classicconcepts.in • classicedge53.com",
  "# Timestamps stored in UTC ISO-8601 and formatted in IST (Asia/Kolkata) on server",
  "# ==============================================================================",
  "",
].join("\n");

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

export function resolveSiblingAiLogFilePaths(): string[] {
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

export function extractEntriesFromRawContent(raw: string): AiTraceLogEntry[] {
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
 * Official Anthropic Claude Haiku token pricing in USD per 1M tokens.
 */
export const CLAUDE_HAIKU_RATES_USD_PER_1M = {
  input: 1.0,
  output: 5.0,
  cacheWrite5m: 1.25,
  cacheRead: 0.1,
} as const;

export interface AiCostBucket {
  tracesCount: number;
  billedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  totalUsd: number;
  baseInr: number;
  gstInr: number;
  totalWithGstInr: number;
}

export interface EcosystemAiCostSummary {
  usdToInrRate: number;
  gstRatePct: number;
  whatsappHub: AiCostBucket;
  websitesOnly: AiCostBucket;
  classicConcepts: AiCostBucket;
  classicEdge53: AiCostBucket;
  allEcosystem: AiCostBucket;
}

function emptyCostBucket(): AiCostBucket {
  return {
    tracesCount: 0,
    billedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    inputUsd: 0,
    outputUsd: 0,
    cacheReadUsd: 0,
    cacheWriteUsd: 0,
    totalUsd: 0,
    baseInr: 0,
    gstInr: 0,
    totalWithGstInr: 0,
  };
}

function finalizeCostBucket(
  b: AiCostBucket,
  usdToInrRate: number,
  gstRatePct: number
): AiCostBucket {
  const inputUsd = (b.inputTokens * CLAUDE_HAIKU_RATES_USD_PER_1M.input) / 1_000_000;
  const outputUsd = (b.outputTokens * CLAUDE_HAIKU_RATES_USD_PER_1M.output) / 1_000_000;
  const cacheReadUsd = (b.cacheReadTokens * CLAUDE_HAIKU_RATES_USD_PER_1M.cacheRead) / 1_000_000;
  const cacheWriteUsd = (b.cacheWriteTokens * CLAUDE_HAIKU_RATES_USD_PER_1M.cacheWrite5m) / 1_000_000;
  const totalUsd = inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd;
  const baseInr = totalUsd * usdToInrRate;
  const gstInr = baseInr * (gstRatePct / 100);
  const totalWithGstInr = baseInr + gstInr;

  return {
    ...b,
    inputUsd: Number(inputUsd.toFixed(4)),
    outputUsd: Number(outputUsd.toFixed(4)),
    cacheReadUsd: Number(cacheReadUsd.toFixed(4)),
    cacheWriteUsd: Number(cacheWriteUsd.toFixed(4)),
    totalUsd: Number(totalUsd.toFixed(4)),
    baseInr: Number(baseInr.toFixed(2)),
    gstInr: Number(gstInr.toFixed(2)),
    totalWithGstInr: Number(totalWithGstInr.toFixed(2)),
  };
}

/**
 * Computes exact Claude Haiku API costs across uncached input, 5-min cache write, cache read, and output
 * tokens in USD and INR (ex-GST + GST), cleanly split between WhatsApp Hub and Websites.
 */
export function computeClaudeAiCostBreakdown(
  entries: AiTraceLogEntry[],
  opts?: { usdToInrRate?: number; gstRatePct?: number }
): EcosystemAiCostSummary {
  const usdToInrRate =
    typeof opts?.usdToInrRate === "number" && Number.isFinite(opts.usdToInrRate) && opts.usdToInrRate > 0
      ? opts.usdToInrRate
      : 93.4;
  const gstRatePct =
    typeof opts?.gstRatePct === "number" && Number.isFinite(opts.gstRatePct) && opts.gstRatePct >= 0
      ? opts.gstRatePct
      : 18;

  const wa = emptyCostBucket();
  const cc = emptyCostBucket();
  const ce = emptyCostBucket();
  const web = emptyCostBucket();
  const all = emptyCostBucket();

  const addEntry = (bucket: AiCostBucket, e: AiTraceLogEntry) => {
    const u = e.tokenUsage;
    const inT = Number(u?.inputTokens ?? 0) || 0;
    const outT = Number(u?.outputTokens ?? 0) || 0;
    const crT = Number(u?.cacheReadInputTokens ?? 0) || 0;
    const cwT = Number(u?.cacheCreationInputTokens ?? 0) || 0;
    bucket.tracesCount++;
    if (inT + outT + crT + cwT > 0) bucket.billedCalls++;
    bucket.inputTokens += inT;
    bucket.outputTokens += outT;
    bucket.cacheReadTokens += crT;
    bucket.cacheWriteTokens += cwT;
  };

  for (const e of entries) {
    addEntry(all, e);
    if (e.website === "WHATSAPP_HUB") {
      addEntry(wa, e);
    } else if (e.website === "CLASSIC_CONCEPTS") {
      addEntry(cc, e);
      addEntry(web, e);
    } else if (e.website === "CLASSIC_EDGE_53") {
      addEntry(ce, e);
      addEntry(web, e);
    }
  }

  return {
    usdToInrRate,
    gstRatePct,
    whatsappHub: finalizeCostBucket(wa, usdToInrRate, gstRatePct),
    websitesOnly: finalizeCostBucket(web, usdToInrRate, gstRatePct),
    classicConcepts: finalizeCostBucket(cc, usdToInrRate, gstRatePct),
    classicEdge53: finalizeCostBucket(ce, usdToInrRate, gstRatePct),
    allEcosystem: finalizeCostBucket(all, usdToInrRate, gstRatePct),
  };
}
