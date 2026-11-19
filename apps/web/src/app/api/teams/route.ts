import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import {
  handleGetTeams,
  handleTeamPostAction,
} from "@/lib/api/teams/handlers";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json(
      { ok: false, error: "Active staff access required." },
      { status: 403 }
    );
  }

  await ensureDatabasesBootstrapped();
  return handleGetTeams(user);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (
    !user ||
    user.status !== "ACTIVE" ||
    !["DEV", "SUPERADMIN", "ADMIN", "MANAGER"].includes(user.role)
  ) {
    return NextResponse.json(
      { ok: false, error: "Manager or Admin access required to manage teams." },
      { status: 403 }
    );
  }

  await ensureDatabasesBootstrapped();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handleTeamPostAction(user, body);
}
