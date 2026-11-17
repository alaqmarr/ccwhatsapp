import { NextResponse } from "next/server";
import {
  deleteCompanyDocument,
  ensureDatabasesBootstrapped,
  fetchLiveEcosystemDocuments,
  listCompanyDocuments,
  upsertCompanyDocument,
} from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const [documents, allEcosystemDocs] = await Promise.all([
    listCompanyDocuments(),
    fetchLiveEcosystemDocuments().catch(() => []),
  ]);
  const websiteDocuments = allEcosystemDocs.filter((d) => d.source !== "HUB_UPLOAD");
  return NextResponse.json({ ok: true, documents, websiteDocuments });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (
    !user ||
    (!hasPermission(user.role, "acrio:manage_training", user.status) &&
      !hasPermission(user.role, "inbox:reply", user.status))
  ) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  const mediaUrl = String(body.mediaUrl || body.url || "").trim();
  if (!title || !mediaUrl) {
    return NextResponse.json(
      { ok: false, error: "Document title and uploaded file are required." },
      { status: 400 }
    );
  }

  const saved = await upsertCompanyDocument({
    id: body.id ? String(body.id) : undefined,
    slug: body.slug ? String(body.slug) : undefined,
    title,
    category:
      body.category &&
      ["COMPLIANCE", "CATALOGUE", "BANKING", "COMPANY_PROFILE"].includes(
        String(body.category).toUpperCase()
      )
        ? (String(body.category).toUpperCase() as
            | "COMPLIANCE"
            | "CATALOGUE"
            | "BANKING"
            | "COMPANY_PROFILE")
        : "COMPLIANCE",
    docNumber: body.docNumber ? String(body.docNumber) : undefined,
    description: body.description ? String(body.description) : undefined,
    mediaId: body.mediaId ? String(body.mediaId) : undefined,
    waMediaId: body.waMediaId ? String(body.waMediaId) : undefined,
    mediaUrl,
    mediaType:
      body.mediaType &&
      ["DOCUMENT", "IMAGE", "VIDEO", "AUDIO"].includes(
        String(body.mediaType).toUpperCase()
      )
        ? (String(body.mediaType).toUpperCase() as
            | "DOCUMENT"
            | "IMAGE"
            | "VIDEO"
            | "AUDIO")
        : "DOCUMENT",
    fileName: body.fileName ? String(body.fileName) : undefined,
    mimeType: body.mimeType ? String(body.mimeType) : undefined,
    keywords: body.keywords ? String(body.keywords) : undefined,
    isEnabled: body.isEnabled !== undefined ? Boolean(body.isEnabled) : true,
    uploadedBy: user.name,
  });

  socketHub.emit("ai:training_updated", { type: "company_document", id: saved.id });
  return NextResponse.json({ ok: true, document: saved });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (
    !user ||
    (!hasPermission(user.role, "acrio:manage_training", user.status) &&
      !hasPermission(user.role, "automations:manage", user.status))
  ) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = String(searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "Document id is required." }, { status: 400 });
  }
  await ensureDatabasesBootstrapped();
  await deleteCompanyDocument(id);
  socketHub.emit("ai:training_updated", { type: "company_document_deleted", id });
  return NextResponse.json({ ok: true });
}
