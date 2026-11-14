"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { WHATSAPP_PUBLIC_ORIGIN } from "@cc/ui";

interface AutomationRule {
  id: string;
  name: string;
  description: string;
  triggerType: string;
  triggerCondition: string;
  actionType: string;
  actionPayload: Record<string, unknown>;
  isEnabled: boolean;
  runsCount: number;
  lastTriggeredAt: string | null;
}

export default function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [triggerType, setTriggerType] = useState<string>("KEYWORD");
  const [triggerCondition, setTriggerCondition] = useState<string>(
    "podium, lectern, stage"
  );
  const [actionType, setActionType] = useState<string>("AUTO_REPLY");
  const [replyText, setReplyText] = useState<string>(
    `Hello! Thank you for messaging Classic Concepts. Here is our stage podium collection while a team member checks your enquiry: ${WHATSAPP_PUBLIC_ORIGIN}/l/stage-podiums`
  );
  const [smartCategory, setSmartCategory] = useState<string>("Podiums & Stage");
  const [priority, setPriority] = useState<string>("HIGH");
  const [notice, setNotice] = useState<string>("");

  const loadRules = useCallback(async () => {
    const res = await fetch("/api/automations", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setRules(data.automations || []);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  async function toggleRule(rule: AutomationRule) {
    const res = await fetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "toggle",
        id: rule.id,
        isEnabled: !rule.isEnabled,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      await loadRules();
    } else {
      setNotice(data.error || "Admin permission required.");
    }
  }

  async function handleCreateRule(e: React.FormEvent) {
    e.preventDefault();
    const actionPayload =
      actionType === "AUTO_REPLY"
        ? { replyText, smartCategory, priority }
        : { smartCategory, priority };

    const res = await fetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        name,
        description,
        triggerType,
        triggerCondition: triggerType === "FIRST_CONTACT" ? "*" : triggerCondition,
        actionType,
        actionPayload,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setName("");
      setDescription("");
      setNotice("Rule saved.");
      setTimeout(() => setNotice(""), 3000);
      await loadRules();
    } else {
      setNotice(data.error || "Could not save rule.");
    }
  }

  return (
    <div className="w-full px-6 py-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">
            Auto-Replies & Topic Rules
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Automatically sort new enquiries by product topic or send an instant greeting when a customer messages us.
          </p>
        </div>
        {notice && (
          <div className="px-3.5 py-2 rounded-md bg-neutral-100 border border-neutral-300 text-xs font-medium text-neutral-900">
            {notice}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-3">
          {rules.map((r) => (
            <div
              key={r.id}
              className={`bg-white rounded-lg border border-neutral-200 p-4 ${
                r.isEnabled ? "" : "opacity-60 bg-neutral-50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-neutral-900">
                      {r.name}
                    </h3>
                    <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 text-[11px] font-medium">
                      {r.triggerType === "FIRST_CONTACT"
                        ? "First Message"
                        : "Words Match"}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-600 mt-1">{r.description}</p>
                </div>

                <button
                  type="button"
                  onClick={() => toggleRule(r)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border cursor-pointer ${
                    r.isEnabled
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                      : "bg-white text-neutral-600 border-neutral-300"
                  }`}
                >
                  {r.isEnabled ? "On" : "Off"}
                </button>
              </div>

              <div className="mt-3 pt-2.5 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
                <span>
                  Words:{" "}
                  <strong className="text-neutral-800">{r.triggerCondition}</strong>
                </span>
                <span>Used {r.runsCount} times</span>
              </div>
            </div>
          ))}
        </div>

        <div className="lg:col-span-5 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-neutral-900">
            Add New Rule
          </h2>

          <form onSubmit={handleCreateRule} className="space-y-3 text-xs">
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Rule Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Podium Enquiry Greeting"
                className="w-full rounded-md border border-neutral-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                What this rule does
              </label>
              <input
                type="text"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Marks podium chats and shares catalog link"
                className="w-full rounded-md border border-neutral-300 px-3 py-2"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  When to run
                </label>
                <select
                  value={triggerType}
                  onChange={(e) => setTriggerType(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
                >
                  <option value="KEYWORD">Customer mentions words</option>
                  <option value="FIRST_CONTACT">New customer messages first time</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Action
                </label>
                <select
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
                >
                  <option value="AUTO_REPLY">Set Topic + Send Reply</option>
                  <option value="SMART_TAG">Set Topic Only</option>
                </select>
              </div>
            </div>

            {triggerType === "KEYWORD" && (
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Matching Words (separated by commas)
                </label>
                <input
                  type="text"
                  required
                  value={triggerCondition}
                  onChange={(e) => setTriggerCondition(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Product Topic
                </label>
                <select
                  value={smartCategory}
                  onChange={(e) => setSmartCategory(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
                >
                  <option value="Podiums & Stage">Podiums & Stage</option>
                  <option value="Awards & Trophies">Awards & Trophies</option>
                  <option value="Hotel & Banquet">Hotel & Banquet</option>
                  <option value="Custom Fabrication">Custom Fabrication</option>
                  <option value="Order & Delivery">Order & Delivery</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Urgency
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
                >
                  <option value="URGENT">Urgent</option>
                  <option value="HIGH">High</option>
                  <option value="NORMAL">Normal</option>
                </select>
              </div>
            </div>

            {actionType === "AUTO_REPLY" && (
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Automatic Reply Text
                </label>
                <textarea
                  rows={3}
                  required
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2"
                />
              </div>
            )}

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Save Rule</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
