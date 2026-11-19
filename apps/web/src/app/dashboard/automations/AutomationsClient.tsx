"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, Zap } from "lucide-react";
import {
  CardListSkeleton,
  ElementErrorState,
  SHORTLINK_PUBLIC_ORIGIN,
} from "@cc/ui";
import {
  STARTER_PRESETS,
  type AutomationRule,
  type DryRunResult,
  type TeamOption,
  type TemplateOption,
} from "./automations-types";
import { AutomationSimulatorCard } from "./AutomationSimulatorCard";
import { AutomationRuleCard } from "./AutomationRuleCard";
import { AutomationRuleBuilderPanel } from "./AutomationRuleBuilderPanel";

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
      <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Zap className="w-6 h-6 text-[#00a884]" />
            <span>Advanced Auto-Replies & AI Credit Guard</span>
          </h1>
          <p className="text-xs sm:text-[13.5px] leading-relaxed text-slate-600 mt-1">
            Auto-reply rules run BEFORE ACRIO AI. Matching common questions
            (GST, hours, order tracking, button payloads, or urgent bulk
            handoffs) gives customers an instant answer and saves AI credits.
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
              flashNotice(
                `Loaded "${preset.label}" into the builder on the right.`
              );
            }}
            className="px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-[#e7fce3] hover:text-[#008069] text-neutral-800 font-medium cursor-pointer transition"
          >
            + {preset.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-5">
          <AutomationSimulatorCard
            simText={simText}
            setSimText={setSimText}
            simButtonPayload={simButtonPayload}
            setSimButtonPayload={setSimButtonPayload}
            simFirstContact={simFirstContact}
            setSimFirstContact={setSimFirstContact}
            simLoading={simLoading}
            simResult={simResult}
            onRunSimulation={handleRunSimulation}
          />

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
                No auto-reply rules yet. Pick a 1-click starter above or create
                one on the right.
              </div>
            ) : (
              rules.map((r) => (
                <AutomationRuleCard
                  key={r.id}
                  rule={r}
                  onEdit={startEditRule}
                  onDelete={deleteRule}
                  onToggle={toggleRule}
                />
              ))
            )}
          </div>
        </div>

        <AutomationRuleBuilderPanel
          editingRuleId={editingRuleId}
          resetForm={resetForm}
          name={name}
          setName={setName}
          priorityOrder={priorityOrder}
          setPriorityOrder={setPriorityOrder}
          description={description}
          setDescription={setDescription}
          triggerType={triggerType}
          setTriggerType={setTriggerType}
          actionType={actionType}
          setActionType={setActionType}
          triggerCondition={triggerCondition}
          setTriggerCondition={setTriggerCondition}
          teamId={teamId}
          setTeamId={setTeamId}
          teams={teams}
          templateName={templateName}
          setTemplateName={setTemplateName}
          approvedTemplates={approvedTemplates}
          smartCategory={smartCategory}
          setSmartCategory={setSmartCategory}
          priority={priority}
          setPriority={setPriority}
          replyText={replyText}
          setReplyText={setReplyText}
          stopFurtherAi={stopFurtherAi}
          setStopFurtherAi={setStopFurtherAi}
          onSubmit={handleSaveRule}
        />
      </div>
    </div>
  );
}
