"use client";

import React from "react";
import { X } from "lucide-react";
import { ElementErrorState, WhatsAppLogoIcon } from "@cc/ui";
import type { TemplateRecord } from "@/app/dashboard/templates/types";

export function TestTemplateModal({
  testModalTpl,
  testPhone,
  setTestPhone,
  sendingTest,
  testSendError,
  onClose,
  onSubmit,
}: {
  testModalTpl: TemplateRecord;
  testPhone: string;
  setTestPhone: (v: string) => void;
  sendingTest: boolean;
  testSendError: string;
  onClose: () => void;
  onSubmit: (e?: React.FormEvent) => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <form
        onSubmit={onSubmit}
        className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-lg border border-neutral-200 p-4 sm:p-5 space-y-4 shadow-xl text-xs"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-[#25d366] text-white inline-flex items-center justify-center">
              <WhatsAppLogoIcon size={13} />
            </span>
            <span>Send Test Template Message</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-neutral-600">
          Sends <strong>{testModalTpl.name}</strong> filled with its sample values to check formatting on your phone.
        </p>

        {testSendError && (
          <ElementErrorState
            title="Test message failed"
            message={testSendError}
            onRetry={() => void onSubmit()}
            retrying={sendingTest}
            compact
          />
        )}

        <div>
          <label className="block font-medium text-neutral-700 mb-1">
            Recipient WhatsApp Number
          </label>
          <input
            type="text"
            required
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="+91 98480 11223"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-md border border-neutral-300 font-medium text-neutral-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={sendingTest}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white font-semibold cursor-pointer disabled:opacity-50"
          >
            <WhatsAppLogoIcon size={13} />
            <span>{sendingTest ? "Sending..." : "Send Test Now"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
