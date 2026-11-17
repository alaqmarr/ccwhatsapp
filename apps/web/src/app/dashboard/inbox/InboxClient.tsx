"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  AtSign,
  BarChart3,
  Check,
  CheckSquare,
  Clock,
  Copy,
  CornerUpLeft,
  Download,
  ExternalLink,
  FileAudio,
  FileText,
  Image as ImageIcon,
  Info,
  Link2,
  Lock,
  MoreHorizontal,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  PhoneCall,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Truck,
  UserCheck,
  UserPlus,
  Users,
  Video,
  X,
  Zap,
} from "lucide-react";
import { canAssignToDev } from "@cc/rbac";
import {
  CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE,
  ChatMessagesSkeleton,
  ClassicConceptsMark,
  ElementErrorState,
  RightDrawerSkeleton,
  SHIPPING_PROVIDER_OPTIONS,
  SHORTLINK_PUBLIC_DOMAIN,
  TRACKING_PUBLIC_ORIGIN,
  WhatsAppFormattedText,
  WhatsAppLogoIcon,
  WhatsAppMessageTicks,
  buildClientProviderTrackingUrl,
  formatDateIst,
  formatDateShortIst,
  formatDateTimeShortIst,
  formatShortLinkUrl,
  formatThreadTimeIst,
  formatTimeIst,
  stripWhatsAppFormatting,
} from "@cc/ui";
import { MentionTextarea } from "@/components/MentionTextarea";
import {
  AttachmentPickerPopover,
  MediaPreviewLightbox,
  MessageMediaRenderer,
  StagedAttachmentBar,
  extractMessageMedia,
  type NormalizedMessageMedia,
  type StagedComposerAttachment,
} from "@/components/MediaAttachmentTools";
import {
  NewChatTemplateModal,
  type NewChatModalMode,
} from "@/components/NewChatTemplateModal";
import { QuickRepliesModal } from "@/components/QuickRepliesModal";
import {
  TemplateSendDialog,
  type TemplateSendPayload,
} from "@/components/TemplateSendDialog";
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

/** Toast text after saving a note: says who was pinged and whether ACRIO is answering. */
function describeNoteResult(data: {
  mentioned?: { id: string; name: string }[];
  askedAcrio?: boolean;
}): string {
  const parts = ["Internal note saved."];
  const names = (data?.mentioned || []).map((m) => m.name);
  if (names.length > 0) parts.push(`Pinged ${names.join(", ")}.`);
  if (data?.askedAcrio) parts.push("ACRIO will answer in a private note shortly.");
  return parts.join(" ");
}

/** True when the text mentions @ACRIO or a teammate by name. */
function hasTeamMention(text: string, people: { name: string }[]): boolean {
  const names = ["ACRIO", ...people.map((p) => p.name)];
  return names.some((name) => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[\\s(])@${esc}(?![A-Za-z0-9_])`, "i").test(text);
  });
}

/** Makes @ACRIO and @Teammate names bold inside note text. */
function emphasizeMentions(text: string, people: { name: string }[]): string {
  let out = text;
  const names = ["ACRIO", ...people.map((p) => p.name)].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(^|[\\s(])@${esc}(?![A-Za-z0-9_])`, "gi"), (_m, lead) => `${lead}*@${name}*`);
  }
  return out;
}

interface MessageCtaButton {
  label: string;
  url: string;
  footerText?: string | null;
  orderId?: string | null;
  providerName?: string | null;
  awbNumber?: string | null;
}

function extractCtaButton(m: ChatMessage): MessageCtaButton | null {
  const raw = m.metadata?.ctaButton;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const label = String(obj.label || "").trim();
  const url = String(obj.url || "").trim();
  if (!label || !url) return null;
  return {
    label,
    url,
    footerText: obj.footerText ? String(obj.footerText) : null,
    orderId: obj.orderId ? String(obj.orderId) : null,
    providerName: obj.providerName ? String(obj.providerName) : null,
    awbNumber: obj.awbNumber ? String(obj.awbNumber) : null,
  };
}

function extractQuotedReply(m: ChatMessage): QuotedMessageRef | null {
  const raw = m.metadata?.replyTo;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const body = String(obj.body || "").trim();
  if (!body) return null;
  return {
    messageId: obj.messageId ? String(obj.messageId) : null,
    waMessageId: obj.waMessageId ? String(obj.waMessageId) : null,
    senderName: String(obj.senderName || "Message"),
    senderType: obj.senderType ? String(obj.senderType) : "",
    direction: obj.direction ? String(obj.direction) : "",
    body,
  };
}

function formatShortThreadTime(iso: string, serverNowMs?: number): string {
  return formatThreadTimeIst(iso, serverNowMs);
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

function formatDateTimeShort(iso: string | null | undefined): string {
  return formatDateTimeShortIst(iso);
}

const CANNED_QUICK_REPLIES = [
  {
    cmd: "/welcome",
    title: "Warm Welcome",
    body: "Hello! Thank you for reaching out to Classic Concepts. Please share the product, size, and quantity you need so we can send pricing right away.",
  },
  {
    cmd: "/podiums",
    title: "Acrylic Podiums Info",
    body: "We make clear, frosted, and LED-lit acrylic podiums in standard and custom heights, with logo engraving and safe wooden crate shipping across India. How many podiums do you need?",
  },
  {
    cmd: "/awards",
    title: "Awards & Mementos",
    body: "We make custom acrylic awards, plaques, and corporate mementos with UV printing or laser engraving. Share your event date, quantity, and logo to get design options.",
  },
  {
    cmd: "/machines",
    title: "Classic Edge 53 Machines",
    body: "We supply Classic Edge 53 diamond polishing machines, flame polishers, acrylic benders, and genuine diamond tools across India. Which sheet thickness and daily volume are you working with?",
  },
  {
    cmd: "/custom",
    title: "Custom Size Quote",
    body: "Sure, we make custom sizes and thicknesses in our Hyderabad workshop. Please share the length x width x height, thickness (mm), and quantity needed.",
  },
  {
    cmd: "/track",
    title: "Order Tracking Portal",
    body: `You can check live dispatch and courier tracking anytime at ${TRACKING_PUBLIC_ORIGIN}. You can also reply here with your order number and I will pull the latest update.`,
  },
  {
    cmd: "/gst",
    title: "GST Billing & Dispatch",
    body: "Yes, we provide a full GST tax invoice on all orders. Kindly share your company GSTIN, billing address, and delivery pincode to prepare the proforma invoice.",
  },
] as const;

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
  const [mobilePane, setMobilePane] = useState<"LIST" | "CHAT" | "INFO">("LIST");
  const [bulkMode, setBulkMode] = useState<boolean>(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState<boolean>(false);

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
  const [customQuickReplies, setCustomQuickReplies] = useState<QuickReplyItem[]>(
    initialData.quickReplies || []
  );
  const [showQuickRepliesModal, setShowQuickRepliesModal] = useState<boolean>(false);

  const isAdminOrSuperadmin =
    initialData.currentUserRole === "DEV" ||
    initialData.currentUserRole === "SUPERADMIN" ||
    initialData.currentUserRole === "ADMIN";

  const [quickFilter, setQuickFilter] = useState<
    "MINE" | "ACTIVE" | "WAITING" | "ACRIO" | "UNREAD" | "ALL" | "RESOLVED"
  >("MINE");
  const [teamFilter, setTeamFilter] = useState<string>("ALL");
  const [staffFilter, setStaffFilter] = useState<string>("ALL");
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
  const [replyingTo, setReplyingTo] = useState<QuotedMessageRef | null>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    initialData.templates[0]?.id || ""
  );
  const [sending, setSending] = useState<boolean>(false);
  const [showShortLinksPicker, setShowShortLinksPicker] =
    useState<boolean>(false);
  const [shortLinkQuery, setShortLinkQuery] = useState<string>("");
  const [shortLinkBrandFilter, setShortLinkBrandFilter] = useState<
    "ALL" | "CC" | "CE53"
  >("ALL");

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
  const [sendingTrackBtn, setSendingTrackBtn] = useState<boolean>(false);

  const [showRightDrawer, setShowRightDrawer] = useState<boolean>(true);
  const [toast, setToast] = useState<string>("");

  // Right CRM panel tab
  const [rightTab, setRightTab] = useState<
    "PROFILE" | "ORDERS" | "NOTES" | "MEDIA" | "HISTORY"
  >("PROFILE");

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
  const [summarizingChat, setSummarizingChat] = useState<boolean>(false);
  const [takingOver, setTakingOver] = useState<boolean>(false);
  const [collabToAdd, setCollabToAdd] = useState<string>("");

  // Add order inline state
  const [newOrderItems, setNewOrderItems] = useState<string>("");
  const [newOrderQty, setNewOrderQty] = useState<number>(1);
  const [newOrderAmount, setNewOrderAmount] = useState<string>("");

  // Editable customer profile fields
  const [editName, setEditName] = useState<string>(
    initialData.initialDetail?.customer?.name || ""
  );
  const [editEmail, setEditEmail] = useState<string>(
    initialData.initialDetail?.customer?.email || ""
  );
  const [editGstNumber, setEditGstNumber] = useState<string>(
    initialData.initialDetail?.customer?.gstNumber || ""
  );
  const [editCompany, setEditCompany] = useState<string>(
    initialData.initialDetail?.customer?.companyName || ""
  );
  const [editOrgType, setEditOrgType] = useState<string>(
    initialData.initialDetail?.customer?.organizationType || "Business"
  );
  const [editCity, setEditCity] = useState<string>(
    initialData.initialDetail?.customer?.city || ""
  );
  const [editSegment, setEditSegment] = useState<string>(
    initialData.initialDetail?.customer?.acrioSegment || "New WhatsApp Lead"
  );
  const [editPreferredStaffId, setEditPreferredStaffId] = useState<string>(
    initialData.initialDetail?.customer?.preferredStaffId || ""
  );
  const [editTags, setEditTags] = useState<string[]>(
    initialData.initialDetail?.customer?.tags || []
  );
  const [newTagInput, setNewTagInput] = useState<string>("");
  const [editNotes, setEditNotes] = useState<string>(
    initialData.initialDetail?.customer?.notes || ""
  );
  const [quickNoteDraft, setQuickNoteDraft] = useState<string>("");
  const [showHeaderMenu, setShowHeaderMenu] = useState<boolean>(false);
  // Pending "Request a callback" for the open chat + across the thread list
  const [pendingCallback, setPendingCallback] = useState<{
    id: string;
    slot: string;
    topic: string;
    phone: string;
    createdAt: string;
  } | null>(null);
  const [callbackConvIds, setCallbackConvIds] = useState<string[]>([]);
  const [unreadMentionConvIds, setUnreadMentionConvIds] = useState<string[]>([]);

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
          const reqs = (cbData.requests || []) as Record<string, unknown>[];
          setCallbackConvIds(reqs.map((r) => String(r.conversation_id)));
          const row = selectedId
            ? reqs.find((r) => String(r.conversation_id) === selectedId)
            : undefined;
          setPendingCallback(
            row
              ? {
                  id: String(row.id),
                  slot: String(row.preferred_slot || ""),
                  topic: String(row.topic || ""),
                  phone: String(row.customer_phone || ""),
                  createdAt: String(row.created_at || ""),
                }
              : null
          );
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
    const es = new EventSource("/api/realtime/stream");
    es.addEventListener("callback:new", loadSignals);
    es.addEventListener("staff:mention", loadSignals);
    return () => {
      cancelled = true;
      clearInterval(timer);
      es.close();
    };
  }, [selectedId]);

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
        setShowRightDrawer((p) => !p);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function markPendingCallbackDone() {
    if (!pendingCallback) return;
    await fetch("/api/callback-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: pendingCallback.id, status: "DONE" }),
    });
    setPendingCallback(null);
    setCallbackConvIds((prev) => prev.filter((cid) => cid !== selectedId));
    showToast("Marked as called.");
  }

  // ------------------------------------------------------------------------
  // Drafts are kept per chat AND per tab (reply / note). Whatever you typed is only ever shown in the
  // chat and tab where you typed it, so a half-written message can never end up in the wrong place.
  // ------------------------------------------------------------------------
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [acrioActionBusyId, setAcrioActionBusyId] = useState<string | null>(null);
  const [stagedAttachment, setStagedAttachment] =
    useState<StagedComposerAttachment | null>(null);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [previewMedia, setPreviewMedia] =
    useState<NormalizedMessageMedia | null>(null);
  const draftsRef = useRef<Record<string, string>>({});
  const activeDraftKeyRef = useRef<string>("");
  const skipDraftSaveRef = useRef(false);
  const lastDraftChatRef = useRef<string | null>(null);

  useEffect(() => {
    const key = `${selectedId || ""}|${composerMode}`;
    if (activeDraftKeyRef.current === key) return;
    if (skipDraftSaveRef.current) {
      skipDraftSaveRef.current = false;
    } else if (activeDraftKeyRef.current) {
      draftsRef.current[activeDraftKeyRef.current] = replyText;
    }
    activeDraftKeyRef.current = key;
    setReplyText(draftsRef.current[key] ?? "");

    // Moving to another chat: drop anything attached to the old one.
    if (lastDraftChatRef.current !== (selectedId || null)) {
      lastDraftChatRef.current = selectedId || null;
      setReplyingTo(null);
      setQuickNoteDraft("");
      setTemplateDialogOpen(false);
      setStagedAttachment(null);
      setShowAttachmentPicker(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, composerMode]);

  /** Moves what the person typed into this chat's Note draft (used when they @mention in the reply box). */
  function moveDraftToNote(text: string) {
    if (!selectedId) return;
    draftsRef.current[`${selectedId}|NOTE`] = text;
    draftsRef.current[`${selectedId}|REPLY`] = "";
    skipDraftSaveRef.current = true;
    setComposerMode("NOTE");
  }

  async function sendTemplateMessage(
    p: TemplateSendPayload
  ): Promise<{ ok: boolean; error?: string }> {
    if (!selectedId) return { ok: false, error: "No chat is open." };
    const chatId = selectedId;
    const components: Record<string, unknown>[] = [];
    if (p.headerValues.length > 0) {
      components.push({
        type: "header",
        parameters: p.headerValues.map((v) => ({ type: "text", text: v })),
      });
    }
    if (p.bodyValues.length > 0) {
      components.push({
        type: "body",
        parameters: p.bodyValues.map((v) => ({ type: "text", text: v })),
      });
    }
    try {
      const res = await fetch(`/api/conversations/${chatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_message",
          text: p.renderedText,
          messageType: "TEMPLATE",
          templateName: p.template.name,
          billingCategory: p.template.category,
          languageCode: p.template.language,
          ...(components.length > 0 ? { templateComponents: components } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error || "The template could not be sent." };
      }
      showToast("Template sent.");
      setComposerMode("REPLY");
      await Promise.all([fetchAndCacheDetail(chatId, false), refreshThreadsSilently()]);
      return { ok: true };
    } catch {
      return { ok: false, error: "Network error. The template was not sent." };
    }
  }

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    setReplyingTo(null);
    setHighlightedMsgId(null);
  }, [selectedId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const chatParam = new URLSearchParams(window.location.search).get("chat");
    if (chatParam) {
      setMobilePane("CHAT");
      if (chatParam !== selectedIdRef.current) {
        setSelectedId(chatParam);
        selectedIdRef.current = chatParam;
        void fetchAndCacheDetail(chatParam, true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setEditName(bundle.customer?.name || bundle.conversation.customerName || "");
    setEditEmail(bundle.customer?.email || "");
    setEditGstNumber(bundle.customer?.gstNumber || "");
    setEditCompany(bundle.customer?.companyName || "");
    setEditOrgType(bundle.customer?.organizationType || "Business");
    setEditCity(bundle.customer?.city || "");
    setEditSegment(bundle.customer?.acrioSegment || "New WhatsApp Lead");
    setEditPreferredStaffId(bundle.customer?.preferredStaffId || "");
    setEditTags(bundle.customer?.tags || []);
    setNewTagInput("");
    setEditNotes(bundle.customer?.notes || "");
    setShowNoteForNonOwner(false);
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

  const detailFetchSeqRef = useRef<number>(0);

  // Silent detail fetch: renders cached copy at 0ms if switching, or element skeletons + retry if uncached!
  const fetchAndCacheDetail = useCallback(
    async (convId: string, updateProfileInputs = false) => {
      const fetchSeq = ++detailFetchSeqRef.current;
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
            assignments: data.assignments || [],
            customer: data.customer || null,
            orders: data.orders || [],
            orderTrackings: data.orderTrackings || [],
            relations: data.relations || [],
            websiteEnquiries: data.websiteEnquiries || [],
            acrio: data.acrio || null,
            customLinks: data.customLinks || [],
          };
          detailCacheRef.current.set(convId, nextBundle);
          if (Array.isArray(data.teams) && data.teams.length > 0) {
            setTeams((prev) => (prev.length > 0 ? prev : data.teams));
          }
          if (
            selectedIdRef.current === convId &&
            fetchSeq >= detailFetchSeqRef.current
          ) {
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
    setMobilePane("CHAT");
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
    const handleStatusEvent = (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(String(ev.data || "{}"));
        const targetConvId = payload.conversationId
          ? String(payload.conversationId)
          : null;
        const nextStatus = payload.status ? String(payload.status) : null;
        const targetMsgId = payload.messageId ? String(payload.messageId) : null;
        const markAllRead = Boolean(payload.markAllOutboundRead);

        if (targetConvId && nextStatus) {
          const cached = detailCacheRef.current.get(targetConvId);
          if (cached) {
            const patchedMessages = cached.messages.map((m) => {
              if (m.direction !== "OUTBOUND") return m;
              if (
                markAllRead &&
                (m.deliveryStatus === "SENDING" ||
                  m.deliveryStatus === "SENT" ||
                  m.deliveryStatus === "DELIVERED")
              ) {
                return { ...m, deliveryStatus: "READ" };
              }
              if (targetMsgId && m.id === targetMsgId) {
                return { ...m, deliveryStatus: nextStatus };
              }
              return m;
            });
            const nextCached: ConversationDetailBundle = {
              ...cached,
              messages: patchedMessages,
            };
            detailCacheRef.current.set(targetConvId, nextCached);
            if (selectedIdRef.current === targetConvId) {
              setDetail(nextCached);
            }
          }

          setThreads((prev) =>
            prev.map((t) =>
              t.id === targetConvId && t.lastMessageDirection === "OUTBOUND"
                ? { ...t, lastMessageStatus: nextStatus }
                : t
            )
          );
        }
      } catch {
        // Ignore malformed SSE event payload
      }
      refresh();
    };

    es.addEventListener("message:new", refresh);
    es.addEventListener("note:new", refresh);
    es.addEventListener("message:status", handleStatusEvent as EventListener);
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
  const assignments = detail?.assignments || [];
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

  const windowStatus = formatWindowCountdown(
    activeConv?.windowExpiresAt || null,
    nowMs
  );
  const activeWait =
    activeConv && activeConv.status !== "RESOLVED" && !isAcrioHandling
      ? formatWaitingDuration(activeConv.waitingSince, nowMs)
      : null;

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
    const el = document.getElementById(`chat-msg-${targetId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMsgId(targetId);
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedMsgId((prev) => (prev === targetId ? null : prev));
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

  async function handleSendOrderTracking(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !detail) return;
    const cleanOrderId = trackOrderId.trim();
    if (!cleanOrderId) {
      showToast("Please enter an Order ID first.");
      return;
    }

    const matchedOrder = detail.orders.find(
      (o) => o.orderNumber.toUpperCase() === cleanOrderId.toUpperCase()
    );
    const computedProviderUrl =
      trackProviderUrl.trim() ||
      buildClientProviderTrackingUrl(
        trackProviderKey,
        trackAwbNumber.trim() || cleanOrderId
      );

    setSendingTrackBtn(true);
    try {
      const res = await fetch(`/api/conversations/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_order_tracking",
          orderId: cleanOrderId,
          brand: trackBrand,
          providerCode: trackProviderKey,
          awbNumber: trackAwbNumber.trim(),
          providerTrackingUrl: computedProviderUrl,
          shipmentStatus: computedProviderUrl ? "DISPATCHED" : "IN_PRODUCTION",
          itemsSummary: matchedOrder?.itemsSummary || undefined,
          buttonLabel: trackButtonLabel.trim() || "Track Order",
          text: trackMessageText.trim() || undefined,
          replyToMessageId: replyingTo?.messageId || undefined,
          replyTo: replyingTo || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showToast(data.error || "Could not send tracking button.");
        return;
      }
      setShowTrackPopover(false);
      setReplyingTo(null);
      showToast(
        `Sent Track Order button (${data.tracking?.publicTrackingUrl || `${TRACKING_PUBLIC_ORIGIN}/${cleanOrderId}`}).`
      );
      await fetchAndCacheDetail(selectedId, false);
      void refreshThreadsSilently(false);
    } catch {
      showToast("Network error while sending tracking button.");
    } finally {
      setSendingTrackBtn(false);
    }
  }

  async function handleComposerSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasStagedAtt =
      (composerMode === "REPLY" || composerMode === "NOTE") &&
      Boolean(stagedAttachment);
    if (!selectedId || (!replyText.trim() && !hasStagedAtt) || !detail) return;

    // Templates are never typed freehand; they go through the picker so values are checked first.
    if (composerMode === "TEMPLATE") {
      setTemplateDialogOpen(true);
      return;
    }

    // An @teammate or @ACRIO in a customer reply is almost certainly meant for the team. Never send it to the customer.
    if (composerMode !== "NOTE" && hasTeamMention(replyText, staffList)) {
      const asNote = window.confirm(
        "This message has an @mention, so it looks meant for your team. Sent as a reply, the CUSTOMER would see it on WhatsApp.\n\nPress OK to switch to a private note (then press Save Note).\nPress Cancel to go back and edit it."
      );
      if (asNote) {
        moveDraftToNote(replyText);
        showToast("Switched to Note mode. Press Save Note to post it privately.");
      }
      return;
    }

    const activeAtt =
      composerMode === "REPLY" || composerMode === "NOTE"
        ? stagedAttachment
        : null;
    const rawCaptionText = replyText.trim();
    const textToSend =
      rawCaptionText ||
      (activeAtt
        ? activeAtt.productName
          ? `*${activeAtt.productName}*${activeAtt.variantName ? ` (${activeAtt.variantName})` : ""}`
          : `[${activeAtt.mediaType}] ${activeAtt.fileName}`
        : "");
    const currentConvId = selectedId;
    const activeReplyRef = replyingTo;
    setSending(true);
    setReplyText("");
    setReplyingTo(null);
    setStagedAttachment(null);
    setShowAttachmentPicker(false);

    // Optimistic UI append at 0ms: starts as SENDING (clock + "Sending") -> SENT (1 tick) -> DELIVERED (2 grey ticks) -> READ (2 blue ticks)
    const tempId = `optimistic_${Date.now()}`;
    const nowIso = new Date().toISOString();
    const optimisticMetadata: Record<string, unknown> | null =
      activeReplyRef || activeAtt
        ? {
            ...(activeReplyRef ? { replyTo: activeReplyRef } : {}),
            ...(activeAtt
              ? {
                  mediaType: activeAtt.mediaType,
                  mediaUrl: activeAtt.url,
                  ...(activeAtt.mediaType === "IMAGE"
                    ? { imageUrl: activeAtt.url }
                    : {}),
                  fileName: activeAtt.fileName,
                  filename: activeAtt.fileName,
                  mimeType: activeAtt.mimeType,
                  sizeBytes: activeAtt.sizeBytes,
                  productName: activeAtt.productName,
                  variantName: activeAtt.variantName,
                }
              : {}),
          }
        : null;
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
            metadata: optimisticMetadata,
          }
        : {
            id: tempId,
            direction: "OUTBOUND",
            senderType: "STAFF",
            senderName: initialData.currentUserName,
            messageType: activeAtt ? activeAtt.mediaType : "TEXT",
            billingCategory: "FREE_CHAT",
            body: textToSend,
            templateName: null,
            deliveryStatus: "SENDING",
            createdAt: nowIso,
            metadata: optimisticMetadata,
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

    if (composerMode !== "NOTE") {
      setThreads((prev) =>
        prev.map((t) =>
          t.id === currentConvId
            ? {
                ...t,
                lastMessagePreview: textToSend.slice(0, 140),
                lastMessageAt: nowIso,
                lastMessageDirection: "OUTBOUND",
                lastMessageStatus: "SENDING",
                waitingSince: null,
              }
            : t
        )
      );
    }

    const patchOptimisticReceipt = (
      nextId: string,
      nextDeliveryStatus: string,
      nextWaMessageId?: string | null
    ) => {
      const cur = detailCacheRef.current.get(currentConvId);
      if (cur) {
        const nextCur: ConversationDetailBundle = {
          ...cur,
          messages: cur.messages.map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  id: nextId,
                  deliveryStatus: nextDeliveryStatus,
                  ...(nextWaMessageId ? { waMessageId: nextWaMessageId } : {}),
                }
              : m
          ),
        };
        detailCacheRef.current.set(currentConvId, nextCur);
        if (selectedIdRef.current === currentConvId) {
          setDetail(nextCur);
        }
      }
      setThreads((prev) =>
        prev.map((t) =>
          t.id === currentConvId
            ? {
                ...t,
                lastMessageDirection: "OUTBOUND",
                lastMessageStatus: nextDeliveryStatus,
              }
            : t
        )
      );
    };

    try {
      if (composerMode === "NOTE") {
        const noteRes = await fetch(`/api/conversations/${currentConvId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add_internal_note",
            noteText: textToSend,
            attachment: activeAtt || undefined,
            replyToMessageId: activeReplyRef?.messageId || undefined,
            replyTo: activeReplyRef || undefined,
          }),
        });
        const noteData = await noteRes.json().catch(() => ({}));
        showToast(describeNoteResult(noteData));
      } else {
        const res = await fetch(`/api/conversations/${currentConvId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "send_message",
            text: rawCaptionText,
            messageType: activeAtt ? activeAtt.mediaType : "TEXT",
            attachment: activeAtt || undefined,
            replyToMessageId: activeReplyRef?.messageId || undefined,
            replyTo: activeReplyRef || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          patchOptimisticReceipt(data.messageId || tempId, "FAILED");
          showToast(data.error || "Message failed to send.");
          return;
        }
        patchOptimisticReceipt(
          String(data.messageId || tempId),
          String(data.deliveryStatus || "SENT"),
          data.waMessageId ? String(data.waMessageId) : null
        );
      }
      await Promise.all([
        fetchAndCacheDetail(currentConvId, false),
        refreshThreadsSilently(),
      ]);
    } catch {
      if (composerMode !== "NOTE") {
        patchOptimisticReceipt(tempId, "FAILED");
        showToast("Network error. Message marked Failed.");
      }
    } finally {
      setSending(false);
    }
  }

  async function handleSimulateCustomerRead() {
    if (!selectedId) return;
    await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "simulate_customer_read" }),
    });
    showToast("Marked outbound messages as Read by customer.");
    await Promise.all([
      fetchAndCacheDetail(selectedId, false),
      refreshThreadsSilently(),
    ]);
  }

  async function handleQuickNoteSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !quickNoteDraft.trim()) return;
    const text = quickNoteDraft.trim();
    setQuickNoteDraft("");
    const noteRes = await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_internal_note",
        noteText: text,
      }),
    });
    const noteData = await noteRes.json().catch(() => ({}));
    showToast(describeNoteResult(noteData));
    await fetchAndCacheDetail(selectedId, false);
  }

  async function handleTakeOverFromAcrio() {
    await handleTakeOverChat();
  }

  async function handleConfirmAcrioAction(
    noteMessageId: string,
    decision: "CONFIRM" | "CANCEL"
  ) {
    if (!selectedId || acrioActionBusyId) return;
    setAcrioActionBusyId(noteMessageId);
    try {
      const res = await fetch(`/api/conversations/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm_acrio_note_action",
          noteMessageId,
          decision,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showToast(data.error || "Could not complete ACRIO action.");
        return;
      }
      showToast(
        decision === "CANCEL"
          ? "ACRIO action cancelled."
          : "Confirmed and shared with customer on WhatsApp."
      );
      await Promise.all([
        fetchAndCacheDetail(selectedId, false),
        refreshThreadsSilently(false),
      ]);
    } catch {
      showToast("Network error while confirming ACRIO action.");
    } finally {
      setAcrioActionBusyId(null);
    }
  }

  async function handleUploadCompanyDocForNote(
    noteMessageId: string,
    missingDoc: { slug?: string; title?: string; keywords?: string },
    file: File
  ) {
    if (!selectedId || acrioActionBusyId) return;
    setAcrioActionBusyId(noteMessageId);
    try {
      const form = new FormData();
      form.append("file", file);
      const upRes = await fetch("/api/media/upload", {
        method: "POST",
        body: form,
      });
      const upData = await upRes.json().catch(() => ({}));
      if (!upRes.ok || !upData.ok || !upData.attachment) {
        showToast(upData.error || "File upload failed.");
        return;
      }
      const att = upData.attachment as {
        mediaId?: string;
        waMediaId?: string;
        mediaType?: string;
        url: string;
        fileName?: string;
        mimeType?: string;
      };
      const attachRes = await fetch(`/api/conversations/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "attach_company_doc_to_acrio_note",
          noteMessageId,
          slug: missingDoc.slug || "company-document",
          title: missingDoc.title || "Company Document",
          keywords: missingDoc.keywords || "",
          mediaId: att.mediaId,
          waMediaId: att.waMediaId,
          mediaUrl: att.url,
          mediaType: att.mediaType || "DOCUMENT",
          fileName: att.fileName || file.name,
          mimeType: att.mimeType || file.type,
        }),
      });
      const attachData = await attachRes.json().catch(() => ({}));
      if (!attachRes.ok || !attachData.ok) {
        showToast(attachData.error || "Could not save document for sharing.");
        return;
      }
      showToast(
        `${missingDoc.title || "Document"} saved! Click Confirm & Share with Client to send.`
      );
      await fetchAndCacheDetail(selectedId, false);
    } catch {
      showToast("Network error while uploading document.");
    } finally {
      setAcrioActionBusyId(null);
    }
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
      const res = await fetch(`/api/conversations/${selectedId}`, {
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
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) {
        showToast(out.error || "Could not assign chat.");
        return;
      }
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
    const prefStaff = staffList.find((s) => s.id === editPreferredStaffId);
    const res = await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_customer_profile",
        name: editName.trim(),
        email: editEmail.trim(),
        gstNumber: editGstNumber.trim(),
        companyName: editCompany,
        organizationType: editOrgType,
        city: editCity,
        acrioSegment: editSegment,
        preferredStaffId: editPreferredStaffId || "",
        preferredStaffName: prefStaff?.name || "",
        tags: editTags,
        notes: editNotes,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) {
      showToast(out.error || "Could not save customer details.");
      return;
    }
    showToast("Customer details saved.");
    await Promise.all([
      fetchAndCacheDetail(selectedId, false),
      refreshThreadsSilently(false),
    ]);
  }

  async function handleTakeOverChat() {
    const targetId = selectedId;
    if (!targetId || takingOver) return;
    setTakingOver(true);
    try {
      const res = await fetch(`/api/conversations/${targetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "take_over_chat" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showToast(data.error || "Could not take over this chat.");
        return;
      }

      const takeoverSeq = ++detailFetchSeqRef.current;
      const cached = detailCacheRef.current.get(targetId);
      const baseBundle =
        detail?.conversation.id === targetId ? detail : cached || null;
      const nextStaffId = String(
        data.conversation?.assignedStaffId || initialData.currentUserId
      );
      const nextStaffName = String(
        data.conversation?.assignedStaffName || initialData.currentUserName
      );
      const fallbackTeamName =
        baseBundle?.conversation.assignedTeamName &&
        !baseBundle.conversation.assignedTeamName.startsWith("System (ACRIO)") &&
        baseBundle.conversation.assignedTeamName !== "ACRIO Assistant" &&
        baseBundle.conversation.assignedTeamName !== "Internal Team Desk"
          ? baseBundle.conversation.assignedTeamName
          : "Sales Team";
      const nextTeamId =
        data.conversation?.assignedTeamId ??
        (baseBundle?.conversation.assignedTeamId || "team_sales");
      const nextTeamName =
        data.conversation?.assignedTeamName ?? fallbackTeamName;

      if (baseBundle) {
        const nextBundle: ConversationDetailBundle = {
          ...baseBundle,
          conversation: {
            ...baseBundle.conversation,
            ...(data.conversation && typeof data.conversation === "object"
              ? data.conversation
              : {}),
            assignedStaffId: nextStaffId,
            assignedStaffName: nextStaffName,
            assignedTeamId: nextTeamId,
            assignedTeamName: nextTeamName,
          },
        };
        detailCacheRef.current.set(targetId, nextBundle);
        if (
          selectedIdRef.current === targetId &&
          takeoverSeq >= detailFetchSeqRef.current
        ) {
          setDetail(nextBundle);
        }
      }

      setThreads((prev) =>
        prev.map((t) =>
          t.id === targetId
            ? {
                ...t,
                assignedStaffId: nextStaffId,
                assignedStaffName: nextStaffName,
                assignedTeamId: nextTeamId,
                assignedTeamName: nextTeamName,
              }
            : t
        )
      );

      showToast("You took over this chat and can now reply directly.");
      setShowNoteForNonOwner(false);
      await Promise.all([
        fetchAndCacheDetail(targetId, false),
        refreshThreadsSilently(false),
      ]);
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : "Network error while taking over chat."
      );
    } finally {
      setTakingOver(false);
    }
  }

  async function handleGenerateSummary() {
    if (!selectedId || summarizingChat) return;
    setSummarizingChat(true);
    try {
      const res = await fetch(`/api/conversations/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_summary" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showToast(data.error || "Could not generate chat summary.");
        return;
      }
      showToast("ACRIO generated a private summary note.");
      await fetchAndCacheDetail(selectedId, false);
    } finally {
      setSummarizingChat(false);
    }
  }

  async function handleAddCollaborator(staffId: string) {
    if (!selectedId || !staffId) return;
    const chosen = staffList.find((s) => s.id === staffId);
    const res = await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_collaborator",
        staffId,
        staffName: chosen?.name || "",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showToast(data.error || "Could not add teammate access.");
      return;
    }
    setCollabToAdd("");
    showToast(`Added ${chosen?.name || "teammate"} to this chat.`);
    await Promise.all([
      fetchAndCacheDetail(selectedId, false),
      refreshThreadsSilently(false),
    ]);
  }

  async function handleRemoveCollaborator(staffId: string) {
    if (!selectedId || !staffId) return;
    const res = await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "remove_collaborator",
        staffId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      showToast("Removed teammate access.");
      await Promise.all([
        fetchAndCacheDetail(selectedId, false),
        refreshThreadsSilently(false),
      ]);
    }
  }

  const handleOpenNewChatWithPhone = useCallback(
    (phone: string) => {
      setSimPhone(phone);
      setSimName("");
      setNewChatInitialMode("TEMPLATE");
      setShowNewChatModal(true);
    },
    []
  );

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

  function toggleBulkSelectThread(convId: string, ev?: React.MouseEvent) {
    if (ev) ev.stopPropagation();
    setSelectedThreadIds((prev) =>
      prev.includes(convId)
        ? prev.filter((id) => id !== convId)
        : [...prev, convId]
    );
  }

  async function handleBulkResolveSelected() {
    if (selectedThreadIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_resolve",
          conversationIds: selectedThreadIds,
          resolutionSummary: "Resolved via bulk inbox action.",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        showToast(`Resolved ${selectedThreadIds.length} chat(s).`);
        setSelectedThreadIds([]);
        setBulkMode(false);
        await refreshThreadsSilently(false);
        if (selectedId) await fetchAndCacheDetail(selectedId, false);
      } else {
        showToast(data.error || "Could not bulk resolve chats.");
      }
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkAssignToMe() {
    if (selectedThreadIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_assign",
          conversationIds: selectedThreadIds,
          staffId: initialData.currentUserId,
          staffName: initialData.currentUserName,
          teamId: "team_sales",
          teamName: "Sales Team",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        showToast(`Assigned ${selectedThreadIds.length} chat(s) to you.`);
        setSelectedThreadIds([]);
        setBulkMode(false);
        await refreshThreadsSilently(false);
        if (selectedId) await fetchAndCacheDetail(selectedId, false);
      } else {
        showToast(data.error || "Could not bulk assign chats.");
      }
    } finally {
      setBulkBusy(false);
    }
  }

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
        <div className="fixed bottom-5 right-5 z-50 px-3.5 py-2 rounded-lg bg-neutral-900 text-white text-xs font-medium shadow-lg">
          {toast}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 1. LEFT WHATSAPP SIDEBAR: CHATS, ACRIO VS STAFF FILTERS, WAIT BADGES */}
      {/* ===================================================================== */}
      <div
        className={`${
          mobilePane === "LIST" ? "flex w-full" : "hidden"
        } lg:flex lg:w-[340px] xl:w-[375px] shrink-0 border-r border-[#d1d7db] flex-col bg-white relative`}
      >
        {/* WhatsApp Web Style Top Bar */}
        <div className="h-[58px] px-3.5 bg-[#f0f2f5] border-b border-[#d1d7db] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <ClassicConceptsMark size={28} />
            <div className="min-w-0">
              <h1 className="font-display text-[17px] font-bold tracking-tight text-[#111b21] truncate flex items-center gap-1.5">
                <span>Customer Chats</span>
                {waitingThreadsCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-red-600 text-white font-sans text-[10px] font-bold uppercase tracking-[0.04em] tabular-nums">
                    {waitingThreadsCount} waiting
                  </span>
                )}
              </h1>
              <p className="text-[11.5px] font-medium text-[#667781] truncate">
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
              href="/dashboard/analytics"
              title="Assignment & First-Response Analytics"
              className="p-2 rounded-full hover:bg-[#e9edef] text-[#54656f]"
            >
              <BarChart3 className="w-4 h-4" />
            </Link>
            <Link
              href="/dashboard/teams"
              title="Teams & Escalation Flow"
              className="p-2 rounded-full hover:bg-[#e9edef] text-[#54656f]"
            >
              <Users className="w-4 h-4" />
            </Link>
            <button
              type="button"
              onClick={() => {
                setSimPhone("");
                setSimName("");
                setNewChatInitialMode("TEMPLATE");
                setShowNewChatModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer"
            >
              <WhatsAppLogoIcon size={13} />
              <span>+ New Chat</span>
            </button>
          </div>
        </div>

        {/* Search + Filter Pills */}
        <div className="px-3 py-2 bg-white border-b border-[#e9edef] space-y-2 shrink-0">
          <div className="flex items-center gap-1.5">
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

            {isAdminOrSuperadmin && (
              <select
                value={staffFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setStaffFilter(val);
                  if (val !== "ALL" && quickFilter === "MINE") {
                    setQuickFilter("ACTIVE");
                  }
                }}
                title="Filter active chats by assigned staff or collaborator"
                className="px-2 py-1.5 rounded-lg bg-[#e7fce3] text-[11px] font-semibold text-[#008069] border border-[#b7ebaf] max-w-[115px] truncate focus:outline-none"
              >
                <option value="ALL">All Staff</option>
                <option value="ACRIO">ACRIO</option>
                {staffList.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            )}

            {teams.length > 0 && (
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                title="Filter by Team"
                className="px-2 py-1.5 rounded-lg bg-[#f0f2f5] text-[11px] font-medium text-[#3b4a54] border-0 max-w-[100px] truncate focus:outline-none"
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
                { key: "MINE", label: "Mine" },
                { key: "ACTIVE", label: "Active" },
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
                { key: "ALL", label: "All" },
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
            <button
              type="button"
              onClick={() => {
                setBulkMode((prev) => !prev);
                setSelectedThreadIds([]);
              }}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap cursor-pointer inline-flex items-center gap-1 transition-colors ${
                bulkMode
                  ? "bg-neutral-900 text-white"
                  : "bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]"
              }`}
            >
              <CheckSquare className="w-3 h-3" />
              <span>{bulkMode ? "Done" : "Bulk"}</span>
            </button>
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
              const isBulkChecked = selectedThreadIds.includes(t.id);
              const isAcrio = t.assignedStaffId === "ACRIO";
              const waitObj =
                t.status !== "RESOLVED" && !isAcrio
                  ? formatWaitingDuration(t.waitingSince, nowMs)
                  : null;
              const isOverdue = waitObj && waitObj.minutes >= 5;
              const hasThreadCallback = callbackConvIds.includes(t.id);
              const hasUnreadMention = unreadMentionConvIds.includes(t.id);
              const leftBorderClass = hasThreadCallback
                ? "border-l-[3.5px] border-l-rose-500"
                : hasUnreadMention
                ? "border-l-[3.5px] border-l-violet-500"
                : isOverdue
                ? "border-l-[3.5px] border-l-red-500"
                : waitObj
                ? "border-l-[3.5px] border-l-amber-500"
                : active
                ? "border-l-[3.5px] border-l-[#00a884]"
                : "border-l-[3.5px] border-l-transparent";

              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    bulkMode
                      ? toggleBulkSelectThread(t.id)
                      : handleSelectConversation(t.id)
                  }
                  className={`w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors cursor-pointer ${leftBorderClass} ${
                    active ? "bg-[#f0f2f5]" : "hover:bg-[#f5f6f6]"
                  }`}
                >
                  {bulkMode && (
                    <span
                      onClick={(ev) => toggleBulkSelectThread(t.id, ev)}
                      className={`mt-3 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                        isBulkChecked
                          ? "bg-[#00a884] border-[#00a884] text-white"
                          : "bg-white border-neutral-400"
                      }`}
                    >
                      {isBulkChecked && <Check className="w-3 h-3" />}
                    </span>
                  )}
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
                      <span className="text-[14px] font-semibold tracking-[-0.015em] text-[#111b21] truncate">
                        {t.customerName}
                      </span>
                      <span
                        className={`text-[11px] tabular-nums shrink-0 ${
                          t.unreadCount > 0
                            ? "text-[#00a884] font-semibold"
                            : "text-[#667781] font-medium"
                        }`}
                      >
                        {formatThreadTimeIst(t.lastMessageAt, initialData.serverNowMs)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-[12.5px] leading-snug text-[#54656f] truncate flex items-center gap-1 min-w-0">
                        {t.lastMessageDirection === "OUTBOUND" && (
                          <WhatsAppMessageTicks
                            status={t.lastMessageStatus || "SENT"}
                            showLabel={false}
                            size={13}
                          />
                        )}
                        <span className="truncate">
                          {stripWhatsAppFormatting(t.lastMessagePreview) || t.customerPhone}
                        </span>
                      </p>
                      {t.unreadCount > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#25d366] text-white text-[10px] font-bold tabular-nums flex items-center justify-center shrink-0">
                          {t.unreadCount}
                        </span>
                      )}
                    </div>

                    {/* ACRIO / Team / Escalation / Live Wait Row */}
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      {hasThreadCallback && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200 font-semibold inline-flex items-center gap-0.5">
                          <PhoneCall className="w-2.5 h-2.5" />
                          <span>Callback</span>
                        </span>
                      )}
                      {hasUnreadMention && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 border border-violet-200 font-semibold inline-flex items-center gap-0.5">
                          <AtSign className="w-2.5 h-2.5" />
                          <span>You</span>
                        </span>
                      )}
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

                          {t.collaborators && t.collaborators.length > 0 && (
                            <span
                              title={t.collaborators
                                .map((c) => c.staffName)
                                .join(", ")}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 font-medium"
                            >
                              +{t.collaborators.length}
                            </span>
                          )}

                          {waitObj && (
                            <span
                              suppressHydrationWarning
                              className={`text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-0.5 ${
                                waitObj.minutes >= 8
                                  ? "bg-red-100 text-red-800"
                                  : waitObj.minutes >= 3
                                  ? "bg-amber-100 text-amber-900"
                                  : "bg-emerald-50 text-emerald-800"
                              }`}
                            >
                              <Clock className="w-2.5 h-2.5" />
                              <span suppressHydrationWarning>Wait {waitObj.text}</span>
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

        {bulkMode && selectedThreadIds.length > 0 && (
          <div className="border-t border-[#d1d7db] bg-neutral-900 text-white px-3 py-2.5 flex items-center justify-between gap-2 shrink-0">
            <span className="text-xs font-semibold">
              {selectedThreadIds.length} selected
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={handleBulkAssignToMe}
                className="px-2.5 py-1 rounded bg-white/15 hover:bg-white/25 text-[11px] font-medium cursor-pointer disabled:opacity-50"
              >
                Assign to Me
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={handleBulkResolveSelected}
                className="px-2.5 py-1 rounded bg-[#00a884] hover:bg-[#008f6f] text-[11px] font-semibold cursor-pointer disabled:opacity-50"
              >
                Resolve
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* 2. CENTER WHATSAPP CONVERSATION STREAM + CLASSIC CONCEPTS WALLPAPER  */}
      {/* ===================================================================== */}
      <div
        className={`${
          mobilePane === "CHAT" ? "flex w-full" : "hidden"
        } lg:flex flex-1 min-w-0 flex-col bg-[#efeae2]`}
      >
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
                  <h2 className="font-display text-lg font-bold tracking-tight text-[#111b21]">
                    Classic Concepts WhatsApp Desk
                  </h2>
                  <p className="text-[13px] leading-relaxed text-[#54656f]">
                    Select any customer chat on the left. New enquiries are handled automatically by ACRIO first and connected to Sales Team whenever human help is needed.
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Top WhatsApp Chat Header */}
            <div className="min-h-[58px] px-3 sm:px-4 py-2 bg-[#f0f2f5] border-b border-[#d1d7db] flex flex-wrap items-center justify-between gap-2.5 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobilePane("LIST")}
                  aria-label="Back to chats list"
                  className="lg:hidden p-1.5 -ml-1 rounded-md bg-white border border-[#d1d7db] text-[#111b21] hover:bg-neutral-50 cursor-pointer shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="w-10 h-10 rounded-full bg-[#dfe5e7] text-[#3b4a54] flex items-center justify-center text-xs font-bold shrink-0 relative">
                  {getInitials(activeConv.customerName)}
                  <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#25d366] text-white flex items-center justify-center ring-2 ring-[#f0f2f5]">
                    <WhatsAppLogoIcon size={9} />
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-[16px] font-bold tracking-tight text-[#111b21] truncate">
                      {activeConv.customerName}
                    </h2>
                    <span className="text-xs font-mono font-medium text-[#54656f]">
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
                      suppressHydrationWarning
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
                        suppressHydrationWarning
                        className={`px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1 ${
                          activeWait.minutes >= 8
                            ? "bg-red-100 text-red-800"
                            : activeWait.minutes >= 3
                            ? "bg-amber-100 text-amber-900"
                            : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        <Clock className="w-3 h-3" />
                        <span suppressHydrationWarning>Customer waiting {activeWait.text}</span>
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

              {/* Right Header Actions: Compact Primary Actions + More Menu + Drawer Toggle */}
              <div className="flex items-center gap-1.5 relative">
                {activeCollaborators.length > 0 && (
                  <span
                    title={`Co-handlers: ${activeCollaborators
                      .map((c) => c.staffName)
                      .join(", ")}`}
                    className="hidden xl:inline-flex items-center gap-1 px-2 py-1 rounded-md bg-violet-50 border border-violet-200 text-violet-800 text-[11px] font-medium"
                  >
                    <Users className="w-3 h-3" />
                    <span>+{activeCollaborators.length} shared</span>
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => void handleGenerateSummary()}
                  disabled={summarizingChat}
                  title="Generate a private ACRIO chat summary note"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-violet-50 border border-violet-200 hover:bg-violet-100 text-violet-900 text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5 text-violet-700" />
                  <span className="hidden md:inline">
                    {summarizingChat ? "Summarizing..." : "Summary"}
                  </span>
                </button>

                {activeConv.status !== "RESOLVED" && isAcrioHandling ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleTakeOverChat()}
                      disabled={takingOver}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer shadow-2xs disabled:opacity-50"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>{takingOver ? "Taking over..." : "Take Over"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSmartAssignSalesP0}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white border border-[#d1d7db] hover:bg-neutral-50 text-xs font-medium text-[#111b21] cursor-pointer"
                      title="Connect to Sales Team P0 member with fewest active chats"
                    >
                      <Users className="w-3.5 h-3.5 text-[#00a884]" />
                      <span className="hidden sm:inline">Assign Sales</span>
                    </button>
                  </>
                ) : (
                  activeConv.status !== "RESOLVED" && (
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
                      title="Click to reassign team, responder, or escalation tier"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white border border-[#d1d7db] hover:bg-neutral-50 text-xs text-[#111b21] cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5 text-[#00a884]" />
                      <span className="font-medium truncate max-w-[110px]">
                        {activeConv.assignedStaffName || activeConv.assignedTeamName || "Sales Team"}
                      </span>
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
                  )
                )}

                {activeConv.status === "RESOLVED" ? (
                  <button
                    type="button"
                    onClick={handleReopen}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#d1d7db] bg-white hover:bg-neutral-50 text-xs font-semibold text-[#111b21] cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reopen</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowResolveModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-[#00a884]/60 hover:bg-[#e7fce3] text-[#008069] text-xs font-semibold cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Resolve</span>
                  </button>
                )}

                {/* Secondary Actions Overflow Menu */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowHeaderMenu((v) => !v)}
                    title="More chat actions"
                    className="p-1.5 rounded-md bg-white border border-[#d1d7db] hover:bg-neutral-50 text-[#54656f] cursor-pointer"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>

                  {showHeaderMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-30"
                        onClick={() => setShowHeaderMenu(false)}
                      />
                      <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl bg-white border border-neutral-200 shadow-xl py-1 z-40 text-xs">
                        {activeConv.status !== "RESOLVED" && !isAcrioHandling && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowHeaderMenu(false);
                              void handleReturnToAcrio();
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 font-medium text-indigo-800 cursor-pointer"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Hand back to System (ACRIO)</span>
                          </button>
                        )}
                        {hasUnreadOutboundByCustomer && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowHeaderMenu(false);
                              void handleSimulateCustomerRead();
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-[#0088cc] font-medium cursor-pointer"
                          >
                            <WhatsAppMessageTicks
                              status="READ"
                              showLabel={false}
                              size={13}
                            />
                            <span>Mark customer Read (test)</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setShowHeaderMenu(false);
                            void navigator.clipboard?.writeText(activeConv.customerPhone);
                            showToast(`Copied ${activeConv.customerPhone}`);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5 text-slate-500" />
                          <span>Copy phone ({activeConv.customerPhone})</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowHeaderMenu(false);
                            const url = `${window.location.origin}/dashboard/inbox?chat=${encodeURIComponent(activeConv.id)}`;
                            void navigator.clipboard?.writeText(url);
                            showToast("Copied direct chat link.");
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 cursor-pointer"
                        >
                          <Link2 className="w-3.5 h-3.5 text-slate-500" />
                          <span>Copy direct chat link</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowHeaderMenu(false);
                            const lines = messages.map(
                              (m) =>
                                `[${formatDateTimeShortIst(m.createdAt)}] ${m.senderName} (${m.direction}): ${m.body}`
                            );
                            const blob = new Blob([lines.join("\n\n")], {
                              type: "text/plain;charset=utf-8",
                            });
                            const a = document.createElement("a");
                            a.href = URL.createObjectURL(blob);
                            a.download = `chat_${activeConv.customerPhone.replace(/\D/g, "")}.txt`;
                            a.click();
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5 text-slate-500" />
                          <span>Export transcript (.txt)</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setMobilePane("INFO")}
                  title="Customer Details & Orders"
                  className="lg:hidden inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-white border border-[#d1d7db] hover:bg-neutral-50 text-xs font-medium text-[#3b4a54] cursor-pointer"
                >
                  <Info className="w-3.5 h-3.5 text-[#00a884]" />
                  <span>Details</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowRightDrawer((p) => !p)}
                  title={
                    showRightDrawer
                      ? "Hide Customer Panel (Alt+D)"
                      : "Show Customer Panel (Alt+D)"
                  }
                  className={`hidden lg:inline-flex p-1.5 rounded-md border cursor-pointer transition ${
                    showRightDrawer
                      ? "bg-[#e7fce3] border-[#00a884]/50 text-[#008069]"
                      : "bg-white border-[#d1d7db] hover:bg-neutral-50 text-[#54656f]"
                  }`}
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
              className="flex-1 overflow-y-auto px-3.5 sm:px-5 py-4 space-y-2.5"
            >
              {/* Top WhatsApp Security/Context Pill (zero cost/free mentions for staff) */}
              <div className="flex justify-center pb-1">
                <div className="px-3 py-1 rounded-md bg-[#fff5c4] border border-[#f2df8d] text-[11px] text-[#54656f] shadow-2xs text-center max-w-xl">
                  <strong>ACRIO</strong> runs only when a chat is assigned to{" "}
                  <strong>System</strong>. Once a chat is assigned to a team
                  member, ACRIO stays paused until assigned back to System.
                </div>
              </div>

              {messages.map((m) => {
                if (m.messageType === "ASSIGNMENT_EVENT") {
                  const meta = (m.metadata || {}) as Record<string, unknown>;
                  const toStaffId = meta.toStaffId ? String(meta.toStaffId) : "";
                  const toStaffName = meta.toStaffName
                    ? String(meta.toStaffName)
                    : "Staff";
                  const toTeamName = meta.toTeamName
                    ? String(meta.toTeamName)
                    : "Sales Team";
                  const tier = meta.escalationLevel
                    ? String(meta.escalationLevel)
                    : "P0";
                  const assignedAtIso = meta.assignedAt
                    ? String(meta.assignedAt)
                    : m.createdAt;
                  const firstRespIso = meta.firstResponseAt
                    ? String(meta.firstResponseAt)
                    : null;
                  const firstRespSec =
                    typeof meta.firstResponseSeconds === "number"
                      ? meta.firstResponseSeconds
                      : null;
                  const outcome = meta.outcome ? String(meta.outcome) : "ACTIVE";
                  const isSystemAsg = toStaffId === "ACRIO";
                  const livePendingWait =
                    !firstRespIso &&
                    outcome === "ACTIVE" &&
                    !isSystemAsg &&
                    activeConv.status !== "RESOLVED"
                      ? formatWaitingDuration(assignedAtIso, nowMs)
                      : null;

                  return (
                    <div key={m.id} className="flex justify-center my-2">
                      <div className="w-full max-w-[84%] rounded-lg px-3.5 py-2.5 bg-white/95 border border-[#d1d7db] shadow-2xs text-[#111b21]">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <div className="inline-flex flex-wrap items-center gap-1.5 font-semibold">
                            {isSystemAsg ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200">
                                <Sparkles className="w-3 h-3" />
                                <span>System (ACRIO)</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#e7fce3] text-[#008069] border border-[#b7ebaf]">
                                <UserCheck className="w-3 h-3" />
                                <span>
                                  {toStaffName} • {toTeamName}
                                </span>
                              </span>
                            )}
                            {!isSystemAsg && (
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                                  tier === "P2"
                                    ? "bg-red-600 text-white"
                                    : tier === "P1"
                                    ? "bg-amber-500 text-white"
                                    : "bg-neutral-100 text-neutral-700"
                                }`}
                              >
                                {tier}
                              </span>
                            )}
                          </div>
                          <span className="text-[#54656f] font-medium">
                            Assigned: {formatDateTimeShort(assignedAtIso)}
                          </span>
                        </div>

                        <p className="text-xs text-[#3b4a54] mt-1 leading-snug">
                          {m.body}
                        </p>

                        <div className="mt-1.5 pt-1.5 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          {firstRespIso ? (
                            <span className="inline-flex items-center gap-1 text-emerald-800 font-medium">
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span>
                                First response:{" "}
                                <strong>{formatDateTimeShort(firstRespIso)}</strong>
                                {firstRespSec !== null && (
                                  <>
                                    {" "}
                                    (in{" "}
                                    <strong>
                                      {formatResponseSpeed(firstRespSec)}
                                    </strong>
                                    )
                                  </>
                                )}
                              </span>
                            </span>
                          ) : outcome === "ESCALATED" ? (
                            <span className="inline-flex items-center gap-1 text-red-700 font-medium">
                              <Clock className="w-3 h-3" />
                              <span>Escalated before first response</span>
                            </span>
                          ) : outcome === "REASSIGNED" ? (
                            <span className="text-neutral-500">
                              Reassigned before first response
                            </span>
                          ) : livePendingWait ? (
                            <span
                              suppressHydrationWarning
                              className={`inline-flex items-center gap-1 font-medium ${
                                livePendingWait.minutes >= 5
                                  ? "text-red-700"
                                  : "text-amber-700"
                              }`}
                            >
                              <Clock className="w-3 h-3" />
                              <span suppressHydrationWarning>
                                Awaiting first response ({livePendingWait.text})
                              </span>
                            </span>
                          ) : (
                            <span className="text-neutral-500">
                              {isSystemAsg
                                ? "Standing by for customer message"
                                : "No outbound reply needed"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                const isInternalNote =
                  m.direction === "INTERNAL" ||
                  m.messageType === "INTERNAL_NOTE";
                const isOutbound = m.direction === "OUTBOUND";
                const quotedReply = extractQuotedReply(m);
                const ctaButton = extractCtaButton(m);
                const isHighlighted = highlightedMsgId === m.id;

                if (isInternalNote) {
                  const isAcrioNote = m.senderName === "ACRIO";
                  return (
                    <div
                      key={m.id}
                      id={`chat-msg-${m.id}`}
                      className="flex justify-center my-2"
                    >
                      <div
                        className={`w-full max-w-[78%] rounded-lg px-3.5 py-2.5 shadow-2xs transition-all duration-300 ${
                          isAcrioNote
                            ? "bg-violet-50 border border-violet-300/70 text-violet-950"
                            : "bg-[#fef3c7] border border-[#f59e0b]/45 text-[#78350f]"
                        } ${isHighlighted ? "ring-2 ring-[#00a884]" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-3 text-[11px] font-semibold mb-1">
                          <span className="inline-flex items-center gap-1">
                            <Lock className={`w-3 h-3 ${isAcrioNote ? "text-violet-700" : "text-amber-700"}`} />
                            <span>
                              {isAcrioNote ? "ACRIO • Private answer for your team" : `Internal Team Note • ${m.senderName}`}
                            </span>
                          </span>
                          <span className={`font-normal ${isAcrioNote ? "text-violet-800/80" : "text-amber-800/80"}`}>
                            {formatTimeIst(m.createdAt)}
                          </span>
                        </div>
                        {quotedReply && (
                          <button
                            type="button"
                            onClick={() => jumpToQuotedMessage(quotedReply)}
                            className="w-full text-left mb-1.5 rounded-md px-2.5 py-1.5 bg-amber-100/85 hover:bg-amber-200/70 border-l-[3.5px] border-amber-600 transition cursor-pointer"
                          >
                            <div className="text-[11px] font-semibold text-amber-950 truncate">
                              {quotedReply.senderName}
                            </div>
                            <div className="text-[12px] text-amber-900/85 line-clamp-2 leading-snug">
                              {stripWhatsAppFormatting(quotedReply.body)}
                            </div>
                          </button>
                        )}
                        <WhatsAppFormattedText
                          text={emphasizeMentions(m.body, staffList)}
                          className="text-[13px] leading-relaxed"
                          onPhoneClick={handleOpenNewChatWithPhone}
                        />
                        {(() => {
                          const noteMedia = extractMessageMedia(m);
                          if (!noteMedia) return null;
                          return (
                            <div className="mt-2">
                              <MessageMediaRenderer
                                media={noteMedia}
                                onOpenPreview={(med) => setPreviewMedia(med)}
                              />
                            </div>
                          );
                        })()}
                        {isAcrioNote &&
                          m.metadata &&
                          typeof m.metadata.pendingAction === "object" &&
                          m.metadata.pendingAction !== null &&
                          (() => {
                            const pa = m.metadata.pendingAction as {
                              id?: string;
                              status?: string;
                              title?: string;
                              messageText?: string;
                              decidedByStaffName?: string;
                              error?: string;
                              attachment?: {
                                fileName?: string;
                                mediaType?: string;
                              } | null;
                            };
                            const isBusy = acrioActionBusyId === m.id;
                            if (pa.status === "CONFIRMED") {
                              return (
                                <div className="mt-2 pt-2 border-t border-violet-200/70 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
                                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                                  <span>
                                    Confirmed & shared with client
                                    {pa.decidedByStaffName ? ` by ${pa.decidedByStaffName}` : ""}
                                  </span>
                                </div>
                              );
                            }
                            if (pa.status === "CANCELLED") {
                              return (
                                <div className="mt-2 pt-2 border-t border-violet-200/70 flex items-center gap-1.5 text-[11px] font-medium text-neutral-600">
                                  <X className="w-3.5 h-3.5" />
                                  <span>
                                    Action cancelled
                                    {pa.decidedByStaffName ? ` by ${pa.decidedByStaffName}` : ""}
                                  </span>
                                </div>
                              );
                            }
                            return (
                              <div className="mt-2.5 rounded-md bg-white border border-violet-200 p-2.5 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[11px] font-semibold text-violet-950">
                                    {pa.title || "Confirm client action"}
                                  </span>
                                  {pa.attachment?.fileName && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-violet-100 text-violet-900 text-[10.5px] font-medium">
                                      <FileText className="w-3 h-3" />
                                      <span>{pa.attachment.fileName}</span>
                                    </span>
                                  )}
                                </div>
                                {pa.messageText && (
                                  <p className="text-[12px] text-[#3b4a54] bg-[#f8fafc] border border-neutral-200 rounded px-2 py-1.5">
                                    {pa.messageText}
                                  </p>
                                )}
                                {pa.status === "FAILED" && pa.error && (
                                  <p className="text-[11px] text-rose-700">
                                    Previous send failed: {pa.error}
                                  </p>
                                )}
                                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() =>
                                      void handleConfirmAcrioAction(m.id, "CONFIRM")
                                    }
                                    className="px-3 py-1.5 rounded bg-[#00a884] hover:bg-[#008f6f] text-white text-[11.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>
                                      {isBusy
                                        ? "Sharing with client..."
                                        : "Confirm & Share with Client"}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() =>
                                      void handleConfirmAcrioAction(m.id, "CANCEL")
                                    }
                                    className="px-2.5 py-1.5 rounded bg-white hover:bg-neutral-100 border border-neutral-300 text-neutral-700 text-[11px] font-medium cursor-pointer disabled:opacity-50"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                        {isAcrioNote &&
                          m.metadata &&
                          typeof m.metadata.missingCompanyDoc === "object" &&
                          m.metadata.missingCompanyDoc !== null &&
                          (m.metadata.missingCompanyDoc as { status?: string }).status ===
                            "NEEDS_UPLOAD" &&
                          (() => {
                            const md = m.metadata.missingCompanyDoc as {
                              slug?: string;
                              title?: string;
                              keywords?: string;
                            };
                            const isBusy = acrioActionBusyId === m.id;
                            return (
                              <div className="mt-2.5 rounded-md bg-white border border-violet-200 p-2.5 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[11px] text-violet-950 font-medium">
                                  Upload once to save permanently & confirm sharing:
                                </span>
                                <label
                                  className={`px-3 py-1.5 rounded bg-violet-700 hover:bg-violet-800 text-white text-[11.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                                    isBusy ? "opacity-50 pointer-events-none" : ""
                                  }`}
                                >
                                  <Paperclip className="w-3.5 h-3.5" />
                                  <span>
                                    {isBusy
                                      ? "Uploading..."
                                      : `Upload ${md.title || "Document"}`}
                                  </span>
                                  <input
                                    type="file"
                                    accept=".pdf,image/*"
                                    className="hidden"
                                    disabled={isBusy}
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      e.target.value = "";
                                      if (f) {
                                        void handleUploadCompanyDocForNote(m.id, md, f);
                                      }
                                    }}
                                  />
                                </label>
                              </div>
                            );
                          })()}
                        {isAcrioNote &&
                          m.metadata &&
                          Array.isArray(m.metadata.actionsExecuted) &&
                          m.metadata.actionsExecuted.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-violet-200/70 flex flex-wrap gap-1.5">
                              {(m.metadata.actionsExecuted as (Record<string, unknown> | string)[]).map(
                                (act, idx) => (
                                  <span
                                    key={`${m.id}_act_${idx}`}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-200 text-[10.5px] font-semibold"
                                  >
                                    <Check className="w-3 h-3" />
                                    <span>
                                      {typeof act === "string"
                                        ? act
                                        : String(act.detail || act.type || "Action done")}
                                    </span>
                                  </span>
                                )
                              )}
                            </div>
                          )}
                        {isAcrioNote &&
                          m.metadata &&
                          !m.metadata.pendingAction &&
                          !m.metadata.missingCompanyDoc &&
                          typeof m.metadata.suggestedReply === "string" &&
                          m.metadata.suggestedReply.trim() && (
                            <div className="mt-2 pt-2 border-t border-violet-200/70 flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] font-medium text-violet-900">
                                Suggested reply ready:
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void navigator.clipboard?.writeText(
                                      String(m.metadata?.suggestedReply || "")
                                    );
                                    showToast("Suggested reply copied.");
                                  }}
                                  className="px-2 py-1 rounded bg-white border border-violet-200 text-violet-900 text-[11px] font-medium cursor-pointer"
                                >
                                  Copy
                                </button>
                                {isAssignedToCurrentUser && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setComposerMode("REPLY");
                                      setReplyText(
                                        String(m.metadata?.suggestedReply || "")
                                      );
                                      composerInputRef.current?.focus();
                                    }}
                                    className="px-2.5 py-1 rounded bg-violet-700 hover:bg-violet-800 text-white text-[11px] font-semibold cursor-pointer"
                                  >
                                    Use Reply
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                      </div>
                    </div>
                  );
                }

                const isAcrioBubble = m.billingCategory === "ACRIO";
                const isTemplateBubble = m.messageType === "TEMPLATE";
                const quotedIsAcrio =
                  quotedReply?.senderType === "ACRIO" ||
                  quotedReply?.senderName === "ACRIO";
                const quotedIsOutbound = quotedReply?.direction === "OUTBOUND";

                return (
                  <div
                    key={m.id}
                    id={`chat-msg-${m.id}`}
                    className={`group flex ${
                      isOutbound ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      onDoubleClick={() => startReplyToMessage(m)}
                      title="Double-click or press Reply to quote this message"
                      className={`max-w-[74%] rounded-lg px-3 py-2 shadow-2xs relative transition-all duration-300 ${
                        isHighlighted
                          ? "ring-2 ring-[#00a884] bg-[#fff8d6] text-[#111b21]"
                          : isOutbound
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
                              ACRIO
                            </span>
                          )}
                          {isTemplateBubble && (
                            <span className="px-1.5 py-0.2 rounded bg-white/80 text-[#54656f] text-[10px] font-medium">
                              Template
                            </span>
                          )}
                          <div className="inline-flex items-center gap-0.5 opacity-75 group-hover:opacity-100 transition">
                            <button
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                startReplyToMessage(m);
                              }}
                              title="Quote & reply to customer"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium text-[#54656f] hover:text-[#111b21] hover:bg-black/8 cursor-pointer"
                            >
                              <CornerUpLeft className="w-3 h-3" />
                              <span>Reply</span>
                            </button>
                            <button
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                startReplyToMessage(m);
                                setComposerMode("NOTE");
                                setTimeout(() => composerInputRef.current?.focus(), 20);
                              }}
                              title="Quote this message in a private team note (@mention or @ACRIO)"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium text-amber-800 hover:bg-amber-500/15 cursor-pointer"
                            >
                              <StickyNote className="w-3 h-3" />
                              <span>Note</span>
                            </button>
                            <button
                              type="button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void navigator.clipboard?.writeText(stripWhatsAppFormatting(m.body));
                                showToast("Message text copied.");
                              }}
                              title="Copy message text"
                              className="p-1 rounded text-[#54656f] hover:text-[#111b21] hover:bg-black/8 cursor-pointer"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {quotedReply && (
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            jumpToQuotedMessage(quotedReply);
                          }}
                          title="Jump to original message"
                          className={`w-full text-left my-1 rounded-md px-2.5 py-1.5 border-l-[3.5px] transition cursor-pointer ${
                            quotedIsAcrio
                              ? "border-indigo-600"
                              : quotedIsOutbound
                              ? "border-[#00a884]"
                              : "border-[#e31837]"
                          } ${
                            isOutbound
                              ? "bg-[#cfe9ba]/75 hover:bg-[#c5e4ae]"
                              : "bg-[#f0f2f5] hover:bg-[#e6eaee]"
                          }`}
                        >
                          <div
                            className={`text-[11px] font-semibold truncate ${
                              quotedIsAcrio
                                ? "text-indigo-800"
                                : quotedIsOutbound
                                ? "text-[#008069]"
                                : "text-[#e31837]"
                            }`}
                          >
                            {quotedReply.senderName}
                          </div>
                          <div className="text-[12px] text-[#54656f] line-clamp-2 leading-snug">
                            {stripWhatsAppFormatting(quotedReply.body)}
                          </div>
                        </button>
                      )}

                      {(() => {
                        const msgMedia = extractMessageMedia(m);
                        if (!msgMedia) return null;
                        return (
                          <MessageMediaRenderer
                            media={msgMedia}
                            onOpenPreview={(med) => setPreviewMedia(med)}
                          />
                        );
                      })()}

                      <WhatsAppFormattedText
                        text={m.body}
                        className="text-[14px] leading-[1.52] tracking-[-0.006em]"
                        onPhoneClick={handleOpenNewChatWithPhone}
                      />

                      {ctaButton && (
                        <div className="mt-2 pt-2 border-t border-black/10 space-y-1.5">
                          {(ctaButton.orderId || ctaButton.providerName) && (
                            <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-[#54656f]">
                              {ctaButton.orderId && (
                                <span className="font-mono font-semibold text-[#111b21]">
                                  Order #{ctaButton.orderId}
                                </span>
                              )}
                              {ctaButton.providerName && (
                                <span className="px-1.5 py-0.5 rounded bg-white/80 text-[#008069] font-medium">
                                  {ctaButton.providerName}
                                  {ctaButton.awbNumber
                                    ? ` • AWB ${ctaButton.awbNumber}`
                                    : ""}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-1.5">
                            <a
                              href={ctaButton.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md bg-white/95 hover:bg-white border border-[#00a884]/35 text-[#008069] text-xs font-semibold shadow-2xs transition"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>{ctaButton.label}</span>
                            </a>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard?.writeText(ctaButton.url);
                                showToast(`Copied ${ctaButton.url}`);
                              }}
                              title={`Copy ${ctaButton.url}`}
                              className="p-1.5 rounded-md bg-white/90 hover:bg-white border border-black/10 text-[#54656f] hover:text-[#111b21] cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="text-[10.5px] font-mono text-[#54656f] truncate">
                            {ctaButton.url}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-end gap-1.5 mt-1 text-[10.5px] tabular-nums text-[#667781]">
                        <span>
                          {formatTimeIst(m.createdAt)}
                        </span>
                        {isOutbound && (
                          <WhatsAppMessageTicks
                            status={m.deliveryStatus}
                            showLabel
                            size={14}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Chronological Bottom Resolution Event Card (so users never scroll up to see resolution!) */}
              {activeConv.status === "RESOLVED" && (
                <div className="mx-auto max-w-xl p-3 rounded-lg bg-emerald-50/95 border border-emerald-300 text-xs text-emerald-950 shadow-2xs flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      <span>
                        Resolved by {activeConv.resolvedByName || "Staff"}
                      </span>
                    </div>
                    {activeConv.resolutionSummary && (
                      <p className="mt-0.5 text-emerald-900">
                        {activeConv.resolutionSummary}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleReopen}
                    className="px-2.5 py-1 rounded bg-white border border-emerald-300 hover:bg-emerald-100 text-[11px] font-semibold text-emerald-900 cursor-pointer shrink-0"
                  >
                    Reopen
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Popovers for Attach Media/File, Track Order Button & Product Short Links (triggered from the Composer Toolbar) */}
            {detail && (showAttachmentPicker || showTrackPopover || (showShortLinksPicker && detail.customLinks.length > 0)) && (
              <div className="relative shrink-0 px-4">
                <AttachmentPickerPopover
                  open={showAttachmentPicker}
                  onClose={() => setShowAttachmentPicker(false)}
                  onStageAttachment={(att) => {
                    setStagedAttachment(att);
                    if (att.suggestedCaption && !replyText.trim()) {
                      setReplyText(att.suggestedCaption);
                    }
                    setComposerMode("REPLY");
                    setTimeout(() => composerInputRef.current?.focus(), 20);
                  }}
                  onShowToast={showToast}
                />
                {showTrackPopover && (
                  <form
                    onSubmit={handleSendOrderTracking}
                    className="absolute bottom-full left-4 right-4 mb-1.5 z-30 rounded-xl bg-white border border-[#d1d7db] shadow-2xl p-3.5 space-y-2.5 max-w-2xl"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#111b21]">
                        <Truck className="w-4 h-4 text-[#00a884]" />
                        <span>
                          Create & Send Dynamic Order Track Button (track.ccapl.cc/{"{id}"})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowTrackPopover(false)}
                        className="p-1 rounded hover:bg-neutral-100 text-[#667781] cursor-pointer"
                        aria-label="Close tracking button creator"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {detail.orders.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-[#54656f]">
                          Pick customer order:
                        </span>
                        {detail.orders.slice(0, 5).map((ord) => (
                          <button
                            key={ord.id}
                            type="button"
                            onClick={() =>
                              openTrackPopoverForOrder({
                                orderId: ord.orderNumber,
                                itemsSummary: ord.itemsSummary,
                              })
                            }
                            className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer border ${
                              trackOrderId.trim().toUpperCase() ===
                              ord.orderNumber.toUpperCase()
                                ? "bg-[#00a884] text-white border-[#00a884]"
                                : "bg-[#f0f2f5] text-[#111b21] border-[#d1d7db]"
                            }`}
                          >
                            {ord.orderNumber}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-[#54656f] mb-0.5">
                          Order ID *
                        </label>
                        <input
                          type="text"
                          required
                          value={trackOrderId}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTrackOrderId(val);
                            if (val.trim().toUpperCase().startsWith("CE")) {
                              setTrackBrand("CLASSIC_EDGE_53");
                            }
                            if (trackProviderKey !== "CUSTOM" && !trackAwbNumber.trim()) {
                              setTrackProviderUrl(
                                buildClientProviderTrackingUrl(
                                  trackProviderKey,
                                  val.trim()
                                )
                              );
                            }
                          }}
                          placeholder="CC-2609 or CE53-1042"
                          className="w-full rounded border border-[#d1d7db] px-2.5 py-1.5 text-xs font-mono text-[#111b21]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[#54656f] mb-0.5">
                          Store / Brand
                        </label>
                        <select
                          value={trackBrand}
                          onChange={(e) =>
                            setTrackBrand(
                              e.target.value as
                                | "CLASSIC_CONCEPTS"
                                | "CLASSIC_EDGE_53"
                            )
                          }
                          className="w-full rounded border border-[#d1d7db] bg-white px-2 py-1.5 text-xs text-[#111b21]"
                        >
                          <option value="CLASSIC_CONCEPTS">
                            Classic Concepts
                          </option>
                          <option value="CLASSIC_EDGE_53">
                            Classic Edge 53
                          </option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[#54656f] mb-0.5">
                          Courier Partner
                        </label>
                        <select
                          value={trackProviderKey}
                          onChange={(e) => {
                            const nextProv = e.target.value;
                            setTrackProviderKey(nextProv);
                            if (nextProv !== "CUSTOM") {
                              setTrackProviderUrl(
                                buildClientProviderTrackingUrl(
                                  nextProv,
                                  trackAwbNumber.trim() || trackOrderId.trim()
                                )
                              );
                            }
                          }}
                          className="w-full rounded border border-[#d1d7db] bg-white px-2 py-1.5 text-xs text-[#111b21]"
                        >
                          {SHIPPING_PROVIDER_OPTIONS.map((p) => (
                            <option key={p.code} value={p.code}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-[#54656f] mb-0.5">
                          AWB / LR Number
                        </label>
                        <input
                          type="text"
                          value={trackAwbNumber}
                          onChange={(e) => {
                            const awb = e.target.value;
                            setTrackAwbNumber(awb);
                            if (trackProviderKey !== "CUSTOM") {
                              setTrackProviderUrl(
                                buildClientProviderTrackingUrl(
                                  trackProviderKey,
                                  awb.trim() || trackOrderId.trim()
                                )
                              );
                            }
                          }}
                          placeholder="Courier AWB or LR #"
                          className="w-full rounded border border-[#d1d7db] px-2.5 py-1.5 text-xs font-mono text-[#111b21]"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-medium text-[#54656f] mb-0.5">
                          Courier Redirect URL (customer lands here)
                        </label>
                        <input
                          type="url"
                          value={trackProviderUrl}
                          onChange={(e) => setTrackProviderUrl(e.target.value)}
                          placeholder="https://www.delhivery.com/track/package/..."
                          className="w-full rounded border border-[#d1d7db] px-2.5 py-1.5 text-xs font-mono text-[#111b21]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-[#54656f] mb-0.5">
                          WhatsApp Button Text
                        </label>
                        <input
                          type="text"
                          maxLength={20}
                          value={trackButtonLabel}
                          onChange={(e) => setTrackButtonLabel(e.target.value)}
                          placeholder="Track Order"
                          className="w-full rounded border border-[#d1d7db] px-2.5 py-1.5 text-xs text-[#111b21]"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-medium text-[#54656f] mb-0.5">
                          Optional Custom Message (blank uses clean default)
                        </label>
                        <input
                          type="text"
                          value={trackMessageText}
                          onChange={(e) => setTrackMessageText(e.target.value)}
                          placeholder="Your order has been dispatched. Tap Track Order below for live status."
                          className="w-full rounded border border-[#d1d7db] px-2.5 py-1.5 text-xs text-[#111b21]"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#f0f2f5]">
                      <span className="text-[11px] font-mono text-[#008069] truncate">
                        Button URL: {TRACKING_PUBLIC_ORIGIN}/
                        {encodeURIComponent(
                          trackOrderId.trim() || "{order-id}"
                        )}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const idSlug = encodeURIComponent(
                              trackOrderId.trim()
                            );
                            if (!idSlug) {
                              showToast("Enter an Order ID first.");
                              return;
                            }
                            appendToComposer(
                              `${TRACKING_PUBLIC_ORIGIN}/${idSlug}`
                            );
                            setShowTrackPopover(false);
                          }}
                          className="px-2.5 py-1.5 rounded border border-[#d1d7db] bg-[#f8f9fa] hover:bg-neutral-100 text-[11px] font-medium text-[#3b4a54] cursor-pointer"
                        >
                          Insert Link Only
                        </button>
                        <button
                          type="submit"
                          disabled={sendingTrackBtn || !trackOrderId.trim()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                        >
                          <Truck className="w-3.5 h-3.5" />
                          <span>
                            {sendingTrackBtn
                              ? "Sending..."
                              : "Send Track Button in Chat"}
                          </span>
                        </button>
                      </div>
                    </div>
                  </form>
                )}

                {showShortLinksPicker && detail.customLinks.length > 0 && (
                  <div className="absolute bottom-full left-4 right-4 mb-1.5 z-30 rounded-lg bg-white border border-[#d1d7db] shadow-lg p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1 text-[11px]">
                        {(
                          [
                            { key: "ALL", label: "All Links" },
                            { key: "CC", label: "Classic Concepts" },
                            { key: "CE53", label: "Classic Edge 53" },
                          ] as const
                        ).map((tb) => (
                          <button
                            key={tb.key}
                            type="button"
                            onClick={() => setShortLinkBrandFilter(tb.key)}
                            className={`px-2 py-0.5 rounded font-medium cursor-pointer ${
                              shortLinkBrandFilter === tb.key
                                ? "bg-[#00a884] text-white"
                                : "bg-[#f0f2f5] text-[#54656f] hover:text-[#111b21]"
                            }`}
                          >
                            {tb.label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowShortLinksPicker(false)}
                        className="p-1 rounded hover:bg-neutral-100 text-[#667781] cursor-pointer"
                        aria-label="Close short links picker"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#667781] absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={shortLinkQuery}
                        onChange={(e) => setShortLinkQuery(e.target.value)}
                        placeholder="Search Classic Concepts or Classic Edge 53 product, SKU, or ccapl.cc code..."
                        className="w-full rounded-md border border-[#d1d7db] pl-8 pr-3 py-1.5 text-xs text-[#111b21] focus:outline-none focus:border-[#00a884]"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-[#f0f2f5]">
                      {detail.customLinks
                        .filter((lnk) => {
                          const isCe =
                            lnk.utmCampaign === "auto_classicedge53" ||
                            lnk.code.startsWith("ce53-");
                          const isCc =
                            lnk.utmCampaign === "auto_classicconcepts" ||
                            lnk.code.startsWith("cc-");
                          if (shortLinkBrandFilter === "CE53" && !isCe) {
                            return false;
                          }
                          if (shortLinkBrandFilter === "CC" && !isCc) {
                            return false;
                          }
                          const q = shortLinkQuery.trim().toLowerCase();
                          if (!q) return true;
                          return `${lnk.title} ${lnk.code} ${lnk.targetUrl}`
                            .toLowerCase()
                            .includes(q);
                        })
                        .slice(0, 60)
                        .map((lnk) => (
                          <button
                            key={lnk.id}
                            type="button"
                            onClick={() => {
                              appendToComposer(formatShortLinkUrl(lnk.code));
                              setShowShortLinksPicker(false);
                              composerInputRef.current?.focus();
                            }}
                            className="w-full text-left py-1.5 px-2 hover:bg-[#f0f2f5] rounded flex items-center justify-between gap-2 text-xs cursor-pointer"
                          >
                            <span className="font-medium text-[#111b21] truncate">
                              {lnk.title}
                            </span>
                            <span className="font-mono text-[11px] text-[#008069] shrink-0">
                              {SHORTLINK_PUBLIC_DOMAIN}/{lnk.code}
                            </span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {pendingCallback && (
              <div className="px-4 py-2 bg-rose-50 border-t border-rose-200 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-rose-950 shrink-0">
                <span className="font-semibold">Callback requested</span>
                <span>
                  Wants a call in the <strong>{pendingCallback.slot}</strong>
                  {pendingCallback.topic ? ` about ${pendingCallback.topic}` : ""}
                </span>
                <a
                  href={`tel:${pendingCallback.phone}`}
                  className="font-semibold text-[#008069] hover:underline"
                >
                  {pendingCallback.phone}
                </a>
                <button
                  type="button"
                  onClick={() => void markPendingCallbackDone()}
                  className="ml-auto px-2.5 py-1 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white font-semibold cursor-pointer"
                >
                  Mark called
                </button>
              </div>
            )}

            {/* WhatsApp Bottom Composer: Gated by Assignment/Collaboration (#5) */}
            {!isAssignedToCurrentUser ? (
              <div className="px-4 py-3 border-t border-[#d1d7db] bg-[#f8fafc] space-y-2.5 shrink-0">
                <div className="rounded-xl border border-amber-200 bg-white px-4 py-3 shadow-2xs flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-neutral-900">
                        {isAcrioHandling
                          ? "ACRIO is currently handling this chat"
                          : `Currently handled by ${
                              activeConv?.assignedStaffName || "another teammate"
                            }${
                              activeConv?.assignedTeamName
                                ? ` (${activeConv.assignedTeamName})`
                                : ""
                            }`}
                      </div>
                      <p className="text-[11.5px] text-neutral-600 mt-0.5">
                        Only the assigned handler or tagged co-handlers can send WhatsApp messages to this customer. Take over the chat to reply directly.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setShowNoteForNonOwner((prev) => !prev);
                        setComposerMode("NOTE");
                      }}
                      className="px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-950 text-xs font-medium cursor-pointer inline-flex items-center gap-1"
                    >
                      <Lock className="w-3 h-3" />
                      <span>
                        {showNoteForNonOwner ? "Hide Note" : "Add Internal Note"}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={takingOver}
                      onClick={() => void handleTakeOverChat()}
                      className="px-3.5 py-1.5 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 shadow-2xs disabled:opacity-50"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>
                        {takingOver
                          ? "Taking over..."
                          : isAcrioHandling
                          ? "Take Over Chat"
                          : `Take Over from ${
                              activeConv?.assignedStaffName?.split(" ")[0] ||
                              "Teammate"
                            }`}
                      </span>
                    </button>
                  </div>
                </div>

                {showNoteForNonOwner && (
                  <form
                    onSubmit={(e) => {
                      if (composerMode !== "NOTE") setComposerMode("NOTE");
                      return handleComposerSubmit(e);
                    }}
                    className="flex items-end gap-2 bg-[#fef9e7] border border-amber-200 rounded-lg p-2.5"
                  >
                    <MentionTextarea
                      textareaRef={composerInputRef}
                      rows={2}
                      enabled
                      people={staffList.map((s) => ({
                        id: s.id,
                        name: s.name,
                        role: s.role,
                      }))}
                      value={replyText}
                      onChange={(v) => setReplyText(v)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleComposerSubmit(e);
                        }
                      }}
                      placeholder="Private note only for teammates (customer never sees this)..."
                      className="w-full rounded-md px-3 py-1.5 text-xs bg-white border border-amber-300 focus:outline-none focus:border-amber-500 resize-none"
                    />
                    <button
                      type="submit"
                      disabled={sending || !replyText.trim()}
                      className="h-9 px-3.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      <Lock className="w-3 h-3" />
                      <span>Save Note</span>
                    </button>
                  </form>
                )}
              </div>
            ) : (
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
                    <span>WhatsApp Reply</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setComposerMode("TEMPLATE");
                      setTemplateDialogOpen(true);
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
                    <span>Internal Note</span>
                  </button>
                </div>

                {/* Unified Quick-Action Tools right on the Composer Toolbar */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {detail && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setShowTrackPopover(false);
                          setShowShortLinksPicker(false);
                          setShowAttachmentPicker((prev) => !prev);
                        }}
                        title="Attach & send Image, Video, PDF, CAD/Office file, or Catalog Photo/Brochure"
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold cursor-pointer transition ${
                          showAttachmentPicker || stagedAttachment
                            ? "bg-[#00a884] text-white border-[#00a884]"
                            : "bg-white hover:bg-[#e7fce3] border-[#d1d7db] text-[#111b21]"
                        }`}
                      >
                        <Paperclip
                          className={`w-3.5 h-3.5 ${
                            showAttachmentPicker || stagedAttachment
                              ? "text-white"
                              : "text-[#00a884]"
                          }`}
                        />
                        <span>Attach Media / PDF</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowShortLinksPicker(false);
                          setShowAttachmentPicker(false);
                          if (showTrackPopover) {
                            setShowTrackPopover(false);
                          } else {
                            openTrackPopoverForOrder();
                          }
                        }}
                        title="Create & send a dynamic order tracking button (track.ccapl.cc)"
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium cursor-pointer transition ${
                          showTrackPopover
                            ? "bg-[#00a884] text-white border-[#00a884]"
                            : "bg-white hover:bg-[#e7fce3] border-[#d1d7db] text-[#111b21]"
                        }`}
                      >
                        <Truck className="w-3.5 h-3.5 text-[#00a884]" />
                        <span>Track Order</span>
                      </button>

                      {detail.customLinks.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowTrackPopover(false);
                            setShowAttachmentPicker(false);
                            setShowShortLinksPicker((prev) => !prev);
                          }}
                          title="Search & insert verified product short links (ccapl.cc)"
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium cursor-pointer transition ${
                            showShortLinksPicker
                              ? "bg-[#00a884] text-white border-[#00a884]"
                              : "bg-white hover:bg-[#e7fce3] border-[#d1d7db] text-[#111b21]"
                          }`}
                        >
                          <Link2 className="w-3.5 h-3.5 text-[#00a884]" />
                          <span>Product Links ({detail.customLinks.length})</span>
                        </button>
                      )}
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setComposerMode("NOTE");
                      setTimeout(() => {
                        setReplyText((prev) =>
                          prev.includes("@ACRIO") ? prev : `@ACRIO ${prev}`
                        );
                        composerInputRef.current?.focus();
                      }, 20);
                    }}
                    title="Ask ACRIO a private question in an internal note"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-900 text-xs font-semibold cursor-pointer transition"
                  >
                    <Sparkles className="w-3 h-3 text-violet-700" />
                    <span>Ask @ACRIO</span>
                  </button>

                  {composerMode === "REPLY" && (
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setReplyText((prev) => (prev.startsWith("/") ? prev : "/"));
                          composerInputRef.current?.focus();
                        }}
                        title="Open quick canned replies (/)"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#d1d7db] bg-white hover:bg-neutral-50 text-[#54656f] hover:text-[#111b21] text-xs font-medium cursor-pointer"
                      >
                        <Zap className="w-3 h-3 text-[#00a884]" />
                        <span className="hidden sm:inline">Quick Reply (/)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowQuickRepliesModal(true)}
                        title="Create or edit your personal /slash quick replies"
                        className="p-1.5 rounded-md border border-[#d1d7db] bg-white hover:bg-neutral-50 text-[#54656f] hover:text-[#111b21] cursor-pointer"
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {replyingTo && (
                <div
                  className={`flex items-start justify-between gap-2.5 rounded-lg bg-white px-3 py-2 border border-[#d1d7db] border-l-4 shadow-2xs ${
                    replyingTo.senderType === "ACRIO" ||
                    replyingTo.senderName === "ACRIO"
                      ? "border-l-indigo-600"
                      : replyingTo.direction === "OUTBOUND"
                      ? "border-l-[#00a884]"
                      : "border-l-[#e31837]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => jumpToQuotedMessage(replyingTo)}
                    className="min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 text-[11.5px] font-semibold">
                      <CornerUpLeft
                        className={`w-3.5 h-3.5 shrink-0 ${
                          replyingTo.senderType === "ACRIO" ||
                          replyingTo.senderName === "ACRIO"
                            ? "text-indigo-700"
                            : replyingTo.direction === "OUTBOUND"
                            ? "text-[#008069]"
                            : "text-[#e31837]"
                        }`}
                      />
                      <span
                        className={`truncate ${
                          replyingTo.senderType === "ACRIO" ||
                          replyingTo.senderName === "ACRIO"
                            ? "text-indigo-800"
                            : replyingTo.direction === "OUTBOUND"
                            ? "text-[#008069]"
                            : "text-[#e31837]"
                        }`}
                      >
                        Replying to {replyingTo.senderName}
                      </span>
                      <span className="text-[10.5px] font-normal text-[#667781] hidden sm:inline">
                        •{" "}
                        {composerMode === "NOTE"
                          ? "Attached to private team note"
                          : "Customer sees quoted message on WhatsApp"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-[#54656f] line-clamp-2 leading-snug">
                      {stripWhatsAppFormatting(replyingTo.body)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    aria-label="Cancel quoted reply"
                    title="Cancel quoted reply (Esc)"
                    className="p-1 rounded-md text-[#667781] hover:text-[#111b21] hover:bg-neutral-100 cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {stagedAttachment &&
                (composerMode === "REPLY" || composerMode === "NOTE") && (
                  <StagedAttachmentBar
                    attachment={stagedAttachment}
                    onClear={() => setStagedAttachment(null)}
                  />
                )}

              {matchingQuickReplies.length > 0 && (
                <div className="rounded-lg bg-white border border-[#d1d7db] shadow-md p-1.5 space-y-1 max-h-48 overflow-y-auto">
                  <div className="px-2 py-0.5 text-[10.5px] font-semibold text-[#54656f] flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1">
                      <Zap className="w-3 h-3 text-[#00a884]" />
                      <span>Quick Replies (click to insert)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowQuickRepliesModal(true)}
                      className="text-[10.5px] font-semibold text-[#008069] hover:underline cursor-pointer"
                    >
                      + Manage Mine
                    </button>
                  </div>
                  {matchingQuickReplies.map((qr) => (
                    <button
                      key={`${qr.id || qr.cmd}`}
                      type="button"
                      onClick={() => {
                        setReplyText(qr.body);
                        composerInputRef.current?.focus();
                        if (qr.id) {
                          void fetch("/api/quick-replies", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              action: "increment_usage",
                              id: qr.id,
                            }),
                          }).catch(() => {});
                        }
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[#f0f2f5] flex items-start justify-between gap-3 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#111b21] flex items-center gap-1.5">
                          <span className="font-mono text-[#008069]">
                            {qr.cmd}
                          </span>
                          <span>{qr.title}</span>
                          {qr.isCustom && qr.staffName && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 font-medium">
                              {qr.staffName}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#54656f] truncate">
                          {qr.body}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {composerMode === "TEMPLATE" ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white border border-[#d1d7db] px-3.5 py-3">
                  <p className="text-xs text-[#54656f] flex-1 min-w-[220px]">
                    Templates are sent exactly as Meta approved them, so the text cannot be edited here. Choose one, check
                    the values we fill in for {activeConv?.customerName || "the customer"}, and review it before sending.
                  </p>
                  <button
                    type="button"
                    onClick={() => setTemplateDialogOpen(true)}
                    className="h-10 px-4 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Choose template</span>
                  </button>
                </div>
              ) : (
              <div className="flex items-end gap-2">
                <MentionTextarea
                  textareaRef={composerInputRef}
                  rows={2}
                  enabled
                  onPickMention={(nextText) => {
                    if (composerMode !== "NOTE") {
                      moveDraftToNote(nextText);
                      showToast("Switched to Note mode, so the customer will not see this.");
                    }
                  }}
                  people={staffList.map((s) => ({ id: s.id, name: s.name, role: s.role }))}
                  value={replyText}
                  onChange={(v) => setReplyText(v)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && replyingTo) {
                      e.preventDefault();
                      setReplyingTo(null);
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleComposerSubmit(e);
                    }
                  }}
                  placeholder={
                    composerMode === "NOTE"
                      ? "Private note. Type @ to ping a teammate or ask @ACRIO a question..."
                      : "Type a WhatsApp reply (Enter to send, Shift+Enter for new line)..."
                  }
                  className={`w-full rounded-lg px-3.5 py-2 text-sm text-[#111b21] resize-none focus:outline-none border ${
                    composerMode === "NOTE"
                      ? "bg-white border-amber-300 focus:border-amber-500"
                      : "bg-white border-[#d1d7db] focus:border-[#00a884]"
                  }`}
                />
                <button
                  type="submit"
                  disabled={
                    sending ||
                    (!replyText.trim() &&
                      !(
                        (composerMode === "REPLY" || composerMode === "NOTE") &&
                        stagedAttachment
                      ))
                  }
                  className={`h-10 px-4 rounded-lg text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0 ${
                    composerMode === "NOTE"
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-[#00a884] hover:bg-[#008f6f]"
                  }`}
                >
                  {composerMode === "NOTE" ? (
                    <>
                      <Lock className="w-3.5 h-3.5" />
                      <span>Save Note</span>
                    </>
                  ) : (
                    <>
                      <WhatsAppLogoIcon size={14} />
                      <span>Send</span>
                    </>
                  )}
                </button>
              </div>
              )}
            </form>
            )}

            <TemplateSendDialog
              open={templateDialogOpen && composerMode === "TEMPLATE"}
              onClose={() => setTemplateDialogOpen(false)}
              templates={templates}
              windowOpen={
                Boolean(activeConv?.windowExpiresAt) &&
                new Date(String(activeConv?.windowExpiresAt)).getTime() > nowMs
              }
              customer={{
                name:
                  detail?.customer?.name?.trim() ||
                  activeConv?.customerName ||
                  activeConv?.customerPhone ||
                  "",
                phone: activeConv?.customerPhone || "",
                companyName: detail?.customer?.companyName || null,
                city: detail?.customer?.city || null,
                latestOrderNumber: detail?.orders?.[0]?.orderNumber || null,
              }}
              onSend={sendTemplateMessage}
            />
            <MediaPreviewLightbox
              media={previewMedia}
              onClose={() => setPreviewMedia(null)}
            />
          </>
        )}
      </div>

      {/* ===================================================================== */}
      {/* 3. RIGHT DRAWER: CUSTOMER DETAILS, ORDERS, TEAM NOTES, WEB ENQUIRIES  */}
      {/* ===================================================================== */}
      <div
        className={`${
          mobilePane === "INFO" ? "flex w-full" : "hidden"
        } ${
          showRightDrawer ? "lg:flex" : "lg:hidden"
        } lg:w-[330px] xl:w-[360px] shrink-0 border-l border-[#d1d7db] bg-white flex-col`}
      >
        <div className="lg:hidden h-[50px] px-3.5 bg-[#f0f2f5] border-b border-[#d1d7db] flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={() => setMobilePane("CHAT")}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#111b21] cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Chat</span>
          </button>
          <span className="text-xs font-semibold text-[#54656f] truncate max-w-[180px]">
            {activeConv?.customerName || "Customer Details"}
          </span>
        </div>
        {/* Pinned Customer Context Card at Top of Right Drawer */}
        {activeConv && (
          <div className="px-3.5 py-2.5 bg-slate-50 border-b border-[#e9edef] space-y-2 text-xs shrink-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-slate-900 truncate">
                  {detail?.customer?.name || activeConv.customerName}
                </div>
                <div className="text-[11px] font-mono text-slate-500 flex items-center gap-1.5">
                  <span>{activeConv.customerPhone}</span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(activeConv.customerPhone);
                      showToast("Phone copied.");
                    }}
                    title="Copy number"
                    className="p-0.5 rounded hover:bg-slate-200 text-slate-500 cursor-pointer"
                  >
                    <Copy className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-[10.5px] font-semibold text-slate-700 shrink-0">
                {detail?.customer?.city || "No city"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1 text-[10.5px] text-slate-600">
              <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold">
                {detail?.customer?.acrioSegment || "WhatsApp Lead"}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-white border border-neutral-200 font-medium">
                {detail?.orders?.length
                  ? `${detail.orders.length} order${detail.orders.length > 1 ? "s" : ""} • ₹${(
                      detail?.customer?.lifetimeValueInr || 0
                    ).toLocaleString("en-IN")}`
                  : "0 orders"}
              </span>
              {detail?.customer?.preferredStaffName && (
                <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800 font-medium">
                  Prefers: {detail.customer.preferredStaffName}
                </span>
              )}
            </div>

            {/* Fast One-Click Actions */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <button
                type="button"
                disabled={summarizingChat}
                onClick={() => void handleGenerateSummary()}
                className="px-2 py-1 rounded bg-violet-50 hover:bg-violet-100 text-violet-900 border border-violet-200 text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" />
                <span>{summarizingChat ? "..." : "Summary"}</span>
              </button>
              <button
                type="button"
                onClick={() => setRightTab("ORDERS")}
                className="px-2 py-1 rounded bg-white hover:bg-slate-100 text-slate-800 border border-neutral-200 text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3 text-[#008069]" />
                <span>Order</span>
              </button>
              {isAssignedToCurrentUser && (
                <button
                  type="button"
                  onClick={() => {
                    setComposerMode("TEMPLATE");
                    setTemplateDialogOpen(true);
                  }}
                  className="px-2 py-1 rounded bg-white hover:bg-slate-100 text-slate-800 border border-neutral-200 text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <FileText className="w-3 h-3 text-[#008069]" />
                  <span>Template</span>
                </button>
              )}
              {detail?.acrio?.suggestedReplies?.[0] && isAssignedToCurrentUser && (
                <button
                  type="button"
                  onClick={() => {
                    setComposerMode("REPLY");
                    setReplyText(detail.acrio!.suggestedReplies[0]);
                    composerInputRef.current?.focus();
                  }}
                  title="Insert ACRIO's suggested reply into the composer"
                  className="px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>AI Draft</span>
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-5 border-b border-[#e9edef] text-[10.5px] font-semibold shrink-0 bg-[#f0f2f5]">
            {(
              [
                { key: "PROFILE", label: "Details" },
                { key: "ORDERS", label: `Orders (${detail?.orders.length || 0})` },
                { key: "NOTES", label: `Notes (${internalNotes.length})` },
                { key: "MEDIA", label: `Media (${sharedMediaItems.length})` },
                { key: "HISTORY", label: "Logs" },
              ] as const
            ).map((tb) => (
              <button
                key={tb.key}
                type="button"
                onClick={() => setRightTab(tb.key)}
                className={`py-2.5 text-center border-b-2 cursor-pointer transition-colors truncate px-1 ${
                  rightTab === tb.key
                    ? "border-[#00a884] text-[#008069] bg-white"
                    : "border-transparent text-[#54656f] hover:text-[#111b21]"
                }`}
              >
                {tb.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
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
              <div className="space-y-4">
                {/* Dual-Assignment Co-Handlers */}
                {activeConv && (
                  <div className="p-2.5 rounded-lg bg-violet-50/70 border border-violet-200 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-violet-950">
                      <span className="inline-flex items-center gap-1">
                        <UserPlus className="w-3.5 h-3.5 text-violet-700" />
                        <span>Shared Access (Co-handlers)</span>
                      </span>
                      <span className="text-[10px] font-normal text-violet-700">
                        Owner: {activeConv.assignedStaffName || "ACRIO"}
                      </span>
                    </div>
                    {activeCollaborators.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {activeCollaborators.map((c) => (
                          <span
                            key={c.staffId}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-violet-200 text-[11px] font-medium text-violet-900"
                          >
                            <span>{c.staffName}</span>
                            <button
                              type="button"
                              onClick={() => void handleRemoveCollaborator(c.staffId)}
                              title="Remove co-handler access"
                              className="text-violet-500 hover:text-red-600 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <select
                        value={collabToAdd}
                        onChange={(e) => setCollabToAdd(e.target.value)}
                        className="flex-1 rounded border border-violet-200 bg-white px-2 py-1 text-[11px]"
                      >
                        <option value="">Tag teammate for access...</option>
                        {staffList
                          .filter(
                            (s) =>
                              s.id !== activeConv.assignedStaffId &&
                              !activeCollaborators.some((c) => c.staffId === s.id)
                          )
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.role})
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        disabled={!collabToAdd}
                        onClick={() => void handleAddCollaborator(collabToAdd)}
                        className="px-2.5 py-1 rounded bg-violet-700 hover:bg-violet-800 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-40"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}

                <form onSubmit={handleSaveCustomerProfile} className="space-y-3">
                  <div className="grid grid-cols-1 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
                        Contact Name
                      </label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Customer full name"
                        className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
                        Email
                      </label>
                      <input
                        type="email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        placeholder="buyer@company.com"
                        className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
                        Company / Org
                      </label>
                      <input
                        type="text"
                        value={editCompany}
                        onChange={(e) => setEditCompany(e.target.value)}
                        placeholder="Taj Deccan / St. Ann's"
                        className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
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

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
                        Business Type
                      </label>
                      <select
                        value={editOrgType}
                        onChange={(e) => setEditOrgType(e.target.value)}
                        className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs bg-white"
                      >
                        <option value="Hotel/Hospitality">Hotel / Banquet</option>
                        <option value="School/College">School / College</option>
                        <option value="Corporate">Corporate Office</option>
                        <option value="Signage Fabricator">Fabricator / CNC</option>
                        <option value="Retail/Showroom">Retail / Showroom</option>
                        <option value="Event Agency">Event Agency</option>
                        <option value="Business">Other Business</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
                        GST Number
                      </label>
                      <input
                        type="text"
                        value={editGstNumber}
                        onChange={(e) => setEditGstNumber(e.target.value.toUpperCase())}
                        placeholder="36AAACC1234F1Z5"
                        className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-mono uppercase"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
                        Lead Stage
                      </label>
                      <select
                        value={editSegment}
                        onChange={(e) => setEditSegment(e.target.value)}
                        className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs bg-white"
                      >
                        <option value="New WhatsApp Lead">New Lead</option>
                        <option value="Quoted / Interested">Quoted / Interested</option>
                        <option value="Hot Prospect">Hot Prospect</option>
                        <option value="Repeat Buyer">Repeat Buyer</option>
                        <option value="Distributor / Dealer">Distributor / Dealer</option>
                        <option value="Institutional Buyer">Institutional Buyer</option>
                        <option value="Won / Customer">Won / Customer</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
                        Preferred Staff
                      </label>
                      <select
                        value={editPreferredStaffId}
                        onChange={(e) => setEditPreferredStaffId(e.target.value)}
                        className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs bg-white"
                      >
                        <option value="">No preference</option>
                        {staffList.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Quick Tags */}
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-medium text-neutral-700">
                      Customer Tags
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {[
                        "VIP",
                        "Bulk Buyer",
                        "Podiums",
                        "Machines",
                        "Custom Acrylic",
                        "GST Invoice",
                        "Follow Up",
                      ].map((preset) => {
                        const on = editTags.includes(preset);
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() =>
                              setEditTags((prev) =>
                                prev.includes(preset)
                                  ? prev.filter((x) => x !== preset)
                                  : [...prev, preset]
                              )
                            }
                            className={`px-2 py-0.5 rounded-full text-[10.5px] font-medium border cursor-pointer ${
                              on
                                ? "bg-[#e7fce3] border-[#00a884] text-[#008069]"
                                : "bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                            }`}
                          >
                            {preset}
                          </button>
                        );
                      })}
                      {editTags
                        .filter(
                          (t) =>
                            ![
                              "VIP",
                              "Bulk Buyer",
                              "Podiums",
                              "Machines",
                              "Custom Acrylic",
                              "GST Invoice",
                              "Follow Up",
                            ].includes(t)
                        )
                        .map((custom) => (
                          <span
                            key={custom}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-300 text-[10.5px] text-slate-800"
                          >
                            <span>{custom}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setEditTags((p) => p.filter((x) => x !== custom))
                              }
                              className="cursor-pointer hover:text-red-600"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={newTagInput}
                        onChange={(e) => setNewTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const t = newTagInput.trim();
                            if (t && !editTags.includes(t)) {
                              setEditTags((p) => [...p, t]);
                            }
                            setNewTagInput("");
                          }
                        }}
                        placeholder="Add custom tag + Enter"
                        className="flex-1 rounded border border-neutral-300 px-2 py-1 text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const t = newTagInput.trim();
                          if (t && !editTags.includes(t)) {
                            setEditTags((p) => [...p, t]);
                          }
                          setNewTagInput("");
                        }}
                        className="px-2 py-1 rounded border border-neutral-300 bg-neutral-50 text-[11px] font-medium cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
                      Permanent Customer Notes
                    </label>
                    <textarea
                      rows={3}
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Preferred thickness, delivery site, machine models owned..."
                      className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold cursor-pointer"
                  >
                    Save Customer Details
                  </button>
                </form>
              </div>
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
                    {detail.orders.map((o) => {
                      const linkedTrack = (detail.orderTrackings || []).find(
                        (t) =>
                          t.orderId.toUpperCase() ===
                          o.orderNumber.toUpperCase()
                      );
                      return (
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
                              {linkedTrack?.shipmentStatus ||
                                o.fulfillmentStatus}
                            </span>
                          </div>
                          {linkedTrack && (
                            <div className="text-[10.5px] font-mono text-[#008069] truncate">
                              {linkedTrack.providerName}
                              {linkedTrack.awbNumber
                                ? ` • AWB ${linkedTrack.awbNumber}`
                                : ""}
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-neutral-100">
                            <a
                              href={`${TRACKING_PUBLIC_ORIGIN}/${encodeURIComponent(o.orderNumber)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] font-mono text-neutral-600 hover:text-[#008069] truncate"
                            >
                              track.ccapl.cc/{o.orderNumber}
                            </a>
                            <button
                              type="button"
                              onClick={() =>
                                openTrackPopoverForOrder({
                                  orderId: o.orderNumber,
                                  itemsSummary: o.itemsSummary,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#e7fce3] hover:bg-[#d9fdd3] text-[#008069] text-[11px] font-semibold cursor-pointer shrink-0"
                            >
                              <Truck className="w-3 h-3" />
                              <span>Track Button</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : rightTab === "NOTES" ? (
              <div className="space-y-3.5">
                <div className="p-2.5 rounded-lg bg-violet-50 border border-violet-200 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-violet-950 font-medium">
                    Need a recap? Let ACRIO post a private summary note.
                  </div>
                  <button
                    type="button"
                    disabled={summarizingChat}
                    onClick={() => void handleGenerateSummary()}
                    className="shrink-0 px-2.5 py-1 rounded bg-violet-700 hover:bg-violet-800 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>{summarizingChat ? "Working..." : "Generate Summary"}</span>
                  </button>
                </div>

                <form
                  onSubmit={handleQuickNoteSave}
                  className="p-3 rounded-lg bg-[#fef9e7] border border-amber-200 space-y-2"
                >
                  <div className="text-xs font-semibold text-amber-950 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-700" />
                    <span>Add Internal Team Note</span>
                  </div>
                  <MentionTextarea
                    rows={2}
                    people={staffList.map((s) => ({ id: s.id, name: s.name, role: s.role }))}
                    value={quickNoteDraft}
                    onChange={(v) => setQuickNoteDraft(v)}
                    placeholder="Private note. Type @ to ping a teammate or ask @ACRIO a question..."
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
                            {formatDateShortIst(n.createdAt)}
                          </span>
                        </div>
                        <WhatsAppFormattedText
                          text={emphasizeMentions(n.body, staffList)}
                          className="text-xs text-amber-950"
                          onPhoneClick={handleOpenNewChatWithPhone}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : rightTab === "MEDIA" ? (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-neutral-800">
                  Shared Files & Media ({sharedMediaItems.length})
                </h4>
                {sharedMediaItems.length === 0 ? (
                  <p className="text-xs text-neutral-500 py-4 text-center">
                    No images, PDFs, videos, or audio files shared in this chat yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {[...sharedMediaItems].reverse().map(({ msg, media }) => (
                      <div
                        key={`med_${msg.id}`}
                        className="p-2.5 rounded-lg border border-neutral-200 bg-neutral-50 flex items-center justify-between gap-2.5"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-8 h-8 rounded bg-white border border-neutral-200 flex items-center justify-center shrink-0 text-[#008069]">
                            {media.mediaType === "IMAGE" ? (
                              <ImageIcon className="w-4 h-4" />
                            ) : media.mediaType === "VIDEO" ? (
                              <Video className="w-4 h-4" />
                            ) : media.mediaType === "AUDIO" ? (
                              <FileAudio className="w-4 h-4" />
                            ) : (
                              <FileText className="w-4 h-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-neutral-900 truncate">
                              {media.fileName || media.mediaType}
                            </div>
                            <div className="text-[10.5px] text-neutral-500">
                              {msg.senderName} • {formatDateShortIst(msg.createdAt)}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPreviewMedia(media)}
                          className="px-2.5 py-1 rounded bg-white border border-neutral-300 hover:bg-neutral-100 text-[11px] font-semibold text-neutral-800 cursor-pointer shrink-0"
                        >
                          Open
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-neutral-800">
                      Assignment & First-Response Log
                    </h4>
                    <Link
                      href="/dashboard/analytics"
                      className="text-[11px] font-medium text-[#008069] hover:underline"
                    >
                      Full Analytics
                    </Link>
                  </div>
                  {assignments.length === 0 ? (
                    <p className="text-xs text-neutral-500">
                      No assignments logged yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {assignments.map((asg) => {
                        const isSys = asg.toStaffId === "ACRIO";
                        const pendingWait =
                          !asg.firstResponseAt &&
                          asg.outcome === "ACTIVE" &&
                          !isSys &&
                          activeConv?.status !== "RESOLVED"
                            ? formatWaitingDuration(asg.assignedAt, nowMs)
                            : null;
                        return (
                          <div
                            key={asg.id}
                            className="p-2.5 rounded-lg bg-neutral-50 border border-neutral-200 space-y-1.5 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-neutral-900 truncate">
                                {isSys
                                  ? "System (ACRIO)"
                                  : `${asg.toStaffName} (${asg.escalationLevel})`}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  asg.firstResponseAt
                                    ? "bg-emerald-100 text-emerald-800"
                                    : asg.outcome === "ESCALATED"
                                    ? "bg-red-100 text-red-800"
                                    : asg.outcome === "ACTIVE"
                                    ? "bg-amber-100 text-amber-900"
                                    : "bg-neutral-200 text-neutral-700"
                                }`}
                              >
                                {asg.firstResponseAt
                                  ? `Replied in ${formatResponseSpeed(
                                      asg.firstResponseSeconds
                                    )}`
                                  : asg.outcome}
                              </span>
                            </div>
                            <div className="text-[11px] text-neutral-600 space-y-0.5">
                              <div>
                                <span className="text-neutral-500">Team:</span>{" "}
                                {asg.toTeamName} • by {asg.assignedByName}
                              </div>
                              <div>
                                <span className="text-neutral-500">Assigned:</span>{" "}
                                <strong>{formatDateTimeShort(asg.assignedAt)}</strong>
                              </div>
                              <div>
                                <span className="text-neutral-500">
                                  First response:
                                </span>{" "}
                                {asg.firstResponseAt ? (
                                  <strong className="text-emerald-800">
                                    {formatDateTimeShort(asg.firstResponseAt)} (
                                    {formatResponseSpeed(asg.firstResponseSeconds)})
                                  </strong>
                                ) : pendingWait ? (
                                  <strong suppressHydrationWarning className="text-amber-800">
                                    Waiting {pendingWait.text}
                                  </strong>
                                ) : (
                                  <span>None before {asg.outcome.toLowerCase()}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

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
                              {formatDateIst(r.occurredAt)}
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
                              {formatDateIst(eq.createdAt)}
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
              Sales Team is our default handoff team (ACRIO stays off on staff-assigned chats so your teammate handles the customer directly). Choose <strong>System (ACRIO)</strong> under Assignee only if you want ACRIO to answer incoming customer messages automatically.
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
                  {staffList
                    .filter(
                      (st) =>
                        st.role !== "DEV" ||
                        canAssignToDev(initialData.currentUserRole)
                    )
                    .map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                        {st.role === "DEV" ? " (Dev)" : ""}
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
      {/* MODAL 3: START NEW CHAT WITH TEMPLATE / FREE CHAT / SIMULATE INBOUND  */}
      {/* ===================================================================== */}
      <NewChatTemplateModal
        open={showNewChatModal}
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
          setSelectedId(convId);
          selectedIdRef.current = convId;
          setMobilePane("CHAT");
          await Promise.all([
            refreshThreadsSilently(),
            fetchAndCacheDetail(convId, true),
          ]);
          showToast(msg);
        }}
      />

      {/* ===================================================================== */}
      {/* MODAL 4: PERSONAL & SHARED QUICK REPLIES MANAGER                      */}
      {/* ===================================================================== */}
      <QuickRepliesModal
        open={showQuickRepliesModal}
        onClose={() => setShowQuickRepliesModal(false)}
        customReplies={customQuickReplies}
        builtInReplies={CANNED_QUICK_REPLIES}
        onSaved={(next) => {
          setCustomQuickReplies(next);
          showToast("Quick replies updated.");
        }}
      />
    </div>
  );
}
