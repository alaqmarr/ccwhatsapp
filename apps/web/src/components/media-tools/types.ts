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

export interface CatalogMediaProduct {
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

export interface CatalogMediaResource {
  title: string;
  url: string;
  fileName: string;
  brandLabel: string;
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function inferKindFromMeta(
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

export function extractMessageMedia(
  m: ChatMessage
): NormalizedMessageMedia | null {
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

export function getFileExtensionBadge(
  fileName: string,
  mimeType: string
): string {
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
  if (m.includes("wordprocessingml") || ext === "DOCX")
    return "Word Document (.docx)";
  if (m.includes("msword") || ext === "DOC") return "Word Document (.doc)";
  if (m.includes("spreadsheetml") || ext === "XLSX")
    return "Excel Spreadsheet (.xlsx)";
  if (m.includes("ms-excel") || ext === "XLS")
    return "Excel Spreadsheet (.xls)";
  if (ext === "CSV" || m.includes("csv")) return "CSV Spreadsheet (.csv)";
  if (ext === "CAD" || ext === "DXF" || ext === "CDR" || ext === "AI") {
    return `Design / CAD File (.${ext.toLowerCase()})`;
  }
  if (ext === "ZIP" || m.includes("zip")) return "ZIP Archive (.zip)";
  if (mediaType === "IMAGE")
    return `Image${ext ? ` (.${ext.toLowerCase()})` : ""}`;
  if (mediaType === "VIDEO")
    return `Video${ext ? ` (.${ext.toLowerCase()})` : ""}`;
  if (mediaType === "AUDIO")
    return `Audio${ext ? ` (.${ext.toLowerCase()})` : ""}`;
  return ext ? `${ext} Document` : "Document File";
}
