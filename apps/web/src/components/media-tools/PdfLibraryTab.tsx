"use client";

import React from "react";
import type {
  CatalogMediaResource,
  StagedComposerAttachment,
} from "@/components/media-tools/types";

export function PdfLibraryTab({
  resources,
  onSelectPdf,
}: {
  resources: CatalogMediaResource[];
  onSelectPdf: (att: StagedComposerAttachment) => void;
}) {
  if (resources.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-bold uppercase tracking-wider text-[#54656f]">
        Official PDF Catalogues & Brochures ({resources.length})
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {resources.map((res) => (
          <button
            key={res.url}
            type="button"
            onClick={() =>
              onSelectPdf({
                mediaType: "DOCUMENT",
                url: res.url,
                fileName: res.fileName,
                mimeType: "application/pdf",
                productName: res.title,
                suggestedCaption: `*${res.title}* (${res.brandLabel})`,
              })
            }
            className="flex items-center justify-between gap-2 p-2 rounded-lg border border-[#d1d7db] hover:border-[#00a884] hover:bg-[#f0fdf4] text-left cursor-pointer transition"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded bg-red-50 border border-red-200 text-red-700 flex items-center justify-center font-bold text-[10px] shrink-0">
                PDF
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#111b21] truncate">
                  {res.title}
                </div>
                <div className="text-[10.5px] text-[#667781] truncate">
                  {res.brandLabel} • Click to attach PDF
                </div>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded bg-[#00a884] text-white text-[10.5px] font-semibold shrink-0">
              Attach
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
