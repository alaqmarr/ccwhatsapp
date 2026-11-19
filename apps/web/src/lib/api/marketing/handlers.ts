import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@cc/auth";
import { buildAcrioSmartMarketingSegment } from "@cc/connections";
import { getRawLibSqlClient } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { createCustomAdminLink } from "@cc/storage";
import {
  cancelMarketingBroadcast,
  enqueueBroadcastIntoSafeQueue,
  pauseMarketingBroadcast,
  resumeMarketingBroadcast,
  retryFailedBroadcastRecipients,
  updateBroadcastQueueSettings,
  type BroadcastPacingMode,
} from "@cc/workers";

export async function handleGetBroadcastRecipients(broadcastId: string) {
  const mkt = getRawLibSqlClient("marketing");
  const [bRes, recRes] = await Promise.all([
    mkt.execute({
      sql: `SELECT id FROM broadcasts WHERE id = ? LIMIT 1`,
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

export async function handleMarketingPostAction(
  user: AuthenticatedUser,
  body: Record<string, unknown>
) {
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
      linkType: body.linkType as any,
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
        body.skipRecentHours !== undefined ? Number(body.skipRecentHours) : undefined,
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
      delaySeconds: body.delaySeconds !== undefined ? Number(body.delaySeconds) : undefined,
      batchSize: body.batchSize !== undefined ? Number(body.batchSize) : undefined,
      batchPauseSeconds:
        body.batchPauseSeconds !== undefined ? Number(body.batchPauseSeconds) : undefined,
      skipRecentHours:
        body.skipRecentHours !== undefined ? Number(body.skipRecentHours) : undefined,
      dailyMarketingCap:
        body.dailyMarketingCap !== undefined ? Number(body.dailyMarketingCap) : undefined,
      autoPauseOnConsecutiveFailures:
        body.autoPauseOnConsecutiveFailures !== undefined
          ? Number(body.autoPauseOnConsecutiveFailures)
          : undefined,
      quietHoursEnabled:
        body.quietHoursEnabled !== undefined ? Boolean(body.quietHoursEnabled) : undefined,
      updatedBy: user.name,
    });
    return NextResponse.json({ ok: true, queueSettings: updated });
  }

  return NextResponse.json(
    { ok: false, error: "Unsupported marketing action." },
    { status: 400 }
  );
}
