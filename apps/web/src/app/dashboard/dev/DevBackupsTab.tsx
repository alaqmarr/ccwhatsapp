"use client";

import React from "react";
import { ExternalLink, Save } from "lucide-react";
import { CardListSkeleton, formatDateTimeIst } from "@cc/ui";
import type { BackupLog, DbDiag } from "./dev-types";

export interface BackupFormState {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  midnightHourIst: number;
  setMidnightHourIst: (v: number) => void;
  midnightMinuteIst: number;
  setMidnightMinuteIst: (v: number) => void;
  googleDriveFolderId: string;
  setGoogleDriveFolderId: (v: string) => void;
  googleServiceAccountEmail: string;
  setGoogleServiceAccountEmail: (v: string) => void;
  googlePrivateKey: string;
  setGooglePrivateKey: (v: string) => void;
  hasPrivateKey: boolean;
  googleClientId: string;
  setGoogleClientId: (v: string) => void;
  googleClientSecret: string;
  setGoogleClientSecret: (v: string) => void;
  googleOauthRefreshToken: string;
  setGoogleOauthRefreshToken: (v: string) => void;
  hasOauthRefreshToken: boolean;
  retentionDays: number;
  setRetentionDays: (v: number) => void;
  includeMainWebsiteDb: boolean;
  setIncludeMainWebsiteDb: (v: boolean) => void;
  savingBackup: boolean;
  onSaveBackupConfig: (e: React.FormEvent) => void;
}

export default function DevBackupsTab({
  loading,
  backupLogs,
  databases,
  backupForm,
}: {
  loading: boolean;
  backupLogs: BackupLog[];
  databases: DbDiag[];
  backupForm: BackupFormState;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <form
        onSubmit={backupForm.onSaveBackupConfig}
        className="lg:col-span-7 bg-white rounded-lg border border-neutral-200 p-5 space-y-4 text-xs"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">
            Google Drive Daily Backup Schedule
          </h2>
          <label className="inline-flex items-center gap-2 font-medium text-neutral-800 cursor-pointer">
            <input
              type="checkbox"
              checked={backupForm.enabled}
              onChange={(e) => backupForm.setEnabled(e.target.checked)}
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
              value={backupForm.midnightHourIst}
              onChange={(e) => backupForm.setMidnightHourIst(Number(e.target.value))}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-700 mb-1">Minute (IST)</label>
            <input
              type="number"
              min={0}
              max={59}
              value={backupForm.midnightMinuteIst}
              onChange={(e) => backupForm.setMidnightMinuteIst(Number(e.target.value))}
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
              value={backupForm.retentionDays}
              onChange={(e) => backupForm.setRetentionDays(Number(e.target.value))}
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
            value={backupForm.googleDriveFolderId}
            onChange={(e) => backupForm.setGoogleDriveFolderId(e.target.value)}
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
              value={backupForm.googleServiceAccountEmail}
              onChange={(e) => backupForm.setGoogleServiceAccountEmail(e.target.value)}
              placeholder="backup@your-project.iam.gserviceaccount.com"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-600 mb-1">
              Private Key{" "}
              {backupForm.hasPrivateKey && (
                <span className="text-emerald-700">
                  (Saved • Leave empty to keep current key)
                </span>
              )}
            </label>
            <textarea
              rows={2}
              value={backupForm.googlePrivateKey}
              onChange={(e) => backupForm.setGooglePrivateKey(e.target.value)}
              placeholder="Paste PEM private key (BEGIN PRIVATE KEY)"
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
              value={backupForm.googleClientId}
              onChange={(e) => backupForm.setGoogleClientId(e.target.value)}
              placeholder="Google Client ID"
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
            />
            <input
              type="password"
              value={backupForm.googleClientSecret}
              onChange={(e) => backupForm.setGoogleClientSecret(e.target.value)}
              placeholder="Client Secret"
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
            />
          </div>
          <input
            type="password"
            value={backupForm.googleOauthRefreshToken}
            onChange={(e) => backupForm.setGoogleOauthRefreshToken(e.target.value)}
            placeholder={
              backupForm.hasOauthRefreshToken
                ? "Refresh Token saved (leave empty to keep)"
                : "Google Refresh Token"
            }
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
          />
        </div>

        <label className="inline-flex items-center gap-2 font-medium text-neutral-700 cursor-pointer">
          <input
            type="checkbox"
            checked={backupForm.includeMainWebsiteDb}
            onChange={(e) => backupForm.setIncludeMainWebsiteDb(e.target.checked)}
            className="rounded accent-[#1da851]"
          />
          <span>Include main Classic Concepts website database in nightly backup</span>
        </label>

        <button
          type="submit"
          disabled={backupForm.savingBackup}
          className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium cursor-pointer"
        >
          <Save className="w-4 h-4" />
          <span>{backupForm.savingBackup ? "Saving..." : "Save Backup Settings"}</span>
        </button>
      </form>

      <div className="lg:col-span-5 space-y-6">
        <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-3 text-xs">
          <h2 className="text-sm font-semibold text-neutral-900">Recent Backups</h2>
          {loading ? (
            <CardListSkeleton rows={3} />
          ) : backupLogs.length === 0 ? (
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
                        log.status.includes("FAILED") ? "text-red-700" : "text-emerald-700"
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
                    <span>{formatDateTimeIst(log.completedAt)}</span>
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
  );
}
