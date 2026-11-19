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
  website: "WHATSAPP_HUB" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  websiteLabel: string;
  feature: string;
  actor: string;
  question: string;
  model: string;
  effort?: string;
  outcomeSource:
    | "LIVE_AI"
    | "RESPONSE_CACHE"
    | "LOCAL_FALLBACK"
    | "ORDER_LOOKUP"
    | "HUMAN_HANDOFF"
    | "ERROR";
  responseCacheStatus: "HIT" | "MISS" | "BYPASS" | "LOCAL_ONLY";
  catalogCacheStatus: "HIT" | "MISS" | "BYPASS" | "LOCAL_ONLY";
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

export interface AiLogsResponse {
  ok: boolean;
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
  error?: string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function websiteBadgeStyle(website: AiTraceLogEntry["website"]): string {
  switch (website) {
    case "WHATSAPP_HUB":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "CLASSIC_CONCEPTS":
      return "bg-blue-50 text-blue-800 border-blue-200";
    case "CLASSIC_EDGE_53":
      return "bg-amber-50 text-amber-800 border-amber-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

export function outcomeBadgeStyle(
  outcome: AiTraceLogEntry["outcomeSource"]
): string {
  switch (outcome) {
    case "LIVE_AI":
      return "bg-violet-50 text-violet-800 border-violet-200";
    case "RESPONSE_CACHE":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "LOCAL_FALLBACK":
      return "bg-slate-100 text-slate-700 border-slate-300";
    case "HUMAN_HANDOFF":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "ORDER_LOOKUP":
      return "bg-sky-50 text-sky-800 border-sky-200";
    case "ERROR":
      return "bg-red-50 text-red-800 border-red-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

export function cacheBadgeStyle(status: string): string {
  if (status === "HIT")
    return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (status === "MISS")
    return "bg-orange-50 text-orange-800 border-orange-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}
