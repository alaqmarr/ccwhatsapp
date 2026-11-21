"use client";

import React, { useMemo, useState } from "react";
import { FileText, Loader2, Send } from "lucide-react";
import type { TemplateSendPayload } from "@/components/TemplateSendDialog";
import type { ApprovedTemplateOption } from "@/lib/inbox-server-data";
import {
  cleanTemplateVarValue,
  selectClientInitiationTemplates,
  smartFillTemplateForCustomer,
  varIndices,
  type TemplateCustomerContext,
} from "@/lib/template-variables";

export function EmptyChatStarterTemplates({
  templates,
  customer,
  onSendTemplate,
  onOpenAllTemplates,
}: {
  templates: ApprovedTemplateOption[];
  customer: TemplateCustomerContext;
  onSendTemplate: (payload: TemplateSendPayload) => Promise<{ ok: boolean; error?: string }>;
  onOpenAllTemplates: () => void;
}) {
  const readyTemplates = useMemo(
    () => selectClientInitiationTemplates(templates, 2),
    [templates]
  );
  const [headerEdits, setHeaderEdits] = useState<
    Record<string, Record<number, string>>
  >({});
  const [bodyEdits, setBodyEdits] = useState<
    Record<string, Record<number, string>>
  >({});
  const [sendingTplId, setSendingTplId] = useState<string | null>(null);
  const [errorByTplId, setErrorByTplId] = useState<Record<string, string>>({});

  if (readyTemplates.length === 0) {
    return (
      <div className="mx-auto max-w-lg my-4 rounded-xl bg-white border border-[#d1d7db] p-5 text-center space-y-2.5 shadow-2xs">
        <div className="text-sm font-semibold text-[#111b21]">
          Start this conversation
        </div>
        <p className="text-xs text-[#54656f]">
          No WhatsApp messages in this chat yet. Open the template picker to
          send an approved greeting first.
        </p>
        <button
          type="button"
          onClick={onOpenAllTemplates}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold cursor-pointer"
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Choose Template</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl my-3 rounded-xl bg-white border border-[#d1d7db] p-4 sm:p-5 space-y-3.5 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[#111b21]">
            Ready templates to start this chat
          </h3>
          <p className="text-xs text-[#54656f] mt-0.5">
            Variables are pre-filled automatically from client details (or{" "}
            <span className="font-medium text-[#111b21]">Hey there</span> if the
            client name is not saved yet).
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenAllTemplates}
          className="text-xs font-semibold text-[#008069] hover:underline inline-flex items-center gap-1 cursor-pointer shrink-0"
        >
          <FileText className="w-3.5 h-3.5" />
          <span>All templates</span>
        </button>
      </div>

      <div
        className={`grid gap-3 ${
          readyTemplates.length === 1 ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"
        }`}
      >
        {readyTemplates.map((tpl, idx) => {
          const filled = smartFillTemplateForCustomer(tpl, customer, {
            headerValues: headerEdits[tpl.id],
            bodyValues: bodyEdits[tpl.id],
          });
          const headerIdx = varIndices(tpl.headerText);
          const bodyIdx = varIndices(tpl.bodyText);
          const isSending = sendingTplId === tpl.id;
          const cardError = errorByTplId[tpl.id] || "";
          const canSend = filled.missingVars.length === 0 && !isSending;

          return (
            <div
              key={tpl.id}
              className="flex flex-col justify-between rounded-xl border border-[#d1d7db] bg-neutral-50 p-3.5 space-y-3"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#111b21] truncate">
                    {idx + 1}. {tpl.name}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-white border border-neutral-200 text-[10px] font-medium text-[#54656f] shrink-0">
                    {tpl.category}
                  </span>
                </div>

                {(headerIdx.length > 0 || bodyIdx.length > 0) && (
                  <div className="space-y-1.5">
                    {headerIdx.map((idx) => (
                      <div key={`h_${tpl.id}_${idx}`} className="space-y-0.5">
                        <label className="block text-[11px] font-medium text-[#54656f]">
                          Header {`{{${idx}}}`}
                          {filled.sources[`h${idx}`]
                            ? ` (auto-filled from ${filled.sources[`h${idx}`]})`
                            : ""}
                        </label>
                        <input
                          type="text"
                          value={filled.headerValues[idx] || ""}
                          onChange={(e) =>
                            setHeaderEdits((prev) => ({
                              ...prev,
                              [tpl.id]: {
                                ...(prev[tpl.id] || {}),
                                [idx]: e.target.value,
                              },
                            }))
                          }
                          className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-[#111b21]"
                        />
                      </div>
                    ))}

                    {bodyIdx.map((idx) => {
                      const spec = tpl.variablesSchema.find(
                        (v) => v.index === idx
                      );
                      return (
                        <div key={`b_${tpl.id}_${idx}`} className="space-y-0.5">
                          <label className="block text-[11px] font-medium text-[#54656f]">
                            {spec?.label || `Variable {{${idx}}}`}
                            {filled.sources[`b${idx}`]
                              ? ` (auto-filled from ${filled.sources[`b${idx}`]})`
                              : ""}
                          </label>
                          <input
                            type="text"
                            value={filled.bodyValues[idx] || ""}
                            onChange={(e) =>
                              setBodyEdits((prev) => ({
                                ...prev,
                                [tpl.id]: {
                                  ...(prev[tpl.id] || {}),
                                  [idx]: e.target.value,
                                },
                              }))
                            }
                            placeholder={
                              spec?.sampleValue || `Enter value for {{${idx}}}`
                            }
                            className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-[#111b21]"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="rounded-lg bg-[#d9fdd3] border border-[#b7ebaf] px-3 py-2 text-xs text-[#111b21] whitespace-pre-wrap leading-relaxed shadow-2xs">
                  {filled.renderedHeader && (
                    <div className="font-semibold mb-1">
                      {filled.renderedHeader}
                    </div>
                  )}
                  <div>{filled.renderedBody}</div>
                  {filled.renderedFooter && (
                    <div className="mt-1.5 text-[10.5px] text-[#54656f]">
                      {filled.renderedFooter}
                    </div>
                  )}
                </div>

                {cardError && (
                  <p className="text-[11px] text-red-700 font-medium">
                    {cardError}
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={!canSend}
                onClick={async () => {
                  setSendingTplId(tpl.id);
                  setErrorByTplId((prev) => ({ ...prev, [tpl.id]: "" }));
                  try {
                    const existingHeaderMedia =
                      tpl.headerMediaUrl && /^https?:\/\//i.test(tpl.headerMediaUrl)
                        ? tpl.headerMediaUrl
                        : undefined;
                    const res = await onSendTemplate({
                      template: tpl,
                      headerValues: filled.orderedHeaderValues.map((v) =>
                        cleanTemplateVarValue(v)
                      ),
                      bodyValues: filled.orderedBodyValues.map((v) =>
                        cleanTemplateVarValue(v)
                      ),
                      ...(existingHeaderMedia
                        ? { headerMediaUrl: existingHeaderMedia }
                        : {}),
                      renderedText: filled.renderedText,
                    });
                    if (!res.ok) {
                      setErrorByTplId((prev) => ({
                        ...prev,
                        [tpl.id]:
                          res.error || "Could not send this template right now.",
                      }));
                    }
                  } finally {
                    setSendingTplId(null);
                  }
                }}
                className="w-full h-9 px-3 rounded-lg bg-[#00a884] hover:bg-[#008f6f] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Template</span>
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
