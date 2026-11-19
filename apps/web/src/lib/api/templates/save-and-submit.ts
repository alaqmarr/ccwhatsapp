import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@cc/auth";
import {
  submitTemplateToMetaCloud,
  validateWhatsAppTemplateRules,
  type WhatsAppHeaderType,
  type WhatsAppTemplateButton,
  type WhatsAppTemplateButtonFlowAction,
  type WhatsAppTemplateCategory,
  type WhatsAppTemplateDefinition,
  type WhatsAppTemplateLocation,
  type WhatsAppTemplateVariableSpec,
} from "@cc/connections";
import { getRawLibSqlClient } from "@cc/database";
import { socketHub } from "@cc/sockets";
import { normalizeTemplateSlug } from "./helpers";

export async function handleSaveOrSubmitTemplate(
  user: AuthenticatedUser,
  body: Record<string, unknown>,
  action: "save_draft" | "submit_to_meta",
  nowIso: string
) {
  const mkt = getRawLibSqlClient("marketing");
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
        exampleSuffix: b.exampleSuffix ? String(b.exampleSuffix).trim() : undefined,
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

  const rawLoc =
    body.headerLocation && typeof body.headerLocation === "object"
      ? (body.headerLocation as Record<string, unknown>)
      : null;
  const headerLocation: WhatsAppTemplateLocation | null =
    headerType === "LOCATION" && rawLoc
      ? {
          name: String(rawLoc.name || "Classic Concepts"),
          address: String(rawLoc.address || "Secunderabad, Hyderabad"),
          latitude: Number(rawLoc.latitude ?? 17.4399),
          longitude: Number(rawLoc.longitude ?? 78.4983),
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
      (headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT") &&
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
  const rejectionReason: string | null = null;
  let feedbackMsg = "Template saved as Draft.";
  let savedButtons = buttons;

  if (action === "submit_to_meta") {
    const submitRes = await submitTemplateToMetaCloud(tplDef);
    if (!submitRes.ok) {
      return NextResponse.json(
        { ok: false, error: submitRes.error || submitRes.message },
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
