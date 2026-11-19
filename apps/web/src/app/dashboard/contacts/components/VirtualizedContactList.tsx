"use client";

import React, { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  CheckCircle2,
  Contact2,
  Copy,
  XCircle,
} from "lucide-react";
import { TableRowsSkeleton, WhatsAppLogoIcon } from "@cc/ui";
import {
  formatDateShort,
  sourceLabel,
  stageMeta,
  type ContactItem,
} from "@/app/dashboard/contacts/types";

const GRID_COLUMNS_CLASS =
  "grid grid-cols-[40px_minmax(190px,1.5fr)_minmax(175px,1.25fr)_minmax(170px,1.25fr)_120px_130px_130px_150px] items-start";

export function VirtualizedContactList({
  loading,
  contacts,
  selectedIds,
  allSelected,
  groupMap,
  openingChatPhone,
  onToggleSelectAll,
  onToggleRow,
  onOpenContact360,
  onOpenChat,
  onQuickToggleOptIn,
  onResetFilters,
  onOpenAddModal,
}: {
  loading: boolean;
  contacts: ContactItem[] | null;
  selectedIds: string[];
  allSelected: boolean;
  groupMap: Map<string, string>;
  openingChatPhone: string;
  onToggleSelectAll: () => void;
  onToggleRow: (id: string) => void;
  onOpenContact360: (id: string) => void;
  onOpenChat: (c: {
    phone: string;
    name: string;
    conversationId?: string | null;
  }) => void;
  onQuickToggleOptIn: (c: ContactItem) => void;
  onResetFilters: () => void;
  onOpenAddModal: () => void;
}) {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const [copiedPhone, setCopiedPhone] = useState<string>("");

  const list = contacts ?? [];
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);

  const rowVirtualizer = useVirtualizer({
    count: list.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 88,
    overscan: 10,
    getItemKey: (idx) => list[idx]?.id ?? idx,
  });

  if (loading && !contacts) {
    return (
      <div className="p-4">
        <TableRowsSkeleton rows={8} columns={6} />
      </div>
    );
  }

  if (contacts && contacts.length === 0) {
    return (
      <div className="p-12 text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 text-[#00a884] flex items-center justify-center">
          <Contact2 className="w-6 h-6" />
        </div>
        <h2 className="font-display text-lg font-bold text-slate-900">
          No matching contacts found
        </h2>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Try clearing a filter, add a contact manually, upload a CSV sheet, or sync existing chats and website enquiries.
        </p>
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={onResetFilters}
            className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Reset Filters
          </button>
          <button
            type="button"
            onClick={onOpenAddModal}
            className="px-3.5 py-1.5 rounded-lg bg-[#00a884] text-white text-xs font-semibold cursor-pointer"
          >
            Add First Contact
          </button>
        </div>
      </div>
    );
  }

  if (!contacts) {
    return null;
  }

  return (
    <div
      ref={scrollParentRef}
      className="overflow-auto max-h-[68vh] min-h-[320px]"
    >
      <div className="min-w-[1055px]">
        <div
          className={`${GRID_COLUMNS_CLASS} sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs border-b border-neutral-200 text-xs font-semibold text-slate-500`}
        >
          <div className="py-3 pl-4 pr-2">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleSelectAll}
              className="rounded border-neutral-300 accent-[#00a884] cursor-pointer"
            />
          </div>
          <div className="py-3 px-3">Contact &amp; Stage</div>
          <div className="py-3 px-3">WhatsApp Number</div>
          <div className="py-3 px-3">Company &amp; City</div>
          <div className="py-3 px-3">Broadcast Status</div>
          <div className="py-3 px-3 text-right">Orders &amp; Value</div>
          <div className="py-3 px-3">Source &amp; Activity</div>
          <div className="py-3 pl-3 pr-4 text-right">Actions</div>
        </div>

        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const c = list[virtualRow.index];
            if (!c) return null;
            const st = stageMeta(c.stage);
            const checked = selectedSet.has(c.id);

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
                className={`${GRID_COLUMNS_CLASS} border-b border-neutral-200/80 text-[13px] transition-colors ${
                  checked ? "bg-emerald-50/40" : "bg-white hover:bg-slate-50/80"
                }`}
              >
                <div className="py-3 pl-4 pr-2 pt-4">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleRow(c.id)}
                    className="rounded border-neutral-300 accent-[#00a884] cursor-pointer"
                  />
                </div>

                <div className="py-3 px-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => onOpenContact360(c.id)}
                    className="text-left group cursor-pointer max-w-full"
                  >
                    <div className="font-semibold text-slate-900 group-hover:text-[#008069] flex items-center gap-1.5">
                      <span className="truncate">{c.name}</span>
                      {c.unreadCount > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full bg-[#25d366] text-white text-[10px] font-bold shrink-0">
                          {c.unreadCount} new
                        </span>
                      )}
                    </div>
                  </button>

                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-[0.04em] border ${st.badge}`}
                    >
                      {st.label}
                    </span>
                    {c.groups.slice(0, 2).map((gid) =>
                      groupMap.get(gid) ? (
                        <span
                          key={gid}
                          className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium"
                        >
                          {groupMap.get(gid)}
                        </span>
                      ) : null
                    )}
                    {c.tags.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 text-[10px] font-medium"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="py-3 px-3 min-w-0">
                  <div className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-slate-800">
                    <span>{c.phone}</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(c.phone);
                        setCopiedPhone(c.phone);
                        setTimeout(() => setCopiedPhone(""), 1500);
                      }}
                      title="Copy phone number"
                      className="p-1 rounded hover:bg-slate-200/70 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {copiedPhone === c.phone ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                  {c.email && (
                    <div className="text-[11.5px] text-slate-500 truncate max-w-[175px] mt-0.5">
                      {c.email}
                    </div>
                  )}
                  {c.windowOpen && (
                    <div className="text-[10.5px] font-semibold text-[#008069] mt-0.5">
                      24h Chat Window Open
                    </div>
                  )}
                </div>

                <div className="py-3 px-3 min-w-0">
                  <div className="font-medium text-slate-800 truncate">
                    {c.companyName || (
                      <span className="text-slate-400 font-normal">
                        Individual / Unspecified
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-slate-500 flex flex-wrap items-center gap-1 mt-0.5">
                    <span>{c.organizationType}</span>
                    {c.city && <span>• {c.city}</span>}
                  </div>
                  {c.gstNumber && (
                    <div className="font-mono text-[10.5px] text-slate-500 mt-0.5">
                      GST: {c.gstNumber}
                    </div>
                  )}
                </div>

                <div className="py-3 px-3">
                  <button
                    type="button"
                    onClick={() => onQuickToggleOptIn(c)}
                    title="Click to toggle broadcast opt-in"
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border cursor-pointer transition-colors ${
                      c.optInMarketing
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                        : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                    }`}
                  >
                    {c.optInMarketing ? (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Opted In</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3 h-3" />
                        <span>Opted Out</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="py-3 px-3 text-right">
                  <div className="font-semibold text-slate-900">
                    ₹{c.lifetimeValueInr.toLocaleString("en-IN")}
                  </div>
                  <div className="text-[11.5px] text-slate-500">
                    {c.totalOrdersCount} orders • {c.totalMessagesCount} msgs
                  </div>
                </div>

                <div className="py-3 px-3">
                  <div className="text-xs font-medium text-slate-700">
                    {sourceLabel(c.source)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {formatDateShort(c.lastContactedAt)}
                  </div>
                </div>

                <div className="py-3 pl-3 pr-4 text-right">
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={openingChatPhone === c.phone}
                      onClick={() => onOpenChat(c)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#e7fce3] hover:bg-[#d3f8cc] text-[#008069] text-xs font-semibold cursor-pointer disabled:opacity-60"
                    >
                      <WhatsAppLogoIcon size={13} />
                      <span>Chat</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenContact360(c.id)}
                      className="px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                    >
                      360 / Edit
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
