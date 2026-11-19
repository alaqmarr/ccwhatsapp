"use client";

import { useMemo, useRef, useState } from "react";
import { buildClientProviderTrackingUrl } from "@cc/ui";
import type {
  ChatMessage,
  ConversationDetailBundle,
  QuickReplyItem,
  QuotedMessageRef,
} from "@/lib/inbox-server-data";
import { useInboxStore, type InboxComposerMode } from "@/lib/inbox-store";
import { CANNED_QUICK_REPLIES } from "./inbox-helpers";
import type { VerifiedLocationInfo } from "./ComposerPopovers";

export function useInboxComposerHelpers({
  detail,
  messages,
  selectedId,
  composerMode,
  setComposerMode,
  replyText,
  setReplyText,
  setReplyingTo,
  setHighlightedMsgId,
  moveReplyDraftToNote,
  composerInputRef,
  timelineScrollRef,
  customQuickReplies,
  showToast,
}: {
  detail: ConversationDetailBundle | null;
  messages: ChatMessage[];
  selectedId: string | null;
  composerMode: InboxComposerMode;
  setComposerMode: (m: InboxComposerMode) => void;
  replyText: string;
  setReplyText: (next: string | ((prev: string) => string)) => void;
  setReplyingTo: (ref: QuotedMessageRef | null) => void;
  setHighlightedMsgId: (id: string | null) => void;
  moveReplyDraftToNote: (convId: string, text: string) => void;
  composerInputRef: React.RefObject<HTMLTextAreaElement | null>;
  timelineScrollRef: React.MutableRefObject<((msgId: string) => void) | null>;
  customQuickReplies: QuickReplyItem[];
  showToast: (msg: string) => void;
}) {
  const [showShortLinksPicker, setShowShortLinksPicker] = useState(false);
  const [showTrackPopover, setShowTrackPopover] = useState(false);
  const [trackOrderId, setTrackOrderId] = useState("");
  const [trackBrand, setTrackBrand] = useState<
    "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53"
  >("CLASSIC_CONCEPTS");
  const [trackProviderKey, setTrackProviderKey] = useState("DELHIVERY");
  const [trackAwbNumber, setTrackAwbNumber] = useState("");
  const [trackProviderUrl, setTrackProviderUrl] = useState("");
  const [trackButtonLabel, setTrackButtonLabel] = useState("Track Order");
  const [trackMessageText, setTrackMessageText] = useState("");

  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
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
    if (composerMode === "NOTE") setComposerMode("REPLY");
    requestAnimationFrame(() => composerInputRef.current?.focus());
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
      (t) => t.orderId.toUpperCase() === chosenOrderId.trim().toUpperCase()
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
        businessHours:
          "Monday - Saturday: 10:00 AM to 7:00 PM (Sunday: Closed)",
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

  function moveDraftToNote(text: string) {
    if (!selectedId) return;
    moveReplyDraftToNote(selectedId, text);
  }

  function handleMoveNoteToReplyBox(
    textValue: string,
    quoted?: QuotedMessageRef | null
  ) {
    setComposerMode("REPLY");
    setReplyText(textValue);
    if (quoted) setReplyingTo(quoted);
    setTimeout(() => composerInputRef.current?.focus(), 30);
    showToast("Loaded into WhatsApp Reply box. Review and press Send.");
  }

  function appendToComposer(snippet: string) {
    if (composerMode === "NOTE") setComposerMode("REPLY");
    setReplyText((prev) => (prev ? `${prev.trim()} ${snippet}` : snippet));
  }

  const allQuickReplies = useMemo(() => {
    const merged: {
      id?: string;
      cmd: string;
      title: string;
      body: string;
      isCustom?: boolean;
      staffName?: string;
    }[] = [];
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

  return {
    showShortLinksPicker,
    setShowShortLinksPicker,
    showTrackPopover,
    setShowTrackPopover,
    trackOrderId,
    setTrackOrderId,
    trackBrand,
    setTrackBrand,
    trackProviderKey,
    setTrackProviderKey,
    trackAwbNumber,
    setTrackAwbNumber,
    trackProviderUrl,
    setTrackProviderUrl,
    trackButtonLabel,
    setTrackButtonLabel,
    trackMessageText,
    setTrackMessageText,
    startReplyToMessage,
    jumpToQuotedMessage,
    openTrackPopoverForOrder,
    resolveActiveVerifiedLocation,
    buildVerifiedLocationMessageText,
    moveDraftToNote,
    handleMoveNoteToReplyBox,
    appendToComposer,
    matchingQuickReplies,
  };
}
