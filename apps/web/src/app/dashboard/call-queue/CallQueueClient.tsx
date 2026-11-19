"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Headphones, Plus, RefreshCw, Search } from "lucide-react";
import { subscribeRealtimeEvent } from "@/lib/realtime-client";
import type {
  AssignmentMode,
  CallDispatchItem,
  RankedStaff,
  StaffMember,
} from "./call-queue-types";
import { CallIntakeSection } from "./CallIntakeSection";
import { CallQueueItemCard } from "./CallQueueItemCard";

const CALL_QUEUE_PAGE_SIZE = 40;

export function CallQueueClient({
  initialData,
}: {
  initialData?: {
    currentUserId: string;
    items: CallDispatchItem[];
    rankedStaff: RankedStaff[];
    staffList: StaffMember[];
  };
}) {
  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState<string>(
    initialData?.currentUserId ?? ""
  );
  const [items, setItems] = useState<CallDispatchItem[]>(
    initialData?.items ?? []
  );
  const [rankedStaff, setRankedStaff] = useState<RankedStaff[]>(
    initialData?.rankedStaff ?? []
  );
  const [staffList, setStaffList] = useState<StaffMember[]>(
    initialData?.staffList ?? []
  );
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [toast, setToast] = useState<string>("");

  const [tab, setTab] = useState<
    "ALL" | "MINE" | "POOL" | "ACTIVE" | "RESOLVED"
  >("ALL");
  const [search, setSearch] = useState<string>("");
  const [showIntake, setShowIntake] = useState<boolean>(true);

  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [source, setSource] = useState("Direct Call / Online Source");
  const [productTopic, setProductTopic] = useState("");
  const [priority, setPriority] = useState<"NORMAL" | "HIGH" | "URGENT">(
    "NORMAL"
  );
  const [notes, setNotes] = useState("");
  const [assignmentMode, setAssignmentMode] =
    useState<AssignmentMode>("AUTO_PERFORMANCE");
  const [manualStaffId, setManualStaffId] = useState("");
  const [recordingUrl, setRecordingUrl] = useState("");
  const [recordingFileName, setRecordingFileName] = useState("");
  const [recordingMimeType, setRecordingMimeType] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(CALL_QUEUE_PAGE_SIZE);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }, []);

  const loadQueue = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch("/api/call-queue", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setCurrentUserId(String(data.currentUserId || ""));
        setItems(data.items || []);
        setRankedStaff(data.rankedStaff || []);
        setStaffList(data.staffList || []);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!initialData) {
      void loadQueue(false);
    }
    const refresh = () => void loadQueue(true);
    return subscribeRealtimeEvent("call_queue:updated", refresh);
  }, [initialData, loadQueue]);

  async function uploadMedia(file: File, kind: "audio" | "file") {
    if (kind === "audio") setUploadingAudio(true);
    else setUploadingFile(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/media/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.attachment) {
        notify(data.error || "Upload failed.");
        return;
      }
      if (kind === "audio") {
        setRecordingUrl(String(data.attachment.url || ""));
        setRecordingFileName(String(data.attachment.fileName || file.name));
        setRecordingMimeType(
          String(data.attachment.mimeType || file.type || "audio/mpeg")
        );
        notify("Call recording attached.");
      } else {
        setAttachmentUrl(String(data.attachment.url || ""));
        setAttachmentName(String(data.attachment.fileName || file.name));
        notify("File attached.");
      }
    } finally {
      setUploadingAudio(false);
      setUploadingFile(false);
    }
  }

  async function handleCreateDispatch(e: React.FormEvent) {
    e.preventDefault();
    if (!customerPhone.trim() && !notes.trim() && !recordingUrl.trim()) {
      notify("Enter customer phone, call notes, or upload a recording.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/call-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          customerPhone,
          customerName,
          source,
          productTopic,
          priority,
          notes,
          assignmentMode,
          manualStaffId:
            assignmentMode === "MANUAL" ? manualStaffId : undefined,
          recordingUrl,
          recordingFileName,
          recordingMimeType,
          attachmentUrl,
          attachmentName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        notify(data.error || "Could not add call query.");
        return;
      }
      const assignedTo = data.item?.assignedStaffName
        ? `Assigned to ${data.item.assignedStaffName}`
        : "Placed in Open Pool";
      notify(`Call query logged. ${assignedTo}.`);
      setCustomerPhone("");
      setCustomerName("");
      setProductTopic("");
      setNotes("");
      setRecordingUrl("");
      setRecordingFileName("");
      setRecordingMimeType("");
      setAttachmentUrl("");
      setAttachmentName("");
      await loadQueue(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function runItemAction(
    id: string,
    action: "pick_up" | "resolve" | "reopen" | "open_in_inbox" | "reassign",
    extra?: Record<string, string>
  ) {
    setBusyId(id);
    try {
      const res = await fetch("/api/call-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, ...(extra || {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        notify(data.error || "Action failed.");
        if (res.status === 409) {
          await loadQueue(true);
        }
        return;
      }
      if (action === "open_in_inbox" && data.conversationId) {
        router.push(
          `/dashboard/inbox?chat=${encodeURIComponent(data.conversationId)}`
        );
        return;
      }
      notify(
        action === "pick_up"
          ? "Claimed and moved to In Progress."
          : action === "resolve"
          ? "Marked as Resolved."
          : action === "reopen"
          ? "Reopened call query."
          : "Updated teammate assignment."
      );
      await loadQueue(true);
    } finally {
      setBusyId(null);
    }
  }

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (tab === "MINE") {
        if (
          item.assignedStaffId !== currentUserId ||
          item.status === "RESOLVED"
        ) {
          return false;
        }
      } else if (tab === "POOL") {
        if (item.status !== "PENDING" || item.assignedStaffId) return false;
      } else if (tab === "ACTIVE") {
        if (item.status === "RESOLVED") return false;
      } else if (tab === "RESOLVED") {
        if (item.status !== "RESOLVED") return false;
      }

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay =
          `${item.customerName} ${item.customerPhone} ${item.source} ${item.productTopic} ${item.notes} ${item.assignedStaffName} ${item.submittedByName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, tab, search, currentUserId]);

  const counts = useMemo(() => {
    const mine = items.filter(
      (i) => i.assignedStaffId === currentUserId && i.status !== "RESOLVED"
    ).length;
    const pool = items.filter(
      (i) => i.status === "PENDING" && !i.assignedStaffId
    ).length;
    const active = items.filter((i) => i.status !== "RESOLVED").length;
    const resolved = items.filter((i) => i.status === "RESOLVED").length;
    return { mine, pool, active, resolved, total: items.length };
  }, [items, currentUserId]);

  useEffect(() => {
    setVisibleCount(CALL_QUEUE_PAGE_SIZE);
  }, [tab, search]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount]
  );
  const remainingItemsCount = Math.max(0, filteredItems.length - visibleItems.length);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {toast && (
        <div className="fixed bottom-4 left-3 right-3 sm:left-auto sm:right-5 sm:max-w-sm z-50 px-4 py-2.5 rounded-lg bg-neutral-900 text-white text-xs font-semibold shadow-xl text-center sm:text-left [overflow-wrap:anywhere]">
          {toast}
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#e7fce3] text-[#008069] flex items-center justify-center">
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-neutral-900">
                Call & External Lead Queue
              </h1>
              <p className="text-xs text-neutral-600">
                Log incoming calls, attach recordings, and route queries
                automatically by performance score or randomly instead of
                forwarding in WhatsApp groups.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadQueue(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-700 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => setShowIntake((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showIntake ? "Hide Call Form" : "Log New Call Query"}</span>
          </button>
        </div>
      </div>

      {showIntake && (
        <CallIntakeSection
          customerPhone={customerPhone}
          setCustomerPhone={setCustomerPhone}
          customerName={customerName}
          setCustomerName={setCustomerName}
          source={source}
          setSource={setSource}
          productTopic={productTopic}
          setProductTopic={setProductTopic}
          priority={priority}
          setPriority={setPriority}
          notes={notes}
          setNotes={setNotes}
          assignmentMode={assignmentMode}
          setAssignmentMode={setAssignmentMode}
          manualStaffId={manualStaffId}
          setManualStaffId={setManualStaffId}
          staffList={staffList}
          rankedStaff={rankedStaff}
          recordingUrl={recordingUrl}
          recordingFileName={recordingFileName}
          attachmentName={attachmentName}
          uploadingAudio={uploadingAudio}
          uploadingFile={uploadingFile}
          submitting={submitting}
          onUploadMedia={(f, kind) => void uploadMedia(f, kind)}
          onSubmit={handleCreateDispatch}
        />
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-neutral-200 rounded-xl p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { key: "ALL", label: `All (${counts.total})` },
              { key: "MINE", label: `Assigned to Me (${counts.mine})` },
              { key: "POOL", label: `Open Pool (${counts.pool})` },
              { key: "ACTIVE", label: `Active (${counts.active})` },
              { key: "RESOLVED", label: `Resolved (${counts.resolved})` },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                tab === t.key
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, number, source, notes..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-neutral-300 text-xs"
          />
        </div>
      </div>

      {/* Queue Items */}
      {loading ? (
        <div className="p-12 text-center text-xs text-neutral-500">
          Loading call queue...
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center space-y-2">
          <Headphones className="w-8 h-8 text-neutral-300 mx-auto" />
          <div className="text-sm font-semibold text-neutral-800">
            No call queries in this view
          </div>
          <p className="text-xs text-neutral-500">
            Use the form above whenever a call comes in so the team can listen,
            claim, open in WhatsApp Inbox, and resolve it cleanly.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visibleItems.map((item) => (
              <CallQueueItemCard
                key={item.id}
                item={item}
                currentUserId={currentUserId}
                staffList={staffList}
                busy={busyId === item.id}
                onRunAction={(id, action, extra) =>
                  void runItemAction(id, action, extra)
                }
              />
            ))}
          </div>
          {remainingItemsCount > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-xs text-neutral-600">
              <span>
                Showing {visibleItems.length} of {filteredItems.length} call queries
              </span>
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + CALL_QUEUE_PAGE_SIZE)}
                className="px-3.5 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 font-semibold text-neutral-800 cursor-pointer"
              >
                Load {Math.min(CALL_QUEUE_PAGE_SIZE, remainingItemsCount)} More ({remainingItemsCount} remaining)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
