import {
  ensureDatabasesBootstrapped,
  getMultiDatabaseDiagnostics,
  getRawLibSqlClient,
} from "@cc/database";
import { getQueueTelemetry } from "@cc/queue";
import { socketHub } from "@cc/sockets";

export async function loadDevBackupsPayload() {
  await ensureDatabasesBootstrapped();
  const bill = getRawLibSqlClient("billing_ops");

  const [databases, queue, cfgRes, logsRes] = await Promise.all([
    getMultiDatabaseDiagnostics(),
    getQueueTelemetry(),
    bill.execute(`SELECT * FROM backup_settings WHERE id = 'default' LIMIT 1`),
    bill.execute(`SELECT * FROM backup_logs ORDER BY started_at DESC LIMIT 12`),
  ]);

  const cfg = (cfgRes.rows[0] || {}) as Record<string, unknown>;

  return {
    ok: true as const,
    databases,
    queue,
    socketsConnected: socketHub.getConnectedCount(),
    recentEvents: socketHub.getRecentEvents(10),
    backupConfig: {
      enabled: Number(cfg.enabled ?? 1) === 1,
      midnightHourIst: Number(cfg.midnight_hour_ist ?? 0),
      midnightMinuteIst: Number(cfg.midnight_minute_ist ?? 0),
      timezone: String(cfg.timezone || "Asia/Kolkata"),
      googleDriveFolderId: String(cfg.google_drive_folder_id || ""),
      googleServiceAccountEmail: String(cfg.google_service_account_email || ""),
      hasPrivateKey: Boolean(String(cfg.google_private_key || "").trim()),
      hasOauthRefreshToken: Boolean(
        String(cfg.google_oauth_refresh_token || "").trim()
      ),
      googleClientId: String(cfg.google_client_id || ""),
      retentionDays: Number(cfg.retention_days ?? 30),
      includeMainWebsiteDb: Number(cfg.include_main_website_db ?? 1) === 1,
      lastRunAt: cfg.last_run_at ? String(cfg.last_run_at) : null,
      lastRunStatus: cfg.last_run_status ? String(cfg.last_run_status) : null,
    },
    backupLogs: logsRes.rows.map((l) => ({
      id: String(l.id),
      startedAt: String(l.started_at),
      completedAt: String(l.completed_at),
      triggerSource: String(l.trigger_source),
      status: String(l.status),
      databasesCount: Number(l.databases_count ?? 0),
      totalBytes: Number(l.total_bytes ?? 0),
      localFolderPath: String(l.local_folder_path),
      googleDriveFileId: l.google_drive_file_id ? String(l.google_drive_file_id) : null,
      googleDriveLink: l.google_drive_link ? String(l.google_drive_link) : null,
      detailsMessage: String(l.details_message),
    })),
  };
}
