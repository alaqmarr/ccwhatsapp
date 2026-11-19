import fs from "node:fs";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolveClassicConceptsInternalUrl,
  resolveClassicEdgeInternalUrl,
  resolveEcosystemBridgeKey,
  resolveMainWebsiteDbPath,
} from "@cc/database";

export interface SmtpResolvedConfig {
  configured: boolean;
  source:
    | "whatsapp_db"
    | "whatsapp_env"
    | "classicconcepts_db"
    | "bridge_3003"
    | "bridge_3002"
    | "none";
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export async function resolveDirectSmtpCredentials(): Promise<SmtpResolvedConfig> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");

  // 1. Check WhatsApp setup_state ('smtp_config')
  try {
    const cfgRes = await auth.execute(
      `SELECT value_json FROM setup_state WHERE key = 'smtp_config' LIMIT 1`
    );
    if (cfgRes.rows[0]?.value_json) {
      const parsed = JSON.parse(String(cfgRes.rows[0].value_json));
      if (parsed?.host && parsed?.user && parsed?.pass) {
        return {
          configured: true,
          source: "whatsapp_db",
          host: String(parsed.host).trim(),
          port: Number(parsed.port || 587),
          user: String(parsed.user).trim(),
          pass: String(parsed.pass).trim(),
          from:
            String(parsed.from || "").trim() ||
            `"Classic Concepts WhatsApp Desk" <${String(parsed.user).trim()}>`,
        };
      }
    }
  } catch {
    // Non-blocking
  }

  // 2. Check ccwhatsapp environment variables
  const envHost = (process.env.SMTP_HOST || "").trim();
  const envUser = (process.env.SMTP_USER || "").trim();
  const envPass = (process.env.SMTP_PASS || "").trim();
  if (envHost && envUser && envPass) {
    return {
      configured: true,
      source: "whatsapp_env",
      host: envHost,
      port: Number(process.env.SMTP_PORT || 587),
      user: envUser,
      pass: envPass,
      from:
        (process.env.SMTP_FROM || "").trim() ||
        `"Classic Concepts WhatsApp Desk" <${envUser}>`,
    };
  }

  // 3. Check sibling classicconcepts/dev.db SiteSetting SMTP credentials
  try {
    const mainDbPath = resolveMainWebsiteDbPath();
    if (mainDbPath && fs.existsSync(/*turbopackIgnore: true*/ mainDbPath)) {
      const { createClient } = await import("@libsql/client");
      const normalized = mainDbPath.replace(/\\/g, "/");
      const url = normalized.startsWith("/")
        ? `file:${normalized}`
        : `file:///${normalized}`;
      const ccClient = createClient({ url });
      const sRes = await ccClient.execute(
        `SELECT smtpHost, smtpPort, smtpUser, smtpPass, email FROM SiteSetting LIMIT 1`
      );
      const r = sRes.rows[0];
      if (r?.smtpUser && r?.smtpPass) {
        const resolvedHost = String(r.smtpHost || "smtp.gmail.com").trim() || "smtp.gmail.com";
        const rawPass = String(r.smtpPass).trim();
        const cleanPass = resolvedHost.toLowerCase().includes("gmail")
          ? rawPass.replace(/\s+/g, "")
          : rawPass;
        return {
          configured: true,
          source: "classicconcepts_db",
          host: resolvedHost,
          port: Number(r.smtpPort || 587),
          user: String(r.smtpUser).trim(),
          pass: cleanPass,
          from: `"Classic Concepts" <${String(r.smtpUser).trim()}>`,
        };
      }
    }
  } catch {
    // Non-blocking
  }

  return {
    configured: false,
    source: "none",
    host: "",
    port: 587,
    user: "",
    pass: "",
    from: "",
  };
}

export async function getSmtpConfigSummary(): Promise<{
  configured: boolean;
  source: string;
  host: string;
  port: number;
  userMasked: string;
  from: string;
}> {
  const direct = await resolveDirectSmtpCredentials();
  if (direct.configured) {
    const u = direct.user;
    const masked =
      u.length > 5 ? `${u.slice(0, 3)}***${u.slice(u.indexOf("@"))}` : u;
    return {
      configured: true,
      source: direct.source,
      host: direct.host,
      port: direct.port,
      userMasked: masked,
      from: direct.from,
    };
  }

  // Probe :3003 / :3002 bridges to see if relay SMTP is active
  const key = resolveEcosystemBridgeKey();
  for (const candidate of [
    { url: resolveClassicConceptsInternalUrl(), label: "bridge_3003" },
    { url: resolveClassicEdgeInternalUrl(), label: "bridge_3002" },
  ]) {
    try {
      const res = await fetch(`${candidate.url}/api/internal/bridge?action=health`, {
        headers: { "x-cc-bridge-key": key },
        signal: AbortSignal.timeout(1800),
      });
      if (res.ok) {
        const json: any = await res.json().catch(() => ({}));
        if (json?.smtpConfigured) {
          return {
            configured: true,
            source: candidate.label,
            host: `${candidate.url} (Shared Ecosystem SMTP Relay)`,
            port: 587,
            userMasked: "Connected via Website SMTP",
            from: "Classic Concepts Ecosystem Mailer",
          };
        }
      }
    } catch {
      // Ignore offline bridge
    }
  }

  return {
    configured: false,
    source: "none",
    host: "",
    port: 587,
    userMasked: "",
    from: "",
  };
}

export async function saveSmtpConfig(params: {
  host: string;
  port: number;
  user: string;
  pass?: string;
  from?: string;
}): Promise<void> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const prevRes = await auth.execute(
    `SELECT value_json FROM setup_state WHERE key = 'smtp_config' LIMIT 1`
  );
  let prevPass = "";
  if (prevRes.rows[0]?.value_json) {
    try {
      prevPass = String(
        JSON.parse(String(prevRes.rows[0].value_json))?.pass || ""
      );
    } catch {
      prevPass = "";
    }
  }
  const finalPass = params.pass?.trim() ? params.pass.trim() : prevPass;
  const nowIso = new Date().toISOString();
  await auth.execute({
    sql: `INSERT INTO setup_state (key, value_json, updated_at)
          VALUES ('smtp_config', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    args: [
      JSON.stringify({
        host: params.host.trim(),
        port: Number(params.port || 587),
        user: params.user.trim(),
        pass: finalPass,
        from: (params.from || "").trim(),
      }),
      nowIso,
    ],
  });
}
