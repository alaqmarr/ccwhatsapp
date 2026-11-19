import crypto from "node:crypto";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { socketHub } from "@cc/sockets";
import type { BillingMessageCategory } from "./billing-ledger";
import { processMarketingBroadcastQueue } from "./broadcast-processor";
import {
  getBroadcastQueueSettings,
  pacingDefaultsForMode,
  type BroadcastPacingMode,
} from "./broadcast-settings";
import {
  ensureBackgroundWorkersRunning,
  triggerBroadcastQueueTick,
} from "./worker-daemon";

/**
 * Enqueues a marketing or utility broadcast into the anti-spam recipient queue:
 * - Deduplicates phones
 * - Skips opted-out contacts (`opt_in_marketing = 0`)
 * - Skips contacts already messaged within `skipRecentHours` (for MARKETING)
 * - Enforces `dailyMarketingCap` so Meta's messaging tier limit is never breached
 * - Staggers `scheduled_at` slots across `delaySeconds` + `batchPauseSeconds`
 */
export async function enqueueBroadcastIntoSafeQueue(params: {
  name?: string;
  listId: string;
  templateId: string;
  pacingMode?: BroadcastPacingMode;
  skipRecentHoursOverride?: number;
  scheduledForIso?: string | null;
  customVariablesOverride?: Record<string, string>;
  createdByName: string;
}): Promise<{
  ok: boolean;
  broadcastId?: string;
  queuedCount?: number;
  skippedCount?: number;
  estimatedDurationSeconds?: number;
  error?: string;
}> {
  await ensureDatabasesBootstrapped();
  const mkt = getRawLibSqlClient("marketing");
  const crm = getRawLibSqlClient("crm_orders");

  const [lRes, tRes, settings] = await Promise.all([
    mkt.execute({
      sql: `SELECT * FROM marketing_lists WHERE id = ? LIMIT 1`,
      args: [params.listId],
    }),
    mkt.execute({
      sql: `SELECT * FROM templates WHERE id = ? LIMIT 1`,
      args: [params.templateId],
    }),
    getBroadcastQueueSettings(),
  ]);

  if (!lRes.rows[0] || !tRes.rows[0]) {
    return { ok: false, error: "Please select a valid customer list and template." };
  }

  const listRow = lRes.rows[0] as Record<string, unknown>;
  const tplRow = tRes.rows[0] as Record<string, unknown>;

  if (String(tplRow.approval_status) !== "APPROVED") {
    return {
      ok: false,
      error: `Template "${String(tplRow.name)}" is currently ${String(
        tplRow.approval_status
      )}. Only Approved templates can be sent in broadcasts.`,
    };
  }

  let rawPhones: string[] = [];
  try {
    rawPhones = JSON.parse(String(listRow.member_phones_json || "[]"));
  } catch {
    rawPhones = [];
  }

  // Deduplicate phones while preserving order
  const seenDigits = new Set<string>();
  const uniquePhones: string[] = [];
  for (const p of rawPhones) {
    const d = String(p || "").replace(/\D/g, "");
    if (d.length >= 10 && !seenDigits.has(d)) {
      seenDigits.add(d);
      uniquePhones.push(p.startsWith("+") ? p : `+${d}`);
    }
  }

  if (uniquePhones.length === 0) {
    return { ok: false, error: "This customer list has no valid WhatsApp phone numbers." };
  }

  const mode: BroadcastPacingMode =
    params.pacingMode || settings.defaultPacingMode;
  const pacing = pacingDefaultsForMode(mode, settings);
  const skipRecentHours =
    params.skipRecentHoursOverride !== undefined
      ? Math.max(0, Number(params.skipRecentHoursOverride))
      : settings.skipRecentHours;

  const category = String(tplRow.category || "MARKETING") as BillingMessageCategory;
  const tplBody = String(tplRow.body_text || "");
  let varSpecs: Array<{
    index: number;
    sourceField?: string;
    sampleValue?: string;
  }> = [];
  try {
    varSpecs = JSON.parse(String(tplRow.variables_schema_json || "[]"));
  } catch {
    varSpecs = [];
  }

  // Fetch customer profiles & latest order numbers scoped to target phones
  const lookupPhoneVariants = Array.from(
    new Set(
      uniquePhones.flatMap((p) => {
        const d = p.replace(/\D/g, "");
        return d ? [`+${d}`, d] : [p];
      })
    )
  );
  const customerByPhone = new Map<string, Record<string, unknown>>();
  const latestOrderByPhone = new Map<string, string>();
  const CHUNK_SIZE = 400;

  for (let i = 0; i < lookupPhoneVariants.length; i += CHUNK_SIZE) {
    const chunk = lookupPhoneVariants.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const [custRes, ordersRes] = await Promise.all([
      crm.execute({
        sql: `SELECT phone, name, opt_in_marketing, company_name, city
              FROM customers
              WHERE phone IN (${placeholders})`,
        args: chunk,
      }),
      crm.execute({
        sql: `SELECT customer_phone, order_number
              FROM customer_orders
              WHERE customer_phone IN (${placeholders})
              ORDER BY ordered_at DESC`,
        args: chunk,
      }),
    ]);

    for (const c of custRes.rows) {
      const d = String(c.phone || "").replace(/\D/g, "");
      if (d) customerByPhone.set(d, c as Record<string, unknown>);
    }
    for (const o of ordersRes.rows) {
      const d = String(o.customer_phone || "").replace(/\D/g, "");
      if (d && !latestOrderByPhone.has(d)) {
        latestOrderByPhone.set(d, String(o.order_number));
      }
    }
  }

  // Recent broadcast cooldown lookup
  const recentlyMessagedDigits = new Set<string>();
  if (category === "MARKETING" && skipRecentHours > 0) {
    const cutoffIso = new Date(
      Date.now() - skipRecentHours * 3600 * 1000
    ).toISOString();
    const recentRes = await mkt.execute({
      sql: `SELECT DISTINCT customer_phone FROM broadcast_recipients
            WHERE status IN ('SENT', 'DELIVERED', 'READ') AND sent_at >= ?`,
      args: [cutoffIso],
    });
    for (const r of recentRes.rows) {
      const d = String(r.customer_phone || "").replace(/\D/g, "");
      if (d) recentlyMessagedDigits.add(d);
    }
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const startBaseMs =
    params.scheduledForIso &&
    !Number.isNaN(new Date(params.scheduledForIso).getTime()) &&
    new Date(params.scheduledForIso).getTime() > nowMs
      ? new Date(params.scheduledForIso).getTime()
      : nowMs;
  const isScheduledFuture = startBaseMs > nowMs + 5000;

  const bcId = `bc_${crypto.randomUUID().slice(0, 8)}`;
  const remainingDailyAllowance =
    category === "MARKETING"
      ? Math.max(0, settings.dailyMarketingCap - settings.sentTodayMarketingCount)
      : Number.MAX_SAFE_INTEGER;

  let queuedCount = 0;
  let skippedCount = 0;
  let cumulativeDelaySec = 0;
  const recipientInserts: Array<{ sql: string; args: any[] }> = [];

  const bodyVarIndices = Array.from(
    new Set(Array.from(tplBody.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1])))
  ).sort((a, b) => a - b);

  for (const phone of uniquePhones) {
    const digits = phone.replace(/\D/g, "");
    const cust = customerByPhone.get(digits);
    const custName = cust ? String(cust.name || phone) : phone;
    const firstName = custName.split(/[\s(]/)[0] || "Sir/Madam";
    const optIn = cust ? Number(cust.opt_in_marketing ?? 1) === 1 : true;

    let skipReason: string | null = null;
    if (!optIn && category === "MARKETING") {
      skipReason = "Customer opted out of promotions";
    } else if (category === "MARKETING" && recentlyMessagedDigits.has(digits)) {
      skipReason = `Already received a broadcast in the last ${skipRecentHours}h`;
    } else if (category === "MARKETING" && queuedCount >= remainingDailyAllowance) {
      skipReason = `Daily WhatsApp marketing cap (${settings.dailyMarketingCap}/day) reached`;
    }

    // Resolve personalized variables
    const resolvedVars = bodyVarIndices.map((idx) => {
      const overrideVal = params.customVariablesOverride?.[String(idx)];
      if (overrideVal && overrideVal.trim()) return overrideVal.trim();

      const spec = varSpecs.find((v) => v.index === idx);
      const src = spec?.sourceField || (idx === 1 ? "customer.firstName" : "custom");
      if (src === "customer.firstName") return firstName;
      if (src === "customer.fullName") return custName;
      if (src === "customer.companyName")
        return String(cust?.company_name || firstName);
      if (src === "customer.city") return String(cust?.city || "India");
      if (src === "order.latestNumber")
        return latestOrderByPhone.get(digits) || spec?.sampleValue || "CC-2026";
      return spec?.sampleValue || firstName;
    });

    let renderedBody = tplBody;
    bodyVarIndices.forEach((idx, pos) => {
      renderedBody = renderedBody.replace(
        new RegExp(`\\{\\{${idx}\\}\\}`, "g"),
        resolvedVars[pos] || ""
      );
    });

    if (skipReason) {
      skippedCount++;
      recipientInserts.push({
        sql: `INSERT INTO broadcast_recipients (
          id, broadcast_id, customer_name, customer_phone, variables_json, rendered_body,
          status, skip_or_error_reason, attempts, scheduled_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'SKIPPED', ?, 0, ?, ?)`,
        args: [
          `bcr_${crypto.randomUUID().slice(0, 8)}`,
          bcId,
          custName,
          phone,
          JSON.stringify(resolvedVars),
          renderedBody,
          skipReason,
          nowIso,
          nowIso,
        ],
      });
      continue;
    }

    if (queuedCount > 0) {
      cumulativeDelaySec += pacing.delaySeconds;
      if (queuedCount % pacing.batchSize === 0) {
        cumulativeDelaySec += pacing.batchPauseSeconds;
      }
    }
    const scheduledIso = new Date(
      startBaseMs + cumulativeDelaySec * 1000
    ).toISOString();
    queuedCount++;

    recipientInserts.push({
      sql: `INSERT INTO broadcast_recipients (
        id, broadcast_id, customer_name, customer_phone, variables_json, rendered_body,
        status, attempts, scheduled_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', 0, ?, ?)`,
      args: [
        `bcr_${crypto.randomUUID().slice(0, 8)}`,
        bcId,
        custName,
        phone,
        JSON.stringify(resolvedVars),
        renderedBody,
        scheduledIso,
        nowIso,
      ],
    });
  }

  const initialStatus =
    queuedCount === 0
      ? "COMPLETED"
      : isScheduledFuture
      ? "SCHEDULED"
      : "SENDING";

  await mkt.batch(
    [
      {
        sql: `INSERT INTO broadcasts (
          id, name, list_id, list_name, template_id, template_name, billing_category,
          status, pacing_mode, delay_seconds, batch_size, batch_pause_seconds, skip_recent_hours,
          total_recipients, queued_count, skipped_count, failed_count, sent_count, delivered_count, read_count,
          client_billed_inr, actual_meta_cost_inr, scheduled_for, next_dispatch_at, started_at, completed_at,
          created_by_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?)`,
        args: [
          bcId,
          (params.name || "").trim() || `${String(listRow.name)} Campaign`,
          params.listId,
          String(listRow.name),
          params.templateId,
          String(tplRow.name),
          category,
          initialStatus,
          mode,
          pacing.delaySeconds,
          pacing.batchSize,
          pacing.batchPauseSeconds,
          skipRecentHours,
          uniquePhones.length,
          queuedCount,
          skippedCount,
          isScheduledFuture ? new Date(startBaseMs).toISOString() : null,
          queuedCount > 0 ? new Date(startBaseMs).toISOString() : null,
          !isScheduledFuture && queuedCount > 0 ? nowIso : null,
          queuedCount === 0 ? nowIso : null,
          params.createdByName,
          nowIso,
        ],
      },
      ...recipientInserts,
    ],
    "write"
  );

  ensureBackgroundWorkersRunning();
  if (!isScheduledFuture && queuedCount > 0) {
    triggerBroadcastQueueTick();
    void processMarketingBroadcastQueue().catch(() => {});
  }

  socketHub.emit("broadcast:progress", {
    broadcastId: bcId,
    status: initialStatus,
    queuedCount,
    skippedCount,
    sent: 0,
  });

  return {
    ok: true,
    broadcastId: bcId,
    queuedCount,
    skippedCount,
    estimatedDurationSeconds: cumulativeDelaySec,
  };
}

export async function pauseMarketingBroadcast(
  broadcastId: string,
  reason = "Paused manually by team."
): Promise<void> {
  const mkt = getRawLibSqlClient("marketing");
  await mkt.execute({
    sql: `UPDATE broadcasts
          SET status = 'PAUSED',
              paused_reason = ?,
              next_dispatch_at = NULL
          WHERE id = ? AND status IN ('QUEUED', 'SENDING', 'SCHEDULED')`,
    args: [reason, broadcastId],
  });
  socketHub.emit("broadcast:progress", { broadcastId, status: "PAUSED" });
}

export async function resumeMarketingBroadcast(
  broadcastId: string
): Promise<void> {
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();
  const remRes = await mkt.execute({
    sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'QUEUED'`,
    args: [broadcastId],
  });
  const remaining = Number(remRes.rows[0]?.cnt ?? 0);
  await mkt.execute({
    sql: `UPDATE broadcasts
          SET status = ?,
              paused_reason = NULL,
              consecutive_failures = 0,
              queued_count = ?,
              next_dispatch_at = ?
          WHERE id = ?`,
    args: [
      remaining > 0 ? "SENDING" : "COMPLETED",
      remaining,
      remaining > 0 ? nowIso : null,
      broadcastId,
    ],
  });
  ensureBackgroundWorkersRunning();
  if (remaining > 0) {
    triggerBroadcastQueueTick();
    void processMarketingBroadcastQueue().catch(() => {});
  }
  socketHub.emit("broadcast:progress", { broadcastId, status: "SENDING" });
}

export async function retryFailedBroadcastRecipients(
  broadcastId: string
): Promise<number> {
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();
  await mkt.execute({
    sql: `UPDATE broadcast_recipients
          SET status = 'QUEUED',
              skip_or_error_reason = NULL,
              scheduled_at = ?
          WHERE broadcast_id = ? AND status = 'FAILED'`,
    args: [nowIso, broadcastId],
  });
  const remRes = await mkt.execute({
    sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'QUEUED'`,
    args: [broadcastId],
  });
  const remaining = Number(remRes.rows[0]?.cnt ?? 0);
  await mkt.execute({
    sql: `UPDATE broadcasts
          SET status = ?,
              failed_count = 0,
              queued_count = ?,
              paused_reason = NULL,
              consecutive_failures = 0,
              next_dispatch_at = ?
          WHERE id = ?`,
    args: [
      remaining > 0 ? "SENDING" : "COMPLETED",
      remaining,
      remaining > 0 ? nowIso : null,
      broadcastId,
    ],
  });
  ensureBackgroundWorkersRunning();
  if (remaining > 0) {
    triggerBroadcastQueueTick();
    void processMarketingBroadcastQueue().catch(() => {});
  }
  socketHub.emit("broadcast:progress", {
    broadcastId,
    status: remaining > 0 ? "SENDING" : "COMPLETED",
  });
  return remaining;
}

export async function cancelMarketingBroadcast(
  broadcastId: string
): Promise<void> {
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();
  await mkt.batch(
    [
      {
        sql: `UPDATE broadcast_recipients
              SET status = 'CANCELLED',
                  skip_or_error_reason = 'Campaign cancelled before sending'
              WHERE broadcast_id = ? AND status = 'QUEUED'`,
        args: [broadcastId],
      },
      {
        sql: `UPDATE broadcasts
              SET status = 'CANCELLED',
                  queued_count = 0,
                  next_dispatch_at = NULL,
                  completed_at = ?
              WHERE id = ?`,
        args: [nowIso, broadcastId],
      },
    ],
    "write"
  );
  socketHub.emit("broadcast:progress", { broadcastId, status: "CANCELLED" });
}
