import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@cc/auth";
import {
  draftMetaCompliantTemplateWithAi,
  syncTemplatesFromMetaCloud,
  type WhatsAppTemplateButton,
  type WhatsAppTemplateButtonFlowAction,
  type WhatsAppTemplateCategory,
} from "@cc/connections";
import { getRawLibSqlClient } from "@cc/database";
import { socketHub } from "@cc/sockets";
import { normalizeTemplateSlug, parseJsonSafe } from "./helpers";

export async function handleSyncMeta() {
  const syncRes = await syncTemplatesFromMetaCloud();
  socketHub.emit("template:updated", { syncedCount: syncRes.syncedCount });
  return NextResponse.json(syncRes, { status: syncRes.ok ? 200 : 400 });
}

export async function handleAiDraftTemplate(body: Record<string, unknown>) {
  const goal = String(body.goal || body.prompt || "").trim();
  if (!goal) {
    return NextResponse.json(
      { ok: false, error: "Describe what this template should communicate." },
      { status: 400 }
    );
  }
  const category: WhatsAppTemplateCategory =
    body.category === "UTILITY" || body.category === "AUTHENTICATION"
      ? body.category
      : "MARKETING";
  const drafted = await draftMetaCompliantTemplateWithAi({
    prompt: goal,
    category,
    brand:
      body.brand === "CLASSIC_EDGE_53" ? "CLASSIC_EDGE_53" : "CLASSIC_CONCEPTS",
  });
  return NextResponse.json({ ok: true, draft: drafted });
}

export async function handleSaveButtonFlows(
  body: Record<string, unknown>,
  nowIso: string
) {
  const mkt = getRawLibSqlClient("marketing");
  const tplId = String(body.templateId || "").trim();
  const srcRes = await mkt.execute({
    sql: `SELECT buttons_json FROM templates WHERE id = ? LIMIT 1`,
    args: [tplId],
  });
  if (!srcRes.rows[0]) {
    return NextResponse.json(
      { ok: false, error: "Template not found." },
      { status: 404 }
    );
  }
  const existingButtons = parseJsonSafe<WhatsAppTemplateButton[]>(
    srcRes.rows[0].buttons_json,
    []
  );
  const incomingFlows: Record<string, WhatsAppTemplateButtonFlowAction> =
    body.flowsByButtonId && typeof body.flowsByButtonId === "object"
      ? (body.flowsByButtonId as Record<string, WhatsAppTemplateButtonFlowAction>)
      : {};

  const updatedButtons = existingButtons.map((btn) => ({
    ...btn,
    flowAction: incomingFlows[btn.id] ?? btn.flowAction,
  }));

  await mkt.execute({
    sql: `UPDATE templates SET buttons_json = ?, updated_at = ? WHERE id = ?`,
    args: [JSON.stringify(updatedButtons), nowIso, tplId],
  });
  socketHub.emit("template:updated", { templateId: tplId });
  return NextResponse.json({
    ok: true,
    buttons: updatedButtons,
    message:
      "Quick-reply button flow actions saved! Incoming button taps will execute these exact flows before AI.",
  });
}

export async function handleDuplicateTemplate(
  user: AuthenticatedUser,
  body: Record<string, unknown>,
  nowIso: string
) {
  const mkt = getRawLibSqlClient("marketing");
  const sourceId = String(body.templateId || "");
  const srcRes = await mkt.execute({
    sql: `SELECT * FROM templates WHERE id = ? LIMIT 1`,
    args: [sourceId],
  });
  if (!srcRes.rows[0]) {
    return NextResponse.json(
      { ok: false, error: "Template not found." },
      { status: 404 }
    );
  }
  const src = srcRes.rows[0] as Record<string, unknown>;
  const newId = `tpl_${crypto.randomUUID().slice(0, 8)}`;
  const cloneName = normalizeTemplateSlug(
    `${String(src.name)}_copy_${Math.floor(10 + Math.random() * 89)}`
  );

  await mkt.execute({
    sql: `INSERT INTO templates (
      id, name, language, category, header_type, header_text, header_media_url,
      header_location_json, body_text, footer_text, cta_label, cta_url, buttons_json,
      variables_schema_json, meta_quality_score, approval_status, allow_category_change,
      code_expiration_minutes, sent_count, created_by_name, updated_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GREEN', 'DRAFT', ?, ?, 0, ?, ?, ?)`,
    args: [
      newId,
      cloneName,
      String(src.language || "en"),
      String(src.category || "MARKETING"),
      String(src.header_type || "NONE"),
      src.header_text ? String(src.header_text) : null,
      src.header_media_url ? String(src.header_media_url) : null,
      src.header_location_json ? String(src.header_location_json) : null,
      String(src.body_text || ""),
      src.footer_text ? String(src.footer_text) : null,
      src.cta_label ? String(src.cta_label) : null,
      src.cta_url ? String(src.cta_url) : null,
      String(src.buttons_json || "[]"),
      String(src.variables_schema_json || "[]"),
      Number(src.allow_category_change ?? 1),
      src.code_expiration_minutes !== null &&
      src.code_expiration_minutes !== undefined
        ? Number(src.code_expiration_minutes)
        : null,
      user.name,
      nowIso,
      nowIso,
    ],
  });

  socketHub.emit("template:updated", { templateId: newId, status: "DRAFT" });
  return NextResponse.json({
    ok: true,
    templateId: newId,
    name: cloneName,
    message: `Cloned as "${cloneName}" (Draft).`,
  });
}

export async function handleTogglePause(
  body: Record<string, unknown>,
  nowIso: string
) {
  const mkt = getRawLibSqlClient("marketing");
  const tplId = String(body.templateId || "");
  const curRes = await mkt.execute({
    sql: `SELECT approval_status FROM templates WHERE id = ? LIMIT 1`,
    args: [tplId],
  });
  if (!curRes.rows[0]) {
    return NextResponse.json(
      { ok: false, error: "Template not found." },
      { status: 404 }
    );
  }
  const cur = String(curRes.rows[0].approval_status || "APPROVED");
  const next = cur === "PAUSED" ? "APPROVED" : "PAUSED";
  await mkt.execute({
    sql: `UPDATE templates SET approval_status = ?, updated_at = ? WHERE id = ?`,
    args: [next, nowIso, tplId],
  });
  socketHub.emit("template:updated", { templateId: tplId, status: next });
  return NextResponse.json({
    ok: true,
    approvalStatus: next,
    message:
      next === "PAUSED"
        ? "Template paused. Staff and broadcasts will not use it until resumed."
        : "Template resumed and active again.",
  });
}

export async function handleDeleteTemplate(body: Record<string, unknown>) {
  const mkt = getRawLibSqlClient("marketing");
  const tplId = String(body.templateId || "");
  await mkt.execute({
    sql: `DELETE FROM templates WHERE id = ?`,
    args: [tplId],
  });
  socketHub.emit("template:updated", { templateId: tplId, status: "DELETED" });
  return NextResponse.json({ ok: true, message: "Template deleted." });
}
