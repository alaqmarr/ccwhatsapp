import { NextResponse } from "next/server";
import { listStaffNotifications, markStaffNotificationsRead } from "@cc/workers";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET: my @mention and ACRIO reply notifications. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: "Active staff access required." }, { status: 403 });
  }
  const data = await listStaffNotifications(user.id, 30);
  return NextResponse.json({ ok: true, ...data });
}

/** POST { ids?: string[] }  marks some (or all) of my notifications as read. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: "Active staff access required." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  await markStaffNotificationsRead(user.id, Array.isArray(body.ids) ? body.ids.map(String) : undefined);
  return NextResponse.json({ ok: true });
}
