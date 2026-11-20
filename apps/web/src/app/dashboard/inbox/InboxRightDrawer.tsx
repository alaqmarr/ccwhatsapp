"use client";

import React from "react";
import { ArrowLeft, ChevronsRight, Copy, FileText, Plus, Sparkles } from "lucide-react";
import { ElementErrorState, RightDrawerSkeleton } from "@cc/ui";
import type { NormalizedMessageMedia } from "@/components/MediaAttachmentTools";
import type {
  ChatMessage,
  ConversationDetailBundle,
  CustomerSharedMediaRecord,
  StaffOption,
} from "@/lib/inbox-server-data";
import { useInboxStore } from "@/lib/inbox-store";
import {
  RightDrawerProfileTab,
  type SaveCustomerProfilePayload,
} from "./RightDrawerProfileTab";
import {
  RightDrawerHistoryTab,
  RightDrawerMediaTab,
  RightDrawerNotesTab,
  RightDrawerOrdersTab,
} from "./RightDrawerActivityTabs";

export function InboxRightDrawer({
  selectedId,
  detail,
  internalNotes,
  unifiedSharedMedia,
  staffList,
  nowMs,
  windowOpen,
  syncingThread,
  detailError,
  isAssignedToCurrentUser,
  summarizingChat,
  onRetryDetail,
  onCopyToast,
  onGenerateSummary,
  onOpenTemplateDialog,
  onUseAiDraft,
  onSaveProfile,
  onAddCollaborator,
  onRemoveCollaborator,
  onAddOrder,
  onOpenTrackPopoverForOrder,
  onSaveQuickNote,
  onOpenNewChatWithPhone,
  onOpenMediaPreview,
}: {
  selectedId: string | null;
  detail: ConversationDetailBundle | null;
  internalNotes: ChatMessage[];
  unifiedSharedMedia: CustomerSharedMediaRecord[];
  staffList: StaffOption[];
  nowMs: number;
  windowOpen: boolean;
  syncingThread: boolean;
  detailError: string;
  isAssignedToCurrentUser: boolean;
  summarizingChat: boolean;
  onRetryDetail: () => void;
  onCopyToast: (msg: string) => void;
  onGenerateSummary: () => void;
  onOpenTemplateDialog: () => void;
  onUseAiDraft: (reply: string) => void;
  onSaveProfile: (payload: SaveCustomerProfilePayload) => Promise<void>;
  onAddCollaborator: (staffId: string) => Promise<void>;
  onRemoveCollaborator: (staffId: string) => Promise<void>;
  onAddOrder: (order: {
    itemsSummary: string;
    quantity: number;
    totalAmountInr: number;
  }) => Promise<void>;
  onOpenTrackPopoverForOrder: (prefill: {
    orderId: string;
    itemsSummary: string;
  }) => void;
  onSaveQuickNote: (noteText: string) => Promise<void>;
  onOpenNewChatWithPhone: (phone: string, rawDisplay: string) => void;
  onOpenMediaPreview: (media: NormalizedMessageMedia) => void;
}) {
  const mobilePane = useInboxStore((s) => s.mobilePane);
  const setMobilePane = useInboxStore((s) => s.setMobilePane);
  const showRightDrawer = useInboxStore((s) => s.showRightDrawer);
  const setShowRightDrawer = useInboxStore((s) => s.setShowRightDrawer);
  const rightTab = useInboxStore((s) => s.rightTab);
  const setRightTab = useInboxStore((s) => s.setRightTab);

  const activeConv = detail?.conversation || null;

  return (
    <div
      className={`${
        mobilePane === "INFO"
          ? "flex w-full min-w-0 h-full overflow-hidden"
          : "hidden"
      } ${
        showRightDrawer
          ? "lg:flex lg:w-[330px] xl:w-[360px] lg:border-l lg:border-[#d1d7db] lg:opacity-100"
          : "lg:flex lg:w-0 lg:border-l-0 lg:opacity-0 lg:pointer-events-none"
      } shrink-0 bg-white flex-col overflow-hidden transition-[width,opacity] duration-200`}
    >
      <div className="w-full lg:min-w-[330px] xl:min-w-[360px] flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="hidden lg:flex h-[38px] px-3 bg-[#f0f2f5] border-b border-[#d1d7db] items-center justify-between shrink-0">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#54656f]">
            Customer details
          </span>
          <button
            type="button"
            onClick={() => setShowRightDrawer(false)}
            title="Hide customer panel (Alt+D)"
            aria-label="Hide customer details panel"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-[#d1d7db] hover:bg-neutral-50 text-[11px] font-medium text-[#3b4a54] cursor-pointer"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
            <span>Hide</span>
          </button>
        </div>

        <div className="lg:hidden h-[50px] px-3.5 bg-[#f0f2f5] border-b border-[#d1d7db] flex items-center justify-between shrink-0">
        <button
          type="button"
          onClick={() => setMobilePane("CHAT")}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#111b21] cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Chat</span>
        </button>
        <span className="text-xs font-semibold text-[#54656f] truncate max-w-[180px]">
          {activeConv?.customerName || "Customer Details"}
        </span>
      </div>

      {activeConv && (
        <div className="px-3.5 py-2.5 bg-slate-50 border-b border-[#e9edef] space-y-2 text-xs shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold text-slate-900 truncate">
                {detail?.customer?.name || activeConv.customerName}
              </div>
              <div className="text-[11px] font-mono text-slate-500 flex items-center gap-1.5">
                <span>{activeConv.customerPhone}</span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(activeConv.customerPhone);
                    onCopyToast("Phone copied.");
                  }}
                  title="Copy number"
                  className="p-0.5 rounded hover:bg-slate-200 text-slate-500 cursor-pointer"
                >
                  <Copy className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-[10.5px] font-semibold text-slate-700 shrink-0">
              {detail?.customer?.city || "No city"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1 text-[10.5px] text-slate-600">
            <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold">
              {detail?.customer?.acrioSegment || "WhatsApp Lead"}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-white border border-neutral-200 font-medium">
              {detail?.orders?.length
                ? `${detail.orders.length} order${
                    detail.orders.length > 1 ? "s" : ""
                  } • ₹${(detail.customer?.lifetimeValueInr || 0).toLocaleString(
                    "en-IN"
                  )}`
                : "0 orders"}
            </span>
            {detail?.customer?.preferredStaffName && (
              <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800 font-medium">
                Prefers: {detail.customer.preferredStaffName}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <button
              type="button"
              disabled={summarizingChat}
              onClick={onGenerateSummary}
              className="px-2 py-1 rounded bg-violet-50 hover:bg-violet-100 text-violet-900 border border-violet-200 text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3" />
              <span>{summarizingChat ? "..." : "Summary"}</span>
            </button>
            <button
              type="button"
              onClick={() => setRightTab("ORDERS")}
              className="px-2 py-1 rounded bg-white hover:bg-slate-100 text-slate-800 border border-neutral-200 text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3 h-3 text-[#008069]" />
              <span>Order</span>
            </button>
            {isAssignedToCurrentUser && (
              <button
                type="button"
                onClick={onOpenTemplateDialog}
                className="px-2 py-1 rounded bg-white hover:bg-slate-100 text-slate-800 border border-neutral-200 text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <FileText className="w-3 h-3 text-[#008069]" />
                <span>Template</span>
              </button>
            )}
            {windowOpen && detail?.acrio?.suggestedReplies?.[0] && isAssignedToCurrentUser && (
              <button
                type="button"
                onClick={() => onUseAiDraft(detail.acrio!.suggestedReplies[0])}
                title="Insert ACRIO's suggested reply into the composer"
                className="px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                <span>AI Draft</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-5 border-b border-[#e9edef] text-[10.5px] font-semibold shrink-0 bg-[#f0f2f5]">
        {(
          [
            { key: "PROFILE", label: "Details" },
            { key: "ORDERS", label: `Orders (${detail?.orders.length || 0})` },
            { key: "NOTES", label: `Notes (${internalNotes.length})` },
            { key: "MEDIA", label: `Media (${unifiedSharedMedia.length})` },
            { key: "HISTORY", label: "Logs" },
          ] as const
        ).map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setRightTab(tb.key)}
            className={`py-2.5 text-center border-b-2 cursor-pointer transition-colors truncate px-1 ${
              rightTab === tb.key
                ? "border-[#00a884] text-[#008069] bg-white"
                : "border-transparent text-[#54656f] hover:text-[#111b21]"
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
        {!detail ? (
          selectedId && syncingThread ? (
            <RightDrawerSkeleton />
          ) : selectedId && detailError ? (
            <ElementErrorState
              compact
              title="Customer details unavailable"
              message={detailError}
              onRetry={onRetryDetail}
              retrying={syncingThread}
            />
          ) : (
            <p className="text-xs text-[#667781]">
              Select a chat to view customer details.
            </p>
          )
        ) : rightTab === "PROFILE" ? (
          <RightDrawerProfileTab
            detail={detail}
            staffList={staffList}
            unifiedMedia={unifiedSharedMedia}
            onOpenMediaTab={() => setRightTab("MEDIA")}
            onOpenPreview={onOpenMediaPreview}
            onSaveProfile={onSaveProfile}
            onAddCollaborator={onAddCollaborator}
            onRemoveCollaborator={onRemoveCollaborator}
          />
        ) : rightTab === "ORDERS" ? (
          <RightDrawerOrdersTab
            detail={detail}
            onAddOrder={onAddOrder}
            onOpenTrackPopoverForOrder={onOpenTrackPopoverForOrder}
          />
        ) : rightTab === "NOTES" ? (
          <RightDrawerNotesTab
            internalNotes={internalNotes}
            staffList={staffList}
            summarizingChat={summarizingChat}
            onGenerateSummary={onGenerateSummary}
            onSaveQuickNote={onSaveQuickNote}
            onPhoneClick={onOpenNewChatWithPhone}
          />
        ) : rightTab === "MEDIA" ? (
          <RightDrawerMediaTab
            items={unifiedSharedMedia}
            customerPhone={detail.conversation.customerPhone}
            onOpenPreview={onOpenMediaPreview}
            onCopyToast={onCopyToast}
          />
        ) : (
          <RightDrawerHistoryTab detail={detail} nowMs={nowMs} />
        )}
      </div>
      </div>
    </div>
  );
}
