"use client";

import React, { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  Copy,
  Download,
  FileCode,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { subscribeRealtimeEvent } from "@/lib/realtime-client";
import {
  formatBytes,
  type AiLogsResponse,
  type AiTraceLogEntry,
} from "./ai-logs-types";
import { AiLogsKpiStrip } from "./AiLogsKpiStrip";
import { AiLogsFiltersBar } from "./AiLogsFiltersBar";
import { AiLogEntryCard } from "./AiLogEntryCard";

const AiLogDetailModal = dynamic(() => import("./AiLogDetailModal"), {
  ssr: false,
});

export function AiLogsClient({
  initialData,
}: {
  initialData?: AiLogsResponse;
}) {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<"structured" | "raw">("structured");
  const [websiteFilter, setWebsiteFilter] = useState<string>("ALL");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("ALL");
  const [cacheFilter, setCacheFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [clearing, setClearing] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string>("");
  const [inspectedEntry, setInspectedEntry] = useState<AiTraceLogEntry | null>(
    null
  );
  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDefaultFilters =
    websiteFilter === "ALL" &&
    outcomeFilter === "ALL" &&
    cacheFilter === "ALL" &&
    searchQuery.trim() === "";

  const logsQuery = useQuery<AiLogsResponse>({
    queryKey: [
      "ai-logs",
      websiteFilter,
      outcomeFilter,
      cacheFilter,
      searchQuery,
    ],
    queryFn: async () => {
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
        throw new Error(json.error || "Could not load ai.logs.");
      }
      return json;
    },
    initialData: isDefaultFilters ? initialData : undefined,
    staleTime: 10_000,
    refetchOnWindowFocus: autoRefresh,
  });

  const rawQuery = useQuery<string>({
    queryKey: ["ai-logs-raw"],
    queryFn: async () => {
      const rawRes = await fetch("/api/dev/ai-logs?format=raw", {
        cache: "no-store",
      });
      if (!rawRes.ok) {
        throw new Error("Could not load raw ai.logs file.");
      }
      return rawRes.text();
    },
    enabled: viewMode === "raw",
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!autoRefresh) return;
    const unsub = subscribeRealtimeEvent("ai:log", () => {
      if (invalidateTimerRef.current) {
        clearTimeout(invalidateTimerRef.current);
      }
      invalidateTimerRef.current = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["ai-logs"] });
        if (viewMode === "raw") {
          void queryClient.invalidateQueries({ queryKey: ["ai-logs-raw"] });
        }
      }, 350);
    });
    return () => {
      unsub();
      if (invalidateTimerRef.current) {
        clearTimeout(invalidateTimerRef.current);
        invalidateTimerRef.current = null;
      }
    };
  }, [autoRefresh, queryClient, viewMode]);

  const data = logsQuery.data ?? null;
  const fullRawFile = rawQuery.data ?? "";
  const loading = logsQuery.isLoading && !data;
  const refreshing = logsQuery.isFetching || rawQuery.isFetching;
  const errorMsg =
    logsQuery.error instanceof Error ? logsQuery.error.message : "";

  async function handleRefresh() {
    await logsQuery.refetch();
    if (viewMode === "raw") {
      await rawQuery.refetch();
    }
  }

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
        queryClient.setQueryData(["ai-logs-raw"], "");
        await queryClient.invalidateQueries({ queryKey: ["ai-logs"] });
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
            Live Tail (Realtime)
          </label>

          <button
            type="button"
            onClick={() => void handleRefresh()}
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

      {data && (
        <AiLogsKpiStrip data={data} hasActiveFilters={!isDefaultFilters} />
      )}

      <AiLogsFiltersBar
        viewMode={viewMode}
        setViewMode={setViewMode}
        entriesCount={data?.entries.length ?? 0}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        websiteFilter={websiteFilter}
        setWebsiteFilter={setWebsiteFilter}
        outcomeFilter={outcomeFilter}
        setOutcomeFilter={setOutcomeFilter}
        cacheFilter={cacheFilter}
        setCacheFilter={setCacheFilter}
      />

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
      ) : data.entries.length > 30 ? (
        <VirtualizedAiLogEntries
          entries={data.entries}
          copiedId={copiedId}
          onCopyText={handleCopyText}
          onInspect={setInspectedEntry}
        />
      ) : (
        <div className="space-y-4">
          {data.entries.map((entry) => (
            <AiLogEntryCard
              key={entry.id}
              entry={entry}
              copiedId={copiedId}
              onCopyText={handleCopyText}
              onInspect={setInspectedEntry}
            />
          ))}
        </div>
      )}

      {inspectedEntry && (
        <AiLogDetailModal
          entry={inspectedEntry}
          copiedId={copiedId}
          onCopy={handleCopyText}
          onClose={() => setInspectedEntry(null)}
        />
      )}
    </div>
  );
}

function VirtualizedAiLogEntries({
  entries,
  copiedId,
  onCopyText,
  onInspect,
}: {
  entries: AiTraceLogEntry[];
  copiedId: string;
  onCopyText: (id: string, text: string) => void;
  onInspect: (entry: AiTraceLogEntry) => void;
}) {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 380,
    overscan: 4,
    getItemKey: (idx) => entries[idx]?.id ?? idx,
  });

  return (
    <div ref={scrollParentRef} className="max-h-[75dvh] overflow-y-auto pr-1">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const entry = entries[virtualRow.index];
          if (!entry) return null;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="pb-4"
            >
              <AiLogEntryCard
                entry={entry}
                copiedId={copiedId}
                onCopyText={onCopyText}
                onInspect={onInspect}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
