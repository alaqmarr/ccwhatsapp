import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { createSessionForUser } from "./sessions";
import { type AuthenticatedUser, mapUserRow } from "./types";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function hashOtp(code: string, salt: string): string {
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export async function loginWithPassword(params: {
  email: string;
  password: string;
}): Promise<{
  ok: boolean;
  sessionToken?: string;
  user?: AuthenticatedUser;
  needsEmailVerify?: boolean;
  error?: string;
}> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");

  const cleanEmail = params.email.trim().toLowerCase();
  const res = await auth.execute({
    sql: `SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1`,
    args: [cleanEmail],
  });

  if (res.rows.length === 0) {
    return { ok: false, error: "Invalid email or password." };
  }

  const row = res.rows[0] as Record<string, unknown>;
  const valid = await verifyPassword(params.password, String(row.password_hash));
  if (!valid) {
    return { ok: false, error: "Invalid email or password." };
  }

  const user = mapUserRow(row);
  if (user.status === "UNVERIFIED_EMAIL") {
    return {
      ok: false,
      needsEmailVerify: true,
      error: "Please verify your company email OTP before signing in.",
    };
  }

  if (user.status === "REJECTED" || user.status === "SUSPENDED") {
    return {
      ok: false,
      error: `This account is ${user.status.toLowerCase()}${
        user.rejectionReason ? `: ${user.rejectionReason}` : "."
      }`,
    };
  }

  const sessionToken = await createSessionForUser(user.id);
  return { ok: true, sessionToken, user };
}
