import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { evaluateAutomationRulesDryRun } from "@cc/workers";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const [res, teamsRes, mktRes] = await Promise.all([
    conv.execute(
      `SELECT * FROM automations ORDER BY COALESCE(priority_order, 10) ASC, created_at DESC`
    ),
    conv.execute(`SELECT id, name FROM teams ORDER BY priority_rank ASC`),
    getRawLibSqlClient("marketing").execute(
      `SELECT id, name, category, approval_status FROM templates WHERE approval_status = 'APPROVED' ORDER BY name ASC`
    ),
  ]);

  return NextResponse.json({
    ok: true,
    teams: teamsRes.rows.map((t) => ({
      id: String(t.id),
      name: String(t.name),
    })),
    approvedTemplates: mktRes.rows.map((t) => ({
      id: String(t.id),
      name: String(t.name),
      category: String(t.category),
    })),
    automations: res.rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      description: String(r.description),
      triggerType: String(r.trigger_type),
      triggerCondition: String(r.trigger_condition),
      actionType: String(r.action_type),
      actionPayload: (() => {
        try {
          return JSON.parse(String(r.action_payload_json || "{}"));
        } catch {
          return {};
        }
      })(),
      priorityOrder: Number(r.priority_order ?? 10),
      isEnabled: Number(r.is_enabled ?? 1) === 1,
      runsCount: Number(r.runs_count ?? 0),
      lastTriggeredAt: r.last_triggered_at ? String(r.last_triggered_at) : null,
      createdAt: String(r.created_at || ""),
    })),
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "automations:manage", user.status)) {
    return NextResponse.json(
      { ok: false, error: "Manager or Admin permission required." },
      { status: 403 }
    );
  }

  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "toggle");

  if (action === "toggle") {
    await conv.execute({
      sql: `UPDATE automations SET is_enabled = ? WHERE id = ?`,
      args: [body.isEnabled ? 1 : 0, String(body.id || "")],
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "create") {
    const id = `auto_${crypto.randomUUID().slice(0, 8)}`;
    await conv.execute({
      sql: `INSERT INTO automations (
        id, name, description, trigger_type, trigger_condition, action_type, action_payload_json, priority_order, is_enabled, runs_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
      args: [
        id,
        String(body.name || "Custom Auto-Reply Rule").trim(),
        String(body.description || "Automated WhatsApp workflow rule").trim(),
        String(body.triggerType || "CONTAINS"),
        String(body.triggerCondition || "").trim(),
        String(body.actionType || "AUTO_REPLY"),
        JSON.stringify(body.actionPayload || {}),
        Math.max(1, Number(body.priorityOrder || 10)),
        new Date().toISOString(),
      ],
    });
    return NextResponse.json({ ok: true, id });
  }

  if (action === "update") {
    const id = String(body.id || "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "Missing rule ID." }, { status: 400 });
    }
    await conv.execute({
      sql: `UPDATE automations
            SET name = ?,
                description = ?,
                trigger_type = ?,
                trigger_condition = ?,
                action_type = ?,
                action_payload_json = ?,
                priority_order = ?
            WHERE id = ?`,
      args: [
        String(body.name || "Custom Auto-Reply Rule").trim(),
        String(body.description || "").trim(),
        String(body.triggerType || "CONTAINS"),
        String(body.triggerCondition || "").trim(),
        String(body.actionType || "AUTO_REPLY"),
        JSON.stringify(body.actionPayload || {}),
        Math.max(1, Number(body.priorityOrder || 10)),
        id,
      ],
    });
    return NextResponse.json({ ok: true, id });
  }

  if (action === "delete") {
    const id = String(body.id || "").trim();
    await conv.execute({
      sql: `DELETE FROM automations WHERE id = ?`,
      args: [id],
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "test_rule") {
    const sim = await evaluateAutomationRulesDryRun({
      sampleText: String(body.sampleText || ""),
      isNewConversation: Boolean(body.isFirstContact ?? body.isNewConversation),
      buttonPayload: body.buttonPayload ? String(body.buttonPayload) : undefined,
    });
    return NextResponse.json({ ok: true, simulation: sim });
  }

  return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
}
