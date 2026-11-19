"use client";

import { create } from "zustand";
import type {
  PreSendFileConfirmationTarget,
  StagedComposerAttachment,
} from "@/components/MediaAttachmentTools";
import type { QuotedMessageRef } from "@/lib/inbox-server-data";
import type { InboxQuickFilter } from "./inbox-filter-helpers";

export const MY_LEADS_THREAD_ID = "__MY_LEADS__" as const;

export type { InboxQuickFilter };

export type InboxComposerMode = "REPLY" | "TEMPLATE" | "NOTE";
export type InboxRightTab = "PROFILE" | "ORDERS" | "NOTES" | "MEDIA" | "HISTORY";
export type InboxMobilePane = "LIST" | "CHAT" | "INFO";

interface InboxUiState {
  selectedId: string | null;
  mobilePane: InboxMobilePane;
  showRightDrawer: boolean;
  rightTab: InboxRightTab;

  // Thread list filters & bulk selection
  quickFilter: InboxQuickFilter;
  teamFilter: string;
  staffFilter: string;
  searchQuery: string;
  bulkMode: boolean;
  selectedThreadIds: string[];

  // Composer UI state (drafts stored per `${convId}|${mode}`)
  composerMode: InboxComposerMode;
  draftsByKey: Record<string, string>;
  replyingTo: QuotedMessageRef | null;
  stagedAttachment: StagedComposerAttachment | null;
  pendingSendConfirm: PreSendFileConfirmationTarget | null;
  highlightedMsgId: string | null;

  // Actions
  initSelectedId: (id: string | null) => void;
  setSelectedId: (id: string | null) => void;
  selectConversation: (id: string) => void;
  setMobilePane: (pane: InboxMobilePane) => void;
  setShowRightDrawer: (next: boolean | ((prev: boolean) => boolean)) => void;
  setRightTab: (tab: InboxRightTab) => void;

  setQuickFilter: (f: InboxQuickFilter) => void;
  setTeamFilter: (teamId: string) => void;
  setStaffFilter: (staffId: string) => void;
  setSearchQuery: (q: string) => void;
  setBulkMode: (next: boolean | ((prev: boolean) => boolean)) => void;
  setSelectedThreadIds: (ids: string[]) => void;
  toggleBulkThreadId: (id: string) => void;
  clearBulkSelection: () => void;

  setComposerMode: (mode: InboxComposerMode) => void;
  setDraft: (
    convId: string | null,
    mode: InboxComposerMode,
    next: string | ((prev: string) => string)
  ) => void;
  moveReplyDraftToNote: (convId: string | null, text: string) => void;
  setReplyingTo: (ref: QuotedMessageRef | null) => void;
  setStagedAttachment: (att: StagedComposerAttachment | null) => void;
  setPendingSendConfirm: (target: PreSendFileConfirmationTarget | null) => void;
  setHighlightedMsgId: (id: string | null) => void;
}

export function getDraftKey(
  convId: string | null | undefined,
  mode: InboxComposerMode
): string {
  return `${convId || ""}|${mode}`;
}

export const useInboxStore = create<InboxUiState>((set) => ({
  selectedId: null,
  mobilePane: "LIST",
  showRightDrawer: true,
  rightTab: "PROFILE",

  quickFilter: "MINE",
  teamFilter: "ALL",
  staffFilter: "ALL",
  searchQuery: "",
  bulkMode: false,
  selectedThreadIds: [],

  composerMode: "REPLY",
  draftsByKey: {},
  replyingTo: null,
  stagedAttachment: null,
  pendingSendConfirm: null,
  highlightedMsgId: null,

  initSelectedId: (id) =>
    set((s) => (s.selectedId === null ? { selectedId: id } : s)),

  setSelectedId: (selectedId) => set({ selectedId }),

  selectConversation: (id) =>
    set((s) =>
      s.selectedId === id
        ? { mobilePane: "CHAT" }
        : {
            selectedId: id,
            mobilePane: "CHAT",
            replyingTo: null,
            highlightedMsgId: null,
            stagedAttachment: null,
            pendingSendConfirm: null,
          }
    ),

  setMobilePane: (mobilePane) => set({ mobilePane }),
  setShowRightDrawer: (next) =>
    set((s) => {
      const value = typeof next === "function" ? next(s.showRightDrawer) : next;
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            "cc_inbox_right_drawer",
            value ? "1" : "0"
          );
        }
      } catch {
        // ignore storage errors
      }
      return { showRightDrawer: value };
    }),
  setRightTab: (rightTab) => set({ rightTab }),

  setQuickFilter: (quickFilter) => set({ quickFilter }),
  setTeamFilter: (teamFilter) => set({ teamFilter }),
  setStaffFilter: (staffFilter) => set({ staffFilter }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setBulkMode: (next) =>
    set((s) => {
      const enabled = typeof next === "function" ? next(s.bulkMode) : next;
      return enabled ? { bulkMode: true } : { bulkMode: false, selectedThreadIds: [] };
    }),
  setSelectedThreadIds: (selectedThreadIds) => set({ selectedThreadIds }),
  toggleBulkThreadId: (id) =>
    set((s) => ({
      selectedThreadIds: s.selectedThreadIds.includes(id)
        ? s.selectedThreadIds.filter((x) => x !== id)
        : [...s.selectedThreadIds, id],
    })),
  clearBulkSelection: () => set({ selectedThreadIds: [] }),

  setComposerMode: (composerMode) => set({ composerMode }),
  setDraft: (convId, mode, next) =>
    set((s) => {
      const key = getDraftKey(convId, mode);
      const prev = s.draftsByKey[key] ?? "";
      const text = typeof next === "function" ? next(prev) : next;
      if (prev === text) return s;
      return {
        draftsByKey: {
          ...s.draftsByKey,
          [key]: text,
        },
      };
    }),
  moveReplyDraftToNote: (convId, text) =>
    set((s) => ({
      composerMode: "NOTE",
      draftsByKey: {
        ...s.draftsByKey,
        [getDraftKey(convId, "NOTE")]: text,
        [getDraftKey(convId, "REPLY")]: "",
      },
    })),
  setReplyingTo: (replyingTo) => set({ replyingTo }),
  setStagedAttachment: (stagedAttachment) => set({ stagedAttachment }),
  setPendingSendConfirm: (pendingSendConfirm) => set({ pendingSendConfirm }),
  setHighlightedMsgId: (highlightedMsgId) => set({ highlightedMsgId }),
}));
