import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@cc/auth";
import {
  dispatchSystemEmail,
  getSmtpConfigSummary,
  listRecentEmailDispatchLogs,
  saveSmtpConfig,
} from "@cc/connections";
import {
  checkEcosystemBridgesHealth,
  getRawLibSqlClient,
} from "@cc/database";
import { checkAndEscalateWaitingChats } from "@cc/workers";

export async function handleGetTeams(user: AuthenticatedUser) {
  await checkAndEscalateWaitingChats().catch(() => {});

  const conv = getRawLibSqlClient("conversations");
  const auth = getRawLibSqlClient("core_auth");
  const canManage = ["DEV", "SUPERADMIN", "ADMIN", "MANAGER"].includes(user.role);

  const [
    teamsRes,
    membersRes,
    activeStaffRes,
    openLoadRes,
    waitingRes,
    smtpSummary,
    emailLogs,
    ecosystemHealth,
  ] = await Promise.all([
    conv.execute(`SELECT * FROM teams ORDER BY priority_rank ASC, created_at ASC`),
    conv.execute(
      `SELECT * FROM team_members ORDER BY CASE tier WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, staff_name ASC`
    ),
    auth.execute(
      `SELECT id, name, email, whatsapp_number, role, department
       FROM users
       WHERE status = 'ACTIVE' AND role NOT IN ('CLIENT', 'DEV')
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
    canManage ? getSmtpConfigSummary() : Promise.resolve(null),
    canManage ? listRecentEmailDispatchLogs(25) : Promise.resolve([]),
    checkEcosystemBridgesHealth(),
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
    emailAlertsEnabled: Number(m.email_alerts_enabled ?? 1) === 1,
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
    canManage,
    smtpSummary,
    emailLogs,
    ecosystemHealth,
  });
}

export async function handleTeamPostAction(
  user: AuthenticatedUser,
  body: Record<string, unknown>
) {
  const conv = getRawLibSqlClient("conversations");
  const auth = getRawLibSqlClient("core_auth");
  const action = String(body.action || "");
  const nowIso = new Date().toISOString();

  if (action === "create_team") {
    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json(
        { ok: false, error: "Please enter a team name." },
        { status: 400 }
      );
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

  if (action === "add_member" || action === "add_members_bulk") {
    const teamId = String(body.teamId || "");
    const rawIds: string[] = Array.isArray(body.staffIds)
      ? body.staffIds.map((x: unknown) => String(x || "").trim()).filter(Boolean)
      : body.staffId
      ? [String(body.staffId).trim()]
      : [];
    const uniqueStaffIds = Array.from(new Set(rawIds));
    const tier = body.tier === "P1" || body.tier === "P2" ? body.tier : "P0";
    const maxCap = Math.max(1, Number(body.maxActiveChats || 15));

    if (!teamId || uniqueStaffIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Select a valid team and at least one staff member." },
        { status: 400 }
      );
    }

    const placeholders = uniqueStaffIds.map(() => "?").join(",");
    const uRes = await auth.execute({
      sql: `SELECT id, name, email, role FROM users WHERE id IN (${placeholders})`,
      args: uniqueStaffIds,
    });
    const validRows = uRes.rows.filter((r) => String(r.role) !== "DEV");
    if (validRows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Dev accounts cannot be placed in automated round-robin pools. Please select active staff, admin, or manager accounts.",
        },
        { status: 400 }
      );
    }

    for (const staffRow of validRows) {
      const sid = String(staffRow.id);
      await conv.execute({
        sql: `DELETE FROM team_members WHERE team_id = ? AND staff_id = ?`,
        args: [teamId, sid],
      });
      await conv.execute({
        sql: `INSERT INTO team_members (
          id, team_id, staff_id, staff_name, staff_email, tier, max_active_chats, is_available, email_alerts_enabled, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
        args: [
          `tm_${crypto.randomUUID().slice(0, 8)}`,
          teamId,
          sid,
          String(staffRow.name),
          String(staffRow.email || ""),
          tier,
          maxCap,
          nowIso,
        ],
      });
    }

    return NextResponse.json({ ok: true, addedCount: validRows.length });
  }

  if (action === "toggle_member_availability") {
    await conv.execute({
      sql: `UPDATE team_members SET is_available = ? WHERE id = ?`,
      args: [body.isAvailable ? 1 : 0, String(body.memberId || "")],
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "toggle_member_email_alerts") {
    await conv.execute({
      sql: `UPDATE team_members SET email_alerts_enabled = ? WHERE id = ?`,
      args: [body.emailAlertsEnabled ? 1 : 0, String(body.memberId || "")],
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "update_member_capacity") {
    const memberId = String(body.memberId || "");
    const maxActiveChats = Math.min(100, Math.max(1, Number(body.maxActiveChats || 15)));
    const tier =
      body.tier === "P0" || body.tier === "P1" || body.tier === "P2"
        ? body.tier
        : undefined;
    if (tier) {
      await conv.execute({
        sql: `UPDATE team_members SET max_active_chats = ?, tier = ? WHERE id = ?`,
        args: [maxActiveChats, tier, memberId],
      });
    } else {
      await conv.execute({
        sql: `UPDATE team_members SET max_active_chats = ? WHERE id = ?`,
        args: [maxActiveChats, memberId],
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "remove_member") {
    await conv.execute({
      sql: `DELETE FROM team_members WHERE id = ?`,
      args: [String(body.memberId || "")],
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "run_escalation_now") {
    const escalated = await checkAndEscalateWaitingChats();
    return NextResponse.json({ ok: true, escalated });
  }

  if (action === "save_smtp_config") {
    if (!["DEV", "SUPERADMIN"].includes(user.role)) {
      return NextResponse.json(
        { ok: false, error: "Only Superadmin or Dev can modify SMTP server credentials." },
        { status: 403 }
      );
    }
    const host = String(body.host || "").trim();
    const smtpUser = String(body.user || "").trim();
    if (!host || !smtpUser) {
      return NextResponse.json(
        { ok: false, error: "SMTP Host and Username are required." },
        { status: 400 }
      );
    }
    await saveSmtpConfig({
      host,
      port: Number(body.port || 587),
      user: smtpUser,
      pass: body.pass ? String(body.pass) : undefined,
      from: body.from ? String(body.from) : undefined,
    });
    const summary = await getSmtpConfigSummary();
    return NextResponse.json({
      ok: true,
      smtpSummary: summary,
      message: "SMTP dispatch credentials saved.",
    });
  }

  if (action === "send_test_email") {
    const targetEmail = String(body.toEmail || user.email || "").trim();
    const res = await dispatchSystemEmail({
      to: targetEmail,
      recipientName: user.name,
      subject: "[Test Dispatch] Classic Concepts WhatsApp Assignment Mailer",
      text: `Hello ${user.name},\n\nThis is a live test email from your Classic Concepts WhatsApp Staff Hub (:3007).\nWhenever a chat is assigned or escalated to a team member, they receive an instant email alert with a 1-click Inbox button.\n`,
      dispatchType: "SMTP_TEST",
    });
    return NextResponse.json(
      {
        ok: res.ok,
        via: res.via,
        error: res.error,
        message: res.ok
          ? `Test email delivered to ${targetEmail} (via ${res.via}).`
          : res.error || "Could not send test email.",
      },
      { status: res.ok ? 200 : 400 }
    );
  }

  return NextResponse.json(
    { ok: false, error: "Unsupported team action." },
    { status: 400 }
  );
}
