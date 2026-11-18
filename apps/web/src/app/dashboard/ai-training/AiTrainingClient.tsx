"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Bot,
  BookOpen,
  CheckCircle2,
  FileText,
  FlaskConical,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { formatDateTimeIst } from "@cc/ui";

interface TrainingExample {
  id: string;
  title: string;
  category: string;
  customerQuestion: string;
  idealAnswer: string;
  doNotSay: string;
  productSlug: string;
  priority: "HIGH" | "NORMAL";
  isEnabled: boolean;
  createdByName: string;
  updatedAt: string;
}

interface TrainingRule {
  id: string;
  title: string;
  ruleText: string;
  scope: "BOTH" | "CUSTOMER_CHAT" | "STAFF_COPILOT";
  isEnabled: boolean;
  createdByName: string;
  updatedAt: string;
}

interface CatalogProductOption {
  slug: string;
  name: string;
  sku: string | null;
  brandLabel: string;
  priceInr: number | null;
}

interface RecentQuestionItem {
  id: string;
  conversationId: string;
  customerName: string;
  question: string;
  createdAt: string;
}

interface SimTurn {
  role: "customer" | "assistant";
  text: string;
  meta?: {
    needsHumanHandoff?: boolean;
    smartCategory?: string;
    activeProduct?: string | null;
    productHistory?: string[];
  };
}

interface CompanyDoc {
  id: string;
  slug: string;
  title: string;
  category: "COMPLIANCE" | "CATALOGUE" | "BANKING" | "COMPANY_PROFILE";
  docNumber: string;
  mediaId: string;
  waMediaId: string;
  mediaUrl: string;
  mediaType: string;
  fileName: string;
  mimeType: string;
  keywords: string;
  uploadedBy: string;
  updatedAt: string;
}

interface WebsiteDoc {
  id: string;
  slug: string;
  title: string;
  source: string;
  sourceLabel: string;
  category: string;
  mediaUrl: string;
  mediaType: string;
  fileName: string;
}

export function AiTrainingClient({
  initialData,
}: {
  initialData?: {
    examples: TrainingExample[];
    rules: TrainingRule[];
    products: CatalogProductOption[];
    recentCustomerQuestions: RecentQuestionItem[];
    documents: CompanyDoc[];
    websiteDocuments: WebsiteDoc[];
  };
}) {
  const [tab, setTab] = useState<"QA" | "RULES" | "DOCS" | "SIMULATOR">("QA");
  const [examples, setExamples] = useState<TrainingExample[]>(
    initialData?.examples ?? []
  );
  const [rules, setRules] = useState<TrainingRule[]>(initialData?.rules ?? []);
  const [companyDocs, setCompanyDocs] = useState<CompanyDoc[]>(
    initialData?.documents ?? []
  );
  const [websiteDocs, setWebsiteDocs] = useState<WebsiteDoc[]>(
    initialData?.websiteDocuments ?? []
  );
  const [docTitle, setDocTitle] = useState("GST Certificate");
  const [docSlug, setDocSlug] = useState("gst-certificate");
  const [docCategory, setDocCategory] = useState<"COMPLIANCE" | "CATALOGUE" | "BANKING" | "COMPANY_PROFILE">("COMPLIANCE");
  const [docNumber, setDocNumber] = useState("");
  const [docKeywords, setDocKeywords] = useState("gst, gstin, tax certificate, gst certificate");
  const [docUploading, setDocUploading] = useState(false);
  const [products, setProducts] = useState<CatalogProductOption[]>(
    initialData?.products ?? []
  );
  const [recentQuestions, setRecentQuestions] = useState<RecentQuestionItem[]>(
    initialData?.recentCustomerQuestions ?? []
  );
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  // Q&A editor
  const [editExId, setEditExId] = useState<string | null>(null);
  const [exTitle, setExTitle] = useState("");
  const [exCategory, setExCategory] = useState("Product Knowledge");
  const [exQuestion, setExQuestion] = useState("");
  const [exAnswer, setExAnswer] = useState("");
  const [exDoNotSay, setExDoNotSay] = useState("");
  const [exProductSlug, setExProductSlug] = useState("");
  const [exPriority, setExPriority] = useState<"HIGH" | "NORMAL">("HIGH");

  // Rule editor
  const [editRuleId, setEditRuleId] = useState<string | null>(null);
  const [ruleTitle, setRuleTitle] = useState("");
  const [ruleText, setRuleText] = useState("");
  const [ruleScope, setRuleScope] = useState<
    "BOTH" | "CUSTOMER_CHAT" | "STAFF_COPILOT"
  >("BOTH");

  // Simulator state
  const [simTurns, setSimTurns] = useState<SimTurn[]>([]);
  const [simInput, setSimInput] = useState("");
  const [simState, setSimState] = useState<Record<string, unknown> | undefined>(
    undefined
  );
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

  function resetExampleForm() {
    setEditExId(null);
    setExTitle("");
    setExCategory("Product Knowledge");
    setExQuestion("");
    setExAnswer("");
    setExDoNotSay("");
    setExProductSlug("");
    setExPriority("HIGH");
  }

  function startEditExample(ex: TrainingExample) {
    setEditExId(ex.id);
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
        notify(data.error || "Could not save Q&A training pair.");
        return;
      }
      notify(editExId ? "Q&A example updated." : "Q&A example saved.");
      resetExampleForm();
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  async function toggleExample(ex: TrainingExample) {
    await fetch("/api/ai-training", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert_example",
        ...ex,
        isEnabled: !ex.isEnabled,
      }),
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
      body: JSON.stringify({
        action: "upsert_rule",
        ...r,
        isEnabled: !r.isEnabled,
      }),
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
        body: JSON.stringify({
          action: "simulate",
          question: q,
          turns: priorTurns,
          state: simState,
        }),
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
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {toast && (
        <div className="fixed bottom-4 left-3 right-3 sm:left-auto sm:right-5 sm:max-w-sm z-50 px-4 py-2.5 rounded-lg bg-neutral-900 text-white text-xs font-semibold shadow-xl text-center sm:text-left [overflow-wrap:anywhere]">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-800 flex items-center justify-center">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-neutral-900">
              AI Training Studio (ACRIO)
            </h1>
            <p className="text-xs text-neutral-600">
              Teach ACRIO the exact answers to real customer questions, set strict rules, and test multi-product conversations before going live.
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

      {/* Tabs */}
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
          <span>Q&A Training Pairs ({examples.length})</span>
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

      {/* TAB 1: Q&A TRAINING PAIRS */}
      {tab === "QA" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <form
              onSubmit={saveExample}
              className="rounded-xl border border-neutral-200 bg-white p-5 space-y-4 shadow-2xs"
            >
              <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
                <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-[#008069]" />
                  <span>{editExId ? "Edit Training Q&A" : "Teach ACRIO a New Q&A"}</span>
                </h2>
                {editExId && (
                  <button
                    type="button"
                    onClick={resetExampleForm}
                    className="text-xs text-neutral-600 underline cursor-pointer"
                  >
                    Cancel edit
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                    Short Title
                  </label>
                  <input
                    type="text"
                    required
                    value={exTitle}
                    onChange={(e) => setExTitle(e.target.value)}
                    placeholder="GST & Bulk Pricing Policy"
                    className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                    Topic / Category
                  </label>
                  <select
                    value={exCategory}
                    onChange={(e) => setExCategory(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs bg-white"
                  >
                    <option value="Product Knowledge">Product Knowledge</option>
                    <option value="Pricing & Bulk">Pricing & Bulk</option>
                    <option value="Shipping & Crating">Shipping & Crating</option>
                    <option value="Machine Service & Parts">Machine Service & Parts</option>
                    <option value="Custom Work & Logo">Custom Work & Logo</option>
                    <option value="Mistake Fix">Fix Past AI Mistake</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                    Priority
                  </label>
                  <select
                    value={exPriority}
                    onChange={(e) =>
                      setExPriority(e.target.value as "HIGH" | "NORMAL")
                    }
                    className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs bg-white"
                  >
                    <option value="HIGH">High (Always check first)</option>
                    <option value="NORMAL">Normal</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Link to Catalog Product (optional)
                </label>
                <select
                  value={exProductSlug}
                  onChange={(e) => setExProductSlug(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs bg-white"
                >
                  <option value="">General / Applies to any matching question</option>
                  {products.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name} {p.sku ? `(${p.sku})` : ""} - {p.brandLabel}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Customer Question or Keywords
                </label>
                <textarea
                  rows={2}
                  required
                  value={exQuestion}
                  onChange={(e) => setExQuestion(e.target.value)}
                  placeholder="Example: Do you ship podiums to Bangalore with GST invoice and logo printing?"
                  className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Exact Verified Answer ACRIO Should Give
                </label>
                <textarea
                  rows={3}
                  required
                  value={exAnswer}
                  onChange={(e) => setExAnswer(e.target.value)}
                  placeholder="Write in plain everyday English. Give exact steps, timelines, or policies."
                  className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  What NOT to Say / Common Trap to Avoid (optional)
                </label>
                <input
                  type="text"
                  value={exDoNotSay}
                  onChange={(e) => setExDoNotSay(e.target.value)}
                  placeholder="e.g. Never quote flat shipping rates for custom crates without knowing city"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-xs"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {saving
                    ? "Saving..."
                    : editExId
                    ? "Update Training Pair"
                    : "Save Training Pair"}
                </button>
              </div>
            </form>

            {/* Saved Q&A Pairs List */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wide">
                Active & Saved Training Knowledge ({examples.length})
              </h3>
              {examples.length === 0 ? (
                <div className="p-8 rounded-xl border border-dashed border-neutral-300 bg-white text-center text-xs text-neutral-500">
                  No Q&A pairs saved yet. Add one above or pick a real customer question from the right.
                </div>
              ) : (
                examples.map((ex) => (
                  <div
                    key={ex.id}
                    className={`rounded-xl border p-4 bg-white space-y-2 ${
                      ex.isEnabled ? "border-neutral-200" : "border-neutral-200 opacity-60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-neutral-900">
                            {ex.title}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700 text-[10.5px] font-medium">
                            {ex.category}
                          </span>
                          {ex.priority === "HIGH" && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10.5px] font-semibold">
                              HIGH PRIORITY
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          Updated by {ex.createdByName || "Team"} •{" "}
                          {formatDateTimeIst(ex.updatedAt)}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void toggleExample(ex)}
                          className={`px-2 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                            ex.isEnabled
                              ? "bg-emerald-100 text-emerald-900"
                              : "bg-neutral-200 text-neutral-700"
                          }`}
                        >
                          {ex.isEnabled ? "Active" : "Paused"}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditExample(ex)}
                          className="p-1.5 rounded hover:bg-neutral-100 text-neutral-600 cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeExample(ex.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="text-xs bg-neutral-50 border border-neutral-100 rounded-lg p-2.5">
                      <span className="font-semibold text-neutral-700">When asked: </span>
                      <span className="text-neutral-800">{ex.customerQuestion}</span>
                    </div>
                    <div className="text-xs bg-[#e7fce3]/60 border border-[#b7ebaf] rounded-lg p-2.5">
                      <span className="font-semibold text-[#008069]">Approved answer: </span>
                      <span className="text-neutral-900 whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {ex.idealAnswer}
                      </span>
                    </div>
                    {ex.doNotSay && (
                      <div className="text-[11.5px] text-red-800 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">
                        <strong>Avoid: </strong>
                        {ex.doNotSay}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Sidebar: Pick Real Customer Questions */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3 h-fit shadow-2xs">
            <h3 className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-violet-700" />
              <span>Turn Recent Chat Questions Into Training</span>
            </h3>
            <p className="text-[11px] text-neutral-600">
              Click any real customer message below to pre-fill the training form with it.
            </p>
            <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
              {recentQuestions.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  No recent inbound text questions found yet.
                </p>
              ) : (
                recentQuestions.map((rq) => (
                  <div
                    key={rq.id}
                    className="p-2.5 rounded-lg border border-neutral-200 bg-neutral-50/80 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[11px] text-neutral-500">
                      <span className="font-semibold text-neutral-800 truncate">
                        {rq.customerName}
                      </span>
                      <span>{formatDateTimeIst(rq.createdAt)}</span>
                    </div>
                    <p className="text-xs text-neutral-800 line-clamp-3">
                      {rq.question}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setEditExId(null);
                        setExTitle(`FAQ: ${rq.question.slice(0, 40)}`);
                        setExQuestion(rq.question);
                        setExCategory("Mistake Fix");
                        notify("Loaded customer question into trainer.");
                      }}
                      className="text-[11px] font-semibold text-[#008069] hover:underline cursor-pointer"
                    >
                      + Train Answer for This
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BEHAVIORAL RULES */}
      {tab === "RULES" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <form
            onSubmit={saveRule}
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
                  setRuleScope(
                    e.target.value as "BOTH" | "CUSTOMER_CHAT" | "STAFF_COPILOT"
                  )
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
                  onClick={resetRuleForm}
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
                      <div className="text-sm font-semibold text-neutral-900">
                        {r.title}
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        Scope: {r.scope} • {r.createdByName || "Team"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void toggleRule(r)}
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
                        onClick={() => {
                          setEditRuleId(r.id);
                          setRuleTitle(r.title);
                          setRuleText(r.ruleText);
                          setRuleScope(r.scope);
                        }}
                        className="p-1.5 rounded hover:bg-neutral-100 text-neutral-600 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeRule(r.id)}
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
      )}

      {/* TAB 3: LIVE MULTI-TURN SIMULATOR */}
      {tab === "SIMULATOR" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 rounded-xl border border-neutral-200 bg-white flex flex-col h-[460px] sm:h-[580px] overflow-hidden shadow-2xs">
            <div className="px-3.5 sm:px-4 py-2.5 sm:py-3 border-b border-neutral-200 bg-[#f0f2f5] flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-neutral-900 flex items-center gap-1.5 min-w-0">
                <FlaskConical className="w-4 h-4 text-violet-700 shrink-0" />
                <span className="truncate">Multi-Turn Conversation Test (Try switching Products A -&gt; B -&gt; C)</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSimTurns([]);
                  setSimState(undefined);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-neutral-300 text-[11px] font-medium text-neutral-700 cursor-pointer shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Chat</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 bg-[#efeae2]">
              {simTurns.length === 0 ? (
                <div className="text-center py-8 sm:py-12 space-y-2">
                  <p className="text-xs font-semibold text-neutral-700">
                    Start typing customer messages below to test ACRIO with your latest training pairs and rules.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 pt-2">
                    {[
                      "Tell me about CCP054 podium",
                      "What is the price of CCP065 instead?",
                      "Actually, compare CCP065 and YN-JW1200 machine",
                    ].map((sample) => (
                      <button
                        key={sample}
                        type="button"
                        onClick={() => setSimInput(sample)}
                        className="px-3 py-1.5 rounded-full bg-white border border-neutral-300 text-[11px] text-neutral-800 hover:bg-neutral-50 cursor-pointer"
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                simTurns.map((t, idx) => (
                  <div
                    key={idx}
                    className={`flex ${
                      t.role === "assistant" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[92%] sm:max-w-[82%] rounded-lg px-3.5 py-2.5 text-xs shadow-2xs space-y-1.5 min-w-0 [overflow-wrap:anywhere] ${
                        t.role === "assistant"
                          ? "bg-[#d9fdd3] text-neutral-900"
                          : "bg-white text-neutral-900"
                      }`}
                    >
                      <div className="font-semibold text-[11px] text-neutral-600">
                        {t.role === "assistant" ? "ACRIO AI" : "Test Customer"}
                      </div>
                      <div className="whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed">
                        {t.text}
                      </div>
                      {t.meta && (
                        <div className="pt-1 border-t border-black/10 flex flex-wrap gap-1.5 text-[10px]">
                          {t.meta.activeProduct && (
                            <span className="px-1.5 py-0.5 rounded bg-white/80 font-medium text-neutral-800">
                              Active: {t.meta.activeProduct}
                            </span>
                          )}
                          {t.meta.needsHumanHandoff && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold">
                              Routed to Human Team
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {simBusy && (
                <div className="flex justify-end">
                  <div className="px-3 py-2 rounded-lg bg-[#d9fdd3] text-xs text-neutral-700 inline-flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>ACRIO thinking...</span>
                  </div>
                </div>
              )}
            </div>

            <form
              onSubmit={sendSimulatorTurn}
              className="p-3 bg-white border-t border-neutral-200 flex items-center gap-2"
            >
              <input
                type="text"
                value={simInput}
                onChange={(e) => setSimInput(e.target.value)}
                placeholder="Type test customer message (e.g., first ask product A, then switch to product B)..."
                className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-xs"
              />
              <button
                type="submit"
                disabled={simBusy || !simInput.trim()}
                className="px-4 py-2 rounded-lg bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Test</span>
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3 h-fit shadow-2xs">
            <h3 className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-[#008069]" />
              <span>Live Context State Tracker</span>
            </h3>
            <p className="text-[11px] text-neutral-600">
              Shows what ACRIO currently locks onto as active product versus archived past products so products never mix together.
            </p>
            <div className="rounded-lg bg-neutral-900 text-emerald-300 p-3 font-mono text-[11px] overflow-x-auto max-h-[420px]">
              <pre>{JSON.stringify(simState || { status: "Fresh conversation" }, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: COMPANY DOCUMENTS */}
      {tab === "DOCS" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-1 rounded-xl border border-neutral-200 bg-white p-5 space-y-4 shadow-2xs h-fit">
            <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-1.5">
              <Upload className="w-4 h-4 text-[#008069]" />
              <span>Upload Verified Company Document</span>
            </h2>
            <p className="text-[11px] text-neutral-600">
              Upload official PDFs or images (GST Certificate, ISO, MSME, Brochure, Bank Details). When staff ask @ACRIO in notes to share one with a client, ACRIO prepares it for confirmation and sends it directly on WhatsApp.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "GST Certificate", slug: "gst-certificate", cat: "COMPLIANCE" as const, kw: "gst, gstin, tax certificate, gst certificate" },
                { label: "ISO Certificate", slug: "iso-certificate", cat: "COMPLIANCE" as const, kw: "iso, quality certificate" },
                { label: "MSME / Udyam", slug: "msme-certificate", cat: "COMPLIANCE" as const, kw: "msme, udyam, ssi certificate" },
                { label: "Cancelled Cheque", slug: "cancelled-cheque", cat: "BANKING" as const, kw: "bank, cheque, neft, rtgs, account" },
                { label: "Company Brochure", slug: "company-brochure", cat: "COMPANY_PROFILE" as const, kw: "brochure, profile, catalogue" },
              ].map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => {
                    setDocTitle(p.label);
                    setDocSlug(p.slug);
                    setDocCategory(p.cat);
                    setDocKeywords(p.kw);
                  }}
                  className="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 text-[11px] font-medium text-neutral-800 cursor-pointer"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Document Title
                </label>
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs"
                  placeholder="e.g. GST Certificate"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Document / Reference Number (Optional, e.g. GSTIN)
                </label>
                <input
                  type="text"
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs"
                  placeholder="e.g. 36AABCC1234D1Z5"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Category
                </label>
                <select
                  value={docCategory}
                  onChange={(e) => setDocCategory(e.target.value as any)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs bg-white"
                >
                  <option value="COMPLIANCE">Compliance (GST / ISO / MSME / PAN)</option>
                  <option value="CATALOGUE">Catalogue / Price Sheet</option>
                  <option value="BANKING">Banking / Cancelled Cheque</option>
                  <option value="COMPANY_PROFILE">Company Profile / Brochure</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Match Keywords
                </label>
                <input
                  type="text"
                  value={docKeywords}
                  onChange={(e) => setDocKeywords(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs"
                  placeholder="gst, gstin, tax certificate"
                />
              </div>
              <label
                className={`w-full py-2.5 px-4 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer ${
                  docUploading || !docTitle.trim() ? "opacity-50 pointer-events-none" : ""
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{docUploading ? "Uploading..." : "Choose PDF / Image & Save"}</span>
                <input
                  type="file"
                  accept=".pdf,image/*"
                  className="hidden"
                  disabled={docUploading || !docTitle.trim()}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file || !docTitle.trim()) return;
                    setDocUploading(true);
                    try {
                      const fd = new FormData();
                      fd.append("file", file);
                      const upRes = await fetch("/api/media/upload", { method: "POST", body: fd });
                      const upData = await upRes.json().catch(() => ({}));
                      if (!upRes.ok || !upData.ok || !upData.attachment) {
                        setToast(upData.error || "Upload failed.");
                        return;
                      }
                      const att = upData.attachment;
                      const saveRes = await fetch("/api/company-documents", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          slug: docSlug.trim() || undefined,
                          title: docTitle.trim(),
                          category: docCategory,
                          docNumber: docNumber.trim(),
                          keywords: docKeywords.trim(),
                          mediaId: att.mediaId,
                          waMediaId: att.waMediaId,
                          mediaUrl: att.url,
                          mediaType: att.mediaType,
                          fileName: att.fileName,
                          mimeType: att.mimeType,
                        }),
                      });
                      const saveData = await saveRes.json().catch(() => ({}));
                      if (saveRes.ok && saveData.ok) {
                        setToast(`${docTitle.trim()} saved! ACRIO can now share it on confirmation.`);
                        setDocNumber("");
                        await loadData();
                      } else {
                        setToast(saveData.error || "Could not save document.");
                      }
                    } finally {
                      setDocUploading(false);
                    }
                  }}
                />
              </label>
            </div>
          </div>

          <div className="lg:col-span-2 rounded-xl border border-neutral-200 bg-white p-5 space-y-3 shadow-2xs">
            <h2 className="text-sm font-semibold text-neutral-900">
              Saved Company Documents ({companyDocs.length})
            </h2>
            {companyDocs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-xs text-neutral-500">
                No company documents uploaded yet. Upload your GST Certificate on the left so @ACRIO can share it directly when requested in internal notes.
              </div>
            ) : (
              <div className="space-y-2.5">
                {companyDocs.map((d) => (
                  <div
                    key={d.id}
                    className="rounded-lg border border-neutral-200 p-3.5 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-neutral-900">
                          {d.title}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 text-[10px] font-medium">
                          {d.category}
                        </span>
                        {d.docNumber && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 text-[10px] font-mono font-semibold">
                            {d.docNumber}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-600 truncate">
                        File: {d.fileName} ({d.mediaType}) {d.keywords ? `| Keywords: ${d.keywords}` : ""}
                      </p>
                      <p className="text-[10.5px] text-neutral-400">
                        Uploaded by {d.uploadedBy || "Team"} • {formatDateTimeIst(d.updatedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={d.mediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-[11px] font-medium text-neutral-800"
                      >
                        View
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          await fetch(`/api/company-documents?id=${encodeURIComponent(d.id)}`, {
                            method: "DELETE",
                          });
                          setToast(`Removed ${d.title}.`);
                          await loadData();
                        }}
                        className="p-1.5 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 cursor-pointer"
                        title="Delete document"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-4 border-t border-neutral-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-neutral-900">
                  Live Documents Fetched from classicconcepts.in & classicedge53.com ({websiteDocs.length})
                </h3>
                <span className="text-[10.5px] text-neutral-500">Auto-synced live</span>
              </div>
              {websiteDocs.length === 0 ? (
                <p className="text-[11px] text-neutral-500">
                  No external website certificates or brochures loaded right now.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {websiteDocs.map((wd) => (
                    <div
                      key={wd.id}
                      className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11.5px] font-semibold text-neutral-900 truncate">
                            {wd.title}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-900 text-[9.5px] font-medium shrink-0">
                            {wd.sourceLabel}
                          </span>
                        </div>
                        <p className="text-[10.5px] text-neutral-600 truncate">
                          {wd.fileName} ({wd.mediaType})
                        </p>
                      </div>
                      <a
                        href={wd.mediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-[10.5px] font-medium text-neutral-800 shrink-0"
                      >
                        View
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
