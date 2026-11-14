"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import {
  CardListSkeleton,
  ElementErrorState,
  MetricStatCard,
  SHORTLINK_PUBLIC_DOMAIN,
  StatCardsSkeleton,
  TableRowsSkeleton,
  WHATSAPP_PUBLIC_DOMAIN,
  WhatsAppFormattedText,
  WhatsAppLogoIcon,
  WhatsAppMessageTicks,
  formatShortLinkUrl,
} from "@cc/ui";

type PacingMode = "SAFE_STEADY" | "EXTRA_CAREFUL" | "WARMED_FAST";

interface TemplateItem {
  id: string;
  name: string;
  language: string;
  category: string;
  headerType: string;
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  approvalStatus: string;
  sentCount: number;
}

interface MarketingListItem {
  id: string;
  name: string;
  description: string;
  sourceType: string;
  acrioPrompt: string | null;
  membersCount: number;
  memberPhones: string[];
  createdByName: string;
  updatedAt: string;
}

interface BroadcastItem {
  id: string;
  name: string;
  listName: string;
  templateName: string;
  billingCategory: string;
  status: string;
  pacingMode: string;
  delaySeconds: number;
  batchSize: number;
  batchPauseSeconds: number;
  totalRecipients: number;
  queuedCount: number;
  skippedCount: number;
  failedCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  pausedReason: string | null;
  scheduledFor: string | null;
  nextDispatchAt: string | null;
  completedAt: string | null;
  clientBilledInr: number;
  createdByName: string;
  createdAt: string;
}

interface RecipientQueueRow {
  id: string;
  customerName: string;
  customerPhone: string;
  renderedBody: string;
  status: string;
  skipOrErrorReason: string | null;
  attempts: number;
  scheduledAt: string;
  sentAt: string | null;
}

interface QueueSafetySettings {
  defaultPacingMode: PacingMode;
  delaySeconds: number;
  batchSize: number;
  batchPauseSeconds: number;
  skipRecentHours: number;
  dailyMarketingCap: number;
  autoPauseOnConsecutiveFailures: number;
  quietHoursEnabled: boolean;
}

interface CustomLinkItem {
  id: string;
  code: string;
  title: string;
  targetUrl: string;
  linkType: string;
  utmCampaign: string | null;
  clicksCount: number;
  createdByName: string;
}

interface AcrioPreview {
  suggestedName: string;
  description: string;
  filterExplanation: string;
  matchedCustomers: {
    id: string;
    name: string;
    phone: string;
    companyName: string | null;
    organizationType: string | null;
    acrioSegment: string;
    lifetimeValueInr: number;
  }[];
}

function formatDurationLabel(totalSeconds: number): string {
  if (totalSeconds <= 0) return "Immediate";
  if (totalSeconds < 60) return `~${totalSeconds} sec`;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins < 60) {
    return secs > 0 ? `~${mins} min ${secs}s` : `~${mins} min`;
  }
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `~${hrs} hr ${remMins} min` : `~${hrs} hr`;
}

function estimateSafeQueueDuration(count: number, mode: PacingMode): number {
  if (count <= 0) return 0;
  const spec =
    mode === "EXTRA_CAREFUL"
      ? { delay: 8, batch: 15, pause: 30 }
      : mode === "WARMED_FAST"
      ? { delay: 2, batch: 50, pause: 15 }
      : { delay: 4, batch: 25, pause: 20 };
  const pauses = Math.floor(Math.max(0, count - 1) / spec.batch);
  return Math.max(0, count - 1) * spec.delay + pauses * spec.pause;
}

function getStatusBadgeStyle(status: string): string {
  switch (status) {
    case "SENDING":
    case "QUEUED":
      return "bg-blue-50 text-blue-800 border-blue-200";
    case "SCHEDULED":
      return "bg-indigo-50 text-indigo-800 border-indigo-200";
    case "PAUSED":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "COMPLETED":
    case "SENT":
    case "DELIVERED":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "SKIPPED":
      return "bg-neutral-100 text-neutral-700 border-neutral-300";
    case "FAILED":
    case "CANCELLED":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-neutral-100 text-neutral-700 border-neutral-200";
  }
}

export default function MarketingAndLinksPage() {
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");

  const [canManageTemplates, setCanManageTemplates] = useState<boolean>(false);
  const [canSendBroadcasts, setCanSendBroadcasts] = useState<boolean>(false);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [lists, setLists] = useState<MarketingListItem[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastItem[]>([]);
  const [customLinks, setCustomLinks] = useState<CustomLinkItem[]>([]);
  const [feedback, setFeedback] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Safe Queue Global Protection Settings
  const [showSafetyPanel, setShowSafetyPanel] = useState<boolean>(false);
  const [savingSafety, setSavingSafety] = useState<boolean>(false);
  const [safetySettings, setSafetySettings] = useState<QueueSafetySettings>({
    defaultPacingMode: "SAFE_STEADY",
    delaySeconds: 4,
    batchSize: 25,
    batchPauseSeconds: 20,
    skipRecentHours: 24,
    dailyMarketingCap: 250,
    autoPauseOnConsecutiveFailures: 3,
    quietHoursEnabled: false,
  });

  // Safe Broadcast Queue Launcher
  const [bcName, setBcName] = useState<string>("");
  const [bcListId, setBcListId] = useState<string>("");
  const [bcTemplateId, setBcTemplateId] = useState<string>("");
  const [bcPacingMode, setBcPacingMode] = useState<PacingMode>("SAFE_STEADY");
  const [bcSkipRecentHours, setBcSkipRecentHours] = useState<number>(24);
  const [bcScheduledFor, setBcScheduledFor] = useState<string>("");
  const [launching, setLaunching] = useState<boolean>(false);
  const [busyCampaignId, setBusyCampaignId] = useState<string>("");

  // Recipient Queue Inspector Modal / Drawer
  const [inspectBroadcast, setInspectBroadcast] =
    useState<BroadcastItem | null>(null);
  const [recipientRows, setRecipientRows] = useState<RecipientQueueRow[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState<boolean>(false);
  const [recipientsError, setRecipientsError] = useState<string>("");

  // ACRIO List Builder
  const [acrioPrompt, setAcrioPrompt] = useState<string>(
    "Hotels, banquets, and repeat buyers with orders over Rs 20000"
  );
  const [acrioPreview, setAcrioPreview] = useState<AcrioPreview | null>(null);
  const [listNameDraft, setListNameDraft] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string>("");
  const [savingList, setSavingList] = useState<boolean>(false);

  // Short-Link Creator & Auto-Synced Catalog Filter
  const [linkTitle, setLinkTitle] = useState<string>("");
  const [linkCode, setLinkCode] = useState<string>("");
  const [linkTargetUrl, setLinkTargetUrl] = useState<string>(
    "https://www.classicconcepts.in/shop"
  );
  const [linkType, setLinkType] = useState<string>("CATALOG");
  const [copiedCode, setCopiedCode] = useState<string>("");
  const [linkSearch, setLinkSearch] = useState<string>("");
  const [linkSourceFilter, setLinkSourceFilter] = useState<
    "ALL" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | "MANUAL"
  >("ALL");
  const [syncingCatalogLinks, setSyncingCatalogLinks] =
    useState<boolean>(false);

  function flashMessage(msg: string, isError = false) {
    if (isError) {
      setErrorMsg(msg);
      setFeedback("");
    } else {
      setFeedback(msg);
      setErrorMsg("");
    }
    setTimeout(() => {
      setFeedback("");
      setErrorMsg("");
    }, 4500);
  }

  const loadMarketingData = useCallback(
    async (silent = false) => {
      if (!silent) {
        setRefreshing(true);
        setLoadError("");
      }
      try {
        const res = await fetch("/api/marketing", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          if (!silent) {
            setLoadError(
              data.error ||
                "Could not load broadcast queue, customer lists, and short links."
            );
          }
          return;
        }
        setCanManageTemplates(Boolean(data.canManageTemplates));
        setCanSendBroadcasts(Boolean(data.canSendBroadcasts));
        const nextTemplates: TemplateItem[] = data.templates || [];
        const nextLists: MarketingListItem[] = data.lists || [];
        setTemplates(nextTemplates);
        setLists(nextLists);
        setBroadcasts(data.broadcasts || []);
        setCustomLinks(data.customLinks || []);

        if (data.queueSettings) {
          setSafetySettings(data.queueSettings);
          if (initialLoading) {
            setBcPacingMode(
              data.queueSettings.defaultPacingMode || "SAFE_STEADY"
            );
            setBcSkipRecentHours(
              Number(data.queueSettings.skipRecentHours ?? 24)
            );
          }
        }

        const approvedTpls = nextTemplates.filter(
          (t) => t.approvalStatus === "APPROVED"
        );
        setBcListId((prev) => prev || nextLists[0]?.id || "");
        setBcTemplateId(
          (prev) =>
            prev || approvedTpls[0]?.id || nextTemplates[0]?.id || ""
        );
        setLoadError("");
      } catch {
        if (!silent) {
          setLoadError(
            "Network error while loading the broadcast queue. Check your connection and try again."
          );
        }
      } finally {
        setInitialLoading(false);
        setRefreshing(false);
      }
    },
    [initialLoading]
  );

  const loadBroadcastRecipients = useCallback(async (broadcastId: string) => {
    setRecipientsLoading(true);
    setRecipientsError("");
    try {
      const res = await fetch(
        `/api/marketing?broadcastId=${encodeURIComponent(broadcastId)}`,
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setRecipientsError(
          data.error || "Could not load recipient queue details."
        );
        return;
      }
      setRecipientRows(data.recipients || []);
    } catch {
      setRecipientsError(
        "Network error while loading recipient queue status. Click Try Again."
      );
    } finally {
      setRecipientsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMarketingData(false);
  }, [loadMarketingData]);

  // Live SSE updates + fast gentle refresh whenever any campaign is actively SENDING / QUEUED
  const hasActiveQueue = useMemo(
    () =>
      broadcasts.some(
        (b) =>
          b.status === "SENDING" ||
          b.status === "QUEUED" ||
          b.status === "SCHEDULED"
      ),
    [broadcasts]
  );

  useEffect(() => {
    const es = new EventSource("/api/realtime/stream");
    const onProgress = () => {
      void loadMarketingData(true);
      if (inspectBroadcast) {
        void loadBroadcastRecipients(inspectBroadcast.id);
      }
    };
    es.addEventListener("broadcast:progress", onProgress);
    es.addEventListener("template:updated", onProgress);

    const intervalMs = hasActiveQueue ? 3000 : 15000;
    const poll = setInterval(() => {
      void loadMarketingData(true);
      if (inspectBroadcast && hasActiveQueue) {
        void loadBroadcastRecipients(inspectBroadcast.id);
      }
    }, intervalMs);

    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [
    hasActiveQueue,
    inspectBroadcast,
    loadBroadcastRecipients,
    loadMarketingData,
  ]);

  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.approvalStatus === "APPROVED"),
    [templates]
  );

  const selectedList = lists.find((l) => l.id === bcListId);
  const selectedTpl =
    approvedTemplates.find((t) => t.id === bcTemplateId) ||
    templates.find((t) => t.id === bcTemplateId);
  const estCount = selectedList?.membersCount || 0;
  const estSeconds = estimateSafeQueueDuration(estCount, bcPacingMode);

  async function handleLaunchBroadcast(e: React.FormEvent) {
    e.preventDefault();
    if (!bcListId || !bcTemplateId || launching) return;
    setLaunching(true);
    try {
      const scheduledIso = bcScheduledFor
        ? new Date(bcScheduledFor).toISOString()
        : null;
      const res = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "launch_broadcast",
          name: bcName,
          listId: bcListId,
          templateId: bcTemplateId,
          pacingMode: bcPacingMode,
          skipRecentHours: bcSkipRecentHours,
          scheduledFor: scheduledIso,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setBcName("");
        setBcScheduledFor("");
        const skippedNote =
          Number(data.skippedCount) > 0
            ? ` (${data.skippedCount} skipped due to opt-out or recent message cooldown)`
            : "";
        flashMessage(
          `Queued ${data.queuedCount} recipients safely with anti-spam spacing${skippedNote}.`
        );
        await loadMarketingData(true);
      } else {
        flashMessage(data.error || "Could not queue broadcast.", true);
      }
    } catch {
      flashMessage("Network error while queueing broadcast.", true);
    } finally {
      setLaunching(false);
    }
  }

  async function handleCampaignControl(
    broadcastId: string,
    action:
      | "pause_broadcast"
      | "resume_broadcast"
      | "retry_failed_broadcast"
      | "cancel_broadcast"
  ) {
    setBusyCampaignId(broadcastId);
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, broadcastId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        const msgMap: Record<typeof action, string> = {
          pause_broadcast: "Broadcast queue paused.",
          resume_broadcast: "Broadcast queue resumed safely.",
          retry_failed_broadcast: `Re-queued ${data.retried ?? 0} failed recipients.`,
          cancel_broadcast: "Remaining queued messages cancelled.",
        };
        flashMessage(msgMap[action]);
        await loadMarketingData(true);
        if (inspectBroadcast?.id === broadcastId) {
          await loadBroadcastRecipients(broadcastId);
        }
      } else {
        flashMessage(data.error || "Could not update broadcast queue.", true);
      }
    } finally {
      setBusyCampaignId("");
    }
  }

  async function handleSaveSafetySettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingSafety(true);
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_queue_settings",
          ...safetySettings,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        if (data.queueSettings) setSafetySettings(data.queueSettings);
        setShowSafetyPanel(false);
        flashMessage("Saved anti-spam broadcast protection settings.");
      } else {
        flashMessage(data.error || "Could not save safety settings.", true);
      }
    } finally {
      setSavingSafety(false);
    }
  }

  async function handleAcrioPreview(e: React.FormEvent) {
    e.preventDefault();
    if (!acrioPrompt.trim()) return;
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "acrio_preview_segment",
          prompt: acrioPrompt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.preview) {
        setAcrioPreview(data.preview);
        setListNameDraft(data.preview.suggestedName);
      } else {
        setPreviewError(data.error || "Could not match contacts right now.");
      }
    } catch {
      setPreviewError("Network error while matching contacts. Try again.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSaveAcrioList() {
    if (!acrioPreview || savingList) return;
    setSavingList(true);
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_acrio_list",
          name: listNameDraft || acrioPreview.suggestedName,
          description: acrioPreview.description,
          acrioPrompt,
          memberPhones: acrioPreview.matchedCustomers.map((c) => c.phone),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        flashMessage("Customer list saved.");
        setAcrioPreview(null);
        await loadMarketingData(true);
      } else {
        flashMessage(data.error || "Permission required to save lists.", true);
      }
    } finally {
      setSavingList(false);
    }
  }

  async function handleDeleteList(listId: string, name: string) {
    if (!window.confirm(`Remove customer list "${name}"?`)) return;
    const res = await fetch("/api/marketing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_list", listId }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      flashMessage("Customer list removed.");
      await loadMarketingData(true);
    } else {
      flashMessage(data.error || "Could not delete list.", true);
    }
  }

  async function handleCreateLink(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/marketing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_custom_link",
        title: linkTitle,
        code: linkCode || undefined,
        targetUrl: linkTargetUrl,
        linkType,
        utmCampaign: "whatsapp_share",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setLinkTitle("");
      setLinkCode("");
      flashMessage(`Created ${formatShortLinkUrl(data.link.code)}`);
      await loadMarketingData(true);
    } else {
      flashMessage(data.error || "Could not create short link.", true);
    }
  }

  function copyShortLink(code: string) {
    const url = formatShortLinkUrl(code);
    navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(""), 2000);
  }

  async function handleSyncProductLinks() {
    setSyncingCatalogLinks(true);
    try {
      const res = await fetch("/api/cache/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        await loadMarketingData(true);
        const totalAuto = Number(data.autoShortLinksCount ?? 0);
        flashMessage(
          `Synced ${totalAuto} product short links from Classic Concepts and Classic Edge 53.`
        );
      } else {
        flashMessage(data.error || "Could not sync product short links.", true);
      }
    } catch {
      flashMessage("Network error while syncing product short links.", true);
    } finally {
      setSyncingCatalogLinks(false);
    }
  }

  const classifyLinkBrand = useCallback(
    (
      lnk: CustomLinkItem
    ): "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | "MANUAL" => {
      if (
        lnk.utmCampaign === "auto_classicedge53" ||
        lnk.createdByName.includes("Classic Edge 53")
      ) {
        return "CLASSIC_EDGE_53";
      }
      if (
        lnk.utmCampaign === "auto_classicconcepts" ||
        lnk.createdByName.includes("Classic Concepts")
      ) {
        return "CLASSIC_CONCEPTS";
      }
      return "MANUAL";
    },
    []
  );

  const linkCounts = useMemo(() => {
    let cc = 0;
    let ce = 0;
    let manual = 0;
    for (const l of customLinks) {
      const kind = classifyLinkBrand(l);
      if (kind === "CLASSIC_CONCEPTS") cc++;
      else if (kind === "CLASSIC_EDGE_53") ce++;
      else manual++;
    }
    return { all: customLinks.length, cc, ce, manual };
  }, [customLinks, classifyLinkBrand]);

  const filteredCustomLinks = useMemo(() => {
    const q = linkSearch.trim().toLowerCase();
    return customLinks.filter((lnk) => {
      const kind = classifyLinkBrand(lnk);
      if (linkSourceFilter !== "ALL" && kind !== linkSourceFilter) {
        return false;
      }
      if (q) {
        const hay = `${lnk.title} ${lnk.code} ${lnk.targetUrl} ${lnk.createdByName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [customLinks, classifyLinkBrand, linkSourceFilter, linkSearch]);

  function openInspector(b: BroadcastItem) {
    setInspectBroadcast(b);
    void loadBroadcastRecipients(b.id);
  }

  return (
    <div className="w-full px-6 py-5 space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-[#00a884] shrink-0" />
            <span>Safe Broadcast Queue, ACRIO Lists & Short Links</span>
          </h1>
          <p className="text-[13.5px] leading-relaxed text-slate-500 mt-1 max-w-3xl">
            Queue WhatsApp broadcasts one recipient at a time with safe anti-spam spacing, opt-out filtering, and Meta rate-limit protection.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManageTemplates && (
            <Link
              href="/dashboard/templates"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white hover:bg-neutral-50 border border-neutral-300 text-xs font-medium text-neutral-800"
            >
              <FileText className="w-3.5 h-3.5 text-[#00a884]" />
              <span>Open Templates Studio</span>
            </Link>
          )}
          {canSendBroadcasts && (
            <button
              type="button"
              onClick={() => setShowSafetyPanel((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white hover:bg-neutral-50 border border-neutral-300 text-xs font-medium text-neutral-800 cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Anti-Spam Safety Limits</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => loadMarketingData(false)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white hover:bg-neutral-50 border border-neutral-300 text-xs font-medium text-neutral-700 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div className="px-3.5 py-2.5 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
          {feedback}
        </div>
      )}
      {errorMsg && (
        <div className="px-3.5 py-2.5 rounded-md bg-red-50 border border-red-200 text-xs font-medium text-red-700">
          {errorMsg}
        </div>
      )}

      {/* Summary Stat Cards (Element-Wise Loading & Error Fallback) */}
      {initialLoading ? (
        <StatCardsSkeleton count={4} />
      ) : loadError ? (
        <ElementErrorState
          title="Could not load broadcast summary"
          message={loadError}
          onRetry={() => loadMarketingData(false)}
          retrying={refreshing}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricStatCard
            label="Active Queued Messages"
            value={String(
              broadcasts.reduce((sum, b) => sum + (b.queuedCount || 0), 0)
            )}
            subtext={`Daily cap: ${safetySettings.dailyMarketingCap} marketing msgs/day`}
          />
          <MetricStatCard
            label="Approved Templates"
            value={String(approvedTemplates.length)}
            subtext="Ready for broadcasts & customer chats"
          />
          <MetricStatCard
            label="Saved Customer Lists"
            value={String(lists.length)}
            subtext="Opted-out contacts skipped automatically"
          />
          <MetricStatCard
            label="Short Links"
            value={String(customLinks.length)}
            subtext={`${customLinks.reduce((a, b) => a + b.clicksCount, 0)} tracked clicks`}
          />
        </div>
      )}

      {/* Collapsible Global Anti-Spam Safety Settings */}
      {showSafetyPanel && canSendBroadcasts && (
        <form
          onSubmit={handleSaveSafetySettings}
          className="bg-white rounded-lg border border-emerald-200 p-5 space-y-4 text-xs"
        >
          <div className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#00a884]" />
                <span>Meta Anti-Spam & Account Protection Settings</span>
              </h2>
              <p className="text-neutral-500 mt-0.5">
                Protects {WHATSAPP_PUBLIC_DOMAIN} from Meta quality drops or spam blocks by pacing messages, skipping recent recipients, and auto-pausing on errors.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSafetyPanel(false)}
              className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Daily Marketing Message Limit
              </label>
              <input
                type="number"
                min={10}
                max={100000}
                value={safetySettings.dailyMarketingCap}
                onChange={(e) =>
                  setSafetySettings((prev) => ({
                    ...prev,
                    dailyMarketingCap: Number(e.target.value),
                  }))
                }
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
              <p className="text-[11px] text-neutral-500 mt-1">
                Match your Meta Business tier (250, 1,000, or 10,000/day).
              </p>
            </div>

            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Default Cooldown (Hours)
              </label>
              <input
                type="number"
                min={0}
                max={720}
                value={safetySettings.skipRecentHours}
                onChange={(e) =>
                  setSafetySettings((prev) => ({
                    ...prev,
                    skipRecentHours: Number(e.target.value),
                  }))
                }
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
              <p className="text-[11px] text-neutral-500 mt-1">
                Skips customers who already received a broadcast recently.
              </p>
            </div>

            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Auto-Pause After Consecutive Errors
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={safetySettings.autoPauseOnConsecutiveFailures}
                onChange={(e) =>
                  setSafetySettings((prev) => ({
                    ...prev,
                    autoPauseOnConsecutiveFailures: Number(e.target.value),
                  }))
                }
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
              <p className="text-[11px] text-neutral-500 mt-1">
                Immediately pauses the queue if Meta returns repeated errors.
              </p>
            </div>

            <div className="flex flex-col justify-between">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Night Quiet Hours (9 PM to 9 AM IST)
                </label>
                <label className="inline-flex items-center gap-2 mt-1.5 cursor-pointer text-neutral-800 font-medium">
                  <input
                    type="checkbox"
                    checked={safetySettings.quietHoursEnabled}
                    onChange={(e) =>
                      setSafetySettings((prev) => ({
                        ...prev,
                        quietHoursEnabled: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 accent-[#00a884]"
                  />
                  <span>Hold marketing sends overnight</span>
                </label>
              </div>
              <button
                type="submit"
                disabled={savingSafety}
                className="mt-3 w-full py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium cursor-pointer"
              >
                {savingSafety ? "Saving..." : "Save Safety Limits"}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* SECTION 1: SAFE BROADCAST LAUNCHER + LIVE CAMPAIGN QUEUE MONITOR */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Safe Broadcast Queue Launcher */}
        <div className="xl:col-span-5 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[#25d366] text-white inline-flex items-center justify-center shrink-0">
                <WhatsAppLogoIcon size={11} />
              </span>
              <span>Queue Safe WhatsApp Broadcast</span>
            </h2>
            <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium">
              Staggered Queue
            </span>
          </div>

          {initialLoading ? (
            <CardListSkeleton rows={3} />
          ) : loadError ? (
            <ElementErrorState
              compact
              title="Broadcast form unavailable"
              message="Reload your lists and templates to queue a campaign."
              onRetry={() => loadMarketingData(false)}
              retrying={refreshing}
            />
          ) : (
            <form onSubmit={handleLaunchBroadcast} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Campaign Name
                </label>
                <input
                  type="text"
                  value={bcName}
                  onChange={(e) => setBcName(e.target.value)}
                  placeholder="e.g. Banquet Podium & Risers Collection"
                  className="w-full rounded-md border border-neutral-300 px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-neutral-700 mb-1">
                    Customer List
                  </label>
                  <select
                    value={bcListId}
                    onChange={(e) => setBcListId(e.target.value)}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
                  >
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.membersCount} contacts)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-medium text-neutral-700">
                      Approved Template
                    </label>
                    {canManageTemplates && (
                      <Link
                        href="/dashboard/templates"
                        className="text-[11px] text-[#008069] font-medium hover:underline"
                      >
                        + New / Edit
                      </Link>
                    )}
                  </div>
                  <select
                    value={bcTemplateId}
                    onChange={(e) => setBcTemplateId(e.target.value)}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
                  >
                    {approvedTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.category})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Anti-Spam Send Speed Selector */}
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Send Speed (Anti-Spam Queue Pacing)
                </label>
                <select
                  value={bcPacingMode}
                  onChange={(e) =>
                    setBcPacingMode(e.target.value as PacingMode)
                  }
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white font-medium"
                >
                  <option value="SAFE_STEADY">
                    Safe Steady (Recommended: 1 msg every 4s, 20s breather every 25 msgs)
                  </option>
                  <option value="EXTRA_CAREFUL">
                    Extra Careful for New Numbers (1 msg every 8s, 30s breather every 15 msgs)
                  </option>
                  <option value="WARMED_FAST">
                    Warmed High-Volume Number (1 msg every 2s, 15s breather every 50 msgs)
                  </option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-neutral-700 mb-1">
                    Skip Contacts Messaged Within
                  </label>
                  <select
                    value={bcSkipRecentHours}
                    onChange={(e) =>
                      setBcSkipRecentHours(Number(e.target.value))
                    }
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
                  >
                    <option value={0}>Send to everyone opted in (0 hrs)</option>
                    <option value={12}>Last 12 hours</option>
                    <option value={24}>Last 24 hours (Recommended)</option>
                    <option value={72}>Last 3 days</option>
                    <option value={168}>Last 7 days</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-neutral-700 mb-1">
                    Start Time (Optional Schedule)
                  </label>
                  <input
                    type="datetime-local"
                    value={bcScheduledFor}
                    onChange={(e) => setBcScheduledFor(e.target.value)}
                    className="w-full rounded-md border border-neutral-300 px-3 py-1.5 bg-white"
                  />
                </div>
              </div>

              {selectedTpl && (
                <div className="p-3 rounded-md bg-[#efeae2]/60 border border-neutral-200 space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-neutral-500">
                    <span className="font-medium">Template Preview</span>
                    <span>
                      {selectedTpl.category} • {selectedTpl.language}
                    </span>
                  </div>
                  {selectedTpl.headerText && (
                    <div className="font-semibold text-neutral-900">
                      {selectedTpl.headerText}
                    </div>
                  )}
                  <WhatsAppFormattedText
                    text={selectedTpl.bodyText}
                    className="text-neutral-800"
                  />
                  {selectedTpl.footerText && (
                    <div className="text-[11px] text-neutral-500">
                      {selectedTpl.footerText}
                    </div>
                  )}
                </div>
              )}

              <div className="p-3 rounded-md bg-neutral-50 border border-neutral-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-600">
                    Safe queue duration ({estCount} contacts):
                  </span>
                  <span className="font-semibold text-neutral-900 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-[#00a884]" />
                    <span>{formatDurationLabel(estSeconds)}</span>
                  </span>
                </div>
                <p className="text-[11px] text-neutral-500">
                  Contacts who replied STOP or were messaged recently are skipped automatically.
                </p>
              </div>

              <button
                type="submit"
                disabled={launching || !canSendBroadcasts || !bcTemplateId}
                className="w-full py-2.5 rounded-md bg-[#1da851] hover:bg-[#178c43] disabled:opacity-50 text-white font-medium inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <WhatsAppLogoIcon size={14} />
                <span>
                  {launching
                    ? "Adding to Safe Queue..."
                    : bcScheduledFor
                    ? "Schedule Safe Broadcast"
                    : "Start Safe Broadcast Queue"}
                </span>
              </button>
            </form>
          )}
        </div>

        {/* Right: Active & Past Broadcast Queue Monitor */}
        <div className="xl:col-span-7 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Broadcast Queue Monitor
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                Track live send progress, pause or resume any queue, retry failed numbers, or inspect individual recipients.
              </p>
            </div>
            {hasActiveQueue && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-medium">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Paced Queue Running</span>
              </span>
            )}
          </div>

          {initialLoading ? (
            <TableRowsSkeleton rows={5} cols={4} />
          ) : loadError ? (
            <ElementErrorState
              compact
              title="Could not load broadcast queue"
              message={loadError}
              onRetry={() => loadMarketingData(false)}
              retrying={refreshing}
            />
          ) : broadcasts.length === 0 ? (
            <div className="p-6 rounded-md bg-neutral-50 border border-neutral-200 text-center text-xs text-neutral-500">
              No broadcasts queued yet. Choose a customer list and template on the left to start your first safe queue.
            </div>
          ) : (
            <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
              {broadcasts.map((b) => {
                const processed =
                  b.sentCount + b.skippedCount + b.failedCount;
                const pct =
                  b.totalRecipients > 0
                    ? Math.min(
                        100,
                        Math.round((processed / b.totalRecipients) * 100)
                      )
                    : 100;
                const isActive =
                  b.status === "SENDING" ||
                  b.status === "QUEUED" ||
                  b.status === "SCHEDULED";
                const isPaused = b.status === "PAUSED";
                const busy = busyCampaignId === b.id;

                return (
                  <div
                    key={b.id}
                    className="p-4 rounded-lg border border-neutral-200 bg-neutral-50/70 space-y-3 text-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-neutral-900 text-sm">
                            {b.name}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${getStatusBadgeStyle(
                              b.status
                            )}`}
                          >
                            {b.status}
                          </span>
                          <span className="text-[11px] text-neutral-500">
                            1 msg / {b.delaySeconds}s
                          </span>
                        </div>
                        <div className="text-neutral-500 mt-0.5">
                          List: <strong className="text-neutral-700">{b.listName}</strong> • Template:{" "}
                          <span className="font-mono text-neutral-700">
                            {b.templateName}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-xs font-semibold text-neutral-800">
                          {b.totalRecipients} contacts
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {new Date(b.createdAt).toLocaleDateString()}{" "}
                          {new Date(b.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1.5">
                      <div className="w-full h-2 rounded-full bg-neutral-200 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isPaused
                              ? "bg-amber-500"
                              : b.failedCount > 0 && b.queuedCount === 0
                              ? "bg-amber-600"
                              : "bg-[#00a884]"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-600">
                        <div className="flex flex-wrap items-center gap-3">
                          <span>
                            <strong className="text-emerald-700">
                              {b.sentCount}
                            </strong>{" "}
                            sent
                          </span>
                          <span>
                            <strong className="text-blue-700">
                              {b.queuedCount}
                            </strong>{" "}
                            waiting in queue
                          </span>
                          {b.skippedCount > 0 && (
                            <span>
                              <strong>{b.skippedCount}</strong> skipped
                            </span>
                          )}
                          {b.failedCount > 0 && (
                            <span className="text-red-700 font-medium">
                              <strong>{b.failedCount}</strong> failed
                            </span>
                          )}
                        </div>
                        <span>
                          {processed}/{b.totalRecipients} ({pct}%)
                        </span>
                      </div>
                    </div>

                    {b.pausedReason && (
                      <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2 text-[11px]">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                        <span>{b.pausedReason}</span>
                      </div>
                    )}

                    {/* Queue Action Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-neutral-200/80">
                      <button
                        type="button"
                        onClick={() => openInspector(b)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white hover:bg-neutral-100 border border-neutral-300 text-neutral-800 font-medium cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View Recipients</span>
                      </button>

                      {canSendBroadcasts && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {isActive && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleCampaignControl(b.id, "pause_broadcast")
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 font-medium cursor-pointer"
                            >
                              <Pause className="w-3 h-3" />
                              <span>Pause</span>
                            </button>
                          )}

                          {isPaused && b.queuedCount > 0 && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleCampaignControl(b.id, "resume_broadcast")
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium cursor-pointer"
                            >
                              <Play className="w-3 h-3" />
                              <span>Resume Queue</span>
                            </button>
                          )}

                          {b.failedCount > 0 && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleCampaignControl(
                                  b.id,
                                  "retry_failed_broadcast"
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white hover:bg-neutral-100 border border-neutral-300 text-neutral-800 font-medium cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Retry Failed ({b.failedCount})</span>
                            </button>
                          )}

                          {(isActive || isPaused) && b.queuedCount > 0 && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleCampaignControl(b.id, "cancel_broadcast")
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white hover:bg-red-50 border border-red-200 text-red-700 font-medium cursor-pointer"
                            >
                              <XCircle className="w-3 h-3" />
                              <span>Cancel Rest</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* SECTION 2: ACRIO Customer List Builder + Saved Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Build a Customer List with ACRIO
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Describe who you want to message in plain words and preview matching contacts.
            </p>
          </div>

          <form onSubmit={handleAcrioPreview} className="space-y-3 text-xs">
            <textarea
              rows={2}
              value={acrioPrompt}
              onChange={(e) => setAcrioPrompt(e.target.value)}
              placeholder="e.g. Schools and colleges looking for student awards"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-neutral-900"
            />
            <div className="flex flex-wrap gap-1.5">
              {[
                "Hotels and banquet buyers",
                "Schools, colleges & student award leads",
                "Industrial & custom fabrication clients",
                "Repeat buyers over Rs 30000",
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAcrioPrompt(preset)}
                  className="px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs cursor-pointer"
                >
                  {preset}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={previewLoading}
              className="px-4 py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium cursor-pointer"
            >
              {previewLoading
                ? "Finding matching contacts..."
                : "Find Matching Contacts"}
            </button>
          </form>

          {previewLoading && <CardListSkeleton rows={2} />}

          {previewError && !previewLoading && (
            <ElementErrorState
              compact
              title="Could not preview customer group"
              message={previewError}
              onRetry={() => {
                const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
                void handleAcrioPreview(fakeEvent);
              }}
            />
          )}

          {acrioPreview && !previewLoading && (
            <div className="p-4 rounded-md bg-neutral-50 border border-neutral-200 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  List Name
                </label>
                <input
                  type="text"
                  value={listNameDraft}
                  onChange={(e) => setListNameDraft(e.target.value)}
                  className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-900"
                />
              </div>
              <p className="text-neutral-600">
                {acrioPreview.filterExplanation}
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {acrioPreview.matchedCustomers.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between bg-white px-3 py-1.5 rounded border border-neutral-200"
                  >
                    <div>
                      <span className="font-medium text-neutral-900">
                        {c.name}
                      </span>{" "}
                      <span className="text-neutral-500">({c.phone})</span>
                    </div>
                    <span className="text-neutral-600">
                      Spent ₹{c.lifetimeValueInr.toLocaleString("en-IN")}
                    </span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleSaveAcrioList}
                disabled={savingList}
                className="w-full py-2 rounded-md bg-[#1da851] hover:bg-[#178c43] text-white font-medium cursor-pointer"
              >
                {savingList ? "Saving..." : "Save Customer List"}
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-6 bg-white rounded-lg border border-neutral-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-900">
            Saved Customer Lists
          </h2>
          {initialLoading ? (
            <CardListSkeleton rows={3} />
          ) : loadError ? (
            <ElementErrorState
              compact
              title="Could not load saved lists"
              message={loadError}
              onRetry={() => loadMarketingData(false)}
              retrying={refreshing}
            />
          ) : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto">
              {lists.map((l) => (
                <div
                  key={l.id}
                  className="p-3.5 rounded-md border border-neutral-200 bg-neutral-50/60 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-neutral-900">
                      {l.name}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded bg-white border border-neutral-200 text-neutral-700 text-[11px] font-medium">
                        {l.membersCount} contacts
                      </span>
                      {canSendBroadcasts && (
                        <button
                          type="button"
                          onClick={() => handleDeleteList(l.id, l.name)}
                          title="Remove list"
                          className="p-1 text-neutral-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-neutral-600">{l.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* SECTION 3: Product & Custom Short Links on ccapl.cc */}
      <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Product &amp; Custom Short Links ({SHORTLINK_PUBLIC_DOMAIN}/&lt;6-char&gt;)
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Every product and machine automatically gets a 6-character {SHORTLINK_PUBLIC_DOMAIN} short link. Leave the 6-char ID blank below to auto-generate one, or enter an exact 6-character code (letters, numbers, -, @, +, $, =).
            </p>
          </div>
          <button
            type="button"
            onClick={handleSyncProductLinks}
            disabled={syncingCatalogLinks}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-800 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                syncingCatalogLinks ? "animate-spin" : ""
              }`}
            />
            <span>
              {syncingCatalogLinks
                ? "Syncing Catalogs..."
                : "Sync Classic Concepts + CE53 Links"}
            </span>
          </button>
        </div>

        <form
          onSubmit={handleCreateLink}
          className="grid grid-cols-1 md:grid-cols-5 gap-2.5 text-xs"
        >
          <input
            type="text"
            required
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            placeholder="Custom title (e.g. Diwali Offer)"
            className="rounded-md border border-neutral-300 px-3 py-2"
          />
          <input
            type="text"
            maxLength={6}
            value={linkCode}
            onChange={(e) => setLinkCode(e.target.value)}
            placeholder="Optional 6-char ID (auto)"
            className="rounded-md border border-neutral-300 px-3 py-2 font-mono"
          />
          <input
            type="url"
            required
            value={linkTargetUrl}
            onChange={(e) => setLinkTargetUrl(e.target.value)}
            placeholder="Destination https://..."
            className="rounded-md border border-neutral-300 px-3 py-2"
          />
          <select
            value={linkType}
            onChange={(e) => setLinkType(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 bg-white"
          >
            <option value="CATALOG">Catalog / Product</option>
            <option value="CUSTOM_QUOTE">Custom Quote</option>
            <option value="PAYMENT">Payment Link</option>
            <option value="ORDER_TRACKING">Order Status</option>
          </select>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium px-4 py-2 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Custom Link</span>
          </button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-neutral-100">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {(
              [
                { key: "ALL", label: `All (${linkCounts.all})` },
                {
                  key: "CLASSIC_CONCEPTS",
                  label: `Classic Concepts (${linkCounts.cc})`,
                },
                {
                  key: "CLASSIC_EDGE_53",
                  label: `Classic Edge 53 (${linkCounts.ce})`,
                },
                { key: "MANUAL", label: `Manual (${linkCounts.manual})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setLinkSourceFilter(tab.key)}
                className={`px-2.5 py-1 rounded-md border font-medium cursor-pointer transition ${
                  linkSourceFilter === tab.key
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={linkSearch}
              onChange={(e) => setLinkSearch(e.target.value)}
              placeholder="Search product name, SKU, or 6-char ID..."
              className="w-full rounded-md border border-neutral-300 pl-8 pr-3 py-1.5 text-xs"
            />
          </div>
        </div>

        {initialLoading ? (
          <CardListSkeleton rows={2} />
        ) : loadError ? (
          <ElementErrorState
            compact
            title="Could not load short links"
            message={loadError}
            onRetry={() => loadMarketingData(false)}
            retrying={refreshing}
          />
        ) : filteredCustomLinks.length === 0 ? (
          <p className="text-xs text-neutral-500 text-center py-6">
            No short links matched your filter.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-h-[480px] overflow-y-auto pr-1">
            {filteredCustomLinks.map((lnk) => {
              const kind = classifyLinkBrand(lnk);
              return (
                <div
                  key={lnk.id}
                  className="p-3.5 rounded-md border border-neutral-200 bg-neutral-50 flex flex-col justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-neutral-900 truncate">
                        {lnk.title}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white border border-neutral-200 text-neutral-700 text-[11px] font-medium shrink-0">
                        {lnk.clicksCount} clicks
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          kind === "CLASSIC_EDGE_53"
                            ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                            : kind === "CLASSIC_CONCEPTS"
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : "bg-neutral-200/70 text-neutral-700"
                        }`}
                      >
                        {kind === "CLASSIC_EDGE_53"
                          ? "Classic Edge 53"
                          : kind === "CLASSIC_CONCEPTS"
                          ? "Classic Concepts"
                          : "Custom"}
                      </span>
                      <span className="font-mono text-xs text-blue-800 truncate">
                        {SHORTLINK_PUBLIC_DOMAIN}/{lnk.code}
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-500 truncate mt-1">
                      {lnk.targetUrl}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => copyShortLink(lnk.code)}
                      className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded bg-white border border-neutral-300 hover:bg-neutral-100 text-xs font-medium text-neutral-800 cursor-pointer"
                    >
                      {copiedCode === lnk.code ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy Link</span>
                        </>
                      )}
                    </button>
                    <a
                      href={`/${lnk.code}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2.5 py-1.5 rounded bg-white border border-neutral-300 hover:bg-neutral-100 text-neutral-700"
                      title="Open destination"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recipient Queue Inspector Modal (with Element-Wise Skeleton & Retry!) */}
      {inspectBroadcast && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-neutral-200 max-w-3xl w-full max-h-[85vh] flex flex-col shadow-xl">
            <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Recipient Queue Status: {inspectBroadcast.name}
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Individual staggered delivery schedule, opt-out skips, and error reasons.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => loadBroadcastRecipients(inspectBroadcast.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-700 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${
                      recipientsLoading ? "animate-spin" : ""
                    }`}
                  />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInspectBroadcast(null)}
                  className="p-1.5 rounded hover:bg-neutral-100 text-neutral-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-5 overflow-y-auto flex-1">
              {recipientsLoading && recipientRows.length === 0 ? (
                <TableRowsSkeleton rows={6} cols={4} />
              ) : recipientsError ? (
                <ElementErrorState
                  title="Could not load recipient queue"
                  message={recipientsError}
                  onRetry={() => loadBroadcastRecipients(inspectBroadcast.id)}
                  retrying={recipientsLoading}
                />
              ) : recipientRows.length === 0 ? (
                <p className="text-xs text-neutral-500 text-center py-6">
                  Legacy broadcast campaign (sent before per-recipient queue logging).
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-neutral-200 text-neutral-500">
                        <th className="py-2 pr-3 font-medium">Customer</th>
                        <th className="py-2 px-3 font-medium">Status</th>
                        <th className="py-2 px-3 font-medium">
                          Scheduled / Sent At
                        </th>
                        <th className="py-2 pl-3 font-medium">
                          Notes / Skip Reason
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200">
                      {recipientRows.map((r) => (
                        <tr key={r.id}>
                          <td className="py-2.5 pr-3">
                            <div className="font-medium text-neutral-900">
                              {r.customerName || "Customer"}
                            </div>
                            <div className="font-mono text-[11px] text-neutral-500">
                              {r.customerPhone}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            {["QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "FAILED"].includes(
                              String(r.status).toUpperCase()
                            ) ? (
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] ${getStatusBadgeStyle(
                                  r.status
                                )}`}
                              >
                                <WhatsAppMessageTicks
                                  status={r.status}
                                  showLabel
                                  size={13}
                                />
                              </span>
                            ) : (
                              <span
                                className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${getStatusBadgeStyle(
                                  r.status
                                )}`}
                              >
                                {r.status}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-neutral-600">
                            {r.sentAt
                              ? `Sent ${new Date(r.sentAt).toLocaleTimeString()}`
                              : `Scheduled ${new Date(
                                  r.scheduledAt
                                ).toLocaleTimeString()}`}
                          </td>
                          <td className="py-2.5 pl-3 text-neutral-600">
                            {r.skipOrErrorReason || "Ready"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
