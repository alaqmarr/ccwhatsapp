import crypto from "node:crypto";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { isAllowedStaffEmail, normalizeWhatsAppNumber } from "@cc/rbac";
import { hashOtp, safeEqualHex } from "./passwords";
import type { AuthenticatedUser } from "./types";
import { getUserById } from "./users-management";

let emailChangeTableReady = false;

async function ensureEmailChangeTable(): Promise<void> {
  if (emailChangeTableReady) return;
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  await auth.execute(`CREATE TABLE IF NOT EXISTS email_change_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    old_email TEXT NOT NULL,
    new_email TEXT NOT NULL,
    old_otp_hash TEXT NOT NULL,
    new_otp_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`);
  await auth.execute(
    `CREATE INDEX IF NOT EXISTS idx_email_change_user ON email_change_requests (user_id, created_at)`
  );
  emailChangeTableReady = true;
}

export async function updateStaffProfile(params: {
  userId: string;
  name: string;
  whatsappNumber: string;
  department: string;
}): Promise<{ ok: boolean; user?: AuthenticatedUser; error?: string }> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const conv = getRawLibSqlClient("conversations");

  const name = params.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) {
    return { ok: false, error: "Name must be 2 to 60 characters." };
  }
  const phoneCheck = normalizeWhatsAppNumber(params.whatsappNumber);
  if (!phoneCheck.valid) return { ok: false, error: phoneCheck.error };
  const department = params.department.trim().slice(0, 60) || "Sales & Support";

  await auth.execute({
    sql: `UPDATE users SET name = ?, whatsapp_number = ?, department = ? WHERE id = ?`,
    args: [name, phoneCheck.e164, department, params.userId],
  });
  // Keep the copies of the name used in teams and chat ownership in step.
  await conv
    .execute({
      sql: `UPDATE team_members SET staff_name = ? WHERE staff_id = ?`,
      args: [name, params.userId],
    })
    .catch(() => {});
  await conv
    .execute({
      sql: `UPDATE conversations SET assigned_staff_name = ? WHERE assigned_staff_id = ?`,
      args: [name, params.userId],
    })
    .catch(() => {});

  const user = await getUserById(params.userId);
  return { ok: true, user: user ?? undefined };
}

export async function requestEmailChange(params: {
  userId: string;
  newEmail: string;
}): Promise<{
  ok: boolean;
  requestId?: string;
  staffName?: string;
  oldEmail?: string;
  newEmail?: string;
  oldOtp?: string;
  newOtp?: string;
  expiresAt?: string;
  error?: string;
}> {
  await ensureEmailChangeTable();
  const auth = getRawLibSqlClient("core_auth");

  const user = await getUserById(params.userId);
  if (!user || user.status !== "ACTIVE") {
    return { ok: false, error: "Only active accounts can change their email." };
  }
  const newEmail = params.newEmail.trim().toLowerCase();
  if (!isAllowedStaffEmail(newEmail)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (newEmail === user.email.toLowerCase()) {
    return { ok: false, error: "That is already your login email." };
  }
  const taken = await auth.execute({
    sql: `SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1`,
    args: [newEmail],
  });
  if (taken.rows.length > 0) {
    return { ok: false, error: "Another account already uses that email." };
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await auth.execute({
    sql: `SELECT COUNT(*) AS c FROM email_change_requests WHERE user_id = ? AND created_at >= ?`,
    args: [user.id, hourAgo],
  });
  if (Number(recent.rows[0]?.c || 0) >= 5) {
    return {
      ok: false,
      error: "Too many email change attempts. Please try again in an hour.",
    };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  const oldOtp = String(crypto.randomInt(100000, 1000000));
  const newOtp = String(crypto.randomInt(100000, 1000000));
  const salt = crypto.randomBytes(12).toString("hex");
  const requestId = `ecr_${crypto.randomUUID().slice(0, 10)}`;

  await auth.batch(
    [
      {
        sql: `UPDATE email_change_requests SET status = 'CANCELLED' WHERE user_id = ? AND status = 'PENDING'`,
        args: [user.id],
      },
      {
        sql: `INSERT INTO email_change_requests (
          id, user_id, old_email, new_email, old_otp_hash, new_otp_hash, salt, attempts, status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'PENDING', ?, ?)`,
        args: [
          requestId,
          user.id,
          user.email.toLowerCase(),
          newEmail,
          hashOtp(oldOtp, salt),
          hashOtp(newOtp, salt),
          salt,
          expiresAt,
          now.toISOString(),
        ],
      },
    ],
    "write"
  );

  return {
    ok: true,
    requestId,
    staffName: user.name,
    oldEmail: user.email,
    newEmail,
    oldOtp,
    newOtp,
    expiresAt,
  };
}

export async function verifyEmailChange(params: {
  userId: string;
  requestId: string;
  oldOtp: string;
  newOtp: string;
  keepSessionToken?: string;
}): Promise<{
  ok: boolean;
  oldEmail?: string;
  newEmail?: string;
  staffName?: string;
  user?: AuthenticatedUser;
  error?: string;
}> {
  await ensureEmailChangeTable();
  const auth = getRawLibSqlClient("core_auth");
  const conv = getRawLibSqlClient("conversations");

  const res = await auth.execute({
    sql: `SELECT * FROM email_change_requests WHERE id = ? AND user_id = ? LIMIT 1`,
    args: [params.requestId, params.userId],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row || String(row.status) !== "PENDING") {
    return {
      ok: false,
      error: "This email change request is no longer active. Please start again.",
    };
  }
  if (String(row.expires_at) < new Date().toISOString()) {
    await auth.execute({
      sql: `UPDATE email_change_requests SET status = 'EXPIRED' WHERE id = ?`,
      args: [params.requestId],
    });
    return { ok: false, error: "The codes expired. Please start again." };
  }
  if (Number(row.attempts || 0) >= 5) {
    await auth.execute({
      sql: `UPDATE email_change_requests SET status = 'LOCKED' WHERE id = ?`,
      args: [params.requestId],
    });
    return { ok: false, error: "Too many wrong codes. Please start again." };
  }

  const salt = String(row.salt);
  const oldOk = safeEqualHex(
    hashOtp(params.oldOtp.trim(), salt),
    String(row.old_otp_hash)
  );
  const newOk = safeEqualHex(
    hashOtp(params.newOtp.trim(), salt),
    String(row.new_otp_hash)
  );
  if (!oldOk || !newOk) {
    await auth.execute({
      sql: `UPDATE email_change_requests SET attempts = attempts + 1 WHERE id = ?`,
      args: [params.requestId],
    });
    const left = Math.max(0, 4 - Number(row.attempts || 0));
    return {
      ok: false,
      error: `${
        !oldOk && !newOk
          ? "Both codes are"
          : !oldOk
          ? "The code from your current email is"
          : "The code from your new email is"
      } wrong. ${left} attempt${left === 1 ? "" : "s"} left.`,
    };
  }

  const newEmail = String(row.new_email);
  const oldEmail = String(row.old_email);
  const taken = await auth.execute({
    sql: `SELECT id FROM users WHERE LOWER(email) = ? AND id != ? LIMIT 1`,
    args: [newEmail, params.userId],
  });
  if (taken.rows.length > 0) {
    return {
      ok: false,
      error:
        "Another account just started using that email. Please pick a different one.",
    };
  }

  const nowIso = new Date().toISOString();
  await auth.batch(
    [
      {
        sql: `UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?`,
        args: [newEmail, nowIso, params.userId],
      },
      {
        sql: `UPDATE email_change_requests SET status = 'COMPLETED', completed_at = ? WHERE id = ?`,
        args: [nowIso, params.requestId],
      },
      // Sign out every other device after a login email change.
      params.keepSessionToken
        ? {
            sql: `DELETE FROM sessions WHERE user_id = ? AND token != ?`,
            args: [params.userId, params.keepSessionToken],
          }
        : { sql: `DELETE FROM sessions WHERE user_id = ?`, args: [params.userId] },
    ],
    "write"
  );
  await conv
    .execute({
      sql: `UPDATE team_members SET staff_email = ? WHERE staff_id = ?`,
      args: [newEmail, params.userId],
    })
    .catch(() => {});

  const user = await getUserById(params.userId);
  return {
    ok: true,
    oldEmail,
    newEmail,
    staffName: user?.name,
    user: user ?? undefined,
  };
}
