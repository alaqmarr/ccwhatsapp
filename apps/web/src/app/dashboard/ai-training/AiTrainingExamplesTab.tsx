"use client";

import React from "react";
import { Bot, Pencil, Plus, Trash2 } from "lucide-react";
import { formatDateTimeIst } from "@cc/ui";
import type {
  CatalogProductOption,
  RecentQuestionItem,
  TrainingExample,
} from "./ai-training-types";

export interface ExampleFormState {
  editExId: string | null;
  exGuidanceType: "INSTRUCTION" | "FIXED_ANSWER";
  setExGuidanceType: (v: "INSTRUCTION" | "FIXED_ANSWER") => void;
  exTitle: string;
  setExTitle: (v: string) => void;
  exCategory: string;
  setExCategory: (v: string) => void;
  exQuestion: string;
  setExQuestion: (v: string) => void;
  exAnswer: string;
  setExAnswer: (v: string) => void;
  exDoNotSay: string;
  setExDoNotSay: (v: string) => void;
  exProductSlug: string;
  setExProductSlug: (v: string) => void;
  exPriority: "HIGH" | "NORMAL";
  setExPriority: (v: "HIGH" | "NORMAL") => void;
  saving: boolean;
  onSaveExample: (e: React.FormEvent) => void;
  onResetForm: (defaultMode?: "INSTRUCTION" | "FIXED_ANSWER") => void;
  onLoadRecentQuestion: (
    rq: RecentQuestionItem,
    mode: "INSTRUCTION" | "FIXED_ANSWER"
  ) => void;
}

export function AiTrainingExamplesTab({
  examples,
  products,
  recentQuestions,
  form,
  onStartEditExample,
  onToggleExample,
  onRemoveExample,
}: {
  examples: TrainingExample[];
  products: CatalogProductOption[];
  recentQuestions: RecentQuestionItem[];
  form: ExampleFormState;
  onStartEditExample: (ex: TrainingExample) => void;
  onToggleExample: (ex: TrainingExample) => void;
  onRemoveExample: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-5">
        <form
          onSubmit={form.onSaveExample}
          className="rounded-xl border border-neutral-200 bg-white p-5 space-y-4 shadow-2xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 pb-2.5">
            <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-[#008069]" />
              <span>
                {form.editExId
                  ? form.exGuidanceType === "INSTRUCTION"
                    ? "Edit Action Instruction"
                    : "Edit Verified Fixed Answer"
                  : "Teach ACRIO What to Do or Say"}
              </span>
            </h2>
            {form.editExId && (
              <button
                type="button"
                onClick={() => form.onResetForm()}
                className="text-xs text-neutral-600 underline cursor-pointer"
              >
                Cancel edit
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-neutral-700">
              Training Mode
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  form.setExGuidanceType("INSTRUCTION");
                  if (form.exCategory === "Product Knowledge") {
                    form.setExCategory("Handling & Routing");
                  }
                }}
                className={`text-left rounded-lg border px-3 py-2 cursor-pointer transition ${
                  form.exGuidanceType === "INSTRUCTION"
                    ? "border-[#008069] bg-emerald-50/70 text-neutral-900"
                    : "border-neutral-200 bg-neutral-50/70 text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                <div className="text-xs font-semibold">
                  Instruction (What ACRIO should do)
                </div>
                <div className="text-[11px] text-neutral-600 mt-0.5">
                  Tell ACRIO how to handle, assign, decline, or reply dynamically.
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  form.setExGuidanceType("FIXED_ANSWER");
                  if (form.exCategory === "Handling & Routing") {
                    form.setExCategory("Product Knowledge");
                  }
                }}
                className={`text-left rounded-lg border px-3 py-2 cursor-pointer transition ${
                  form.exGuidanceType === "FIXED_ANSWER"
                    ? "border-neutral-900 bg-neutral-100 text-neutral-900"
                    : "border-neutral-200 bg-neutral-50/70 text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                <div className="text-xs font-semibold">
                  Fixed Answer (Exact Q&amp;A reply)
                </div>
                <div className="text-[11px] text-neutral-600 mt-0.5">
                  Use a verified standard reply when a specific question comes in.
                </div>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                Short Title
              </label>
              <input
                type="text"
                required
                value={form.exTitle}
                onChange={(e) => form.setExTitle(e.target.value)}
                placeholder={
                  form.exGuidanceType === "INSTRUCTION"
                    ? "Handle outside supplier pitch"
                    : "GST & Bulk Pricing Policy"
                }
                className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                Topic / Category
              </label>
              <select
                value={form.exCategory}
                onChange={(e) => form.setExCategory(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs bg-white"
              >
                <option value="Handling & Routing">Handling &amp; Routing</option>
                <option value="Staff Command / Assignment">Staff Command / Assignment</option>
                <option value="Vendor / Spam / Ignore">Vendor / Spam / Ignore</option>
                <option value="Product Knowledge">Product Knowledge</option>
                <option value="Pricing & Bulk">Pricing &amp; Bulk</option>
                <option value="Shipping & Crating">Shipping &amp; Crating</option>
                <option value="Machine Service & Parts">Machine Service &amp; Parts</option>
                <option value="Custom Work & Logo">Custom Work &amp; Logo</option>
                <option value="Mistake Fix">Fix Past AI Mistake</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                Priority
              </label>
              <select
                value={form.exPriority}
                onChange={(e) =>
                  form.setExPriority(e.target.value as "HIGH" | "NORMAL")
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
              value={form.exProductSlug}
              onChange={(e) => form.setExProductSlug(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs bg-white"
            >
              <option value="">General / Applies to any matching message</option>
              {products.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name} {p.sku ? `(${p.sku})` : ""} - {p.brandLabel}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-1">
              {form.exGuidanceType === "INSTRUCTION"
                ? "When This Message or Situation Happens (Trigger / Example)"
                : "Customer Question or Keywords"}
            </label>
            <textarea
              rows={2}
              required
              value={form.exQuestion}
              onChange={(e) => form.setExQuestion(e.target.value)}
              placeholder={
                form.exGuidanceType === "INSTRUCTION"
                  ? "Example: Supplier offering B2B laminates, rate card, or staff writing 'Assign to Shilpa'"
                  : "Example: Do you ship podiums to Bangalore with GST invoice and logo printing?"
              }
              className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-1">
              {form.exGuidanceType === "INSTRUCTION"
                ? "Instruction: What ACRIO Should Do"
                : "Exact Verified Answer ACRIO Should Give"}
            </label>
            <textarea
              rows={3}
              required
              value={form.exAnswer}
              onChange={(e) => form.setExAnswer(e.target.value)}
              placeholder={
                form.exGuidanceType === "INSTRUCTION"
                  ? "Explain step by step what to do: e.g. Recognize this is a vendor sales pitch, do NOT pitch our products, politely thank them and decline, or hand over to the team."
                  : "Write in plain everyday English. Give exact steps, timelines, or policies."
              }
              className="w-full rounded-lg border border-neutral-300 p-2.5 text-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-1">
              {form.exGuidanceType === "INSTRUCTION"
                ? "What ACRIO Must Avoid / Never Do (optional)"
                : "What NOT to Say / Common Trap to Avoid (optional)"}
            </label>
            <input
              type="text"
              value={form.exDoNotSay}
              onChange={(e) => form.setExDoNotSay(e.target.value)}
              placeholder={
                form.exGuidanceType === "INSTRUCTION"
                  ? "e.g. Never list podiums or machines when someone is only pitching us their own raw materials"
                  : "e.g. Never quote flat shipping rates for custom crates without knowing city"
              }
              className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-xs"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={form.saving}
              className="px-5 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              {form.saving
                ? "Saving..."
                : form.editExId
                ? form.exGuidanceType === "INSTRUCTION"
                  ? "Update Instruction"
                  : "Update Fixed Answer"
                : form.exGuidanceType === "INSTRUCTION"
                ? "Save Instruction"
                : "Save Fixed Answer"}
            </button>
          </div>
        </form>

        <div className="space-y-3">
          <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wide">
            Active &amp; Saved Instructions and Q&amp;A ({examples.length})
          </h3>
          {examples.length === 0 ? (
            <div className="p-8 rounded-xl border border-dashed border-neutral-300 bg-white text-center text-xs text-neutral-500">
              No instructions or Q&amp;A pairs saved yet. Add one above or pick a recent message from the right.
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
                      <span className="text-sm font-semibold text-neutral-900">{ex.title}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${
                          ex.guidanceType === "INSTRUCTION"
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                            : "bg-neutral-100 text-neutral-700"
                        }`}
                      >
                        {ex.guidanceType === "INSTRUCTION" ? "WHAT TO DO" : "FIXED ANSWER"}
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
                      Updated by {ex.createdByName || "Team"} • {formatDateTimeIst(ex.updatedAt)}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleExample(ex)}
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
                      onClick={() => onStartEditExample(ex)}
                      className="p-1.5 rounded hover:bg-neutral-100 text-neutral-600 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveExample(ex.id)}
                      className="p-1.5 rounded hover:bg-red-50 text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="text-xs bg-neutral-50 border border-neutral-100 rounded-lg p-2.5">
                  <span className="font-semibold text-neutral-700">
                    {ex.guidanceType === "INSTRUCTION" ? "When this happens: " : "When asked: "}
                  </span>
                  <span className="text-neutral-800 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {ex.customerQuestion}
                  </span>
                </div>
                <div className="text-xs bg-[#e7fce3]/60 border border-[#b7ebaf] rounded-lg p-2.5">
                  <span className="font-semibold text-[#008069]">
                    {ex.guidanceType === "INSTRUCTION"
                      ? "What ACRIO must do: "
                      : "Approved answer: "}
                  </span>
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

      <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3 h-fit shadow-2xs">
        <h3 className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5 text-[#008069]" />
          <span>Turn Recent Chat Messages Into Training</span>
        </h3>
        <p className="text-[11px] text-neutral-600">
          Pick any message below to teach ACRIO what action to take or set a fixed reply.
        </p>
        <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
          {recentQuestions.length === 0 ? (
            <p className="text-xs text-neutral-500">
              No recent inbound text messages found yet.
            </p>
          ) : (
            recentQuestions.map((rq) => (
              <div
                key={rq.id}
                className="p-2.5 rounded-lg border border-neutral-200 bg-neutral-50/80 space-y-1.5"
              >
                <div className="flex items-center justify-between text-[11px] text-neutral-500 gap-2">
                  <span className="font-semibold text-neutral-800 truncate">
                    {rq.customerName}
                  </span>
                  <span className="shrink-0">{formatDateTimeIst(rq.createdAt)}</span>
                </div>
                <p className="text-xs text-neutral-800 line-clamp-3 [overflow-wrap:anywhere]">
                  {rq.question}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => form.onLoadRecentQuestion(rq, "INSTRUCTION")}
                    className="text-[11px] font-semibold text-[#008069] hover:underline cursor-pointer"
                  >
                    + Give Instruction
                  </button>
                  <span className="text-neutral-300">•</span>
                  <button
                    type="button"
                    onClick={() => form.onLoadRecentQuestion(rq, "FIXED_ANSWER")}
                    className="text-[11px] font-medium text-neutral-700 hover:underline cursor-pointer"
                  >
                    + Fixed Answer
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
