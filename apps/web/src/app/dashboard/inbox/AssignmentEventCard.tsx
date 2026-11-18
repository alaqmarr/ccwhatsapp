"use client";

import React from "react";
import { Check, Clock, Sparkles, UserCheck } from "lucide-react";
import type { ChatMessage } from "@/lib/inbox-server-data";
import {
  formatDateTimeShort,
  formatResponseSpeed,
  formatWaitingDuration,
} from "./inbox-helpers";

export const AssignmentEventCard = React.memo(function AssignmentEventCard({
  message: m,
  conversationStatus,
  nowMs,
}: {
  message: ChatMessage;
  conversationStatus: string;
  nowMs: number;
}) {
  const meta = (m.metadata || {}) as Record<string, unknown>;
  const toStaffId = meta.toStaffId ? String(meta.toStaffId) : "";
  const toStaffName = meta.toStaffName ? String(meta.toStaffName) : "Staff";
  const toTeamName = meta.toTeamName ? String(meta.toTeamName) : "Sales Team";
  const tier = meta.escalationLevel ? String(meta.escalationLevel) : "P0";
  const assignedAtIso = meta.assignedAt ? String(meta.assignedAt) : m.createdAt;
  const firstRespIso = meta.firstResponseAt ? String(meta.firstResponseAt) : null;
  const firstRespSec =
    typeof meta.firstResponseSeconds === "number"
      ? meta.firstResponseSeconds
      : null;
  const outcome = meta.outcome ? String(meta.outcome) : "ACTIVE";
  const isSystemAsg = toStaffId === "ACRIO";
  const livePendingWait =
    !firstRespIso &&
    outcome === "ACTIVE" &&
    !isSystemAsg &&
    conversationStatus !== "RESOLVED"
      ? formatWaitingDuration(assignedAtIso, nowMs)
      : null;

  return (
    <div className="flex justify-center my-0.5">
      <div className="w-full max-w-[94%] sm:max-w-[84%] rounded-lg px-3 sm:px-3.5 py-2.5 bg-white/95 border border-[#d1d7db] shadow-2xs text-[#111b21] min-w-0 [overflow-wrap:anywhere]">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="inline-flex flex-wrap items-center gap-1.5 font-semibold">
            {isSystemAsg ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200">
                <Sparkles className="w-3 h-3" />
                <span>System (ACRIO)</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#e7fce3] text-[#008069] border border-[#b7ebaf]">
                <UserCheck className="w-3 h-3" />
                <span>
                  {toStaffName} • {toTeamName}
                </span>
              </span>
            )}
            {!isSystemAsg && (
              <span
                className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                  tier === "P2"
                    ? "bg-red-600 text-white"
                    : tier === "P1"
                    ? "bg-amber-500 text-white"
                    : "bg-neutral-100 text-neutral-700"
                }`}
              >
                {tier}
              </span>
            )}
          </div>
          <span className="text-[#54656f] font-medium">
            Assigned: {formatDateTimeShort(assignedAtIso)}
          </span>
        </div>

        <p className="text-xs text-[#3b4a54] mt-1 leading-snug">{m.body}</p>

        <div className="mt-1.5 pt-1.5 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          {firstRespIso ? (
            <span className="inline-flex items-center gap-1 text-emerald-800 font-medium">
              <Check className="w-3 h-3 text-emerald-600" />
              <span>
                First response:{" "}
                <strong>{formatDateTimeShort(firstRespIso)}</strong>
                {firstRespSec !== null && (
                  <>
                    {" "}
                    (in <strong>{formatResponseSpeed(firstRespSec)}</strong>)
                  </>
                )}
              </span>
            </span>
          ) : outcome === "ESCALATED" ? (
            <span className="inline-flex items-center gap-1 text-red-700 font-medium">
              <Clock className="w-3 h-3" />
              <span>Escalated before first response</span>
            </span>
          ) : outcome === "REASSIGNED" ? (
            <span className="text-neutral-500">
              Reassigned before first response
            </span>
          ) : livePendingWait ? (
            <span
              suppressHydrationWarning
              className={`inline-flex items-center gap-1 font-medium ${
                livePendingWait.minutes >= 5 ? "text-red-700" : "text-amber-700"
              }`}
            >
              <Clock className="w-3 h-3" />
              <span suppressHydrationWarning>
                Awaiting first response ({livePendingWait.text})
              </span>
            </span>
          ) : (
            <span className="text-neutral-500">
              {isSystemAsg
                ? "Standing by for customer message"
                : "No outbound reply needed"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
