"use client";

import React from "react";
import { Trash2 } from "lucide-react";
import { CardListSkeleton, ElementErrorState } from "@cc/ui";
import type { AcrioPreview, MarketingListItem } from "@/app/dashboard/marketing/types";

export function MarketingListsTab({
  initialLoading,
  loadError,
  refreshing,
  canSendBroadcasts,
  lists,
  acrioPrompt,
  setAcrioPrompt,
  acrioPreview,
  listNameDraft,
  setListNameDraft,
  previewLoading,
  previewError,
  savingList,
  onRetry,
  onAcrioPreview,
  onSaveAcrioList,
  onDeleteList,
}: {
  initialLoading: boolean;
  loadError: string;
  refreshing: boolean;
  canSendBroadcasts: boolean;
  lists: MarketingListItem[];
  acrioPrompt: string;
  setAcrioPrompt: (v: string) => void;
  acrioPreview: AcrioPreview | null;
  listNameDraft: string;
  setListNameDraft: (v: string) => void;
  previewLoading: boolean;
  previewError: string;
  savingList: boolean;
  onRetry: () => void;
  onAcrioPreview: (e?: React.FormEvent) => Promise<void>;
  onSaveAcrioList: () => Promise<void>;
  onDeleteList: (listId: string, name: string) => Promise<void>;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-6 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">
            Build a Customer List with ACRIO
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Describe who you want to message in plain words and preview matching contacts.
          </p>
        </div>

        <form onSubmit={onAcrioPreview} className="space-y-3 text-xs">
          <textarea
            rows={2}
            value={acrioPrompt}
            onChange={(e) => setAcrioPrompt(e.target.value)}
            placeholder="e.g. Schools and colleges looking for student awards"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-neutral-900"
          />
          <div className="flex flex-wrap gap-1.5">
            {[
              "Hotels and banquet buyers",
              "Schools, colleges & student award leads",
              "Industrial & custom fabrication clients",
              "Repeat buyers over Rs 30000",
            ].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAcrioPrompt(preset)}
                className="px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs cursor-pointer"
              >
                {preset}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={previewLoading}
            className="px-4 py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium cursor-pointer"
          >
            {previewLoading
              ? "Finding matching contacts..."
              : "Find Matching Contacts"}
          </button>
        </form>

        {previewLoading && <CardListSkeleton rows={2} />}

        {previewError && !previewLoading && (
          <ElementErrorState
            compact
            title="Could not preview customer group"
            message={previewError}
            onRetry={() => void onAcrioPreview()}
          />
        )}

        {acrioPreview && !previewLoading && (
          <div className="p-4 rounded-md bg-neutral-50 border border-neutral-200 space-y-3 text-xs">
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                List Name
              </label>
              <input
                type="text"
                value={listNameDraft}
                onChange={(e) => setListNameDraft(e.target.value)}
                className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-900"
              />
            </div>
            <p className="text-neutral-600">{acrioPreview.filterExplanation}</p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {acrioPreview.matchedCustomers.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between bg-white px-3 py-1.5 rounded border border-neutral-200"
                >
                  <div>
                    <span className="font-medium text-neutral-900">
                      {c.name}
                    </span>{" "}
                    <span className="text-neutral-500">({c.phone})</span>
                  </div>
                  <span className="text-neutral-600">
                    Spent ₹{c.lifetimeValueInr.toLocaleString("en-IN")}
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void onSaveAcrioList()}
              disabled={savingList}
              className="w-full py-2 rounded-md bg-[#1da851] hover:bg-[#178c43] text-white font-medium cursor-pointer"
            >
              {savingList ? "Saving..." : "Save Customer List"}
            </button>
          </div>
        )}
      </div>

      <div className="lg:col-span-6 bg-white rounded-lg border border-neutral-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900">
          Saved Customer Lists
        </h2>
        {initialLoading ? (
          <CardListSkeleton rows={3} />
        ) : loadError ? (
          <ElementErrorState
            compact
            title="Could not load saved lists"
            message={loadError}
            onRetry={onRetry}
            retrying={refreshing}
          />
        ) : (
          <div className="space-y-2.5 max-h-80 overflow-y-auto">
            {lists.map((l) => (
              <div
                key={l.id}
                className="p-3.5 rounded-md border border-neutral-200 bg-neutral-50/60 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-neutral-900">
                    {l.name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded bg-white border border-neutral-200 text-neutral-700 text-[11px] font-medium">
                      {l.membersCount} contacts
                    </span>
                    {canSendBroadcasts && (
                      <button
                        type="button"
                        onClick={() => void onDeleteList(l.id, l.name)}
                        title="Remove list"
                        className="p-1 text-neutral-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-neutral-600">{l.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
