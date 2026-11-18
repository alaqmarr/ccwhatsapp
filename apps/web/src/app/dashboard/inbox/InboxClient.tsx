"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE,
  ChatMessagesSkeleton,
  ElementErrorState,
  WhatsAppLogoIcon,
  buildClientProviderTrackingUrl,
} from "@cc/ui";
import {
  extractMessageMedia,
  type NormalizedMessageMedia,
} from "@/components/MediaAttachmentTools";
import type { NewChatModalMode } from "@/components/NewChatTemplateModal";
import type {
  ApprovedTemplateOption,
  ChatMessage,
  ConversationDetailBundle,
  ConversationSummary,
  InitialInboxPayload,
  QuickReplyItem,
  QuotedMessageRef,
  StaffOption,
  TeamOption,
} from "@/lib/inbox-server-data";
import { subscribeRealtimeEvent } from "@/lib/realtime-client";
import { getDraftKey, useInboxStore } from "@/lib/inbox-store";
import {
  appendOptimisticMessageToCache,
  attachInboxRealtimeQuerySync,
  fetchConversationDetail,
  fetchInboxThreads,
  inboxKeys,
  loadOlderMessagesIntoCache,
  mergeServerDetailWithCached,
  patchOptimisticMessageInCache,
  prefetchConversationDetail,
} from "@/lib/inbox-queries";
import { CANNED_QUICK_REPLIES } from "./inbox-helpers";
import { useInboxMessagingActions } from "./useInboxMessagingActions";
import { useInboxWorkflowActions } from "./useInboxWorkflowActions";
import { ThreadListPane } from "./ThreadListPane";
import { MessageTimeline } from "./MessageTimeline";
import { InboxSidebarHeader } from "./InboxSidebarHeader";
import { InboxChatHeader } from "./InboxChatHeader";
import { InboxComposer } from "./InboxComposer";
import { InboxRightDrawer } from "./InboxRightDrawer";
import type { SaveCustomerProfilePayload } from "./RightDrawerProfileTab";
import type { VerifiedLocationInfo } from "./ComposerPopovers";

const AttachmentPickerPopover = dynamic(
  () =>
    import("@/components/MediaAttachmentTools").then(
      (m) => m.AttachmentPickerPopover
    ),
  { ssr: false }
);
const MediaPreviewLightbox = dynamic(
  () =>
    import("@/components/MediaAttachmentTools").then(
      (m) => m.MediaPreviewLightbox
    ),
  { ssr: false }
);
const PreSendFileConfirmModal = dynamic(
  () =>
    import("@/components/MediaAttachmentTools").then(
      (m) => m.PreSendFileConfirmModal
    ),
  { ssr: false }
);
const NewChatTemplateModal = dynamic(
  () =>
    import("@/components/NewChatTemplateModal").then(
      (m) => m.NewChatTemplateModal
    ),
  { ssr: false }
);
const QuickRepliesModal = dynamic(
  () =>
    import("@/components/QuickRepliesModal").then((m) => m.QuickRepliesModal),
  { ssr: false }
);
const TemplateSendDialog = dynamic(
  () =>
    import("@/components/TemplateSendDialog").then((m) => m.TemplateSendDialog),
  { ssr: false }
);
const TrackOrderPopover = dynamic(
  () => import("./ComposerPopovers").then((m) => m.TrackOrderPopover),
  { ssr: false }
);
const LocationPinPopover = dynamic(
  () => import("./ComposerPopovers").then((m) => m.LocationPinPopover),
  { ssr: false }
);
const ShortLinksPopover = dynamic(
  () => import("./ComposerPopovers").then((m) => m.ShortLinksPopover),
  { ssr: false }
);
const AssignTeamModal = dynamic(
  () => import("./InboxModals").then((m) => m.AssignTeamModal),
  { ssr: false }
);
const ResolveChatModal = dynamic(
  () => import("./InboxModals").then((m) => m.ResolveChatModal),
  { ssr: false }
);

export function InboxClient({
  initialData,
  emptyChatSlot,
}: {
  initialData: InitialInboxPayload;
  emptyChatSlot?: React.ReactNode;
}) {
  const queryClient = useQueryClient();

  const storeSelectedId = useInboxStore((s) => s.selectedId);
  const selectedId = storeSelectedId ?? initialData.initialSelectedId;
  const initSelectedId = useInboxStore((s) => s.initSelectedId);
  const setSelectedId = useInboxStore((s) => s.setSelectedId);
  const selectConversationInStore = useInboxStore((s) => s.selectConversation);

  const mobilePane = useInboxStore((s) => s.mobilePane);
  const setMobilePane = useInboxStore((s) => s.setMobilePane);
  const bulkMode = useInboxStore((s) => s.bulkMode);
  const setBulkMode = useInboxStore((s) => s.setBulkMode);
  const selectedThreadIds = useInboxStore((s) => s.selectedThreadIds);
  const setSelectedThreadIds = useInboxStore((s) => s.setSelectedThreadIds);
  const toggleBulkThreadId = useInboxStore((s) => s.toggleBulkThreadId);

  useEffect(() => {
    initSelectedId(initialData.initialSelectedId);
    if (initialData.initialSelectedId && initialData.initialDetail) {
      queryClient.setQueryData(
        inboxKeys.detail(initialData.initialSelectedId),
        (existing: ConversationDetailBundle | undefined) =>
          existing ?? initialData.initialDetail ?? undefined
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [teams, setTeams] = useState<TeamOption[]>(initialData.teams);
  const [staffList] = useState<StaffOption[]>(initialData.staffList);
  const [templates] = useState<ApprovedTemplateOption[]>(initialData.templates);
  const [customQuickReplies, setCustomQuickReplies] = useState<QuickReplyItem[]>(
    initialData.quickReplies || []
  );
  const [showQuickRepliesModal, setShowQuickRepliesModal] = useState<boolean>(false);

  const isAdminOrSuperadmin =
    initialData.currentUserRole === "DEV" ||
    initialData.currentUserRole === "SUPERADMIN" ||
    initialData.currentUserRole === "ADMIN";

  const quickFilter = useInboxStore((s) => s.quickFilter);
  const setQuickFilter = useInboxStore((s) => s.setQuickFilter);
  const teamFilter = useInboxStore((s) => s.teamFilter);
  const setTeamFilter = useInboxStore((s) => s.setTeamFilter);
  const staffFilter = useInboxStore((s) => s.staffFilter);
  const setStaffFilter = useInboxStore((s) => s.setStaffFilter);
  const searchQuery = useInboxStore((s) => s.searchQuery);
  const setSearchQuery = useInboxStore((s) => s.setSearchQuery);

  const [loadingOlderMessages, setLoadingOlderMessages] = useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(initialData.serverNowMs);

  // Composer state: Free WhatsApp Reply | Paid Approved Template | Private Internal Team Note
  const composerMode = useInboxStore((s) => s.composerMode);
  const setComposerMode = useInboxStore((s) => s.setComposerMode);
  const draftsByKey = useInboxStore((s) => s.draftsByKey);
  const setDraft = useInboxStore((s) => s.setDraft);
  const moveReplyDraftToNote = useInboxStore((s) => s.moveReplyDraftToNote);
  const replyText = draftsByKey[getDraftKey(selectedId, composerMode)] ?? "";
  const setReplyText = useCallback(
    (next: string | ((prev: string) => string)) => {
      const targetId = useInboxStore.getState().selectedId ?? initialData.initialSelectedId;
      const targetMode = useInboxStore.getState().composerMode;
      setDraft(targetId, targetMode, next);
    },
    [initialData.initialSelectedId, setDraft]
  );
  const replyingTo = useInboxStore((s) => s.replyingTo);
  const setReplyingTo = useInboxStore((s) => s.setReplyingTo);
  const highlightedMsgId = useInboxStore((s) => s.highlightedMsgId);
  const setHighlightedMsgId = useInboxStore((s) => s.setHighlightedMsgId);

  const threadsQuery = useQuery<ConversationSummary[]>({
    queryKey: inboxKeys.threads,
    queryFn: fetchInboxThreads,
    initialData: initialData.threads,
    staleTime: 10_000,
    refetchInterval: 20_000,
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
    refetchInterval: 20_000,
    initialData:
      selectedId &&
      selectedId === initialData.initialSelectedId &&
      initialData.initialDetail
        ? initialData.initialDetail
        : undefined,
    queryFn: async () => {
      const targetId = selectedId!;
      const data = await fetchConversationDetail(targetId);
      if (Array.isArray(data.teams) && data.teams.length > 0) {
        setTeams((prev) => (prev.length > 0 ? prev : (data.teams as TeamOption[])));
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
  const [showShortLinksPicker, setShowShortLinksPicker] =
    useState<boolean>(false);

  // Dynamic track.ccapl.cc/{id} interactive WhatsApp button popover state
  const [showTrackPopover, setShowTrackPopover] = useState<boolean>(false);
  const [trackOrderId, setTrackOrderId] = useState<string>("");
  const [trackBrand, setTrackBrand] = useState<
    "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53"
  >("CLASSIC_CONCEPTS");
  const [trackProviderKey, setTrackProviderKey] =
    useState<string>("DELHIVERY");
  const [trackAwbNumber, setTrackAwbNumber] = useState<string>("");
  const [trackProviderUrl, setTrackProviderUrl] = useState<string>("");
  const [trackButtonLabel, setTrackButtonLabel] =
    useState<string>("Track Order");
  const [trackMessageText, setTrackMessageText] = useState<string>("");

  const [toast, setToast] = useState<string>("");

  // Resolve modal
  const [showResolveModal, setShowResolveModal] = useState<boolean>(false);
  const [resolveSummary, setResolveSummary] = useState<string>("");

  // Assign Team & Staff modal
  const [showAssignModal, setShowAssignModal] = useState<boolean>(false);
  const [assignTeamId, setAssignTeamId] = useState<string>("team_sales");
  const [assignStaffId, setAssignStaffId] = useState<string>("");
  const [assignTier, setAssignTier] = useState<"P0" | "P1" | "P2">("P0");

  // New conversation / Template / Simulator modal
  const [showNewChatModal, setShowNewChatModal] = useState<boolean>(false);
  const [newChatInitialMode, setNewChatInitialMode] =
    useState<NewChatModalMode>("TEMPLATE");
  const [simPhone, setSimPhone] = useState<string>("");
  const [simName, setSimName] = useState<string>("");

  // Non-owner private note toggle & ACRIO summary/takeover busy states
  const [showNoteForNonOwner, setShowNoteForNonOwner] = useState<boolean>(false);

  // Pending "Request a callback" for the open chat + across the thread list (derived synchronously at 0ms when switching chats)
  const [callbackReqs, setCallbackReqs] = useState<Record<string, unknown>[]>([]);
  const [unreadMentionConvIds, setUnreadMentionConvIds] = useState<string[]>([]);

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
          fetch("/api/callback-requests?status=PENDING", { cache: "no-store" }),
          fetch("/api/notifications", { cache: "no-store" }),
        ]);
        const [cbData, ntfData] = await Promise.all([
          cbRes.json().catch(() => ({})),
          ntfRes.json().catch(() => ({})),
        ]);
        if (cancelled) return;
        if (cbData?.ok) {
          setCallbackReqs((cbData.requests || []) as Record<string, unknown>[]);
        }
        if (ntfData?.ok) {
          const unreadIds = ((ntfData.notifications || []) as Record<string, unknown>[])
            .filter((n) => !n.isRead && n.type !== "CALLBACK")
            .map((n) => String(n.conversationId));
          setUnreadMentionConvIds(Array.from(new Set(unreadIds)));
        }
      } catch {
        // ignore
      }
    };
    void loadSignals();
    const timer = setInterval(loadSignals, 30000);
    const unsubCb = subscribeRealtimeEvent("callback:new", loadSignals);
    const unsubMention = subscribeRealtimeEvent("staff:mention", loadSignals);
    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubCb();
      unsubMention();
    };
  }, []);

  // Global keyboard shortcuts for fast desk handling (Alt+R Reply, Alt+N Note, Alt+T Template, Alt+A Ask @ACRIO, Alt+D Drawer)
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
          setReplyText((prev) => (prev.includes("@ACRIO") ? prev : `@ACRIO ${prev}`));
          composerInputRef.current?.focus();
        }, 20);
      } else if (k === "d") {
        e.preventDefault();
        useInboxStore.getState().setShowRightDrawer((p) => !p);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  // ------------------------------------------------------------------------
  // ------------------------------------------------------------------------
  // Drafts are kept in Zustand per chat AND per tab (`${convId}|${mode}`).
  // ------------------------------------------------------------------------
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const stagedAttachment = useInboxStore((s) => s.stagedAttachment);
  const setStagedAttachment = useInboxStore((s) => s.setStagedAttachment);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [showLocationPopover, setShowLocationPopover] = useState(false);
  const pendingSendConfirm = useInboxStore((s) => s.pendingSendConfirm);
  const setPendingSendConfirm = useInboxStore((s) => s.setPendingSendConfirm);
  const [previewMedia, setPreviewMedia] =
    useState<NormalizedMessageMedia | null>(null);
  const lastDraftChatRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastDraftChatRef.current !== (selectedId || null)) {
      lastDraftChatRef.current = selectedId || null;
      setTemplateDialogOpen(false);
      setShowAttachmentPicker(false);
      setShowLocationPopover(false);
    }
  }, [selectedId]);

  /** Moves what the person typed into this chat's Note draft (used when they @mention in the reply box). */
  function moveDraftToNote(text: string) {
    if (!selectedId) return;
    moveReplyDraftToNote(selectedId, text);
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

  const timelineScrollRef = useRef<((msgId: string) => void) | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;
  const optimisticSeqRef = useRef<number>(0);
  const recentLocalMsgIdsRef = useRef<Map<string, number>>(new Map());
  const threadRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedProfileConvIdRef = useRef<string | null>(
    initialData.initialDetail?.conversation.id || null
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }, []);

  // Refresh thread wait-time & chat window labels every 15s (avoids 60/min full-inbox re-renders while typing/scrolling)
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const syncProfileFields = useCallback((bundle: ConversationDetailBundle) => {
    setShowNoteForNonOwner(false);
    setResolveSummary(
      bundle.acrio?.resolutionDraft ||
        `Resolved enquiry with ${bundle.conversation.customerName}.`
    );
  }, []);

  // Populate CRM form inputs when an uncached conversation finishes loading
  useEffect(() => {
    if (!detail) return;
    if (lastSyncedProfileConvIdRef.current !== detail.conversation.id) {
      lastSyncedProfileConvIdRef.current = detail.conversation.id;
      syncProfileFields(detail);
    }
  }, [detail, syncProfileFields]);

  // Silent background refresh of thread list via TanStack Query
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

  // Silent detail fetch backed by TanStack Query cache
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
    [queryClient, syncProfileFields]
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

  // Hover/touch prefetch (?prefetch=1 keeps unread count untouched until user opens chat)
  const prefetchDetail = useCallback(
    (convId: string) => {
      if (!convId || convId === selectedIdRef.current) return;
      void prefetchConversationDetail(queryClient, convId);
    },
    [queryClient]
  );

  // Background idle prefetch for top 3 chats so switching feels instantaneous
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

  // Select conversation handler (zero flash on cached, element skeleton on uncached!)
  function handleSelectConversation(convId: string) {
    setMobilePane("CHAT");
    if (convId === selectedId && (detail || syncingThread)) return;
    selectConversationInStore(convId);
    selectedIdRef.current = convId;
    const cached = queryClient.getQueryData<ConversationDetailBundle>(
      inboxKeys.detail(convId)
    );
    if (cached) {
      lastSyncedProfileConvIdRef.current = convId;
      syncProfileFields(cached);
    } else {
      lastSyncedProfileConvIdRef.current = null;
    }
    void queryClient.invalidateQueries({ queryKey: inboxKeys.detail(convId) });
  }

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
  }, [detail?.oldestMessageCursor, loadingOlderMessages, queryClient, showToast]);

  // Real-time SSE over shared singleton stream patching TanStack Query cache in place
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

  // Pre-fill template body when user selects an approved template
  const activeConv = detail?.conversation || null;

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
        const hay = `${t.customerName} ${t.customerPhone} ${t.lastMessagePreview} ${t.smartCategory} ${t.assignedTeamName || ""} ${t.assignedStaffName || ""}`.toLowerCase();
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

  const messages = detail?.messages || [];
  const internalNotes = useMemo(
    () => messages.filter((m) => m.messageType === "INTERNAL_NOTE"),
    [messages]
  );

  const sharedMediaItems = useMemo(
    () =>
      messages
        .map((m) => ({ msg: m, media: extractMessageMedia(m) }))
        .filter(
          (
            item
          ): item is { msg: ChatMessage; media: NormalizedMessageMedia } =>
            Boolean(item.media)
        ),
    [messages]
  );

  const isAcrioHandling = activeConv?.assignedStaffId === "ACRIO";
  const activeCollaborators = useMemo(
    () => activeConv?.collaborators || [],
    [activeConv?.collaborators]
  );
  const isOwnerOfActiveChat = Boolean(
    activeConv && activeConv.assignedStaffId === initialData.currentUserId
  );
  const isCollaboratorOfActiveChat = Boolean(
    activeConv &&
      activeCollaborators.some((c) => c.staffId === initialData.currentUserId)
  );
  const isAssignedToCurrentUser = Boolean(
    activeConv && (isOwnerOfActiveChat || isCollaboratorOfActiveChat)
  );

  const hasUnreadOutboundByCustomer = useMemo(
    () =>
      messages.some(
        (m) =>
          m.direction === "OUTBOUND" &&
          (m.deliveryStatus === "SENT" || m.deliveryStatus === "DELIVERED")
      ),
    [messages]
  );

  function startReplyToMessage(m: ChatMessage) {
    setReplyingTo({
      messageId: m.id,
      waMessageId: m.waMessageId || null,
      senderName: m.senderName,
      senderType: m.senderType,
      direction: m.direction,
      body: m.body.slice(0, 280),
    });
    if (composerMode === "NOTE") {
      setComposerMode("REPLY");
    }
    requestAnimationFrame(() => {
      composerInputRef.current?.focus();
    });
  }

  function jumpToQuotedMessage(quoted: QuotedMessageRef) {
    let targetId = quoted.messageId || "";
    if (!targetId && quoted.waMessageId) {
      const matched = messages.find(
        (item) => item.waMessageId && item.waMessageId === quoted.waMessageId
      );
      if (matched) targetId = matched.id;
    }
    if (!targetId) return;
    timelineScrollRef.current?.(targetId);
    setHighlightedMsgId(targetId);
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = setTimeout(() => {
      if (useInboxStore.getState().highlightedMsgId === targetId) {
        setHighlightedMsgId(null);
      }
    }, 1800);
  }

  function openTrackPopoverForOrder(prefill?: {
    orderId?: string;
    itemsSummary?: string;
    brand?: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  }) {
    setShowShortLinksPicker(false);
    const existingList = detail?.orderTrackings || [];
    const chosenOrderId =
      prefill?.orderId ||
      detail?.orders[0]?.orderNumber ||
      existingList[0]?.orderId ||
      "";
    const matchedTracking = existingList.find(
      (t) =>
        t.orderId.toUpperCase() === chosenOrderId.trim().toUpperCase()
    );
    const inferredBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" =
      matchedTracking?.brand ||
      prefill?.brand ||
      (chosenOrderId.toUpperCase().startsWith("CE")
        ? "CLASSIC_EDGE_53"
        : "CLASSIC_CONCEPTS");
    const nextProvider = matchedTracking?.providerCode || "DELHIVERY";
    const nextAwb = matchedTracking?.awbNumber || "";
    const nextUrl =
      matchedTracking?.providerTrackingUrl ||
      buildClientProviderTrackingUrl(nextProvider, nextAwb || chosenOrderId);

    setTrackOrderId(chosenOrderId);
    setTrackBrand(inferredBrand);
    setTrackProviderKey(nextProvider);
    setTrackAwbNumber(nextAwb);
    setTrackProviderUrl(nextUrl);
    setTrackButtonLabel("Track Order");
    setTrackMessageText("");
    setShowTrackPopover(true);
  }

  function resolveActiveVerifiedLocation(): VerifiedLocationInfo {
    return (
      detail?.verifiedLocation || {
        placeName: "Classic Concepts Acrylic Private Limited",
        address:
          "1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015",
        businessHours: "Monday - Saturday: 10:00 AM to 7:00 PM (Sunday: Closed)",
        phone: "+91 79016 50662",
        mapsUrl: "https://maps.google.com/?q=17.4947378,78.496725",
        latitude: 17.4947378,
        longitude: 78.496725,
      }
    );
  }

  function buildVerifiedLocationMessageText() {
    const loc = resolveActiveVerifiedLocation();
    return `*Classic Concepts Acrylic Pvt. Ltd.*\n${loc.address}\n*Hours:* ${loc.businessHours}\n*Phone:* ${loc.phone}\n\n*Google Maps:* ${loc.mapsUrl}`;
  }

  function handleMoveNoteToReplyBox(
    textValue: string,
    quoted?: QuotedMessageRef | null
  ) {
    setComposerMode("REPLY");
    setReplyText(textValue);
    if (quoted) {
      setReplyingTo(quoted);
    }
    setTimeout(() => composerInputRef.current?.focus(), 30);
    showToast("Loaded into WhatsApp Reply box. Review and press Send.");
  }

  const handleOpenNewChatWithPhone = useCallback((phone: string) => {
    setSimPhone(phone);
    setSimName("");
    setNewChatInitialMode("TEMPLATE");
    setShowNewChatModal(true);
  }, []);

  function toggleBulkSelectThread(convId: string, ev?: React.MouseEvent) {
    if (ev) ev.stopPropagation();
    toggleBulkThreadId(convId);
  }

  const {
    sendingTrackBtn,
    sendingLocationPin,
    acrioActionBusyId,
    sendTemplateMessage,
    handleSendOrderTracking,
    handleSendVerifiedLocationNow,
    executeComposerSend,
    handleComposerSubmit,
    handleSimulateCustomerRead,
    handleConfirmAcrioAction,
    handleSendNoteInChat,
    handleUploadCompanyDocForNote,
  } = useInboxMessagingActions({
    selectedId,
    detail,
    currentUserName: initialData.currentUserName,
    staffList,
    composerMode,
    setComposerMode,
    replyText,
    replyingTo,
    setReplyingTo,
    stagedAttachment,
    setStagedAttachment,
    setDraft,
    setPendingSendConfirm,
    setShowAttachmentPicker,
    setTemplateDialogOpen,
    setShowTrackPopover,
    setShowLocationPopover,
    trackOrderId,
    trackBrand,
    trackProviderKey,
    trackAwbNumber,
    trackProviderUrl,
    trackButtonLabel,
    trackMessageText,
    resolveActiveVerifiedLocation,
    buildVerifiedLocationMessageText,
    optimisticSeqRef,
    appendOptimisticMessage,
    patchOptimisticMessage,
    fetchAndCacheDetail,
    refreshThreadsSilently,
    scheduleThreadsRefresh,
    showToast,
    moveDraftToNote,
  });

  const {
    bulkBusy,
    summarizingChat,
    takingOver,
    handleQuickNoteSave,
    handleReturnToAcrio,
    handleSmartAssignSalesP0,
    handleManualAssignSubmit,
    handleSmartResolve,
    handleReopen,
    handleSaveCustomerProfile,
    handleTakeOverChat,
    handleGenerateSummary,
    handleAddCollaborator,
    handleRemoveCollaborator,
    handleAddOrder,
    handleBulkResolveSelected,
    handleBulkAssignToMe,
  } = useInboxWorkflowActions({
    queryClient,
    selectedId,
    detail,
    currentUserId: initialData.currentUserId,
    currentUserName: initialData.currentUserName,
    teams,
    staffList,
    selectedThreadIds,
    setSelectedThreadIds,
    setBulkMode,
    assignTeamId,
    assignStaffId,
    assignTier,
    resolveSummary,
    setShowAssignModal,
    setShowResolveModal,
    setShowNoteForNonOwner,
    optimisticSeqRef,
    appendOptimisticMessage,
    patchOptimisticMessage,
    fetchAndCacheDetail,
    refreshThreadsSilently,
    showToast,
  });

  type CombinedQuickReply = {
    id?: string;
    cmd: string;
    title: string;
    body: string;
    isCustom?: boolean;
    staffName?: string;
  };

  const allQuickReplies = useMemo<CombinedQuickReply[]>(() => {
    const merged: CombinedQuickReply[] = [];
    const seenCmds = new Set<string>();
    const orderedCustom = [...customQuickReplies].sort(
      (a, b) => Number(b.isMine) - Number(a.isMine)
    );
    for (const item of orderedCustom) {
      const key = item.cmd.trim().toLowerCase();
      if (!seenCmds.has(key)) {
        seenCmds.add(key);
        merged.push({
          id: item.id,
          cmd: item.cmd,
          title: item.title,
          body: item.body,
          isCustom: true,
          staffName: item.isMine ? "You" : item.staffName,
        });
      }
    }
    for (const builtIn of CANNED_QUICK_REPLIES) {
      const key = builtIn.cmd.toLowerCase();
      if (!seenCmds.has(key)) {
        seenCmds.add(key);
        merged.push({
          cmd: builtIn.cmd,
          title: builtIn.title,
          body: builtIn.body,
          isCustom: false,
        });
      }
    }
    return merged;
  }, [customQuickReplies]);

  const matchingQuickReplies = useMemo(() => {
    if (composerMode !== "REPLY" || !replyText.startsWith("/")) return [];
    const q = replyText.trim().toLowerCase();
    return allQuickReplies.filter(
      (item) =>
        item.cmd.toLowerCase().startsWith(q) ||
        item.title.toLowerCase().includes(q.slice(1))
    );
  }, [composerMode, replyText, allQuickReplies]);

  function appendToComposer(snippet: string) {
    if (composerMode === "NOTE") setComposerMode("REPLY");
    setReplyText((prev) => (prev ? `${prev.trim()} ${snippet}` : snippet));
  }

  return (
    <div className="h-[calc(100dvh-52px)] lg:h-full w-full flex overflow-hidden bg-[#f0f2f5] select-text">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-20 sm:bottom-5 left-3 right-3 sm:left-auto sm:right-5 sm:max-w-sm z-50 px-3.5 py-2 rounded-lg bg-neutral-900 text-white text-xs font-medium shadow-lg text-center sm:text-left [overflow-wrap:anywhere]">
          {toast}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 1. LEFT WHATSAPP SIDEBAR                                              */}
      {/* ===================================================================== */}
      <div
        className={`${
          mobilePane === "LIST" ? "flex w-full min-w-0" : "hidden"
        } lg:flex lg:w-[340px] xl:w-[375px] shrink-0 border-r border-[#d1d7db] flex-col bg-white relative`}
      >
        <InboxSidebarHeader
          waitingThreadsCount={waitingThreadsCount}
          acrioThreadsCount={acrioThreadsCount}
          refreshingThreads={refreshingThreads}
          isAdminOrSuperadmin={isAdminOrSuperadmin}
          staffList={staffList}
          teams={teams}
          onRefreshThreads={() => void refreshThreadsSilently(true)}
          onOpenNewChat={() => {
            setSimPhone("");
            setSimName("");
            setNewChatInitialMode("TEMPLATE");
            setShowNewChatModal(true);
          }}
        />

        <ThreadListPane
          filteredThreads={filteredThreads}
          selectedId={selectedId}
          bulkMode={bulkMode}
          selectedThreadIds={selectedThreadIds}
          callbackConvIds={callbackConvIds}
          unreadMentionConvIds={unreadMentionConvIds}
          nowMs={nowMs}
          serverNowMs={initialData.serverNowMs}
          threadsError={threadsError}
          refreshingThreads={refreshingThreads}
          onRetryRefresh={() => void refreshThreadsSilently(true)}
          onPrefetch={prefetchDetail}
          onSelect={handleSelectConversation}
          onToggleBulk={toggleBulkSelectThread}
        />

        {bulkMode && selectedThreadIds.length > 0 && (
          <div className="border-t border-[#d1d7db] bg-neutral-900 text-white px-3 py-2.5 flex items-center justify-between gap-2 shrink-0">
            <span className="text-xs font-semibold">
              {selectedThreadIds.length} selected
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void handleBulkAssignToMe()}
                className="px-2.5 py-1 rounded bg-white/15 hover:bg-white/25 text-[11px] font-medium cursor-pointer disabled:opacity-50"
              >
                Assign to Me
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void handleBulkResolveSelected()}
                className="px-2.5 py-1 rounded bg-[#00a884] hover:bg-[#008f6f] text-[11px] font-semibold cursor-pointer disabled:opacity-50"
              >
                Resolve
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* 2. CENTER WHATSAPP CONVERSATION STREAM & COMPOSER                     */}
      {/* ===================================================================== */}
      <div
        className={`${
          mobilePane === "CHAT" ? "flex w-full" : "hidden"
        } lg:flex flex-1 min-w-0 flex-col bg-[#efeae2]`}
      >
        {!detail || !activeConv ? (
          <div
            style={CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE}
            className="flex-1 flex flex-col justify-center overflow-y-auto"
          >
            {selectedId && syncingThread ? (
              <ChatMessagesSkeleton />
            ) : selectedId && detailError ? (
              <div className="p-8 max-w-md mx-auto w-full">
                <ElementErrorState
                  title="Could not load chat messages"
                  message={detailError}
                  onRetry={() => void fetchAndCacheDetail(selectedId, true)}
                  retrying={syncingThread}
                />
              </div>
            ) : (
              emptyChatSlot ?? (
                <div className="p-8 text-center flex justify-center">
                  <div className="bg-white/95 border border-[#d1d7db] rounded-xl p-6 max-w-sm shadow-xs space-y-2.5">
                    <div className="mx-auto w-12 h-12 rounded-full bg-[#e7fce3] flex items-center justify-center text-[#00a884]">
                      <WhatsAppLogoIcon size={24} />
                    </div>
                    <h2 className="font-display text-lg font-bold tracking-tight text-[#111b21]">
                      Classic Concepts WhatsApp Desk
                    </h2>
                    <p className="text-[13px] leading-relaxed text-[#54656f]">
                      Select any customer chat on the left. New enquiries are handled
                      automatically by ACRIO first and connected to Sales Team
                      whenever human help is needed.
                    </p>
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          <>
            <InboxChatHeader
              detail={detail}
              messages={messages}
              nowMs={nowMs}
              syncingThread={syncingThread}
              isAcrioHandling={isAcrioHandling}
              hasUnreadOutboundByCustomer={hasUnreadOutboundByCustomer}
              summarizingChat={summarizingChat}
              takingOver={takingOver}
              onGenerateSummary={() => void handleGenerateSummary()}
              onTakeOverChat={() => void handleTakeOverChat()}
              onSmartAssignSalesP0={() => void handleSmartAssignSalesP0()}
              onOpenAssignModal={() => {
                setAssignTeamId(activeConv.assignedTeamId || "team_sales");
                setAssignStaffId(
                  activeConv.assignedStaffId &&
                    activeConv.assignedStaffId !== "ACRIO"
                    ? activeConv.assignedStaffId
                    : ""
                );
                setAssignTier(
                  activeConv.escalationLevel === "P1" ||
                    activeConv.escalationLevel === "P2"
                    ? activeConv.escalationLevel
                    : "P0"
                );
                setShowAssignModal(true);
              }}
              onOpenResolveModal={() => setShowResolveModal(true)}
              onReopen={() => void handleReopen()}
              onReturnToAcrio={() => void handleReturnToAcrio()}
              onSimulateCustomerRead={() => void handleSimulateCustomerRead()}
              onCopyToast={showToast}
            />

            <MessageTimeline
              conversationId={activeConv.id}
              messages={messages}
              conversationStatus={activeConv.status}
              resolvedByName={activeConv.resolvedByName || null}
              resolutionSummary={activeConv.resolutionSummary || null}
              hasOlderMessages={Boolean(detail.hasOlderMessages)}
              loadingOlderMessages={loadingOlderMessages}
              onLoadOlderMessages={handleLoadOlderMessages}
              nowMs={nowMs}
              staffList={staffList}
              isAssignedToCurrentUser={isAssignedToCurrentUser}
              highlightedMsgId={highlightedMsgId}
              acrioActionBusyId={acrioActionBusyId}
              onStartReplyToMessage={startReplyToMessage}
              onStartNoteReplyToMessage={(m) => {
                startReplyToMessage(m);
                setComposerMode("NOTE");
                setTimeout(() => composerInputRef.current?.focus(), 20);
              }}
              onJumpToQuotedMessage={jumpToQuotedMessage}
              onOpenMediaPreview={(media) => setPreviewMedia(media)}
              onOpenNewChatWithPhone={handleOpenNewChatWithPhone}
              onCopyToast={showToast}
              onSendNoteInChat={(noteId, customText, dismissOnly) => {
                void handleSendNoteInChat(noteId, customText, dismissOnly);
              }}
              onMoveNoteToReplyBox={handleMoveNoteToReplyBox}
              onConfirmAcrioAction={(noteId, decision, selectedOptionId) => {
                void handleConfirmAcrioAction(noteId, decision, selectedOptionId);
              }}
              onUploadCompanyDocForNote={(noteId, md, file) => {
                void handleUploadCompanyDocForNote(noteId, md, file);
              }}
              onUseSuggestedReply={(reply) => {
                setComposerMode("REPLY");
                setReplyText(reply);
                composerInputRef.current?.focus();
              }}
              onReopen={() => void handleReopen()}
              scrollTargetRef={timelineScrollRef}
            />

            {(showAttachmentPicker ||
              showTrackPopover ||
              showLocationPopover ||
              (showShortLinksPicker && detail.customLinks.length > 0)) && (
              <div className="relative shrink-0 px-2 sm:px-4">
                {showAttachmentPicker && (
                  <AttachmentPickerPopover
                    open={showAttachmentPicker}
                    recipientName={
                      detail.customer?.name ||
                      activeConv.customerName ||
                      activeConv.customerPhone ||
                      "Customer"
                    }
                    recipientPhone={activeConv.customerPhone || ""}
                    onClose={() => setShowAttachmentPicker(false)}
                    onStageAttachment={(att) => {
                      setStagedAttachment(att);
                      if (att.suggestedCaption && !replyText.trim()) {
                        setReplyText(att.suggestedCaption);
                      }
                      setComposerMode("REPLY");
                      setTimeout(() => composerInputRef.current?.focus(), 20);
                    }}
                    onSendUploadedAttachment={(att) =>
                      executeComposerSend({
                        overrideAttachment: att,
                        overrideCaption:
                          replyText.trim() || att.suggestedCaption || "",
                        modeOverride: "REPLY",
                      })
                    }
                    onShowToast={showToast}
                  />
                )}
                {showTrackPopover && (
                  <TrackOrderPopover
                    detail={detail}
                    trackOrderId={trackOrderId}
                    setTrackOrderId={setTrackOrderId}
                    trackBrand={trackBrand}
                    setTrackBrand={setTrackBrand}
                    trackProviderKey={trackProviderKey}
                    setTrackProviderKey={setTrackProviderKey}
                    trackAwbNumber={trackAwbNumber}
                    setTrackAwbNumber={setTrackAwbNumber}
                    trackProviderUrl={trackProviderUrl}
                    setTrackProviderUrl={setTrackProviderUrl}
                    trackButtonLabel={trackButtonLabel}
                    setTrackButtonLabel={setTrackButtonLabel}
                    trackMessageText={trackMessageText}
                    setTrackMessageText={setTrackMessageText}
                    sendingTrackBtn={sendingTrackBtn}
                    onSelectOrder={(prefill) => openTrackPopoverForOrder(prefill)}
                    onSubmit={(e) => void handleSendOrderTracking(e)}
                    onInsertLinkOnly={(url) => {
                      appendToComposer(url);
                      setShowTrackPopover(false);
                    }}
                    onClose={() => setShowTrackPopover(false)}
                  />
                )}
                {showLocationPopover && (
                  <LocationPinPopover
                    location={resolveActiveVerifiedLocation()}
                    sendingLocationPin={sendingLocationPin}
                    onInsertText={() => {
                      appendToComposer(buildVerifiedLocationMessageText());
                      setShowLocationPopover(false);
                      composerInputRef.current?.focus();
                    }}
                    onSendNow={() => void handleSendVerifiedLocationNow()}
                    onClose={() => setShowLocationPopover(false)}
                  />
                )}
                {showShortLinksPicker && detail.customLinks.length > 0 && (
                  <ShortLinksPopover
                    links={detail.customLinks}
                    onSelectLink={(formatted) => {
                      appendToComposer(formatted);
                      setShowShortLinksPicker(false);
                      composerInputRef.current?.focus();
                    }}
                    onClose={() => setShowShortLinksPicker(false)}
                  />
                )}
              </div>
            )}

            <InboxComposer
              detail={detail}
              staffList={staffList}
              isAssignedToCurrentUser={isAssignedToCurrentUser}
              isAcrioHandling={isAcrioHandling}
              composerMode={composerMode}
              setComposerMode={setComposerMode}
              replyText={replyText}
              setReplyText={setReplyText}
              replyingTo={replyingTo}
              setReplyingTo={setReplyingTo}
              stagedAttachment={stagedAttachment}
              setStagedAttachment={setStagedAttachment}
              composerInputRef={composerInputRef}
              matchingQuickReplies={matchingQuickReplies}
              showAttachmentPicker={showAttachmentPicker}
              showTrackPopover={showTrackPopover}
              showLocationPopover={showLocationPopover}
              showShortLinksPicker={showShortLinksPicker}
              showNoteForNonOwner={showNoteForNonOwner}
              setShowNoteForNonOwner={setShowNoteForNonOwner}
              takingOver={takingOver}
              pendingCallback={pendingCallback}
              onMarkPendingCallbackDone={() => void markPendingCallbackDone()}
              onTakeOverChat={() => void handleTakeOverChat()}
              onToggleAttachmentPicker={() => {
                setShowTrackPopover(false);
                setShowShortLinksPicker(false);
                setShowLocationPopover(false);
                setShowAttachmentPicker((prev) => !prev);
              }}
              onToggleTrackPopover={() => {
                setShowShortLinksPicker(false);
                setShowAttachmentPicker(false);
                setShowLocationPopover(false);
                if (showTrackPopover) {
                  setShowTrackPopover(false);
                } else {
                  openTrackPopoverForOrder();
                }
              }}
              onToggleLocationPopover={() => {
                setShowTrackPopover(false);
                setShowShortLinksPicker(false);
                setShowAttachmentPicker(false);
                setShowLocationPopover((prev) => !prev);
              }}
              onToggleShortLinksPicker={() => {
                setShowTrackPopover(false);
                setShowAttachmentPicker(false);
                setShowLocationPopover(false);
                setShowShortLinksPicker((prev) => !prev);
              }}
              onOpenTemplateDialog={() => setTemplateDialogOpen(true)}
              onOpenQuickRepliesModal={() => setShowQuickRepliesModal(true)}
              onJumpToQuotedMessage={jumpToQuotedMessage}
              onMoveDraftToNote={moveDraftToNote}
              onSubmit={(e) => void handleComposerSubmit(e)}
              onShowToast={showToast}
            />

            {templateDialogOpen && composerMode === "TEMPLATE" && (
              <TemplateSendDialog
                open
                onClose={() => setTemplateDialogOpen(false)}
                templates={templates}
                windowOpen={
                  Boolean(activeConv.windowExpiresAt) &&
                  new Date(String(activeConv.windowExpiresAt)).getTime() > nowMs
                }
                customer={{
                  name:
                    detail.customer?.name?.trim() ||
                    activeConv.customerName ||
                    activeConv.customerPhone ||
                    "",
                  phone: activeConv.customerPhone || "",
                  companyName: detail.customer?.companyName || null,
                  city: detail.customer?.city || null,
                  latestOrderNumber: detail.orders?.[0]?.orderNumber || null,
                }}
                onSend={sendTemplateMessage}
              />
            )}
            {previewMedia && (
              <MediaPreviewLightbox
                media={previewMedia}
                onClose={() => setPreviewMedia(null)}
              />
            )}
            {pendingSendConfirm && (
              <PreSendFileConfirmModal
                target={pendingSendConfirm}
                busy={false}
                onCancel={() => setPendingSendConfirm(null)}
                onConfirmSend={() =>
                  void executeComposerSend({
                    overrideAttachment:
                      pendingSendConfirm.staged || stagedAttachment,
                    overrideCaption:
                      pendingSendConfirm.captionPreview ?? replyText.trim(),
                    modeOverride: "REPLY",
                  })
                }
              />
            )}
          </>
        )}
      </div>

      {/* ===================================================================== */}
      {/* 3. RIGHT CRM DRAWER                                                   */}
      {/* ===================================================================== */}
      <InboxRightDrawer
        selectedId={selectedId}
        detail={detail}
        internalNotes={internalNotes}
        sharedMediaItems={sharedMediaItems}
        staffList={staffList}
        nowMs={nowMs}
        syncingThread={syncingThread}
        detailError={detailError}
        isAssignedToCurrentUser={isAssignedToCurrentUser}
        summarizingChat={summarizingChat}
        onRetryDetail={() => selectedId && void fetchAndCacheDetail(selectedId, true)}
        onCopyToast={showToast}
        onGenerateSummary={() => void handleGenerateSummary()}
        onOpenTemplateDialog={() => {
          setComposerMode("TEMPLATE");
          setTemplateDialogOpen(true);
        }}
        onUseAiDraft={(reply) => {
          setComposerMode("REPLY");
          setReplyText(reply);
          composerInputRef.current?.focus();
        }}
        onSaveProfile={handleSaveCustomerProfile}
        onAddCollaborator={handleAddCollaborator}
        onRemoveCollaborator={handleRemoveCollaborator}
        onAddOrder={handleAddOrder}
        onOpenTrackPopoverForOrder={(prefill) => openTrackPopoverForOrder(prefill)}
        onSaveQuickNote={handleQuickNoteSave}
        onOpenNewChatWithPhone={handleOpenNewChatWithPhone}
        onOpenMediaPreview={(media) => setPreviewMedia(media)}
      />

      {/* ===================================================================== */}
      {/* MODALS                                                                */}
      {/* ===================================================================== */}
      {showAssignModal && activeConv && (
        <AssignTeamModal
          open
          teams={teams}
          staffList={staffList}
          currentUserRole={initialData.currentUserRole}
          assignTeamId={assignTeamId}
          setAssignTeamId={setAssignTeamId}
          assignStaffId={assignStaffId}
          setAssignStaffId={setAssignStaffId}
          assignTier={assignTier}
          setAssignTier={setAssignTier}
          onSubmit={(e) => void handleManualAssignSubmit(e)}
          onClose={() => setShowAssignModal(false)}
        />
      )}

      {showResolveModal && (
        <ResolveChatModal
          open
          resolveSummary={resolveSummary}
          setResolveSummary={setResolveSummary}
          onResolve={() => void handleSmartResolve()}
          onClose={() => setShowResolveModal(false)}
        />
      )}

      {showNewChatModal && (
        <NewChatTemplateModal
          open
          onClose={() => setShowNewChatModal(false)}
          templates={templates}
          threads={threads}
          initialPhone={simPhone}
          initialName={simName}
          initialMode={newChatInitialMode}
          onOpenExistingChat={(convId) => {
            handleSelectConversation(convId);
          }}
          onCompleted={async (convId, msg) => {
            selectConversationInStore(convId);
            selectedIdRef.current = convId;
            lastSyncedProfileConvIdRef.current = null;
            await Promise.all([
              refreshThreadsSilently(),
              fetchAndCacheDetail(convId, true),
            ]);
            showToast(msg);
          }}
        />
      )}

      {showQuickRepliesModal && (
        <QuickRepliesModal
          open
          onClose={() => setShowQuickRepliesModal(false)}
          customReplies={customQuickReplies}
          builtInReplies={CANNED_QUICK_REPLIES}
          onSaved={(next) => {
            setCustomQuickReplies(next);
            showToast("Quick replies updated.");
          }}
        />
      )}
    </div>
  );
}
