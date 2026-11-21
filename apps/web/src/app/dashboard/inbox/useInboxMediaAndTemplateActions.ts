"use client";

import { useState } from "react";
import { TRACKING_PUBLIC_ORIGIN, buildClientProviderTrackingUrl } from "@cc/ui";
import type { TemplateSendPayload } from "@/components/TemplateSendDialog";
import type {
  ChatMessage,
  ConversationDetailBundle,
  QuotedMessageRef,
} from "@/lib/inbox-server-data";
import type { InboxComposerMode } from "@/lib/inbox-store";
import type { VerifiedLocationInfo } from "./ComposerPopovers";

export interface UseInboxMediaAndTemplateActionsParams {
  selectedId: string | null;
  detail: ConversationDetailBundle | null;
  currentUserName: string;
  setComposerMode: (mode: InboxComposerMode) => void;
  replyingTo: QuotedMessageRef | null;
  setReplyingTo: (ref: QuotedMessageRef | null) => void;
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
  scheduleThreadsRefresh: (delayMs?: number) => void;
  showToast: (msg: string) => void;
}

export function useInboxMediaAndTemplateActions(
  p: UseInboxMediaAndTemplateActionsParams
) {
  const [sendingTrackBtn, setSendingTrackBtn] = useState(false);
  const [sendingLocationPin, setSendingLocationPin] = useState(false);

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
          ...(payload.headerMediaUrl ? { headerMediaUrl: payload.headerMediaUrl } : {}),
          ...(components.length > 0 ? { templateComponents: components } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        const failErr = data.error || "The template could not be sent.";
        p.patchOptimisticMessage(chatId, tempId, {
          id: data.messageId || tempId,
          deliveryStatus: "FAILED",
          metadata: {
            errorCode: data.metaErrorCode ?? null,
            errorMessage: failErr,
          },
        });
        p.showToast(failErr);
        return {
          ok: false,
          error: failErr,
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
      p.patchOptimisticMessage(chatId, tempId, {
        deliveryStatus: "FAILED",
        metadata: { errorMessage: "Network error. The template was not sent." },
      });
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
      p.patchOptimisticMessage(currentConvId, tempId, {
        deliveryStatus: "FAILED",
      });
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
      p.patchOptimisticMessage(currentConvId, tempId, {
        deliveryStatus: "FAILED",
      });
      p.showToast("Network error while sending location.");
    } finally {
      setSendingLocationPin(false);
    }
  }

  return {
    sendingTrackBtn,
    sendingLocationPin,
    sendTemplateMessage,
    handleSendOrderTracking,
    handleSendVerifiedLocationNow,
  };
}
