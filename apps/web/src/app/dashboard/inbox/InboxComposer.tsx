"use client";

import React from "react";
import { FileText, Lock } from "lucide-react";
import { WhatsAppLogoIcon } from "@cc/ui";
import { MentionTextarea } from "@/components/MentionTextarea";
import type { StagedComposerAttachment } from "@/components/MediaAttachmentTools";
import type {
  ConversationDetailBundle,
  QuotedMessageRef,
  StaffOption,
} from "@/lib/inbox-server-data";
import { ComposerNonOwnerBanner } from "./ComposerNonOwnerBanner";
import { ComposerToolbarAndBars } from "./ComposerToolbarAndBars";

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
        <ComposerNonOwnerBanner
          isAcrioHandling={isAcrioHandling}
          assignedStaffName={activeConv.assignedStaffName}
          assignedTeamName={activeConv.assignedTeamName}
          showNoteForNonOwner={showNoteForNonOwner}
          setShowNoteForNonOwner={setShowNoteForNonOwner}
          setComposerMode={setComposerMode}
          composerMode={composerMode}
          takingOver={takingOver}
          onTakeOverChat={onTakeOverChat}
          composerInputRef={composerInputRef}
          staffList={staffList}
          replyText={replyText}
          setReplyText={setReplyText}
          onSubmit={onSubmit}
        />
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
          <ComposerToolbarAndBars
            composerMode={composerMode}
            setComposerMode={setComposerMode}
            customLinksCount={detail.customLinks.length}
            stagedAttachment={stagedAttachment}
            setStagedAttachment={setStagedAttachment}
            showAttachmentPicker={showAttachmentPicker}
            showTrackPopover={showTrackPopover}
            showLocationPopover={showLocationPopover}
            showShortLinksPicker={showShortLinksPicker}
            onToggleAttachmentPicker={onToggleAttachmentPicker}
            onToggleTrackPopover={onToggleTrackPopover}
            onToggleLocationPopover={onToggleLocationPopover}
            onToggleShortLinksPicker={onToggleShortLinksPicker}
            onOpenTemplateDialog={onOpenTemplateDialog}
            onOpenQuickRepliesModal={onOpenQuickRepliesModal}
            setReplyText={setReplyText}
            composerInputRef={composerInputRef}
            replyingTo={replyingTo}
            setReplyingTo={setReplyingTo}
            onJumpToQuotedMessage={onJumpToQuotedMessage}
            matchingQuickReplies={matchingQuickReplies}
          />

          {composerMode === "TEMPLATE" ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white border border-[#d1d7db] px-3 sm:px-3.5 py-2.5 sm:py-3">
              <p className="text-xs text-[#54656f] flex-1 min-w-0 sm:min-w-[220px]">
                Templates are sent exactly as Meta approved them, so the text
                cannot be edited here. Choose one, check the values we fill in
                for {activeConv.customerName || "the customer"}, and review it
                before sending.
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
