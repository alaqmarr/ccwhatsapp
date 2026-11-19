"use client";

import React from "react";
import { ArrowDown, ArrowUp, Workflow, X } from "lucide-react";
import {
  SHORTLINK_PUBLIC_DOMAIN,
  SHORTLINK_PUBLIC_ORIGIN,
  TRACKING_PUBLIC_ORIGIN,
  formatShortLinkUrl,
} from "@cc/ui";
import type {
  ButtonFlowActionType,
  ShortLinkOption,
  TemplateButton,
  TemplateRecord,
} from "@/app/dashboard/templates/types";

export function TemplateButtonsEditor({
  buttons,
  setButtons,
  customLinks,
  teams,
  templates,
  onAddButton,
  onMoveButton,
}: {
  buttons: TemplateButton[];
  setButtons: React.Dispatch<React.SetStateAction<TemplateButton[]>>;
  customLinks: ShortLinkOption[];
  teams: { id: string; name: string }[];
  templates: TemplateRecord[];
  onAddButton: (type: TemplateButton["type"]) => void;
  onMoveButton: (index: number, dir: -1 | 1) => void;
}) {
  return (
    <div className="p-3.5 rounded-lg border border-neutral-200 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold text-neutral-900">
            Interactive Buttons ({buttons.length}/10)
          </span>
          <p className="text-[11px] text-neutral-500">
            Add clickable website/short-link buttons, phone call buttons, coupon copy buttons, or quick replies.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onAddButton("QUICK_REPLY")}
            className="px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 font-medium cursor-pointer"
          >
            + Quick Reply
          </button>
          <button
            type="button"
            onClick={() => onAddButton("URL")}
            className="px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 font-medium cursor-pointer"
          >
            + Website / Short Link
          </button>
          <button
            type="button"
            onClick={() => onAddButton("PHONE_NUMBER")}
            className="px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 font-medium cursor-pointer"
          >
            + Phone Call
          </button>
          <button
            type="button"
            onClick={() => onAddButton("COPY_CODE")}
            className="px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 font-medium cursor-pointer"
          >
            + Copy Code
          </button>
        </div>
      </div>

      {buttons.length === 0 ? (
        <p className="text-neutral-500 text-center py-2">
          No buttons added. Click any button type above to add one.
        </p>
      ) : (
        <div className="space-y-2.5">
          {buttons.map((btn, idx) => (
            <div
              key={btn.id}
              className="p-3 rounded-md bg-neutral-50 border border-neutral-200 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="px-2 py-0.5 rounded bg-white border border-neutral-300 text-[11px] font-semibold">
                  {btn.type === "URL"
                    ? "Visit Website"
                    : btn.type === "PHONE_NUMBER"
                    ? "Call Phone Number"
                    : btn.type === "COPY_CODE" || btn.type === "OTP"
                    ? "Copy Code"
                    : "Quick Reply"}
                </span>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onMoveButton(idx, -1)}
                    disabled={idx === 0}
                    className="p-1 text-neutral-500 hover:text-neutral-900 disabled:opacity-30 cursor-pointer"
                    title="Move up"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveButton(idx, 1)}
                    disabled={idx === buttons.length - 1}
                    className="p-1 text-neutral-500 hover:text-neutral-900 disabled:opacity-30 cursor-pointer"
                    title="Move down"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setButtons((prev) => prev.filter((b) => b.id !== btn.id))
                    }
                    className="p-1 text-neutral-400 hover:text-red-600 cursor-pointer"
                    title="Remove button"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <input
                  type="text"
                  maxLength={25}
                  value={btn.text}
                  onChange={(e) => {
                    const val = e.target.value;
                    setButtons((prev) =>
                      prev.map((b) =>
                        b.id === btn.id ? { ...b, text: val } : b
                      )
                    );
                  }}
                  placeholder="Button Label (max 25 chars)"
                  className="sm:col-span-5 rounded border border-neutral-300 bg-white px-2.5 py-1.5"
                />

                {btn.type === "URL" && (
                  <>
                    <input
                      type="url"
                      value={btn.url || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setButtons((prev) =>
                          prev.map((b) =>
                            b.id === btn.id ? { ...b, url: val } : b
                          )
                        );
                      }}
                      placeholder="https://ccapl.cc/podium"
                      className="sm:col-span-7 rounded border border-neutral-300 bg-white px-2.5 py-1.5 font-mono"
                    />
                    <div className="sm:col-span-12 flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <select
                        value={btn.urlType || "STATIC"}
                        onChange={(e) => {
                          const nextType = e.target.value as
                            | "STATIC"
                            | "DYNAMIC";
                          setButtons((prev) =>
                            prev.map((b) =>
                              b.id === btn.id ? { ...b, urlType: nextType } : b
                            )
                          );
                        }}
                        className="rounded border border-neutral-300 bg-white px-2 py-1 text-[11px]"
                      >
                        <option value="STATIC">Fixed Link</option>
                        <option value="DYNAMIC">
                          Dynamic Link Suffix (adds {"{{1}}"} at end)
                        </option>
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          setButtons((prev) =>
                            prev.map((b) =>
                              b.id === btn.id
                                ? {
                                    ...b,
                                    text: b.text || "Track Order",
                                    urlType: "DYNAMIC",
                                    url: `${TRACKING_PUBLIC_ORIGIN}/{{1}}`,
                                  }
                                : b
                            )
                          );
                        }}
                        className="rounded border border-[#00a884]/45 bg-[#e7fce3] hover:bg-[#d9fdd3] px-2.5 py-1 text-[11px] font-semibold text-[#008069] cursor-pointer"
                      >
                        Use Order Track (track.ccapl.cc/{"{{1}}"})
                      </button>

                      {customLinks.length > 0 && (
                        <select
                          value=""
                          onChange={(e) => {
                            const chosen = e.target.value;
                            if (!chosen) return;
                            setButtons((prev) =>
                              prev.map((b) =>
                                b.id === btn.id
                                  ? { ...b, url: formatShortLinkUrl(chosen) }
                                  : b
                              )
                            );
                          }}
                          className="rounded border border-neutral-300 bg-white px-2 py-1 text-[11px]"
                        >
                          <option value="">
                            Insert short link ({SHORTLINK_PUBLIC_DOMAIN}/...)...
                          </option>
                          {customLinks.map((lnk) => (
                            <option key={lnk.id} value={lnk.code}>
                              {SHORTLINK_PUBLIC_DOMAIN}/{lnk.code} ({lnk.title})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </>
                )}

                {btn.type === "QUICK_REPLY" && (
                  <div className="sm:col-span-7 flex items-center gap-2">
                    <Workflow className="w-3.5 h-3.5 text-[#008069] shrink-0" />
                    <select
                      value={btn.flowAction?.actionType || "AUTO_REPLY"}
                      onChange={(e) => {
                        const nextAction = e.target
                          .value as ButtonFlowActionType;
                        setButtons((prev) =>
                          prev.map((b) =>
                            b.id === btn.id
                              ? {
                                  ...b,
                                  flowAction: {
                                    ...(b.flowAction || {}),
                                    actionType: nextAction,
                                    teamId:
                                      b.flowAction?.teamId ||
                                      teams[0]?.id ||
                                      "team_sales",
                                  },
                                }
                              : b
                          )
                        );
                      }}
                      className="w-full rounded border border-emerald-300 bg-emerald-50/70 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-950"
                    >
                      <option value="AUTO_REPLY">
                        On Tap: Send Instant Auto-Reply (0 AI Credits)
                      </option>
                      <option value="ASSIGN_TEAM">
                        On Tap: Route Chat to Team + Email Staff Alert
                      </option>
                      <option value="SEND_ORDER_TRACKING">
                        On Tap: Live Order Status Lookup (3 Websites)
                      </option>
                      <option value="SEND_APPROVED_TEMPLATE">
                        On Tap: Send Follow-Up Approved Template
                      </option>
                      <option value="OPT_OUT_DND">
                        On Tap: Unsubscribe / Mark DND (STOP)
                      </option>
                      <option value="SMART_AI_WITH_GUARD">
                        On Tap: Guarded Single-Shot AI Reply
                      </option>
                      <option value="NONE">
                        On Tap: No Mapped Flow (Standard Inbox Rules)
                      </option>
                    </select>
                  </div>
                )}

                {btn.type === "PHONE_NUMBER" && (
                  <input
                    type="text"
                    value={btn.phoneNumber || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setButtons((prev) =>
                        prev.map((b) =>
                          b.id === btn.id ? { ...b, phoneNumber: val } : b
                        )
                      );
                    }}
                    placeholder="+917337222876"
                    className="sm:col-span-7 rounded border border-neutral-300 bg-white px-2.5 py-1.5 font-mono"
                  />
                )}

                {(btn.type === "COPY_CODE" || btn.type === "OTP") && (
                  <input
                    type="text"
                    maxLength={15}
                    value={btn.exampleCode || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setButtons((prev) =>
                        prev.map((b) =>
                          b.id === btn.id ? { ...b, exampleCode: val } : b
                        )
                      );
                    }}
                    placeholder="Sample Code (e.g. CLASSIC10)"
                    className="sm:col-span-7 rounded border border-neutral-300 bg-white px-2.5 py-1.5 font-mono"
                  />
                )}
              </div>

              {btn.type === "QUICK_REPLY" &&
                (btn.flowAction?.actionType || "AUTO_REPLY") !== "NONE" && (
                  <div className="p-2.5 rounded border border-emerald-200 bg-white space-y-2 text-[11px]">
                    {(btn.flowAction?.actionType || "AUTO_REPLY") ===
                      "AUTO_REPLY" && (
                      <div>
                        <label className="block font-medium text-neutral-700 mb-1">
                          Exact WhatsApp Reply Sent Immediately When Customer Taps &ldquo;{btn.text || "Button"}&rdquo;:
                        </label>
                        <textarea
                          rows={2}
                          value={btn.flowAction?.replyText || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setButtons((prev) =>
                              prev.map((b) =>
                                b.id === btn.id
                                  ? {
                                      ...b,
                                      flowAction: {
                                        ...(b.flowAction || {
                                          actionType: "AUTO_REPLY",
                                        }),
                                        replyText: val,
                                      },
                                    }
                                  : b
                              )
                            );
                          }}
                          placeholder={`Here is our catalog & price guide: ${SHORTLINK_PUBLIC_ORIGIN}/podium\nShare your required quantity for bulk rates!`}
                          className="w-full rounded border border-neutral-300 px-2.5 py-1.5"
                        />
                      </div>
                    )}

                    {btn.flowAction?.actionType === "ASSIGN_TEAM" && (
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <div className="sm:col-span-5">
                          <label className="block font-medium text-neutral-700 mb-1">
                            Assign to Team (Sends Staff Email Alert)
                          </label>
                          <select
                            value={
                              btn.flowAction?.teamId ||
                              teams[0]?.id ||
                              "team_sales"
                            }
                            onChange={(e) => {
                              const val = e.target.value;
                              setButtons((prev) =>
                                prev.map((b) =>
                                  b.id === btn.id
                                    ? {
                                        ...b,
                                        flowAction: {
                                          ...(b.flowAction || {
                                            actionType: "ASSIGN_TEAM",
                                          }),
                                          teamId: val,
                                        },
                                      }
                                    : b
                                )
                              );
                            }}
                            className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5"
                          >
                            {teams.map((tm) => (
                              <option key={tm.id} value={tm.id}>
                                {tm.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:col-span-7">
                          <label className="block font-medium text-neutral-700 mb-1">
                            Instant Confirmation Message to Customer
                          </label>
                          <input
                            type="text"
                            value={btn.flowAction?.replyText || ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setButtons((prev) =>
                                prev.map((b) =>
                                  b.id === btn.id
                                    ? {
                                        ...b,
                                        flowAction: {
                                          ...(b.flowAction || {
                                            actionType: "ASSIGN_TEAM",
                                          }),
                                          replyText: val,
                                        },
                                      }
                                    : b
                                )
                              );
                            }}
                            placeholder="Connecting you to our *Sales Team* right away."
                            className="w-full rounded border border-neutral-300 px-2.5 py-1.5"
                          />
                        </div>
                      </div>
                    )}

                    {btn.flowAction?.actionType ===
                      "SEND_APPROVED_TEMPLATE" && (
                      <div>
                        <label className="block font-medium text-neutral-700 mb-1">
                          Select Meta-APPROVED Follow-Up Template
                        </label>
                        <select
                          value={btn.flowAction?.templateName || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setButtons((prev) =>
                              prev.map((b) =>
                                b.id === btn.id
                                  ? {
                                      ...b,
                                      flowAction: {
                                        ...(b.flowAction || {
                                          actionType: "SEND_APPROVED_TEMPLATE",
                                        }),
                                        templateName: val,
                                      },
                                    }
                                  : b
                              )
                            );
                          }}
                          className="w-full rounded border border-neutral-300 bg-white px-2.5 py-1.5"
                        >
                          <option value="">Pick an Approved Template...</option>
                          {templates
                            .filter((tp) => tp.approvalStatus === "APPROVED")
                            .map((tp) => (
                              <option key={tp.id} value={tp.name}>
                                {tp.name} ({tp.category})
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {btn.flowAction?.actionType === "SMART_AI_WITH_GUARD" && (
                      <div>
                        <label className="block font-medium text-neutral-700 mb-1">
                          Strict Guarded AI Instruction (1 Short Reply Only):
                        </label>
                        <input
                          type="text"
                          value={btn.flowAction?.aiInstruction || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setButtons((prev) =>
                              prev.map((b) =>
                                b.id === btn.id
                                  ? {
                                      ...b,
                                      flowAction: {
                                        ...(b.flowAction || {
                                          actionType: "SMART_AI_WITH_GUARD",
                                        }),
                                        aiInstruction: val,
                                      },
                                    }
                                  : b
                              )
                            );
                          }}
                          placeholder="Share top 3 matching podium shortlinks and ask for quantity & delivery city."
                          className="w-full rounded border border-neutral-300 px-2.5 py-1.5"
                        />
                      </div>
                    )}

                    {btn.flowAction?.actionType === "SEND_ORDER_TRACKING" && (
                      <p className="text-emerald-800">
                        Automatically looks up the customer&apos;s latest order across Classic Concepts (:3003), Classic Edge 53 (:3002), and WhatsApp CRM (:3007) and sends a live <strong>track.ccapl.cc</strong> status card without invoking AI.
                      </p>
                    )}

                    {btn.flowAction?.actionType === "OPT_OUT_DND" && (
                      <p className="text-emerald-800">
                        Marks the customer opted-out of marketing broadcasts immediately and sends a polite confirmation without invoking AI.
                      </p>
                    )}
                  </div>
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
