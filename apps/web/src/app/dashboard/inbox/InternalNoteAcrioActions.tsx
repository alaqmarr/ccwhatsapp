"use client";

import React from "react";
import { Check, FileText, Loader2, Paperclip, X } from "lucide-react";
import type { ChatMessage, QuotedMessageRef } from "@/lib/inbox-server-data";

interface PendingActionData {
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
}

export function InternalNoteAcrioActions({
  message: m,
  quotedReply,
  isBusy,
  isAssignedToCurrentUser,
  onMoveNoteToReplyBox,
  onConfirmAcrioAction,
  onUploadCompanyDocForNote,
  onCopyToast,
  onUseSuggestedReply,
}: {
  message: ChatMessage;
  quotedReply: QuotedMessageRef | null;
  isBusy: boolean;
  isAssignedToCurrentUser: boolean;
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
  onCopyToast: (msg: string) => void;
  onUseSuggestedReply: (reply: string) => void;
}) {
  const meta = m.metadata;
  if (!meta) return null;

  const pa =
    typeof meta.pendingAction === "object" && meta.pendingAction !== null
      ? (meta.pendingAction as PendingActionData)
      : null;

  const hasChoices =
    Boolean(pa) &&
    Array.isArray(pa?.candidateOptions) &&
    (pa?.candidateOptions?.length ?? 0) > 1;

  const isTextChoiceList =
    hasChoices &&
    Boolean(
      pa?.candidateOptions?.some((o) => Boolean(o.messageText) && !o.mediaUrl)
    );

  const missingDoc =
    typeof meta.missingCompanyDoc === "object" &&
    meta.missingCompanyDoc !== null &&
    (meta.missingCompanyDoc as { status?: string }).status === "NEEDS_UPLOAD"
      ? (meta.missingCompanyDoc as {
          slug?: string;
          title?: string;
          keywords?: string;
        })
      : null;

  const actionsExecuted = Array.isArray(meta.actionsExecuted)
    ? (meta.actionsExecuted as (Record<string, unknown> | string)[])
    : [];

  const suggestedReply =
    !meta.pendingAction &&
    !meta.missingCompanyDoc &&
    typeof meta.suggestedReply === "string" &&
    meta.suggestedReply.trim()
      ? meta.suggestedReply
      : null;

  return (
    <>
      {pa &&
        (pa.status === "CONFIRMED" ? (
          <div className="mt-2 pt-2 border-t border-violet-200/70 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
            <Check className="w-3.5 h-3.5 text-emerald-700" />
            <span>
              Confirmed &amp; shared with client
              {pa.decidedByStaffName ? ` by ${pa.decidedByStaffName}` : ""}
            </span>
          </div>
        ) : pa.status === "CANCELLED" ? (
          <div className="mt-2 pt-2 border-t border-violet-200/70 flex items-center gap-1.5 text-[11px] font-medium text-neutral-600">
            <X className="w-3.5 h-3.5" />
            <span>
              Action cancelled
              {pa.decidedByStaffName ? ` by ${pa.decidedByStaffName}` : ""}
            </span>
          </div>
        ) : (
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
                            onMoveNoteToReplyBox(
                              opt.messageText || "",
                              quotedReply
                            )
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
        ))}

      {missingDoc && (
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
              {isBusy
                ? "Uploading..."
                : `Upload ${missingDoc.title || "Document"}`}
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
                  onUploadCompanyDocForNote(m.id, missingDoc, f);
                }
              }}
            />
          </label>
        </div>
      )}

      {actionsExecuted.length > 0 && (
        <div className="mt-2 pt-2 border-t border-violet-200/70 flex flex-wrap gap-1.5">
          {actionsExecuted.map((act, idx) => (
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
          ))}
        </div>
      )}

      {suggestedReply && (
        <div className="mt-2 pt-2 border-t border-violet-200/70 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-violet-900">
            Suggested reply ready:
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(suggestedReply);
                onCopyToast("Suggested reply copied.");
              }}
              className="px-2 py-1 rounded bg-white border border-violet-200 text-violet-900 text-[11px] font-medium cursor-pointer"
            >
              Copy
            </button>
            {isAssignedToCurrentUser && (
              <button
                type="button"
                onClick={() => onUseSuggestedReply(suggestedReply)}
                className="px-2.5 py-1 rounded bg-violet-700 hover:bg-violet-800 text-white text-[11px] font-semibold cursor-pointer"
              >
                Use Reply
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
