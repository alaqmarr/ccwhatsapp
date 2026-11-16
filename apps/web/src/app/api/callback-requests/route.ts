import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { listCallbackRequests } from "@cc/workers";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /api/callback-requests?status=PENDING  lists callback requests customers made from WhatsApp buttons. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Active staff access required." }, { status: 403 });
  }
  const status = new URL(req.url).searchParams.get("status") || undefined;
  const requests = await listCallbackRequests(status);
  return NextResponse.json({ ok: true, requests });
}

/** PATCH { id, status: "DONE" | "PENDING" }  marks a callback as handled. */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Active staff access required." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { id?: string; status?: string };
  const id = String(body.id || "").trim();
  const status = String(body.status || "").toUpperCase();
  if (!id || !["DONE", "PENDING"].includes(status)) {
    return NextResponse.json({ ok: false, error: "id and status (DONE or PENDING) are required." }, { status: 400 });
  }
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  await conv.execute({
    sql: `UPDATE callback_requests SET status = ?, handled_by = ?, updated_at = ? WHERE id = ?`,
    args: [status, status === "DONE" ? String((user as any).name || (user as any).email || "staff") : null, new Date().toISOString(), id],
  });
  return NextResponse.json({ ok: true });
}
