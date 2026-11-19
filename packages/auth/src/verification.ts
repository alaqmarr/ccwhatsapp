import crypto from "node:crypto";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import {
  type UserRole,
  isAllowedStaffEmail,
  normalizeWhatsAppNumber,
} from "@cc/rbac";
import { invalidatePendingApprovalsCache } from "./cache";
import { hashPassword } from "./passwords";
import { createSessionForUser } from "./sessions";
import type { AuthenticatedUser } from "./types";
import { getUserById } from "./users-management";

export async function registerStaffAccount(params: {
  name: string;
  email: string;
  whatsappNumber: string;
  password: string;
  department?: string;
  requestedRole?: "STAFF" | "ADMIN" | "MANAGER";
}): Promise<{
  ok: boolean;
  userId?: string;
  email?: string;
  otpCodeForDelivery?: string;
  error?: string;
}> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");

  const cleanName = params.name.trim();
  const cleanEmail = params.email.trim().toLowerCase();

  if (!cleanName) {
    return { ok: false, error: "Full name is required." };
  }

  if (!isAllowedStaffEmail(cleanEmail)) {
    return {
      ok: false,
      error: "Please enter a valid email address.",
    };
  }

  const phoneCheck = normalizeWhatsAppNumber(params.whatsappNumber);
  if (!phoneCheck.valid) {
    return { ok: false, error: phoneCheck.error };
  }

  if (!params.password || params.password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }

  const existing = await auth.execute({
    sql: `SELECT id, status FROM users WHERE LOWER(email) = ? LIMIT 1`,
    args: [cleanEmail],
  });

  const now = new Date();
  const isoNow = now.toISOString();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const otpCode = String(Math.floor(100000 + Math.random() * 900000));

  if (existing.rows.length > 0) {
    const existingStatus = String(existing.rows[0].status);
    const existingUserId = String(existing.rows[0].id);
    if (existingStatus === "UNVERIFIED_EMAIL") {
      await auth.execute({
        sql: `INSERT INTO email_verifications (id, user_id, email, otp_code, expires_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          `otp_${crypto.randomUUID().slice(0, 8)}`,
          existingUserId,
          cleanEmail,
          otpCode,
          expiresAt,
          isoNow,
        ],
      });
      return {
        ok: true,
        userId: existingUserId,
        email: cleanEmail,
        otpCodeForDelivery: otpCode,
      };
    }
    return {
      ok: false,
      error: "An account with this email already exists. Please sign in.",
    };
  }

  const userId = `usr_${crypto.randomUUID().slice(0, 8)}`;
  const passwordHash = await hashPassword(params.password);
  const role: UserRole =
    params.requestedRole === "MANAGER"
      ? "MANAGER"
      : params.requestedRole === "ADMIN"
      ? "ADMIN"
      : "STAFF";

  await auth.batch(
    [
      {
        sql: `INSERT INTO users (
          id, name, email, whatsapp_number, password_hash, role, status, department, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'UNVERIFIED_EMAIL', ?, ?)`,
        args: [
          userId,
          cleanName,
          cleanEmail,
          phoneCheck.e164,
          passwordHash,
          role,
          params.department?.trim() || "Sales & Support",
          isoNow,
        ],
      },
      {
        sql: `INSERT INTO email_verifications (id, user_id, email, otp_code, expires_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          `otp_${crypto.randomUUID().slice(0, 8)}`,
          userId,
          cleanEmail,
          otpCode,
          expiresAt,
          isoNow,
        ],
      },
    ],
    "write"
  );

  invalidatePendingApprovalsCache();

  return {
    ok: true,
    userId,
    email: cleanEmail,
    otpCodeForDelivery: otpCode,
  };
}

export async function verifyStaffEmailOtp(params: {
  email: string;
  otpCode: string;
}): Promise<{
  ok: boolean;
  sessionToken?: string;
  user?: AuthenticatedUser;
  error?: string;
}> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");

  const cleanEmail = params.email.trim().toLowerCase();
  const cleanOtp = params.otpCode.trim();

  const res = await auth.execute({
    sql: `SELECT id, user_id, otp_code, expires_at, verified_at
          FROM email_verifications
          WHERE LOWER(email) = ?
          ORDER BY created_at DESC
          LIMIT 5`,
    args: [cleanEmail],
  });

  const nowIso = new Date().toISOString();
  const match = res.rows.find(
    (r) =>
      String(r.otp_code) === cleanOtp &&
      !r.verified_at &&
      String(r.expires_at) >= nowIso
  );

  if (!match) {
    return {
      ok: false,
      error: "Invalid or expired 6-digit verification code.",
    };
  }

  const userId = String(match.user_id);

  await auth.batch(
    [
      {
        sql: `UPDATE email_verifications SET verified_at = ? WHERE id = ?`,
        args: [nowIso, String(match.id)],
      },
      {
        sql: `UPDATE users
              SET email_verified_at = ?,
                  status = CASE WHEN status = 'UNVERIFIED_EMAIL' THEN 'PENDING_APPROVAL' ELSE status END
              WHERE id = ?`,
        args: [nowIso, userId],
      },
    ],
    "write"
  );

  invalidatePendingApprovalsCache();

  const sessionToken = await createSessionForUser(userId);
  const user = await getUserById(userId);
  return { ok: true, sessionToken, user: user ?? undefined };
}
