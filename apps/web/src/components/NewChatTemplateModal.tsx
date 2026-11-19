"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { WhatsAppLogoIcon } from "@cc/ui";
import type {
  ApprovedTemplateOption,
  ConversationSummary,
} from "@/lib/inbox-server-data";
import {
  FreeTextMessageSection,
  NewChatModeSelector,
  type NewChatModalMode,
} from "@/components/new-chat/NewChatModeFields";
import {
  fillTemplateText,
  TemplateSelectorSection,
  varIndices,
} from "@/components/new-chat/TemplateSelectorSection";

export type { NewChatModalMode } from "@/components/new-chat/NewChatModeFields";

function phoneMatchKey(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function NewChatTemplateModal({
  open,
  onClose,
  templates,
  threads,
  initialPhone,
  initialName,
  initialMode,
  onOpenExistingChat,
  onCompleted,
}: {
  open: boolean;
  onClose: () => void;
  templates: ApprovedTemplateOption[];
  threads: ConversationSummary[];
  initialPhone: string;
  initialName: string;
  initialMode: NewChatModalMode;
  onOpenExistingChat: (conversationId: string) => void;
  onCompleted: (conversationId: string, toastMessage: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<NewChatModalMode>(initialMode);
  const [phone, setPhone] = useState(initialPhone);
  const [name, setName] = useState(initialName);
  const [orgType, setOrgType] = useState("Business");
  const [text, setText] = useState(
    "Hi, we need clear acrylic podiums for our auditorium."
  );
  const [buttonPayload, setButtonPayload] = useState("");
  const [tplSearch, setTplSearch] = useState("");
  const [selectedTplId, setSelectedTplId] = useState<string>(
    templates[0]?.id || ""
  );
  const [headerVals, setHeaderVals] = useState<Record<number, string>>({});
  const [bodyVals, setBodyVals] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setPhone(initialPhone);
    setName(initialName);
    setError("");
    setButtonPayload("");
    if (templates.length > 0 && !selectedTplId) {
      setSelectedTplId(templates[0].id);
    }
  }, [open, initialMode, initialPhone, initialName, templates, selectedTplId]);

  const existingMatch = useMemo(() => {
    const targetKey = phoneMatchKey(phone);
    if (targetKey.length < 8) return null;
    return (
      threads.find((t) => phoneMatchKey(t.customerPhone) === targetKey) || null
    );
  }, [phone, threads]);

  const filteredTemplates = useMemo(() => {
    const q = tplSearch.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.bodyText.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
    );
  }, [templates, tplSearch]);

  const activeTpl = useMemo(
    () =>
      templates.find((t) => t.id === selectedTplId) ||
      filteredTemplates[0] ||
      null,
    [templates, filteredTemplates, selectedTplId]
  );

  const headerVars = useMemo(
    () => varIndices(activeTpl?.headerText),
    [activeTpl]
  );
  const bodyVars = useMemo(() => varIndices(activeTpl?.bodyText), [activeTpl]);

  // Pre-fill {{1}} with first name when switching template or entering customer name
  useEffect(() => {
    if (!open || !activeTpl) return;
    const trimmedName = name.trim();
    const first =
      trimmedName && !/^\+?\d/.test(trimmedName)
        ? trimmedName.split(/[\s(]/)[0]
        : "";
    setHeaderVals((prev) => {
      const next: Record<number, string> = {};
      for (const idx of varIndices(activeTpl.headerText)) {
        next[idx] = prev[idx] || first || "";
      }
      return next;
    });
    setBodyVals((prev) => {
      const next: Record<number, string> = {};
      for (const idx of varIndices(activeTpl.bodyText)) {
        const spec = activeTpl.variablesSchema.find((v) => v.index === idx);
        const autoFirst =
          idx === 1 || spec?.sourceField === "customer.firstName"
            ? first
            : spec?.sourceField === "customer.fullName"
            ? trimmedName
            : "";
        next[idx] = prev[idx] || autoFirst || spec?.sampleValue || "";
      }
      return next;
    });
  }, [open, activeTpl, name]);

  const renderedPreview = useMemo(() => {
    if (!activeTpl) return "";
    const parts: string[] = [];
    if (activeTpl.headerText && activeTpl.headerType === "TEXT") {
      parts.push(`*${fillTemplateText(activeTpl.headerText, headerVals)}*`);
    }
    parts.push(fillTemplateText(activeTpl.bodyText, bodyVals));
    if (activeTpl.footerText) parts.push(`_${activeTpl.footerText}_`);
    return parts.join("\n\n");
  }, [activeTpl, headerVals, bodyVals]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!phone.trim()) {
      setError("Enter a valid WhatsApp phone number.");
      return;
    }

    if (mode === "TEMPLATE") {
      if (!activeTpl) {
        setError("Select an approved Meta template to start the chat.");
        return;
      }
      for (const idx of headerVars) {
        if (!(headerVals[idx] || "").trim()) {
          setError(`Please fill header variable {{${idx}}}.`);
          return;
        }
      }
      for (const idx of bodyVars) {
        if (!(bodyVals[idx] || "").trim()) {
          setError(`Please fill body variable {{${idx}}}.`);
          return;
        }
      }

      const components: Record<string, unknown>[] = [];
      if (headerVars.length > 0) {
        components.push({
          type: "header",
          parameters: headerVars.map((idx) => ({
            type: "text",
            text: (headerVals[idx] || "").trim(),
          })),
        });
      }
      if (bodyVars.length > 0) {
        components.push({
          type: "body",
          parameters: bodyVars.map((idx) => ({
            type: "text",
            text: (bodyVals[idx] || "").trim(),
          })),
        });
      }

      setSubmitting(true);
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerPhone: phone.trim(),
            customerName: name.trim() || existingMatch?.customerName || phone.trim(),
            organizationType: orgType,
            direction: "OUTBOUND",
            messageType: "TEMPLATE",
            templateName: activeTpl.name,
            billingCategory: activeTpl.category,
            languageCode: activeTpl.language,
            ...(components.length > 0 ? { templateComponents: components } : {}),
            messageText: renderedPreview,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok || !data.conversationId) {
          setError(data.error || "Could not start chat with this template.");
          return;
        }
        await onCompleted(
          String(data.conversationId),
          `Started chat and sent template "${activeTpl.name}".`
        );
        onClose();
      } catch {
        setError("Network error while sending template.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerPhone: phone.trim(),
          customerName: name.trim() || existingMatch?.customerName || phone.trim(),
          organizationType: orgType,
          messageText: text.trim(),
          direction: mode === "INBOUND" ? "INBOUND" : "OUTBOUND",
          buttonPayload:
            mode === "INBOUND" && buttonPayload.trim()
              ? buttonPayload.trim()
              : undefined,
          buttonText:
            mode === "INBOUND" && buttonPayload.trim() ? text.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.conversationId) {
        setError(data.error || "Could not start conversation.");
        return;
      }
      await onCompleted(
        String(data.conversationId),
        mode === "INBOUND"
          ? "Customer message received and processed."
          : "New WhatsApp chat started."
      );
      onClose();
    } catch {
      setError("Network error while starting conversation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full sm:max-w-lg max-h-[92dvh] bg-white rounded-t-2xl sm:rounded-xl border border-neutral-200 shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="px-4 sm:px-5 py-3.5 border-b border-neutral-200 flex items-center justify-between gap-2 bg-[#f0f2f5]">
          <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-2 min-w-0">
            <span className="w-6 h-6 rounded-full bg-[#25d366] text-white inline-flex items-center justify-center shrink-0">
              <WhatsAppLogoIcon size={13} />
            </span>
            <span className="truncate">Open New WhatsApp Chat</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 cursor-pointer shrink-0 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <NewChatModeSelector mode={mode} onChange={setMode} />

          {error && (
            <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                WhatsApp Number
              </label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98480 55112"
                className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Customer Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={existingMatch?.customerName || "Optional customer name"}
                className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs"
              />
            </div>
          </div>

          {existingMatch && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 text-xs">
                <div className="font-semibold text-emerald-950 truncate">
                  Existing chat found: {existingMatch.customerName}
                </div>
                <div className="text-[11px] text-emerald-800 truncate">
                  Handled by {existingMatch.assignedStaffName || "ACRIO"} •{" "}
                  {existingMatch.status}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onOpenExistingChat(existingMatch.id);
                  onClose();
                }}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-semibold cursor-pointer"
              >
                <span>Open Chat</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          )}

          {mode === "TEMPLATE" ? (
            <TemplateSelectorSection
              templates={templates}
              filteredTemplates={filteredTemplates}
              activeTpl={activeTpl}
              tplSearch={tplSearch}
              onTplSearchChange={setTplSearch}
              onSelectTemplate={setSelectedTplId}
              headerVars={headerVars}
              bodyVars={bodyVars}
              headerVals={headerVals}
              bodyVals={bodyVals}
              onHeaderValChange={(idx, val) =>
                setHeaderVals((p) => ({ ...p, [idx]: val }))
              }
              onBodyValChange={(idx, val) =>
                setBodyVals((p) => ({ ...p, [idx]: val }))
              }
              renderedPreview={renderedPreview}
            />
          ) : (
            <FreeTextMessageSection
              mode={mode}
              orgType={orgType}
              text={text}
              buttonPayload={buttonPayload}
              onOrgTypeChange={setOrgType}
              onTextChange={setText}
              onButtonPayloadChange={setButtonPayload}
            />
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-neutral-200 bg-neutral-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-md border border-neutral-300 bg-white text-xs font-medium text-neutral-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || (mode === "TEMPLATE" && !activeTpl)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            <WhatsAppLogoIcon size={13} />
            <span>
              {submitting
                ? "Sending..."
                : mode === "TEMPLATE"
                ? "Send Template & Open Chat"
                : "Send"}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}
