import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSetupStatus } from "@cc/auth";
import {
  cleanDisplayProductName,
  resolveEnvMetaWhatsAppConfig,
  resolveMonorepoRoot,
  type MainWebsiteProduct,
} from "@cc/database";
import { getCachedEcosystemCatalog } from "@cc/connections";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function escapePdfText(raw: string): string {
  return String(raw || "")
    .replace(/₹/g, "Rs. ")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildSimplePdfBuffer(title: string, subtitle: string, lines: string[]): Buffer {
  const safeLines = lines.slice(0, 46);
  const contentStreamLines: string[] = [
    "BT",
    "/F1 15 Tf",
    "44 795 Td",
    `(${escapePdfText(title)}) Tj`,
    "/F1 9 Tf",
    "0 -16 Td",
    `(${escapePdfText(subtitle)}) Tj`,
    "0 -18 Td",
  ];
  for (const line of safeLines) {
    contentStreamLines.push(`(${escapePdfText(line.slice(0, 102))}) Tj`);
    contentStreamLines.push("0 -14 Td");
  }
  contentStreamLines.push("ET");
  const streamBody = contentStreamLines.join("\n");

  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(streamBody, "utf8")} >>\nstream\n${streamBody}\nendstream\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

async function renderBuiltinCataloguePdf(mediaId: string): Promise<{
  buffer: Buffer;
  fileName: string;
} | null> {
  if (!mediaId.startsWith("pdf_")) return null;
  const { allItems } = await getCachedEcosystemCatalog();
  const subtitle =
    "Classic Concepts & Classic Edge 53 | Secunderabad, Hyderabad | +91 73372 22876 | sales@classicconcepts.in";

  if (mediaId.startsWith("pdf_spec_")) {
    const slug = decodeURIComponent(mediaId.slice("pdf_spec_".length)).toLowerCase();
    const item = allItems.find((it) => (it.slug || "").toLowerCase() === slug);
    if (!item) return null;
    const cleanName = cleanDisplayProductName(item.name);
    const lines: string[] = [
      `Product: ${cleanName}${item.sku ? ` (SKU: ${item.sku})` : ""}`,
      `Category: ${item.categoryName || "Acrylic Products"}`,
      `Price: ${item.basePrice ? `Rs. ${item.basePrice.toLocaleString("en-IN")}` : "Price on Request"}`,
      `Product Page: ${item.shortUrl || item.url}`,
      "--------------------------------------------------------------------------------",
    ];
    if (item.dimensions && item.dimensions.length > 0) {
      lines.push("DIMENSIONS:");
      for (const d of item.dimensions) {
        lines.push(`  * ${d.label || d.key}: ${d.value}`);
      }
    }
    if (item.specifications && item.specifications.length > 0) {
      lines.push("SPECIFICATIONS:");
      for (const s of item.specifications) {
        lines.push(`  * ${s.label || s.key}: ${s.value}`);
      }
    }
    if (item.variants && item.variants.length > 0) {
      lines.push("AVAILABLE VARIANTS / COLOURS:");
      for (const v of item.variants) {
        lines.push(
          `  * ${v.name}${v.price ? ` - Rs. ${v.price.toLocaleString("en-IN")}` : ""}`
        );
      }
    }
    if (item.features && item.features.length > 0) {
      lines.push("KEY HIGHLIGHTS:");
      for (const f of item.features.slice(0, 8)) {
        lines.push(`  * ${f}`);
      }
    }
    return {
      buffer: buildSimplePdfBuffer(`${cleanName} - Specification Sheet`, subtitle, lines),
      fileName: `${item.slug}-spec-sheet.pdf`,
    };
  }

  let title = "Classic Concepts - Complete Product Catalogue";
  let fileName = "Classic-Concepts-Full-Catalogue.pdf";
  let filtered: MainWebsiteProduct[] = allItems;

  if (mediaId === "pdf_podium_catalogue") {
    title = "Classic Concepts - Acrylic Podiums & Pulpits Catalogue";
    fileName = "Classic-Concepts-Podium-Catalogue.pdf";
    filtered = allItems.filter(
      (it) =>
        it.brand === "CLASSIC_CONCEPTS" &&
        /podium|pulpit|lectern/i.test(`${it.name} ${it.categoryName}`)
    );
  } else if (mediaId === "pdf_furniture_catalogue") {
    title = "Classic Concepts - Acrylic Furniture, Chairs & Tables Catalogue";
    fileName = "Classic-Concepts-Furniture-Catalogue.pdf";
    filtered = allItems.filter(
      (it) =>
        it.brand === "CLASSIC_CONCEPTS" &&
        /furniture|chair|stool|table|desk/i.test(`${it.name} ${it.categoryName}`)
    );
  } else if (mediaId === "pdf_memento_catalogue") {
    title = "Classic Concepts - Trophies, Mementos & Corporate Gifts Catalogue";
    fileName = "Classic-Concepts-Memento-Catalogue.pdf";
    filtered = allItems.filter(
      (it) =>
        it.brand === "CLASSIC_CONCEPTS" &&
        /trophy|trophies|memento|award|gift|plaque/i.test(`${it.name} ${it.categoryName}`)
    );
  } else if (mediaId === "pdf_machines_catalogue") {
    title = "Classic Edge 53 - Industrial Acrylic Machines Catalogue";
    fileName = "Classic-Edge-53-Machines-Catalogue.pdf";
    filtered = allItems.filter((it) => it.brand === "CLASSIC_EDGE_53");
  }

  const lines: string[] = [
    `Total Listed Models in Category: ${filtered.length}`,
    "--------------------------------------------------------------------------------",
  ];
  filtered.slice(0, 40).forEach((it, idx) => {
    const cleanName = cleanDisplayProductName(it.name);
    const price = it.basePrice ? `Rs. ${it.basePrice.toLocaleString("en-IN")}` : "Quote";
    const vars =
      it.variants && it.variants.length > 0
        ? ` | Variants: ${it.variants.map((v) => v.name).join(", ")}`
        : "";
    lines.push(
      `${idx + 1}. ${cleanName} (${price})${vars} - ${it.shortUrl || it.url}`
    );
  });

  return {
    buffer: buildSimplePdfBuffer(title, subtitle, lines),
    fileName,
  };
}

export async function GET(_req: Request, context: RouteContext) {
  /* 1. Resolve media ID from URL parameters and reject traversal attacks */
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

  /* 1b. Built-in public PDF catalogues & product spec sheets (`pdf_*`) */
  if (mediaId.startsWith("pdf_")) {
    const reqUrl = new URL(_req.url);
    const forceDownload = reqUrl.searchParams.get("download") === "1";
    const built = await renderBuiltinCataloguePdf(mediaId);
    if (built) {
      return new Response(new Uint8Array(built.buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(built.buffer.length),
          "Cache-Control": "public, max-age=3600",
          "Content-Disposition": `${forceDownload ? "attachment" : "inline"}; filename="${built.fileName}"`,
        },
      });
    }
  }

  /* 2. Authenticate session and verify inbox viewing permissions for private/customer media */
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized access" }, { status: 401 });
  }
  if (!hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden access" }, { status: 403 });
  }

  /* 3. Serve locally uploaded or cached files from <monorepoRoot>/data/uploads */
  const reqUrl = new URL(_req.url);
  const forceDownload = reqUrl.searchParams.get("download") === "1";
  const requestedFilename = reqUrl.searchParams.get("filename");
  const root = resolveMonorepoRoot();
  const uploadsDir = path.join(/*turbopackIgnore: true*/ root, "data", "uploads");
  const localMetaPath = path.join(/*turbopackIgnore: true*/ uploadsDir, `${mediaId}.json`);

  if (fs.existsSync(/*turbopackIgnore: true*/ localMetaPath)) {
    try {
      const meta = JSON.parse(
        fs.readFileSync(/*turbopackIgnore: true*/ localMetaPath, "utf8")
      ) as {
        fileName?: string;
        storedFileName?: string;
        mimeType?: string;
      };
      const binPath = path.join(
        /*turbopackIgnore: true*/ uploadsDir,
        String(meta.storedFileName || "")
      );
      if (meta.storedFileName && fs.existsSync(/*turbopackIgnore: true*/ binPath)) {
        const buf = fs.readFileSync(/*turbopackIgnore: true*/ binPath);
        const contentType = meta.mimeType || "application/octet-stream";
        const fileName = requestedFilename || meta.fileName || mediaId;
        const disposition = forceDownload
          ? `attachment; filename="${fileName.replace(/"/g, "")}"`
          : `inline; filename="${fileName.replace(/"/g, "")}"`;
        return new Response(buf, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(buf.length),
            "Cache-Control": "private, max-age=86400",
            "Content-Disposition": disposition,
          },
        });
      }
    } catch {
      // Fall through
    }
  }

  /* 3b. Handle simulated media in sandbox mode */
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

    const finalFilename = (
      requestedFilename ||
      `${mediaId}.${contentType.includes("pdf") ? "pdf" : contentType.includes("mp4") ? "mp4" : contentType.includes("png") ? "png" : "jpg"}`
    ).replace(/"/g, "");

    if (forceDownload) {
      responseHeaders.set("Content-Disposition", `attachment; filename="${finalFilename}"`);
    } else {
      responseHeaders.set("Content-Disposition", `inline; filename="${finalFilename}"`);
    }

    // Cache inbound Meta media locally on disk so it stays viewable even after Meta's temporary URL expires
    const arrayBuf = await cdnRes.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    try {
      fs.mkdirSync(/*turbopackIgnore: true*/ uploadsDir, { recursive: true });
      const storedFileName = `${mediaId}_${finalFilename.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
      fs.writeFileSync(
        /*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ uploadsDir, storedFileName),
        buf
      );
      fs.writeFileSync(
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
      );
    } catch {
      // Non-blocking disk cache
    }

    responseHeaders.set("Content-Length", String(buf.length));
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
