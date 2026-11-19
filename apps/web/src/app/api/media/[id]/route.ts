import { NextResponse } from "next/server";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import {
  buildNotModifiedResponse,
  computeBufferEtag,
  matchesIfNoneMatch,
} from "@/lib/api/media/etag";
import { renderBuiltinCataloguePdf } from "@/lib/api/media/pdf-catalogue";
import {
  proxyMetaMedia,
  resolveMediaUploadPaths,
  serveLocalUploadedMedia,
} from "@/lib/api/media/storage";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, context: RouteContext) {
  const { id: rawId } = await context.params;
  const mediaId = String(rawId || "").trim();
  if (!mediaId) {
    return NextResponse.json(
      { ok: false, error: "Media identifier is required" },
      { status: 400 }
    );
  }
  if (
    mediaId.includes("..") ||
    mediaId.includes("/") ||
    mediaId.includes("\\") ||
    mediaId.includes("%2f") ||
    mediaId.includes("%2F")
  ) {
    return NextResponse.json(
      { ok: false, error: "Invalid media identifier" },
      { status: 400 }
    );
  }

  const reqUrl = new URL(req.url);
  const forceDownload = reqUrl.searchParams.get("download") === "1";
  const requestedFilename = reqUrl.searchParams.get("filename");

  if (mediaId.startsWith("pdf_")) {
    const built = await renderBuiltinCataloguePdf(mediaId);
    if (built) {
      const cacheControl = "public, max-age=3600";
      if (matchesIfNoneMatch(req, built.etag)) {
        return buildNotModifiedResponse(built.etag, cacheControl);
      }
      return new Response(new Uint8Array(built.buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(built.buffer.length),
          "Cache-Control": cacheControl,
          ETag: built.etag,
          "Content-Disposition": `${forceDownload ? "attachment" : "inline"}; filename="${built.fileName}"`,
        },
      });
    }
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized access" },
      { status: 401 }
    );
  }
  if (!hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json(
      { ok: false, error: "Forbidden access" },
      { status: 403 }
    );
  }

  const { uploadsDir, localMetaPath } = resolveMediaUploadPaths(mediaId);
  const localResp = await serveLocalUploadedMedia({
    req,
    mediaId,
    uploadsDir,
    localMetaPath,
    forceDownload,
    requestedFilename,
  });
  if (localResp) return localResp;

  if (mediaId.startsWith("sim_") || mediaId.startsWith("mock_")) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#f0f2f5"/><text x="150" y="100" font-family="sans-serif" font-size="14" fill="#54656f" text-anchor="middle">Sandbox Media: ${mediaId}</text></svg>`;
    const etag = computeBufferEtag(svg);
    const cacheControl = "public, max-age=3600";
    if (matchesIfNoneMatch(req, etag)) {
      return buildNotModifiedResponse(etag, cacheControl);
    }
    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": cacheControl,
        ETag: etag,
        "Content-Disposition": "inline",
      },
    });
  }

  return proxyMetaMedia({
    req,
    mediaId,
    uploadsDir,
    localMetaPath,
    forceDownload,
    requestedFilename,
  });
}
