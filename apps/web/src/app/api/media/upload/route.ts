import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { uploadMediaToMetaCloud, type WhatsAppMediaAttachmentType } from "@cc/connections";
import { hasPermission } from "@cc/rbac";
import { resolveMediaUploadPaths } from "@/lib/api/media/storage";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function classifyMediaType(mimeType: string, fileName: string): WhatsAppMediaAttachmentType {
  const mime = String(mimeType || "").toLowerCase();
  const ext = path.extname(fileName || "").toLowerCase();
  if (
    mime.startsWith("image/") ||
    [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg"].includes(ext)
  ) {
    return "IMAGE";
  }
  if (
    mime.startsWith("video/") ||
    [".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"].includes(ext)
  ) {
    return "VIDEO";
  }
  if (
    mime.startsWith("audio/") ||
    [".mp3", ".ogg", ".opus", ".wav", ".m4a", ".aac"].includes(ext)
  ) {
    return "AUDIO";
  }
  return "DOCUMENT";
}

function inferMimeType(rawMime: string, fileName: string): string {
  const clean = String(rawMime || "").trim();
  if (clean && clean !== "application/octet-stream") return clean;
  const ext = path.extname(fileName || "").toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".zip": "application/zip",
    ".dxf": "application/dxf",
    ".cdr": "application/x-coreldraw",
    ".ai": "application/postscript",
  };
  return map[ext] || clean || "application/octet-stream";
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:reply", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { ok: false, error: "No file uploaded." },
        { status: 400 }
      );
    }

    const maxBytes = 64 * 1024 * 1024; // 64 MB
    if (file.size > maxBytes) {
      return NextResponse.json(
        { ok: false, error: "File exceeds the 64 MB WhatsApp limit." },
        { status: 400 }
      );
    }

    const rawName =
      "name" in file && typeof (file as File).name === "string" && (file as File).name.trim()
        ? (file as File).name.trim()
        : "attachment";
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 140) || "attachment";
    const mimeType = inferMimeType(file.type, rawName);
    const mediaType = classifyMediaType(mimeType, rawName);
    const mediaId = `local_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
    const storedFileName = `${mediaId}_${safeName}`;

    const { uploadsDir, localMetaPath } = resolveMediaUploadPaths(mediaId);
    await fs.promises.mkdir(/*turbopackIgnore: true*/ uploadsDir, { recursive: true });

    const arrayBuf = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const binPath = path.join(/*turbopackIgnore: true*/ uploadsDir, storedFileName);

    // Write binary and upload to Meta Cloud API concurrently when live credentials are configured
    const [, metaUpload] = await Promise.all([
      fs.promises.writeFile(/*turbopackIgnore: true*/ binPath, buffer),
      uploadMediaToMetaCloud({
        buffer,
        mimeType,
        fileName: rawName,
      }).catch(() => ({ ok: false, waMediaId: undefined, mode: "SANDBOX_SIMULATOR" })),
    ]);

    const metaRecord = {
      id: mediaId,
      waMediaId: metaUpload.waMediaId || null,
      fileName: rawName,
      storedFileName,
      mimeType,
      mediaType,
      sizeBytes: buffer.length,
      uploadedBy: user.name,
      createdAt: new Date().toISOString(),
    };
    await fs.promises.writeFile(
      /*turbopackIgnore: true*/ localMetaPath,
      JSON.stringify(metaRecord, null, 2),
      "utf8"
    );

    return NextResponse.json({
      ok: true,
      attachment: {
        mediaId,
        waMediaId: metaUpload.waMediaId || undefined,
        mediaType,
        url: `/api/media/${mediaId}`,
        fileName: rawName,
        mimeType,
        sizeBytes: buffer.length,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to upload file." },
      { status: 500 }
    );
  }
}
