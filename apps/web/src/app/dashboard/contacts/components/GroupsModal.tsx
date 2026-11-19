"use client";

import React, { useState } from "react";
import { FolderPlus, Trash2, X } from "lucide-react";
import { formatDateShort, type ContactsPayload } from "@/app/dashboard/contacts/types";

export function ContactGroupsSidebar({
  data,
  optInFilter,
  setOptInFilter,
  stageFilter,
  setStageFilter,
  groupFilter,
  setGroupFilter,
  tagFilter,
  setTagFilter,
  onCreateGroup,
  onDeleteGroup,
}: {
  data: ContactsPayload | null;
  optInFilter: string;
  setOptInFilter: (v: string) => void;
  stageFilter: string;
  setStageFilter: (v: string) => void;
  groupFilter: string;
  setGroupFilter: (v: string) => void;
  tagFilter: string;
  setTagFilter: (v: string) => void;
  onCreateGroup: (name: string, description: string) => Promise<boolean>;
  onDeleteGroup: (groupId: string) => Promise<void>;
}) {
  const [showNewGroupForm, setShowNewGroupForm] = useState<boolean>(false);
  const [newGroupName, setNewGroupName] = useState<string>("");
  const [newGroupDesc, setNewGroupDesc] = useState<string>("");
  const [savingGroup, setSavingGroup] = useState<boolean>(false);

  async function submitGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setSavingGroup(true);
    try {
      const ok = await onCreateGroup(newGroupName, newGroupDesc);
      if (ok) {
        setNewGroupName("");
        setNewGroupDesc("");
        setShowNewGroupForm(false);
      }
    } finally {
      setSavingGroup(false);
    }
  }

  return (
    <div className="lg:col-span-3 space-y-4">
      <div className="bg-white rounded-xl border border-neutral-200/90 p-3.5 space-y-3 shadow-2xs">
        <div className="eyebrow-label text-slate-400 px-1">Quick Views</div>
        <div className="space-y-0.5 text-[13px]">
          {[
            {
              id: "ALL",
              label: "All Contacts",
              count: data?.kpis.totalContacts ?? 0,
              active:
                optInFilter === "ALL" &&
                stageFilter === "ALL" &&
                groupFilter === "ALL" &&
                tagFilter === "ALL",
              onClick: () => {
                setOptInFilter("ALL");
                setStageFilter("ALL");
                setGroupFilter("ALL");
                setTagFilter("ALL");
              },
            },
            {
              id: "OPTED_IN",
              label: "Broadcast Opted-In",
              count: data?.kpis.optedInCount ?? 0,
              active: optInFilter === "OPTED_IN",
              onClick: () => {
                setOptInFilter("OPTED_IN");
                setStageFilter("ALL");
              },
            },
            {
              id: "OPTED_OUT",
              label: "Opted-Out (DND)",
              count: data?.kpis.optedOutCount ?? 0,
              active: optInFilter === "OPTED_OUT",
              onClick: () => {
                setOptInFilter("OPTED_OUT");
                setStageFilter("ALL");
              },
            },
            {
              id: "BUYERS",
              label: "Customers & VIPs",
              count: data?.kpis.customersCount ?? 0,
              active: stageFilter === "BUYERS_ALL",
              onClick: () => {
                setStageFilter("BUYERS_ALL");
                setOptInFilter("ALL");
              },
            },
          ].map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={v.onClick}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                v.active
                  ? "bg-[#e7fce3] text-[#008069] font-semibold"
                  : "text-slate-700 hover:bg-slate-100 font-medium"
              }`}
            >
              <span>{v.label}</span>
              <span className="text-xs tabular-nums opacity-80">{v.count}</span>
            </button>
          ))}
        </div>

        <div className="pt-2 border-t border-neutral-200 space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="eyebrow-label text-slate-400">Contact Groups</span>
            <button
              type="button"
              onClick={() => setShowNewGroupForm((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#008069] hover:underline cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>New</span>
            </button>
          </div>

          {showNewGroupForm && (
            <form
              onSubmit={submitGroup}
              className="p-2.5 rounded-lg bg-slate-50 border border-neutral-200 space-y-2"
            >
              <input
                type="text"
                required
                placeholder="Group name (e.g. Architects)"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-md border border-neutral-300 bg-white text-xs"
              />
              <input
                type="text"
                placeholder="Short note (optional)"
                value={newGroupDesc}
                onChange={(e) => setNewGroupDesc(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-md border border-neutral-300 bg-white text-xs"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowNewGroupForm(false)}
                  className="px-2 py-1 text-xs text-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingGroup}
                  className="px-2.5 py-1 rounded-md bg-[#00a884] text-white text-xs font-semibold cursor-pointer"
                >
                  Save Group
                </button>
              </div>
            </form>
          )}

          <div className="space-y-0.5 text-[13px]">
            {(data?.groups || []).map((g) => {
              const active = groupFilter === g.id;
              const isSystem = [
                "grp_vip",
                "grp_edu",
                "grp_corp",
                "grp_machines",
              ].includes(g.id);
              return (
                <div
                  key={g.id}
                  className={`group flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg transition-colors ${
                    active
                      ? "bg-[#00a884] text-white font-semibold"
                      : "text-slate-700 hover:bg-slate-100 font-medium"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setGroupFilter(active ? "ALL" : g.id)}
                    className="flex-1 text-left truncate cursor-pointer"
                    title={g.description || g.name}
                  >
                    {g.name}
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs tabular-nums opacity-80">
                      {g.membersCount}
                    </span>
                    {!isSystem && (
                      <button
                        type="button"
                        onClick={() => void onDeleteGroup(g.id)}
                        title="Remove group"
                        className={`opacity-0 group-hover:opacity-100 p-0.5 rounded cursor-pointer ${
                          active
                            ? "hover:bg-white/20"
                            : "hover:bg-red-50 text-red-600"
                        }`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {data && data.allTags.length > 0 && (
          <div className="pt-2 border-t border-neutral-200 space-y-2">
            <div className="eyebrow-label text-slate-400 px-1">Tags</div>
            <div className="flex flex-wrap gap-1.5 px-0.5">
              {data.allTags.slice(0, 18).map((t) => {
                const active = tagFilter === t.tag;
                return (
                  <button
                    key={t.tag}
                    type="button"
                    onClick={() => setTagFilter(active ? "ALL" : t.tag)}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border cursor-pointer transition-colors ${
                      active
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-slate-50 text-slate-700 border-neutral-200 hover:bg-slate-100"
                    }`}
                  >
                    #{t.tag} ({t.count})
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {data && data.importLogs.length > 0 && (
        <div className="bg-white rounded-xl border border-neutral-200/90 p-3.5 space-y-2.5 shadow-2xs">
          <div className="eyebrow-label text-slate-400">
            Recent Imports &amp; Syncs
          </div>
          <div className="space-y-2">
            {data.importLogs.slice(0, 4).map((log) => (
              <div
                key={log.id}
                className="p-2 rounded-lg bg-slate-50 border border-neutral-200/80 text-xs space-y-0.5"
              >
                <div className="font-semibold text-slate-800 truncate">
                  {log.sourceLabel}
                </div>
                <div className="text-[11px] text-slate-500 tabular-nums">
                  +{log.importedCount} new • {log.updatedCount} updated
                </div>
                <div className="text-[10.5px] text-slate-400">
                  {log.importedByName} • {formatDateShort(log.createdAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function GroupsModal({
  selectedCount,
  marketingLists,
  onClose,
  onPushToBroadcastList,
}: {
  selectedCount: number;
  marketingLists: Array<{ id: string; name: string; membersCount: number }>;
  onClose: () => void;
  onPushToBroadcastList: (
    listId: string,
    newListName: string
  ) => Promise<boolean>;
}) {
  const [targetListId, setTargetListId] = useState<string>("NEW");
  const [newBroadcastListName, setNewBroadcastListName] = useState<string>("");
  const [pushingToList, setPushingToList] = useState<boolean>(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPushingToList(true);
    try {
      const ok = await onPushToBroadcastList(
        targetListId,
        newBroadcastListName
      );
      if (ok) {
        setNewBroadcastListName("");
        onClose();
      }
    } finally {
      setPushingToList(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-neutral-200 w-full sm:max-w-md max-h-[92dvh] overflow-y-auto shadow-xl">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-slate-900">
            Send {selectedCount} Selected Contacts to Broadcast List
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-slate-500">
            Only contacts marked <strong>Opted In</strong> are added so your WhatsApp number stays protected.
          </p>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Destination Broadcast List
            </label>
            <select
              value={targetListId}
              onChange={(e) => setTargetListId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm bg-white"
            >
              <option value="NEW">+ Create a New Broadcast List</option>
              {marketingLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.membersCount} contacts)
                </option>
              ))}
            </select>
          </div>

          {targetListId === "NEW" && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                New Broadcast List Name *
              </label>
              <input
                type="text"
                required
                value={newBroadcastListName}
                onChange={(e) => setNewBroadcastListName(e.target.value)}
                placeholder="e.g. Hyderabad Banquet Buyers"
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg border border-neutral-300 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pushingToList}
              className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer"
            >
              {pushingToList ? "Saving..." : "Save to Broadcast List"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
