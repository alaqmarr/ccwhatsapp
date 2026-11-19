"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { StagedComposerAttachment } from "@/components/MediaAttachmentTools";
import type { ConversationDetailBundle } from "@/lib/inbox-server-data";
import type { VerifiedLocationInfo } from "./ComposerPopovers";

const AttachmentPickerPopover = dynamic(
  () =>
    import("@/components/MediaAttachmentTools").then(
      (m) => m.AttachmentPickerPopover
    ),
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

export function InboxComposerPopoversSlot({
  detail,
  showAttachmentPicker,
  setShowAttachmentPicker,
  showTrackPopover,
  setShowTrackPopover,
  showLocationPopover,
  setShowLocationPopover,
  showShortLinksPicker,
  setShowShortLinksPicker,
  replyText,
  setReplyText,
  setStagedAttachment,
  setComposerMode,
  composerInputRef,
  executeComposerSend,
  showToast,
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
  sendingTrackBtn,
  openTrackPopoverForOrder,
  handleSendOrderTracking,
  appendToComposer,
  resolveActiveVerifiedLocation,
  buildVerifiedLocationMessageText,
  sendingLocationPin,
  handleSendVerifiedLocationNow,
}: {
  detail: ConversationDetailBundle;
  showAttachmentPicker: boolean;
  setShowAttachmentPicker: (v: boolean) => void;
  showTrackPopover: boolean;
  setShowTrackPopover: (v: boolean) => void;
  showLocationPopover: boolean;
  setShowLocationPopover: (v: boolean) => void;
  showShortLinksPicker: boolean;
  setShowShortLinksPicker: (v: boolean) => void;
  replyText: string;
  setReplyText: (next: string | ((prev: string) => string)) => void;
  setStagedAttachment: (att: StagedComposerAttachment | null) => void;
  setComposerMode: (m: "REPLY" | "TEMPLATE" | "NOTE") => void;
  composerInputRef: React.RefObject<HTMLTextAreaElement | null>;
  executeComposerSend: (opts?: {
    overrideAttachment?: StagedComposerAttachment | null;
    overrideCaption?: string;
    modeOverride?: "REPLY" | "NOTE";
  }) => Promise<void>;
  showToast: (msg: string) => void;
  trackOrderId: string;
  setTrackOrderId: (v: string) => void;
  trackBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  setTrackBrand: (v: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53") => void;
  trackProviderKey: string;
  setTrackProviderKey: (v: string) => void;
  trackAwbNumber: string;
  setTrackAwbNumber: (v: string) => void;
  trackProviderUrl: string;
  setTrackProviderUrl: (v: string) => void;
  trackButtonLabel: string;
  setTrackButtonLabel: (v: string) => void;
  trackMessageText: string;
  setTrackMessageText: (v: string) => void;
  sendingTrackBtn: boolean;
  openTrackPopoverForOrder: (prefill?: {
    orderId?: string;
    itemsSummary?: string;
    brand?: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  }) => void;
  handleSendOrderTracking: (e: React.FormEvent) => Promise<void>;
  appendToComposer: (snippet: string) => void;
  resolveActiveVerifiedLocation: () => VerifiedLocationInfo;
  buildVerifiedLocationMessageText: () => string;
  sendingLocationPin: boolean;
  handleSendVerifiedLocationNow: () => Promise<void>;
}) {
  const activeConv = detail.conversation;
  const anyVisible =
    showAttachmentPicker ||
    showTrackPopover ||
    showLocationPopover ||
    (showShortLinksPicker && detail.customLinks.length > 0);

  if (!anyVisible) return null;

  return (
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
              overrideCaption: replyText.trim() || att.suggestedCaption || "",
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
  );
}
