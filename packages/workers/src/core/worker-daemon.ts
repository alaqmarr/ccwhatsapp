import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { executeMultiDatabaseBackup } from "@cc/connections";
import {
  claimPendingJobs,
  completeJob,
  enqueueJob,
  failJob,
  recordWorkerHeartbeat,
} from "@cc/queue";
import { socketHub } from "@cc/sockets";
import { requeueStaleStaffNoteJobs, runStaffNoteAnswerJob } from "@cc/workers/staff-notes";
import {
  executeBroadcastJob,
  processMarketingBroadcastQueue,
} from "./broadcast-processor";
import { checkAndEscalateWaitingChats } from "./wait-time-escalation";
import { getCurrentIstDateAndTime } from "./time-ist";

const ACTIVE_BROADCAST_POLL_MS = 2000;
const IDLE_BROADCAST_POLL_MS = 20000;

const globalWorkerRunner = globalThis as unknown as {
  __ccBackgroundWorkersStarted?: boolean;
  __ccLastMidnightBackupDate?: string;
  __ccBroadcastLoopTimer?: ReturnType<typeof setTimeout> | null;
};

function areInProcessWorkersDisabled(): boolean {
  const role = String(process.env.WORKER_ROLE || "").trim().toLowerCase();
  return (
    process.env.DISABLE_IN_PROCESS_WORKERS === "1" ||
    role === "web" ||
    role === "disabled"
  );
}

async function hasActiveOrDueBroadcasts(): Promise<boolean> {
  try {
    await ensureDatabasesBootstrapped();
    const mkt = getRawLibSqlClient("marketing");
    const nowIso = new Date().toISOString();
    const res = await mkt.execute({
      sql: `SELECT 1 FROM broadcasts
            WHERE status IN ('QUEUED', 'SENDING')
               OR (status = 'SCHEDULED' AND scheduled_for IS NOT NULL AND scheduled_for <= ?)
            LIMIT 1`,
      args: [nowIso],
    });
    return res.rows.length > 0;
  } catch {
    return false;
  }
}

function scheduleNextBroadcastTick(delayMs: number): void {
  if (globalWorkerRunner.__ccBroadcastLoopTimer) {
    clearTimeout(globalWorkerRunner.__ccBroadcastLoopTimer);
    globalWorkerRunner.__ccBroadcastLoopTimer = null;
  }
  const timer = setTimeout(() => {
    void runBroadcastQueueTick();
  }, delayMs);
  timer.unref();
  globalWorkerRunner.__ccBroadcastLoopTimer = timer;
}

async function runBroadcastQueueTick(): Promise<void> {
  if (!globalWorkerRunner.__ccBackgroundWorkersStarted || areInProcessWorkersDisabled()) {
    return;
  }
  let dispatched = 0;
  try {
    dispatched = await processMarketingBroadcastQueue();
  } catch {
    dispatched = 0;
  }
  const hasMore = dispatched > 0 || (await hasActiveOrDueBroadcasts());
  scheduleNextBroadcastTick(
    hasMore ? ACTIVE_BROADCAST_POLL_MS : IDLE_BROADCAST_POLL_MS
  );
}

/**
 * Wakes up the adaptive broadcast queue loop immediately (for example when a broadcast
 * is created, resumed, or failed recipients are retried).
 */
export function triggerBroadcastQueueTick(): void {
  if (areInProcessWorkersDisabled()) return;
  if (!globalWorkerRunner.__ccBackgroundWorkersStarted) {
    ensureBackgroundWorkersRunning();
    return;
  }
  scheduleNextBroadcastTick(10);
}

/**
 * Processes pending jobs across queues (`backup:midnight_gdrive`, `whatsapp:broadcast`, etc.)
 */
export async function drainPendingWorkerJobs(): Promise<number> {
  await requeueStaleStaffNoteJobs();
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
      } else if (job.queueName === "acrio:staff_note_answer") {
        await runStaffNoteAnswerJob(job.payload);
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

async function pruneOldJobs(): Promise<void> {
  await ensureDatabasesBootstrapped();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  try {
    const qDb = getRawLibSqlClient("queue_jobs");
    const completedCutoff = new Date(nowMs - 7 * 86400000).toISOString();
    const failedCutoff = new Date(nowMs - 30 * 86400000).toISOString();
    await qDb.execute({
      sql: `DELETE FROM jobs
            WHERE (status = 'COMPLETED' AND created_at < ?)
               OR (status = 'FAILED' AND created_at < ?)`,
      args: [completedCutoff, failedCutoff],
    });
  } catch {
    // Non-blocking job cleanup
  }

  try {
    const authDb = getRawLibSqlClient("core_auth");
    await authDb.execute({
      sql: `DELETE FROM sessions WHERE expires_at <= ?`,
      args: [nowIso],
    });
  } catch {
    // Non-blocking session cleanup
  }
}

/**
 * Idempotent in-process background daemon started automatically by the server:
 * 1. Runs adaptive safe anti-spam marketing broadcast loop (2s when active, 20s when idle).
 * 2. Drains LibSQL job queues every 6 seconds.
 * 3. Checks the Midnight IST Google Drive Backup schedule every 30 seconds.
 * 4. Periodically prunes old jobs and expired auth sessions.
 */
export function ensureBackgroundWorkersRunning(): void {
  if (areInProcessWorkersDisabled()) return;
  if (globalWorkerRunner.__ccBackgroundWorkersStarted) return;
  globalWorkerRunner.__ccBackgroundWorkersStarted = true;

  // Initial heartbeat
  void recordWorkerHeartbeat("midnight-gdrive-scheduler", "ONLINE", 0, {
    schedule: "Daily Midnight IST (Configurable in Dev Panel)",
  });
  void drainPendingWorkerJobs();
  void runBroadcastQueueTick();

  // Queue consumer loop
  const queueTimer = setInterval(() => {
    void drainPendingWorkerJobs().catch(() => {});
  }, 6000);
  queueTimer.unref();

  // Automatic P0 -> P1 -> P2 customer wait-time escalation loop (every 15 seconds)
  const escalationTimer = setInterval(() => {
    void checkAndEscalateWaitingChats().catch(() => {});
  }, 15000);
  escalationTimer.unref();

  // Midnight IST Google Drive Backup scheduler loop
  const backupTimer = setInterval(async () => {
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
  backupTimer.unref();

  // Periodic queue & expired session hygiene
  void pruneOldJobs();
  const pruneTimer = setInterval(() => {
    void pruneOldJobs();
  }, 6 * 60 * 60 * 1000);
  pruneTimer.unref();
}
