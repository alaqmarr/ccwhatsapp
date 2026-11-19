"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Mail, RefreshCw } from "lucide-react";
import { CardListSkeleton } from "@cc/ui";
import { subscribeRealtimeEvent } from "@/lib/realtime-client";
import { EnquiriesKpiAndFilters } from "./EnquiriesKpiAndFilters";
import { EnquiriesListPane } from "./EnquiriesListPane";
import type {
  EcosystemEnquiry,
  EnquiriesInitialData,
  EnquiriesStats,
} from "./enquiries-types";

const EnquiryDetailPane = dynamic(() => import("./EnquiryDetailPane"), {
  loading: () => (
    <div className="lg:col-span-7">
      <CardListSkeleton rows={4} />
    </div>
  ),
});

export function EnquiriesClient({
  initialData,
}: {
  initialData?: EnquiriesInitialData;
}) {
  const [enquiries, setEnquiries] = useState<EcosystemEnquiry[]>(
    initialData?.enquiries ?? []
  );
  const [stats, setStats] = useState<EnquiriesStats>(
    initialData?.stats ?? {
      total: 0,
      newCount: 0,
      repliedCount: 0,
      ccCount: 0,
      ce53Count: 0,
    }
  );
  const [bridgeHealth, setBridgeHealth] = useState<{
    ccOnline: boolean;
    ceOnline: boolean;
  }>(() =>
    initialData?.bridgeHealth
      ? {
          ccOnline: Boolean(
            initialData.bridgeHealth.classicConcepts3003?.online ||
              initialData.bridgeHealth.classicConcepts3003?.dbFallbackAvailable
          ),
          ceOnline: Boolean(
            initialData.bridgeHealth.classicEdge3002?.online ||
              initialData.bridgeHealth.classicEdge3002?.dbFallbackAvailable
          ),
        }
      : { ccOnline: true, ceOnline: true }
  );

  const [loading, setLoading] = useState(!initialData);
  const [syncing, setSyncing] = useState(false);
  const [brandFilter, setBrandFilter] = useState<
    "ALL" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53"
  >("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "New" | "Replied">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialData?.enquiries?.[0]?.id ?? null
  );

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

  const loadEnquiries = useCallback(async (showSyncSpinner = false) => {
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
  }, []);

  useEffect(() => {
    if (!initialData) {
      void loadEnquiries(false);
    }
  }, [initialData, loadEnquiries]);

  useEffect(() => {
    return subscribeRealtimeEvent("enquiry:updated", () => {
      void loadEnquiries(false);
    });
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

  useEffect(() => {
    setPendingAiDraft(null);
    setBanner(null);
    if (selectedEnquiry?.aiSuggestedReply && !selectedEnquiry.lastReplyText) {
      setReplyText(selectedEnquiry.aiSuggestedReply);
    } else {
      setReplyText("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1600px] mx-auto">
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
                <span className="font-semibold text-slate-700">classicconcepts.in</span> and{" "}
                <span className="font-semibold text-slate-700">classicedge53.com</span> in one place. Replies sync across all 3 sites and ACRIO AI automatically.
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

      <EnquiriesKpiAndFilters
        stats={stats}
        brandFilter={brandFilter}
        setBrandFilter={setBrandFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <EnquiriesListPane
          loading={loading}
          filteredEnquiries={filteredEnquiries}
          selectedEnquiryId={selectedEnquiry?.id ?? null}
          onSelectEnquiry={setSelectedId}
        />

        <EnquiryDetailPane
          selectedEnquiry={selectedEnquiry}
          replyText={replyText}
          setReplyText={setReplyText}
          pendingAiDraft={pendingAiDraft}
          setPendingAiDraft={setPendingAiDraft}
          customTone={customTone}
          setCustomTone={setCustomTone}
          aiDrafting={aiDrafting}
          sendingChannel={sendingChannel}
          banner={banner}
          onDraftWithAcrio={(tone) => void handleDraftWithAcrio(tone)}
          onSendReply={(ch) => void handleSendReply(ch)}
        />
      </div>
    </div>
  );
}
