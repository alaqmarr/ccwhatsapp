"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Award,
  CheckCircle2,
  ExternalLink,
  FileAudio,
  FileText,
  Headphones,
  Loader2,
  MessageSquare,
  PhoneCall,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Shuffle,
  Upload,
  UserCheck,
  Users,
} from "lucide-react";
import { formatDateTimeIst } from "@cc/ui";

type AssignmentMode =
  | "AUTO_PERFORMANCE"
  | "AUTO_RANDOM"
  | "PREFERRED_OR_PAST"
  | "OPEN_POOL"
  | "MANUAL";

interface CallDispatchItem {
  id: string;
  customerPhone: string;
  customerName: string;
  source: string;
  productTopic: string;
  notes: string;
  recordingUrl: string;
  recordingFileName: string;
  recordingMimeType: string;
  attachmentUrl: string;
  attachmentName: string;
  assignmentMode: AssignmentMode;
  assignmentReason: string;
  assignedStaffId: string | null;
  assignedStaffName: string;
  status: "PENDING" | "IN_PROGRESS" | "RESOLVED";
  priority: "URGENT" | "HIGH" | "NORMAL";
  conversationId: string | null;
  resolutionNotes: string;
  submittedById: string | null;
  submittedByName: string;
  pickedUpAt: string | null;
  resolvedAt: string | null;
  resolvedByName: string;
  createdAt: string;
}

interface RankedStaff {
  staffId: string;
  staffName: string;
  role: string;
  resolved30d: number;
  avgFirstResponseSec: number | null;
  openLoad: number;
  performanceScore: number;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
}

function formatSec(sec: number | null): string {
  if (sec === null || sec === undefined) return "No data";
  if (sec < 60) return `${sec}s`;
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

export default function CallQueuePage() {
  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [items, setItems] = useState<CallDispatchItem[]>([]);
  const [rankedStaff, setRankedStaff] = useState<RankedStaff[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [toast, setToast] = useState<string>("");

  const [tab, setTab] = useState<"ALL" | "MINE" | "POOL" | "ACTIVE" | "RESOLVED">("ALL");
  const [search, setSearch] = useState<string>("");
  const [showIntake, setShowIntake] = useState<boolean>(true);

  // New call intake form state
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [source, setSource] = useState("Direct Call / Online Source");
  const [productTopic, setProductTopic] = useState("");
  const [priority, setPriority] = useState<"NORMAL" | "HIGH" | "URGENT">("NORMAL");
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
    void loadQueue(false);
    const es = new EventSource("/api/realtime/stream");
    const refresh = () => void loadQueue(true);
    es.addEventListener("call_queue:updated", refresh);
    return () => es.close();
  }, [loadQueue]);

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
        setRecordingMimeType(String(data.attachment.mimeType || file.type || "audio/mpeg"));
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
          manualStaffId: assignmentMode === "MANUAL" ? manualStaffId : undefined,
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
        return;
      }
      if (action === "open_in_inbox" && data.conversationId) {
        router.push(`/dashboard/inbox?chat=${encodeURIComponent(data.conversationId)}`);
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
        if (item.assignedStaffId !== currentUserId || item.status === "RESOLVED") {
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
        const hay = `${item.customerName} ${item.customerPhone} ${item.source} ${item.productTopic} ${item.notes} ${item.assignedStaffName} ${item.submittedByName}`.toLowerCase();
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

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg bg-neutral-900 text-white text-xs font-semibold shadow-xl">
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
                Log incoming calls, attach recordings, and route queries automatically by performance score or randomly instead of forwarding in WhatsApp groups.
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
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
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

      {/* Intake Form + Live Team Ranking Grid */}
      {showIntake && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <form
            onSubmit={handleCreateDispatch}
            className="lg:col-span-2 rounded-xl border border-neutral-200 bg-white p-5 space-y-4 shadow-2xs"
          >
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
                <PhoneCall className="w-4 h-4 text-[#008069]" />
                <span>Log Call Recording & Client Details</span>
              </h2>
              <span className="text-[11px] text-neutral-500">
                Auto-syncs into Contacts & Chat notes
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Client Phone Number
                </label>
                <input
                  type="text"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="+91 98480 55112"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Client Name / Company
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Ramesh / ABC Events"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Source Channel
                </label>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-xs bg-white"
                >
                  <option value="Direct Call / Online Source">
                    Direct Call / Online Source
                  </option>
                  <option value="IndiaMart Call">IndiaMart Call</option>
                  <option value="JustDial Lead">JustDial Lead</option>
                  <option value="Google Business Call">Google Business Call</option>
                  <option value="Website Callback">Website Callback</option>
                  <option value="Exhibition / Walk-in">Exhibition / Walk-in</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Product / Requirement Summary
                </label>
                <input
                  type="text"
                  value={productTopic}
                  onChange={(e) => setProductTopic(e.target.value)}
                  placeholder="e.g. 10 acrylic podiums with logo print or YN-JW1200 machine"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Urgency
                </label>
                <select
                  value={priority}
                  onChange={(e) =>
                    setPriority(e.target.value as "NORMAL" | "HIGH" | "URGENT")
                  }
                  className="w-full rounded-lg border border-neutral-300 px-2.5 py-2 text-xs bg-white"
                >
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High Priority</option>
                  <option value="URGENT">Urgent Callback</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                Detailed Notes for Team
              </label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Write what the caller asked for, budget, delivery city, quantity, and callback timing..."
                className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs"
              />
            </div>

            {/* Call Recording & File Upload */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-neutral-50 border border-neutral-200">
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold text-neutral-800 flex items-center gap-1.5">
                  <FileAudio className="w-3.5 h-3.5 text-[#008069]" />
                  <span>Call Recording (Audio Upload)</span>
                </label>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-300 bg-white hover:bg-neutral-100 text-xs font-medium cursor-pointer">
                  {uploadingAudio ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5 text-[#008069]" />
                  )}
                  <span>
                    {recordingFileName ? `Replace (${recordingFileName})` : "Upload Call Recording"}
                  </span>
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.amr"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadMedia(f, "audio");
                    }}
                  />
                </label>
                {recordingUrl && (
                  <audio controls src={recordingUrl} className="w-full h-8" />
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-semibold text-neutral-800 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  <span>Optional Attachment / Photo / PDF</span>
                </label>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-300 bg-white hover:bg-neutral-100 text-xs font-medium cursor-pointer">
                  {uploadingFile ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5 text-blue-600" />
                  )}
                  <span>
                    {attachmentName ? `Attached: ${attachmentName}` : "Upload File / Screenshot"}
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadMedia(f, "file");
                    }}
                  />
                </label>
              </div>
            </div>

            {/* Assignment Strategy */}
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold text-neutral-800">
                How should this call query be assigned?
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                {(
                  [
                    {
                      key: "AUTO_PERFORMANCE",
                      label: "By Performance Score",
                      sub: "Top available score + lowest load",
                    },
                    {
                      key: "AUTO_RANDOM",
                      label: "Random Teammate",
                      sub: "Fair random pick from active staff",
                    },
                    {
                      key: "PREFERRED_OR_PAST",
                      label: "Past / Preferred Staff",
                      sub: "Same person who handled them before",
                    },
                    {
                      key: "OPEN_POOL",
                      label: "Open Pool",
                      sub: "Let any teammate pick it up",
                    },
                    {
                      key: "MANUAL",
                      label: "Choose Teammate",
                      sub: "Assign directly right now",
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setAssignmentMode(opt.key)}
                    className={`text-left p-2.5 rounded-lg border cursor-pointer transition ${
                      assignmentMode === opt.key
                        ? "border-[#00a884] bg-[#e7fce3]/70 text-neutral-900"
                        : "border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700"
                    }`}
                  >
                    <div className="font-semibold text-[11.5px]">{opt.label}</div>
                    <div className="text-[10.5px] text-neutral-500">{opt.sub}</div>
                  </button>
                ))}
              </div>

              {assignmentMode === "MANUAL" && (
                <select
                  required
                  value={manualStaffId}
                  onChange={(e) => setManualStaffId(e.target.value)}
                  className="w-full sm:w-72 rounded-lg border border-neutral-300 px-3 py-2 text-xs bg-white"
                >
                  <option value="">Select teammate...</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.role})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting || uploadingAudio || uploadingFile}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : assignmentMode === "AUTO_RANDOM" ? (
                  <Shuffle className="w-3.5 h-3.5" />
                ) : (
                  <Award className="w-3.5 h-3.5" />
                )}
                <span>{submitting ? "Dispatching..." : "Dispatch Call Query"}</span>
              </button>
            </div>
          </form>

          {/* Performance Leaderboard Sidebar */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
              <h3 className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
                <Award className="w-4 h-4 text-amber-500" />
                <span>Live Staff Performance Ranking</span>
              </h3>
              <span className="text-[10.5px] text-neutral-500">30d score</span>
            </div>
            <p className="text-[11px] text-neutral-600">
              Used when dispatching queries with Performance mode. Balances resolved chats, reply speed, and open workload.
            </p>
            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
              {rankedStaff.length === 0 ? (
                <p className="text-xs text-neutral-500">No active staff metrics yet.</p>
              ) : (
                rankedStaff.map((st, idx) => (
                  <div
                    key={st.staffId}
                    className="p-2.5 rounded-lg border border-neutral-200 bg-neutral-50/70 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-neutral-900 truncate">
                        #{idx + 1} {st.staffName}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[10.5px] font-bold">
                        Score {st.performanceScore}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10.5px] text-neutral-600">
                      <span>{st.resolved30d} resolved</span>
                      <span>Avg reply: {formatSec(st.avgFirstResponseSec)}</span>
                      <span>{st.openLoad} open</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
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
            Use the form above whenever a call comes in so the team can listen, claim, open in WhatsApp Inbox, and resolve it cleanly.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredItems.map((item) => {
            const busy = busyId === item.id;
            return (
              <div
                key={item.id}
                className={`rounded-xl border bg-white p-4 space-y-3 shadow-2xs ${
                  item.priority === "URGENT"
                    ? "border-red-300"
                    : item.status === "RESOLVED"
                    ? "border-emerald-200 opacity-85"
                    : "border-neutral-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-neutral-900 truncate">
                        {item.customerName || item.customerPhone || "Unnamed Caller"}
                      </span>
                      {item.customerPhone && (
                        <span className="text-xs font-mono text-neutral-600">
                          {item.customerPhone}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-0.5">
                      {item.source} • Logged by {item.submittedByName} •{" "}
                      {formatDateTimeIst(item.createdAt)}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.priority !== "NORMAL" && (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          item.priority === "URGENT"
                            ? "bg-red-100 text-red-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {item.priority}
                      </span>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${
                        item.status === "RESOLVED"
                          ? "bg-emerald-100 text-emerald-800"
                          : item.status === "IN_PROGRESS"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-amber-100 text-amber-900"
                      }`}
                    >
                      {item.status.replace("_", " ")}
                    </span>
                  </div>
                </div>

                {item.productTopic && (
                  <div className="text-xs font-semibold text-[#008069]">
                    Topic: {item.productTopic}
                  </div>
                )}

                {item.notes && (
                  <p className="text-xs text-neutral-700 whitespace-pre-wrap bg-neutral-50 rounded-lg p-2.5 border border-neutral-100">
                    {item.notes}
                  </p>
                )}

                {item.recordingUrl && (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-medium text-slate-700">
                      <span className="inline-flex items-center gap-1">
                        <FileAudio className="w-3.5 h-3.5 text-[#008069]" />
                        <span>{item.recordingFileName || "Call Recording"}</span>
                      </span>
                      <a
                        href={item.recordingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#008069] hover:underline inline-flex items-center gap-1"
                      >
                        <span>Open</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <audio controls src={item.recordingUrl} className="w-full h-8" />
                  </div>
                )}

                {item.attachmentUrl && (
                  <a
                    href={item.attachmentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>{item.attachmentName || "View Attachment"}</span>
                  </a>
                )}

                {/* Assignment Banner */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-100 text-[11px]">
                  <div className="text-neutral-600">
                    <span className="font-semibold text-neutral-900 inline-flex items-center gap-1">
                      <Users className="w-3 h-3 text-[#008069]" />
                      <span>
                        {item.assignedStaffName
                          ? `Assigned to ${item.assignedStaffName}`
                          : "Unassigned (Open Pool)"}
                      </span>
                    </span>
                    {item.assignmentReason && (
                      <div className="text-[10.5px] text-neutral-500">
                        {item.assignmentReason}
                      </div>
                    )}
                  </div>

                  {item.status !== "RESOLVED" && (
                    <select
                      disabled={busy}
                      value={item.assignedStaffId || ""}
                      onChange={(e) => {
                        if (e.target.value) {
                          void runItemAction(item.id, "reassign", {
                            targetStaffId: e.target.value,
                          });
                        }
                      }}
                      className="rounded border border-neutral-300 bg-white px-2 py-1 text-[11px]"
                    >
                      <option value="">Reassign to...</option>
                      {staffList.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Action Footer */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.status !== "RESOLVED" &&
                      (!item.assignedStaffId ||
                        item.assignedStaffId === currentUserId) &&
                      item.status === "PENDING" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runItemAction(item.id, "pick_up")}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Pick Up</span>
                        </button>
                      )}

                    {item.customerPhone && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runItemAction(item.id, "open_in_inbox")}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#e7fce3] hover:bg-[#d3f7cb] text-[#008069] text-xs font-semibold cursor-pointer disabled:opacity-50"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>
                          {item.conversationId
                            ? "View in WhatsApp Inbox"
                            : "Open in WhatsApp Inbox"}
                        </span>
                      </button>
                    )}
                  </div>

                  {item.status !== "RESOLVED" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runItemAction(item.id, "resolve")}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Resolve</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runItemAction(item.id, "reopen")}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reopen</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
