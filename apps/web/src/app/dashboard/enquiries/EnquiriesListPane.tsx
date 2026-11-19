"use client";

import React, { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckCircle2, Clock, Loader2, Mail } from "lucide-react";
import { formatDateTimeIst } from "@cc/ui";
import type { EcosystemEnquiry } from "./enquiries-types";

export function EnquiriesListPane({
  loading,
  filteredEnquiries,
  selectedEnquiryId,
  onSelectEnquiry,
}: {
  loading: boolean;
  filteredEnquiries: EcosystemEnquiry[];
  selectedEnquiryId: string | null;
  onSelectEnquiry: (id: string) => void;
}) {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: filteredEnquiries.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 128,
    overscan: 8,
    getItemKey: (idx) => filteredEnquiries[idx]?.id ?? idx,
  });

  return (
    <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/75 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-700">
          Showing {filteredEnquiries.length} Enquir
          {filteredEnquiries.length === 1 ? "y" : "ies"}
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
        <div ref={scrollParentRef} className="max-h-[72vh] overflow-y-auto">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const enq = filteredEnquiries[virtualRow.index];
              if (!enq) return null;
              const isSelected = selectedEnquiryId === enq.id;
              const isEdge = enq.brand === "CLASSIC_EDGE_53";
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="border-b border-slate-100 last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => onSelectEnquiry(enq.id)}
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
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
