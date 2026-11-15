"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  FileCode,
  HardDrive,
  IndianRupee,
  Play,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import {
  AccountStatusBadge,
  CardListSkeleton,
  ElementErrorState,
  MetricStatCard,
  StatCardsSkeleton,
  TableRowsSkeleton,
  formatDateIst,
  formatDateTimeIst,
} from "@cc/ui";
import type { AccountStatus } from "@cc/rbac";

interface CategoryProfitRow {
  category: string;
  messageCount: number;
  unitRateInr: number;
  totalBilledInr: number;
  actualMetaCostInr?: number;
  netMarginInr?: number;
}

interface ProfitLedgerEntry {
  id: string;
  customerPhone: string;
  category: string;
  clientUnitRateInr: number;
  actualMetaUnitCostInr?: number;
  marginInr?: number;
  staffName: string;
  billedAt: string;
}

interface DevPricingPayload {
  ok: boolean;
  viewMode: "dev_actual_and_margin";
  rates: {
    marketingRateInr: number;
    otherMessagesRateInr: number;
    actualMetaMarketingRateInr: number;
    actualMetaUtilityRateInr: number;
    actualMetaAuthRateInr: number;
    actualMetaServiceRateInr: number;
  };
  totals: {
    totalMessages: number;
    totalBilledInr: number;
    totalActualMetaCostInr: number;
    totalNetMarginInr: number;
    marginPercentage: number;
  };
  byCategory: CategoryProfitRow[];
  recentEntries: ProfitLedgerEntry[];
}

interface DevAnalyticsSlice {
  range: string;
  kpis: {
    totalConversations: number;
    inboundMessagesCount: number;
    outboundMessagesCount: number;
    freeStaffRepliesCount: number;
    acrioRepliesCount: number;
    templateMessagesCount: number;
    outboundDeliveryRatePct: number;
    outboundReadRatePct: number;
    aiTokensIn?: number;
    aiTokensOut?: number;
    aiTokensTotal?: number;
    aiCacheReadTokens?: number;
    aiLiveCallsCount?: number;
    clientBilledInr?: number;
    actualMetaCostInr?: number;
    netMarginInr?: number;
  };
  aiTokenSummary?: {
    periodTokensIn: number;
    periodTokensOut: number;
    periodTokensTotal: number;
    periodCacheReadTokens: number;
    periodLiveAiCalls: number;
    allTimeTokensIn: number;
    allTimeTokensOut: number;
    allTimeTokensTotal: number;
  };
}

interface StaffMemberRecord {
  id: string;
  name: string;
  email: string;
  whatsappNumber: string;
  role: string;
  status: AccountStatus;
  createdAt: string;
}

interface DbDiag {
  domain: string;
  fileName: string;
  description: string;
  sizeBytes: number;
  tablesCount: number;
  totalRows: number;
}

interface BackupLog {
  id: string;
  startedAt: string;
  completedAt: string;
  triggerSource: string;
  status: string;
  databasesCount: number;
  totalBytes: number;
  localFolderPath: string;
  googleDriveFileId: string | null;
  googleDriveLink: string | null;
  detailsMessage: string;
}

function friendlyCategoryName(cat: string): string {
  switch (cat) {
    case "MARKETING":
      return "Marketing & Offer Templates";
    case "UTILITY":
      return "Order & Delivery Templates";
    case "AUTHENTICATION":
      return "Verification Code Templates";
    case "ACRIO":
      return "ACRIO Automated Replies";
    default:
      return cat;
  }
}

export default function DevProfitAndOpsPage() {
  const [activeTab, setActiveTab] = useState<"profit" | "devs" | "backups">(
    "profit"
  );
  const [range, setRange] = useState<string>("30d");

  const [pricing, setPricing] = useState<DevPricingPayload | null>(null);
  const [analytics, setAnalytics] = useState<DevAnalyticsSlice | null>(null);
  const [devAccounts, setDevAccounts] = useState<StaffMemberRecord[]>([]);
  const [databases, setDatabases] = useState<DbDiag[]>([]);
  const [backupLogs, setBackupLogs] = useState<BackupLog[]>([]);

  // DEV rate editor state
  const [clientMkt, setClientMkt] = useState<string>("0.95");
  const [clientOther, setClientOther] = useState<string>("0.30");
  const [metaMkt, setMetaMkt] = useState<string>("0.7846");
  const [metaUtil, setMetaUtil] = useState<string>("0.1150");
  const [metaAuth, setMetaAuth] = useState<string>("0.1150");
  const [metaServ, setMetaServ] = useState<string>("0.0800");
  const [savingRates, setSavingRates] = useState<boolean>(false);

  // Create another DEV form state
  const [newDevName, setNewDevName] = useState<string>("");
  const [newDevEmail, setNewDevEmail] = useState<string>("");
  const [newDevPhone, setNewDevPhone] = useState<string>("");
  const [newDevPassword, setNewDevPassword] = useState<string>("");
  const [creatingDev, setCreatingDev] = useState<boolean>(false);
  const [devFormError, setDevFormError] = useState<string>("");

  // Backup settings form
  const [enabled, setEnabled] = useState<boolean>(true);
  const [midnightHourIst, setMidnightHourIst] = useState<number>(0);
  const [midnightMinuteIst, setMidnightMinuteIst] = useState<number>(0);
  const [googleDriveFolderId, setGoogleDriveFolderId] = useState<string>("");
  const [googleServiceAccountEmail, setGoogleServiceAccountEmail] =
    useState<string>("");
  const [googlePrivateKey, setGooglePrivateKey] = useState<string>("");
  const [hasPrivateKey, setHasPrivateKey] = useState<boolean>(false);
  const [googleClientId, setGoogleClientId] = useState<string>("");
  const [googleClientSecret, setGoogleClientSecret] = useState<string>("");
  const [googleOauthRefreshToken, setGoogleOauthRefreshToken] =
    useState<string>("");
  const [hasOauthRefreshToken, setHasOauthRefreshToken] =
    useState<boolean>(false);
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [includeMainWebsiteDb, setIncludeMainWebsiteDb] =
    useState<boolean>(true);

  const [savingBackup, setSavingBackup] = useState<boolean>(false);
  const [runningBackup, setRunningBackup] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");

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
        setMetaMkt(String(priceJson.rates.actualMetaMarketingRateInr ?? 0.7846));
        setMetaUtil(String(priceJson.rates.actualMetaUtilityRateInr ?? 0.115));
        setMetaAuth(String(priceJson.rates.actualMetaAuthRateInr ?? 0.115));
        setMetaServ(String(priceJson.rates.actualMetaServiceRateInr ?? 0.08));

        if (anaRes.ok && anaJson.ok) {
          setAnalytics(anaJson);
        }

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
            setMidnightMinuteIst(
              Number(bkpJson.backupConfig.midnightMinuteIst ?? 0)
            );
            setGoogleDriveFolderId(
              bkpJson.backupConfig.googleDriveFolderId || ""
            );
            setGoogleServiceAccountEmail(
              bkpJson.backupConfig.googleServiceAccountEmail || ""
            );
            setHasPrivateKey(Boolean(bkpJson.backupConfig.hasPrivateKey));
            setGoogleClientId(bkpJson.backupConfig.googleClientId || "");
            setHasOauthRefreshToken(
              Boolean(bkpJson.backupConfig.hasOauthRefreshToken)
            );
            setRetentionDays(Number(bkpJson.backupConfig.retentionDays ?? 30));
            setIncludeMainWebsiteDb(
              Boolean(bkpJson.backupConfig.includeMainWebsiteDb)
            );
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
    loadAllDevData(range);
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
      <div className="w-full px-6 py-5 space-y-6">
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
      <div className="w-full px-6 py-5 space-y-6">
        <ElementErrorState
          title="Dev Console Restricted"
          message={loadError}
          onRetry={() => loadAllDevData(range)}
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
            href="/dashboard/ai-logs"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Open AI Logs (ai.logs)</span>
          </Link>
          <button
            type="button"
            onClick={() => loadAllDevData(range)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white border border-neutral-300 text-xs font-medium text-neutral-700 hover:bg-neutral-50 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            disabled={runningBackup}
            onClick={handleRunBackupNow}
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

      {/* Section Tabs */}
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

      {/* TAB 1: PROFIT, META WHOLESALE COSTS & ANALYTICS */}
      {activeTab === "profit" && pricing && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricStatCard
              label="Client Billed Total"
              value={`₹${pricing.totals.totalBilledInr.toFixed(2)}`}
              subtext={`${pricing.totals.totalMessages} paid messages logged`}
            />
            <MetricStatCard
              label="Actual Meta & AI Cost"
              value={`₹${pricing.totals.totalActualMetaCostInr.toFixed(4)}`}
              subtext="Direct Meta wholesale & Haiku cost"
            />
            <MetricStatCard
              label="Your Net Profit"
              value={`₹${pricing.totals.totalNetMarginInr.toFixed(4)}`}
              subtext="Client billed minus actual wholesale"
            />
            <MetricStatCard
              label="Net Profit Margin"
              value={`${pricing.totals.marginPercentage}%`}
              subtext={`Mkt +₹${(pricing.rates.marketingRateInr - pricing.rates.actualMetaMarketingRateInr).toFixed(3)} • Other +₹${(pricing.rates.otherMessagesRateInr - pricing.rates.actualMetaUtilityRateInr).toFixed(3)}`}
            />
          </div>

          {/* Period Cost & Volume Analytics */}
          {analytics && (
            <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">
                    Period Profit & Traffic Analytics
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Compare message volume, client billing, actual Meta/AI spend, and net profit by time window.
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {[
                    { id: "today", label: "Today" },
                    { id: "7d", label: "7 Days" },
                    { id: "30d", label: "30 Days" },
                    { id: "90d", label: "90 Days" },
                    { id: "all", label: "All Time" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setRange(opt.id)}
                      className={`px-2.5 py-1.5 rounded text-xs font-medium cursor-pointer ${
                        range === opt.id
                          ? "bg-slate-900 text-white"
                          : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                  <div className="text-neutral-500">Period Client Billed</div>
                  <div className="text-base font-bold text-neutral-900 mt-1 font-mono">
                    ₹{(analytics.kpis.clientBilledInr ?? 0).toFixed(2)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                  <div className="text-neutral-500">Period Actual Cost</div>
                  <div className="text-base font-bold text-neutral-900 mt-1 font-mono">
                    ₹{(analytics.kpis.actualMetaCostInr ?? 0).toFixed(4)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                  <div className="text-emerald-800 font-medium">Period Net Profit</div>
                  <div className="text-base font-bold text-emerald-900 mt-1 font-mono">
                    +₹{(analytics.kpis.netMarginInr ?? 0).toFixed(4)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-indigo-50/60 border border-indigo-200">
                  <div className="text-indigo-800 font-medium">AI Tokens In</div>
                  <div className="text-base font-bold text-indigo-950 mt-1 font-mono">
                    {(analytics.kpis.aiTokensIn ?? 0).toLocaleString("en-IN")}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-purple-50/60 border border-purple-200">
                  <div className="text-purple-800 font-medium">AI Tokens Out</div>
                  <div className="text-base font-bold text-purple-950 mt-1 font-mono">
                    {(analytics.kpis.aiTokensOut ?? 0).toLocaleString("en-IN")}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                  <div className="text-neutral-500">ACRIO Turns</div>
                  <div className="text-base font-bold text-neutral-900 mt-1 font-mono">
                    {analytics.kpis.acrioRepliesCount}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                  <div className="text-neutral-500">Templates Sent</div>
                  <div className="text-base font-bold text-neutral-900 mt-1 font-mono">
                    {analytics.kpis.templateMessagesCount}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200">
                  <div className="text-neutral-500">Staff 24h Replies</div>
                  <div className="text-base font-bold text-neutral-900 mt-1 font-mono">
                    {analytics.kpis.freeStaffRepliesCount}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Category Profit Breakdown Table */}
          <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-neutral-900">
              Profit & Margin by Message Category
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 text-neutral-500">
                    <th className="py-2.5 pr-3 font-medium">Message Type</th>
                    <th className="py-2.5 px-3 font-medium">Count</th>
                    <th className="py-2.5 px-3 font-medium">Client Rate</th>
                    <th className="py-2.5 px-3 font-medium">Client Total</th>
                    <th className="py-2.5 px-3 font-medium">Actual Meta/AI Cost</th>
                    <th className="py-2.5 pl-3 text-right font-medium">Net Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {pricing.byCategory.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-neutral-400">
                        No paid messages recorded yet.
                      </td>
                    </tr>
                  ) : (
                    pricing.byCategory.map((c) => (
                      <tr key={c.category}>
                        <td className="py-3 pr-3 font-medium text-neutral-900">
                          {friendlyCategoryName(c.category)}
                        </td>
                        <td className="py-3 px-3 text-neutral-700">{c.messageCount}</td>
                        <td className="py-3 px-3 font-mono">
                          ₹{c.unitRateInr.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 font-mono font-semibold text-neutral-900">
                          ₹{c.totalBilledInr.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 font-mono text-neutral-700">
                          ₹{(c.actualMetaCostInr ?? 0).toFixed(4)}
                        </td>
                        <td className="py-3 pl-3 text-right font-mono font-semibold text-emerald-700">
                          +₹{(c.netMarginInr ?? 0).toFixed(4)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* DEV Rate Editor */}
          <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Configure Client Charge Rates & Actual Meta Wholesale Costs
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                Superadmins only see the Client rates on Cost Breakdown. Meta wholesale costs and profit margins never leave this Dev page.
              </p>
            </div>

            <form
              onSubmit={handleSaveDevRates}
              className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs"
            >
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Client Marketing (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={clientMkt}
                  onChange={(e) => setClientMkt(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Client ACRIO / Utility (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={clientOther}
                  onChange={(e) => setClientOther(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Meta Marketing (₹)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={metaMkt}
                  onChange={(e) => setMetaMkt(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Meta Utility (₹)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={metaUtil}
                  onChange={(e) => setMetaUtil(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Meta Auth (₹)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={metaAuth}
                  onChange={(e) => setMetaAuth(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Meta Service (₹)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={metaServ}
                  onChange={(e) => setMetaServ(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
                />
              </div>

              <div className="sm:col-span-3 lg:col-span-6 flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={savingRates}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingRates ? "Saving..." : "Save Rates"}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Per-Message Profit Ledger */}
          <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-neutral-900">
              Recent Per-Message Profit Ledger
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 text-neutral-500">
                    <th className="py-2 pr-3 font-medium">Date & Time</th>
                    <th className="py-2 px-3 font-medium">Customer Number</th>
                    <th className="py-2 px-3 font-medium">Type</th>
                    <th className="py-2 px-3 font-medium">Sent By</th>
                    <th className="py-2 px-3 text-right font-medium">Client Charge</th>
                    <th className="py-2 px-3 text-right font-medium">Actual Cost</th>
                    <th className="py-2 pl-3 text-right font-medium">Net Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {pricing.recentEntries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-neutral-400">
                        No billed messages recorded yet.
                      </td>
                    </tr>
                  ) : (
                    pricing.recentEntries.map((e) => (
                      <tr key={e.id}>
                        <td className="py-2.5 pr-3 text-neutral-500">
                          {formatDateTimeIst(e.billedAt)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-neutral-800">
                          {e.customerPhone}
                        </td>
                        <td className="py-2.5 px-3 text-neutral-700">
                          {friendlyCategoryName(e.category)}
                        </td>
                        <td className="py-2.5 px-3 text-neutral-700">{e.staffName}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-medium">
                          ₹{e.clientUnitRateInr.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-neutral-600">
                          ₹{(e.actualMetaUnitCostInr ?? 0).toFixed(4)}
                        </td>
                        <td className="py-2.5 pl-3 text-right font-mono font-semibold text-emerald-700">
                          +₹{(e.marginInr ?? 0).toFixed(4)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DEV ACCOUNTS (ONLY ONE DEV CAN CREATE ANOTHER DEV) */}
      {activeTab === "devs" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleCreateDevAccount}
            className="lg:col-span-5 bg-white rounded-lg border border-neutral-200 p-5 space-y-4 text-xs"
          >
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Create Another Dev Account
              </h2>
              <p className="text-neutral-500 mt-0.5 leading-relaxed">
                Only an active DEV can create or manage another DEV. Dev accounts can view every page and step into any chat directly, and are never placed in automatic chat round-robin.
              </p>
            </div>

            {devFormError && (
              <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700">
                {devFormError}
              </div>
            )}

            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Full Name
              </label>
              <input
                type="text"
                required
                value={newDevName}
                onChange={(e) => setNewDevName(e.target.value)}
                placeholder="Developer Name"
                className="w-full rounded-md border border-neutral-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Email Address
              </label>
              <input
                type="email"
                required
                value={newDevEmail}
                onChange={(e) => setNewDevEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full rounded-md border border-neutral-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                WhatsApp Number
              </label>
              <input
                type="tel"
                required
                value={newDevPhone}
                onChange={(e) => setNewDevPhone(e.target.value)}
                placeholder="+91 98XXXXXXXX"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
            </div>

            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Password (min 8 characters)
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={newDevPassword}
                onChange={(e) => setNewDevPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full rounded-md border border-neutral-300 px-3 py-2"
              />
            </div>

            <button
              type="submit"
              disabled={creatingDev}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-semibold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{creatingDev ? "Creating Dev..." : "Create Dev Account"}</span>
            </button>
          </form>

          <div className="lg:col-span-7 bg-white rounded-lg border border-neutral-200 p-5 space-y-3 text-xs">
            <h2 className="text-sm font-semibold text-neutral-900">
              Existing Dev Accounts ({devAccounts.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 text-neutral-500">
                    <th className="py-2 pr-3 font-medium">Name & Email</th>
                    <th className="py-2 px-3 font-medium">WhatsApp</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                    <th className="py-2 pl-3 text-right font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {devAccounts.map((acc) => (
                    <tr key={acc.id}>
                      <td className="py-3 pr-3">
                        <div className="font-semibold text-neutral-900">{acc.name}</div>
                        <div className="text-neutral-500 font-mono">{acc.email}</div>
                      </td>
                      <td className="py-3 px-3 font-mono text-neutral-700">
                        {acc.whatsappNumber}
                      </td>
                      <td className="py-3 px-3">
                        <AccountStatusBadge status={acc.status} />
                      </td>
                      <td className="py-3 pl-3 text-right text-neutral-500">
                        {formatDateIst(acc.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: DAILY BACKUPS & DATABASES */}
      {activeTab === "backups" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSaveBackupConfig}
            className="lg:col-span-7 bg-white rounded-lg border border-neutral-200 p-5 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">
                Google Drive Daily Backup Schedule
              </h2>
              <label className="inline-flex items-center gap-2 font-medium text-neutral-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="rounded accent-[#1da851]"
                />
                <span>Run every night automatically</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Hour (IST, 0 = 12:00 AM)
                </label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={midnightHourIst}
                  onChange={(e) => setMidnightHourIst(Number(e.target.value))}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Minute (IST)
                </label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={midnightMinuteIst}
                  onChange={(e) => setMidnightMinuteIst(Number(e.target.value))}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Keep Local Copies (Days)
                </label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(Number(e.target.value))}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Google Drive Folder ID
              </label>
              <input
                type="text"
                value={googleDriveFolderId}
                onChange={(e) => setGoogleDriveFolderId(e.target.value)}
                placeholder="Paste the folder ID from your Google Drive URL"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
            </div>

            <div className="p-3.5 rounded-md bg-neutral-50 border border-neutral-200 space-y-3">
              <div className="font-medium text-neutral-900">
                Option 1: Google Service Account
              </div>
              <div>
                <label className="block font-medium text-neutral-600 mb-1">
                  Service Account Email
                </label>
                <input
                  type="email"
                  value={googleServiceAccountEmail}
                  onChange={(e) => setGoogleServiceAccountEmail(e.target.value)}
                  placeholder="backup@your-project.iam.gserviceaccount.com"
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-neutral-600 mb-1">
                  Private Key{" "}
                  {hasPrivateKey && (
                    <span className="text-emerald-700">
                      (Saved • Leave empty to keep current key)
                    </span>
                  )}
                </label>
                <textarea
                  rows={2}
                  value={googlePrivateKey}
                  onChange={(e) => setGooglePrivateKey(e.target.value)}
                  placeholder="-----BEGIN PRIVATE KEY-----"
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
                />
              </div>
            </div>

            <div className="p-3.5 rounded-md bg-neutral-50 border border-neutral-200 space-y-3">
              <div className="font-medium text-neutral-900">
                Option 2: Personal Google Account Token
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  placeholder="Google Client ID"
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
                />
                <input
                  type="password"
                  value={googleClientSecret}
                  onChange={(e) => setGoogleClientSecret(e.target.value)}
                  placeholder="Client Secret"
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
                />
              </div>
              <input
                type="password"
                value={googleOauthRefreshToken}
                onChange={(e) => setGoogleOauthRefreshToken(e.target.value)}
                placeholder={
                  hasOauthRefreshToken
                    ? "Refresh Token saved (leave empty to keep)"
                    : "Google Refresh Token"
                }
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
              />
            </div>

            <label className="inline-flex items-center gap-2 font-medium text-neutral-700 cursor-pointer">
              <input
                type="checkbox"
                checked={includeMainWebsiteDb}
                onChange={(e) => setIncludeMainWebsiteDb(e.target.checked)}
                className="rounded accent-[#1da851]"
              />
              <span>Include main Classic Concepts website database in nightly backup</span>
            </label>

            <button
              type="submit"
              disabled={savingBackup}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{savingBackup ? "Saving..." : "Save Backup Settings"}</span>
            </button>
          </form>

          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-3 text-xs">
              <h2 className="text-sm font-semibold text-neutral-900">
                Recent Backups
              </h2>
              {loading ? (
                <CardListSkeleton rows={3} />
              ) : backupLogs.length === 0 ? (
                <p className="text-neutral-400 py-4 text-center">
                  No backups run yet. Click &ldquo;Back Up Now&rdquo; at the top right to create one.
                </p>
              ) : (
                <div className="space-y-2.5 max-h-72 overflow-y-auto">
                  {backupLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3 rounded-md border border-neutral-200 bg-neutral-50 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-neutral-900">
                          {log.databasesCount} databases ({(log.totalBytes / 1024).toFixed(1)} KB)
                        </span>
                        <span
                          className={`text-[11px] font-medium ${
                            log.status.includes("FAILED")
                              ? "text-red-700"
                              : "text-emerald-700"
                          }`}
                        >
                          {log.status === "UPLOADED_TO_GDRIVE"
                            ? "Uploaded to Drive"
                            : log.status === "SAVED_LOCAL_SNAPSHOT"
                            ? "Saved Locally"
                            : "Failed"}
                        </span>
                      </div>
                      <p className="text-neutral-600">{log.detailsMessage}</p>
                      <div className="flex items-center justify-between text-[11px] text-neutral-400">
                        <span>{formatDateTimeIst(log.completedAt)}</span>
                        {log.googleDriveLink && (
                          <a
                            href={log.googleDriveLink}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-neutral-900 font-medium underline"
                          >
                            <span>Open in Drive</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-3 text-xs">
              <h2 className="text-sm font-semibold text-neutral-900">
                Databases Included in Backup
              </h2>
              <div className="divide-y divide-neutral-200">
                {databases.map((db) => (
                  <div key={db.domain} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-medium text-neutral-900">
                        {db.fileName}
                      </span>
                      <span className="text-neutral-500">
                        {db.totalRows} records • {(db.sizeBytes / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    <p className="text-neutral-500 mt-0.5">{db.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
