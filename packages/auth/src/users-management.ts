import crypto from "node:crypto";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import {
  type UserRole,
  canApproveStaff,
  isAllowedStaffEmail,
  isSuperAdminCapable,
  normalizeWhatsAppNumber,
} from "@cc/rbac";
import {
  invalidatePendingApprovalsCache,
  invalidateSetupStatusCache,
  rememberCoreAuthCache,
} from "./cache";
import { hashPassword } from "./passwords";
import { type AuthenticatedUser, mapUserRow } from "./types";

export { invalidatePendingApprovalsCache };

export async function getUserById(
  userId: string
): Promise<AuthenticatedUser | null> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const res = await auth.execute({
    sql: `SELECT * FROM users WHERE id = ? LIMIT 1`,
    args: [userId],
  });
  return res.rows[0] ? mapUserRow(res.rows[0] as Record<string, unknown>) : null;
}

export async function listAllStaffAccounts(): Promise<AuthenticatedUser[]> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const res = await auth.execute(
    `SELECT * FROM users ORDER BY
      CASE status WHEN 'PENDING_APPROVAL' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END,
      created_at DESC`
  );
  return res.rows.map((r) => mapUserRow(r as Record<string, unknown>));
}

export async function countPendingStaffApprovals(): Promise<number> {
  return rememberCoreAuthCache("__ccAuthPendingApprovalsCache", async () => {
    await ensureDatabasesBootstrapped();
    const auth = getRawLibSqlClient("core_auth");
    const res = await auth.execute(
      `SELECT COUNT(*) AS cnt FROM users WHERE status = 'PENDING_APPROVAL'`
    );
    return Number(res.rows[0]?.cnt ?? 0);
  });
}

export async function createDevAccountByDev(params: {
  creator: AuthenticatedUser;
  name: string;
  email: string;
  whatsappNumber: string;
  password: string;
}): Promise<{ ok: boolean; user?: AuthenticatedUser; error?: string }> {
  if (params.creator.role !== "DEV" || params.creator.status !== "ACTIVE") {
    return {
      ok: false,
      error: "Only an active DEV account can create another DEV account.",
    };
  }

  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");

  const cleanName = params.name.trim();
  const cleanEmail = params.email.trim().toLowerCase();
  if (!cleanName) {
    return { ok: false, error: "Full name is required." };
  }
  if (!isAllowedStaffEmail(cleanEmail)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  const phoneCheck = normalizeWhatsAppNumber(params.whatsappNumber);
  if (!phoneCheck.valid) {
    return { ok: false, error: phoneCheck.error };
  }
  if (!params.password || params.password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }

  const existing = await auth.execute({
    sql: `SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1`,
    args: [cleanEmail],
  });
  if (existing.rows.length > 0) {
    return {
      ok: false,
      error: "An account with this email already exists.",
    };
  }

  const userId = `usr_dev_${crypto.randomUUID().slice(0, 8)}`;
  const passwordHash = await hashPassword(params.password);
  const nowIso = new Date().toISOString();

  await auth.execute({
    sql: `INSERT INTO users (
      id, name, email, whatsapp_number, password_hash, role, status,
      department, email_verified_at, approved_by_id, approved_by_name, approved_at,
      onboarding_completed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'DEV', 'ACTIVE', 'Platform Engineering & Dev', ?, ?, ?, ?, ?, ?)`,
    args: [
      userId,
      cleanName,
      cleanEmail,
      phoneCheck.e164,
      passwordHash,
      nowIso,
      params.creator.id,
      `${params.creator.name} (DEV)`,
      nowIso,
      nowIso,
      nowIso,
    ],
  });

  invalidatePendingApprovalsCache();
  invalidateSetupStatusCache();
  const created = await getUserById(userId);
  return { ok: true, user: created ?? undefined };
}

export async function reviewStaffAccount(params: {
  approver: AuthenticatedUser;
  targetUserId: string;
  decision: "APPROVE" | "REJECT" | "SUSPEND";
  assignedRole?: UserRole;
  reason?: string;
}): Promise<{ ok: boolean; updated?: AuthenticatedUser; error?: string }> {
  if (!isSuperAdminCapable(params.approver.role)) {
    return {
      ok: false,
      error: "Only SUPERADMIN or DEV accounts can approve or manage staff.",
    };
  }

  const target = await getUserById(params.targetUserId);
  if (!target) {
    return { ok: false, error: "Staff account not found." };
  }

  const finalRole = params.assignedRole || target.role;
  if (
    (target.role === "DEV" || finalRole === "DEV") &&
    params.approver.role !== "DEV"
  ) {
    return {
      ok: false,
      error:
        "Only a DEV account can create, approve, or modify another DEV account.",
    };
  }
  if (!canApproveStaff(params.approver.role, finalRole)) {
    return {
      ok: false,
      error: "Only a DEV account can grant the DEV role.",
    };
  }

  const auth = getRawLibSqlClient("core_auth");
  const conv = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();

  if (params.decision === "APPROVE") {
    await auth.execute({
      sql: `UPDATE users
            SET status = 'ACTIVE',
                role = ?,
                approved_by_id = ?,
                approved_by_name = ?,
                approved_at = ?,
                rejection_reason = NULL
            WHERE id = ?`,
      args: [
        finalRole,
        params.approver.id,
        `${params.approver.name} (${params.approver.role})`,
        nowIso,
        target.id,
      ],
    });

    // Auto-enroll approved non-DEV staff into their department's routing team (defaulting to Sales Team)
    if (finalRole !== "DEV") {
      const dept = (target.department || "").toLowerCase();
      const targetTeamId = /fab|custom|workshop|machine/.test(dept)
        ? "team_fabrication"
        : /dispatch|billing|account|order/.test(dept)
        ? "team_dispatch"
        : "team_sales";
      const tier =
        finalRole === "SUPERADMIN"
          ? "P2"
          : finalRole === "MANAGER"
          ? "P1"
          : "P0";
      await conv
        .execute({
          sql: `INSERT INTO team_members (
                  id, team_id, staff_id, staff_name, staff_role, tier, is_available, max_active_chats, email_alerts_enabled, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, 1, 15, 1, ?)
                ON CONFLICT(team_id, staff_id) DO UPDATE SET
                  staff_name = excluded.staff_name,
                  staff_role = excluded.staff_role,
                  is_available = 1`,
          args: [
            `tm_${target.id.replace(/[^a-zA-Z0-9]/g, "").slice(-10)}`,
            targetTeamId,
            target.id,
            target.name,
            finalRole,
            tier,
            nowIso,
          ],
        })
        .catch(() => {});
    }
  } else {
    const nextStatus = params.decision === "SUSPEND" ? "SUSPENDED" : "REJECTED";
    await auth.batch(
      [
        {
          sql: `UPDATE users
                SET status = ?,
                    approved_by_id = ?,
                    approved_by_name = ?,
                    approved_at = ?,
                    rejection_reason = ?
                WHERE id = ?`,
          args: [
            nextStatus,
            params.approver.id,
            `${params.approver.name} (${params.approver.role})`,
            nowIso,
            params.reason?.trim() || "Account not approved by Superadmin.",
            target.id,
          ],
        },
        {
          sql: `DELETE FROM sessions WHERE user_id = ?`,
          args: [target.id],
        },
      ],
      "write"
    );

    await conv
      .execute({
        sql: `UPDATE team_members SET is_available = 0 WHERE staff_id = ?`,
        args: [target.id],
      })
      .catch(() => {});
  }

  invalidatePendingApprovalsCache();
  invalidateSetupStatusCache();
  const updated = await getUserById(target.id);
  return { ok: true, updated: updated ?? undefined };
}

export async function setStaffAssignmentsEnabled(params: {
  actor: AuthenticatedUser;
  targetUserId: string;
  enabled: boolean;
}): Promise<{ ok: boolean; updated?: AuthenticatedUser; error?: string }> {
  if (!isSuperAdminCapable(params.actor.role)) {
    return {
      ok: false,
      error: "Only SUPERADMIN or DEV accounts can change assignment settings.",
    };
  }

  const target = await getUserById(params.targetUserId);
  if (!target) {
    return { ok: false, error: "Staff account not found." };
  }

  if (target.role === "DEV" && params.actor.role !== "DEV") {
    return {
      ok: false,
      error: "Only a DEV account can modify assignment settings for another DEV account.",
    };
  }

  const auth = getRawLibSqlClient("core_auth");
  const conv = getRawLibSqlClient("conversations");
  const flag = params.enabled ? 1 : 0;

  await auth.execute({
    sql: `UPDATE users SET assignments_enabled = ? WHERE id = ?`,
    args: [flag, target.id],
  });

  await conv
    .execute({
      sql: `UPDATE team_members SET is_available = ? WHERE staff_id = ?`,
      args: [flag, target.id],
    })
    .catch(() => {});

  invalidatePendingApprovalsCache();
  invalidateSetupStatusCache();
  const updated = await getUserById(target.id);
  return { ok: true, updated: updated ?? undefined };
}

export async function deleteStaffAccount(params: {
  actor: AuthenticatedUser;
  targetUserId: string;
}): Promise<{ ok: boolean; deletedName?: string; error?: string }> {
  if (!isSuperAdminCapable(params.actor.role)) {
    return {
      ok: false,
      error: "Only SUPERADMIN or DEV accounts can delete team accounts.",
    };
  }
  if (params.actor.id === params.targetUserId) {
    return {
      ok: false,
      error: "You cannot delete your own active account.",
    };
  }

  const target = await getUserById(params.targetUserId);
  if (!target) {
    return { ok: false, error: "Staff account not found." };
  }

  if (target.role === "DEV" && params.actor.role !== "DEV") {
    return {
      ok: false,
      error: "Only a DEV account can delete another DEV account.",
    };
  }

  const auth = getRawLibSqlClient("core_auth");
  const conv = getRawLibSqlClient("conversations");

  await auth.batch(
    [
      { sql: `DELETE FROM sessions WHERE user_id = ?`, args: [target.id] },
      {
        sql: `DELETE FROM email_verifications WHERE user_id = ?`,
        args: [target.id],
      },
      { sql: `DELETE FROM users WHERE id = ?`, args: [target.id] },
    ],
    "write"
  );

  await Promise.all([
    conv
      .execute({
        sql: `DELETE FROM team_members WHERE staff_id = ?`,
        args: [target.id],
      })
      .catch(() => {}),
    conv
      .execute({
        sql: `UPDATE conversations
              SET assigned_staff_id = 'ACRIO',
                  assigned_staff_name = 'ACRIO',
                  assigned_team_id = NULL,
                  assigned_team_name = 'System (ACRIO)'
              WHERE assigned_staff_id = ? AND status != 'RESOLVED'`,
        args: [target.id],
      })
      .catch(() => {}),
  ]);

  invalidatePendingApprovalsCache();
  invalidateSetupStatusCache();
  return { ok: true, deletedName: target.name };
}

export async function recordOnboardingStep(params: {
  userId: string;
  stepId: string;
  markAllComplete?: boolean;
}): Promise<AuthenticatedUser | null> {
  const user = await getUserById(params.userId);
  if (!user) return null;

  const set = new Set(user.onboardingSteps);
  if (params.stepId) set.add(params.stepId);
  const nextSteps = Array.from(set);
  const completedAt =
    params.markAllComplete || nextSteps.length >= 6
      ? user.onboardingCompletedAt || new Date().toISOString()
      : user.onboardingCompletedAt;

  const auth = getRawLibSqlClient("core_auth");
  await auth.execute({
    sql: `UPDATE users SET onboarding_progress_json = ?, onboarding_completed_at = ? WHERE id = ?`,
    args: [JSON.stringify(nextSteps), completedAt, user.id],
  });

  return getUserById(user.id);
}
