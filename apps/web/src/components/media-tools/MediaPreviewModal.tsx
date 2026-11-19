"use client";

import React from "react";
import { createPortal } from "react-dom";
import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Film,
  Loader2,
  Music,
  X,
} from "lucide-react";
import {
  formatFileSize,
  getFileExtensionBadge,
  type NormalizedMessageMedia,
  type PreSendFileConfirmationTarget,
} from "@/components/media-tools/types";

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
  const sizeLabel =
    formatFileSize(target.sizeBytes) || "Catalog / External file";
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
              <div className="text-[11px] text-slate-500">{sizeLabel}</div>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100 bg-white">
            <div className="px-3 py-2 flex items-start justify-between gap-3">
              <span className="text-neutral-500 font-medium shrink-0">
                Recipient
              </span>
              <span className="text-right font-semibold text-neutral-900 min-w-0 [overflow-wrap:anywhere]">
                {target.recipientName}
                {target.recipientPhone ? ` (${target.recipientPhone})` : ""}
              </span>
            </div>
            <div className="px-3 py-2 flex items-start justify-between gap-3">
              <span className="text-neutral-500 font-medium shrink-0">
                Filename
              </span>
              <span className="text-right font-mono text-[11.5px] font-semibold text-neutral-900 min-w-0 break-all [overflow-wrap:anywhere]">
                {target.fileName}
              </span>
            </div>
            <div className="px-3 py-2 flex items-start justify-between gap-3">
              <span className="text-neutral-500 font-medium shrink-0">
                File Type
              </span>
              <span className="text-right font-medium text-neutral-800 min-w-0 [overflow-wrap:anywhere]">
                {target.fileTypeLabel}
                {target.mimeType ? ` • ${target.mimeType}` : ""}
              </span>
            </div>
            <div className="px-3 py-2 flex items-start justify-between gap-3">
              <span className="text-neutral-500 font-medium shrink-0">
                File Size
              </span>
              <span className="text-right font-semibold text-neutral-900 tabular-nums">
                {sizeLabel}
              </span>
            </div>
            {target.captionPreview && (
              <div className="px-3 py-2 flex items-start justify-between gap-3">
                <span className="text-neutral-500 font-medium shrink-0">
                  Caption
                </span>
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
    (badge === "PDF" ||
      media.mimeType.includes("pdf") ||
      /\.pdf(\?|$)/i.test(media.url));

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
