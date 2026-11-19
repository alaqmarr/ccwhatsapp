import crypto from "node:crypto";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";

// Conversation assignment and first-response tracking engine

export type AssignmentSourceType =
  | "INITIAL_SYSTEM"
  | "ACRIO_HANDOFF"
  | "SMART_ASSIGN"
  | "MANUAL_ASSIGN"
  | "STAFF_TAKEOVER"
  | "AUTO_ESCALATION"
  | "REOPEN"
  | "OUTBOUND_START"
  | "RETURN_TO_SYSTEM"
  | "CALL_DISPATCH_QUEUE"
  | "REQUESTED_BY_CUSTOMER"
  | "PREFERRED_STAFF"
  | "PAST_HANDLER"
  | "WHATSAPP_FIRST_COME_CLAIM";

async function patchAssignmentEventMessageMeta(
  assignmentId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const conv = getRawLibSqlClient("conversations");
  const msgRes = await conv.execute({
    sql: `SELECT id, metadata_json
          FROM messages
          WHERE message_type = 'ASSIGNMENT_EVENT'
            AND metadata_json LIKE ?
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [`%${assignmentId}%`],
  });
  const row = msgRes.rows[0];
  if (!row) return;
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(String(row.metadata_json || "{}"));
  } catch {
    meta = {};
  }
  const merged = { ...meta, ...patch };
  await conv.execute({
    sql: `UPDATE messages SET metadata_json = ? WHERE id = ?`,
    args: [JSON.stringify(merged), String(row.id)],
  });
}

export async function logConversationAssignment(params: {
  conversationId: string;
  customerPhone?: string;
  customerName?: string;
  fromStaffId?: string | null;
  fromStaffName?: string | null;
  fromTeamName?: string | null;
  toStaffId: string | null;
  toStaffName: string;
  toTeamId?: string | null;
  toTeamName: string;
  escalationLevel?: string;
  assignmentSource: AssignmentSourceType;
  assignedByName: string;
  reason?: string;
  assignedAt?: string;
}): Promise<string> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const assignedAt = params.assignedAt || new Date().toISOString();
  const tier = params.escalationLevel || "P0";

  // Resolve customer name/phone if omitted
  let customerPhone = params.customerPhone || "";
  let customerName = params.customerName || "";
  if (!customerPhone || !customerName) {
    const cRes = await conv.execute({
      sql: `SELECT customer_phone, customer_name FROM conversations WHERE id = ? LIMIT 1`,
      args: [params.conversationId],
    });
    if (cRes.rows[0]) {
      customerPhone = customerPhone || String(cRes.rows[0].customer_phone || "");
      customerName = customerName || String(cRes.rows[0].customer_name || "");
    }
  }

  // Close any previous open assignment on this conversation
  const openRes = await conv.execute({
    sql: `SELECT id, first_response_at
          FROM conversation_assignments
          WHERE conversation_id = ? AND ended_at IS NULL`,
    args: [params.conversationId],
  });

  for (const prev of openRes.rows) {
    const prevId = String(prev.id);
    const hadReply = Boolean(prev.first_response_at);
    const prevOutcome = hadReply
      ? "RESPONDED"
      : params.assignmentSource === "AUTO_ESCALATION"
      ? "ESCALATED"
      : "REASSIGNED";
    await conv.execute({
      sql: `UPDATE conversation_assignments
            SET ended_at = ?, outcome = ?
            WHERE id = ?`,
      args: [assignedAt, prevOutcome, prevId],
    });
    await patchAssignmentEventMessageMeta(prevId, {
      endedAt: assignedAt,
      outcome: prevOutcome,
    });
  }

  const assignmentId = `asg_${crypto.randomUUID().slice(0, 10)}`;
  const reason = params.reason || "";

  await conv.execute({
    sql: `INSERT INTO conversation_assignments (
      id, conversation_id, customer_phone, customer_name,
      from_staff_id, from_staff_name, from_team_name,
      to_staff_id, to_staff_name, to_team_id, to_team_name,
      escalation_level, assignment_source, assigned_by_name, reason,
      assigned_at, outcome
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    args: [
      assignmentId,
      params.conversationId,
      customerPhone,
      customerName,
      params.fromStaffId ?? null,
      params.fromStaffName ?? null,
      params.fromTeamName ?? null,
      params.toStaffId,
      params.toStaffName,
      params.toTeamId ?? null,
      params.toTeamName,
      tier,
      params.assignmentSource,
      params.assignedByName,
      reason,
      assignedAt,
    ],
  });

  // Build plain-language timeline message for chat history
  let summaryBody = "";
  if (params.toStaffId === "ACRIO") {
    summaryBody =
      params.assignmentSource === "INITIAL_SYSTEM"
        ? "Assigned to System (ACRIO) for automatic handling."
        : `${params.assignedByName} assigned this chat to System (ACRIO).`;
  } else if (params.assignmentSource === "AUTO_ESCALATION") {
    summaryBody = `${reason} Assigned to ${params.toStaffName} (${params.toTeamName} • ${tier}).`;
  } else if (params.assignmentSource === "ACRIO_HANDOFF") {
    summaryBody = `${reason ? `${reason} ` : ""}Connected by ACRIO to ${params.toTeamName} (${tier}: ${params.toStaffName}).`;
  } else if (params.assignmentSource === "STAFF_TAKEOVER") {
    summaryBody = `${params.toStaffName} took over this chat (${params.toTeamName} • ${tier}).`;
  } else if (params.assignmentSource === "REOPEN") {
    summaryBody = `${params.assignedByName} reopened this chat under ${params.toTeamName} (${params.toStaffName}).`;
  } else if (params.assignmentSource === "OUTBOUND_START") {
    summaryBody = `${params.toStaffName} (${params.toTeamName}) started this outbound chat.`;
  } else {
    summaryBody = `${params.assignedByName} assigned this chat to ${params.toStaffName} (${params.toTeamName} • ${tier}).`;
  }

  const meta = {
    assignmentId,
    fromStaffName: params.fromStaffName ?? null,
    fromTeamName: params.fromTeamName ?? null,
    toStaffId: params.toStaffId,
    toStaffName: params.toStaffName,
    toTeamId: params.toTeamId ?? null,
    toTeamName: params.toTeamName,
    escalationLevel: tier,
    assignmentSource: params.assignmentSource,
    assignedByName: params.assignedByName,
    reason,
    assignedAt,
    firstResponseAt: null,
    firstResponseSeconds: null,
    firstResponderName: null,
    outcome: "ACTIVE",
  };

  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, direction, sender_type, sender_name, message_type,
      billing_category, body, metadata_json, delivery_status, created_at
    ) VALUES (?, ?, 'INTERNAL', 'SYSTEM_EVENT', ?, 'ASSIGNMENT_EVENT', 'INTERNAL', ?, ?, 'SAVED', ?)`,
    args: [
      `msg_asg_${crypto.randomUUID().slice(0, 8)}`,
      params.conversationId,
      params.assignedByName,
      summaryBody,
      JSON.stringify(meta),
      assignedAt,
    ],
  });

  return assignmentId;
}

/**
 * Records the assigned person's first outbound response timestamp and elapsed seconds,
 * updating both `conversation_assignments` and the inline `ASSIGNMENT_EVENT` chat timeline card!
 */
export async function recordAssignedFirstResponse(params: {
  conversationId: string;
  responderId: string;
  responderName: string;
  responderTeamId?: string | null;
  responderTeamName?: string | null;
  messageId: string;
  respondedAt?: string;
  overrideWaitSeconds?: number | null;
}): Promise<{ assignmentId: string; firstResponseSeconds: number } | null> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const respondedAt = params.respondedAt || new Date().toISOString();
  const respondedMs = new Date(respondedAt).getTime();

  const openRes = await conv.execute({
    sql: `SELECT *
          FROM conversation_assignments
          WHERE conversation_id = ? AND ended_at IS NULL
          ORDER BY assigned_at DESC
          LIMIT 1`,
    args: [params.conversationId],
  });

  const activeRow = openRes.rows[0] as Record<string, unknown> | undefined;
  const isHumanReply = params.responderId !== "ACRIO";
  const currentAssigneeId = activeRow?.to_staff_id
    ? String(activeRow.to_staff_id)
    : "";

  // If a human staff member replies directly while chat was on ACRIO or had no open assignment,
  // log their STAFF_TAKEOVER 1ms before their message and record their first response cleanly!
  if (isHumanReply && (!activeRow || currentAssigneeId === "ACRIO")) {
    const takeoverIso = new Date(Math.max(0, respondedMs - 1)).toISOString();
    const newAsgId = await logConversationAssignment({
      conversationId: params.conversationId,
      fromStaffId: currentAssigneeId || null,
      fromStaffName: activeRow?.to_staff_name
        ? String(activeRow.to_staff_name)
        : null,
      fromTeamName: activeRow?.to_team_name
        ? String(activeRow.to_team_name)
        : null,
      toStaffId: params.responderId,
      toStaffName: params.responderName,
      toTeamId: params.responderTeamId ?? "team_sales",
      toTeamName: params.responderTeamName || "Sales Team",
      escalationLevel: "P0",
      assignmentSource: "STAFF_TAKEOVER",
      assignedByName: params.responderName,
      reason: "Replied directly and took ownership from System (ACRIO)",
      assignedAt: takeoverIso,
    });
    const secs =
      params.overrideWaitSeconds !== null &&
      params.overrideWaitSeconds !== undefined &&
      params.overrideWaitSeconds > 0
        ? params.overrideWaitSeconds
        : 1;

    await conv.execute({
      sql: `UPDATE conversation_assignments
            SET first_response_at = ?,
                first_response_seconds = ?,
                first_response_message_id = ?,
                outcome = 'RESPONDED'
            WHERE id = ?`,
      args: [respondedAt, secs, params.messageId, newAsgId],
    });
    await patchAssignmentEventMessageMeta(newAsgId, {
      firstResponseAt: respondedAt,
      firstResponseSeconds: secs,
      firstResponderName: params.responderName,
      outcome: "RESPONDED",
    });
    return { assignmentId: newAsgId, firstResponseSeconds: secs };
  }

  if (!activeRow) return null;

  // Already recorded first response on this assignment
  if (activeRow.first_response_at) {
    return null;
  }

  // If ACRIO replies, only record against an ACRIO assignment
  if (!isHumanReply && currentAssigneeId !== "ACRIO") {
    return null;
  }

  const assignmentId = String(activeRow.id);
  const assignedMs = new Date(String(activeRow.assigned_at)).getTime();
  const computedSecs = Number.isNaN(assignedMs)
    ? 1
    : Math.max(1, Math.round((respondedMs - assignedMs) / 1000));

  // If the chat was queued to a team without a specific person (`to_staff_id IS NULL`),
  // attribute the assignment & conversation directly to the real staff member who answered!
  if (isHumanReply && !currentAssigneeId) {
    await Promise.all([
      conv.execute({
        sql: `UPDATE conversation_assignments
              SET to_staff_id = ?,
                  to_staff_name = ?,
                  first_response_at = ?,
                  first_response_seconds = ?,
                  first_response_message_id = ?,
                  outcome = 'RESPONDED'
              WHERE id = ?`,
        args: [
          params.responderId,
          params.responderName,
          respondedAt,
          computedSecs,
          params.messageId,
          assignmentId,
        ],
      }),
      conv.execute({
        sql: `UPDATE conversations
              SET assigned_staff_id = ?,
                  assigned_staff_name = ?
              WHERE id = ? AND (assigned_staff_id IS NULL OR assigned_staff_id = '')`,
        args: [params.responderId, params.responderName, params.conversationId],
      }),
    ]);
  } else {
    await conv.execute({
      sql: `UPDATE conversation_assignments
            SET first_response_at = ?,
                first_response_seconds = ?,
                first_response_message_id = ?,
                outcome = 'RESPONDED'
            WHERE id = ?`,
      args: [respondedAt, computedSecs, params.messageId, assignmentId],
    });
  }

  await patchAssignmentEventMessageMeta(assignmentId, {
    ...(isHumanReply && !currentAssigneeId
      ? { toStaffId: params.responderId, toStaffName: params.responderName }
      : {}),
    firstResponseAt: respondedAt,
    firstResponseSeconds: computedSecs,
    firstResponderName: params.responderName,
    outcome: "RESPONDED",
  });

  return { assignmentId, firstResponseSeconds: computedSecs };
}

export async function closeActiveAssignmentOnResolve(
  conversationId: string,
  resolvedAt?: string
): Promise<void> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const endIso = resolvedAt || new Date().toISOString();

  const openRes = await conv.execute({
    sql: `SELECT id, first_response_at
          FROM conversation_assignments
          WHERE conversation_id = ? AND ended_at IS NULL`,
    args: [conversationId],
  });

  for (const row of openRes.rows) {
    const asgId = String(row.id);
    const outcome = row.first_response_at ? "RESPONDED" : "RESOLVED";
    await conv.execute({
      sql: `UPDATE conversation_assignments
            SET ended_at = ?, outcome = ?
            WHERE id = ?`,
      args: [endIso, outcome, asgId],
    });
    await patchAssignmentEventMessageMeta(asgId, {
      endedAt: endIso,
      outcome,
    });
  }
}
