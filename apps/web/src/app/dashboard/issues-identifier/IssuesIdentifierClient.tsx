"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Info,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Wrench,
} from "lucide-react";

type EcosystemIssueSeverity = "CRITICAL" | "WARNING" | "INFO";
type EcosystemIssueCategory =
  | "SHORTLINKS_AND_CROSS_SITE"
  | "PRODUCT_MEDIA_AND_R2"
  | "PRICING_AND_SPECS"
  | "AI_LOGS_AND_BRIDGES"
  | "TEMPLATES_AND_CONTENT";
type EcosystemSiteKey =
  | "CLASSIC_CONCEPTS"
  | "CLASSIC_EDGE_53"
  | "WHATSAPP_HUB"
  | "SHORTLINK_ROUTER";

interface EcosystemDetectedIssue {
  id: string;
  severity: EcosystemIssueSeverity;
  category: EcosystemIssueCategory;
  site: EcosystemSiteKey;
  title: string;
  detail: string;
  affectedEntity: string;
  skuOrCode?: string | null;
  sourceUrl?: string | null;
  targetUrl?: string | null;
  adminEditUrl?: string | null;
  autoFixAction?: "SYNC_SHORTLINKS" | "REFRESH_CATALOG_CACHE" | null;
  suggestion: string;
}

interface EcosystemSiteHealthSummary {
  site: EcosystemSiteKey;
  label: string;
  publicDomain: string;
  online: boolean;
  totalItemsScanned: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  statusNote: string;
}

interface EcosystemIssuesAuditReport {
  scannedAtIso: string;
  scannedAtIst: string;
  durationMs: number;
  healthScore: number;
  totals: {
    totalIssues: number;
    critical: number;
    warning: number;
    info: number;
    classicConceptsProducts: number;
    classicEdgeItems: number;
    shortLinksCount: number;
    templatesCount: number;
    recentAiLogsScanned: number;
  };
  siteSummaries: EcosystemSiteHealthSummary[];
  issues: EcosystemDetectedIssue[];
  acrioAnalysis?: string | null;
  acrioModel?: string | null;
}

const QUICK_DIAGNOSTIC_PROMPTS = [
  "Identify all broken or missing shortlinks and cross-site link discrepancies between classicconcepts.in, classicedge.in, and ccapl.cc",
  "List all products and colour variants missing R2 photos or sharing duplicate variant images",
  "Audit all Acrylic Podiums for missing Height/Top dimensions, missing sub-categories, or pricing discrepancies",
  "Review recent ai.logs zero-match customer queries and suggest catalog keywords or synonyms to add",
];

function severityBadgeStyle(sev: EcosystemIssueSeverity): string {
  switch (sev) {
    case "CRITICAL":
      return "bg-red-50 text-red-700 border-red-200";
    case "WARNING":
      return "bg-amber-50 text-amber-800 border-amber-200";
    default:
      return "bg-sky-50 text-sky-800 border-sky-200";
  }
}

function siteBadgeStyle(site: EcosystemSiteKey): string {
  switch (site) {
    case "CLASSIC_CONCEPTS":
      return "bg-blue-50 text-blue-800 border-blue-200";
    case "CLASSIC_EDGE_53":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "SHORTLINK_ROUTER":
      return "bg-purple-50 text-purple-800 border-purple-200";
    default:
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
  }
}

function categoryLabel(cat: EcosystemIssueCategory): string {
  switch (cat) {
    case "SHORTLINKS_AND_CROSS_SITE":
      return "Links & Cross-Site";
    case "PRODUCT_MEDIA_AND_R2":
      return "Media & R2 Storage";
    case "PRICING_AND_SPECS":
      return "Pricing, SKUs & Specs";
    case "AI_LOGS_AND_BRIDGES":
      return "AI Logs & Bridges";
    case "TEMPLATES_AND_CONTENT":
      return "Templates & Content";
    default:
      return cat;
  }
}

export function IssuesIdentifierClient({
  initialData,
  initialError,
}: {
  initialData?: EcosystemIssuesAuditReport | null;
  initialError?: string;
}) {
  const [report, setReport] = useState<EcosystemIssuesAuditReport | null>(
    initialData ?? null
  );
  const [loading, setLoading] = useState(!initialData && !initialError);
  const [scanning, setScanning] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [askingAcrio, setAskingAcrio] = useState(false);
  const [acrioPrompt, setAcrioPrompt] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState(initialError || "");

  // Filters
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [siteFilter, setSiteFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const runAudit = useCallback(async (forceFresh = false) => {
    setScanning(true);
    setErrorMsg("");
    try {
      const res = await fetch(
        `/api/dev/issues-identifier${forceFresh ? "?fresh=1" : ""}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Could not run Issues Identifier scan.");
        return;
      }
      setReport(data.report);
    } catch {
      setErrorMsg("Network error while scanning ecosystem.");
    } finally {
      setLoading(false);
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    if (!initialData && !initialError) {
      void runAudit(false);
    }
  }, [initialData, initialError, runAudit]);

  const handleAutoFix = async (
    fixType: "SYNC_SHORTLINKS" | "REFRESH_CATALOG_CACHE"
  ) => {
    setFixing(fixType);
    setStatusMessage("");
    setErrorMsg("");
    try {
      const res = await fetch("/api/dev/issues-identifier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auto_fix", fixType }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Auto-fix failed.");
        return;
      }
      if (data.report) setReport(data.report);
      setStatusMessage(data.message || "Auto-fix completed.");
      setTimeout(() => setStatusMessage(""), 6000);
    } catch {
      setErrorMsg("Network error while running auto-fix.");
    } finally {
      setFixing(null);
    }
  };

  const handleAskAcrio = async (promptText?: string) => {
    const q = (promptText ?? acrioPrompt).trim();
    if (!q) return;
    if (promptText) setAcrioPrompt(promptText);
    setAskingAcrio(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/dev/issues-identifier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ask_acrio", prompt: q }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "ACRIO analysis failed.");
        return;
      }
      if (data.report) setReport(data.report);
    } catch {
      setErrorMsg("Network error while asking ACRIO.");
    } finally {
      setAskingAcrio(false);
    }
  };

  const handleExportJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `acrio-ecosystem-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredIssues = useMemo(() => {
    if (!report) return [];
    const q = searchQuery.trim().toLowerCase();
    return report.issues.filter((iss) => {
      if (severityFilter !== "ALL" && iss.severity !== severityFilter) {
        return false;
      }
      if (siteFilter !== "ALL" && iss.site !== siteFilter) {
        return false;
      }
      if (categoryFilter !== "ALL" && iss.category !== categoryFilter) {
        return false;
      }
      if (q) {
        const hay = `${iss.title} ${iss.detail} ${iss.affectedEntity} ${iss.skuOrCode || ""} ${iss.sourceUrl || ""} ${iss.targetUrl || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [report, severityFilter, siteFilter, categoryFilter, searchQuery]);

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      {/* Header & Action Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider">
              DEV MODE
            </span>
            <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-indigo-600" />
              <span>ACRIO Ecosystem Issues Identifier</span>
            </h1>
          </div>
          <p className="text-xs text-slate-500">
            Cross-site link auditor, R2 media &amp; variant photo verifier, pricing/spec discrepancy scanner, and live AI diagnostic console across{" "}
            <span className="font-mono font-semibold text-slate-700">classicconcepts.in</span>,{" "}
            <span className="font-mono font-semibold text-slate-700">classicedge.in</span>,{" "}
            <span className="font-mono font-semibold text-slate-700">ccapl.cc</span>, and{" "}
            <span className="font-mono font-semibold text-slate-700">chat.ccapl.cc</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={scanning}
            onClick={() => void runAudit(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-2xs disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? "animate-spin" : ""}`} />
            <span>{scanning ? "Scanning Ecosystem..." : "Run Fresh Deep Scan"}</span>
          </button>

          <button
            type="button"
            disabled={Boolean(fixing)}
            onClick={() => void handleAutoFix("SYNC_SHORTLINKS")}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-2xs disabled:opacity-50 cursor-pointer"
          >
            {fixing === "SYNC_SHORTLINKS" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wrench className="w-3.5 h-3.5" />
            )}
            <span>Auto-Fix &amp; Sync Shortlinks</span>
          </button>

          <button
            type="button"
            disabled={Boolean(fixing)}
            onClick={() => void handleAutoFix("REFRESH_CATALOG_CACHE")}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold cursor-pointer"
          >
            {fixing === "REFRESH_CATALOG_CACHE" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>Flush &amp; Reload Caches</span>
          </button>

          {report && (
            <button
              type="button"
              onClick={handleExportJson}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>
          )}
        </div>
      </div>

      {statusMessage && (
        <div className="px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMsg && (
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Site-by-Site Health Cards */}
      {report && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3.5">
          {/* Overall Health Score Card */}
          <div className="bg-slate-900 text-white rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Ecosystem Health
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {report.durationMs}ms
              </span>
            </div>
            <div className="my-2 flex items-baseline gap-2">
              <span
                className={`text-3xl font-black ${
                  report.healthScore >= 85
                    ? "text-emerald-400"
                    : report.healthScore >= 65
                    ? "text-amber-300"
                    : "text-red-400"
                }`}
              >
                {report.healthScore}%
              </span>
              <span className="text-xs text-slate-300">
                ({report.totals.totalIssues} total findings)
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 font-bold">
                {report.totals.critical} Critical
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 font-bold">
                {report.totals.warning} Warn
              </span>
              <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-200 font-bold">
                {report.totals.info} Info
              </span>
            </div>
          </div>

          {report.siteSummaries.map((s) => (
            <button
              key={s.site}
              type="button"
              onClick={() =>
                setSiteFilter((prev) => (prev === s.site ? "ALL" : s.site))
              }
              className={`text-left bg-white rounded-xl p-4 border transition-all cursor-pointer ${
                siteFilter === s.site
                  ? "border-indigo-600 ring-2 ring-indigo-600/15"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] font-bold text-indigo-600">
                  {s.publicDomain}
                </span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    s.criticalCount > 0
                      ? "bg-red-500"
                      : s.warningCount > 0
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                  }`}
                />
              </div>
              <div className="font-bold text-sm text-slate-900 mt-1 truncate">
                {s.label}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Scanned: <strong className="text-slate-700">{s.totalItemsScanned}</strong> records
              </div>
              <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold">
                {s.criticalCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                    {s.criticalCount} Crit
                  </span>
                )}
                {s.warningCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                    {s.warningCount} Warn
                  </span>
                )}
                {s.infoCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    {s.infoCount} Info
                  </span>
                )}
                {s.criticalCount === 0 && s.warningCount === 0 && s.infoCount === 0 && (
                  <span className="text-emerald-700">All clear</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Ask ACRIO Interactive Diagnostic Console */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xs space-y-3.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900">
              Run ACRIO Deep Diagnostic Analysis (claude-haiku-5-5)
            </h2>
          </div>
          <span className="text-[11px] text-slate-400">
            ACRIO inspects all live findings, shortlinks, R2 media, and catalog specs
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {QUICK_DIAGNOSTIC_PROMPTS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={askingAcrio}
              onClick={() => void handleAskAcrio(preset)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 text-xs font-medium transition-colors text-left cursor-pointer"
            >
              {preset}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleAskAcrio();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={acrioPrompt}
            onChange={(e) => setAcrioPrompt(e.target.value)}
            placeholder="Ask ACRIO to inspect specific discrepancies, broken links, missing variant photos, or SKU conflicts..."
            className="flex-1 px-3.5 py-2 rounded-lg border border-slate-300 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={askingAcrio || !acrioPrompt.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-bold disabled:opacity-50 shrink-0 cursor-pointer"
          >
            {askingAcrio ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>{askingAcrio ? "Analyzing..." : "Analyze with ACRIO"}</span>
          </button>
        </form>

        {report?.acrioAnalysis && (
          <div className="p-3.5 sm:p-4 rounded-xl bg-slate-900 text-slate-100 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] border border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-800 text-[11px] text-indigo-300 font-bold uppercase tracking-wider">
              <span>ACRIO Ecosystem Diagnostic Report</span>
              <span>Model: {report.acrioModel || "claude-haiku-5-5"}</span>
            </div>
            {report.acrioAnalysis}
          </div>
        )}
      </div>

      {/* Filter Bar & Issues Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
          <div className="flex flex-wrap items-center gap-2">
            {/* Severity Filter Pills */}
            {(["ALL", "CRITICAL", "WARNING", "INFO"] as const).map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() => setSeverityFilter(sev)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                  severityFilter === sev
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                }`}
              >
                {sev === "ALL" ? "All Severities" : sev}
              </button>
            ))}

            {/* Category Dropdown */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
            >
              <option value="ALL">All Categories</option>
              <option value="SHORTLINKS_AND_CROSS_SITE">Links &amp; Cross-Site</option>
              <option value="PRODUCT_MEDIA_AND_R2">Media &amp; R2 Storage</option>
              <option value="PRICING_AND_SPECS">Pricing, SKUs &amp; Specs</option>
              <option value="AI_LOGS_AND_BRIDGES">AI Logs &amp; Bridges</option>
              <option value="TEMPLATES_AND_CONTENT">Templates &amp; Content</option>
            </select>

            {/* Site Dropdown */}
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
            >
              <option value="ALL">All Sites</option>
              <option value="CLASSIC_CONCEPTS">classicconcepts.in</option>
              <option value="CLASSIC_EDGE_53">classicedge.in</option>
              <option value="SHORTLINK_ROUTER">ccapl.cc Shortlinks</option>
              <option value="WHATSAPP_HUB">chat.ccapl.cc Hub</option>
            </select>
          </div>

          <div className="relative min-w-0 w-full sm:min-w-[240px] sm:flex-1 sm:max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by SKU, product name, slug, or URL..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            <span>Scanning Classic Concepts, Classic Edge 53, ccapl.cc shortlinks, and R2 media...</span>
          </div>
        ) : filteredIssues.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
            <div className="text-sm font-bold text-slate-800">
              No matching issues or discrepancies found
            </div>
            <p className="text-xs text-slate-500">
              All filtered checks passed across the ecosystem.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredIssues.map((iss) => (
              <div
                key={iss.id}
                className="p-4 hover:bg-slate-50/80 transition-colors flex flex-col lg:flex-row lg:items-start justify-between gap-3"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${severityBadgeStyle(
                        iss.severity
                      )}`}
                    >
                      {iss.severity}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${siteBadgeStyle(
                        iss.site
                      )}`}
                    >
                      {iss.site}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                      {categoryLabel(iss.category)}
                    </span>
                    {iss.skuOrCode && (
                      <span className="font-mono text-[11px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                        {iss.skuOrCode}
                      </span>
                    )}
                  </div>

                  <div className="text-sm font-bold text-slate-900">
                    {iss.title}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed break-words">
                    {iss.detail}
                  </p>
                  <div className="text-[11px] text-indigo-700 font-medium flex items-center gap-1">
                    <Info className="w-3.5 h-3.5 shrink-0" />
                    <span>Recommended Fix: {iss.suggestion}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {iss.sourceUrl && (
                    <a
                      href={iss.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Open Page</span>
                    </a>
                  )}
                  {iss.adminEditUrl && (
                    <a
                      href={iss.adminEditUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Edit in Admin</span>
                    </a>
                  )}
                  {iss.targetUrl && (
                    <a
                      href={iss.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-mono"
                    >
                      <Link2 className="w-3 h-3" />
                      <span>Target Link</span>
                    </a>
                  )}
                  {iss.autoFixAction && (
                    <button
                      type="button"
                      disabled={Boolean(fixing)}
                      onClick={() => void handleAutoFix(iss.autoFixAction!)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                    >
                      <Wrench className="w-3 h-3" />
                      <span>Auto-Fix</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
