"use client";

import React from "react";
import { FileText, Sparkles } from "lucide-react";
import { WhatsAppLogoIcon } from "@cc/ui";

export type NewChatModalMode = "TEMPLATE" | "OUTBOUND" | "INBOUND";

export function NewChatModeSelector({
  mode,
  onChange,
}: {
  mode: NewChatModalMode;
  onChange: (mode: NewChatModalMode) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-xs">
      <button
        type="button"
        onClick={() => onChange("TEMPLATE")}
        className={`py-2 px-2 rounded-md border font-medium cursor-pointer flex items-center justify-center gap-1 ${
          mode === "TEMPLATE"
            ? "bg-[#00a884] text-white border-[#00a884]"
            : "bg-white text-neutral-700 border-neutral-300"
        }`}
      >
        <FileText className="w-3.5 h-3.5" />
        <span>With Template</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("OUTBOUND")}
        className={`py-2 px-2 rounded-md border font-medium cursor-pointer flex items-center justify-center gap-1 ${
          mode === "OUTBOUND"
            ? "bg-neutral-900 text-white border-neutral-900"
            : "bg-white text-neutral-700 border-neutral-300"
        }`}
      >
        <WhatsAppLogoIcon size={12} />
        <span>Free Message</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("INBOUND")}
        className={`py-2 px-2 rounded-md border font-medium cursor-pointer flex items-center justify-center gap-1 ${
          mode === "INBOUND"
            ? "bg-indigo-700 text-white border-indigo-700"
            : "bg-white text-neutral-700 border-neutral-300"
        }`}
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span>Test Inbound</span>
      </button>
    </div>
  );
}

export function FreeTextMessageSection({
  mode,
  orgType,
  text,
  buttonPayload,
  onOrgTypeChange,
  onTextChange,
  onButtonPayloadChange,
}: {
  mode: NewChatModalMode;
  orgType: string;
  text: string;
  buttonPayload: string;
  onOrgTypeChange: (val: string) => void;
  onTextChange: (val: string) => void;
  onButtonPayloadChange: (val: string) => void;
}) {
  return (
    <div className="space-y-2.5">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">
          Business / Category
        </label>
        <input
          type="text"
          value={orgType}
          onChange={(e) => onOrgTypeChange(e.target.value)}
          className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">
          Message Text
        </label>
        <textarea
          rows={3}
          required
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          className="w-full rounded-md border border-neutral-300 p-2.5 text-xs"
        />
      </div>
      {mode === "INBOUND" && (
        <div>
          <label className="block text-[11px] font-medium text-neutral-700 mb-1">
            Optional: Simulate Quick-Reply Button Payload
          </label>
          <input
            type="text"
            value={buttonPayload}
            onChange={(e) => onButtonPayloadChange(e.target.value)}
            placeholder="e.g. TALK_TO_SALES or TRACK_MY_ORDER"
            className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-mono"
          />
        </div>
      )}
    </div>
  );
}
