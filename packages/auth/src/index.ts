import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolveEnvMetaWhatsAppConfig,
} from "@cc/database";
import {
  type AccountStatus,
  type UserRole,
  canApproveStaff,
  isAllowedStaffEmail,
  isSuperAdminCapable,
  normalizeWhatsAppNumber,
} from "@cc/rbac";

export const SESSION_COOKIE_NAME = "ccwa_session";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  whatsappNumber: string;
  role: UserRole;
  status: AccountStatus;
  department: string;
  emailVerifiedAt: string | null;
  onboardingCompletedAt: string | null;
  onboardingSteps: string[];
  approvedByName: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface FacebookWhatsAppSetupConfig {
  mode: "SANDBOX_SIMULATOR" | "LIVE_META_CLOUD";
  businessPortfolioId?: string;
  verifiedName?: string;
  metaAppId: string;
  metaAppSecret: string;
  wabaId: string;
  phoneNumberId: string;
  businessDisplayPhone: string;
  systemUserAccessToken: string;
  webhookVerifyToken: string;
  stepsCompleted: {
    metaBusinessVerified: boolean;
    whatsappAppCreated: boolean;
    phoneRegistered: boolean;
    webhookSubscribed: boolean;
    systemTokenSaved: boolean;
  };
}

function mapUserRow(r: Record<string, unknown>): AuthenticatedUser {
  let steps: string[] = [];
  try {
    const parsed = JSON.parse(String(r.onboarding_progress_json || "[]"));
    if (Array.isArray(parsed)) steps = parsed.map(String);
  } catch {
    steps = [];
  }
  return {
    id: String(r.id),
    name: String(r.name),
    email: String(r.email),
    whatsappNumber: String(r.whatsapp_number),
    role: String(r.role) as UserRole,
    status: String(r.status) as AccountStatus,
    department: String(r.department || "Sales & Support"),
    emailVerifiedAt: r.email_verified_at ? String(r.email_verified_at) : null,
    onboardingCompletedAt: r.onboarding_completed_at
      ? String(r.onboarding_completed_at)
      : null,
    onboardingSteps: steps,
    approvedByName: r.approved_by_name ? String(r.approved_by_name) : null,
    approvedAt: r.approved_at ? String(r.approved_at) : null,
    rejectionReason: r.rejection_reason ? String(r.rejection_reason) : null,
    createdAt: String(r.created_at),
  };
}

export async function getSetupStatus(): Promise<{
  hasDevAccount: boolean;
  devCount: number;
  facebookConfig: FacebookWhatsAppSetupConfig;
  allFacebookStepsDone: boolean;
}> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");

  const devRes = await auth.execute(
    `SELECT COUNT(*) as cnt FROM users WHERE role = 'DEV'`
  );
  const devCount = Number(devRes.rows[0]?.cnt ?? 0);

  const cfgRes = await auth.execute({
    sql: `SELECT value_json FROM setup_state WHERE key = 'facebook_whatsapp_config' LIMIT 1`,
    args: [],
  });

  const envMeta = resolveEnvMetaWhatsAppConfig();
  let facebookConfig: FacebookWhatsAppSetupConfig = {
    mode: envMeta.mode,
    businessPortfolioId: envMeta.businessPortfolioId,
    verifiedName: envMeta.verifiedName,
    metaAppId: envMeta.metaAppId,
    metaAppSecret: envMeta.metaAppSecret,
    wabaId: envMeta.wabaId,
    phoneNumberId: envMeta.phoneNumberId,
    businessDisplayPhone: envMeta.businessDisplayPhone || "+91 73372 20568",
    systemUserAccessToken: envMeta.systemUserAccessToken,
    webhookVerifyToken: envMeta.webhookVerifyToken || "cc_whatsapp_verify_2026",
    stepsCompleted: {
      metaBusinessVerified: Boolean(envMeta.businessPortfolioId || envMeta.wabaId),
      whatsappAppCreated: envMeta.hasLiveCredentials,
      phoneRegistered: Boolean(envMeta.phoneNumberId),
      webhookSubscribed: envMeta.hasLiveCredentials,
      systemTokenSaved: Boolean(envMeta.systemUserAccessToken),
    },
  };

  if (cfgRes.rows[0]?.value_json) {
    try {
      const dbCfg = JSON.parse(String(cfgRes.rows[0].value_json));
      const isValidId = (v: unknown) => /^\d{8,25}$/.test(String(v || "").trim());
      const isValidTok = (v: unknown) => {
        const s = String(v || "").trim();
        return s.length >= 40 && !/(stress|dummy|mock|_test|placeholder)/i.test(s);
      };
      const pick = (dbV: unknown, envV: string, check?: (v: unknown) => boolean) => {
        const d = String(dbV || "").trim();
        const e = String(envV || "").trim();
        if (d && (!envMeta.hasLiveCredentials || !check || check(d))) return d;
        return e || d;
      };
      const dbHasValidLivePair =
        isValidId(dbCfg.phoneNumberId) && isValidTok(dbCfg.systemUserAccessToken);

      facebookConfig = {
        ...facebookConfig,
        ...dbCfg,
        mode:
          envMeta.hasLiveCredentials && (!dbHasValidLivePair || dbCfg.mode === "LIVE_META_CLOUD")
            ? "LIVE_META_CLOUD"
            : dbCfg.mode || facebookConfig.mode,
        businessPortfolioId: pick(dbCfg.businessPortfolioId, envMeta.businessPortfolioId, isValidId),
        verifiedName: dbCfg.verifiedName || envMeta.verifiedName,
        metaAppId: pick(dbCfg.metaAppId, envMeta.metaAppId, isValidId),
        metaAppSecret: dbCfg.metaAppSecret || envMeta.metaAppSecret,
        wabaId: pick(dbCfg.wabaId, envMeta.wabaId, isValidId),
        phoneNumberId: pick(dbCfg.phoneNumberId, envMeta.phoneNumberId, isValidId),
        businessDisplayPhone:
          !dbCfg.businessDisplayPhone || dbCfg.businessDisplayPhone === "+91 73372 22876"
            ? envMeta.businessDisplayPhone || "+91 73372 20568"
            : dbCfg.businessDisplayPhone,
        systemUserAccessToken: pick(dbCfg.systemUserAccessToken, envMeta.systemUserAccessToken, isValidTok),
        webhookVerifyToken:
          dbCfg.webhookVerifyToken || envMeta.webhookVerifyToken || "cc_whatsapp_verify_2026",
        stepsCompleted: {
          metaBusinessVerified:
            Boolean(dbCfg.stepsCompleted?.metaBusinessVerified) ||
            Boolean(envMeta.businessPortfolioId || envMeta.wabaId),
          whatsappAppCreated:
            Boolean(dbCfg.stepsCompleted?.whatsappAppCreated) ||
            envMeta.hasLiveCredentials,
          phoneRegistered:
            Boolean(dbCfg.stepsCompleted?.phoneRegistered) ||
            Boolean(envMeta.phoneNumberId),
          webhookSubscribed:
            Boolean(dbCfg.stepsCompleted?.webhookSubscribed) ||
            envMeta.hasLiveCredentials,
          systemTokenSaved:
            Boolean(dbCfg.stepsCompleted?.systemTokenSaved) ||
            Boolean(envMeta.systemUserAccessToken),
        },
      };
    } catch {
      // Keep default
    }
  }

  const allFacebookStepsDone = Object.values(
    facebookConfig.stepsCompleted || {}
  ).every(Boolean);

  return {
    hasDevAccount: devCount > 0,
    devCount,
    facebookConfig,
    allFacebookStepsDone,
  };
}

export async function createInitialDevAccount(params: {
  name: string;
  email: string;
  whatsappNumber: string;
  password: string;
  facebookConfig?: Partial<FacebookWhatsAppSetupConfig>;
}): Promise<{ ok: boolean; sessionToken?: string; user?: AuthenticatedUser; error?: string }> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");

  const status = await getSetupStatus();
  if (status.hasDevAccount) {
    return {
      ok: false,
      error: "Primary DEV account already exists. Sign in as DEV to manage /setup.",
    };
  }

  const cleanEmail = params.email.trim().toLowerCase();
  if (!cleanEmail.includes("@")) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const phoneCheck = normalizeWhatsAppNumber(params.whatsappNumber);
  if (!phoneCheck.valid) {
    return { ok: false, error: phoneCheck.error };
  }

  if (!params.password || params.password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }

  const now = new Date().toISOString();
  const userId = `usr_dev_${crypto.randomUUID().slice(0, 8)}`;
  const passwordHash = await bcrypt.hash(params.password, 10);

  await auth.execute({
    sql: `INSERT INTO users (
      id, name, email, whatsapp_number, password_hash, role, status,
      department, email_verified_at, approved_by_id, approved_by_name, approved_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'DEV', 'ACTIVE', 'Platform Engineering & Superadmin', ?, ?, 'System /setup', ?, ?)`,
    args: [
      userId,
      params.name.trim() || "Lead Developer",
      cleanEmail,
      phoneCheck.e164,
      passwordHash,
      now,
      userId,
      now,
      now,
    ],
  });

  if (params.facebookConfig) {
    await saveFacebookWhatsAppConfig(params.facebookConfig);
  }

  const sessionToken = await createSessionForUser(userId);
  const user = await getUserById(userId);
  return { ok: true, sessionToken, user: user ?? undefined };
}

export async function saveFacebookWhatsAppConfig(
  patch: Partial<FacebookWhatsAppSetupConfig>
): Promise<FacebookWhatsAppSetupConfig> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const current = (await getSetupStatus()).facebookConfig;

  const merged: FacebookWhatsAppSetupConfig = {
    ...current,
    ...patch,
    stepsCompleted: {
      ...current.stepsCompleted,
      ...(patch.stepsCompleted || {}),
    },
  };

  if (
    merged.metaAppId &&
    merged.phoneNumberId &&
    merged.systemUserAccessToken &&
    !patch.mode
  ) {
    merged.mode = "LIVE_META_CLOUD";
  }

  await auth.execute({
    sql: `INSERT INTO setup_state (key, value_json, updated_at)
          VALUES ('facebook_whatsapp_config', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    args: [JSON.stringify(merged), new Date().toISOString()],
  });

  return merged;
}

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
  const passwordHash = await bcrypt.hash(params.password, 10);
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
}): Promise<{ ok: boolean; sessionToken?: string; user?: AuthenticatedUser; error?: string }> {
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

  const sessionToken = await createSessionForUser(userId);
  const user = await getUserById(userId);
  return { ok: true, sessionToken, user: user ?? undefined };
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
  const valid = await bcrypt.compare(params.password, String(row.password_hash));
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

export async function createSessionForUser(userId: string): Promise<string> {
  const auth = getRawLibSqlClient("core_auth");
  const token = `ccsess_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomBytes(12).toString("hex")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  await auth.batch(
    [
      {
        sql: `INSERT INTO sessions (id, token, user_id, expires_at, created_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [`ses_${crypto.randomUUID().slice(0, 8)}`, token, userId, expiresAt, now.toISOString()],
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

export async function getUserById(userId: string): Promise<AuthenticatedUser | null> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const res = await auth.execute({
    sql: `SELECT * FROM users WHERE id = ? LIMIT 1`,
    args: [userId],
  });
  return res.rows[0] ? mapUserRow(res.rows[0] as Record<string, unknown>) : null;
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
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const res = await auth.execute(
    `SELECT COUNT(*) AS cnt FROM users WHERE status = 'PENDING_APPROVAL'`
  );
  return Number(res.rows[0]?.cnt ?? 0);
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
  const passwordHash = await bcrypt.hash(params.password, 10);
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
      error: "Only a DEV account can create, approve, or modify another DEV account.",
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
      { sql: `DELETE FROM email_verifications WHERE user_id = ?`, args: [target.id] },
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

// ============================================================================
// PROFILE EDITS AND EMAIL CHANGE (needs a code from BOTH the old and the new email)
// ============================================================================

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

const hashOtp = (code: string, salt: string) =>
  crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");

const safeEqualHex = (a: string, b: string) => {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

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
    .execute({ sql: `UPDATE team_members SET staff_name = ? WHERE staff_id = ?`, args: [name, params.userId] })
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
    return { ok: false, error: "Too many email change attempts. Please try again in an hour." };
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
    return { ok: false, error: "This email change request is no longer active. Please start again." };
  }
  if (String(row.expires_at) < new Date().toISOString()) {
    await auth.execute({ sql: `UPDATE email_change_requests SET status = 'EXPIRED' WHERE id = ?`, args: [params.requestId] });
    return { ok: false, error: "The codes expired. Please start again." };
  }
  if (Number(row.attempts || 0) >= 5) {
    await auth.execute({ sql: `UPDATE email_change_requests SET status = 'LOCKED' WHERE id = ?`, args: [params.requestId] });
    return { ok: false, error: "Too many wrong codes. Please start again." };
  }

  const salt = String(row.salt);
  const oldOk = safeEqualHex(hashOtp(params.oldOtp.trim(), salt), String(row.old_otp_hash));
  const newOk = safeEqualHex(hashOtp(params.newOtp.trim(), salt), String(row.new_otp_hash));
  if (!oldOk || !newOk) {
    await auth.execute({
      sql: `UPDATE email_change_requests SET attempts = attempts + 1 WHERE id = ?`,
      args: [params.requestId],
    });
    const left = Math.max(0, 4 - Number(row.attempts || 0));
    return {
      ok: false,
      error: `${!oldOk && !newOk ? "Both codes are" : !oldOk ? "The code from your current email is" : "The code from your new email is"} wrong. ${left} attempt${left === 1 ? "" : "s"} left.`,
    };
  }

  const newEmail = String(row.new_email);
  const oldEmail = String(row.old_email);
  const taken = await auth.execute({
    sql: `SELECT id FROM users WHERE LOWER(email) = ? AND id != ? LIMIT 1`,
    args: [newEmail, params.userId],
  });
  if (taken.rows.length > 0) {
    return { ok: false, error: "Another account just started using that email. Please pick a different one." };
  }

  const nowIso = new Date().toISOString();
  await auth.batch(
    [
      { sql: `UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?`, args: [newEmail, nowIso, params.userId] },
      {
        sql: `UPDATE email_change_requests SET status = 'COMPLETED', completed_at = ? WHERE id = ?`,
        args: [nowIso, params.requestId],
      },
      // Sign out every other device after a login email change.
      params.keepSessionToken
        ? { sql: `DELETE FROM sessions WHERE user_id = ? AND token != ?`, args: [params.userId, params.keepSessionToken] }
        : { sql: `DELETE FROM sessions WHERE user_id = ?`, args: [params.userId] },
    ],
    "write"
  );
  await conv
    .execute({ sql: `UPDATE team_members SET staff_email = ? WHERE staff_id = ?`, args: [newEmail, params.userId] })
    .catch(() => {});

  const user = await getUserById(params.userId);
  return { ok: true, oldEmail, newEmail, staffName: user?.name, user: user ?? undefined };
}
