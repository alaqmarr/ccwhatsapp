"use client";

import React, { useState } from "react";
import { Megaphone, Search, Tag, Trash2, X } from "lucide-react";
import {
  ORG_TYPES,
  STAGE_OPTIONS,
  type ContactsPayload,
} from "@/app/dashboard/contacts/types";

export function ContactFiltersBar({
  searchQuery,
  setSearchQuery,
  stageFilter,
  setStageFilter,
  orgFilter,
  setOrgFilter,
  sourceFilter,
  setSourceFilter,
  sortBy,
  setSortBy,
  selectedIds,
  setSelectedIds,
  data,
  onRunBulkAction,
  onOpenBroadcastListModal,
}: {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  stageFilter: string;
  setStageFilter: (v: string) => void;
  orgFilter: string;
  setOrgFilter: (v: string) => void;
  sourceFilter: string;
  setSourceFilter: (v: string) => void;
  sortBy: string;
  setSortBy: (v: string) => void;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  data: ContactsPayload | null;
  onRunBulkAction: (
    payload: Record<string, unknown>,
    successMsg: string
  ) => Promise<void>;
  onOpenBroadcastListModal: () => void;
}) {
  const [bulkTagDraft, setBulkTagDraft] = useState<string>("");
  const [showBulkTagInput, setShowBulkTagInput] = useState<boolean>(false);

  return (
    <>
      <div className="p-3.5 border-b border-neutral-200 flex flex-wrap items-center gap-2.5 bg-white">
        <div className="relative flex-1 min-w-0 w-full sm:min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, +91 phone, company, GST, city, email, or tag..."
            className="w-full pl-9 pr-8 py-2 rounded-lg border border-neutral-300 text-[13px] bg-neutral-50/60 focus:bg-white focus:outline-none focus:border-[#00a884]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="px-2.5 py-2 rounded-lg border border-neutral-300 bg-white text-xs font-medium text-slate-700"
        >
          <option value="ALL">All Stages</option>
          <option value="BUYERS_ALL">All Paying Customers</option>
          {STAGE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <select
          value={orgFilter}
          onChange={(e) => setOrgFilter(e.target.value)}
          className="px-2.5 py-2 rounded-lg border border-neutral-300 bg-white text-xs font-medium text-slate-700"
        >
          <option value="ALL">All Org Types</option>
          {ORG_TYPES.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>

        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="px-2.5 py-2 rounded-lg border border-neutral-300 bg-white text-xs font-medium text-slate-700"
        >
          <option value="ALL">All Sources</option>
          <option value="WHATSAPP_INBOUND">WhatsApp Chat</option>
          <option value="WEBSITE_ENQUIRY">Website Enquiry</option>
          <option value="CSV_IMPORT">CSV Import</option>
          <option value="ORDER">Past Order</option>
          <option value="MANUAL">Manual</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-2.5 py-2 rounded-lg border border-neutral-300 bg-white text-xs font-medium text-slate-700"
        >
          <option value="recent">Sort: Recent Activity</option>
          <option value="name">Sort: Name (A to Z)</option>
          <option value="ltv">Sort: Highest Order Value</option>
          <option value="orders">Sort: Most Orders</option>
          <option value="created">Sort: Newest Added</option>
        </select>
      </div>

      {selectedIds.length > 0 && data && (
        <div className="px-4 py-2.5 bg-emerald-50/90 border-b border-emerald-200 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-950">
            <span className="px-2 py-0.5 rounded-md bg-[#00a884] text-white tabular-nums">
              {selectedIds.length}
            </span>
            <span>selected</span>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="text-emerald-800 underline ml-1 cursor-pointer"
            >
              Clear
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {showBulkTagInput ? (
              <div className="inline-flex items-center gap-1 bg-white rounded-md border border-emerald-300 px-2 py-1">
                <input
                  type="text"
                  placeholder="Tag name..."
                  value={bulkTagDraft}
                  onChange={(e) => setBulkTagDraft(e.target.value)}
                  className="text-xs w-28 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (bulkTagDraft.trim()) {
                      void onRunBulkAction(
                        { subAction: "add_tag", tag: bulkTagDraft.trim() },
                        `Added tag #${bulkTagDraft.trim()} to ${selectedIds.length} contacts.`
                      );
                      setBulkTagDraft("");
                      setShowBulkTagInput(false);
                    }
                  }}
                  className="text-xs font-semibold text-[#008069] cursor-pointer"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => setShowBulkTagInput(false)}
                  className="text-slate-400 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowBulkTagInput(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white border border-neutral-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Tag className="w-3 h-3" />
                <span>Add Tag</span>
              </button>
            )}

            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  void onRunBulkAction(
                    { subAction: "set_stage", stage: e.target.value },
                    `Updated stage for ${selectedIds.length} contacts.`
                  );
                  e.target.value = "";
                }
              }}
              className="px-2.5 py-1.5 rounded-md bg-white border border-neutral-300 text-xs font-semibold text-slate-700"
            >
              <option value="">Set Stage...</option>
              {STAGE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>

            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  void onRunBulkAction(
                    { subAction: "add_to_group", groupId: e.target.value },
                    `Added ${selectedIds.length} contacts to group.`
                  );
                  e.target.value = "";
                }
              }}
              className="px-2.5 py-1.5 rounded-md bg-white border border-neutral-300 text-xs font-semibold text-slate-700"
            >
              <option value="">Add to Group...</option>
              {data.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>

            {data.permissions.canManageLists && (
              <button
                type="button"
                onClick={onOpenBroadcastListModal}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer"
              >
                <Megaphone className="w-3.5 h-3.5" />
                <span>Add to Broadcast List</span>
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                void onRunBulkAction(
                  { subAction: "set_opt_in", optIn: true },
                  `Marked ${selectedIds.length} contacts opted-in.`
                )
              }
              className="px-2.5 py-1.5 rounded-md bg-white border border-neutral-300 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 cursor-pointer"
            >
              Opt In
            </button>

            <button
              type="button"
              onClick={() =>
                void onRunBulkAction(
                  { subAction: "set_opt_in", optIn: false },
                  `Marked ${selectedIds.length} contacts opted-out.`
                )
              }
              className="px-2.5 py-1.5 rounded-md bg-white border border-neutral-300 text-xs font-semibold text-amber-800 hover:bg-amber-50 cursor-pointer"
            >
              Opt Out
            </button>

            {data.permissions.canDelete && (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete ${selectedIds.length} selected contact(s) from the Contacts Database?`
                    )
                  ) {
                    void onRunBulkAction(
                      { subAction: "delete" },
                      `Deleted ${selectedIds.length} contact(s).`
                    );
                  }
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white border border-red-300 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>Delete</span>
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
