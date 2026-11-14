import crypto from "node:crypto";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
} from "@cc/database";

export type QueueName =
  | "whatsapp:outbound"
  | "whatsapp:broadcast"
  | "acrio:categorize"
  | "backup:midnight_gdrive"
  | "email:staff_otp";

export interface QueuedJob<TPayload = Record<string, unknown>> {
  id: string;
  queueName: QueueName;
  payload: TPayload;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  errorText: string | null;
  processedAt: string | null;
  createdAt: string;
}

export async function enqueueJob<TPayload = Record<string, unknown>>(
  queueName: QueueName,
  payload: TPayload,
  delayMs = 0
): Promise<string> {
  await ensureDatabasesBootstrapped();
  const db = getRawLibSqlClient("queue_jobs");
  const id = `job_${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date();
  const runAfter = new Date(now.getTime() + Math.max(0, delayMs)).toISOString();

  await db.execute({
    sql: `INSERT INTO jobs (
      id, queue_name, payload_json, status, attempts, max_attempts, run_after, created_at
    ) VALUES (?, ?, ?, 'PENDING', 0, 3, ?, ?)`,
    args: [id, queueName, JSON.stringify(payload ?? {}), runAfter, now.toISOString()],
  });

  return id;
}

export async function claimPendingJobs(
  queueName?: QueueName,
  limit = 5
): Promise<QueuedJob[]> {
  await ensureDatabasesBootstrapped();
  const db = getRawLibSqlClient("queue_jobs");
  const nowIso = new Date().toISOString();

  const res = queueName
    ? await db.execute({
        sql: `SELECT * FROM jobs
              WHERE status = 'PENDING' AND queue_name = ? AND run_after <= ?
              ORDER BY created_at ASC
              LIMIT ?`,
        args: [queueName, nowIso, limit],
      })
    : await db.execute({
        sql: `SELECT * FROM jobs
              WHERE status = 'PENDING' AND run_after <= ?
              ORDER BY created_at ASC
              LIMIT ?`,
        args: [nowIso, limit],
      });

  const claimed: QueuedJob[] = [];
  for (const row of res.rows) {
    const id = String(row.id);
    const upd = await db.execute({
      sql: `UPDATE jobs
            SET status = 'PROCESSING', attempts = attempts + 1
            WHERE id = ? AND status = 'PENDING'`,
      args: [id],
    });
    if ((upd.rowsAffected ?? 0) > 0) {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(String(row.payload_json || "{}"));
      } catch {
        payload = {};
      }
      claimed.push({
        id,
        queueName: String(row.queue_name) as QueueName,
        payload,
        status: "PROCESSING",
        attempts: Number(row.attempts ?? 0) + 1,
        maxAttempts: Number(row.max_attempts ?? 3),
        runAfter: String(row.run_after),
        errorText: row.error_text ? String(row.error_text) : null,
        processedAt: null,
        createdAt: String(row.created_at),
      });
    }
  }

  return claimed;
}

export async function completeJob(jobId: string): Promise<void> {
  const db = getRawLibSqlClient("queue_jobs");
  await db.execute({
    sql: `UPDATE jobs SET status = 'COMPLETED', processed_at = ?, error_text = NULL WHERE id = ?`,
    args: [new Date().toISOString(), jobId],
  });
}

export async function failJob(job: QueuedJob, errorMessage: string): Promise<void> {
  const db = getRawLibSqlClient("queue_jobs");
  const shouldRetry = job.attempts < job.maxAttempts;
  const retryAt = new Date(Date.now() + 15000 * job.attempts).toISOString();

  await db.execute({
    sql: `UPDATE jobs
          SET status = ?, run_after = ?, error_text = ?, processed_at = ?
          WHERE id = ?`,
    args: [
      shouldRetry ? "PENDING" : "FAILED",
      shouldRetry ? retryAt : job.runAfter,
      errorMessage.slice(0, 500),
      new Date().toISOString(),
      job.id,
    ],
  });
}

export async function recordWorkerHeartbeat(
  workerName: string,
  status: string,
  processedDelta = 0,
  info: Record<string, unknown> = {}
): Promise<void> {
  await ensureDatabasesBootstrapped();
  const db = getRawLibSqlClient("queue_jobs");
  const nowIso = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO worker_heartbeats (worker_name, status, last_beat_at, processed_count, info_json)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(worker_name) DO UPDATE SET
            status = excluded.status,
            last_beat_at = excluded.last_beat_at,
            processed_count = worker_heartbeats.processed_count + ?,
            info_json = excluded.info_json`,
    args: [workerName, status, nowIso, processedDelta, JSON.stringify(info), processedDelta],
  });
}

export async function getQueueTelemetry(): Promise<{
  counts: Record<string, number>;
  recentJobs: QueuedJob[];
  workers: {
    workerName: string;
    status: string;
    lastBeatAt: string;
    processedCount: number;
    info: Record<string, unknown>;
  }[];
}> {
  await ensureDatabasesBootstrapped();
  const db = getRawLibSqlClient("queue_jobs");

  const [grp, recent, workersRes] = await Promise.all([
    db.execute(`SELECT status, COUNT(*) as cnt FROM jobs GROUP BY status`),
    db.execute(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT 15`),
    db.execute(`SELECT * FROM worker_heartbeats ORDER BY worker_name ASC`),
  ]);

  const counts: Record<string, number> = {
    PENDING: 0,
    PROCESSING: 0,
    COMPLETED: 0,
    FAILED: 0,
  };
  for (const r of grp.rows) {
    counts[String(r.status)] = Number(r.cnt ?? 0);
  }

  return {
    counts,
    recentJobs: recent.rows.map((r) => ({
      id: String(r.id),
      queueName: String(r.queue_name) as QueueName,
      payload: (() => {
        try {
          return JSON.parse(String(r.payload_json || "{}"));
        } catch {
          return {};
        }
      })(),
      status: String(r.status) as QueuedJob["status"],
      attempts: Number(r.attempts ?? 0),
      maxAttempts: Number(r.max_attempts ?? 3),
      runAfter: String(r.run_after),
      errorText: r.error_text ? String(r.error_text) : null,
      processedAt: r.processed_at ? String(r.processed_at) : null,
      createdAt: String(r.created_at),
    })),
    workers: workersRes.rows.map((w) => ({
      workerName: String(w.worker_name),
      status: String(w.status),
      lastBeatAt: String(w.last_beat_at),
      processedCount: Number(w.processed_count ?? 0),
      info: (() => {
        try {
          return JSON.parse(String(w.info_json || "{}"));
        } catch {
          return {};
        }
      })(),
    })),
  };
}
