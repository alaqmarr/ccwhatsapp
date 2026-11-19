"use client";

import React, { useState } from "react";
import { X } from "lucide-react";
import type { TeamCreateInput } from "@/app/dashboard/teams/types";

export function TeamMemberModal({
  creatingTeam,
  onClose,
  onCreateTeam,
}: {
  creatingTeam: boolean;
  onClose: () => void;
  onCreateTeam: (input: TeamCreateInput) => Promise<boolean>;
}) {
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [brandScope, setBrandScope] = useState<string>("ALL");
  const [routingKeywords, setRoutingKeywords] = useState<string>("");
  const [priorityRank, setPriorityRank] = useState<number>(5);
  const [p0WaitMinutes, setP0WaitMinutes] = useState<number>(5);
  const [p1WaitMinutes, setP1WaitMinutes] = useState<number>(12);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await onCreateTeam({
      name,
      description,
      brandScope,
      routingKeywords,
      priorityRank,
      p0WaitMinutes,
      p1WaitMinutes,
    });
    if (ok) {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-t-2xl sm:rounded-xl border border-neutral-200 sm:max-w-lg w-full max-h-[92dvh] overflow-y-auto p-4 sm:p-5 space-y-4 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">
            Create New Routing Team
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              Team Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hospitality & Hotel Desk"
              className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              What this team handles
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Bulk menu holders, buffet risers, and room signage"
              className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Brand Focus
              </label>
              <select
                value={brandScope}
                onChange={(e) => setBrandScope(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm bg-white"
              >
                <option value="ALL">Both Brands</option>
                <option value="CLASSIC_CONCEPTS">
                  Classic Concepts Products
                </option>
                <option value="CLASSIC_EDGE_53">
                  Classic Edge 53 Machines
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Team Priority (1 = highest)
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={priorityRank}
                onChange={(e) => setPriorityRank(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              Auto-Routing Words (comma separated)
            </label>
            <input
              type="text"
              value={routingKeywords}
              onChange={(e) => setRoutingKeywords(e.target.value)}
              placeholder="e.g. hotel, resort, menu, banquet, qr stand"
              className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Move P0 to P1 after (minutes)
              </label>
              <input
                type="number"
                min={1}
                max={60}
                value={p0WaitMinutes}
                onChange={(e) => setP0WaitMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Move P1 to P2 after (minutes)
              </label>
              <input
                type="number"
                min={2}
                max={120}
                value={p1WaitMinutes}
                onChange={(e) => setP1WaitMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-neutral-300 text-xs font-medium text-neutral-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={creatingTeam}
            className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer"
          >
            {creatingTeam ? "Creating..." : "Create Team"}
          </button>
        </div>
      </form>
    </div>
  );
}
