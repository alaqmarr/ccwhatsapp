import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const res = await conv.execute(`SELECT * FROM automations ORDER BY created_at DESC`);

  return NextResponse.json({
    ok: true,
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
      isEnabled: Number(r.is_enabled ?? 1) === 1,
      runsCount: Number(r.runs_count ?? 0),
      lastTriggeredAt: r.last_triggered_at ? String(r.last_triggered_at) : null,
    })),
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "automations:manage", user.status)) {
    return NextResponse.json({ ok: false, error: "Admin permission required." }, { status: 403 });
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
        id, name, description, trigger_type, trigger_condition, action_type, action_payload_json, is_enabled, runs_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
      args: [
        id,
        String(body.name || "Custom Automation"),
        String(body.description || "Automated workflow rule"),
        String(body.triggerType || "KEYWORD"),
        String(body.triggerCondition || ""),
        String(body.actionType || "SMART_TAG"),
        JSON.stringify(body.actionPayload || {}),
        new Date().toISOString(),
      ],
    });
    return NextResponse.json({ ok: true, id });
  }

  return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
}
