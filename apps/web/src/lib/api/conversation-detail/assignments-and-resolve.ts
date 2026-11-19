import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { sendStaffAssignmentEmailNotification } from "@cc/connections";
import {
  getRawLibSqlClient,
  isUserAssignmentsEnabled,
} from "@cc/database";
import { canAssignToDev } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import {
  closeActiveAssignmentOnResolve,
  logConversationAssignment,
  processInboundAutomations,
  smartAssignConversation,
} from "@cc/workers";
import type { ConversationActionContext } from "./shared";

export async function handleReturnToAcrio(ctx: ConversationActionContext) {
  const { id, user, conv, cRow, customerPhone, nowIso } = ctx;
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
    args: [id],
  });

  await logConversationAssignment({
    conversationId: id,
    customerPhone,
    customerName: String(cRow.customer_name || ""),
    fromStaffId: cRow.assigned_staff_id ? String(cRow.assigned_staff_id) : null,
    fromStaffName: cRow.assigned_staff_name ? String(cRow.assigned_staff_name) : null,
    fromTeamName: cRow.assigned_team_name ? String(cRow.assigned_team_name) : null,
    toStaffId: "ACRIO",
    toStaffName: "ACRIO",
    toTeamId: null,
    toTeamName: "System (ACRIO)",
    escalationLevel: "P0",
    assignmentSource: "RETURN_TO_SYSTEM",
    assignedByName: user.name,
    reason: `${user.name} assigned chat to System (ACRIO)`,
    assignedAt: nowIso,
  });

  const lastCustOrStaffMsg = await conv.execute({
    sql: `SELECT direction, body FROM messages
          WHERE conversation_id = ? AND direction IN ('INBOUND', 'OUTBOUND')
          ORDER BY created_at DESC LIMIT 1`,
    args: [id],
  });
  const tailMsg = lastCustOrStaffMsg.rows[0];
  if (tailMsg && String(tailMsg.direction) === "INBOUND") {
    await processInboundAutomations({
      conversationId: id,
      customerPhone,
      inboundText: String(tailMsg.body || ""),
      isNewConversation: false,
    });
  }

  socketHub.emit("conversation:assigned", {
    conversationId: id,
    staffName: "ACRIO",
    teamName: "System (ACRIO)",
    escalationLevel: "P0",
  });
  return NextResponse.json({ ok: true });
}

export async function handleSmartAssign(ctx: ConversationActionContext) {
  const { id, user, body } = ctx;
  const res = await smartAssignConversation({
    conversationId: id,
    preferredTeamId: body.teamId ? String(body.teamId) : "team_sales",
    preferredTier: body.tier === "P1" || body.tier === "P2" ? body.tier : "P0",
    onlyIfUnassigned: false,
    triggeredByName: user.name,
  });
  return NextResponse.json({ ok: true, assignment: res });
}

export async function handleAssignStaff(ctx: ConversationActionContext) {
  const { id, user, body, conv, cRow, customerPhone, nowIso } = ctx;
  const staffId = body.staffId ? String(body.staffId) : user.id;
  let staffName = body.staffName ? String(body.staffName) : user.name;

  if (staffId && staffId !== "ACRIO") {
    const auth = getRawLibSqlClient("core_auth");
    const targetUserRes = await auth.execute({
      sql: `SELECT id, name, role, status, COALESCE(assignments_enabled, 1) AS assignments_enabled
            FROM users WHERE id = ? LIMIT 1`,
      args: [staffId],
    });
    const targetUser = targetUserRes.rows[0] as Record<string, unknown> | undefined;
    if (targetUser) {
      staffName = String(targetUser.name || staffName);
      if (Number(targetUser.assignments_enabled ?? 1) === 0) {
        return NextResponse.json(
          {
            ok: false,
            error: `Assignments and leads are turned off for ${staffName} in Team Approvals.`,
          },
          { status: 400 }
        );
      }
      if (
        String(targetUser.role) === "DEV" &&
        staffId !== user.id &&
        !canAssignToDev(user.role)
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: "Only Managers and Superadmins can assign a chat to a Dev account.",
          },
          { status: 403 }
        );
      }
    } else if (!(await isUserAssignmentsEnabled(staffId))) {
      return NextResponse.json(
        {
          ok: false,
          error: "Assignments and leads are turned off for this account.",
        },
        { status: 400 }
      );
    }
  }

  const teamId =
    body.teamId !== undefined
      ? body.teamId
        ? String(body.teamId)
        : null
      : cRow.assigned_team_id
      ? String(cRow.assigned_team_id)
      : "team_sales";
  const teamName =
    body.teamName !== undefined
      ? body.teamName
        ? String(body.teamName)
        : null
      : cRow.assigned_team_name &&
          String(cRow.assigned_team_name) !== "ACRIO Assistant" &&
          String(cRow.assigned_team_name) !== "System (ACRIO)"
      ? String(cRow.assigned_team_name)
      : "Sales Team";
  const escalationLevel =
    body.escalationLevel === "P1" || body.escalationLevel === "P2"
      ? body.escalationLevel
      : "P0";

  const tailMsgRes = await conv.execute({
    sql: `SELECT direction FROM messages
          WHERE conversation_id = ? AND direction IN ('INBOUND', 'OUTBOUND')
          ORDER BY created_at DESC LIMIT 1`,
    args: [id],
  });
  const isAwaitingReply =
    tailMsgRes.rows[0] && String(tailMsgRes.rows[0].direction) === "INBOUND";

  await conv.execute({
    sql: `UPDATE conversations
          SET assigned_staff_id = ?,
              assigned_staff_name = ?,
              assigned_team_id = ?,
              assigned_team_name = ?,
              escalation_level = ?,
              waiting_since = CASE WHEN ? = 1 THEN COALESCE(waiting_since, ?) ELSE waiting_since END,
              status = 'ASSIGNED'
          WHERE id = ?`,
    args: [
      staffId,
      staffName,
      teamId,
      teamName,
      escalationLevel,
      isAwaitingReply ? 1 : 0,
      nowIso,
      id,
    ],
  });

  await logConversationAssignment({
    conversationId: id,
    customerPhone,
    customerName: String(cRow.customer_name || ""),
    fromStaffId: cRow.assigned_staff_id ? String(cRow.assigned_staff_id) : null,
    fromStaffName: cRow.assigned_staff_name ? String(cRow.assigned_staff_name) : null,
    fromTeamName: cRow.assigned_team_name ? String(cRow.assigned_team_name) : null,
    toStaffId: staffId,
    toStaffName: staffName,
    toTeamId: teamId,
    toTeamName: teamName || "Sales Team",
    escalationLevel,
    assignmentSource: "MANUAL_ASSIGN",
    assignedByName: user.name,
    reason: `Assigned by ${user.name}`,
    assignedAt: nowIso,
  });

  if (
    staffId &&
    staffId !== "ACRIO" &&
    staffId !== user.id &&
    staffId !== String(cRow.assigned_staff_id || "")
  ) {
    sendStaffAssignmentEmailNotification({
      staffId,
      staffName,
      customerName: String(cRow.customer_name || customerPhone),
      customerPhone,
      smartCategory: String(cRow.smart_category || "General Enquiry"),
      priority: String(cRow.priority || "NORMAL"),
      escalationLevel,
      teamName: teamName || "Sales Team",
      reason: `Assigned to you by ${user.name}`,
      latestMessage: String(cRow.last_message_preview || ""),
      conversationId: id,
    }).catch(() => {});
  }

  socketHub.emit("conversation:assigned", {
    conversationId: id,
    staffName,
    teamName,
    escalationLevel,
  });
  return NextResponse.json({ ok: true });
}

export async function handleSmartResolve(ctx: ConversationActionContext) {
  const { id, user, body, conv, crm, cRow, customerPhone, nowIso } = ctx;
  const summary = String(body.resolutionSummary || "Resolved customer enquiry.").trim();
  const nextCategory = body.smartCategory
    ? String(body.smartCategory)
    : String(cRow.smart_category);

  await conv.execute({
    sql: `UPDATE conversations
          SET status = 'RESOLVED',
              waiting_since = NULL,
              escalation_level = 'P0',
              smart_category = ?,
              resolution_summary = ?,
              resolved_by_id = ?,
              resolved_by_name = ?,
              resolved_at = ?
          WHERE id = ?`,
    args: [nextCategory, summary, user.id, user.name, nowIso, id],
  });

  await closeActiveAssignmentOnResolve(id, nowIso);

  if (cRow.customer_id) {
    await crm.execute({
      sql: `INSERT INTO customer_relations (
        id, customer_id, customer_phone, relation_type, summary, handled_by, occurred_at
      ) VALUES (?, ?, ?, 'WHATSAPP_RESOLVED', ?, ?, ?)`,
      args: [
        `rel_${crypto.randomUUID().slice(0, 8)}`,
        String(cRow.customer_id),
        customerPhone,
        summary,
        user.name,
        nowIso,
      ],
    });
  }

  socketHub.emit("conversation:resolved", { conversationId: id, resolvedBy: user.name });
  return NextResponse.json({ ok: true });
}

export async function handleReopen(ctx: ConversationActionContext) {
  const { id, user, conv, cRow, customerPhone, nowIso } = ctx;
  await conv.execute({
    sql: `UPDATE conversations
          SET status = 'ASSIGNED',
              assigned_staff_id = ?,
              assigned_staff_name = ?,
              assigned_team_id = 'team_sales',
              assigned_team_name = 'Sales Team',
              escalation_level = 'P0',
              waiting_since = NULL
          WHERE id = ?`,
    args: [user.id, user.name, id],
  });

  await logConversationAssignment({
    conversationId: id,
    customerPhone,
    customerName: String(cRow.customer_name || ""),
    fromStaffId: cRow.assigned_staff_id ? String(cRow.assigned_staff_id) : null,
    fromStaffName: cRow.assigned_staff_name ? String(cRow.assigned_staff_name) : null,
    fromTeamName: cRow.assigned_team_name ? String(cRow.assigned_team_name) : null,
    toStaffId: user.id,
    toStaffName: user.name,
    toTeamId: "team_sales",
    toTeamName: "Sales Team",
    escalationLevel: "P0",
    assignmentSource: "REOPEN",
    assignedByName: user.name,
    reason: `${user.name} reopened resolved chat`,
    assignedAt: nowIso,
  });
  return NextResponse.json({ ok: true });
}
