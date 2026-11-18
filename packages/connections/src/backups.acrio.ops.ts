import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolveBackupDirectory,
  snapshotAllDatabasesToFolder,
} from "@cc/database";
import { socketHub } from "@cc/sockets";

// ============================================================================
// 3. GOOGLE DRIVE MIDNIGHT MULTI-DB BACKUP CONNECTOR
// ============================================================================
async function getGoogleDriveAccessToken(cfg: {
  serviceAccountEmail: string;
  privateKey: string;
  oauthRefreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<string | null> {
  // Option A: OAuth2 Refresh Token
  if (cfg.oauthRefreshToken && cfg.clientId && cfg.clientSecret) {
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.oauthRefreshToken,
      grant_type: "refresh_token",
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (res.ok) {
      const json: any = await res.json();
      if (json.access_token) return String(json.access_token);
    }
  }

  // Option B: Google Service Account JWT (RS256)
  if (cfg.serviceAccountEmail && cfg.privateKey) {
    const nowSec = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT" })
    ).toString("base64url");
    const claim = Buffer.from(
      JSON.stringify({
        iss: cfg.serviceAccountEmail,
        scope: "https://www.googleapis.com/auth/drive.file",
        aud: "https://oauth2.googleapis.com/token",
        exp: nowSec + 3600,
        iat: nowSec,
      })
    ).toString("base64url");
    const normalizedKey = cfg.privateKey.replace(/\\n/g, "\n");
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(`${header}.${claim}`);
    const signature = signer.sign(normalizedKey, "base64url");
    const assertion = `${header}.${claim}.${signature}`;

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (res.ok) {
      const json: any = await res.json();
      if (json.access_token) return String(json.access_token);
    }
  }

  return null;
}

export async function executeMultiDatabaseBackup(
  triggerSource: "MIDNIGHT_CRON" | "MANUAL_DEV"
): Promise<{
  ok: boolean;
  status: "UPLOADED_TO_GDRIVE" | "SAVED_LOCAL_SNAPSHOT" | "FAILED";
  databasesCount: number;
  totalBytes: number;
  localFolderPath: string;
  googleDriveFileId?: string;
  googleDriveLink?: string;
  detailsMessage: string;
}> {
  await ensureDatabasesBootstrapped();
  const bill = getRawLibSqlClient("billing_ops");
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, "-");
  const backupRoot = resolveBackupDirectory();
  const runFolder = path.join(/*turbopackIgnore: true*/ backupRoot, `snapshot_${stamp}`);

  try {
    const cfgRes = await bill.execute(
      `SELECT * FROM backup_settings WHERE id = 'default' LIMIT 1`
    );
    const cfg = (cfgRes.rows[0] || {}) as Record<string, unknown>;
    const includeMain = Number(cfg.include_main_website_db ?? 1) === 1;
    const retentionDays = Math.max(1, Number(cfg.retention_days ?? 30));

    const snap = await snapshotAllDatabasesToFolder(runFolder, includeMain);

    // Bundle all SQLite snapshots into a compressed .json.gz archive ready for Google Drive upload
    const bundlePayload = {
      createdAt: startedAt,
      triggerSource,
      databases: snap.files.map((f) => ({
        domain: f.domain,
        fileName: path.basename(/*turbopackIgnore: true*/ f.filePath),
        sizeBytes: f.sizeBytes,
        base64: fs.readFileSync(/*turbopackIgnore: true*/ f.filePath).toString("base64"),
      })),
    };
    const compressedArchive = zlib.gzipSync(
      Buffer.from(JSON.stringify(bundlePayload), "utf8")
    );
    const archiveName = `ccwhatsapp_libsql_backup_${stamp}.json.gz`;
    const archivePath = path.join(/*turbopackIgnore: true*/ runFolder, archiveName);
    fs.writeFileSync(/*turbopackIgnore: true*/ archivePath, compressedArchive);

    let status: "UPLOADED_TO_GDRIVE" | "SAVED_LOCAL_SNAPSHOT" =
      "SAVED_LOCAL_SNAPSHOT";
    let gdriveFileId: string | undefined;
    let gdriveLink: string | undefined;
    let detailsMessage = `Saved backup of ${snap.files.length} databases (${(
      snap.totalBytes / 1024
    ).toFixed(1)} KB) on server. Add Google Drive settings below to upload automatically every midnight.`;

    const token = await getGoogleDriveAccessToken({
      serviceAccountEmail: String(cfg.google_service_account_email || "").trim(),
      privateKey: String(cfg.google_private_key || "").trim(),
      oauthRefreshToken: String(cfg.google_oauth_refresh_token || "").trim(),
      clientId: String(cfg.google_client_id || "").trim(),
      clientSecret: String(cfg.google_client_secret || "").trim(),
    }).catch(() => null);

    if (token) {
      const folderId = String(cfg.google_drive_folder_id || "").trim();
      const metadata = {
        name: archiveName,
        mimeType: "application/gzip",
        ...(folderId ? { parents: [folderId] } : {}),
      };
      const boundary = `ccbackup_${crypto.randomBytes(8).toString("hex")}`;
      const multipartBody = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
            metadata
          )}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`,
          "utf8"
        ),
        compressedArchive,
        Buffer.from(`\r\n--${boundary}--`, "utf8"),
      ]);

      const upRes = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
          signal: AbortSignal.timeout(30000),
        }
      );

      if (upRes.ok) {
        const upJson: any = await upRes.json();
        gdriveFileId = String(upJson.id || "");
        gdriveLink = upJson.webViewLink ? String(upJson.webViewLink) : undefined;
        status = "UPLOADED_TO_GDRIVE";
        detailsMessage = `Uploaded ${snap.files.length} databases (${(
          compressedArchive.length / 1024
        ).toFixed(1)} KB) to Google Drive.`;
      } else {
        const errTxt = await upRes.text().catch(() => "");
        detailsMessage = `Saved local backup (${snap.files.length} databases), but Google Drive upload returned HTTP ${upRes.status}: ${errTxt.slice(0, 140)}`;
      }
    }

    // Prune local snapshots older than retentionDays
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(/*turbopackIgnore: true*/ backupRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("snapshot_")) {
        const full = path.join(/*turbopackIgnore: true*/ backupRoot, entry.name);
        const st = fs.statSync(/*turbopackIgnore: true*/ full);
        if (st.mtimeMs < cutoffMs) {
          fs.rmSync(/*turbopackIgnore: true*/ full, { recursive: true, force: true });
        }
      }
    }

    const completedAt = new Date().toISOString();
    await bill.batch(
      [
        {
          sql: `INSERT INTO backup_logs (
            id, started_at, completed_at, trigger_source, status, databases_count,
            total_bytes, local_folder_path, google_drive_file_id, google_drive_link, details_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            `bkp_${crypto.randomUUID().slice(0, 8)}`,
            startedAt,
            completedAt,
            triggerSource,
            status,
            snap.files.length,
            snap.totalBytes,
            runFolder,
            gdriveFileId || null,
            gdriveLink || null,
            detailsMessage,
          ],
        },
        {
          sql: `UPDATE backup_settings SET last_run_at = ?, last_run_status = ?, updated_at = ? WHERE id = 'default'`,
          args: [completedAt, status, completedAt],
        },
      ],
      "write"
    );

    socketHub.emit("backup:completed", {
      status,
      databasesCount: snap.files.length,
      totalBytes: snap.totalBytes,
      completedAt,
    });

    return {
      ok: true,
      status,
      databasesCount: snap.files.length,
      totalBytes: snap.totalBytes,
      localFolderPath: runFolder,
      googleDriveFileId: gdriveFileId,
      googleDriveLink: gdriveLink,
      detailsMessage,
    };
  } catch (err: any) {
    const completedAt = new Date().toISOString();
    const msg = err?.message || "Backup error";
    await bill.execute({
      sql: `INSERT INTO backup_logs (
        id, started_at, completed_at, trigger_source, status, databases_count,
        total_bytes, local_folder_path, details_message
      ) VALUES (?, ?, ?, ?, 'FAILED', 0, 0, ?, ?)`,
      args: [
        `bkp_${crypto.randomUUID().slice(0, 8)}`,
        startedAt,
        completedAt,
        triggerSource,
        runFolder,
        msg,
      ],
    });
    return {
      ok: false,
      status: "FAILED",
      databasesCount: 0,
      totalBytes: 0,
      localFolderPath: runFolder,
      detailsMessage: msg,
    };
  }
}

