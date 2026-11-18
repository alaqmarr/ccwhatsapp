"use client";

import React from "react";
import {
  Check,
  CornerUpLeft,
  FileText,
  Loader2,
  Lock,
  Paperclip,
  X,
} from "lucide-react";
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
import {
  buildClientMergedCorrection,
  emphasizeMentions,
  extractQuotedReply,
} from "./inbox-helpers";

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
  onSendNoteInChat: (noteId: string, customText?: string, dismissOnly?: boolean) => void;
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

        {isAcrioNote &&
          m.metadata &&
          typeof m.metadata.pendingAction === "object" &&
          m.metadata.pendingAction !== null &&
          (() => {
            const pa = m.metadata.pendingAction as {
              id?: string;
              status?: string;
              title?: string;
              messageText?: string;
              sourceLabel?: string;
              decidedByStaffName?: string;
              error?: string;
              attachment?: {
                url?: string;
                fileName?: string;
                mediaType?: string;
              } | null;
              candidateOptions?: Array<{
                id: string;
                title: string;
                sourceLabel: string;
                mediaUrl: string;
                mediaType: string;
                fileName: string;
                messageText?: string;
              }>;
            };
            const hasChoices =
              Array.isArray(pa.candidateOptions) && pa.candidateOptions.length > 1;
            const isTextChoiceList =
              hasChoices &&
              Boolean(
                pa.candidateOptions?.some((o) => Boolean(o.messageText) && !o.mediaUrl)
              );

            if (pa.status === "CONFIRMED") {
              return (
                <div className="mt-2 pt-2 border-t border-violet-200/70 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                  <span>
                    Confirmed &amp; shared with client
                    {pa.decidedByStaffName ? ` by ${pa.decidedByStaffName}` : ""}
                  </span>
                </div>
              );
            }
            if (pa.status === "CANCELLED") {
              return (
                <div className="mt-2 pt-2 border-t border-violet-200/70 flex items-center gap-1.5 text-[11px] font-medium text-neutral-600">
                  <X className="w-3.5 h-3.5" />
                  <span>
                    Action cancelled
                    {pa.decidedByStaffName ? ` by ${pa.decidedByStaffName}` : ""}
                  </span>
                </div>
              );
            }
            return (
              <div className="mt-2.5 rounded-md bg-white border border-violet-200 p-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-violet-950">
                    {isTextChoiceList
                      ? "Choose how to send this in the customer's WhatsApp chat:"
                      : hasChoices
                      ? "Select which document to confirm & send to client:"
                      : pa.title || "Confirm client action"}
                  </span>
                  {!hasChoices && pa.attachment?.fileName && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-violet-100 text-violet-900 text-[10.5px] font-medium">
                      <FileText className="w-3 h-3" />
                      <span>
                        {pa.attachment.fileName}
                        {pa.sourceLabel ? ` (${pa.sourceLabel})` : ""}
                      </span>
                    </span>
                  )}
                </div>

                {hasChoices && pa.candidateOptions ? (
                  <div className="space-y-1.5">
                    {pa.candidateOptions.map((opt, idx) => (
                      <div
                        key={opt.id}
                        className="rounded border border-violet-100 bg-[#faf8ff] px-2.5 py-2 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[11.5px] font-semibold text-violet-950 truncate">
                            {idx + 1}. {opt.title}
                          </div>
                          {opt.messageText && !opt.mediaUrl ? (
                            <div className="mt-1 text-[12px] text-[#111b21] bg-white border border-violet-200/80 rounded px-2 py-1 font-medium">
                              {opt.messageText}
                            </div>
                          ) : (
                            <div className="text-[10.5px] text-neutral-600 truncate">
                              Source: {opt.sourceLabel} • {opt.fileName}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {opt.mediaUrl && (
                            <a
                              href={opt.mediaUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-[10.5px] font-medium text-neutral-700"
                            >
                              View
                            </a>
                          )}
                          {opt.messageText && !opt.mediaUrl && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                onMoveNoteToReplyBox(opt.messageText || "", quotedReply)
                              }
                              className="px-2 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-[10.5px] font-medium text-neutral-700 cursor-pointer"
                            >
                              Edit in Reply Box
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              onConfirmAcrioAction(m.id, "CONFIRM", opt.id)
                            }
                            className="px-2.5 py-1 rounded bg-[#00a884] hover:bg-[#008f6f] text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            {isBusy ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Check className="w-3 h-3" />
                            )}
                            <span>
                              {isBusy
                                ? "Sending..."
                                : opt.messageText && !opt.mediaUrl
                                ? "Send in Chat"
                                : "Confirm & Send"}
                            </span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  pa.messageText && (
                    <p className="text-[12px] text-[#3b4a54] bg-[#f8fafc] border border-neutral-200 rounded px-2 py-1.5">
                      {pa.messageText}
                    </p>
                  )
                )}

                {pa.status === "FAILED" && pa.error && (
                  <p className="text-[11px] text-rose-700">
                    Previous send failed: {pa.error}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {!hasChoices && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onConfirmAcrioAction(m.id, "CONFIRM")}
                      className="px-3 py-1.5 rounded bg-[#00a884] hover:bg-[#008f6f] text-white text-[11.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {isBusy
                          ? "Sharing with client..."
                          : "Confirm & Share with Client"}
                      </span>
                    </button>
                  )}
                  {!hasChoices && pa.attachment?.url && (
                    <a
                      href={pa.attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2.5 py-1.5 rounded bg-white hover:bg-neutral-50 border border-neutral-300 text-neutral-700 text-[11px] font-medium"
                    >
                      View File
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onConfirmAcrioAction(m.id, "CANCEL")}
                    className="px-2.5 py-1.5 rounded bg-white hover:bg-neutral-100 border border-neutral-300 text-neutral-700 text-[11px] font-medium cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          })()}

        {isAcrioNote &&
          m.metadata &&
          typeof m.metadata.missingCompanyDoc === "object" &&
          m.metadata.missingCompanyDoc !== null &&
          (m.metadata.missingCompanyDoc as { status?: string }).status ===
            "NEEDS_UPLOAD" &&
          (() => {
            const md = m.metadata.missingCompanyDoc as {
              slug?: string;
              title?: string;
              keywords?: string;
            };
            return (
              <div className="mt-2.5 rounded-md bg-white border border-violet-200 p-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-violet-950 font-medium">
                  Upload once to save permanently &amp; confirm sharing:
                </span>
                <label
                  className={`px-3 py-1.5 rounded bg-violet-700 hover:bg-violet-800 text-white text-[11.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                    isBusy ? "opacity-50 pointer-events-none" : ""
                  }`}
                >
                  {isBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Paperclip className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isBusy ? "Uploading..." : `Upload ${md.title || "Document"}`}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    className="hidden"
                    disabled={isBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) {
                        onUploadCompanyDocForNote(m.id, md, f);
                      }
                    }}
                  />
                </label>
              </div>
            );
          })()}

        {isAcrioNote &&
          m.metadata &&
          Array.isArray(m.metadata.actionsExecuted) &&
          m.metadata.actionsExecuted.length > 0 && (
            <div className="mt-2 pt-2 border-t border-violet-200/70 flex flex-wrap gap-1.5">
              {(m.metadata.actionsExecuted as (Record<string, unknown> | string)[]).map(
                (act, idx) => (
                  <span
                    key={`${m.id}_act_${idx}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-200 text-[10.5px] font-semibold"
                  >
                    <Check className="w-3 h-3" />
                    <span>
                      {typeof act === "string"
                        ? act
                        : String(act.detail || act.type || "Action done")}
                    </span>
                  </span>
                )
              )}
            </div>
          )}

        {isAcrioNote &&
          m.metadata &&
          !m.metadata.pendingAction &&
          !m.metadata.missingCompanyDoc &&
          typeof m.metadata.suggestedReply === "string" &&
          m.metadata.suggestedReply.trim() && (
            <div className="mt-2 pt-2 border-t border-violet-200/70 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-violet-900">
                Suggested reply ready:
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      String(m.metadata?.suggestedReply || "")
                    );
                    onCopyToast("Suggested reply copied.");
                  }}
                  className="px-2 py-1 rounded bg-white border border-violet-200 text-violet-900 text-[11px] font-medium cursor-pointer"
                >
                  Copy
                </button>
                {isAssignedToCurrentUser && (
                  <button
                    type="button"
                    onClick={() =>
                      onUseSuggestedReply(String(m.metadata?.suggestedReply || ""))
                    }
                    className="px-2.5 py-1 rounded bg-violet-700 hover:bg-violet-800 text-white text-[11px] font-semibold cursor-pointer"
                  >
                    Use Reply
                  </button>
                )}
              </div>
            </div>
          )}

        {!isAcrioNote &&
          (() => {
            const rawAcc =
              m.metadata &&
              typeof m.metadata.accidentalCustomerReply === "object" &&
              m.metadata.accidentalCustomerReply !== null
                ? (m.metadata.accidentalCustomerReply as {
                    detected?: boolean;
                    status?: "PENDING" | "SENT" | "DISMISSED";
                    exactMessageText?: string;
                    mergedCorrectionText?: string | null;
                    sentByStaffName?: string;
                  })
                : null;
            const bodyTrimmed = String(m.body || "").trim();
            const hasAtMention = bodyTrimmed.includes("@");
            const clientDetectedMistake =
              !hasAtMention &&
              (Boolean(quotedReply) ||
                /^(?:sorry|sry)\b/i.test(bodyTrimmed) ||
                /\b(?:each\s+one\s+[\d,]+|plus\s+gst|transport\s+charges|\bsir\s*[,!.]*$)/i.test(
                  bodyTrimmed
                ));
            const isMistakePending =
              rawAcc?.status === "SENT" || rawAcc?.status === "DISMISSED"
                ? false
                : Boolean(rawAcc?.detected || clientDetectedMistake);
            const mergedText =
              rawAcc?.mergedCorrectionText ||
              (quotedReply?.body
                ? buildClientMergedCorrection(bodyTrimmed, quotedReply.body)
                : null);

            if (rawAcc?.status === "SENT") {
              return (
                <div className="mt-2 pt-1.5 border-t border-amber-300/70 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                  <span>
                    Sent to customer in WhatsApp chat
                    {rawAcc.sentByStaffName ? ` by ${rawAcc.sentByStaffName}` : ""}
                  </span>
                </div>
              );
            }

            if (isMistakePending) {
              return (
                <div className="mt-2.5 rounded-md bg-white/95 border border-amber-400 p-2.5 space-y-2 shadow-2xs">
                  <div className="text-[11.5px] font-semibold text-amber-950">
                    Heads up: This looks like a customer reply saved in an Internal
                    Note (the customer cannot see this).
                  </div>
                  {mergedText && (
                    <div className="rounded bg-emerald-50/80 border border-emerald-200 px-2.5 py-1.5 text-[11.5px] text-emerald-950">
                      <span className="font-semibold">Smart corrected reply: </span>
                      <span>{mergedText}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {mergedText && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onSendNoteInChat(m.id, mergedText)}
                        className="px-2.5 py-1 rounded bg-[#00a884] hover:bg-[#008f6f] text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                        <span>
                          {isBusy ? "Sending..." : "Send Corrected Reply in Chat"}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onSendNoteInChat(m.id, bodyTrimmed)}
                      className={`px-2.5 py-1 rounded text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                        mergedText
                          ? "bg-amber-700 hover:bg-amber-800 text-white"
                          : "bg-[#00a884] hover:bg-[#008f6f] text-white"
                      }`}
                    >
                      {isBusy ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <CornerUpLeft className="w-3 h-3" />
                      )}
                      <span>
                        {isBusy
                          ? "Sending..."
                          : mergedText
                          ? `Send "${bodyTrimmed.slice(0, 28)}" Only`
                          : "Send in Chat"}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        onMoveNoteToReplyBox(
                          mergedText || bodyTrimmed,
                          quotedReply
                        )
                      }
                      className="px-2 py-1 rounded bg-white hover:bg-neutral-50 border border-neutral-300 text-neutral-800 text-[11px] font-medium cursor-pointer"
                    >
                      Edit in Reply Box
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onSendNoteInChat(m.id, undefined, true)}
                      className="px-2 py-1 rounded bg-white hover:bg-neutral-100 border border-neutral-200 text-neutral-600 text-[10.5px] font-medium cursor-pointer"
                    >
                      Keep as Note
                    </button>
                  </div>
                </div>
              );
            }

            if (!hasAtMention && bodyTrimmed.length > 0) {
              return (
                <div className="mt-1.5 pt-1 border-t border-amber-300/45 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onMoveNoteToReplyBox(bodyTrimmed, quotedReply)}
                    className="text-[10.5px] font-medium text-amber-900/80 hover:text-amber-950 underline cursor-pointer"
                  >
                    Edit in Reply Box
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onSendNoteInChat(m.id, bodyTrimmed)}
                    className="px-2 py-0.5 rounded bg-amber-700/15 hover:bg-amber-700/25 text-amber-950 text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    {isBusy ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    ) : (
                      <CornerUpLeft className="w-2.5 h-2.5" />
                    )}
                    <span>{isBusy ? "Sending..." : "Send in Chat"}</span>
                  </button>
                </div>
              );
            }
            return null;
          })()}
      </div>
    </div>
  );
});
