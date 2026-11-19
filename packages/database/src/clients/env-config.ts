import fs from "node:fs";
import path from "node:path";

export type DatabaseDomain =
  | "core_auth"
  | "conversations"
  | "contacts"
  | "crm_orders"
  | "marketing"
  | "billing_ops"
  | "queue_jobs";

export const DATABASE_FILES: Record<DatabaseDomain, string> = {
  core_auth: "core_auth.db",
  conversations: "conversations.db",
  contacts: "contacts.db",
  crm_orders: "crm_orders.db",
  marketing: "marketing.db",
  billing_ops: "billing_ops.db",
  queue_jobs: "queue_jobs.db",
};

export const DATABASE_DESCRIPTIONS: Record<DatabaseDomain, string> = {
  core_auth: "Team accounts, email verification codes, approvals, and Facebook connection settings",
  conversations: "Customer WhatsApp chats, internal notes, team escalations, auto-replies, and short links",
  contacts: "Master WhatsApp contacts directory, groups, tags, opt-in preferences, and CSV import history",
  crm_orders: "Customer contact details, orders, and past enquiry history",
  marketing: "Message templates, ACRIO customer lists, and broadcast campaigns",
  billing_ops: "Message charges, rates, and daily Google Drive backup history",
  queue_jobs: "Scheduled background tasks and broadcast queue",
};

let dotEnvLoadedForRoot: string | null = null;

function parseAndPopulateDotEnvFile(filePath: string): void {
  if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) return;
  try {
    const content = fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!key) continue;
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key] && val !== "") {
        process.env[key] = val;
      }
    }
  } catch {
    // Non-blocking
  }
}

export function resolveMonorepoRoot(): string {
  let root = process.cwd();
  if (process.env.CCWHATSAPP_ROOT) {
    root = path.resolve(/*turbopackIgnore: true*/ process.env.CCWHATSAPP_ROOT);
  } else if (root.endsWith(path.join("apps", "web"))) {
    root = path.resolve(/*turbopackIgnore: true*/ root, "..", "..");
  } else if (fs.existsSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ root, "ccwhatsapp"))) {
    root = path.join(/*turbopackIgnore: true*/ root, "ccwhatsapp");
  }

  if (dotEnvLoadedForRoot !== root) {
    dotEnvLoadedForRoot = root;
    parseAndPopulateDotEnvFile(path.join(/*turbopackIgnore: true*/ root, ".env.local"));
    parseAndPopulateDotEnvFile(path.join(/*turbopackIgnore: true*/ root, ".env"));
    parseAndPopulateDotEnvFile(path.join(/*turbopackIgnore: true*/ root, ".env.production"));
  }

  return root;
}

export interface EnvMetaWhatsAppConfig {
  mode: "SANDBOX_SIMULATOR" | "LIVE_META_CLOUD";
  businessPortfolioId: string;
  wabaId: string;
  phoneNumberId: string;
  businessDisplayPhone: string;
  verifiedName: string;
  systemUserAccessToken: string;
  webhookVerifyToken: string;
  metaAppId: string;
  metaAppSecret: string;
  hasLiveCredentials: boolean;
}

export function resolveEnvMetaWhatsAppConfig(): EnvMetaWhatsAppConfig {
  resolveMonorepoRoot();
  const businessPortfolioId = (
    process.env.META_BUSINESS_PORTFOLIO_ID ||
    process.env.WHATSAPP_BUSINESS_PORTFOLIO_ID ||
    ""
  ).trim();
  const wabaId = (
    process.env.WHATSAPP_WABA_ID ||
    process.env.WHATSAPP_MESSAGING_ACCOUNT_ID ||
    ""
  ).trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  const systemUserAccessToken = (
    process.env.WHATSAPP_SYSTEM_ACCESS_TOKEN ||
    process.env.FACEBOOK_SYSTEM_ACCESS_TOKEN ||
    ""
  ).trim();
  const businessDisplayPhone = (
    process.env.WHATSAPP_DISPLAY_PHONE || "+91 73372 20568"
  ).trim();
  const verifiedName = (
    process.env.WHATSAPP_VERIFIED_NAME ||
    "Classic Concepts Acrylic Private Limited"
  ).trim();
  const webhookVerifyToken = (
    process.env.WHATSAPP_VERIFY_TOKEN || "cc_whatsapp_verify_2026"
  ).trim();
  const metaAppId = (process.env.META_APP_ID || "").trim();
  const metaAppSecret = (process.env.META_APP_SECRET || "").trim();
  const hasLiveCredentials = Boolean(phoneNumberId && systemUserAccessToken);
  const rawMode = (process.env.WHATSAPP_MODE || "").trim().toUpperCase();
  const mode: "SANDBOX_SIMULATOR" | "LIVE_META_CLOUD" =
    rawMode === "SANDBOX_SIMULATOR"
      ? "SANDBOX_SIMULATOR"
      : rawMode === "LIVE_META_CLOUD" || hasLiveCredentials
      ? "LIVE_META_CLOUD"
      : "SANDBOX_SIMULATOR";

  return {
    mode,
    businessPortfolioId,
    wabaId,
    phoneNumberId,
    businessDisplayPhone,
    verifiedName,
    systemUserAccessToken,
    webhookVerifyToken,
    metaAppId,
    metaAppSecret,
    hasLiveCredentials,
  };
}

export function resolveDataDirectory(): string {
  const dir = process.env.DATABASE_DATA_DIR
    ? path.resolve(/*turbopackIgnore: true*/ process.env.DATABASE_DATA_DIR)
    : path.join(/*turbopackIgnore: true*/ resolveMonorepoRoot(), "data");
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function resolveBackupDirectory(): string {
  const dir = path.join(/*turbopackIgnore: true*/ resolveMonorepoRoot(), "backups");
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getDatabaseFilePath(domain: DatabaseDomain): string {
  return path.join(/*turbopackIgnore: true*/ resolveDataDirectory(), DATABASE_FILES[domain]);
}

export function resolveWhatsAppWebAppOrigin(): string {
  const raw = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.APP_BASE_URL ||
    "https://chat.ccapl.cc"
  ).trim();
  const cleaned = raw.replace(/\/+$/, "");
  if (cleaned.toLowerCase() === "https://whatsapp.ccapl.cc" || cleaned.toLowerCase() === "http://whatsapp.ccapl.cc") {
    return "https://chat.ccapl.cc";
  }
  return cleaned;
}

export function resolveShortLinkDomainOrigin(): string {
  const raw = (
    process.env.SHORTLINK_PUBLIC_ORIGIN ||
    process.env.NEXT_PUBLIC_SHORTLINK_ORIGIN ||
    "https://ccapl.cc"
  ).trim();
  return raw.replace(/\/+$/, "");
}

export function resolvePublicShortLinkOrigin(): string {
  return resolveShortLinkDomainOrigin();
}

export function buildPublicShortUrl(code: string): string {
  const clean = String(code || "").trim().replace(/^\/+/, "");
  return `${resolveShortLinkDomainOrigin()}/${clean}`;
}

export function resolvePublicTrackingOrigin(): string {
  const raw = (
    process.env.TRACKING_PUBLIC_ORIGIN ||
    process.env.NEXT_PUBLIC_TRACKING_ORIGIN ||
    "https://track.ccapl.cc"
  ).trim();
  return raw.replace(/\/+$/, "");
}

export function resolveEcosystemBridgeKey(): string {
  resolveMonorepoRoot();
  return (
    process.env.CC_BRIDGE_KEY ||
    process.env.CC_ECOSYSTEM_BRIDGE_KEY ||
    process.env.INTERNAL_BRIDGE_SECRET ||
    "cc_internal_ecosystem_bridge_2026"
  ).trim();
}

export function isValidEcosystemBridgeKey(candidateKey: string | null | undefined): boolean {
  const clean = String(candidateKey || "").trim();
  if (!clean) return false;
  const accepted = new Set([
    resolveEcosystemBridgeKey(),
    "cc_internal_ecosystem_bridge_2026",
    "cc_internal_bridge_2026",
  ]);
  return accepted.has(clean);
}

export function resolveClassicConceptsInternalUrl(): string {
  resolveMonorepoRoot();
  return (
    process.env.CLASSICCONCEPTS_API_URL || "http://127.0.0.1:3003"
  )
    .trim()
    .replace(/\/+$/, "");
}

export function resolveClassicEdgeInternalUrl(): string {
  resolveMonorepoRoot();
  return (process.env.CLASSICEDGE_API_URL || "http://127.0.0.1:3002")
    .trim()
    .replace(/\/+$/, "");
}

export function resolveMainWebsiteDbPath(): string | null {
  if (process.env.CLASSIC_CONCEPTS_MAIN_DB && fs.existsSync(/*turbopackIgnore: true*/ process.env.CLASSIC_CONCEPTS_MAIN_DB)) {
    return path.resolve(/*turbopackIgnore: true*/ process.env.CLASSIC_CONCEPTS_MAIN_DB);
  }
  const root = resolveMonorepoRoot();
  const candidates = [
    "C:/Users/DELL/Desktop/classicconcepts/dev.db",
    path.resolve(/*turbopackIgnore: true*/ root, "..", "classicconcepts", "dev.db"),
    path.resolve(/*turbopackIgnore: true*/ root, "..", "dev.db"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ c)) return c;
  }
  return null;
}

export function resolveClassicEdgeDbPath(): string | null {
  if (process.env.CLASSIC_EDGE_MAIN_DB && fs.existsSync(/*turbopackIgnore: true*/ process.env.CLASSIC_EDGE_MAIN_DB)) {
    return path.resolve(/*turbopackIgnore: true*/ process.env.CLASSIC_EDGE_MAIN_DB);
  }
  const root = resolveMonorepoRoot();
  const candidates = [
    "C:/Users/DELL/Desktop/classicedge/dev.db",
    path.resolve(/*turbopackIgnore: true*/ root, "..", "classicedge", "dev.db"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ c)) return c;
  }
  return null;
}
