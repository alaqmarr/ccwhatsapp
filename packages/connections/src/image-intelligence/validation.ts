import crypto from "node:crypto";
import path from "node:path";
import type {
  CustomerImageAttachmentInput,
  ImageValidationResult,
  SupportedVisionMimeType,
} from "./types";

export function getMaxAcrioImageBytes(): number {
  const configured = Number(process.env.ACRIO_MAX_IMAGE_BYTES || 5 * 1024 * 1024);
  if (!Number.isFinite(configured) || configured <= 0) {
    return 5 * 1024 * 1024;
  }
  return Math.min(5 * 1024 * 1024, Math.max(1024, Math.floor(configured)));
}

export const ALLOWED_VISION_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const ALLOWED_META_CDN_SUFFIXES = [
  ".fbsbx.com",
  ".facebook.com",
  ".fbcdn.net",
  ".whatsapp.net",
];

const INJECTION_LINE_RE =
  /\b(ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?|reveal\s+(?:your\s+)?(?:system\s*prompt|api\s*key|secret|password|token)|you\s+are\s+now|override\s+(?:all\s+)?rules?|system\s*override|execute\s+command|drop\s+table|sk-ant-)\b/gi;

export function sanitizeImageFilename(raw?: string | null): string {
  const base = path.basename(String(raw || "image").trim() || "image");
  const clean = base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  return (clean || "image").slice(0, 120);
}

export function isValidWhatsAppMediaId(mediaId?: string | null): boolean {
  const id = String(mediaId || "").trim();
  if (!id || id.length > 180) return false;
  if (
    id.includes("..") ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("?") ||
    id.includes("#") ||
    /[\s\r\n]/.test(id)
  ) {
    return false;
  }
  return /^[a-zA-Z0-9._:-]+$/.test(id);
}

export function isAllowedMetaCdnUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (!host || host === "localhost" || /^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)) {
      return false;
    }
    return ALLOWED_META_CDN_SUFFIXES.some(
      (suffix) => host === suffix.slice(1) || host.endsWith(suffix)
    );
  } catch {
    return false;
  }
}

/**
 * Inspects binary magic bytes to detect the true image format and prevent
 * spoofed MIME types (e.g. HTML/JS/EXE/SVG uploaded as `.jpg`).
 */
export function detectImageSignatureMimeType(
  buf: Buffer | Uint8Array
): SupportedVisionMimeType | null {
  if (!buf || buf.byteLength < 12) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);

  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP: RIFF....WEBP
  if (
    b.subarray(0, 4).toString("ascii") === "RIFF" &&
    b.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  // GIF: GIF87a / GIF89a
  const hdr6 = b.subarray(0, 6).toString("ascii");
  if (hdr6 === "GIF87a" || hdr6 === "GIF89a") {
    return "image/gif";
  }
  return null;
}

export function validateCustomerImageBuffer(params: {
  buffer: Buffer | Uint8Array;
  declaredMimeType?: string | null;
  filename?: string | null;
  maxBytes?: number;
}): ImageValidationResult {
  const maxBytes = params.maxBytes ?? getMaxAcrioImageBytes();
  const safeFileName = sanitizeImageFilename(params.filename);
  const rawBuf = Buffer.isBuffer(params.buffer)
    ? params.buffer
    : Buffer.from(params.buffer);

  if (rawBuf.byteLength > maxBytes) {
    return {
      ok: false,
      safeFileName,
      byteLength: rawBuf.byteLength,
      errorCode: "OVERSIZED_IMAGE",
      errorMessage: `Image exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
    };
  }

  if (rawBuf.byteLength < 32) {
    return {
      ok: false,
      safeFileName,
      byteLength: rawBuf.byteLength,
      errorCode: "EMPTY_OR_CORRUPT",
      errorMessage: "Image file is empty or corrupted.",
    };
  }

  const declared = String(params.declaredMimeType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (declared && !ALLOWED_VISION_MIME_TYPES.has(declared)) {
    return {
      ok: false,
      safeFileName,
      byteLength: rawBuf.byteLength,
      errorCode: "INVALID_IMAGE_TYPE",
      errorMessage: `Unsupported image format "${declared}". Please send a JPG, PNG, or WebP photo.`,
    };
  }

  const sigMime = detectImageSignatureMimeType(rawBuf);
  if (!sigMime) {
    return {
      ok: false,
      safeFileName,
      byteLength: rawBuf.byteLength,
      errorCode: "INVALID_IMAGE_SIGNATURE",
      errorMessage:
        "File content does not match a valid JPG, PNG, WebP, or GIF image signature.",
    };
  }

  const sha256 = crypto.createHash("sha256").update(rawBuf).digest("hex");
  return {
    ok: true,
    mimeType: sigMime,
    buffer: rawBuf,
    base64: rawBuf.toString("base64"),
    byteLength: rawBuf.byteLength,
    sha256,
    safeFileName,
  };
}

export async function fetchAndValidateWhatsAppImage(params: {
  attachment: CustomerImageAttachmentInput;
  accessToken?: string | null;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
}): Promise<ImageValidationResult> {
  const maxBytes = params.maxBytes ?? getMaxAcrioImageBytes();
  const att = params.attachment;
  const declared = String(att.mimeType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const safeFileName = sanitizeImageFilename(att.filename);

  if (declared && !ALLOWED_VISION_MIME_TYPES.has(declared)) {
    return {
      ok: false,
      safeFileName,
      errorCode: "INVALID_IMAGE_TYPE",
      errorMessage: `Unsupported image format "${declared}". Please send a JPG, PNG, or WebP photo.`,
    };
  }

  // Test/preloaded fixture path (stays completely in memory)
  if (att.buffer) {
    return validateCustomerImageBuffer({
      buffer: att.buffer,
      declaredMimeType: declared || undefined,
      filename: safeFileName,
      maxBytes,
    });
  }

  const mediaId = String(att.mediaId || "").trim();
  if (!mediaId) {
    return {
      ok: false,
      safeFileName,
      errorCode: "MISSING_MEDIA_ID",
      errorMessage: "No WhatsApp media ID was attached.",
    };
  }
  if (!isValidWhatsAppMediaId(mediaId)) {
    return {
      ok: false,
      safeFileName,
      errorCode: "SSRF_BLOCKED",
      errorMessage: "Invalid WhatsApp media identifier.",
    };
  }

  const token = String(params.accessToken || "").trim();
  if (!token) {
    return {
      ok: false,
      safeFileName,
      errorCode: "MEDIA_FETCH_FAILED",
      errorMessage: "WhatsApp access token is not configured to download this image.",
    };
  }

  const doFetch = params.fetchImpl || fetch;
  try {
    const metaRes = await doFetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "ccwhatsapp/1.0",
        },
        signal: AbortSignal.timeout(12000),
      }
    );
    const metaJson: any = await metaRes.json().catch(() => null);
    if (!metaRes.ok || !metaJson?.url) {
      return {
        ok: false,
        safeFileName,
        errorCode: "MEDIA_FETCH_FAILED",
        errorMessage: `Meta Graph API media lookup failed (HTTP ${metaRes.status}).`,
      };
    }

    const declaredRemoteSize = Number(metaJson.file_size || 0);
    if (declaredRemoteSize > maxBytes) {
      return {
        ok: false,
        safeFileName,
        byteLength: declaredRemoteSize,
        errorCode: "OVERSIZED_IMAGE",
        errorMessage: `Image exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
      };
    }

    const remoteUrl = String(metaJson.url);
    if (!isAllowedMetaCdnUrl(remoteUrl)) {
      return {
        ok: false,
        safeFileName,
        errorCode: "SSRF_BLOCKED",
        errorMessage: "Rejected untrusted media download host.",
      };
    }

    const cdnRes = await doFetch(remoteUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "ccwhatsapp/1.0",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!cdnRes.ok) {
      return {
        ok: false,
        safeFileName,
        errorCode: "MEDIA_FETCH_FAILED",
        errorMessage: `Meta media CDN download failed (HTTP ${cdnRes.status}).`,
      };
    }

    const contentLengthHeader = Number(cdnRes.headers.get("content-length") || 0);
    if (contentLengthHeader > maxBytes) {
      return {
        ok: false,
        safeFileName,
        byteLength: contentLengthHeader,
        errorCode: "OVERSIZED_IMAGE",
        errorMessage: `Image exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
      };
    }

    // Stream with hard cap so spoofed Content-Length headers cannot cause excessive memory allocation
    const reader = cdnRes.body?.getReader();
    let downloaded: Buffer;
    if (reader) {
      const chunks: Buffer[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return {
            ok: false,
            safeFileName,
            byteLength: total,
            errorCode: "OVERSIZED_IMAGE",
            errorMessage: `Image exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
          };
        }
        chunks.push(Buffer.from(value));
      }
      downloaded = Buffer.concat(chunks);
    } else {
      const ab = await cdnRes.arrayBuffer();
      downloaded = Buffer.from(ab);
    }

    return validateCustomerImageBuffer({
      buffer: downloaded,
      declaredMimeType:
        (metaJson.mime_type ? String(metaJson.mime_type) : declared) || undefined,
      filename: safeFileName,
      maxBytes,
    });
  } catch (err: any) {
    return {
      ok: false,
      safeFileName,
      errorCode: "MEDIA_FETCH_FAILED",
      errorMessage: err?.message || "Failed to retrieve customer image safely.",
    };
  }
}

export function sanitizeVisionExtractedText(raw: string | null | undefined): {
  clean: string;
  injectionDetected: boolean;
} {
  const input = String(raw || "").trim();
  if (!input) return { clean: "", injectionDetected: false };
  const hadInjection = INJECTION_LINE_RE.test(input);
  INJECTION_LINE_RE.lastIndex = 0;
  const clean = input
    .replace(INJECTION_LINE_RE, "[filtered]")
    .replace(/[<>{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { clean, injectionDetected: hadInjection };
}
