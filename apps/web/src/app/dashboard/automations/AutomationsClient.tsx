"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  BotOff,
  CheckCircle2,
  Edit3,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  CardListSkeleton,
  ElementErrorState,
  SHORTLINK_PUBLIC_ORIGIN,
  TRACKING_PUBLIC_ORIGIN,
} from "@cc/ui";

interface AutomationRule {
  id: string;
  name: string;
  description: string;
  triggerType: string;
  triggerCondition: string;
  actionType: string;
  actionPayload: Record<string, unknown>;
  priorityOrder?: number;
  isEnabled: boolean;
  runsCount: number;
  lastTriggeredAt: string | null;
}

interface TeamOption {
  id: string;
  name: string;
}

interface TemplateOption {
  id: string;
  name: string;
  category: string;
  languageCode?: string;
}

interface DryRunResult {
  orderLookupDetected: {
    explicitOrderId: string | null;
    asksAboutOrder: boolean;
  };
  matchedRules: {
    id: string;
    name: string;
    triggerType: string;
    actionType: string;
    stopFurtherAi: boolean;
    simulatedReply?: string;
  }[];
  wouldRunAcrioAi?: boolean;
}

const TRIGGER_LABELS: Record<string, string> = {
  KEYWORD: "Contains Any Word",
  EXACT: "Exact Phrase Match",
  STARTS_WITH: "Starts With",
  REGEX: "Regex Pattern",
  FIRST_CONTACT: "New First-Time Customer",
  OUT_OF_HOURS_IST: "Outside Working Hours (IST)",
  BUTTON_PAYLOAD: "Quick-Reply Button Payload",
  ORDER_INQUIRY: "Order / Tracking Question",
};

const ACTION_LABELS: Record<string, string> = {
  AUTO_REPLY: "Send Instant Auto-Reply",
  COMBO: "Combo (Reply + Tag + Assign Team)",
  ASSIGN_TEAM: "Assign Directly to Team",
  SEND_ORDER_STATUS: "Lookup & Send Order Track Link",
  SEND_APPROVED_TEMPLATE: "Send Meta-Approved Template",
  SMART_TAG: "Tag Topic & Urgency Only",
};

const STARTER_PRESETS = [
  {
    label: "GST / Invoice Info",
    name: "GST Invoice & Billing Auto-Answer",
    description: "Answers GST billing questions without spending ACRIO AI credits",
    triggerType: "KEYWORD",
    triggerCondition: "gst, gstin, proforma, tax invoice",
    actionType: "AUTO_REPLY",
    replyText:
      "Yes, we issue a full 18% GST tax invoice on all Classic Concepts and Classic Edge 53 orders. Share your company GSTIN, billing address, and pincode whenever ready.",
    smartCategory: "Order & Delivery",
    priority: "NORMAL",
    stopFurtherAi: true,
  },
  {
    label: "Bulk Hotel / Event Handoff",
    name: "Urgent Bulk Hotel & Event Routing",
    description: "Sends a quick acknowledgment and connects Sales Team P0",
    triggerType: "KEYWORD",
    triggerCondition: "bulk order, 50 pieces, 100 pieces, hotel tender, urgent quote",
    actionType: "COMBO",
    replyText:
      "Thank you! I am connecting your bulk requirement directly to our Sales Team so they can share volume pricing right away.",
    smartCategory: "Hotel & Banquet",
    priority: "URGENT",
    stopFurtherAi: true,
  },
  {
    label: "After-Hours Greeting",
    name: "After-Hours Instant Reply (IST)",
    description: "Lets late-evening customers know when our Hyderabad workshop opens",
    triggerType: "OUT_OF_HOURS_IST",
    triggerCondition: "19:30-09:30",
    actionType: "AUTO_REPLY",
    replyText: `Hello! Thank you for messaging Classic Concepts. Our workshop team is live Mon to Sat, 9:30 AM to 7:30 PM IST. You can track existing orders anytime at ${TRACKING_PUBLIC_ORIGIN} or share your requirement here for first-priority morning follow-up.`,
    smartCategory: "General Enquiry",
    priority: "NORMAL",
    stopFurtherAi: false,
  },
] as const;

export function AutomationsClient({
  initialData,
}: {
  initialData?: {
    teams: TeamOption[];
    approvedTemplates: TemplateOption[];
    automations: AutomationRule[];
  };
}) {
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");

  const [rules, setRules] = useState<AutomationRule[]>(
    initialData?.automations ?? []
  );
  const [teams, setTeams] = useState<TeamOption[]>(initialData?.teams ?? []);
  const [approvedTemplates, setApprovedTemplates] = useState<TemplateOption[]>(
    initialData?.approvedTemplates ?? []
  );

  // Form state (supports both Create & Edit)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [triggerType, setTriggerType] = useState<string>("KEYWORD");
  const [triggerCondition, setTriggerCondition] = useState<string>(
    "podium, lectern, stage"
  );
  const [actionType, setActionType] = useState<string>("AUTO_REPLY");
  const [replyText, setReplyText] = useState<string>(
    `Hello! Thank you for messaging Classic Concepts. Share the size and quantity you need, or browse our short links (${SHORTLINK_PUBLIC_ORIGIN}) while we check your message.`
  );
  const [smartCategory, setSmartCategory] = useState<string>("Podiums & Stage");
  const [priority, setPriority] = useState<string>("HIGH");
  const [teamId, setTeamId] = useState<string>("team_sales");
  const [templateName, setTemplateName] = useState<string>(
    initialData?.approvedTemplates?.[0]?.name || ""
  );
  const [priorityOrder, setPriorityOrder] = useState<number>(50);
  const [stopFurtherAi, setStopFurtherAi] = useState<boolean>(true);
  const [notice, setNotice] = useState<string>("");

  // Live Simulator state
  const [simText, setSimText] = useState<string>(
    "Hi, do you provide a GST tax invoice for 10 podiums?"
  );
  const [simButtonPayload, setSimButtonPayload] = useState<string>("");
  const [simFirstContact, setSimFirstContact] = useState<boolean>(false);
  const [simLoading, setSimLoading] = useState<boolean>(false);
  const [simResult, setSimResult] = useState<DryRunResult | null>(null);

  const flashNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 3500);
  };

  const loadRules = useCallback(async () => {
    setRefreshing(true);
    setLoadError("");
    try {
      const res = await fetch("/api/automations", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setRules(data.automations || []);
        if (Array.isArray(data.teams)) setTeams(data.teams);
        if (Array.isArray(data.approvedTemplates)) {
          setApprovedTemplates(data.approvedTemplates);
          if (!templateName && data.approvedTemplates[0]?.name) {
            setTemplateName(data.approvedTemplates[0].name);
          }
        }
      } else {
        setLoadError(
          data.error || "Could not load auto-reply rules right now."
        );
      }
    } catch {
      setLoadError(
        "Network error while loading auto-reply rules. Click Try Again."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [templateName]);

  useEffect(() => {
    if (!initialData) {
      void loadRules();
    }
  }, [initialData, loadRules]);

  function resetForm() {
    setEditingRuleId(null);
    setName("");
    setDescription("");
    setTriggerType("KEYWORD");
    setTriggerCondition("podium, lectern, stage");
    setActionType("AUTO_REPLY");
    setSmartCategory("Podiums & Stage");
    setPriority("HIGH");
    setTeamId("team_sales");
    setPriorityOrder(50);
    setStopFurtherAi(true);
  }

  function startEditRule(rule: AutomationRule) {
    setEditingRuleId(rule.id);
    setName(rule.name);
    setDescription(rule.description);
    setTriggerType(rule.triggerType);
    setTriggerCondition(rule.triggerCondition);
    setActionType(rule.actionType);
    const p = rule.actionPayload || {};
    setReplyText(String(p.replyText || ""));
    setSmartCategory(String(p.smartCategory || "General Enquiry"));
    setPriority(String(p.priority || "NORMAL"));
    setTeamId(String(p.teamId || "team_sales"));
    setTemplateName(String(p.templateName || approvedTemplates[0]?.name || ""));
    setPriorityOrder(Number(rule.priorityOrder ?? 50));
    setStopFurtherAi(
      p.stopFurtherAi !== undefined
        ? Boolean(p.stopFurtherAi)
        : rule.actionType !== "SMART_TAG"
    );
  }

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
      flashNotice(data.error || "Admin permission required.");
    }
  }

  async function deleteRule(rule: AutomationRule) {
    if (!window.confirm(`Delete auto-reply rule "${rule.name}"?`)) return;
    const res = await fetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id: rule.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      if (editingRuleId === rule.id) resetForm();
      flashNotice("Rule deleted.");
      await loadRules();
    } else {
      flashNotice(data.error || "Could not delete rule.");
    }
  }

  async function handleSaveRule(e: React.FormEvent) {
    e.preventDefault();
    const actionPayload: Record<string, unknown> = {
      smartCategory,
      priority,
      stopFurtherAi,
    };
    if (actionType === "AUTO_REPLY" || actionType === "COMBO") {
      actionPayload.replyText = replyText.trim();
    }
    if (actionType === "ASSIGN_TEAM" || actionType === "COMBO") {
      actionPayload.teamId = teamId || "team_sales";
    }
    if (actionType === "SEND_APPROVED_TEMPLATE") {
      actionPayload.templateName = templateName;
    }

    const cleanCondition =
      triggerType === "FIRST_CONTACT" || triggerType === "ORDER_INQUIRY"
        ? "*"
        : triggerCondition.trim() || "*";

    const res = await fetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: editingRuleId ? "update" : "create",
        id: editingRuleId || undefined,
        name: name.trim(),
        description: description.trim(),
        triggerType,
        triggerCondition: cleanCondition,
        actionType,
        actionPayload,
        priorityOrder,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      flashNotice(editingRuleId ? "Rule updated." : "New auto-reply rule saved.");
      resetForm();
      await loadRules();
    } else {
      flashNotice(data.error || "Could not save rule.");
    }
  }

  async function handleRunSimulation(e: React.FormEvent) {
    e.preventDefault();
    setSimLoading(true);
    try {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test_rule",
          sampleText: simText,
          isFirstContact: simFirstContact,
          buttonPayload: simButtonPayload.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setSimResult(data.simulation || null);
      } else {
        flashNotice(data.error || "Simulation failed.");
      }
    } finally {
      setSimLoading(false);
    }
  }

  return (
    <div className="w-full p-3.5 sm:p-4 lg:p-6 space-y-5 sm:space-y-6 bg-neutral-50 min-h-dvh">
      {/* Header */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Zap className="w-6 h-6 text-[#00a884]" />
            <span>Advanced Auto-Replies & AI Credit Guard</span>
          </h1>
          <p className="text-xs sm:text-[13.5px] leading-relaxed text-slate-600 mt-1">
            Auto-reply rules run BEFORE ACRIO AI. Matching common questions (GST, hours, order tracking, button payloads, or urgent bulk handoffs) gives customers an instant answer and saves AI credits.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {notice && (
            <div className="px-3.5 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-950">
              {notice}
            </div>
          )}
          <button
            type="button"
            onClick={() => loadRules()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-neutral-50 border border-neutral-300 text-xs font-medium text-neutral-700 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Quick Starter Presets */}
      <div className="bg-white rounded-xl border border-neutral-200 px-4 py-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-neutral-700">
          1-Click Starter Templates:
        </span>
        {STARTER_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              setEditingRuleId(null);
              setName(preset.name);
              setDescription(preset.description);
              setTriggerType(preset.triggerType);
              setTriggerCondition(preset.triggerCondition);
              setActionType(preset.actionType);
              setReplyText(preset.replyText);
              setSmartCategory(preset.smartCategory);
              setPriority(preset.priority);
              setStopFurtherAi(preset.stopFurtherAi);
              flashNotice(`Loaded "${preset.label}" into the builder on the right.`);
            }}
            className="px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-[#e7fce3] hover:text-[#008069] text-neutral-800 font-medium cursor-pointer transition"
          >
            + {preset.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: ACTIVE RULES + LIVE RULE SIMULATOR */}
        <div className="lg:col-span-7 space-y-5">
          {/* Live Rule & AI Credit Guard Simulator */}
          <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 space-y-3.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-neutral-900 flex items-center gap-1.5">
                  <Play className="w-4 h-4 text-[#00a884]" />
                  <span>Live Rule & Order Lookup Simulator (Zero Credits Used)</span>
                </h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Test what happens when a customer sends a message or taps a button before making a rule live.
                </p>
              </div>
            </div>

            <form onSubmit={handleRunSimulation} className="space-y-2.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={simText}
                  onChange={(e) => setSimText(e.target.value)}
                  placeholder="Type a sample customer message or order ID (e.g. CC-2609)..."
                  className="sm:col-span-2 rounded-lg border border-neutral-300 px-3 py-2"
                />
                <input
                  type="text"
                  value={simButtonPayload}
                  onChange={(e) => setSimButtonPayload(e.target.value)}
                  placeholder="Optional Button Payload"
                  className="rounded-lg border border-neutral-300 px-3 py-2 font-mono"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-1.5 text-neutral-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simFirstContact}
                    onChange={(e) => setSimFirstContact(e.target.checked)}
                    className="rounded border-neutral-300"
                  />
                  <span>Simulate first-time new customer</span>
                </label>
                <button
                  type="submit"
                  disabled={simLoading}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white font-semibold cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{simLoading ? "Testing..." : "Test Pipeline"}</span>
                </button>
              </div>
            </form>

            {simResult && (
              <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-3 space-y-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  {simResult.orderLookupDetected.explicitOrderId ||
                  simResult.orderLookupDetected.asksAboutOrder ? (
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-semibold">
                      Stage 3 Order Lookup Triggered (
                      {simResult.orderLookupDetected.explicitOrderId || "Order Status Query"}
                      )
                    </span>
                  ) : null}

                  <span
                    className={`px-2 py-0.5 rounded font-semibold inline-flex items-center gap-1 ${
                      simResult.matchedRules.some((m) => m.stopFurtherAi) ||
                      simResult.orderLookupDetected.explicitOrderId
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-indigo-100 text-indigo-900"
                    }`}
                  >
                    {simResult.matchedRules.some((m) => m.stopFurtherAi) ||
                    simResult.orderLookupDetected.explicitOrderId ? (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>ACRIO AI Skipped (0 AI Credits Spent)</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Continues to ACRIO AI (Claude Haiku 5.5)</span>
                      </>
                    )}
                  </span>
                </div>

                {simResult.matchedRules.length === 0 ? (
                  <p className="text-neutral-600">
                    No custom auto-reply rule matched this text.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {simResult.matchedRules.map((m) => (
                      <div
                        key={m.id}
                        className="p-2 rounded bg-white border border-neutral-200 space-y-1"
                      >
                        <div className="font-semibold text-neutral-900 flex items-center justify-between">
                          <span>Matched: {m.name}</span>
                          <span className="text-[11px] text-neutral-500">
                            {ACTION_LABELS[m.actionType] || m.actionType}
                          </span>
                        </div>
                        {m.simulatedReply && (
                          <p className="text-neutral-700 bg-[#e7fce3]/60 px-2.5 py-1.5 rounded">
                            {m.simulatedReply}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Rules List */}
          <div className="space-y-3">
            {loading ? (
              <CardListSkeleton rows={4} />
            ) : loadError ? (
              <ElementErrorState
                title="Could not load auto-reply rules"
                message={loadError}
                onRetry={() => loadRules()}
                retrying={refreshing}
              />
            ) : rules.length === 0 ? (
              <div className="bg-white rounded-xl border border-neutral-200 p-6 text-center text-xs text-neutral-500">
                No auto-reply rules yet. Pick a 1-click starter above or create one on the right.
              </div>
            ) : (
              rules.map((r) => {
                const payload = r.actionPayload || {};
                const stopsAi =
                  payload.stopFurtherAi !== undefined
                    ? Boolean(payload.stopFurtherAi)
                    : r.actionType !== "SMART_TAG";
                return (
                  <div
                    key={r.id}
                    className={`bg-white rounded-xl border border-neutral-200 p-4 shadow-2xs transition ${
                      r.isEnabled ? "" : "opacity-60 bg-neutral-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-neutral-900 text-white text-[10.5px] font-mono">
                            #{r.priorityOrder ?? 50}
                          </span>
                          <h3 className="text-sm font-bold text-neutral-900">
                            {r.name}
                          </h3>
                          <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 text-[11px] font-medium">
                            {TRIGGER_LABELS[r.triggerType] || r.triggerType}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 text-[11px] font-medium">
                            {ACTION_LABELS[r.actionType] || r.actionType}
                          </span>
                          {stopsAi && (
                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10.5px] font-semibold inline-flex items-center gap-1">
                              <BotOff className="w-3 h-3" />
                              <span>Stops AI</span>
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-600">{r.description}</p>
                        {typeof payload.replyText === "string" && payload.replyText && (
                          <p className="text-xs text-neutral-700 bg-neutral-50 border border-neutral-200/80 rounded-lg px-2.5 py-1.5 mt-1.5 line-clamp-2">
                            {payload.replyText}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEditRule(r)}
                          title="Edit rule"
                          className="p-1.5 rounded-lg border border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRule(r)}
                          title="Delete rule"
                          className="p-1.5 rounded-lg border border-neutral-200 text-neutral-400 hover:text-red-600 hover:border-red-200 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleRule(r)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                            r.isEnabled
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                              : "bg-white text-neutral-600 border-neutral-300"
                          }`}
                        >
                          {r.isEnabled ? "On" : "Off"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
                      <span className="truncate max-w-md">
                        Match:{" "}
                        <strong className="font-mono text-neutral-800">
                          {r.triggerCondition}
                        </strong>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Triggered {r.runsCount} times</span>
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: CREATE / EDIT RULE BUILDER */}
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

          <form onSubmit={handleSaveRule} className="space-y-3 text-xs">
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
                    No Meta-APPROVED templates yet. Submit and sync a template in the Templates page first.
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
                  Keep checked when this rule already answers or assigns the chat so Claude Haiku is not billed twice.
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
      </div>
    </div>
  );
}
