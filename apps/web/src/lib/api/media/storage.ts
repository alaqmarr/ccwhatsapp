import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSetupStatus } from "@cc/auth";
import { resolveEnvMetaWhatsAppConfig, resolveMonorepoRoot } from "@cc/database";
import {
  buildNotModifiedResponse,
  computeBufferEtag,
  computeFileStatEtag,
  matchesIfNoneMatch,
} from "./etag";

const MAX_DISK_CACHE_BYTES = 15 * 1024 * 1024;
const PRIVATE_CACHE_CONTROL = "private, max-age=86400, stale-while-revalidate=3600";

export function resolveMediaUploadPaths(mediaId: string): {
  uploadsDir: string;
  localMetaPath: string;
} {
  const dataDir = process.env.DATABASE_DATA_DIR?.trim();
  const uploadsDir = dataDir
    ? path.join(/*turbopackIgnore: true*/ path.resolve(/*turbopackIgnore: true*/ dataDir), "uploads")
    : path.join(/*turbopackIgnore: true*/ resolveMonorepoRoot(), "data", "uploads");
  const localMetaPath = path.join(/*turbopackIgnore: true*/ uploadsDir, `${mediaId}.json`);
  return { uploadsDir, localMetaPath };
}

export async function serveLocalUploadedMedia(params: {
  req: Request;
  mediaId: string;
  uploadsDir: string;
  localMetaPath: string;
  forceDownload: boolean;
  requestedFilename: string | null;
}): Promise<Response | null> {
  const { req, mediaId, uploadsDir, localMetaPath, forceDownload, requestedFilename } =
    params;

  try {
    const metaRaw = await fs.readFile(/*turbopackIgnore: true*/ localMetaPath, "utf8");
    const meta = JSON.parse(metaRaw) as {
      fileName?: string;
      storedFileName?: string;
      mimeType?: string;
    };
    if (!meta.storedFileName) return null;

    const binPath = path.join(
      /*turbopackIgnore: true*/ uploadsDir,
      String(meta.storedFileName)
    );
    const stat = await fs.stat(/*turbopackIgnore: true*/ binPath);
    if (!stat.isFile()) return null;

    const etag = computeFileStatEtag(mediaId, stat.size, stat.mtimeMs);
    if (matchesIfNoneMatch(req, etag)) {
      return buildNotModifiedResponse(etag, "private, max-age=86400");
    }

    const buf = await fs.readFile(/*turbopackIgnore: true*/ binPath);
    const contentType = meta.mimeType || "application/octet-stream";
    const fileName = (requestedFilename || meta.fileName || mediaId).replace(/"/g, "");
    const disposition = forceDownload
      ? `attachment; filename="${fileName}"`
      : `inline; filename="${fileName}"`;

    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=86400",
        ETag: etag,
        "Content-Disposition": disposition,
      },
    });
  } catch {
    return null;
  }
}

async function persistMediaToDisk(params: {
  uploadsDir: string;
  localMetaPath: string;
  mediaId: string;
  finalFilename: string;
  contentType: string;
  buf: Buffer;
}): Promise<void> {
  const { uploadsDir, localMetaPath, mediaId, finalFilename, contentType, buf } = params;
  try {
    await fs.mkdir(/*turbopackIgnore: true*/ uploadsDir, { recursive: true });
    const storedFileName = `${mediaId}_${finalFilename.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
    const binPath = path.join(/*turbopackIgnore: true*/ uploadsDir, storedFileName);
    await Promise.all([
      fs.writeFile(/*turbopackIgnore: true*/ binPath, buf),
      fs.writeFile(
        /*turbopackIgnore: true*/ localMetaPath,
        JSON.stringify(
          {
            id: mediaId,
            fileName: finalFilename,
            storedFileName,
            mimeType: contentType,
            sizeBytes: buf.length,
            createdAt: new Date().toISOString(),
          },
          null,
          2
        ),
        "utf8"
      ),
    ]);
  } catch {
    // Non-blocking disk cache
  }
}

export async function proxyMetaMedia(params: {
  req: Request;
  mediaId: string;
  uploadsDir: string;
  localMetaPath: string;
  forceDownload: boolean;
  requestedFilename: string | null;
}): Promise<Response> {
  const { req, mediaId, uploadsDir, localMetaPath, forceDownload, requestedFilename } =
    params;

  const setup = await getSetupStatus();
  const envCfg = resolveEnvMetaWhatsAppConfig();
  const accessToken = String(
    setup.facebookConfig?.systemUserAccessToken ||
      envCfg.systemUserAccessToken ||
      process.env.WHATSAPP_SYSTEM_ACCESS_TOKEN ||
      process.env.FACEBOOK_SYSTEM_ACCESS_TOKEN ||
      ""
  ).trim();

  if (!accessToken) {
    return NextResponse.json(
      { ok: false, error: "Meta WhatsApp credentials are not configured" },
      { status: 503 }
    );
  }

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "ccwhatsapp/1.0",
        },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!metaRes.ok) {
      const errText = await metaRes.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          error: `Meta Graph API request failed with status ${metaRes.status}`,
          details: errText.slice(0, 300),
        },
        { status: metaRes.status === 404 ? 404 : 502 }
      );
    }

    const metaData = (await metaRes.json()) as {
      url?: string;
      mime_type?: string;
      sha256?: string;
      file_size?: number;
      id?: string;
    };

    if (!metaData.url) {
      return NextResponse.json(
        { ok: false, error: "Media download link was not returned by Meta" },
        { status: 502 }
      );
    }

    const cdnRes = await fetch(metaData.url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!cdnRes.ok || !cdnRes.body) {
      return NextResponse.json(
        { ok: false, error: "Could not download media binary from Meta CDN" },
        { status: cdnRes.status || 502 }
      );
    }

    const contentType =
      metaData.mime_type ||
      cdnRes.headers.get("content-type") ||
      "application/octet-stream";

    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", contentType);
    responseHeaders.set("Cache-Control", PRIVATE_CACHE_CONTROL);

    const rawFileSize = Number(
      metaData.file_size || cdnRes.headers.get("content-length") || 0
    );
    if (rawFileSize > 0) {
      responseHeaders.set("Content-Length", String(rawFileSize));
    }

    const ext = contentType.includes("pdf")
      ? "pdf"
      : contentType.includes("mp4")
      ? "mp4"
      : contentType.includes("png")
      ? "png"
      : "jpg";
    const finalFilename = (requestedFilename || `${mediaId}.${ext}`).replace(/"/g, "");
    responseHeaders.set(
      "Content-Disposition",
      `${forceDownload ? "attachment" : "inline"}; filename="${finalFilename}"`
    );

    // Avoid buffering very large payloads in RAM; stream directly to caller
    if (rawFileSize > MAX_DISK_CACHE_BYTES) {
      return new Response(cdnRes.body, {
        status: 200,
        headers: responseHeaders,
      });
    }

    const arrayBuf = await cdnRes.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const etag = computeBufferEtag(buf);
    if (matchesIfNoneMatch(req, etag)) {
      void persistMediaToDisk({
        uploadsDir,
        localMetaPath,
        mediaId,
        finalFilename,
        contentType,
        buf,
      });
      return buildNotModifiedResponse(etag, PRIVATE_CACHE_CONTROL);
    }

    responseHeaders.set("Content-Length", String(buf.length));
    responseHeaders.set("ETag", etag);

    void persistMediaToDisk({
      uploadsDir,
      localMetaPath,
      mediaId,
      finalFilename,
      contentType,
      buf,
    });

    return new Response(buf, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to stream media attachment",
        details: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}
