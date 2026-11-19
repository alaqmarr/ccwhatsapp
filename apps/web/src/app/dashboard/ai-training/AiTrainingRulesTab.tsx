"use client";

import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { TrainingRule } from "./ai-training-types";

export default function AiTrainingRulesTab({
  rules,
  editRuleId,
  ruleTitle,
  setRuleTitle,
  ruleText,
  setRuleText,
  ruleScope,
  setRuleScope,
  saving,
  onSaveRule,
  onResetRuleForm,
  onStartEditRule,
  onToggleRule,
  onRemoveRule,
}: {
  rules: TrainingRule[];
  editRuleId: string | null;
  ruleTitle: string;
  setRuleTitle: (v: string) => void;
  ruleText: string;
  setRuleText: (v: string) => void;
  ruleScope: "BOTH" | "CUSTOMER_CHAT" | "STAFF_COPILOT";
  setRuleScope: (v: "BOTH" | "CUSTOMER_CHAT" | "STAFF_COPILOT") => void;
  saving: boolean;
  onSaveRule: (e: React.FormEvent) => void;
  onResetRuleForm: () => void;
  onStartEditRule: (r: TrainingRule) => void;
  onToggleRule: (r: TrainingRule) => void;
  onRemoveRule: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <form
        onSubmit={onSaveRule}
        className="rounded-xl border border-neutral-200 bg-white p-5 space-y-4 h-fit shadow-2xs"
      >
        <h2 className="text-sm font-semibold text-neutral-900">
          {editRuleId ? "Edit Behavior Rule" : "Add Mandatory AI Instruction"}
        </h2>
        <div>
          <label className="block text-[11px] font-medium text-neutral-700 mb-1">
            Rule Title
          </label>
          <input
            type="text"
            required
            value={ruleTitle}
            onChange={(e) => setRuleTitle(e.target.value)}
            placeholder="Never confirm delivery timelines for custom orders without team"
            className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-neutral-700 mb-1">
            Applies To
          </label>
          <select
            value={ruleScope}
            onChange={(e) =>
              setRuleScope(e.target.value as "BOTH" | "CUSTOMER_CHAT" | "STAFF_COPILOT")
            }
            className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs bg-white"
          >
            <option value="BOTH">Both Customer Chats & Staff Copilot</option>
            <option value="CUSTOMER_CHAT">Customer WhatsApp Replies Only</option>
            <option value="STAFF_COPILOT">Internal @ACRIO Notes Only</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-neutral-700 mb-1">
            Clear Rule Instruction
          </label>
          <textarea
            rows={4}
            required
            value={ruleText}
            onChange={(e) => setRuleText(e.target.value)}
            placeholder="Write a direct rule ACRIO must obey in every reply..."
            className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs"
          />
        </div>
        <div className="flex justify-end gap-2">
          {editRuleId && (
            <button
              type="button"
              onClick={onResetRuleForm}
              className="px-3.5 py-2 rounded-lg border border-neutral-300 text-xs font-medium cursor-pointer"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {saving ? "Saving..." : editRuleId ? "Update Rule" : "Save Rule"}
          </button>
        </div>
      </form>

      <div className="space-y-3">
        {rules.length === 0 ? (
          <div className="p-8 rounded-xl border border-dashed border-neutral-300 bg-white text-center text-xs text-neutral-500">
            No custom rules saved yet. Add instructions here to strictly control tone, quoting, or handoffs.
          </div>
        ) : (
          rules.map((r) => (
            <div
              key={r.id}
              className={`rounded-xl border p-4 bg-white space-y-2 ${
                r.isEnabled ? "border-neutral-200" : "border-neutral-200 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-neutral-900">{r.title}</div>
                  <div className="text-[11px] text-neutral-500">
                    Scope: {r.scope} • {r.createdByName || "Team"}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onToggleRule(r)}
                    className={`px-2 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                      r.isEnabled
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-neutral-200 text-neutral-700"
                    }`}
                  >
                    {r.isEnabled ? "Active" : "Paused"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartEditRule(r)}
                    className="p-1.5 rounded hover:bg-neutral-100 text-neutral-600 cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveRule(r.id)}
                    className="p-1.5 rounded hover:bg-red-50 text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-neutral-800 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {r.ruleText}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
