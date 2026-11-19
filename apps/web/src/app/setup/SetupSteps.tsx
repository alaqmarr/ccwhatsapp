"use client";

import React from "react";
import { Check, Copy } from "lucide-react";

export function DevAccountStepCard({
  hasDevAccount,
  currentUserRole,
  name,
  email,
  whatsappNumber,
  password,
  onNameChange,
  onEmailChange,
  onWhatsappNumberChange,
  onPasswordChange,
}: {
  hasDevAccount: boolean;
  currentUserRole?: string | null;
  name: string;
  email: string;
  whatsappNumber: string;
  password: string;
  onNameChange: (val: string) => void;
  onEmailChange: (val: string) => void;
  onWhatsappNumberChange: (val: string) => void;
  onPasswordChange: (val: string) => void;
}) {
  if (hasDevAccount) {
    return (
      <div className="p-4 rounded-lg bg-white border border-neutral-200 flex items-center gap-2.5 text-xs text-neutral-700">
        <Check className="w-4 h-4 text-emerald-600 shrink-0" />
        <span>
          Developer account is active.{" "}
          {currentUserRole === "DEV"
            ? "You can update your Facebook WhatsApp connection below."
            : "Sign in as Dev to edit Facebook connection keys."}
        </span>
      </div>
    );
  }

  return (
    <section className="p-5 rounded-lg bg-white border border-neutral-200 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">
          1. Create Developer Account
        </h2>
        <p className="text-xs text-neutral-500 mt-1">
          The Dev account also has full Superadmin permissions to approve staff,
          plus access to Meta actual costs and daily Google Drive backups.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Full Name
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Email Address
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            WhatsApp Number
          </label>
          <input
            type="text"
            required
            value={whatsappNumber}
            onChange={(e) => onWhatsappNumberChange(e.target.value)}
            placeholder="+91 98765 43210"
            className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Password (minimum 6 characters)
          </label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder="Enter password"
            className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
          />
        </div>
      </div>
    </section>
  );
}

export function WebhookDetailsCard({
  webhookUrl,
  webhookVerifyToken,
  copied,
  onCopy,
}: {
  webhookUrl: string;
  webhookVerifyToken: string;
  copied: string;
  onCopy: (label: string, val: string) => void;
}) {
  return (
    <section className="p-5 rounded-lg bg-white border border-neutral-200 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">
          Webhook Details for Meta Dashboard
        </h2>
        <p className="text-xs text-neutral-500 mt-1">
          Paste these two values inside developers.facebook.com under WhatsApp
          &rarr; Configuration.
        </p>
      </div>

      <div className="space-y-3">
        {[
          { id: "url", label: "Callback URL", value: webhookUrl },
          { id: "token", label: "Verify Token", value: webhookVerifyToken },
        ].map((row) => (
          <div
            key={row.id}
            className="p-3 rounded-md bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <div className="text-[11px] text-neutral-500 font-medium">
                {row.label}
              </div>
              <div className="text-xs font-mono text-neutral-900 truncate">
                {row.value}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onCopy(row.id, row.value)}
              className="px-2.5 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-xs font-medium inline-flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <Copy className="w-3 h-3" />
              <span>{copied === row.id ? "Copied" : "Copy"}</span>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export { FacebookChecklistStep } from "./FacebookChecklistStep";
