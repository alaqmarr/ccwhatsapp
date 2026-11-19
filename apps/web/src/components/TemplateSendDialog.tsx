"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, FileText, Loader2, Search, Send, Sparkles, X } from "lucide-react";
import type { ApprovedTemplateOption } from "@/lib/inbox-server-data";
import {
  fillTemplateText,
  guessTemplateVariableValue,
  varIndices,
  type TemplateCustomerContext,
} from "@/lib/template-variables";

export type { TemplateCustomerContext };

export interface TemplateSendPayload {
  template: ApprovedTemplateOption;
  bodyValues: string[];
  headerValues: string[];
  renderedText: string;
}

type Step = "PICK" | "FILL" | "REVIEW";

const COST: Record<string, string> = {
  MARKETING: "about ₹0.95",
  UTILITY: "about ₹0.30",
  AUTHENTICATION: "about ₹0.30",
};

const fillText = fillTemplateText;

function validateValue(v: string): string | null {
  const t = v.trim();
  if (!t) return "Required";
  if (/[\n\r\t]/.test(v)) return "No line breaks or tabs allowed";
  if (/ {4,}/.test(v)) return "No more than 3 spaces in a row";
  if (t.length > 200) return "Keep it under 200 characters";
  return null;
}

export function TemplateSendDialog({
  open,
  onClose,
  templates,
  customer,
  windowOpen,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  templates: ApprovedTemplateOption[];
  customer: TemplateCustomerContext;
  windowOpen: boolean;
  onSend: (payload: TemplateSendPayload) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [step, setStep] = useState<Step>("PICK");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<"ALL" | "UTILITY" | "MARKETING" | "AUTHENTICATION">("ALL");
  const [tpl, setTpl] = useState<ApprovedTemplateOption | null>(null);
  const [bodyVals, setBodyVals] = useState<Record<number, string>>({});
  const [headerVals, setHeaderVals] = useState<Record<number, string>>({});
  const [autoSrc, setAutoSrc] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Start fresh every time the dialog opens, so nothing from an earlier chat carries over.
  useEffect(() => {
    if (open) {
      setStep("PICK");
      setQuery("");
      setCat("ALL");
      setTpl(null);
      setBodyVals({});
      setHeaderVals({});
      setAutoSrc({});
      setConfirmed(false);
      setSending(false);
      setError("");
    }
  }, [open, customer.phone]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (cat !== "ALL" && t.category !== cat) return false;
      if (!q) return true;
      return `${t.name} ${t.bodyText} ${t.headerText || ""}`.toLowerCase().includes(q);
    });
  }, [templates, query, cat]);

  const bodyIdx = useMemo(() => varIndices(tpl?.bodyText), [tpl]);
  const headerIdx = useMemo(() => varIndices(tpl?.headerText), [tpl]);

  function choose(t: ApprovedTemplateOption) {
    setTpl(t);
    const b: Record<number, string> = {};
    const h: Record<number, string> = {};
    const src: Record<string, string> = {};
    for (const i of varIndices(t.bodyText)) {
      const g = guessTemplateVariableValue(t, "BODY", i, customer);
      b[i] = g.value;
      if (g.value) src[`b${i}`] = g.source;
    }
    for (const i of varIndices(t.headerText)) {
      const g = guessTemplateVariableValue(t, "HEADER", i, customer);
      h[i] = g.value;
      if (g.value) src[`h${i}`] = g.source;
    }
    setBodyVals(b);
    setHeaderVals(h);
    setAutoSrc(src);
    setConfirmed(false);
    setError("");
    setStep(varIndices(t.bodyText).length + varIndices(t.headerText).length > 0 ? "FILL" : "REVIEW");
  }

  const allErrors = useMemo(() => {
    const errs: string[] = [];
    for (const i of bodyIdx) {
      const e = validateValue(bodyVals[i] || "");
      if (e) errs.push(`Body {{${i}}}: ${e}`);
    }
    for (const i of headerIdx) {
      const e = validateValue(headerVals[i] || "");
      if (e) errs.push(`Header {{${i}}}: ${e}`);
    }
    return errs;
  }, [bodyIdx, headerIdx, bodyVals, headerVals]);

  const renderedHeader = tpl?.headerText ? fillText(tpl.headerText, headerVals) : "";
  const renderedBody = tpl ? fillText(tpl.bodyText, bodyVals) : "";
  const renderedText = [renderedHeader, renderedBody, tpl?.footerText || ""].filter(Boolean).join("\n\n");

  async function doSend() {
    if (!tpl || allErrors.length > 0 || !confirmed) return;
    setSending(true);
    setError("");
    const res = await onSend({
      template: tpl,
      bodyValues: bodyIdx.map((i) => (bodyVals[i] || "").trim()),
      headerValues: headerIdx.map((i) => (headerVals[i] || "").trim()),
      renderedText,
    });
    setSending(false);
    if (res.ok) onClose();
    else setError(res.error || "The template could not be sent.");
  }

  if (!open) return null;

  const Preview = (
    <div className="rounded-xl bg-[#e7ddd4] p-3">
      <div className="max-w-[92%] rounded-lg rounded-tl-none bg-white shadow-2xs px-3 py-2 text-[13px] text-[#111b21] space-y-1.5">
        {renderedHeader && <div className="font-semibold">{renderedHeader}</div>}
        <div className="whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed">{renderedBody}</div>
        {tpl?.footerText && <div className="text-[11px] text-[#667781]">{tpl.footerText}</div>}
        {(tpl?.buttons?.length || tpl?.ctaUrl) ? (
          <div className="pt-1.5 border-t border-neutral-200 space-y-1">
            {(tpl?.buttons || []).map((b, i) => (
              <div key={i} className="text-center text-[12px] font-medium text-[#027eb5]">
                {b.text}
              </div>
            ))}
            {!tpl?.buttons?.length && tpl?.ctaUrl && (
              <div className="text-center text-[12px] font-medium text-[#027eb5] truncate">{tpl.ctaUrl}</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[900] flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-3xl max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {step !== "PICK" && (
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setConfirmed(false);
                  setStep(step === "REVIEW" && (bodyIdx.length || headerIdx.length) ? "FILL" : "PICK");
                }}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 cursor-pointer"
                aria-label="Back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-slate-700" />
                {step === "PICK" ? "Choose a template" : step === "FILL" ? "Fill in the values" : "Review and send"}
              </h2>
              <p className="text-[11px] text-slate-500 truncate">
                To {customer.name} ({customer.phone}){tpl ? ` • ${tpl.name}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1 text-[10px] font-semibold">
              {(["PICK", "FILL", "REVIEW"] as Step[]).map((s, i) => (
                <span
                  key={s}
                  className={`px-2 py-0.5 rounded-full ${
                    s === step ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {i + 1}. {s === "PICK" ? "Choose" : s === "FILL" ? "Values" : "Review"}
                </span>
              ))}
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 cursor-pointer" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {step === "PICK" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
                  <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search templates"
                    className="w-full rounded-lg border border-neutral-300 pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-[#00a884]"
                  />
                </div>
                <div className="flex items-center gap-1 text-[11px] font-semibold">
                  {(["ALL", "UTILITY", "MARKETING", "AUTHENTICATION"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCat(c)}
                      className={`px-2.5 py-1 rounded-full cursor-pointer ${
                        cat === c ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {c === "ALL" ? "All" : c === "AUTHENTICATION" ? "Auth" : c[0] + c.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
              {windowOpen && (
                <p className="text-xs text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
                  This chat is inside the 24 hour window, so you can also send a normal free reply. Templates are billed.
                </p>
              )}
              {filtered.length === 0 ? (
                <p className="text-center text-xs text-slate-500 py-8">No approved templates match.</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {filtered.map((t) => {
                    const n = varIndices(t.bodyText).length + varIndices(t.headerText).length;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => choose(t)}
                        className="text-left rounded-xl border border-neutral-200 hover:border-[#00a884] hover:bg-emerald-50/40 p-3 space-y-1.5 cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900 truncate">{t.name}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                              t.category === "MARKETING" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"
                            }`}
                          >
                            {t.category === "AUTHENTICATION" ? "Auth" : t.category}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 line-clamp-3 whitespace-pre-wrap">{t.bodyText}</p>
                        <p className="text-[10.5px] text-slate-400">
                          {n === 0 ? "No values to fill" : `${n} value${n > 1 ? "s" : ""} to fill`} • {COST[t.category]} per message
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {step === "FILL" && tpl && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <p className="text-xs text-slate-600 flex items-start gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>
                    We filled in what we know about this customer. Please check every value. Anything marked{" "}
                    <strong className="text-rose-600">Required</strong> needs you.
                  </span>
                </p>
                {[
                  ...headerIdx.map((i) => ({ key: `h${i}`, idx: i, kind: "Header" as const })),
                  ...bodyIdx.map((i) => ({ key: `b${i}`, idx: i, kind: "Body" as const })),
                ].map((f) => {
                  const spec = tpl.variablesSchema.find((v) => v.index === f.idx);
                  const value = (f.kind === "Header" ? headerVals[f.idx] : bodyVals[f.idx]) || "";
                  const err = validateValue(value);
                  const auto = autoSrc[f.key];
                  return (
                    <label key={f.key} className="block space-y-1">
                      <span className="flex items-center justify-between text-xs font-medium text-slate-700">
                        <span>
                          {f.kind === "Header" ? "Header" : spec?.label || `Value`} {`{{${f.idx}}}`}
                        </span>
                        {auto && value ? (
                          <span className="text-[10.5px] text-emerald-700 inline-flex items-center gap-1">
                            <Check className="w-3 h-3" /> From {auto}
                          </span>
                        ) : err ? (
                          <span className="text-[10.5px] text-rose-600 font-semibold">{err}</span>
                        ) : (
                          <span className="text-[10.5px] text-slate-500">Typed by you</span>
                        )}
                      </span>
                      <input
                        value={value}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (f.kind === "Header") setHeaderVals((p) => ({ ...p, [f.idx]: v }));
                          else setBodyVals((p) => ({ ...p, [f.idx]: v }));
                          setAutoSrc((p) => {
                            const n = { ...p };
                            delete n[f.key];
                            return n;
                          });
                        }}
                        placeholder={spec?.sampleValue ? `For example: ${spec.sampleValue}` : "Enter value"}
                        className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                          err ? "border-rose-300 focus:border-rose-500" : "border-neutral-300 focus:border-[#00a884]"
                        }`}
                      />
                    </label>
                  );
                })}
              </div>
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Live preview</div>
                {Preview}
              </div>
            </div>
          )}

          {step === "REVIEW" && tpl && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100 text-sm">
                  <Row label="Sending to" value={`${customer.name}`} sub={customer.phone} />
                  <Row label="Template" value={tpl.name} sub={`${tpl.category === "AUTHENTICATION" ? "Authentication" : tpl.category[0] + tpl.category.slice(1).toLowerCase()} • ${tpl.language}`} />
                  <Row label="Cost" value={`${COST[tpl.category]} per message`} sub="Billed once it is sent" />
                  {[...headerIdx.map((i) => ({ k: `Header {{${i}}}`, v: headerVals[i] })), ...bodyIdx.map((i) => ({ k: `Value {{${i}}}`, v: bodyVals[i] }))].map((r) => (
                    <Row key={r.k} label={r.k} value={(r.v || "").trim()} />
                  ))}
                </div>
                {allErrors.length > 0 && (
                  <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" /> Some values need fixing: {allErrors.join("; ")}
                  </p>
                )}
                <label className="flex items-start gap-2 text-xs text-slate-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-0.5 accent-[#00a884]"
                  />
                  <span>
                    I checked the customer, the phone number and every value. The message below is exactly what the customer will receive.
                  </span>
                </label>
              </div>
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">What the customer will see</div>
                {Preview}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== "PICK" && (
          <div className="px-4 py-3 border-t border-neutral-200 flex flex-wrap items-center justify-between gap-2 shrink-0 bg-slate-50">
            <div className="text-xs text-rose-700 min-h-4">{error}</div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-200 cursor-pointer">
                Cancel
              </button>
              {step === "FILL" ? (
                <button
                  type="button"
                  disabled={allErrors.length > 0}
                  onClick={() => {
                    setConfirmed(false);
                    setStep("REVIEW");
                  }}
                  className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold disabled:opacity-40 cursor-pointer"
                >
                  Review message
                </button>
              ) : (
                <button
                  type="button"
                  disabled={sending || !confirmed || allErrors.length > 0}
                  onClick={() => void doSend()}
                  className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-sm font-semibold disabled:opacity-40 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {sending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Sending...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" /> Send template
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-3 py-2 flex items-start justify-between gap-3">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className="text-right min-w-0">
        <span className="block text-sm font-medium text-slate-900 break-words">{value}</span>
        {sub && <span className="block text-[11px] text-slate-500">{sub}</span>}
      </span>
    </div>
  );
}
