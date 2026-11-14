import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { buildAcrioSmartMarketingSegment } from "@cc/connections";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { enqueueJob } from "@cc/queue";
import { hasPermission } from "@cc/rbac";
import { createCustomAdminLink, listCustomAdminLinks } from "@cc/storage";
import { drainPendingWorkerJobs } from "@cc/workers";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const mkt = getRawLibSqlClient("marketing");
  const bill = getRawLibSqlClient("billing_ops");

  const [tplRes, listRes, bcRes, links, pricingRes] = await Promise.all([
    mkt.execute(`SELECT * FROM templates ORDER BY created_at DESC`),
    mkt.execute(`SELECT * FROM marketing_lists ORDER BY updated_at DESC`),
    mkt.execute(`SELECT * FROM broadcasts ORDER BY created_at DESC`),
    listCustomAdminLinks(),
    bill.execute(`SELECT * FROM pricing_config WHERE id = 'default' LIMIT 1`),
  ]);

  const pRow = (pricingRes.rows[0] || {}) as Record<string, unknown>;
  const clientMarketingRateInr = Number(pRow.client_marketing_rate_inr ?? 0.95);
  const clientOtherRateInr = Number(pRow.client_other_rate_inr ?? 0.3);

  return NextResponse.json({
    ok: true,
    rates: {
      marketingRateInr: clientMarketingRateInr,
      otherRateInr: clientOtherRateInr,
    },
    templates: tplRes.rows.map((t) => ({
      id: String(t.id),
      name: String(t.name),
      category: String(t.category),
      headerText: t.header_text ? String(t.header_text) : null,
      bodyText: String(t.body_text),
      footerText: t.footer_text ? String(t.footer_text) : null,
      ctaLabel: t.cta_label ? String(t.cta_label) : null,
      ctaUrl: t.cta_url ? String(t.cta_url) : null,
      approvalStatus: String(t.approval_status),
      sentCount: Number(t.sent_count ?? 0),
    })),
    lists: listRes.rows.map((l) => ({
      id: String(l.id),
      name: String(l.name),
      description: String(l.description),
      sourceType: String(l.source_type),
      acrioPrompt: l.acrio_prompt ? String(l.acrio_prompt) : null,
      membersCount: Number(l.members_count ?? 0),
      memberPhones: (() => {
        try {
          return JSON.parse(String(l.member_phones_json || "[]"));
        } catch {
          return [];
        }
      })(),
      createdByName: String(l.created_by_name),
      updatedAt: String(l.updated_at),
    })),
    broadcasts: bcRes.rows.map((b) => ({
      id: String(b.id),
      name: String(b.name),
      listName: String(b.list_name),
      templateName: String(b.template_name),
      billingCategory: String(b.billing_category),
      status: String(b.status),
      totalRecipients: Number(b.total_recipients ?? 0),
      sentCount: Number(b.sent_count ?? 0),
      deliveredCount: Number(b.delivered_count ?? 0),
      readCount: Number(b.read_count ?? 0),
      clientBilledInr: Number(b.client_billed_inr ?? 0),
      createdByName: String(b.created_by_name),
      createdAt: String(b.created_at),
    })),
    customLinks: links,
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  await ensureDatabasesBootstrapped();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();

  if (action === "acrio_preview_segment") {
    const preview = await buildAcrioSmartMarketingSegment(String(body.prompt || ""));
    return NextResponse.json({ ok: true, preview });
  }

  if (action === "save_acrio_list") {
    if (!hasPermission(user.role, "marketing:manage_lists", user.status)) {
      return NextResponse.json({ ok: false, error: "Admin permission required." }, { status: 403 });
    }
    const phones: string[] = Array.isArray(body.memberPhones)
      ? body.memberPhones.map(String)
      : [];
    const listId = `lst_${crypto.randomUUID().slice(0, 8)}`;

    await mkt.execute({
      sql: `INSERT INTO marketing_lists (
        id, name, description, source_type, acrio_prompt, member_phones_json,
        members_count, created_by_name, updated_at, created_at
      ) VALUES (?, ?, ?, 'ACRIO_SMART', ?, ?, ?, ?, ?, ?)`,
      args: [
        listId,
        String(body.name || "ACRIO Smart Segment").trim(),
        String(body.description || "Targeted WhatsApp segment").trim(),
        body.acrioPrompt ? String(body.acrioPrompt) : null,
        JSON.stringify(phones),
        phones.length,
        user.name,
        nowIso,
        nowIso,
      ],
    });
    return NextResponse.json({ ok: true, listId });
  }

  if (action === "create_custom_link") {
    if (!hasPermission(user.role, "links:use_custom_links", user.status)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const created = await createCustomAdminLink({
      code: body.code ? String(body.code) : undefined,
      title: String(body.title || "Custom Link"),
      targetUrl: String(body.targetUrl || ""),
      linkType: body.linkType,
      utmCampaign: body.utmCampaign ? String(body.utmCampaign) : undefined,
      createdByName: user.name,
    });
    if (!created.ok) {
      return NextResponse.json({ ok: false, error: created.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, link: created.link });
  }

  if (action === "create_template") {
    if (!hasPermission(user.role, "templates:manage", user.status) && !hasPermission(user.role, "marketing:send_broadcasts", user.status)) {
      return NextResponse.json({ ok: false, error: "Permission required." }, { status: 403 });
    }
    const tplId = `tpl_${crypto.randomUUID().slice(0, 8)}`;
    const slugName = String(body.name || "cc_custom_template")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_");
    await mkt.execute({
      sql: `INSERT INTO templates (
        id, name, language, category, header_text, body_text, footer_text, cta_label, cta_url, approval_status, created_at
      ) VALUES (?, ?, 'en', ?, ?, ?, ?, ?, ?, 'APPROVED', ?)`,
      args: [
        tplId,
        slugName,
        body.category === "UTILITY" || body.category === "AUTHENTICATION"
          ? body.category
          : "MARKETING",
        body.headerText ? String(body.headerText) : null,
        String(body.bodyText || "Hello {{1}}, greetings from Classic Concepts!"),
        body.footerText ? String(body.footerText) : "Classic Concepts • Since 2008",
        body.ctaLabel ? String(body.ctaLabel) : null,
        body.ctaUrl ? String(body.ctaUrl) : null,
        nowIso,
      ],
    });
    return NextResponse.json({ ok: true, templateId: tplId });
  }

  if (action === "launch_broadcast") {
    if (!hasPermission(user.role, "marketing:send_broadcasts", user.status)) {
      return NextResponse.json({ ok: false, error: "Admin permission required." }, { status: 403 });
    }
    const listId = String(body.listId || "");
    const templateId = String(body.templateId || "");

    const [lRes, tRes] = await Promise.all([
      mkt.execute({ sql: `SELECT * FROM marketing_lists WHERE id = ?`, args: [listId] }),
      mkt.execute({ sql: `SELECT * FROM templates WHERE id = ?`, args: [templateId] }),
    ]);

    if (!lRes.rows[0] || !tRes.rows[0]) {
      return NextResponse.json({ ok: false, error: "Select a valid list and template." }, { status: 400 });
    }

    const bcId = `bc_${crypto.randomUUID().slice(0, 8)}`;
    const membersCount = Number(lRes.rows[0].members_count ?? 0);
    const category = String(tRes.rows[0].category || "MARKETING");

    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category,
        status, total_recipients, sent_count, delivered_count, read_count,
        client_billed_inr, actual_meta_cost_inr, created_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, 0, 0, 0, 0, 0, ?, ?)`,
      args: [
        bcId,
        String(body.name || `${String(lRes.rows[0].name)} Campaign`),
        listId,
        String(lRes.rows[0].name),
        templateId,
        String(tRes.rows[0].name),
        category,
        membersCount,
        user.name,
        nowIso,
      ],
    });

    await enqueueJob("whatsapp:broadcast", { broadcastId: bcId });
    await drainPendingWorkerJobs();

    return NextResponse.json({ ok: true, broadcastId: bcId });
  }

  return NextResponse.json({ ok: false, error: "Unsupported marketing action." }, { status: 400 });
}
