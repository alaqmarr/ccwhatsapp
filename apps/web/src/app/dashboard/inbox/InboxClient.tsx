"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  FileText,
  Link2,
  Lock,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  StickyNote,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import {
  CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE,
  ChatMessagesSkeleton,
  ClassicConceptsMark,
  ElementErrorState,
  RightDrawerSkeleton,
  WHATSAPP_PUBLIC_ORIGIN,
  WhatsAppLogoIcon,
} from "@cc/ui";
import type {
  ApprovedTemplateOption,
  ChatMessage,
  ConversationDetailBundle,
  ConversationSummary,
  InitialInboxPayload,
  StaffOption,
  TeamOption,
} from "@/lib/inbox-server-data";

function formatShortThreadTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function formatWindowCountdown(
  expiresIso: string | null,
  nowMs: number
): { open: boolean; label: string } {
  if (!expiresIso) {
    return { open: false, label: "Chat window expired" };
  }
  const diffMs = new Date(expiresIso).getTime() - nowMs;
  if (Number.isNaN(diffMs) || diffMs <= 0) {
    return { open: false, label: "Chat window expired" };
  }
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const timeText =
    hours > 0
      ? `${hours}h ${minutes}m`
      : `${Math.max(1, minutes)}m`;
  return {
    open: true,
    label: `Chat window expires in ${timeText}`,
  };
}

function formatWaitingDuration(
  waitingSinceIso: string | null,
  nowMs: number
): { minutes: number; text: string } | null {
  if (!waitingSinceIso) return null;
  const start = new Date(waitingSinceIso).getTime();
  if (Number.isNaN(start)) return null;
  const elapsedSec = Math.max(0, Math.floor((nowMs - start) / 1000));
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return { minutes: mins, text: `${hrs}h ${remMins}m` };
  }
  if (mins > 0) {
    return { minutes: mins, text: `${mins}m ${secs}s` };
  }
  return { minutes: 0, text: `${secs}s` };
}

function formatResponseSpeed(seconds: number | null): string | null {
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "CC";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function InboxClient({
  initialData,
}: {
  initialData: InitialInboxPayload;
}) {
  const [threads, setThreads] = useState<ConversationSummary[]>(initialData.threads);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialData.initialSelectedId
  );
  const [detail, setDetail] = useState<ConversationDetailBundle | null>(
    initialData.initialDetail
  );

  // Per-conversation client memory cache so switching threads NEVER flashes blank!
  const detailCacheRef = useRef<Map<string, ConversationDetailBundle>>(new Map());
  if (
    initialData.initialSelectedId &&
    initialData.initialDetail &&
    !detailCacheRef.current.has(initialData.initialSelectedId)
  ) {
    detailCacheRef.current.set(
      initialData.initialSelectedId,
      initialData.initialDetail
    );
  }

  const [teams, setTeams] = useState<TeamOption[]>(initialData.teams);
  const [staffList] = useState<StaffOption[]>(initialData.staffList);
  const [templates] = useState<ApprovedTemplateOption[]>(initialData.templates);

  const [quickFilter, setQuickFilter] = useState<
    "ALL" | "WAITING" | "ACRIO" | "UNREAD" | "MINE" | "RESOLVED"
  >("ALL");
  const [teamFilter, setTeamFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [syncingThread, setSyncingThread] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string>("");
  const [threadsError, setThreadsError] = useState<string>("");
  const [refreshingThreads, setRefreshingThreads] = useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(initialData.serverNowMs);

  // Composer state: Free WhatsApp Reply | Paid Approved Template | Private Internal Team Note
  const [composerMode, setComposerMode] = useState<"REPLY" | "TEMPLATE" | "NOTE">(
    "REPLY"
  );
  const [replyText, setReplyText] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    initialData.templates[0]?.id || ""
  );
  const [sending, setSending] = useState<boolean>(false);
  const [showRightDrawer, setShowRightDrawer] = useState<boolean>(true);
  const [toast, setToast] = useState<string>("");

  // Right CRM panel tab
  const [rightTab, setRightTab] = useState<
    "PROFILE" | "ORDERS" | "NOTES" | "HISTORY"
  >("PROFILE");

  // Resolve modal
  const [showResolveModal, setShowResolveModal] = useState<boolean>(false);
  const [resolveSummary, setResolveSummary] = useState<string>("");

  // Assign Team & Staff modal
  const [showAssignModal, setShowAssignModal] = useState<boolean>(false);
  const [assignTeamId, setAssignTeamId] = useState<string>("team_sales");
  const [assignStaffId, setAssignStaffId] = useState<string>("");
  const [assignTier, setAssignTier] = useState<"P0" | "P1" | "P2">("P0");

  // New conversation / Simulator modal
  const [showNewChatModal, setShowNewChatModal] = useState<boolean>(false);
  const [simPhone, setSimPhone] = useState<string>("+91 98480 55112");
  const [simName, setSimName] = useState<string>("Vikram Mehta");
  const [simOrg, setSimOrg] = useState<string>("Hotel/Hospitality");
  const [simText, setSimText] = useState<string>(
    "Hi, we need 6 clear acrylic banquet podiums and 1 YN-JW1200 diamond polishing machine quote."
  );
  const [simDirection, setSimDirection] = useState<"INBOUND" | "OUTBOUND">(
    "INBOUND"
  );

  // Add order inline state
  const [newOrderItems, setNewOrderItems] = useState<string>("");
  const [newOrderQty, setNewOrderQty] = useState<number>(1);
  const [newOrderAmount, setNewOrderAmount] = useState<string>("");

  // Editable customer profile fields
  const [editCompany, setEditCompany] = useState<string>(
    initialData.initialDetail?.customer?.companyName || ""
  );
  const [editOrgType, setEditOrgType] = useState<string>(
    initialData.initialDetail?.customer?.organizationType || "Business"
  );
  const [editCity, setEditCity] = useState<string>(
    initialData.initialDetail?.customer?.city || ""
  );
  const [editNotes, setEditNotes] = useState<string>(
    initialData.initialDetail?.customer?.notes || ""
  );
  const [quickNoteDraft, setQuickNoteDraft] = useState<string>("");

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }, []);

  // Tick every second for live wait-time counter + "Chat window expires in {time}"
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const syncProfileFields = useCallback((bundle: ConversationDetailBundle) => {
    setEditCompany(bundle.customer?.companyName || "");
    setEditOrgType(bundle.customer?.organizationType || "Business");
    setEditCity(bundle.customer?.city || "");
    setEditNotes(bundle.customer?.notes || "");
    setResolveSummary(
      bundle.acrio?.resolutionDraft ||
        `Resolved enquiry with ${bundle.conversation.customerName}.`
    );
  }, []);

  // Silent background refresh of thread list (never clears existing threads!)
  const refreshThreadsSilently = useCallback(async (manual = false) => {
    if (manual) {
      setRefreshingThreads(true);
      setThreadsError("");
    }
    try {
      const res = await fetch("/api/conversations", { cache: "no-store" });
      if (!res.ok) {
        if (manual) {
          setThreadsError("Could not refresh chats list right now.");
        }
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.ok && Array.isArray(data.conversations)) {
        setThreads(data.conversations);
        setThreadsError("");
      } else if (manual) {
        setThreadsError(data.error || "Could not refresh chats list.");
      }
    } catch {
      if (manual) {
        setThreadsError("Network error while refreshing chats.");
      }
    } finally {
      if (manual) setRefreshingThreads(false);
    }
  }, []);

  // Silent detail fetch: renders cached copy at 0ms if switching, or element skeletons + retry if uncached!
  const fetchAndCacheDetail = useCallback(
    async (convId: string, updateProfileInputs = false) => {
      const cached = detailCacheRef.current.get(convId);
      if (cached && selectedIdRef.current === convId) {
        setDetail(cached);
        setDetailError("");
        if (updateProfileInputs) syncProfileFields(cached);
      } else if (selectedIdRef.current === convId) {
        setDetail(null);
        setDetailError("");
        setSyncingThread(true);
      }

      try {
        const res = await fetch(`/api/conversations/${convId}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok && data.conversation) {
          const nextBundle: ConversationDetailBundle = {
            conversation: data.conversation,
            messages: data.messages || [],
            customer: data.customer || null,
            orders: data.orders || [],
            relations: data.relations || [],
            websiteEnquiries: data.websiteEnquiries || [],
            acrio: data.acrio || null,
            customLinks: data.customLinks || [],
          };
          detailCacheRef.current.set(convId, nextBundle);
          if (Array.isArray(data.teams) && data.teams.length > 0) {
            setTeams((prev) => (prev.length > 0 ? prev : data.teams));
          }
          if (selectedIdRef.current === convId) {
            setDetail(nextBundle);
            setDetailError("");
            if (updateProfileInputs || !cached) {
              syncProfileFields(nextBundle);
            }
          }
          setThreads((prev) =>
            prev.map((t) =>
              t.id === convId ? { ...t, unreadCount: 0 } : t
            )
          );
        } else if (!cached && selectedIdRef.current === convId) {
          setDetailError(
            data.error || "Could not load this conversation right now."
          );
        }
      } catch {
        if (!cached && selectedIdRef.current === convId) {
          setDetailError(
            "Network error while loading messages. Click Try Again to reload."
          );
        }
      } finally {
        setSyncingThread(false);
      }
    },
    [syncProfileFields]
  );

  // Select conversation handler (zero flash on cached, element skeleton on uncached!)
  function handleSelectConversation(convId: string) {
    if (convId === selectedId && (detail || syncingThread)) return;
    setSelectedId(convId);
    selectedIdRef.current = convId;
    setDetailError("");
    const cached = detailCacheRef.current.get(convId);
    if (cached) {
      setDetail(cached);
      syncProfileFields(cached);
    } else {
      setDetail(null);
      setSyncingThread(true);
    }
    void fetchAndCacheDetail(convId, true);
  }

  // Real-time SSE + gentle silent poll (never triggers loading spinners on existing chats!)
  useEffect(() => {
    const es = new EventSource("/api/realtime/stream");
    const refresh = () => {
      void refreshThreadsSilently(false);
      if (selectedIdRef.current) {
        void fetchAndCacheDetail(selectedIdRef.current, false);
      }
    };
    es.addEventListener("message:new", refresh);
    es.addEventListener("note:new", refresh);
    es.addEventListener("message:status", refresh);
    es.addEventListener("conversation:resolved", refresh);
    es.addEventListener("conversation:assigned", refresh);
    es.addEventListener("conversation:escalated", refresh);

    const poll = setInterval(() => {
      void refreshThreadsSilently(false);
      if (selectedIdRef.current) {
        void fetchAndCacheDetail(selectedIdRef.current, false);
      }
    }, 15000);

    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [fetchAndCacheDetail, refreshThreadsSilently]);

  // Smooth scroll only when message count changes or selected conversation changes
  const messageCount = detail?.messages.length ?? 0;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedId, messageCount]);

  // Pre-fill template body when user selects an approved template
  const activeConv = detail?.conversation || null;
  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || templates[0] || null,
    [templates, selectedTemplateId]
  );

  function applyTemplateToDraft(tpl: ApprovedTemplateOption | null) {
    if (!tpl) return;
    const firstName =
      activeConv?.customerName?.trim().split(/\s+/)[0] || "Sir/Madam";
    const latestOrder = detail?.orders[0]?.orderNumber || "CC-2026";
    const filled = tpl.bodyText
      .replace(/\{\{1\}\}/g, firstName)
      .replace(/\{\{2\}\}/g, latestOrder)
      .replace(/\{\{3\}\}/g, "ready for dispatch");
    setReplyText(
      tpl.ctaUrl ? `${filled}\n${tpl.ctaUrl}` : filled
    );
  }

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
      if (quickFilter === "WAITING") {
        if (t.status === "RESOLVED" || !t.waitingSince) return false;
      } else if (quickFilter === "ACRIO") {
        if (t.status === "RESOLVED" || t.assignedStaffId !== "ACRIO") return false;
      } else if (quickFilter === "UNREAD") {
        if (t.unreadCount <= 0) return false;
      } else if (quickFilter === "MINE") {
        if (t.assignedStaffId !== initialData.currentUserId) return false;
      } else if (quickFilter === "RESOLVED") {
        if (t.status !== "RESOLVED") return false;
      }

      if (teamFilter !== "ALL" && t.assignedTeamId !== teamFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${t.customerName} ${t.customerPhone} ${t.lastMessagePreview} ${t.smartCategory} ${t.assignedTeamName || ""} ${t.assignedStaffName || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [threads, quickFilter, teamFilter, searchQuery, initialData.currentUserId]);

  const messages = detail?.messages || [];
  const internalNotes = useMemo(
    () =>
      messages.filter(
        (m) => m.direction === "INTERNAL" || m.messageType === "INTERNAL_NOTE"
      ),
    [messages]
  );

  const isAcrioHandling = activeConv?.assignedStaffId === "ACRIO";

  const windowStatus = formatWindowCountdown(
    activeConv?.windowExpiresAt || null,
    nowMs
  );
  const activeWait =
    activeConv && activeConv.status !== "RESOLVED" && !isAcrioHandling
      ? formatWaitingDuration(activeConv.waitingSince, nowMs)
      : null;

  async function handleComposerSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !replyText.trim() || !detail) return;

    const textToSend = replyText.trim();
    const currentConvId = selectedId;
    setSending(true);
    setReplyText("");

    // Optimistic UI append at 0ms so there is zero waiting or screen jump!
    const tempId = `optimistic_${Date.now()}`;
    const nowIso = new Date().toISOString();
    const optimisticMsg: ChatMessage =
      composerMode === "NOTE"
        ? {
            id: tempId,
            direction: "INTERNAL",
            senderType: "STAFF_NOTE",
            senderName: initialData.currentUserName,
            messageType: "INTERNAL_NOTE",
            billingCategory: "INTERNAL",
            body: textToSend,
            templateName: null,
            deliveryStatus: "SAVED",
            createdAt: nowIso,
          }
        : {
            id: tempId,
            direction: "OUTBOUND",
            senderType: "STAFF",
            senderName: initialData.currentUserName,
            messageType: composerMode === "TEMPLATE" ? "TEMPLATE" : "TEXT",
            billingCategory:
              composerMode === "TEMPLATE" && activeTemplate
                ? activeTemplate.category
                : "FREE_CHAT",
            body: textToSend,
            templateName:
              composerMode === "TEMPLATE" && activeTemplate
                ? activeTemplate.name
                : null,
            deliveryStatus: "SENT",
            createdAt: nowIso,
          };

    const optimisticBundle: ConversationDetailBundle = {
      ...detail,
      conversation:
        composerMode === "NOTE"
          ? detail.conversation
          : {
              ...detail.conversation,
              status: "ASSIGNED",
              assignedStaffId:
                detail.conversation.assignedStaffId === "ACRIO" ||
                !detail.conversation.assignedStaffId
                  ? initialData.currentUserId
                  : detail.conversation.assignedStaffId,
              assignedStaffName:
                detail.conversation.assignedStaffId === "ACRIO" ||
                !detail.conversation.assignedStaffId
                  ? initialData.currentUserName
                  : detail.conversation.assignedStaffName,
              assignedTeamId: detail.conversation.assignedTeamId || "team_sales",
              assignedTeamName:
                detail.conversation.assignedTeamName &&
                detail.conversation.assignedTeamName !== "ACRIO Assistant" &&
                detail.conversation.assignedTeamName !== "System (ACRIO)"
                  ? detail.conversation.assignedTeamName
                  : "Sales Team",
              waitingSince: null,
            },
      messages: [...detail.messages, optimisticMsg],
    };
    setDetail(optimisticBundle);
    detailCacheRef.current.set(currentConvId, optimisticBundle);

    try {
      if (composerMode === "NOTE") {
        await fetch(`/api/conversations/${currentConvId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add_internal_note",
            noteText: textToSend,
          }),
        });
        showToast("Internal team note saved (Free).");
      } else if (composerMode === "TEMPLATE" && activeTemplate) {
        await fetch(`/api/conversations/${currentConvId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "send_message",
            text: textToSend,
            messageType: "TEMPLATE",
            templateName: activeTemplate.name,
            billingCategory: activeTemplate.category,
          }),
        });
        const rateLabel =
          activeTemplate.category === "MARKETING" ? "₹0.95" : "₹0.30";
        showToast(`Template sent (${rateLabel}).`);
        setComposerMode("REPLY");
      } else {
        await fetch(`/api/conversations/${currentConvId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "send_message",
            text: textToSend,
            messageType: "TEXT",
          }),
        });
      }
      await Promise.all([
        fetchAndCacheDetail(currentConvId, false),
        refreshThreadsSilently(),
      ]);
    } finally {
      setSending(false);
    }
  }

  async function handleQuickNoteSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !quickNoteDraft.trim()) return;
    const text = quickNoteDraft.trim();
    setQuickNoteDraft("");
    await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_internal_note",
        noteText: text,
      }),
    });
    showToast("Internal note added.");
    await fetchAndCacheDetail(selectedId, false);
  }

  async function handleTakeOverFromAcrio() {
    if (!selectedId) return;
    await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "take_over_from_acrio" }),
    });
    showToast("You took over this chat under Sales Team.");
    await Promise.all([
      fetchAndCacheDetail(selectedId, false),
      refreshThreadsSilently(),
    ]);
  }

  async function handleReturnToAcrio() {
    if (!selectedId) return;
    await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "return_to_acrio" }),
    });
    showToast("Assigned chat to System (ACRIO).");
    await Promise.all([
      fetchAndCacheDetail(selectedId, false),
      refreshThreadsSilently(),
    ]);
  }

  async function handleSmartAssignSalesP0() {
    if (!selectedId) return;
    const res = await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "smart_assign", teamId: "team_sales" }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok && data.assignment) {
      showToast(
        `Connected to ${data.assignment.teamName} (${data.assignment.escalationLevel}: ${data.assignment.staffName})`
      );
    } else {
      showToast("Connected to Sales Team P0.");
    }
    await Promise.all([
      fetchAndCacheDetail(selectedId, false),
      refreshThreadsSilently(),
    ]);
  }

  async function handleManualAssignSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    const chosenTeam = teams.find((t) => t.id === assignTeamId);
    const chosenStaff = staffList.find((s) => s.id === assignStaffId);

    if (assignStaffId === "ACRIO") {
      await fetch(`/api/conversations/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "return_to_acrio" }),
      });
      showToast("Assigned chat to System (ACRIO).");
    } else if (!assignStaffId) {
      await fetch(`/api/conversations/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "smart_assign",
          teamId: assignTeamId || "team_sales",
          tier: assignTier,
        }),
      });
      showToast(
        `Assigned to available ${assignTier} member in ${
          chosenTeam?.name || "Sales Team"
        }`
      );
    } else {
      await fetch(`/api/conversations/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign_staff",
          teamId: chosenTeam?.id || "team_sales",
          teamName: chosenTeam?.name || "Sales Team",
          staffId: chosenStaff?.id,
          staffName: chosenStaff?.name,
          escalationLevel: assignTier,
        }),
      });
      showToast(`Assigned to ${chosenStaff?.name || "teammate"} (${assignTier})`);
    }

    setShowAssignModal(false);
    await Promise.all([
      fetchAndCacheDetail(selectedId, false),
      refreshThreadsSilently(),
    ]);
  }

  async function handleSmartResolve() {
    if (!selectedId) return;
    await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "smart_resolve",
        resolutionSummary: resolveSummary,
        smartCategory: detail?.acrio?.smartCategory,
      }),
    });
    setShowResolveModal(false);
    showToast("Chat marked resolved.");
    await Promise.all([
      fetchAndCacheDetail(selectedId, false),
      refreshThreadsSilently(),
    ]);
  }

  async function handleReopen() {
    if (!selectedId) return;
    await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen" }),
    });
    await Promise.all([
      fetchAndCacheDetail(selectedId, false),
      refreshThreadsSilently(),
    ]);
  }

  async function handleSaveCustomerProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_customer_profile",
        companyName: editCompany,
        organizationType: editOrgType,
        city: editCity,
        notes: editNotes,
      }),
    });
    showToast("Customer details saved.");
    await fetchAndCacheDetail(selectedId, false);
  }

  async function handleAddOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !newOrderItems.trim()) return;
    await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_order",
        itemsSummary: newOrderItems,
        quantity: newOrderQty,
        totalAmountInr: Number(newOrderAmount || 0),
      }),
    });
    setNewOrderItems("");
    setNewOrderQty(1);
    setNewOrderAmount("");
    showToast("Order recorded.");
    await fetchAndCacheDetail(selectedId, false);
  }

  async function handleSimulateOrNewChat(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerPhone: simPhone,
        customerName: simName,
        organizationType: simOrg,
        messageText: simText,
        direction: simDirection,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok && data.conversationId) {
      setShowNewChatModal(false);
      setSelectedId(data.conversationId);
      selectedIdRef.current = data.conversationId;
      await Promise.all([
        refreshThreadsSilently(),
        fetchAndCacheDetail(data.conversationId, true),
      ]);
      showToast(
        simDirection === "INBOUND"
          ? "Customer message received and handled by ACRIO."
          : "New WhatsApp chat started (Free)."
      );
    }
  }

  function appendToComposer(snippet: string) {
    if (composerMode === "NOTE") setComposerMode("REPLY");
    setReplyText((prev) => (prev ? `${prev.trim()} ${snippet}` : snippet));
  }

  return (
    <div className="h-[calc(100vh)] w-full flex overflow-hidden bg-[#f0f2f5] select-text">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 px-3.5 py-2 rounded-lg bg-neutral-900 text-white text-xs font-medium shadow-lg">
          {toast}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 1. LEFT WHATSAPP SIDEBAR: CHATS, ACRIO VS STAFF FILTERS, WAIT BADGES */}
      {/* ===================================================================== */}
      <div className="w-[340px] xl:w-[375px] shrink-0 border-r border-[#d1d7db] flex flex-col bg-white">
        {/* WhatsApp Web Style Top Bar */}
        <div className="h-[58px] px-3.5 bg-[#f0f2f5] border-b border-[#d1d7db] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <ClassicConceptsMark size={28} />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-[#111b21] truncate flex items-center gap-1.5">
                <span>Chats</span>
                {waitingThreadsCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-semibold">
                    {waitingThreadsCount} waiting
                  </span>
                )}
              </h1>
              <p className="text-[11px] text-[#667781] truncate">
                System (ACRIO) • Handoff to Sales Team
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => refreshThreadsSilently(true)}
              title="Refresh chats"
              className="p-2 rounded-full hover:bg-[#e9edef] text-[#54656f] cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  refreshingThreads ? "animate-spin" : ""
                }`}
              />
            </button>
            <Link
              href="/dashboard/teams"
              title="Teams & Escalation Flow"
              className="p-2 rounded-full hover:bg-[#e9edef] text-[#54656f]"
            >
              <Users className="w-4 h-4" />
            </Link>
            <button
              type="button"
              onClick={() => setShowNewChatModal(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer"
            >
              <WhatsAppLogoIcon size={13} />
              <span>+ New Chat</span>
            </button>
          </div>
        </div>

        {/* Search + Filter Pills */}
        <div className="px-3 py-2 bg-white border-b border-[#e9edef] space-y-2 shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[#54656f] absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search customer, phone, or product"
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#f0f2f5] text-xs text-[#111b21] placeholder:text-[#667781] focus:outline-none focus:ring-1 focus:ring-[#00a884]"
              />
            </div>

            {teams.length > 0 && (
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                title="Filter by Team"
                className="px-2 py-1.5 rounded-lg bg-[#f0f2f5] text-[11px] font-medium text-[#3b4a54] border-0 max-w-[115px] truncate focus:outline-none"
              >
                <option value="ALL">All Teams</option>
                {teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* WhatsApp Filter Chips */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            {(
              [
                { key: "ALL", label: "All" },
                {
                  key: "WAITING",
                  label:
                    waitingThreadsCount > 0
                      ? `Needs Staff (${waitingThreadsCount})`
                      : "Needs Staff",
                },
                {
                  key: "ACRIO",
                  label:
                    acrioThreadsCount > 0
                      ? `System (${acrioThreadsCount})`
                      : "System",
                },
                { key: "UNREAD", label: "Unread" },
                { key: "MINE", label: "Mine" },
                { key: "RESOLVED", label: "Resolved" },
              ] as const
            ).map((pill) => {
              const active = quickFilter === pill.key;
              return (
                <button
                  key={pill.key}
                  type="button"
                  onClick={() => setQuickFilter(pill.key)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                    active
                      ? "bg-[#e7fce3] text-[#008069]"
                      : "bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]"
                  }`}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* WhatsApp Conversation Rows */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#f0f2f5]">
          {threadsError && (
            <div className="p-3">
              <ElementErrorState
                compact
                title="Could not refresh chats"
                message={threadsError}
                onRetry={() => refreshThreadsSilently(true)}
                retrying={refreshingThreads}
              />
            </div>
          )}
          {filteredThreads.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#667781]">
              No chats match this filter.
            </div>
          ) : (
            filteredThreads.map((t) => {
              const active = t.id === selectedId;
              const isAcrio = t.assignedStaffId === "ACRIO";
              const waitObj =
                t.status !== "RESOLVED" && !isAcrio
                  ? formatWaitingDuration(t.waitingSince, nowMs)
                  : null;
              const isOverdue = waitObj && waitObj.minutes >= 5;

              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleSelectConversation(t.id)}
                  className={`w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors cursor-pointer ${
                    active ? "bg-[#f0f2f5]" : "hover:bg-[#f5f6f6]"
                  }`}
                >
                  {/* Customer Avatar Circle */}
                  <div
                    className={`w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-xs font-semibold relative ${
                      t.status === "RESOLVED"
                        ? "bg-neutral-200 text-neutral-600"
                        : isOverdue
                        ? "bg-red-100 text-red-800 ring-2 ring-red-300"
                        : isAcrio
                        ? "bg-[#eef2ff] text-[#3730a3]"
                        : "bg-[#dfe5e7] text-[#3b4a54]"
                    }`}
                  >
                    {getInitials(t.customerName)}
                    <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#25d366] text-white flex items-center justify-center ring-2 ring-white">
                      <WhatsAppLogoIcon size={9} />
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13.5px] font-semibold text-[#111b21] truncate">
                        {t.customerName}
                      </span>
                      <span
                        className={`text-[11px] shrink-0 ${
                          t.unreadCount > 0
                            ? "text-[#00a884] font-semibold"
                            : "text-[#667781]"
                        }`}
                      >
                        {formatShortThreadTime(t.lastMessageAt)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-xs text-[#667781] truncate">
                        {t.lastMessagePreview || t.customerPhone}
                      </p>
                      {t.unreadCount > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#25d366] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                          {t.unreadCount}
                        </span>
                      )}
                    </div>

                    {/* ACRIO / Team / Escalation / Live Wait Row */}
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      {t.status === "RESOLVED" ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">
                          Resolved
                        </span>
                      ) : isAcrio ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 font-medium inline-flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5" />
                          <span>System (ACRIO)</span>
                        </span>
                      ) : (
                        <>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                              t.escalationLevel === "P2"
                                ? "bg-red-600 text-white"
                                : t.escalationLevel === "P1"
                                ? "bg-amber-500 text-white"
                                : "bg-[#e9edef] text-[#3b4a54]"
                            }`}
                          >
                            {t.escalationLevel || "P0"}
                          </span>

                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 font-medium truncate max-w-[105px]">
                            {t.assignedTeamName || "Sales Team"}
                          </span>

                          {t.assignedStaffName && (
                            <span className="text-[10px] text-[#54656f] truncate max-w-[85px]">
                              • {t.assignedStaffName.split(" ")[0]}
                            </span>
                          )}

                          {waitObj && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-0.5 ${
                                waitObj.minutes >= 8
                                  ? "bg-red-100 text-red-800"
                                  : waitObj.minutes >= 3
                                  ? "bg-amber-100 text-amber-900"
                                  : "bg-emerald-50 text-emerald-800"
                              }`}
                            >
                              <Clock className="w-2.5 h-2.5" />
                              <span>Wait {waitObj.text}</span>
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 2. CENTER WHATSAPP CONVERSATION STREAM + CLASSIC CONCEPTS WALLPAPER  */}
      {/* ===================================================================== */}
      <div className="flex-1 min-w-0 flex flex-col bg-[#efeae2]">
        {!activeConv ? (
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
                  onRetry={() => fetchAndCacheDetail(selectedId, true)}
                  retrying={syncingThread}
                />
              </div>
            ) : (
              <div className="p-8 text-center flex justify-center">
                <div className="bg-white/95 border border-[#d1d7db] rounded-xl p-6 max-w-sm shadow-xs space-y-2.5">
                  <div className="mx-auto w-12 h-12 rounded-full bg-[#e7fce3] flex items-center justify-center text-[#00a884]">
                    <WhatsAppLogoIcon size={24} />
                  </div>
                  <h2 className="text-sm font-semibold text-[#111b21]">
                    Classic Concepts WhatsApp Desk
                  </h2>
                  <p className="text-xs text-[#54656f]">
                    Select any customer chat on the left. New enquiries are handled automatically by ACRIO first and connected to Sales Team whenever human help is needed.
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Top WhatsApp Chat Header */}
            <div className="min-h-[58px] px-4 py-2 bg-[#f0f2f5] border-b border-[#d1d7db] flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-[#dfe5e7] text-[#3b4a54] flex items-center justify-center text-xs font-semibold shrink-0 relative">
                  {getInitials(activeConv.customerName)}
                  <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#25d366] text-white flex items-center justify-center ring-2 ring-[#f0f2f5]">
                    <WhatsAppLogoIcon size={9} />
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-[#111b21] truncate">
                      {activeConv.customerName}
                    </h2>
                    <span className="text-xs font-mono text-[#54656f]">
                      {activeConv.customerPhone}
                    </span>
                    {detail?.customer?.companyName && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-white border border-[#d1d7db] text-[#3b4a54]">
                        {detail.customer.companyName}
                      </span>
                    )}
                    {syncingThread && (
                      <span className="text-[10px] text-[#667781]">Syncing...</span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px]">
                    {/* Required phrasing: "Chat window expires in {time}" */}
                    <span
                      className={`font-medium ${
                        windowStatus.open ? "text-[#008069]" : "text-amber-700"
                      }`}
                    >
                      {windowStatus.label}
                    </span>

                    {isAcrioHandling && activeConv.status !== "RESOLVED" && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 font-medium inline-flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        <span>Assigned to System (ACRIO)</span>
                      </span>
                    )}

                    {/* Live Customer Waiting Counter (for Sales Team / Human Staff) */}
                    {activeWait && (
                      <span
                        className={`px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1 ${
                          activeWait.minutes >= 8
                            ? "bg-red-100 text-red-800"
                            : activeWait.minutes >= 3
                            ? "bg-amber-100 text-amber-900"
                            : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        <Clock className="w-3 h-3" />
                        <span>Customer waiting {activeWait.text}</span>
                      </span>
                    )}

                    {!activeWait &&
                      !isAcrioHandling &&
                      activeConv.lastResponseSeconds !== null && (
                        <span className="text-[#667781]">
                          • Last reply in{" "}
                          {formatResponseSpeed(activeConv.lastResponseSeconds)}
                        </span>
                      )}
                  </div>
                </div>
              </div>

              {/* Right Header Actions: ACRIO Takeover / Sales Team / Assign / Resolve */}
              <div className="flex flex-wrap items-center gap-1.5">
                {activeConv.status !== "RESOLVED" && isAcrioHandling ? (
                  <>
                    <button
                      type="button"
                      onClick={handleTakeOverFromAcrio}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Take Over Chat</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSmartAssignSalesP0}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white border border-[#d1d7db] hover:bg-neutral-50 text-xs font-medium text-[#111b21] cursor-pointer"
                      title="Connect to Sales Team P0 member with fewest active chats"
                    >
                      <Users className="w-3.5 h-3.5 text-[#00a884]" />
                      <span>Connect Sales Team</span>
                    </button>
                  </>
                ) : (
                  activeConv.status !== "RESOLVED" && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setAssignTeamId(
                            activeConv.assignedTeamId || "team_sales"
                          );
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
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white border border-[#d1d7db] hover:bg-neutral-50 text-xs text-[#111b21] cursor-pointer"
                      >
                        <UserCheck className="w-3.5 h-3.5 text-[#00a884]" />
                        <span className="font-medium">
                          {activeConv.assignedTeamName || "Sales Team"}
                        </span>
                        <span className="text-[#54656f]">•</span>
                        <span>{activeConv.assignedStaffName || "Assign"}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                            activeConv.escalationLevel === "P2"
                              ? "bg-red-600 text-white"
                              : activeConv.escalationLevel === "P1"
                              ? "bg-amber-500 text-white"
                              : "bg-neutral-100 text-neutral-700"
                          }`}
                        >
                          {activeConv.escalationLevel || "P0"}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={handleReturnToAcrio}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white border border-[#d1d7db] hover:bg-neutral-50 text-xs font-medium text-indigo-800 cursor-pointer"
                        title="Assign chat to System (ACRIO) for automatic handling"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Assign to System</span>
                      </button>
                    </>
                  )
                )}

                {activeConv.status === "RESOLVED" ? (
                  <button
                    type="button"
                    onClick={handleReopen}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#d1d7db] bg-white hover:bg-neutral-50 text-xs font-medium text-[#111b21] cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reopen</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowResolveModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Mark Resolved</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowRightDrawer((p) => !p)}
                  title={
                    showRightDrawer
                      ? "Hide Customer Panel"
                      : "Show Customer Panel"
                  }
                  className="p-1.5 rounded-md bg-white border border-[#d1d7db] hover:bg-neutral-50 text-[#54656f] cursor-pointer"
                >
                  {showRightDrawer ? (
                    <PanelRightClose className="w-4 h-4" />
                  ) : (
                    <PanelRightOpen className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* WhatsApp Chat Wallpaper + Message Stream (NEVER flashes empty!) */}
            <div
              style={CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE}
              className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5"
            >
              {/* Top WhatsApp Security/Context Pill */}
              <div className="flex justify-center pb-1">
                <div className="px-3 py-1 rounded-md bg-[#fff5c4] border border-[#f2df8d] text-[11px] text-[#54656f] shadow-2xs text-center max-w-xl">
                  <strong>ACRIO</strong> runs only when a chat is assigned to{" "}
                  <strong>System</strong> (when a customer starts a chat or an agent
                  assigns to System). On staff-assigned chats, ACRIO is off to save AI
                  credits & bills, and staff replies are <strong>Free (₹0.00)</strong>.
                </div>
              </div>

              {activeConv.status === "RESOLVED" && activeConv.resolutionSummary && (
                <div className="mx-auto max-w-xl p-3 rounded-lg bg-emerald-50/95 border border-emerald-200 text-xs text-emerald-950 shadow-2xs">
                  <div className="font-semibold">
                    Resolved by {activeConv.resolvedByName || "Staff"}
                  </div>
                  <p className="mt-0.5 text-emerald-900">
                    {activeConv.resolutionSummary}
                  </p>
                </div>
              )}

              {messages.map((m) => {
                const isInternalNote =
                  m.direction === "INTERNAL" ||
                  m.messageType === "INTERNAL_NOTE";
                const isOutbound = m.direction === "OUTBOUND";

                if (isInternalNote) {
                  return (
                    <div key={m.id} className="flex justify-center my-2">
                      <div className="w-full max-w-[78%] rounded-lg px-3.5 py-2.5 bg-[#fef3c7] border border-[#f59e0b]/45 shadow-2xs text-[#78350f]">
                        <div className="flex items-center justify-between gap-3 text-[11px] font-semibold mb-1">
                          <span className="inline-flex items-center gap-1">
                            <Lock className="w-3 h-3 text-amber-700" />
                            <span>Internal Team Note • {m.senderName}</span>
                          </span>
                          <span className="font-normal text-amber-800/80">
                            {new Date(m.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="text-[13px] whitespace-pre-wrap leading-relaxed">
                          {m.body}
                        </p>
                      </div>
                    </div>
                  );
                }

                const isAcrioBubble = m.billingCategory === "ACRIO";
                const isTemplateBubble = m.messageType === "TEMPLATE";

                return (
                  <div
                    key={m.id}
                    className={`flex ${
                      isOutbound ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[74%] rounded-lg px-3 py-2 shadow-2xs relative ${
                        isOutbound
                          ? "bg-[#d9fdd3] text-[#111b21] rounded-tr-none"
                          : "bg-white text-[#111b21] rounded-tl-none"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 text-[11px] mb-0.5">
                        <span
                          className={`font-semibold ${
                            isOutbound
                              ? isAcrioBubble
                                ? "text-indigo-800"
                                : "text-[#008069]"
                              : "text-[#e31837]"
                          }`}
                        >
                          {m.senderName}
                        </span>
                        <div className="flex items-center gap-1">
                          {isAcrioBubble && (
                            <span className="px-1.5 py-0.2 rounded bg-white/80 text-indigo-800 text-[10px] font-medium">
                              ACRIO • ₹0.30
                            </span>
                          )}
                          {isTemplateBubble && (
                            <span className="px-1.5 py-0.2 rounded bg-white/80 text-[#54656f] text-[10px] font-medium">
                              Template •{" "}
                              {m.billingCategory === "MARKETING"
                                ? "₹0.95"
                                : "₹0.30"}
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-[13.5px] whitespace-pre-wrap leading-snug">
                        {m.body}
                      </p>

                      <div className="flex items-center justify-end gap-1 mt-1 text-[10.5px] text-[#667781]">
                        <span>
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {isOutbound && (
                          <CheckCheck
                            className={`w-3.5 h-3.5 ${
                              m.deliveryStatus === "READ"
                                ? "text-[#53bdeb]"
                                : "text-[#667781]"
                            }`}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>

            {/* Zero-AI Quick Short Links Bar (/l/...) */}
            {detail && detail.customLinks.length > 0 && (
              <div className="bg-[#f8f9fa] border-t border-[#d1d7db] px-4 py-1.5 shrink-0 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-[#54656f] shrink-0">
                  Quick Short Links:
                </span>
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {detail.customLinks.slice(0, 4).map((lnk) => (
                    <button
                      key={lnk.id}
                      type="button"
                      onClick={() =>
                        appendToComposer(
                          `${WHATSAPP_PUBLIC_ORIGIN}/l/${lnk.code}`
                        )
                      }
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white hover:bg-neutral-100 border border-[#d1d7db] text-[11px] text-[#3b4a54] cursor-pointer whitespace-nowrap"
                    >
                      <Link2 className="w-3 h-3 text-[#00a884]" />
                      <span>/l/{lnk.code}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* WhatsApp Bottom Composer: Free Chat vs Paid Template vs Free Internal Note */}
            <form
              onSubmit={handleComposerSubmit}
              className={`px-4 py-2.5 border-t border-[#d1d7db] space-y-2 shrink-0 ${
                composerMode === "NOTE"
                  ? "bg-[#fef9e7]"
                  : composerMode === "TEMPLATE"
                  ? "bg-[#f4f7fb]"
                  : "bg-[#f0f2f5]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-lg bg-white p-0.5 border border-[#d1d7db]">
                  <button
                    type="button"
                    onClick={() => setComposerMode("REPLY")}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                      composerMode === "REPLY"
                        ? "bg-[#00a884] text-white"
                        : "text-[#54656f] hover:text-[#111b21]"
                    }`}
                  >
                    <WhatsAppLogoIcon size={12} />
                    <span>WhatsApp Reply (Free)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setComposerMode("TEMPLATE");
                      if (!replyText.trim() && activeTemplate) {
                        applyTemplateToDraft(activeTemplate);
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                      composerMode === "TEMPLATE"
                        ? "bg-neutral-900 text-white"
                        : "text-[#54656f] hover:text-[#111b21]"
                    }`}
                  >
                    <FileText className="w-3 h-3" />
                    <span>Send Template</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setComposerMode("NOTE")}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                      composerMode === "NOTE"
                        ? "bg-amber-500 text-white"
                        : "text-[#54656f] hover:text-[#111b21]"
                    }`}
                  >
                    <StickyNote className="w-3 h-3" />
                    <span>Internal Note (Free)</span>
                  </button>
                </div>

                {composerMode === "REPLY" && (
                  <span className="text-[11px] text-[#008069] font-medium">
                    ₹0.00 • Free inside 24h chat window
                  </span>
                )}

                {composerMode === "TEMPLATE" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setSelectedTemplateId(nextId);
                        const found = templates.find((t) => t.id === nextId) || null;
                        applyTemplateToDraft(found);
                      }}
                      className="px-2.5 py-1 rounded-md bg-white border border-[#d1d7db] text-xs text-[#111b21]"
                    >
                      {templates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.name} (
                          {tpl.category === "MARKETING"
                            ? "Marketing • ₹0.95"
                            : "Utility/Auth • ₹0.30"}
                          )
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] font-semibold text-neutral-800">
                      Charge:{" "}
                      {activeTemplate?.category === "MARKETING"
                        ? "₹0.95"
                        : "₹0.30"}
                    </span>
                  </div>
                )}

                {composerMode === "NOTE" && (
                  <span className="text-[11px] text-amber-900 font-medium inline-flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    <span>Visible only to our staff • ₹0.00 Free</span>
                  </span>
                )}
              </div>

              <div className="flex items-end gap-2">
                <textarea
                  rows={2}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleComposerSubmit(e);
                    }
                  }}
                  placeholder={
                    composerMode === "NOTE"
                      ? "Write a private note for Sales or Fabrication teammates (for example, 'Quote ₹14,500 if ordering 4 podiums')..."
                      : composerMode === "TEMPLATE"
                      ? "Review template message before sending to customer..."
                      : "Type a free WhatsApp reply (Enter to send, Shift+Enter for new line)..."
                  }
                  className={`flex-1 rounded-lg px-3.5 py-2 text-sm text-[#111b21] resize-none focus:outline-none border ${
                    composerMode === "NOTE"
                      ? "bg-white border-amber-300 focus:border-amber-500"
                      : "bg-white border-[#d1d7db] focus:border-[#00a884]"
                  }`}
                />
                <button
                  type="submit"
                  disabled={sending || !replyText.trim()}
                  className={`h-10 px-4 rounded-lg text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0 ${
                    composerMode === "NOTE"
                      ? "bg-amber-600 hover:bg-amber-700"
                      : composerMode === "TEMPLATE"
                      ? "bg-neutral-900 hover:bg-neutral-800"
                      : "bg-[#00a884] hover:bg-[#008f6f]"
                  }`}
                >
                  {composerMode === "NOTE" ? (
                    <>
                      <Lock className="w-3.5 h-3.5" />
                      <span>Save Note</span>
                    </>
                  ) : composerMode === "TEMPLATE" ? (
                    <>
                      <WhatsAppLogoIcon size={14} />
                      <span>
                        Send (
                        {activeTemplate?.category === "MARKETING"
                          ? "₹0.95"
                          : "₹0.30"}
                        )
                      </span>
                    </>
                  ) : (
                    <>
                      <WhatsAppLogoIcon size={14} />
                      <span>Send Free</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {/* ===================================================================== */}
      {/* 3. RIGHT DRAWER: CUSTOMER DETAILS, ORDERS, TEAM NOTES, WEB ENQUIRIES  */}
      {/* ===================================================================== */}
      {showRightDrawer && (
        <div className="w-[330px] xl:w-[360px] shrink-0 border-l border-[#d1d7db] bg-white flex flex-col">
          <div className="grid grid-cols-4 border-b border-[#e9edef] text-[11px] font-semibold shrink-0 bg-[#f0f2f5]">
            {(
              [
                { key: "PROFILE", label: "Details" },
                { key: "ORDERS", label: `Orders (${detail?.orders.length || 0})` },
                { key: "NOTES", label: `Notes (${internalNotes.length})` },
                { key: "HISTORY", label: "Web & Past" },
              ] as const
            ).map((tb) => (
              <button
                key={tb.key}
                type="button"
                onClick={() => setRightTab(tb.key)}
                className={`py-3 text-center border-b-2 cursor-pointer transition-colors ${
                  rightTab === tb.key
                    ? "border-[#00a884] text-[#008069] bg-white"
                    : "border-transparent text-[#54656f] hover:text-[#111b21]"
                }`}
              >
                {tb.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {!detail?.customer && !activeConv ? (
              selectedId && syncingThread ? (
                <RightDrawerSkeleton />
              ) : selectedId && detailError ? (
                <ElementErrorState
                  compact
                  title="Customer details unavailable"
                  message={detailError}
                  onRetry={() => fetchAndCacheDetail(selectedId, true)}
                  retrying={syncingThread}
                />
              ) : (
                <p className="text-xs text-[#667781]">
                  Select a chat to view customer details.
                </p>
              )
            ) : rightTab === "PROFILE" ? (
              <form onSubmit={handleSaveCustomerProfile} className="space-y-3.5">
                <div className="p-3 rounded-lg bg-[#f8f9fa] border border-[#e9edef] space-y-1">
                  <div className="text-[11px] text-[#667781]">Customer Group</div>
                  <div className="text-xs font-semibold text-[#111b21]">
                    {detail?.customer?.acrioSegment || "WhatsApp Lead"}
                  </div>
                  <div className="flex items-center justify-between text-xs text-[#54656f] pt-1">
                    <span>Total Spent:</span>
                    <strong className="text-[#111b21]">
                      ₹
                      {(detail?.customer?.lifetimeValueInr || 0).toLocaleString(
                        "en-IN"
                      )}
                    </strong>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Company / Institution
                  </label>
                  <input
                    type="text"
                    value={editCompany}
                    onChange={(e) => setEditCompany(e.target.value)}
                    placeholder="Taj Deccan / St. Ann's College"
                    className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      Business Type
                    </label>
                    <select
                      value={editOrgType}
                      onChange={(e) => setEditOrgType(e.target.value)}
                      className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs bg-white"
                    >
                      <option value="Hotel/Hospitality">Hotel / Banquet</option>
                      <option value="School/College">School / College</option>
                      <option value="Corporate">Corporate Office</option>
                      <option value="Signage Fabricator">
                        Fabricator / CNC Buyer
                      </option>
                      <option value="Retail/Showroom">Retail / Showroom</option>
                      <option value="Event Agency">Event Agency</option>
                      <option value="Business">Other Business</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      City
                    </label>
                    <input
                      type="text"
                      value={editCity}
                      onChange={(e) => setEditCity(e.target.value)}
                      placeholder="Hyderabad"
                      className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Permanent Customer Summary
                  </label>
                  <textarea
                    rows={3}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Preferred thickness, GST details, machine models owned..."
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-xs"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-medium cursor-pointer"
                >
                  Save Customer Details
                </button>
              </form>
            ) : rightTab === "ORDERS" ? (
              <div className="space-y-4">
                <form
                  onSubmit={handleAddOrder}
                  className="p-3 rounded-lg bg-[#f8f9fa] border border-[#e9edef] space-y-2.5"
                >
                  <div className="text-xs font-semibold text-neutral-800 flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add New Order</span>
                  </div>
                  <input
                    type="text"
                    required
                    value={newOrderItems}
                    onChange={(e) => setNewOrderItems(e.target.value)}
                    placeholder="Items or machine model ordered"
                    className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min={1}
                      value={newOrderQty}
                      onChange={(e) => setNewOrderQty(Number(e.target.value))}
                      placeholder="Qty"
                      className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                    <input
                      type="number"
                      min={0}
                      value={newOrderAmount}
                      onChange={(e) => setNewOrderAmount(e.target.value)}
                      placeholder="Total ₹"
                      className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-1.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer"
                  >
                    Save Order
                  </button>
                </form>

                {!detail || detail.orders.length === 0 ? (
                  <p className="text-xs text-neutral-500 text-center py-4">
                    No orders recorded for this customer yet.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {detail.orders.map((o) => (
                      <div
                        key={o.id}
                        className="p-3 rounded-lg border border-neutral-200 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono font-semibold text-neutral-900">
                            {o.orderNumber}
                          </span>
                          <span className="text-xs font-semibold text-emerald-700">
                            ₹{o.totalAmountInr.toLocaleString("en-IN")}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-700">
                          {o.itemsSummary}
                        </p>
                        <div className="flex items-center justify-between text-[11px] text-neutral-500 pt-1">
                          <span>Qty: {o.quantity}</span>
                          <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 font-medium">
                            {o.fulfillmentStatus}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : rightTab === "NOTES" ? (
              <div className="space-y-3.5">
                <form
                  onSubmit={handleQuickNoteSave}
                  className="p-3 rounded-lg bg-[#fef9e7] border border-amber-200 space-y-2"
                >
                  <div className="text-xs font-semibold text-amber-950 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-700" />
                    <span>Add Internal Team Note (Free)</span>
                  </div>
                  <textarea
                    rows={2}
                    value={quickNoteDraft}
                    onChange={(e) => setQuickNoteDraft(e.target.value)}
                    placeholder="Private note for Sales, Fabrication, or Machine Support..."
                    className="w-full rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={!quickNoteDraft.trim()}
                    className="w-full py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium cursor-pointer disabled:opacity-50"
                  >
                    Post Internal Note
                  </button>
                </form>

                {internalNotes.length === 0 ? (
                  <p className="text-xs text-neutral-500 text-center py-4">
                    No internal team notes yet on this chat.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {[...internalNotes].reverse().map((n) => (
                      <div
                        key={n.id}
                        className="p-2.5 rounded-lg bg-[#fef3c7]/70 border border-amber-200 space-y-1"
                      >
                        <div className="flex items-center justify-between text-[11px] font-semibold text-amber-950">
                          <span>{n.senderName}</span>
                          <span className="font-normal text-amber-800">
                            {new Date(n.createdAt).toLocaleDateString([], {
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        </div>
                        <p className="text-xs text-amber-950 whitespace-pre-wrap">
                          {n.body}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-neutral-700 mb-2">
                    Past WhatsApp Interactions
                  </h4>
                  {!detail || detail.relations.length === 0 ? (
                    <p className="text-xs text-neutral-500">
                      No earlier closed interactions.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {detail.relations.map((r) => (
                        <div
                          key={r.id}
                          className="p-2.5 rounded-md bg-neutral-50 border border-neutral-200 space-y-1"
                        >
                          <div className="flex items-center justify-between text-[11px] text-neutral-500">
                            <span className="font-medium text-neutral-800">
                              {r.relationType}
                            </span>
                            <span>
                              {new Date(r.occurredAt).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-xs text-neutral-700">{r.summary}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-neutral-700 mb-2 flex items-center justify-between">
                    <span>Website Enquiries (CC & CE53)</span>
                    <ExternalLink className="w-3 h-3 text-neutral-400" />
                  </h4>
                  {!detail || detail.websiteEnquiries.length === 0 ? (
                    <p className="text-xs text-neutral-500">
                      No matching website form submissions for this phone/email.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {detail.websiteEnquiries.map((eq) => (
                        <div
                          key={eq.id}
                          className="p-2.5 rounded-md bg-blue-50/50 border border-blue-200 space-y-1"
                        >
                          <div className="flex items-center justify-between text-[11px] text-blue-800 font-medium">
                            <span>{eq.source}</span>
                            <span>
                              {new Date(eq.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-xs text-neutral-800">{eq.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: ASSIGN TEAM & ESCALATION TIER (P0 -> P1 -> P2)               */}
      {/* ===================================================================== */}
      {showAssignModal && activeConv && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleManualAssignSubmit}
            className="w-full max-w-md bg-white rounded-lg border border-neutral-200 p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">
                Assign Team & Escalation Priority
              </h3>
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-neutral-600">
              Sales Team is our default handoff team (ACRIO stays off on staff-assigned chats to save AI credits & charges). Choose <strong>System (ACRIO)</strong> under Assignee only if you want ACRIO to answer incoming customer messages automatically.
            </p>

            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Team
              </label>
              <select
                value={assignTeamId}
                disabled={assignStaffId === "ACRIO"}
                onChange={(e) => setAssignTeamId(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-xs bg-white disabled:opacity-50"
              >
                {teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name} (P0 {tm.p0WaitMinutes}m → P1 {tm.p1WaitMinutes}m)
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Escalation Level
                </label>
                <select
                  value={assignTier}
                  disabled={assignStaffId === "ACRIO"}
                  onChange={(e) =>
                    setAssignTier(e.target.value as "P0" | "P1" | "P2")
                  }
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-xs bg-white disabled:opacity-50"
                >
                  <option value="P0">P0 (First Responder)</option>
                  <option value="P1">P1 (Escalation Backup)</option>
                  <option value="P2">P2 (Lead / Urgent)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Assignee
                </label>
                <select
                  value={assignStaffId}
                  onChange={(e) => setAssignStaffId(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-xs bg-white"
                >
                  <option value="">Auto-pick least busy in team</option>
                  <option value="ACRIO">System (ACRIO)</option>
                  {staffList.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Link
                href="/dashboard/teams"
                className="text-xs font-medium text-[#008069] hover:underline"
              >
                Configure teams & wait limits
              </Link>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAssignModal(false)}
                  className="px-3.5 py-1.5 rounded-md border border-neutral-300 text-xs font-medium text-neutral-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer"
                >
                  Save Assignment
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: MARK RESOLVED                                                */}
      {/* ===================================================================== */}
      {showResolveModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-lg border border-neutral-200 p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">
                Mark Chat Resolved
              </h3>
              <button
                type="button"
                onClick={() => setShowResolveModal(false)}
                className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-neutral-600">
              Save a short closing summary so the next team member immediately sees what was agreed.
            </p>
            <textarea
              rows={3}
              value={resolveSummary}
              onChange={(e) => setResolveSummary(e.target.value)}
              className="w-full rounded-md border border-neutral-300 p-2.5 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowResolveModal(false)}
                className="px-3.5 py-2 rounded-md border border-neutral-300 text-xs font-medium text-neutral-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSmartResolve}
                className="px-4 py-2 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer"
              >
                Save & Close Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: START NEW CHAT OR TEST INCOMING MESSAGE (ACRIO AUTO-HANDLED) */}
      {/* ===================================================================== */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSimulateOrNewChat}
            className="w-full max-w-md bg-white rounded-lg border border-neutral-200 p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#25d366] text-white inline-flex items-center justify-center">
                  <WhatsAppLogoIcon size={13} />
                </span>
                <span>Start Chat or Test Incoming Enquiry</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowNewChatModal(false)}
                className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setSimDirection("INBOUND")}
                className={`py-2 rounded-md border font-medium cursor-pointer ${
                  simDirection === "INBOUND"
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "bg-white text-neutral-700 border-neutral-300"
                }`}
              >
                Incoming (ACRIO First)
              </button>
              <button
                type="button"
                onClick={() => setSimDirection("OUTBOUND")}
                className={`py-2 rounded-md border font-medium cursor-pointer ${
                  simDirection === "OUTBOUND"
                    ? "bg-[#00a884] text-white border-[#00a884]"
                    : "bg-white text-neutral-700 border-neutral-300"
                }`}
              >
                Start Outbound Chat
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Customer Name
                </label>
                <input
                  type="text"
                  required
                  value={simName}
                  onChange={(e) => setSimName(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  WhatsApp Number
                </label>
                <input
                  type="text"
                  required
                  value={simPhone}
                  onChange={(e) => setSimPhone(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Message Text
              </label>
              <textarea
                rows={3}
                required
                value={simText}
                onChange={(e) => setSimText(e.target.value)}
                className="w-full rounded-md border border-neutral-300 p-2.5 text-xs"
              />
              {simDirection === "INBOUND" && (
                <p className="text-[11px] text-neutral-500 mt-1">
                  ACRIO will reply automatically using Classic Concepts & Classic Edge 53 catalogs, or hand off to Sales Team if the customer asks for staff.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewChatModal(false)}
                className="px-3.5 py-2 rounded-md border border-neutral-300 text-xs font-medium text-neutral-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer"
              >
                <WhatsAppLogoIcon size={13} />
                <span>Send</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
