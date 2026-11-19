"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import type { EcosystemIssuesAuditReport } from "./issues-types";
import { IssuesSiteHealthCards } from "./IssuesSiteHealthCards";
import { IssuesAcrioConsole } from "./IssuesAcrioConsole";
import { IssuesFindingsList } from "./IssuesFindingsList";

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
        const hay =
          `${iss.title} ${iss.detail} ${iss.affectedEntity} ${iss.skuOrCode || ""} ${iss.sourceUrl || ""} ${iss.targetUrl || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [report, severityFilter, siteFilter, categoryFilter, searchQuery]);

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
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
            Cross-site link auditor, R2 media &amp; variant photo verifier,
            pricing/spec discrepancy scanner, and live AI diagnostic console
            across{" "}
            <span className="font-mono font-semibold text-slate-700">
              classicconcepts.in
            </span>
            ,{" "}
            <span className="font-mono font-semibold text-slate-700">
              classicedge.in
            </span>
            ,{" "}
            <span className="font-mono font-semibold text-slate-700">
              ccapl.cc
            </span>
            , and{" "}
            <span className="font-mono font-semibold text-slate-700">
              chat.ccapl.cc
            </span>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={scanning}
            onClick={() => void runAudit(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-2xs disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${scanning ? "animate-spin" : ""}`}
            />
            <span>
              {scanning ? "Scanning Ecosystem..." : "Run Fresh Deep Scan"}
            </span>
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

      {report && (
        <IssuesSiteHealthCards
          report={report}
          siteFilter={siteFilter}
          onToggleSite={(site) =>
            setSiteFilter((prev) => (prev === site ? "ALL" : site))
          }
        />
      )}

      <IssuesAcrioConsole
        acrioPrompt={acrioPrompt}
        setAcrioPrompt={setAcrioPrompt}
        askingAcrio={askingAcrio}
        report={report}
        onAskAcrio={(p) => void handleAskAcrio(p)}
      />

      <IssuesFindingsList
        severityFilter={severityFilter}
        setSeverityFilter={setSeverityFilter}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        siteFilter={siteFilter}
        setSiteFilter={setSiteFilter}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        loading={loading}
        filteredIssues={filteredIssues}
        fixing={fixing}
        onAutoFix={(f) => void handleAutoFix(f)}
      />
    </div>
  );
}
