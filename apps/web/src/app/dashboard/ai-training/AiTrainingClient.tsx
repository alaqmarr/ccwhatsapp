"use client";

import React, { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { BookOpen, Bot, FileText, FlaskConical, RefreshCw, ShieldAlert } from "lucide-react";
import { CardListSkeleton } from "@cc/ui";
import { AiTrainingExamplesTab } from "./AiTrainingExamplesTab";
import type {
  AiTrainingInitialData,
  CatalogProductOption,
  CompanyDoc,
  RecentQuestionItem,
  SimTurn,
  TrainingExample,
  TrainingRule,
  WebsiteDoc,
} from "./ai-training-types";

const AiTrainingRulesTab = dynamic(() => import("./AiTrainingRulesTab"), {
  loading: () => <CardListSkeleton rows={4} />,
});

const AiTrainingDocsTab = dynamic(() => import("./AiTrainingDocsTab"), {
  loading: () => <CardListSkeleton rows={4} />,
});

const AiTrainingSimulatorTab = dynamic(() => import("./AiTrainingSimulatorTab"), {
  loading: () => <CardListSkeleton rows={4} />,
});

export function AiTrainingClient({
  initialData,
}: {
  initialData?: AiTrainingInitialData;
}) {
  const [tab, setTab] = useState<"QA" | "RULES" | "DOCS" | "SIMULATOR">("QA");
  const [examples, setExamples] = useState<TrainingExample[]>(initialData?.examples ?? []);
  const [rules, setRules] = useState<TrainingRule[]>(initialData?.rules ?? []);
  const [companyDocs, setCompanyDocs] = useState<CompanyDoc[]>(initialData?.documents ?? []);
  const [websiteDocs, setWebsiteDocs] = useState<WebsiteDoc[]>(initialData?.websiteDocuments ?? []);
  const [docTitle, setDocTitle] = useState("GST Certificate");
  const [docSlug, setDocSlug] = useState("gst-certificate");
  const [docCategory, setDocCategory] = useState<"COMPLIANCE" | "CATALOGUE" | "BANKING" | "COMPANY_PROFILE">("COMPLIANCE");
  const [docNumber, setDocNumber] = useState("");
  const [docKeywords, setDocKeywords] = useState("gst, gstin, tax certificate, gst certificate");
  const [docUploading, setDocUploading] = useState(false);
  const [products, setProducts] = useState<CatalogProductOption[]>(initialData?.products ?? []);
  const [recentQuestions, setRecentQuestions] = useState<RecentQuestionItem[]>(
    initialData?.recentCustomerQuestions ?? []
  );
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  // Q&A & Action Instruction editor
  const [editExId, setEditExId] = useState<string | null>(null);
  const [exGuidanceType, setExGuidanceType] = useState<"INSTRUCTION" | "FIXED_ANSWER">("INSTRUCTION");
  const [exTitle, setExTitle] = useState("");
  const [exCategory, setExCategory] = useState("Handling & Routing");
  const [exQuestion, setExQuestion] = useState("");
  const [exAnswer, setExAnswer] = useState("");
  const [exDoNotSay, setExDoNotSay] = useState("");
  const [exProductSlug, setExProductSlug] = useState("");
  const [exPriority, setExPriority] = useState<"HIGH" | "NORMAL">("HIGH");

  // Rule editor
  const [editRuleId, setEditRuleId] = useState<string | null>(null);
  const [ruleTitle, setRuleTitle] = useState("");
  const [ruleText, setRuleText] = useState("");
  const [ruleScope, setRuleScope] = useState<"BOTH" | "CUSTOMER_CHAT" | "STAFF_COPILOT">("BOTH");

  // Simulator state
  const [simTurns, setSimTurns] = useState<SimTurn[]>([]);
  const [simInput, setSimInput] = useState("");
  const [simState, setSimState] = useState<Record<string, unknown> | undefined>(undefined);
  const [simBusy, setSimBusy] = useState(false);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [res, docsRes] = await Promise.all([
        fetch("/api/ai-training", { cache: "no-store" }),
        fetch("/api/company-documents", { cache: "no-store" }),
      ]);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setExamples(data.examples || []);
        setRules(data.rules || []);
        setProducts(data.products || []);
        setRecentQuestions(data.recentCustomerQuestions || []);
      }
      const docsData = await docsRes.json().catch(() => ({}));
      if (docsRes.ok && docsData.ok) {
        setCompanyDocs(docsData.documents || []);
        setWebsiteDocs(docsData.websiteDocuments || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialData) {
      void loadData();
    }
  }, [initialData, loadData]);

  function resetExampleForm(defaultMode: "INSTRUCTION" | "FIXED_ANSWER" = "INSTRUCTION") {
    setEditExId(null);
    setExGuidanceType(defaultMode);
    setExTitle("");
    setExCategory(defaultMode === "INSTRUCTION" ? "Handling & Routing" : "Product Knowledge");
    setExQuestion("");
    setExAnswer("");
    setExDoNotSay("");
    setExProductSlug("");
    setExPriority("HIGH");
  }

  function startEditExample(ex: TrainingExample) {
    setEditExId(ex.id);
    setExGuidanceType(ex.guidanceType === "INSTRUCTION" ? "INSTRUCTION" : "FIXED_ANSWER");
    setExTitle(ex.title);
    setExCategory(ex.category);
    setExQuestion(ex.customerQuestion);
    setExAnswer(ex.idealAnswer);
    setExDoNotSay(ex.doNotSay);
    setExProductSlug(ex.productSlug);
    setExPriority(ex.priority);
    setTab("QA");
  }

  async function saveExample(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/ai-training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_example",
          id: editExId || undefined,
          title: exTitle,
          category: exCategory,
          guidanceType: exGuidanceType,
          customerQuestion: exQuestion,
          idealAnswer: exAnswer,
          doNotSay: exDoNotSay,
          productSlug: exProductSlug,
          priority: exPriority,
          isEnabled: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        notify(data.error || "Could not save training entry.");
        return;
      }
      notify(
        editExId
          ? exGuidanceType === "INSTRUCTION"
            ? "Action instruction updated."
            : "Fixed answer updated."
          : exGuidanceType === "INSTRUCTION"
          ? "Action instruction saved."
          : "Fixed answer saved."
      );
      resetExampleForm(exGuidanceType);
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  async function toggleExample(ex: TrainingExample) {
    await fetch("/api/ai-training", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsert_example", ...ex, isEnabled: !ex.isEnabled }),
    });
    await loadData();
  }

  async function removeExample(id: string) {
    await fetch("/api/ai-training", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_example", id }),
    });
    notify("Training example removed.");
    if (editExId === id) resetExampleForm();
    await loadData();
  }

  function resetRuleForm() {
    setEditRuleId(null);
    setRuleTitle("");
    setRuleText("");
    setRuleScope("BOTH");
  }

  async function saveRule(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/ai-training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_rule",
          id: editRuleId || undefined,
          title: ruleTitle,
          ruleText,
          scope: ruleScope,
          isEnabled: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        notify(data.error || "Could not save rule.");
        return;
      }
      notify(editRuleId ? "AI rule updated." : "AI rule saved.");
      resetRuleForm();
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(r: TrainingRule) {
    await fetch("/api/ai-training", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsert_rule", ...r, isEnabled: !r.isEnabled }),
    });
    await loadData();
  }

  async function removeRule(id: string) {
    await fetch("/api/ai-training", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_rule", id }),
    });
    notify("Rule removed.");
    if (editRuleId === id) resetRuleForm();
    await loadData();
  }

  async function sendSimulatorTurn(e: React.FormEvent) {
    e.preventDefault();
    const q = simInput.trim();
    if (!q || simBusy) return;
    setSimBusy(true);
    setSimInput("");
    const priorTurns = simTurns.map((t) => ({ role: t.role, text: t.text }));
    setSimTurns((prev) => [...prev, { role: "customer", text: q }]);

    try {
      const res = await fetch("/api/ai-training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "simulate", question: q, turns: priorTurns, state: simState }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.result) {
        notify(data.error || "Simulator run failed.");
        return;
      }
      const r = data.result;
      setSimState(r.nextState);
      setSimTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          text: String(r.replyText || ""),
          meta: {
            needsHumanHandoff: Boolean(r.needsHumanHandoff),
            smartCategory: String(r.smartCategory || ""),
            activeProduct: r.nextState?.activeProduct || null,
            productHistory: Array.isArray(r.nextState?.productHistory)
              ? r.nextState.productHistory
              : [],
          },
        },
      ]);
    } finally {
      setSimBusy(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 w-full space-y-6">
      {toast && (
        <div className="fixed bottom-4 left-3 right-3 sm:left-auto sm:right-5 sm:max-w-sm z-50 px-4 py-2.5 rounded-lg bg-neutral-900 text-white text-xs font-semibold shadow-xl text-center sm:text-left [overflow-wrap:anywhere]">
          {toast}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-neutral-100 border border-neutral-200 text-neutral-800 flex items-center justify-center">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-neutral-900">
              AI Training Studio (ACRIO)
            </h1>
            <p className="text-xs text-neutral-600">
              Give ACRIO instructions on what to do for specific situations, save verified fixed answers, set strict rules, and test replies before going live.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-700 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-3">
        <button
          type="button"
          onClick={() => setTab("QA")}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
            tab === "QA"
              ? "bg-neutral-900 text-white"
              : "bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Instructions &amp; Q&amp;A ({examples.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("RULES")}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
            tab === "RULES"
              ? "bg-neutral-900 text-white"
              : "bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Behavior Rules ({rules.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("DOCS")}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
            tab === "DOCS"
              ? "bg-neutral-900 text-white"
              : "bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Company Documents ({companyDocs.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("SIMULATOR")}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
            tab === "SIMULATOR"
              ? "bg-violet-700 text-white"
              : "bg-violet-50 border border-violet-200 text-violet-900 hover:bg-violet-100"
          }`}
        >
          <FlaskConical className="w-3.5 h-3.5" />
          <span>Test AI Live (Multi-Turn Simulator)</span>
        </button>
      </div>

      {tab === "QA" && (
        <AiTrainingExamplesTab
          examples={examples}
          products={products}
          recentQuestions={recentQuestions}
          form={{
            editExId,
            exGuidanceType,
            setExGuidanceType,
            exTitle,
            setExTitle,
            exCategory,
            setExCategory,
            exQuestion,
            setExQuestion,
            exAnswer,
            setExAnswer,
            exDoNotSay,
            setExDoNotSay,
            exProductSlug,
            setExProductSlug,
            exPriority,
            setExPriority,
            saving,
            onSaveExample: (e) => void saveExample(e),
            onResetForm: resetExampleForm,
            onLoadRecentQuestion: (rq, mode) => {
              setEditExId(null);
              setExGuidanceType(mode);
              setExTitle(
                mode === "INSTRUCTION"
                  ? `Handle: ${rq.question.slice(0, 38)}`
                  : `FAQ: ${rq.question.slice(0, 40)}`
              );
              setExQuestion(rq.question);
              setExAnswer("");
              setExCategory(
                mode === "INSTRUCTION" ? "Handling & Routing" : "Mistake Fix"
              );
              notify(
                mode === "INSTRUCTION"
                  ? "Loaded message to write an action instruction."
                  : "Loaded message to set a fixed answer."
              );
            },
          }}
          onStartEditExample={startEditExample}
          onToggleExample={(ex) => void toggleExample(ex)}
          onRemoveExample={(id) => void removeExample(id)}
        />
      )}

      {tab === "RULES" && (
        <AiTrainingRulesTab
          rules={rules}
          editRuleId={editRuleId}
          ruleTitle={ruleTitle}
          setRuleTitle={setRuleTitle}
          ruleText={ruleText}
          setRuleText={setRuleText}
          ruleScope={ruleScope}
          setRuleScope={setRuleScope}
          saving={saving}
          onSaveRule={(e) => void saveRule(e)}
          onResetRuleForm={resetRuleForm}
          onStartEditRule={(r) => {
            setEditRuleId(r.id);
            setRuleTitle(r.title);
            setRuleText(r.ruleText);
            setRuleScope(r.scope);
          }}
          onToggleRule={(r) => void toggleRule(r)}
          onRemoveRule={(id) => void removeRule(id)}
        />
      )}

      {tab === "SIMULATOR" && (
        <AiTrainingSimulatorTab
          simTurns={simTurns}
          simInput={simInput}
          setSimInput={setSimInput}
          simState={simState}
          simBusy={simBusy}
          onSendTurn={(e) => void sendSimulatorTurn(e)}
          onReset={() => {
            setSimTurns([]);
            setSimState(undefined);
          }}
        />
      )}

      {tab === "DOCS" && (
        <AiTrainingDocsTab
          companyDocs={companyDocs}
          websiteDocs={websiteDocs}
          docTitle={docTitle}
          setDocTitle={setDocTitle}
          docSlug={docSlug}
          setDocSlug={setDocSlug}
          docCategory={docCategory}
          setDocCategory={setDocCategory}
          docNumber={docNumber}
          setDocNumber={setDocNumber}
          docKeywords={docKeywords}
          setDocKeywords={setDocKeywords}
          docUploading={docUploading}
          setDocUploading={setDocUploading}
          notify={notify}
          onReload={loadData}
        />
      )}
    </div>
  );
}
