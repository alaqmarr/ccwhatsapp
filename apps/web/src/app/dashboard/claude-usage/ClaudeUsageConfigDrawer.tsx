"use client";

import React from "react";
import { KeyRound, Save } from "lucide-react";

export default function ClaudeUsageConfigDrawer({
  sharedAdminKeyDraft,
  setSharedAdminKeyDraft,
  acrioWorkspaceDraft,
  setAcrioWorkspaceDraft,
  acrioKeyIdDraft,
  setAcrioKeyIdDraft,
  acrioSharedOthersDraft,
  setAcrioSharedOthersDraft,
  acroWorkspaceDraft,
  setAcroWorkspaceDraft,
  acroKeyIdDraft,
  setAcroKeyIdDraft,
  acroSharedOthersDraft,
  setAcroSharedOthersDraft,
  savingConfig,
  onClose,
  onSave,
}: {
  sharedAdminKeyDraft: string;
  setSharedAdminKeyDraft: (v: string) => void;
  acrioWorkspaceDraft: string;
  setAcrioWorkspaceDraft: (v: string) => void;
  acrioKeyIdDraft: string;
  setAcrioKeyIdDraft: (v: string) => void;
  acrioSharedOthersDraft: boolean;
  setAcrioSharedOthersDraft: (v: boolean) => void;
  acroWorkspaceDraft: string;
  setAcroWorkspaceDraft: (v: string) => void;
  acroKeyIdDraft: string;
  setAcroKeyIdDraft: (v: string) => void;
  acroSharedOthersDraft: boolean;
  setAcroSharedOthersDraft: (v: boolean) => void;
  savingConfig: boolean;
  onClose: () => void;
  onSave: (e: React.FormEvent) => void;
}) {
  return (
    <form
      onSubmit={onSave}
      className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xs space-y-4"
    >
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-indigo-600" />
            <span>Anthropic Admin API &amp; Workspace / API Key Attribution Settings</span>
          </h2>
          <p className="text-[11px] text-slate-500">
            Stored server-side only in <code>core_auth.db</code> (or set via{" "}
            <code>.env</code>). Used exclusively for{" "}
            <code>/v1/organizations/usage_report/messages</code> and{" "}
            <code>/v1/organizations/cost_report</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-semibold text-slate-500 hover:text-slate-800"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="md:col-span-3">
          <label className="block font-bold text-slate-700 mb-1">
            Anthropic Organization Admin API Key (<code>ANTHROPIC_ORG_ADMIN_API_KEY</code>)
          </label>
          <input
            type="password"
            value={sharedAdminKeyDraft}
            onChange={(e) => setSharedAdminKeyDraft(e.target.value)}
            placeholder="sk-ant-admin01-... (Leave blank to keep existing key)"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs text-slate-900"
          />
        </div>

        <div>
          <label className="block font-bold text-slate-700 mb-1">
            Acrio Workspace ID (<code>ACRIO_ANTHROPIC_WORKSPACE_ID</code>)
          </label>
          <input
            type="text"
            value={acrioWorkspaceDraft}
            onChange={(e) => setAcrioWorkspaceDraft(e.target.value)}
            placeholder="wrkspc_01..."
            className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs text-slate-900"
          />
        </div>

        <div>
          <label className="block font-bold text-slate-700 mb-1">
            Acrio API Key ID (<code>ACRIO_ANTHROPIC_API_KEY_ID</code>)
          </label>
          <input
            type="text"
            value={acrioKeyIdDraft}
            onChange={(e) => setAcrioKeyIdDraft(e.target.value)}
            placeholder="apikey_01..."
            className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs text-slate-900"
          />
        </div>

        <div className="flex items-center pt-5">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={acrioSharedOthersDraft}
              onChange={(e) => setAcrioSharedOthersDraft(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span className="text-slate-700 font-medium">
              Acrio workspace also serves unrelated integrations
            </span>
          </label>
        </div>

        <div>
          <label className="block font-bold text-slate-700 mb-1">
            Acro Workspace ID (<code>ACRO_ANTHROPIC_WORKSPACE_ID</code>)
          </label>
          <input
            type="text"
            value={acroWorkspaceDraft}
            onChange={(e) => setAcroWorkspaceDraft(e.target.value)}
            placeholder="wrkspc_01..."
            className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs text-slate-900"
          />
        </div>

        <div>
          <label className="block font-bold text-slate-700 mb-1">
            Acro API Key ID (<code>ACRO_ANTHROPIC_API_KEY_ID</code>)
          </label>
          <input
            type="text"
            value={acroKeyIdDraft}
            onChange={(e) => setAcroKeyIdDraft(e.target.value)}
            placeholder="apikey_01..."
            className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs text-slate-900"
          />
        </div>

        <div className="flex items-center pt-5">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={acroSharedOthersDraft}
              onChange={(e) => setAcroSharedOthersDraft(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span className="text-slate-700 font-medium">
              Acro workspace also serves unrelated integrations
            </span>
          </label>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={savingConfig}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{savingConfig ? "Saving & Fetching..." : "Save Attribution Config & Refresh"}</span>
        </button>
      </div>
    </form>
  );
}
