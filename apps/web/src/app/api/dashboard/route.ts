import { NextResponse } from "next/server";
import { hasPermission } from "@cc/rbac";
import { loadDashboardPayload } from "@/lib/loaders/core";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /api/dashboard  - everything the /dashboard home screen shows. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Active staff access required." }, { status: 403 });
  }
  const payload = await loadDashboardPayload(user);
  return NextResponse.json(payload);
}
