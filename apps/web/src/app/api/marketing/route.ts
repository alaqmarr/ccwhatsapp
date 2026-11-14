import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { buildAcrioSmartMarketingSegment } from "@cc/connections";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { createCustomAdminLink, listCustomAdminLinks } from "@cc/storage";
import {
  cancelMarketingBroadcast,
  enqueueBroadcastIntoSafeQueue,
  ensureBackgroundWorkersRunning,
  getBroadcastQueueSettings,
  pauseMarketingBroadcast,
  processMarketingBroadcastQueue,
  resumeMarketingBroadcast,
  retryFailedBroadcastRecipients,
  updateBroadcastQueueSettings,
  type BroadcastPacingMode,
} from "@cc/workers";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  ensureBackgroundWorkersRunning();
  await processMarketingBroadcastQueue().catch(() => {});

  const url = new URL(req.url);
  const broadcastId = url.searchParams.get("broadcastId");
  const mkt = getRawLibSqlClient("marketing");

  // Element-level query: recipient queue rows for a single broadcast campaign
  if (broadcastId) {
    const [bRes, recRes] = await Promise.all([
      mkt.execute({
        sql: `SELECT * FROM broadcasts WHERE id = ? LIMIT 1`,
        args: [broadcastId],
      }),
      mkt.execute({
        sql: `SELECT * FROM broadcast_recipients
              WHERE broadcast_id = ?
              ORDER BY CASE status
                WHEN 'SENDING' THEN 1
                WHEN 'QUEUED' THEN 2
                WHEN 'FAILED' THEN 3
                WHEN 'SENT' THEN 4
                WHEN 'DELIVERED' THEN 5
                WHEN 'SKIPPED' THEN 6
                ELSE 7
              END, scheduled_at ASC
              LIMIT 250`,
        args: [broadcastId],
      }),
    ]);

    if (!bRes.rows[0]) {
      return NextResponse.json(
        { ok: false, error: "Broadcast campaign not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      recipients: recRes.rows.map((r) => ({
        id: String(r.id),
        customerName: String(r.customer_name || ""),
        customerPhone: String(r.customer_phone),
        renderedBody: String(r.rendered_body || ""),
        status: String(r.status),
        skipOrErrorReason: r.skip_or_error_reason
          ? String(r.skip_or_error_reason)
          : null,
        attempts: Number(r.attempts ?? 0),
        scheduledAt: String(r.scheduled_at),
        sentAt: r.sent_at ? String(r.sent_at) : null,
      })),
    });
  }

  const bill = getRawLibSqlClient("billing_ops");
  const [tplRes, listRes, bcRes, links, pricingRes, queueSettings] =
    await Promise.all([
      mkt.execute(`SELECT * FROM templates ORDER BY created_at DESC`),
      mkt.execute(`SELECT * FROM marketing_lists ORDER BY updated_at DESC`),
      mkt.execute(`SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 50`),
      listCustomAdminLinks(),
      bill.execute(`SELECT * FROM pricing_config WHERE id = 'default' LIMIT 1`),
      getBroadcastQueueSettings(),
    ]);

  const pRow = (pricingRes.rows[0] || {}) as Record<string, unknown>;
  const clientMarketingRateInr = Number(pRow.client_marketing_rate_inr ?? 0.95);
  const clientOtherRateInr = Number(pRow.client_other_rate_inr ?? 0.3);

  return NextResponse.json({
    ok: true,
    canManageTemplates: hasPermission(
      user.role,
      "templates:manage",
      user.status
    ),
    canSendBroadcasts: hasPermission(
      user.role,
      "marketing:send_broadcasts",
      user.status
    ),
    rates: {
      marketingRateInr: clientMarketingRateInr,
      otherRateInr: clientOtherRateInr,
    },
    queueSettings,
    templates: tplRes.rows.map((t) => ({
      id: String(t.id),
      name: String(t.name),
      language: String(t.language || "en"),
      category: String(t.category),
      headerType: String(t.header_type || (t.header_text ? "TEXT" : "NONE")),
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
      pacingMode: String(b.pacing_mode || "SAFE_STEADY"),
      delaySeconds: Number(b.delay_seconds ?? 4),
      batchSize: Number(b.batch_size ?? 25),
      batchPauseSeconds: Number(b.batch_pause_seconds ?? 20),
      totalRecipients: Number(b.total_recipients ?? 0),
      queuedCount: Number(b.queued_count ?? 0),
      skippedCount: Number(b.skipped_count ?? 0),
      failedCount: Number(b.failed_count ?? 0),
      sentCount: Number(b.sent_count ?? 0),
      deliveredCount: Number(b.delivered_count ?? 0),
      readCount: Number(b.read_count ?? 0),
      pausedReason: b.paused_reason ? String(b.paused_reason) : null,
      scheduledFor: b.scheduled_for ? String(b.scheduled_for) : null,
      nextDispatchAt: b.next_dispatch_at ? String(b.next_dispatch_at) : null,
      completedAt: b.completed_at ? String(b.completed_at) : null,
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
      return NextResponse.json(
        { ok: false, error: "Manager or Admin permission required." },
        { status: 403 }
      );
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

  if (action === "delete_list") {
    if (!hasPermission(user.role, "marketing:manage_lists", user.status)) {
      return NextResponse.json(
        { ok: false, error: "Manager or Admin permission required." },
        { status: 403 }
      );
    }
    await mkt.execute({
      sql: `DELETE FROM marketing_lists WHERE id = ?`,
      args: [String(body.listId || "")],
    });
    return NextResponse.json({ ok: true });
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

  if (action === "launch_broadcast") {
    if (!hasPermission(user.role, "marketing:send_broadcasts", user.status)) {
      return NextResponse.json(
        { ok: false, error: "Manager or Admin permission required to launch broadcasts." },
        { status: 403 }
      );
    }

    const pacingMode: BroadcastPacingMode =
      body.pacingMode === "EXTRA_CAREFUL" || body.pacingMode === "WARMED_FAST"
        ? body.pacingMode
        : "SAFE_STEADY";

    const enq = await enqueueBroadcastIntoSafeQueue({
      name: body.name ? String(body.name) : undefined,
      listId: String(body.listId || ""),
      templateId: String(body.templateId || ""),
      pacingMode,
      skipRecentHoursOverride:
        body.skipRecentHours !== undefined
          ? Number(body.skipRecentHours)
          : undefined,
      scheduledForIso: body.scheduledFor ? String(body.scheduledFor) : null,
      createdByName: user.name,
    });

    if (!enq.ok) {
      return NextResponse.json(
        { ok: false, error: enq.error || "Could not queue broadcast." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      broadcastId: enq.broadcastId,
      queuedCount: enq.queuedCount,
      skippedCount: enq.skippedCount,
      estimatedDurationSeconds: enq.estimatedDurationSeconds,
    });
  }

  if (action === "pause_broadcast") {
    if (!hasPermission(user.role, "marketing:send_broadcasts", user.status)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    await pauseMarketingBroadcast(
      String(body.broadcastId || ""),
      `Paused by ${user.name}.`
    );
    return NextResponse.json({ ok: true });
  }

  if (action === "resume_broadcast") {
    if (!hasPermission(user.role, "marketing:send_broadcasts", user.status)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    await resumeMarketingBroadcast(String(body.broadcastId || ""));
    return NextResponse.json({ ok: true });
  }

  if (action === "retry_failed_broadcast") {
    if (!hasPermission(user.role, "marketing:send_broadcasts", user.status)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const retried = await retryFailedBroadcastRecipients(
      String(body.broadcastId || "")
    );
    return NextResponse.json({ ok: true, retried });
  }

  if (action === "cancel_broadcast") {
    if (!hasPermission(user.role, "marketing:send_broadcasts", user.status)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    await cancelMarketingBroadcast(String(body.broadcastId || ""));
    return NextResponse.json({ ok: true });
  }

  if (action === "update_queue_settings") {
    if (!hasPermission(user.role, "marketing:send_broadcasts", user.status)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const updated = await updateBroadcastQueueSettings({
      defaultPacingMode:
        body.defaultPacingMode === "EXTRA_CAREFUL" ||
        body.defaultPacingMode === "WARMED_FAST"
          ? body.defaultPacingMode
          : "SAFE_STEADY",
      delaySeconds:
        body.delaySeconds !== undefined ? Number(body.delaySeconds) : undefined,
      batchSize:
        body.batchSize !== undefined ? Number(body.batchSize) : undefined,
      batchPauseSeconds:
        body.batchPauseSeconds !== undefined
          ? Number(body.batchPauseSeconds)
          : undefined,
      skipRecentHours:
        body.skipRecentHours !== undefined
          ? Number(body.skipRecentHours)
          : undefined,
      dailyMarketingCap:
        body.dailyMarketingCap !== undefined
          ? Number(body.dailyMarketingCap)
          : undefined,
      autoPauseOnConsecutiveFailures:
        body.autoPauseOnConsecutiveFailures !== undefined
          ? Number(body.autoPauseOnConsecutiveFailures)
          : undefined,
      quietHoursEnabled:
        body.quietHoursEnabled !== undefined
          ? Boolean(body.quietHoursEnabled)
          : undefined,
      updatedBy: user.name,
    });
    return NextResponse.json({ ok: true, queueSettings: updated });
  }

  return NextResponse.json(
    { ok: false, error: "Unsupported marketing action." },
    { status: 400 }
  );
}
