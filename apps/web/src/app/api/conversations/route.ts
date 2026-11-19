import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import { handleGetConversations } from "@/lib/api/conversations-list/get-list";
import {
  handleBulkAssign,
  handleBulkResolve,
} from "@/lib/api/conversations-list/bulk-actions";
import { handleCreateOrSendConversation } from "@/lib/api/conversations-list/create-or-send";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json(
      { ok: false, error: "Active staff access required." },
      { status: 403 }
    );
  }

  await ensureDatabasesBootstrapped();
  return handleGetConversations(req, user);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:reply", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const nowIso = new Date().toISOString();

  if (body.action === "bulk_resolve") {
    return handleBulkResolve(user, body, nowIso);
  }
  if (body.action === "bulk_assign") {
    return handleBulkAssign(user, body);
  }

  return handleCreateOrSendConversation(user, body, nowIso);
}
