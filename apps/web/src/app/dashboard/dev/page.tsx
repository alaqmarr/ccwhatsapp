"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ExternalLink, Play, RefreshCw, Save } from "lucide-react";

interface DbDiag {
  domain: string;
  fileName: string;
  description: string;
  sizeBytes: number;
  tablesCount: number;
  totalRows: number;
}

interface BackupLog {
  id: string;
  startedAt: string;
  completedAt: string;
  triggerSource: string;
  status: string;
  databasesCount: number;
  totalBytes: number;
  localFolderPath: string;
  googleDriveFileId: string | null;
  googleDriveLink: string | null;
  detailsMessage: string;
}

export default function DevBackupsPage() {
  const [databases, setDatabases] = useState<DbDiag[]>([]);
  const [backupLogs, setBackupLogs] = useState<BackupLog[]>([]);

  // Backup settings form
  const [enabled, setEnabled] = useState<boolean>(true);
  const [midnightHourIst, setMidnightHourIst] = useState<number>(0);
  const [midnightMinuteIst, setMidnightMinuteIst] = useState<number>(0);
  const [googleDriveFolderId, setGoogleDriveFolderId] = useState<string>("");
  const [googleServiceAccountEmail, setGoogleServiceAccountEmail] =
    useState<string>("");
  const [googlePrivateKey, setGooglePrivateKey] = useState<string>("");
  const [hasPrivateKey, setHasPrivateKey] = useState<boolean>(false);
  const [googleClientId, setGoogleClientId] = useState<string>("");
  const [googleClientSecret, setGoogleClientSecret] = useState<string>("");
  const [googleOauthRefreshToken, setGoogleOauthRefreshToken] =
    useState<string>("");
  const [hasOauthRefreshToken, setHasOauthRefreshToken] =
    useState<boolean>(false);
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [includeMainWebsiteDb, setIncludeMainWebsiteDb] =
    useState<boolean>(true);

  const [saving, setSaving] = useState<boolean>(false);
  const [runningBackup, setRunningBackup] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string>("");

  const loadDiagnostics = useCallback(async () => {
    const res = await fetch("/api/dev/backups", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setDatabases(data.databases || []);
      setBackupLogs(data.backupLogs || []);

      if (data.backupConfig) {
        setEnabled(Boolean(data.backupConfig.enabled));
        setMidnightHourIst(Number(data.backupConfig.midnightHourIst ?? 0));
        setMidnightMinuteIst(Number(data.backupConfig.midnightMinuteIst ?? 0));
        setGoogleDriveFolderId(data.backupConfig.googleDriveFolderId || "");
        setGoogleServiceAccountEmail(
          data.backupConfig.googleServiceAccountEmail || ""
        );
        setHasPrivateKey(Boolean(data.backupConfig.hasPrivateKey));
        setGoogleClientId(data.backupConfig.googleClientId || "");
        setHasOauthRefreshToken(Boolean(data.backupConfig.hasOauthRefreshToken));
        setRetentionDays(Number(data.backupConfig.retentionDays ?? 30));
        setIncludeMainWebsiteDb(Boolean(data.backupConfig.includeMainWebsiteDb));
      }
    }
  }, []);

  useEffect(() => {
    loadDiagnostics();
  }, [loadDiagnostics]);

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/dev/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_config",
          enabled,
          midnightHourIst,
          midnightMinuteIst,
          googleDriveFolderId,
          googleServiceAccountEmail,
          googlePrivateKey,
          googleClientId,
          googleClientSecret,
          googleOauthRefreshToken,
          retentionDays,
          includeMainWebsiteDb,
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (out.ok) {
        setGooglePrivateKey("");
        setGoogleClientSecret("");
        setGoogleOauthRefreshToken("");
        setStatusBanner("Saved midnight Google Drive backup settings.");
        setTimeout(() => setStatusBanner(""), 4000);
        await loadDiagnostics();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRunBackupNow() {
    setRunningBackup(true);
    setStatusBanner("Backing up databases now...");
    try {
      const res = await fetch("/api/dev/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_now" }),
      });
      const out = await res.json().catch(() => ({}));
      if (out.result) {
        setStatusBanner(out.result.detailsMessage || "Backup finished.");
      }
      await loadDiagnostics();
    } finally {
      setRunningBackup(false);
    }
  }

  return (
    <div className="w-full px-6 py-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">
            Midnight Google Drive Backups & Databases (Dev Only)
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Configure daily midnight backups to Google Drive and check database storage.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadDiagnostics()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white border border-neutral-300 text-xs font-medium text-neutral-700 hover:bg-neutral-50 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            disabled={runningBackup}
            onClick={handleRunBackupNow}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#1da851] hover:bg-[#178c43] text-white text-xs font-medium cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{runningBackup ? "Backing up..." : "Back Up Now"}</span>
          </button>
        </div>
      </div>

      {statusBanner && (
        <div className="p-3.5 rounded-md bg-neutral-100 border border-neutral-300 text-xs font-medium text-neutral-900">
          {statusBanner}
        </div>
      )}

      {/* Midnight Google Drive Backup Settings + History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSaveConfig}
          className="lg:col-span-7 bg-white rounded-lg border border-neutral-200 p-5 space-y-4 text-xs"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">
              Google Drive Daily Backup Schedule
            </h2>
            <label className="inline-flex items-center gap-2 font-medium text-neutral-800 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded accent-[#1da851]"
              />
              <span>Run every night automatically</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Hour (IST, 0 = 12:00 AM)
              </label>
              <input
                type="number"
                min={0}
                max={23}
                value={midnightHourIst}
                onChange={(e) => setMidnightHourIst(Number(e.target.value))}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Minute (IST)
              </label>
              <input
                type="number"
                min={0}
                max={59}
                value={midnightMinuteIst}
                onChange={(e) => setMidnightMinuteIst(Number(e.target.value))}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Keep Local Copies (Days)
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-neutral-700 mb-1">
              Google Drive Folder ID
            </label>
            <input
              type="text"
              value={googleDriveFolderId}
              onChange={(e) => setGoogleDriveFolderId(e.target.value)}
              placeholder="Paste the folder ID from your Google Drive URL"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
            />
          </div>

          <div className="p-3.5 rounded-md bg-neutral-50 border border-neutral-200 space-y-3">
            <div className="font-medium text-neutral-900">
              Option 1: Google Service Account
            </div>
            <div>
              <label className="block font-medium text-neutral-600 mb-1">
                Service Account Email
              </label>
              <input
                type="email"
                value={googleServiceAccountEmail}
                onChange={(e) => setGoogleServiceAccountEmail(e.target.value)}
                placeholder="backup@your-project.iam.gserviceaccount.com"
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-neutral-600 mb-1">
                Private Key{" "}
                {hasPrivateKey && (
                  <span className="text-emerald-700">
                    (Saved • Leave empty to keep current key)
                  </span>
                )}
              </label>
              <textarea
                rows={2}
                value={googlePrivateKey}
                onChange={(e) => setGooglePrivateKey(e.target.value)}
                placeholder="-----BEGIN PRIVATE KEY-----"
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
              />
            </div>
          </div>

          <div className="p-3.5 rounded-md bg-neutral-50 border border-neutral-200 space-y-3">
            <div className="font-medium text-neutral-900">
              Option 2: Personal Google Account Token
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                value={googleClientId}
                onChange={(e) => setGoogleClientId(e.target.value)}
                placeholder="Google Client ID"
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
              />
              <input
                type="password"
                value={googleClientSecret}
                onChange={(e) => setGoogleClientSecret(e.target.value)}
                placeholder="Client Secret"
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
              />
            </div>
            <input
              type="password"
              value={googleOauthRefreshToken}
              onChange={(e) => setGoogleOauthRefreshToken(e.target.value)}
              placeholder={
                hasOauthRefreshToken
                  ? "Refresh Token saved (leave empty to keep)"
                  : "Google Refresh Token"
              }
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
            />
          </div>

          <label className="inline-flex items-center gap-2 font-medium text-neutral-700 cursor-pointer">
            <input
              type="checkbox"
              checked={includeMainWebsiteDb}
              onChange={(e) => setIncludeMainWebsiteDb(e.target.checked)}
              className="rounded accent-[#1da851]"
            />
            <span>Include main Classic Concepts website database in nightly backup</span>
          </label>

          <button
            type="submit"
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? "Saving..." : "Save Backup Settings"}</span>
          </button>
        </form>

        {/* Backup History & Databases */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-3 text-xs">
            <h2 className="text-sm font-semibold text-neutral-900">
              Recent Backups
            </h2>

            {backupLogs.length === 0 ? (
              <p className="text-neutral-400 py-4 text-center">
                No backups run yet. Click &ldquo;Back Up Now&rdquo; at the top right to create one.
              </p>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto">
                {backupLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-md border border-neutral-200 bg-neutral-50 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-neutral-900">
                        {log.databasesCount} databases ({(log.totalBytes / 1024).toFixed(1)} KB)
                      </span>
                      <span
                        className={`text-[11px] font-medium ${
                          log.status.includes("FAILED")
                            ? "text-red-700"
                            : "text-emerald-700"
                        }`}
                      >
                        {log.status === "UPLOADED_TO_GDRIVE"
                          ? "Uploaded to Drive"
                          : log.status === "SAVED_LOCAL_SNAPSHOT"
                          ? "Saved Locally"
                          : "Failed"}
                      </span>
                    </div>
                    <p className="text-neutral-600">{log.detailsMessage}</p>
                    <div className="flex items-center justify-between text-[11px] text-neutral-400">
                      <span>{new Date(log.completedAt).toLocaleString()}</span>
                      {log.googleDriveLink && (
                        <a
                          href={log.googleDriveLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-neutral-900 font-medium underline"
                        >
                          <span>Open in Drive</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-3 text-xs">
            <h2 className="text-sm font-semibold text-neutral-900">
              Databases Included in Backup
            </h2>
            <div className="divide-y divide-neutral-200">
              {databases.map((db) => (
                <div key={db.domain} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium text-neutral-900">
                      {db.fileName}
                    </span>
                    <span className="text-neutral-500">
                      {db.totalRows} records • {(db.sizeBytes / 1024).toFixed(1)} KB
                    </span>
                  </div>
                  <p className="text-neutral-500 mt-0.5">{db.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
