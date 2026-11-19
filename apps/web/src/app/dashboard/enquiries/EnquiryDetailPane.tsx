"use client";

import React from "react";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  MessageSquare,
  Package,
  Phone,
  Send,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { formatDateTimeIst } from "@cc/ui";
import {
  buildDirectWaMeLink,
  type EcosystemEnquiry,
} from "./enquiries-types";

export default function EnquiryDetailPane({
  selectedEnquiry,
  replyText,
  setReplyText,
  pendingAiDraft,
  setPendingAiDraft,
  customTone,
  setCustomTone,
  aiDrafting,
  sendingChannel,
  banner,
  onDraftWithAcrio,
  onSendReply,
}: {
  selectedEnquiry: EcosystemEnquiry | null;
  replyText: string;
  setReplyText: (v: string) => void;
  pendingAiDraft: string | null;
  setPendingAiDraft: (v: string | null) => void;
  customTone: string;
  setCustomTone: (v: string) => void;
  aiDrafting: boolean;
  sendingChannel: "EMAIL" | "WHATSAPP" | "BOTH" | null;
  banner: { type: "success" | "error"; text: string } | null;
  onDraftWithAcrio: (toneInstruction?: string) => void;
  onSendReply: (channel: "EMAIL" | "WHATSAPP" | "BOTH") => void;
}) {
  return (
    <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
      {!selectedEnquiry ? (
        <div className="p-12 text-center text-slate-400 space-y-2">
          <Mail className="w-10 h-10 mx-auto opacity-40" />
          <div className="text-sm font-semibold text-slate-600">
            Select an enquiry from the left to view details and send a reply
          </div>
        </div>
      ) : (
        <div className="p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-2.5 py-0.5 rounded-md text-xs font-bold ${
                    selectedEnquiry.brand === "CLASSIC_EDGE_53"
                      ? "bg-purple-100 text-purple-800 border border-purple-200"
                      : "bg-blue-100 text-blue-800 border border-blue-200"
                  }`}
                >
                  {selectedEnquiry.brandLabel}
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    selectedEnquiry.status === "Replied"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {selectedEnquiry.status === "Replied" ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <Clock className="w-3.5 h-3.5" />
                  )}
                  {selectedEnquiry.status}
                </span>
              </div>
              <h2 className="text-xl font-extrabold text-slate-900 pt-1">
                {selectedEnquiry.customerName}
              </h2>
              <p className="text-xs text-slate-500">
                Received on {formatDateTimeIst(selectedEnquiry.createdAt)} • Source:{" "}
                <span className="font-medium text-slate-700">{selectedEnquiry.source}</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedEnquiry.conversationId && (
                <Link
                  href={`/dashboard/inbox?conversationId=${encodeURIComponent(
                    selectedEnquiry.conversationId
                  )}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Open in Customer Chats
                </Link>
              )}
              {selectedEnquiry.customerPhone && (
                <a
                  href={buildDirectWaMeLink(selectedEnquiry, replyText)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  wa.me Link
                </a>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200/80 text-xs">
            <div>
              <div className="text-[10.5px] font-bold uppercase text-slate-400">
                Email Address
              </div>
              <div className="font-semibold text-slate-800 mt-0.5 truncate">
                {selectedEnquiry.customerEmail ? (
                  <a
                    href={`mailto:${selectedEnquiry.customerEmail}`}
                    className="text-blue-600 hover:underline inline-flex items-center gap-1"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {selectedEnquiry.customerEmail}
                  </a>
                ) : (
                  "Not provided"
                )}
              </div>
            </div>

            <div>
              <div className="text-[10.5px] font-bold uppercase text-slate-400">
                Phone / WhatsApp
              </div>
              <div className="font-semibold text-slate-800 mt-0.5">
                {selectedEnquiry.customerPhone ? (
                  <a
                    href={`tel:${selectedEnquiry.customerPhone}`}
                    className="text-slate-800 hover:text-blue-600 inline-flex items-center gap-1"
                  >
                    <Phone className="w-3.5 h-3.5 text-emerald-600" />
                    {selectedEnquiry.customerPhone}
                  </a>
                ) : (
                  "Not provided"
                )}
              </div>
            </div>

            <div>
              <div className="text-[10.5px] font-bold uppercase text-slate-400">
                Website / Item
              </div>
              <div className="font-semibold text-slate-800 mt-0.5 truncate inline-flex items-center gap-1">
                {selectedEnquiry.productName ? (
                  <>
                    <Package className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span className="truncate">{selectedEnquiry.productName}</span>
                  </>
                ) : (
                  <>
                    <Globe className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>General Website Enquiry</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Customer Enquiry Message
            </div>
            <div className="p-3.5 sm:p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800 whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed">
              {selectedEnquiry.message}
            </div>
          </div>

          {selectedEnquiry.lastReplyText && (
            <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Last Reply Sent{" "}
                  {selectedEnquiry.lastReplyChannel
                    ? `via ${selectedEnquiry.lastReplyChannel}`
                    : ""}{" "}
                  {selectedEnquiry.repliedByName
                    ? `by ${selectedEnquiry.repliedByName}`
                    : ""}
                </span>
                {selectedEnquiry.repliedAt && (
                  <span className="text-[11px] text-emerald-700">
                    {formatDateTimeIst(selectedEnquiry.repliedAt)}
                  </span>
                )}
              </div>
              <div className="text-xs text-emerald-950 whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed bg-white/80 p-3 rounded-lg border border-emerald-200/60">
                {selectedEnquiry.lastReplyText}
              </div>
            </div>
          )}

          <div className="bg-gradient-to-r from-indigo-50 via-blue-50/70 to-indigo-50/40 border border-indigo-200/80 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </span>
                <div>
                  <div className="text-xs font-extrabold text-slate-800">
                    ACRIO (Claude Haiku 5.5) Smart Reply Drafter
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Generates a plain-English reply with verified{" "}
                    {selectedEnquiry.brand === "CLASSIC_EDGE_53"
                      ? "Classic Edge 53 machine"
                      : "Classic Concepts product"}{" "}
                    links &amp; prices
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={aiDrafting}
                  onClick={() =>
                    onDraftWithAcrio(
                      "Friendly helpful quote reply recommending matching products/machines, pricing if known, and asking quantity plus delivery city."
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors disabled:opacity-50"
                >
                  {aiDrafting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  Draft Quote &amp; Options
                </button>
                <button
                  type="button"
                  disabled={aiDrafting}
                  onClick={() =>
                    onDraftWithAcrio(
                      "Short, crisp WhatsApp & email follow-up (under 70 words) with clear next steps."
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-bold transition-colors disabled:opacity-50"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  Short Crisp Note
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={customTone}
                onChange={(e) => setCustomTone(e.target.value)}
                placeholder="Optional custom instruction (e.g. 'Offer 10% bulk discount for 5+ units, dispatch in 4 days')..."
                className="flex-1 px-3 py-1.5 bg-white border border-indigo-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {customTone.trim() && (
                <button
                  type="button"
                  disabled={aiDrafting}
                  onClick={() => onDraftWithAcrio(customTone)}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  Draft Custom
                </button>
              )}
            </div>
          </div>

          {pendingAiDraft !== null && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  Review ACRIO Draft (Confirm to place in Reply Box)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingAiDraft(null)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-700"
                  >
                    <X className="w-3.5 h-3.5" />
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReplyText(pendingAiDraft);
                      setPendingAiDraft(null);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Confirm &amp; Use Draft
                  </button>
                </div>
              </div>
              <textarea
                rows={4}
                value={pendingAiDraft}
                onChange={(e) => setPendingAiDraft(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl text-xs text-slate-800"
              />
            </div>
          )}

          {banner && (
            <div
              className={`p-3.5 rounded-xl text-xs font-semibold border ${
                banner.type === "success"
                  ? "bg-emerald-50 text-emerald-900 border-emerald-200"
                  : "bg-red-50 text-red-800 border-red-200"
              }`}
            >
              {banner.text}
            </div>
          )}

          <div className="space-y-3">
            <label className="block text-xs font-bold text-slate-700">
              Your Reply Message (Syncs automatically to{" "}
              {selectedEnquiry.brand === "CLASSIC_EDGE_53"
                ? "Classic Edge 53"
                : "Classic Concepts"}
              , WhatsApp Hub &amp; ACRIO AI)
            </label>
            <textarea
              rows={6}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={`Hello ${selectedEnquiry.customerName},\n\nThank you for reaching out to ${
                selectedEnquiry.brand === "CLASSIC_EDGE_53"
                  ? "Classic Edge 53"
                  : "Classic Concepts"
              }...`}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/60 text-sm text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#008069]"
            />

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {selectedEnquiry.customerEmail && (
                <button
                  type="button"
                  disabled={sendingChannel !== null}
                  onClick={() => onSendReply("EMAIL")}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-2xs transition-colors disabled:opacity-50"
                >
                  {sendingChannel === "EMAIL" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Mail className="w-4 h-4" />
                  )}
                  Send Email Reply
                </button>
              )}

              {selectedEnquiry.customerPhone && (
                <button
                  type="button"
                  disabled={sendingChannel !== null}
                  onClick={() => onSendReply("WHATSAPP")}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#008069] hover:bg-[#006d59] text-white text-xs font-bold shadow-2xs transition-colors disabled:opacity-50"
                >
                  {sendingChannel === "WHATSAPP" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Send WhatsApp API Reply
                </button>
              )}

              {selectedEnquiry.customerEmail && selectedEnquiry.customerPhone && (
                <button
                  type="button"
                  disabled={sendingChannel !== null}
                  onClick={() => onSendReply("BOTH")}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-2xs transition-colors disabled:opacity-50"
                >
                  {sendingChannel === "BOTH" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Send Both (Email + WhatsApp)
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
