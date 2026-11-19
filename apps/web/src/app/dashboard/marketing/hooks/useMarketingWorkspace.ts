"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parseLocalIstToUtcIso, formatShortLinkUrl } from "@cc/ui";
import { subscribeRealtimeEvent } from "@/lib/realtime-client";
import {
  DEFAULT_QUEUE_SAFETY_SETTINGS,
  type AcrioPreview,
  type BroadcastItem,
  type MarketingInitialPayload,
  type PacingMode,
  type QueueSafetySettings,
  type RecipientQueueRow,
} from "@/app/dashboard/marketing/types";

async function fetchMarketingOverview(): Promise<MarketingInitialPayload> {
  const res = await fetch("/api/marketing", { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(
      data.error ||
        "Could not load broadcast queue, customer lists, and short links."
    );
  }
  return {
    canManageTemplates: Boolean(data.canManageTemplates),
    canSendBroadcasts: Boolean(data.canSendBroadcasts),
    templates: data.templates || [],
    lists: data.lists || [],
    broadcasts: data.broadcasts || [],
    customLinks: data.customLinks || [],
    queueSettings: data.queueSettings,
  };
}

async function fetchBroadcastRecipients(
  broadcastId: string
): Promise<RecipientQueueRow[]> {
  const res = await fetch(
    `/api/marketing?broadcastId=${encodeURIComponent(broadcastId)}`,
    { cache: "no-store" }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Could not load recipient queue details.");
  }
  return data.recipients || [];
}

export function useMarketingWorkspace(initialData?: MarketingInitialPayload) {
  const queryClient = useQueryClient();

  const [feedback, setFeedback] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [safetyDraft, setSafetyDraft] = useState<QueueSafetySettings>(
    initialData?.queueSettings ?? DEFAULT_QUEUE_SAFETY_SETTINGS
  );
  const [savingSafety, setSavingSafety] = useState<boolean>(false);

  const [bcName, setBcName] = useState<string>("");
  const [bcListId, setBcListId] = useState<string>(
    initialData?.lists?.[0]?.id || ""
  );
  const [bcTemplateId, setBcTemplateId] = useState<string>(() => {
    const tpls = initialData?.templates ?? [];
    const approved = tpls.find((t) => t.approvalStatus === "APPROVED");
    return approved?.id || tpls[0]?.id || "";
  });
  const [bcPacingMode, setBcPacingMode] = useState<PacingMode>(
    initialData?.queueSettings?.defaultPacingMode || "SAFE_STEADY"
  );
  const [bcSkipRecentHours, setBcSkipRecentHours] = useState<number>(
    Number(initialData?.queueSettings?.skipRecentHours ?? 24)
  );
  const [bcScheduledFor, setBcScheduledFor] = useState<string>("");
  const [launching, setLaunching] = useState<boolean>(false);
  const [busyCampaignId, setBusyCampaignId] = useState<string>("");

  const [inspectBroadcast, setInspectBroadcast] =
    useState<BroadcastItem | null>(null);

  const [acrioPrompt, setAcrioPrompt] = useState<string>(
    "Hotels, banquets, and repeat buyers with orders over Rs 20000"
  );
  const [acrioPreview, setAcrioPreview] = useState<AcrioPreview | null>(null);
  const [listNameDraft, setListNameDraft] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string>("");
  const [savingList, setSavingList] = useState<boolean>(false);

  const [syncingCatalogLinks, setSyncingCatalogLinks] =
    useState<boolean>(false);

  const flashMessage = useCallback((msg: string, isError = false) => {
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
  }, []);

  const overviewQuery = useQuery({
    queryKey: ["marketing", "overview"],
    queryFn: fetchMarketingOverview,
    initialData,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const list = query.state.data?.broadcasts ?? [];
      const active = list.some(
        (b) =>
          b.status === "SENDING" ||
          b.status === "QUEUED" ||
          b.status === "SCHEDULED"
      );
      return active ? 8000 : false;
    },
  });

  const payload = overviewQuery.data;
  const templates = payload?.templates ?? [];
  const lists = payload?.lists ?? [];
  const broadcasts = payload?.broadcasts ?? [];
  const customLinks = payload?.customLinks ?? [];
  const canManageTemplates = Boolean(payload?.canManageTemplates);
  const canSendBroadcasts = Boolean(payload?.canSendBroadcasts);
  const queueSettings =
    payload?.queueSettings ?? DEFAULT_QUEUE_SAFETY_SETTINGS;

  useEffect(() => {
    if (payload?.queueSettings) {
      setSafetyDraft(payload.queueSettings);
    }
  }, [payload?.queueSettings]);

  useEffect(() => {
    if (!bcListId && lists[0]?.id) {
      setBcListId(lists[0].id);
    }
  }, [bcListId, lists]);

  useEffect(() => {
    if (!bcTemplateId && templates.length > 0) {
      const approved = templates.find((t) => t.approvalStatus === "APPROVED");
      setBcTemplateId(approved?.id || templates[0]?.id || "");
    }
  }, [bcTemplateId, templates]);

  const recipientsQuery = useQuery({
    queryKey: ["marketing", "recipients", inspectBroadcast?.id ?? ""],
    queryFn: () => fetchBroadcastRecipients(inspectBroadcast!.id),
    enabled: Boolean(inspectBroadcast?.id),
    staleTime: 5_000,
  });

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

  const inspectBroadcastIdRef = useRef<string | null>(null);
  inspectBroadcastIdRef.current = inspectBroadcast?.id ?? null;

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const onProgress = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: ["marketing", "overview"],
        });
        if (inspectBroadcastIdRef.current) {
          void queryClient.invalidateQueries({
            queryKey: [
              "marketing",
              "recipients",
              inspectBroadcastIdRef.current,
            ],
          });
        }
      }, 250);
    };

    const unsubProgress = subscribeRealtimeEvent(
      "broadcast:progress",
      onProgress
    );
    const unsubTpl = subscribeRealtimeEvent("template:updated", onProgress);

    return () => {
      unsubProgress();
      unsubTpl();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [queryClient]);

  const refreshAll = useCallback(async () => {
    await overviewQuery.refetch();
  }, [overviewQuery]);

  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.approvalStatus === "APPROVED"),
    [templates]
  );

  const handleLaunchBroadcast = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!bcListId || !bcTemplateId || launching) return;
      setLaunching(true);
      try {
        const scheduledIso = parseLocalIstToUtcIso(bcScheduledFor);
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
          await queryClient.invalidateQueries({
            queryKey: ["marketing", "overview"],
          });
        } else {
          flashMessage(data.error || "Could not queue broadcast.", true);
        }
      } catch {
        flashMessage("Network error while queueing broadcast.", true);
      } finally {
        setLaunching(false);
      }
    },
    [
      bcListId,
      bcTemplateId,
      bcName,
      bcPacingMode,
      bcSkipRecentHours,
      bcScheduledFor,
      launching,
      flashMessage,
      queryClient,
    ]
  );

  const handleCampaignControl = useCallback(
    async (
      broadcastId: string,
      action:
        | "pause_broadcast"
        | "resume_broadcast"
        | "retry_failed_broadcast"
        | "cancel_broadcast"
    ) => {
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
          await queryClient.invalidateQueries({
            queryKey: ["marketing", "overview"],
          });
          if (inspectBroadcastIdRef.current === broadcastId) {
            await queryClient.invalidateQueries({
              queryKey: ["marketing", "recipients", broadcastId],
            });
          }
        } else {
          flashMessage(data.error || "Could not update broadcast queue.", true);
        }
      } finally {
        setBusyCampaignId("");
      }
    },
    [flashMessage, queryClient]
  );

  const handleSaveSafetySettings = useCallback(
    async (e: React.FormEvent): Promise<boolean> => {
      e.preventDefault();
      setSavingSafety(true);
      try {
        const res = await fetch("/api/marketing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update_queue_settings",
            ...safetyDraft,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) {
          if (data.queueSettings) setSafetyDraft(data.queueSettings);
          flashMessage("Saved anti-spam broadcast protection settings.");
          await queryClient.invalidateQueries({
            queryKey: ["marketing", "overview"],
          });
          return true;
        }
        flashMessage(data.error || "Could not save safety settings.", true);
        return false;
      } finally {
        setSavingSafety(false);
      }
    },
    [safetyDraft, flashMessage, queryClient]
  );

  const handleAcrioPreview = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
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
    },
    [acrioPrompt]
  );

  const handleSaveAcrioList = useCallback(async () => {
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
        await queryClient.invalidateQueries({
          queryKey: ["marketing", "overview"],
        });
      } else {
        flashMessage(data.error || "Permission required to save lists.", true);
      }
    } finally {
      setSavingList(false);
    }
  }, [acrioPreview, savingList, listNameDraft, acrioPrompt, flashMessage, queryClient]);

  const handleDeleteList = useCallback(
    async (listId: string, name: string) => {
      if (!window.confirm(`Remove customer list "${name}"?`)) return;
      const res = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_list", listId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        flashMessage("Customer list removed.");
        await queryClient.invalidateQueries({
          queryKey: ["marketing", "overview"],
        });
      } else {
        flashMessage(data.error || "Could not delete list.", true);
      }
    },
    [flashMessage, queryClient]
  );

  const handleCreateLink = useCallback(
    async (input: {
      title: string;
      code: string;
      targetUrl: string;
      linkType: string;
    }): Promise<boolean> => {
      const res = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_custom_link",
          title: input.title,
          code: input.code || undefined,
          targetUrl: input.targetUrl,
          linkType: input.linkType,
          utmCampaign: "whatsapp_share",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        flashMessage(`Created ${formatShortLinkUrl(data.link.code)}`);
        await queryClient.invalidateQueries({
          queryKey: ["marketing", "overview"],
        });
        return true;
      }
      flashMessage(data.error || "Could not create short link.", true);
      return false;
    },
    [flashMessage, queryClient]
  );

  const handleSyncProductLinks = useCallback(async () => {
    setSyncingCatalogLinks(true);
    try {
      const res = await fetch("/api/cache/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        await queryClient.invalidateQueries({
          queryKey: ["marketing", "overview"],
        });
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
  }, [flashMessage, queryClient]);

  return {
    initialLoading: overviewQuery.isLoading && !payload,
    refreshing: overviewQuery.isFetching,
    loadError:
      overviewQuery.error instanceof Error
        ? overviewQuery.error.message
        : "",
    canManageTemplates,
    canSendBroadcasts,
    templates,
    approvedTemplates,
    lists,
    broadcasts,
    customLinks,
    queueSettings,
    hasActiveQueue,
    feedback,
    errorMsg,
    safetyDraft,
    setSafetyDraft,
    savingSafety,
    bcName,
    setBcName,
    bcListId,
    setBcListId,
    bcTemplateId,
    setBcTemplateId,
    bcPacingMode,
    setBcPacingMode,
    bcSkipRecentHours,
    setBcSkipRecentHours,
    bcScheduledFor,
    setBcScheduledFor,
    launching,
    busyCampaignId,
    inspectBroadcast,
    setInspectBroadcast,
    recipientRows: recipientsQuery.data ?? [],
    recipientsLoading: recipientsQuery.isFetching,
    recipientsError:
      recipientsQuery.error instanceof Error
        ? recipientsQuery.error.message
        : "",
    refetchRecipients: () => recipientsQuery.refetch(),
    acrioPrompt,
    setAcrioPrompt,
    acrioPreview,
    listNameDraft,
    setListNameDraft,
    previewLoading,
    previewError,
    savingList,
    syncingCatalogLinks,
    refreshAll,
    handleLaunchBroadcast,
    handleCampaignControl,
    handleSaveSafetySettings,
    handleAcrioPreview,
    handleSaveAcrioList,
    handleDeleteList,
    handleCreateLink,
    handleSyncProductLinks,
  };
}
