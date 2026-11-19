"use client";

import React from "react";
import { BotOff, CheckCircle2, Edit3, Trash2 } from "lucide-react";
import {
  ACTION_LABELS,
  TRIGGER_LABELS,
  type AutomationRule,
} from "./automations-types";

export function AutomationRuleCard({
  rule,
  onEdit,
  onDelete,
  onToggle,
}: {
  rule: AutomationRule;
  onEdit: (rule: AutomationRule) => void;
  onDelete: (rule: AutomationRule) => void;
  onToggle: (rule: AutomationRule) => void;
}) {
  const payload = rule.actionPayload || {};
  const stopsAi =
    payload.stopFurtherAi !== undefined
      ? Boolean(payload.stopFurtherAi)
      : rule.actionType !== "SMART_TAG";

  return (
    <div
      className={`bg-white rounded-xl border border-neutral-200 p-4 shadow-2xs transition ${
        rule.isEnabled ? "" : "opacity-60 bg-neutral-50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded bg-neutral-900 text-white text-[10.5px] font-mono">
              #{rule.priorityOrder ?? 50}
            </span>
            <h3 className="text-sm font-bold text-neutral-900">{rule.name}</h3>
            <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 text-[11px] font-medium">
              {TRIGGER_LABELS[rule.triggerType] || rule.triggerType}
            </span>
            <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 text-[11px] font-medium">
              {ACTION_LABELS[rule.actionType] || rule.actionType}
            </span>
            {stopsAi && (
              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10.5px] font-semibold inline-flex items-center gap-1">
                <BotOff className="w-3 h-3" />
                <span>Stops AI</span>
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-600">{rule.description}</p>
          {typeof payload.replyText === "string" && payload.replyText && (
            <p className="text-xs text-neutral-700 bg-neutral-50 border border-neutral-200/80 rounded-lg px-2.5 py-1.5 mt-1.5 line-clamp-2">
              {payload.replyText}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onEdit(rule)}
            title="Edit rule"
            className="p-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(rule)}
            title="Delete rule"
            className="p-1.5 rounded-lg border border-neutral-200 text-neutral-400 hover:text-red-600 hover:border-red-200 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onToggle(rule)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
              rule.isEnabled
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-white text-neutral-600 border-neutral-300"
            }`}
          >
            {rule.isEnabled ? "On" : "Off"}
          </button>
        </div>
      </div>

      <div className="mt-3 pt-2.5 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
        <span className="truncate max-w-md">
          Match:{" "}
          <strong className="font-mono text-neutral-800">
            {rule.triggerCondition}
          </strong>
        </span>
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>Triggered {rule.runsCount} times</span>
        </span>
      </div>
    </div>
  );
}
