"use client";

import React from "react";
import { Copy, Edit3, ExternalLink, Search, Trash2, Truck } from "lucide-react";
import { ElementErrorState, TableRowsSkeleton } from "@cc/ui";
import type { OrderTrackingRow } from "./tracking-types";

export function TrackingTableCard({
  brandFilter,
  setBrandFilter,
  query,
  setQuery,
  error,
  loading,
  refreshing,
  filteredRows,
  trackingOrigin,
  onRetry,
  onCopyLink,
  onEdit,
  onDelete,
}: {
  brandFilter: "ALL" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  setBrandFilter: (v: "ALL" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53") => void;
  query: string;
  setQuery: (v: string) => void;
  error: string;
  loading: boolean;
  refreshing: boolean;
  filteredRows: OrderTrackingRow[];
  trackingOrigin: string;
  onRetry: () => void;
  onCopyLink: (publicLink: string) => void;
  onEdit: (row: OrderTrackingRow) => void;
  onDelete: (row: OrderTrackingRow) => void;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-2xs overflow-hidden">
      <div className="p-4 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {(
            [
              { key: "ALL", label: "All Brands" },
              { key: "CLASSIC_CONCEPTS", label: "Classic Concepts" },
              { key: "CLASSIC_EDGE_53", label: "Classic Edge 53" },
            ] as const
          ).map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => setBrandFilter(tb.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                brandFilter === tb.key
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Order ID, AWB, courier, customer..."
            className="w-full rounded-lg border border-neutral-300 pl-8 pr-3 py-1.5 text-xs"
          />
        </div>
      </div>

      {error ? (
        <div className="p-6">
          <ElementErrorState
            title="Could not load tracking links"
            message={error}
            onRetry={onRetry}
            retrying={refreshing}
          />
        </div>
      ) : loading ? (
        <div className="p-4">
          <TableRowsSkeleton rows={5} />
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="p-10 text-center space-y-2">
          <Truck className="w-8 h-8 text-neutral-300 mx-auto" />
          <p className="text-sm font-semibold text-neutral-800">
            No order tracking links found
          </p>
          <p className="text-xs text-neutral-500 max-w-md mx-auto">
            Add an Order ID above or click Send Track Button directly inside any
            WhatsApp conversation in Customer Chats.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[680px]">
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 uppercase text-[11px]">
              <tr>
                <th className="px-4 py-3 font-semibold">Order ID &amp; Link</th>
                <th className="px-4 py-3 font-semibold">Brand</th>
                <th className="px-4 py-3 font-semibold">Courier &amp; AWB</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold text-right">Clicks</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filteredRows.map((row) => {
                const publicLink = `${trackingOrigin}/${encodeURIComponent(row.orderId)}`;
                return (
                  <tr key={row.id} className="hover:bg-neutral-50/70">
                    <td className="px-4 py-3">
                      <div className="font-mono font-bold text-neutral-900">
                        {row.orderId}
                      </div>
                      <div className="font-mono text-[11px] text-[#008069] truncate max-w-[230px]">
                        {publicLink}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                          row.brand === "CLASSIC_EDGE_53"
                            ? "bg-amber-50 text-amber-900 border border-amber-200"
                            : "bg-red-50 text-red-800 border border-red-200"
                        }`}
                      >
                        {row.brand === "CLASSIC_EDGE_53"
                          ? "Classic Edge 53"
                          : "Classic Concepts"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-neutral-900">
                        {row.providerName}
                      </div>
                      {row.awbNumber && (
                        <div className="font-mono text-[11px] text-neutral-600">
                          AWB: {row.awbNumber}
                        </div>
                      )}
                      {row.providerTrackingUrl && (
                        <a
                          href={row.providerTrackingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:underline mt-0.5"
                        >
                          <span>Open Courier URL</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[11px]">
                        {row.shipmentStatus.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-800">
                        {row.customerName || "Direct Order"}
                      </div>
                      {row.customerPhone && (
                        <div className="text-[11px] text-neutral-500">
                          {row.customerPhone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-neutral-800">
                      {row.lookupsCount}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onCopyLink(publicLink)}
                          title="Copy track.ccapl.cc link"
                          className="p-1.5 rounded hover:bg-neutral-100 text-neutral-600 hover:text-neutral-900 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <a
                          href={`/tracking/${encodeURIComponent(row.orderId)}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Test live redirect"
                          className="p-1.5 rounded hover:bg-neutral-100 text-[#008069]"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => onEdit(row)}
                          title="Edit courier or AWB"
                          className="p-1.5 rounded hover:bg-neutral-100 text-neutral-600 hover:text-neutral-900 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(row)}
                          title="Delete tracking record"
                          className="p-1.5 rounded hover:bg-red-50 text-neutral-500 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
