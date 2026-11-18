"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  FileAudio,
  FileText,
  Image as ImageIcon,
  Lock,
  Plus,
  Sparkles,
  Truck,
  Video,
} from "lucide-react";
import {
  TRACKING_PUBLIC_ORIGIN,
  WhatsAppFormattedText,
  formatDateIst,
  formatDateShortIst,
} from "@cc/ui";
import type { NormalizedMessageMedia } from "@/components/MediaAttachmentTools";
import { MentionTextarea } from "@/components/MentionTextarea";
import type {
  ChatMessage,
  ConversationDetailBundle,
  StaffOption,
} from "@/lib/inbox-server-data";
import {
  emphasizeMentions,
  formatDateTimeShort,
  formatResponseSpeed,
  formatWaitingDuration,
} from "./inbox-helpers";

export function RightDrawerOrdersTab({
  detail,
  onAddOrder,
  onOpenTrackPopoverForOrder,
}: {
  detail: ConversationDetailBundle;
  onAddOrder: (order: {
    itemsSummary: string;
    quantity: number;
    totalAmountInr: number;
  }) => Promise<void>;
  onOpenTrackPopoverForOrder: (prefill: {
    orderId: string;
    itemsSummary: string;
  }) => void;
}) {
  const [newOrderItems, setNewOrderItems] = useState("");
  const [newOrderQty, setNewOrderQty] = useState(1);
  const [newOrderAmount, setNewOrderAmount] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newOrderItems.trim()) return;
    await onAddOrder({
      itemsSummary: newOrderItems,
      quantity: newOrderQty,
      totalAmountInr: Number(newOrderAmount || 0),
    });
    setNewOrderItems("");
    setNewOrderQty(1);
    setNewOrderAmount("");
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="p-3 rounded-lg bg-[#f8f9fa] border border-[#e9edef] space-y-2.5"
      >
        <div className="text-xs font-semibold text-neutral-800 flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          <span>Add New Order</span>
        </div>
        <input
          type="text"
          required
          value={newOrderItems}
          onChange={(e) => setNewOrderItems(e.target.value)}
          placeholder="Items or machine model ordered"
          className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            min={1}
            value={newOrderQty}
            onChange={(e) => setNewOrderQty(Number(e.target.value))}
            placeholder="Qty"
            className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs"
          />
          <input
            type="number"
            min={0}
            value={newOrderAmount}
            onChange={(e) => setNewOrderAmount(e.target.value)}
            placeholder="Total ₹"
            className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs"
          />
        </div>
        <button
          type="submit"
          className="w-full py-1.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer"
        >
          Save Order
        </button>
      </form>

      {detail.orders.length === 0 ? (
        <p className="text-xs text-neutral-500 text-center py-4">
          No orders recorded for this customer yet.
        </p>
      ) : (
        <div className="space-y-2.5">
          {detail.orders.map((o) => {
            const linkedTrack = (detail.orderTrackings || []).find(
              (t) => t.orderId.toUpperCase() === o.orderNumber.toUpperCase()
            );
            return (
              <div
                key={o.id}
                className="p-3 rounded-lg border border-neutral-200 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-neutral-900">
                    {o.orderNumber}
                  </span>
                  <span className="text-xs font-semibold text-emerald-700">
                    ₹{o.totalAmountInr.toLocaleString("en-IN")}
                  </span>
                </div>
                <p className="text-xs text-neutral-700">{o.itemsSummary}</p>
                <div className="flex items-center justify-between text-[11px] text-neutral-500 pt-1">
                  <span>Qty: {o.quantity}</span>
                  <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 font-medium">
                    {linkedTrack?.shipmentStatus || o.fulfillmentStatus}
                  </span>
                </div>
                {linkedTrack && (
                  <div className="text-[10.5px] font-mono text-[#008069] truncate">
                    {linkedTrack.providerName}
                    {linkedTrack.awbNumber ? ` • AWB ${linkedTrack.awbNumber}` : ""}
                  </div>
                )}
                <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-neutral-100">
                  <a
                    href={`${TRACKING_PUBLIC_ORIGIN}/${encodeURIComponent(o.orderNumber)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-mono text-neutral-600 hover:text-[#008069] truncate"
                  >
                    track.ccapl.cc/{o.orderNumber}
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenTrackPopoverForOrder({
                        orderId: o.orderNumber,
                        itemsSummary: o.itemsSummary,
                      })
                    }
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#e7fce3] hover:bg-[#d9fdd3] text-[#008069] text-[11px] font-semibold cursor-pointer shrink-0"
                  >
                    <Truck className="w-3 h-3" />
                    <span>Track Button</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function RightDrawerNotesTab({
  internalNotes,
  staffList,
  summarizingChat,
  onGenerateSummary,
  onSaveQuickNote,
  onPhoneClick,
}: {
  internalNotes: ChatMessage[];
  staffList: StaffOption[];
  summarizingChat: boolean;
  onGenerateSummary: () => void;
  onSaveQuickNote: (noteText: string) => Promise<void>;
  onPhoneClick: (phone: string, rawDisplay: string) => void;
}) {
  const [quickNoteDraft, setQuickNoteDraft] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = quickNoteDraft.trim();
    if (!text) return;
    setQuickNoteDraft("");
    await onSaveQuickNote(text);
  }

  return (
    <div className="space-y-3.5">
      <div className="p-2.5 rounded-lg bg-violet-50 border border-violet-200 flex items-center justify-between gap-2">
        <div className="text-[11px] text-violet-950 font-medium">
          Need a recap? Let ACRIO post a private summary note.
        </div>
        <button
          type="button"
          disabled={summarizingChat}
          onClick={onGenerateSummary}
          className="shrink-0 px-2.5 py-1 rounded bg-violet-700 hover:bg-violet-800 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
        >
          <Sparkles className="w-3 h-3" />
          <span>{summarizingChat ? "Working..." : "Generate Summary"}</span>
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-3 rounded-lg bg-[#fef9e7] border border-amber-200 space-y-2"
      >
        <div className="text-xs font-semibold text-amber-950 flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-amber-700" />
          <span>Add Internal Team Note</span>
        </div>
        <MentionTextarea
          rows={2}
          people={staffList.map((s) => ({
            id: s.id,
            name: s.name,
            role: s.role,
          }))}
          value={quickNoteDraft}
          onChange={(v) => setQuickNoteDraft(v)}
          placeholder="Private note. Type @ to ping a teammate or ask @ACRIO a question..."
          className="w-full rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs"
        />
        <button
          type="submit"
          disabled={!quickNoteDraft.trim()}
          className="w-full py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium cursor-pointer disabled:opacity-50"
        >
          Post Internal Note
        </button>
      </form>

      {internalNotes.length === 0 ? (
        <p className="text-xs text-neutral-500 text-center py-4">
          No internal team notes yet on this chat.
        </p>
      ) : (
        <div className="space-y-2">
          {[...internalNotes].reverse().map((n) => (
            <div
              key={n.id}
              className="p-2.5 rounded-lg bg-[#fef3c7]/70 border border-amber-200 space-y-1"
            >
              <div className="flex items-center justify-between text-[11px] font-semibold text-amber-950">
                <span>{n.senderName}</span>
                <span className="font-normal text-amber-800">
                  {formatDateShortIst(n.createdAt)}
                </span>
              </div>
              <WhatsAppFormattedText
                text={emphasizeMentions(n.body, staffList)}
                className="text-xs text-amber-950"
                onPhoneClick={onPhoneClick}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RightDrawerMediaTab({
  sharedMediaItems,
  onOpenPreview,
}: {
  sharedMediaItems: { msg: ChatMessage; media: NormalizedMessageMedia }[];
  onOpenPreview: (media: NormalizedMessageMedia) => void;
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-neutral-800">
        Shared Files &amp; Media ({sharedMediaItems.length})
      </h4>
      {sharedMediaItems.length === 0 ? (
        <p className="text-xs text-neutral-500 py-4 text-center">
          No images, PDFs, videos, or audio files shared in this chat yet.
        </p>
      ) : (
        <div className="space-y-2">
          {[...sharedMediaItems].reverse().map(({ msg, media }) => (
            <div
              key={`med_${msg.id}`}
              className="p-2.5 rounded-lg border border-neutral-200 bg-neutral-50 flex items-center justify-between gap-2.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded bg-white border border-neutral-200 flex items-center justify-center shrink-0 text-[#008069]">
                  {media.mediaType === "IMAGE" ? (
                    <ImageIcon className="w-4 h-4" />
                  ) : media.mediaType === "VIDEO" ? (
                    <Video className="w-4 h-4" />
                  ) : media.mediaType === "AUDIO" ? (
                    <FileAudio className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-neutral-900 truncate">
                    {media.fileName || media.mediaType}
                  </div>
                  <div className="text-[10.5px] text-neutral-500">
                    {msg.senderName} • {formatDateShortIst(msg.createdAt)}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenPreview(media)}
                className="px-2.5 py-1 rounded bg-white border border-neutral-300 hover:bg-neutral-100 text-[11px] font-semibold text-neutral-800 cursor-pointer shrink-0"
              >
                Open
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RightDrawerHistoryTab({
  detail,
  nowMs,
}: {
  detail: ConversationDetailBundle;
  nowMs: number;
}) {
  const activeConv = detail.conversation;
  const assignments = detail.assignments || [];

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-neutral-800">
            Assignment &amp; First-Response Log
          </h4>
          <Link
            href="/dashboard/analytics"
            className="text-[11px] font-medium text-[#008069] hover:underline"
          >
            Full Analytics
          </Link>
        </div>
        {assignments.length === 0 ? (
          <p className="text-xs text-neutral-500">No assignments logged yet.</p>
        ) : (
          <div className="space-y-2">
            {assignments.map((asg) => {
              const isSys = asg.toStaffId === "ACRIO";
              const pendingWait =
                !asg.firstResponseAt &&
                asg.outcome === "ACTIVE" &&
                !isSys &&
                activeConv.status !== "RESOLVED"
                  ? formatWaitingDuration(asg.assignedAt, nowMs)
                  : null;
              return (
                <div
                  key={asg.id}
                  className="p-2.5 rounded-lg bg-neutral-50 border border-neutral-200 space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-neutral-900 truncate">
                      {isSys
                        ? "System (ACRIO)"
                        : `${asg.toStaffName} (${asg.escalationLevel})`}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        asg.firstResponseAt
                          ? "bg-emerald-100 text-emerald-800"
                          : asg.outcome === "ESCALATED"
                          ? "bg-red-100 text-red-800"
                          : asg.outcome === "ACTIVE"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-neutral-200 text-neutral-700"
                      }`}
                    >
                      {asg.firstResponseAt
                        ? `Replied in ${formatResponseSpeed(
                            asg.firstResponseSeconds
                          )}`
                        : asg.outcome}
                    </span>
                  </div>
                  <div className="text-[11px] text-neutral-600 space-y-0.5">
                    <div>
                      <span className="text-neutral-500">Team:</span>{" "}
                      {asg.toTeamName} • by {asg.assignedByName}
                    </div>
                    <div>
                      <span className="text-neutral-500">Assigned:</span>{" "}
                      <strong>{formatDateTimeShort(asg.assignedAt)}</strong>
                    </div>
                    <div>
                      <span className="text-neutral-500">First response:</span>{" "}
                      {asg.firstResponseAt ? (
                        <strong className="text-emerald-800">
                          {formatDateTimeShort(asg.firstResponseAt)} (
                          {formatResponseSpeed(asg.firstResponseSeconds)})
                        </strong>
                      ) : pendingWait ? (
                        <strong suppressHydrationWarning className="text-amber-800">
                          Waiting {pendingWait.text}
                        </strong>
                      ) : (
                        <span>None before {asg.outcome.toLowerCase()}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-neutral-700 mb-2">
          Past WhatsApp Interactions
        </h4>
        {detail.relations.length === 0 ? (
          <p className="text-xs text-neutral-500">No earlier closed interactions.</p>
        ) : (
          <div className="space-y-2">
            {detail.relations.map((r) => (
              <div
                key={r.id}
                className="p-2.5 rounded-md bg-neutral-50 border border-neutral-200 space-y-1"
              >
                <div className="flex items-center justify-between text-[11px] text-neutral-500">
                  <span className="font-medium text-neutral-800">
                    {r.relationType}
                  </span>
                  <span>{formatDateIst(r.occurredAt)}</span>
                </div>
                <p className="text-xs text-neutral-700">{r.summary}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-neutral-700 mb-2 flex items-center justify-between">
          <span>Website Enquiries (CC &amp; CE53)</span>
          <ExternalLink className="w-3 h-3 text-neutral-400" />
        </h4>
        {detail.websiteEnquiries.length === 0 ? (
          <p className="text-xs text-neutral-500">
            No matching website form submissions for this phone/email.
          </p>
        ) : (
          <div className="space-y-2">
            {detail.websiteEnquiries.map((eq) => (
              <div
                key={eq.id}
                className="p-2.5 rounded-md bg-blue-50/50 border border-blue-200 space-y-1"
              >
                <div className="flex items-center justify-between text-[11px] text-blue-800 font-medium">
                  <span>{eq.source}</span>
                  <span>{formatDateIst(eq.createdAt)}</span>
                </div>
                <p className="text-xs text-neutral-800">{eq.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
