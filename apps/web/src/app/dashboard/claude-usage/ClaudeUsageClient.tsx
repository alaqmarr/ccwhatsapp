"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  RefreshCw,
  Settings,
} from "lucide-react";
import {
  CardListSkeleton,
  ElementErrorState,
  MetricStatCard,
  StatCardsSkeleton,
} from "@cc/ui";
import {
  formatInt,
  formatUsd,
  statusBadgeMeta,
  type ClaudeUsageAndSpendComparisonReport,
  type UsagePresetRange,
} from "./claude-usage-types";
import { ClaudeUsageIntegrationCard } from "./ClaudeUsageIntegrationCard";
import { ClaudeUsageSharedWorkspaceCard } from "./ClaudeUsageSharedWorkspaceCard";

const ClaudeUsageConfigDrawer = dynamic(
  () => import("./ClaudeUsageConfigDrawer"),
  {
    loading: () => <CardListSkeleton rows={2} />,
  }
);

export function ClaudeUsageClient({
  initialData,
  initialError,
}: {
  initialData?: ClaudeUsageAndSpendComparisonReport | null;
  initialError?: string;
}) {
  const [preset, setPreset] = useState<UsagePresetRange>("mtd");
  const [customStart, setCustomStart] = useState<string>(() => {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(
      2,
      "0"
    )}-01`;
  });
  const [customEnd, setCustomEnd] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );

  const [report, setReport] =
    useState<ClaudeUsageAndSpendComparisonReport | null>(initialData ?? null);
  const [loading, setLoading] = useState<boolean>(!initialData && !initialError);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>(initialError || "");
  const skippedInitialFetchRef = useRef<boolean>(
    Boolean(initialData || initialError)
  );

  const [showConfigDrawer, setShowConfigDrawer] = useState<boolean>(false);
  const [sharedAdminKeyDraft, setSharedAdminKeyDraft] = useState<string>("");
  const [acrioWorkspaceDraft, setAcrioWorkspaceDraft] = useState<string>(
    initialData?.acrio?.identity?.workspaceId || ""
  );
  const [acroWorkspaceDraft, setAcroWorkspaceDraft] = useState<string>(
    initialData?.acro?.identity?.workspaceId || ""
  );
  const [acrioKeyIdDraft, setAcrioKeyIdDraft] = useState<string>(
    initialData?.acrio?.identity?.apiKeyId || ""
  );
  const [acroKeyIdDraft, setAcroKeyIdDraft] = useState<string>(
    initialData?.acro?.identity?.apiKeyId || ""
  );
  const [acrioSharedOthersDraft, setAcrioSharedOthersDraft] =
    useState<boolean>(
      Boolean(initialData?.acrio?.identity?.sharedWithUnrelatedIntegrations)
    );
  const [acroSharedOthersDraft, setAcroSharedOthersDraft] = useState<boolean>(
    Boolean(initialData?.acro?.identity?.sharedWithUnrelatedIntegrations)
  );
  const [savingConfig, setSavingConfig] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string>("");

  const fetchReport = useCallback(
    async (
      activePreset = preset,
      startStr = customStart,
      endStr = customEnd,
      forceRefresh = false
    ) => {
      setRefreshing(true);
      setLoadError("");
      try {
        const qs = new URLSearchParams();
        qs.set("preset", activePreset);
        if (activePreset === "custom") {
          qs.set("starting_at", startStr);
          qs.set("ending_at", endStr);
        }
        if (forceRefresh) {
          qs.set("refresh", "1");
        }
        const res = await fetch(`/api/dev/claude-usage?${qs.toString()}`, {
          cache: "no-store",
        });
        const json: ClaudeUsageAndSpendComparisonReport = await res.json();
        if (!res.ok || !json.ok) {
          setLoadError(
            json.error ||
              "Could not load Claude API usage & spend report (DEV access required)."
          );
          return;
        }
        setReport(json);
        setAcrioWorkspaceDraft(json.acrio.identity.workspaceId || "");
        setAcroWorkspaceDraft(json.acro.identity.workspaceId || "");
        setAcrioKeyIdDraft(json.acrio.identity.apiKeyId || "");
        setAcroKeyIdDraft(json.acro.identity.apiKeyId || "");
        setAcrioSharedOthersDraft(
          json.acrio.identity.sharedWithUnrelatedIntegrations
        );
        setAcroSharedOthersDraft(
          json.acro.identity.sharedWithUnrelatedIntegrations
        );
      } catch {
        setLoadError(
          "Network error while fetching Claude API Usage & Spend report."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [preset, customStart, customEnd]
  );

  useEffect(() => {
    if (skippedInitialFetchRef.current) {
      skippedInitialFetchRef.current = false;
      return;
    }
    if (preset !== "custom") {
      void fetchReport(preset, customStart, customEnd, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  async function handleSaveAttributionConfig(e: React.FormEvent) {
    e.preventDefault();
    setSavingConfig(true);
    setStatusBanner("");
    try {
      const res = await fetch("/api/dev/claude-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preset,
          startingAt: preset === "custom" ? customStart : undefined,
          endingAt: preset === "custom" ? customEnd : undefined,
          sharedOrgAdminApiKey: sharedAdminKeyDraft.trim() || undefined,
          acrioWorkspaceId: acrioWorkspaceDraft.trim(),
          acroWorkspaceId: acroWorkspaceDraft.trim(),
          acrioApiKeyId: acrioKeyIdDraft.trim(),
          acroApiKeyId: acroKeyIdDraft.trim(),
          acrioWorkspaceSharedWithOthers: acrioSharedOthersDraft,
          acroWorkspaceSharedWithOthers: acroSharedOthersDraft,
        }),
      });
      const json: ClaudeUsageAndSpendComparisonReport = await res.json();
      if (res.ok && json.ok) {
        setReport(json);
        setSharedAdminKeyDraft("");
        setStatusBanner(
          "Saved Anthropic Admin API & workspace/key attribution settings and refreshed report."
        );
        setTimeout(() => setStatusBanner(""), 5000);
      } else {
        setLoadError(json.error || "Could not save configuration.");
      }
    } finally {
      setSavingConfig(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] font-bold uppercase tracking-wider">
              DEV ONLY
            </span>
            <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-600" />
              <span>Claude API Usage &amp; Spend (Acrio vs Acro)</span>
            </h1>
          </div>
          <p className="text-xs text-slate-500">
            Direct Anthropic Admin API telemetry via{" "}
            <code className="font-mono text-slate-700">
              GET /v1/organizations/usage_report/messages
            </code>{" "}
            and{" "}
            <code className="font-mono text-slate-700">
              GET /v1/organizations/cost_report
            </code>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {(
              [
                { id: "mtd", label: "Month-to-Date" },
                { id: "7d", label: "Last 7 Days" },
                { id: "30d", label: "Last 30 Days" },
                { id: "custom", label: "Custom Range" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPreset(opt.id)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                  preset === opt.id
                    ? "bg-slate-900 text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowConfigDrawer((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Attribution Config</span>
          </button>

          <button
            type="button"
            disabled={refreshing}
            onClick={() => void fetchReport(preset, customStart, customEnd, true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-2xs disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>{refreshing ? "Refreshing..." : "Refresh Live"}</span>
          </button>
        </div>
      </div>

      {preset === "custom" && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3 shadow-2xs">
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
              Start Date (UTC 00:00:00Z)
            </label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono text-slate-900"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
              End Date (Inclusive UTC Day)
            </label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono text-slate-900"
            />
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void fetchReport("custom", customStart, customEnd, false)}
            className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
          >
            Apply Custom UTC Range
          </button>
        </div>
      )}

      {report && (
        <div className="bg-slate-900 text-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Window:{" "}
                <strong className="font-mono text-white">{report.startingAtUtc}</strong> →{" "}
                <strong className="font-mono text-white">{report.endingAtUtc}</strong>
              </span>
            </span>
            <span className="px-2 py-0.5 rounded bg-white/10 text-emerald-300 font-mono text-[11px] font-bold">
              Time Zone: {report.reportingTimeZone} (UTC)
            </span>
            <span className="px-2 py-0.5 rounded bg-white/10 text-sky-300 font-mono text-[11px]">
              Attribution Mode: {report.spendAttributionMode}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1 text-slate-300">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>
                Last Successful Refresh:{" "}
                <strong className="font-mono text-white">
                  {report.lastSuccessfulRefreshUtc || "Never (Missing Admin Key)"}
                </strong>
              </span>
            </span>
            {report.cacheHit && (
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold uppercase">
                {report.isStale ? "Stale Cache Fallback" : "5m Server Cache Hit"}
              </span>
            )}
          </div>
        </div>
      )}

      {statusBanner && (
        <div className="px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{statusBanner}</span>
        </div>
      )}

      {loadError && (
        <ElementErrorState
          title="Could not load Claude API Usage & Spend"
          message={loadError}
          onRetry={() => void fetchReport(preset, customStart, customEnd, true)}
        />
      )}

      {report && report.overallStatus !== "LIVE_OK" && (
        <div
          className={`p-4 rounded-xl border text-xs space-y-2 ${
            report.overallStatus === "MISSING_CONFIG" ||
            report.overallStatus === "UNAVAILABLE_ATTRIBUTION"
              ? "bg-amber-50 border-amber-200 text-amber-900"
              : report.overallStatus === "STALE_DATA"
              ? "bg-orange-50 border-orange-200 text-orange-900"
              : report.overallStatus === "FETCH_ERROR"
              ? "bg-red-50 border-red-200 text-red-900"
              : "bg-slate-100 border-slate-300 text-slate-800"
          }`}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="font-bold text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                Status: {statusBadgeMeta(report.overallStatus).label}:{" "}
                {report.overallStatusMessage}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowConfigDrawer(true)}
              className="px-3 py-1 rounded-lg bg-slate-900 text-white text-xs font-bold cursor-pointer"
            >
              Configure Admin Key &amp; Workspace/Key IDs
            </button>
          </div>

          {report.requiredEnvConfigGuide.missingVariables.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="font-bold">
                Missing Environment Variables / Attribution IDs:{" "}
                <span className="font-mono">
                  {report.requiredEnvConfigGuide.missingVariables.join(", ")}
                </span>
              </div>
              <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                {report.requiredEnvConfigGuide.instructions.map((inst, i) => (
                  <li key={i}>{inst}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {showConfigDrawer && (
        <ClaudeUsageConfigDrawer
          sharedAdminKeyDraft={sharedAdminKeyDraft}
          setSharedAdminKeyDraft={setSharedAdminKeyDraft}
          acrioWorkspaceDraft={acrioWorkspaceDraft}
          setAcrioWorkspaceDraft={setAcrioWorkspaceDraft}
          acrioKeyIdDraft={acrioKeyIdDraft}
          setAcrioKeyIdDraft={setAcrioKeyIdDraft}
          acrioSharedOthersDraft={acrioSharedOthersDraft}
          setAcrioSharedOthersDraft={setAcrioSharedOthersDraft}
          acroWorkspaceDraft={acroWorkspaceDraft}
          setAcroWorkspaceDraft={setAcroWorkspaceDraft}
          acroKeyIdDraft={acroKeyIdDraft}
          setAcroKeyIdDraft={setAcroKeyIdDraft}
          acroSharedOthersDraft={acroSharedOthersDraft}
          setAcroSharedOthersDraft={setAcroSharedOthersDraft}
          savingConfig={savingConfig}
          onClose={() => setShowConfigDrawer(false)}
          onSave={(e) => void handleSaveAttributionConfig(e)}
        />
      )}

      {loading ? (
        <div className="space-y-4">
          <StatCardsSkeleton count={4} />
          <CardListSkeleton items={2} />
        </div>
      ) : report ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <MetricStatCard
              label="Acrio USD Spend"
              value={
                report.acrio.perKeySpendAvailable &&
                report.acrio.totalSpendUsd !== null
                  ? formatUsd(report.acrio.totalSpendUsd)
                  : "Unavailable"
              }
              subtext={report.acrio.spendLabel}
            />
            <MetricStatCard
              label="Acro USD Spend"
              value={
                report.acro.perKeySpendAvailable &&
                report.acro.totalSpendUsd !== null
                  ? formatUsd(report.acro.totalSpendUsd)
                  : "Unavailable"
              }
              subtext={report.acro.spendLabel}
            />
            <MetricStatCard
              label="Acrio Total Tokens"
              value={formatInt(report.acrio.tokens.totalTokens)}
              subtext={`In: ${formatInt(report.acrio.tokens.inputTokens)} • Out: ${formatInt(report.acrio.tokens.outputTokens)} • Cache Read: ${formatInt(report.acrio.tokens.cacheReadTokens)}`}
            />
            <MetricStatCard
              label="Acro Total Tokens"
              value={formatInt(report.acro.tokens.totalTokens)}
              subtext={`In: ${formatInt(report.acro.tokens.inputTokens)} • Out: ${formatInt(report.acro.tokens.outputTokens)} • Cache Read: ${formatInt(report.acro.tokens.cacheReadTokens)}`}
            />
          </div>

          {report.sharedWorkspaceSpend && (
            <ClaudeUsageSharedWorkspaceCard shared={report.sharedWorkspaceSpend} />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ClaudeUsageIntegrationCard side={report.acrio} />
            <ClaudeUsageIntegrationCard side={report.acro} />
          </div>
        </>
      ) : null}
    </div>
  );
}
