import crypto from "node:crypto";
import { loadMetaWhatsAppSetupConfig } from "./config";
import type { WhatsAppMediaAttachmentType } from "./types";

const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function buildMinimalPdfBuffer(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n168\n%%EOF\n",
    "utf8"
  );
}

function buildMinimalMp4Buffer(): Buffer {
  return Buffer.from(
    "00000018667479706d703432000000006d70343269736f6d000000086d646174",
    "hex"
  );
}

async function resolveMetaAppIdForUpload(
  configuredAppId: string,
  accessToken: string
): Promise<string> {
  if (/^\d{8,25}$/.test(configuredAppId)) {
    return configuredAppId;
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(
        accessToken
      )}&access_token=${encodeURIComponent(accessToken)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return "";
    const json: any = await res.json().catch(() => null);
    const appId = String(json?.data?.app_id || "").trim();
    return /^\d{8,25}$/.test(appId) ? appId : "";
  } catch {
    return "";
  }
}

/**
 * Uploads a binary file (image, video, PDF, or document) to Meta's WhatsApp Cloud API
 * `/v21.0/{phoneNumberId}/media` endpoint so it can be delivered via `id` even when
 * the local server is not publicly reachable.
 */
export async function uploadMediaToMetaCloud(params: {
  buffer: Buffer | Uint8Array;
  mimeType: string;
  fileName: string;
  forceSandbox?: boolean;
}): Promise<{ ok: boolean; waMediaId?: string; mode: string; error?: string }> {
  const cfg = await loadMetaWhatsAppSetupConfig();
  const useSandbox =
    Boolean(params.forceSandbox) ||
    process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS === "1";
  const mode = useSandbox
    ? "SANDBOX_SIMULATOR"
    : String(cfg.mode || "SANDBOX_SIMULATOR");
  const phoneNumberId = String(cfg.phoneNumberId || "").trim();
  const accessToken = String(cfg.systemUserAccessToken || "").trim();

  if (mode !== "LIVE_META_CLOUD" || !phoneNumberId || !accessToken) {
    return {
      ok: true,
      waMediaId: `sim_media_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
      mode: "SANDBOX_SIMULATOR",
    };
  }

  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", params.mimeType || "application/octet-stream");
    const blob = new Blob([new Uint8Array(params.buffer)], {
      type: params.mimeType || "application/octet-stream",
    });
    form.append("file", blob, params.fileName || "attachment");

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/media`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
        signal: AbortSignal.timeout(30000),
      }
    );
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data?.id) {
      return {
        ok: false,
        mode: "LIVE_META_CLOUD",
        error: data?.error?.message || `Meta media upload HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      waMediaId: String(data.id),
      mode: "LIVE_META_CLOUD",
    };
  } catch (err: any) {
    return {
      ok: false,
      mode: "LIVE_META_CLOUD",
      error: err?.message || "Meta media upload network error",
    };
  }
}

/**
 * Takes a media file that someone SENT to the business number (identified by the inbound media id), downloads it from
 * Meta, and uploads it again under the business number so it can be forwarded to a teammate.
 * In sandbox mode no network call is made and a simulated id is returned.
 */
export async function prepareInboundMediaForForward(params: {
  mediaId: string;
  mimeType?: string;
  fileName?: string;
  kind?: WhatsAppMediaAttachmentType;
}): Promise<{ ok: boolean; waMediaId?: string; mimeType?: string; error?: string }> {
  const mediaId = String(params.mediaId || "").trim();
  if (!mediaId) return { ok: false, error: "No media id was saved for this attachment." };
  const baseMime = String(params.mimeType || "").split(";")[0].trim() || "application/octet-stream";

  const cfg = await loadMetaWhatsAppSetupConfig();
  const useSandbox = process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS === "1";
  const live = !useSandbox && String(cfg.mode || "") === "LIVE_META_CLOUD";
  const accessToken = String(cfg.systemUserAccessToken || "").trim();
  if (!live || !accessToken) {
    const sim = await uploadMediaToMetaCloud({
      buffer: new Uint8Array(0),
      mimeType: baseMime,
      fileName: params.fileName || "attachment",
      forceSandbox: true,
    });
    return { ok: sim.ok, waMediaId: sim.waMediaId, mimeType: baseMime, error: sim.error };
  }

  try {
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    const meta: any = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok || !meta?.url) {
      return { ok: false, error: `Could not find the attachment on WhatsApp (HTTP ${metaRes.status}). It may be older than 30 days.` };
    }
    const cdn = await fetch(String(meta.url), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!cdn.ok) return { ok: false, error: `Could not download the attachment (HTTP ${cdn.status}).` };
    const buffer = new Uint8Array(await cdn.arrayBuffer());
    const maxBytes = params.kind === "DOCUMENT" ? 100 * 1024 * 1024 : 16 * 1024 * 1024;
    if (buffer.byteLength > maxBytes) {
      return { ok: false, error: "The attachment is too large to forward on WhatsApp." };
    }
    const mime = String(meta.mime_type || baseMime).split(";")[0].trim() || baseMime;
    const up = await uploadMediaToMetaCloud({
      buffer,
      mimeType: mime,
      fileName: params.fileName || `attachment.${mime.split("/")[1] || "bin"}`,
    });
    return { ok: up.ok, waMediaId: up.waMediaId, mimeType: mime, error: up.error };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Attachment transfer failed." };
  }
}

export async function uploadSampleMediaForTemplateHeader(params: {
  mediaUrl: string;
  headerType: "IMAGE" | "VIDEO" | "DOCUMENT";
  accessToken: string;
  metaAppId?: string;
}): Promise<string> {
  const raw = params.mediaUrl.trim();
  if (!raw || raw.startsWith("4:")) {
    return raw;
  }

  const appId = await resolveMetaAppIdForUpload(
    String(params.metaAppId || "").trim(),
    params.accessToken
  );
  if (!appId) {
    return raw;
  }

  let fileBuf: Buffer | null = null;
  let fileType =
    params.headerType === "IMAGE"
      ? "image/png"
      : params.headerType === "DOCUMENT"
      ? "application/pdf"
      : "video/mp4";
  let fileName =
    params.headerType === "IMAGE"
      ? "sample.png"
      : params.headerType === "DOCUMENT"
      ? "sample.pdf"
      : "sample.mp4";

  if (/^https?:\/\//i.test(raw)) {
    try {
      const dl = await fetch(raw, { signal: AbortSignal.timeout(8000) });
      if (dl.ok) {
        const arr = await dl.arrayBuffer();
        if (arr.byteLength > 0 && arr.byteLength <= 15 * 1024 * 1024) {
          fileBuf = Buffer.from(arr);
          const ct = String(dl.headers.get("content-type") || "")
            .split(";")[0]
            .trim()
            .toLowerCase();
          if (params.headerType === "IMAGE") {
            if (ct === "image/jpeg" || ct === "image/jpg" || /\.jpe?g(\?|$)/i.test(raw)) {
              fileType = "image/jpeg";
              fileName = "sample.jpg";
            } else {
              fileType = "image/png";
              fileName = "sample.png";
            }
          } else if (params.headerType === "DOCUMENT") {
            fileType = "application/pdf";
            fileName = "sample.pdf";
          } else if (params.headerType === "VIDEO") {
            fileType = "video/mp4";
            fileName = "sample.mp4";
          }
        }
      }
    } catch {
      fileBuf = null;
    }
  }

  if (!fileBuf || fileBuf.length === 0) {
    if (params.headerType === "IMAGE") {
      fileBuf = Buffer.from(SAMPLE_PNG_BASE64, "base64");
      fileType = "image/png";
      fileName = "sample.png";
    } else if (params.headerType === "DOCUMENT") {
      fileBuf = buildMinimalPdfBuffer();
      fileType = "application/pdf";
      fileName = "sample.pdf";
    } else {
      fileBuf = buildMinimalMp4Buffer();
      fileType = "video/mp4";
      fileName = "sample.mp4";
    }
  }

  try {
    const sessionRes = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(
        appId
      )}/uploads?file_name=${encodeURIComponent(
        fileName
      )}&file_length=${fileBuf.length}&file_type=${encodeURIComponent(fileType)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
        },
        signal: AbortSignal.timeout(12000),
      }
    );
    const sessionJson: any = await sessionRes.json().catch(() => null);
    const sessionId = String(sessionJson?.id || "").trim();
    if (!sessionRes.ok || !sessionId) {
      return raw;
    }

    const uploadRes = await fetch(
      `https://graph.facebook.com/v21.0/${sessionId}`,
      {
        method: "POST",
        headers: {
          Authorization: `OAuth ${params.accessToken}`,
          file_offset: "0",
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(fileBuf),
        signal: AbortSignal.timeout(20000),
      }
    );
    const uploadJson: any = await uploadRes.json().catch(() => null);
    const handle = String(uploadJson?.h || "").trim();
    return uploadRes.ok && handle ? handle : raw;
  } catch {
    return raw;
  }
}
