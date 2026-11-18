"use client";

import { useState } from "react";
import { TRACKING_PUBLIC_ORIGIN, buildClientProviderTrackingUrl } from "@cc/ui";
import {
  describeAttachmentType,
  type PreSendFileConfirmationTarget,
  type StagedComposerAttachment,
} from "@/components/MediaAttachmentTools";
import type { TemplateSendPayload } from "@/components/TemplateSendDialog";
import type {
  ChatMessage,
  ConversationDetailBundle,
  QuotedMessageRef,
  StaffOption,
} from "@/lib/inbox-server-data";
import type { InboxComposerMode } from "@/lib/inbox-store";
import type { VerifiedLocationInfo } from "./ComposerPopovers";
import { describeNoteResult, hasTeamMention } from "./inbox-helpers";

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
  const [sendingTrackBtn, setSendingTrackBtn] = useState(false);
  const [sendingLocationPin, setSendingLocationPin] = useState(false);
  const [acrioActionBusyId, setAcrioActionBusyId] = useState<string | null>(null);

  const activeConv = p.detail?.conversation || null;

  async function sendTemplateMessage(
    payload: TemplateSendPayload
  ): Promise<{ ok: boolean; error?: string }> {
    if (!p.selectedId) return { ok: false, error: "No chat is open." };
    const chatId = p.selectedId;
    const components: Record<string, unknown>[] = [];
    if (payload.headerValues.length > 0) {
      components.push({
        type: "header",
        parameters: payload.headerValues.map((v) => ({ type: "text", text: v })),
      });
    }
    if (payload.bodyValues.length > 0) {
      components.push({
        type: "body",
        parameters: payload.bodyValues.map((v) => ({ type: "text", text: v })),
      });
    }

    const tempId = `optimistic_${Date.now()}_${++p.optimisticSeqRef.current}`;
    p.appendOptimisticMessage(chatId, {
      id: tempId,
      direction: "OUTBOUND",
      senderType: "STAFF",
      senderName: p.currentUserName,
      messageType: "TEMPLATE",
      billingCategory: payload.template.category,
      body: payload.renderedText,
      templateName: payload.template.name,
      deliveryStatus: "SENDING",
      createdAt: new Date().toISOString(),
      metadata: null,
    });
    p.setComposerMode("REPLY");

    try {
      const res = await fetch(`/api/conversations/${chatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_message",
          text: payload.renderedText,
          messageType: "TEMPLATE",
          templateName: payload.template.name,
          billingCategory: payload.template.category,
          languageCode: payload.template.language,
          ...(components.length > 0 ? { templateComponents: components } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        p.patchOptimisticMessage(chatId, tempId, {
          id: data.messageId || tempId,
          deliveryStatus: "FAILED",
        });
        return {
          ok: false,
          error: data.error || "The template could not be sent.",
        };
      }
      p.patchOptimisticMessage(chatId, tempId, {
        id: String(data.messageId || tempId),
        deliveryStatus: String(data.deliveryStatus || "SENT"),
        waMessageId: data.waMessageId ? String(data.waMessageId) : null,
      });
      p.showToast("Template sent.");
      p.scheduleThreadsRefresh(150);
      return { ok: true };
    } catch {
      p.patchOptimisticMessage(chatId, tempId, { deliveryStatus: "FAILED" });
      return { ok: false, error: "Network error. The template was not sent." };
    }
  }

  async function handleSendOrderTracking(e: React.FormEvent) {
    e.preventDefault();
    if (!p.selectedId || !p.detail) return;
    const cleanOrderId = p.trackOrderId.trim();
    if (!cleanOrderId) {
      p.showToast("Please enter an Order ID first.");
      return;
    }

    const currentConvId = p.selectedId;
    const matchedOrder = p.detail.orders.find(
      (o) => o.orderNumber.toUpperCase() === cleanOrderId.toUpperCase()
    );
    const computedProviderUrl =
      p.trackProviderUrl.trim() ||
      buildClientProviderTrackingUrl(
        p.trackProviderKey,
        p.trackAwbNumber.trim() || cleanOrderId
      );
    const buttonLabel = p.trackButtonLabel.trim() || "Track Order";
    const firstName =
      String(p.detail.conversation.customerName || "there")
        .trim()
        .split(/\s+/)[0] || "there";
    const customText = p.trackMessageText.trim();
    const optimisticBody =
      customText ||
      `Hello ${firstName}, your order ${cleanOrderId} tracking update is ready. Tap ${buttonLabel} below.`;
    const optimisticPublicUrl = `${TRACKING_PUBLIC_ORIGIN}/${cleanOrderId}`;
    const activeReplyRef = p.replyingTo;

    p.setShowTrackPopover(false);
    p.setReplyingTo(null);
    setSendingTrackBtn(true);

    const tempId = `optimistic_${Date.now()}_${++p.optimisticSeqRef.current}`;
    p.appendOptimisticMessage(
      currentConvId,
      {
        id: tempId,
        direction: "OUTBOUND",
        senderType: "STAFF",
        senderName: p.currentUserName,
        messageType: "CUSTOM_LINK",
        billingCategory: "FREE_CHAT",
        body: optimisticBody,
        templateName: null,
        deliveryStatus: "SENDING",
        createdAt: new Date().toISOString(),
        metadata: {
          ...(activeReplyRef ? { replyTo: activeReplyRef } : {}),
          ctaButton: {
            label: buttonLabel,
            url: optimisticPublicUrl,
            orderId: cleanOrderId,
            awbNumber: p.trackAwbNumber.trim() || undefined,
          },
        },
      },
      `[${buttonLabel}] ${optimisticBody}`
    );

    try {
      const res = await fetch(`/api/conversations/${currentConvId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_order_tracking",
          orderId: cleanOrderId,
          brand: p.trackBrand,
          providerCode: p.trackProviderKey,
          awbNumber: p.trackAwbNumber.trim(),
          providerTrackingUrl: computedProviderUrl,
          shipmentStatus: computedProviderUrl ? "DISPATCHED" : "IN_PRODUCTION",
          itemsSummary: matchedOrder?.itemsSummary || undefined,
          buttonLabel,
          text: customText || undefined,
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
        p.showToast(data.error || "Could not send tracking button.");
        return;
      }
      p.patchOptimisticMessage(currentConvId, tempId, {
        id: String(data.messageId || tempId),
        deliveryStatus: String(data.deliveryStatus || "SENT"),
        waMessageId: data.waMessageId ? String(data.waMessageId) : null,
        ...(data.ctaButton
          ? {
              metadata: {
                ...(activeReplyRef ? { replyTo: activeReplyRef } : {}),
                ctaButton: data.ctaButton,
              },
            }
          : {}),
      });
      p.showToast(
        `Sent Track Order button (${
          data.tracking?.publicTrackingUrl || optimisticPublicUrl
        }).`
      );
      p.scheduleThreadsRefresh(150);
    } catch {
      p.patchOptimisticMessage(currentConvId, tempId, { deliveryStatus: "FAILED" });
      p.showToast("Network error while sending tracking button.");
    } finally {
      setSendingTrackBtn(false);
    }
  }

  async function handleSendVerifiedLocationNow() {
    if (!p.selectedId || !p.detail || sendingLocationPin) return;
    const currentConvId = p.selectedId;
    const loc = p.resolveActiveVerifiedLocation();
    const locText = p.buildVerifiedLocationMessageText();
    const activeReplyRef = p.replyingTo;

    p.setShowLocationPopover(false);
    p.setReplyingTo(null);
    setSendingLocationPin(true);

    const tempId = `optimistic_${Date.now()}_${++p.optimisticSeqRef.current}`;
    const locMeta: Record<string, unknown> = {
      ...(activeReplyRef ? { replyTo: activeReplyRef } : {}),
      locationPin: {
        latitude: loc.latitude,
        longitude: loc.longitude,
        name: loc.placeName,
        address: loc.address,
        mapsUrl: loc.mapsUrl,
      },
    };
    p.appendOptimisticMessage(currentConvId, {
      id: tempId,
      direction: "OUTBOUND",
      senderType: "STAFF",
      senderName: p.currentUserName,
      messageType: "TEXT",
      billingCategory: "FREE_CHAT",
      body: locText,
      templateName: null,
      deliveryStatus: "SENDING",
      createdAt: new Date().toISOString(),
      metadata: locMeta,
    });

    try {
      const res = await fetch(`/api/conversations/${currentConvId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_message",
          text: locText,
          locationPin: {
            latitude: loc.latitude,
            longitude: loc.longitude,
            name: loc.placeName,
            address: loc.address,
            mapsUrl: loc.mapsUrl,
          },
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
        p.showToast(data.error || "Could not send location.");
        return;
      }
      p.patchOptimisticMessage(currentConvId, tempId, {
        id: String(data.messageId || tempId),
        deliveryStatus: String(data.deliveryStatus || "SENT"),
        waMessageId: data.waMessageId ? String(data.waMessageId) : null,
      });
      p.showToast("Sent factory location pin + Google Maps link to customer.");
      p.scheduleThreadsRefresh(150);
    } catch {
      p.patchOptimisticMessage(currentConvId, tempId, { deliveryStatus: "FAILED" });
      p.showToast("Network error while sending location.");
    } finally {
      setSendingLocationPin(false);
    }
  }

  async function executeComposerSend(opts?: {
    overrideAttachment?: StagedComposerAttachment | null;
    overrideCaption?: string;
    modeOverride?: "REPLY" | "NOTE";
  }) {
    const effectiveMode =
      opts?.modeOverride || (p.composerMode === "NOTE" ? "NOTE" : "REPLY");
    const activeAtt =
      opts?.overrideAttachment !== undefined
        ? opts.overrideAttachment
        : p.stagedAttachment;
    const rawCaptionText = (
      opts?.overrideCaption !== undefined ? opts.overrideCaption : p.replyText
    ).trim();
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

    p.setDraft(currentConvId, effectiveMode, "");
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
    const hasStagedAtt =
      (p.composerMode === "REPLY" || p.composerMode === "NOTE") &&
      Boolean(p.stagedAttachment);
    if (!p.selectedId || (!p.replyText.trim() && !hasStagedAtt) || !p.detail) {
      return;
    }

    if (p.composerMode === "TEMPLATE") {
      p.setTemplateDialogOpen(true);
      return;
    }

    if (p.composerMode !== "NOTE" && hasTeamMention(p.replyText, p.staffList)) {
      const asNote = window.confirm(
        "This message has an @mention, so it looks meant for your team. Sent as a reply, the CUSTOMER would see it on WhatsApp.\n\nPress OK to switch to a private note (then press Save Note).\nPress Cancel to go back and edit it."
      );
      if (asNote) {
        p.moveDraftToNote(p.replyText);
        p.showToast(
          "Switched to Note mode. Press Save Note to post it privately."
        );
      }
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

    await executeComposerSend();
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
          p.patchOptimisticMessage(convId, tempId, { deliveryStatus: "FAILED" });
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
        p.showToast(attachData.error || "Could not save document for sharing.");
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
  };
}
