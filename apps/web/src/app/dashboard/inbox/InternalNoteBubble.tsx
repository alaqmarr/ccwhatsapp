"use client";

import React from "react";
import { Lock } from "lucide-react";
import {
  WhatsAppFormattedText,
  formatTimeIst,
  stripWhatsAppFormatting,
} from "@cc/ui";
import {
  MessageMediaRenderer,
  extractMessageMedia,
  type NormalizedMessageMedia,
} from "@/components/MediaAttachmentTools";
import type {
  ChatMessage,
  QuotedMessageRef,
  StaffOption,
} from "@/lib/inbox-server-data";
import { emphasizeMentions, extractQuotedReply } from "./inbox-helpers";
import { InternalNoteAcrioActions } from "./InternalNoteAcrioActions";
import { InternalNoteMistakeGuard } from "./InternalNoteMistakeGuard";

export const InternalNoteBubble = React.memo(function InternalNoteBubble({
  message: m,
  staffList,
  isHighlighted,
  isAssignedToCurrentUser,
  acrioActionBusyId,
  onJumpToQuotedMessage,
  onOpenMediaPreview,
  onOpenNewChatWithPhone,
  onCopyToast,
  onSendNoteInChat,
  onMoveNoteToReplyBox,
  onConfirmAcrioAction,
  onUploadCompanyDocForNote,
  onUseSuggestedReply,
}: {
  message: ChatMessage;
  staffList: StaffOption[];
  isHighlighted: boolean;
  isAssignedToCurrentUser: boolean;
  acrioActionBusyId: string | null;
  onJumpToQuotedMessage: (quoted: QuotedMessageRef) => void;
  onOpenMediaPreview: (media: NormalizedMessageMedia) => void;
  onOpenNewChatWithPhone: (phone: string, rawDisplay: string) => void;
  onCopyToast: (msg: string) => void;
  onSendNoteInChat: (
    noteId: string,
    customText?: string,
    dismissOnly?: boolean
  ) => void;
  onMoveNoteToReplyBox: (text: string, quoted?: QuotedMessageRef | null) => void;
  onConfirmAcrioAction: (
    noteId: string,
    decision: "CONFIRM" | "CANCEL",
    selectedOptionId?: string
  ) => void;
  onUploadCompanyDocForNote: (
    noteId: string,
    missingDoc: { slug?: string; title?: string; keywords?: string },
    file: File
  ) => void;
  onUseSuggestedReply: (reply: string) => void;
}) {
  const isAcrioNote = m.senderName === "ACRIO";
  const quotedReply = extractQuotedReply(m);
  const noteMedia = extractMessageMedia(m);
  const isBusy = acrioActionBusyId === m.id;

  return (
    <div id={`chat-msg-${m.id}`} className="flex justify-center my-0.5">
      <div
        className={`w-full max-w-[94%] sm:max-w-[84%] lg:max-w-[78%] rounded-lg px-3 sm:px-3.5 py-2.5 shadow-2xs transition-all duration-300 min-w-0 [overflow-wrap:anywhere] ${
          isAcrioNote
            ? "bg-violet-50 border border-violet-300/70 text-violet-950"
            : "bg-[#fef3c7] border border-[#f59e0b]/45 text-[#78350f]"
        } ${isHighlighted ? "ring-2 ring-[#00a884]" : ""}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] font-semibold mb-1 min-w-0">
          <span className="inline-flex items-center gap-1 min-w-0">
            <Lock
              className={`w-3 h-3 shrink-0 ${
                isAcrioNote ? "text-violet-700" : "text-amber-700"
              }`}
            />
            <span className="truncate">
              {isAcrioNote
                ? "ACRIO • Private answer for your team"
                : `Internal Team Note • ${m.senderName}`}
            </span>
          </span>
          <span
            className={`font-normal ${
              isAcrioNote ? "text-violet-800/80" : "text-amber-800/80"
            }`}
          >
            {formatTimeIst(m.createdAt)}
          </span>
        </div>

        {quotedReply && (
          <button
            type="button"
            onClick={() => onJumpToQuotedMessage(quotedReply)}
            className="w-full text-left mb-1.5 rounded-md px-2.5 py-1.5 bg-amber-100/85 hover:bg-amber-200/70 border-l-[3.5px] border-amber-600 transition cursor-pointer"
          >
            <div className="text-[11px] font-semibold text-amber-950 truncate">
              {quotedReply.senderName}
            </div>
            <div className="text-[12px] text-amber-900/85 line-clamp-2 leading-snug">
              {stripWhatsAppFormatting(quotedReply.body)}
            </div>
          </button>
        )}

        <WhatsAppFormattedText
          text={emphasizeMentions(m.body, staffList)}
          className="text-[13px] leading-relaxed"
          onPhoneClick={onOpenNewChatWithPhone}
        />

        {noteMedia && (
          <div className="mt-2">
            <MessageMediaRenderer
              media={noteMedia}
              onOpenPreview={onOpenMediaPreview}
            />
          </div>
        )}

        {isAcrioNote ? (
          <InternalNoteAcrioActions
            message={m}
            quotedReply={quotedReply}
            isBusy={isBusy}
            isAssignedToCurrentUser={isAssignedToCurrentUser}
            onMoveNoteToReplyBox={onMoveNoteToReplyBox}
            onConfirmAcrioAction={onConfirmAcrioAction}
            onUploadCompanyDocForNote={onUploadCompanyDocForNote}
            onCopyToast={onCopyToast}
            onUseSuggestedReply={onUseSuggestedReply}
          />
        ) : (
          <InternalNoteMistakeGuard
            message={m}
            quotedReply={quotedReply}
            isBusy={isBusy}
            onSendNoteInChat={onSendNoteInChat}
            onMoveNoteToReplyBox={onMoveNoteToReplyBox}
          />
        )}
      </div>
    </div>
  );
});
