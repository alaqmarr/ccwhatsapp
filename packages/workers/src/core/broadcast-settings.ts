import { fromZonedTime } from "date-fns-tz";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { APP_TIMEZONE, getCurrentIstDateAndTime } from "./time-ist";

export type BroadcastPacingMode =
  | "SAFE_STEADY"
  | "EXTRA_CAREFUL"
  | "WARMED_FAST";

export interface BroadcastQueueSafetySettings {
  defaultPacingMode: BroadcastPacingMode;
  delaySeconds: number;
  batchSize: number;
  batchPauseSeconds: number;
  skipRecentHours: number;
  dailyMarketingCap: number;
  autoPauseOnConsecutiveFailures: number;
  quietHoursEnabled: boolean;
  sentTodayMarketingCount: number;
}

export async function getBroadcastQueueSettings(): Promise<BroadcastQueueSafetySettings> {
  await ensureDatabasesBootstrapped();
  const mkt = getRawLibSqlClient("marketing");
  const { dateKey } = getCurrentIstDateAndTime();
  const startOfDayIso = fromZonedTime(`${dateKey} 00:00:00`, APP_TIMEZONE).toISOString();

  const [cfgRes, todayRes] = await Promise.all([
    mkt.execute(
      `SELECT * FROM broadcast_queue_settings WHERE id = 'default' LIMIT 1`
    ),
    mkt.execute({
      sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients r
            JOIN broadcasts b ON b.id = r.broadcast_id
            WHERE b.billing_category = 'MARKETING'
              AND r.status IN ('SENT', 'DELIVERED', 'READ')
              AND r.sent_at >= ?`,
      args: [startOfDayIso],
    }),
  ]);

  const row = (cfgRes.rows[0] || {}) as Record<string, unknown>;
  const modeRaw = String(row.default_pacing_mode || "SAFE_STEADY");
  const defaultPacingMode: BroadcastPacingMode =
    modeRaw === "EXTRA_CAREFUL" || modeRaw === "WARMED_FAST"
      ? modeRaw
      : "SAFE_STEADY";

  return {
    defaultPacingMode,
    delaySeconds: Math.max(1, Number(row.delay_seconds ?? 4)),
    batchSize: Math.max(5, Number(row.batch_size ?? 25)),
    batchPauseSeconds: Math.max(0, Number(row.batch_pause_seconds ?? 20)),
    skipRecentHours: Math.max(0, Number(row.skip_recent_hours ?? 24)),
    dailyMarketingCap: Math.max(10, Number(row.daily_marketing_cap ?? 250)),
    autoPauseOnConsecutiveFailures: Math.max(
      1,
      Number(row.auto_pause_on_consecutive_failures ?? 3)
    ),
    quietHoursEnabled: Number(row.quiet_hours_enabled ?? 0) === 1,
    sentTodayMarketingCount: Number(todayRes.rows[0]?.cnt ?? 0),
  };
}

export async function updateBroadcastQueueSettings(params: {
  defaultPacingMode?: BroadcastPacingMode;
  delaySeconds?: number;
  batchSize?: number;
  batchPauseSeconds?: number;
  skipRecentHours?: number;
  dailyMarketingCap?: number;
  autoPauseOnConsecutiveFailures?: number;
  quietHoursEnabled?: boolean;
  updatedBy: string;
}): Promise<BroadcastQueueSafetySettings> {
  const current = await getBroadcastQueueSettings();
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();

  const nextMode = params.defaultPacingMode || current.defaultPacingMode;
  const nextDelay =
    params.delaySeconds !== undefined
      ? Math.max(1, Math.min(120, Math.round(params.delaySeconds)))
      : current.delaySeconds;
  const nextBatch =
    params.batchSize !== undefined
      ? Math.max(5, Math.min(200, Math.round(params.batchSize)))
      : current.batchSize;
  const nextPause =
    params.batchPauseSeconds !== undefined
      ? Math.max(0, Math.min(600, Math.round(params.batchPauseSeconds)))
      : current.batchPauseSeconds;
  const nextSkipHrs =
    params.skipRecentHours !== undefined
      ? Math.max(0, Math.min(720, Math.round(params.skipRecentHours)))
      : current.skipRecentHours;
  const nextDailyCap =
    params.dailyMarketingCap !== undefined
      ? Math.max(10, Math.min(500000, Math.round(params.dailyMarketingCap)))
      : current.dailyMarketingCap;
  const nextAutoPause =
    params.autoPauseOnConsecutiveFailures !== undefined
      ? Math.max(
          1,
          Math.min(20, Math.round(params.autoPauseOnConsecutiveFailures))
        )
      : current.autoPauseOnConsecutiveFailures;
  const nextQuiet =
    params.quietHoursEnabled !== undefined
      ? params.quietHoursEnabled
      : current.quietHoursEnabled;

  await mkt.execute({
    sql: `UPDATE broadcast_queue_settings
          SET default_pacing_mode = ?,
              delay_seconds = ?,
              batch_size = ?,
              batch_pause_seconds = ?,
              skip_recent_hours = ?,
              daily_marketing_cap = ?,
              auto_pause_on_consecutive_failures = ?,
              quiet_hours_enabled = ?,
              updated_by = ?,
              updated_at = ?
          WHERE id = 'default'`,
    args: [
      nextMode,
      nextDelay,
      nextBatch,
      nextPause,
      nextSkipHrs,
      nextDailyCap,
      nextAutoPause,
      nextQuiet ? 1 : 0,
      params.updatedBy,
      nowIso,
    ],
  });

  return getBroadcastQueueSettings();
}

export function pacingDefaultsForMode(
  mode: BroadcastPacingMode,
  fallback: BroadcastQueueSafetySettings
): { delaySeconds: number; batchSize: number; batchPauseSeconds: number } {
  if (mode === "EXTRA_CAREFUL") {
    return { delaySeconds: 8, batchSize: 15, batchPauseSeconds: 30 };
  }
  if (mode === "WARMED_FAST") {
    return { delaySeconds: 2, batchSize: 40, batchPauseSeconds: 15 };
  }
  return {
    delaySeconds: fallback.delaySeconds || 4,
    batchSize: fallback.batchSize || 25,
    batchPauseSeconds: fallback.batchPauseSeconds ?? 20,
  };
}
