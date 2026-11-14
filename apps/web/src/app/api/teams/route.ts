import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { checkAndEscalateWaitingChats } from "@cc/workers";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Active staff access required." }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  await checkAndEscalateWaitingChats().catch(() => {});

  const conv = getRawLibSqlClient("conversations");
  const auth = getRawLibSqlClient("core_auth");

  const [teamsRes, membersRes, activeStaffRes, openLoadRes, waitingRes] = await Promise.all([
    conv.execute(`SELECT * FROM teams ORDER BY priority_rank ASC, created_at ASC`),
    conv.execute(`SELECT * FROM team_members ORDER BY CASE tier WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, staff_name ASC`),
    auth.execute(
      `SELECT id, name, email, whatsapp_number, role, department
       FROM users
       WHERE status = 'ACTIVE' AND role != 'CLIENT'
       ORDER BY name ASC`
    ),
    conv.execute(
      `SELECT assigned_staff_id, COUNT(*) as open_cnt
       FROM conversations
       WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL
       GROUP BY assigned_staff_id`
    ),
    conv.execute(
      `SELECT assigned_team_id, COUNT(*) as waiting_cnt
       FROM conversations
       WHERE status != 'RESOLVED' AND waiting_since IS NOT NULL
       GROUP BY assigned_team_id`
    ),
  ]);

  const loadMap = new Map<string, number>();
  for (const r of openLoadRes.rows) {
    loadMap.set(String(r.assigned_staff_id), Number(r.open_cnt ?? 0));
  }

  const waitingByTeam = new Map<string, number>();
  for (const r of waitingRes.rows) {
    if (r.assigned_team_id) {
      waitingByTeam.set(String(r.assigned_team_id), Number(r.waiting_cnt ?? 0));
    }
  }

  const allMembers = membersRes.rows.map((m) => ({
    id: String(m.id),
    teamId: String(m.team_id),
    staffId: String(m.staff_id),
    staffName: String(m.staff_name),
    staffEmail: String(m.staff_email || ""),
    tier: String(m.tier || "P0") as "P0" | "P1" | "P2",
    maxActiveChats: Number(m.max_active_chats ?? 15),
    isAvailable: Number(m.is_available ?? 1) === 1,
    activeOpenChats: loadMap.get(String(m.staff_id)) ?? 0,
  }));

  const teams = teamsRes.rows.map((t) => {
    const id = String(t.id);
    return {
      id,
      name: String(t.name),
      description: String(t.description || ""),
      brandScope: String(t.brand_scope || "ALL"),
      routingKeywords: String(t.routing_keywords || ""),
      priorityRank: Number(t.priority_rank ?? 10),
      p0WaitMinutes: Number(t.p0_wait_minutes ?? 5),
      p1WaitMinutes: Number(t.p1_wait_minutes ?? 12),
      autoAssignEnabled: Number(t.auto_assign_enabled ?? 1) === 1,
      waitingChatsCount: waitingByTeam.get(id) ?? 0,
      members: allMembers.filter((m) => m.teamId === id),
    };
  });

  const activeStaff = activeStaffRes.rows.map((u) => ({
    id: String(u.id),
    name: String(u.name),
    email: String(u.email),
    whatsappNumber: String(u.whatsapp_number || ""),
    role: String(u.role),
    department: String(u.department || ""),
    activeOpenChats: loadMap.get(String(u.id)) ?? 0,
  }));

  return NextResponse.json({
    ok: true,
    teams,
    activeStaff,
    canManage: ["DEV", "SUPERADMIN", "ADMIN"].includes(user.role),
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !["DEV", "SUPERADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ ok: false, error: "Admin access required to manage teams." }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const auth = getRawLibSqlClient("core_auth");
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const nowIso = new Date().toISOString();

  if (action === "create_team") {
    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json({ ok: false, error: "Please enter a team name." }, { status: 400 });
    }
    const id = `team_${crypto.randomUUID().slice(0, 8)}`;
    await conv.execute({
      sql: `INSERT INTO teams (
        id, name, description, brand_scope, routing_keywords, priority_rank,
        p0_wait_minutes, p1_wait_minutes, auto_assign_enabled, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        name,
        String(body.description || "").trim(),
        String(body.brandScope || "ALL"),
        String(body.routingKeywords || "").trim(),
        Math.max(1, Number(body.priorityRank || 5)),
        Math.max(1, Number(body.p0WaitMinutes || 5)),
        Math.max(2, Number(body.p1WaitMinutes || 12)),
        body.autoAssignEnabled === false ? 0 : 1,
        nowIso,
      ],
    });
    return NextResponse.json({ ok: true, teamId: id });
  }

  if (action === "update_team") {
    const teamId = String(body.teamId || "");
    if (!teamId) {
      return NextResponse.json({ ok: false, error: "Missing team ID." }, { status: 400 });
    }
    await conv.execute({
      sql: `UPDATE teams
            SET name = COALESCE(?, name),
                description = COALESCE(?, description),
                brand_scope = COALESCE(?, brand_scope),
                routing_keywords = COALESCE(?, routing_keywords),
                priority_rank = COALESCE(?, priority_rank),
                p0_wait_minutes = COALESCE(?, p0_wait_minutes),
                p1_wait_minutes = COALESCE(?, p1_wait_minutes),
                auto_assign_enabled = COALESCE(?, auto_assign_enabled)
            WHERE id = ?`,
      args: [
        body.name !== undefined ? String(body.name).trim() : null,
        body.description !== undefined ? String(body.description).trim() : null,
        body.brandScope !== undefined ? String(body.brandScope) : null,
        body.routingKeywords !== undefined ? String(body.routingKeywords).trim() : null,
        body.priorityRank !== undefined ? Math.max(1, Number(body.priorityRank)) : null,
        body.p0WaitMinutes !== undefined ? Math.max(1, Number(body.p0WaitMinutes)) : null,
        body.p1WaitMinutes !== undefined ? Math.max(2, Number(body.p1WaitMinutes)) : null,
        body.autoAssignEnabled !== undefined ? (body.autoAssignEnabled ? 1 : 0) : null,
        teamId,
      ],
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete_team") {
    const teamId = String(body.teamId || "");
    await conv.batch(
      [
        { sql: `DELETE FROM team_members WHERE team_id = ?`, args: [teamId] },
        { sql: `DELETE FROM teams WHERE id = ?`, args: [teamId] },
      ],
      "write"
    );
    return NextResponse.json({ ok: true });
  }

  if (action === "add_member") {
    const teamId = String(body.teamId || "");
    const staffId = String(body.staffId || "");
    const tier =
      body.tier === "P1" || body.tier === "P2" ? body.tier : "P0";

    const uRes = await auth.execute({
      sql: `SELECT id, name, email FROM users WHERE id = ? LIMIT 1`,
      args: [staffId],
    });
    const staffRow = uRes.rows[0];
    if (!staffRow || !teamId) {
      return NextResponse.json({ ok: false, error: "Select a valid team and staff member." }, { status: 400 });
    }

    // Remove existing membership in the same team so we cleanly update their P0/P1/P2 tier
    await conv.execute({
      sql: `DELETE FROM team_members WHERE team_id = ? AND staff_id = ?`,
      args: [teamId, staffId],
    });

    await conv.execute({
      sql: `INSERT INTO team_members (
        id, team_id, staff_id, staff_name, staff_email, tier, max_active_chats, is_available, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      args: [
        `tm_${crypto.randomUUID().slice(0, 8)}`,
        teamId,
        staffId,
        String(staffRow.name),
        String(staffRow.email || ""),
        tier,
        Math.max(1, Number(body.maxActiveChats || 15)),
        nowIso,
      ],
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "toggle_member_availability") {
    const memberId = String(body.memberId || "");
    const isAvailable = body.isAvailable ? 1 : 0;
    await conv.execute({
      sql: `UPDATE team_members SET is_available = ? WHERE id = ?`,
      args: [isAvailable, memberId],
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "remove_member") {
    const memberId = String(body.memberId || "");
    await conv.execute({
      sql: `DELETE FROM team_members WHERE id = ?`,
      args: [memberId],
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "run_escalation_now") {
    const escalated = await checkAndEscalateWaitingChats();
    return NextResponse.json({ ok: true, escalated });
  }

  return NextResponse.json({ ok: false, error: "Unsupported team action." }, { status: 400 });
}
