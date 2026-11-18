"use client";

import React from "react";
import {
  CornerUpLeft,
  FileText,
  Link2,
  Loader2,
  Lock,
  MapPin,
  Paperclip,
  Settings2,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Truck,
  UserCheck,
  X,
  Zap,
} from "lucide-react";
import { WhatsAppLogoIcon, stripWhatsAppFormatting } from "@cc/ui";
import { MentionTextarea } from "@/components/MentionTextarea";
import {
  StagedAttachmentBar,
  type StagedComposerAttachment,
} from "@/components/MediaAttachmentTools";
import type {
  ConversationDetailBundle,
  QuotedMessageRef,
  StaffOption,
} from "@/lib/inbox-server-data";

export type CombinedQuickReplyItem = {
  id?: string;
  cmd: string;
  title: string;
  body: string;
  isCustom?: boolean;
  staffName?: string;
};

export function InboxComposer({
  detail,
  staffList,
  isAssignedToCurrentUser,
  isAcrioHandling,
  composerMode,
  setComposerMode,
  replyText,
  setReplyText,
  replyingTo,
  setReplyingTo,
  stagedAttachment,
  setStagedAttachment,
  composerInputRef,
  matchingQuickReplies,
  showAttachmentPicker,
  showTrackPopover,
  showLocationPopover,
  showShortLinksPicker,
  showNoteForNonOwner,
  setShowNoteForNonOwner,
  takingOver,
  pendingCallback,
  onMarkPendingCallbackDone,
  onTakeOverChat,
  onToggleAttachmentPicker,
  onToggleTrackPopover,
  onToggleLocationPopover,
  onToggleShortLinksPicker,
  onOpenTemplateDialog,
  onOpenQuickRepliesModal,
  onJumpToQuotedMessage,
  onMoveDraftToNote,
  onSubmit,
  onShowToast,
}: {
  detail: ConversationDetailBundle;
  staffList: StaffOption[];
  isAssignedToCurrentUser: boolean;
  isAcrioHandling: boolean;
  composerMode: "REPLY" | "TEMPLATE" | "NOTE";
  setComposerMode: (m: "REPLY" | "TEMPLATE" | "NOTE") => void;
  replyText: string;
  setReplyText: (next: string | ((prev: string) => string)) => void;
  replyingTo: QuotedMessageRef | null;
  setReplyingTo: (ref: QuotedMessageRef | null) => void;
  stagedAttachment: StagedComposerAttachment | null;
  setStagedAttachment: (att: StagedComposerAttachment | null) => void;
  composerInputRef: React.RefObject<HTMLTextAreaElement | null>;
  matchingQuickReplies: CombinedQuickReplyItem[];
  showAttachmentPicker: boolean;
  showTrackPopover: boolean;
  showLocationPopover: boolean;
  showShortLinksPicker: boolean;
  showNoteForNonOwner: boolean;
  setShowNoteForNonOwner: React.Dispatch<React.SetStateAction<boolean>>;
  takingOver: boolean;
  pendingCallback: {
    id: string;
    slot: string;
    topic: string;
    phone: string;
  } | null;
  onMarkPendingCallbackDone: () => void;
  onTakeOverChat: () => void;
  onToggleAttachmentPicker: () => void;
  onToggleTrackPopover: () => void;
  onToggleLocationPopover: () => void;
  onToggleShortLinksPicker: () => void;
  onOpenTemplateDialog: () => void;
  onOpenQuickRepliesModal: () => void;
  onJumpToQuotedMessage: (quoted: QuotedMessageRef) => void;
  onMoveDraftToNote: (text: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onShowToast: (msg: string) => void;
}) {
  const activeConv = detail.conversation;

  return (
    <>
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
            onClick={onMarkPendingCallbackDone}
            className="ml-auto px-2.5 py-1 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white font-semibold cursor-pointer"
          >
            Mark called
          </button>
        </div>
      )}

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
                        activeConv.assignedStaffName || "another teammate"
                      }${
                        activeConv.assignedTeamName
                          ? ` (${activeConv.assignedTeamName})`
                          : ""
                      }`}
                </div>
                <p className="text-[11.5px] text-neutral-600 mt-0.5">
                  Only the assigned handler or tagged co-handlers can send WhatsApp
                  messages to this customer. Take over the chat to reply directly.
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
                onClick={onTakeOverChat}
                className="px-3.5 py-1.5 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 shadow-2xs disabled:opacity-50"
              >
                {takingOver ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <UserCheck className="w-3.5 h-3.5" />
                )}
                <span>
                  {takingOver
                    ? "Taking over..."
                    : isAcrioHandling
                    ? "Take Over Chat"
                    : `Take Over from ${
                        activeConv.assignedStaffName?.split(" ")[0] || "Teammate"
                      }`}
                </span>
              </button>
            </div>
          </div>

          {showNoteForNonOwner && (
            <form
              onSubmit={(e) => {
                if (composerMode !== "NOTE") setComposerMode("NOTE");
                onSubmit(e);
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
                    onSubmit(e);
                  }
                }}
                placeholder="Private note only for teammates (customer never sees this)..."
                className="w-full rounded-md px-3 py-1.5 text-xs bg-white border border-amber-300 focus:outline-none focus:border-amber-500 resize-none"
              />
              <button
                type="submit"
                disabled={!replyText.trim()}
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
          onSubmit={onSubmit}
          className={`px-2.5 sm:px-4 py-2 sm:py-2.5 border-t border-[#d1d7db] space-y-2 shrink-0 ${
            composerMode === "NOTE"
              ? "bg-[#fef9e7]"
              : composerMode === "TEMPLATE"
              ? "bg-[#f4f7fb]"
              : "bg-[#f0f2f5]"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
            <div className="inline-flex max-w-full overflow-x-auto rounded-lg bg-white p-0.5 border border-[#d1d7db]">
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
                  onOpenTemplateDialog();
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

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleAttachmentPicker}
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
                onClick={onToggleTrackPopover}
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

              <button
                type="button"
                onClick={onToggleLocationPopover}
                title="Share verified factory address, native WhatsApp pin, and Google Maps link"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium cursor-pointer transition ${
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

              {detail.customLinks.length > 0 && (
                <button
                  type="button"
                  onClick={onToggleShortLinksPicker}
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
                    <p className="text-[11px] text-[#54656f] truncate">
                      {qr.body}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {composerMode === "TEMPLATE" ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white border border-[#d1d7db] px-3 sm:px-3.5 py-2.5 sm:py-3">
              <p className="text-xs text-[#54656f] flex-1 min-w-0 sm:min-w-[220px]">
                Templates are sent exactly as Meta approved them, so the text cannot
                be edited here. Choose one, check the values we fill in for{" "}
                {activeConv.customerName || "the customer"}, and review it before
                sending.
              </p>
              <button
                type="button"
                onClick={onOpenTemplateDialog}
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
                    onMoveDraftToNote(nextText);
                    onShowToast(
                      "Switched to Note mode, so the customer will not see this."
                    );
                  }
                }}
                people={staffList.map((s) => ({
                  id: s.id,
                  name: s.name,
                  role: s.role,
                }))}
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
                    onSubmit(e);
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
                  !replyText.trim() &&
                  !(
                    (composerMode === "REPLY" || composerMode === "NOTE") &&
                    stagedAttachment
                  )
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
    </>
  );
}
