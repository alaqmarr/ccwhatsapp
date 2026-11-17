import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  buildMetaGraphTemplatePayload,
  draftMetaCompliantTemplateWithAi,
  getCachedEcosystemCatalog,
  sendWhatsAppCloudMessage,
  submitTemplateToMetaCloud,
  syncTemplatesFromMetaCloud,
  validateWhatsAppTemplateRules,
  type WhatsAppHeaderType,
  type WhatsAppTemplateButton,
  type WhatsAppTemplateButtonFlowAction,
  type WhatsAppTemplateCategory,
  type WhatsAppTemplateDefinition,
  type WhatsAppTemplateLocation,
  type WhatsAppTemplateVariableSpec,
} from "@cc/connections";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { hasPermission, isSuperAdminCapable } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import { listCustomAdminLinks } from "@cc/storage";
import {
  recordDualPricingLedgerEntry,
  type BillingMessageCategory,
} from "@cc/workers";
import { loadTemplatesPayload } from "@/lib/loaders/crm";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function normalizeTemplateSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json(
      { ok: false, error: "Sign in required." },
      { status: 403 }
    );
  }

  const payload = await loadTemplatesPayload(user);
  return NextResponse.json(payload);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "templates:manage", user.status)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Only Manager, Admin, Superadmin, or Dev accounts can create or edit WhatsApp templates.",
      },
      { status: 403 }
    );
  }

  await ensureDatabasesBootstrapped();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();

  if (action === "sync_meta") {
    const syncRes = await syncTemplatesFromMetaCloud();
    socketHub.emit("template:updated", { syncedCount: syncRes.syncedCount });
    return NextResponse.json(syncRes, { status: syncRes.ok ? 200 : 400 });
  }

  if (action === "ai_draft_template") {
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
        body.brand === "CLASSIC_EDGE_53"
          ? "CLASSIC_EDGE_53"
          : "CLASSIC_CONCEPTS",
    });
    return NextResponse.json({ ok: true, draft: drafted });
  }

  if (action === "save_button_flows") {
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
        ? body.flowsByButtonId
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
      message: "Quick-reply button flow actions saved! Incoming button taps will execute these exact flows before AI.",
    });
  }

  if (action === "save_draft" || action === "submit_to_meta") {
    const existingId = body.id ? String(body.id).trim() : "";
    const slugName = normalizeTemplateSlug(
      String(body.name || "classic_concepts_template")
    );
    const category: WhatsAppTemplateCategory =
      body.category === "UTILITY" || body.category === "AUTHENTICATION"
        ? body.category
        : "MARKETING";
    const headerType: WhatsAppHeaderType = [
      "NONE",
      "TEXT",
      "IMAGE",
      "VIDEO",
      "DOCUMENT",
      "LOCATION",
    ].includes(String(body.headerType))
      ? (String(body.headerType) as WhatsAppHeaderType)
      : "NONE";

    const buttons: WhatsAppTemplateButton[] = Array.isArray(body.buttons)
      ? body.buttons.map((b: any, idx: number) => ({
          id: String(b.id || `btn_${idx + 1}`),
          type:
            b.type === "URL" ||
            b.type === "PHONE_NUMBER" ||
            b.type === "COPY_CODE" ||
            b.type === "OTP"
              ? b.type
              : "QUICK_REPLY",
          text: String(b.text || "").trim(),
          url: b.url ? String(b.url).trim() : undefined,
          urlType: b.urlType === "DYNAMIC" ? "DYNAMIC" : "STATIC",
          exampleSuffix: b.exampleSuffix
            ? String(b.exampleSuffix).trim()
            : undefined,
          phoneNumber: b.phoneNumber ? String(b.phoneNumber).trim() : undefined,
          exampleCode: b.exampleCode ? String(b.exampleCode).trim() : undefined,
          otpType: b.otpType === "ONE_TAP" ? "ONE_TAP" : "COPY_CODE",
          flowAction:
            b.flowAction && typeof b.flowAction === "object"
              ? (b.flowAction as WhatsAppTemplateButtonFlowAction)
              : undefined,
        }))
      : [];

    const variablesSchema: WhatsAppTemplateVariableSpec[] = Array.isArray(
      body.variablesSchema
    )
      ? body.variablesSchema.map((v: any, idx: number) => ({
          index: Number(v.index || idx + 1),
          label: String(v.label || `Variable ${idx + 1}`),
          sourceField: v.sourceField || "custom",
          sampleValue: String(v.sampleValue || "").trim(),
        }))
      : [];

    const headerLocation: WhatsAppTemplateLocation | null =
      headerType === "LOCATION" && body.headerLocation
        ? {
            name: String(body.headerLocation.name || "Classic Concepts"),
            address: String(
              body.headerLocation.address || "Secunderabad, Hyderabad"
            ),
            latitude: Number(body.headerLocation.latitude ?? 17.4399),
            longitude: Number(body.headerLocation.longitude ?? 78.4983),
          }
        : null;

    const tplDef: WhatsAppTemplateDefinition = {
      id: existingId || undefined,
      name: slugName,
      language: String(body.language || "en").trim() || "en",
      category,
      headerType,
      headerText:
        headerType === "TEXT" && body.headerText
          ? String(body.headerText).trim()
          : null,
      headerMediaUrl:
        (headerType === "IMAGE" ||
          headerType === "VIDEO" ||
          headerType === "DOCUMENT") &&
        body.headerMediaUrl
          ? String(body.headerMediaUrl).trim()
          : null,
      headerLocation,
      bodyText: String(body.bodyText || "").trim(),
      footerText: body.footerText ? String(body.footerText).trim() : null,
      buttons,
      variablesSchema,
      allowCategoryChange: body.allowCategoryChange !== false,
      codeExpirationMinutes:
        category === "AUTHENTICATION"
          ? Number(body.codeExpirationMinutes || 10)
          : null,
    };

    const validation = validateWhatsAppTemplateRules(tplDef);
    if (action === "submit_to_meta" && !validation.valid) {
      return NextResponse.json(
        {
          ok: false,
          error: validation.errors[0],
          errors: validation.errors,
          warnings: validation.warnings,
        },
        { status: 400 }
      );
    }

    if (!tplDef.name || !tplDef.bodyText) {
      return NextResponse.json(
        { ok: false, error: "Template name and message body are required." },
        { status: 400 }
      );
    }

    // Check unique name collision
    const dupCheck = await mkt.execute({
      sql: `SELECT id FROM templates WHERE name = ? LIMIT 1`,
      args: [tplDef.name],
    });
    if (dupCheck.rows[0] && String(dupCheck.rows[0].id) !== existingId) {
      return NextResponse.json(
        {
          ok: false,
          error: `A template named "${tplDef.name}" already exists. Choose a different template name.`,
        },
        { status: 400 }
      );
    }

    let approvalStatus = "DRAFT";
    let metaTemplateId: string | null = null;
    let rejectionReason: string | null = null;
    let feedbackMsg = "Template saved as Draft.";
    let savedButtons = buttons;

    if (action === "submit_to_meta") {
      const submitRes = await submitTemplateToMetaCloud(tplDef);
      if (!submitRes.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: submitRes.error || submitRes.message,
          },
          { status: 400 }
        );
      }
      approvalStatus = submitRes.approvalStatus;
      metaTemplateId = submitRes.metaTemplateId || null;
      feedbackMsg = submitRes.message;
      if (submitRes.effectiveCategory) {
        tplDef.category = submitRes.effectiveCategory;
        if (tplDef.category !== "AUTHENTICATION") {
          tplDef.codeExpirationMinutes = null;
        }
      }
      if (submitRes.effectiveBodyText) {
        tplDef.bodyText = submitRes.effectiveBodyText;
      }
      if (submitRes.effectiveFooterText !== undefined) {
        tplDef.footerText = submitRes.effectiveFooterText;
      }
      if (Array.isArray(submitRes.effectiveButtons)) {
        savedButtons = submitRes.effectiveButtons;
        tplDef.buttons = savedButtons;
      }
    }

    const firstUrlBtn = savedButtons.find((b) => b.type === "URL");
    const targetId = existingId || `tpl_${crypto.randomUUID().slice(0, 8)}`;

    if (existingId) {
      await mkt.execute({
        sql: `UPDATE templates
              SET name = ?,
                  language = ?,
                  category = ?,
                  header_type = ?,
                  header_text = ?,
                  header_media_url = ?,
                  header_location_json = ?,
                  body_text = ?,
                  footer_text = ?,
                  cta_label = ?,
                  cta_url = ?,
                  buttons_json = ?,
                  variables_schema_json = ?,
                  meta_template_id = COALESCE(?, meta_template_id),
                  approval_status = ?,
                  rejection_reason = ?,
                  allow_category_change = ?,
                  code_expiration_minutes = ?,
                  updated_at = ?
              WHERE id = ?`,
        args: [
          tplDef.name,
          tplDef.language,
          tplDef.category,
          tplDef.headerType,
          tplDef.headerText || null,
          tplDef.headerMediaUrl || null,
          headerLocation ? JSON.stringify(headerLocation) : null,
          tplDef.bodyText,
          tplDef.footerText || null,
          firstUrlBtn?.text || null,
          firstUrlBtn?.url || null,
          JSON.stringify(savedButtons),
          JSON.stringify(variablesSchema),
          metaTemplateId,
          approvalStatus,
          rejectionReason,
          tplDef.allowCategoryChange ? 1 : 0,
          tplDef.codeExpirationMinutes ?? null,
          nowIso,
          existingId,
        ],
      });
    } else {
      await mkt.execute({
        sql: `INSERT INTO templates (
          id, name, language, category, header_type, header_text, header_media_url,
          header_location_json, body_text, footer_text, cta_label, cta_url, buttons_json,
          variables_schema_json, meta_template_id, meta_quality_score, approval_status,
          rejection_reason, allow_category_change, code_expiration_minutes, created_by_name,
          updated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GREEN', ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          targetId,
          tplDef.name,
          tplDef.language,
          tplDef.category,
          tplDef.headerType,
          tplDef.headerText || null,
          tplDef.headerMediaUrl || null,
          headerLocation ? JSON.stringify(headerLocation) : null,
          tplDef.bodyText,
          tplDef.footerText || null,
          firstUrlBtn?.text || null,
          firstUrlBtn?.url || null,
          JSON.stringify(savedButtons),
          JSON.stringify(variablesSchema),
          metaTemplateId,
          approvalStatus,
          rejectionReason,
          tplDef.allowCategoryChange ? 1 : 0,
          tplDef.codeExpirationMinutes ?? null,
          user.name,
          nowIso,
          nowIso,
        ],
      });
    }

    socketHub.emit("template:updated", {
      templateId: targetId,
      status: approvalStatus,
    });

    return NextResponse.json({
      ok: true,
      templateId: targetId,
      approvalStatus,
      effectiveCategory: tplDef.category,
      effectiveBodyText: tplDef.bodyText,
      effectiveFooterText: tplDef.footerText,
      effectiveButtons: savedButtons,
      warnings: validation.warnings,
      message: feedbackMsg,
    });
  }

  if (action === "duplicate_template") {
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

  if (action === "toggle_pause") {
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

  if (action === "delete_template") {
    const tplId = String(body.templateId || "");
    await mkt.execute({
      sql: `DELETE FROM templates WHERE id = ?`,
      args: [tplId],
    });
    socketHub.emit("template:updated", { templateId: tplId, status: "DELETED" });
    return NextResponse.json({ ok: true, message: "Template deleted." });
  }

  if (action === "send_test_template") {
    const tplId = String(body.templateId || "");
    const toPhone = String(body.toPhone || "").trim();
    if (!toPhone) {
      return NextResponse.json(
        { ok: false, error: "Enter a WhatsApp number to receive the test message." },
        { status: 400 }
      );
    }
    const tplRes = await mkt.execute({
      sql: `SELECT * FROM templates WHERE id = ? LIMIT 1`,
      args: [tplId],
    });
    if (!tplRes.rows[0]) {
      return NextResponse.json(
        { ok: false, error: "Template not found." },
        { status: 404 }
      );
    }
    const t = tplRes.rows[0] as Record<string, unknown>;
    if (String(t.approval_status || "") !== "APPROVED") {
      return NextResponse.json(
        {
          ok: false,
          error: `Only official Meta-APPROVED templates can be sent on WhatsApp (current status: ${String(
            t.approval_status || "DRAFT"
          )}). Submit this template to Meta for review first.`,
        },
        { status: 400 }
      );
    }
    const varSpecs = parseJsonSafe<WhatsAppTemplateVariableSpec[]>(
      t.variables_schema_json,
      []
    );
    let rendered = String(t.body_text || "");
    for (const v of varSpecs) {
      rendered = rendered.replace(
        new RegExp(`\\{\\{${v.index}\\}\\}`, "g"),
        v.sampleValue || "Sample"
      );
    }

    const headerType = String(t.header_type || "NONE");
    const headerMediaUrl = t.header_media_url ? String(t.header_media_url) : "";
    const tplBtns = parseJsonSafe<WhatsAppTemplateButton[]>(t.buttons_json, []);
    const comps: Record<string, unknown>[] = [];
    if (
      (headerType === "IMAGE" ||
        headerType === "VIDEO" ||
        headerType === "DOCUMENT") &&
      headerMediaUrl
    ) {
      const mk = headerType.toLowerCase();
      comps.push({
        type: "header",
        parameters: [{ type: mk, [mk]: { link: headerMediaUrl } }],
      });
    } else if (headerType === "LOCATION") {
      const loc = parseJsonSafe<WhatsAppTemplateLocation | null>(
        t.header_location_json,
        null
      );
      comps.push({
        type: "header",
        parameters: [
          {
            type: "location",
            location: {
              name: loc?.name || "Classic Concepts",
              address: loc?.address || "Rani Gunj, Secunderabad, Hyderabad",
              latitude: String(loc?.latitude ?? 17.4326),
              longitude: String(loc?.longitude ?? 78.4913),
            },
          },
        ],
      });
    }
    if (varSpecs.length > 0) {
      comps.push({
        type: "body",
        parameters: varSpecs
          .sort((a, b) => a.index - b.index)
          .map((v) => ({ type: "text", text: v.sampleValue || "Sample" })),
      });
    }
    tplBtns.forEach((b, idx) => {
      if (b.type === "COPY_CODE") {
        comps.push({
          type: "button",
          sub_type: "copy_code",
          index: String(idx),
          parameters: [
            { type: "coupon_code", coupon_code: b.exampleCode || "CLASSIC10" },
          ],
        });
      } else if (
        b.type === "URL" &&
        (b.urlType === "DYNAMIC" || /\{\{1\}\}/.test(b.url || ""))
      ) {
        comps.push({
          type: "button",
          sub_type: "url",
          index: String(idx),
          parameters: [{ type: "text", text: b.exampleSuffix || "CC-2026" }],
        });
      }
    });

    const sendRes = await sendWhatsAppCloudMessage({
      toPhone,
      bodyText: rendered,
      templateName: String(t.name),
      languageCode: String(t.language || "en"),
      templateComponents: comps,
    });
    if (!sendRes.ok) {
      return NextResponse.json(
        { ok: false, error: sendRes.error || "Test send failed." },
        { status: 400 }
      );
    }

    const cat = String(t.category || "MARKETING") as BillingMessageCategory;
    await recordDualPricingLedgerEntry({
      customerPhone: toPhone,
      category: cat,
      staffName: `Template Test (${user.name})`,
    });
    await mkt.execute({
      sql: `UPDATE templates SET sent_count = sent_count + 1 WHERE id = ?`,
      args: [tplId],
    });

    return NextResponse.json({
      ok: true,
      mode: sendRes.mode,
      message: `Sent test message of "${String(t.name)}" to ${toPhone}.`,
    });
  }

  return NextResponse.json(
    { ok: false, error: "Unsupported template action." },
    { status: 400 }
  );
}
