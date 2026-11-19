import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  pickNextSequentialStaffAtoZ,
} from "@cc/database";
import { sendStaffAssignmentEmailNotification } from "@cc/connections";
import { socketHub } from "@cc/sockets";
import { logConversationAssignment } from "./assignment-tracking";

/**
 * Automatic P0 -> P1 -> P2 Wait-Time Escalation Engine:
 * Checks open/assigned chats where `waiting_since` is active.
 * If customer waits past team's P0 threshold -> escalates to P1 responder + logs Internal Team Note.
 * If customer waits past team's P1 threshold -> escalates to P2 lead + logs Internal Team Note.
 */
export async function checkAndEscalateWaitingChats(): Promise<number> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const auth = getRawLibSqlClient("core_auth");
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Only escalate unattended initial leads where NO assigned human staff reply has been sent yet in the active ticket.
  // Once a staff member initiates or replies to the client, the chat stays with them forever unless manually reassigned/taken over.
  const [waitingRes, teamsRes, membersRes, devUsersRes] = await Promise.all([
    conv.execute(
      `SELECT c.id, c.customer_phone, c.customer_name, c.smart_category,
              c.assigned_staff_id, c.assigned_staff_name, c.assigned_team_id, c.assigned_team_name,
              c.escalation_level, c.waiting_since, c.last_message_preview
       FROM conversations c
       WHERE c.status != 'RESOLVED'
         AND c.waiting_since IS NOT NULL
         AND COALESCE(c.assigned_staff_id, '') != 'ACRIO'
         AND NOT EXISTS (
           SELECT 1 FROM messages m
           WHERE m.conversation_id = c.id
             AND m.direction = 'OUTBOUND'
             AND m.sender_type = 'STAFF'
             AND (
               c.resolved_at IS NULL
               OR TRIM(c.resolved_at) = ''
               OR m.created_at > c.resolved_at
             )
         )`
    ),
    conv.execute(`SELECT id, name, p0_wait_minutes, p1_wait_minutes FROM teams`),
    conv.execute(`SELECT team_id, staff_id, staff_name, tier FROM team_members WHERE is_available = 1`),
    auth.execute(
      `SELECT id FROM users WHERE role = 'DEV' OR COALESCE(assignments_enabled, 1) = 0`
    ),
  ]);

  if (waitingRes.rows.length === 0) return 0;

  const devUserIds = new Set(devUsersRes.rows.map((u) => String(u.id)));

  const teamMap = new Map<string, Record<string, unknown>>();
  for (const t of teamsRes.rows) {
    teamMap.set(String(t.id), t as Record<string, unknown>);
  }
  const defaultTeam =
    teamMap.get("team_sales") ||
    (teamsRes.rows[0] as Record<string, unknown> | undefined);

  let escalatedCount = 0;

  for (const row of waitingRes.rows) {
    const convId = String(row.id);
    const waitingSinceMs = new Date(String(row.waiting_since)).getTime();
    if (Number.isNaN(waitingSinceMs)) continue;

    const waitedMinutes = (nowMs - waitingSinceMs) / 60000;
    const currentLevel = String(row.escalation_level || "P0") as "P0" | "P1" | "P2";
    const teamId = row.assigned_team_id
      ? String(row.assigned_team_id)
      : defaultTeam
      ? String(defaultTeam.id)
      : "";
    const team = teamMap.get(teamId) || defaultTeam;
    const teamName = team ? String(team.name) : "Sales Team";

    const p0Wait = Number(team?.p0_wait_minutes ?? 5);
    const p1Wait = Number(team?.p1_wait_minutes ?? 12);

    let targetTier: "P1" | "P2" | null = null;
    if (currentLevel === "P0" && waitedMinutes >= p0Wait) {
      targetTier = "P1";
    } else if (currentLevel === "P1" && waitedMinutes >= p1Wait) {
      targetTier = "P2";
    }

    if (!targetTier) continue;

    const teamMembers = (membersRes.rows as Record<string, unknown>[]).filter(
      (m) =>
        String(m.team_id) === teamId &&
        String(m.tier) === targetTier &&
        !devUserIds.has(String(m.staff_id))
    );
    const fallbackMembers =
      teamMembers.length > 0
        ? teamMembers
        : (membersRes.rows as Record<string, unknown>[]).filter(
            (m) =>
              String(m.tier) === targetTier &&
              !devUserIds.has(String(m.staff_id))
          );

    const seqPick = await pickNextSequentialStaffAtoZ(
      fallbackMembers.map((m) => ({
        id: String(m.staff_id),
        name: String(m.staff_name || m.staff_id || ""),
        row: m,
      })),
      `wait_escalation_${teamId || "default"}_${targetTier}`
    );
    const nextResponder = seqPick ? seqPick.chosen.row : fallbackMembers[0];
    const nextStaffId = nextResponder
      ? String(nextResponder.staff_id)
      : row.assigned_staff_id
      ? String(row.assigned_staff_id)
      : null;
    const nextStaffName = nextResponder
      ? String(nextResponder.staff_name)
      : row.assigned_staff_name
      ? String(row.assigned_staff_name)
      : "Team Lead";

    const nextPriority = targetTier === "P2" ? "URGENT" : "HIGH";
    const roundedMins = Math.max(1, Math.floor(waitedMinutes));

    await conv.execute({
      sql: `UPDATE conversations
            SET status = 'ASSIGNED',
                assigned_team_id = COALESCE(assigned_team_id, ?),
                assigned_team_name = COALESCE(assigned_team_name, ?),
                assigned_staff_id = ?,
                assigned_staff_name = ?,
                escalation_level = ?,
                priority = ?,
                escalated_at = ?
            WHERE id = ?`,
      args: [
        teamId || null,
        teamName,
        nextStaffId,
        nextStaffName,
        targetTier,
        nextPriority,
        nowIso,
        convId,
      ],
    });

    await logConversationAssignment({
      conversationId: convId,
      customerPhone: String(row.customer_phone || ""),
      customerName: String(row.customer_name || ""),
      fromStaffId: row.assigned_staff_id ? String(row.assigned_staff_id) : null,
      fromStaffName: row.assigned_staff_name ? String(row.assigned_staff_name) : null,
      fromTeamName: row.assigned_team_name ? String(row.assigned_team_name) : teamName,
      toStaffId: nextStaffId,
      toStaffName: nextStaffName,
      toTeamId: teamId || null,
      toTeamName: teamName,
      escalationLevel: targetTier,
      assignmentSource: "AUTO_ESCALATION",
      assignedByName: "Wait-Time Escalation",
      reason: `Customer waited ${roundedMins} min without a reply. Escalated from ${currentLevel} to ${targetTier}.`,
      assignedAt: nowIso,
    });

    if (
      nextStaffId &&
      nextStaffId !== "ACRIO" &&
      nextStaffId !== String(row.assigned_staff_id || "")
    ) {
      void sendStaffAssignmentEmailNotification({
        staffId: nextStaffId,
        staffName: nextStaffName,
        customerName: String(row.customer_name || row.customer_phone || "Customer"),
        customerPhone: String(row.customer_phone || ""),
        smartCategory: String(row.smart_category || "General Enquiry"),
        priority: nextPriority,
        escalationLevel: targetTier,
        teamName,
        reason: `Customer waited ${roundedMins} min without a reply. Escalated from ${currentLevel} to ${targetTier}.`,
        latestMessage: String(row.last_message_preview || ""),
        conversationId: convId,
        isEscalation: true,
      }).catch(() => {});
    }

    escalatedCount++;
    socketHub.emit("conversation:escalated", {
      conversationId: convId,
      fromTier: currentLevel,
      toTier: targetTier,
      assignedStaffName: nextStaffName,
      teamName,
      waitedMinutes: roundedMins,
    });
  }

  return escalatedCount;
}
