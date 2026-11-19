"use client";

import React, { useMemo } from "react";
import { formatDuration, type AnalyticsResponse } from "./analytics-types";

export default function AnalyticsVolumeCharts({
  data,
}: {
  data: AnalyticsResponse;
}) {
  const maxDailyMsg = useMemo(() => {
    if (data.dailySeries.length === 0) return 1;
    return Math.max(
      1,
      ...data.dailySeries.map((d) => d.inboundMessages + d.outboundMessages)
    );
  }, [data]);

  const maxHourlyCount = useMemo(() => {
    if (data.hourlyIst.length === 0) return 1;
    return Math.max(
      1,
      ...data.hourlyIst.map((h) => Math.max(h.inboundCount, h.outboundCount))
    );
  }, [data]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      <section className="xl:col-span-7 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Daily Customer & Outbound Message Volume
            </h2>
            <p className="text-xs text-neutral-500">
              Daily inbound vs outbound messages and average human first-response speed (IST).
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-neutral-600">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#00a884]" />
              <span>Customer Inbound</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-sky-500" />
              <span>Team / ACRIO Outbound</span>
            </span>
          </div>
        </div>

        <div className="h-52 flex items-end gap-1.5 pt-4 pb-1 border-b border-neutral-200 overflow-x-auto">
          {data.dailySeries.map((day) => {
            const total = day.inboundMessages + day.outboundMessages;
            const inPct = Math.round((day.inboundMessages / maxDailyMsg) * 100);
            const outPct = Math.round((day.outboundMessages / maxDailyMsg) * 100);
            return (
              <div
                key={day.date}
                className="flex-1 min-w-[24px] h-full flex flex-col justify-end items-center group relative"
                title={`${day.label}: ${day.inboundMessages} inbound, ${day.outboundMessages} outbound${
                  day.avgFirstResponseSeconds !== null
                    ? `, Avg 1st reply: ${formatDuration(day.avgFirstResponseSeconds)}`
                    : ""
                }`}
              >
                {total > 0 && (
                  <span className="text-[9px] text-neutral-500 mb-0.5">{total}</span>
                )}
                <div className="w-full max-w-[18px] flex flex-col justify-end rounded-t overflow-hidden bg-neutral-100 h-[145px]">
                  <div style={{ height: `${outPct}%` }} className="w-full bg-sky-500 transition-all" />
                  <div style={{ height: `${inPct}%` }} className="w-full bg-[#00a884] transition-all" />
                </div>
                <span className="text-[9px] text-neutral-500 mt-1.5 truncate max-w-full">
                  {day.label}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="xl:col-span-5 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">
            Peak Customer Hours (India Standard Time)
          </h2>
          <p className="text-xs text-neutral-500">
            Helps schedule Sales & Machine specialists during busy WhatsApp hours.
          </p>
        </div>

        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
          {data.hourlyIst.map((hr) => {
            const ratio = hr.inboundCount / maxHourlyCount;
            const tone =
              hr.inboundCount === 0
                ? "bg-neutral-50 border-neutral-200 text-neutral-400"
                : ratio >= 0.65
                ? "bg-[#00a884] border-[#008f6f] text-white"
                : ratio >= 0.3
                ? "bg-[#d9fdd3] border-[#a9e5a0] text-[#005c4b]"
                : "bg-emerald-50/70 border-emerald-200 text-emerald-900";
            return (
              <div
                key={hr.hour}
                className={`p-2 rounded-md border text-center ${tone}`}
                title={`${hr.label} IST: ${hr.inboundCount} customer messages, ${hr.outboundCount} replies`}
              >
                <div className="text-[10px] font-medium">{hr.label}</div>
                <div className="text-xs font-bold mt-0.5">{hr.inboundCount}</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
