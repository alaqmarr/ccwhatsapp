"use client";

import React from "react";
import { Check, CornerUpLeft, Loader2 } from "lucide-react";
import type { ChatMessage, QuotedMessageRef } from "@/lib/inbox-server-data";
import { buildClientMergedCorrection } from "./inbox-helpers";

export function InternalNoteMistakeGuard({
  message: m,
  quotedReply,
  isBusy,
  onSendNoteInChat,
  onMoveNoteToReplyBox,
}: {
  message: ChatMessage;
  quotedReply: QuotedMessageRef | null;
  isBusy: boolean;
  onSendNoteInChat: (
    noteId: string,
    customText?: string,
    dismissOnly?: boolean
  ) => void;
  onMoveNoteToReplyBox: (text: string, quoted?: QuotedMessageRef | null) => void;
}) {
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
          Heads up: This looks like a customer reply saved in an Internal Note
          (the customer cannot see this).
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
              onMoveNoteToReplyBox(mergedText || bodyTrimmed, quotedReply)
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
}
