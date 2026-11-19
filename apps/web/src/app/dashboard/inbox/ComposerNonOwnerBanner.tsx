"use client";

import React from "react";
import { Loader2, Lock, ShieldCheck, UserCheck } from "lucide-react";
import { MentionTextarea } from "@/components/MentionTextarea";
import type { StaffOption } from "@/lib/inbox-server-data";

export function ComposerNonOwnerBanner({
  isAcrioHandling,
  assignedStaffName,
  assignedTeamName,
  showNoteForNonOwner,
  setShowNoteForNonOwner,
  setComposerMode,
  composerMode,
  takingOver,
  onTakeOverChat,
  composerInputRef,
  staffList,
  replyText,
  setReplyText,
  onSubmit,
}: {
  isAcrioHandling: boolean;
  assignedStaffName?: string | null;
  assignedTeamName?: string | null;
  showNoteForNonOwner: boolean;
  setShowNoteForNonOwner: React.Dispatch<React.SetStateAction<boolean>>;
  setComposerMode: (m: "REPLY" | "TEMPLATE" | "NOTE") => void;
  composerMode: "REPLY" | "TEMPLATE" | "NOTE";
  takingOver: boolean;
  onTakeOverChat: () => void;
  composerInputRef: React.RefObject<HTMLTextAreaElement | null>;
  staffList: StaffOption[];
  replyText: string;
  setReplyText: (next: string | ((prev: string) => string)) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
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
                    assignedStaffName || "another teammate"
                  }${assignedTeamName ? ` (${assignedTeamName})` : ""}`}
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
                    assignedStaffName?.split(" ")[0] || "Teammate"
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
  );
}
