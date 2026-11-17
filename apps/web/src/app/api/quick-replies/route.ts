import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function normalizeQuickCommand(raw: string): string {
  const cleaned = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
  if (!cleaned) return "";
  return `/${cleaned}`;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const res = await conv.execute({
    sql: `SELECT * FROM staff_quick_replies
          WHERE staff_id = ? OR is_shared = 1
          ORDER BY CASE WHEN staff_id = ? THEN 0 ELSE 1 END, usage_count DESC, updated_at DESC`,
    args: [user.id, user.id],
  });

  const quickReplies = res.rows.map((r) => ({
    id: String(r.id),
    staffId: String(r.staff_id),
    staffName: String(r.staff_name || ""),
    cmd: String(r.cmd),
    title: String(r.title),
    body: String(r.body),
    isShared: Number(r.is_shared ?? 0) === 1,
    isMine: String(r.staff_id) === user.id,
    usageCount: Number(r.usage_count ?? 0),
    updatedAt: String(r.updated_at || ""),
  }));

  return NextResponse.json({ ok: true, quickReplies });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:reply", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "upsert");
  const nowIso = new Date().toISOString();

  if (action === "delete") {
    const id = String(body.id || "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    }
    const check = await conv.execute({
      sql: `SELECT staff_id FROM staff_quick_replies WHERE id = ? LIMIT 1`,
      args: [id],
    });
    if (!check.rows[0]) {
      return NextResponse.json({ ok: false, error: "Quick reply not found." }, { status: 404 });
    }
    const ownerId = String(check.rows[0].staff_id);
    if (
      ownerId !== user.id &&
      !["DEV", "SUPERADMIN", "MANAGER", "ADMIN"].includes(user.role)
    ) {
      return NextResponse.json(
        { ok: false, error: "You can only delete your own quick replies." },
        { status: 403 }
      );
    }
    await conv.execute({
      sql: `DELETE FROM staff_quick_replies WHERE id = ?`,
      args: [id],
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "increment_usage") {
    const id = String(body.id || "").trim();
    if (id) {
      await conv
        .execute({
          sql: `UPDATE staff_quick_replies SET usage_count = usage_count + 1 WHERE id = ?`,
          args: [id],
        })
        .catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  const title = String(body.title || "").trim();
  const replyBody = String(body.body || "").trim();
  const cmd =
    normalizeQuickCommand(String(body.cmd || title.split(/\s+/)[0] || "reply")) ||
    "/reply";
  const isShared = Boolean(body.isShared);
  const id = String(body.id || "").trim() || `qr_${crypto.randomUUID().slice(0, 8)}`;

  if (!title || !replyBody) {
    return NextResponse.json(
      { ok: false, error: "Title and reply message text are required." },
      { status: 400 }
    );
  }

  const existing = body.id
    ? await conv.execute({
        sql: `SELECT staff_id, created_at, usage_count FROM staff_quick_replies WHERE id = ? LIMIT 1`,
        args: [id],
      })
    : { rows: [] as Record<string, unknown>[] };

  if (
    existing.rows[0] &&
    String(existing.rows[0].staff_id) !== user.id &&
    !["DEV", "SUPERADMIN", "MANAGER", "ADMIN"].includes(user.role)
  ) {
    return NextResponse.json(
      { ok: false, error: "You can only edit your own quick replies." },
      { status: 403 }
    );
  }

  const createdAt = existing.rows[0]?.created_at
    ? String(existing.rows[0].created_at)
    : nowIso;
  const usageCount = Number(existing.rows[0]?.usage_count ?? 0);

  await conv.execute({
    sql: `INSERT INTO staff_quick_replies (
      id, staff_id, staff_name, cmd, title, body, is_shared, usage_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      cmd = excluded.cmd,
      title = excluded.title,
      body = excluded.body,
      is_shared = excluded.is_shared,
      updated_at = excluded.updated_at`,
    args: [
      id,
      existing.rows[0]?.staff_id ? String(existing.rows[0].staff_id) : user.id,
      user.name,
      cmd,
      title,
      replyBody,
      isShared ? 1 : 0,
      usageCount,
      createdAt,
      nowIso,
    ],
  });

  return NextResponse.json({
    ok: true,
    quickReply: {
      id,
      staffId: existing.rows[0]?.staff_id ? String(existing.rows[0].staff_id) : user.id,
      staffName: user.name,
      cmd,
      title,
      body: replyBody,
      isShared,
      isMine: true,
      usageCount,
      updatedAt: nowIso,
    },
  });
}
