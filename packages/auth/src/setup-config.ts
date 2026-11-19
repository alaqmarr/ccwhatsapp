import crypto from "node:crypto";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolveEnvMetaWhatsAppConfig,
} from "@cc/database";
import { normalizeWhatsAppNumber } from "@cc/rbac";
import { invalidateSetupStatusCache, rememberCoreAuthCache } from "./cache";
import { hashPassword } from "./passwords";
import { createSessionForUser } from "./sessions";
import {
  type AuthenticatedUser,
  type FacebookWhatsAppSetupConfig,
} from "./types";
import { getUserById } from "./users-management";

export { invalidateSetupStatusCache };

export async function getSetupStatus(): Promise<{
  hasDevAccount: boolean;
  devCount: number;
  facebookConfig: FacebookWhatsAppSetupConfig;
  allFacebookStepsDone: boolean;
}> {
  return rememberCoreAuthCache("__ccAuthSetupStatusCache", async () => {
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
        metaBusinessVerified: Boolean(
          envMeta.businessPortfolioId || envMeta.wabaId
        ),
        whatsappAppCreated: envMeta.hasLiveCredentials,
        phoneRegistered: Boolean(envMeta.phoneNumberId),
        webhookSubscribed: envMeta.hasLiveCredentials,
        systemTokenSaved: Boolean(envMeta.systemUserAccessToken),
      },
    };

    if (cfgRes.rows[0]?.value_json) {
      try {
        const dbCfg = JSON.parse(String(cfgRes.rows[0].value_json));
        const isValidId = (v: unknown) =>
          /^\d{8,25}$/.test(String(v || "").trim());
        const isValidTok = (v: unknown) => {
          const s = String(v || "").trim();
          return (
            s.length >= 40 && !/(stress|dummy|mock|_test|placeholder)/i.test(s)
          );
        };
        const pick = (
          dbV: unknown,
          envV: string,
          check?: (v: unknown) => boolean
        ) => {
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
            envMeta.hasLiveCredentials &&
            (!dbHasValidLivePair || dbCfg.mode === "LIVE_META_CLOUD")
              ? "LIVE_META_CLOUD"
              : dbCfg.mode || facebookConfig.mode,
          businessPortfolioId: pick(
            dbCfg.businessPortfolioId,
            envMeta.businessPortfolioId,
            isValidId
          ),
          verifiedName: dbCfg.verifiedName || envMeta.verifiedName,
          metaAppId: pick(dbCfg.metaAppId, envMeta.metaAppId, isValidId),
          metaAppSecret: dbCfg.metaAppSecret || envMeta.metaAppSecret,
          wabaId: pick(dbCfg.wabaId, envMeta.wabaId, isValidId),
          phoneNumberId: pick(
            dbCfg.phoneNumberId,
            envMeta.phoneNumberId,
            isValidId
          ),
          businessDisplayPhone:
            !dbCfg.businessDisplayPhone ||
            dbCfg.businessDisplayPhone === "+91 73372 22876"
              ? envMeta.businessDisplayPhone || "+91 73372 20568"
              : dbCfg.businessDisplayPhone,
          systemUserAccessToken: pick(
            dbCfg.systemUserAccessToken,
            envMeta.systemUserAccessToken,
            isValidTok
          ),
          webhookVerifyToken:
            dbCfg.webhookVerifyToken ||
            envMeta.webhookVerifyToken ||
            "cc_whatsapp_verify_2026",
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
  });
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

  invalidateSetupStatusCache();
  return merged;
}

export async function createInitialDevAccount(params: {
  name: string;
  email: string;
  whatsappNumber: string;
  password: string;
  facebookConfig?: Partial<FacebookWhatsAppSetupConfig>;
}): Promise<{
  ok: boolean;
  sessionToken?: string;
  user?: AuthenticatedUser;
  error?: string;
}> {
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
  const passwordHash = await hashPassword(params.password);

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

  invalidateSetupStatusCache();

  if (params.facebookConfig) {
    await saveFacebookWhatsAppConfig(params.facebookConfig);
  }

  const sessionToken = await createSessionForUser(userId);
  const user = await getUserById(userId);
  return { ok: true, sessionToken, user: user ?? undefined };
}
