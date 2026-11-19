"use client";

import React from "react";
import { Sparkles, Workflow } from "lucide-react";
import { WhatsAppLogoIcon } from "@cc/ui";
import {
  LANGUAGE_OPTIONS,
  slugifyName,
  type CatalogMediaOption,
  type HeaderType,
  type LocationHeader,
  type ShortLinkOption,
  type TemplateButton,
  type TemplateCategory,
  type TemplatePresetKey,
  type TemplateRecord,
  type VariableSpec,
} from "@/app/dashboard/templates/types";
import { TemplateHeaderEditor } from "./TemplateHeaderEditor";
import { TemplateButtonsEditor } from "./TemplateButtonsEditor";
import { TemplatePreviewPane } from "./TemplatePreviewPane";

export interface TemplateBuilderPanelProps {
  isDev: boolean;
  editingId: string;
  setEditingId: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  language: string;
  setLanguage: (v: string) => void;
  category: TemplateCategory;
  setCategory: (v: TemplateCategory) => void;
  allowCategoryChange: boolean;
  setAllowCategoryChange: (v: boolean) => void;
  codeExpirationMinutes: number;
  setCodeExpirationMinutes: (v: number) => void;
  headerType: HeaderType;
  setHeaderType: (v: HeaderType) => void;
  headerText: string;
  setHeaderText: (v: string) => void;
  headerMediaUrl: string;
  setHeaderMediaUrl: (v: string) => void;
  headerLocation: LocationHeader;
  setHeaderLocation: React.Dispatch<React.SetStateAction<LocationHeader>>;
  bodyText: string;
  setBodyText: (v: string) => void;
  footerText: string;
  setFooterText: (v: string) => void;
  buttons: TemplateButton[];
  setButtons: React.Dispatch<React.SetStateAction<TemplateButton[]>>;
  variablesSchema: VariableSpec[];
  setVariablesSchema: React.Dispatch<React.SetStateAction<VariableSpec[]>>;
  bodyRef: React.RefObject<HTMLTextAreaElement | null>;
  aiGoal: string;
  setAiGoal: (v: string) => void;
  aiBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  setAiBrand: (v: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53") => void;
  draftingAi: boolean;
  aiComplianceNotes: string[];
  savingAction: "" | "DRAFT" | "SUBMIT" | "FLOWS";
  liveChecks: { issues: string[]; tips: string[] };
  previewHeaderRendered: string;
  previewBodyRendered: string;
  liveMetaJsonPreview: Record<string, unknown>;
  customLinks: ShortLinkOption[];
  catalogMedia: CatalogMediaOption[];
  teams: { id: string; name: string }[];
  templates: TemplateRecord[];
  onApplyPreset: (preset: TemplatePresetKey) => void;
  onDraftWithMetaAi: () => Promise<void>;
  onWrapBodySelection: (marker: "*" | "_" | "~" | "`") => void;
  onInsertNextVariable: () => void;
  onAddButton: (type: TemplateButton["type"]) => void;
  onMoveButton: (index: number, dir: -1 | 1) => void;
  onSaveButtonFlowsOnly: () => Promise<void>;
  onSaveOrSubmit: (mode: "save_draft" | "submit_to_meta") => Promise<void>;
}

export function TemplateBuilderPanel(props: TemplateBuilderPanelProps) {
  const {
    isDev,
    editingId,
    setEditingId,
    name,
    setName,
    language,
    setLanguage,
    category,
    setCategory,
    allowCategoryChange,
    setAllowCategoryChange,
    codeExpirationMinutes,
    setCodeExpirationMinutes,
    headerType,
    setHeaderType,
    headerText,
    setHeaderText,
    headerMediaUrl,
    setHeaderMediaUrl,
    headerLocation,
    setHeaderLocation,
    bodyText,
    setBodyText,
    footerText,
    setFooterText,
    buttons,
    setButtons,
    variablesSchema,
    setVariablesSchema,
    bodyRef,
    aiGoal,
    setAiGoal,
    aiBrand,
    setAiBrand,
    draftingAi,
    aiComplianceNotes,
    savingAction,
    liveChecks,
    previewHeaderRendered,
    previewBodyRendered,
    liveMetaJsonPreview,
    customLinks,
    catalogMedia,
    teams,
    templates,
    onApplyPreset,
    onDraftWithMetaAi,
    onWrapBodySelection,
    onInsertNextVariable,
    onAddButton,
    onMoveButton,
    onSaveButtonFlowsOnly,
    onSaveOrSubmit,
  } = props;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      <div className="xl:col-span-7 bg-white rounded-lg border border-neutral-200 p-5 space-y-5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              {editingId
                ? `Editing Template: ${name}`
                : "Create WhatsApp Message Template"}
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Pick a starter preset below or customize every section from scratch.
            </p>
          </div>
          {editingId && (
            <button
              type="button"
              onClick={() => setEditingId("")}
              className="px-2.5 py-1 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 cursor-pointer"
            >
              Exit Edit Mode (Save as New)
            </button>
          )}
        </div>

        <div className="p-3.5 rounded-lg bg-emerald-50/60 border border-emerald-200 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-950">
              <Sparkles className="w-4 h-4 text-[#008069]" />
              <span>Meta-Compliant Template Drafter (AI + Auto Flow Mapping)</span>
            </div>
            <select
              value={aiBrand}
              onChange={(e) =>
                setAiBrand(
                  e.target.value as "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53"
                )
              }
              className="rounded border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-800"
            >
              <option value="CLASSIC_CONCEPTS">
                Brand: Classic Concepts (Acrylic Products)
              </option>
              <option value="CLASSIC_EDGE_53">
                Brand: Classic Edge 53 (Machines &amp; Tools)
              </option>
            </select>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={aiGoal}
              onChange={(e) => setAiGoal(e.target.value)}
              placeholder="Describe your message goal (e.g. Order ready for pickup with Track Order and Call Desk buttons)..."
              className="flex-1 rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs"
            />
            <button
              type="button"
              disabled={draftingAi}
              onClick={() => void onDraftWithMetaAi()}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-md bg-[#008069] hover:bg-[#006b57] text-white font-semibold cursor-pointer disabled:opacity-60 shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{draftingAi ? "Drafting..." : "Draft Compliant Template"}</span>
            </button>
          </div>
          {aiComplianceNotes.length > 0 && (
            <ul className="text-[11px] text-emerald-900 space-y-0.5 pl-4 list-disc">
              {aiComplianceNotes.map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="block font-medium text-neutral-700">
            1-Click Starter Templates
          </label>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: "HOSPITALITY", label: "Hotel & Podium Offer" },
                { id: "CE53_MACHINE", label: "Classic Edge 53 Machines" },
                { id: "ORDER_UPDATE", label: "Order Dispatch Update" },
                { id: "PAYMENT_QUOTE", label: "PDF Quote & Link" },
                { id: "OTP_CODE", label: "6-Digit OTP Code" },
                { id: "SHOWROOM_MAP", label: "Factory Map Invite" },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onApplyPreset(p.id)}
                className="px-2.5 py-1.5 rounded-md bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-medium cursor-pointer"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Template Name (lowercase_with_underscores)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(slugifyName(e.target.value))}
              placeholder="diwali_podium_offer_2026"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs"
            />
          </div>

          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Message Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as TemplateCategory)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
            >
              <option value="MARKETING">Marketing / Offers</option>
              <option value="UTILITY">Utility / Order Updates</option>
              <option value="AUTHENTICATION">Authentication / OTP Code</option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Language
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
            >
              {LANGUAGE_OPTIONS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {category === "AUTHENTICATION" && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Note: If Meta has temporarily paused Authentication (OTP) templates on your WhatsApp Business Account during display name or tier review, clicking Submit will safely keep this template saved as a Draft without creating rejected records on Meta. Marketing and Utility templates submit normally.
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2">
          <label className="inline-flex items-center gap-2 cursor-pointer text-neutral-700">
            <input
              type="checkbox"
              checked={allowCategoryChange}
              onChange={(e) => setAllowCategoryChange(e.target.checked)}
              className="rounded accent-[#00a884]"
            />
            <span>
              Allow Meta to automatically switch category if needed so review is not rejected
            </span>
          </label>

          {category === "AUTHENTICATION" && (
            <div className="flex items-center gap-2">
              <span className="text-neutral-600">OTP Expiry (mins):</span>
              <input
                type="number"
                min={1}
                max={90}
                value={codeExpirationMinutes}
                onChange={(e) =>
                  setCodeExpirationMinutes(Number(e.target.value))
                }
                className="w-16 rounded border border-neutral-300 bg-white px-2 py-1 text-center"
              />
            </div>
          )}
        </div>

        {category !== "AUTHENTICATION" && (
          <TemplateHeaderEditor
            headerType={headerType}
            setHeaderType={setHeaderType}
            headerText={headerText}
            setHeaderText={setHeaderText}
            headerMediaUrl={headerMediaUrl}
            setHeaderMediaUrl={setHeaderMediaUrl}
            headerLocation={headerLocation}
            setHeaderLocation={setHeaderLocation}
            catalogMedia={catalogMedia}
          />
        )}

        <div className="p-3.5 rounded-lg border border-neutral-200 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-neutral-900">Message Body</span>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => onWrapBodySelection("*")}
                className="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 font-bold cursor-pointer"
                title="Bold"
              >
                B
              </button>
              <button
                type="button"
                onClick={() => onWrapBodySelection("_")}
                className="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 italic cursor-pointer"
                title="Italic"
              >
                I
              </button>
              <button
                type="button"
                onClick={() => onWrapBodySelection("~")}
                className="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 line-through cursor-pointer"
                title="Strikethrough"
              >
                S
              </button>
              <button
                type="button"
                onClick={() => onWrapBodySelection("`")}
                className="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 font-mono cursor-pointer"
                title="Monospace"
              >
                {"</>"}
              </button>
              <button
                type="button"
                onClick={onInsertNextVariable}
                className="px-2.5 py-1 rounded bg-[#e7fce3] hover:bg-[#d3f8cc] text-[#008069] font-semibold cursor-pointer"
              >
                + Add Variable {"{{n}}"}
              </button>
            </div>
          </div>

          <textarea
            ref={bodyRef}
            rows={4}
            maxLength={1024}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm leading-relaxed"
          />
          <div className="flex justify-between text-[11px] text-neutral-500">
            <span>
              Use {"{{1}}"}, {"{{2}}"} for customer name, order number, or custom fields.
            </span>
            <span>{bodyText.length}/1024</span>
          </div>

          {variablesSchema.length > 0 && (
            <div className="bg-neutral-50 rounded-md border border-neutral-200 p-3 space-y-2">
              <div className="font-semibold text-neutral-800">
                Variable Auto-Fill &amp; Sample Values (Required by WhatsApp)
              </div>
              {variablesSchema.map((v) => (
                <div
                  key={v.index}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                >
                  <span className="sm:col-span-2 font-mono font-semibold text-[#008069]">
                    {`{{${v.index}}}`}
                  </span>
                  <select
                    value={v.sourceField}
                    onChange={(e) => {
                      const nextField = e.target
                        .value as VariableSpec["sourceField"];
                      setVariablesSchema((prev) =>
                        prev.map((item) =>
                          item.index === v.index
                            ? { ...item, sourceField: nextField }
                            : item
                        )
                      );
                    }}
                    className="sm:col-span-5 rounded border border-neutral-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="customer.firstName">
                      Auto-fill: Customer First Name
                    </option>
                    <option value="customer.fullName">
                      Auto-fill: Customer Full Name
                    </option>
                    <option value="customer.companyName">
                      Auto-fill: Company / Institution
                    </option>
                    <option value="customer.city">
                      Auto-fill: Customer City
                    </option>
                    <option value="order.latestNumber">
                      Auto-fill: Latest Order Number
                    </option>
                    <option value="custom">Custom / Manual Text</option>
                  </select>
                  <input
                    type="text"
                    value={v.sampleValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      setVariablesSchema((prev) =>
                        prev.map((item) =>
                          item.index === v.index
                            ? { ...item, sampleValue: val }
                            : item
                        )
                      );
                    }}
                    placeholder={`Sample for {{${v.index}}} (e.g. Vikram)`}
                    className="sm:col-span-5 rounded border border-neutral-300 bg-white px-2.5 py-1.5"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-3.5 rounded-lg border border-neutral-200 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-neutral-900">
              Footer (Optional Grey Note)
            </span>
            <button
              type="button"
              onClick={() =>
                setFooterText("Classic Concepts • Reply STOP to opt out")
              }
              className="text-[11px] font-medium text-[#008069] hover:underline cursor-pointer"
            >
              + Insert &ldquo;Reply STOP to opt out&rdquo;
            </button>
          </div>
          <input
            type="text"
            maxLength={60}
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            placeholder="Classic Concepts • Reply STOP to opt out"
            className="w-full rounded-md border border-neutral-300 px-3 py-1.5"
          />
        </div>

        <TemplateButtonsEditor
          buttons={buttons}
          setButtons={setButtons}
          customLinks={customLinks}
          teams={teams}
          templates={templates}
          onAddButton={onAddButton}
          onMoveButton={onMoveButton}
        />

        {(liveChecks.issues.length > 0 || liveChecks.tips.length > 0) && (
          <div className="space-y-2">
            {liveChecks.issues.length > 0 && (
              <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-900 space-y-1">
                <div className="font-semibold">
                  Fix before submitting to WhatsApp:
                </div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {liveChecks.issues.map((iss, idx) => (
                    <li key={idx}>{iss}</li>
                  ))}
                </ul>
              </div>
            )}
            {liveChecks.tips.map((tip, idx) => (
              <div
                key={idx}
                className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-950"
              >
                {tip}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-neutral-200">
          <span className="text-xs text-neutral-500">
            Supports *bold*, _italic_, ~strike~, and {"{{1}}"} variables
          </span>

          <div className="flex flex-wrap gap-2">
            {editingId && buttons.some((b) => b.type === "QUICK_REPLY") && (
              <button
                type="button"
                disabled={savingAction !== ""}
                onClick={() => void onSaveButtonFlowsOnly()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-md border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 font-semibold text-emerald-950 cursor-pointer disabled:opacity-50"
                title="Updates button click actions immediately without changing Meta approval status"
              >
                <Workflow className="w-3.5 h-3.5 text-[#008069]" />
                <span>
                  {savingAction === "FLOWS"
                    ? "Saving Flows..."
                    : "Save Button Flows Only"}
                </span>
              </button>
            )}
            <button
              type="button"
              disabled={savingAction !== ""}
              onClick={() => void onSaveOrSubmit("save_draft")}
              className="px-4 py-2.5 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 font-medium text-neutral-800 cursor-pointer disabled:opacity-50"
            >
              {savingAction === "DRAFT" ? "Saving..." : "Save as Draft"}
            </button>
            <button
              type="button"
              disabled={savingAction !== "" || liveChecks.issues.length > 0}
              onClick={() => void onSaveOrSubmit("submit_to_meta")}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white font-semibold cursor-pointer disabled:opacity-50"
            >
              <WhatsAppLogoIcon size={14} />
              <span>
                {savingAction === "SUBMIT"
                  ? "Submitting..."
                  : editingId
                  ? "Update & Submit to Meta"
                  : "Submit for Meta Approval"}
              </span>
            </button>
          </div>
        </div>
      </div>

      <TemplatePreviewPane
        isDev={isDev}
        category={category}
        headerType={headerType}
        headerMediaUrl={headerMediaUrl}
        headerLocation={headerLocation}
        previewHeaderRendered={previewHeaderRendered}
        previewBodyRendered={previewBodyRendered}
        footerText={footerText}
        buttons={buttons}
        liveMetaJsonPreview={liveMetaJsonPreview}
      />
    </div>
  );
}
