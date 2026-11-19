import { NextResponse } from "next/server";
import {
  createDevAccountByDev,
  deleteStaffAccount,
  reviewStaffAccount,
  setStaffAssignmentsEnabled,
} from "@cc/auth";
import {
  isDevRole,
  isSuperAdminCapable,
  type UserRole,
} from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import { loadStaffDirectoryPayload } from "@/lib/loaders/core";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = await loadStaffDirectoryPayload(user);
  return NextResponse.json(payload);
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

  if (body.action === "create_dev") {
    if (!isDevRole(user.role)) {
      return NextResponse.json(
        { ok: false, error: "Only an active DEV account can create another DEV account." },
        { status: 403 }
      );
    }

    const created = await createDevAccountByDev({
      creator: user,
      name: String(body.name || ""),
      email: String(body.email || ""),
      whatsappNumber: String(body.whatsappNumber || ""),
      password: String(body.password || ""),
    });

    if (!created.ok) {
      return NextResponse.json({ ok: false, error: created.error }, { status: 400 });
    }

    socketHub.emit("staff:approval_changed", {
      targetUserId: created.user?.id,
      status: created.user?.status,
      role: created.user?.role,
      approvedBy: user.name,
    });

    return NextResponse.json({ ok: true, created: created.user });
  }

  if (body.action === "toggle_assignments") {
    const enabled = Boolean(body.assignmentsEnabled);
    const updatedRes = await setStaffAssignmentsEnabled({
      actor: user,
      targetUserId: String(body.targetUserId || ""),
      enabled,
    });
    if (!updatedRes.ok) {
      return NextResponse.json(
        { ok: false, error: updatedRes.error },
        { status: 400 }
      );
    }
    socketHub.emit("staff:approval_changed", {
      targetUserId: updatedRes.updated?.id,
      status: updatedRes.updated?.status,
      role: updatedRes.updated?.role,
      assignmentsEnabled: updatedRes.updated?.assignmentsEnabled,
      approvedBy: user.name,
    });
    return NextResponse.json({
      ok: true,
      updated: updatedRes.updated,
      message: `${
        enabled ? "Enabled" : "Turned off"
      } assignments and leads for "${updatedRes.updated?.name || "member"}".`,
    });
  }

  if (body.action === "delete_staff") {
    const deleted = await deleteStaffAccount({
      actor: user,
      targetUserId: String(body.targetUserId || ""),
    });
    if (!deleted.ok) {
      return NextResponse.json({ ok: false, error: deleted.error }, { status: 400 });
    }
    socketHub.emit("staff:approval_changed", {
      targetUserId: String(body.targetUserId || ""),
      status: "DELETED",
      deletedName: deleted.deletedName,
      approvedBy: user.name,
    });
    return NextResponse.json({
      ok: true,
      deletedName: deleted.deletedName,
      message: `Deleted account "${deleted.deletedName}".`,
    });
  }

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
