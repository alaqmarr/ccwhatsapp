import crypto from "node:crypto";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
} from "@cc/database";
import {
  executeMultiDatabaseBackup,
  sendWhatsAppCloudMessage,
} from "@cc/connections";
import {
  claimPendingJobs,
  completeJob,
  enqueueJob,
  failJob,
  recordWorkerHeartbeat,
} from "@cc/queue";
import { socketHub } from "@cc/sockets";

export type BillingMessageCategory =
  | "MARKETING"
  | "UTILITY"
  | "AUTHENTICATION"
  | "SERVICE";

/**
 * Dual-Ledger Billing Engine:
 * - Client & Admins see Classic Concepts configured rates (default ₹0.95 Marketing, ₹0.30 Auth/Utility/Service).
 * - DEV sees actual Meta wholesale rates + exact net margin per message!
 */
export async function recordDualPricingLedgerEntry(params: {
  messageId?: string;
  broadcastId?: string;
  conversationId?: string;
  customerPhone: string;
  category: BillingMessageCategory;
  staffName: string;
}): Promise<{
  clientUnitRateInr: number;
  actualMetaUnitCostInr: number;
  marginInr: number;
}> {
  await ensureDatabasesBootstrapped();
  const bill = getRawLibSqlClient("billing_ops");

  const cfgRes = await bill.execute(
    `SELECT * FROM pricing_config WHERE id = 'default' LIMIT 1`
  );
  const cfg = (cfgRes.rows[0] || {}) as Record<string, unknown>;

  const clientMarketing = Number(cfg.client_marketing_rate_inr ?? 0.95);
  const clientOther = Number(cfg.client_other_rate_inr ?? 0.3);

  const metaMarketing = Number(cfg.actual_meta_marketing_rate_inr ?? 0.7846);
  const metaUtility = Number(cfg.actual_meta_utility_rate_inr ?? 0.115);
  const metaAuth = Number(cfg.actual_meta_auth_rate_inr ?? 0.115);
  const metaService = Number(cfg.actual_meta_service_rate_inr ?? 0.08);

  const clientUnitRateInr =
    params.category === "MARKETING" ? clientMarketing : clientOther;

  let actualMetaUnitCostInr = metaUtility;
  if (params.category === "MARKETING") actualMetaUnitCostInr = metaMarketing;
  else if (params.category === "AUTHENTICATION") actualMetaUnitCostInr = metaAuth;
  else if (params.category === "SERVICE") actualMetaUnitCostInr = metaService;

  const marginInr = Number(
    (clientUnitRateInr - actualMetaUnitCostInr).toFixed(4)
  );

  await bill.execute({
    sql: `INSERT INTO message_billing_ledger (
      id, message_id, broadcast_id, conversation_id, customer_phone,
      category, client_unit_rate_inr, actual_meta_unit_cost_inr, margin_inr, staff_name, billed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `ldg_${crypto.randomUUID().slice(0, 10)}`,
      params.messageId || null,
      params.broadcastId || null,
      params.conversationId || null,
      params.customerPhone,
      params.category,
      clientUnitRateInr,
      actualMetaUnitCostInr,
      marginInr,
      params.staffName,
      new Date().toISOString(),
    ],
  });

  return { clientUnitRateInr, actualMetaUnitCostInr, marginInr };
}

/**
 * Runs enabled inbound automations (keyword smart-tagging, priority boosts, auto-greetings).
 */
export async function processInboundAutomations(params: {
  conversationId: string;
  customerPhone: string;
  inboundText: string;
  isNewConversation: boolean;
}): Promise<void> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");

  const rulesRes = await conv.execute(
    `SELECT * FROM automations WHERE is_enabled = 1`
  );
  const lower = params.inboundText.toLowerCase();
  const nowIso = new Date().toISOString();

  for (const r of rulesRes.rows) {
    const triggerType = String(r.trigger_type);
    const cond = String(r.trigger_condition || "").toLowerCase();
    const actionType = String(r.action_type);
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(String(r.action_payload_json || "{}"));
    } catch {
      payload = {};
    }

    let matched = false;
    if (triggerType === "FIRST_CONTACT" && params.isNewConversation) {
      matched = true;
    } else if (triggerType === "KEYWORD" && cond) {
      const words = cond.split(",").map((w) => w.trim()).filter(Boolean);
      matched = words.some((w) => lower.includes(w));
    }

    if (!matched) continue;

    await conv.execute({
      sql: `UPDATE automations SET runs_count = runs_count + 1, last_triggered_at = ? WHERE id = ?`,
      args: [nowIso, String(r.id)],
    });

    if (actionType === "SMART_TAG") {
      await conv.execute({
        sql: `UPDATE conversations
              SET smart_category = COALESCE(?, smart_category),
                  priority = COALESCE(?, priority)
              WHERE id = ?`,
        args: [
          payload.smartCategory ? String(payload.smartCategory) : null,
          payload.priority ? String(payload.priority) : null,
          params.conversationId,
        ],
      });
    } else if (actionType === "AUTO_REPLY" && payload.replyText) {
      const replyBody = String(payload.replyText);
      const sendRes = await sendWhatsAppCloudMessage({
        toPhone: params.customerPhone,
        bodyText: replyBody,
      });
      const msgId = `msg_${crypto.randomUUID().slice(0, 8)}`;
      await conv.execute({
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, wa_message_id, delivery_status, created_at
        ) VALUES (?, ?, 'OUTBOUND', 'AUTOMATION', ?, 'TEXT', 'SERVICE', ?, ?, ?, ?)`,
        args: [
          msgId,
          params.conversationId,
          String(r.name),
          replyBody,
          sendRes.waMessageId,
          sendRes.deliveryStatus,
          nowIso,
        ],
      });
      await recordDualPricingLedgerEntry({
        messageId: msgId,
        conversationId: params.conversationId,
        customerPhone: params.customerPhone,
        category: "SERVICE",
        staffName: `Automation: ${String(r.name)}`,
      });
    }
  }
}

/**
 * Processes pending jobs across queues (`backup:midnight_gdrive`, `whatsapp:broadcast`, etc.)
 */
export async function drainPendingWorkerJobs(): Promise<number> {
  const jobs = await claimPendingJobs(undefined, 8);
  let processed = 0;

  for (const job of jobs) {
    try {
      if (job.queueName === "backup:midnight_gdrive") {
        const source =
          job.payload.triggerSource === "MANUAL_DEV"
            ? "MANUAL_DEV"
            : "MIDNIGHT_CRON";
        const res = await executeMultiDatabaseBackup(source);
        if (!res.ok) throw new Error(res.detailsMessage);
      } else if (job.queueName === "whatsapp:broadcast") {
        await executeBroadcastJob(job.payload);
      }
      await completeJob(job.id);
      processed++;
    } catch (err: any) {
      await failJob(job, err?.message || "Worker job error");
    }
  }

  await recordWorkerHeartbeat("cc-primary-worker", "ONLINE", processed, {
    lastCheckedAt: new Date().toISOString(),
  });

  if (processed > 0) {
    socketHub.emit("queue:updated", { processed });
  }
  return processed;
}

async function executeBroadcastJob(payload: Record<string, unknown>): Promise<void> {
  const broadcastId = String(payload.broadcastId || "");
  if (!broadcastId) return;

  const mkt = getRawLibSqlClient("marketing");
  const bcRes = await mkt.execute({
    sql: `SELECT * FROM broadcasts WHERE id = ? LIMIT 1`,
    args: [broadcastId],
  });
  if (!bcRes.rows[0]) return;
  const bc = bcRes.rows[0] as Record<string, unknown>;

  const listRes = await mkt.execute({
    sql: `SELECT * FROM marketing_lists WHERE id = ? LIMIT 1`,
    args: [String(bc.list_id)],
  });
  const tplRes = await mkt.execute({
    sql: `SELECT * FROM templates WHERE id = ? LIMIT 1`,
    args: [String(bc.template_id)],
  });

  let phones: string[] = [];
  try {
    phones = JSON.parse(String(listRes.rows[0]?.member_phones_json || "[]"));
  } catch {
    phones = [];
  }

  const tplName = String(tplRes.rows[0]?.name || bc.template_name || "");
  const tplBody = String(tplRes.rows[0]?.body_text || "Hello from Classic Concepts!");
  const category = (String(bc.billing_category || "MARKETING") as BillingMessageCategory);

  let sent = 0;
  let delivered = 0;
  let totalClientBilled = 0;
  let totalMetaCost = 0;

  for (const phone of phones) {
    const out = await sendWhatsAppCloudMessage({
      toPhone: phone,
      bodyText: tplBody,
      templateName: tplName,
    });
    if (out.ok) {
      sent++;
      if (out.deliveryStatus === "DELIVERED" || out.deliveryStatus === "SENT") {
        delivered++;
      }
      const billed = await recordDualPricingLedgerEntry({
        broadcastId,
        customerPhone: phone,
        category,
        staffName: `Broadcast: ${String(bc.name)}`,
      });
      totalClientBilled += billed.clientUnitRateInr;
      totalMetaCost += billed.actualMetaUnitCostInr;
    }
  }

  await mkt.execute({
    sql: `UPDATE broadcasts
          SET status = 'COMPLETED',
              sent_count = ?,
              delivered_count = ?,
              client_billed_inr = ?,
              actual_meta_cost_inr = ?
          WHERE id = ?`,
    args: [
      sent,
      delivered,
      Number(totalClientBilled.toFixed(2)),
      Number(totalMetaCost.toFixed(4)),
      broadcastId,
    ],
  });

  socketHub.emit("broadcast:progress", {
    broadcastId,
    status: "COMPLETED",
    sent,
    delivered,
  });
}

function getCurrentIstDateAndTime(): {
  dateKey: string;
  hour: number;
  minute: number;
} {
  const now = new Date();
  // IST = UTC + 05:30
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  return {
    dateKey: `${yyyy}-${mm}-${dd}`,
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
  };
}

const globalWorkerRunner = globalThis as unknown as {
  __ccBackgroundWorkersStarted?: boolean;
  __ccLastMidnightBackupDate?: string;
};

/**
 * Idempotent in-process background daemon started automatically by the server:
 * 1. Drains LibSQL job queues every 6 seconds.
 * 2. Checks the Midnight IST Google Drive Backup schedule every 30 seconds and triggers backup automatically!
 */
export function ensureBackgroundWorkersRunning(): void {
  if (globalWorkerRunner.__ccBackgroundWorkersStarted) return;
  globalWorkerRunner.__ccBackgroundWorkersStarted = true;

  // Initial heartbeat
  void recordWorkerHeartbeat("midnight-gdrive-scheduler", "ONLINE", 0, {
    schedule: "Daily Midnight IST (Configurable in Dev Panel)",
  });
  void drainPendingWorkerJobs();

  // Queue consumer loop
  setInterval(() => {
    void drainPendingWorkerJobs().catch(() => {});
  }, 6000);

  // Midnight IST Google Drive Backup scheduler loop
  setInterval(async () => {
    try {
      await ensureDatabasesBootstrapped();
      const bill = getRawLibSqlClient("billing_ops");
      const res = await bill.execute(
        `SELECT * FROM backup_settings WHERE id = 'default' LIMIT 1`
      );
      const cfg = res.rows[0];
      if (!cfg || Number(cfg.enabled ?? 1) !== 1) return;

      const targetHour = Number(cfg.midnight_hour_ist ?? 0);
      const targetMinute = Number(cfg.midnight_minute_ist ?? 0);
      const { dateKey, hour, minute } = getCurrentIstDateAndTime();

      if (
        hour === targetHour &&
        minute === targetMinute &&
        globalWorkerRunner.__ccLastMidnightBackupDate !== dateKey
      ) {
        globalWorkerRunner.__ccLastMidnightBackupDate = dateKey;
        await enqueueJob("backup:midnight_gdrive", {
          triggerSource: "MIDNIGHT_CRON",
          dateKey,
        });
        await drainPendingWorkerJobs();
      }

      await recordWorkerHeartbeat("midnight-gdrive-scheduler", "ONLINE", 0, {
        configuredTimeIst: `${String(targetHour).padStart(2, "0")}:${String(
          targetMinute
        ).padStart(2, "0")} IST`,
        enabled: Number(cfg.enabled ?? 1) === 1,
      });
    } catch {
      // Non-blocking cron guard
    }
  }, 30000);
}
