"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  FileCode,
  HardDrive,
  IndianRupee,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  CardListSkeleton,
  ElementErrorState,
  StatCardsSkeleton,
  TableRowsSkeleton,
} from "@cc/ui";
import type {
  BackupLog,
  DbDiag,
  DevAnalyticsSlice,
  DevClientInitialData,
  DevPricingPayload,
  StaffMemberRecord,
} from "./dev-types";

const DevProfitTab = dynamic(() => import("./DevProfitTab"), {
  loading: () => <StatCardsSkeleton count={4} />,
});

const DevAccountsTab = dynamic(() => import("./DevAccountsTab"), {
  loading: () => <TableRowsSkeleton rows={4} cols={4} />,
});

const DevBackupsTab = dynamic(() => import("./DevBackupsTab"), {
  loading: () => <CardListSkeleton rows={4} />,
});

export function DevClient({
  initialData,
}: {
  initialData?: DevClientInitialData;
}) {
  const [activeTab, setActiveTab] = useState<"profit" | "devs" | "backups">(
    "profit"
  );
  const [range, setRange] = useState<string>("30d");

  const [pricing, setPricing] = useState<DevPricingPayload | null>(
    initialData?.pricing ?? null
  );
  const [analytics, setAnalytics] = useState<DevAnalyticsSlice | null>(
    initialData?.analytics ?? null
  );
  const [devAccounts, setDevAccounts] = useState<StaffMemberRecord[]>(
    initialData?.devAccounts ?? []
  );
  const [databases, setDatabases] = useState<DbDiag[]>(
    initialData?.databases ?? []
  );
  const [backupLogs, setBackupLogs] = useState<BackupLog[]>(
    initialData?.backupLogs ?? []
  );

  // DEV rate editor state
  const [clientMkt, setClientMkt] = useState<string>(
    String(initialData?.pricing?.rates?.marketingRateInr ?? 0.95)
  );
  const [clientOther, setClientOther] = useState<string>(
    String(initialData?.pricing?.rates?.otherMessagesRateInr ?? 0.3)
  );
  const [metaMkt, setMetaMkt] = useState<string>(
    String(initialData?.pricing?.rates?.actualMetaMarketingRateInr ?? 0.8631)
  );
  const [metaUtil, setMetaUtil] = useState<string>(
    String(initialData?.pricing?.rates?.actualMetaUtilityRateInr ?? 0.115)
  );
  const [metaAuth, setMetaAuth] = useState<string>(
    String(initialData?.pricing?.rates?.actualMetaAuthRateInr ?? 0.115)
  );
  const [metaServ, setMetaServ] = useState<string>(
    String(initialData?.pricing?.rates?.actualMetaServiceRateInr ?? 0.0)
  );
  const [gstRatePct, setGstRatePct] = useState<string>(
    String(initialData?.pricing?.rates?.gstRatePct ?? 18)
  );
  const [usdToInrRate, setUsdToInrRate] = useState<string>(
    String(initialData?.pricing?.rates?.usdToInrRate ?? 93.4)
  );
  const [savingRates, setSavingRates] = useState<boolean>(false);

  // Create another DEV form state
  const [newDevName, setNewDevName] = useState<string>("");
  const [newDevEmail, setNewDevEmail] = useState<string>("");
  const [newDevPhone, setNewDevPhone] = useState<string>("");
  const [newDevPassword, setNewDevPassword] = useState<string>("");
  const [creatingDev, setCreatingDev] = useState<boolean>(false);
  const [devFormError, setDevFormError] = useState<string>("");

  // Backup settings form
  const [enabled, setEnabled] = useState<boolean>(
    initialData?.backupConfig ? Boolean(initialData.backupConfig.enabled) : true
  );
  const [midnightHourIst, setMidnightHourIst] = useState<number>(
    Number(initialData?.backupConfig?.midnightHourIst ?? 0)
  );
  const [midnightMinuteIst, setMidnightMinuteIst] = useState<number>(
    Number(initialData?.backupConfig?.midnightMinuteIst ?? 0)
  );
  const [googleDriveFolderId, setGoogleDriveFolderId] = useState<string>(
    initialData?.backupConfig?.googleDriveFolderId || ""
  );
  const [googleServiceAccountEmail, setGoogleServiceAccountEmail] =
    useState<string>(
      initialData?.backupConfig?.googleServiceAccountEmail || ""
    );
  const [googlePrivateKey, setGooglePrivateKey] = useState<string>("");
  const [hasPrivateKey, setHasPrivateKey] = useState<boolean>(
    Boolean(initialData?.backupConfig?.hasPrivateKey)
  );
  const [googleClientId, setGoogleClientId] = useState<string>(
    initialData?.backupConfig?.googleClientId || ""
  );
  const [googleClientSecret, setGoogleClientSecret] = useState<string>("");
  const [googleOauthRefreshToken, setGoogleOauthRefreshToken] =
    useState<string>("");
  const [hasOauthRefreshToken, setHasOauthRefreshToken] = useState<boolean>(
    Boolean(initialData?.backupConfig?.hasOauthRefreshToken)
  );
  const [retentionDays, setRetentionDays] = useState<number>(
    Number(initialData?.backupConfig?.retentionDays ?? 30)
  );
  const [includeMainWebsiteDb, setIncludeMainWebsiteDb] = useState<boolean>(
    initialData?.backupConfig
      ? Boolean(initialData.backupConfig.includeMainWebsiteDb)
      : true
  );

  const [savingBackup, setSavingBackup] = useState<boolean>(false);
  const [runningBackup, setRunningBackup] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");
  const skippedInitialFetchRef = useRef<boolean>(Boolean(initialData));

  const loadAllDevData = useCallback(
    async (selectedRange = range) => {
      setRefreshing(true);
      setLoadError("");
      try {
        const [priceRes, anaRes, staffRes, bkpRes] = await Promise.all([
          fetch("/api/pricing?scope=dev", { cache: "no-store" }),
          fetch(
            `/api/analytics?scope=dev&range=${encodeURIComponent(selectedRange)}`,
            { cache: "no-store" }
          ),
          fetch("/api/staff", { cache: "no-store" }),
          fetch("/api/dev/backups", { cache: "no-store" }),
        ]);

        const [priceJson, anaJson, staffJson, bkpJson] = await Promise.all([
          priceRes.json().catch(() => ({})),
          anaRes.json().catch(() => ({})),
          staffRes.json().catch(() => ({})),
          bkpRes.json().catch(() => ({})),
        ]);

        if (!priceRes.ok || !priceJson.ok) {
          setLoadError(
            priceJson.error ||
              "Dev access is required to view profit, Meta costs, and operations."
          );
          return;
        }

        setPricing(priceJson);
        setClientMkt(String(priceJson.rates.marketingRateInr ?? 0.95));
        setClientOther(String(priceJson.rates.otherMessagesRateInr ?? 0.3));
        setMetaMkt(String(priceJson.rates.actualMetaMarketingRateInr ?? 0.8631));
        setMetaUtil(String(priceJson.rates.actualMetaUtilityRateInr ?? 0.115));
        setMetaAuth(String(priceJson.rates.actualMetaAuthRateInr ?? 0.115));
        setMetaServ(String(priceJson.rates.actualMetaServiceRateInr ?? 0.0));
        setGstRatePct(String(priceJson.rates.gstRatePct ?? 18));
        setUsdToInrRate(String(priceJson.rates.usdToInrRate ?? 93.4));

        if (anaRes.ok && anaJson.ok) setAnalytics(anaJson);
        if (staffRes.ok && staffJson.ok) {
          setDevAccounts(
            (staffJson.staff || []).filter(
              (s: StaffMemberRecord) => s.role === "DEV"
            )
          );
        }
        if (bkpRes.ok && bkpJson.ok) {
          setDatabases(bkpJson.databases || []);
          setBackupLogs(bkpJson.backupLogs || []);
          if (bkpJson.backupConfig) {
            setEnabled(Boolean(bkpJson.backupConfig.enabled));
            setMidnightHourIst(Number(bkpJson.backupConfig.midnightHourIst ?? 0));
            setMidnightMinuteIst(Number(bkpJson.backupConfig.midnightMinuteIst ?? 0));
            setGoogleDriveFolderId(bkpJson.backupConfig.googleDriveFolderId || "");
            setGoogleServiceAccountEmail(bkpJson.backupConfig.googleServiceAccountEmail || "");
            setHasPrivateKey(Boolean(bkpJson.backupConfig.hasPrivateKey));
            setGoogleClientId(bkpJson.backupConfig.googleClientId || "");
            setHasOauthRefreshToken(Boolean(bkpJson.backupConfig.hasOauthRefreshToken));
            setRetentionDays(Number(bkpJson.backupConfig.retentionDays ?? 30));
            setIncludeMainWebsiteDb(Boolean(bkpJson.backupConfig.includeMainWebsiteDb));
          }
        }
      } catch {
        setLoadError(
          "Network error while loading Dev profit & ops dashboard. Click Refresh."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [range]
  );

  useEffect(() => {
    if (skippedInitialFetchRef.current) {
      skippedInitialFetchRef.current = false;
      return;
    }
    void loadAllDevData(range);
  }, [loadAllDevData, range]);

  async function handleSaveDevRates(e: React.FormEvent) {
    e.preventDefault();
    setSavingRates(true);
    try {
      const res = await fetch("/api/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientMarketingRateInr: Number(clientMkt),
          clientOtherRateInr: Number(clientOther),
          actualMetaMarketingRateInr: Number(metaMkt),
          actualMetaUtilityRateInr: Number(metaUtil),
          actualMetaAuthRateInr: Number(metaAuth),
          actualMetaServiceRateInr: Number(metaServ),
          gstRatePct: Number(gstRatePct),
          usdToInrRate: Number(usdToInrRate),
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (out.ok) {
        setStatusBanner("Updated client rates and actual Meta wholesale costs.");
        setTimeout(() => setStatusBanner(""), 4000);
        await loadAllDevData(range);
      }
    } finally {
      setSavingRates(false);
    }
  }

  async function handleCreateDevAccount(e: React.FormEvent) {
    e.preventDefault();
    setDevFormError("");
    setCreatingDev(true);
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_dev",
          name: newDevName,
          email: newDevEmail,
          whatsappNumber: newDevPhone,
          password: newDevPassword,
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) {
        setDevFormError(out.error || "Could not create Dev account.");
        return;
      }
      setNewDevName("");
      setNewDevEmail("");
      setNewDevPhone("");
      setNewDevPassword("");
      setStatusBanner(`Created active DEV account for ${out.created?.name || newDevEmail}.`);
      setTimeout(() => setStatusBanner(""), 4500);
      await loadAllDevData(range);
    } finally {
      setCreatingDev(false);
    }
  }

  async function handleSaveBackupConfig(e: React.FormEvent) {
    e.preventDefault();
    setSavingBackup(true);
    try {
      const res = await fetch("/api/dev/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_config",
          enabled,
          midnightHourIst,
          midnightMinuteIst,
          googleDriveFolderId,
          googleServiceAccountEmail,
          googlePrivateKey,
          googleClientId,
          googleClientSecret,
          googleOauthRefreshToken,
          retentionDays,
          includeMainWebsiteDb,
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (out.ok) {
        setGooglePrivateKey("");
        setGoogleClientSecret("");
        setGoogleOauthRefreshToken("");
        setStatusBanner("Saved midnight Google Drive backup settings.");
        setTimeout(() => setStatusBanner(""), 4000);
        await loadAllDevData(range);
      }
    } finally {
      setSavingBackup(false);
    }
  }

  async function handleRunBackupNow() {
    setRunningBackup(true);
    setStatusBanner("Backing up databases now...");
    try {
      const res = await fetch("/api/dev/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_now" }),
      });
      const out = await res.json().catch(() => ({}));
      if (out.result) {
        setStatusBanner(out.result.detailsMessage || "Backup finished.");
      }
      await loadAllDevData(range);
    } finally {
      setRunningBackup(false);
    }
  }

  if (loading && !pricing) {
    return (
      <div className="w-full px-3.5 sm:px-6 py-4 sm:py-5 space-y-5 sm:space-y-6">
        <div className="border-b border-neutral-200 pb-4">
          <h1 className="text-lg font-semibold text-neutral-900">
            Dev Profit, Meta Costs & Operations
          </h1>
        </div>
        <StatCardsSkeleton count={4} />
        <TableRowsSkeleton rows={5} cols={6} />
      </div>
    );
  }

  if (loadError && !pricing) {
    return (
      <div className="w-full px-3.5 sm:px-6 py-4 sm:py-5 space-y-5 sm:space-y-6">
        <ElementErrorState
          title="Dev Console Restricted"
          message={loadError}
          onRetry={() => void loadAllDevData(range)}
          retrying={refreshing}
        />
      </div>
    );
  }

  return (
    <div className="w-full px-6 py-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-900 text-white text-[10.5px] font-semibold uppercase tracking-wider mb-1.5">
            Reserved Strictly for DEV
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Dev Profit, Meta Wholesale Costs & Ops
          </h1>
          <p className="text-[13.5px] leading-relaxed text-slate-500 mt-1">
            Private developer view of net profit, actual Meta & AI wholesale costs, DEV account management, and nightly database backups.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/claude-usage"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
          >
            <IndianRupee className="w-3.5 h-3.5" />
            <span>Claude API Usage &amp; Spend</span>
          </Link>
          <Link
            href="/dashboard/ai-logs"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Open AI Logs (ai.logs)</span>
          </Link>
          <button
            type="button"
            onClick={() => void loadAllDevData(range)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white border border-neutral-300 text-xs font-medium text-neutral-700 hover:bg-neutral-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            disabled={runningBackup}
            onClick={() => void handleRunBackupNow()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#1da851] hover:bg-[#178c43] text-white text-xs font-medium cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{runningBackup ? "Backing up..." : "Back Up Now"}</span>
          </button>
        </div>
      </div>

      {statusBanner && (
        <div className="p-3.5 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900">
          {statusBanner}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("profit")}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold cursor-pointer ${
            activeTab === "profit"
              ? "bg-slate-900 text-white"
              : "bg-white border border-neutral-200 text-slate-700 hover:bg-neutral-50"
          }`}
        >
          <IndianRupee className="w-3.5 h-3.5" />
          <span>Profit, Meta Costs & Analytics</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("devs")}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold cursor-pointer ${
            activeTab === "devs"
              ? "bg-slate-900 text-white"
              : "bg-white border border-neutral-200 text-slate-700 hover:bg-neutral-50"
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Dev Accounts ({devAccounts.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("backups")}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold cursor-pointer ${
            activeTab === "backups"
              ? "bg-slate-900 text-white"
              : "bg-white border border-neutral-200 text-slate-700 hover:bg-neutral-50"
          }`}
        >
          <HardDrive className="w-3.5 h-3.5" />
          <span>Daily Backups & Databases</span>
        </button>
      </div>

      {activeTab === "profit" && pricing && (
        <DevProfitTab
          pricing={pricing}
          analytics={analytics}
          range={range}
          onRangeChange={setRange}
          rateForm={{
            clientMkt,
            setClientMkt,
            clientOther,
            setClientOther,
            metaMkt,
            setMetaMkt,
            metaUtil,
            setMetaUtil,
            metaAuth,
            setMetaAuth,
            metaServ,
            setMetaServ,
            gstRatePct,
            setGstRatePct,
            usdToInrRate,
            setUsdToInrRate,
            savingRates,
            onSaveDevRates: (e) => void handleSaveDevRates(e),
          }}
        />
      )}

      {activeTab === "devs" && (
        <DevAccountsTab
          devAccounts={devAccounts}
          newDevName={newDevName}
          setNewDevName={setNewDevName}
          newDevEmail={newDevEmail}
          setNewDevEmail={setNewDevEmail}
          newDevPhone={newDevPhone}
          setNewDevPhone={setNewDevPhone}
          newDevPassword={newDevPassword}
          setNewDevPassword={setNewDevPassword}
          creatingDev={creatingDev}
          devFormError={devFormError}
          onCreateDevAccount={(e) => void handleCreateDevAccount(e)}
        />
      )}

      {activeTab === "backups" && (
        <DevBackupsTab
          loading={loading}
          backupLogs={backupLogs}
          databases={databases}
          backupForm={{
            enabled,
            setEnabled,
            midnightHourIst,
            setMidnightHourIst,
            midnightMinuteIst,
            setMidnightMinuteIst,
            googleDriveFolderId,
            setGoogleDriveFolderId,
            googleServiceAccountEmail,
            setGoogleServiceAccountEmail,
            googlePrivateKey,
            setGooglePrivateKey,
            hasPrivateKey,
            googleClientId,
            setGoogleClientId,
            googleClientSecret,
            setGoogleClientSecret,
            googleOauthRefreshToken,
            setGoogleOauthRefreshToken,
            hasOauthRefreshToken,
            retentionDays,
            setRetentionDays,
            includeMainWebsiteDb,
            setIncludeMainWebsiteDb,
            savingBackup,
            onSaveBackupConfig: (e) => void handleSaveBackupConfig(e),
          }}
        />
      )}
    </div>
  );
}
