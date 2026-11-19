import { getSetupStatus } from "@cc/auth";

interface CachedFacebookWebhookConfig {
  metaAppSecret: string;
  webhookVerifyToken: string;
  expiresAtMs: number;
}

const CACHE_TTL_MS = 60_000;
let cachedConfig: CachedFacebookWebhookConfig | null = null;
let inflightFetch: Promise<CachedFacebookWebhookConfig> | null = null;

export async function getCachedWebhookSecrets(): Promise<{
  metaAppSecret: string;
  webhookVerifyToken: string;
}> {
  const now = Date.now();
  if (cachedConfig && cachedConfig.expiresAtMs > now) {
    return {
      metaAppSecret: cachedConfig.metaAppSecret,
      webhookVerifyToken: cachedConfig.webhookVerifyToken,
    };
  }

  if (!inflightFetch) {
    inflightFetch = getSetupStatus()
      .then((setup) => {
        const next: CachedFacebookWebhookConfig = {
          metaAppSecret: String(setup.facebookConfig?.metaAppSecret || ""),
          webhookVerifyToken: String(setup.facebookConfig?.webhookVerifyToken || ""),
          expiresAtMs: Date.now() + CACHE_TTL_MS,
        };
        cachedConfig = next;
        return next;
      })
      .finally(() => {
        inflightFetch = null;
      });
  }

  const res = await inflightFetch;
  return {
    metaAppSecret: res.metaAppSecret,
    webhookVerifyToken: res.webhookVerifyToken,
  };
}
