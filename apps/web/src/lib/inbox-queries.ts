"use client";

import type { QueryClient } from "@tanstack/react-query";
import type {
  ChatMessage,
  ConversationDetailBundle,
  ConversationSummary,
} from "@/lib/inbox-server-data";
import { parseRealtimeEventPayload, subscribeRealtimeEvent } from "@/lib/realtime-client";

export const inboxKeys = {
  all: ["inbox"] as const,
  threads: ["inbox", "threads"] as const,
  detail: (conversationId: string | null | undefined) =>
    ["inbox", "detail", conversationId || ""] as const,
  callbacks: ["inbox", "signals", "callbacks"] as const,
  notifications: ["inbox", "signals", "notifications"] as const,
};

export async function fetchInboxThreads(): Promise<ConversationSummary[]> {
  const res = await fetch("/api/conversations", { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok || !Array.isArray(data.conversations)) {
    throw new Error(data?.error || "Could not refresh chats list.");
  }
  return data.conversations as ConversationSummary[];
}

export async function fetchConversationDetail(
  conversationId: string,
  opts?: { prefetch?: boolean; includeDrawer?: boolean }
): Promise<ConversationDetailBundle & { teams?: unknown[] }> {
  const params = new URLSearchParams();
  if (opts?.prefetch) params.set("prefetch", "1");
  if (opts?.includeDrawer === false) params.set("includeDrawer", "0");
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`/api/conversations/${conversationId}${qs}`, {
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok || !data?.conversation) {
    throw new Error(data?.error || "Could not load conversation.");
  }
  return {
    conversation: data.conversation,
    messages: (data.messages || []) as ChatMessage[],
    hasOlderMessages: Boolean(data.hasOlderMessages),
    oldestMessageCursor: data.oldestMessageCursor
      ? String(data.oldestMessageCursor)
      : (data.messages?.[0]?.createdAt ? String(data.messages[0].createdAt) : null),
    assignments: data.assignments || [],
    customer: data.customer || null,
    orders: data.orders || [],
    orderTrackings: data.orderTrackings || [],
    relations: data.relations || [],
    websiteEnquiries: data.websiteEnquiries || [],
    acrio: data.acrio || null,
    customLinks: data.customLinks || [],
    verifiedLocation: data.verifiedLocation,
    drawerHydrated: data.drawerHydrated !== false,
    teams: Array.isArray(data.teams) ? data.teams : undefined,
  };
}

export async function fetchConversationDrawer(conversationId: string): Promise<
  Pick<
    ConversationDetailBundle,
    | "customer"
    | "orders"
    | "orderTrackings"
    | "relations"
    | "websiteEnquiries"
    | "customLinks"
    | "verifiedLocation"
    | "drawerHydrated"
  >
> {
  const res = await fetch(`/api/conversations/${conversationId}?mode=drawer`, {
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || "Could not load customer details.");
  }
  return {
    customer: data.customer || null,
    orders: data.orders || [],
    orderTrackings: data.orderTrackings || [],
    relations: data.relations || [],
    websiteEnquiries: data.websiteEnquiries || [],
    customLinks: data.customLinks || [],
    verifiedLocation: data.verifiedLocation,
    drawerHydrated: true,
  };
}

/**
 * Merges server-fetched conversation detail with any locally loaded older pages
 * or still-in-flight optimistic bubbles stored inside TanStack Query cache.
 */
export function mergeServerDetailWithCached(
  queryClient: QueryClient,
  convId: string,
  serverBundle: ConversationDetailBundle
): ConversationDetailBundle {
  const prev = queryClient.getQueryData<ConversationDetailBundle>(inboxKeys.detail(convId));
  if (!prev) return serverBundle;

  const serverIds = new Set(serverBundle.messages.map((m) => m.id));
  const serverWaIds = new Set(
    serverBundle.messages.map((m) => m.waMessageId).filter(Boolean)
  );
  const serverOldest = serverBundle.messages[0]?.createdAt || "";

  // Retain older paginated messages loaded earlier above the latest 250-message server window
  const olderPreloaded = serverOldest
    ? prev.messages.filter(
        (m) =>
          !m.id.startsWith("optimistic_") &&
          !serverIds.has(m.id) &&
          m.createdAt < serverOldest
      )
    : [];

  // Retain optimistic messages currently in flight
  const pendingOptimistic = prev.messages.filter(
    (m) =>
      m.id.startsWith("optimistic_") &&
      !serverIds.has(m.id) &&
      !(m.waMessageId && serverWaIds.has(m.waMessageId))
  );

  const mergedMessages = [
    ...olderPreloaded,
    ...serverBundle.messages,
    ...pendingOptimistic,
  ];

  const hasOlder =
    olderPreloaded.length > 0 ? prev.hasOlderMessages : serverBundle.hasOlderMessages;
  const cursor = mergedMessages[0]?.createdAt || serverBundle.oldestMessageCursor || null;

  const keepExistingDrawer =
    serverBundle.drawerHydrated === false && prev.drawerHydrated !== false;

  return {
    ...serverBundle,
    ...(keepExistingDrawer
      ? {
          customer: prev.customer,
          orders: prev.orders,
          orderTrackings: prev.orderTrackings,
          relations: prev.relations,
          websiteEnquiries: prev.websiteEnquiries,
          customLinks: prev.customLinks,
          verifiedLocation: prev.verifiedLocation,
          drawerHydrated: true,
        }
      : {}),
    messages: mergedMessages,
    hasOlderMessages: hasOlder,
    oldestMessageCursor: cursor,
  };
}

export async function prefetchConversationDetail(
  queryClient: QueryClient,
  convId: string
): Promise<void> {
  if (!convId) return;
  await queryClient.prefetchQuery({
    queryKey: inboxKeys.detail(convId),
    queryFn: async () => {
      const bundle = await fetchConversationDetail(convId, {
        prefetch: true,
        includeDrawer: false,
      });
      return mergeServerDetailWithCached(queryClient, convId, bundle);
    },
    staleTime: 20_000,
  });
}

export async function loadOlderMessagesIntoCache(
  queryClient: QueryClient,
  convId: string,
  beforeCursor: string
): Promise<{ added: number; hasOlderMessages: boolean }> {
  const res = await fetch(
    `/api/conversations/${convId}?mode=older&before=${encodeURIComponent(beforeCursor)}`,
    { cache: "no-store" }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok || !Array.isArray(data.messages)) {
    throw new Error(data?.error || "Could not load older messages.");
  }
  const olderMsgs = data.messages as ChatMessage[];
  let added = 0;

  queryClient.setQueryData<ConversationDetailBundle>(
    inboxKeys.detail(convId),
    (prev) => {
      if (!prev) return prev;
      const existingIds = new Set(prev.messages.map((m) => m.id));
      const uniqueOlder = olderMsgs.filter((m) => !existingIds.has(m.id));
      added = uniqueOlder.length;
      const combined = [...uniqueOlder, ...prev.messages];
      return {
        ...prev,
        messages: combined,
        hasOlderMessages: Boolean(data.hasOlderMessages),
        oldestMessageCursor:
          data.oldestMessageCursor || combined[0]?.createdAt || null,
      };
    }
  );

  return { added, hasOlderMessages: Boolean(data.hasOlderMessages) };
}

export function appendOptimisticMessageToCache(
  queryClient: QueryClient,
  params: {
    convId: string;
    msg: ChatMessage;
    currentUserId: string;
    currentUserName: string;
    threadPreviewText?: string;
  }
) {
  const { convId, msg, currentUserId, currentUserName, threadPreviewText } = params;
  const isNote = msg.messageType === "INTERNAL_NOTE";

  queryClient.setQueryData<ConversationDetailBundle>(
    inboxKeys.detail(convId),
    (base) => {
      if (!base) return base;
      return {
        ...base,
        conversation: isNote
          ? base.conversation
          : {
              ...base.conversation,
              status: "ASSIGNED",
              assignedStaffId:
                base.conversation.assignedStaffId === "ACRIO" ||
                !base.conversation.assignedStaffId
                  ? currentUserId
                  : base.conversation.assignedStaffId,
              assignedStaffName:
                base.conversation.assignedStaffId === "ACRIO" ||
                !base.conversation.assignedStaffId
                  ? currentUserName
                  : base.conversation.assignedStaffName,
              assignedTeamId: base.conversation.assignedTeamId || "team_sales",
              assignedTeamName:
                base.conversation.assignedTeamName &&
                base.conversation.assignedTeamName !== "ACRIO Assistant" &&
                base.conversation.assignedTeamName !== "System (ACRIO)"
                  ? base.conversation.assignedTeamName
                  : "Sales Team",
              waitingSince: null,
            },
        messages: [...base.messages, msg],
      };
    }
  );

  if (msg.direction === "OUTBOUND") {
    const preview = (threadPreviewText ?? msg.body)
      .replace(/\s*\n+\s*/g, " ")
      .slice(0, 140);
    queryClient.setQueryData<ConversationSummary[]>(
      inboxKeys.threads,
      (prev) =>
        prev
          ? prev.map((t) =>
              t.id === convId
                ? {
                    ...t,
                    lastMessagePreview: preview,
                    lastMessageAt: msg.createdAt,
                    lastMessageDirection: "OUTBOUND",
                    lastMessageStatus: msg.deliveryStatus,
                    waitingSince: null,
                  }
                : t
            )
          : prev
    );
  }
}

export function patchOptimisticMessageInCache(
  queryClient: QueryClient,
  convId: string,
  tempId: string,
  patch: {
    id?: string;
    deliveryStatus?: string;
    waMessageId?: string | null;
    metadata?: Record<string, unknown> | null;
    body?: string;
  },
  recentLocalMsgIds?: Map<string, number>
) {
  if (patch.id && !patch.id.startsWith("optimistic_") && recentLocalMsgIds) {
    recentLocalMsgIds.set(patch.id, Date.now());
  }

  queryClient.setQueryData<ConversationDetailBundle>(
    inboxKeys.detail(convId),
    (cur) => {
      if (!cur) return cur;
      return {
        ...cur,
        messages: cur.messages.map((m) =>
          m.id === tempId
            ? {
                ...m,
                ...(patch.id ? { id: patch.id } : {}),
                ...(patch.deliveryStatus
                  ? { deliveryStatus: patch.deliveryStatus }
                  : {}),
                ...(patch.waMessageId !== undefined
                  ? { waMessageId: patch.waMessageId }
                  : {}),
                ...(patch.metadata !== undefined
                  ? { metadata: patch.metadata }
                  : {}),
                ...(patch.body !== undefined ? { body: patch.body } : {}),
              }
            : m
        ),
      };
    }
  );

  if (patch.deliveryStatus) {
    queryClient.setQueryData<ConversationSummary[]>(
      inboxKeys.threads,
      (prev) =>
        prev
          ? prev.map((t) =>
              t.id === convId
                ? {
                    ...t,
                    lastMessageDirection: "OUTBOUND",
                    lastMessageStatus: patch.deliveryStatus!,
                  }
                : t
            )
          : prev
    );
  }
}

export function attachInboxRealtimeQuerySync(params: {
  queryClient: QueryClient;
  getSelectedId: () => string | null;
  recentLocalMsgIds: Map<string, number>;
}): () => void {
  const { queryClient, getSelectedId, recentLocalMsgIds } = params;
  let threadsTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleThreadsInvalidate = () => {
    if (threadsTimer) clearTimeout(threadsTimer);
    threadsTimer = setTimeout(() => {
      threadsTimer = null;
      void queryClient.invalidateQueries({ queryKey: inboxKeys.threads });
    }, 220);
  };

  const handleRealtimeRefresh = (ev: MessageEvent) => {
    const payload = parseRealtimeEventPayload(ev);
    const targetConvId = payload.conversationId ? String(payload.conversationId) : null;
    const incomingMsgId = payload.messageId ? String(payload.messageId) : null;
    scheduleThreadsInvalidate();

    const activeId = getSelectedId();
    if (activeId && (!targetConvId || targetConvId === activeId)) {
      if (incomingMsgId) {
        const seenAt = recentLocalMsgIds.get(incomingMsgId);
        if (seenAt && Date.now() - seenAt < 4000) {
          return;
        }
      }
      void queryClient.invalidateQueries({ queryKey: inboxKeys.detail(activeId) });
    } else if (targetConvId && queryClient.getQueryData(inboxKeys.detail(targetConvId))) {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.detail(targetConvId) });
    }
  };

  const handleStatusEvent = (ev: MessageEvent) => {
    const payload = parseRealtimeEventPayload(ev);
    const targetConvId = payload.conversationId ? String(payload.conversationId) : null;
    const nextStatus = payload.status ? String(payload.status) : null;
    const targetMsgId = payload.messageId ? String(payload.messageId) : null;
    const targetWaMsgId = payload.waMessageId ? String(payload.waMessageId) : null;
    const markAllRead = Boolean(payload.markAllOutboundRead);

    if (!targetConvId || !nextStatus) return;

    let cachedHit = false;
    queryClient.setQueryData<ConversationDetailBundle>(
      inboxKeys.detail(targetConvId),
      (cached) => {
        if (!cached) return cached;
        cachedHit = true;
        let changed = false;
        const patched = cached.messages.map((m) => {
          if (m.direction !== "OUTBOUND") return m;
          if (
            markAllRead &&
            (m.deliveryStatus === "SENDING" ||
              m.deliveryStatus === "SENT" ||
              m.deliveryStatus === "DELIVERED")
          ) {
            changed = true;
            return { ...m, deliveryStatus: "READ" };
          }
          if (
            (targetMsgId && m.id === targetMsgId) ||
            (targetWaMsgId && m.waMessageId === targetWaMsgId)
          ) {
            changed = true;
            return { ...m, deliveryStatus: nextStatus };
          }
          return m;
        });
        return changed ? { ...cached, messages: patched } : cached;
      }
    );

    queryClient.setQueryData<ConversationSummary[]>(
      inboxKeys.threads,
      (prev) =>
        prev
          ? prev.map((t) =>
              t.id === targetConvId && t.lastMessageDirection === "OUTBOUND"
                ? { ...t, lastMessageStatus: nextStatus }
                : t
            )
          : prev
    );

    if (!cachedHit && getSelectedId() === targetConvId) {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.detail(targetConvId) });
    }
  };

  const unsubs = [
    subscribeRealtimeEvent("message:new", handleRealtimeRefresh),
    subscribeRealtimeEvent("note:new", handleRealtimeRefresh),
    subscribeRealtimeEvent("message:status", handleStatusEvent),
    subscribeRealtimeEvent("conversation:resolved", handleRealtimeRefresh),
    subscribeRealtimeEvent("conversation:assigned", handleRealtimeRefresh),
    subscribeRealtimeEvent("conversation:escalated", handleRealtimeRefresh),
  ];

  return () => {
    unsubs.forEach((fn) => fn());
    if (threadsTimer) clearTimeout(threadsTimer);
  };
}
