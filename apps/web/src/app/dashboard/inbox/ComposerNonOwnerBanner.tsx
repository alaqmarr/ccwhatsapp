"use client";

import React from "react";
import { AtSign, Loader2, Lock, ShieldCheck, UserCheck } from "lucide-react";
import { MentionTextarea } from "@/components/MentionTextarea";
import type { StaffOption } from "@/lib/inbox-server-data";

export function ComposerNonOwnerBanner({
  isAcrioHandling,
  assignedStaffName,
  assignedTeamName,
  showNoteForNonOwner,
  setShowNoteForNonOwner,
  setComposerMode,
  windowOpen,
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
  windowOpen?: boolean;
  takingOver: boolean;
  onTakeOverChat: () => void;
  composerInputRef: React.RefObject<HTMLTextAreaElement | null>;
  staffList: StaffOption[];
  replyText: string;
  setReplyText: (next: string | ((prev: string) => string)) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const firstAssignee = assignedStaffName?.split(" ")[0] || "Teammate";

  return (
    <div className="px-2.5 sm:px-4 py-2 border-t border-[#d1d7db] bg-[#f8fafc] space-y-2 shrink-0">
      <div className="rounded-lg border border-amber-200 bg-white px-2.5 sm:px-3.5 py-2 shadow-2xs flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-neutral-900 truncate">
              {isAcrioHandling ? (
                "Handled by ACRIO"
              ) : (
                <>
                  <span className="sm:hidden">Handled by {firstAssignee}</span>
                  <span className="hidden sm:inline">
                    Currently handled by {assignedStaffName || "another teammate"}
                    {assignedTeamName ? ` (${assignedTeamName})` : ""}
                  </span>
                </>
              )}
            </div>
            <p className="hidden sm:block text-[11px] text-neutral-600 truncate">
              Take over the chat to reply, or type @ to ping a teammate.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setShowNoteForNonOwner((prev) => {
                const next = !prev;
                if (next && !replyText.trim().startsWith("@")) {
                  setReplyText((cur) => (cur.includes("@") ? cur : `@${cur}`));
                }
                return next;
              });
              setTimeout(() => composerInputRef.current?.focus(), 20);
            }}
            title="Ping a teammate or @ACRIO privately"
            className={`px-2 py-1.5 rounded-lg border text-xs font-medium cursor-pointer inline-flex items-center gap-1 ${
              showNoteForNonOwner
                ? "border-amber-400 bg-amber-100 text-amber-950"
                : "border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-700"
            }`}
          >
            <AtSign className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ping</span>
          </button>
          <button
            type="button"
            disabled={takingOver}
            onClick={onTakeOverChat}
            className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1 shadow-2xs disabled:opacity-50 whitespace-nowrap"
          >
            {takingOver ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <UserCheck className="w-3.5 h-3.5" />
            )}
            <span className="sm:hidden">
              {takingOver ? "..." : "Take Over"}
            </span>
            <span className="hidden sm:inline">
              {takingOver
                ? "Taking over..."
                : isAcrioHandling
                ? "Take Over Chat"
                : `Take Over from ${firstAssignee}`}
            </span>
          </button>
        </div>
      </div>

      {showNoteForNonOwner && (
        <form
          onSubmit={(e) => {
            setComposerMode("NOTE");
            onSubmit(e);
            setShowNoteForNonOwner(false);
            setComposerMode(windowOpen ? "REPLY" : "TEMPLATE");
          }}
          className="flex items-end gap-1.5 bg-[#fef9e7] border border-amber-200 rounded-lg p-2"
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
                setComposerMode("NOTE");
                onSubmit(e);
                setShowNoteForNonOwner(false);
                setComposerMode(windowOpen ? "REPLY" : "TEMPLATE");
              }
            }}
            placeholder="@teammate or @ACRIO (private note only)..."
            className="w-full rounded-md px-2.5 py-1.5 text-xs bg-white border border-amber-300 focus:outline-none focus:border-amber-500 resize-none"
          />
          <button
            type="submit"
            disabled={!replyText.trim()}
            className="h-9 px-3 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 shrink-0"
          >
            <Lock className="w-3 h-3" />
            <span>Note</span>
          </button>
        </form>
      )}
    </div>
  );
}
