import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveMonorepoRoot } from "@cc/database";
import { loadMetaWhatsAppSetupConfig } from "./config";
import type { WhatsAppMediaAttachmentType } from "./types";

const execFileAsync = promisify(execFile);

const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function buildMinimalPdfBuffer(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n168\n%%EOF\n",
    "utf8"
  );
}

export const WHATSAPP_SUPPORTED_AUDIO_MIMES = new Set([
  "audio/aac",
  "audio/mp4",
  "audio/mpeg",
  "audio/amr",
  "audio/ogg",
]);

/**
 * Audio containers Meta reliably delivers via `type: "audio"` without throwing async
 * Code 131053 ("on processing it is of type application/octet-stream").
 * Notably `audio/mp4` (.m4a) is excluded because Meta's media processor routinely
 * classifies M4A containers as octet-stream unless transcoded to OGG/Opus.
 */
export const WHATSAPP_RELIABLE_NATIVE_AUDIO_MIMES = new Set([
  "audio/ogg",
  "audio/mpeg",
  "audio/amr",
  "audio/aac",
]);

const AUDIO_EXT_BY_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/webm": "webm",
  "audio/wav": "wav",
};

const EXT_BY_CANONICAL_MIME: Record<string, string> = {
  ...AUDIO_EXT_BY_MIME,
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/**
 * Detects canonical MIME type from container magic bytes across images, PDFs, video, and audio
 * so mismatched browser file extensions or `application/octet-stream` headers never trigger Code 131053.
 */
export function detectCanonicalFileMimeAndExt(
  rawMime: string,
  fileName: string,
  buffer?: Uint8Array | Buffer
): { mimeType: string; extension: string } {
  const base = String(rawMime || "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const extLower = path.extname(String(fileName || "")).toLowerCase().replace(/^\./, "");

  if (buffer && buffer.byteLength >= 4) {
    const b0 = buffer[0];
    const b1 = buffer[1];
    const b2 = buffer[2];
    const b3 = buffer[3];

    if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) {
      return { mimeType: "image/jpeg", extension: "jpg" };
    }
    if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) {
      return { mimeType: "image/png", extension: "png" };
    }
    if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38) {
      return { mimeType: "image/gif", extension: "gif" };
    }
    if (b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46) {
      return { mimeType: "application/pdf", extension: "pdf" };
    }
    if (
      buffer.byteLength >= 12 &&
      b0 === 0x52 &&
      b1 === 0x49 &&
      b2 === 0x46 &&
      b3 === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return { mimeType: "image/webp", extension: "webp" };
    }
  }

  if (base.startsWith("audio/") || ["m4a", "mp3", "ogg", "opus", "aac", "amr", "wav"].includes(extLower)) {
    const audioInfo = resolveAudioContainerMimeAndExt(base, buffer);
    return { mimeType: audioInfo.mimeType, extension: audioInfo.extension };
  }

  if (
    buffer &&
    buffer.byteLength >= 8 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    if (extLower === "m4a") {
      return { mimeType: "audio/mp4", extension: "m4a" };
    }
    return { mimeType: "video/mp4", extension: extLower === "mov" ? "mov" : "mp4" };
  }

  return {
    mimeType: base || "application/octet-stream",
    extension: EXT_BY_CANONICAL_MIME[base] || extLower || base.split("/")[1] || "bin",
  };
}

/**
 * Inspects leading container magic bytes + MIME aliases so WhatsApp Cloud `/media`
 * always receives a canonical MIME type and matching extension (e.g. `audio/ogg` without `; codecs=opus`).
 */
export function resolveAudioContainerMimeAndExt(
  rawMime: string,
  buffer?: Uint8Array | Buffer
): { mimeType: string; extension: string; supportsWhatsAppAudioType: boolean } {
  const base = String(rawMime || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  let detected = base;
  let verifiedAudioMagic = false;
  if (buffer && buffer.byteLength >= 4) {
    const b0 = buffer[0];
    const b1 = buffer[1];
    const b2 = buffer[2];
    const b3 = buffer[3];
    if (b0 === 0x4f && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) {
      detected = "audio/ogg"; // OggS
      verifiedAudioMagic = true;
    } else if (
      buffer.byteLength >= 8 &&
      buffer[4] === 0x66 &&
      buffer[5] === 0x74 &&
      buffer[6] === 0x79 &&
      buffer[7] === 0x70
    ) {
      detected = "audio/mp4"; // ....ftyp (M4A/MP4)
      verifiedAudioMagic = true;
    } else if (
      (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) || // ID3
      (b0 === 0xff && (b1 === 0xfb || b1 === 0xf3 || b1 === 0xf2))
    ) {
      detected = "audio/mpeg";
      verifiedAudioMagic = true;
    } else if (b0 === 0x23 && b1 === 0x21 && b2 === 0x41 && b3 === 0x4d) {
      detected = "audio/amr"; // #!AM(R)
      verifiedAudioMagic = true;
    } else if (b0 === 0x1a && b1 === 0x45 && b2 === 0xdf && b3 === 0xa3) {
      detected = "audio/webm"; // EBML/WebM
      verifiedAudioMagic = true;
    } else if (
      buffer.byteLength >= 12 &&
      b0 === 0x52 &&
      b1 === 0x49 &&
      b2 === 0x46 &&
      b3 === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x41 &&
      buffer[10] === 0x56 &&
      buffer[11] === 0x45
    ) {
      detected = "audio/wav";
      verifiedAudioMagic = true;
    } else if (b0 === 0xff && (b1 & 0xf6) === 0xf0) {
      detected = "audio/aac"; // ADTS AAC frame
      verifiedAudioMagic = true;
    }
  }

  if (detected === "audio/opus") detected = "audio/ogg";
  if (detected === "audio/mp3" || detected === "audio/x-mpeg") detected = "audio/mpeg";
  if (detected === "audio/x-m4a" || detected === "audio/m4a") detected = "audio/mp4";
  if (detected === "audio/x-aac") detected = "audio/aac";
  if (detected === "audio/wave" || detected === "audio/x-wav") detected = "audio/wav";

  const finalMime = detected || "audio/ogg";
  const ext = AUDIO_EXT_BY_MIME[finalMime] || finalMime.split("/")[1] || "bin";
  const hasBufferToVerify = Boolean(buffer && buffer.byteLength > 0);
  const supportsWhatsAppAudioType =
    WHATSAPP_RELIABLE_NATIVE_AUDIO_MIMES.has(finalMime) &&
    (!hasBufferToVerify || verifiedAudioMagic);

  return {
    mimeType: finalMime,
    extension: ext,
    supportsWhatsAppAudioType,
  };
}

let cachedFfmpegBinary: string | null | undefined;
async function resolveFfmpegBinary(): Promise<string | null> {
  if (cachedFfmpegBinary !== undefined) return cachedFfmpegBinary;
  const candidate = String(process.env.FFMPEG_PATH || "ffmpeg").trim();
  try {
    await execFileAsync(candidate, ["-version"], { timeout: 2500 });
    cachedFfmpegBinary = candidate;
  } catch {
    cachedFfmpegBinary = null;
  }
  return cachedFfmpegBinary;
}

/**
 * Optionally transcodes non-native audio (e.g. .m4a, .webm, .wav) to OGG/Opus when ffmpeg is available
 * on the server host, preventing Meta Code 131053 rejections. Falls back cleanly to null if unavailable.
 */
export async function tryTranscodeAudioToOgg(
  buffer: Uint8Array | Buffer,
  inputExt = "m4a"
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!buffer || buffer.byteLength === 0) return null;
  const bin = await resolveFfmpegBinary();
  if (!bin) return null;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccwa-aud-"));
  const safeExt = (inputExt || "m4a").replace(/[^a-z0-9]/gi, "") || "m4a";
  const inPath = path.join(tmpDir, `input.${safeExt}`);
  const outPath = path.join(tmpDir, "output.ogg");
  try {
    await fs.writeFile(inPath, buffer);
    await execFileAsync(
      bin,
      ["-y", "-i", inPath, "-vn", "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", outPath],
      { timeout: 10_000 }
    );
    const outBuf = await fs.readFile(outPath);
    if (outBuf.byteLength >= 4 && outBuf[0] === 0x4f && outBuf[1] === 0x67 && outBuf[2] === 0x67 && outBuf[3] === 0x53) {
      const ab = new ArrayBuffer(outBuf.byteLength);
      new Uint8Array(ab).set(outBuf);
      return new Uint8Array(ab);
    }
    return null;
  } catch {
    return null;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
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
    let rawBuf: Uint8Array<ArrayBuffer> = new Uint8Array(
      params.buffer.byteLength
    );
    rawBuf.set(
      params.buffer instanceof Uint8Array
        ? params.buffer
        : new Uint8Array(params.buffer)
    );
    const detected = detectCanonicalFileMimeAndExt(
      params.mimeType,
      params.fileName,
      rawBuf
    );
    let uploadMime = detected.mimeType || "application/octet-stream";
    let audioInfo = uploadMime.startsWith("audio/")
      ? resolveAudioContainerMimeAndExt(uploadMime, rawBuf)
      : null;

    if (audioInfo && !audioInfo.supportsWhatsAppAudioType && rawBuf.byteLength > 0) {
      const transcoded = await tryTranscodeAudioToOgg(rawBuf, audioInfo.extension);
      if (transcoded) {
        rawBuf = transcoded;
        uploadMime = "audio/ogg";
        audioInfo = resolveAudioContainerMimeAndExt("audio/ogg", rawBuf);
      }
    } else if (audioInfo) {
      uploadMime = audioInfo.mimeType;
    }

    let uploadName = String(params.fileName || "").trim();
    const expectedExt = audioInfo ? audioInfo.extension : detected.extension;
    if (!uploadName) {
      uploadName = audioInfo
        ? `voice-note.${expectedExt}`
        : `attachment.${expectedExt || "bin"}`;
    } else if (expectedExt && !uploadName.includes(".")) {
      uploadName = `${uploadName}.${expectedExt}`;
    } else if (
      audioInfo?.mimeType === "audio/ogg" &&
      !/\.(?:ogg|opus)$/i.test(uploadName)
    ) {
      uploadName = `${uploadName.replace(/\.[^.]+$/, "")}.ogg`;
    }

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", uploadMime);
    const blob = new Blob([rawBuf], {
      type: uploadMime,
    });
    form.append("file", blob, uploadName);

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

const VAULT_MAX_PERSIST_BYTES = 64 * 1024 * 1024;

function resolveVaultUploadPaths(mediaId: string): {
  uploadsDir: string;
  localMetaPath: string;
} {
  const dataDir = process.env.DATABASE_DATA_DIR?.trim();
  const uploadsDir = dataDir
    ? path.join(path.resolve(dataDir), "uploads")
    : path.join(resolveMonorepoRoot(), "data", "uploads");
  const safeId = String(mediaId || "").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const localMetaPath = path.join(uploadsDir, `${safeId}.json`);
  return { uploadsDir, localMetaPath };
}

async function readLocalCachedMedia(mediaId: string): Promise<{
  buffer: Uint8Array;
  fileName: string;
  mimeType: string;
} | null> {
  if (!mediaId) return null;
  try {
    const { uploadsDir, localMetaPath } = resolveVaultUploadPaths(mediaId);
    const metaRaw = await fs.readFile(localMetaPath, "utf8");
    const meta = JSON.parse(metaRaw) as {
      fileName?: string;
      storedFileName?: string;
      mimeType?: string;
    };
    if (!meta.storedFileName) return null;
    const buf = await fs.readFile(path.join(uploadsDir, meta.storedFileName));
    if (buf.byteLength === 0) return null;
    return {
      buffer: new Uint8Array(buf),
      fileName: meta.fileName || mediaId,
      mimeType: meta.mimeType || "application/octet-stream",
    };
  } catch {
    return null;
  }
}

async function writeLocalCachedMedia(params: {
  mediaId: string;
  fileName: string;
  mimeType: string;
  buffer: Uint8Array;
  customerPhone?: string;
  sourceLabel?: string;
}): Promise<void> {
  if (
    !params.mediaId ||
    params.buffer.byteLength === 0 ||
    params.buffer.byteLength > VAULT_MAX_PERSIST_BYTES
  ) {
    return;
  }
  try {
    const { uploadsDir, localMetaPath } = resolveVaultUploadPaths(params.mediaId);
    await fs.mkdir(uploadsDir, { recursive: true });
    let existingMeta: Record<string, unknown> = {};
    try {
      existingMeta = JSON.parse(await fs.readFile(localMetaPath, "utf8"));
    } catch {
      existingMeta = {};
    }
    const cleanName = (params.fileName || params.mediaId)
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 120);
    const storedFileName = String(
      existingMeta.storedFileName || `${params.mediaId}_${cleanName}`
    );
    await Promise.all([
      fs.writeFile(path.join(uploadsDir, storedFileName), params.buffer),
      fs.writeFile(
        localMetaPath,
        JSON.stringify(
          {
            ...existingMeta,
            id: params.mediaId,
            fileName:
              params.fileName || String(existingMeta.fileName || cleanName),
            storedFileName,
            mimeType:
              params.mimeType ||
              String(existingMeta.mimeType || "application/octet-stream"),
            sizeBytes: params.buffer.byteLength,
            customerPhone:
              params.customerPhone || existingMeta.customerPhone || undefined,
            sourceLabel:
              params.sourceLabel || existingMeta.sourceLabel || undefined,
            protectedFromPurge: true,
            createdAt: String(
              existingMeta.createdAt || new Date().toISOString()
            ),
          },
          null,
          2
        ),
        "utf8"
      ),
    ]);
  } catch {
    // Non-blocking vault write
  }
}

export async function downloadAndPersistMetaMediaToDisk(params: {
  mediaId: string;
  customerPhone?: string;
  fileName?: string;
  mimeType?: string;
  sourceLabel?: string;
}): Promise<{
  ok: boolean;
  cachedLocally: boolean;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
}> {
  const mediaId = String(params.mediaId || "").trim();
  if (!mediaId) return { ok: false, cachedLocally: false };

  const existing = await readLocalCachedMedia(mediaId);
  if (existing) {
    if (params.customerPhone || params.sourceLabel) {
      await writeLocalCachedMedia({
        mediaId,
        fileName: params.fileName || existing.fileName,
        mimeType: params.mimeType || existing.mimeType,
        buffer: existing.buffer,
        customerPhone: params.customerPhone,
        sourceLabel: params.sourceLabel,
      });
    }
    return {
      ok: true,
      cachedLocally: true,
      fileName: existing.fileName,
      mimeType: existing.mimeType,
      sizeBytes: existing.buffer.byteLength,
    };
  }

  if (
    mediaId.startsWith("local_") ||
    mediaId.startsWith("sim_") ||
    mediaId.startsWith("mock_") ||
    mediaId.startsWith("pdf_")
  ) {
    return { ok: true, cachedLocally: false };
  }

  const cfg = await loadMetaWhatsAppSetupConfig();
  const mode =
    process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS === "1"
      ? "SANDBOX_SIMULATOR"
      : String(cfg.mode || "SANDBOX_SIMULATOR");
  const accessToken = String(cfg.systemUserAccessToken || "").trim();
  if (mode !== "LIVE_META_CLOUD" || !accessToken) {
    return { ok: true, cachedLocally: false };
  }

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "ccwhatsapp/1.0",
        },
        signal: AbortSignal.timeout(15000),
      }
    );
    const meta: any = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok || !meta?.url) return { ok: false, cachedLocally: false };

    const cdn = await fetch(String(meta.url), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "ccwhatsapp/1.0",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!cdn.ok) return { ok: false, cachedLocally: false };
    const buffer = new Uint8Array(await cdn.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > VAULT_MAX_PERSIST_BYTES) {
      return { ok: false, cachedLocally: false };
    }
    const cdnMime = String(cdn.headers.get("content-type") || "")
      .split(";")[0]
      .trim();
    const finalMime = String(
      meta.mime_type || cdnMime || params.mimeType || "application/octet-stream"
    )
      .split(";")[0]
      .trim();
    const ext = finalMime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
    const finalFileName = String(params.fileName || `${mediaId}.${ext}`).trim();

    await writeLocalCachedMedia({
      mediaId,
      fileName: finalFileName,
      mimeType: finalMime,
      buffer,
      customerPhone: params.customerPhone,
      sourceLabel: params.sourceLabel,
    });
    return {
      ok: true,
      cachedLocally: true,
      fileName: finalFileName,
      mimeType: finalMime,
      sizeBytes: buffer.byteLength,
    };
  } catch {
    return { ok: false, cachedLocally: false };
  }
}

/**
 * Takes a media file that someone SENT to the business number (identified by the inbound media id), downloads it from
 * Meta (or reads from local permanent vault storage if already cached), and uploads it again under the business
 * number so it can be forwarded to a teammate.
 * In sandbox mode no network call is made and a simulated id is returned.
 */
export async function prepareInboundMediaForForward(params: {
  mediaId: string;
  mimeType?: string;
  fileName?: string;
  kind?: WhatsAppMediaAttachmentType;
}): Promise<{
  ok: boolean;
  waMediaId?: string;
  mimeType?: string;
  fileName?: string;
  supportsWhatsAppAudioType?: boolean;
  error?: string;
}> {
  const mediaId = String(params.mediaId || "").trim();
  if (!mediaId) return { ok: false, error: "No media id was saved for this attachment." };
  const baseMime = String(params.mimeType || "").split(";")[0].trim() || "application/octet-stream";

  const cfg = await loadMetaWhatsAppSetupConfig();
  const useSandbox = process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS === "1";
  const live = !useSandbox && String(cfg.mode || "") === "LIVE_META_CLOUD";
  const accessToken = String(cfg.systemUserAccessToken || "").trim();
  if (!live || !accessToken || mediaId.startsWith("sim_")) {
    const simAudio =
      params.kind === "AUDIO" || baseMime.startsWith("audio/")
        ? resolveAudioContainerMimeAndExt(baseMime)
        : null;
    const simMime = simAudio ? simAudio.mimeType : baseMime;
    const simName =
      params.fileName ||
      (simAudio ? `voice-note.${simAudio.extension}` : "attachment");
    const sim = await uploadMediaToMetaCloud({
      buffer: new Uint8Array(0),
      mimeType: simMime,
      fileName: simName,
      forceSandbox: true,
    });
    return {
      ok: sim.ok,
      waMediaId: sim.waMediaId,
      mimeType: simMime,
      fileName: simName,
      supportsWhatsAppAudioType: simAudio ? simAudio.supportsWhatsAppAudioType : true,
      error: sim.error,
    };
  }

  try {
    let buffer: Uint8Array | null = null;
    let rawDetected = baseMime;
    const cached = await readLocalCachedMedia(mediaId);
    if (cached) {
      buffer = cached.buffer;
      rawDetected = cached.mimeType || baseMime;
    } else {
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
      buffer = new Uint8Array(await cdn.arrayBuffer());
      const cdnMime = String(cdn.headers.get("content-type") || "").split(";")[0].trim();
      rawDetected = String(meta.mime_type || cdnMime || baseMime).split(";")[0].trim() || baseMime;
    }

    if (!buffer || buffer.byteLength === 0) {
      return { ok: false, error: "Downloaded attachment was empty." };
    }
    const maxBytes = params.kind === "DOCUMENT" ? 100 * 1024 * 1024 : 16 * 1024 * 1024;
    if (buffer.byteLength > maxBytes) {
      return { ok: false, error: "The attachment is too large to forward on WhatsApp." };
    }
    const canonical = detectCanonicalFileMimeAndExt(
      rawDetected,
      params.fileName || "",
      buffer
    );
    const isAudio =
      params.kind === "AUDIO" || canonical.mimeType.startsWith("audio/");
    let audioInfo = isAudio
      ? resolveAudioContainerMimeAndExt(canonical.mimeType, buffer)
      : null;
    let finalMime = audioInfo ? audioInfo.mimeType : canonical.mimeType;
    let finalExt = audioInfo ? audioInfo.extension : canonical.extension;

    if (audioInfo && !audioInfo.supportsWhatsAppAudioType) {
      const transcoded = await tryTranscodeAudioToOgg(buffer, audioInfo.extension);
      if (transcoded) {
        buffer = transcoded;
        finalMime = "audio/ogg";
        finalExt = "ogg";
        audioInfo = resolveAudioContainerMimeAndExt("audio/ogg", buffer);
      }
    }

    const finalFileName =
      audioInfo?.mimeType === "audio/ogg" && params.fileName
        ? `${params.fileName.replace(/\.[^.]+$/, "")}.ogg`
        : params.fileName ||
          (audioInfo
            ? `voice-note.${finalExt}`
            : `attachment.${finalExt || "bin"}`);
    if (!cached) {
      void writeLocalCachedMedia({
        mediaId,
        fileName: finalFileName,
        mimeType: finalMime,
        buffer,
      });
    }
    const up = await uploadMediaToMetaCloud({
      buffer,
      mimeType: finalMime,
      fileName: finalFileName,
    });
    return {
      ok: up.ok,
      waMediaId: up.waMediaId,
      mimeType: finalMime,
      fileName: finalFileName,
      supportsWhatsAppAudioType: audioInfo ? audioInfo.supportsWhatsAppAudioType : true,
      error: up.error,
    };
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
