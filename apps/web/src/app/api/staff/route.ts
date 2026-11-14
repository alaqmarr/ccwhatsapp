import { NextResponse } from "next/server";
import { listAllStaffAccounts, reviewStaffAccount } from "@cc/auth";
import { isSuperAdminCapable, type UserRole } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await listAllStaffAccounts();
  if (!isSuperAdminCapable(user.role)) {
    // Active staff/admins can view active teammates for chat assignment dropdowns
    return NextResponse.json({
      ok: true,
      staff: accounts
        .filter((a) => a.status === "ACTIVE")
        .map((a) => ({
          id: a.id,
          name: a.name,
          email: a.email,
          role: a.role,
          department: a.department,
        })),
    });
  }

  return NextResponse.json({ ok: true, staff: accounts });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isSuperAdminCapable(user.role)) {
    return NextResponse.json(
      { ok: false, error: "Only SUPERADMIN or DEV can approve or modify staff accounts." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const result = await reviewStaffAccount({
    approver: user,
    targetUserId: String(body.targetUserId || ""),
    decision: body.decision === "REJECT" ? "REJECT" : body.decision === "SUSPEND" ? "SUSPEND" : "APPROVE",
    assignedRole: body.assignedRole as UserRole | undefined,
    reason: body.reason ? String(body.reason) : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  socketHub.emit("staff:approval_changed", {
    targetUserId: result.updated?.id,
    status: result.updated?.status,
    role: result.updated?.role,
    approvedBy: user.name,
  });

  return NextResponse.json({ ok: true, updated: result.updated });
}
