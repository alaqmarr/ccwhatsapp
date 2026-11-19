"use client";

import React from "react";
import {
  CheckCircle2,
  ExternalLink,
  FileAudio,
  FileText,
  MessageSquare,
  RotateCcw,
  UserCheck,
  Users,
} from "lucide-react";
import { formatDateTimeIst } from "@cc/ui";
import type { CallDispatchItem, StaffMember } from "./call-queue-types";

export function CallQueueItemCard({
  item,
  currentUserId,
  staffList,
  busy,
  onRunAction,
}: {
  item: CallDispatchItem;
  currentUserId: string;
  staffList: StaffMember[];
  busy: boolean;
  onRunAction: (
    id: string,
    action: "pick_up" | "resolve" | "reopen" | "open_in_inbox" | "reassign",
    extra?: Record<string, string>
  ) => void;
}) {
  return (
    <div
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
        <p className="text-xs text-neutral-700 whitespace-pre-wrap [overflow-wrap:anywhere] bg-neutral-50 rounded-lg p-2.5 border border-neutral-100">
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
                onRunAction(item.id, "reassign", {
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
                onClick={() => onRunAction(item.id, "pick_up")}
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
              onClick={() => onRunAction(item.id, "open_in_inbox")}
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
            onClick={() => onRunAction(item.id, "resolve")}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Resolve</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRunAction(item.id, "reopen")}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reopen</span>
          </button>
        )}
      </div>
    </div>
  );
}
