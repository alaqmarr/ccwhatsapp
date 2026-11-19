"use client";

import React from "react";
import {
  Copy,
  CornerUpLeft,
  ExternalLink,
  MapPin,
  StickyNote,
} from "lucide-react";
import {
  WhatsAppFormattedText,
  WhatsAppMessageTicks,
  formatTimeIst,
  stripWhatsAppFormatting,
} from "@cc/ui";
import {
  MessageMediaRenderer,
  extractMessageMedia,
  type NormalizedMessageMedia,
} from "@/components/MediaAttachmentTools";
import type { ChatMessage, QuotedMessageRef } from "@/lib/inbox-server-data";
import {
  extractCtaButton,
  extractLocationPin,
  extractQuotedReply,
} from "./inbox-helpers";

export const ChatMessageBubble = React.memo(function ChatMessageBubble({
  message: m,
  isHighlighted,
  onStartReplyToMessage,
  onStartNoteReplyToMessage,
  onJumpToQuotedMessage,
  onOpenMediaPreview,
  onOpenNewChatWithPhone,
  onCopyToast,
}: {
  message: ChatMessage;
  isHighlighted: boolean;
  onStartReplyToMessage: (m: ChatMessage) => void;
  onStartNoteReplyToMessage: (m: ChatMessage) => void;
  onJumpToQuotedMessage: (quoted: QuotedMessageRef) => void;
  onOpenMediaPreview: (media: NormalizedMessageMedia) => void;
  onOpenNewChatWithPhone: (phone: string, rawDisplay: string) => void;
  onCopyToast: (msg: string) => void;
}) {
  const isOutbound = m.direction === "OUTBOUND";
  const quotedReply = extractQuotedReply(m);
  const ctaButton = extractCtaButton(m);
  const locationPin = extractLocationPin(m);
  const msgMedia = extractMessageMedia(m);

  const isAcrioBubble = m.billingCategory === "ACRIO";
  const isTemplateBubble = m.messageType === "TEMPLATE";
  const quotedIsAcrio =
    quotedReply?.senderType === "ACRIO" || quotedReply?.senderName === "ACRIO";
  const quotedIsOutbound = quotedReply?.direction === "OUTBOUND";

  return (
    <div
      id={`chat-msg-${m.id}`}
      className={`group flex ${isOutbound ? "justify-end" : "justify-start"}`}
    >
      <div
        onDoubleClick={() => onStartReplyToMessage(m)}
        title="Double-click or press Reply to quote this message"
        className={`max-w-[92%] sm:max-w-[82%] lg:max-w-[74%] rounded-lg px-2.5 sm:px-3 py-2 shadow-2xs relative transition-all duration-300 min-w-0 [overflow-wrap:anywhere] ${
          isHighlighted
            ? "ring-2 ring-[#00a884] bg-[#fff8d6] text-[#111b21]"
            : isOutbound
            ? "bg-[#d9fdd3] text-[#111b21] rounded-tr-none"
            : "bg-white text-[#111b21] rounded-tl-none"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] mb-0.5 min-w-0">
          <span
            className={`font-semibold truncate min-w-0 ${
              isOutbound
                ? isAcrioBubble
                  ? "text-indigo-800"
                  : "text-[#008069]"
                : "text-[#e31837]"
            }`}
          >
            {m.senderName}
          </span>
          <div className="flex flex-wrap items-center gap-1 shrink-0">
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
                  onStartReplyToMessage(m);
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
                  onStartNoteReplyToMessage(m);
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
                  onCopyToast("Message text copied.");
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
              onJumpToQuotedMessage(quotedReply);
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

        {msgMedia && (
          <MessageMediaRenderer
            media={msgMedia}
            onOpenPreview={onOpenMediaPreview}
          />
        )}

        {locationPin ? (
          <div className="mb-1 rounded-md border border-[#00a884]/35 bg-[#f0fdf4] p-2.5 space-y-1.5">
            <div className="flex items-start gap-2">
              <span className="w-7 h-7 rounded-full bg-[#00a884] text-white flex items-center justify-center shrink-0 mt-0.5">
                <MapPin className="w-3.5 h-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-[#111b21] truncate">
                  {locationPin.name}
                </div>
                {locationPin.address && (
                  <div className="text-[11.5px] text-[#54656f] leading-snug mt-0.5">
                    {locationPin.address}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <a
                href={locationPin.mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md bg-white hover:bg-emerald-50 border border-[#00a884]/40 text-[#008069] text-xs font-semibold shadow-2xs transition"
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>Open in Google Maps</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(locationPin.mapsUrl);
                  onCopyToast("Copied Google Maps link.");
                }}
                title={`Copy ${locationPin.mapsUrl}`}
                className="p-1.5 rounded-md bg-white hover:bg-neutral-50 border border-black/10 text-[#54656f] hover:text-[#111b21] cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <WhatsAppFormattedText
            text={m.body}
            className="text-[14px] leading-[1.52] tracking-[-0.006em]"
            onPhoneClick={onOpenNewChatWithPhone}
          />
        )}

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
                    {ctaButton.awbNumber ? ` • AWB ${ctaButton.awbNumber}` : ""}
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
                  onCopyToast(`Copied ${ctaButton.url}`);
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
          <span>{formatTimeIst(m.createdAt)}</span>
          {isOutbound && (
            <WhatsAppMessageTicks
              status={m.deliveryStatus}
              showLabel
              size={14}
            />
          )}
        </div>
        {isOutbound &&
          m.deliveryStatus === "FAILED" &&
          Boolean(m.metadata?.errorMessage || m.metadata?.errorCode) && (
            <div className="mt-1 text-[10.5px] text-red-700 text-right leading-snug break-words">
              {m.metadata?.errorCode ? `Code ${String(m.metadata.errorCode)}: ` : ""}
              {String(
                m.metadata?.errorDetails || m.metadata?.errorMessage || "Delivery failed"
              )}
            </div>
          )}
      </div>
    </div>
  );
});
