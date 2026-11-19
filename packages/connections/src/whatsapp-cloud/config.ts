import crypto from "node:crypto";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolveEnvMetaWhatsAppConfig,
} from "@cc/database";
import type { AcrioInteractive } from "./types";

function isLikelyValidMetaNumericId(val: string): boolean {
  return /^\d{8,25}$/.test(val);
}

function isLikelyValidMetaToken(val: string): boolean {
  return val.length >= 40 && !/(stress|dummy|mock|_test|placeholder)/i.test(val);
}

function pickMetaConfigValue(
  dbVal: unknown,
  envVal: string,
  envHasLive: boolean,
  validator?: (v: string) => boolean
): string {
  const d = String(dbVal || "").trim();
  const e = String(envVal || "").trim();
  if (d && (!envHasLive || !validator || validator(d))) {
    return d;
  }
  return e || d;
}

let metaSetupConfigCache: {
  expiresAt: number;
  value: Record<string, unknown>;
} | null = null;

export function invalidateMetaWhatsAppSetupConfigCache(): void {
  metaSetupConfigCache = null;
}

export async function loadMetaWhatsAppSetupConfig(): Promise<Record<string, unknown>> {
  const bypassCache =
    process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS === "1" ||
    process.env.NODE_ENV === "test";
  if (!bypassCache && metaSetupConfigCache && metaSetupConfigCache.expiresAt > Date.now()) {
    return metaSetupConfigCache.value;
  }

  await ensureDatabasesBootstrapped();
  const envMeta = resolveEnvMetaWhatsAppConfig();
  const auth = getRawLibSqlClient("core_auth");
  const cfgRes = await auth.execute(
    `SELECT value_json FROM setup_state WHERE key = 'facebook_whatsapp_config' LIMIT 1`
  );
  let dbCfg: Record<string, unknown> = {};
  if (cfgRes.rows[0]?.value_json) {
    try {
      dbCfg = JSON.parse(String(cfgRes.rows[0].value_json));
    } catch {
      dbCfg = {};
    }
  }

  const resolvedWabaId = pickMetaConfigValue(
    dbCfg.wabaId,
    envMeta.wabaId,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaNumericId
  );
  const resolvedPhoneNumberId = pickMetaConfigValue(
    dbCfg.phoneNumberId,
    envMeta.phoneNumberId,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaNumericId
  );
  const resolvedToken = pickMetaConfigValue(
    dbCfg.systemUserAccessToken,
    envMeta.systemUserAccessToken,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaToken
  );
  const resolvedAppId = pickMetaConfigValue(
    dbCfg.metaAppId,
    envMeta.metaAppId,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaNumericId
  );
  const resolvedPortfolioId = pickMetaConfigValue(
    dbCfg.businessPortfolioId,
    envMeta.businessPortfolioId,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaNumericId
  );

  const dbHasValidLivePair =
    isLikelyValidMetaNumericId(String(dbCfg.phoneNumberId || "").trim()) &&
    isLikelyValidMetaToken(String(dbCfg.systemUserAccessToken || "").trim());

  const resolved = {
    ...dbCfg,
    mode:
      envMeta.hasLiveCredentials && (!dbHasValidLivePair || dbCfg.mode === "LIVE_META_CLOUD")
        ? "LIVE_META_CLOUD"
        : dbCfg.mode || envMeta.mode,
    businessPortfolioId: resolvedPortfolioId,
    verifiedName: dbCfg.verifiedName || envMeta.verifiedName,
    wabaId: resolvedWabaId,
    phoneNumberId: resolvedPhoneNumberId,
    businessDisplayPhone: dbCfg.businessDisplayPhone || envMeta.businessDisplayPhone,
    systemUserAccessToken: resolvedToken,
    webhookVerifyToken: dbCfg.webhookVerifyToken || envMeta.webhookVerifyToken,
    metaAppId: resolvedAppId,
    metaAppSecret: dbCfg.metaAppSecret || envMeta.metaAppSecret,
  };
  if (!bypassCache) {
    metaSetupConfigCache = { expiresAt: Date.now() + 15_000, value: resolved };
  }
  return resolved;
}

export const clip = (s: string, n: number) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, Math.max(1, n - 1)).trimEnd()}…`;
};

/** Text version of interactive options, used when Meta rejects the interactive payload or in the inbox view. */
export function describeInteractiveAsText(interactive: AcrioInteractive): string {
  if (interactive.kind === "buttons") {
    return interactive.buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
  }
  return interactive.rows.map((r, i) => `${i + 1}. ${r.title}${r.description ? ` (${r.description})` : ""}`).join("\n");
}

export function buildMetaInteractivePayload(
  interactive: AcrioInteractive,
  bodyText: string
): Record<string, unknown> {
  const trimmedBody = String(bodyText || "").trim();
  const body = {
    text:
      trimmedBody.length > 1024
        ? `${trimmedBody.slice(0, 1020).trimEnd()}…`
        : trimmedBody || "Please choose an option",
  };
  const footer = interactive.footer ? { footer: { text: clip(interactive.footer, 60) } } : {};
  if (interactive.kind === "buttons") {
    return {
      type: "button",
      body,
      ...footer,
      action: {
        buttons: interactive.buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id.slice(0, 256), title: clip(b.title, 20) },
        })),
      },
    };
  }
  return {
    type: "list",
    body,
    ...footer,
    action: {
      button: clip(interactive.buttonLabel || "View options", 20),
      sections: [
        {
          title: clip(interactive.sectionTitle || "Options", 24),
          rows: interactive.rows.slice(0, 10).map((r) => ({
            id: r.id.slice(0, 200),
            title: clip(r.title, 24),
            ...(r.description ? { description: clip(r.description, 72) } : {}),
          })),
        },
      ],
    },
  };
}

export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!appSecret) return true;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}
