import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import {
  ensureBackgroundWorkersRunning,
  processMarketingBroadcastQueue,
} from "@cc/workers";
import { loadMarketingPayload } from "@/lib/loaders/crm";
import { getCurrentUser } from "@/lib/session";
import {
  handleGetBroadcastRecipients,
  handleMarketingPostAction,
} from "@/lib/api/marketing/handlers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  ensureBackgroundWorkersRunning();
  await processMarketingBroadcastQueue().catch(() => {});

  const url = new URL(req.url);
  const broadcastId = url.searchParams.get("broadcastId");
  if (broadcastId) {
    return handleGetBroadcastRecipients(broadcastId);
  }

  const payload = await loadMarketingPayload(user);
  return NextResponse.json(payload);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  await ensureDatabasesBootstrapped();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handleMarketingPostAction(user, body);
}
