"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Music,
  Paperclip,
  Search,
  Upload,
  X,
} from "lucide-react";
import type { ChatMessage } from "@/lib/inbox-server-data";

export type MediaAttachmentKind = "IMAGE" | "VIDEO" | "DOCUMENT" | "AUDIO";

export interface StagedComposerAttachment {
  mediaId?: string;
  waMediaId?: string;
  mediaType: MediaAttachmentKind;
  url: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  productName?: string;
  variantName?: string;
  suggestedCaption?: string;
}

export interface NormalizedMessageMedia {
  mediaType: MediaAttachmentKind;
  url: string;
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  productName: string | null;
  variantName: string | null;
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function inferKindFromMeta(
  rawType: string,
  mimeType: string,
  url: string,
  fileName: string
): MediaAttachmentKind {
  const t = rawType.toUpperCase();
  if (t === "IMAGE" || t === "VIDEO" || t === "DOCUMENT" || t === "AUDIO") {
    return t;
  }
  const m = mimeType.toLowerCase();
  const target = `${fileName} ${url}`.toLowerCase();
  if (
    m.startsWith("image/") ||
    /\.(jpe?g|png|webp|gif|bmp|svg)(\?|$)/i.test(target)
  ) {
    return "IMAGE";
  }
  if (
    m.startsWith("video/") ||
    /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i.test(target)
  ) {
    return "VIDEO";
  }
  if (
    m.startsWith("audio/") ||
    /\.(mp3|ogg|opus|wav|m4a|aac)(\?|$)/i.test(target)
  ) {
    return "AUDIO";
  }
  return "DOCUMENT";
}

export function extractMessageMedia(m: ChatMessage): NormalizedMessageMedia | null {
  const meta = (m.metadata || {}) as Record<string, unknown>;
  const nestedMedia =
    meta.media && typeof meta.media === "object"
      ? (meta.media as Record<string, unknown>)
      : null;

  const rawMediaId = String(
    meta.mediaId ||
      meta.media_id ||
      nestedMedia?.mediaId ||
      nestedMedia?.media_id ||
      ""
  ).trim();

  const rawUrl = String(
    meta.mediaUrl ||
      meta.imageUrl ||
      nestedMedia?.downloadUrl ||
      nestedMedia?.download_url ||
      (rawMediaId ? `/api/media/${encodeURIComponent(rawMediaId)}` : "")
  ).trim();

  if (!rawUrl) return null;

  const fileName = String(
    meta.fileName ||
      meta.filename ||
      nestedMedia?.filename ||
      (typeof meta.productName === "string" && meta.productName
        ? `${meta.productName}${meta.variantName ? ` - ${meta.variantName}` : ""}`
        : "") ||
      rawUrl.split("/").pop()?.split("?")[0] ||
      "attachment"
  ).trim();

  const mimeType = String(
    meta.mimeType ||
      meta.mime_type ||
      nestedMedia?.mimeType ||
      nestedMedia?.mime_type ||
      ""
  ).trim();

  const mediaType = inferKindFromMeta(
    String(meta.mediaType || m.messageType || ""),
    mimeType,
    rawUrl,
    fileName
  );

  const sizeBytes =
    typeof meta.sizeBytes === "number" && meta.sizeBytes > 0
      ? meta.sizeBytes
      : null;

  const downloadUrl = rawUrl.startsWith("/api/media/")
    ? `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}download=1&filename=${encodeURIComponent(
        fileName
      )}`
    : rawUrl;

  return {
    mediaType,
    url: rawUrl,
    downloadUrl,
    fileName,
    mimeType,
    sizeBytes,
    productName:
      typeof meta.productName === "string" && meta.productName
        ? meta.productName
        : null,
    variantName:
      typeof meta.variantName === "string" && meta.variantName
        ? meta.variantName
        : null,
  };
}

function getFileExtensionBadge(fileName: string, mimeType: string): string {
  const extMatch = fileName.match(/\.([a-z0-9]{2,6})$/i);
  if (extMatch) return extMatch[1].toUpperCase();
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("word")) return "DOC";
  if (mimeType.includes("sheet") || mimeType.includes("excel")) return "XLS";
  if (mimeType.includes("zip")) return "ZIP";
  return "FILE";
}

export function describeAttachmentType(
  fileName: string,
  mimeType: string,
  mediaType: MediaAttachmentKind
): string {
  const m = mimeType.toLowerCase();
  const extMatch = fileName.match(/\.([a-z0-9]{2,6})$/i);
  const ext = extMatch ? extMatch[1].toUpperCase() : "";
  if (m.includes("pdf") || ext === "PDF") return "PDF Document (.pdf)";
  if (m.includes("wordprocessingml") || ext === "DOCX") return "Word Document (.docx)";
  if (m.includes("msword") || ext === "DOC") return "Word Document (.doc)";
  if (m.includes("spreadsheetml") || ext === "XLSX") return "Excel Spreadsheet (.xlsx)";
  if (m.includes("ms-excel") || ext === "XLS") return "Excel Spreadsheet (.xls)";
  if (ext === "CSV" || m.includes("csv")) return "CSV Spreadsheet (.csv)";
  if (ext === "CAD" || ext === "DXF" || ext === "CDR" || ext === "AI") {
    return `Design / CAD File (.${ext.toLowerCase()})`;
  }
  if (ext === "ZIP" || m.includes("zip")) return "ZIP Archive (.zip)";
  if (mediaType === "IMAGE") return `Image${ext ? ` (.${ext.toLowerCase()})` : ""}`;
  if (mediaType === "VIDEO") return `Video${ext ? ` (.${ext.toLowerCase()})` : ""}`;
  if (mediaType === "AUDIO") return `Audio${ext ? ` (.${ext.toLowerCase()})` : ""}`;
  return ext ? `${ext} Document` : "Document File";
}

export interface PreSendFileConfirmationTarget {
  mode: "UPLOAD" | "SEND";
  file?: File;
  staged?: StagedComposerAttachment;
  fileName: string;
  fileTypeLabel: string;
  mimeType: string;
  sizeBytes?: number | null;
  mediaType: MediaAttachmentKind;
  previewUrl?: string | null;
  recipientName: string;
  recipientPhone?: string;
  captionPreview?: string;
}

export function PreSendFileConfirmModal({
  target,
  busy = false,
  onCancel,
  onConfirmUploadAttach,
  onConfirmUploadAndSend,
  onConfirmSend,
}: {
  target: PreSendFileConfirmationTarget | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirmUploadAttach?: () => void;
  onConfirmUploadAndSend?: () => void;
  onConfirmSend?: () => void;
}) {
  if (!target || typeof document === "undefined") return null;

  const badge = getFileExtensionBadge(target.fileName, target.mimeType);
  const sizeLabel = formatFileSize(target.sizeBytes) || "Catalog / External file";
  const isDocLike = target.mediaType === "DOCUMENT";

  return createPortal(
    <div
      onClick={() => {
        if (!busy) onCancel();
      }}
      className="fixed inset-0 z-[1050] bg-slate-900/60 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="presend-file-confirm-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[92dvh] bg-white rounded-t-2xl sm:rounded-2xl border border-neutral-200 shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-neutral-200 bg-[#f0f2f5] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3
                id="presend-file-confirm-title"
                className="text-sm font-semibold text-neutral-900 truncate"
              >
                {target.mode === "UPLOAD"
                  ? "Confirm File Before Uploading"
                  : "Confirm File Before Sending"}
              </h3>
              <p className="text-[11px] text-neutral-500 truncate">
                Verify details for {target.recipientName}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="p-1.5 rounded-md text-neutral-500 hover:bg-neutral-200/70 cursor-pointer disabled:opacity-40 shrink-0"
            aria-label="Cancel file confirmation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
          {/* Preview Banner */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
            {target.mediaType === "IMAGE" && target.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={target.previewUrl}
                alt={target.fileName}
                className="w-14 h-14 rounded-lg object-cover border border-neutral-200 bg-white shrink-0"
              />
            ) : target.mediaType === "VIDEO" ? (
              <div className="w-14 h-14 rounded-lg bg-neutral-900 text-white flex items-center justify-center shrink-0">
                <Film className="w-6 h-6 text-emerald-400" />
              </div>
            ) : (
              <div
                className={`w-14 h-14 rounded-lg flex flex-col items-center justify-center shrink-0 font-bold text-[10px] ${
                  badge === "PDF"
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : "bg-emerald-50 text-[#008069] border border-emerald-200"
                }`}
              >
                {badge === "XLS" || badge === "CSV" ? (
                  <FileSpreadsheet className="w-5 h-5 mb-0.5" />
                ) : (
                  <FileText className="w-5 h-5 mb-0.5" />
                )}
                <span>{badge}</span>
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#008069]">
                {target.fileTypeLabel}
              </div>
              <div className="text-xs font-bold text-slate-900 break-all [overflow-wrap:anywhere]">
                {target.fileName}
              </div>
              <div className="text-[11px] text-slate-500">
                {sizeLabel}
              </div>
            </div>
          </div>

          {/* Mandatory Verification Fields */}
          <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100 bg-white">
            <div className="px-3 py-2 flex items-start justify-between gap-3">
              <span className="text-neutral-500 font-medium shrink-0">Recipient</span>
              <span className="text-right font-semibold text-neutral-900 min-w-0 [overflow-wrap:anywhere]">
                {target.recipientName}
                {target.recipientPhone ? ` (${target.recipientPhone})` : ""}
              </span>
            </div>
            <div className="px-3 py-2 flex items-start justify-between gap-3">
              <span className="text-neutral-500 font-medium shrink-0">Filename</span>
              <span className="text-right font-mono text-[11.5px] font-semibold text-neutral-900 min-w-0 break-all [overflow-wrap:anywhere]">
                {target.fileName}
              </span>
            </div>
            <div className="px-3 py-2 flex items-start justify-between gap-3">
              <span className="text-neutral-500 font-medium shrink-0">File Type</span>
              <span className="text-right font-medium text-neutral-800 min-w-0 [overflow-wrap:anywhere]">
                {target.fileTypeLabel}
                {target.mimeType ? ` • ${target.mimeType}` : ""}
              </span>
            </div>
            <div className="px-3 py-2 flex items-start justify-between gap-3">
              <span className="text-neutral-500 font-medium shrink-0">File Size</span>
              <span className="text-right font-semibold text-neutral-900 tabular-nums">
                {sizeLabel}
              </span>
            </div>
            {target.captionPreview && (
              <div className="px-3 py-2 flex items-start justify-between gap-3">
                <span className="text-neutral-500 font-medium shrink-0">Caption</span>
                <span className="text-right text-neutral-700 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {target.captionPreview}
                </span>
              </div>
            )}
          </div>

          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11.5px] text-amber-900 leading-relaxed">
            {isDocLike
              ? "Please check the document filename and customer name. Once sent on WhatsApp, documents cannot be edited or deleted for everyone."
              : "Check the file name and customer above before continuing."}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-neutral-200 bg-neutral-50 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="w-full sm:w-auto px-3.5 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 text-xs font-semibold text-neutral-700 cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          {target.mode === "UPLOAD" ? (
            <>
              {onConfirmUploadAttach && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onConfirmUploadAttach}
                  className="w-full sm:w-auto px-3.5 py-2 rounded-lg border border-[#00a884] bg-white hover:bg-[#e7fce3] text-[#008069] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Upload & Attach</span>
                </button>
              )}
              {onConfirmUploadAndSend && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onConfirmUploadAndSend}
                  className="w-full sm:w-auto px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Upload & Send to Customer</span>
                </button>
              )}
            </>
          ) : (
            onConfirmSend && (
              <button
                type="button"
                disabled={busy}
                onClick={onConfirmSend}
                className="w-full sm:w-auto px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm & Send to Customer</span>
              </button>
            )
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

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

  // DOCUMENT (PDF, Office, CAD, ZIP, etc.)
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

export function MediaPreviewLightbox({
  media,
  onClose,
}: {
  media: NormalizedMessageMedia | null;
  onClose: () => void;
}) {
  if (!media || typeof document === "undefined") return null;

  const badge = getFileExtensionBadge(media.fileName, media.mimeType);
  const isPdf =
    media.mediaType === "DOCUMENT" &&
    (badge === "PDF" || media.mimeType.includes("pdf") || /\.pdf(\?|$)/i.test(media.url));

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-xs flex flex-col items-center justify-center p-2 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl bg-white rounded-xl overflow-hidden shadow-2xl border border-neutral-200 flex flex-col max-h-[92dvh]"
      >
        <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-neutral-900 text-white flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs sm:text-sm font-semibold truncate">
              {media.productName || media.fileName}
              {media.variantName ? ` (${media.variantName} variant)` : ""}
            </div>
            <div className="text-[11px] text-neutral-400 truncate">
              {media.fileName}
              {media.sizeBytes ? ` • ${formatFileSize(media.sizeBytes)}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <a
              href={media.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Open in Tab</span>
            </a>
            <a
              href={media.downloadUrl}
              download={media.fileName}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              aria-label="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-neutral-100 flex items-center justify-center p-2.5 sm:p-4 min-h-[220px] sm:min-h-[360px]">
          {media.mediaType === "IMAGE" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={media.url}
              alt={media.fileName}
              className="max-w-full max-h-[70dvh] sm:max-h-[76vh] object-contain rounded-lg bg-white shadow"
            />
          ) : media.mediaType === "VIDEO" ? (
            <video
              src={media.url}
              controls
              autoPlay
              className="max-w-full max-h-[70dvh] sm:max-h-[76vh] rounded-lg bg-black shadow"
            />
          ) : media.mediaType === "AUDIO" ? (
            <div className="p-5 sm:p-8 bg-white rounded-xl shadow text-center space-y-3 w-full max-w-md">
              <Music className="w-10 h-10 text-[#00a884] mx-auto" />
              <div className="text-sm font-semibold text-neutral-900 break-all">
                {media.fileName}
              </div>
              <audio src={media.url} controls autoPlay className="w-full" />
            </div>
          ) : isPdf ? (
            <iframe
              src={media.url}
              title={media.fileName}
              className="w-full h-[65dvh] sm:h-[76vh] rounded-lg bg-white border border-neutral-200"
            />
          ) : (
            <div className="p-5 sm:p-8 bg-white rounded-xl shadow text-center space-y-3 w-full max-w-md">
              <FileText className="w-12 h-12 text-[#008069] mx-auto" />
              <div className="text-sm font-semibold text-neutral-900 break-all">
                {media.fileName}
              </div>
              <p className="text-xs text-neutral-600">
                This file type ({badge}) can be downloaded or opened directly.
              </p>
              <a
                href={media.downloadUrl}
                download={media.fileName}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold max-w-full"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span className="truncate">Download {media.fileName}</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
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

interface CatalogMediaProduct {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  brandLabel: string;
  categoryName: string;
  basePrice: number | null;
  shortUrl: string;
  mainImage: string | null;
  images: string[];
  variants: {
    id: string;
    name: string;
    price: number | null;
    imageUrl: string | null;
  }[];
  videoUrl: string | null;
}

interface CatalogMediaResource {
  title: string;
  url: string;
  fileName: string;
  brandLabel: string;
}

export function AttachmentPickerPopover({
  open,
  recipientName = "Customer",
  recipientPhone = "",
  onClose,
  onStageAttachment,
  onSendUploadedAttachment,
  onShowToast,
}: {
  open: boolean;
  recipientName?: string;
  recipientPhone?: string;
  onClose: () => void;
  onStageAttachment: (att: StagedComposerAttachment) => void;
  onSendUploadedAttachment?: (att: StagedComposerAttachment) => Promise<void> | void;
  onShowToast: (msg: string) => void;
}) {
  const [tab, setTab] = useState<"UPLOAD" | "CATALOG">("UPLOAD");
  const [uploading, setUploading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [products, setProducts] = useState<CatalogMediaProduct[]>([]);
  const [resources, setResources] = useState<CatalogMediaResource[]>([]);
  const [pendingConfirm, setPendingConfirm] =
    useState<PreSendFileConfirmationTarget | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || tab !== "CATALOG") return;
    let cancelled = false;
    setCatalogLoading(true);
    fetch(`/api/media/library?q=${encodeURIComponent(searchQuery.trim())}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok) {
          setProducts(Array.isArray(data.products) ? data.products : []);
          setResources(Array.isArray(data.resources) ? data.resources : []);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, searchQuery]);

  if (!open) return null;

  function openPreUploadConfirmation(file: File | null | undefined) {
    if (!file) return;
    const mediaType = inferKindFromMeta("", file.type || "", "", file.name);
    const previewUrl =
      mediaType === "IMAGE" && typeof URL !== "undefined"
        ? URL.createObjectURL(file)
        : null;
    setPendingConfirm({
      mode: "UPLOAD",
      file,
      fileName: file.name,
      fileTypeLabel: describeAttachmentType(file.name, file.type || "", mediaType),
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      mediaType,
      previewUrl,
      recipientName,
      recipientPhone,
    });
  }

  function closePendingConfirm() {
    if (pendingConfirm?.previewUrl && pendingConfirm.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(pendingConfirm.previewUrl);
    }
    setPendingConfirm(null);
  }

  async function executeConfirmedUpload(sendImmediately: boolean) {
    const file = pendingConfirm?.file;
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/media/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok || !data?.attachment) {
        onShowToast(data?.error || "Failed to upload file.");
        return;
      }
      const stagedAtt: StagedComposerAttachment = {
        mediaId: data.attachment.mediaId,
        waMediaId: data.attachment.waMediaId,
        mediaType: data.attachment.mediaType,
        url: data.attachment.url,
        fileName: data.attachment.fileName,
        mimeType: data.attachment.mimeType,
        sizeBytes: data.attachment.sizeBytes,
      };
      closePendingConfirm();
      if (sendImmediately && onSendUploadedAttachment) {
        await onSendUploadedAttachment(stagedAtt);
        onClose();
      } else {
        onStageAttachment(stagedAtt);
        onShowToast(`Attached ${data.attachment.fileName}`);
        onClose();
      }
    } catch {
      onShowToast("Network error while uploading file.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="absolute bottom-full left-2 right-2 sm:left-4 sm:right-4 mb-1.5 z-30 rounded-xl bg-white border border-[#d1d7db] shadow-2xl p-3 sm:p-3.5 space-y-3 max-w-3xl max-h-[70dvh] overflow-y-auto">
      <PreSendFileConfirmModal
        target={pendingConfirm}
        busy={uploading}
        onCancel={closePendingConfirm}
        onConfirmUploadAttach={() => void executeConfirmedUpload(false)}
        onConfirmUploadAndSend={
          onSendUploadedAttachment ? () => void executeConfirmedUpload(true) : undefined
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f0f2f5] pb-2">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => setTab("UPLOAD")}
            className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
              tab === "UPLOAD"
                ? "bg-[#00a884] text-white"
                : "bg-[#f0f2f5] text-[#54656f] hover:text-[#111b21]"
            }`}
          >
            <Upload className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Upload File (Image, Video, PDF, CAD, Doc)</span>
            <span className="sm:hidden">Upload File</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("CATALOG")}
            className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
              tab === "CATALOG"
                ? "bg-[#00a884] text-white"
                : "bg-[#f0f2f5] text-[#54656f] hover:text-[#111b21]"
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Catalog Photos, Variants & PDF Brochures</span>
            <span className="sm:hidden">Catalog Media</span>
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-neutral-100 text-[#667781] cursor-pointer shrink-0"
          aria-label="Close attachment picker"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {tab === "UPLOAD" ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer?.files?.[0];
            if (f) openPreUploadConfirmation(f);
          }}
          className="border-2 border-dashed border-[#00a884]/45 hover:border-[#00a884] rounded-xl p-4 sm:p-6 text-center bg-[#f8fbf9] transition"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip,.cdr,.dxf,.ai"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openPreUploadConfirmation(f);
              e.target.value = "";
            }}
          />
          <div className="flex justify-center gap-2 mb-2 text-[#008069]">
            <ImageIcon className="w-6 h-6" />
            <Film className="w-6 h-6" />
            <FileText className="w-6 h-6" />
          </div>
          <div className="text-xs font-semibold text-[#111b21]">
            Drag and drop any Image, Video, PDF, Quotation, or CAD/Design file here
          </div>
          <p className="text-[11px] text-[#667781] mt-1">
            Supports JPG, PNG, WEBP, MP4, MOV, PDF, DOCX, XLSX, CSV, DXF, CDR, ZIP (up to 64 MB)
          </p>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Uploading...</span>
              </>
            ) : (
              <>
                <Paperclip className="w-3.5 h-3.5" />
                <span>Choose File from Device</span>
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#667781] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search product (e.g. CCP054, CCP111, Chair), variant colour, or PDF catalogue..."
              className="w-full rounded-lg border border-[#d1d7db] pl-8 pr-3 py-1.5 text-xs text-[#111b21] focus:outline-none focus:border-[#00a884]"
            />
          </div>

          <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
            {catalogLoading && (
              <div className="py-6 text-center text-xs text-[#667781] flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-[#00a884]" />
                <span>Loading catalog media & PDF brochures...</span>
              </div>
            )}

            {!catalogLoading && resources.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#54656f]">
                  Official PDF Catalogues & Brochures ({resources.length})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {resources.map((res) => (
                    <button
                      key={res.url}
                      type="button"
                      onClick={() => {
                        onStageAttachment({
                          mediaType: "DOCUMENT",
                          url: res.url,
                          fileName: res.fileName,
                          mimeType: "application/pdf",
                          productName: res.title,
                          suggestedCaption: `*${res.title}* (${res.brandLabel})`,
                        });
                        onClose();
                      }}
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
            )}

            {!catalogLoading && products.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#54656f]">
                  Product & Variant Photos ({products.length})
                </div>
                {products.map((prod) => {
                  const priceLabel =
                    typeof prod.basePrice === "number" && prod.basePrice > 0
                      ? `₹${prod.basePrice.toLocaleString("en-IN")}`
                      : "";
                  return (
                    <div
                      key={prod.id}
                      className="rounded-lg border border-[#e2e8f0] p-2.5 bg-[#f8fafc] space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-[#111b21]">
                            {prod.name}
                          </span>
                          {priceLabel && (
                            <span className="ml-1.5 text-xs font-semibold text-[#008069]">
                              ({priceLabel})
                            </span>
                          )}
                          <span className="ml-2 text-[11px] text-[#667781]">
                            {prod.categoryName}
                          </span>
                        </div>
                        {prod.mainImage && (
                          <button
                            type="button"
                            onClick={() => {
                              onStageAttachment({
                                mediaType: "IMAGE",
                                url: prod.mainImage!,
                                fileName: `${prod.slug}.jpg`,
                                mimeType: "image/jpeg",
                                productName: prod.name,
                                suggestedCaption: `*${prod.name}*${priceLabel ? ` (${priceLabel})` : ""}\n${prod.shortUrl}`,
                              });
                              onClose();
                            }}
                            className="px-2.5 py-1 rounded bg-[#00a884] hover:bg-[#008f6f] text-white text-[11px] font-semibold cursor-pointer shrink-0"
                          >
                            Attach Main Photo
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {prod.variants.map((v) => {
                          const vPrice =
                            typeof v.price === "number" && v.price > 0
                              ? `₹${v.price.toLocaleString("en-IN")}`
                              : priceLabel;
                          return (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => {
                                if (!v.imageUrl) return;
                                onStageAttachment({
                                  mediaType: "IMAGE",
                                  url: v.imageUrl,
                                  fileName: `${prod.slug}-${v.name
                                    .toLowerCase()
                                    .replace(/\s+/g, "-")}.jpg`,
                                  mimeType: "image/jpeg",
                                  productName: prod.name,
                                  variantName: v.name,
                                  suggestedCaption: `*${prod.name}* - *${v.name}* variant${vPrice ? ` (${vPrice})` : ""}\n${prod.shortUrl}`,
                                });
                                onClose();
                              }}
                              className="inline-flex items-center gap-1.5 p-1 pr-2.5 rounded-md bg-white border border-[#d1d7db] hover:border-[#00a884] text-left cursor-pointer transition"
                              title={`Attach ${v.name} variant photo`}
                            >
                              {v.imageUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={v.imageUrl}
                                  alt={v.name}
                                  className="w-8 h-8 rounded object-cover border border-neutral-200 bg-white shrink-0"
                                />
                              )}
                              <div>
                                <div className="text-[11px] font-semibold text-[#111b21]">
                                  {v.name}
                                </div>
                                {vPrice && (
                                  <div className="text-[10px] text-[#008069]">
                                    {vPrice}
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })}

                        {prod.images.slice(1, 5).map((imgUrl, idx) => (
                          <button
                            key={imgUrl}
                            type="button"
                            onClick={() => {
                              onStageAttachment({
                                mediaType: "IMAGE",
                                url: imgUrl,
                                fileName: `${prod.slug}-photo-${idx + 2}.jpg`,
                                mimeType: "image/jpeg",
                                productName: prod.name,
                                suggestedCaption: `*${prod.name}* (Photo ${idx + 2})\n${prod.shortUrl}`,
                              });
                              onClose();
                            }}
                            className="inline-flex items-center gap-1.5 p-1 pr-2 rounded-md bg-white border border-[#d1d7db] hover:border-[#00a884] text-[11px] text-[#54656f] cursor-pointer"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={imgUrl}
                              alt={`Photo ${idx + 2}`}
                              className="w-8 h-8 rounded object-cover border border-neutral-200 bg-white"
                            />
                            <span>Photo {idx + 2}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
