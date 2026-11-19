"use client";

import React from "react";
import {
  CornerUpLeft,
  FileText,
  Link2,
  MapPin,
  Paperclip,
  Settings2,
  Truck,
  X,
  Zap,
} from "lucide-react";
import { WhatsAppLogoIcon, stripWhatsAppFormatting } from "@cc/ui";
import {
  StagedAttachmentBar,
  type StagedComposerAttachment,
} from "@/components/MediaAttachmentTools";
import type { QuotedMessageRef } from "@/lib/inbox-server-data";
import type { CombinedQuickReplyItem } from "./InboxComposer";

export function ComposerToolbarAndBars({
  composerMode,
  setComposerMode,
  windowOpen,
  customLinksCount,
  stagedAttachment,
  setStagedAttachment,
  showAttachmentPicker,
  showTrackPopover,
  showLocationPopover,
  showShortLinksPicker,
  onToggleAttachmentPicker,
  onToggleTrackPopover,
  onToggleLocationPopover,
  onToggleShortLinksPicker,
  onOpenTemplateDialog,
  onOpenQuickRepliesModal,
  setReplyText,
  composerInputRef,
  replyingTo,
  setReplyingTo,
  onJumpToQuotedMessage,
  matchingQuickReplies,
}: {
  composerMode: "REPLY" | "TEMPLATE" | "NOTE";
  setComposerMode: (m: "REPLY" | "TEMPLATE" | "NOTE") => void;
  windowOpen: boolean;
  customLinksCount: number;
  stagedAttachment: StagedComposerAttachment | null;
  setStagedAttachment: (att: StagedComposerAttachment | null) => void;
  showAttachmentPicker: boolean;
  showTrackPopover: boolean;
  showLocationPopover: boolean;
  showShortLinksPicker: boolean;
  onToggleAttachmentPicker: () => void;
  onToggleTrackPopover: () => void;
  onToggleLocationPopover: () => void;
  onToggleShortLinksPicker: () => void;
  onOpenTemplateDialog: () => void;
  onOpenQuickRepliesModal: () => void;
  setReplyText: (next: string | ((prev: string) => string)) => void;
  composerInputRef: React.RefObject<HTMLTextAreaElement | null>;
  replyingTo: QuotedMessageRef | null;
  setReplyingTo: (ref: QuotedMessageRef | null) => void;
  onJumpToQuotedMessage: (quoted: QuotedMessageRef) => void;
  matchingQuickReplies: CombinedQuickReplyItem[];
}) {
  return (
    <>
      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-1.5 sm:gap-2">
        <div className="inline-flex max-w-full shrink-0 rounded-lg bg-white p-0.5 border border-[#d1d7db]">
          {windowOpen && (
            <button
              type="button"
              onClick={() => setComposerMode("REPLY")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap ${
                composerMode === "REPLY"
                  ? "bg-[#00a884] text-white"
                  : "text-[#54656f] hover:text-[#111b21]"
              }`}
            >
              <WhatsAppLogoIcon size={12} />
              <span>WhatsApp Reply</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setComposerMode("TEMPLATE");
              onOpenTemplateDialog();
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap ${
              composerMode === "TEMPLATE"
                ? "bg-neutral-900 text-white"
                : "text-[#54656f] hover:text-[#111b21]"
            }`}
          >
            <FileText className="w-3 h-3" />
            <span>Send Template</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-0.5 sm:pb-0 sm:flex-wrap">
          {windowOpen && (
            <button
              type="button"
              onClick={onToggleAttachmentPicker}
              title="Attach & send Image, Video, PDF, CAD/Office file, or Catalog Photo/Brochure"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-semibold cursor-pointer transition whitespace-nowrap shrink-0 ${
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
              <span className="hidden sm:inline">Attach Media / PDF</span>
              <span className="sm:hidden">Attach</span>
            </button>
          )}

          {windowOpen && (
            <button
              type="button"
              onClick={onToggleTrackPopover}
              title="Create & send a dynamic order tracking button (track.ccapl.cc)"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium cursor-pointer transition whitespace-nowrap shrink-0 ${
                showTrackPopover
                  ? "bg-[#00a884] text-white border-[#00a884]"
                  : "bg-white hover:bg-[#e7fce3] border-[#d1d7db] text-[#111b21]"
              }`}
            >
              <Truck className="w-3.5 h-3.5 text-[#00a884]" />
              <span>Track Order</span>
            </button>
          )}

          {windowOpen && (
            <button
              type="button"
              onClick={onToggleLocationPopover}
              title="Share verified factory address, native WhatsApp pin, and Google Maps link"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium cursor-pointer transition whitespace-nowrap shrink-0 ${
                showLocationPopover
                  ? "bg-[#00a884] text-white border-[#00a884]"
                  : "bg-white hover:bg-[#e7fce3] border-[#d1d7db] text-[#111b21]"
              }`}
            >
              <MapPin
                className={`w-3.5 h-3.5 ${
                  showLocationPopover ? "text-white" : "text-[#00a884]"
                }`}
              />
              <span>Location</span>
            </button>
          )}

          {windowOpen && customLinksCount > 0 && (
            <button
              type="button"
              onClick={onToggleShortLinksPicker}
              title="Search & insert verified product short links (ccapl.cc)"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium cursor-pointer transition whitespace-nowrap shrink-0 ${
                showShortLinksPicker
                  ? "bg-[#00a884] text-white border-[#00a884]"
                  : "bg-white hover:bg-[#e7fce3] border-[#d1d7db] text-[#111b21]"
              }`}
            >
              <Link2 className="w-3.5 h-3.5 text-[#00a884]" />
              <span className="hidden sm:inline">
                Product Links ({customLinksCount})
              </span>
              <span className="sm:hidden">Links ({customLinksCount})</span>
            </button>
          )}

          {windowOpen && composerMode === "REPLY" && (
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
                onClick={onOpenQuickRepliesModal}
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
            onClick={() => onJumpToQuotedMessage(replyingTo)}
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
              onClick={onOpenQuickRepliesModal}
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
                  <span className="font-mono text-[#008069]">{qr.cmd}</span>
                  <span>{qr.title}</span>
                  {qr.isCustom && qr.staffName && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 font-medium">
                      {qr.staffName}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[#54656f] truncate">{qr.body}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
