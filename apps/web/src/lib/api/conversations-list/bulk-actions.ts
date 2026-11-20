import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@cc/auth";
import { sendStaffAssignmentEmailNotification } from "@cc/connections";
import {
  getRawLibSqlClient,
} from "@cc/database";
import { canAssignToDev } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import { closeActiveAssignmentOnResolve } from "@cc/workers";

export async function handleBulkResolve(
  user: AuthenticatedUser,
  body: Record<string, unknown>,
  nowIso: string
) {
  const ids: string[] = Array.isArray(body.conversationIds)
    ? body.conversationIds.map(String).filter(Boolean)
    : [];
  if (ids.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Select at least one conversation." },
      { status: 400 }
    );
  }

  const conv = getRawLibSqlClient("conversations");
  const summary = String(body.resolutionSummary || `Resolved by ${user.name}.`).trim();
  for (const cid of ids) {
    await conv.execute({
      sql: `UPDATE conversations
            SET status = 'RESOLVED',
                waiting_since = NULL,
                escalation_level = 'P0',
                resolution_summary = ?,
                resolved_by_id = ?,
                resolved_by_name = ?,
                resolved_at = ?
            WHERE id = ?`,
      args: [summary, user.id, user.name, nowIso, cid],
    });
    await closeActiveAssignmentOnResolve(cid, nowIso).catch(() => {});
  }

  socketHub.emit("conversation:resolved", {
    conversationIds: ids,
    resolvedBy: user.name,
  });
  return NextResponse.json({ ok: true, updatedCount: ids.length });
}

export async function handleBulkAssign(
  user: AuthenticatedUser,
  body: Record<string, unknown>
) {
  const ids: string[] = Array.isArray(body.conversationIds)
    ? body.conversationIds.map(String).filter(Boolean)
    : [];
  const targetStaffId = String(body.staffId || user.id);
  if (ids.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Select at least one conversation." },
      { status: 400 }
    );
  }

  let targetStaffName = String(body.staffName || user.name);
  let targetEmail = "";
  if (targetStaffId !== "ACRIO") {
    const auth = getRawLibSqlClient("core_auth");
    const uRes = await auth.execute({
      sql: `SELECT id, name, email, role
            FROM users WHERE id = ? LIMIT 1`,
      args: [targetStaffId],
    });
    if (uRes.rows[0]) {
      targetStaffName = String(uRes.rows[0].name || targetStaffName);
      targetEmail = String(uRes.rows[0].email || "");
      if (
        String(uRes.rows[0].role) === "DEV" &&
        targetStaffId !== user.id &&
        !canAssignToDev(user.role)
      ) {
        return NextResponse.json(
          { ok: false, error: "Only Managers and Superadmins can assign Dev accounts." },
          { status: 403 }
        );
      }
    }
  }

  const conv = getRawLibSqlClient("conversations");
  for (const cid of ids) {
    const cCheck = await conv.execute({
      sql: `SELECT customer_phone, customer_name, smart_category, priority, last_message_preview FROM conversations WHERE id = ? LIMIT 1`,
      args: [cid],
    });
    const cRow = cCheck.rows[0];
    if (!cRow) continue;

    if (targetStaffId === "ACRIO") {
      await conv.execute({
        sql: `UPDATE conversations
              SET status = 'OPEN',
                  assigned_staff_id = 'ACRIO',
                  assigned_staff_name = 'ACRIO',
                  assigned_team_id = NULL,
                  assigned_team_name = 'System (ACRIO)',
                  escalation_level = 'P0',
                  waiting_since = NULL
              WHERE id = ?`,
        args: [cid],
      });
    } else {
      await conv.execute({
        sql: `UPDATE conversations
              SET status = 'ASSIGNED',
                  assigned_staff_id = ?,
                  assigned_staff_name = ?,
                  assigned_team_id = COALESCE(assigned_team_id, 'team_sales'),
                  assigned_team_name = COALESCE(NULLIF(assigned_team_name, 'System (ACRIO)'), 'Sales Team'),
                  escalation_level = 'P0'
              WHERE id = ?`,
        args: [targetStaffId, targetStaffName, cid],
      });
      if (targetStaffId !== user.id) {
        sendStaffAssignmentEmailNotification({
          staffId: targetStaffId,
          staffEmail: targetEmail || undefined,
          staffName: targetStaffName,
          customerName: String(cRow.customer_name || ""),
          customerPhone: String(cRow.customer_phone || ""),
          smartCategory: String(cRow.smart_category || "General Enquiry"),
          priority: String(cRow.priority || "NORMAL"),
          teamName: "Sales Team",
          reason: `Assigned by ${user.name} (Bulk Inbox Action)`,
          latestMessage: String(cRow.last_message_preview || ""),
          conversationId: cid,
        }).catch(() => {});
      }
    }
  }

  socketHub.emit("conversation:assigned", {
    conversationIds: ids,
    staffName: targetStaffName,
  });
  return NextResponse.json({ ok: true, updatedCount: ids.length });
}
