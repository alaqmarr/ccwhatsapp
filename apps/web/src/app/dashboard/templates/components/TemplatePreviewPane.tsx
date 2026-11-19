"use client";

import React, { useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  MapPin,
  Phone,
  Video,
} from "lucide-react";
import {
  CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE,
  ClassicConceptsMark,
  WhatsAppFormattedText,
  WhatsAppMessageTicks,
} from "@cc/ui";
import type {
  HeaderType,
  LocationHeader,
  TemplateButton,
  TemplateCategory,
} from "@/app/dashboard/templates/types";

export function TemplatePreviewPane({
  isDev,
  category,
  headerType,
  headerMediaUrl,
  headerLocation,
  previewHeaderRendered,
  previewBodyRendered,
  footerText,
  buttons,
  liveMetaJsonPreview,
}: {
  isDev: boolean;
  category: TemplateCategory;
  headerType: HeaderType;
  headerMediaUrl: string;
  headerLocation: LocationHeader;
  previewHeaderRendered: string;
  previewBodyRendered: string;
  footerText: string;
  buttons: TemplateButton[];
  liveMetaJsonPreview: Record<string, unknown>;
}) {
  const [previewTab, setPreviewTab] = useState<"PHONE" | "JSON">("PHONE");
  const [copiedJson, setCopiedJson] = useState<boolean>(false);

  return (
    <div className="xl:col-span-5 xl:sticky xl:top-5 space-y-3">
      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 flex items-center justify-between">
          <span className="text-xs font-semibold text-neutral-900">
            Live Customer Preview
          </span>
          {isDev && (
            <div className="inline-flex rounded bg-neutral-200/70 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setPreviewTab("PHONE")}
                className={`px-2.5 py-0.5 rounded font-medium cursor-pointer ${
                  previewTab === "PHONE"
                    ? "bg-white text-neutral-900 shadow-2xs"
                    : "text-neutral-600"
                }`}
              >
                WhatsApp View
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab("JSON")}
                className={`px-2.5 py-0.5 rounded font-medium cursor-pointer ${
                  previewTab === "JSON"
                    ? "bg-white text-neutral-900 shadow-2xs"
                    : "text-neutral-600"
                }`}
              >
                Meta API JSON
              </button>
            </div>
          )}
        </div>

        {previewTab === "JSON" && isDev ? (
          <div className="p-4 space-y-2 bg-neutral-950 text-neutral-100">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-neutral-400">
                Meta Graph API v21.0 Payload
              </span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(
                    JSON.stringify(liveMetaJsonPreview, null, 2)
                  );
                  setCopiedJson(true);
                  setTimeout(() => setCopiedJson(false), 1800);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-[11px] text-white cursor-pointer"
              >
                {copiedJson ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy JSON</span>
                  </>
                )}
              </button>
            </div>
            <pre className="text-[11px] font-mono overflow-x-auto max-h-[460px] leading-relaxed">
              {JSON.stringify(liveMetaJsonPreview, null, 2)}
            </pre>
          </div>
        ) : (
          <div>
            <div className="px-4 py-2.5 bg-[#075e54] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0">
                  <ClassicConceptsMark size={22} />
                </div>
                <div>
                  <div className="text-xs font-semibold flex items-center gap-1">
                    <span>Classic Concepts</span>
                    <span className="w-3.5 h-3.5 rounded-full bg-[#25d366] text-white inline-flex items-center justify-center text-[9px]">
                      ✓
                    </span>
                  </div>
                  <div className="text-[10px] text-emerald-100">
                    Official Business Account
                  </div>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded bg-white/15 text-[10px]">
                {category}
              </span>
            </div>

            <div
              style={CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE}
              className="p-5 min-h-[360px] flex flex-col justify-center"
            >
              <div className="max-w-[92%] bg-white rounded-lg shadow-xs overflow-hidden border border-black/5">
                {category !== "AUTHENTICATION" && headerType === "IMAGE" && (
                  <div className="h-36 bg-neutral-100 flex items-center justify-center overflow-hidden border-b border-neutral-100">
                    {headerMediaUrl ? (
                      <img
                        src={headerMediaUrl}
                        alt="Header preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center text-neutral-400 text-xs gap-1">
                        <ImageIcon className="w-6 h-6" />
                        <span>Image Header Preview</span>
                      </div>
                    )}
                  </div>
                )}

                {category !== "AUTHENTICATION" && headerType === "VIDEO" && (
                  <div className="h-32 bg-neutral-900 text-white flex flex-col items-center justify-center gap-1 text-xs">
                    <Video className="w-6 h-6 text-emerald-400" />
                    <span>Video Header</span>
                  </div>
                )}

                {category !== "AUTHENTICATION" && headerType === "DOCUMENT" && (
                  <div className="p-3 bg-neutral-100 border-b border-neutral-200 flex items-center gap-2.5 text-xs text-neutral-800">
                    <FileText className="w-5 h-5 text-red-600 shrink-0" />
                    <span className="truncate font-medium">
                      {headerMediaUrl
                        ? headerMediaUrl.split("/").pop()
                        : "Classic-Concepts-Quote.pdf"}
                    </span>
                  </div>
                )}

                {category !== "AUTHENTICATION" && headerType === "LOCATION" && (
                  <div className="p-3 bg-emerald-50 border-b border-emerald-100 flex items-start gap-2 text-xs">
                    <MapPin className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-neutral-900">
                        {headerLocation.name}
                      </div>
                      <div className="text-[11px] text-neutral-600">
                        {headerLocation.address}
                      </div>
                    </div>
                  </div>
                )}

                <div className="p-3 space-y-1.5">
                  {category !== "AUTHENTICATION" &&
                    headerType === "TEXT" &&
                    previewHeaderRendered.trim() && (
                      <div className="text-[13.5px] font-bold text-[#111b21]">
                        {previewHeaderRendered}
                      </div>
                    )}

                  <WhatsAppFormattedText
                    text={previewBodyRendered}
                    className="text-[13px] text-[#111b21] leading-snug"
                  />

                  {footerText.trim() && (
                    <div className="text-[11px] text-[#667781] pt-1">
                      {footerText}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-1.5 text-[10px] text-[#667781]">
                    <span>10:30 AM</span>
                    <WhatsAppMessageTicks status="READ" showLabel size={13} />
                  </div>
                </div>

                {buttons.length > 0 && (
                  <div className="divide-y divide-neutral-200 border-t border-neutral-200 bg-white">
                    {buttons.map((b) => (
                      <div
                        key={b.id}
                        className="py-2 px-3 text-center text-xs font-medium text-[#00a5f4] flex items-center justify-center gap-1.5"
                      >
                        {b.type === "URL" && (
                          <ExternalLink className="w-3.5 h-3.5" />
                        )}
                        {b.type === "PHONE_NUMBER" && (
                          <Phone className="w-3.5 h-3.5" />
                        )}
                        {(b.type === "COPY_CODE" || b.type === "OTP") && (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{b.text || "Button"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
