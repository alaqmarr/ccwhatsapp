import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { loadCallQueuePayload } from "@/lib/loaders/operations";
import { getCurrentUser } from "@/lib/session";
import {
  handleCallQueueMiscAction,
  handleCreateCallQueueItem,
  handleOpenCallQueueInInbox,
} from "@/lib/api/call-queue/handlers";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "call_queue:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const payload = await loadCallQueuePayload(user);
  return NextResponse.json(payload);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "call_queue:manage", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "create");
  const nowIso = new Date().toISOString();

  if (action === "create") {
    return handleCreateCallQueueItem(user, body, nowIso);
  }
  if (action === "open_in_inbox") {
    return handleOpenCallQueueInInbox(user, body, nowIso);
  }
  return handleCallQueueMiscAction(user, body, action);
}
