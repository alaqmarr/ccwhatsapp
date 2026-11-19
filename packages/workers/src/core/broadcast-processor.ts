import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { sendWhatsAppCloudMessage } from "@cc/connections";
import { socketHub } from "@cc/sockets";
import { recordDualPricingLedgerEntry, type BillingMessageCategory } from "./billing-ledger";
import { getBroadcastQueueSettings } from "./broadcast-settings";

const globalBroadcastLock = globalThis as unknown as {
  __ccMarketingQueueRunning?: boolean;
};

/**
 * Legacy queue job bridge in case `whatsapp:broadcast` job exists in `queue_jobs.db`
 */
export async function executeBroadcastJob(_payload: Record<string, unknown>): Promise<void> {
  await processMarketingBroadcastQueue();
}

/**
 * Safe Paced Marketing Broadcast Queue Worker:
 * Sends at most 1 message per active campaign per tick according to `delay_seconds`
 * and `batch_pause_seconds`, with automatic circuit-breaker pause if Meta flags rate/spam errors!
 */
export async function processMarketingBroadcastQueue(): Promise<number> {
  if (globalBroadcastLock.__ccMarketingQueueRunning) return 0;
  globalBroadcastLock.__ccMarketingQueueRunning = true;

  let dispatchedCount = 0;
  try {
    await ensureDatabasesBootstrapped();
    const mkt = getRawLibSqlClient("marketing");
    const settings = await getBroadcastQueueSettings();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // Activate any SCHEDULED broadcasts whose scheduled start time has arrived
    await mkt.execute({
      sql: `UPDATE broadcasts
            SET status = 'SENDING',
                started_at = COALESCE(started_at, ?)
            WHERE status = 'SCHEDULED'
              AND scheduled_for IS NOT NULL
              AND scheduled_for <= ?`,
      args: [nowIso, nowIso],
    });

    const activeRes = await mkt.execute({
      sql: `SELECT * FROM broadcasts
            WHERE status IN ('QUEUED', 'SENDING')
              AND (next_dispatch_at IS NULL OR next_dispatch_at <= ?)
            ORDER BY created_at ASC
            LIMIT 3`,
      args: [nowIso],
    });

    for (const bRow of activeRes.rows) {
      const bcId = String(bRow.id);
      const delaySec = Math.max(1, Number(bRow.delay_seconds ?? 4));
      const batchSize = Math.max(5, Number(bRow.batch_size ?? 25));
      const batchPauseSec = Math.max(0, Number(bRow.batch_pause_seconds ?? 20));
      const category = String(
        bRow.billing_category || "MARKETING"
      ) as BillingMessageCategory;

      // Pick the single next queued recipient due for sending
      const nextRecRes = await mkt.execute({
        sql: `SELECT * FROM broadcast_recipients
              WHERE broadcast_id = ? AND status = 'QUEUED'
              ORDER BY scheduled_at ASC, created_at ASC
              LIMIT 1`,
        args: [bcId],
      });

      const rec = nextRecRes.rows[0] as Record<string, unknown> | undefined;
      if (!rec) {
        // No more QUEUED recipients -> finalize campaign as COMPLETED
        await mkt.execute({
          sql: `UPDATE broadcasts
                SET status = 'COMPLETED',
                    queued_count = 0,
                    next_dispatch_at = NULL,
                    completed_at = COALESCE(completed_at, ?)
                WHERE id = ?`,
          args: [nowIso, bcId],
        });
        socketHub.emit("broadcast:progress", {
          broadcastId: bcId,
          status: "COMPLETED",
        });
        continue;
      }

      // Fetch template details for structured Meta components
      const tplRes = await mkt.execute({
        sql: `SELECT * FROM templates WHERE id = ? LIMIT 1`,
        args: [String(bRow.template_id)],
      });
      const tpl = (tplRes.rows[0] || {}) as Record<string, unknown>;
      const tplName = String(tpl.name || bRow.template_name || "");
      const tplLang = String(tpl.language || "en");
      const headerType = String(tpl.header_type || "NONE");
      const headerMediaUrl = tpl.header_media_url
        ? String(tpl.header_media_url)
        : "";

      let resolvedVars: string[] = [];
      try {
        resolvedVars = JSON.parse(String(rec.variables_json || "[]"));
      } catch {
        resolvedVars = [];
      }

      const templateComponents: Record<string, unknown>[] = [];
      if (
        (headerType === "IMAGE" ||
          headerType === "VIDEO" ||
          headerType === "DOCUMENT") &&
        headerMediaUrl
      ) {
        const mediaKey = headerType.toLowerCase();
        templateComponents.push({
          type: "header",
          parameters: [
            {
              type: mediaKey,
              [mediaKey]: { link: headerMediaUrl },
            },
          ],
        });
      }
      if (resolvedVars.length > 0) {
        templateComponents.push({
          type: "body",
          parameters: resolvedVars.map((val) => ({
            type: "text",
            text: String(val),
          })),
        });
      }

      const recId = String(rec.id);
      const phone = String(rec.customer_phone);
      const renderedBody = String(rec.rendered_body || tpl.body_text || "");

      await mkt.execute({
        sql: `UPDATE broadcast_recipients SET status = 'SENDING', attempts = attempts + 1 WHERE id = ?`,
        args: [recId],
      });

      const out = await sendWhatsAppCloudMessage({
        toPhone: phone,
        bodyText: renderedBody,
        templateName: tplName,
        languageCode: tplLang,
        templateComponents,
      });

      const finishedAtMs = Date.now();
      const finishedIso = new Date(finishedAtMs).toISOString();

      if (out.ok) {
        dispatchedCount++;
        const billed = await recordDualPricingLedgerEntry({
          broadcastId: bcId,
          customerPhone: phone,
          category,
          staffName: `Broadcast: ${String(bRow.name)}`,
          deliveryMode: out.mode,
        });

        const nextSentCount = Number(bRow.sent_count ?? 0) + 1;
        const isBatchBoundary = nextSentCount % batchSize === 0;
        const waitSeconds =
          delaySec + (isBatchBoundary ? batchPauseSec : 0);
        const nextDispatchIso = new Date(
          finishedAtMs + waitSeconds * 1000
        ).toISOString();

        await mkt.batch(
          [
            {
              sql: `UPDATE broadcast_recipients
                    SET status = ?,
                        sent_at = ?,
                        wa_message_id = ?,
                        skip_or_error_reason = NULL
                    WHERE id = ?`,
              args: [
                out.deliveryStatus === "DELIVERED" ? "DELIVERED" : "SENT",
                finishedIso,
                out.waMessageId,
                recId,
              ],
            },
            {
              sql: `UPDATE templates SET sent_count = sent_count + 1 WHERE id = ?`,
              args: [String(bRow.template_id)],
            },
          ],
          "write"
        );

        // Recount remaining queued items accurately
        const remRes = await mkt.execute({
          sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'QUEUED'`,
          args: [bcId],
        });
        const remainingQueued = Number(remRes.rows[0]?.cnt ?? 0);
        const nextStatus = remainingQueued === 0 ? "COMPLETED" : "SENDING";

        await mkt.execute({
          sql: `UPDATE broadcasts
                SET status = ?,
                    sent_count = sent_count + 1,
                    delivered_count = delivered_count + (CASE WHEN ? = 'DELIVERED' THEN 1 ELSE 0 END),
                    queued_count = ?,
                    consecutive_failures = 0,
                    client_billed_inr = ROUND(client_billed_inr + ?, 2),
                    actual_meta_cost_inr = ROUND(actual_meta_cost_inr + ?, 4),
                    next_dispatch_at = ?,
                    started_at = COALESCE(started_at, ?),
                    completed_at = CASE WHEN ? = 0 THEN ? ELSE completed_at END
                WHERE id = ?`,
          args: [
            nextStatus,
            out.deliveryStatus,
            remainingQueued,
            billed.clientUnitRateInr,
            billed.actualMetaUnitCostInr,
            remainingQueued > 0 ? nextDispatchIso : null,
            finishedIso,
            remainingQueued,
            finishedIso,
            bcId,
          ],
        });

        socketHub.emit("broadcast:progress", {
          broadcastId: bcId,
          status: nextStatus,
          sentCount: nextSentCount,
          queuedCount: remainingQueued,
          nextDispatchAt: remainingQueued > 0 ? nextDispatchIso : null,
        });
      } else {
        const nextConsecutiveFailures =
          Number(bRow.consecutive_failures ?? 0) + 1;
        const shouldCircuitBreak =
          Boolean(out.isRateOrSpamBlock) ||
          nextConsecutiveFailures >= settings.autoPauseOnConsecutiveFailures;

        await mkt.execute({
          sql: `UPDATE broadcast_recipients
                SET status = 'FAILED',
                    skip_or_error_reason = ?
                WHERE id = ?`,
          args: [out.error || "Delivery failed", recId],
        });

        const remRes = await mkt.execute({
          sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'QUEUED'`,
          args: [bcId],
        });
        const remainingQueued = Number(remRes.rows[0]?.cnt ?? 0);

        if (shouldCircuitBreak && remainingQueued > 0) {
          const pauseReason = out.isRateOrSpamBlock
            ? `Paused automatically to protect your WhatsApp number from Meta rate limits (${out.error || "rate limit"}). Wait 15 minutes before resuming.`
            : `Paused automatically after ${nextConsecutiveFailures} failed messages in a row (${out.error || "send error"}). Check settings and click Resume.`;

          await mkt.execute({
            sql: `UPDATE broadcasts
                  SET status = 'PAUSED',
                      failed_count = failed_count + 1,
                      queued_count = ?,
                      consecutive_failures = ?,
                      paused_reason = ?,
                      next_dispatch_at = NULL
                  WHERE id = ?`,
            args: [remainingQueued, nextConsecutiveFailures, pauseReason, bcId],
          });

          socketHub.emit("broadcast:progress", {
            broadcastId: bcId,
            status: "PAUSED",
            pausedReason: pauseReason,
          });
        } else {
          const nextStatus = remainingQueued === 0 ? "COMPLETED" : "SENDING";
          const nextDispatchIso = new Date(
            finishedAtMs + delaySec * 1000
          ).toISOString();
          await mkt.execute({
            sql: `UPDATE broadcasts
                  SET status = ?,
                      failed_count = failed_count + 1,
                      queued_count = ?,
                      consecutive_failures = ?,
                      next_dispatch_at = ?,
                      completed_at = CASE WHEN ? = 0 THEN ? ELSE completed_at END
                  WHERE id = ?`,
            args: [
              nextStatus,
              remainingQueued,
              nextConsecutiveFailures,
              remainingQueued > 0 ? nextDispatchIso : null,
              remainingQueued,
              finishedIso,
              bcId,
            ],
          });
          socketHub.emit("broadcast:progress", {
            broadcastId: bcId,
            status: nextStatus,
            queuedCount: remainingQueued,
          });
        }
      }
    }
  } finally {
    globalBroadcastLock.__ccMarketingQueueRunning = false;
  }

  return dispatchedCount;
}
