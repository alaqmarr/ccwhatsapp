"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import {
  FACEBOOK_CHECKLIST_ITEMS,
  type SetupMode,
  type SetupStateResponse,
  type SetupStepsCompleted,
} from "./types";

export function FacebookChecklistStep({
  hasDevAccount,
  saving,
  mode,
  onModeChange,
  steps,
  onToggleStep,
  businessPortfolioId,
  onBusinessPortfolioIdChange,
  wabaId,
  onWabaIdChange,
  phoneNumberId,
  onPhoneNumberIdChange,
  businessDisplayPhone,
  onBusinessDisplayPhoneChange,
  metaAppId,
  onMetaAppIdChange,
  webhookVerifyToken,
  onWebhookVerifyTokenChange,
  systemUserAccessToken,
  onSystemUserAccessTokenChange,
  anthropicApiKey,
  onAnthropicApiKeyChange,
  anthropicAdminApiKey,
  onAnthropicAdminApiKeyChange,
  aiKeys,
}: {
  hasDevAccount: boolean;
  saving: boolean;
  mode: SetupMode;
  onModeChange: (mode: SetupMode) => void;
  steps: SetupStepsCompleted;
  onToggleStep: (key: keyof SetupStepsCompleted, checked: boolean) => void;
  businessPortfolioId: string;
  onBusinessPortfolioIdChange: (v: string) => void;
  wabaId: string;
  onWabaIdChange: (v: string) => void;
  phoneNumberId: string;
  onPhoneNumberIdChange: (v: string) => void;
  businessDisplayPhone: string;
  onBusinessDisplayPhoneChange: (v: string) => void;
  metaAppId: string;
  onMetaAppIdChange: (v: string) => void;
  webhookVerifyToken: string;
  onWebhookVerifyTokenChange: (v: string) => void;
  systemUserAccessToken: string;
  onSystemUserAccessTokenChange: (v: string) => void;
  anthropicApiKey: string;
  onAnthropicApiKeyChange: (v: string) => void;
  anthropicAdminApiKey: string;
  onAnthropicAdminApiKeyChange: (v: string) => void;
  aiKeys?: SetupStateResponse["aiKeys"];
}) {
  return (
    <section className="xl:col-span-7 p-5 rounded-lg bg-white border border-neutral-200 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">
            2. Facebook WhatsApp Connection Steps
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Keep Test Mode on while testing locally, and switch to Live Mode once
            your Facebook token is ready.
          </p>
        </div>
        <div className="inline-flex rounded-md bg-neutral-100 p-1 border border-neutral-200">
          <button
            type="button"
            onClick={() => onModeChange("SANDBOX_SIMULATOR")}
            className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer ${
              mode === "SANDBOX_SIMULATOR"
                ? "bg-white text-neutral-900 shadow-2xs"
                : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            Test Mode
          </button>
          <button
            type="button"
            onClick={() => onModeChange("LIVE_META_CLOUD")}
            className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer ${
              mode === "LIVE_META_CLOUD"
                ? "bg-[#1da851] text-white"
                : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            Live Facebook API
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-neutral-700">
          Facebook Setup Checklist
        </div>
        {FACEBOOK_CHECKLIST_ITEMS.map((item) => (
          <label
            key={item.key}
            className="flex items-start gap-3 p-3 rounded-md bg-neutral-50 border border-neutral-200 hover:border-neutral-300 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={steps[item.key]}
              onChange={(e) => onToggleStep(item.key, e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-[#1da851]"
            />
            <div>
              <div className="text-xs font-medium text-neutral-900">
                {item.title}
              </div>
              <div className="text-xs text-neutral-500">{item.desc}</div>
            </div>
          </label>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Business Portfolio ID
          </label>
          <input
            type="text"
            value={businessPortfolioId}
            onChange={(e) => onBusinessPortfolioIdChange(e.target.value)}
            placeholder="30341529622102835"
            className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Messaging Account ID (WABA)
          </label>
          <input
            type="text"
            value={wabaId}
            onChange={(e) => onWabaIdChange(e.target.value)}
            placeholder="2195463394700930"
            className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Phone Number ID
          </label>
          <input
            type="text"
            value={phoneNumberId}
            onChange={(e) => onPhoneNumberIdChange(e.target.value)}
            placeholder="1456145487577989"
            className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Business WhatsApp Number
          </label>
          <input
            type="text"
            value={businessDisplayPhone}
            onChange={(e) => onBusinessDisplayPhoneChange(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Facebook App ID
          </label>
          <input
            type="text"
            value={metaAppId}
            onChange={(e) => onMetaAppIdChange(e.target.value)}
            placeholder="Optional when using System Access Token"
            className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Webhook Verify Token
          </label>
          <input
            type="text"
            value={webhookVerifyToken}
            onChange={(e) => onWebhookVerifyTokenChange(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Permanent System Access Token (Never Expires)
          </label>
          <input
            type="password"
            value={systemUserAccessToken}
            onChange={(e) => onSystemUserAccessTokenChange(e.target.value)}
            placeholder="Paste permanent Facebook system access token"
            className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
          />
        </div>
        <div className="sm:col-span-2 pt-2 border-t border-neutral-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              Client ACRIO Key (claude-haiku-5-5){" "}
              {aiKeys?.clientConnected
                ? `(Active via ${aiKeys.clientSource}: ${aiKeys.clientMasked})`
                : ""}
            </label>
            <input
              type="password"
              value={anthropicApiKey}
              onChange={(e) => onAnthropicApiKeyChange(e.target.value)}
              placeholder="ANTHROPIC_CLIENT_API_KEY (loaded from .env)"
              className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              Admin ACRIO Key (claude-haiku-5-5){" "}
              {aiKeys?.adminConnected
                ? `(Active via ${aiKeys.adminSource}: ${aiKeys.adminMasked})`
                : ""}
            </label>
            <input
              type="password"
              value={anthropicAdminApiKey}
              onChange={(e) => onAnthropicAdminApiKeyChange(e.target.value)}
              placeholder="ANTHROPIC_ADMIN_API_KEY (loaded from .env)"
              className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="pt-2 flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#1da851] hover:bg-[#178c43] text-white text-sm font-medium cursor-pointer disabled:opacity-50"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>
            {!hasDevAccount ? "Create Dev Account & Continue" : "Save Settings"}
          </span>
        </button>
      </div>
    </section>
  );
}
