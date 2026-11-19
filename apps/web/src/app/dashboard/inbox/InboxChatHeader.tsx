"use client";

import React, { useState } from "react";
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  Download,
  Info,
  Link2,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Sparkles,
  UserCheck,
  Users,
} from "lucide-react";
import {
  WhatsAppLogoIcon,
  WhatsAppMessageTicks,
  formatDateTimeShortIst,
} from "@cc/ui";
import type { ChatMessage, ConversationDetailBundle } from "@/lib/inbox-server-data";
import { useInboxStore } from "@/lib/inbox-store";
import {
  formatResponseSpeed,
  formatWaitingDuration,
  formatWindowCountdown,
  getInitials,
} from "./inbox-helpers";

export function InboxChatHeader({
  detail,
  messages,
  nowMs,
  syncingThread,
  isAcrioHandling,
  hasUnreadOutboundByCustomer,
  summarizingChat,
  takingOver,
  onGenerateSummary,
  onTakeOverChat,
  onSmartAssignSalesP0,
  onOpenAssignModal,
  onOpenResolveModal,
  onReopen,
  onReturnToAcrio,
  onSimulateCustomerRead,
  onCopyToast,
}: {
  detail: ConversationDetailBundle;
  messages: ChatMessage[];
  nowMs: number;
  syncingThread: boolean;
  isAcrioHandling: boolean;
  hasUnreadOutboundByCustomer: boolean;
  summarizingChat: boolean;
  takingOver: boolean;
  onGenerateSummary: () => void;
  onTakeOverChat: () => void;
  onSmartAssignSalesP0: () => void;
  onOpenAssignModal: () => void;
  onOpenResolveModal: () => void;
  onReopen: () => void;
  onReturnToAcrio: () => void;
  onSimulateCustomerRead: () => void;
  onCopyToast: (msg: string) => void;
}) {
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const setMobilePane = useInboxStore((s) => s.setMobilePane);
  const showRightDrawer = useInboxStore((s) => s.showRightDrawer);
  const setShowRightDrawer = useInboxStore((s) => s.setShowRightDrawer);

  const activeConv = detail.conversation;
  const activeCollaborators = activeConv.collaborators || [];
  const windowStatus = formatWindowCountdown(activeConv.windowExpiresAt, nowMs);
  const showSeparatePhone =
    activeConv.customerName.trim() !== activeConv.customerPhone.trim();
  const activeWait =
    activeConv.status !== "RESOLVED" && !isAcrioHandling
      ? formatWaitingDuration(activeConv.waitingSince, nowMs)
      : null;

  return (
    <div className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-[#f0f2f5] border-b border-[#d1d7db] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2 shrink-0">
      <div className="flex items-center justify-between gap-2 min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setMobilePane("LIST")}
            aria-label="Back to chats list"
            className="lg:hidden p-1.5 rounded-md bg-white border border-[#d1d7db] text-[#111b21] hover:bg-neutral-50 cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#dfe5e7] text-[#3b4a54] flex items-center justify-center text-[11px] sm:text-xs font-bold shrink-0 relative">
            {getInitials(activeConv.customerName)}
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-[#25d366] text-white flex items-center justify-center ring-2 ring-[#f0f2f5]">
              <WhatsAppLogoIcon size={8} />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
              <h2 className="font-display text-[14px] sm:text-[16px] font-bold tracking-tight text-[#111b21] truncate max-w-full">
                {activeConv.customerName}
              </h2>
              {showSeparatePhone && (
                <span className="text-[11px] sm:text-xs font-mono font-medium text-[#54656f] truncate">
                  {activeConv.customerPhone}
                </span>
              )}
              {detail.customer?.companyName && (
                <span className="hidden sm:inline-block text-[11px] px-2 py-0.5 rounded bg-white border border-[#d1d7db] text-[#3b4a54]">
                  {detail.customer.companyName}
                </span>
              )}
              {syncingThread && (
                <span className="text-[10px] text-[#667781]">Syncing...</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10.5px] sm:text-[11px]">
              <span
                suppressHydrationWarning
                className={`font-medium ${
                  windowStatus.open ? "text-[#008069]" : "text-amber-700"
                }`}
              >
                {windowStatus.label}
              </span>

              {isAcrioHandling && activeConv.status !== "RESOLVED" && (
                <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-900 font-medium inline-flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />
                  <span className="sm:hidden">ACRIO</span>
                  <span className="hidden sm:inline">
                    Assigned to System (ACRIO)
                  </span>
                </span>
              )}

              {activeWait && (
                <span
                  suppressHydrationWarning
                  className={`px-1.5 py-0.5 rounded-full font-medium inline-flex items-center gap-1 ${
                    activeWait.minutes >= 8
                      ? "bg-red-100 text-red-800"
                      : activeWait.minutes >= 3
                      ? "bg-amber-100 text-amber-900"
                      : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  <Clock className="w-2.5 h-2.5" />
                  <span suppressHydrationWarning>
                    <span className="sm:hidden">{activeWait.text}</span>
                    <span className="hidden sm:inline">
                      Customer waiting {activeWait.text}
                    </span>
                  </span>
                </span>
              )}

              {!activeWait &&
                !isAcrioHandling &&
                activeConv.lastResponseSeconds !== null && (
                  <span className="text-[#667781]">
                    • {formatResponseSpeed(activeConv.lastResponseSeconds)}
                  </span>
                )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setMobilePane("INFO")}
          title="Customer Details & Orders"
          className="sm:hidden inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-white border border-[#d1d7db] hover:bg-neutral-50 text-[11px] font-medium text-[#3b4a54] cursor-pointer shrink-0"
        >
          <Info className="w-3.5 h-3.5 text-[#00a884]" />
          <span>Details</span>
        </button>
      </div>

      <div className="flex items-center justify-between sm:justify-end gap-1.5 relative w-full sm:w-auto pt-1 border-t border-[#e2e6ea] sm:border-0 sm:pt-0">
        {activeCollaborators.length > 0 && (
          <span
            title={`Co-handlers: ${activeCollaborators
              .map((c) => c.staffName)
              .join(", ")}`}
            className="hidden xl:inline-flex items-center gap-1 px-2 py-1 rounded-md bg-violet-50 border border-violet-200 text-violet-800 text-[11px] font-medium"
          >
            <Users className="w-3 h-3" />
            <span>+{activeCollaborators.length} shared</span>
          </span>
        )}

        <button
          type="button"
          onClick={onGenerateSummary}
          disabled={summarizingChat}
          title="Generate a private ACRIO chat summary note"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-violet-50 border border-violet-200 hover:bg-violet-100 text-violet-900 text-xs font-semibold cursor-pointer disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5 text-violet-700" />
          <span className="hidden md:inline">
            {summarizingChat ? "Summarizing..." : "Summary"}
          </span>
        </button>

        {activeConv.status !== "RESOLVED" && isAcrioHandling ? (
          <>
            <button
              type="button"
              onClick={onTakeOverChat}
              disabled={takingOver}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer shadow-2xs disabled:opacity-50"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>{takingOver ? "Taking over..." : "Take Over"}</span>
            </button>
            <button
              type="button"
              onClick={onSmartAssignSalesP0}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white border border-[#d1d7db] hover:bg-neutral-50 text-xs font-medium text-[#111b21] cursor-pointer"
              title="Connect to Sales Team P0 member with fewest active chats"
            >
              <Users className="w-3.5 h-3.5 text-[#00a884]" />
              <span className="hidden sm:inline">Assign Sales</span>
            </button>
          </>
        ) : (
          activeConv.status !== "RESOLVED" && (
            <button
              type="button"
              onClick={onOpenAssignModal}
              title="Click to reassign team, responder, or escalation tier"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white border border-[#d1d7db] hover:bg-neutral-50 text-xs text-[#111b21] cursor-pointer"
            >
              <UserCheck className="w-3.5 h-3.5 text-[#00a884]" />
              <span className="font-medium truncate max-w-[110px]">
                {activeConv.assignedStaffName ||
                  activeConv.assignedTeamName ||
                  "Sales Team"}
              </span>
              <span
                className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                  activeConv.escalationLevel === "P2"
                    ? "bg-red-600 text-white"
                    : activeConv.escalationLevel === "P1"
                    ? "bg-amber-500 text-white"
                    : "bg-neutral-100 text-neutral-700"
                }`}
              >
                {activeConv.escalationLevel || "P0"}
              </span>
            </button>
          )
        )}

        {activeConv.status === "RESOLVED" ? (
          <button
            type="button"
            onClick={onReopen}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#d1d7db] bg-white hover:bg-neutral-50 text-xs font-semibold text-[#111b21] cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reopen</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenResolveModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-[#00a884]/60 hover:bg-[#e7fce3] text-[#008069] text-xs font-semibold cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Resolve</span>
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowHeaderMenu((v) => !v)}
            title="More chat actions"
            className="p-1.5 rounded-md bg-white border border-[#d1d7db] hover:bg-neutral-50 text-[#54656f] cursor-pointer"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {showHeaderMenu && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setShowHeaderMenu(false)}
              />
              <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl bg-white border border-neutral-200 shadow-xl py-1 z-40 text-xs">
                {activeConv.status !== "RESOLVED" && !isAcrioHandling && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowHeaderMenu(false);
                      onReturnToAcrio();
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 font-medium text-indigo-800 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Hand back to System (ACRIO)</span>
                  </button>
                )}
                {hasUnreadOutboundByCustomer && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowHeaderMenu(false);
                      onSimulateCustomerRead();
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-[#0088cc] font-medium cursor-pointer"
                  >
                    <WhatsAppMessageTicks
                      status="READ"
                      showLabel={false}
                      size={13}
                    />
                    <span>Mark customer Read (test)</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowHeaderMenu(false);
                    void navigator.clipboard?.writeText(activeConv.customerPhone);
                    onCopyToast(`Copied ${activeConv.customerPhone}`);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  <span>Copy phone ({activeConv.customerPhone})</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowHeaderMenu(false);
                    const url = `${window.location.origin}/dashboard/inbox?chat=${encodeURIComponent(
                      activeConv.id
                    )}`;
                    void navigator.clipboard?.writeText(url);
                    onCopyToast("Copied direct chat link.");
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 cursor-pointer"
                >
                  <Link2 className="w-3.5 h-3.5 text-slate-500" />
                  <span>Copy direct chat link</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowHeaderMenu(false);
                    const lines = messages.map(
                      (m) =>
                        `[${formatDateTimeShortIst(m.createdAt)}] ${m.senderName} (${m.direction}): ${m.body}`
                    );
                    const blob = new Blob([lines.join("\n\n")], {
                      type: "text/plain;charset=utf-8",
                    });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `chat_${activeConv.customerPhone.replace(/\D/g, "")}.txt`;
                    a.click();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Export transcript (.txt)</span>
                </button>
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobilePane("INFO")}
          title="Customer Details & Orders"
          className="hidden sm:inline-flex lg:hidden items-center gap-1 px-2 py-1.5 rounded-md bg-white border border-[#d1d7db] hover:bg-neutral-50 text-xs font-medium text-[#3b4a54] cursor-pointer"
        >
          <Info className="w-3.5 h-3.5 text-[#00a884]" />
          <span>Details</span>
        </button>

        <button
          type="button"
          onClick={() => setShowRightDrawer((p) => !p)}
          title={
            showRightDrawer
              ? "Hide Customer Panel (Alt+D)"
              : "Show Customer Panel (Alt+D)"
          }
          className={`hidden lg:inline-flex p-1.5 rounded-md border cursor-pointer transition ${
            showRightDrawer
              ? "bg-[#e7fce3] border-[#00a884]/50 text-[#008069]"
              : "bg-white border-[#d1d7db] hover:bg-neutral-50 text-[#54656f]"
          }`}
        >
          {showRightDrawer ? (
            <PanelRightClose className="w-4 h-4" />
          ) : (
            <PanelRightOpen className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
