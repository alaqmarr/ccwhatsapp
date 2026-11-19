"use client";

import React, { useEffect, useState } from "react";
import { FolderOpen, Upload, X } from "lucide-react";
import { CataloguePickerTab } from "@/components/media-tools/CataloguePickerTab";
import { CustomUploadTab } from "@/components/media-tools/CustomUploadTab";
import { PreSendFileConfirmModal } from "@/components/media-tools/MediaPreviewModal";
import {
  describeAttachmentType,
  inferKindFromMeta,
  type CatalogMediaProduct,
  type CatalogMediaResource,
  type PreSendFileConfirmationTarget,
  type StagedComposerAttachment,
} from "@/components/media-tools/types";

export type {
  MediaAttachmentKind,
  NormalizedMessageMedia,
  PreSendFileConfirmationTarget,
  StagedComposerAttachment,
} from "@/components/media-tools/types";
export {
  describeAttachmentType,
  extractMessageMedia,
} from "@/components/media-tools/types";
export {
  MediaPreviewLightbox,
  PreSendFileConfirmModal,
} from "@/components/media-tools/MediaPreviewModal";
export {
  MessageMediaRenderer,
  StagedAttachmentBar,
} from "@/components/media-tools/MessageMediaCard";

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
          onSendUploadedAttachment
            ? () => void executeConfirmedUpload(true)
            : undefined
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
            <span className="hidden sm:inline">
              Upload File (Image, Video, PDF, CAD, Doc)
            </span>
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
            <span className="hidden sm:inline">
              Catalog Photos, Variants & PDF Brochures
            </span>
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
        <CustomUploadTab
          uploading={uploading}
          onFileSelected={(f) => openPreUploadConfirmation(f)}
        />
      ) : (
        <CataloguePickerTab
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          catalogLoading={catalogLoading}
          products={products}
          resources={resources}
          onStageAndClose={(att) => {
            onStageAttachment(att);
            onClose();
          }}
        />
      )}
    </div>
  );
}
