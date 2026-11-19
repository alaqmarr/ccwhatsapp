import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { invalidateWhatsAppCacheTags } from "@cc/storage";
import { getCurrentUser } from "@/lib/session";
import { handleGetContacts } from "@/lib/api/contacts/get-handler";
import {
  handleBulkImport,
  handleUpsertContact,
} from "@/lib/api/contacts/upsert-and-import";
import {
  handleCreateGroup,
  handleDeleteGroup,
  handleOpenOrCreateChat,
  handleSyncSources,
} from "@/lib/api/contacts/sync-and-groups";
import { handleBulkAction } from "@/lib/api/contacts/bulk-actions";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "contacts:view", user.status)) {
    return NextResponse.json(
      { ok: false, error: "Active staff access required to view Contacts Database." },
      { status: 403 }
    );
  }

  await ensureDatabasesBootstrapped();
  return handleGetContacts(req, user);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "contacts:manage", user.status)) {
    return NextResponse.json(
      { ok: false, error: "Staff permission required to manage contacts." },
      { status: 403 }
    );
  }

  await ensureDatabasesBootstrapped();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const nowIso = new Date().toISOString();

  let response: NextResponse;
  switch (action) {
    case "upsert_contact":
      response = await handleUpsertContact(body);
      break;
    case "bulk_import":
      response = await handleBulkImport(user, body, nowIso);
      break;
    case "sync_sources":
      response = await handleSyncSources(user, nowIso);
      break;
    case "create_group":
      response = await handleCreateGroup(user, body, nowIso);
      break;
    case "delete_group":
      response = await handleDeleteGroup(body);
      break;
    case "bulk_action":
      response = await handleBulkAction(user, body, nowIso);
      break;
    case "open_or_create_chat":
      response = await handleOpenOrCreateChat(user, body, nowIso);
      break;
    default:
      return NextResponse.json(
        { ok: false, error: "Unsupported contacts action." },
        { status: 400 }
      );
  }

  if (response.ok) {
    await invalidateWhatsAppCacheTags(["contacts-meta"]);
  }
  return response;
}
