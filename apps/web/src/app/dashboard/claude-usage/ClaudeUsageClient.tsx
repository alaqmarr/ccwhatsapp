"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Cpu,
  DollarSign,
  Info,
  KeyRound,
  Layers,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
} from "lucide-react";
import {
  CardListSkeleton,
  ElementErrorState,
  MetricStatCard,
  StatCardsSkeleton,
} from "@cc/ui";

type UsagePresetRange = "mtd" | "7d" | "30d" | "custom";
type ReportDataStatus =
  | "LIVE_OK"
  | "ZERO_USAGE"
  | "MISSING_CONFIG"
  | "UNAVAILABLE_ATTRIBUTION"
  | "STALE_DATA"
  | "FETCH_ERROR";
type SpendAttributionMode =
  | "SEPARATE_WORKSPACES"
  | "SHARED_WORKSPACE"
  | "UNCONFIGURED_WORKSPACE";

interface TokenMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

interface KeyModelTokenBreakdown extends TokenMetrics {
  apiKeyId: string;
  workspaceId: string | null;
  model: string;
}

interface DailyTokenPoint extends TokenMetrics {
  dateUtc: string;
}

interface DailySpendPoint {
  dateUtc: string;
  amountCents: number;
  spendUsd: number;
  byDescription: Record<string, number>;
}

interface IntegrationBillingIdentity {
  integration: "ACRIO" | "ACRO";
  label: string;
  description: string;
  runtimeKeyConfigured: boolean;
  runtimeKeyPrefix: string | null;
  runtimeKeySource: string;
  runtimeKeyType: "service_key" | "standard_api_key" | "admin_key" | "missing";
  organizationId: string | null;
  organizationName: string | null;
  adminApiKeyConfigured: boolean;
  adminApiKeyPrefix: string | null;
  adminApiKeyEnvVar: string;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceEnvVar: string;
  apiKeyId: string | null;
  apiKeyName: string | null;
  apiKeyIdEnvVar: string;
  sharedWithUnrelatedIntegrations: boolean;
}

interface IntegrationUsageAndSpendSummary {
  integration: "ACRIO" | "ACRO";
  identity: IntegrationBillingIdentity;
  usageStatus: ReportDataStatus;
  usageStatusMessage: string;
  spendStatus: ReportDataStatus;
  spendStatusMessage: string;
  perKeySpendAvailable: boolean;
  spendLabel: string;
  totalSpendUsd: number | null;
  totalSpendCents: number | null;
  dailySpend: DailySpendPoint[];
  tokens: TokenMetrics;
  byKeyAndModel: KeyModelTokenBreakdown[];
  dailyTokens: DailyTokenPoint[];
}

interface SharedWorkspaceSpendSummary {
  workspaceId: string;
  workspaceName: string | null;
  sharedBetweenAcrioAndAcro: boolean;
  servesUnrelatedIntegrations: boolean;
  spendLabel: string;
  totalSpendUsd: number;
  totalSpendCents: number;
  dailySpend: DailySpendPoint[];
  unattributedKeyIds: string[];
}

interface ClaudeUsageAndSpendComparisonReport {
  ok: boolean;
  reportingTimeZone: "UTC";
  preset: UsagePresetRange;
  startingAtUtc: string;
  endingAtUtc: string;
  generatedAtUtc: string;
  lastSuccessfulRefreshUtc: string | null;
  cacheHit: boolean;
  isStale: boolean;
  sameOrganization: boolean;
  spendAttributionMode: SpendAttributionMode;
  overallStatus: ReportDataStatus;
  overallStatusMessage: string;
  acrio: IntegrationUsageAndSpendSummary;
  acro: IntegrationUsageAndSpendSummary;
  sharedWorkspaceSpend: SharedWorkspaceSpendSummary | null;
  organizationTotalSpendUsd: number | null;
  organizationUnattributedTokens: TokenMetrics;
  requiredEnvConfigGuide: {
    missingVariables: string[];
    instructions: string[];
  };
  warnings: string[];
  error?: string;
}

function formatUsd(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) {
    return "Unavailable";
  }
  if (usd === 0) return "$0.00";
  if (usd > 0 && usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatInt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-US");
}

function statusBadgeMeta(status: ReportDataStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "LIVE_OK":
      return {
        label: "Live Anthropic Data",
        className: "bg-emerald-50 text-emerald-800 border-emerald-200",
      };
    case "ZERO_USAGE":
      return {
        label: "Zero Usage in Period",
        className: "bg-slate-100 text-slate-700 border-slate-300",
      };
    case "MISSING_CONFIG":
      return {
        label: "Missing Configuration",
        className: "bg-amber-50 text-amber-800 border-amber-200",
      };
    case "UNAVAILABLE_ATTRIBUTION":
      return {
        label: "Attribution Unavailable",
        className: "bg-purple-50 text-purple-800 border-purple-200",
      };
    case "STALE_DATA":
      return {
        label: "Stale Cached Data",
        className: "bg-orange-50 text-orange-800 border-orange-200",
      };
    case "FETCH_ERROR":
    default:
      return {
        label: "Upstream Fetch Error",
        className: "bg-red-50 text-red-800 border-red-200",
      };
  }
}

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

  // Optional Dev Attribution Mapping Drawer
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

  const renderIntegrationCard = (side: IntegrationUsageAndSpendSummary) => {
    const isAcrio = side.integration === "ACRIO";
    const usageBadge = statusBadgeMeta(side.usageStatus);
    const spendBadge = statusBadgeMeta(side.spendStatus);

    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xs flex flex-col overflow-hidden">
        {/* Card Header */}
        <div
          className={`px-4 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 ${
            isAcrio ? "bg-emerald-50/60" : "bg-indigo-50/60"
          }`}
        >
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider ${
                  isAcrio
                    ? "bg-emerald-600 text-white"
                    : "bg-indigo-600 text-white"
                }`}
              >
                {side.integration}
              </span>
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
                {side.identity.label}
              </h2>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {side.identity.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`px-2 py-0.5 rounded border text-[10px] font-bold ${usageBadge.className}`}
            >
              Usage: {usageBadge.label}
            </span>
            <span
              className={`px-2 py-0.5 rounded border text-[10px] font-bold ${spendBadge.className}`}
            >
              Spend: {spendBadge.label}
            </span>
          </div>
        </div>

        <div className="p-4 space-y-4 flex-1 flex flex-col">
          {/* Billing & Attribution Identity Metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200/80 text-xs">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Anthropic Organization
              </span>
              <span className="font-mono font-semibold text-slate-800 break-all">
                {side.identity.organizationName
                  ? `${side.identity.organizationName} (${side.identity.organizationId})`
                  : side.identity.organizationId || "Not detected"}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Runtime Inference Key
              </span>
              <span className="font-mono font-semibold text-slate-800">
                {side.identity.runtimeKeyPrefix || "Not configured"}{" "}
                <span className="text-[10px] text-slate-500 font-sans">
                  ({side.identity.runtimeKeyType.replace(/_/g, " ")})
                </span>
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Spend Attribution Workspace ID
              </span>
              <span className="font-mono font-semibold text-slate-800">
                {side.identity.workspaceId
                  ? `${side.identity.workspaceName ? `${side.identity.workspaceName} · ` : ""}${side.identity.workspaceId}`
                  : `Unconfigured (${side.identity.workspaceEnvVar})`}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Usage Attribution API Key ID
              </span>
              <span className="font-mono font-semibold text-slate-800">
                {side.identity.apiKeyId
                  ? `${side.identity.apiKeyName ? `${side.identity.apiKeyName} · ` : ""}${side.identity.apiKeyId}`
                  : `Unconfigured (${side.identity.apiKeyIdEnvVar})`}
              </span>
            </div>
          </div>

          {/* USD Spend Box */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {side.spendLabel}
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                Currency: USD
              </span>
            </div>

            {side.perKeySpendAvailable && side.totalSpendUsd !== null ? (
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-black text-slate-900">
                  {formatUsd(side.totalSpendUsd)}
                </span>
                <span className="text-xs font-mono text-slate-500">
                  ({side.totalSpendCents?.toFixed(2)}¢ USD cents)
                </span>
              </div>
            ) : side.totalSpendUsd !== null &&
              side.identity.sharedWithUnrelatedIntegrations ? (
              <div className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-black text-amber-800">
                    {formatUsd(side.totalSpendUsd)}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-bold">
                    Workspace Total (Includes Unrelated Integrations)
                  </span>
                </div>
                <p className="text-[11px] text-amber-800">
                  Per-key spend is unavailable because this workspace also serves
                  other API keys.
                </p>
              </div>
            ) : (
              <div className="py-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-50 border border-purple-200 text-purple-900 text-xs font-bold">
                  <AlertTriangle className="w-3.5 h-3.5 text-purple-700 shrink-0" />
                  <span>Per-Key Spend Unavailable</span>
                </span>
              </div>
            )}

            <p className="text-[11px] text-slate-600 leading-relaxed">
              {side.spendStatusMessage}
            </p>
          </div>

          {/* Token Metrics Grid (Input, Output, Cache-Read, Cache-Write) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">
                Token Consumption (Anthropic usage_report/messages)
              </span>
              <span className="text-[11px] text-slate-500">
                Total:{" "}
                <strong className="text-slate-900">
                  {formatInt(side.tokens.totalTokens)}
                </strong>
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Uncached Input
                </span>
                <span className="text-sm font-extrabold text-slate-900 font-mono">
                  {formatInt(side.tokens.inputTokens)}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Output Tokens
                </span>
                <span className="text-sm font-extrabold text-slate-900 font-mono">
                  {formatInt(side.tokens.outputTokens)}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-emerald-50/50 border border-emerald-200/80">
                <span className="text-[10px] font-bold uppercase text-emerald-700 block">
                  Cache Read
                </span>
                <span className="text-sm font-extrabold text-emerald-900 font-mono">
                  {formatInt(side.tokens.cacheReadTokens)}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-sky-50/50 border border-sky-200/80">
                <span className="text-[10px] font-bold uppercase text-sky-700 block">
                  Cache Write
                </span>
                <span className="text-sm font-extrabold text-sky-900 font-mono">
                  {formatInt(side.tokens.cacheWriteTokens)}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">{side.usageStatusMessage}</p>
          </div>

          {/* Breakdown by API Key & Model */}
          <div className="space-y-1.5">
            <h3 className="text-xs font-bold text-slate-800">
              Tokens by API Key &amp; Model
            </h3>
            {side.byKeyAndModel.length === 0 ? (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500">
                {side.usageStatus === "ZERO_USAGE"
                  ? "0 token rows returned for this API key in the selected UTC range."
                  : "No attributed API key + model rows available."}
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                      <th className="py-2 px-2.5">API Key ID</th>
                      <th className="py-2 px-2.5">Model</th>
                      <th className="py-2 px-2.5 text-right">Input</th>
                      <th className="py-2 px-2.5 text-right">Output</th>
                      <th className="py-2 px-2.5 text-right">Cache Read</th>
                      <th className="py-2 px-2.5 text-right">Cache Write</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                    {side.byKeyAndModel.map((row) => (
                      <tr key={`${row.apiKeyId}-${row.model}`}>
                        <td className="py-1.5 px-2.5 text-slate-800">
                          {row.apiKeyId}
                        </td>
                        <td className="py-1.5 px-2.5 text-indigo-700 font-semibold">
                          {row.model}
                        </td>
                        <td className="py-1.5 px-2.5 text-right">
                          {formatInt(row.inputTokens)}
                        </td>
                        <td className="py-1.5 px-2.5 text-right">
                          {formatInt(row.outputTokens)}
                        </td>
                        <td className="py-1.5 px-2.5 text-right text-emerald-700">
                          {formatInt(row.cacheReadTokens)}
                        </td>
                        <td className="py-1.5 px-2.5 text-right text-sky-700">
                          {formatInt(row.cacheWriteTokens)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Daily Spend Breakdown (when workspace spend is attributed to this integration) */}
          {side.dailySpend.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-bold text-slate-800">
                Daily Spend Breakdown (UTC) — {side.spendLabel}
              </h3>
              <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-56 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                      <th className="py-2 px-2.5">Date (UTC)</th>
                      <th className="py-2 px-2.5 text-right">USD Cents</th>
                      <th className="py-2 px-2.5 text-right">Spend (USD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                    {side.dailySpend.map((d) => (
                      <tr key={d.dateUtc}>
                        <td className="py-1.5 px-2.5 text-slate-800">
                          {d.dateUtc}
                        </td>
                        <td className="py-1.5 px-2.5 text-right text-slate-600">
                          {d.amountCents.toFixed(2)}¢
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-bold text-slate-900">
                          {formatUsd(d.spendUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      {/* Top Header & Reporting Period Bar */}
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

        {/* Date Preset Selector & Refresh */}
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
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            <span>{refreshing ? "Refreshing..." : "Refresh Live"}</span>
          </button>
        </div>
      </div>

      {/* Custom Date Range Picker */}
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

      {/* Reporting Time Zone, Window & Last Successful Refresh Metadata Bar */}
      {report && (
        <div className="bg-slate-900 text-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Window:{" "}
                <strong className="font-mono text-white">
                  {report.startingAtUtc}
                </strong>{" "}
                →{" "}
                <strong className="font-mono text-white">
                  {report.endingAtUtc}
                </strong>
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

      {/* Overall Status & Configuration Banner when Admin Key or Workspace/Key IDs are missing */}
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
                Status: {statusBadgeMeta(report.overallStatus).label} —{" "}
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

      {/* Optional Attribution Config Drawer */}
      {showConfigDrawer && (
        <form
          onSubmit={handleSaveAttributionConfig}
          className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xs space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-indigo-600" />
                <span>
                  Anthropic Admin API &amp; Workspace / API Key Attribution Settings
                </span>
              </h2>
              <p className="text-[11px] text-slate-500">
                Stored server-side only in <code>core_auth.db</code> (or set via{" "}
                <code>.env</code>). Used exclusively for{" "}
                <code>/v1/organizations/usage_report/messages</code> and{" "}
                <code>/v1/organizations/cost_report</code>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowConfigDrawer(false)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="md:col-span-3">
              <label className="block font-bold text-slate-700 mb-1">
                Anthropic Organization Admin API Key (<code>ANTHROPIC_ORG_ADMIN_API_KEY</code>)
              </label>
              <input
                type="password"
                value={sharedAdminKeyDraft}
                onChange={(e) => setSharedAdminKeyDraft(e.target.value)}
                placeholder="sk-ant-admin01-... (Leave blank to keep existing key)"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Acrio Workspace ID (<code>ACRIO_ANTHROPIC_WORKSPACE_ID</code>)
              </label>
              <input
                type="text"
                value={acrioWorkspaceDraft}
                onChange={(e) => setAcrioWorkspaceDraft(e.target.value)}
                placeholder="wrkspc_01..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Acrio API Key ID (<code>ACRIO_ANTHROPIC_API_KEY_ID</code>)
              </label>
              <input
                type="text"
                value={acrioKeyIdDraft}
                onChange={(e) => setAcrioKeyIdDraft(e.target.value)}
                placeholder="apikey_01..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs text-slate-900"
              />
            </div>

            <div className="flex items-center pt-5">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acrioSharedOthersDraft}
                  onChange={(e) => setAcrioSharedOthersDraft(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span className="text-slate-700 font-medium">
                  Acrio workspace also serves unrelated integrations
                </span>
              </label>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Acro Workspace ID (<code>ACRO_ANTHROPIC_WORKSPACE_ID</code>)
              </label>
              <input
                type="text"
                value={acroWorkspaceDraft}
                onChange={(e) => setAcroWorkspaceDraft(e.target.value)}
                placeholder="wrkspc_01..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Acro API Key ID (<code>ACRO_ANTHROPIC_API_KEY_ID</code>)
              </label>
              <input
                type="text"
                value={acroKeyIdDraft}
                onChange={(e) => setAcroKeyIdDraft(e.target.value)}
                placeholder="apikey_01..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs text-slate-900"
              />
            </div>

            <div className="flex items-center pt-5">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acroSharedOthersDraft}
                  onChange={(e) => setAcroSharedOthersDraft(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span className="text-slate-700 font-medium">
                  Acro workspace also serves unrelated integrations
                </span>
              </label>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingConfig}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>
                {savingConfig
                  ? "Saving & Fetching..."
                  : "Save Attribution Config & Refresh"}
              </span>
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-4">
          <StatCardsSkeleton count={4} />
          <CardListSkeleton items={2} />
        </div>
      ) : report ? (
        <>
          {/* Top Summary Stat Cards */}
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

          {/* Shared Workspace Combined Spend Section (when both integrations share a workspace) */}
          {report.sharedWorkspaceSpend && (
            <div className="bg-white border-2 border-purple-200 rounded-xl p-4 sm:p-5 shadow-2xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-900 text-[10px] font-extrabold uppercase tracking-wider">
                    Shared Workspace Spend
                  </span>
                  <h2 className="text-base font-extrabold text-slate-900 mt-1">
                    {report.sharedWorkspaceSpend.spendLabel}
                  </h2>
                  <p className="text-xs text-slate-600">
                    Both Acrio and Acro share workspace{" "}
                    <code className="font-mono font-bold">
                      {report.sharedWorkspaceSpend.workspaceId}
                    </code>
                    . Token usage is separated by API key ID below, while spend is
                    reported at the workspace level.
                  </p>
                </div>

                <div className="text-right">
                  <div className="text-2xl sm:text-3xl font-black text-purple-900">
                    {formatUsd(report.sharedWorkspaceSpend.totalSpendUsd)}
                  </div>
                  <div className="text-xs font-mono text-slate-500">
                    ({report.sharedWorkspaceSpend.totalSpendCents.toFixed(2)}¢ USD
                    cents)
                  </div>
                </div>
              </div>

              {report.sharedWorkspaceSpend.dailySpend.length > 0 && (
                <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-56 overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                        <th className="py-2 px-3">Date (UTC)</th>
                        <th className="py-2 px-3 text-right">USD Cents</th>
                        <th className="py-2 px-3 text-right">
                          Shared Workspace Spend (USD)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                      {report.sharedWorkspaceSpend.dailySpend.map((d) => (
                        <tr key={d.dateUtc}>
                          <td className="py-1.5 px-3 text-slate-800">
                            {d.dateUtc}
                          </td>
                          <td className="py-1.5 px-3 text-right text-slate-600">
                            {d.amountCents.toFixed(2)}¢
                          </td>
                          <td className="py-1.5 px-3 text-right font-bold text-slate-900">
                            {formatUsd(d.spendUsd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Side-by-Side Comparison Grid: Acrio (Left) vs Acro (Right) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {renderIntegrationCard(report.acrio)}
            {renderIntegrationCard(report.acro)}
          </div>
        </>
      ) : null}
    </div>
  );
}
