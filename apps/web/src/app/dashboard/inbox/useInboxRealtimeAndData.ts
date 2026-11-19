"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ChatMessage,
  ConversationDetailBundle,
  ConversationSummary,
  InitialInboxPayload,
  TeamOption,
} from "@/lib/inbox-server-data";
import { subscribeRealtimeEvent } from "@/lib/realtime-client";
import { useInboxStore } from "@/lib/inbox-store";
import {
  appendOptimisticMessageToCache,
  attachInboxRealtimeQuerySync,
  fetchConversationDetail,
  fetchConversationDrawer,
  fetchInboxThreads,
  inboxKeys,
  loadOlderMessagesIntoCache,
  mergeServerDetailWithCached,
  patchOptimisticMessageInCache,
  prefetchConversationDetail,
} from "@/lib/inbox-queries";

export function useInboxRealtimeAndData({
  initialData,
  selectedId,
  setSelectedId,
  setMobilePane,
  setTeams,
  setComposerMode,
  setTemplateDialogOpen,
  setReplyText,
  composerInputRef,
  syncProfileFields,
  showToast,
}: {
  initialData: InitialInboxPayload;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  setMobilePane: (pane: "LIST" | "CHAT") => void;
  setTeams: React.Dispatch<React.SetStateAction<TeamOption[]>>;
  setComposerMode: (m: "REPLY" | "TEMPLATE" | "NOTE") => void;
  setTemplateDialogOpen: (open: boolean) => void;
  setReplyText: (next: string | ((prev: string) => string)) => void;
  composerInputRef: React.RefObject<HTMLTextAreaElement | null>;
  syncProfileFields: (bundle: ConversationDetailBundle) => void;
  showToast: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const quickFilter = useInboxStore((s) => s.quickFilter);
  const teamFilter = useInboxStore((s) => s.teamFilter);
  const staffFilter = useInboxStore((s) => s.staffFilter);
  const searchQuery = useInboxStore((s) => s.searchQuery);
  const showRightDrawer = useInboxStore((s) => s.showRightDrawer);
  const mobilePane = useInboxStore((s) => s.mobilePane);
  const shouldIncludeDrawer = showRightDrawer || mobilePane === "INFO";

  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [nowMs, setNowMs] = useState<number>(initialData.serverNowMs);
  const [callbackReqs, setCallbackReqs] = useState<Record<string, unknown>[]>(
    []
  );
  const [unreadMentionConvIds, setUnreadMentionConvIds] = useState<string[]>(
    []
  );

  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;
  const optimisticSeqRef = useRef<number>(0);
  const recentLocalMsgIdsRef = useRef<Map<string, number>>(new Map());
  const threadRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const lastSyncedProfileConvIdRef = useRef<string | null>(
    initialData.initialDetail?.conversation.id || null
  );

  const threadsQuery = useQuery<ConversationSummary[]>({
    queryKey: inboxKeys.threads,
    queryFn: fetchInboxThreads,
    initialData: initialData.threads,
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const threads = threadsQuery.data ?? initialData.threads;
  const refreshingThreads = threadsQuery.isFetching;
  const threadsError = threadsQuery.isError
    ? threadsQuery.error instanceof Error
      ? threadsQuery.error.message
      : "Could not refresh chats list right now."
    : "";

  const detailQuery = useQuery<ConversationDetailBundle>({
    queryKey: inboxKeys.detail(selectedId || "__none__"),
    enabled: Boolean(selectedId),
    staleTime: 8_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    initialData:
      selectedId &&
      selectedId === initialData.initialSelectedId &&
      initialData.initialDetail
        ? initialData.initialDetail
        : undefined,
    queryFn: async () => {
      const targetId = selectedId!;
      const data = await fetchConversationDetail(targetId, {
        includeDrawer: shouldIncludeDrawer,
      });
      if (Array.isArray(data.teams) && data.teams.length > 0) {
        setTeams((prev) =>
          prev.length > 0 ? prev : (data.teams as TeamOption[])
        );
      }
      const merged = mergeServerDetailWithCached(queryClient, targetId, data);
      queryClient.setQueryData<ConversationSummary[]>(
        inboxKeys.threads,
        (prev) =>
          prev
            ? prev.map((t) =>
                t.id === targetId ? { ...t, unreadCount: 0 } : t
              )
            : prev
      );
      return merged;
    },
  });
  const detail = detailQuery.data ?? null;
  const syncingThread = Boolean(selectedId) && detailQuery.isFetching;
  const detailError =
    selectedId && !detail && detailQuery.isError
      ? detailQuery.error instanceof Error
        ? detailQuery.error.message
        : "Could not load this conversation right now."
      : "";

  const callbackConvIds = useMemo(
    () => callbackReqs.map((r) => String(r.conversation_id)),
    [callbackReqs]
  );

  const pendingCallback = useMemo(() => {
    const row = selectedId
      ? callbackReqs.find((r) => String(r.conversation_id) === selectedId)
      : undefined;
    return row
      ? {
          id: String(row.id),
          slot: String(row.preferred_slot || ""),
          topic: String(row.topic || ""),
          phone: String(row.customer_phone || ""),
          createdAt: String(row.created_at || ""),
        }
      : null;
  }, [callbackReqs, selectedId]);

  useEffect(() => {
    let cancelled = false;
    const loadSignals = async () => {
      try {
        const [cbRes, ntfRes] = await Promise.all([
          fetch("/api/callback-requests?status=PENDING", {
            cache: "no-store",
          }),
          fetch("/api/notifications", { cache: "no-store" }),
        ]);
        const [cbData, ntfData] = await Promise.all([
          cbRes.json().catch(() => ({})),
          ntfRes.json().catch(() => ({})),
        ]);
        if (cancelled) return;
        if (cbData?.ok) {
          setCallbackReqs(
            (cbData.requests || []) as Record<string, unknown>[]
          );
        }
        if (ntfData?.ok) {
          const unreadIds = (
            (ntfData.notifications || []) as Record<string, unknown>[]
          )
            .filter((n) => !n.isRead && n.type !== "CALLBACK")
            .map((n) => String(n.conversationId));
          setUnreadMentionConvIds(Array.from(new Set(unreadIds)));
        }
      } catch {
        // ignore transient signal fetch errors
      }
    };
    void loadSignals();
    const unsubCb = subscribeRealtimeEvent("callback:new", loadSignals);
    const unsubMention = subscribeRealtimeEvent("staff:mention", loadSignals);
    const onFocus = () => {
      if (document.visibilityState === "visible") {
        void loadSignals();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      unsubCb();
      unsubMention();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === "r") {
        e.preventDefault();
        setComposerMode("REPLY");
        setTimeout(() => composerInputRef.current?.focus(), 20);
      } else if (k === "n") {
        e.preventDefault();
        setComposerMode("NOTE");
        setTimeout(() => composerInputRef.current?.focus(), 20);
      } else if (k === "t") {
        e.preventDefault();
        setComposerMode("TEMPLATE");
        setTemplateDialogOpen(true);
      } else if (k === "a") {
        e.preventDefault();
        setComposerMode("NOTE");
        setTimeout(() => {
          setReplyText((prev) =>
            prev.includes("@ACRIO") ? prev : `@ACRIO ${prev}`
          );
          composerInputRef.current?.focus();
        }, 20);
      } else if (k === "d") {
        e.preventDefault();
        useInboxStore.getState().setShowRightDrawer((p) => !p);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [composerInputRef, setComposerMode, setReplyText, setTemplateDialogOpen]);

  async function markPendingCallbackDone() {
    if (!pendingCallback) return;
    const targetId = pendingCallback.id;
    setCallbackReqs((prev) => prev.filter((r) => String(r.id) !== targetId));
    await fetch("/api/callback-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: targetId, status: "DONE" }),
    });
    showToast("Marked as called.");
  }

  const appendOptimisticMessage = useCallback(
    (convId: string, msg: ChatMessage, threadPreviewText?: string) => {
      appendOptimisticMessageToCache(queryClient, {
        convId,
        msg,
        currentUserId: initialData.currentUserId,
        currentUserName: initialData.currentUserName,
        threadPreviewText,
      });
    },
    [initialData.currentUserId, initialData.currentUserName, queryClient]
  );

  const patchOptimisticMessage = useCallback(
    (
      convId: string,
      tempId: string,
      patch: {
        id?: string;
        deliveryStatus?: string;
        waMessageId?: string | null;
        metadata?: Record<string, unknown> | null;
        body?: string;
      }
    ) => {
      patchOptimisticMessageInCache(
        queryClient,
        convId,
        tempId,
        patch,
        recentLocalMsgIdsRef.current
      );
    },
    [queryClient]
  );

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!detail) return;
    if (lastSyncedProfileConvIdRef.current !== detail.conversation.id) {
      lastSyncedProfileConvIdRef.current = detail.conversation.id;
      syncProfileFields(detail);
    }
  }, [detail, syncProfileFields]);

  const hydratingDrawerForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId || !shouldIncludeDrawer || !detail || detail.drawerHydrated !== false) {
      return;
    }
    if (hydratingDrawerForRef.current === selectedId) return;
    hydratingDrawerForRef.current = selectedId;
    let cancelled = false;
    void fetchConversationDrawer(selectedId)
      .then((drawer) => {
        if (cancelled) return;
        queryClient.setQueryData<ConversationDetailBundle>(
          inboxKeys.detail(selectedId),
          (prev) => (prev ? { ...prev, ...drawer, drawerHydrated: true } : prev)
        );
      })
      .catch(() => {})
      .finally(() => {
        if (hydratingDrawerForRef.current === selectedId) {
          hydratingDrawerForRef.current = null;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detail, queryClient, selectedId, shouldIncludeDrawer]);

  const refreshThreadsSilently = useCallback(
    async (_manual = false) => {
      await queryClient.refetchQueries({ queryKey: inboxKeys.threads });
    },
    [queryClient]
  );

  const scheduleThreadsRefresh = useCallback(
    (delayMs = 220) => {
      if (threadRefreshTimerRef.current) {
        clearTimeout(threadRefreshTimerRef.current);
      }
      threadRefreshTimerRef.current = setTimeout(() => {
        threadRefreshTimerRef.current = null;
        void queryClient.invalidateQueries({ queryKey: inboxKeys.threads });
      }, delayMs);
    },
    [queryClient]
  );

  const fetchAndCacheDetail = useCallback(
    async (convId: string, updateProfileInputs = false) => {
      try {
        const bundle = await queryClient.fetchQuery<ConversationDetailBundle>({
          queryKey: inboxKeys.detail(convId),
          staleTime: 0,
          queryFn: async () => {
            const data = await fetchConversationDetail(convId);
            if (Array.isArray(data.teams) && data.teams.length > 0) {
              setTeams((prev) =>
                prev.length > 0 ? prev : (data.teams as TeamOption[])
              );
            }
            const merged = mergeServerDetailWithCached(
              queryClient,
              convId,
              data
            );
            queryClient.setQueryData<ConversationSummary[]>(
              inboxKeys.threads,
              (prev) =>
                prev
                  ? prev.map((t) =>
                      t.id === convId ? { ...t, unreadCount: 0 } : t
                    )
                  : prev
            );
            return merged;
          },
        });
        if (
          selectedIdRef.current === convId &&
          (updateProfileInputs ||
            lastSyncedProfileConvIdRef.current !== convId)
        ) {
          lastSyncedProfileConvIdRef.current = convId;
          syncProfileFields(bundle);
        }
      } catch {
        // Error state surfaced cleanly via detailQuery
      }
    },
    [queryClient, setTeams, syncProfileFields]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const chatParam = new URLSearchParams(window.location.search).get("chat");
    if (chatParam) {
      setMobilePane("CHAT");
      if (chatParam !== selectedIdRef.current) {
        setSelectedId(chatParam);
        selectedIdRef.current = chatParam;
        lastSyncedProfileConvIdRef.current = null;
        void fetchAndCacheDetail(chatParam, true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prefetchDetail = useCallback(
    (convId: string) => {
      if (!convId || convId === selectedIdRef.current) return;
      void prefetchConversationDetail(queryClient, convId);
    },
    [queryClient]
  );

  useEffect(() => {
    if (threads.length === 0) return;
    const candidates = threads
      .filter((t) => t.id !== selectedIdRef.current)
      .slice(0, 3);
    if (candidates.length === 0) return;
    const timer = setTimeout(() => {
      for (const t of candidates) {
        prefetchDetail(t.id);
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetchDetail]);

  const handleLoadOlderMessages = useCallback(async () => {
    const convId = selectedIdRef.current;
    const cursor = detail?.oldestMessageCursor;
    if (!convId || !cursor || loadingOlderMessages) return;
    setLoadingOlderMessages(true);
    try {
      await loadOlderMessagesIntoCache(queryClient, convId, cursor);
    } catch {
      showToast("Could not load older messages right now.");
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [
    detail?.oldestMessageCursor,
    loadingOlderMessages,
    queryClient,
    showToast,
  ]);

  useEffect(() => {
    const detach = attachInboxRealtimeQuerySync({
      queryClient,
      getSelectedId: () => selectedIdRef.current,
      recentLocalMsgIds: recentLocalMsgIdsRef.current,
    });
    return () => {
      detach();
      if (threadRefreshTimerRef.current) {
        clearTimeout(threadRefreshTimerRef.current);
      }
    };
  }, [queryClient]);

  const waitingThreadsCount = useMemo(
    () =>
      threads.filter((t) => t.status !== "RESOLVED" && Boolean(t.waitingSince))
        .length,
    [threads]
  );

  const acrioThreadsCount = useMemo(
    () =>
      threads.filter(
        (t) => t.status !== "RESOLVED" && t.assignedStaffId === "ACRIO"
      ).length,
    [threads]
  );

  const filteredThreads = useMemo(() => {
    return threads.filter((t) => {
      const isMine =
        t.assignedStaffId === initialData.currentUserId ||
        Boolean(
          t.collaborators?.some(
            (c) => c.staffId === initialData.currentUserId
          )
        );

      if (quickFilter === "MINE") {
        if (!isMine) return false;
      } else if (quickFilter === "ACTIVE") {
        if (t.status === "RESOLVED") return false;
      } else if (quickFilter === "WAITING") {
        if (t.status === "RESOLVED" || !t.waitingSince) return false;
      } else if (quickFilter === "ACRIO") {
        if (t.status === "RESOLVED" || t.assignedStaffId !== "ACRIO")
          return false;
      } else if (quickFilter === "UNREAD") {
        if (t.unreadCount <= 0) return false;
      } else if (quickFilter === "RESOLVED") {
        if (t.status !== "RESOLVED") return false;
      }

      if (teamFilter !== "ALL" && t.assignedTeamId !== teamFilter) {
        return false;
      }

      if (staffFilter !== "ALL") {
        const matchesStaff =
          t.assignedStaffId === staffFilter ||
          Boolean(t.collaborators?.some((c) => c.staffId === staffFilter));
        if (!matchesStaff) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay =
          `${t.customerName} ${t.customerPhone} ${t.lastMessagePreview} ${t.smartCategory} ${t.assignedTeamName || ""} ${t.assignedStaffName || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    threads,
    quickFilter,
    teamFilter,
    staffFilter,
    searchQuery,
    initialData.currentUserId,
  ]);

  return {
    queryClient,
    threads,
    refreshingThreads,
    threadsError,
    detail,
    syncingThread,
    detailError,
    loadingOlderMessages,
    nowMs,
    callbackConvIds,
    unreadMentionConvIds,
    pendingCallback,
    markPendingCallbackDone,
    waitingThreadsCount,
    acrioThreadsCount,
    filteredThreads,
    selectedIdRef,
    optimisticSeqRef,
    lastSyncedProfileConvIdRef,
    appendOptimisticMessage,
    patchOptimisticMessage,
    refreshThreadsSilently,
    scheduleThreadsRefresh,
    fetchAndCacheDetail,
    prefetchDetail,
    handleLoadOlderMessages,
  };
}
