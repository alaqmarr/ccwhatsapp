"use client";

import React from "react";
import { Search } from "lucide-react";
import type { ApprovedTemplateOption } from "@/lib/inbox-server-data";

export function varIndices(text: string | null | undefined): number[] {
  if (!text) return [];
  const found = Array.from(text.matchAll(/\{\{(\d+)\}\}/g)).map((m) =>
    Number(m[1])
  );
  return Array.from(new Set(found)).sort((a, b) => a - b);
}

export function fillTemplateText(
  text: string,
  values: Record<number, string>
): string {
  return text.replace(/\{\{(\d+)\}\}/g, (_m, n) => {
    const v = (values[Number(n)] || "").trim();
    return v || `{{${n}}}`;
  });
}

export function TemplateSelectorSection({
  templates,
  starterTemplates = [],
  filteredTemplates,
  activeTpl,
  tplSearch,
  onTplSearchChange,
  onSelectTemplate,
  headerVars,
  bodyVars,
  headerVals,
  bodyVals,
  onHeaderValChange,
  onBodyValChange,
  renderedPreview,
}: {
  templates: ApprovedTemplateOption[];
  starterTemplates?: ApprovedTemplateOption[];
  filteredTemplates: ApprovedTemplateOption[];
  activeTpl: ApprovedTemplateOption | null;
  tplSearch: string;
  onTplSearchChange: (val: string) => void;
  onSelectTemplate: (id: string) => void;
  headerVars: number[];
  bodyVars: number[];
  headerVals: Record<number, string>;
  bodyVals: Record<number, string>;
  onHeaderValChange: (idx: number, val: string) => void;
  onBodyValChange: (idx: number, val: string) => void;
  renderedPreview: string;
}) {
  return (
    <div className="space-y-3">
      {starterTemplates.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-neutral-700">
            Quick Start Templates
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {starterTemplates.map((tpl, idx) => {
              const selected = activeTpl?.id === tpl.id;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => onSelectTemplate(tpl.id)}
                  className={`text-left rounded-lg border px-3 py-2 transition-colors cursor-pointer ${
                    selected
                      ? "border-[#00a884] bg-emerald-50/70"
                      : "border-neutral-200 bg-white hover:border-[#00a884]/70 hover:bg-neutral-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-neutral-900 truncate">
                      {tpl.name}
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 shrink-0">
                      {idx === 0 ? "#1 First" : `#${idx + 1}`}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-600 line-clamp-2 mt-1">
                    {tpl.bodyText}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-neutral-700">
            Approved WhatsApp Template ({templates.length})
          </label>
          <div className="relative w-44">
            <Search className="w-3 h-3 text-neutral-400 absolute left-2 top-2" />
            <input
              type="text"
              value={tplSearch}
              onChange={(e) => onTplSearchChange(e.target.value)}
              placeholder="Filter templates"
              className="w-full pl-6 pr-2 py-1 rounded border border-neutral-300 text-[11px]"
            />
          </div>
        </div>
        <select
          value={activeTpl?.id || ""}
          onChange={(e) => onSelectTemplate(e.target.value)}
          className="w-full rounded-md border border-neutral-300 px-2.5 py-2 text-xs bg-white"
        >
          {filteredTemplates.length === 0 ? (
            <option value="">No matching approved templates</option>
          ) : (
            filteredTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.category} • {t.language})
              </option>
            ))
          )}
        </select>
      </div>

      {(headerVars.length > 0 || bodyVars.length > 0) && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-2.5">
          <div className="text-[11px] font-semibold text-neutral-700">
            Template Variable Values
          </div>
          {headerVars.map((idx) => (
            <div key={`h_${idx}`}>
              <label className="block text-[11px] text-neutral-600 mb-0.5">
                Header {"{{"}
                {idx}
                {"}}"}
              </label>
              <input
                type="text"
                required
                value={headerVals[idx] || ""}
                onChange={(e) => onHeaderValChange(idx, e.target.value)}
                className="w-full rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-xs"
              />
            </div>
          ))}
          {bodyVars.map((idx) => {
            const spec = activeTpl?.variablesSchema.find(
              (v) => v.index === idx
            );
            return (
              <div key={`b_${idx}`}>
                <label className="block text-[11px] text-neutral-600 mb-0.5">
                  {spec?.label || `Variable {{${idx}}}`}
                </label>
                <input
                  type="text"
                  required
                  value={bodyVals[idx] || ""}
                  onChange={(e) => onBodyValChange(idx, e.target.value)}
                  placeholder={spec?.sampleValue || `Value for {{${idx}}}`}
                  className="w-full rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-xs"
                />
              </div>
            );
          })}
        </div>
      )}

      {activeTpl && (
        <div className="rounded-lg border border-[#b7ebaf] bg-[#efeae2] p-3 space-y-1.5">
          <div className="text-[10.5px] font-semibold text-[#008069] uppercase tracking-wide">
            WhatsApp Template Preview
          </div>
          <div className="rounded-lg bg-[#d9fdd3] px-3 py-2 text-xs text-[#111b21] whitespace-pre-wrap shadow-2xs">
            {renderedPreview}
          </div>
        </div>
      )}
    </div>
  );
}
