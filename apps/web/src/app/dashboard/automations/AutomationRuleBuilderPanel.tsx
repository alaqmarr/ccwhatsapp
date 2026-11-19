"use client";

import React from "react";
import { Plus, X } from "lucide-react";
import {
  ACTION_LABELS,
  TRIGGER_LABELS,
  type TeamOption,
  type TemplateOption,
} from "./automations-types";

export function AutomationRuleBuilderPanel({
  editingRuleId,
  resetForm,
  name,
  setName,
  priorityOrder,
  setPriorityOrder,
  description,
  setDescription,
  triggerType,
  setTriggerType,
  actionType,
  setActionType,
  triggerCondition,
  setTriggerCondition,
  teamId,
  setTeamId,
  teams,
  templateName,
  setTemplateName,
  approvedTemplates,
  smartCategory,
  setSmartCategory,
  priority,
  setPriority,
  replyText,
  setReplyText,
  stopFurtherAi,
  setStopFurtherAi,
  onSubmit,
}: {
  editingRuleId: string | null;
  resetForm: () => void;
  name: string;
  setName: (v: string) => void;
  priorityOrder: number;
  setPriorityOrder: (v: number) => void;
  description: string;
  setDescription: (v: string) => void;
  triggerType: string;
  setTriggerType: (v: string) => void;
  actionType: string;
  setActionType: (v: string) => void;
  triggerCondition: string;
  setTriggerCondition: (v: string) => void;
  teamId: string;
  setTeamId: (v: string) => void;
  teams: TeamOption[];
  templateName: string;
  setTemplateName: (v: string) => void;
  approvedTemplates: TemplateOption[];
  smartCategory: string;
  setSmartCategory: (v: string) => void;
  priority: string;
  setPriority: (v: string) => void;
  replyText: string;
  setReplyText: (v: string) => void;
  stopFurtherAi: boolean;
  setStopFurtherAi: (v: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className="lg:col-span-5 bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 space-y-4 shadow-2xs lg:sticky lg:top-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-neutral-900">
          {editingRuleId ? "Edit Auto-Reply Rule" : "Create Auto-Reply Rule"}
        </h2>
        {editingRuleId && (
          <button
            type="button"
            onClick={resetForm}
            className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Cancel Edit</span>
          </button>
        )}
      </div>

      <form onSubmit={onSubmit} className="space-y-3 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <div className="sm:col-span-3">
            <label className="block font-medium text-neutral-700 mb-1">
              Rule Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Podium Enquiry Instant Reply"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Order #
            </label>
            <input
              type="number"
              min={1}
              max={999}
              value={priorityOrder}
              onChange={(e) => setPriorityOrder(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-2.5 py-2"
            />
          </div>
        </div>

        <div>
          <label className="block font-medium text-neutral-700 mb-1">
            Short Summary
          </label>
          <input
            type="text"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Explains to staff what this rule handles"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              When to Trigger
            </label>
            <select
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 bg-white"
            >
              {Object.entries(TRIGGER_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Action to Run
            </label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 bg-white"
            >
              {Object.entries(ACTION_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {triggerType !== "FIRST_CONTACT" &&
          triggerType !== "ORDER_INQUIRY" && (
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                {triggerType === "OUT_OF_HOURS_IST"
                  ? "Quiet Hours Window IST (24h format, e.g. 19:30-09:30)"
                  : triggerType === "BUTTON_PAYLOAD"
                  ? "Button Payload ID or Button Text (comma separated)"
                  : triggerType === "REGEX"
                  ? "Regular Expression Pattern"
                  : "Matching Words or Phrases (comma separated)"}
              </label>
              <input
                type="text"
                required
                value={triggerCondition}
                onChange={(e) => setTriggerCondition(e.target.value)}
                placeholder={
                  triggerType === "OUT_OF_HOURS_IST"
                    ? "19:30-09:30"
                    : "podium, lectern, stage"
                }
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono"
              />
            </div>
          )}

        {(actionType === "ASSIGN_TEAM" || actionType === "COMBO") && (
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Target Team for Handoff (+ Staff Email Alert)
            </label>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 bg-white"
            >
              <option value="team_sales">Sales Team (Default)</option>
              {teams
                .filter((t) => t.id !== "team_sales")
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        {actionType === "SEND_APPROVED_TEMPLATE" && (
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Meta-Approved Template
            </label>
            {approvedTemplates.length === 0 ? (
              <p className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
                No Meta-APPROVED templates yet. Submit and sync a template in
                the Templates page first.
              </p>
            ) : (
              <select
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 bg-white"
              >
                {approvedTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.name}>
                    {tpl.name} ({tpl.category})
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Product Topic Tag
            </label>
            <select
              value={smartCategory}
              onChange={(e) => setSmartCategory(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 bg-white"
            >
              <option value="Podiums & Stage">Podiums & Stage</option>
              <option value="Awards & Trophies">Awards & Trophies</option>
              <option value="Hotel & Banquet">Hotel & Banquet</option>
              <option value="Machines & Polishing">Machines & Polishing</option>
              <option value="Custom Fabrication">Custom Fabrication</option>
              <option value="Order & Delivery">Order & Delivery</option>
              <option value="General Enquiry">General Enquiry</option>
            </select>
          </div>
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Urgency
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 bg-white"
            >
              <option value="URGENT">Urgent</option>
              <option value="HIGH">High</option>
              <option value="NORMAL">Normal</option>
            </select>
          </div>
        </div>

        {(actionType === "AUTO_REPLY" || actionType === "COMBO") && (
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Automatic WhatsApp Reply
            </label>
            <textarea
              rows={4}
              required
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
            />
          </div>
        )}

        <label className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-50/70 border border-emerald-200 cursor-pointer">
          <input
            type="checkbox"
            checked={stopFurtherAi}
            onChange={(e) => setStopFurtherAi(e.target.checked)}
            className="mt-0.5 rounded border-emerald-400"
          />
          <div>
            <div className="font-semibold text-emerald-950">
              Stop ACRIO AI when this rule matches (saves AI credits)
            </div>
            <p className="text-[11px] text-emerald-900 mt-0.5">
              Keep checked when this rule already answers or assigns the chat so
              Claude Haiku is not billed twice.
            </p>
          </div>
        </label>

        <button
          type="submit"
          className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white font-semibold cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{editingRuleId ? "Update Rule" : "Save Auto-Reply Rule"}</span>
        </button>
      </form>
    </div>
  );
}
