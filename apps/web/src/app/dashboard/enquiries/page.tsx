"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Mail,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  CheckCircle2,
  Clock,
  Phone,
  Package,
  Globe,
  ExternalLink,
  MessageSquare,
  Check,
  X,
  Loader2,
  Wand2,
} from "lucide-react";
import { formatDateTimeIst } from "@cc/ui";

interface EcosystemEnquiry {
  id: string;
  externalId: string;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  brandLabel: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  productName: string;
  source: string;
  message: string;
  status: "New" | "Replied";
  aiSuggestedReply: string;
  lastReplyText: string;
  lastReplyChannel: string;
  repliedByName: string;
  repliedAt: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EnquiriesStats {
  total: number;
  newCount: number;
  repliedCount: number;
  ccCount: number;
  ce53Count: number;
}

export default function UnifiedWebsiteEnquiriesPage() {
  const [enquiries, setEnquiries] = useState<EcosystemEnquiry[]>([]);
  const [stats, setStats] = useState<EnquiriesStats>({
    total: 0,
    newCount: 0,
    repliedCount: 0,
    ccCount: 0,
    ce53Count: 0,
  });
  const [bridgeHealth, setBridgeHealth] = useState<{
    ccOnline: boolean;
    ceOnline: boolean;
  }>({ ccOnline: true, ceOnline: true });

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [brandFilter, setBrandFilter] = useState<
    "ALL" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53"
  >("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "New" | "Replied">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [replyText, setReplyText] = useState("");
  const [pendingAiDraft, setPendingAiDraft] = useState<string | null>(null);
  const [customTone, setCustomTone] = useState("");
  const [aiDrafting, setAiDrafting] = useState(false);
  const [sendingChannel, setSendingChannel] = useState<
    "EMAIL" | "WHATSAPP" | "BOTH" | null
  >(null);
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadEnquiries = useCallback(
    async (showSyncSpinner = false) => {
      if (showSyncSpinner) setSyncing(true);
      try {
        const res = await fetch("/api/enquiries?limit=300", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.ok) {
          const list: EcosystemEnquiry[] = Array.isArray(data.enquiries)
            ? data.enquiries
            : [];
          setEnquiries(list);
          if (data.stats) setStats(data.stats);
          if (data.bridgeHealth) {
            setBridgeHealth({
              ccOnline: Boolean(
                data.bridgeHealth.classicConcepts3003?.online ||
                  data.bridgeHealth.classicConcepts3003?.dbFallbackAvailable
              ),
              ceOnline: Boolean(
                data.bridgeHealth.classicEdge3002?.online ||
                  data.bridgeHealth.classicEdge3002?.dbFallbackAvailable
              ),
            });
          }
          setSelectedId((prev) => {
            if (prev && list.some((e) => e.id === prev)) return prev;
            return list[0]?.id || null;
          });
        }
      } catch {
        // Ignore transient network error
      } finally {
        setLoading(false);
        setSyncing(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadEnquiries(false);
  }, [loadEnquiries]);

  // Listen to SSE realtime stream for instant enquiry updates across all 3 sites
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/realtime/stream");
      es.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data);
          if (
            parsed?.event === "enquiry:updated" ||
            parsed?.type === "enquiry:updated"
          ) {
            void loadEnquiries(false);
          }
        } catch {
          // Ignore malformed event
        }
      };
    } catch {
      // Non-blocking
    }
    return () => {
      if (es) es.close();
    };
  }, [loadEnquiries]);

  const filteredEnquiries = useMemo(() => {
    return enquiries.filter((e) => {
      if (brandFilter !== "ALL" && e.brand !== brandFilter) return false;
      if (statusFilter !== "ALL" && e.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const blob = `${e.customerName} ${e.customerEmail} ${e.customerPhone} ${e.productName} ${e.source} ${e.message} ${e.lastReplyText}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [enquiries, brandFilter, statusFilter, searchQuery]);

  const selectedEnquiry = useMemo(
    () =>
      filteredEnquiries.find((e) => e.id === selectedId) ||
      enquiries.find((e) => e.id === selectedId) ||
      filteredEnquiries[0] ||
      null,
    [filteredEnquiries, enquiries, selectedId]
  );

  // When switching selected enquiry, clear draft states
  useEffect(() => {
    setPendingAiDraft(null);
    setBanner(null);
    if (selectedEnquiry?.aiSuggestedReply && !selectedEnquiry.lastReplyText) {
      setReplyText(selectedEnquiry.aiSuggestedReply);
    } else {
      setReplyText("");
    }
  }, [selectedEnquiry?.id]);

  async function handleDraftWithAcrio(toneInstruction?: string) {
    if (!selectedEnquiry) return;
    setAiDrafting(true);
    setBanner(null);
    try {
      const res = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft_ai_reply",
          id: selectedEnquiry.id,
          brand: selectedEnquiry.brand,
          customerName: selectedEnquiry.customerName,
          customerEmail: selectedEnquiry.customerEmail,
          customerPhone: selectedEnquiry.customerPhone,
          productName: selectedEnquiry.productName,
          message: selectedEnquiry.message,
          customTone: toneInstruction || customTone,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok && data.draftEmailReply) {
        setPendingAiDraft(data.draftEmailReply);
      } else {
        setBanner({
          type: "error",
          text: data?.error || "Could not generate ACRIO draft right now.",
        });
      }
    } catch {
      setBanner({
        type: "error",
        text: "Network error while contacting ACRIO reply assistant.",
      });
    } finally {
      setAiDrafting(false);
    }
  }

  async function handleSendReply(channel: "EMAIL" | "WHATSAPP" | "BOTH") {
    if (!selectedEnquiry) return;
    const text = replyText.trim();
    if (!text) {
      setBanner({
        type: "error",
        text: "Please enter or confirm a reply message before sending.",
      });
      return;
    }

    setSendingChannel(channel);
    setBanner(null);
    try {
      const res = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_reply",
          id: selectedEnquiry.id,
          replyMessage: text,
          channel,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        const updated: EcosystemEnquiry | undefined = data.enquiry;
        if (updated) {
          setEnquiries((prev) =>
            prev.map((item) => (item.id === updated.id ? updated : item))
          );
        }
        const channelDesc =
          channel === "BOTH"
            ? "Email & WhatsApp Business API"
            : channel === "WHATSAPP"
            ? "WhatsApp Business API"
            : "Email";
        setBanner({
          type: "success",
          text: `Reply sent to ${selectedEnquiry.customerName} via ${channelDesc} and synced across Classic Concepts, Classic Edge 53 & WhatsApp Hub!`,
        });
        setReplyText("");
        void loadEnquiries(false);
      } else {
        setBanner({
          type: "error",
          text: data?.error || "Failed to send reply. Please check settings.",
        });
      }
    } catch {
      setBanner({
        type: "error",
        text: "Network error while sending reply.",
      });
    } finally {
      setSendingChannel(null);
    }
  }

  function buildDirectWaMeLink(enq: EcosystemEnquiry): string {
    const digits = (enq.customerPhone || "").replace(/\D/g, "");
    const normalized = digits.length === 10 ? `91${digits}` : digits;
    const text =
      replyText.trim() ||
      `Hello ${enq.customerName},\n\nGreetings from ${
        enq.brand === "CLASSIC_EDGE_53" ? "Classic Edge 53" : "Classic Concepts"
      }! We received your website enquiry${
        enq.productName ? ` regarding ${enq.productName}` : ""
      }:\n"${enq.message.slice(0, 140)}"\n\nHow can we help you with this?`;
    return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1600px] mx-auto">
      {/* Header & Ecosystem Webhook Status Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-[#008069] text-white flex items-center justify-center shadow-2xs">
              <Mail className="w-5 h-5" />
            </span>
            <div>
              <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900">
                Unified Website Enquiries Hub
              </h1>
              <p className="text-xs text-slate-500">
                Manage and reply to enquiries from both{" "}
                <span className="font-semibold text-slate-700">
                  classicconcepts.in
                </span>{" "}
                and{" "}
                <span className="font-semibold text-slate-700">
                  classicedge53.com
                </span>{" "}
                in one place. Replies sync across all 3 sites and ACRIO AI automatically.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700">
            <span
              className={`w-2 h-2 rounded-full ${
                bridgeHealth.ccOnline ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            Classic Concepts (:3003)
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700">
            <span
              className={`w-2 h-2 rounded-full ${
                bridgeHealth.ceOnline ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            Classic Edge 53 (:3002)
          </div>
          <button
            type="button"
            onClick={() => void loadEnquiries(true)}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync Both Sites"}
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => {
            setBrandFilter("ALL");
            setStatusFilter("ALL");
          }}
          className={`text-left p-3.5 rounded-xl border transition-all ${
            brandFilter === "ALL" && statusFilter === "ALL"
              ? "bg-slate-900 text-white border-slate-900 shadow-xs"
              : "bg-white text-slate-800 border-slate-200 hover:border-slate-300"
          }`}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wider opacity-75">
            Total Enquiries
          </div>
          <div className="text-2xl font-extrabold mt-0.5">{stats.total}</div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === "New" ? "ALL" : "New")}
          className={`text-left p-3.5 rounded-xl border transition-all ${
            statusFilter === "New"
              ? "bg-amber-600 text-white border-amber-600 shadow-xs"
              : "bg-white text-slate-800 border-slate-200 hover:border-amber-300"
          }`}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wider opacity-75">
            New / Pending
          </div>
          <div className="text-2xl font-extrabold mt-0.5">{stats.newCount}</div>
        </button>

        <button
          type="button"
          onClick={() =>
            setStatusFilter(statusFilter === "Replied" ? "ALL" : "Replied")
          }
          className={`text-left p-3.5 rounded-xl border transition-all ${
            statusFilter === "Replied"
              ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
              : "bg-white text-slate-800 border-slate-200 hover:border-emerald-300"
          }`}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wider opacity-75">
            Replied
          </div>
          <div className="text-2xl font-extrabold mt-0.5">{stats.repliedCount}</div>
        </button>

        <button
          type="button"
          onClick={() =>
            setBrandFilter(
              brandFilter === "CLASSIC_CONCEPTS" ? "ALL" : "CLASSIC_CONCEPTS"
            )
          }
          className={`text-left p-3.5 rounded-xl border transition-all ${
            brandFilter === "CLASSIC_CONCEPTS"
              ? "bg-blue-600 text-white border-blue-600 shadow-xs"
              : "bg-white text-slate-800 border-slate-200 hover:border-blue-300"
          }`}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wider opacity-75">
            Classic Concepts
          </div>
          <div className="text-2xl font-extrabold mt-0.5">{stats.ccCount}</div>
        </button>

        <button
          type="button"
          onClick={() =>
            setBrandFilter(
              brandFilter === "CLASSIC_EDGE_53" ? "ALL" : "CLASSIC_EDGE_53"
            )
          }
          className={`text-left p-3.5 rounded-xl border transition-all ${
            brandFilter === "CLASSIC_EDGE_53"
              ? "bg-purple-600 text-white border-purple-600 shadow-xs"
              : "bg-white text-slate-800 border-slate-200 hover:border-purple-300"
          }`}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wider opacity-75">
            Classic Edge 53
          </div>
          <div className="text-2xl font-extrabold mt-0.5">{stats.ce53Count}</div>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-2xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "ALL", label: "All Websites" },
              { id: "CLASSIC_CONCEPTS", label: "Classic Concepts (.in)" },
              { id: "CLASSIC_EDGE_53", label: "Classic Edge 53 (.com)" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setBrandFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                brandFilter === tab.id
                  ? "bg-[#008069] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
          <span className="h-4 w-px bg-slate-200 mx-1" />
          {(
            [
              { id: "ALL", label: "All Status" },
              { id: "New", label: "New Only" },
              { id: "Replied", label: "Replied Only" },
            ] as const
          ).map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => setStatusFilter(st.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                statusFilter === st.id
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by customer name, phone, email, product or message..."
            className="w-full pl-9 pr-8 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#008069]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Master-Detail Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left List (5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/75 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">
              Showing {filteredEnquiries.length} Enquir{filteredEnquiries.length === 1 ? "y" : "ies"}
            </span>
          </div>

          {loading ? (
            <div className="p-10 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#008069]" />
              Loading enquiries across Classic Concepts &amp; Classic Edge 53...
            </div>
          ) : filteredEnquiries.length === 0 ? (
            <div className="p-10 text-center text-slate-500 space-y-2">
              <Mail className="w-8 h-8 mx-auto text-slate-300" />
              <div className="text-sm font-semibold text-slate-700">
                No matching website enquiries
              </div>
              <p className="text-xs text-slate-500">
                New enquiries submitted on classicconcepts.in or classicedge53.com appear here automatically.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[72vh] overflow-y-auto">
              {filteredEnquiries.map((enq) => {
                const isSelected = selectedEnquiry?.id === enq.id;
                const isEdge = enq.brand === "CLASSIC_EDGE_53";
                return (
                  <button
                    key={enq.id}
                    type="button"
                    onClick={() => setSelectedId(enq.id)}
                    className={`w-full text-left p-4 transition-colors block ${
                      isSelected
                        ? "bg-emerald-50/70 border-l-4 border-l-[#008069]"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                            isEdge
                              ? "bg-purple-100 text-purple-800 border border-purple-200"
                              : "bg-blue-100 text-blue-800 border border-blue-200"
                          }`}
                        >
                          {isEdge ? "Classic Edge 53" : "Classic Concepts"}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            enq.status === "Replied"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {enq.status === "Replied" ? (
                            <CheckCircle2 className="w-2.5 h-2.5" />
                          ) : (
                            <Clock className="w-2.5 h-2.5" />
                          )}
                          {enq.status}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 shrink-0">
                        {formatDateTimeIst(enq.createdAt)}
                      </span>
                    </div>

                    <div className="font-bold text-sm text-slate-900 truncate">
                      {enq.customerName}
                    </div>
                    <div className="text-[11.5px] text-slate-500 truncate mt-0.5">
                      {enq.customerEmail || "No email"}{" "}
                      {enq.customerPhone ? `• ${enq.customerPhone}` : ""}
                    </div>
                    {enq.productName && (
                      <div className="text-[11px] font-semibold text-indigo-700 mt-1 truncate">
                        Product / Machine: {enq.productName}
                      </div>
                    )}
                    <p className="text-xs text-slate-600 line-clamp-2 mt-1.5 leading-relaxed">
                      {enq.message}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Detail & Direct Reply Composer (7 cols) */}
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
              {/* Top Customer & Brand Metadata */}
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
                    <span className="font-medium text-slate-700">
                      {selectedEnquiry.source}
                    </span>
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
                      href={buildDirectWaMeLink(selectedEnquiry)}
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

              {/* Customer Contact Info Grid */}
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

              {/* Customer Enquiry Message */}
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Customer Enquiry Message
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {selectedEnquiry.message}
                </div>
              </div>

              {/* Previous Reply Record (if already replied) */}
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
                  <div className="text-xs text-emerald-950 whitespace-pre-wrap leading-relaxed bg-white/80 p-3 rounded-lg border border-emerald-200/60">
                    {selectedEnquiry.lastReplyText}
                  </div>
                </div>
              )}

              {/* ACRIO AI Reply Drafter Bar */}
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
                        void handleDraftWithAcrio(
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
                        void handleDraftWithAcrio(
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
                      onClick={() => void handleDraftWithAcrio(customTone)}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      Draft Custom
                    </button>
                  )}
                </div>
              </div>

              {/* Pending AI Draft Confirmation Box */}
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

              {/* Status Banner */}
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

              {/* Reply Textarea & Action Buttons */}
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
                      onClick={() => void handleSendReply("EMAIL")}
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
                      onClick={() => void handleSendReply("WHATSAPP")}
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
                      onClick={() => void handleSendReply("BOTH")}
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
      </div>
    </div>
  );
}
