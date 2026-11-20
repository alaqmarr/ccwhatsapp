"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Forward,
  MessageSquare,
  Paperclip,
  Phone,
  Pin,
  RefreshCw,
  Send,
  UserCheck,
} from "lucide-react";
import {
  CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE,
  formatDateTimeShortIst,
} from "@cc/ui";
import type { MyLeadItem } from "@/app/api/leads/mine/route";
import type { StaffOption } from "@/lib/inbox-server-data";
import { useInboxStore } from "@/lib/inbox-store";

export function MyLeadsChatWindow({
  leads,
  loading,
  error,
  isAdminOrSuperadmin,
  scopeAll,
  staffList,
  currentUserId,
  onToggleScopeAll,
  onRefresh,
  onOpenChat,
  onOpenNewChatWithPhone,
  onUpdateLeadStatus,
  onForwardLead,
}: {
  leads: MyLeadItem[];
  loading: boolean;
  error: string;
  isAdminOrSuperadmin: boolean;
  scopeAll: boolean;
  staffList: StaffOption[];
  currentUserId: string;
  onToggleScopeAll: (next: boolean) => void;
  onRefresh: () => void;
  onOpenChat: (conversationId: string) => void;
  onOpenNewChatWithPhone: (phone: string) => void;
  onUpdateLeadStatus: (
    callQueueId: string,
    status: "IN_PROGRESS" | "RESOLVED"
  ) => Promise<void>;
  onForwardLead: (
    lead: MyLeadItem,
    targetStaffId: string
  ) => Promise<void>;
}) {
  const mobilePane = useInboxStore((s) => s.mobilePane);
  const setMobilePane = useInboxStore((s) => s.setMobilePane);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [forwardOpenId, setForwardOpenId] = useState<string | null>(null);
  const [forwardTargetById, setForwardTargetById] = useState<
    Record<string, string>
  >({});
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const forwardableStaff = staffList.filter(
    (s) =>
      s.role !== "DEV" &&
      s.id !== currentUserId
  );

  const handleForwardSubmit = async (lead: MyLeadItem) => {
    const targetId = forwardTargetById[lead.id] ?? "";
    setBusyId(lead.id);
    try {
      await onForwardLead(lead, targetId);
      setForwardOpenId(null);
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    if (leads.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [leads.length]);

  const handleStatusAction = async (
    lead: MyLeadItem,
    nextStatus: "IN_PROGRESS" | "RESOLVED"
  ) => {
    if (!lead.callQueueId) return;
    setBusyId(lead.id);
    try {
      await onUpdateLeadStatus(lead.callQueueId, nextStatus);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className={`${
        mobilePane === "CHAT" ? "flex w-full" : "hidden"
      } lg:flex flex-1 min-w-0 flex-col bg-[#efeae2]`}
    >
      {/* WhatsApp-style Header */}
      <div className="min-h-[58px] px-3 sm:px-4 py-2 bg-[#f0f2f5] border-b border-[#d1d7db] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setMobilePane("LIST")}
            className="lg:hidden p-1.5 rounded-full hover:bg-[#e9edef] text-[#54656f] cursor-pointer"
            title="Back to chats"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="w-10 h-10 rounded-full bg-[#00a884] text-white flex items-center justify-center shrink-0 relative">
            <UserCheck className="w-5 h-5" />
            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white text-[#008069] border border-[#b7ebaf] flex items-center justify-center">
              <Pin className="w-2.5 h-2.5" />
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-[15px] font-bold text-[#111b21] truncate">
                MY LEADS
              </h2>
              <span className="px-1.5 py-0.5 rounded bg-[#e7fce3] text-[#008069] text-[10px] font-semibold border border-[#b7ebaf]">
                Pinned
              </span>
            </div>
            <p className="text-[11.5px] text-[#54656f] truncate">
              {scopeAll
                ? `Showing all team assigned leads (${leads.length})`
                : `Your assigned leads (${leads.length} total)`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isAdminOrSuperadmin && (
            <div className="inline-flex rounded-lg bg-white border border-[#d1d7db] p-0.5 text-[11px] font-medium">
              <button
                type="button"
                onClick={() => onToggleScopeAll(false)}
                className={`px-2 py-1 rounded-md cursor-pointer ${
                  !scopeAll
                    ? "bg-[#e7fce3] text-[#008069] font-semibold"
                    : "text-[#54656f] hover:text-[#111b21]"
                }`}
              >
                My Leads
              </button>
              <button
                type="button"
                onClick={() => onToggleScopeAll(true)}
                className={`px-2 py-1 rounded-md cursor-pointer ${
                  scopeAll
                    ? "bg-[#e7fce3] text-[#008069] font-semibold"
                    : "text-[#54656f] hover:text-[#111b21]"
                }`}
              >
                All Staff
              </button>
            </div>
          )}

          <Link
            href="/dashboard/call-queue"
            className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-[#d1d7db] hover:bg-[#f5f6f6] text-[11px] font-medium text-[#111b21]"
          >
            <ExternalLink className="w-3 h-3" />
            <span>Call Queue</span>
          </Link>

          <button
            type="button"
            onClick={onRefresh}
            title="Refresh MY LEADS"
            className="p-2 rounded-full hover:bg-[#e9edef] text-[#54656f] cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Chat-like Timeline Body */}
      <div
        style={CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE}
        className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-3"
      >
        <div className="flex justify-center">
          <div className="bg-white/95 border border-[#d1d7db] text-[#54656f] text-[11px] rounded-lg px-3 py-1.5 shadow-2xs text-center max-w-lg">
            Leads assigned to you from WhatsApp (&quot;assign&quot;), Call Queue,
            and direct chat assignments appear here automatically.
          </div>
        </div>

        {error && (
          <div className="max-w-lg mx-auto rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {loading && leads.length === 0 ? (
          <div className="max-w-md mx-auto bg-white/95 border border-[#d1d7db] rounded-xl p-5 text-center text-xs text-[#54656f]">
            Loading your assigned leads...
          </div>
        ) : leads.length === 0 ? (
          <div className="max-w-md mx-auto bg-white/95 border border-[#d1d7db] rounded-xl p-6 text-center space-y-2 shadow-xs">
            <div className="mx-auto w-10 h-10 rounded-full bg-[#e7fce3] text-[#00a884] flex items-center justify-center">
              <UserCheck className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-[#111b21]">
              No leads assigned yet
            </h3>
            <p className="text-xs text-[#54656f] leading-relaxed">
              When the owner sends &quot;assign&quot; on WhatsApp or a customer
              chat is assigned to you, the full lead details will show up right
              here.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-w-3xl">
            {leads.map((lead) => (
              <div
                key={lead.id}
                className="bg-white border border-[#d1d7db] rounded-xl rounded-tl-xs px-3.5 py-2.5 shadow-2xs space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <span className="text-[12px] font-bold text-[#008069]">
                      {lead.sourceLabel}
                    </span>
                    <span className="text-[11px] text-[#667781]">
                      from {lead.ownerOrAssignerName}
                    </span>
                    {scopeAll && lead.staffName && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 text-[10px] font-medium">
                        Assigned: {lead.staffName}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {lead.priority === "URGENT" || lead.priority === "HIGH" ? (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          lead.priority === "URGENT"
                            ? "bg-red-100 text-red-800"
                            : "bg-amber-100 text-amber-900"
                        }`}
                      >
                        {lead.priority}
                      </span>
                    ) : null}
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        lead.status === "RESOLVED"
                          ? "bg-emerald-50 text-emerald-700"
                          : lead.status === "DELIVERED"
                          ? "bg-[#e7fce3] text-[#008069]"
                          : lead.status === "IN_PROGRESS"
                          ? "bg-blue-50 text-blue-800"
                          : "bg-[#f0f2f5] text-[#3b4a54]"
                      }`}
                    >
                      {lead.status.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-[#111b21]">
                    <span>{lead.customerName}</span>
                    {lead.customerPhone && (
                      <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#54656f] bg-[#f0f2f5] px-2 py-0.5 rounded">
                        <Phone className="w-3 h-3" />
                        {lead.customerPhone}
                      </span>
                    )}
                    {lead.attachmentCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#54656f] bg-[#f0f2f5] px-2 py-0.5 rounded">
                        <Paperclip className="w-3 h-3" />
                        {lead.attachmentCount}{" "}
                        {lead.attachmentCount === 1 ? "attachment" : "attachments"}
                      </span>
                    )}
                  </div>

                  {lead.title && (
                    <div className="text-[12px] font-medium text-[#3b4a54]">
                      {lead.title}
                    </div>
                  )}

                  {lead.body && (
                    <p className="text-[13px] text-[#111b21] whitespace-pre-wrap break-words leading-relaxed">
                      {lead.body}
                    </p>
                  )}

                  {lead.deliveryNote && (
                    <p className="text-[11px] text-[#667781]">
                      Note: {lead.deliveryNote}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#f0f2f5]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {lead.conversationId && (
                      <button
                        type="button"
                        onClick={() => onOpenChat(lead.conversationId!)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-[11px] font-medium cursor-pointer"
                      >
                        <MessageSquare className="w-3 h-3" />
                        <span>Open Chat</span>
                      </button>
                    )}

                    {lead.customerPhone && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenNewChatWithPhone(lead.customerPhone)
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#f0f2f5] hover:bg-[#e9edef] text-[#111b21] text-[11px] font-medium cursor-pointer"
                      >
                        <Send className="w-3 h-3" />
                        <span>Send Template</span>
                      </button>
                    )}

                    {lead.callQueueId && lead.status === "PENDING" && (
                      <button
                        type="button"
                        disabled={busyId === lead.id}
                        onClick={() =>
                          void handleStatusAction(lead, "IN_PROGRESS")
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-800 text-[11px] font-medium cursor-pointer disabled:opacity-50"
                      >
                        <span>Pick Up</span>
                      </button>
                    )}

                    {lead.callQueueId && lead.status !== "RESOLVED" && (
                      <button
                        type="button"
                        disabled={busyId === lead.id}
                        onClick={() =>
                          void handleStatusAction(lead, "RESOLVED")
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-medium cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Mark Done</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={busyId === lead.id}
                      onClick={() =>
                        setForwardOpenId((prev) =>
                          prev === lead.id ? null : lead.id
                        )
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-[11px] font-medium cursor-pointer disabled:opacity-50"
                    >
                      <Forward className="w-3 h-3" />
                      <span>Forward Lead</span>
                    </button>
                  </div>

                  <span
                    suppressHydrationWarning
                    className="text-[10.5px] text-[#667781] tabular-nums"
                  >
                    {formatDateTimeShortIst(lead.createdAt)}
                  </span>
                </div>

                {forwardOpenId === lead.id && (
                  <div className="pt-2 border-t border-[#f0f2f5] flex flex-wrap items-center gap-1.5">
                    <select
                      value={forwardTargetById[lead.id] ?? ""}
                      onChange={(e) =>
                        setForwardTargetById((prev) => ({
                          ...prev,
                          [lead.id]: e.target.value,
                        }))
                      }
                      className="px-2.5 py-1.5 rounded-lg border border-[#d1d7db] bg-white text-[11.5px] text-[#111b21]"
                    >
                      <option value="">Next in A-Z Sequence (Auto)</option>
                      {forwardableStaff.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name} ({st.department})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busyId === lead.id}
                      onClick={() => void handleForwardSubmit(lead)}
                      className="px-3 py-1.5 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-[11.5px] font-semibold cursor-pointer disabled:opacity-50"
                    >
                      {busyId === lead.id ? "Forwarding..." : "Send Lead"}
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Bottom Read-Only Info Bar */}
      <div className="px-4 py-2.5 bg-[#f0f2f5] border-t border-[#d1d7db] text-[11.5px] text-[#54656f] text-center shrink-0">
        This pinned chat collects all leads assigned to you. Use Open Chat or
        Send Template on any lead to follow up with the customer.
      </div>
    </div>
  );
}
