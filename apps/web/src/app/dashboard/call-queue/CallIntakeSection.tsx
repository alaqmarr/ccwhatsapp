"use client";

import React from "react";
import {
  Award,
  FileAudio,
  FileText,
  Loader2,
  PhoneCall,
  Shuffle,
  Upload,
} from "lucide-react";
import {
  formatSec,
  type AssignmentMode,
  type RankedStaff,
  type StaffMember,
} from "./call-queue-types";

export function CallIntakeSection({
  customerPhone,
  setCustomerPhone,
  customerName,
  setCustomerName,
  source,
  setSource,
  productTopic,
  setProductTopic,
  priority,
  setPriority,
  notes,
  setNotes,
  assignmentMode,
  setAssignmentMode,
  manualStaffId,
  setManualStaffId,
  staffList,
  rankedStaff,
  recordingUrl,
  recordingFileName,
  attachmentName,
  uploadingAudio,
  uploadingFile,
  submitting,
  onUploadMedia,
  onSubmit,
}: {
  customerPhone: string;
  setCustomerPhone: (v: string) => void;
  customerName: string;
  setCustomerName: (v: string) => void;
  source: string;
  setSource: (v: string) => void;
  productTopic: string;
  setProductTopic: (v: string) => void;
  priority: "NORMAL" | "HIGH" | "URGENT";
  setPriority: (v: "NORMAL" | "HIGH" | "URGENT") => void;
  notes: string;
  setNotes: (v: string) => void;
  assignmentMode: AssignmentMode;
  setAssignmentMode: (v: AssignmentMode) => void;
  manualStaffId: string;
  setManualStaffId: (v: string) => void;
  staffList: StaffMember[];
  rankedStaff: RankedStaff[];
  recordingUrl: string;
  recordingFileName: string;
  attachmentName: string;
  uploadingAudio: boolean;
  uploadingFile: boolean;
  submitting: boolean;
  onUploadMedia: (file: File, kind: "audio" | "file") => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <form
        onSubmit={onSubmit}
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
                {recordingFileName
                  ? `Replace (${recordingFileName})`
                  : "Upload Call Recording"}
              </span>
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.amr"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadMedia(f, "audio");
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
                {attachmentName
                  ? `Attached: ${attachmentName}`
                  : "Upload File / Screenshot"}
              </span>
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadMedia(f, "file");
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
          Used when dispatching queries with Performance mode. Balances resolved
          chats, reply speed, and open workload.
        </p>
        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
          {rankedStaff.length === 0 ? (
            <p className="text-xs text-neutral-500">
              No active staff metrics yet.
            </p>
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
  );
}
