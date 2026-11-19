import crypto from "node:crypto";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  pickNextSequentialStaffAtoZ,
  resolveRequestedOrPreferredStaffForInbound,
} from "@cc/database";
import {
  formatWhatsAppOutboundText,
  sendStaffAssignmentEmailNotification,
  sendWhatsAppCloudMessage,
} from "@cc/connections";
import { socketHub } from "@cc/sockets";
import { logConversationAssignment } from "./assignment-tracking";

/**
 * Staff Preference, Explicit Person Request, or Previous Handler Sticky Auto-Assign.
 * Returns true if the chat was assigned and handled.
 */
export async function tryStickyStaffAutoAssign(params: {
  conversationId: string;
  customerPhone: string;
  inboundText: string;
  isNewConversation: boolean;
  convRow: Record<string, unknown>;
  currentAssignedId: string;
  nowIso: string;
}): Promise<boolean> {
  const staffPref = await resolveRequestedOrPreferredStaffForInbound({
    customerPhone: params.customerPhone,
    inboundText: params.inboundText,
    conversationId: params.conversationId,
  }).catch(() => null);

  if (
    !staffPref ||
    !(
      staffPref.matchType === "REQUESTED_BY_CUSTOMER" ||
      (params.isNewConversation &&
        (staffPref.matchType === "PREFERRED_STAFF" ||
          staffPref.matchType === "PAST_HANDLER"))
    )
  ) {
    return false;
  }

  const conv = getRawLibSqlClient("conversations");
  await conv.execute({
    sql: `UPDATE conversations
          SET status = 'ASSIGNED',
              assigned_staff_id = ?,
              assigned_staff_name = ?,
              assigned_team_id = 'team_sales',
              assigned_team_name = 'Sales Team',
              escalation_level = 'P0',
              waiting_since = COALESCE(waiting_since, ?)
          WHERE id = ?`,
    args: [staffPref.staffId, staffPref.staffName, params.nowIso, params.conversationId],
  });

  await logConversationAssignment({
    conversationId: params.conversationId,
    customerPhone: params.customerPhone,
    customerName: String(params.convRow.customer_name || params.customerPhone),
    fromStaffId: params.currentAssignedId || "ACRIO",
    fromStaffName:
      params.currentAssignedId === "ACRIO"
        ? "ACRIO"
        : String(params.convRow.assigned_staff_name || "System"),
    fromTeamName: String(params.convRow.assigned_team_name || "System (ACRIO)"),
    toStaffId: staffPref.staffId,
    toStaffName: staffPref.staffName,
    toTeamId: "team_sales",
    toTeamName: "Sales Team",
    escalationLevel: "P0",
    assignmentSource: staffPref.matchType,
    assignedByName: "System (Sticky Routing)",
    reason: staffPref.reason,
    assignedAt: params.nowIso,
  }).catch(() => {});

  await conv
    .execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, delivery_status, created_at
      ) VALUES (?, ?, 'INTERNAL', 'SYSTEM', 'Auto-Routing', 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
      args: [
        `msg_pref_${crypto.randomUUID().slice(0, 8)}`,
        params.conversationId,
        `Auto-assigned directly to @${staffPref.staffName} (${staffPref.reason}).`,
        params.nowIso,
      ],
    })
    .catch(() => {});

  void sendStaffAssignmentEmailNotification({
    staffId: staffPref.staffId,
    staffName: staffPref.staffName,
    customerName: String(params.convRow.customer_name || params.customerPhone),
    customerPhone: params.customerPhone,
    smartCategory: String(params.convRow.smart_category || "General Enquiry"),
    priority: "HIGH",
    escalationLevel: "P0",
    teamName: "Sales Team",
    reason: staffPref.reason,
    latestMessage: params.inboundText,
    conversationId: params.conversationId,
  }).catch(() => {});

  if (staffPref.matchType === "REQUESTED_BY_CUSTOMER") {
    const confirmText = formatWhatsAppOutboundText(
      `Sure, I have connected you directly with *${staffPref.staffName}* as requested. They will reply to you here shortly.`
    );
    const sendRes = await sendWhatsAppCloudMessage({
      toPhone: params.customerPhone,
      bodyText: confirmText,
      simulateAsyncDelivery: true,
    });
    await conv
      .execute({
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, wa_message_id, delivery_status, created_at
        ) VALUES (?, ?, 'OUTBOUND', 'AUTOMATION', 'Auto-Routing', 'TEXT', 'FREE_CHAT', ?, ?, ?, ?)`,
        args: [
          `msg_req_${crypto.randomUUID().slice(0, 8)}`,
          params.conversationId,
          confirmText,
          sendRes.waMessageId,
          sendRes.deliveryStatus,
          params.nowIso,
        ],
      })
      .catch(() => {});
    socketHub.emit("message:new", {
      conversationId: params.conversationId,
      senderName: "Auto-Routing",
      text: confirmText,
    });
  }

  socketHub.emit("conversation:assigned", {
    conversationId: params.conversationId,
    assignedTeamName: "Sales Team",
    assignedStaffName: staffPref.staffName,
    escalationLevel: "P0",
  });
  return true;
}

/**
 * Smart Team & Least-Loaded Agent Assignment Engine:
 * - Defaults ALWAYS to `Sales Team` (`team_sales`) when connecting from ACRIO or when no team is specified.
 * - Picks the available P0 responder with the fewest active open chats (falling back to P1, then P2).
 * - Starts `waiting_since` so customer wait time and P0 -> P1 -> P2 escalation are tracked automatically.
 */
export async function smartAssignConversation(params: {
  conversationId: string;
  inboundText?: string;
  preferredTeamId?: string;
  preferredTier?: "P0" | "P1" | "P2";
  allowKeywordRouting?: boolean;
  onlyIfUnassigned?: boolean;
  startWaitingTimer?: boolean;
  triggeredByName?: string;
  handoffReasonFromAcrio?: string;
  quoteProduct?: string;
  quoteQuantity?: string;
}): Promise<{
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  escalationLevel: "P0" | "P1" | "P2";
}> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();

  const existingRes = await conv.execute({
    sql: `SELECT * FROM conversations WHERE id = ? LIMIT 1`,
    args: [params.conversationId],
  });
  const current = existingRes.rows[0] as Record<string, unknown> | undefined;
  if (!current) {
    return {
      assignedTeamId: null,
      assignedTeamName: null,
      assignedStaffId: null,
      assignedStaffName: null,
      escalationLevel: "P0",
    };
  }

  const existingStaffId = current.assigned_staff_id
    ? String(current.assigned_staff_id)
    : "";
  if (params.onlyIfUnassigned && existingStaffId && existingStaffId !== "ACRIO") {
    if (params.startWaitingTimer && !current.waiting_since) {
      await conv.execute({
        sql: `UPDATE conversations SET waiting_since = ? WHERE id = ?`,
        args: [nowIso, params.conversationId],
      });
    }
    return {
      assignedTeamId: current.assigned_team_id ? String(current.assigned_team_id) : null,
      assignedTeamName: current.assigned_team_name ? String(current.assigned_team_name) : null,
      assignedStaffId: existingStaffId,
      assignedStaffName: current.assigned_staff_name ? String(current.assigned_staff_name) : null,
      escalationLevel: String(current.escalation_level || "P0") as "P0" | "P1" | "P2",
    };
  }

  const teamsRes = await conv.execute(
    `SELECT * FROM teams ORDER BY priority_rank ASC, created_at ASC`
  );
  const allTeams = teamsRes.rows as Record<string, unknown>[];
  if (allTeams.length === 0) {
    return {
      assignedTeamId: null,
      assignedTeamName: null,
      assignedStaffId: null,
      assignedStaffName: null,
      escalationLevel: "P0",
    };
  }

  const salesTeam =
    allTeams.find((t) => String(t.id) === "team_sales") ||
    allTeams.find((t) => /sales/i.test(String(t.name))) ||
    allTeams[0];

  let chosenTeam = params.preferredTeamId
    ? allTeams.find((t) => String(t.id) === params.preferredTeamId)
    : undefined;

  if (!chosenTeam && params.allowKeywordRouting) {
    const textLower = String(
      params.inboundText || current.last_message_preview || ""
    ).toLowerCase();
    for (const t of allTeams) {
      if (Number(t.auto_assign_enabled ?? 1) !== 1) continue;
      const kwList = String(t.routing_keywords || "")
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      if (kwList.some((kw) => textLower.includes(kw))) {
        chosenTeam = t;
        break;
      }
    }
  }

  // Default ALWAYS to Sales Team when connecting to staff
  if (!chosenTeam) {
    chosenTeam = salesTeam;
  }

  const teamId = String(chosenTeam.id);
  const teamName = String(chosenTeam.name);
  const auth = getRawLibSqlClient("core_auth");

  // Load team members (excluding DEV roles and accounts with assignments turned off)
  const [membersRes, devUsersRes] = await Promise.all([
    conv.execute({
      sql: `SELECT * FROM team_members WHERE team_id = ? AND is_available = 1`,
      args: [teamId],
    }),
    auth.execute(
      `SELECT id FROM users WHERE role = 'DEV' OR COALESCE(assignments_enabled, 1) = 0`
    ),
  ]);

  const devUserIds = new Set(devUsersRes.rows.map((u) => String(u.id)));

  const tierOrder: ("P0" | "P1" | "P2")[] =
    params.preferredTier === "P1"
      ? ["P1", "P2", "P0"]
      : params.preferredTier === "P2"
      ? ["P2", "P1", "P0"]
      : ["P0", "P1", "P2"];

  let chosenMember: Record<string, unknown> | null = null;
  let chosenTier: "P0" | "P1" | "P2" = params.preferredTier || "P0";
  let stickyReasonOverride: string | null = null;
  let sequentialOrderNote = "";

  // Check if customer requested someone specific, has a preferred staff member, or has an existing previous handler
  const stickyMatch = await resolveRequestedOrPreferredStaffForInbound({
    customerPhone: String(current.customer_phone || ""),
    inboundText: params.inboundText,
    conversationId: params.conversationId,
  }).catch(() => null);
  if (stickyMatch && !devUserIds.has(stickyMatch.staffId)) {
    chosenMember = {
      staff_id: stickyMatch.staffId,
      staff_name: stickyMatch.staffName,
      tier: chosenTier,
    };
    stickyReasonOverride = stickyMatch.reason;
  }

  for (const tier of tierOrder) {
    if (chosenMember) break;
    const candidates = (membersRes.rows as Record<string, unknown>[]).filter(
      (m) => String(m.tier) === tier && !devUserIds.has(String(m.staff_id))
    );
    if (candidates.length === 0) continue;

    // Assign sequentially in A-to-Z order irrespective of current load, wrapping back to start when complete.
    const seqPick = await pickNextSequentialStaffAtoZ(
      candidates.map((m) => ({
        id: String(m.staff_id),
        name: String(m.staff_name || m.staff_id || ""),
        row: m,
      })),
      `smart_team_${teamId}_${tier}`
    );
    chosenMember = seqPick ? seqPick.chosen.row : candidates[0];
    chosenTier = tier;
    if (seqPick) {
      sequentialOrderNote = ` (${seqPick.position} of ${seqPick.total})`;
    }
    break;
  }

  // Fallback: if chosenTeam had no available members, check any available non-DEV team member or active non-DEV user
  if (!chosenMember) {
    const anyTeamMemberRes = await conv.execute(
      `SELECT * FROM team_members WHERE is_available = 1`
    );
    const anyPool = (anyTeamMemberRes.rows as Record<string, unknown>[]).filter(
      (m) => !devUserIds.has(String(m.staff_id))
    );
    if (anyPool.length > 0) {
      const seqPick = await pickNextSequentialStaffAtoZ(
        anyPool.map((m) => ({
          id: String(m.staff_id),
          name: String(m.staff_name || m.staff_id || ""),
          row: m,
        })),
        "smart_team_fallback_pool"
      );
      chosenMember = seqPick ? seqPick.chosen.row : anyPool[0];
      chosenTier = String(chosenMember.tier || "P0") as "P0" | "P1" | "P2";
    } else {
      const activeUsersRes = await auth.execute(
        `SELECT id, name FROM users
         WHERE status = 'ACTIVE' AND role != 'DEV' AND COALESCE(assignments_enabled, 1) = 1
         ORDER BY name ASC`
      );
      if (activeUsersRes.rows.length > 0) {
        const seqPick = await pickNextSequentialStaffAtoZ(
          activeUsersRes.rows.map((u) => ({
            id: String(u.id),
            name: String(u.name || ""),
          })),
          "smart_team_fallback_users"
        );
        if (seqPick) {
          chosenMember = {
            staff_id: seqPick.chosen.id,
            staff_name: seqPick.chosen.name,
          };
        }
      }
    }
  }

  const staffId = chosenMember ? String(chosenMember.staff_id) : null;
  const staffName = chosenMember ? String(chosenMember.staff_name) : null;

  await conv.execute({
    sql: `UPDATE conversations
          SET status = 'ASSIGNED',
              assigned_team_id = ?,
              assigned_team_name = ?,
              assigned_staff_id = ?,
              assigned_staff_name = ?,
              escalation_level = ?,
              waiting_since = CASE
                WHEN ? = 1 THEN COALESCE(waiting_since, ?)
                ELSE waiting_since
              END
          WHERE id = ?`,
    args: [
      teamId,
      teamName,
      staffId,
      staffName,
      chosenTier,
      params.startWaitingTimer ? 1 : 0,
      nowIso,
      params.conversationId,
    ],
  });

  const assignmentReason =
    stickyReasonOverride ||
    params.handoffReasonFromAcrio ||
    `Assigned in A-Z sequence${sequentialOrderNote} (${chosenTier} in ${teamName})`;

  await logConversationAssignment({
    conversationId: params.conversationId,
    customerPhone: String(current.customer_phone || ""),
    customerName: String(current.customer_name || ""),
    fromStaffId: current.assigned_staff_id ? String(current.assigned_staff_id) : null,
    fromStaffName: current.assigned_staff_name ? String(current.assigned_staff_name) : null,
    fromTeamName: current.assigned_team_name ? String(current.assigned_team_name) : null,
    toStaffId: staffId,
    toStaffName: staffName || teamName,
    toTeamId: teamId,
    toTeamName: teamName,
    escalationLevel: chosenTier,
    assignmentSource: params.handoffReasonFromAcrio
      ? "ACRIO_HANDOFF"
      : "SMART_ASSIGN",
    assignedByName: params.handoffReasonFromAcrio
      ? "System (ACRIO)"
      : params.triggeredByName || "Smart Router",
    reason: assignmentReason,
    assignedAt: nowIso,
  });

  // Notify assigned individual staff member via email & WhatsApp template (`cc_quote_request_alert` or `cc_staff_client_assignment`)
  if (staffId && staffId !== "ACRIO" && staffId !== existingStaffId) {
    void sendStaffAssignmentEmailNotification({
      staffId,
      staffName: staffName || "Team Member",
      customerName: String(current.customer_name || current.customer_phone || "Customer"),
      customerPhone: String(current.customer_phone || ""),
      smartCategory: String(current.smart_category || "General Enquiry"),
      priority: String(current.priority || "HIGH"),
      escalationLevel: chosenTier,
      teamName,
      reason: assignmentReason,
      latestMessage: String(
        params.inboundText || current.last_message_preview || ""
      ),
      quoteProduct: params.quoteProduct,
      quoteQuantity: params.quoteQuantity,
      conversationId: params.conversationId,
      isEscalation: false,
    }).catch(() => {});
  }

  socketHub.emit("conversation:assigned", {
    conversationId: params.conversationId,
    assignedTeamName: teamName,
    assignedStaffName: staffName,
    escalationLevel: chosenTier,
  });

  return {
    assignedTeamId: teamId,
    assignedTeamName: teamName,
    assignedStaffId: staffId,
    assignedStaffName: staffName,
    escalationLevel: chosenTier,
  };
}

