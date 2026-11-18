"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCode,
  PackageSearch,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  AlertTriangle,
} from "lucide-react";

interface AiLookedUpProduct {
  name: string;
  slug?: string;
  sku?: string | null;
  brand?: string;
  itemType?: string;
  priceInr?: number | null;
  url?: string | null;
  reason?: string | null;
}

interface AiTraceStep {
  stepNumber: number;
  label: string;
  detail?: string;
  durationMs?: number;
  status?: "OK" | "WARN" | "SKIP" | "ERROR";
}

interface AiTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

interface AiTraceLogEntry {
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

interface AiLogsResponse {
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function websiteBadgeStyle(website: AiTraceLogEntry["website"]): string {
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

function outcomeBadgeStyle(outcome: AiTraceLogEntry["outcomeSource"]): string {
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

function cacheBadgeStyle(status: string): string {
  if (status === "HIT") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (status === "MISS") return "bg-orange-50 text-orange-800 border-orange-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

export function AiLogsClient({
  initialData,
}: {
  initialData?: AiLogsResponse;
}) {
  const [viewMode, setViewMode] = useState<"structured" | "raw">("structured");
  const [websiteFilter, setWebsiteFilter] = useState<string>("ALL");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("ALL");
  const [cacheFilter, setCacheFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

  const [data, setData] = useState<AiLogsResponse | null>(initialData ?? null);
  const [fullRawFile, setFullRawFile] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [clearing, setClearing] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const skippedInitialFetchRef = useRef<boolean>(Boolean(initialData));

  const fetchLogs = useCallback(
    async (silent = false) => {
      if (!silent) setRefreshing(true);
      setErrorMsg("");
      try {
        const qs = new URLSearchParams({
          website: websiteFilter,
          outcome: outcomeFilter,
          cache: cacheFilter,
          search: searchQuery,
          limit: "200",
        });
        const res = await fetch(`/api/dev/ai-logs?${qs.toString()}`, {
          cache: "no-store",
        });
        const json: AiLogsResponse = await res.json();
        if (!res.ok || !json.ok) {
          setErrorMsg(json.error || "Could not load ai.logs.");
          return;
        }
        setData(json);

        if (viewMode === "raw") {
          const rawRes = await fetch("/api/dev/ai-logs?format=raw", {
            cache: "no-store",
          });
          if (rawRes.ok) {
            setFullRawFile(await rawRes.text());
          }
        }
      } catch (err: any) {
        setErrorMsg(err?.message || "Failed to load AI logs.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [websiteFilter, outcomeFilter, cacheFilter, searchQuery, viewMode]
  );

  useEffect(() => {
    if (skippedInitialFetchRef.current) {
      skippedInitialFetchRef.current = false;
      return;
    }
    void fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      void fetchLogs(true);
    }, 6000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchLogs]);

  async function handleClearLogs() {
    if (
      !window.confirm(
        "Clear all entries in ai.logs across the workspace? This cannot be undone."
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      const res = await fetch("/api/dev/ai-logs", { method: "DELETE" });
      if (res.ok) {
        setFullRawFile("");
        await fetchLogs();
      }
    } finally {
      setClearing(false);
    }
  }

  async function handleCopyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(""), 1800);
    } catch {
      // Ignore clipboard errors
    }
  }

  return (
    <div className="w-full px-4 sm:px-6 py-5 space-y-5">
      {/* Top Header */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 md:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 shadow-2xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-900 text-white">
              <FileCode className="w-3.5 h-3.5" />
              DEV EXCLUSIVE • ai.logs
            </span>
            {data && (
              <span className="font-mono text-[11.5px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                {data.filePath} ({formatBytes(data.fileSizeBytes)} •{" "}
                {data.totalLines.toLocaleString()} lines)
              </span>
            )}
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Unified Ecosystem AI & Product Lookup Flight Logs
          </h1>
          <p className="text-xs text-slate-500">
            Live telemetry across WhatsApp Hub (ACRIO), classicconcepts.in, and
            classicedge53.com: questions asked, cache hits/misses, exact products
            looked up, step-by-step execution, and responses returned.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-300"
            />
            Live Tail (6s)
          </label>

          <button
            type="button"
            onClick={() => fetchLogs(false)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>

          <a
            href="/api/dev/ai-logs?download=1"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white"
          >
            <Download className="w-3.5 h-3.5" />
            Download ai.logs
          </a>

          <button
            type="button"
            onClick={handleClearLogs}
            disabled={clearing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-xs font-semibold text-red-700"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear File
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* KPI Summary Cards */}
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <div className="bg-white rounded-xl border border-neutral-200 p-3.5">
              <div className="text-[11px] font-semibold text-slate-500 uppercase">
                Total Logged Traces
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {data.totalEntries}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                WA: {data.byWebsite.WHATSAPP_HUB} • CC:{" "}
                {data.byWebsite.CLASSIC_CONCEPTS} • CE53:{" "}
                {data.byWebsite.CLASSIC_EDGE_53}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-indigo-200 bg-indigo-50/30 p-3.5">
              <div className="text-[11px] font-semibold text-indigo-700 uppercase">
                Total Tokens In
              </div>
              <div className="text-2xl font-bold text-indigo-950 mt-1 font-mono tabular-nums">
                {(data.totalInputTokens ?? 0).toLocaleString("en-IN")}
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5 font-mono">
                Cache Read:{" "}
                {(data.totalCacheReadInputTokens ?? 0).toLocaleString("en-IN")}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-purple-200 bg-purple-50/30 p-3.5">
              <div className="text-[11px] font-semibold text-purple-700 uppercase">
                Total Tokens Out
              </div>
              <div className="text-2xl font-bold text-purple-950 mt-1 font-mono tabular-nums">
                {(data.totalOutputTokens ?? 0).toLocaleString("en-IN")}
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5 font-mono">
                In + Out:{" "}
                {(data.totalCombinedTokens ?? 0).toLocaleString("en-IN")}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 p-3.5">
              <div className="text-[11px] font-semibold text-violet-700 uppercase flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                Live Claude Haiku 5.5
              </div>
              <div className="text-2xl font-bold text-violet-900 mt-1">
                {data.liveAiCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Medium adaptive effort
              </div>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 p-3.5">
              <div className="text-[11px] font-semibold text-emerald-700 uppercase flex items-center gap-1">
                <Database className="w-3.5 h-3.5" />
                Cache Hits
              </div>
              <div className="text-2xl font-bold text-emerald-800 mt-1">
                {data.cacheHitCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Response & catalog cache
              </div>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 p-3.5">
              <div className="text-[11px] font-semibold text-blue-700 uppercase flex items-center gap-1">
                <PackageSearch className="w-3.5 h-3.5" />
                Product Lookups
              </div>
              <div className="text-2xl font-bold text-blue-900 mt-1">
                {data.productLookupCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Catalog queries traced
              </div>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 p-3.5">
              <div className="text-[11px] font-semibold text-slate-600 uppercase flex items-center gap-1">
                <Activity className="w-3.5 h-3.5" />
                Local / 0-Credit
              </div>
              <div className="text-2xl font-bold text-slate-800 mt-1">
                {data.localFallbackCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Instant deterministic runs
              </div>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 p-3.5">
              <div className="text-[11px] font-semibold text-red-700 uppercase flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Warnings / Errors
              </div>
              <div className="text-2xl font-bold text-red-700 mt-1">
                {data.errorCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                API / parse diagnostics
              </div>
            </div>
          </div>

          {/* Per-Website Token Breakdown Strip */}
          <div className="bg-white rounded-xl border border-neutral-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <span className="font-semibold text-slate-800">
                Tokens by Website:
              </span>
              <span className="font-mono text-[11.5px] text-emerald-900 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md">
                WhatsApp Hub: In{" "}
                {(
                  data.tokensByWebsite?.WHATSAPP_HUB?.inputTokens ?? 0
                ).toLocaleString("en-IN")}{" "}
                • Out{" "}
                {(
                  data.tokensByWebsite?.WHATSAPP_HUB?.outputTokens ?? 0
                ).toLocaleString("en-IN")}
              </span>
              <span className="font-mono text-[11.5px] text-blue-900 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-md">
                classicconcepts.in: In{" "}
                {(
                  data.tokensByWebsite?.CLASSIC_CONCEPTS?.inputTokens ?? 0
                ).toLocaleString("en-IN")}{" "}
                • Out{" "}
                {(
                  data.tokensByWebsite?.CLASSIC_CONCEPTS?.outputTokens ?? 0
                ).toLocaleString("en-IN")}
              </span>
              <span className="font-mono text-[11.5px] text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-md">
                classicedge53.com: In{" "}
                {(
                  data.tokensByWebsite?.CLASSIC_EDGE_53?.inputTokens ?? 0
                ).toLocaleString("en-IN")}{" "}
                • Out{" "}
                {(
                  data.tokensByWebsite?.CLASSIC_EDGE_53?.outputTokens ?? 0
                ).toLocaleString("en-IN")}
              </span>
            </div>
            {(websiteFilter !== "ALL" ||
              outcomeFilter !== "ALL" ||
              cacheFilter !== "ALL" ||
              searchQuery.trim() !== "") && (
              <div className="font-mono text-[11.5px] text-slate-700">
                Filtered View: In{" "}
                <strong>
                  {(data.filteredInputTokens ?? 0).toLocaleString("en-IN")}
                </strong>{" "}
                • Out{" "}
                <strong>
                  {(data.filteredOutputTokens ?? 0).toLocaleString("en-IN")}
                </strong>
              </div>
            )}
          </div>
        </div>
      )}

      {/* View Mode Tabs + Filter Bar */}
      <div className="bg-white rounded-xl border border-neutral-200 p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setViewMode("structured")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                viewMode === "structured"
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Structured Flight Explorer ({data?.entries.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setViewMode("raw")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                viewMode === "raw"
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Raw ai.logs File Viewer
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 flex-1 justify-end w-full">
            <div className="relative min-w-0 w-full sm:min-w-[220px] sm:flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search question, product, SKU, step, response..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-neutral-200 focus:outline-none focus:border-slate-400"
              />
            </div>

            <select
              value={websiteFilter}
              onChange={(e) => setWebsiteFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-neutral-200 bg-white font-medium text-slate-700"
            >
              <option value="ALL">All Websites</option>
              <option value="WHATSAPP_HUB">WhatsApp Hub (ACRIO)</option>
              <option value="CLASSIC_CONCEPTS">Classic Concepts (.in)</option>
              <option value="CLASSIC_EDGE_53">Classic Edge 53 (.com)</option>
            </select>

            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-neutral-200 bg-white font-medium text-slate-700"
            >
              <option value="ALL">All Outcomes</option>
              <option value="LIVE_AI">Live Claude Haiku 5.5</option>
              <option value="RESPONSE_CACHE">Response Cache Hit</option>
              <option value="LOCAL_FALLBACK">Local Catalog / Fallback</option>
              <option value="HUMAN_HANDOFF">Human Handoff</option>
              <option value="ORDER_LOOKUP">Live Order Lookup</option>
              <option value="ERROR">Errors</option>
            </select>

            <select
              value={cacheFilter}
              onChange={(e) => setCacheFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-neutral-200 bg-white font-medium text-slate-700"
            >
              <option value="ALL">All Cache States</option>
              <option value="HIT">Cache HIT</option>
              <option value="MISS">Cache MISS</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="bg-white rounded-xl border border-neutral-200 p-10 text-center text-sm text-slate-500">
          Loading ecosystem ai.logs...
        </div>
      ) : viewMode === "raw" ? (
        <div className="bg-slate-950 text-slate-100 rounded-xl border border-slate-800 overflow-hidden">
          <div className="px-3.5 sm:px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs text-emerald-400 break-all min-w-0">
              {data?.filePath || "ai.logs"}
            </span>
            <button
              type="button"
              onClick={() =>
                handleCopyText("raw_file", fullRawFile || data?.rawTail || "")
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-200 shrink-0"
            >
              <Copy className="w-3 h-3" />
              {copiedId === "raw_file" ? "Copied!" : "Copy Raw Log"}
            </button>
          </div>
          <pre className="p-3 sm:p-4 font-mono text-[11.5px] leading-relaxed overflow-x-auto max-h-[72dvh] overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]">
            {fullRawFile || data?.rawTail || "# No AI logs recorded yet."}
          </pre>
        </div>
      ) : !data || data.entries.length === 0 ? (
        <div className="bg-white rounded-xl border border-neutral-200 p-10 text-center space-y-2">
          <div className="text-sm font-semibold text-slate-800">
            No matching AI trace entries yet
          </div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Trigger any AI concierge chat, smart search, template draft, or
            website enquiry on WhatsApp Hub, classicconcepts.in, or
            classicedge53.com and the complete execution trace will appear here
            instantly.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.entries.map((entry) => (
            <div
              key={entry.id}
              className="bg-white rounded-xl border border-neutral-200 shadow-2xs overflow-hidden"
            >
              {/* Trace Header */}
              <div className="px-4 py-3 bg-slate-50/80 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${websiteBadgeStyle(
                      entry.website
                    )}`}
                  >
                    {entry.websiteLabel}
                  </span>
                  <span className="text-xs font-bold text-slate-900">
                    {entry.feature}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${outcomeBadgeStyle(
                      entry.outcomeSource
                    )}`}
                  >
                    {entry.outcomeSource}
                  </span>
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                    {entry.model}
                    {entry.effort ? ` (${entry.effort})` : ""}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded border text-[10.5px] font-semibold ${cacheBadgeStyle(
                      entry.responseCacheStatus
                    )}`}
                  >
                    Resp Cache: {entry.responseCacheStatus}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded border text-[10.5px] font-semibold ${cacheBadgeStyle(
                      entry.catalogCacheStatus
                    )}`}
                  >
                    Catalog Cache: {entry.catalogCacheStatus}
                  </span>
                  <span className="font-mono text-[10.5px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-900 border border-indigo-200 font-semibold">
                    Tokens In:{" "}
                    {(entry.tokenUsage?.inputTokens ?? 0).toLocaleString("en-IN")}
                  </span>
                  <span className="font-mono text-[10.5px] px-2 py-0.5 rounded bg-purple-50 text-purple-900 border border-purple-200 font-semibold">
                    Tokens Out:{" "}
                    {(entry.tokenUsage?.outputTokens ?? 0).toLocaleString("en-IN")}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono">
                  <span className="inline-flex items-center gap-1 text-slate-700 font-semibold">
                    <Clock className="w-3 h-3" />
                    {entry.durationMs}ms
                  </span>
                  <span title={`UTC: ${entry.timestampUtc}`}>
                    {entry.timestampIst}
                  </span>
                  <span className="text-slate-400">{entry.id}</span>
                </div>
              </div>

              {/* Body Grid */}
              <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Left Column: Question + Looked Up Products + Steps */}
                <div className="lg:col-span-7 space-y-3.5">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Question / Input • Actor: {entry.actor || "Visitor"}
                    </div>
                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-900 whitespace-pre-wrap [overflow-wrap:anywhere] font-medium">
                      {entry.question || "(empty)"}
                    </div>
                  </div>

                  {/* Cache & Token Telemetry Bar */}
                  <div className="rounded-lg bg-slate-50/70 border border-slate-200 px-3 py-2 text-[11px] text-slate-600 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <strong className="text-slate-800">Cache Trace:</strong>{" "}
                      {entry.cacheDetails || "Standard"}
                    </span>
                    <span className="font-mono text-[10.5px] bg-white px-2.5 py-0.5 rounded border border-slate-200 text-slate-800">
                      Tokens In:{" "}
                      <strong>
                        {(entry.tokenUsage?.inputTokens ?? 0).toLocaleString("en-IN")}
                      </strong>{" "}
                      • Tokens Out:{" "}
                      <strong>
                        {(entry.tokenUsage?.outputTokens ?? 0).toLocaleString("en-IN")}
                      </strong>{" "}
                      • Total:{" "}
                      <strong>
                        {(
                          (entry.tokenUsage?.inputTokens ?? 0) +
                          (entry.tokenUsage?.outputTokens ?? 0)
                        ).toLocaleString("en-IN")}
                      </strong>
                      {entry.tokenUsage?.cacheReadInputTokens
                        ? ` • Cache Read: ${entry.tokenUsage.cacheReadInputTokens.toLocaleString("en-IN")}`
                        : ""}
                    </span>
                  </div>

                  {/* Product Lookup Section */}
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center justify-between">
                      <span>
                        Products Looked Up (
                        {entry.productLookupTriggered
                          ? `${entry.productsLookedUp.length} matched of ${entry.productLookupTotalScanned} scanned`
                          : "Lookup Not Triggered"}
                        {entry.productLookupBudget
                          ? ` • Budget: ${entry.productLookupBudget}`
                          : ""}
                        )
                      </span>
                      {entry.productLookupQuery && (
                        <span className="font-mono text-[10.5px] normal-case text-slate-500">
                          query=&quot;{entry.productLookupQuery.slice(0, 55)}&quot;
                        </span>
                      )}
                    </div>

                    {!entry.productLookupTriggered ? (
                      <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500">
                        No product catalog lookup needed for this step.
                      </div>
                    ) : entry.productsLookedUp.length === 0 ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-900">
                        Catalog lookup ran against {entry.productLookupTotalScanned}{" "}
                        items, and 0 items matched the strict query/budget filter.
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
                        {entry.productsLookedUp.map((prod, idx) => (
                          <div
                            key={`${entry.id}_p_${idx}`}
                            className="px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2"
                          >
                            <div className="space-y-0.5">
                              <div className="font-semibold text-slate-900 flex items-center gap-1.5 flex-wrap">
                                <span className="text-slate-400 font-mono">
                                  {idx + 1}.
                                </span>
                                <span>{prod.name}</span>
                                {typeof prod.priceInr === "number" &&
                                  prod.priceInr > 0 && (
                                    <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[10.5px]">
                                      ₹{prod.priceInr.toLocaleString("en-IN")}
                                    </span>
                                  )}
                                {prod.sku && (
                                  <span className="font-mono text-[10px] text-slate-500">
                                    SKU: {prod.sku}
                                  </span>
                                )}
                              </div>
                              {prod.reason && (
                                <div className="text-[11px] text-slate-500">
                                  {prod.reason}
                                </div>
                              )}
                            </div>

                            {prod.url && (
                              <a
                                href={prod.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-600 hover:underline"
                              >
                                {prod.url.replace(/^https?:\/\//, "").slice(0, 28)}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Steps Timeline */}
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Execution Steps Followed ({entry.steps.length})
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 space-y-1.5">
                      {entry.steps.map((s, idx) => (
                        <div
                          key={`${entry.id}_s_${idx}`}
                          className="text-xs flex items-start gap-2"
                        >
                          <CheckCircle2
                            className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                              s.status === "ERROR"
                                ? "text-red-600"
                                : s.status === "WARN"
                                ? "text-amber-600"
                                : "text-emerald-600"
                            }`}
                          />
                          <div className="flex-1">
                            <span className="font-semibold text-slate-800">
                              {s.stepNumber || idx + 1}. {s.label}
                            </span>
                            {typeof s.durationMs === "number" && (
                              <span className="ml-1.5 font-mono text-[10.5px] text-slate-400">
                                (+{s.durationMs}ms)
                              </span>
                            )}
                            {s.detail && (
                              <div className="text-[11px] text-slate-600">
                                {s.detail}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right Column: Final Response & Error Diagnostics */}
                <div className="lg:col-span-5 flex flex-col justify-between space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Response Followed / Sent
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyText(entry.id, entry.response || "")
                        }
                        className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800"
                      >
                        <Copy className="w-3 h-3" />
                        {copiedId === entry.id ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <div className="rounded-xl bg-[#efeae2] border border-stone-300 p-3.5 text-xs text-slate-900 whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed shadow-inner min-h-[160px]">
                      {entry.response || "(empty response)"}
                    </div>
                  </div>

                  {entry.error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                      <div className="font-bold mb-0.5">
                        Diagnostic / Fallback Reason:
                      </div>
                      <div className="font-mono text-[11px] whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {entry.error}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
