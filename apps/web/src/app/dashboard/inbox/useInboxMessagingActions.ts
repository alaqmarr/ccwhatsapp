"use client";

import { useRef, useState } from "react";
import {
  describeAttachmentType,
  type PreSendFileConfirmationTarget,
  type StagedComposerAttachment,
} from "@/components/MediaAttachmentTools";
import type {
  ChatMessage,
  ConversationDetailBundle,
  QuotedMessageRef,
  StaffOption,
} from "@/lib/inbox-server-data";
import type { InboxComposerMode } from "@/lib/inbox-store";
import type { VerifiedLocationInfo } from "./ComposerPopovers";
import type { MessagePolishModalState } from "./MessagePolishModal";
import {
  describeNoteResult,
  shouldRouteTextAsInternalNote,
} from "./inbox-helpers";
import { useInboxMediaAndTemplateActions } from "./useInboxMediaAndTemplateActions";

export interface UseInboxMessagingActionsParams {
  selectedId: string | null;
  detail: ConversationDetailBundle | null;
  currentUserName: string;
  staffList: StaffOption[];
  composerMode: InboxComposerMode;
  setComposerMode: (mode: InboxComposerMode) => void;
  replyText: string;
  replyingTo: QuotedMessageRef | null;
  setReplyingTo: (ref: QuotedMessageRef | null) => void;
  stagedAttachment: StagedComposerAttachment | null;
  setStagedAttachment: (att: StagedComposerAttachment | null) => void;
  setDraft: (
    convId: string | null,
    mode: InboxComposerMode,
    next: string | ((prev: string) => string)
  ) => void;
  setPendingSendConfirm: (target: PreSendFileConfirmationTarget | null) => void;
  setShowAttachmentPicker: (open: boolean) => void;
  setTemplateDialogOpen: (open: boolean) => void;
  setShowTrackPopover: (open: boolean) => void;
  setShowLocationPopover: (open: boolean) => void;
  trackOrderId: string;
  trackBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  trackProviderKey: string;
  trackAwbNumber: string;
  trackProviderUrl: string;
  trackButtonLabel: string;
  trackMessageText: string;
  resolveActiveVerifiedLocation: () => VerifiedLocationInfo;
  buildVerifiedLocationMessageText: () => string;
  optimisticSeqRef: React.MutableRefObject<number>;
  appendOptimisticMessage: (
    convId: string,
    msg: ChatMessage,
    threadPreviewText?: string
  ) => void;
  patchOptimisticMessage: (
    convId: string,
    tempId: string,
    patch: {
      id?: string;
      deliveryStatus?: string;
      waMessageId?: string | null;
      metadata?: Record<string, unknown> | null;
      body?: string;
    }
  ) => void;
  fetchAndCacheDetail: (
    convId: string,
    updateProfileInputs?: boolean
  ) => Promise<void>;
  refreshThreadsSilently: (manual?: boolean) => Promise<void>;
  scheduleThreadsRefresh: (delayMs?: number) => void;
  showToast: (msg: string) => void;
  moveDraftToNote: (text: string) => void;
}

export function useInboxMessagingActions(p: UseInboxMessagingActionsParams) {
  const [acrioActionBusyId, setAcrioActionBusyId] = useState<string | null>(
    null
  );
  const [pendingPolish, setPendingPolish] =
    useState<MessagePolishModalState | null>(null);
  const polishAbortRef = useRef<AbortController | null>(null);

  const mediaAndTemplate = useInboxMediaAndTemplateActions({
    selectedId: p.selectedId,
    detail: p.detail,
    currentUserName: p.currentUserName,
    setComposerMode: p.setComposerMode,
    replyingTo: p.replyingTo,
    setReplyingTo: p.setReplyingTo,
    setShowTrackPopover: p.setShowTrackPopover,
    setShowLocationPopover: p.setShowLocationPopover,
    trackOrderId: p.trackOrderId,
    trackBrand: p.trackBrand,
    trackProviderKey: p.trackProviderKey,
    trackAwbNumber: p.trackAwbNumber,
    trackProviderUrl: p.trackProviderUrl,
    trackButtonLabel: p.trackButtonLabel,
    trackMessageText: p.trackMessageText,
    resolveActiveVerifiedLocation: p.resolveActiveVerifiedLocation,
    buildVerifiedLocationMessageText: p.buildVerifiedLocationMessageText,
    optimisticSeqRef: p.optimisticSeqRef,
    appendOptimisticMessage: p.appendOptimisticMessage,
    patchOptimisticMessage: p.patchOptimisticMessage,
    scheduleThreadsRefresh: p.scheduleThreadsRefresh,
    showToast: p.showToast,
  });

  const activeConv = p.detail?.conversation || null;

  async function executeComposerSend(opts?: {
    overrideAttachment?: StagedComposerAttachment | null;
    overrideCaption?: string;
    modeOverride?: "REPLY" | "NOTE";
  }) {
    const rawCaptionText = (
      opts?.overrideCaption !== undefined ? opts.overrideCaption : p.replyText
    ).trim();
    const isAtNote =
      p.composerMode === "NOTE" ||
      shouldRouteTextAsInternalNote(rawCaptionText, p.staffList);
    const effectiveMode =
      opts?.modeOverride || (isAtNote ? "NOTE" : "REPLY");
    const activeAtt =
      opts?.overrideAttachment !== undefined
        ? opts.overrideAttachment
        : p.stagedAttachment;
    if (!p.selectedId || (!rawCaptionText && !activeAtt) || !p.detail) return;

    const textToSend =
      rawCaptionText ||
      (activeAtt
        ? activeAtt.productName
          ? `*${activeAtt.productName}*${
              activeAtt.variantName ? ` (${activeAtt.variantName})` : ""
            }`
          : `[${activeAtt.mediaType}] ${activeAtt.fileName}`
        : "");
    const currentConvId = p.selectedId;
    const activeReplyRef = p.replyingTo;
    const windowOpenNow = Boolean(
      activeConv?.windowExpiresAt &&
        new Date(String(activeConv.windowExpiresAt)).getTime() > Date.now()
    );

    p.setDraft(currentConvId, effectiveMode, "");
    p.setDraft(currentConvId, p.composerMode, "");
    if (effectiveMode === "NOTE") {
      p.setComposerMode(windowOpenNow ? "REPLY" : "TEMPLATE");
    }
    p.setReplyingTo(null);
    p.setStagedAttachment(null);
    p.setShowAttachmentPicker(false);
    p.setPendingSendConfirm(null);

    const tempId = `optimistic_${Date.now()}_${++p.optimisticSeqRef.current}`;
    const nowIso = new Date().toISOString();
    const optimisticMetadata: Record<string, unknown> | null =
      activeReplyRef || activeAtt
        ? {
            ...(activeReplyRef ? { replyTo: activeReplyRef } : {}),
            ...(activeAtt
              ? {
                  media: {
                    mediaId: activeAtt.mediaId,
                    waMediaId: activeAtt.waMediaId,
                    mediaType: activeAtt.mediaType,
                    url: activeAtt.url,
                    fileName: activeAtt.fileName,
                    mimeType: activeAtt.mimeType,
                    sizeBytes: activeAtt.sizeBytes,
                    productName: activeAtt.productName,
                    variantName: activeAtt.variantName,
                  },
                }
              : {}),
          }
        : null;
    const optimisticMsg: ChatMessage =
      effectiveMode === "NOTE"
        ? {
            id: tempId,
            direction: "INTERNAL",
            senderType: "STAFF_NOTE",
            senderName: p.currentUserName,
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
            senderName: p.currentUserName,
            messageType: activeAtt ? activeAtt.mediaType : "TEXT",
            billingCategory: "FREE_CHAT",
            body: textToSend,
            templateName: null,
            deliveryStatus: "SENDING",
            createdAt: nowIso,
            metadata: optimisticMetadata,
          };

    p.appendOptimisticMessage(currentConvId, optimisticMsg, textToSend);

    try {
      if (effectiveMode === "NOTE") {
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
        if (noteData.noteId) {
          p.patchOptimisticMessage(currentConvId, tempId, {
            id: String(noteData.noteId),
            deliveryStatus: "SAVED",
          });
        }
        p.showToast(describeNoteResult(noteData));
        if (noteData.askedAcrio || noteData.accidentalReplyDetected) {
          void p.fetchAndCacheDetail(currentConvId, false);
        }
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
          p.patchOptimisticMessage(currentConvId, tempId, {
            id: data.messageId || tempId,
            deliveryStatus: "FAILED",
          });
          p.showToast(data.error || "Message failed to send.");
          return;
        }
        p.patchOptimisticMessage(currentConvId, tempId, {
          id: String(data.messageId || tempId),
          deliveryStatus: String(data.deliveryStatus || "SENT"),
          waMessageId: data.waMessageId ? String(data.waMessageId) : null,
        });
        p.scheduleThreadsRefresh(150);
      }
    } catch {
      if (effectiveMode !== "NOTE") {
        p.patchOptimisticMessage(currentConvId, tempId, {
          deliveryStatus: "FAILED",
        });
        p.showToast("Network error. Message marked Failed.");
      }
    }
  }

  async function handleComposerSubmit(e: React.FormEvent) {
    e.preventDefault();
    const isAtNote =
      p.composerMode === "NOTE" ||
      shouldRouteTextAsInternalNote(p.replyText, p.staffList);
    const hasStagedAtt =
      (p.composerMode === "REPLY" || isAtNote) && Boolean(p.stagedAttachment);
    if (!p.selectedId || (!p.replyText.trim() && !hasStagedAtt) || !p.detail) {
      return;
    }

    // Whenever @ is used, save automatically as an internal note and switch right back cleanly
    if (isAtNote) {
      await executeComposerSend({ modeOverride: "NOTE" });
      return;
    }

    if (p.composerMode === "TEMPLATE") {
      p.setTemplateDialogOpen(true);
      return;
    }

    const windowOpen = Boolean(
      activeConv?.windowExpiresAt &&
        new Date(String(activeConv.windowExpiresAt)).getTime() > Date.now()
    );
    if (!windowOpen) {
      p.setComposerMode("TEMPLATE");
      p.setTemplateDialogOpen(true);
      p.showToast(
        "24-hour window is closed. Choose a template, or type @ for a private note."
      );
      return;
    }

    if (
      p.composerMode === "REPLY" &&
      p.stagedAttachment &&
      p.stagedAttachment.mediaType === "DOCUMENT"
    ) {
      p.setPendingSendConfirm({
        mode: "SEND",
        staged: p.stagedAttachment,
        fileName: p.stagedAttachment.fileName,
        fileTypeLabel: describeAttachmentType(
          p.stagedAttachment.fileName,
          p.stagedAttachment.mimeType || "application/pdf",
          p.stagedAttachment.mediaType
        ),
        mimeType: p.stagedAttachment.mimeType || "application/pdf",
        sizeBytes: p.stagedAttachment.sizeBytes ?? null,
        mediaType: p.stagedAttachment.mediaType,
        previewUrl: p.stagedAttachment.url,
        recipientName:
          p.detail.customer?.name ||
          activeConv?.customerName ||
          activeConv?.customerPhone ||
          "Customer",
        recipientPhone: activeConv?.customerPhone || "",
        captionPreview: p.replyText.trim() || undefined,
      });
      return;
    }

    const trimmedDraft = p.replyText.trim();
    const isUrlOnly = /^https?:\/\/\S+$/i.test(trimmedDraft);
    if (trimmedDraft.length > 0 && !isUrlOnly) {
      const convId = p.selectedId;
      const recipientName =
        p.detail.customer?.name ||
        activeConv?.customerName ||
        activeConv?.customerPhone ||
        "Customer";

      polishAbortRef.current?.abort();
      const ctrl = new AbortController();
      polishAbortRef.current = ctrl;

      setPendingPolish({
        convId,
        recipientName,
        originalText: trimmedDraft,
        enhancedText: trimmedDraft,
        loading: true,
        changed: false,
      });

      try {
        const res = await fetch(`/api/conversations/${convId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "polish_message",
            text: trimmedDraft,
          }),
          signal: ctrl.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!ctrl.signal.aborted) {
          const nextEnhanced =
            typeof data?.enhancedText === "string" && data.enhancedText.trim()
              ? data.enhancedText.trim()
              : trimmedDraft;
          setPendingPolish((prev) =>
            prev && prev.convId === convId && prev.originalText === trimmedDraft
              ? {
                  ...prev,
                  enhancedText: nextEnhanced,
                  changed: Boolean(data?.changed ?? nextEnhanced !== trimmedDraft),
                  loading: false,
                }
              : prev
          );
        }
      } catch {
        if (!ctrl.signal.aborted) {
          setPendingPolish((prev) =>
            prev && prev.convId === convId && prev.originalText === trimmedDraft
              ? { ...prev, enhancedText: trimmedDraft, changed: false, loading: false }
              : prev
          );
        }
      }
      return;
    }

    await executeComposerSend();
  }

  function handleCancelPolish() {
    polishAbortRef.current?.abort();
    polishAbortRef.current = null;
    setPendingPolish(null);
  }

  async function handleSendPolishedChoice(chosenText: string) {
    const cleanChoice = chosenText.trim();
    polishAbortRef.current?.abort();
    polishAbortRef.current = null;
    setPendingPolish(null);
    if (!cleanChoice) return;
    await executeComposerSend({
      overrideCaption: cleanChoice,
      modeOverride: "REPLY",
    });
  }

  async function handleSimulateCustomerRead() {
    if (!p.selectedId) return;
    await fetch(`/api/conversations/${p.selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "simulate_customer_read" }),
    });
    p.showToast("Marked outbound messages as Read by customer.");
    await Promise.all([
      p.fetchAndCacheDetail(p.selectedId, false),
      p.refreshThreadsSilently(),
    ]);
  }

  async function handleConfirmAcrioAction(
    noteMessageId: string,
    decision: "CONFIRM" | "CANCEL",
    selectedOptionId?: string
  ) {
    if (!p.selectedId || acrioActionBusyId) return;
    setAcrioActionBusyId(noteMessageId);
    try {
      const res = await fetch(`/api/conversations/${p.selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm_acrio_note_action",
          noteMessageId,
          decision,
          ...(selectedOptionId ? { selectedOptionId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        p.showToast(data.error || "Could not complete ACRIO action.");
        return;
      }
      p.showToast(
        decision === "CANCEL"
          ? "ACRIO action cancelled."
          : "Confirmed and shared with customer on WhatsApp."
      );
      await Promise.all([
        p.fetchAndCacheDetail(p.selectedId, false),
        p.refreshThreadsSilently(false),
      ]);
    } catch {
      p.showToast("Network error while confirming ACRIO action.");
    } finally {
      setAcrioActionBusyId(null);
    }
  }

  async function handleSendNoteInChat(
    noteMessageId: string,
    customText?: string,
    dismissOnly?: boolean
  ) {
    if (!p.selectedId || acrioActionBusyId) return;
    const convId = p.selectedId;
    setAcrioActionBusyId(noteMessageId);

    const tempId = !dismissOnly
      ? `optimistic_${Date.now()}_${++p.optimisticSeqRef.current}`
      : null;
    if (tempId && customText) {
      p.appendOptimisticMessage(convId, {
        id: tempId,
        direction: "OUTBOUND",
        senderType: "STAFF",
        senderName: p.currentUserName,
        messageType: "TEXT",
        billingCategory: "FREE_CHAT",
        body: customText,
        templateName: null,
        deliveryStatus: "SENDING",
        createdAt: new Date().toISOString(),
        metadata: null,
      });
    }

    try {
      const res = await fetch(`/api/conversations/${convId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_note_in_chat",
          noteMessageId,
          ...(customText ? { customText } : {}),
          ...(dismissOnly ? { dismissOnly: true } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (tempId) {
          p.patchOptimisticMessage(convId, tempId, {
            deliveryStatus: "FAILED",
          });
        }
        p.showToast(data.error || "Could not send note in chat.");
        return;
      }
      if (tempId) {
        p.patchOptimisticMessage(convId, tempId, {
          id: String(data.messageId || tempId),
          deliveryStatus: String(data.deliveryStatus || "SENT"),
          waMessageId: data.waMessageId ? String(data.waMessageId) : null,
        });
      }
      p.showToast(
        dismissOnly
          ? "Kept as an internal team note."
          : "Sent to customer on WhatsApp chat!"
      );
      void p.fetchAndCacheDetail(convId, false);
      p.scheduleThreadsRefresh(150);
    } catch {
      if (tempId) {
        p.patchOptimisticMessage(convId, tempId, { deliveryStatus: "FAILED" });
      }
      p.showToast("Network error while sending note in chat.");
    } finally {
      setAcrioActionBusyId(null);
    }
  }

  async function handleUploadCompanyDocForNote(
    noteMessageId: string,
    missingDoc: { slug?: string; title?: string; keywords?: string },
    file: File
  ) {
    if (!p.selectedId || acrioActionBusyId) return;
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
        p.showToast(upData.error || "File upload failed.");
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
      const attachRes = await fetch(`/api/conversations/${p.selectedId}`, {
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
        p.showToast(
          attachData.error || "Could not save document for sharing."
        );
        return;
      }
      p.showToast(
        `${missingDoc.title || "Document"} saved! Click Confirm & Share with Client to send.`
      );
      await p.fetchAndCacheDetail(p.selectedId, false);
    } catch {
      p.showToast("Network error while uploading document.");
    } finally {
      setAcrioActionBusyId(null);
    }
  }

  return {
    ...mediaAndTemplate,
    acrioActionBusyId,
    pendingPolish,
    handleCancelPolish,
    handleSendPolishedChoice,
    executeComposerSend,
    handleComposerSubmit,
    handleSimulateCustomerRead,
    handleConfirmAcrioAction,
    handleSendNoteInChat,
    handleUploadCompanyDocForNote,
  };
}
