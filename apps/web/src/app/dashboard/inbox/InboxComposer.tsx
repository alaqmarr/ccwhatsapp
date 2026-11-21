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
import { shouldRouteTextAsInternalNote } from "./inbox-helpers";

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
  windowOpen,
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
  windowOpen: boolean;
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
  const effectiveMode: "REPLY" | "TEMPLATE" | "NOTE" =
    !windowOpen && composerMode === "REPLY" ? "TEMPLATE" : composerMode;
  const isAtNote =
    effectiveMode === "NOTE" ||
    shouldRouteTextAsInternalNote(replyText, staffList);

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
          windowOpen={windowOpen}
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
          className={`px-2.5 sm:px-4 py-2 border-t border-[#d1d7db] space-y-2 shrink-0 ${
            isAtNote
              ? "bg-[#fef9e7]"
              : effectiveMode === "TEMPLATE"
              ? "bg-[#f4f7fb]"
              : "bg-[#f0f2f5]"
          }`}
        >
          <ComposerToolbarAndBars
            composerMode={effectiveMode}
            setComposerMode={setComposerMode}
            windowOpen={windowOpen}
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

          {effectiveMode === "TEMPLATE" && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-white border border-[#d1d7db] px-3 py-2">
              <p className="text-[11.5px] sm:text-xs text-[#54656f] truncate flex-1">
                {!windowOpen
                  ? "24-hour chat window closed. Send a template to message client."
                  : `Send an approved Meta template to ${
                      activeConv.customerName || "this client"
                    }.`}
              </p>
              <button
                type="button"
                onClick={onOpenTemplateDialog}
                className="h-8 sm:h-9 px-3 sm:px-3.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Choose template</span>
              </button>
            </div>
          )}

          {isAtNote && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-100/90 border border-amber-300 text-[11px] font-medium text-amber-950">
              <Lock className="w-3 h-3 shrink-0" />
              <span className="truncate">
                Private team note (@mention tagged). Customer will not see this, and chat returns right after saving.
              </span>
            </div>
          )}

          <div className="flex items-end gap-2">
            <MentionTextarea
              textareaRef={composerInputRef}
              rows={windowOpen ? 2 : 1}
              enabled
              onPickMention={() => {
                onShowToast(
                  "Tagged with @, so this will save as a private team note."
                );
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
                isAtNote
                  ? "Private note for teammates or @ACRIO..."
                  : windowOpen
                  ? "Type a message, or @teammate / @ACRIO for a private note..."
                  : "Type @teammate or @ACRIO for a private note..."
              }
              className={`w-full rounded-lg px-3 py-2 text-sm text-[#111b21] resize-none focus:outline-none border ${
                isAtNote
                  ? "bg-white border-amber-400 focus:border-amber-500"
                  : "bg-white border-[#d1d7db] focus:border-[#00a884]"
              }`}
            />

            {(windowOpen || isAtNote) && (
              <button
                type="submit"
                disabled={
                  !replyText.trim() &&
                  !((effectiveMode === "REPLY" || isAtNote) && stagedAttachment)
                }
                className={`h-9 sm:h-10 px-3.5 sm:px-4 rounded-lg text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0 ${
                  isAtNote
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-[#00a884] hover:bg-[#008f6f]"
                }`}
              >
                {isAtNote ? (
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
            )}
          </div>
        </form>
      )}
    </>
  );
}
