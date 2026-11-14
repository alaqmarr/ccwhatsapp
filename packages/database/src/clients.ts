import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

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
  if (!fs.existsSync(filePath)) return;
  try {
    const content = fs.readFileSync(filePath, "utf8");
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
    root = path.resolve(process.env.CCWHATSAPP_ROOT);
  } else if (root.endsWith(path.join("apps", "web"))) {
    root = path.resolve(root, "..", "..");
  } else if (fs.existsSync(path.join(root, "ccwhatsapp"))) {
    root = path.join(root, "ccwhatsapp");
  }

  if (dotEnvLoadedForRoot !== root) {
    dotEnvLoadedForRoot = root;
    parseAndPopulateDotEnvFile(path.join(root, ".env.local"));
    parseAndPopulateDotEnvFile(path.join(root, ".env"));
    parseAndPopulateDotEnvFile(path.join(root, ".env.production"));
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
  const dir = path.join(resolveMonorepoRoot(), "data");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function resolveBackupDirectory(): string {
  const dir = path.join(resolveMonorepoRoot(), "backups");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getDatabaseFilePath(domain: DatabaseDomain): string {
  return path.join(resolveDataDirectory(), DATABASE_FILES[domain]);
}

function toLibSqlFileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  return normalized.startsWith("/") ? `file:${normalized}` : `file:///${normalized}`;
}

interface CachedMultiDb {
  rawClients: Partial<Record<DatabaseDomain, Client>>;
  drizzleClients: Partial<Record<DatabaseDomain, LibSQLDatabase>>;
  bootstrapped?: Promise<void>;
  mainCatalogClient?: Client | null;
  classicEdgeClient?: Client | null;
}

const globalDbHolder = globalThis as unknown as {
  __ccMultiLibSql?: CachedMultiDb;
};

function getHolder(): CachedMultiDb {
  if (!globalDbHolder.__ccMultiLibSql) {
    globalDbHolder.__ccMultiLibSql = {
      rawClients: {},
      drizzleClients: {},
    };
  }
  return globalDbHolder.__ccMultiLibSql;
}

export function getRawLibSqlClient(domain: DatabaseDomain): Client {
  const holder = getHolder();
  if (!holder.rawClients[domain]) {
    const filePath = getDatabaseFilePath(domain);
    const client = createClient({
      url: toLibSqlFileUrl(filePath),
    });
    holder.rawClients[domain] = client;
  }
  return holder.rawClients[domain]!;
}

export function getDrizzleDb(domain: DatabaseDomain): LibSQLDatabase {
  const holder = getHolder();
  if (!holder.drizzleClients[domain]) {
    holder.drizzleClients[domain] = drizzle(getRawLibSqlClient(domain));
  }
  return holder.drizzleClients[domain]!;
}

export const authDb = () => getDrizzleDb("core_auth");
export const conversationsDb = () => getDrizzleDb("conversations");
export const contactsDb = () => getDrizzleDb("contacts");
export const crmDb = () => getDrizzleDb("crm_orders");
export const marketingDb = () => getDrizzleDb("marketing");
export const billingDb = () => getDrizzleDb("billing_ops");
export const queueDb = () => getDrizzleDb("queue_jobs");

export function normalizeWhatsAppPhone(raw: string): string {
  const trimmed = String(raw || "").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return `+91${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return `+91${digits.slice(1)}`;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  return "";
}

export interface UpsertSyncedContactInput {
  phone: string;
  name?: string;
  whatsappName?: string;
  email?: string;
  companyName?: string;
  designation?: string;
  organizationType?: string;
  city?: string;
  state?: string;
  country?: string;
  gstNumber?: string;
  source?: string;
  stage?: string;
  acrioSegment?: string;
  tags?: string[];
  groups?: string[];
  optInMarketing?: boolean;
  optOutReason?: string;
  assignedOwnerId?: string | null;
  assignedOwnerName?: string;
  lifetimeValueInr?: number;
  totalOrdersCount?: number;
  notes?: string;
  lastContactedAt?: string;
}

/**
 * Keeps contacts.db, crm_orders.db (customers), and conversations.db (customer_name)
 * synchronized whenever a contact is created or updated anywhere in the app.
 */
export async function upsertSyncedContact(
  input: UpsertSyncedContactInput
): Promise<{ ok: boolean; id?: string; phone?: string; isNew?: boolean; error?: string }> {
  const phone = normalizeWhatsAppPhone(input.phone);
  if (!phone) {
    return { ok: false, error: "Please enter a valid 10 to 15 digit WhatsApp phone number." };
  }

  const contactsClient = getRawLibSqlClient("contacts");
  const crmClient = getRawLibSqlClient("crm_orders");
  const convClient = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();

  const existingRes = await contactsClient.execute({
    sql: `SELECT * FROM contacts WHERE phone = ? LIMIT 1`,
    args: [phone],
  });
  const ex = existingRes.rows[0] as Record<string, unknown> | undefined;
  const isNew = !ex;

  const parseArr = (raw: unknown): string[] => {
    try {
      const parsed = JSON.parse(String(raw || "[]"));
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  const id = ex ? String(ex.id) : `cnt_${Math.random().toString(36).slice(2, 10)}`;
  const cleanName = (input.name ?? "").trim();
  const finalName =
    cleanName ||
    (ex && String(ex.name || "").trim() && String(ex.name) !== phone
      ? String(ex.name)
      : (input.whatsappName || "").trim() || phone);
  const finalWaName =
    input.whatsappName !== undefined
      ? input.whatsappName.trim()
      : String(ex?.whatsapp_name || "");
  const finalEmail =
    input.email !== undefined ? input.email.trim() : String(ex?.email || "");
  const finalCompany =
    input.companyName !== undefined
      ? input.companyName.trim()
      : String(ex?.company_name || "");
  const finalDesignation =
    input.designation !== undefined
      ? input.designation.trim()
      : String(ex?.designation || "");
  const finalOrgType =
    input.organizationType !== undefined && input.organizationType.trim()
      ? input.organizationType.trim()
      : String(ex?.organization_type || "Business");
  const finalCity =
    input.city !== undefined ? input.city.trim() : String(ex?.city || "");
  const finalState =
    input.state !== undefined ? input.state.trim() : String(ex?.state || "");
  const finalCountry =
    input.country !== undefined && input.country.trim()
      ? input.country.trim()
      : String(ex?.country || "India");
  const finalGst =
    input.gstNumber !== undefined
      ? input.gstNumber.trim().toUpperCase()
      : String(ex?.gst_number || "");
  const finalSource =
    input.source !== undefined && input.source.trim()
      ? input.source.trim()
      : String(ex?.source || "MANUAL");
  const finalStage =
    input.stage !== undefined && input.stage.trim()
      ? input.stage.trim()
      : String(ex?.stage || "NEW_LEAD");
  const finalSegment =
    input.acrioSegment !== undefined && input.acrioSegment.trim()
      ? input.acrioSegment.trim()
      : String(ex?.acrio_segment || "Active Prospect");

  const finalTags =
    input.tags !== undefined
      ? Array.from(new Set(input.tags.map((t) => t.trim()).filter(Boolean)))
      : parseArr(ex?.tags_json);
  const finalGroups =
    input.groups !== undefined
      ? Array.from(new Set(input.groups.map((g) => g.trim()).filter(Boolean)))
      : parseArr(ex?.groups_json);

  const finalOptIn =
    input.optInMarketing !== undefined
      ? input.optInMarketing
        ? 1
        : 0
      : Number(ex?.opt_in_marketing ?? 1);
  const finalOptOutReason =
    input.optOutReason !== undefined
      ? input.optOutReason.trim()
      : finalOptIn === 1
      ? ""
      : String(ex?.opt_out_reason || "");
  const finalOwnerId =
    input.assignedOwnerId !== undefined
      ? input.assignedOwnerId
      : ex?.assigned_owner_id
      ? String(ex.assigned_owner_id)
      : null;
  const finalOwnerName =
    input.assignedOwnerName !== undefined
      ? input.assignedOwnerName.trim()
      : String(ex?.assigned_owner_name || "");
  const finalLtv =
    input.lifetimeValueInr !== undefined
      ? Number(input.lifetimeValueInr)
      : Number(ex?.lifetime_value_inr ?? 0);
  const finalOrders =
    input.totalOrdersCount !== undefined
      ? Number(input.totalOrdersCount)
      : Number(ex?.total_orders_count ?? 0);
  const finalNotes =
    input.notes !== undefined ? input.notes.trim() : String(ex?.notes || "");
  const finalLastContacted =
    input.lastContactedAt || (ex?.last_contacted_at ? String(ex.last_contacted_at) : nowIso);
  const createdAt = ex?.created_at ? String(ex.created_at) : nowIso;

  await contactsClient.execute({
    sql: `INSERT INTO contacts (
      id, phone, whatsapp_name, name, email, company_name, designation,
      organization_type, city, state, country, gst_number, source, stage,
      acrio_segment, tags_json, groups_json, opt_in_marketing, opt_out_reason,
      assigned_owner_id, assigned_owner_name, lifetime_value_inr, total_orders_count,
      notes, last_contacted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      whatsapp_name = excluded.whatsapp_name,
      name = excluded.name,
      email = excluded.email,
      company_name = excluded.company_name,
      designation = excluded.designation,
      organization_type = excluded.organization_type,
      city = excluded.city,
      state = excluded.state,
      country = excluded.country,
      gst_number = excluded.gst_number,
      source = excluded.source,
      stage = excluded.stage,
      acrio_segment = excluded.acrio_segment,
      tags_json = excluded.tags_json,
      groups_json = excluded.groups_json,
      opt_in_marketing = excluded.opt_in_marketing,
      opt_out_reason = excluded.opt_out_reason,
      assigned_owner_id = excluded.assigned_owner_id,
      assigned_owner_name = excluded.assigned_owner_name,
      lifetime_value_inr = excluded.lifetime_value_inr,
      total_orders_count = excluded.total_orders_count,
      notes = excluded.notes,
      last_contacted_at = excluded.last_contacted_at,
      updated_at = excluded.updated_at`,
    args: [
      id,
      phone,
      finalWaName,
      finalName,
      finalEmail,
      finalCompany,
      finalDesignation,
      finalOrgType,
      finalCity,
      finalState,
      finalCountry,
      finalGst,
      finalSource,
      finalStage,
      finalSegment,
      JSON.stringify(finalTags),
      JSON.stringify(finalGroups),
      finalOptIn,
      finalOptOutReason,
      finalOwnerId,
      finalOwnerName,
      finalLtv,
      finalOrders,
      finalNotes,
      finalLastContacted,
      createdAt,
      nowIso,
    ],
  });

  // Mirror into crm_orders.db (customers) so Broadcast Queue, ACRIO Lists, and Inbox 360 stay synced
  const custRes = await crmClient.execute({
    sql: `SELECT id FROM customers WHERE phone = ? LIMIT 1`,
    args: [phone],
  });
  const custId = custRes.rows[0] ? String(custRes.rows[0].id) : `cust_${id.replace(/^cnt_/, "")}`;

  await crmClient.execute({
    sql: `INSERT INTO customers (
      id, phone, name, email, company_name, organization_type, city, gst_number,
      acrio_segment, tags_json, lifetime_value_inr, total_orders_count,
      opt_in_marketing, notes, last_interaction_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      company_name = excluded.company_name,
      organization_type = excluded.organization_type,
      city = excluded.city,
      gst_number = excluded.gst_number,
      acrio_segment = excluded.acrio_segment,
      tags_json = excluded.tags_json,
      lifetime_value_inr = excluded.lifetime_value_inr,
      total_orders_count = excluded.total_orders_count,
      opt_in_marketing = excluded.opt_in_marketing,
      notes = excluded.notes,
      last_interaction_at = excluded.last_interaction_at`,
    args: [
      custId,
      phone,
      finalName,
      finalEmail || null,
      finalCompany || null,
      finalOrgType,
      finalCity || null,
      finalGst || null,
      finalSegment,
      JSON.stringify(finalTags),
      finalLtv,
      finalOrders,
      finalOptIn,
      finalNotes,
      finalLastContacted,
      createdAt,
    ],
  });

  // Also keep active conversation display name & customer_id aligned if a chat thread exists
  if (finalName && finalName !== phone) {
    await convClient
      .execute({
        sql: `UPDATE conversations SET customer_name = ?, customer_id = COALESCE(customer_id, ?) WHERE customer_phone = ?`,
        args: [finalName, custId, phone],
      })
      .catch(() => {});
  }

  return { ok: true, id, phone, isNew };
}

// ============================================================================
// ECOSYSTEM BRIDGES: classicconcepts.in (Products) + classicedge53.com (Machines)
// ============================================================================
export interface MainWebsiteProduct {
  id: string;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  brandLabel: string;
  itemType: "PRODUCT" | "MACHINE" | "CONSUMABLE";
  name: string;
  slug: string;
  sku: string | null;
  categoryName: string;
  description?: string | null;
  basePrice: number | null;
  mainImage: string | null;
  url: string;
  shortCode?: string;
  shortUrl?: string;
  modelsSummary?: string | null;
  specsSummary?: string | null;
}

export function resolvePublicShortLinkOrigin(): string {
  const raw = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    "https://whatsapp.ccapl.cc"
  ).trim();
  return raw.replace(/\/+$/, "");
}

function toShortSlugPart(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildPreferredProductShortCode(item: MainWebsiteProduct): string {
  const prefix = item.brand === "CLASSIC_EDGE_53" ? "ce53" : "cc";
  const firstSku = item.sku
    ? item.sku.split("/")[0].split(",")[0].trim()
    : "";
  let skuPart = toShortSlugPart(firstSku);
  if (prefix === "cc" && skuPart.startsWith("cc-")) {
    skuPart = skuPart.slice(3);
  } else if (prefix === "ce53" && skuPart.startsWith("ce53-")) {
    skuPart = skuPart.slice(5);
  } else if (prefix === "ce53" && skuPart.startsWith("ce-")) {
    skuPart = skuPart.slice(3);
  }

  if (skuPart.length >= 3 && skuPart.length <= 18 && skuPart !== "test") {
    return `${prefix}-${skuPart}`;
  }

  const rawSlug = String(item.slug || "").trim();
  const isLikelyCuid = /^c[a-z0-9]{20,}$/i.test(rawSlug);
  const rawCandidate = !isLikelyCuid && rawSlug ? rawSlug : item.name;
  let slugPart = toShortSlugPart(rawCandidate).replace(/^acrylic-/, "");
  if (!slugPart) {
    slugPart = toShortSlugPart(rawCandidate) || toShortSlugPart(item.id) || "item";
  }
  slugPart = slugPart.slice(0, 24).replace(/-+$/, "");
  if (prefix === "cc" && slugPart.startsWith("cc-")) {
    slugPart = slugPart.slice(3);
  } else if (prefix === "ce53" && slugPart.startsWith("ce53-")) {
    slugPart = slugPart.slice(5);
  }
  return `${prefix}-${slugPart || "item"}`;
}

function appendWhatsAppShortLinkUtm(
  rawUrl: string,
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53"
): string {
  const clean = String(rawUrl || "").trim();
  if (!clean || /[?&]utm_source=/i.test(clean)) return clean;
  const sep = clean.includes("?") ? "&" : "?";
  const campaign =
    brand === "CLASSIC_EDGE_53" ? "auto_classicedge53" : "auto_classicconcepts";
  return `${clean}${sep}utm_source=whatsapp&utm_medium=shortlink&utm_campaign=${campaign}`;
}

function isDummyPlaceholderRow(id: unknown, name: unknown): boolean {
  const cleanId = String(id || "").trim().toLowerCase();
  const cleanName = String(name || "").trim().toLowerCase();
  return cleanId === "test" && (cleanName === "test" || cleanName === "test product");
}

let shortLinkTableReady = false;
let shortLinkSyncChain: Promise<void> = Promise.resolve();

/**
 * Automatically creates or updates short links (`/l/<code>` in `conversations.db -> custom_links`)
 * for every product, machine, and consumable fetched from Classic Concepts (`classicconcepts.in`)
 * and Classic Edge 53 (`classicedge53.com`), preserving existing short codes and click counts.
 */
export async function ensureEcosystemProductShortLinks(
  items: MainWebsiteProduct[]
): Promise<MainWebsiteProduct[]> {
  if (!items || items.length === 0) return items;

  const origin = resolvePublicShortLinkOrigin();
  const codeByIndex = new Map<number, string>();

  const task = shortLinkSyncChain.then(async () => {
    try {
      const conv = getRawLibSqlClient("conversations");
      if (!shortLinkTableReady) {
        await conv.execute("PRAGMA journal_mode = WAL;");
        await conv.execute("PRAGMA busy_timeout = 5000;");
        await conv.execute(`CREATE TABLE IF NOT EXISTS custom_links (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          target_url TEXT NOT NULL,
          link_type TEXT NOT NULL DEFAULT 'PRODUCT',
          product_slug TEXT,
          utm_campaign TEXT,
          created_by_name TEXT NOT NULL,
          clicks_count INTEGER NOT NULL DEFAULT 0,
          last_clicked_at TEXT,
          created_at TEXT NOT NULL
        )`);
        shortLinkTableReady = true;
      }

      const existingRes = await conv.execute(
        `SELECT id, code, title, target_url, product_slug, utm_campaign FROM custom_links`
      );

      const byProductKey = new Map<
        string,
        {
          id: string;
          code: string;
          title: string;
          targetUrl: string;
          utmCampaign: string;
        }
      >();
      const usedCodes = new Set<string>();

      for (const row of existingRes.rows) {
        const code = String(row.code || "").trim().toLowerCase();
        if (code) usedCodes.add(code);
        const pSlug = row.product_slug ? String(row.product_slug).trim() : "";
        if (pSlug && !byProductKey.has(pSlug)) {
          byProductKey.set(pSlug, {
            id: String(row.id),
            code,
            title: String(row.title || ""),
            targetUrl: String(row.target_url || ""),
            utmCampaign: String(row.utm_campaign || ""),
          });
        }
      }

      const writeStmts: { sql: string; args: (string | number | null)[] }[] = [];
      const nowIso = new Date().toISOString();

      items.forEach((item, idx) => {
        const brandPrefix = item.brand === "CLASSIC_EDGE_53" ? "ce53" : "cc";
        const productKey = `${brandPrefix}:${item.itemType.toLowerCase()}:${item.slug || item.id}`;
        const utmCampaign =
          item.brand === "CLASSIC_EDGE_53"
            ? "auto_classicedge53"
            : "auto_classicconcepts";
        const createdByName =
          item.brand === "CLASSIC_EDGE_53"
            ? "Auto Sync (Classic Edge 53)"
            : "Auto Sync (Classic Concepts)";
        const desiredTitle = item.name.trim();
        const desiredTargetUrl = appendWhatsAppShortLinkUtm(item.url, item.brand);

        const existing = byProductKey.get(productKey);
        if (existing) {
          codeByIndex.set(idx, existing.code);
          if (
            existing.title !== desiredTitle ||
            existing.targetUrl !== desiredTargetUrl ||
            existing.utmCampaign !== utmCampaign
          ) {
            writeStmts.push({
              sql: `UPDATE custom_links
                    SET title = ?, target_url = ?, utm_campaign = ?
                    WHERE id = ?`,
              args: [desiredTitle, desiredTargetUrl, utmCampaign, existing.id],
            });
            existing.title = desiredTitle;
            existing.targetUrl = desiredTargetUrl;
            existing.utmCampaign = utmCampaign;
          }
          return;
        }

        const baseCode = buildPreferredProductShortCode(item);
        let chosenCode = baseCode;
        let suffix = 2;
        while (usedCodes.has(chosenCode)) {
          chosenCode = `${baseCode}-${suffix}`;
          suffix++;
        }
        usedCodes.add(chosenCode);
        codeByIndex.set(idx, chosenCode);

        const linkId = `lnk_auto_${brandPrefix}_${Math.random().toString(36).slice(2, 10)}`;
        byProductKey.set(productKey, {
          id: linkId,
          code: chosenCode,
          title: desiredTitle,
          targetUrl: desiredTargetUrl,
          utmCampaign,
        });

        writeStmts.push({
          sql: `INSERT OR IGNORE INTO custom_links (
            id, code, title, target_url, link_type, product_slug, utm_campaign, created_by_name, clicks_count, created_at
          ) VALUES (?, ?, ?, ?, 'PRODUCT', ?, ?, ?, 0, ?)`,
          args: [
            linkId,
            chosenCode,
            desiredTitle,
            desiredTargetUrl,
            productKey,
            utmCampaign,
            createdByName,
            nowIso,
          ],
        });
      });

      if (writeStmts.length > 0) {
        await conv.batch(writeStmts, "write");
      }
    } catch {
      // Non-blocking fallback: still attach deterministic short codes in memory if DB is temporarily unavailable
    }
  });

  shortLinkSyncChain = task.catch(() => {});
  await task;

  return items.map((item, idx) => {
    const code = codeByIndex.get(idx) || buildPreferredProductShortCode(item);
    return {
      ...item,
      shortCode: code,
      shortUrl: `${origin}/l/${code}`,
    };
  });
}

export interface MainWebsiteEnquiry {
  id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  source: string;
  status: string;
  createdAt: string;
}

export function resolveMainWebsiteDbPath(): string | null {
  if (process.env.CLASSIC_CONCEPTS_MAIN_DB && fs.existsSync(process.env.CLASSIC_CONCEPTS_MAIN_DB)) {
    return path.resolve(process.env.CLASSIC_CONCEPTS_MAIN_DB);
  }
  const root = resolveMonorepoRoot();
  const candidates = [
    "C:/Users/DELL/Desktop/classicconcepts/dev.db",
    path.resolve(root, "..", "classicconcepts", "dev.db"),
    path.resolve(root, "..", "dev.db"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function resolveClassicEdgeDbPath(): string | null {
  if (process.env.CLASSIC_EDGE_MAIN_DB && fs.existsSync(process.env.CLASSIC_EDGE_MAIN_DB)) {
    return path.resolve(process.env.CLASSIC_EDGE_MAIN_DB);
  }
  const root = resolveMonorepoRoot();
  const candidates = [
    "C:/Users/DELL/Desktop/classicedge/dev.db",
    path.resolve(root, "..", "classicedge", "dev.db"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function getMainCatalogClient(): Client | null {
  const holder = getHolder();
  if (holder.mainCatalogClient !== undefined) return holder.mainCatalogClient;
  const dbPath = resolveMainWebsiteDbPath();
  if (!dbPath) {
    holder.mainCatalogClient = null;
    return null;
  }
  holder.mainCatalogClient = createClient({
    url: toLibSqlFileUrl(dbPath),
  });
  return holder.mainCatalogClient;
}

function getClassicEdgeClient(): Client | null {
  const holder = getHolder();
  if (holder.classicEdgeClient !== undefined) return holder.classicEdgeClient;
  const dbPath = resolveClassicEdgeDbPath();
  if (!dbPath) {
    holder.classicEdgeClient = null;
    return null;
  }
  holder.classicEdgeClient = createClient({
    url: toLibSqlFileUrl(dbPath),
  });
  return holder.classicEdgeClient;
}

/**
 * Loads the complete Classic Concepts acrylic product catalog (`classicconcepts.in`)
 * via API if configured, or directly from the local SQLite database.
 */
export async function loadAllClassicConceptsProducts(): Promise<MainWebsiteProduct[]> {
  const apiUrl = (process.env.CLASSICCONCEPTS_API_URL || "").trim().replace(/\/+$/, "");
  if (apiUrl) {
    try {
      const res = await fetch(`${apiUrl}/api/whatsapp-catalog`, {
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const data: any = await res.json();
        if (Array.isArray(data?.products) && data.products.length > 0) {
          const apiItems: MainWebsiteProduct[] = data.products
            .filter((p: any) => !isDummyPlaceholderRow(p?.id, p?.name))
            .map((p: any) => ({
              id: String(p.id),
              brand: "CLASSIC_CONCEPTS" as const,
              brandLabel: "Classic Concepts",
              itemType: "PRODUCT" as const,
              name: String(p.name),
              slug: String(p.slug),
              sku: p.sku ? String(p.sku) : null,
              categoryName: String(p.categoryName || "Acrylic Products"),
              description: p.description ? String(p.description) : null,
              basePrice: typeof p.basePrice === "number" ? p.basePrice : null,
              mainImage: p.mainImage ? String(p.mainImage) : null,
              url: String(p.url || `https://classicconcepts.in/shop/p/${p.slug}`),
              specsSummary: Array.isArray(p.specifications)
                ? p.specifications.slice(0, 3).map((s: any) => `${s.key}: ${s.value}`).join(", ")
                : null,
            }));
          if (apiItems.length > 0) {
            return ensureEcosystemProductShortLinks(apiItems);
          }
        }
      }
    } catch {
      // Fallback to direct LibSQL read below
    }
  }

  try {
    const client = getMainCatalogClient();
    if (!client) return ensureEcosystemProductShortLinks(FALLBACK_CLASSIC_CATALOG);

    const res = await client.execute({
      sql: `
        SELECT
          p.id,
          p.name,
          p.slug,
          p.sku,
          p.description,
          p.basePrice,
          p.discountPrice,
          p.isPodium,
          c.name AS categoryName,
          sc.name AS subCategoryName,
          (SELECT url FROM ProductImage pi WHERE pi.productId = p.id ORDER BY pi.isMain DESC, pi.createdAt ASC LIMIT 1) AS mainImage
        FROM Product p
        LEFT JOIN Category c ON p.categoryId = c.id
        LEFT JOIN SubCategory sc ON p.subCategoryId = sc.id
        ORDER BY p.isPodium DESC, p.updatedAt DESC
        LIMIT 250
      `,
      args: [],
    });

    const validRows = res.rows.filter(
      (r) => !isDummyPlaceholderRow(r.id, r.name)
    );
    if (validRows.length === 0) {
      return ensureEcosystemProductShortLinks(FALLBACK_CLASSIC_CATALOG);
    }

    const dbItems: MainWebsiteProduct[] = validRows.map((r) => {
      const slug = String(r.slug);
      const effectivePrice =
        r.discountPrice !== null && r.discountPrice !== undefined && Number(r.discountPrice) > 0
          ? Number(r.discountPrice)
          : r.basePrice !== null && r.basePrice !== undefined && Number(r.basePrice) > 0
          ? Number(r.basePrice)
          : null;

      return {
        id: String(r.id),
        brand: "CLASSIC_CONCEPTS" as const,
        brandLabel: "Classic Concepts",
        itemType: "PRODUCT" as const,
        name: String(r.name),
        slug,
        sku: r.sku ? String(r.sku) : null,
        categoryName: r.subCategoryName
          ? `${String(r.categoryName || "Acrylic")} - ${String(r.subCategoryName)}`
          : String(r.categoryName || "Acrylic Products"),
        description: r.description ? String(r.description).slice(0, 220) : null,
        basePrice: effectivePrice,
        mainImage: r.mainImage ? String(r.mainImage) : null,
        url: `https://classicconcepts.in/shop/p/${slug}`,
      };
    });

    return ensureEcosystemProductShortLinks(dbItems);
  } catch {
    return ensureEcosystemProductShortLinks(FALLBACK_CLASSIC_CATALOG);
  }
}

/**
 * Loads all Classic Edge 53 machines, models (`YN-JW1200`, CNC, laser, polishing, bending),
 * specifications, and consumables (`classicedge53.com`) via API or direct LibSQL read.
 */
export async function loadAllClassicEdgeItems(): Promise<MainWebsiteProduct[]> {
  const apiUrl = (process.env.CLASSICEDGE_API_URL || "").trim().replace(/\/+$/, "");
  if (apiUrl) {
    try {
      const res = await fetch(`${apiUrl}/api/whatsapp-catalog`, {
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const data: any = await res.json();
        const combined: MainWebsiteProduct[] = [];
        for (const m of data?.machines || []) {
          if (isDummyPlaceholderRow(m?.id, m?.name)) continue;
          combined.push({
            id: String(m.id),
            brand: "CLASSIC_EDGE_53",
            brandLabel: "Classic Edge 53",
            itemType: "MACHINE",
            name: String(m.name),
            slug: String(m.id),
            sku: Array.isArray(m.models) && m.models.length > 0
              ? m.models.map((md: any) => md.modelName).join(" / ")
              : null,
            categoryName: "Classic Edge 53 Machine",
            description: m.description ? String(m.description).slice(0, 220) : null,
            basePrice: null,
            mainImage: m.coverImage ? String(m.coverImage) : null,
            url: String(m.url || `https://classicedge53.com/products/${m.id}`),
            modelsSummary: Array.isArray(m.models)
              ? m.models.map((md: any) => md.modelName).join(", ")
              : null,
            specsSummary: Array.isArray(m.specifications)
              ? m.specifications.slice(0, 4).map((s: any) => `${s.key}: ${s.value}`).join(", ")
              : null,
          });
        }
        for (const c of data?.consumables || []) {
          if (isDummyPlaceholderRow(c?.id, c?.name)) continue;
          combined.push({
            id: String(c.id),
            brand: "CLASSIC_EDGE_53",
            brandLabel: "Classic Edge 53",
            itemType: "CONSUMABLE",
            name: String(c.name),
            slug: String(c.id),
            sku: null,
            categoryName: String(c.categoryName || "Machine Consumables"),
            description: c.description ? String(c.description).slice(0, 200) : null,
            basePrice: null,
            mainImage: c.mainImage ? String(c.mainImage) : null,
            url: String(c.url || `https://classicedge53.com/consumables/${c.id}`),
          });
        }
        if (combined.length > 0) {
          return ensureEcosystemProductShortLinks(combined);
        }
      }
    } catch {
      // Fallback to direct LibSQL read below
    }
  }

  try {
    const client = getClassicEdgeClient();
    if (!client) return ensureEcosystemProductShortLinks(FALLBACK_CLASSIC_EDGE_MACHINES);

    const [machinesRes, modelsRes, specsRes, consRes] = await Promise.all([
      client.execute(`SELECT id, name, description, keywords, coverImage FROM Product ORDER BY updatedAt DESC`),
      client.execute(`SELECT id, productId, modelName FROM ProductModel`),
      client.execute(`SELECT productId, productModelId, key, value FROM Specification`),
      client.execute(`SELECT id, name, description, keywords, image, category FROM Consumable ORDER BY updatedAt DESC`),
    ]);

    const modelsByProd = new Map<string, string[]>();
    for (const m of modelsRes.rows) {
      const pid = String(m.productId || "");
      if (!modelsByProd.has(pid)) modelsByProd.set(pid, []);
      modelsByProd.get(pid)!.push(String(m.modelName));
    }

    const specsByProd = new Map<string, string[]>();
    for (const s of specsRes.rows) {
      const pid = String(s.productId || "");
      if (!pid) continue;
      if (!specsByProd.has(pid)) specsByProd.set(pid, []);
      if (specsByProd.get(pid)!.length < 4) {
        specsByProd.get(pid)!.push(`${String(s.key)}: ${String(s.value || "")}`);
      }
    }

    const items: MainWebsiteProduct[] = [];
    for (const r of machinesRes.rows) {
      if (isDummyPlaceholderRow(r.id, r.name)) continue;
      const id = String(r.id);
      const models = modelsByProd.get(id) || [];
      const specs = specsByProd.get(id) || [];
      items.push({
        id,
        brand: "CLASSIC_EDGE_53",
        brandLabel: "Classic Edge 53",
        itemType: "MACHINE",
        name: String(r.name),
        slug: id,
        sku: models.length > 0 ? models.slice(0, 3).join(" / ") : null,
        categoryName: "Acrylic Machine (Classic Edge 53)",
        description: r.description ? String(r.description).slice(0, 220) : null,
        basePrice: null,
        mainImage: r.coverImage ? String(r.coverImage) : null,
        url: `https://classicedge53.com/products/${id}`,
        modelsSummary: models.join(", ") || null,
        specsSummary: [specs.join(", "), r.keywords ? String(r.keywords) : ""].filter(Boolean).join(" | ") || null,
      });
    }

    for (const c of consRes.rows) {
      if (isDummyPlaceholderRow(c.id, c.name)) continue;
      const id = String(c.id);
      items.push({
        id,
        brand: "CLASSIC_EDGE_53",
        brandLabel: "Classic Edge 53",
        itemType: "CONSUMABLE",
        name: String(c.name),
        slug: id,
        sku: null,
        categoryName: c.category ? `Consumable - ${String(c.category)}` : "Machine Consumables",
        description: c.description ? String(c.description).slice(0, 200) : null,
        basePrice: null,
        mainImage: c.image ? String(c.image) : null,
        url: `https://classicedge53.com/consumables/${id}`,
        specsSummary: c.keywords ? String(c.keywords) : null,
      });
    }

    return ensureEcosystemProductShortLinks(
      items.length > 0 ? items : FALLBACK_CLASSIC_EDGE_MACHINES
    );
  } catch {
    return ensureEcosystemProductShortLinks(FALLBACK_CLASSIC_EDGE_MACHINES);
  }
}

export function searchEcosystemItems(
  items: MainWebsiteProduct[],
  searchQuery: string,
  limit = 6
): MainWebsiteProduct[] {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return items.slice(0, limit);

  const tokens = q
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !["the", "and", "for", "with", "have", "need", "want", "please", "hello", "classic", "concepts"].includes(t));

  if (tokens.length === 0) return items.slice(0, limit);

  const wantsMachine = /machine|laser|cnc|router|polish|diamond|bending|bender|heater|blade|cutter|tool|ce53|edge|yn-|model/i.test(q);

  const scored = items.map((item) => {
    const haystack = [
      item.name,
      item.sku || "",
      item.categoryName,
      item.description || "",
      item.modelsSummary || "",
      item.specsSummary || "",
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;
    if (haystack.includes(q)) score += 25;
    for (const tok of tokens) {
      if (item.name.toLowerCase().includes(tok)) score += 10;
      else if ((item.sku || "").toLowerCase().includes(tok)) score += 12;
      else if ((item.modelsSummary || "").toLowerCase().includes(tok)) score += 11;
      else if (haystack.includes(tok)) score += 4;
    }
    if (wantsMachine && item.brand === "CLASSIC_EDGE_53") score += 8;
    if (!wantsMachine && item.brand === "CLASSIC_CONCEPTS") score += 2;

    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const positive = scored.filter((s) => s.score > 0).map((s) => s.item);
  return (positive.length > 0 ? positive : items).slice(0, limit);
}

export async function fetchClassicCatalogProducts(
  searchQuery = "",
  limit = 12
): Promise<MainWebsiteProduct[]> {
  const [ccItems, ceItems] = await Promise.all([
    loadAllClassicConceptsProducts(),
    loadAllClassicEdgeItems(),
  ]);
  return searchEcosystemItems([...ccItems, ...ceItems], searchQuery, limit);
}

export async function fetchWebsiteEnquiriesForCustomer(
  phoneDigitsOrEmail: string
): Promise<MainWebsiteEnquiry[]> {
  if (!phoneDigitsOrEmail) return [];
  const last10 = phoneDigitsOrEmail.replace(/\D/g, "").slice(-10);
  const emailVal = phoneDigitsOrEmail.includes("@") ? phoneDigitsOrEmail.trim() : "";
  if (last10.length < 7 && !emailVal) return [];

  const combined: MainWebsiteEnquiry[] = [];

  // 1. Classic Concepts (`classicconcepts.in`) enquiries
  try {
    const ccClient = getMainCatalogClient();
    if (ccClient) {
      const res = await ccClient.execute({
        sql: `
          SELECT id, name, email, phone, message, source, status, createdAt
          FROM Enquiry
          WHERE (? != '' AND phone LIKE ?) OR (? != '' AND LOWER(email) = LOWER(?))
          ORDER BY createdAt DESC
          LIMIT 6
        `,
        args: [last10, `%${last10}%`, emailVal, emailVal],
      });
      for (const r of res.rows) {
        combined.push({
          id: `cc_${String(r.id)}`,
          name: String(r.name || ""),
          email: String(r.email || ""),
          phone: String(r.phone || ""),
          message: String(r.message || ""),
          source: `classicconcepts.in (${String(r.source || "Website")})`,
          status: String(r.status || "New"),
          createdAt: String(r.createdAt || ""),
        });
      }
    }
  } catch {
    // Non-blocking
  }

  // 2. Classic Edge 53 (`classicedge53.com`) machine enquiries
  try {
    const ceClient = getClassicEdgeClient();
    if (ceClient) {
      const res = await ceClient.execute({
        sql: `
          SELECT id, name, email, phone, message, productName, repliedAt, createdAt
          FROM Enquiry
          WHERE (? != '' AND phone LIKE ?) OR (? != '' AND LOWER(email) = LOWER(?))
          ORDER BY createdAt DESC
          LIMIT 6
        `,
        args: [last10, `%${last10}%`, emailVal, emailVal],
      });
      for (const r of res.rows) {
        const prod = r.productName ? String(r.productName) : "";
        combined.push({
          id: `ce_${String(r.id)}`,
          name: String(r.name || ""),
          email: String(r.email || ""),
          phone: String(r.phone || ""),
          message: prod ? `[Machine: ${prod}] ${String(r.message || "")}` : String(r.message || ""),
          source: `classicedge53.com${prod ? ` (${prod})` : ""}`,
          status: r.repliedAt ? "Replied" : "New",
          createdAt: String(r.createdAt || ""),
        });
      }
    }
  } catch {
    // Non-blocking
  }

  combined.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return combined.slice(0, 8);
}

export async function fetchAllEcosystemWebsiteEnquiries(
  limit = 500
): Promise<MainWebsiteEnquiry[]> {
  const combined: MainWebsiteEnquiry[] = [];

  try {
    const ccClient = getMainCatalogClient();
    if (ccClient) {
      const res = await ccClient.execute({
        sql: `SELECT id, name, email, phone, message, source, status, createdAt
              FROM Enquiry
              WHERE phone IS NOT NULL AND TRIM(phone) != ''
              ORDER BY createdAt DESC
              LIMIT ?`,
        args: [limit],
      });
      for (const r of res.rows) {
        combined.push({
          id: `cc_${String(r.id)}`,
          name: String(r.name || ""),
          email: String(r.email || ""),
          phone: String(r.phone || ""),
          message: String(r.message || ""),
          source: `classicconcepts.in`,
          status: String(r.status || "New"),
          createdAt: String(r.createdAt || ""),
        });
      }
    }
  } catch {
    // Non-blocking
  }

  try {
    const ceClient = getClassicEdgeClient();
    if (ceClient) {
      const res = await ceClient.execute({
        sql: `SELECT id, name, email, phone, message, productName, repliedAt, createdAt
              FROM Enquiry
              WHERE phone IS NOT NULL AND TRIM(phone) != ''
              ORDER BY createdAt DESC
              LIMIT ?`,
        args: [limit],
      });
      for (const r of res.rows) {
        const prod = r.productName ? String(r.productName) : "";
        combined.push({
          id: `ce_${String(r.id)}`,
          name: String(r.name || ""),
          email: String(r.email || ""),
          phone: String(r.phone || ""),
          message: prod ? `[Machine: ${prod}] ${String(r.message || "")}` : String(r.message || ""),
          source: `classicedge53.com`,
          status: r.repliedAt ? "Replied" : "New",
          createdAt: String(r.createdAt || ""),
        });
      }
    }
  } catch {
    // Non-blocking
  }

  return combined;
}

/**
 * Resolves the role-isolated Anthropic API key (`client` vs `admin`), locked to `claude-haiku-5-5`:
 * 1. Environment variables (`ANTHROPIC_CLIENT_API_KEY` / `ANTHROPIC_ADMIN_API_KEY` from `.env` / `.env.production`)
 * 2. `core_auth.db` (`setup_state` key `ai_config`)
 * 3. `classicconcepts/dev.db` (`SiteSetting`)
 * 4. `.env` / `.env.local` in `classicconcepts`
 */
export async function resolveSharedAnthropicApiKey(
  agentRole: "client" | "admin" = "client"
): Promise<{
  apiKey: string;
  source: "env" | "whatsapp_settings" | "classicconcepts_db" | "classicconcepts_env" | "none";
}> {
  resolveMonorepoRoot();

  // 1. Check process.env role-specific key first (highest priority for .env deployments)
  const roleEnvKey = (
    agentRole === "admin"
      ? process.env.ANTHROPIC_ADMIN_API_KEY || process.env.ANTHROPIC_API_KEY || ""
      : process.env.ANTHROPIC_CLIENT_API_KEY || process.env.ANTHROPIC_API_KEY || ""
  ).trim();
  if (roleEnvKey.startsWith("sk-ant-")) {
    return { apiKey: roleEnvKey, source: "env" };
  }

  // 2. Check WhatsApp setup_state
  try {
    const auth = getRawLibSqlClient("core_auth");
    const row = await auth.execute(
      `SELECT value_json FROM setup_state WHERE key = 'ai_config' LIMIT 1`
    );
    if (row.rows[0]?.value_json) {
      const parsed = JSON.parse(String(row.rows[0].value_json));
      const key = String(
        agentRole === "admin"
          ? parsed?.adminApiKey || parsed?.anthropicApiKey || ""
          : parsed?.clientApiKey || parsed?.anthropicApiKey || ""
      ).trim();
      if (key.startsWith("sk-ant-")) {
        return { apiKey: key, source: "whatsapp_settings" };
      }
    }
  } catch {
    // Table may not be initialized yet
  }

  // 3. Check classicconcepts SiteSetting table
  try {
    const ccClient = getMainCatalogClient();
    if (ccClient) {
      const sRes = await ccClient.execute(
        `SELECT anthropicApiKey, anthropicAdminApiKey, anthropicClientApiKey FROM SiteSetting LIMIT 1`
      );
      const r = sRes.rows[0];
      if (r) {
        const dbKey = String(
          agentRole === "admin"
            ? r.anthropicAdminApiKey || r.anthropicApiKey || ""
            : r.anthropicClientApiKey || r.anthropicApiKey || ""
        ).trim();
        if (dbKey.startsWith("sk-ant-")) {
          return { apiKey: dbKey, source: "classicconcepts_db" };
        }
      }
    }
  } catch {
    // Non-blocking
  }

  // 4. Check sibling classicconcepts .env files if present (Linux VPS or local dev)
  try {
    const root = resolveMonorepoRoot();
    const ccEnvPaths = [
      path.resolve(root, "..", "classicconcepts", ".env.production"),
      path.resolve(root, "..", "classicconcepts", ".env"),
      path.resolve(root, "..", "classicconcepts", ".env.local"),
      "C:/Users/DELL/Desktop/classicconcepts/.env",
      "C:/Users/DELL/Desktop/classicconcepts/.env.local",
    ];
    const targetVar =
      agentRole === "admin"
        ? /ANTHROPIC_ADMIN_API_KEY\s*=\s*["']?(sk-ant-[A-Za-z0-9_-]+)["']?/
        : /ANTHROPIC_CLIENT_API_KEY\s*=\s*["']?(sk-ant-[A-Za-z0-9_-]+)["']?/;
    const fallbackVar =
      /ANTHROPIC_API_KEY\s*=\s*["']?(sk-ant-[A-Za-z0-9_-]+)["']?/;
    for (const p of ccEnvPaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf8");
        const match = content.match(targetVar) || content.match(fallbackVar);
        if (match?.[1]) {
          return { apiKey: match[1], source: "classicconcepts_env" };
        }
      }
    }
  } catch {
    // Non-blocking
  }

  return { apiKey: "", source: "none" };
}

export async function getAcrioKeysStatus(): Promise<{
  clientConnected: boolean;
  clientSource: string;
  clientMasked: string;
  adminConnected: boolean;
  adminSource: string;
  adminMasked: string;
}> {
  const [clientInfo, adminInfo] = await Promise.all([
    resolveSharedAnthropicApiKey("client"),
    resolveSharedAnthropicApiKey("admin"),
  ]);
  const mask = (k: string) =>
    k ? `${k.slice(0, 11)}...${k.slice(-4)}` : "";
  return {
    clientConnected: Boolean(clientInfo.apiKey),
    clientSource: clientInfo.source,
    clientMasked: mask(clientInfo.apiKey),
    adminConnected: Boolean(adminInfo.apiKey),
    adminSource: adminInfo.source,
    adminMasked: mask(adminInfo.apiKey),
  };
}

export async function saveSharedAnthropicApiKey(
  apiKey: string,
  adminApiKey?: string
): Promise<void> {
  const auth = getRawLibSqlClient("core_auth");
  const cleanClient = apiKey.trim();
  const cleanAdmin = (adminApiKey || apiKey).trim();
  const now = new Date().toISOString();
  await auth.execute({
    sql: `INSERT INTO setup_state (key, value_json, updated_at)
          VALUES ('ai_config', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    args: [
      JSON.stringify({
        anthropicApiKey: cleanClient,
        clientApiKey: cleanClient,
        adminApiKey: cleanAdmin,
        model: "claude-haiku-5-5",
      }),
      now,
    ],
  });
}

/**
 * Hot atomic LibSQL snapshot export for daily backups (including sister databases when present).
 */
export async function snapshotAllDatabasesToFolder(
  targetFolder: string,
  includeMainWebsiteDb = true
): Promise<{ files: { domain: string; filePath: string; sizeBytes: number }[]; totalBytes: number }> {
  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }

  const files: { domain: string; filePath: string; sizeBytes: number }[] = [];
  let totalBytes = 0;

  for (const domain of Object.keys(DATABASE_FILES) as DatabaseDomain[]) {
    const client = getRawLibSqlClient(domain);
    const outFile = path.join(targetFolder, DATABASE_FILES[domain]);
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
    const escapedPath = outFile.replace(/\\/g, "/").replace(/'/g, "''");
    await client.execute(`VACUUM INTO '${escapedPath}'`);
    const stat = fs.statSync(outFile);
    files.push({ domain, filePath: outFile, sizeBytes: stat.size });
    totalBytes += stat.size;
  }

  if (includeMainWebsiteDb) {
    const mainDbPath = resolveMainWebsiteDbPath();
    if (mainDbPath && fs.existsSync(mainDbPath)) {
      const mainClient = getMainCatalogClient();
      const outMain = path.join(targetFolder, "classicconcepts_website.db");
      if (fs.existsSync(outMain)) fs.unlinkSync(outMain);
      if (mainClient) {
        const escapedMain = outMain.replace(/\\/g, "/").replace(/'/g, "''");
        await mainClient.execute(`VACUUM INTO '${escapedMain}'`);
      } else {
        fs.copyFileSync(mainDbPath, outMain);
      }
      const stat = fs.statSync(outMain);
      files.push({
        domain: "classicconcepts_website",
        filePath: outMain,
        sizeBytes: stat.size,
      });
      totalBytes += stat.size;
    }

    const edgeDbPath = resolveClassicEdgeDbPath();
    if (edgeDbPath && fs.existsSync(edgeDbPath)) {
      const edgeClient = getClassicEdgeClient();
      const outEdge = path.join(targetFolder, "classicedge53_machines.db");
      if (fs.existsSync(outEdge)) fs.unlinkSync(outEdge);
      if (edgeClient) {
        const escapedEdge = outEdge.replace(/\\/g, "/").replace(/'/g, "''");
        await edgeClient.execute(`VACUUM INTO '${escapedEdge}'`);
      } else {
        fs.copyFileSync(edgeDbPath, outEdge);
      }
      const stat = fs.statSync(outEdge);
      files.push({
        domain: "classicedge53_machines",
        filePath: outEdge,
        sizeBytes: stat.size,
      });
      totalBytes += stat.size;
    }
  }

  return { files, totalBytes };
}

export async function getMultiDatabaseDiagnostics(): Promise<
  {
    domain: DatabaseDomain;
    fileName: string;
    description: string;
    sizeBytes: number;
    tablesCount: number;
    totalRows: number;
  }[]
> {
  const results = [];
  for (const domain of Object.keys(DATABASE_FILES) as DatabaseDomain[]) {
    const filePath = getDatabaseFilePath(domain);
    const client = getRawLibSqlClient(domain);
    const sizeBytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;

    const tblRes = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    );
    let totalRows = 0;
    for (const row of tblRes.rows) {
      const tblName = String(row.name);
      const cntRes = await client.execute(`SELECT COUNT(*) as cnt FROM "${tblName}"`);
      totalRows += Number(cntRes.rows[0]?.cnt ?? 0);
    }

    results.push({
      domain,
      fileName: DATABASE_FILES[domain],
      description: DATABASE_DESCRIPTIONS[domain],
      sizeBytes,
      tablesCount: tblRes.rows.length,
      totalRows,
    });
  }
  return results;
}

const FALLBACK_CLASSIC_CATALOG: MainWebsiteProduct[] = [
  {
    id: "cat_podium_053",
    brand: "CLASSIC_CONCEPTS",
    brandLabel: "Classic Concepts",
    itemType: "PRODUCT",
    name: "Full Clear Auditorium Acrylic Podium CCP-053",
    slug: "acrylic-podium-ccp053",
    sku: "CCP-053",
    categoryName: "Acrylic Podiums",
    basePrice: 24500,
    mainImage: null,
    url: "https://classicconcepts.in/shop/p/acrylic-podium-ccp053",
  },
  {
    id: "cat_tstand_a4",
    brand: "CLASSIC_CONCEPTS",
    brandLabel: "Classic Concepts",
    itemType: "PRODUCT",
    name: "Crystal Clear A4 Table Menu & Sign Stand",
    slug: "a4-t-stand-1",
    sku: "CC-TS-A4",
    categoryName: "Signage & Holders",
    basePrice: 450,
    mainImage: null,
    url: "https://classicconcepts.in/shop/p/a4-t-stand-1",
  },
  {
    id: "cat_memento_01",
    brand: "CLASSIC_CONCEPTS",
    brandLabel: "Classic Concepts",
    itemType: "PRODUCT",
    name: "Acrylic Flame Excellence Memento & Trophy",
    slug: "acrylic-ganesha-flame-memento",
    sku: "CC-AWD-01",
    categoryName: "Awards & Mementos",
    basePrice: 1250,
    mainImage: null,
    url: "https://classicconcepts.in/shop/p/acrylic-ganesha-flame-memento",
  },
];

const FALLBACK_CLASSIC_EDGE_MACHINES: MainWebsiteProduct[] = [
  {
    id: "diamond-edge-polisher",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "MACHINE",
    name: "Acrylic Diamond Edge Polishing Machine",
    slug: "diamond-edge-polisher",
    sku: "YN-JW1200 / YN-JW1600",
    categoryName: "Acrylic Machine (Classic Edge 53)",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/products",
    modelsSummary: "YN-JW1200, YN-JW1600",
    specsSummary: "Mirror finish on thick cast acrylic sheets",
  },
  {
    id: "acrylic-heat-bender",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "MACHINE",
    name: "Acrylic Sheet Line Bending & Heating Machine",
    slug: "acrylic-heat-bender",
    sku: "CE-ABM-1250",
    categoryName: "Acrylic Machine (Classic Edge 53)",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/products",
  },
];
