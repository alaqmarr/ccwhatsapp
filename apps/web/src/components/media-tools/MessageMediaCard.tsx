"use client";

import React from "react";
import {
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Film,
  Music,
  X,
} from "lucide-react";
import {
  formatFileSize,
  getFileExtensionBadge,
  type NormalizedMessageMedia,
  type StagedComposerAttachment,
} from "@/components/media-tools/types";

export function MessageMediaRenderer({
  media,
  onOpenPreview,
}: {
  media: NormalizedMessageMedia;
  onOpenPreview: (media: NormalizedMessageMedia) => void;
}) {
  if (media.mediaType === "IMAGE") {
    return (
      <div className="my-1.5 w-full">
        <div className="relative group/img rounded-lg overflow-hidden border border-black/10 bg-white w-full max-w-[260px] sm:max-w-[280px]">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenPreview(media);
            }}
            className="block w-full text-left cursor-pointer"
            title="Click to view full size"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={media.url}
              alt={media.productName || media.fileName || "Attached image"}
              loading="lazy"
              className="w-full max-h-60 object-contain bg-white"
            />
          </button>
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover/img:opacity-100 transition">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenPreview(media);
              }}
              title="Preview full screen"
              className="p-1.5 rounded-md bg-black/65 hover:bg-black/80 text-white cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
            <a
              href={media.downloadUrl}
              download={media.fileName}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Download image"
              className="p-1.5 rounded-md bg-black/65 hover:bg-black/80 text-white"
            >
              <Download className="w-3.5 h-3.5" />
            </a>
          </div>
          {media.variantName && (
            <div className="px-2.5 py-1 bg-neutral-50 border-t border-black/8 text-[11px] font-semibold text-[#111b21] flex items-center justify-between gap-2">
              <span>Variant: {media.variantName}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (media.mediaType === "VIDEO") {
    return (
      <div className="my-1.5 w-full">
        <div className="rounded-lg overflow-hidden border border-black/10 bg-black w-full max-w-[260px] sm:max-w-[300px]">
          <video
            src={media.url}
            controls
            preload="metadata"
            className="w-full max-h-60 bg-black"
          />
          <div className="px-2.5 py-1.5 bg-neutral-900 text-white text-[11px] flex items-center justify-between gap-2">
            <span className="truncate font-medium">
              {media.productName || media.fileName || "Video"}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenPreview(media);
                }}
                className="px-1.5 py-0.5 rounded bg-white/15 hover:bg-white/25 text-white cursor-pointer"
              >
                Expand
              </button>
              <a
                href={media.downloadUrl}
                download={media.fileName}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded bg-white/15 hover:bg-white/25 text-white"
                title="Download video"
              >
                <Download className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (media.mediaType === "AUDIO") {
    return (
      <div className="my-1.5 rounded-lg bg-white/90 border border-black/10 p-2 w-full max-w-[260px] sm:max-w-[290px] space-y-1">
        <div className="flex items-center justify-between gap-2 text-[11px] text-[#54656f]">
          <span className="inline-flex items-center gap-1 font-semibold text-[#111b21] truncate">
            <Music className="w-3.5 h-3.5 text-[#00a884]" />
            <span className="truncate">{media.fileName || "Audio message"}</span>
          </span>
          <a
            href={media.downloadUrl}
            download={media.fileName}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1 rounded hover:bg-neutral-100 text-[#008069]"
            title="Download audio"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
        <audio src={media.url} controls className="w-full h-8" />
      </div>
    );
  }

  const badge = getFileExtensionBadge(media.fileName, media.mimeType);
  const isPdf = badge === "PDF" || media.mimeType.includes("pdf");
  const sizeLabel = formatFileSize(media.sizeBytes);

  return (
    <div className="my-1.5 rounded-lg bg-white/95 border border-black/12 p-2.5 w-full max-w-[270px] sm:max-w-[320px] shadow-2xs">
      <div className="flex items-start gap-2.5 min-w-0">
        <div
          className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center shrink-0 font-bold text-[10px] ${
            isPdf
              ? "bg-red-50 text-red-700 border border-red-200"
              : "bg-emerald-50 text-[#008069] border border-emerald-200"
          }`}
        >
          {badge === "XLS" || badge === "CSV" ? (
            <FileSpreadsheet className="w-4 h-4 mb-0.5" />
          ) : (
            <FileText className="w-4 h-4 mb-0.5" />
          )}
          <span>{badge}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="text-xs font-semibold text-[#111b21] break-all line-clamp-2 [overflow-wrap:anywhere]"
            title={media.fileName}
          >
            {media.fileName}
          </div>
          <div className="text-[11px] text-[#667781] mt-0.5">
            {badge} Document{sizeLabel ? ` • ${sizeLabel}` : ""}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenPreview(media);
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#f0f2f5] hover:bg-[#e2e6ea] text-[#111b21] text-[11px] font-semibold cursor-pointer"
            >
              <Eye className="w-3 h-3 text-[#008069]" />
              <span>Preview</span>
            </button>
            <a
              href={media.downloadUrl}
              download={media.fileName}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#00a884] hover:bg-[#008f6f] text-white text-[11px] font-semibold"
            >
              <Download className="w-3 h-3" />
              <span>Download</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StagedAttachmentBar({
  attachment,
  onClear,
}: {
  attachment: StagedComposerAttachment;
  onClear: () => void;
}) {
  const sizeText = formatFileSize(attachment.sizeBytes);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 border border-[#00a884] shadow-2xs">
      <div className="flex items-center gap-2.5 min-w-0">
        {attachment.mediaType === "IMAGE" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={attachment.url}
            alt={attachment.fileName}
            className="w-11 h-11 rounded object-cover border border-neutral-200 bg-white shrink-0"
          />
        ) : attachment.mediaType === "VIDEO" ? (
          <div className="w-11 h-11 rounded bg-neutral-900 text-white flex items-center justify-center shrink-0">
            <Film className="w-5 h-5 text-emerald-400" />
          </div>
        ) : (
          <div className="w-11 h-11 rounded bg-red-50 text-red-700 border border-red-200 flex flex-col items-center justify-center shrink-0 text-[10px] font-bold">
            <FileText className="w-4 h-4" />
            <span>PDF/DOC</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[#008069] text-[10px] font-bold uppercase">
              Ready to send • {attachment.mediaType}
            </span>
            {attachment.variantName && (
              <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-800 text-[10px] font-semibold truncate max-w-full">
                Variant: {attachment.variantName}
              </span>
            )}
          </div>
          <div className="text-xs font-semibold text-[#111b21] break-all [overflow-wrap:anywhere] mt-0.5">
            {attachment.productName || attachment.fileName}
          </div>
          <div className="text-[11px] text-[#667781] break-all [overflow-wrap:anywhere]">
            {attachment.fileName}
            {sizeText ? ` • ${sizeText}` : ""} - Add an optional caption below and press Send
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="p-1.5 rounded-md text-[#667781] hover:text-[#111b21] hover:bg-neutral-100 cursor-pointer shrink-0"
        title="Remove attachment"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
