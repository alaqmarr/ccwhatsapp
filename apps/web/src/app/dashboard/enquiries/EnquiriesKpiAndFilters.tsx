"use client";

import React from "react";
import { Search, X } from "lucide-react";
import type { EnquiriesStats } from "./enquiries-types";

export function EnquiriesKpiAndFilters({
  stats,
  brandFilter,
  setBrandFilter,
  statusFilter,
  setStatusFilter,
  searchQuery,
  setSearchQuery,
}: {
  stats: EnquiriesStats;
  brandFilter: "ALL" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  setBrandFilter: (v: "ALL" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53") => void;
  statusFilter: "ALL" | "New" | "Replied";
  setStatusFilter: (v: "ALL" | "New" | "Replied") => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
}) {
  return (
    <>
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
    </>
  );
}
