import { NextResponse } from "next/server";
import { hasPermission, isDevRole } from "@cc/rbac";
import { loadAnalyticsPayload } from "@/lib/loaders/analytics";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "analytics:view", user.status)) {
    return NextResponse.json(
      { ok: false, error: "Analytics access required." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope");
  if (scope === "dev" && !isDevRole(user.role)) {
    return NextResponse.json(
      { ok: false, error: "Dev profit & cost analytics reserved strictly for DEV." },
      { status: 403 }
    );
  }

  const payload = await loadAnalyticsPayload(user, {
    range: searchParams.get("range") || "30d",
    teamId: searchParams.get("teamId") || "ALL",
    scope,
  });

  return NextResponse.json(payload);
}
