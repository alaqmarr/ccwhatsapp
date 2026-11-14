import { NextResponse } from "next/server";
import { getSetupStatus } from "@cc/auth";
import { resolveEnvMetaWhatsAppConfig } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  /* 1. Authenticate session and verify inbox viewing permissions */
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized access" }, { status: 401 });
  }
  if (!hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden access" }, { status: 403 });
  }

  /* 2. Resolve media ID from URL parameters and reject traversal attacks */
  const { id: rawId } = await context.params;
  const mediaId = String(rawId || "").trim();
  if (!mediaId) {
    return NextResponse.json({ ok: false, error: "Media identifier is required" }, { status: 400 });
  }
  if (
    mediaId.includes("..") ||
    mediaId.includes("/") ||
    mediaId.includes("\\") ||
    mediaId.includes("%2f") ||
    mediaId.includes("%2F")
  ) {
    return NextResponse.json({ ok: false, error: "Invalid media identifier" }, { status: 400 });
  }

  /* 3. Handle simulated media in sandbox mode */
  if (mediaId.startsWith("sim_") || mediaId.startsWith("mock_")) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#f0f2f5"/><text x="150" y="100" font-family="sans-serif" font-size="14" fill="#54656f" text-anchor="middle">Sandbox Media: ${mediaId}</text></svg>`;
    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=3600",
        "Content-Disposition": "inline",
      },
    });
  }

  /* 4. Resolve Meta WhatsApp Cloud API access token */
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
    /* 5. Request media metadata and temporary CDN download URL from Meta Graph API */
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

    /* 6. Download binary media stream from Meta lookaside CDN */
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

    /* 7. Construct response headers and stream binary payload */
    const contentType =
      metaData.mime_type ||
      cdnRes.headers.get("content-type") ||
      "application/octet-stream";

    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", contentType);

    const fileSize = metaData.file_size || cdnRes.headers.get("content-length");
    if (fileSize) {
      responseHeaders.set("Content-Length", String(fileSize));
    }

    responseHeaders.set(
      "Cache-Control",
      "private, max-age=86400, stale-while-revalidate=3600"
    );

    const reqUrl = new URL(_req.url);
    const requestedFilename = reqUrl.searchParams.get("filename");
    const isPdfOrDoc =
      contentType.includes("pdf") ||
      contentType.includes("document") ||
      contentType.includes("octet-stream");

    if (isPdfOrDoc || requestedFilename) {
      const finalFilename = requestedFilename || `${mediaId}.pdf`;
      responseHeaders.set("Content-Disposition", `attachment; filename="${finalFilename}"`);
    } else {
      responseHeaders.set("Content-Disposition", "inline");
    }

    return new Response(cdnRes.body, {
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
