import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@cc/auth";
import { getRawLibSqlClient, parseConversationCollaborators } from "@cc/database";
import { ensureBackgroundWorkersRunning } from "@cc/workers";

async function fetchMissingLastMessageFallback(
  conv: ReturnType<typeof getRawLibSqlClient>,
  missingIds: string[]
): Promise<Map<string, { direction: string; status: string }>> {
  const fallbackMap = new Map<string, { direction: string; status: string }>();
  if (missingIds.length === 0) return fallbackMap;

  for (let i = 0; i < missingIds.length; i += 400) {
    const chunk = missingIds.slice(i, i + 400);
    const placeholders = chunk.map(() => "?").join(",");
    const res = await conv.execute({
      sql: `SELECT conversation_id, direction, delivery_status
            FROM (
              SELECT conversation_id, direction, delivery_status,
                     ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at DESC, rowid DESC) AS rn
              FROM messages
              WHERE conversation_id IN (${placeholders})
                AND direction IN ('INBOUND', 'OUTBOUND')
            )
            WHERE rn = 1`,
      args: chunk,
    });
    for (const row of res.rows) {
      fallbackMap.set(String(row.conversation_id), {
        direction: String(row.direction),
        status: String(row.delivery_status),
      });
    }
  }
  return fallbackMap;
}

export async function handleGetConversations(
  req: Request,
  user: AuthenticatedUser
) {
  ensureBackgroundWorkersRunning();

  const conv = getRawLibSqlClient("conversations");
  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status") || "ALL";
  const categoryFilter = searchParams.get("category") || "ALL";
  const teamFilter = searchParams.get("teamId") || "ALL";
  const waitingOnly = searchParams.get("waiting") === "1";
  const acrioOnly = searchParams.get("acrio") === "1";
  const mineOnly = searchParams.get("mine") === "1";
  const staffFilter = searchParams.get("staffId") || "ALL";
  const activeOnly = searchParams.get("activeOnly") === "1";
  const searchQuery = (searchParams.get("q") || "").trim();
  const requestedLimit = Number(searchParams.get("limit") || 400);
  const limit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 400, 50),
    1000
  );

  const whereParts: string[] = [];
  const args: (string | number)[] = [];
  if (statusFilter !== "ALL") {
    whereParts.push(`c.status = ?`);
    args.push(statusFilter);
  }
  if (activeOnly || waitingOnly || acrioOnly) {
    whereParts.push(`c.status != 'RESOLVED'`);
  }
  if (categoryFilter !== "ALL") {
    whereParts.push(`c.smart_category = ?`);
    args.push(categoryFilter);
  }
  if (teamFilter !== "ALL") {
    whereParts.push(`c.assigned_team_id = ?`);
    args.push(teamFilter);
  }
  if (waitingOnly) {
    whereParts.push(`c.waiting_since IS NOT NULL`);
  }
  if (acrioOnly) {
    whereParts.push(`c.assigned_staff_id = 'ACRIO'`);
  }
  if (searchQuery) {
    const like = `%${searchQuery}%`;
    whereParts.push(
      `(c.customer_name LIKE ? OR c.customer_phone LIKE ? OR c.last_message_preview LIKE ?)`
    );
    args.push(like, like, like);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
  args.push(limit);

  const res = await conv.execute({
    sql: `SELECT c.*
          FROM conversations c
          ${whereSql}
          ORDER BY
            CASE WHEN c.status != 'RESOLVED' AND c.waiting_since IS NOT NULL THEN 0
                 WHEN c.status != 'RESOLVED' THEN 1
                 ELSE 2 END,
            c.last_message_at DESC
          LIMIT ?`,
    args,
  });

  const missingIds = res.rows
    .filter((r) => !r.last_message_direction || !r.last_message_status)
    .map((r) => String(r.id));
  const fallbackMap = await fetchMissingLastMessageFallback(conv, missingIds);

  let items = res.rows.map((r) => {
    const cid = String(r.id);
    const fb = fallbackMap.get(cid);
    const resolvedDir = r.last_message_direction
      ? String(r.last_message_direction)
      : fb?.direction || null;
    const resolvedStatus = r.last_message_status
      ? String(r.last_message_status)
      : fb?.status || null;

    return {
      id: cid,
      customerPhone: String(r.customer_phone),
      customerName: String(r.customer_name),
      customerId: r.customer_id ? String(r.customer_id) : null,
      status: String(r.status),
      priority: String(r.priority),
      smartCategory: String(r.smart_category),
      assignedStaffId: r.assigned_staff_id ? String(r.assigned_staff_id) : null,
      assignedStaffName: r.assigned_staff_name
        ? String(r.assigned_staff_name)
        : null,
      assignedTeamId: r.assigned_team_id ? String(r.assigned_team_id) : null,
      assignedTeamName: r.assigned_team_name ? String(r.assigned_team_name) : null,
      escalationLevel: String(r.escalation_level || "P0"),
      waitingSince: r.waiting_since ? String(r.waiting_since) : null,
      lastResponseSeconds:
        r.last_response_seconds !== null && r.last_response_seconds !== undefined
          ? Number(r.last_response_seconds)
          : null,
      escalatedAt: r.escalated_at ? String(r.escalated_at) : null,
      unreadCount: Number(r.unread_count ?? 0),
      lastMessagePreview: String(r.last_message_preview || ""),
      lastMessageAt: String(r.last_message_at),
      lastMessageDirection: resolvedDir,
      lastMessageStatus: resolvedStatus,
      windowExpiresAt: r.window_expires_at ? String(r.window_expires_at) : null,
      resolutionSummary: r.resolution_summary ? String(r.resolution_summary) : null,
      resolvedByName: r.resolved_by_name ? String(r.resolved_by_name) : null,
      tags: (() => {
        try {
          return JSON.parse(String(r.tags_json || "[]"));
        } catch {
          return [];
        }
      })(),
      collaborators: parseConversationCollaborators(r.collaborators_json),
    };
  });

  if (statusFilter !== "ALL") {
    items = items.filter((c) => c.status === statusFilter);
  }
  if (activeOnly) {
    items = items.filter((c) => c.status !== "RESOLVED");
  }
  if (categoryFilter !== "ALL") {
    items = items.filter((c) => c.smartCategory === categoryFilter);
  }
  if (teamFilter !== "ALL") {
    items = items.filter((c) => c.assignedTeamId === teamFilter);
  }
  if (waitingOnly) {
    items = items.filter((c) => c.status !== "RESOLVED" && Boolean(c.waitingSince));
  }
  if (acrioOnly) {
    items = items.filter(
      (c) => c.status !== "RESOLVED" && c.assignedStaffId === "ACRIO"
    );
  }
  if (mineOnly) {
    items = items.filter(
      (c) =>
        c.assignedStaffId === user.id ||
        c.collaborators.some((cb) => cb.staffId === user.id)
    );
  }
  if (staffFilter !== "ALL") {
    items = items.filter(
      (c) =>
        c.assignedStaffId === staffFilter ||
        c.collaborators.some((cb) => cb.staffId === staffFilter)
    );
  }

  return NextResponse.json({ ok: true, conversations: items });
}
