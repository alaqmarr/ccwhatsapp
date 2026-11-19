import { NextResponse } from "next/server";
import {
  addConversationCollaborators,
  getRawLibSqlClient,
  removeConversationCollaborator,
} from "@cc/database";
import { socketHub } from "@cc/sockets";
import { logConversationAssignment } from "@cc/workers";
import type { ConversationActionContext } from "./shared";

export async function handleClaimOrTakeOver(
  ctx: ConversationActionContext,
  action: string
) {
  const { id, user, body, conv, cRow, customerPhone, nowIso } = ctx;
  const prevStaffId = cRow.assigned_staff_id ? String(cRow.assigned_staff_id) : "ACRIO";
  const prevStaffName = cRow.assigned_staff_name
    ? String(cRow.assigned_staff_name)
    : "ACRIO";
  const expectedStaffId = body.expectedCurrentStaffId
    ? String(body.expectedCurrentStaffId).trim()
    : "";
  const isFirstComeClaim =
    action === "claim_assignment" || expectedStaffId === "ACRIO" || expectedStaffId === "";

  if (
    isFirstComeClaim &&
    prevStaffId &&
    prevStaffId !== "ACRIO" &&
    prevStaffId !== user.id
  ) {
    return NextResponse.json(
      {
        ok: false,
        alreadyClaimed: true,
        claimedByStaffId: prevStaffId,
        claimedByStaffName: prevStaffName,
        error: `Already accepted by ${prevStaffName} (first-come, first-serve).`,
      },
      { status: 409 }
    );
  }

  const rawPrevTeam = String(cRow.assigned_team_name || "").trim();
  const resolvedTeamId =
    cRow.assigned_team_id && String(cRow.assigned_team_id).trim()
      ? String(cRow.assigned_team_id)
      : "team_sales";
  const resolvedTeamName =
    !rawPrevTeam ||
    rawPrevTeam.startsWith("System (ACRIO)") ||
    rawPrevTeam === "ACRIO Assistant" ||
    rawPrevTeam === "Internal Team Desk"
      ? "Sales Team"
      : rawPrevTeam;

  const tailMsgRes = await conv
    .execute({
      sql: `SELECT direction FROM messages
            WHERE conversation_id = ? AND direction IN ('INBOUND', 'OUTBOUND')
            ORDER BY created_at DESC LIMIT 1`,
      args: [id],
    })
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const isAwaitingReply = Boolean(
    tailMsgRes.rows[0] && String(tailMsgRes.rows[0].direction) === "INBOUND"
  );
  const nextWaitingSince = isAwaitingReply
    ? cRow.waiting_since
      ? String(cRow.waiting_since)
      : nowIso
    : null;

  if (isFirstComeClaim) {
    const claimRes = await conv.execute({
      sql: `UPDATE conversations
            SET status = 'ASSIGNED',
                assigned_staff_id = ?,
                assigned_staff_name = ?,
                assigned_team_id = ?,
                assigned_team_name = ?,
                escalation_level = 'P0',
                waiting_since = ?
            WHERE id = ?
              AND (
                assigned_staff_id IS NULL
                OR TRIM(assigned_staff_id) = ''
                OR assigned_staff_id = 'ACRIO'
                OR assigned_staff_id = ?
              )`,
      args: [
        user.id,
        user.name,
        resolvedTeamId,
        resolvedTeamName,
        nextWaitingSince,
        id,
        user.id,
      ],
    });
    if (Number(claimRes.rowsAffected ?? 0) === 0) {
      const latestRow = await conv.execute({
        sql: `SELECT assigned_staff_id, assigned_staff_name FROM conversations WHERE id = ? LIMIT 1`,
        args: [id],
      });
      const winnerName = String(
        latestRow.rows[0]?.assigned_staff_name || "another team member"
      );
      return NextResponse.json(
        {
          ok: false,
          alreadyClaimed: true,
          claimedByStaffName: winnerName,
          error: `Already accepted by ${winnerName} (first-come, first-serve).`,
        },
        { status: 409 }
      );
    }
  } else {
    await conv.execute({
      sql: `UPDATE conversations
            SET status = 'ASSIGNED',
                assigned_staff_id = ?,
                assigned_staff_name = ?,
                assigned_team_id = ?,
                assigned_team_name = ?,
                escalation_level = 'P0',
                waiting_since = ?
            WHERE id = ?`,
      args: [
        user.id,
        user.name,
        resolvedTeamId,
        resolvedTeamName,
        nextWaitingSince,
        id,
      ],
    });
  }

  await logConversationAssignment({
    conversationId: id,
    customerPhone,
    customerName: String(cRow.customer_name || ""),
    fromStaffId: prevStaffId,
    fromStaffName: prevStaffName,
    fromTeamName: rawPrevTeam || "System (ACRIO)",
    toStaffId: user.id,
    toStaffName: user.name,
    toTeamId: resolvedTeamId,
    toTeamName: resolvedTeamName,
    escalationLevel: "P0",
    assignmentSource: "STAFF_TAKEOVER",
    assignedByName: user.name,
    reason:
      prevStaffId === "ACRIO"
        ? `${user.name} took over chat from System (ACRIO)`
        : `${user.name} took over chat from ${prevStaffName}`,
    assignedAt: nowIso,
  }).catch((err) => {
    console.warn("[takeover] assignment timeline log failed:", (err as Error)?.message || err);
  });

  socketHub.emit("conversation:assigned", {
    conversationId: id,
    staffId: user.id,
    staffName: user.name,
    teamName: resolvedTeamName,
    escalationLevel: "P0",
  });

  return NextResponse.json({
    ok: true,
    conversation: {
      id,
      status: "ASSIGNED",
      assignedStaffId: user.id,
      assignedStaffName: user.name,
      assignedTeamId: resolvedTeamId,
      assignedTeamName: resolvedTeamName,
      escalationLevel: "P0",
      waitingSince: nextWaitingSince,
    },
  });
}

export async function handleAddCollaborator(ctx: ConversationActionContext) {
  const { id, user, body } = ctx;
  const staffId = String(body.staffId || "").trim();
  const staffName = String(body.staffName || "").trim();
  if (!staffId || staffId === "ACRIO") {
    return NextResponse.json(
      { ok: false, error: "Select a valid staff member." },
      { status: 400 }
    );
  }
  let resolvedName = staffName;
  const auth = getRawLibSqlClient("core_auth");
  const u = await auth.execute({
    sql: `SELECT name, COALESCE(assignments_enabled, 1) AS assignments_enabled FROM users WHERE id = ? LIMIT 1`,
    args: [staffId],
  });
  if (u.rows[0]) {
    if (!resolvedName) resolvedName = String(u.rows[0].name || staffId);
    if (Number(u.rows[0].assignments_enabled ?? 1) === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Assignments and leads are turned off for ${resolvedName} in Team Approvals.`,
        },
        { status: 400 }
      );
    }
  } else if (!resolvedName) {
    resolvedName = staffId;
  }
  const collaborators = await addConversationCollaborators({
    conversationId: id,
    members: [{ staffId, staffName: resolvedName }],
    addedBy: user.name,
  });
  socketHub.emit("conversation:assigned", { conversationId: id, collaborators });
  return NextResponse.json({ ok: true, collaborators });
}

export async function handleRemoveCollaborator(ctx: ConversationActionContext) {
  const { id, body } = ctx;
  const staffId = String(body.staffId || "").trim();
  const collaborators = await removeConversationCollaborator(id, staffId);
  socketHub.emit("conversation:updated", { conversationId: id, collaborators });
  return NextResponse.json({ ok: true, collaborators });
}
