import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
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

  let facebookConfig: FacebookWhatsAppSetupConfig = {
    mode: "SANDBOX_SIMULATOR",
    metaAppId: "",
    metaAppSecret: "",
    wabaId: "",
    phoneNumberId: "",
    businessDisplayPhone: "+91 73372 22876",
    systemUserAccessToken: "",
    webhookVerifyToken: "cc_whatsapp_verify_2026",
    stepsCompleted: {
      metaBusinessVerified: false,
      whatsappAppCreated: false,
      phoneRegistered: false,
      webhookSubscribed: false,
      systemTokenSaved: false,
    },
  };

  if (cfgRes.rows[0]?.value_json) {
    try {
      facebookConfig = {
        ...facebookConfig,
        ...JSON.parse(String(cfgRes.rows[0].value_json)),
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

  // Also seed one realistic pending staff member once DEV exists so the approval workflow can be tested right away
  const pendingCheck = await auth.execute({
    sql: `SELECT id FROM users WHERE email = ?`,
    args: ["priya.menon@classiconcepts.in"],
  });
  if (pendingCheck.rows.length === 0) {
    const sampleHash = await bcrypt.hash("Staff@123", 10);
    await auth.execute({
      sql: `INSERT INTO users (
        id, name, email, whatsapp_number, password_hash, role, status,
        department, email_verified_at, onboarding_progress_json, created_at
      ) VALUES (?, ?, ?, ?, ?, 'STAFF', 'PENDING_APPROVAL', 'Corporate & Hotel Sales', ?, ?, ?)`,
      args: [
        "usr_staff_sample",
        "Priya Menon",
        "priya.menon@classiconcepts.in",
        "+919848055110",
        sampleHash,
        now,
        JSON.stringify(["welcome", "inbox", "acrio"]),
        now,
      ],
    });
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
  requestedRole?: "STAFF" | "ADMIN";
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
      error:
        "Staff registration requires an official @classiconcepts.in (or @classicconcepts.in) email address.",
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
      error: "An account with this company email already exists. Please sign in.",
    };
  }

  const userId = `usr_${crypto.randomUUID().slice(0, 8)}`;
  const passwordHash = await bcrypt.hash(params.password, 10);
  const role: UserRole = params.requestedRole === "ADMIN" ? "ADMIN" : "STAFF";

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
  if (!canApproveStaff(params.approver.role, finalRole)) {
    return {
      ok: false,
      error: "Only a DEV account can grant the DEV role.",
    };
  }

  const auth = getRawLibSqlClient("core_auth");
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
  } else {
    const nextStatus = params.decision === "SUSPEND" ? "SUSPENDED" : "REJECTED";
    await auth.execute({
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
    });
  }

  const updated = await getUserById(target.id);
  return { ok: true, updated: updated ?? undefined };
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
