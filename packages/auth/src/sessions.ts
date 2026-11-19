import crypto from "node:crypto";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { type AuthenticatedUser, mapUserRow } from "./types";

export async function createSessionForUser(userId: string): Promise<string> {
  const auth = getRawLibSqlClient("core_auth");
  const token = `ccsess_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomBytes(12).toString("hex")}`;
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + 14 * 24 * 60 * 60 * 1000
  ).toISOString();

  await auth.batch(
    [
      {
        sql: `INSERT INTO sessions (id, token, user_id, expires_at, created_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [
          `ses_${crypto.randomUUID().slice(0, 8)}`,
          token,
          userId,
          expiresAt,
          now.toISOString(),
        ],
      },
      {
        sql: `UPDATE users SET last_active_at = ? WHERE id = ?`,
        args: [now.toISOString(), userId],
      },
    ],
    "write"
  );

  return token;
}

export async function deleteSessionToken(token: string): Promise<void> {
  if (!token) return;
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  await auth.execute({
    sql: `DELETE FROM sessions WHERE token = ?`,
    args: [token],
  });
}

export async function getSessionUserByToken(
  token: string | undefined | null
): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const nowIso = new Date().toISOString();

  const res = await auth.execute({
    sql: `SELECT u.*
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token = ? AND s.expires_at > ?
          LIMIT 1`,
    args: [token, nowIso],
  });

  if (!res.rows[0]) return null;
  const user = mapUserRow(res.rows[0] as Record<string, unknown>);

  // Security guard: immediately invalidate sessions if user was rejected, suspended, or unverified
  if (
    user.status === "REJECTED" ||
    user.status === "SUSPENDED" ||
    user.status === "UNVERIFIED_EMAIL"
  ) {
    await auth
      .execute({
        sql: `DELETE FROM sessions WHERE user_id = ?`,
        args: [user.id],
      })
      .catch(() => {});
    return null;
  }

  return user;
}

export async function pruneExpiredSessions(): Promise<number> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const nowIso = new Date().toISOString();
  const res = await auth.execute({
    sql: `DELETE FROM sessions WHERE expires_at <= ?`,
    args: [nowIso],
  });
  return Number(res.rowsAffected ?? 0);
}
