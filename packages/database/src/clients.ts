import crypto from "node:crypto";
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

export type OrderBrand = "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";

export type ShipmentStatus =
  | "ORDER_CONFIRMED"
  | "IN_PRODUCTION"
  | "READY_FOR_DISPATCH"
  | "DISPATCHED"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED";

export interface OrderTrackingRecord {
  id: string;
  orderId: string;
  lookupKey: string;
  brand: OrderBrand;
  brandLabel: string;
  customerName: string;
  customerPhone: string;
  conversationId: string | null;
  itemsSummary: string;
  providerCode: string;
  providerName: string;
  awbNumber: string;
  providerTrackingUrl: string;
  publicTrackingUrl: string;
  shipmentStatus: ShipmentStatus;
  estimatedDelivery: string;
  notes: string;
  lookupsCount: number;
  lastLookedUpAt: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export const SHIPPING_PROVIDERS: ReadonlyArray<{
  code: string;
  name: string;
  urlTemplate: string;
}> = [
  {
    code: "DELHIVERY",
    name: "Delhivery",
    urlTemplate: "https://www.delhivery.com/track/package/{awb}",
  },
  {
    code: "BLUEDART",
    name: "Blue Dart",
    urlTemplate: "https://www.bluedart.com/tracking?trackFor=0&trackNo={awb}",
  },
  {
    code: "SAFEEXPRESS",
    name: "Safexpress",
    urlTemplate: "https://www.safexpress.com/track?waybill={awb}",
  },
  {
    code: "DTDC",
    name: "DTDC",
    urlTemplate: "https://www.dtdc.in/trace.asp?strCnno={awb}",
  },
  {
    code: "VRL",
    name: "VRL Logistics",
    urlTemplate: "https://www.vrlgroup.in/track_consignment.aspx?lrno={awb}",
  },
  {
    code: "TCIEXPRESS",
    name: "TCI Express",
    urlTemplate: "https://www.tciexpress.in/trackingdocket.asp?docketno={awb}",
  },
  {
    code: "GATI",
    name: "Gati KWE",
    urlTemplate: "https://www.gati.com/track-by-docket/?dktno={awb}",
  },
  {
    code: "TRACKON",
    name: "Trackon",
    urlTemplate: "https://trackon.in/Tracking/TrackConsignment?awb={awb}",
  },
  {
    code: "SHIPROCKET",
    name: "Shiprocket",
    urlTemplate: "https://shiprocket.co/tracking/{awb}",
  },
  {
    code: "DHL",
    name: "DHL Express",
    urlTemplate: "https://www.dhl.com/in-en/home/tracking.html?tracking-id={awb}",
  },
  {
    code: "FEDEX",
    name: "FedEx",
    urlTemplate: "https://www.fedex.com/fedextrack/?trknbr={awb}",
  },
  {
    code: "INDIAPOST",
    name: "India Post",
    urlTemplate:
      "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx",
  },
  {
    code: "PORTER",
    name: "Porter / Local Tempo",
    urlTemplate: "",
  },
  {
    code: "CUSTOM",
    name: "Other Courier / Direct Link",
    urlTemplate: "",
  },
];

export function normalizeOrderLookupKey(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripOrderAlnum(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function sanitizeOrderDisplayId(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "");
}

export function inferOrderBrand(
  orderId: string,
  explicitBrand?: string | null,
  itemsHint?: string | null
): OrderBrand {
  if (explicitBrand === "CLASSIC_EDGE_53") return "CLASSIC_EDGE_53";
  if (explicitBrand === "CLASSIC_CONCEPTS") return "CLASSIC_CONCEPTS";
  const combined = `${orderId} ${itemsHint || ""}`.toUpperCase();
  if (/^(CE53|CE-|YN-)|CLASSIC\s*EDGE|POLISHER|BENDER|MACHINE/.test(combined)) {
    return "CLASSIC_EDGE_53";
  }
  return "CLASSIC_CONCEPTS";
}

export function buildProviderTrackingUrl(
  providerCode: string,
  awbNumber: string,
  explicitProviderUrl?: string | null
): { providerCode: string; providerName: string; providerTrackingUrl: string } {
  const code = String(providerCode || "DELHIVERY").trim().toUpperCase();
  const matched = SHIPPING_PROVIDERS.find((p) => p.code === code);
  const providerName = matched ? matched.name : code === "CUSTOM" ? "Courier Partner" : code;
  const cleanCustom = String(explicitProviderUrl || "").trim();
  if (/^https?:\/\//i.test(cleanCustom)) {
    return {
      providerCode: matched ? matched.code : "CUSTOM",
      providerName,
      providerTrackingUrl: cleanCustom,
    };
  }
  const cleanAwb = String(awbNumber || "").trim();
  if (matched && matched.urlTemplate) {
    if (!cleanAwb && matched.urlTemplate.includes("{awb}")) {
      return {
        providerCode: matched.code,
        providerName: matched.name,
        providerTrackingUrl: "",
      };
    }
    return {
      providerCode: matched.code,
      providerName: matched.name,
      providerTrackingUrl: matched.urlTemplate.replace(
        "{awb}",
        encodeURIComponent(cleanAwb)
      ),
    };
  }
  return {
    providerCode: matched ? matched.code : "CUSTOM",
    providerName,
    providerTrackingUrl: "",
  };
}

let trackingTableReady = false;
async function ensureOrderTrackingTableExists() {
  if (trackingTableReady) return;
  const crm = getRawLibSqlClient("crm_orders");
  await crm.execute("PRAGMA journal_mode = WAL;");
  await crm.execute("PRAGMA busy_timeout = 5000;");
  await crm.batch(
    [
      `CREATE TABLE IF NOT EXISTS order_trackings (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL UNIQUE,
        lookup_key TEXT NOT NULL UNIQUE,
        brand TEXT NOT NULL DEFAULT 'CLASSIC_CONCEPTS',
        customer_name TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        conversation_id TEXT,
        items_summary TEXT NOT NULL DEFAULT '',
        provider_code TEXT NOT NULL DEFAULT 'DELHIVERY',
        provider_name TEXT NOT NULL DEFAULT 'Delhivery',
        awb_number TEXT NOT NULL DEFAULT '',
        provider_tracking_url TEXT NOT NULL DEFAULT '',
        shipment_status TEXT NOT NULL DEFAULT 'DISPATCHED',
        estimated_delivery TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        lookups_count INTEGER NOT NULL DEFAULT 0,
        last_looked_up_at TEXT,
        created_by_name TEXT NOT NULL DEFAULT 'System',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_order_trackings_lookup ON order_trackings (lookup_key)`,
      `CREATE INDEX IF NOT EXISTS idx_order_trackings_phone ON order_trackings (customer_phone)`,
      `CREATE INDEX IF NOT EXISTS idx_order_trackings_updated ON order_trackings (updated_at DESC)`,
    ],
    "write"
  );
  trackingTableReady = true;
}

function mapOrderTrackingRow(row: Record<string, unknown>): OrderTrackingRecord {
  const origin = resolvePublicTrackingOrigin();
  const orderId = String(row.order_id || "");
  const brand =
    String(row.brand || "") === "CLASSIC_EDGE_53"
      ? "CLASSIC_EDGE_53"
      : "CLASSIC_CONCEPTS";
  return {
    id: String(row.id),
    orderId,
    lookupKey: String(row.lookup_key || normalizeOrderLookupKey(orderId)),
    brand,
    brandLabel: brand === "CLASSIC_EDGE_53" ? "Classic Edge 53" : "Classic Concepts",
    customerName: String(row.customer_name || ""),
    customerPhone: String(row.customer_phone || ""),
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    itemsSummary: String(row.items_summary || ""),
    providerCode: String(row.provider_code || "DELHIVERY"),
    providerName: String(row.provider_name || "Courier Partner"),
    awbNumber: String(row.awb_number || ""),
    providerTrackingUrl: String(row.provider_tracking_url || ""),
    publicTrackingUrl: `${origin}/${encodeURIComponent(orderId)}`,
    shipmentStatus: (String(row.shipment_status || "DISPATCHED") as ShipmentStatus),
    estimatedDelivery: String(row.estimated_delivery || ""),
    notes: String(row.notes || ""),
    lookupsCount: Number(row.lookups_count ?? 0),
    lastLookedUpAt: row.last_looked_up_at ? String(row.last_looked_up_at) : null,
    createdByName: String(row.created_by_name || "System"),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

export async function listOrderTrackings(filters?: {
  brand?: string;
  customerPhone?: string;
  query?: string;
  limit?: number;
}): Promise<OrderTrackingRecord[]> {
  await ensureOrderTrackingTableExists();
  const crm = getRawLibSqlClient("crm_orders");
  const where: string[] = [];
  const args: (string | number)[] = [];

  if (filters?.brand && filters.brand !== "ALL") {
    where.push("brand = ?");
    args.push(filters.brand);
  }
  if (filters?.customerPhone) {
    where.push("customer_phone = ?");
    args.push(filters.customerPhone.trim());
  }
  if (filters?.query?.trim()) {
    const q = `%${filters.query.trim().toLowerCase()}%`;
    where.push(
      "(LOWER(order_id) LIKE ? OR LOWER(customer_name) LIKE ? OR LOWER(customer_phone) LIKE ? OR LOWER(awb_number) LIKE ? OR LOWER(provider_name) LIKE ? OR LOWER(items_summary) LIKE ?)"
    );
    args.push(q, q, q, q, q, q);
  }

  const limit = Math.min(500, Math.max(1, filters?.limit ?? 200));
  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const res = await crm.execute({
    sql: `SELECT * FROM order_trackings ${whereClause} ORDER BY updated_at DESC LIMIT ${limit}`,
    args,
  });
  return res.rows.map((r) => mapOrderTrackingRow(r as Record<string, unknown>));
}

export async function upsertOrderTracking(params: {
  orderId: string;
  brand?: string;
  customerName?: string;
  customerPhone?: string;
  conversationId?: string | null;
  itemsSummary?: string;
  providerCode?: string;
  providerName?: string;
  awbNumber?: string;
  providerTrackingUrl?: string;
  shipmentStatus?: ShipmentStatus;
  estimatedDelivery?: string;
  notes?: string;
  createdByName?: string;
}): Promise<{ ok: boolean; tracking?: OrderTrackingRecord; error?: string }> {
  await ensureOrderTrackingTableExists();
  const crm = getRawLibSqlClient("crm_orders");

  const cleanOrderId = sanitizeOrderDisplayId(params.orderId);
  const lookupKey = normalizeOrderLookupKey(cleanOrderId);
  if (!cleanOrderId || !lookupKey) {
    return {
      ok: false,
      error: "Please enter a valid Order ID (for example CC-2026-1089 or CE53-2026-401).",
    };
  }

  const brand = inferOrderBrand(cleanOrderId, params.brand, params.itemsSummary);
  const resolvedProvider = buildProviderTrackingUrl(
    params.providerCode || "DELHIVERY",
    params.awbNumber || "",
    params.providerTrackingUrl
  );
  const finalProviderName =
    params.providerName?.trim() || resolvedProvider.providerName;

  const existingRes = await crm.execute({
    sql: `SELECT * FROM order_trackings WHERE lookup_key = ? LIMIT 1`,
    args: [lookupKey],
  });
  const nowIso = new Date().toISOString();

  if (existingRes.rows[0]) {
    const prev = existingRes.rows[0] as Record<string, unknown>;
    const id = String(prev.id);
    await crm.execute({
      sql: `UPDATE order_trackings
            SET order_id = ?,
                brand = ?,
                customer_name = ?,
                customer_phone = ?,
                conversation_id = COALESCE(?, conversation_id),
                items_summary = ?,
                provider_code = ?,
                provider_name = ?,
                awb_number = ?,
                provider_tracking_url = ?,
                shipment_status = ?,
                estimated_delivery = ?,
                notes = ?,
                updated_at = ?
            WHERE id = ?`,
      args: [
        cleanOrderId,
        brand,
        params.customerName !== undefined
          ? params.customerName.trim()
          : String(prev.customer_name || ""),
        params.customerPhone !== undefined
          ? params.customerPhone.trim()
          : String(prev.customer_phone || ""),
        params.conversationId || null,
        params.itemsSummary !== undefined
          ? params.itemsSummary.trim()
          : String(prev.items_summary || ""),
        resolvedProvider.providerCode,
        finalProviderName,
        params.awbNumber !== undefined
          ? params.awbNumber.trim()
          : String(prev.awb_number || ""),
        resolvedProvider.providerTrackingUrl,
        params.shipmentStatus ||
          (String(prev.shipment_status || "DISPATCHED") as ShipmentStatus),
        params.estimatedDelivery !== undefined
          ? params.estimatedDelivery.trim()
          : String(prev.estimated_delivery || ""),
        params.notes !== undefined
          ? params.notes.trim()
          : String(prev.notes || ""),
        nowIso,
        id,
      ],
    });
  } else {
    const id = `trk_${Math.random().toString(36).slice(2, 10)}`;
    await crm.execute({
      sql: `INSERT INTO order_trackings (
        id, order_id, lookup_key, brand, customer_name, customer_phone, conversation_id,
        items_summary, provider_code, provider_name, awb_number, provider_tracking_url,
        shipment_status, estimated_delivery, notes, lookups_count, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      args: [
        id,
        cleanOrderId,
        lookupKey,
        brand,
        (params.customerName || "").trim(),
        (params.customerPhone || "").trim(),
        params.conversationId || null,
        (params.itemsSummary || "").trim(),
        resolvedProvider.providerCode,
        finalProviderName,
        (params.awbNumber || "").trim(),
        resolvedProvider.providerTrackingUrl,
        params.shipmentStatus || "DISPATCHED",
        (params.estimatedDelivery || "").trim(),
        (params.notes || "").trim(),
        (params.createdByName || "Staff").trim(),
        nowIso,
        nowIso,
      ],
    });
  }

  // Also sync fulfillment_status onto customer_orders if matching order_number exists
  const mappedFulfillment =
    params.shipmentStatus === "DELIVERED"
      ? "DELIVERED"
      : params.shipmentStatus === "IN_PRODUCTION" ||
        params.shipmentStatus === "ORDER_CONFIRMED"
      ? "IN_PRODUCTION"
      : "DISPATCHED";
  await crm
    .execute({
      sql: `UPDATE customer_orders SET fulfillment_status = ? WHERE LOWER(order_number) = ?`,
      args: [mappedFulfillment, cleanOrderId.toLowerCase()],
    })
    .catch(() => {});

  const finalRes = await crm.execute({
    sql: `SELECT * FROM order_trackings WHERE lookup_key = ? LIMIT 1`,
    args: [lookupKey],
  });
  return {
    ok: true,
    tracking: finalRes.rows[0]
      ? mapOrderTrackingRow(finalRes.rows[0] as Record<string, unknown>)
      : undefined,
  };
}

export async function deleteOrderTracking(idOrKey: string): Promise<boolean> {
  await ensureOrderTrackingTableExists();
  const crm = getRawLibSqlClient("crm_orders");
  const clean = idOrKey.trim();
  const res = await crm.execute({
    sql: `DELETE FROM order_trackings WHERE id = ? OR lookup_key = ?`,
    args: [clean, normalizeOrderLookupKey(clean)],
  });
  return Number(res.rowsAffected ?? 0) > 0;
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

export interface EcosystemBridgeStatus {
  classicEdge3002: {
    online: boolean;
    url: string;
    latencyMs: number;
    dbFallbackAvailable: boolean;
    smtpConfigured?: boolean;
  };
  classicConcepts3003: {
    online: boolean;
    url: string;
    latencyMs: number;
    dbFallbackAvailable: boolean;
    smtpConfigured?: boolean;
  };
  whatsapp3007: {
    online: boolean;
    port: number;
  };
  checkedAt: string;
}

export async function checkEcosystemBridgesHealth(): Promise<EcosystemBridgeStatus> {
  const key = resolveEcosystemBridgeKey();
  const ceUrl = resolveClassicEdgeInternalUrl();
  const ccUrl = resolveClassicConceptsInternalUrl();

  const probe = async (baseUrl: string) => {
    const t0 = Date.now();
    try {
      const res = await fetch(`${baseUrl}/api/internal/bridge?action=health`, {
        headers: { "x-cc-bridge-key": key },
        signal: AbortSignal.timeout(2200),
      });
      if (!res.ok) {
        return { online: false, latencyMs: Date.now() - t0, smtpConfigured: false };
      }
      const data: any = await res.json().catch(() => ({}));
      return {
        online: Boolean(data?.ok),
        latencyMs: Date.now() - t0,
        smtpConfigured: Boolean(data?.smtpConfigured),
      };
    } catch {
      return { online: false, latencyMs: Date.now() - t0, smtpConfigured: false };
    }
  };

  const [ceProbe, ccProbe] = await Promise.all([probe(ceUrl), probe(ccUrl)]);

  return {
    classicEdge3002: {
      online: ceProbe.online,
      url: ceUrl,
      latencyMs: ceProbe.latencyMs,
      dbFallbackAvailable: Boolean(resolveClassicEdgeDbPath()),
      smtpConfigured: ceProbe.smtpConfigured,
    },
    classicConcepts3003: {
      online: ccProbe.online,
      url: ccUrl,
      latencyMs: ccProbe.latencyMs,
      dbFallbackAvailable: Boolean(resolveMainWebsiteDbPath()),
      smtpConfigured: ccProbe.smtpConfigured,
    },
    whatsapp3007: {
      online: true,
      port: Number(process.env.PORT || 3007),
    },
    checkedAt: new Date().toISOString(),
  };
}

function mapWebsiteBridgeStatusToShipment(raw: string): ShipmentStatus {
  const s = String(raw || "").trim().toUpperCase();
  if (/DELIVER|COMPLETE/.test(s)) return "DELIVERED";
  if (/OUT_FOR_DELIVERY/.test(s)) return "OUT_FOR_DELIVERY";
  if (/IN_TRANSIT/.test(s)) return "IN_TRANSIT";
  if (/DISPATCH|SHIP/.test(s)) return "DISPATCHED";
  if (/READY/.test(s)) return "READY_FOR_DISPATCH";
  if (/PROCESS|PRODUCTION|PAID/.test(s)) return "IN_PRODUCTION";
  return "ORDER_CONFIRMED";
}

async function fetchWebsiteBridgeOrders(params: {
  orderId?: string;
  phone?: string;
  email?: string;
}): Promise<OrderTrackingRecord[]> {
  const key = resolveEcosystemBridgeKey();
  const qs = new URLSearchParams({ action: "orders" });
  if (params.orderId) qs.set("orderId", params.orderId);
  if (params.phone) qs.set("phone", params.phone);
  if (params.email) qs.set("email", params.email);

  const endpoints = [
    { url: resolveClassicConceptsInternalUrl(), defaultBrand: "CLASSIC_CONCEPTS" as const },
    { url: resolveClassicEdgeInternalUrl(), defaultBrand: "CLASSIC_EDGE_53" as const },
  ];

  const found: OrderTrackingRecord[] = [];

  await Promise.all(
    endpoints.map(async (ep) => {
      try {
        const res = await fetch(`${ep.url}/api/internal/bridge?${qs.toString()}`, {
          headers: { "x-cc-bridge-key": key },
          signal: AbortSignal.timeout(2500),
        });
        if (!res.ok) return;
        const json: any = await res.json().catch(() => ({}));
        const orders: any[] = Array.isArray(json?.orders) ? json.orders : [];
        for (const o of orders) {
          const displayOrderId = sanitizeOrderDisplayId(
            String(o.orderNumber || o.orderId || o.id || "")
          );
          if (!displayOrderId) continue;
          const shipmentStatus = mapWebsiteBridgeStatusToShipment(
            String(o.shipmentStatus || o.status || "ORDER_CONFIRMED")
          );
          const upserted = await upsertOrderTracking({
            orderId: displayOrderId,
            brand: o.brand || ep.defaultBrand,
            customerName: String(o.customerName || o.name || ""),
            customerPhone: normalizeWhatsAppPhone(String(o.customerPhone || o.phone || "")) || String(o.customerPhone || o.phone || ""),
            itemsSummary: String(o.itemsSummary || "Website Order"),
            providerCode: String(o.providerCode || "WORKSHOP"),
            providerName: String(
              o.providerName ||
                (ep.defaultBrand === "CLASSIC_EDGE_53"
                  ? "Classic Edge 53 Dispatch"
                  : "Classic Concepts Dispatch")
            ),
            awbNumber: String(o.awbNumber || ""),
            providerTrackingUrl: String(o.providerTrackingUrl || ""),
            shipmentStatus,
            createdByName:
              ep.defaultBrand === "CLASSIC_EDGE_53"
                ? "Classic Edge 53 (:3002)"
                : "Classic Concepts (:3003)",
          });
          if (upserted.ok && upserted.tracking) {
            found.push(upserted.tracking);
          }
        }
      } catch {
        // Non-blocking: falls back to local SQLite below
      }
    })
  );

  return found;
}

export async function lookupOrderTracking(params: {
  orderInput: string;
  preferredBrand?: string;
  incrementCounter?: boolean;
}): Promise<OrderTrackingRecord | null> {
  await ensureOrderTrackingTableExists();
  const crm = getRawLibSqlClient("crm_orders");

  let decoded = String(params.orderInput || "").trim();
  try {
    decoded = decodeURIComponent(decoded).trim();
  } catch {
    // Keep raw
  }
  const lookupKey = normalizeOrderLookupKey(decoded);
  const alnumKey = stripOrderAlnum(decoded);
  if (!lookupKey && !alnumKey) return null;

  // 1. Check dedicated dynamic order_trackings table first
  const exactRes = await crm.execute({
    sql: `SELECT * FROM order_trackings WHERE lookup_key = ? OR LOWER(awb_number) = ? LIMIT 5`,
    args: [lookupKey, decoded.toLowerCase()],
  });

  let matchedRow = exactRes.rows[0] as Record<string, unknown> | undefined;
  if (!matchedRow && alnumKey.length >= 4) {
    const allRes = await crm.execute(
      `SELECT * FROM order_trackings ORDER BY updated_at DESC LIMIT 500`
    );
    matchedRow = allRes.rows.find((r) => {
      const rAlnum = stripOrderAlnum(String(r.order_id || ""));
      const rAwb = stripOrderAlnum(String(r.awb_number || ""));
      return (
        rAlnum === alnumKey ||
        `cc${rAlnum}` === alnumKey ||
        `ce53${rAlnum}` === alnumKey ||
        rAlnum === `cc${alnumKey}` ||
        rAlnum === `ce53${alnumKey}` ||
        (rAwb.length >= 5 && rAwb === alnumKey)
      );
    }) as Record<string, unknown> | undefined;
  }

  if (matchedRow) {
    if (params.incrementCounter !== false) {
      const nowIso = new Date().toISOString();
      await crm
        .execute({
          sql: `UPDATE order_trackings
                SET lookups_count = lookups_count + 1,
                    last_looked_up_at = ?
                WHERE id = ?`,
          args: [nowIso, String(matchedRow.id)],
        })
        .catch(() => {});
      matchedRow = {
        ...matchedRow,
        lookups_count: Number(matchedRow.lookups_count ?? 0) + 1,
        last_looked_up_at: nowIso,
      };
    }
    return mapOrderTrackingRow(matchedRow);
  }

  // 2. Live HTTP Bridge check across Classic Concepts (:3003) and Classic Edge 53 (:3002)
  const bridgeOrders = await fetchWebsiteBridgeOrders({ orderId: decoded });
  if (bridgeOrders.length > 0) {
    return bridgeOrders[0];
  }

  // 3. Fallback to CRM customer_orders if order exists in workshop/CRM without courier AWB yet
  const crmOrdersRes = await crm.execute(
    `SELECT o.*, c.name as customer_name
     FROM customer_orders o
     LEFT JOIN customers c ON c.id = o.customer_id
     ORDER BY o.ordered_at DESC
     LIMIT 300`
  );
  const matchedCrmOrder = crmOrdersRes.rows.find((r) => {
    const oNum = String(r.order_number || "");
    return (
      normalizeOrderLookupKey(oNum) === lookupKey ||
      stripOrderAlnum(oNum) === alnumKey ||
      String(r.id || "").toLowerCase() === decoded.toLowerCase()
    );
  }) as Record<string, unknown> | undefined;

  if (matchedCrmOrder) {
    const orderNum = String(matchedCrmOrder.order_number || decoded);
    const items = String(matchedCrmOrder.items_summary || "");
    const brand = inferOrderBrand(orderNum, params.preferredBrand, items);
    const fStatus = String(matchedCrmOrder.fulfillment_status || "IN_PRODUCTION");
    const shipmentStatus: ShipmentStatus =
      fStatus === "DELIVERED"
        ? "DELIVERED"
        : fStatus === "DISPATCHED"
        ? "DISPATCHED"
        : fStatus === "DESIGN_PENDING"
        ? "ORDER_CONFIRMED"
        : "IN_PRODUCTION";
    const maybeUrl = String(matchedCrmOrder.invoice_url || "").trim();
    const isExternalProviderUrl =
      /^https?:\/\//i.test(maybeUrl) &&
      !/classicconcepts\.in|classicedge53\.com/i.test(maybeUrl);

    const upserted = await upsertOrderTracking({
      orderId: orderNum,
      brand,
      customerName: String(matchedCrmOrder.customer_name || ""),
      customerPhone: String(matchedCrmOrder.customer_phone || ""),
      itemsSummary: items,
      providerCode: "WORKSHOP",
      providerName: isExternalProviderUrl ? "Courier Partner" : "Workshop Fulfillment",
      providerTrackingUrl: isExternalProviderUrl ? maybeUrl : "",
      shipmentStatus,
      createdByName: "CRM Sync",
    });
    if (upserted.ok && upserted.tracking) {
      return upserted.tracking;
    }
  }

  // 4. Fallback to Classic Concepts website CartOrder table (dev.db) if present
  const siteClient = getMainCatalogClient();
  if (siteClient) {
    try {
      const cartRes = await siteClient.execute(
        `SELECT id, name, phone, status, createdAt FROM CartOrder ORDER BY createdAt DESC LIMIT 200`
      );
      const foundCart = cartRes.rows.find((r: Record<string, unknown>) => {
        const cid = String(r.id || "");
        const short6 = cid.slice(-6).toLowerCase();
        return (
          cid.toLowerCase() === decoded.toLowerCase() ||
          short6 === alnumKey ||
          `cc${short6}` === alnumKey
        );
      });
      if (foundCart) {
        const cid = String(foundCart.id);
        const itemsRes = await siteClient
          .execute({
            sql: `SELECT productName, quantity FROM CartOrderItem WHERE orderId = ?`,
            args: [cid],
          })
          .catch(() => ({ rows: [] as Record<string, unknown>[] }));
        const summary = itemsRes.rows
          .map(
            (it: Record<string, unknown>) =>
              `${Number(it.quantity ?? 1)}x ${String(it.productName || "Item")}`
          )
          .join(", ");
        const st = String(foundCart.status || "Pending");
        const shipmentStatus = mapWebsiteBridgeStatusToShipment(st);
        const displayId = `CC-${cid.slice(-6).toUpperCase()}`;
        const upserted = await upsertOrderTracking({
          orderId: displayId,
          brand: "CLASSIC_CONCEPTS",
          customerName: String(foundCart.name || ""),
          customerPhone: normalizeWhatsAppPhone(String(foundCart.phone || "")) || String(foundCart.phone || ""),
          itemsSummary: summary || "Classic Concepts Website Order",
          providerCode: "WORKSHOP",
          providerName: "Classic Concepts Dispatch",
          shipmentStatus,
          createdByName: "Classic Concepts DB",
        });
        if (upserted.ok && upserted.tracking) {
          return upserted.tracking;
        }
      }
    } catch {
      // Ignore if CartOrder table doesn't exist
    }
  }

  // 5. Fallback to Classic Edge 53 website Order table (dev.db) if present
  const ceClient = getClassicEdgeClient();
  if (ceClient) {
    try {
      const ceOrdersRes = await ceClient.execute(
        `SELECT id, customerName, customerPhone, status, items, createdAt FROM "Order" ORDER BY createdAt DESC LIMIT 200`
      );
      const foundCe = ceOrdersRes.rows.find((r: Record<string, unknown>) => {
        const cid = String(r.id || "");
        const short6 = cid.slice(-6).toLowerCase();
        return (
          cid.toLowerCase() === decoded.toLowerCase() ||
          short6 === alnumKey ||
          `ce53${short6}` === alnumKey ||
          `ce${short6}` === alnumKey
        );
      });
      if (foundCe) {
        const cid = String(foundCe.id);
        let summary = "Classic Edge 53 Machine / Consumable Order";
        try {
          const parsedItems = JSON.parse(String(foundCe.items || "[]"));
          if (Array.isArray(parsedItems) && parsedItems.length > 0) {
            summary = parsedItems
              .map((it: any) => `${Number(it.quantity || 1)}x ${String(it.name || it.productName || "Item")}`)
              .join(", ");
          }
        } catch {
          // Keep default summary
        }
        const displayId = `CE53-${cid.slice(-6).toUpperCase()}`;
        const upserted = await upsertOrderTracking({
          orderId: displayId,
          brand: "CLASSIC_EDGE_53",
          customerName: String(foundCe.customerName || ""),
          customerPhone: normalizeWhatsAppPhone(String(foundCe.customerPhone || "")) || String(foundCe.customerPhone || ""),
          itemsSummary: summary,
          providerCode: "WORKSHOP",
          providerName: "Classic Edge 53 Dispatch",
          shipmentStatus: mapWebsiteBridgeStatusToShipment(String(foundCe.status || "Pending")),
          createdByName: "Classic Edge 53 DB",
        });
        if (upserted.ok && upserted.tracking) {
          return upserted.tracking;
        }
      }
    } catch {
      // Ignore if Order table doesn't exist
    }
  }

  return null;
}

export async function lookupCustomerOrdersAcrossEcosystem(params: {
  orderInput?: string;
  customerPhone?: string;
  customerEmail?: string;
}): Promise<{
  exactMatch: OrderTrackingRecord | null;
  phoneOrders: OrderTrackingRecord[];
}> {
  await ensureOrderTrackingTableExists();
  const crm = getRawLibSqlClient("crm_orders");

  let exactMatch: OrderTrackingRecord | null = null;
  if (params.orderInput?.trim()) {
    exactMatch = await lookupOrderTracking({
      orderInput: params.orderInput.trim(),
      incrementCounter: true,
    });
  }

  const last10 = String(params.customerPhone || "")
    .replace(/\D/g, "")
    .slice(-10);

  const byOrderKey = new Map<string, OrderTrackingRecord>();
  if (exactMatch) {
    byOrderKey.set(exactMatch.lookupKey, exactMatch);
  }

  if (last10.length >= 10 || params.customerEmail?.trim()) {
    // Pull live orders by phone/email across :3003 & :3002 bridges
    const bridgeFound = await fetchWebsiteBridgeOrders({
      phone: last10 || undefined,
      email: params.customerEmail?.trim() || undefined,
    });
    for (const b of bridgeFound) {
      byOrderKey.set(b.lookupKey, b);
    }

    // Pull local order_trackings matching phone last-10 digits
    if (last10.length >= 10) {
      const trkRes = await crm.execute({
        sql: `SELECT * FROM order_trackings WHERE customer_phone LIKE ? ORDER BY updated_at DESC LIMIT 8`,
        args: [`%${last10}%`],
      });
      for (const r of trkRes.rows) {
        const mapped = mapOrderTrackingRow(r as Record<string, unknown>);
        if (!byOrderKey.has(mapped.lookupKey)) {
          byOrderKey.set(mapped.lookupKey, mapped);
        }
      }

      // Also check customer_orders in crm_orders.db
      const crmRes = await crm.execute({
        sql: `SELECT o.*, c.name as customer_name
              FROM customer_orders o
              LEFT JOIN customers c ON c.id = o.customer_id
              WHERE o.customer_phone LIKE ?
              ORDER BY o.ordered_at DESC
              LIMIT 5`,
        args: [`%${last10}%`],
      });
      for (const r of crmRes.rows) {
        const orderNum = String(r.order_number || "");
        const key = normalizeOrderLookupKey(orderNum);
        if (key && !byOrderKey.has(key)) {
          const up = await upsertOrderTracking({
            orderId: orderNum,
            brand: inferOrderBrand(orderNum, null, String(r.items_summary || "")),
            customerName: String(r.customer_name || ""),
            customerPhone: String(r.customer_phone || ""),
            itemsSummary: String(r.items_summary || ""),
            providerCode: "WORKSHOP",
            providerName: "Workshop Fulfillment",
            shipmentStatus: mapWebsiteBridgeStatusToShipment(String(r.fulfillment_status || "IN_PRODUCTION")),
            createdByName: "CRM Sync",
          });
          if (up.ok && up.tracking) {
            byOrderKey.set(up.tracking.lookupKey, up.tracking);
          }
        }
      }
    }
  }

  return {
    exactMatch,
    phoneOrders: Array.from(byOrderKey.values()).slice(0, 6),
  };
}

const SHORT_OUTER_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const SHORT_INNER_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789-@+$=";

/**
 * Generates an exact 6-character URL-safe short ID for `https://ccapl.cc/<6-char-id>`.
 * Outer characters (index 0 & 5) are alphanumeric so WhatsApp/iOS/Android link auto-detection
 * never trims trailing punctuation, while inner characters include numbers + URL special chars.
 */
export function generateSixCharShortCode(seed?: string, salt = 0): string {
  const bytes = seed
    ? crypto.createHash("sha256").update(`${seed}#${salt}`).digest()
    : crypto.randomBytes(8);
  const c0 = SHORT_OUTER_ALPHABET[bytes[0] % SHORT_OUTER_ALPHABET.length];
  const c1 = SHORT_INNER_ALPHABET[bytes[1] % SHORT_INNER_ALPHABET.length];
  const c2 = SHORT_INNER_ALPHABET[bytes[2] % SHORT_INNER_ALPHABET.length];
  const c3 = SHORT_INNER_ALPHABET[bytes[3] % SHORT_INNER_ALPHABET.length];
  const c4 = SHORT_INNER_ALPHABET[bytes[4] % SHORT_INNER_ALPHABET.length];
  const c5 = SHORT_OUTER_ALPHABET[bytes[5] % SHORT_OUTER_ALPHABET.length];
  return `${c0}${c1}${c2}${c3}${c4}${c5}`;
}

/**
 * Cleans verbose/scraped SEO product titles so AI & WhatsApp lists show crisp, human-readable names
 * (strips `| ...` SEO tails, scraped questions like "Do you like this...?", and verbose comma tails).
 */
export function cleanDisplayProductName(raw: string): string {
  let text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Acrylic Product";

  // Strip pipe-separated SEO suffixes e.g. "| Custom Cut Sizes Available..."
  text = text.split("|")[0].trim();

  // Strip scraped conversational tails or stray questions e.g. "Do you like this personality?"
  text = text
    .replace(/\b(?:do you like|would you like|what do you think)[^?]*\??/gi, "")
    .replace(/\s*\?+$/, "")
    .trim();

  // Strip em-dashes / double-hyphens suffixes if verbose
  if (text.length > 52 && /\s[—–-]\s/.test(text)) {
    text = text.split(/\s[—–-]\s/)[0].trim();
  }

  // If comma-stuffed SEO title ("Premium Multi-Purpose Acrylic Sheets, Clear & Coloured Acrylic Panels"), keep the primary name
  if (text.includes(",")) {
    const firstPart = text.split(",")[0].trim();
    if (firstPart.length >= 14) {
      text = firstPart;
    }
  }

  // Hard cap at 64 chars on word boundary
  if (text.length > 64) {
    text = text.slice(0, 62).replace(/\s+\S*$/, "").trim();
  }

  return text || "Acrylic Product";
}

function buildPreferredProductShortCode(item: MainWebsiteProduct, salt = 0): string {
  const brandPrefix = item.brand === "CLASSIC_EDGE_53" ? "ce53" : "cc";
  const seed = `${brandPrefix}:${item.itemType.toLowerCase()}:${item.slug || item.id}`;
  return generateSixCharShortCode(seed, salt);
}

/**
 * Rewrites any localhost / 127.0.0.1 / 0.0.0.0 target URL (:3003 or :3002)
 * to its canonical production domain (`https://classicconcepts.in` or `https://classicedge53.com`).
 */
export function normalizePublicEcosystemUrl(
  rawUrl: string,
  brandHint?: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | string | null
): string {
  const clean = String(rawUrl || "").trim();
  if (!clean) return "https://classicconcepts.in/shop";

  const isEdge =
    brandHint === "CLASSIC_EDGE_53" ||
    /:3002\b/i.test(clean) ||
    /classicedge53\.com/i.test(clean) ||
    /auto_classicedge53/i.test(clean) ||
    /^\/?(?:products|consumables)\//i.test(clean.replace(/^https?:\/\/[^/]+/i, ""));

  const prodOrigin = isEdge
    ? "https://classicedge53.com"
    : "https://classicconcepts.in";

  if (clean.startsWith("/")) {
    return `${prodOrigin}${clean}`;
  }

  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(\/.*|$)/i.test(clean)) {
    return clean.replace(
      /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i,
      prodOrigin
    );
  }

  // Also upgrade www.classicconcepts.in -> classicconcepts.in for consistency if needed, or preserve valid https URLs
  return clean;
}

function appendWhatsAppShortLinkUtm(
  rawUrl: string,
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53"
): string {
  const clean = normalizePublicEcosystemUrl(rawUrl, brand);
  if (!clean || /[?&]utm_source=/i.test(clean)) return clean;
  const sep = clean.includes("?") ? "&" : "?";
  const campaign =
    brand === "CLASSIC_EDGE_53" ? "auto_classicedge53" : "auto_classicconcepts";
  return `${clean}${sep}utm_source=whatsapp&utm_medium=shortlink&utm_campaign=${campaign}`;
}

function isDummyPlaceholderRow(id: unknown, name: unknown): boolean {
  const cleanId = String(id || "").trim().toLowerCase();
  const cleanName = String(name || "").trim().toLowerCase();
  return (
    cleanId === "test" ||
    cleanName === "test" ||
    cleanName === "test product" ||
    /^test\s+product\b/i.test(cleanName)
  );
}

let shortLinkTableReady = false;
let shortLinkSyncChain: Promise<void> = Promise.resolve();

/**
 * Automatically creates or updates ultra-short 6-character links (`https://ccapl.cc/<6-char-id>`)
 * in `conversations.db -> custom_links` for every product, machine, and consumable fetched from
 * Classic Concepts (`classicconcepts.in`) and Classic Edge 53 (`classicedge53.com`),
 * upgrading any legacy long auto-slugs in-place while preserving click counts!
 */
export async function ensureEcosystemProductShortLinks(
  items: MainWebsiteProduct[]
): Promise<MainWebsiteProduct[]> {
  if (!items || items.length === 0) return items;

  const origin = resolveShortLinkDomainOrigin();
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
        const rawCode = String(row.code || "").trim();
        if (rawCode) usedCodes.add(rawCode.toLowerCase());
        const pSlug = row.product_slug ? String(row.product_slug).trim() : "";
        const rawTarget = String(row.target_url || "");
        const normalizedExistingTarget = normalizePublicEcosystemUrl(
          rawTarget,
          pSlug.startsWith("ce53:") ? "CLASSIC_EDGE_53" : undefined
        );
        if (rawTarget && normalizedExistingTarget !== rawTarget) {
          await conv.execute({
            sql: `UPDATE custom_links SET target_url = ? WHERE id = ?`,
            args: [normalizedExistingTarget, String(row.id)],
          });
        }
        if (pSlug && !byProductKey.has(pSlug)) {
          byProductKey.set(pSlug, {
            id: String(row.id),
            code: rawCode,
            title: String(row.title || ""),
            targetUrl: normalizedExistingTarget,
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
        const desiredTitle = cleanDisplayProductName(item.name);
        const desiredTargetUrl = appendWhatsAppShortLinkUtm(item.url, item.brand);

        const existing = byProductKey.get(productKey);
        if (existing) {
          let nextCode = existing.code;
          // Upgrade legacy long slugs (e.g. cc-premium-multi-purpose-ac) to exact 6-char IDs!
          if (nextCode.length !== 6) {
            usedCodes.delete(nextCode.toLowerCase());
            let salt = 0;
            let candidate = buildPreferredProductShortCode(item, salt);
            while (usedCodes.has(candidate.toLowerCase())) {
              salt++;
              candidate = buildPreferredProductShortCode(item, salt);
            }
            usedCodes.add(candidate.toLowerCase());
            nextCode = candidate;
          }

          codeByIndex.set(idx, nextCode);
          if (
            existing.code !== nextCode ||
            existing.title !== desiredTitle ||
            existing.targetUrl !== desiredTargetUrl ||
            existing.utmCampaign !== utmCampaign
          ) {
            writeStmts.push({
              sql: `UPDATE custom_links
                    SET code = ?, title = ?, target_url = ?, utm_campaign = ?
                    WHERE id = ?`,
              args: [nextCode, desiredTitle, desiredTargetUrl, utmCampaign, existing.id],
            });
            existing.code = nextCode;
            existing.title = desiredTitle;
            existing.targetUrl = desiredTargetUrl;
            existing.utmCampaign = utmCampaign;
          }
          return;
        }

        let salt = 0;
        let chosenCode = buildPreferredProductShortCode(item, salt);
        while (usedCodes.has(chosenCode.toLowerCase())) {
          salt++;
          chosenCode = buildPreferredProductShortCode(item, salt);
        }
        usedCodes.add(chosenCode.toLowerCase());
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
      // Non-blocking fallback: still attach deterministic 6-char short codes in memory
    }
  });

  shortLinkSyncChain = task.catch(() => {});
  await task;

  return items.map((item, idx) => {
    const code = codeByIndex.get(idx) || buildPreferredProductShortCode(item, 0);
    return {
      ...item,
      url: normalizePublicEcosystemUrl(item.url, item.brand),
      name: cleanDisplayProductName(item.name),
      shortCode: code,
      shortUrl: `${origin}/${code}`,
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

export interface EcosystemSpecItem {
  key?: string;
  label?: string;
  value: string;
  type?: "dimension" | "specification" | string;
}

export interface EcosystemVariantItem {
  id?: string;
  name: string;
  price: number | null;
  imageUrl?: string | null;
}

export interface EcosystemModelItem {
  id: string;
  modelName: string;
  specifications: { key?: string; label?: string; value: string }[];
  resources?: { name?: string; title?: string; type?: string; url: string }[];
  consumables?: (
    | {
        id: string;
        name: string;
        category?: string | null;
        description?: string | null;
      }
    | string
  )[];
}

export interface MainWebsiteProduct {
  images?: string[];
  features?: string[];
  dimensions?: EcosystemSpecItem[];
  specifications?: EcosystemSpecItem[];
  variants?: EcosystemVariantItem[];
  descriptionHtmlText?: string | null;
  importantNoteText?: string | null;
  searchKeywords?: string | null;
  podiumSubCategory?: string | null;
  podiumSubCategoryNames?: string[];
  regularPrice?: number | null;
  isRegisteredDesign?: boolean;
  designRegistrationNo?: string | null;
  ipProtectionText?: string | null;
  videoUrl?: string | null;
  industries?: ({ name: string; slug: string; description?: string } | string)[];
  problemStatements?: ({ name: string; slug: string; description?: string } | string)[];
  resources?: { name?: string; title?: string; type?: string; url: string }[];
  models?: EcosystemModelItem[];
  relatedConsumables?: (
    | {
        id: string;
        name: string;
        category?: string | null;
        description?: string | null;
      }
    | string
  )[];
  searchBlob?: string;
}

export function normalizeCatalogHtmlToText(
  html: string | null | undefined
): string {
  if (!html) return "";
  let text = String(html);
  text = text
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\s*\/\s*li\s*>/gi, "\n")
    .replace(/<\s*\/\s*(?:td|th)\s*>/gi, " | ")
    .replace(
      /<\s*\/\s*(?:tr|p|div|h[1-6]|ul|ol|table|blockquote|section)\s*>/gi,
      "\n"
    )
    .replace(/<[^>]+>/g, " ");

  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&times;/gi, "×")
    .replace(/&ndash;|&mdash;|[—–]/gi, "-")
    .replace(/&#8377;/gi, "₹")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : " ";
    });

  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\s*\|\s*\|\s*/g, " | ")
        .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
        .replace(/[ \t\u00A0]+/g, " ")
        .trim()
    )
    .filter((line) => line.length > 0 && line !== "•")
    .join("\n");
}

function isEcosystemDimensionSpec(spec: {
  key?: string;
  label?: string;
  value: string;
  type?: string | null;
}): boolean {
  const k = String(spec.label || spec.key || "").trim();
  const v = String(spec.value || "").trim();
  if (/^model$/i.test(k)) return false;
  if (String(spec.type || "").toLowerCase() === "dimension") return true;
  if (
    /\b(height|width|depth|length|size|top\s*sheet|bottom\s*sheet|front\s*panel|shelf\s*size|logo\s*panel|base\s*size|reading\s*top|overall\s*size|dimension|dimensions|diameter|thickness)\b/i.test(
      k
    )
  ) {
    return true;
  }
  return /\b\d+(?:\.\d+)?\s*(?:×|x|\*)\s*\d+(?:\.\d+)?\s*(?:inch|inches|in|mm|cm|ft|")\b/i.test(
    v
  );
}

function buildEcosystemItemSearchBlob(item: MainWebsiteProduct): string {
  const featStr = (item.features || []).join(" ");
  const dimStr = (item.dimensions || [])
    .map((d) => `${d.label || d.key || ""} ${d.value}`)
    .join(" ");
  const specStr = (item.specifications || [])
    .map((s) => `${s.label || s.key || ""} ${s.value}`)
    .join(" ");
  const varStr = (item.variants || [])
    .map((v) => `${v.name} ${v.price ? `₹${v.price} ${v.price}` : ""}`)
    .join(" ");
  const modelStr = (item.models || [])
    .map(
      (m) =>
        `${m.modelName} ${(m.specifications || [])
          .map((s) => `${s.label || s.key || ""} ${s.value}`)
          .join(" ")}`
    )
    .join(" ");
  const indStr = (item.industries || [])
    .map((i) => (typeof i === "string" ? i : `${i.name} ${i.description || ""}`))
    .join(" ");
  const probStr = (item.problemStatements || [])
    .map((ps) => (typeof ps === "string" ? ps : `${ps.name} ${ps.description || ""}`))
    .join(" ");
  const resStr = (item.resources || [])
    .map((r) => r.title || r.name || "")
    .join(" ");

  return [
    item.name,
    item.slug.replace(/-/g, " "),
    item.sku || "",
    item.categoryName,
    item.podiumSubCategory || "",
    item.description || "",
    item.descriptionHtmlText || "",
    item.importantNoteText || "",
    item.searchKeywords || "",
    item.modelsSummary || "",
    item.specsSummary || "",
    featStr,
    dimStr,
    specStr,
    varStr,
    modelStr,
    indStr,
    probStr,
    resStr,
    item.designRegistrationNo || "",
    item.ipProtectionText || "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Loads the complete Classic Concepts acrylic product catalog (`classicconcepts.in`)
 * via API if configured, or directly from the local SQLite database.
 */
export async function loadAllClassicConceptsProducts(): Promise<MainWebsiteProduct[]> {
  const candidateUrls = Array.from(
    new Set(
      [resolveClassicConceptsInternalUrl(), "https://www.classicconcepts.in"]
        .filter(Boolean)
        .map((u) => u.replace(/\/+$/, ""))
    )
  );
  const parseApiProducts = (productsList: any[]): MainWebsiteProduct[] =>
    productsList
      .filter((p: any) => !isDummyPlaceholderRow(p?.id, p?.name))
      .map((p: any) => {
        const allSpecs: EcosystemSpecItem[] = Array.isArray(p.specifications)
          ? p.specifications
              .map((s: any) => ({
                key: String(s.key || s.name || "").trim(),
                value: String(s.value || "").trim(),
                type: String(s.type || "specification"),
              }))
              .filter((s: EcosystemSpecItem) => Boolean(s.key && s.value))
          : [];
        const dimensions = allSpecs.filter((s) => isEcosystemDimensionSpec(s));
        const specifications = allSpecs.filter((s) => !isEcosystemDimensionSpec(s));
        const variants: EcosystemVariantItem[] = Array.isArray(p.variants)
          ? p.variants
              .map((v: any) => ({
                id: v.id ? String(v.id) : undefined,
                name: String(v.name || "").trim(),
                price:
                  typeof v.price === "number" && v.price > 0 ? v.price : null,
                imageUrl: v.imageUrl ? String(v.imageUrl) : null,
              }))
              .filter((v: EcosystemVariantItem) => Boolean(v.name))
          : [];
        const features: string[] = Array.isArray(p.features)
          ? p.features.map((f: any) => String(f || "").trim()).filter(Boolean)
          : [];
        const descriptionHtmlText =
          p.descriptionText ||
          normalizeCatalogHtmlToText(p.descriptionHtml) ||
          normalizeCatalogHtmlToText(p.description);
        const importantNoteText =
          p.importantNoteText || normalizeCatalogHtmlToText(p.importantNoteHtml);
        const normalizedSku = p.sku
          ? String(p.sku).replace(/^CCPO(\d+)/i, "CCP0$1")
          : null;

        const item: MainWebsiteProduct = {
          id: String(p.id),
          brand: "CLASSIC_CONCEPTS" as const,
          brandLabel: "Classic Concepts",
          itemType: "PRODUCT" as const,
          name: String(p.name),
          slug: String(p.slug),
          sku: normalizedSku,
          categoryName: String(p.categoryName || "Acrylic Products"),
          podiumSubCategory: p.podiumSubCategory
            ? String(p.podiumSubCategory)
            : null,
          description: p.description ? String(p.description) : null,
          descriptionHtmlText,
          importantNoteText,
          searchKeywords: p.searchKeywords ? String(p.searchKeywords) : null,
          basePrice:
            typeof p.discountPrice === "number" && p.discountPrice > 0
              ? p.discountPrice
              : typeof p.basePrice === "number" && p.basePrice > 0
              ? p.basePrice
              : null,
          regularPrice:
            typeof p.basePrice === "number" && p.basePrice > 0
              ? p.basePrice
              : null,
          mainImage: p.mainImage ? String(p.mainImage) : null,
          images: Array.isArray(p.images)
            ? p.images
                .map((u: any) =>
                  String(typeof u === "string" ? u : u?.url || "").trim()
                )
                .filter(Boolean)
            : p.mainImage
            ? [String(p.mainImage)]
            : [],
          url: String(p.url || `https://classicconcepts.in/shop/p/${p.slug}`),
          features,
          dimensions,
          specifications,
          variants,
          isRegisteredDesign: Boolean(p.isRegisteredDesign),
          designRegistrationNo: p.designRegistrationNo
            ? String(p.designRegistrationNo)
            : null,
          ipProtectionText: p.ipProtectionText
            ? String(p.ipProtectionText)
            : null,
          videoUrl: p.videoUrl ? String(p.videoUrl) : null,
          industries: Array.isArray(p.industries) ? p.industries : [],
          problemStatements: Array.isArray(p.problemStatements)
            ? p.problemStatements
            : [],
          resources: Array.isArray(p.resources) ? p.resources : [],
          specsSummary:
            allSpecs.length > 0
              ? allSpecs.map((s) => `${s.key}: ${s.value}`).join(", ")
              : null,
        };
        item.searchBlob = buildEcosystemItemSearchBlob(item);
        return item;
      });

  const primaryUrl = candidateUrls[0];
  if (primaryUrl && !primaryUrl.includes("classicconcepts.in")) {
    try {
      const res = await fetch(`${primaryUrl}/api/whatsapp-catalog`, {
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const data: any = await res.json();
        if (Array.isArray(data?.products) && data.products.length > 0) {
          const apiItems = parseApiProducts(data.products);
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

    const [
      res,
      featsRes,
      specsRes,
      varsRes,
      imgsRes,
      resLinks,
      indLinks,
      probLinks,
    ] = await Promise.all([
      client.execute({
        sql: `
          SELECT
            p.id,
            p.name,
            p.slug,
            p.sku,
            p.description,
            p.descriptionHtml,
            p.importantNoteHtml,
            p.searchKeywords,
            p.basePrice,
            p.discountPrice,
            p.isPodium,
            p.isRegisteredDesign,
            p.designRegistrationNo,
            p.ipProtectionText,
            p.videoUrl,
            c.name AS categoryName,
            sc.name AS subCategoryName,
            psc.name AS podiumSubCategoryName,
            (SELECT url FROM ProductImage pi WHERE pi.productId = p.id ORDER BY pi.isMain DESC, pi.createdAt ASC LIMIT 1) AS mainImage
          FROM Product p
          LEFT JOIN Category c ON p.categoryId = c.id
          LEFT JOIN SubCategory sc ON p.subCategoryId = sc.id
          LEFT JOIN PodiumSubCategory psc ON p.podiumSubCategoryId = psc.id
          ORDER BY p.isPodium DESC, p.updatedAt DESC
          LIMIT 300
        `,
        args: [],
      }),
      client.execute(`SELECT productId, text FROM ProductFeature`),
      client.execute(`SELECT productId, name, value, type FROM ProductSpecification`),
      client.execute(`SELECT id, productId, name, price, imageUrl FROM ProductVariant`),
      client
        .execute(
          `SELECT productId, url FROM ProductImage ORDER BY isMain DESC, createdAt ASC`
        )
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
      client
        .execute(`SELECT title, fileUrl, type FROM Resource LIMIT 30`)
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
      client
        .execute(
          `SELECT ip.B AS productId, i.name, i.slug, i.description FROM _IndustryToProduct ip JOIN Industry i ON ip.A = i.id`
        )
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
      client
        .execute(
          `SELECT pp.B AS productId, ps.name, ps.slug, ps.description FROM _ProblemStatementToProduct pp JOIN ProblemStatement ps ON pp.A = ps.id`
        )
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    ]);

    const validRows = res.rows.filter(
      (r) => !isDummyPlaceholderRow(r.id, r.name)
    );
    if (validRows.length === 0) {
      return ensureEcosystemProductShortLinks(FALLBACK_CLASSIC_CATALOG);
    }

    const featsByProd = new Map<string, string[]>();
    for (const f of featsRes.rows) {
      const pid = String(f.productId || "");
      const txt = String(f.text || "").trim();
      if (!pid || !txt) continue;
      if (!featsByProd.has(pid)) featsByProd.set(pid, []);
      featsByProd.get(pid)!.push(txt);
    }

    const specsByProd = new Map<string, EcosystemSpecItem[]>();
    for (const s of specsRes.rows) {
      const pid = String(s.productId || "");
      const key = String(s.name || "").trim();
      const value = String(s.value || "").trim();
      const type = String(s.type || "specification").trim();
      if (!pid || !key || !value) continue;
      if (!specsByProd.has(pid)) specsByProd.set(pid, []);
      specsByProd.get(pid)!.push({ key, value, type });
    }

    const varsByProd = new Map<string, EcosystemVariantItem[]>();
    for (const v of varsRes.rows) {
      const pid = String(v.productId || "");
      const name = String(v.name || "").trim();
      if (!pid || !name) continue;
      const price =
        v.price !== null && v.price !== undefined && Number(v.price) > 0
          ? Number(v.price)
          : null;
      if (!varsByProd.has(pid)) varsByProd.set(pid, []);
      varsByProd.get(pid)!.push({
        id: String(v.id || ""),
        name,
        price,
        imageUrl: v.imageUrl ? String(v.imageUrl) : null,
      });
    }

    const imgsByProd = new Map<string, string[]>();
    for (const img of imgsRes.rows) {
      const pid = String(img.productId || "");
      const url = String(img.url || "").trim();
      if (!pid || !url) continue;
      if (!imgsByProd.has(pid)) imgsByProd.set(pid, []);
      if (!imgsByProd.get(pid)!.includes(url)) {
        imgsByProd.get(pid)!.push(url);
      }
    }

    const globalResourcesList: { name: string; url: string }[] = [];
    for (const r of resLinks.rows) {
      const name = String(r.title || r.name || "").trim();
      const url = String(r.fileUrl || r.url || "").trim();
      if (!name || !url) continue;
      globalResourcesList.push({ name, url });
    }
    const resByProd = new Map<string, { name: string; url: string }[]>();

    const indByProd = new Map<
      string,
      { name: string; slug: string; description?: string }[]
    >();
    for (const i of indLinks.rows) {
      const pid = String(i.productId || "");
      const name = String(i.name || "").trim();
      if (!pid || isDummyPlaceholderRow(i.slug, name)) continue;
      if (!indByProd.has(pid)) indByProd.set(pid, []);
      indByProd.get(pid)!.push({
        name,
        slug: String(i.slug || ""),
        description: normalizeCatalogHtmlToText(String(i.description || "")),
      });
    }

    const probByProd = new Map<
      string,
      { name: string; slug: string; description?: string }[]
    >();
    for (const ps of probLinks.rows) {
      const pid = String(ps.productId || "");
      const name = String(ps.name || "").trim();
      if (!pid || isDummyPlaceholderRow(ps.slug, name)) continue;
      if (!probByProd.has(pid)) probByProd.set(pid, []);
      probByProd.get(pid)!.push({
        name,
        slug: String(ps.slug || ""),
        description: normalizeCatalogHtmlToText(String(ps.description || "")),
      });
    }

    const dbItems: MainWebsiteProduct[] = validRows.map((r) => {
      const id = String(r.id);
      const slug = String(r.slug);
      const effectivePrice =
        r.discountPrice !== null &&
        r.discountPrice !== undefined &&
        Number(r.discountPrice) > 0
          ? Number(r.discountPrice)
          : r.basePrice !== null &&
            r.basePrice !== undefined &&
            Number(r.basePrice) > 0
          ? Number(r.basePrice)
          : null;

      const allSpecs = specsByProd.get(id) || [];
      const dimensions = allSpecs.filter((s) => isEcosystemDimensionSpec(s));
      const specifications = allSpecs.filter((s) => !isEcosystemDimensionSpec(s));
      const features = featsByProd.get(id) || [];
      const variants = varsByProd.get(id) || [];
      const plainDesc = normalizeCatalogHtmlToText(
        r.description ? String(r.description) : ""
      );
      const htmlDesc = normalizeCatalogHtmlToText(
        r.descriptionHtml ? String(r.descriptionHtml) : ""
      );
      const descriptionHtmlText = [plainDesc, htmlDesc]
        .filter(Boolean)
        .join("\n")
        .trim();
      const importantNoteText = normalizeCatalogHtmlToText(
        r.importantNoteHtml ? String(r.importantNoteHtml) : ""
      );

      const rawSku = r.sku ? String(r.sku).trim() : "";
      const normSku = rawSku ? rawSku.replace(/^CCPO(\d+)/i, "CCP0$1") : null;
      const regularPrice =
        r.basePrice !== null && r.basePrice !== undefined && Number(r.basePrice) > 0
          ? Number(r.basePrice)
          : null;

      const item: MainWebsiteProduct = {
        id,
        brand: "CLASSIC_CONCEPTS" as const,
        brandLabel: "Classic Concepts",
        itemType: "PRODUCT" as const,
        name: String(r.name),
        slug,
        sku: normSku,
        categoryName: r.subCategoryName
          ? `${String(r.categoryName || "Acrylic")} - ${String(r.subCategoryName)}`
          : String(r.categoryName || "Acrylic Products"),
        podiumSubCategory: r.podiumSubCategoryName
          ? String(r.podiumSubCategoryName)
          : null,
        description: r.description ? String(r.description) : null,
        descriptionHtmlText: descriptionHtmlText || null,
        importantNoteText: importantNoteText || null,
        searchKeywords: r.searchKeywords ? String(r.searchKeywords) : null,
        basePrice: effectivePrice,
        regularPrice,
        mainImage: r.mainImage ? String(r.mainImage) : null,
        images:
          imgsByProd.get(id) ||
          (r.mainImage ? [String(r.mainImage)] : []),
        url: `https://classicconcepts.in/shop/p/${slug}`,
        features,
        dimensions,
        specifications,
        variants,
        isRegisteredDesign: Boolean(r.isRegisteredDesign),
        designRegistrationNo: r.designRegistrationNo
          ? String(r.designRegistrationNo)
          : null,
        ipProtectionText: r.ipProtectionText
          ? String(r.ipProtectionText)
          : null,
        videoUrl: r.videoUrl ? String(r.videoUrl) : null,
        industries: indByProd.get(id) || [],
        problemStatements: probByProd.get(id) || [],
        resources: resByProd.get(id) || globalResourcesList,
        specsSummary:
          allSpecs.length > 0
            ? allSpecs.map((s) => `${s.key}: ${s.value}`).join(", ")
            : null,
      };
      item.searchBlob = buildEcosystemItemSearchBlob(item);
      return item;
    });

    return ensureEcosystemProductShortLinks(dbItems);
  } catch {
    return ensureEcosystemProductShortLinks(FALLBACK_CLASSIC_CATALOG);
  }
}

/**
 * Loads all Classic Edge 53 machines, models (`YN-JW1200`, `YN-JW1600`, `ABM-1250`, `ABM-2400`, CNC, laser, polishing, bending),
 * product-level and model-specific specifications, features, resources, and consumables (`classicedge53.com`) via API or direct LibSQL read.
 */
export async function loadAllClassicEdgeItems(): Promise<MainWebsiteProduct[]> {
  const apiUrl = resolveClassicEdgeInternalUrl();
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
          const prodSpecs: EcosystemSpecItem[] = Array.isArray(m.specifications)
            ? m.specifications
                .map((s: any) => ({
                  key: String(s.key || "").trim(),
                  value: String(s.value || "").trim(),
                  type: "specification",
                }))
                .filter((s: EcosystemSpecItem) => Boolean(s.key && s.value))
            : [];
          const models: EcosystemModelItem[] = Array.isArray(m.models)
            ? m.models.map((md: any) => ({
                id: String(md.id || md.modelName || ""),
                modelName: String(md.modelName || ""),
                specifications: Array.isArray(md.specifications)
                  ? md.specifications
                      .map((s: any) => ({
                        key: String(s.key || "").trim(),
                        value: String(s.value || "").trim(),
                      }))
                      .filter((s: { key: string; value: string }) =>
                        Boolean(s.key && s.value)
                      )
                  : [],
                resources: Array.isArray(md.resources) ? md.resources : [],
                consumables: Array.isArray(md.consumables) ? md.consumables : [],
              }))
            : [];

          const item: MainWebsiteProduct = {
            id: String(m.id),
            brand: "CLASSIC_EDGE_53",
            brandLabel: "Classic Edge 53",
            itemType: "MACHINE",
            name: String(m.name),
            slug: String(m.id),
            sku:
              models.length > 0
                ? models.map((md) => md.modelName).join(" / ")
                : null,
            categoryName: "Classic Edge 53 Machine",
            description: m.description ? String(m.description) : null,
            searchKeywords: m.keywords ? String(m.keywords) : null,
            basePrice: null,
            mainImage: m.coverImage ? String(m.coverImage) : null,
            url: String(m.url || `https://classicedge53.com/products/${m.id}`),
            features: Array.isArray(m.features)
              ? m.features.map((f: any) => String(f || "").trim()).filter(Boolean)
              : [],
            specifications: prodSpecs,
            models,
            resources: Array.isArray(m.resources) ? m.resources : [],
            relatedConsumables: Array.isArray(m.consumables) ? m.consumables : [],
            modelsSummary:
              models.length > 0
                ? models.map((md) => md.modelName).join(", ")
                : null,
            specsSummary:
              prodSpecs.length > 0
                ? prodSpecs.map((s) => `${s.key}: ${s.value}`).join(", ")
                : null,
          };
          item.searchBlob = buildEcosystemItemSearchBlob(item);
          combined.push(item);
        }
        for (const c of data?.consumables || []) {
          if (isDummyPlaceholderRow(c?.id, c?.name)) continue;
          const descStr = c.description ? String(c.description) : "";
          const priceMatch = descStr.match(/(?:starting\s+from|price:?)?\s*₹\s*([\d,]+(?:\.\d+)?)/i);
          const parsedPrice = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null;
          const item: MainWebsiteProduct = {
            id: String(c.id),
            brand: "CLASSIC_EDGE_53",
            brandLabel: "Classic Edge 53",
            itemType: "CONSUMABLE",
            name: String(c.name),
            slug: String(c.id),
            sku: null,
            categoryName: String(c.categoryName || c.category || "Machine Consumables"),
            description: descStr || null,
            searchKeywords: c.keywords ? String(c.keywords) : null,
            basePrice: parsedPrice && Number.isFinite(parsedPrice) ? parsedPrice : null,
            mainImage: c.mainImage ? String(c.mainImage) : null,
            url: String(
              c.url || `https://classicedge53.com/consumables/${c.id}`
            ),
            specsSummary: c.keywords ? String(c.keywords) : null,
          };
          item.searchBlob = buildEcosystemItemSearchBlob(item);
          combined.push(item);
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

    const [
      machinesRes,
      featsRes,
      modelsRes,
      specsRes,
      resRows,
      consRes,
      prodConsLinks,
      modelConsLinks,
    ] = await Promise.all([
      client.execute(
        `SELECT id, name, description, keywords, coverImage FROM Product ORDER BY updatedAt DESC`
      ),
      client
        .execute(`SELECT productId, text FROM ProductFeature`)
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
      client.execute(`SELECT id, productId, modelName FROM ProductModel`),
      client.execute(
        `SELECT productId, productModelId, key, value FROM Specification`
      ),
      client
        .execute(`SELECT productId, productModelId, name, url FROM Resource`)
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
      client.execute(
        `SELECT id, name, description, keywords, image, category FROM Consumable ORDER BY updatedAt DESC`
      ),
      client
        .execute(`SELECT A AS consumableId, B AS productId FROM _ConsumableToProduct`)
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
      client
        .execute(
          `SELECT A AS consumableId, B AS modelId FROM _ConsumableToProductModel`
        )
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    ]);

    const consById = new Map<
      string,
      { id: string; name: string; category: string | null; description: string | null }
    >();
    for (const c of consRes.rows) {
      if (isDummyPlaceholderRow(c.id, c.name)) continue;
      consById.set(String(c.id), {
        id: String(c.id),
        name: String(c.name),
        category: c.category ? String(c.category) : null,
        description: c.description ? String(c.description) : null,
      });
    }

    const featsByProd = new Map<string, string[]>();
    for (const f of featsRes.rows) {
      const pid = String(f.productId || "");
      const txt = String(f.text || "").trim();
      if (!pid || !txt) continue;
      if (!featsByProd.has(pid)) featsByProd.set(pid, []);
      featsByProd.get(pid)!.push(txt);
    }

    const prodLevelSpecs = new Map<string, EcosystemSpecItem[]>();
    const modelLevelSpecs = new Map<string, { key: string; value: string }[]>();
    for (const s of specsRes.rows) {
      const pid = s.productId ? String(s.productId) : "";
      const mid = s.productModelId ? String(s.productModelId) : "";
      const key = String(s.key || "").trim();
      const value = String(s.value || "").trim();
      if (!key || !value) continue;
      if (mid) {
        if (!modelLevelSpecs.has(mid)) modelLevelSpecs.set(mid, []);
        modelLevelSpecs.get(mid)!.push({ key, value });
      } else if (pid) {
        if (!prodLevelSpecs.has(pid)) prodLevelSpecs.set(pid, []);
        prodLevelSpecs.get(pid)!.push({ key, value, type: "specification" });
      }
    }

    const prodLevelRes = new Map<string, { name: string; url: string }[]>();
    const modelLevelRes = new Map<string, { name: string; url: string }[]>();
    for (const r of resRows.rows) {
      const pid = r.productId ? String(r.productId) : "";
      const mid = r.productModelId ? String(r.productModelId) : "";
      const name = String(r.name || "").trim();
      const url = String(r.url || "").trim();
      if (!name || !url) continue;
      if (mid) {
        if (!modelLevelRes.has(mid)) modelLevelRes.set(mid, []);
        modelLevelRes.get(mid)!.push({ name, url });
      } else if (pid) {
        if (!prodLevelRes.has(pid)) prodLevelRes.set(pid, []);
        prodLevelRes.get(pid)!.push({ name, url });
      }
    }

    const consByModel = new Map<
      string,
      { id: string; name: string; category?: string | null; description?: string | null }[]
    >();
    for (const link of modelConsLinks.rows) {
      const cid = String(link.consumableId || "");
      const mid = String(link.modelId || "");
      const cObj = consById.get(cid);
      if (!mid || !cObj) continue;
      if (!consByModel.has(mid)) consByModel.set(mid, []);
      consByModel.get(mid)!.push(cObj);
    }

    const consByProd = new Map<
      string,
      { id: string; name: string; category?: string | null; description?: string | null }[]
    >();
    for (const link of prodConsLinks.rows) {
      const cid = String(link.consumableId || "");
      const pid = String(link.productId || "");
      const cObj = consById.get(cid);
      if (!pid || !cObj) continue;
      if (!consByProd.has(pid)) consByProd.set(pid, []);
      consByProd.get(pid)!.push(cObj);
    }

    const modelsByProd = new Map<string, EcosystemModelItem[]>();
    for (const m of modelsRes.rows) {
      const mid = String(m.id || "");
      const pid = String(m.productId || "");
      const modelName = String(m.modelName || "").trim();
      if (!pid || !modelName) continue;
      if (!modelsByProd.has(pid)) modelsByProd.set(pid, []);
      modelsByProd.get(pid)!.push({
        id: mid,
        modelName,
        specifications: modelLevelSpecs.get(mid) || [],
        resources: modelLevelRes.get(mid) || [],
        consumables: consByModel.get(mid) || [],
      });
    }

    const items: MainWebsiteProduct[] = [];
    for (const r of machinesRes.rows) {
      if (isDummyPlaceholderRow(r.id, r.name)) continue;
      const id = String(r.id);
      const models = modelsByProd.get(id) || [];
      const specs = prodLevelSpecs.get(id) || [];
      const features = featsByProd.get(id) || [];
      const item: MainWebsiteProduct = {
        id,
        brand: "CLASSIC_EDGE_53",
        brandLabel: "Classic Edge 53",
        itemType: "MACHINE",
        name: String(r.name),
        slug: id,
        sku:
          models.length > 0
            ? models.map((md) => md.modelName).join(" / ")
            : null,
        categoryName: "Acrylic Machine (Classic Edge 53)",
        description: r.description ? String(r.description) : null,
        searchKeywords: r.keywords ? String(r.keywords) : null,
        basePrice: null,
        mainImage: r.coverImage ? String(r.coverImage) : null,
        url: `https://classicedge53.com/products/${id}`,
        features,
        specifications: specs,
        models,
        resources: prodLevelRes.get(id) || [],
        relatedConsumables: consByProd.get(id) || [],
        modelsSummary: models.map((md) => md.modelName).join(", ") || null,
        specsSummary:
          [
            specs.map((s) => `${s.key}: ${s.value}`).join(", "),
            r.keywords ? String(r.keywords) : "",
          ]
            .filter(Boolean)
            .join(" | ") || null,
      };
      item.searchBlob = buildEcosystemItemSearchBlob(item);
      items.push(item);
    }

    for (const c of consRes.rows) {
      if (isDummyPlaceholderRow(c.id, c.name)) continue;
      const id = String(c.id);
      const item: MainWebsiteProduct = {
        id,
        brand: "CLASSIC_EDGE_53",
        brandLabel: "Classic Edge 53",
        itemType: "CONSUMABLE",
        name: String(c.name),
        slug: id,
        sku: null,
        categoryName: c.category
          ? `Consumable - ${String(c.category)}`
          : "Machine Consumables",
        description: c.description ? String(c.description) : null,
        searchKeywords: c.keywords ? String(c.keywords) : null,
        basePrice: (() => {
          const descStr = c.description ? String(c.description) : "";
          const m = descStr.match(/(?:starting\s+from|price:?)?\s*₹\s*([\d,]+(?:\.\d+)?)/i);
          const v = m ? Number(m[1].replace(/,/g, "")) : null;
          return v && Number.isFinite(v) ? v : null;
        })(),
        mainImage: c.image ? String(c.image) : null,
        url: `https://classicedge53.com/consumables/${id}`,
        specsSummary: c.keywords ? String(c.keywords) : null,
      };
      item.searchBlob = buildEcosystemItemSearchBlob(item);
      items.push(item);
    }

    if (items.length >= 5) {
      return ensureEcosystemProductShortLinks(items);
    }
  } catch {
    // Fall through to remote Classic Edge 53 catalog fallback
  }

  try {
    const res = await fetch("https://www.classicedge53.com/api/whatsapp-catalog", {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data: any = await res.json();
      const combined: MainWebsiteProduct[] = [];
      for (const m of data?.machines || []) {
        if (isDummyPlaceholderRow(m?.id, m?.name)) continue;
        const prodSpecs: EcosystemSpecItem[] = Array.isArray(m.specifications)
          ? m.specifications
              .map((s: any) => ({
                key: String(s.key || "").trim(),
                value: String(s.value || "").trim(),
                type: "specification",
              }))
              .filter((s: EcosystemSpecItem) => Boolean(s.key && s.value))
          : [];
        const models: EcosystemModelItem[] = Array.isArray(m.models)
          ? m.models.map((md: any) => ({
              id: String(md.id || md.modelName || ""),
              modelName: String(md.modelName || ""),
              specifications: Array.isArray(md.specifications)
                ? md.specifications
                    .map((s: any) => ({
                      key: String(s.key || "").trim(),
                      value: String(s.value || "").trim(),
                    }))
                    .filter((s: { key: string; value: string }) => Boolean(s.key && s.value))
                : [],
              resources: Array.isArray(md.resources) ? md.resources : [],
              consumables: Array.isArray(md.consumables) ? md.consumables : [],
            }))
          : [];
        const item: MainWebsiteProduct = {
          id: String(m.id),
          brand: "CLASSIC_EDGE_53",
          brandLabel: "Classic Edge 53",
          itemType: "MACHINE",
          name: String(m.name),
          slug: String(m.id),
          sku: models.length > 0 ? models.map((md) => md.modelName).join(" / ") : null,
          categoryName: "Classic Edge 53 Machine",
          description: m.description ? String(m.description) : null,
          searchKeywords: m.keywords ? String(m.keywords) : null,
          basePrice: null,
          mainImage: m.coverImage ? String(m.coverImage) : null,
          url: String(m.url || `https://classicedge53.com/products/${m.id}`),
          features: Array.isArray(m.features)
            ? m.features.map((f: any) => String(f || "").trim()).filter(Boolean)
            : [],
          specifications: prodSpecs,
          models,
          resources: Array.isArray(m.resources) ? m.resources : [],
          relatedConsumables: Array.isArray(m.consumables) ? m.consumables : [],
          modelsSummary: models.length > 0 ? models.map((md) => md.modelName).join(", ") : null,
          specsSummary: prodSpecs.length > 0 ? prodSpecs.map((s) => `${s.key}: ${s.value}`).join(", ") : null,
        };
        item.searchBlob = buildEcosystemItemSearchBlob(item);
        combined.push(item);
      }
      for (const c of data?.consumables || []) {
        if (isDummyPlaceholderRow(c?.id, c?.name)) continue;
        const descStr = c.description ? String(c.description) : "";
        const priceMatch = descStr.match(/(?:starting\s+from|price:?)?\s*₹\s*([\d,]+(?:\.\d+)?)/i);
        const parsedPrice = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null;
        const item: MainWebsiteProduct = {
          id: String(c.id),
          brand: "CLASSIC_EDGE_53",
          brandLabel: "Classic Edge 53",
          itemType: "CONSUMABLE",
          name: String(c.name),
          slug: String(c.id),
          sku: null,
          categoryName: String(c.categoryName || c.category || "Machine Consumables"),
          description: descStr || null,
          searchKeywords: c.keywords ? String(c.keywords) : null,
          basePrice: parsedPrice && Number.isFinite(parsedPrice) ? parsedPrice : null,
          mainImage: c.mainImage ? String(c.mainImage) : null,
          url: String(c.url || `https://classicedge53.com/consumables/${c.id}`),
          specsSummary: c.keywords ? String(c.keywords) : null,
        };
        item.searchBlob = buildEcosystemItemSearchBlob(item);
        combined.push(item);
      }
      if (combined.length > 0) {
        return ensureEcosystemProductShortLinks(combined);
      }
    }
  } catch {
    // Ignore remote fallback error
  }

  return ensureEcosystemProductShortLinks(FALLBACK_CLASSIC_EDGE_MACHINES);
}

const SEARCH_STOPWORDS = new Set([
  "i", "im", "am", "is", "are", "was", "were", "be", "been", "being",
  "a", "an", "the", "and", "or", "but", "if", "so", "as", "at", "by",
  "for", "from", "in", "into", "of", "on", "onto", "to", "up", "with",
  "about", "above", "after", "again", "all", "also", "any", "around",
  "asking", "asked", "below", "between", "both", "budget", "buy", "can",
  "check", "classic", "concepts", "cost", "costs", "could", "details",
  "do", "does", "doing", "each", "few", "find", "get", "give", "good",
  "best", "great", "had", "has", "have", "having", "hello", "hey", "hi",
  "how", "inr", "item", "items", "just", "know", "less", "like", "list",
  "look", "looking", "make", "many", "max", "maximum", "may", "me", "min",
  "minimum", "more", "most", "much", "must", "my", "need", "needed", "new",
  "no", "not", "now", "only", "option", "options", "order", "our", "out",
  "over", "per", "piece", "pieces", "please", "pls", "plz", "price",
  "priced", "prices", "pricing", "product", "products", "purchase",
  "quote", "range", "rate", "rates", "rs", "rupee", "rupees", "said",
  "same", "say", "see", "send", "share", "show", "some", "something",
  "still", "such", "take", "tell", "than", "thank", "thanks", "that",
  "their", "them", "then", "there", "these", "they", "this", "those",
  "through", "told", "too", "under", "until", "upto", "us", "use", "very",
  "want", "wanted", "we", "what", "when", "where", "which", "while", "who",
  "will", "within", "would", "you", "your", "namaste", "sir", "madam",
]);

const DOMAIN_SYNONYM_GROUPS: string[][] = [
  ["podium", "podiums", "pulpit", "pulpits", "lectern", "lecterns", "rostrum", "speech", "stage", "auditorium", "ccp"],
  ["trophy", "trophies", "award", "awards", "memento", "mementos", "plaque", "plaques", "shield", "shields", "medal", "gift", "gifts", "gifting"],
  ["menu", "menus", "tent", "qr", "standee", "holder", "holders", "brochure", "leaflet", "pamphlet", "flyer"],
  ["donation", "charity", "ballot", "suggestion", "lottery", "drop"],
  ["saree", "garment", "showcase", "riser", "risers", "turntable", "merchandise", "retail"],
  ["table", "tables", "chair", "chairs", "stool", "stools", "desk", "desks", "furniture", "bedside", "coffee", "dining", "interior", "interiors", "interiora", "furnishings"],
  ["tray", "trays", "dispenser", "dispensers", "candy", "lollipop", "beverage", "juice"],
  ["signage", "signages", "sign", "nameplate", "nameplates", "board", "boards", "keychain", "keychains", "badge", "badges"],
  ["polisher", "polishing", "buffing", "diamond"],
  ["bender", "bending", "heater", "heating"],
  ["router", "cnc", "laser", "cutter", "cutting", "blade", "blades"],
  ["sheet", "sheets", "mirror", "tube", "tubes", "rod", "rods"],
];

export interface EcosystemSearchOptions {
  minPrice?: number | null;
  maxPrice?: number | null;
  brand?: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | null;
  itemType?: "PRODUCT" | "MACHINE" | "CONSUMABLE" | null;
  excludedItemTypes?: ("PRODUCT" | "MACHINE" | "CONSUMABLE")[];
  productFamily?: string | null;
  preferPremium?: boolean;
  preferCheapest?: boolean;
  includeUnpricedOnBudget?: boolean;
  excludeSlugs?: string[];
}

export function extractBudgetConstraintsFromQuery(rawQuery: string): {
  maxPrice: number | null;
  minPrice: number | null;
  isPerPiece?: boolean;
  isTotalProjectBudget?: boolean;
} {
  const normalized = String(rawQuery || "").replace(/,/g, "").toLowerCase();
  let maxPrice: number | null = null;
  let minPrice: number | null = null;

  const isPerPiece = /\b(per\s*(?:piece|pc|unit|item|podium|chair|table|gift|memento|plate|sign)|each|apiece)\b/i.test(
    normalized
  );
  const isTotalProjectBudget =
    !isPerPiece &&
    (/\b(total\s*budget|overall\s*budget|project\s*budget|renovat(?:e|ion)|all\s*together|combined|combinations?\s*accordingly)\b/i.test(
      normalized
    ) ||
      /\b(lac|lacs|lakh|lakhs|cr|crore)\b/i.test(normalized));

  const parseAmount = (numStr: string, unitSuffix?: string): number | null => {
    const val = parseFloat(numStr);
    if (!Number.isFinite(val) || val <= 0) return null;
    const suffix = (unitSuffix || "").toLowerCase().trim();
    let multiplier = 1;
    if (suffix === "k" || suffix === "thousand") {
      multiplier = 1000;
    } else if (/^(lac|lacs|lakh|lakhs)$/.test(suffix)) {
      multiplier = 100000;
    } else if (/^(cr|crore|crores)$/.test(suffix)) {
      multiplier = 10000000;
    }
    const computed = Math.round(val * multiplier);
    // Avoid mistaking small quantities (e.g. "need 5" or "10mm") for a Rupee budget unless unit suffix or currency symbol is present
    if (multiplier === 1 && computed < 250) return null;
    return computed;
  };

  const maxRe =
    /\b(?:under|below|within|upto|up\s*to|less\s*than|max|maximum|(?:increase|raise|extend|stretch|push|bump|change|update|set)?\s*(?:the\s*|my\s*|our\s*)?budget(?:\s*(?:of|is|to|upto|up\s*to|around|for))?|(?:stretch|go|increase|raise|make\s*it)(?:\s*up)?\s*to)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|lac|lacs|lakh|lakhs|cr|crore|crores)?\b/gi;
  for (const m of normalized.matchAll(maxRe)) {
    if (m[1]) {
      const parsed = parseAmount(m[1], m[2]);
      if (parsed !== null) maxPrice = parsed;
    }
  }

  // Also catch standalone currency ceiling like "around ₹30000", "around 1 lac rupees", or "₹30,000 budget"
  if (maxPrice === null) {
    const altMaxRe =
      /(?:(?:rs\.?|inr|₹)\s*(\d+(?:\.\d+)?)\s*(k|thousand|lac|lacs|lakh|lakhs)?\s*(?:max|maximum|budget|limit|or\s*less))|(?:\baround\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|lac|lacs|lakh|lakhs)?\s*(?:rs\.?|inr|rupees|₹)?\b)|(?:\b(\d+(?:\.\d+)?)\s*(lac|lacs|lakh|lakhs)\s*(?:rs\.?|inr|rupees|budget)?\b)/gi;
    for (const m of normalized.matchAll(altMaxRe)) {
      const num = m[1] || m[3] || m[5];
      const unit = m[2] || m[4] || m[6];
      if (num) {
        const parsed = parseAmount(num, unit);
        if (parsed !== null) maxPrice = parsed;
      }
    }
  }

  const minRe =
    /\b(?:above|over|more\s*than|min|minimum|starting(?:\s*from)?|at\s*least)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|lac|lacs|lakh|lakhs)?\b/gi;
  for (const m of normalized.matchAll(minRe)) {
    if (m[1]) {
      const parsed = parseAmount(m[1], m[2]);
      if (parsed !== null) minPrice = parsed;
    }
  }

  const rangeRe =
    /\bbetween\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|lac|lacs|lakh|lakhs)?\s*(?:and|to|-)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|lac|lacs|lakh|lakhs)?\b/gi;
  for (const m of normalized.matchAll(rangeRe)) {
    if (m[1] && m[3]) {
      const pMin = parseAmount(m[1], m[2]);
      const pMax = parseAmount(m[3], m[4]);
      if (pMin !== null) minPrice = pMin;
      if (pMax !== null) maxPrice = pMax;
    }
  }

  return { maxPrice, minPrice, isPerPiece, isTotalProjectBudget };
}

function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function wordMatchesToken(word: string, token: string): boolean {
  if (word === token) return true;
  if (token.length >= 4 && word.length >= 4) {
    if (word === `${token}s` || token === `${word}s`) return true;
    if (word === `${token}es` || token === `${word}es`) return true;
    if (
      token.length >= 5 &&
      (word.startsWith(token) || (word.length >= 5 && token.startsWith(word)))
    ) {
      return true;
    }
  }
  return false;
}

export function extractExplicitProductOrModelCodes(query: string): string[] {
  const codes = new Set<string>();
  const matches = query.matchAll(
    /\b(ccpo?[-_\s]?\d{2,4}[a-z]?|yn[-_\s]?jw\d{3,4}|abm[-_\s]?\d{3,4}|ce53[-_\s]?[a-z0-9-]+|cw[-_\s]?\d{3,5}|f[-_\s]?(?:308|500)|sd[-_\s]?\d{3,4}[a-z0-9]*|jw[-_\s]?\d{3,4}[a-z]?|zd[-_\s]?\d{3,4}|ce[-_\s]?[a-z]{2,4}[-_\s]?\d{2,4}[a-z]*|a[345][-_\s]?t[-_\s]?stand[-_\s]?\d*|d30)\b/gi
  );
  for (const m of matches) {
    if (m[1]) {
      codes.add(
        m[1]
          .toLowerCase()
          .replace(/[-_\s]+/g, "")
          .replace(/^ccpo(\d)/, "ccp0$1")
      );
    }
  }
  if (/\bc[-\s]*podium\b|\bc[-\s]*shaped\s+pillar/i.test(query)) {
    codes.add("ccp053");
  }
  return Array.from(codes);
}

export function extractCompactDimensionPairsFromText(text: string): {
  pairs: string[];
  ranges: string[];
} {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/[×✕*]/g, "x")
    .replace(/["”″']/g, " ");
  const pairsSet = new Set<string>();
  const rangesSet = new Set<string>();

  const pairRegex = /(\d{1,4}(?:\.\d+)?)\s*(?:inch|inches|in|mm|cm|ft|feet)?\s*(?:x|by)\s*(\d{1,4}(?:\.\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = pairRegex.exec(normalized)) !== null) {
    const a = m[1];
    const b = m[2];
    pairsSet.add(`${a}x${b}`);
    pairsSet.add(`${b}x${a}`);
  }

  const rangeRegex = /(\d{1,4}(?:\.\d+)?)\s*(?:min\.?\s*)?(?:to|-)\s*(\d{1,4}(?:\.\d+)?)\s*(?:max\.?\s*)?(?:inch|inches|in|mm|cm)\b/gi;
  while ((m = rangeRegex.exec(normalized)) !== null) {
    rangesSet.add(`${m[1]}to${m[2]}`);
  }

  return {
    pairs: Array.from(pairsSet),
    ranges: Array.from(rangesSet),
  };
}

export function searchEcosystemItems(
  items: MainWebsiteProduct[],
  searchQuery: string,
  limit = 6,
  options?: EcosystemSearchOptions
): MainWebsiteProduct[] {
  const q = searchQuery.trim().toLowerCase();
  const explicitCodes = extractExplicitProductOrModelCodes(searchQuery);

  // Detect inline negations even when searchEcosystemItems is called directly without options
  const inlineExcludeConsumables =
    /\b(?:not\s+looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|exclude|excluding|skip)\s+(?:any\s+)?(?:tools?|consumables?|blades?|cutters?|solvents?|accessories)\b|\b(?:just|only)\s+machines?\b/i.test(
      q
    );
  const inlineExcludeMachines =
    /\b(?:not\s+looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|exclude)\s+(?:any\s+)?machines?\b|\b(?:just|only)\s+(?:tools?|consumables?|blades?|cutters?)\b/i.test(
      q
    );
  const mentionsMachineExplicitly =
    /\b(machine|machines|polisher|polishing\s+machine|bender|bending\s+machine|line\s+bender|laser\s+cutter|laser\s+cutting|cnc\s+router\s+machine|flame\s+polish|thermoforming\s+oven|chiller|compressor|yn[-_\s]?jw\d+|abm[-_\s]?\d+|ce53[-_\s]?[a-z0-9-]+|cw[-_\s]?\d{3,5}|f[-_\s]?(?:308|500)|sd[-_\s]?\d{3,4}|jw[-_\s]?\d{3,4}|zd[-_\s]?\d{3,4}|ce[-_\s]?(?:lc|cnc|fp|to)\d+)\b/i.test(
      q
    ) ||
    (/\b(cnc\s+router|router|laser)\b/i.test(q) &&
      !/\b(bit|bits|tool|tools|blade|blades|cutter|cutters|carbide|collet|collect|consumable|consumables|accessor(?:y|ies))\b/i.test(
        q
      ));
  const mentionsConsumablesExplicitly =
    /\b(consumable|consumables|tool|tools|blade|blades|cutter|cutters|router\s+bit|router\s+bits|carbide|collet|collect|solvent|glue|bonding|buffing|heating\s+wire|spare\s+part|accessor(?:y|ies)|add[-\s]?ons?|hinge|hinges|camlock|camlocks|standoff|standoffs|spacer|spacers|knob|knobs|handle|handles|latch|latches|catch|catches|hasp|staple|screw|screws|bolt|nut|washer|bracket|brackets|rod|rods|tube|tubes|ball|balls|sphere|turntable|rotating\s+disc|key\s*ring|photo\s*magnet|radeon|glitter\s+sheet|mirror\s+sheet|metallic\s+sheet)\b/i.test(
      q
    );

  let cleanItems = items.filter((i) => !isDummyPlaceholderRow(i.id, i.name));
  if (options?.brand) {
    cleanItems = cleanItems.filter((i) => i.brand === options.brand);
  }
  const effectiveItemType =
    options?.itemType ??
    (inlineExcludeConsumables
      ? "MACHINE"
      : inlineExcludeMachines
      ? "CONSUMABLE"
      : mentionsMachineExplicitly && !mentionsConsumablesExplicitly
      ? "MACHINE"
      : null);
  if (effectiveItemType) {
    cleanItems = cleanItems.filter((i) => i.itemType === effectiveItemType);
  }

  const excludedSet = new Set<"PRODUCT" | "MACHINE" | "CONSUMABLE">(
    options?.excludedItemTypes || []
  );
  if (inlineExcludeConsumables || (mentionsMachineExplicitly && !mentionsConsumablesExplicitly)) {
    excludedSet.add("CONSUMABLE");
  }
  if (inlineExcludeMachines) excludedSet.add("MACHINE");
  if (excludedSet.size > 0) {
    cleanItems = cleanItems.filter((i) => !excludedSet.has(i.itemType));
  }

  if (!q && options?.maxPrice === undefined && options?.minPrice === undefined) {
    return cleanItems.slice(0, limit);
  }

  const extractedBudget = extractBudgetConstraintsFromQuery(searchQuery);
  const maxPrice =
    options?.maxPrice !== undefined ? options.maxPrice : extractedBudget.maxPrice;
  const minPrice =
    options?.minPrice !== undefined ? options.minPrice : extractedBudget.minPrice;
  const preferCheapest =
    options?.preferCheapest ??
    /\b(cheapest|lowest\s*price|least\s*expensive|minimum\s*price|starting\s*(?:price|model|range)|most\s*affordable|economy\s*model|sasta|sabse\s*sasta|kam\s*price|smaller\s*top\s*to\s*save|save\s*more|cheaper\s*alternative|cheaper\s*option|lower\s*cost)\b/i.test(
      q
    );
  const preferPremium =
    !preferCheapest &&
    (options?.preferPremium ??
      /\b(costliest|most\s*expensive|highest\s*price|most\s*premium|premium|high\s*end|best\s*quality|top\s*model|flagship|luxury|heaviest|mehenga|sabse\s*mehenga)\b/i.test(
        q
      ));
  const excludeSlugSet = new Set<string>(
    (options?.excludeSlugs || []).map((s) => s.toLowerCase().trim())
  );

  // Strip currency amounts AND negated clauses ("not looking for tools") so negated terms never match positively
  const queryWithoutPricesAndNegations = q
    .replace(
      /\b(?:not\s+looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|exclude|excluding|skip)\s+(?:any\s+)?(?:tools?|consumables?|blades?|cutters?|solvents?|accessories|machines?)\b/gi,
      " "
    )
    .replace(/(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?\s*(?:k|thousand|lac|lacs|lakh|lakhs|cr|crore|crores)?\b/gi, " ")
    .replace(
      /\b(?:under|below|within|upto|up\s*to|above|over|around|budget(?:\s*(?:of|is|to|around))?|increase|raise|extend|stretch)\s*(?:the\s*|my\s*|our\s*)?(?:budget\s*(?:to|of|is|around)?\s*)?(?:rs\.?|inr|₹)?\s*[\d,]+(?:\.\d+)?\s*(?:k|thousand|lac|lacs|lakh|lakhs|cr|crore|crores)?\s*(?:rupees|rs\.?|inr|₹)?\b/gi,
      " "
    );

  // Extract measurement numbers like "24 x 20" or "1600mm" when present
  const measurementTokens: string[] = [];
  for (const m of queryWithoutPricesAndNegations.matchAll(
    /\b(\d{2,4})\s*(?:x|×|by)\s*(\d{2,4})\b|\b(\d{3,4})\s*mm\b/gi
  )) {
    if (m[1] && m[2]) {
      measurementTokens.push(m[1], m[2]);
    } else if (m[3]) {
      measurementTokens.push(m[3]);
    }
  }

  const rawTokens = tokenizeWords(queryWithoutPricesAndNegations).filter(
    (t) =>
      t.length >= 2 &&
      !SEARCH_STOPWORDS.has(t) &&
      !/^\d+$/.test(t) &&
      t !== "acrylic" &&
      t !== "increase" &&
      t !== "extend" &&
      t !== "raise" &&
      t !== "stretch" &&
      t !== "premium" &&
      t !== "cheapest" &&
      t !== "cheaper" &&
      t !== "alternative" &&
      t !== "ones" &&
      t !== "actually" &&
      t !== "compare" &&
      t !== "difference" &&
      t !== "between"
  );

  // If user literally only typed "acrylic", allow "acrylic" as fallback token
  const directTokens =
    rawTokens.length > 0
      ? rawTokens
      : explicitCodes.length > 0
      ? explicitCodes
      : q.includes("acrylic")
      ? ["acrylic"]
      : [];

  if (directTokens.length === 0 && explicitCodes.length === 0) {
    if (maxPrice !== null || minPrice !== null || preferCheapest || preferPremium) {
      const pricedPool = cleanItems.filter((it) => {
        if (typeof it.basePrice !== "number" || it.basePrice <= 0) return false;
        if (maxPrice !== null && it.basePrice > maxPrice) return false;
        if (minPrice !== null && it.basePrice < minPrice) return false;
        return true;
      });
      pricedPool.sort((a, b) =>
        preferPremium
          ? (b.basePrice || 0) - (a.basePrice || 0)
          : (a.basePrice || 0) - (b.basePrice || 0)
      );
      return pricedPool.slice(0, limit);
    }
    if (effectiveItemType === "MACHINE" || effectiveItemType === "CONSUMABLE") {
      return cleanItems.slice(0, limit);
    }
    return [];
  }

  // Expand domain synonyms (e.g., "pulpits" -> "podium", "lectern", "ccp")
  const expandedSynonyms = new Set<string>();
  for (const tok of directTokens) {
    for (const grp of DOMAIN_SYNONYM_GROUPS) {
      if (grp.some((g) => wordMatchesToken(g, tok))) {
        for (const syn of grp) {
          if (!directTokens.includes(syn)) expandedSynonyms.add(syn);
        }
      }
    }
  }

  const queryDims = extractCompactDimensionPairsFromText(searchQuery);
  const wantsTopSurface = /\b(top\s*surface|top\s*sheet|reading\s*top|reading\s*surface|top\s*panel|top\s*size|top)\b/i.test(q);
  const wantsSmallerTop = /\b(smaller\s*top|compact\s*top|narrow\s*top|single\s*pillar|save\s*more|cheaper\s*alternative)\b/i.test(q);
  const hasExplicitEdgeModel = explicitCodes.some((c) =>
    /^(ynjw|abm|ce53|cw\d|f308|f500|sd\d|jw\d|zd\d|d30|celc|cecnc|cefp|ceto)/.test(c)
  );
  const hasExplicitCcCode = explicitCodes.some((c) => /^ccp\d/.test(c));

  const wantsFurniture =
    options?.productFamily === "furniture" ||
    /\b(furniture|interior|interiors|interiora|decor|table|tables|chair|chairs|stool|stools|desk|desks|console|bench|seating|sit)\b/i.test(
      queryWithoutPricesAndNegations
    );
  const wantsSignage =
    options?.productFamily === "signage" ||
    /\b(signage|signages|name\s*plate|name\s*plates|nameplate|nameplates|name\s*board|door\s*sign|directional\s*sign)\b/i.test(
      queryWithoutPricesAndNegations
    );
  const wantsCorporateGift =
    options?.productFamily === "corporate_gift" ||
    /\b(gift|gifts|gifting|corporate\s*gift|corporate\s*clients?|souvenir|souvenirs|paper\s*weight|paperweight|pen\s*stand|keychain|keychains|coaster|coasters|desk\s*organizer)\b/i.test(
      queryWithoutPricesAndNegations
    );
  const wantsPodium =
    (!wantsFurniture && !wantsSignage && !wantsCorporateGift && options?.productFamily === "podium") ||
    hasExplicitCcCode ||
    /\b(pulpit|pulpits|podium|podiums|lectern|lecterns|rostrum|rostrums)\b/i.test(
      queryWithoutPricesAndNegations
    );
  const wantsAward =
    options?.productFamily === "trophy" ||
    (!wantsPodium &&
      !wantsFurniture &&
      /\b(trophy|trophies|memento|mementos|award|awards|plaque|plaques|medal|medals|shield|shields)\b/i.test(
        queryWithoutPricesAndNegations
      ));
  const wantsTray =
    options?.productFamily === "tray_hospitality" ||
    (!wantsCorporateGift && /\b(tray|trays|coaster|coasters)\b/i.test(queryWithoutPricesAndNegations));
  const wantsStandOrHolder =
    options?.productFamily === "stand" ||
    /\b(menu|qr\s*stand|tent\s*card|table\s*stand|sign\s*holder|brochure|leaflet|pamphlet)\b/i.test(
      queryWithoutPricesAndNegations
    );
  const wantsMachineOrTool =
    options?.brand === "CLASSIC_EDGE_53" ||
    hasExplicitEdgeModel ||
    effectiveItemType === "MACHINE" ||
    effectiveItemType === "CONSUMABLE" ||
    mentionsMachineExplicitly ||
    mentionsConsumablesExplicitly ||
    /\b(machine|machines|laser|cnc|router|polisher|polishing|diamond|bending|bender|heater|blade|blades|cutter|consumable|consumables|ce53|yn-|abm-|thermoforming|oven|chiller|compressor)\b/i.test(
      queryWithoutPricesAndNegations
    );
  const wantsDisplayProduct =
    options?.brand === "CLASSIC_CONCEPTS" ||
    wantsPodium ||
    wantsFurniture ||
    wantsSignage ||
    wantsCorporateGift ||
    wantsAward ||
    wantsTray ||
    wantsStandOrHolder ||
    /\b(saree|donation|ballot|table|chair|stool|furniture|interior|interiora|riser|signage|nameplate|keychain|cake\s*stand|cosmetic|jewelry|jewellery|watch\s*stand|eyewear|book\s*stand|quran|rehal|bible)\b/i.test(
      queryWithoutPricesAndNegations
    );

  const scored: { item: MainWebsiteProduct; score: number }[] = [];

  for (const item of cleanItems) {
    const skuLower = (item.sku || "").toLowerCase();
    const skuCompact = skuLower.replace(/[-_\s]+/g, "").replace(/^ccpo(\d)/, "ccp0$1");
    const slugCompact = (item.slug || "").toLowerCase().replace(/[-_\s]+/g, "");
    const modelLower = (
      item.modelsSummary ||
      (item.models || []).map((m) => m.modelName).join(" ") ||
      ""
    ).toLowerCase();
    const modelCompact = modelLower.replace(/[-_\s]+/g, "");

    const isExplicitCodeHit =
      explicitCodes.length > 0 &&
      explicitCodes.some(
        (code) =>
          skuCompact === code ||
          skuCompact.includes(code) ||
          slugCompact.includes(code) ||
          modelCompact.includes(code)
      );

    // 1. Strict business routing (CLASSIC_CONCEPTS vs CLASSIC_EDGE_53) unless explicitly named by SKU
    if (!isExplicitCodeHit) {
      if (wantsDisplayProduct && !wantsMachineOrTool && item.brand !== "CLASSIC_CONCEPTS") {
        continue;
      }
      if (wantsMachineOrTool && !wantsDisplayProduct && item.brand !== "CLASSIC_EDGE_53") {
        continue;
      }
    }

    // 2. Strict category / product-family isolation (bypassed when item matches an explicit SKU in query)
    const combinedTaxonomy = `${item.name} ${item.categoryName} ${item.sku || ""}`;
    if (!isExplicitCodeHit) {
      if (wantsPodium && !wantsFurniture && !wantsSignage && !wantsCorporateGift) {
        if (!/\b(podium|podiums|pulpit|pulpits|lectern|lecterns|rostrum)\b|^ccp\d/i.test(combinedTaxonomy)) {
          continue;
        }
      }
      if (wantsFurniture && !wantsPodium) {
        if (
          !/\b(furniture|table|tables|chair|chairs|stool|stools|desk|console|bench|pedestal)\b/i.test(
            combinedTaxonomy
          ) ||
          /\b(podium|pulpit|lectern|rostrum|machine|oven)\b/i.test(combinedTaxonomy)
        ) {
          continue;
        }
      }
      if (wantsSignage && !wantsPodium && !wantsFurniture) {
        if (
          !/\b(sign|signage|name\s*plate|nameplate|name\s*board|frame|holder|display)\b/i.test(
            combinedTaxonomy
          ) ||
          /\b(podium|pulpit|lectern|machine|oven)\b/i.test(combinedTaxonomy)
        ) {
          continue;
        }
      }
      if (wantsCorporateGift && !wantsPodium && !wantsFurniture) {
        if (
          !/\b(trophy|trophies|memento|mementos|award|awards|plaque|gift|paper\s*weight|paperweight|pen\s*stand|keychain|coaster|tray|organizer|tissue|frame|stand|holder)\b/i.test(
            combinedTaxonomy
          ) ||
          /\b(podium|pulpit|lectern|machine|oven|sheet|rod|tube)\b/i.test(combinedTaxonomy)
        ) {
          continue;
        }
      }
      if (
        wantsAward &&
        !wantsCorporateGift &&
        (!/\b(trophy|trophies|award|awards|memento|mementos|plaque|plaques|medal|medals|shield|shields)\b/i.test(
          combinedTaxonomy
        ) ||
          /\b(podium|pulpit|lectern|tray|machine|oven)\b/i.test(combinedTaxonomy))
      ) {
        continue;
      }
      if (
        wantsTray &&
        /\b(podium|pulpit|lectern|trophy|award|machine|oven|tube|keyway)\b/i.test(
          combinedTaxonomy
        )
      ) {
        continue;
      }
    }

    // 3. Strict budget enforcement & unknown-price handling (never filter out explicit SKU comparisons or quote-based gift/award/signage categories!)
    if (!isExplicitCodeHit && (maxPrice !== null || minPrice !== null)) {
      const hasValidPrice = typeof item.basePrice === "number" && item.basePrice > 0;
      if (!hasValidPrice) {
        if (
          !options?.includeUnpricedOnBudget &&
          !wantsCorporateGift &&
          !wantsAward &&
          !wantsSignage
        ) {
          continue;
        }
      } else {
        if (maxPrice !== null && item.basePrice! > maxPrice) continue;
        if (minPrice !== null && item.basePrice! < minPrice) continue;
      }
    }

    const nameWords = tokenizeWords(item.name);
    const catWords = tokenizeWords(
      `${item.categoryName} ${(item.podiumSubCategoryNames || []).join(" ")}`
    );
    const deepText = `${item.description || ""} ${item.descriptionHtmlText || ""} ${item.importantNoteText || ""} ${item.specsSummary || ""} ${(item.features || []).join(" ")} ${(item.variants || []).map((v) => v.name).join(" ")} ${(item.industries || []).map((ind) => (typeof ind === "string" ? ind : `${ind.name} ${ind.description || ""}`)).join(" ")} ${(item.problemStatements || []).map((ps) => (typeof ps === "string" ? ps : `${ps.name} ${ps.description || ""}`)).join(" ")} ${(item.models || []).map((m) => m.specifications.map((s) => `${s.label || s.key || ""} ${s.value}`).join(" ")).join(" ")}`;
    const descWords = tokenizeWords(deepText);

    let matchScore = 0;

    // Boost exact product/model codes (e.g., CCP054, CCP065, YN-JW1200, ABM-1250, CW-5300)
    if (explicitCodes.length > 0) {
      for (const code of explicitCodes) {
        if (
          skuCompact === code ||
          skuCompact.includes(code) ||
          slugCompact.includes(code) ||
          modelCompact.includes(code)
        ) {
          matchScore += skuCompact === code || slugCompact.endsWith(code) ? 520 : 320;
        }
      }
    }

    // Exact Dimension Pair & Height Range Scoring (e.g., "22 × 16-inch top surface" -> CCP065)
    if (queryDims.pairs.length > 0 || queryDims.ranges.length > 0) {
      const topSheetSpec = (item.dimensions || []).find((d) =>
        /top\s*sheet|reading\s*top|top\s*surface|top/i.test(d.label || d.key || "")
      );
      const topSheetDims = extractCompactDimensionPairsFromText(topSheetSpec?.value || "");
      const allStructDims = extractCompactDimensionPairsFromText(
        `${(item.dimensions || []).map((d) => `${d.label || d.key || ""} ${d.value}`).join(" ")} ${(item.specifications || []).map((s) => `${s.label || s.key || ""} ${s.value}`).join(" ")}`
      );
      const allDescDims = extractCompactDimensionPairsFromText(deepText);

      for (const qPair of queryDims.pairs) {
        if (topSheetDims.pairs.includes(qPair)) {
          matchScore += wantsTopSurface ? 380 : 280;
        } else if (allStructDims.pairs.includes(qPair)) {
          matchScore += 240;
        } else if (allDescDims.pairs.includes(qPair)) {
          matchScore += 160;
        }
      }

      for (const qRange of queryDims.ranges) {
        if (allStructDims.ranges.includes(qRange) || allDescDims.ranges.includes(qRange)) {
          matchScore += 220;
        }
      }
    }

    // Boost compact / smaller-top podiums when user asks for smaller top or cheaper alternative
    if (wantsSmallerTop && wantsPodium) {
      const topSpec = (item.dimensions || []).find((d) =>
        /top\s*sheet|reading\s*top/i.test(d.label || d.key || "")
      );
      if (topSpec && /\b(18\s*[x×]\s*1[2456]|19\s*[x×]\s*15|20\s*[x×]\s*15|20\s*[x×]\s*16)\b/i.test(topSpec.value)) {
        matchScore += 45;
      }
      if ((item.podiumSubCategoryNames || []).some((sub) => /essential/i.test(sub))) {
        matchScore += 30;
      }
    }

    for (const tok of directTokens) {
      const tokCompact = tok.replace(/[-_\s]+/g, "");
      if (skuLower && (skuLower.includes(tok) || skuCompact.includes(tokCompact)) && tok.length >= 3) {
        matchScore += 32;
      } else if (modelLower && (modelLower.includes(tok) || modelCompact.includes(tokCompact)) && tok.length >= 3) {
        matchScore += 30;
      }
      if (nameWords.some((w) => wordMatchesToken(w, tok))) {
        matchScore += 24;
      }
      if (catWords.some((w) => wordMatchesToken(w, tok))) {
        matchScore += 18;
      }
      if (descWords.some((w) => wordMatchesToken(w, tok))) {
        matchScore += 7;
      }
    }

    // Score specific measurement tokens ("24", "20", "1600") against dimensions/model specs
    if (measurementTokens.length > 0) {
      const dimAndModelBlob = `${(item.dimensions || []).map((d) => `${d.label || d.key || ""} ${d.value}`).join(" ")} ${item.descriptionHtmlText || ""} ${modelLower} ${(item.models || []).map((m) => m.specifications.map((s) => `${s.label || s.key || ""} ${s.value}`).join(" ")).join(" ")}`.toLowerCase();
      let matchedMeasurements = 0;
      for (const mTok of measurementTokens) {
        if (dimAndModelBlob.includes(mTok)) {
          matchedMeasurements++;
        }
      }
      if (matchedMeasurements > 0) {
        matchScore += matchedMeasurements * 14;
      }
    }

    for (const syn of expandedSynonyms) {
      if (nameWords.some((w) => wordMatchesToken(w, syn))) {
        matchScore += 18;
      } else if (catWords.some((w) => wordMatchesToken(w, syn))) {
        matchScore += 14;
      } else if (skuLower && syn.length >= 3 && skuLower.startsWith(syn)) {
        matchScore += 12;
      }
    }

    // Reject weak description-only matches (require at least 14 topical points)
    if (matchScore < 14) continue;

    if (wantsMachineOrTool && item.brand === "CLASSIC_EDGE_53") {
      matchScore += 10;
    }

    if (maxPrice !== null || minPrice !== null || preferCheapest || preferPremium) {
      if (typeof item.basePrice === "number" && item.basePrice > 0) {
        matchScore += 18;
      }
    }

    // Deprioritize already-shown slugs when user asks for "any more options" or "other models"
    if (
      !isExplicitCodeHit &&
      excludeSlugSet.size > 0 &&
      (excludeSlugSet.has((item.slug || "").toLowerCase()) ||
        excludeSlugSet.has((item.sku || "").toLowerCase()))
    ) {
      matchScore -= 80;
    }

    scored.push({ item, score: matchScore });
  }

  scored.sort((a, b) => {
    const aHasPrice = typeof a.item.basePrice === "number" && a.item.basePrice > 0;
    const bHasPrice = typeof b.item.basePrice === "number" && b.item.basePrice > 0;
    if ((maxPrice !== null || minPrice !== null || preferCheapest || preferPremium) && aHasPrice !== bHasPrice) {
      return aHasPrice ? -1 : 1;
    }
    if (preferCheapest && aHasPrice && bHasPrice) {
      const aExcluded = excludeSlugSet.has((a.item.slug || "").toLowerCase());
      const bExcluded = excludeSlugSet.has((b.item.slug || "").toLowerCase());
      if (aExcluded !== bExcluded) return aExcluded ? 1 : -1;
      return (a.item.basePrice || 0) - (b.item.basePrice || 0);
    }
    if (preferPremium && aHasPrice && bHasPrice) {
      if (Math.abs(b.score - a.score) <= 40) {
        return (b.item.basePrice || 0) - (a.item.basePrice || 0);
      }
    }
    if (b.score !== a.score) return b.score - a.score;
    const aP = aHasPrice ? a.item.basePrice! : Infinity;
    const bP = bHasPrice ? b.item.basePrice! : Infinity;
    return preferPremium ? bP - aP : aP - bP;
  });

  return scored.slice(0, limit).map((s) => s.item);
}

/**
 * When a strict budget query (e.g. "pulpits under ₹5,000") yields 0 verified within-budget matches,
 * returns the lowest verified starting price in that category and any custom-quote alternatives
 * so ACRIO can explain honestly without returning over-budget or unpriced items as false matches.
 */
export function getEcosystemBudgetFallbackInfo(
  items: MainWebsiteProduct[],
  searchQuery: string,
  options?: EcosystemSearchOptions
): {
  lowestAvailablePrice: number | null;
  lowestAvailableItem: MainWebsiteProduct | null;
  customQuoteCount: number;
} {
  const withoutBudgetMatches = searchEcosystemItems(items, searchQuery, 25, {
    ...options,
    minPrice: null,
    maxPrice: null,
  });
  const priced = withoutBudgetMatches
    .filter((it) => typeof it.basePrice === "number" && it.basePrice > 0)
    .sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));
  const unpriced = withoutBudgetMatches.filter(
    (it) => !(typeof it.basePrice === "number" && it.basePrice > 0)
  );
  return {
    lowestAvailablePrice: priced[0]?.basePrice ?? null,
    lowestAvailableItem: priced[0] ?? null,
    customQuoteCount: unpriced.length,
  };
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

export interface EcosystemEnquiryRecord {
  id: string;
  externalId: string;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  brandLabel: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  productName: string;
  source: string;
  message: string;
  status: "New" | "Replied";
  aiSuggestedReply: string;
  lastReplyText: string;
  lastReplyChannel: string;
  repliedByName: string;
  repliedAt: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

let ecoEnqTableChecked = false;
export async function ensureEcosystemEnquiriesTable(): Promise<void> {
  if (ecoEnqTableChecked) return;
  const crm = getRawLibSqlClient("crm_orders");
  await crm.batch(
    [
      `CREATE TABLE IF NOT EXISTS ecosystem_enquiries (
        id TEXT PRIMARY KEY,
        external_id TEXT NOT NULL,
        brand TEXT NOT NULL,
        brand_label TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        product_name TEXT DEFAULT '',
        source TEXT NOT NULL DEFAULT 'Website Form',
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'New',
        ai_suggested_reply TEXT DEFAULT '',
        last_reply_text TEXT DEFAULT '',
        last_reply_channel TEXT DEFAULT '',
        replied_by_name TEXT DEFAULT '',
        replied_at TEXT,
        conversation_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_eco_enq_created ON ecosystem_enquiries (created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_eco_enq_phone ON ecosystem_enquiries (customer_phone)`,
      `CREATE INDEX IF NOT EXISTS idx_eco_enq_brand_status ON ecosystem_enquiries (brand, status)`,
    ],
    "write"
  );
  ecoEnqTableChecked = true;
}

function mapEcosystemEnquiryRow(r: Record<string, unknown>): EcosystemEnquiryRecord {
  const brand =
    String(r.brand || "") === "CLASSIC_EDGE_53"
      ? "CLASSIC_EDGE_53"
      : "CLASSIC_CONCEPTS";
  return {
    id: String(r.id),
    externalId: String(r.external_id || String(r.id).replace(/^(cc_|ce53_|ce_)/, "")),
    brand,
    brandLabel:
      String(r.brand_label || "") ||
      (brand === "CLASSIC_EDGE_53"
        ? "Classic Edge 53 (classicedge53.com)"
        : "Classic Concepts (classicconcepts.in)"),
    customerName: String(r.customer_name || "Customer"),
    customerEmail: String(r.customer_email || ""),
    customerPhone: String(r.customer_phone || ""),
    productName: String(r.product_name || ""),
    source: String(r.source || "Website Form"),
    message: String(r.message || ""),
    status: String(r.status || "New") === "Replied" ? "Replied" : "New",
    aiSuggestedReply: String(r.ai_suggested_reply || ""),
    lastReplyText: String(r.last_reply_text || ""),
    lastReplyChannel: String(r.last_reply_channel || ""),
    repliedByName: String(r.replied_by_name || ""),
    repliedAt: r.replied_at ? String(r.replied_at) : null,
    conversationId: r.conversation_id ? String(r.conversation_id) : null,
    createdAt: String(r.created_at || new Date().toISOString()),
    updatedAt: String(r.updated_at || new Date().toISOString()),
  };
}

export async function upsertEcosystemEnquiry(params: {
  externalId: string;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  productName?: string;
  source?: string;
  message: string;
  status?: "New" | "Replied" | string;
  aiSuggestedReply?: string;
  lastReplyText?: string;
  lastReplyChannel?: string;
  repliedByName?: string;
  repliedAt?: string | null;
  conversationId?: string | null;
  createdAt?: string;
}): Promise<EcosystemEnquiryRecord> {
  await ensureEcosystemEnquiriesTable();
  const crm = getRawLibSqlClient("crm_orders");
  const cleanExtId = String(params.externalId || "").replace(/^(cc_|ce53_|ce_)/, "").trim();
  const prefix = params.brand === "CLASSIC_EDGE_53" ? "ce53" : "cc";
  const id = `${prefix}_${cleanExtId || crypto.randomUUID().slice(0, 10)}`;
  const brandLabel =
    params.brand === "CLASSIC_EDGE_53"
      ? "Classic Edge 53 (classicedge53.com)"
      : "Classic Concepts (classicconcepts.in)";
  const nowIso = new Date().toISOString();

  const existingRes = await crm.execute({
    sql: `SELECT * FROM ecosystem_enquiries WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const ex = existingRes.rows[0] as Record<string, unknown> | undefined;

  const finalStatus =
    String(params.status || "").toLowerCase() === "replied" ||
    String(ex?.status || "").toLowerCase() === "replied"
      ? "Replied"
      : "New";
  const finalCreatedAt =
    params.createdAt || (ex?.created_at ? String(ex.created_at) : nowIso);
  const finalAiReply =
    params.aiSuggestedReply !== undefined && params.aiSuggestedReply.trim()
      ? params.aiSuggestedReply.trim()
      : String(ex?.ai_suggested_reply || "");
  const finalLastReply =
    params.lastReplyText !== undefined && params.lastReplyText.trim()
      ? params.lastReplyText.trim()
      : String(ex?.last_reply_text || "");
  const finalChannel =
    params.lastReplyChannel !== undefined && params.lastReplyChannel.trim()
      ? params.lastReplyChannel.trim()
      : String(ex?.last_reply_channel || "");
  const finalRepliedBy =
    params.repliedByName !== undefined && params.repliedByName.trim()
      ? params.repliedByName.trim()
      : String(ex?.replied_by_name || "");
  const finalRepliedAt =
    params.repliedAt !== undefined && params.repliedAt
      ? params.repliedAt
      : ex?.replied_at
      ? String(ex.replied_at)
      : finalStatus === "Replied"
      ? nowIso
      : null;
  const finalConvId =
    params.conversationId !== undefined && params.conversationId
      ? params.conversationId
      : ex?.conversation_id
      ? String(ex.conversation_id)
      : null;

  await crm.execute({
    sql: `INSERT INTO ecosystem_enquiries (
      id, external_id, brand, brand_label, customer_name, customer_email, customer_phone,
      product_name, source, message, status, ai_suggested_reply, last_reply_text,
      last_reply_channel, replied_by_name, replied_at, conversation_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      customer_name = COALESCE(NULLIF(excluded.customer_name, ''), ecosystem_enquiries.customer_name),
      customer_email = COALESCE(NULLIF(excluded.customer_email, ''), ecosystem_enquiries.customer_email),
      customer_phone = COALESCE(NULLIF(excluded.customer_phone, ''), ecosystem_enquiries.customer_phone),
      product_name = COALESCE(NULLIF(excluded.product_name, ''), ecosystem_enquiries.product_name),
      source = COALESCE(NULLIF(excluded.source, ''), ecosystem_enquiries.source),
      message = COALESCE(NULLIF(excluded.message, ''), ecosystem_enquiries.message),
      status = excluded.status,
      ai_suggested_reply = COALESCE(NULLIF(excluded.ai_suggested_reply, ''), ecosystem_enquiries.ai_suggested_reply),
      last_reply_text = COALESCE(NULLIF(excluded.last_reply_text, ''), ecosystem_enquiries.last_reply_text),
      last_reply_channel = COALESCE(NULLIF(excluded.last_reply_channel, ''), ecosystem_enquiries.last_reply_channel),
      replied_by_name = COALESCE(NULLIF(excluded.replied_by_name, ''), ecosystem_enquiries.replied_by_name),
      replied_at = COALESCE(excluded.replied_at, ecosystem_enquiries.replied_at),
      conversation_id = COALESCE(excluded.conversation_id, ecosystem_enquiries.conversation_id),
      updated_at = excluded.updated_at`,
    args: [
      id,
      cleanExtId,
      params.brand,
      brandLabel,
      params.customerName || "Customer",
      params.customerEmail || "",
      params.customerPhone || "",
      params.productName || "",
      params.source || (params.brand === "CLASSIC_EDGE_53" ? "Classic Edge 53 Website" : "Classic Concepts Website"),
      params.message || "",
      finalStatus,
      finalAiReply,
      finalLastReply,
      finalChannel,
      finalRepliedBy,
      finalRepliedAt,
      finalConvId,
      finalCreatedAt,
      nowIso,
    ],
  });

  const savedRes = await crm.execute({
    sql: `SELECT * FROM ecosystem_enquiries WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return mapEcosystemEnquiryRow((savedRes.rows[0] || {}) as Record<string, unknown>);
}

export async function syncWebsiteEnquiryStatusAcrossSites(params: {
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  externalId: string;
  replyMessage?: string;
  sendEmailOnSite?: boolean;
}): Promise<{ bridgeUpdated: boolean; dbUpdated: boolean; emailDeliveredBySite: boolean; emailError?: string }> {
  const cleanExtId = String(params.externalId || "").replace(/^(cc_|ce53_|ce_)/, "").trim();
  if (!cleanExtId) {
    return { bridgeUpdated: false, dbUpdated: false, emailDeliveredBySite: false };
  }

  let bridgeUpdated = false;
  let dbUpdated = false;
  let emailDeliveredBySite = false;
  let emailError: string | undefined;

  // 1. Update directly via local SQLite client if available on this host
  try {
    if (params.brand === "CLASSIC_CONCEPTS") {
      const ccClient = getMainCatalogClient();
      if (ccClient) {
        await ccClient.execute({
          sql: `UPDATE Enquiry SET status = 'Replied' WHERE id = ?`,
          args: [cleanExtId],
        });
        dbUpdated = true;
      }
    } else {
      const ceClient = getClassicEdgeClient();
      if (ceClient) {
        await ceClient.execute({
          sql: `UPDATE Enquiry SET repliedAt = ? WHERE id = ?`,
          args: [new Date().toISOString(), cleanExtId],
        });
        dbUpdated = true;
      }
    }
  } catch {
    // Non-blocking
  }

  // 2. Call internal HTTP webhook on Classic Concepts (:3003) or Classic Edge 53 (:3002)
  const targetBaseUrl =
    params.brand === "CLASSIC_EDGE_53"
      ? resolveClassicEdgeInternalUrl()
      : resolveClassicConceptsInternalUrl();
  const key = resolveEcosystemBridgeKey();

  try {
    const res = await fetch(`${targetBaseUrl}/api/internal/bridge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cc-bridge-key": key,
      },
      body: JSON.stringify({
        action: params.sendEmailOnSite ? "reply_enquiry" : "mark_enquiry_replied",
        enquiryId: cleanExtId,
        replyMessage: params.replyMessage || "",
        sendEmail: Boolean(params.sendEmailOnSite),
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data: any = await res.json().catch(() => ({}));
      bridgeUpdated = Boolean(data?.ok);
      emailDeliveredBySite = Boolean(data?.emailDelivered);
      if (data?.emailError) emailError = String(data.emailError);
    }
  } catch {
    // Non-blocking if sibling site is offline in local dev
  }

  return { bridgeUpdated, dbUpdated, emailDeliveredBySite, emailError };
}

export async function syncAndListEcosystemEnquiries(filters?: {
  brand?: "ALL" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  status?: "ALL" | "New" | "Replied";
  search?: string;
  limit?: number;
}): Promise<EcosystemEnquiryRecord[]> {
  await ensureEcosystemEnquiriesTable();
  const crm = getRawLibSqlClient("crm_orders");
  const key = resolveEcosystemBridgeKey();

  // 1. Pull from Classic Concepts SQLite + HTTP bridge
  try {
    const ccClient = getMainCatalogClient();
    if (ccClient) {
      const res = await ccClient.execute(
        `SELECT id, name, email, phone, message, source, status, createdAt FROM Enquiry ORDER BY createdAt DESC LIMIT 200`
      );
      for (const r of res.rows) {
        const createdIso =
          typeof r.createdAt === "number"
            ? new Date(r.createdAt).toISOString()
            : String(r.createdAt || new Date().toISOString());
        await upsertEcosystemEnquiry({
          externalId: String(r.id),
          brand: "CLASSIC_CONCEPTS",
          customerName: String(r.name || "Customer"),
          customerEmail: String(r.email || ""),
          customerPhone: String(r.phone || ""),
          source: String(r.source || "Classic Concepts Website"),
          message: String(r.message || ""),
          status: String(r.status || "New"),
          createdAt: createdIso,
        });
      }
    }
  } catch {
    // Non-blocking
  }

  // 2. Pull from Classic Edge 53 SQLite + HTTP bridge
  try {
    const ceClient = getClassicEdgeClient();
    if (ceClient) {
      const res = await ceClient.execute(
        `SELECT id, name, email, phone, message, productName, repliedAt, createdAt FROM Enquiry ORDER BY createdAt DESC LIMIT 200`
      );
      for (const r of res.rows) {
        const prod = r.productName ? String(r.productName) : "";
        const createdIso =
          typeof r.createdAt === "number"
            ? new Date(r.createdAt).toISOString()
            : String(r.createdAt || new Date().toISOString());
        const repliedIso = r.repliedAt
          ? typeof r.repliedAt === "number"
            ? new Date(r.repliedAt).toISOString()
            : String(r.repliedAt)
          : null;
        await upsertEcosystemEnquiry({
          externalId: String(r.id),
          brand: "CLASSIC_EDGE_53",
          customerName: String(r.name || "Customer"),
          customerEmail: String(r.email || ""),
          customerPhone: String(r.phone || ""),
          productName: prod,
          source: prod ? `Classic Edge 53 (${prod})` : "Classic Edge 53 Website",
          message: String(r.message || ""),
          status: r.repliedAt ? "Replied" : "New",
          repliedAt: repliedIso,
          createdAt: createdIso,
        });
      }
    }
  } catch {
    // Non-blocking
  }

  // 3. Also pull via HTTP Bridges (:3003 & :3002) in case databases are on separate paths
  const bridgeTargets: Array<{
    url: string;
    brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  }> = [
    { url: resolveClassicConceptsInternalUrl(), brand: "CLASSIC_CONCEPTS" },
    { url: resolveClassicEdgeInternalUrl(), brand: "CLASSIC_EDGE_53" },
  ];
  await Promise.all(
    bridgeTargets.map(async (bt) => {
      try {
        const res = await fetch(
          `${bt.url}/api/internal/bridge?action=enquiries&limit=100`,
          {
            headers: { "x-cc-bridge-key": key },
            signal: AbortSignal.timeout(2200),
          }
        );
        if (!res.ok) return;
        const json: any = await res.json().catch(() => ({}));
        const list: any[] = Array.isArray(json?.enquiries) ? json.enquiries : [];
        for (const e of list) {
          await upsertEcosystemEnquiry({
            externalId: String(e.id),
            brand: bt.brand,
            customerName: String(e.name || "Customer"),
            customerEmail: String(e.email || ""),
            customerPhone: String(e.phone || ""),
            productName: String(e.productName || ""),
            source:
              String(e.source || "") ||
              (bt.brand === "CLASSIC_EDGE_53"
                ? "Classic Edge 53 Website"
                : "Classic Concepts Website"),
            message: String(e.message || "").replace(/^\[Machine:\s*[^\]]+\]\s*/i, ""),
            status: String(e.status || "New"),
            createdAt: String(e.createdAt || new Date().toISOString()),
          });
        }
      } catch {
        // Non-blocking
      }
    })
  );

  // 4. Also backfill from website_enquiry_sync_logs if any enquiries arrived via webhook earlier
  try {
    const syncLogs = await crm
      .execute(
        `SELECT * FROM website_enquiry_sync_logs ORDER BY created_at DESC LIMIT 100`
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    for (const log of syncLogs.rows) {
      const extKey = String(log.external_key || "");
      const brand =
        String(log.brand || "") === "CLASSIC_EDGE_53"
          ? "CLASSIC_EDGE_53"
          : "CLASSIC_CONCEPTS";
      const extId = extKey.replace(/^(CLASSIC_CONCEPTS:|CLASSIC_EDGE_53:)/, "");
      if (!extId) continue;
      await upsertEcosystemEnquiry({
        externalId: extId,
        brand,
        customerName: String(log.customer_name || "Customer"),
        customerEmail: String(log.customer_email || ""),
        customerPhone: String(log.customer_phone || ""),
        productName: String(log.product_name || ""),
        message: String(log.message || "Customer Website Enquiry"),
        aiSuggestedReply: String(log.smart_reply_text || ""),
        conversationId: log.conversation_id ? String(log.conversation_id) : null,
        createdAt: String(log.created_at || new Date().toISOString()),
      });
    }
  } catch {
    // Non-blocking
  }

  // 5. Query filtered list from ecosystem_enquiries
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filters?.brand && filters.brand !== "ALL") {
    where.push("brand = ?");
    args.push(filters.brand);
  }
  if (filters?.status && filters.status !== "ALL") {
    where.push("status = ?");
    args.push(filters.status);
  }
  if (filters?.search?.trim()) {
    const q = `%${filters.search.trim().toLowerCase()}%`;
    where.push(
      "(LOWER(customer_name) LIKE ? OR LOWER(customer_email) LIKE ? OR LOWER(customer_phone) LIKE ? OR LOWER(message) LIKE ? OR LOWER(product_name) LIKE ? OR LOWER(source) LIKE ?)"
    );
    args.push(q, q, q, q, q, q);
  }

  const limit = Math.min(500, Math.max(1, filters?.limit ?? 200));
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rowsRes = await crm.execute({
    sql: `SELECT * FROM ecosystem_enquiries ${whereSql} ORDER BY created_at DESC LIMIT ${limit}`,
    args,
  });

  return rowsRes.rows.map((r) =>
    mapEcosystemEnquiryRow(r as Record<string, unknown>)
  );
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
      path.resolve(/*turbopackIgnore: true*/ root, "..", "classicconcepts", ".env.production"),
      path.resolve(/*turbopackIgnore: true*/ root, "..", "classicconcepts", ".env"),
      path.resolve(/*turbopackIgnore: true*/ root, "..", "classicconcepts", ".env.local"),
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
      if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
        const content = fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8");
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
  if (!fs.existsSync(/*turbopackIgnore: true*/ targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }

  const files: { domain: string; filePath: string; sizeBytes: number }[] = [];
  let totalBytes = 0;

  for (const domain of Object.keys(DATABASE_FILES) as DatabaseDomain[]) {
    const client = getRawLibSqlClient(domain);
    const outFile = path.join(/*turbopackIgnore: true*/ targetFolder, DATABASE_FILES[domain]);
    if (fs.existsSync(/*turbopackIgnore: true*/ outFile)) fs.unlinkSync(/*turbopackIgnore: true*/ outFile);
    const escapedPath = outFile.replace(/\\/g, "/").replace(/'/g, "''");
    await client.execute(`VACUUM INTO '${escapedPath}'`);
    const stat = fs.statSync(/*turbopackIgnore: true*/ outFile);
    files.push({ domain, filePath: outFile, sizeBytes: stat.size });
    totalBytes += stat.size;
  }

  if (includeMainWebsiteDb) {
    const mainDbPath = resolveMainWebsiteDbPath();
    if (mainDbPath && fs.existsSync(/*turbopackIgnore: true*/ mainDbPath)) {
      const mainClient = getMainCatalogClient();
      const outMain = path.join(/*turbopackIgnore: true*/ targetFolder, "classicconcepts_website.db");
      if (fs.existsSync(/*turbopackIgnore: true*/ outMain)) fs.unlinkSync(/*turbopackIgnore: true*/ outMain);
      if (mainClient) {
        const escapedMain = outMain.replace(/\\/g, "/").replace(/'/g, "''");
        await mainClient.execute(`VACUUM INTO '${escapedMain}'`);
      } else {
        fs.copyFileSync(/*turbopackIgnore: true*/ mainDbPath, /*turbopackIgnore: true*/ outMain);
      }
      const stat = fs.statSync(/*turbopackIgnore: true*/ outMain);
      files.push({
        domain: "classicconcepts_website",
        filePath: outMain,
        sizeBytes: stat.size,
      });
      totalBytes += stat.size;
    }

    const edgeDbPath = resolveClassicEdgeDbPath();
    if (edgeDbPath && fs.existsSync(/*turbopackIgnore: true*/ edgeDbPath)) {
      const edgeClient = getClassicEdgeClient();
      const outEdge = path.join(/*turbopackIgnore: true*/ targetFolder, "classicedge53_machines.db");
      if (fs.existsSync(/*turbopackIgnore: true*/ outEdge)) fs.unlinkSync(/*turbopackIgnore: true*/ outEdge);
      if (edgeClient) {
        const escapedEdge = outEdge.replace(/\\/g, "/").replace(/'/g, "''");
        await edgeClient.execute(`VACUUM INTO '${escapedEdge}'`);
      } else {
        fs.copyFileSync(/*turbopackIgnore: true*/ edgeDbPath, /*turbopackIgnore: true*/ outEdge);
      }
      const stat = fs.statSync(/*turbopackIgnore: true*/ outEdge);
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
    const sizeBytes = fs.existsSync(/*turbopackIgnore: true*/ filePath) ? fs.statSync(/*turbopackIgnore: true*/ filePath).size : 0;

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
    id: "ce53-diamond-edge-polisher",
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
    description:
      "Industrial high-speed diamond cutter edge polishing machine for thick cast acrylic sheets up to 100mm, delivering crystal-clear mirror edges in a single pass.",
    features: [
      "Single-pass optical mirror edge finish on cast and extruded acrylic",
      "Precision PCD and natural diamond cutter spindle with low vibration",
      "Adjustable feed speed and cutter depth for thin to extra-thick blocks",
      "Pneumatic clamping beam for distortion-free workpiece holding",
    ],
    specifications: [
      { label: "Max Sheet Thickness", value: "3mm to 100mm", type: "specification" },
      { label: "Spindle Speed", value: "0 - 9000 RPM Variable", type: "specification" },
      { label: "Polishing Angle", value: "0 to 45 Degrees Bevel & Straight", type: "specification" },
      { label: "Power Supply", value: "380V 3-Phase 50Hz", type: "specification" },
    ],
    models: [
      {
        id: "model-yn-jw1200",
        modelName: "YN-JW1200",
        specifications: [
          { label: "Working Length", value: "1200 mm" },
          { label: "Max Sheet Thickness", value: "3mm to 80mm" },
          { label: "Main Spindle Power", value: "1.8 kW" },
          { label: "Polishing Angle", value: "0 degrees straight edge" },
        ],
        resources: [
          {
            title: "YN-JW1200 Technical Datasheet",
            type: "Specification Sheet",
            url: "https://classicedge53.com/products",
          },
        ],
        consumables: ["PCD & Natural Single-Crystal Diamond Polishing Cutters"],
      },
      {
        id: "model-yn-jw1600",
        modelName: "YN-JW1600",
        specifications: [
          { label: "Working Length", value: "1600 mm" },
          { label: "Max Sheet Thickness", value: "3mm to 100mm" },
          { label: "Main Spindle Power", value: "2.2 kW" },
          { label: "Polishing Angle", value: "0 to 45 degrees bevel and straight" },
        ],
        resources: [
          {
            title: "YN-JW1600 Technical Datasheet",
            type: "Specification Sheet",
            url: "https://classicedge53.com/products",
          },
        ],
        consumables: ["PCD & Natural Single-Crystal Diamond Polishing Cutters"],
      },
    ],
    resources: [
      {
        title: "Diamond Edge Polisher Operation & Maintenance Guide",
        type: "User Manual",
        url: "https://classicedge53.com/products",
      },
    ],
    relatedConsumables: ["PCD & Natural Single-Crystal Diamond Polishing Cutters"],
    modelsSummary: "YN-JW1200, YN-JW1600",
    specsSummary:
      "Max Sheet Thickness: 3mm to 100mm, Spindle Speed: 0 - 9000 RPM Variable, Polishing Angle: 0 to 45 Degrees Bevel & Straight, Power Supply: 380V 3-Phase 50Hz | YN-JW1200: Working Length: 1200 mm, Max Sheet Thickness: 3mm to 80mm, Main Spindle Power: 1.8 kW | YN-JW1600: Working Length: 1600 mm, Max Sheet Thickness: 3mm to 100mm, Main Spindle Power: 2.2 kW",
    searchBlob:
      "acrylic diamond edge polishing machine yn-jw1200 yn-jw1600 1200mm 1600mm 3mm to 100mm 80mm 1.8 kw 2.2 kw 0 to 45 degrees bevel mirror finish pcd diamond cutters",
  },
  {
    id: "ce53-acrylic-line-bender",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "MACHINE",
    name: "Acrylic Sheet Line Bending & Heating Machine",
    slug: "acrylic-heat-bender",
    sku: "ABM-1250 / ABM-2400",
    categoryName: "Acrylic Machine (Classic Edge 53)",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/products",
    description:
      "Precision water-circulated infrared heating and line bending machine for folding acrylic, polycarbonate, PVC, and PETG sheets without surface bubbling or warping.",
    features: [
      "Water-cooled aluminium heating table prevents surrounding sheet warping",
      "Digital PID temperature control for uniform heat distribution",
      "Angle-locking folding jig for repeatable podium, stand, and display bends",
      "Supports single-line and multi-line simultaneous heating",
    ],
    specifications: [
      { label: "Bending Width", value: "1250mm / 2400mm", type: "specification" },
      { label: "Sheet Thickness", value: "1mm to 15mm", type: "specification" },
      { label: "Cooling System", value: "Closed-Loop Water Circulation", type: "specification" },
      { label: "Applicable Materials", value: "Acrylic, PC, PVC, PETG, ABS", type: "specification" },
    ],
    models: [
      {
        id: "model-abm-1250",
        modelName: "ABM-1250",
        specifications: [
          { label: "Effective Bending Width", value: "1250 mm (4 Feet)" },
          { label: "Sheet Thickness Range", value: "1mm to 10mm" },
          { label: "Heating Zones", value: "Single Upper Heating Tube" },
          { label: "Power Consumption", value: "1.5 kW (220V Single Phase)" },
        ],
        resources: [],
        consumables: ["Nichrome & Quartz Heating Tubes for Line Benders"],
      },
      {
        id: "model-abm-2400",
        modelName: "ABM-2400",
        specifications: [
          { label: "Effective Bending Width", value: "2400 mm (8 Feet)" },
          { label: "Sheet Thickness Range", value: "1mm to 15mm" },
          { label: "Heating Zones", value: "Dual Upper & Lower Heating Tubes" },
          { label: "Power Consumption", value: "3.6 kW (220V Single Phase)" },
        ],
        resources: [],
        consumables: ["Nichrome & Quartz Heating Tubes for Line Benders"],
      },
    ],
    resources: [
      {
        title: "ABM Series Acrylic Line Bender Setup Guide",
        type: "Setup Guide",
        url: "https://classicedge53.com/products",
      },
    ],
    relatedConsumables: ["Nichrome & Quartz Heating Tubes for Line Benders"],
    modelsSummary: "ABM-1250, ABM-2400",
    specsSummary:
      "Bending Width: 1250mm / 2400mm, Sheet Thickness: 1mm to 15mm, Cooling System: Closed-Loop Water Circulation | ABM-1250: Effective Bending Width: 1250 mm (4 Feet), Sheet Thickness Range: 1mm to 10mm, Power Consumption: 1.5 kW | ABM-2400: Effective Bending Width: 2400 mm (8 Feet), Sheet Thickness Range: 1mm to 15mm, Dual Upper & Lower Heating Tubes, Power Consumption: 3.6 kW",
    searchBlob:
      "acrylic sheet line bending heating machine abm-1250 abm-2400 1250mm 2400mm 4 feet 8 feet 1mm to 10mm 1mm to 15mm 1.5 kw 3.6 kw water cooled pid temperature",
  },
  {
    id: "ce53-laser-cutting-system",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "MACHINE",
    name: "CO2 Acrylic Laser Cutting & Engraving Machine",
    slug: "co2-acrylic-laser-cutter",
    sku: "CE-LC1390 / CE-LC1325",
    categoryName: "Acrylic Machine (Classic Edge 53)",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/products",
    description:
      "Heavy-duty CO2 laser cutting and engraving system engineered for cast acrylic fabrication, trophies, podium panels, signage letters, and precision display parts.",
    features: [
      "Flame-polished crystal clear cut edges on cast acrylic up to 25mm",
      "Knife-blade bed designed to minimize back-reflection marks on clear sheets",
      "Ruida digital controller compatible with LightBurn and CorelDraw",
      "Industrial CW-5200 water chiller and exhaust blower included",
    ],
    specifications: [
      { label: "Working Bed Size", value: "1300x900mm / 1300x2500mm", type: "specification" },
      { label: "Laser Power", value: "100W / 130W / 150W RECI CO2", type: "specification" },
      { label: "Max Acrylic Cutting Thickness", value: "Up to 25mm Cast Acrylic", type: "specification" },
      { label: "Table Type", value: "Anodized Knife Blade & Honeycomb", type: "specification" },
    ],
    models: [
      {
        id: "model-ce-lc1390",
        modelName: "CE-LC1390",
        specifications: [
          { label: "Working Area", value: "1300 x 900 mm" },
          { label: "Laser Tube Options", value: "100W / 130W RECI CO2" },
          { label: "Max Acrylic Thickness", value: "20 mm" },
        ],
        resources: [],
        consumables: [],
      },
      {
        id: "model-ce-lc1325",
        modelName: "CE-LC1325",
        specifications: [
          { label: "Working Area", value: "1300 x 2500 mm (Full 8x4 Sheet)" },
          { label: "Laser Tube Options", value: "130W / 150W RECI CO2" },
          { label: "Max Acrylic Thickness", value: "25 mm" },
        ],
        resources: [],
        consumables: [],
      },
    ],
    resources: [],
    relatedConsumables: [],
    modelsSummary: "CE-LC1390, CE-LC1325",
    specsSummary:
      "Working Bed Size: 1300x900mm / 1300x2500mm, Laser Power: 100W / 130W / 150W RECI CO2, Max Acrylic Cutting Thickness: Up to 25mm | CE-LC1390: 1300 x 900 mm, Max 20 mm | CE-LC1325: 1300 x 2500 mm, Max 25 mm",
    searchBlob:
      "co2 acrylic laser cutting engraving machine ce-lc1390 ce-lc1325 1300x900mm 1300x2500mm 100w 130w 150w reci 20mm 25mm",
  },
  {
    id: "ce53-cnc-router-acrylic",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "MACHINE",
    name: "3-Axis Acrylic & Sign Making CNC Router",
    slug: "acrylic-cnc-router-1325",
    sku: "CE-CNC1325",
    categoryName: "Acrylic Machine (Classic Edge 53)",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/products",
    description:
      "High-rigidity 8x4 ft CNC router with mist cooling for heavy acrylic block routing, chamfering, grooving, LED letter housing, and composite sheet cutting.",
    features: [
      "Heavy welded tubular steel frame for vibration-free thick acrylic routing",
      "Dual-zone vacuum table with T-slot clamps for small and full-sheet parts",
      "Mist coolant sprayer prevents chip re-welding on acrylic edges",
    ],
    specifications: [
      { label: "Working Area", value: "1300mm x 2500mm x 200mm", type: "specification" },
      { label: "Spindle", value: "3.5kW / 4.5kW Water or Air Cooled", type: "specification" },
      { label: "Table Structure", value: "Vacuum Bed + T-Slot Aluminium Table", type: "specification" },
    ],
    models: [
      {
        id: "model-ce-cnc1325",
        modelName: "CE-CNC1325",
        specifications: [
          { label: "Working Area", value: "1300 x 2500 x 200 mm" },
          { label: "Spindle Power", value: "3.5 kW / 4.5 kW" },
          { label: "Drive System", value: "Helical Rack & Pinion + Linear Guides" },
        ],
        resources: [],
        consumables: ["Single-Flute Spiral Carbide CNC Router Bits for Acrylic"],
      },
    ],
    resources: [],
    relatedConsumables: ["Single-Flute Spiral Carbide CNC Router Bits for Acrylic"],
    modelsSummary: "CE-CNC1325",
    specsSummary:
      "Working Area: 1300mm x 2500mm x 200mm, Spindle: 3.5kW / 4.5kW Water or Air Cooled, Table Structure: Vacuum Bed + T-Slot Aluminium Table",
    searchBlob:
      "3-axis acrylic sign making cnc router ce-cnc1325 1300x2500mm 3.5kw 4.5kw vacuum bed",
  },
  {
    id: "ce53-flame-polishing-unit",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "MACHINE",
    name: "HHO Oxy-Hydrogen Acrylic Flame Polishing Machine",
    slug: "hho-acrylic-flame-polisher",
    sku: "CE-FP160 / CE-FP260",
    categoryName: "Acrylic Machine (Classic Edge 53)",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/products",
    description:
      "Portable oxy-hydrogen water-electrolysis flame polishing generator for rapid crystal-clear polishing of curved, internal, and intricate acrylic edges.",
    features: [
      "Produces clean oxy-hydrogen flame on demand using distilled water",
      "Ideal for curved edges, internal cutouts, and letters where diamond polishers cannot reach",
      "Multi-stage flashback arrestor and over-pressure safety cut-off",
    ],
    specifications: [
      { label: "Gas Output", value: "160 L/H to 260 L/H", type: "specification" },
      { label: "Max Acrylic Thickness", value: "Up to 12mm Curved & Internal Edges", type: "specification" },
      { label: "Consumable Medium", value: "Distilled Water + KOH Electrolyte", type: "specification" },
    ],
    models: [
      {
        id: "model-ce-fp160",
        modelName: "CE-FP160",
        specifications: [
          { label: "Gas Output", value: "160 L/H (Single Torch)" },
          { label: "Recommended Sheet Thickness", value: "1mm to 8mm" },
          { label: "Power", value: "600W 220V" },
        ],
        resources: [],
        consumables: [],
      },
      {
        id: "model-ce-fp260",
        modelName: "CE-FP260",
        specifications: [
          { label: "Gas Output", value: "260 L/H (Single or Dual Torch)" },
          { label: "Recommended Sheet Thickness", value: "1mm to 12mm" },
          { label: "Power", value: "1000W 220V" },
        ],
        resources: [],
        consumables: [],
      },
    ],
    resources: [],
    relatedConsumables: [],
    modelsSummary: "CE-FP160, CE-FP260",
    specsSummary:
      "Gas Output: 160 L/H to 260 L/H, Max Acrylic Thickness: Up to 12mm Curved & Internal Edges | CE-FP160: 160 L/H, 1mm to 8mm, 600W | CE-FP260: 260 L/H, 1mm to 12mm, 1000W",
    searchBlob:
      "hho oxy-hydrogen acrylic flame polishing machine ce-fp160 ce-fp260 160 l/h 260 l/h 12mm curved internal edges",
  },
  {
    id: "ce53-thermoforming-oven",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "MACHINE",
    name: "Industrial Acrylic Sheet Thermoforming & Softening Oven",
    slug: "acrylic-thermoforming-oven",
    sku: "CE-TO1525",
    categoryName: "Acrylic Machine (Classic Edge 53)",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/products",
    description:
      "Hot-air circulation industrial baking and softening oven for uniform heating of full acrylic sheets prior to 3D dome blowing, drape molding, and curved podium forming.",
    features: [
      "Dual-convection hot-air circulation keeps temperature uniform within +/- 2 C",
      "Pull-out PTFE-coated drawers prevent surface marks on softened acrylic sheets",
      "Digital timer and PID temperature controller up to 250 C",
    ],
    specifications: [
      { label: "Chamber Size", value: "1500mm x 2500mm", type: "specification" },
      { label: "Temperature Control", value: "PID Digital (Room Temp to 250°C)", type: "specification" },
    ],
    models: [
      {
        id: "model-ce-to1525",
        modelName: "CE-TO1525",
        specifications: [
          { label: "Internal Chamber Size", value: "1500 x 2500 x 450 mm" },
          { label: "Heating Power", value: "18 kW 3-Phase" },
          { label: "Temperature Range", value: "Room Temp to 250°C" },
        ],
        resources: [],
        consumables: [],
      },
    ],
    resources: [],
    relatedConsumables: [],
    modelsSummary: "CE-TO1525",
    specsSummary:
      "Chamber Size: 1500mm x 2500mm, Temperature Control: PID Digital (Room Temp to 250°C), Heating Power: 18 kW 3-Phase",
    searchBlob:
      "industrial acrylic sheet thermoforming softening oven ce-to1525 1500x2500mm 250c 18 kw",
  },
  {
    id: "ce53-pcd-diamond-cutters",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "CONSUMABLE",
    name: "PCD & Natural Single-Crystal Diamond Polishing Cutters",
    slug: "pcd-natural-diamond-polishing-blades",
    sku: "CE-PCD-SET",
    categoryName: "Acrylic Fabrication Consumables & Tools",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/consumables",
    description:
      "Replacement pre-milling PCD and natural monocrystalline diamond finish cutters for YN-JW series acrylic diamond edge polishing machines.",
    specsSummary:
      "Compatibility: YN-JW1200, YN-JW1600 & Standard Edge Polishers, Blade Types: Roughing PCD + Finishing Natural Diamond",
    searchBlob:
      "pcd natural single-crystal diamond polishing cutters ce-pcd-set yn-jw1200 yn-jw1600 consumable blades",
  },
  {
    id: "ce53-acrylic-cnc-bits",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "CONSUMABLE",
    name: "Single-Flute Spiral Carbide CNC Router Bits for Acrylic",
    slug: "single-flute-acrylic-cnc-bits",
    sku: "CE-BIT-OFLUTE",
    categoryName: "Acrylic Fabrication Consumables & Tools",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/consumables",
    description:
      "Mirror-polished O-flute solid carbide spiral end mills designed for chip-free upward evacuation and smooth edge cutting on cast and extruded acrylic.",
    specsSummary: "Shank Sizes: 3.175mm, 4mm, 6mm, 8mm, Flute Geometry: Mirror-Polished O-Flute Upcut",
    searchBlob:
      "single-flute spiral carbide cnc router bits for acrylic ce-bit-oflute 3.175mm 4mm 6mm 8mm consumable",
  },
  {
    id: "ce53-chloroform-bonding-applicators",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "CONSUMABLE",
    name: "Bubble-Free Acrylic Solvent Bonding Glue & Needle Applicators",
    slug: "acrylic-bonding-solvent-applicators",
    sku: "CE-BOND-KIT",
    categoryName: "Acrylic Fabrication Consumables & Tools",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/consumables",
    description:
      "Optical-clarity capillary acrylic welding adhesive, UV curing crystal glue, and precision stainless-steel needle applicator bottles for invisible podium and display joints.",
    specsSummary: "Application: Capillary Seam Welding & Heavy Block Bonding",
    searchBlob:
      "bubble-free acrylic solvent bonding glue needle applicators ce-bond-kit capillary welding consumable",
  },
  {
    id: "ce53-buffing-wheels-compounds",
    brand: "CLASSIC_EDGE_53",
    brandLabel: "Classic Edge 53",
    itemType: "CONSUMABLE",
    name: "Cotton Buffing Wheels, Heating Wires & Polishing Compounds",
    slug: "acrylic-buffing-wheels-heating-wires",
    sku: "CE-BUFF-KIT",
    categoryName: "Acrylic Fabrication Consumables & Tools",
    basePrice: null,
    mainImage: null,
    url: "https://classicedge53.com/consumables",
    description:
      "Layered unbleached cotton buffing wheels, white/brown acrylic polishing wax bars, and replacement nichrome/quartz heating elements for acrylic line benders.",
    specsSummary: "Use Case: Final Gloss Buffing & Line Bender Maintenance",
    searchBlob:
      "cotton buffing wheels heating wires polishing compounds ce-buff-kit nichrome quartz consumable",
  },
];

function parseMeasurementValuesFromSpec(val: string): {
  numbers: number[];
  area: number | null;
  maxNumber: number | null;
} {
  const nums = Array.from(val.matchAll(/\d+(?:\.\d+)?/g))
    .map((m) => Number(m[0]))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return { numbers: [], area: null, maxNumber: null };
  const areaMatch = val.match(/(\d+(?:\.\d+)?)\s*(?:x|×|by|\*)\s*(\d+(?:\.\d+)?)/i);
  const area = areaMatch ? Number(areaMatch[1]) * Number(areaMatch[2]) : null;
  const maxNumber = Math.max(...nums);
  return { numbers: nums, area, maxNumber };
}

/**
 * Stage 2 Question-Aware Deep Product Context & Deterministic Answer Builder for WhatsApp & Admin Copilot.
 * Formats only the relevant deep fields (dimensions, specifications, variants, features, models, notes, resources)
 * for Claude Haiku 5.5 and produces a verified factual answer for comparisons, dimensions, variants, and unverified specs.
 */
export function buildEcosystemDeepProductContextAndAnswer(params: {
  rawQuery: string;
  matchedItems: MainWebsiteProduct[];
  formatItemLink?: (item: MainWebsiteProduct) => string;
}): {
  promptCatalogContext: string;
  deterministicDeepAnswer: string | null;
  isDeepQuestion: boolean;
} {
  const { rawQuery, matchedItems, formatItemLink } = params;
  const q = rawQuery.trim().toLowerCase();
  const getLink = (it: MainWebsiteProduct) =>
    formatItemLink ? formatItemLink(it) : it.url;

  const isComparison =
    /\b(compare|comparison|difference|differences|differ|vs\.?|versus|between|wider|widest|larger|largest|bigger|biggest|taller|tallest|heavier|heaviest|which\s+one|which\s+of\s+these|which\s+podium|which\s+machine|which\s+model)\b/i.test(
      q
    );
  const isDimensionQuery =
    /\b(dimension|dimensions|size|sizes|height|width|wide|wider|depth|length|top\s*sheet|reading\s*top|reading\s*surface|bottom\s*sheet|base\s*size|front\s*panel|shelf\s*size|logo\s*panel|inch|inches|mm|cm|feet|ft|footprint)\b/i.test(
      q
    );
  const isVariantQuery =
    /\b(variant|variants|color|colors|colour|colours|finish|finishes|led|frosted|black|white|clear|silver|golden|gold|stainless|price\s+difference)\b/i.test(
      q
    );
  const isFeatureOrSpecQuery =
    /\b(spec|specs|specification|specifications|feature|features|material|pillar|pillars|wheel|wheels|warranty|weight|assembly|diy|note|notes|packaging|delivery|application|applications|industry|industries|brochure|manual|datasheet|video|consumable|consumables|model|models|spindle|power|thickness|working\s*length|working\s*area|bending\s*width)\b/i.test(
      q
    );
  const unverifiedThicknessOrSpecMatch = q.match(
    /\b(?:can\s+(?:this|the|it)|does\s+(?:this|the|it)|process|bend|cut|polish|support|handle)\b.*?\b(\d+)\s*(mm|inch|inches|kw|w|rpm|v|volt)\b|\b(motor\s+brand|power\s+consumption|exact\s+sheet\s+thickness|sheet\s+thickness\s+of\s+ccp\d+)\b/i
  );

  const explicitCodesInQuery = extractExplicitProductOrModelCodes(rawQuery);
  const queryDimsInDeep = extractCompactDimensionPairsFromText(rawQuery);
  const isSpecificModelOrTellMeQuery =
    explicitCodesInQuery.length > 0 ||
    queryDimsInDeep.pairs.length > 0 ||
    queryDimsInDeep.ranges.length > 0 ||
    /\b(tell\s+me\s+about|details\s+of|details\s+for|info\s+about|information\s+on|describe|what\s+is|everything\s+about)\b/i.test(
      q
    );

  const isDeepQuestion =
    isSpecificModelOrTellMeQuery ||
    isComparison ||
    isDimensionQuery ||
    isVariantQuery ||
    isFeatureOrSpecQuery ||
    Boolean(unverifiedThicknessOrSpecMatch);

  // Build Stage 2 Question-Aware Prompt Context
  const promptLines = matchedItems.slice(0, 12).map((it, idx) => {
    const priceLabel =
      typeof it.basePrice === "number" && it.basePrice > 0
        ? `₹${it.basePrice.toLocaleString("en-IN")}${
            it.regularPrice && it.regularPrice > it.basePrice
              ? ` (MRP ₹${it.regularPrice.toLocaleString("en-IN")})`
              : ""
          }`
        : "Custom Quote on Request";
    const lines: string[] = [
      `${idx + 1}. [${it.brandLabel}] *${it.name}*${it.sku ? ` (SKU/Model: ${it.sku})` : ""} | Category: ${it.categoryName} | Price: ${priceLabel} | Link: ${getLink(it)}`,
    ];

    if (it.dimensions && it.dimensions.length > 0) {
      lines.push(
        `   - Verified Dimensions: ${it.dimensions.map((d) => `${d.label || d.key || ""}: ${d.value}`).join("; ")}`
      );
    }
    const techSpecs = (it.specifications || []).filter((s) => s.type !== "dimension");
    if (techSpecs.length > 0) {
      lines.push(
        `   - Verified Technical Specifications: ${techSpecs.map((s) => `${s.label || s.key || ""}: ${s.value}`).join("; ")}`
      );
    } else if (it.specsSummary && (!it.dimensions || it.dimensions.length === 0)) {
      lines.push(`   - Verified Specifications: ${it.specsSummary}`);
    }
    if (it.variants && it.variants.length > 0) {
      lines.push(
        `   - Variants & Option Prices: ${it.variants
          .map((v) =>
            typeof v.price === "number" && v.price > 0
              ? `${v.name} (₹${v.price.toLocaleString("en-IN")})`
              : v.name
          )
          .join(", ")}`
      );
    }
    if (it.features && it.features.length > 0) {
      lines.push(`   - Key Features: ${it.features.slice(0, 8).join(" | ")}`);
    }
    if (it.models && it.models.length > 0) {
      for (const m of it.models) {
        const mSpecs = m.specifications.map((s) => `${s.label || s.key || ""}: ${s.value}`).join("; ");
        lines.push(`   - Machine Model [${m.modelName}]: ${mSpecs || "Standard configuration"}`);
      }
    }
    if (it.descriptionHtmlText || it.description) {
      lines.push(
        `   - Detailed Description: ${(it.descriptionHtmlText || it.description || "").slice(0, 420)}`
      );
    }
    if (it.importantNoteText) {
      lines.push(`   - Important Note: ${it.importantNoteText.slice(0, 260)}`);
    }
    if (it.industries && it.industries.length > 0) {
      lines.push(
        `   - Applications / Industries: ${it.industries
          .map((ind) => (typeof ind === "string" ? ind : ind.name))
          .join(", ")}`
      );
    }
    if (it.relatedConsumables && it.relatedConsumables.length > 0) {
      lines.push(
        `   - Compatible Consumables: ${it.relatedConsumables
          .map((c) => (typeof c === "string" ? c : c.name))
          .join(", ")}`
      );
    }
    if (it.resources && it.resources.length > 0) {
      lines.push(
        `   - Technical Resources: ${it.resources.map((r) => `${r.title || r.name || "Resource"}${r.type ? ` (${r.type})` : ""}`).join(", ")}`
      );
    }
    return lines.join("\n");
  });

  const promptCatalogContext = promptLines.join("\n\n");

  if (!isDeepQuestion || matchedItems.length === 0) {
    return {
      promptCatalogContext,
      deterministicDeepAnswer: null,
      isDeepQuestion,
    };
  }

  // Check for unverified capacity or missing spec questions (e.g., "Can the ABM-1250 process 20mm acrylic?" or "What is the exact acrylic sheet thickness in mm of CCP055?")
  if (unverifiedThicknessOrSpecMatch) {
    const primary = matchedItems[0];
    const requestedNum = unverifiedThicknessOrSpecMatch[1]
      ? Number(unverifiedThicknessOrSpecMatch[1])
      : null;
    const requestedUnit = (unverifiedThicknessOrSpecMatch[2] || "").toLowerCase();

    if (primary.brand === "CLASSIC_EDGE_53") {
      // Check if user mentioned a specific model like ABM-1250
      const targetModel =
        (primary.models || []).find((m) =>
          q.replace(/[-_\s]+/g, "").includes(m.modelName.toLowerCase().replace(/[-_\s]+/g, ""))
        ) || (primary.models || [])[0];
      const allSpecs = [
        ...(targetModel?.specifications || []),
        ...(primary.specifications || []),
      ];
      const thicknessSpec = allSpecs.find((s) =>
        /thickness/i.test(s.label || s.key || "")
      );
      if (thicknessSpec && requestedNum && requestedUnit === "mm") {
        const parsed = parseMeasurementValuesFromSpec(thicknessSpec.value);
        if (parsed.maxNumber !== null && requestedNum > parsed.maxNumber) {
          const otherModel = (primary.models || []).find(
            (m) => m.modelName !== targetModel?.modelName
          );
          const otherThickness = otherModel?.specifications.find((s) =>
            /thickness/i.test(s.label || s.key || "")
          );
          const lines: string[] = [
            `Based on our verified catalog specifications for the *${primary.name}*${targetModel ? ` (*${targetModel.modelName}*)` : ""}, its rated sheet thickness capacity is *${thicknessSpec.value}*, so *${requestedNum} mm* exceeds the verified limit for that model.`,
          ];
          if (otherModel && otherThickness) {
            lines.push(
              `• *${otherModel.modelName}* supports *${otherThickness.value}*.`
            );
          }
          lines.push(
            `• Product Specs: ${primary.specsSummary || thicknessSpec.value}`,
            `• View details: ${getLink(primary)}`,
            `\nIf you need to process *${requestedNum} mm* acrylic sheets, please share your application and our Classic Edge 53 engineering team will confirm the right heavy-duty machine or custom heating/cutting setup.`
          );
          return {
            promptCatalogContext,
            deterministicDeepAnswer: lines.join("\n"),
            isDeepQuestion: true,
          };
        }
      }
    }

    // Check if asking for an unverified spec on a Classic Concepts product (e.g., sheet thickness in mm or motor brand when not stored)
    if (
      primary.brand === "CLASSIC_CONCEPTS" &&
      /\b(thickness\s+in\s+mm|sheet\s+thickness|how\s+many\s+mm\s+thick|motor\s+brand|wattage)\b/i.test(
        q
      )
    ) {
      const hasThicknessInSpecs = (primary.specifications || []).some((s) =>
        /\b\d+\s*mm\b/i.test(`${s.label || s.key || ""} ${s.value}`)
      );
      if (!hasThicknessInSpecs) {
        const verifiedDims = (primary.dimensions || [])
          .map((d) => `${d.label || d.key || ""}: ${d.value}`)
          .join(", ");
        const verifiedSpecs = (primary.specifications || [])
          .filter((s) => s.type !== "dimension")
          .map((s) => `${s.label || s.key || ""}: ${s.value}`)
          .join(", ");
        return {
          promptCatalogContext,
          deterministicDeepAnswer: [
            `The exact acrylic sheet thickness in millimetres is not listed in the stored specifications for *${primary.name}* (${getLink(primary)}), so I will not guess that figure.`,
            verifiedDims ? `• *Verified Dimensions:* ${verifiedDims}` : "",
            verifiedSpecs ? `• *Verified Specifications:* ${verifiedSpecs}` : "",
            `\nReply here if you would like our manufacturing team in Hyderabad to confirm the exact sheet gauge for each panel or customize the thickness for your order.`,
          ]
            .filter(Boolean)
            .join("\n"),
          isDeepQuestion: true,
        };
      }
    }
  }

  // Handle Machine Model Comparisons (e.g., YN-JW1200 vs YN-JW1600, ABM-1250 vs ABM-2400)
  const machineWithModels = matchedItems.find(
    (it) => it.brand === "CLASSIC_EDGE_53" && (it.models || []).length >= 2
  );
  if (
    machineWithModels &&
    (isComparison ||
      (machineWithModels.models || []).some((m) =>
        q.replace(/[-_\s]+/g, "").includes(m.modelName.toLowerCase().replace(/[-_\s]+/g, ""))
      ))
  ) {
    const models = machineWithModels.models || [];
    const prodSpecs = (machineWithModels.specifications || [])
      .map((s) => `${s.label || s.key || ""}: ${s.value}`)
      .join(", ");
    const modelLines = models.map((m) => {
      const mSpecText = m.specifications.map((s) => `${s.label || s.key || ""}: ${s.value}`).join(" | ");
      return `• *${m.modelName}*: ${mSpecText}`;
    });
    const featureLine =
      machineWithModels.features && machineWithModels.features.length > 0
        ? `• *Key Highlights*: ${machineWithModels.features.slice(0, 3).join("; ")}`
        : "";
    return {
      promptCatalogContext,
      deterministicDeepAnswer: [
        `Here are the verified specifications for the *${machineWithModels.name}* (${getLink(machineWithModels)}):`,
        prodSpecs ? `• *General Machine Specs*: ${prodSpecs}` : "",
        ...modelLines,
        featureLine,
        machineWithModels.relatedConsumables && machineWithModels.relatedConsumables.length > 0
          ? `• *Compatible Consumables*: ${machineWithModels.relatedConsumables.map((c) => (typeof c === "string" ? c : c.name)).join(", ")}`
          : "",
        `\nClassic Edge 53 machines are quoted based on the model and factory configuration. Share your preferred model (*${models.map((m) => m.modelName).join("* or *")}*) and city for an official quotation.`,
      ]
        .filter(Boolean)
        .join("\n"),
      isDeepQuestion: true,
    };
  }

  // Handle Multi-Product Comparisons & Superlative Follow-ups ("Compare CCP054 and CCP055", "Which one is wider?", "Which has the largest reading top?")
  if (isComparison && matchedItems.length >= 2) {
    const explicitCodes = extractExplicitProductOrModelCodes(q);
    const explicitMatched =
      explicitCodes.length >= 2
        ? matchedItems.filter((it) => {
            const skuText = `${it.sku || ""} ${it.name} ${it.slug}`.toLowerCase();
            return explicitCodes.some((c: string) =>
              new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(skuText)
            );
          })
        : [];
    const candidates =
      explicitMatched.length >= 2 ? explicitMatched : matchedItems.slice(0, 3);
    const wantsReadingTop = /\b(reading\s*top|top\s*sheet|reading\s*surface|top\s*size)\b/i.test(q);
    const wantsWider = /\b(wider|widest|width|larger|largest|bigger|biggest)\b/i.test(q);

    let winnerNote = "";
    if (wantsReadingTop || wantsWider) {
      let bestItem: MainWebsiteProduct | null = null;
      let bestSpecValue = "";
      let bestMetric = -1;

      for (const it of candidates) {
        const allDims = it.dimensions || [];
        const targetSpec = wantsReadingTop
          ? allDims.find((d) => /top\s*sheet|reading/i.test(d.label || d.key || "")) || allDims[0]
          : allDims.find((d) => /top\s*sheet|bottom\s*sheet|front\s*panel|width/i.test(d.label || d.key || "")) ||
            allDims[0];
        if (targetSpec) {
          const parsed = parseMeasurementValuesFromSpec(targetSpec.value);
          const metric = wantsReadingTop
            ? parsed.area ?? parsed.maxNumber ?? -1
            : parsed.maxNumber ?? parsed.area ?? -1;
          if (metric > bestMetric) {
            bestMetric = metric;
            bestItem = it;
            bestSpecValue = `${targetSpec.label || targetSpec.key || ""}: ${targetSpec.value}`;
          }
        }
      }
      if (bestItem) {
        winnerNote = wantsReadingTop
          ? `*${bestItem.name}* has the largest reading top among these options (*${bestSpecValue}*).`
          : `*${bestItem.name}* has the wider dimensions among these options (*${bestSpecValue}*).`;
      }
    }

    const itemLines = candidates.map((it) => {
      const priceText =
        typeof it.basePrice === "number" && it.basePrice > 0
          ? `₹${it.basePrice.toLocaleString("en-IN")}`
          : "Custom Quote";
      const dims = (it.dimensions || [])
        .map((d) => `${d.label || d.key || ""}: ${d.value}`)
        .join(", ");
      const tech = (it.specifications || [])
        .filter((s) => s.type !== "dimension")
        .map((s) => `${s.label || s.key || ""}: ${s.value}`)
        .join(", ");
      const vars =
        it.variants && it.variants.length > 0
          ? `Variants: ${it.variants
              .map((v) =>
                typeof v.price === "number" && v.price > 0
                  ? `${v.name} (₹${v.price.toLocaleString("en-IN")})`
                  : v.name
              )
              .join(", ")}`
          : "";
      return [
        `• *${it.name}* (${priceText}) - ${getLink(it)}`,
        dims ? `  Dimensions: ${dims}` : "",
        tech ? `  Specs: ${tech}` : "",
        vars ? `  ${vars}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    });

    return {
      promptCatalogContext,
      deterministicDeepAnswer: [
        winnerNote || `Here is a side-by-side comparison from our verified catalog:`,
        ...itemLines,
        `\nLet me know which model or variant you prefer and I can share delivery timelines or prepare a quote.`,
      ]
        .filter(Boolean)
        .join("\n"),
      isDeepQuestion: true,
    };
  }

  // Single-product deep question: concise scannable Gist by default (full panel breakdown only when explicitly requested)
  const item = matchedItems[0];
  const cleanTitle = cleanDisplayProductName(item.name);
  const hasMrp = item.regularPrice && item.basePrice && item.regularPrice > item.basePrice;
  const priceStr =
    typeof item.basePrice === "number" && item.basePrice > 0
      ? `₹${item.basePrice.toLocaleString("en-IN")}${hasMrp ? ` (MRP ₹${item.regularPrice!.toLocaleString("en-IN")})` : ""}`
      : "Custom Quote on Request";
  const asksExhaustivePanelSpecs =
    /\b(all\s*dimensions|full\s*dimensions|every\s*dimension|panel\s*sizes?|bottom\s*sheet|front\s*panel|shelf\s*size|logo\s*panel|sheet\s*thickness|all\s*specs|complete\s*specs)\b/i.test(
      q
    );

  const detailLines: string[] = [
    `*${cleanTitle}* (${priceStr})`,
  ];

  if (asksExhaustivePanelSpecs) {
    if (item.dimensions && item.dimensions.length > 0) {
      detailLines.push(
        `• *Full Dimensions*: ${item.dimensions.map((d) => `${d.label || d.key || ""}: ${d.value}`).join(" | ")}`
      );
    }
    const techSpecs = (item.specifications || []).filter((s) => s.type !== "dimension");
    if (techSpecs.length > 0) {
      detailLines.push(
        `• *Technical Specs*: ${techSpecs.map((s) => `${s.label || s.key || ""}: ${s.value}`).join(" | ")}`
      );
    } else if (item.specsSummary) {
      detailLines.push(`• *Specifications*: ${item.specsSummary}`);
    }
  } else {
    // Scannable Gist: Height + Reading Top + Key Build/Warranty
    const heightDim = (item.dimensions || []).find((d) => /height/i.test(d.label || d.key || ""));
    const topDim = (item.dimensions || []).find((d) => /top\s*sheet|reading\s*top|top\s*surface|size/i.test(d.label || d.key || ""));
    const otherDims = (item.dimensions || []).slice(0, 2);
    const keySizeParts: string[] = [];
    if (heightDim) keySizeParts.push(`Height ${heightDim.value}`);
    if (topDim && topDim !== heightDim) keySizeParts.push(`Top ${topDim.value}`);
    if (keySizeParts.length === 0 && otherDims.length > 0) {
      for (const d of otherDims) {
        keySizeParts.push(`${d.label || d.key || "Size"}: ${d.value}`);
      }
    }
    if (keySizeParts.length > 0) {
      detailLines.push(`• *Key Size*: ${keySizeParts.join(" | ")}`);
    }

    const techSpecs = (item.specifications || []).filter((s) => s.type !== "dimension");
    const keyTech = techSpecs
      .filter((s) => /material|pillar|warranty|power|work\s*area|thickness|finish|capacity/i.test(s.label || s.key || ""))
      .slice(0, 3);
    if (keyTech.length > 0) {
      detailLines.push(
        `• *Build & Specs*: ${keyTech.map((s) => `${s.label || s.key || ""}: ${s.value}`).join(" | ")}`
      );
    } else if (item.specsSummary) {
      detailLines.push(`• *Specs*: ${item.specsSummary}`);
    }
  }

  if (item.variants && item.variants.length > 0) {
    detailLines.push(
      `• *Options / Variants*: ${item.variants
        .slice(0, 6)
        .map((v) =>
          typeof v.price === "number" && v.price > 0 && v.price !== item.basePrice
            ? `${v.name} (₹${v.price.toLocaleString("en-IN")})`
            : v.name
        )
        .join(", ")}`
    );
  }
  if (item.features && item.features.length > 0) {
    detailLines.push(`• *Highlights*: ${item.features.slice(0, 3).join("; ")}`);
  }
  if (item.models && item.models.length > 0) {
    for (const m of item.models.slice(0, 3)) {
      detailLines.push(
        `• *Model ${m.modelName}*: ${m.specifications.slice(0, 4).map((s) => `${s.label || s.key || ""}: ${s.value}`).join(" | ")}`
      );
    }
  }
  detailLines.push(`• *Link*: ${getLink(item)}`);

  return {
    promptCatalogContext,
    deterministicDeepAnswer: detailLines.join("\n"),
    isDeepQuestion: true,
  };
}

export interface MultiItemProjectLine {
  requestedLabel: string;
  quantity: number;
  categoryKey: "podium" | "signage" | "chair_furniture" | "table_furniture" | "trophy_gift" | "stand_display";
  economyMatch?: MainWebsiteProduct;
  economyUnitPrice: number;
  standardMatch?: MainWebsiteProduct;
  standardUnitPrice: number;
}

export interface MultiItemProjectPlanResult {
  isMultiItemOrTotalling: boolean;
  lines: MultiItemProjectLine[];
  budgetLimit: number | null;
  summaryText: string;
  matchedProducts: MainWebsiteProduct[];
  needsSalesTeamPing: boolean;
}

/**
 * Multi-Item Quantity & Project Budget Totalling Engine.
 * Handles queries like:
 * - "We require 3 Acrylic podiums, 10 signages for office name plates and approximately 10 chairs. Our budget is around 1 lac rupees."
 * - "What is the total cost for 5 CCP057S podiums?"
 * - "Total price for 4 chairs and 2 podiums"
 */
export function buildMultiItemProjectPlan(
  allItems: MainWebsiteProduct[],
  rawQuery: string,
  shortLinkMap?: Record<string, string>
): MultiItemProjectPlanResult {
  const q = String(rawQuery || "").trim();
  const qLower = q.toLowerCase();
  const budgetInfo = extractBudgetConstraintsFromQuery(q);
  const budgetLimit = budgetInfo.maxPrice;

  const getLink = (it: MainWebsiteProduct) => {
    const kSlug = `PRODUCT:${it.slug}`.toLowerCase();
    const kId = `PRODUCT:${it.id}`.toLowerCase();
    return (
      shortLinkMap?.[kSlug] ||
      shortLinkMap?.[kId] ||
      it.shortUrl ||
      it.url ||
      `https://www.classicconcepts.in/products/${it.slug}`
    );
  };

  // Detect explicit SKU + quantity e.g. "5 CCP057S" or "3 units of CCP054"
  const explicitCodes = extractExplicitProductOrModelCodes(q);
  const qtyRegexes: Array<{
    key: MultiItemProjectLine["categoryKey"];
    label: string;
    pattern: RegExp;
  }> = [
    {
      key: "podium",
      label: "Acrylic Podiums",
      pattern: /\b(?:approx(?:imately)?\s*|around\s*|about\s*)?(\d{1,3})\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:podiums?|pulpits?|lecterns?|rostrums?)\b/i,
    },
    {
      key: "signage",
      label: "Acrylic Office Name Plates / Signages",
      pattern: /\b(?:approx(?:imately)?\s*|around\s*|about\s*)?(\d{1,3})\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:signages?|signs?|office\s*name\s*plates?|name\s*plates?|nameplates?|name\s*boards?)\b/i,
    },
    {
      key: "chair_furniture",
      label: "Acrylic Chairs / Stools",
      pattern: /\b(?:approx(?:imately)?\s*|around\s*|about\s*)?(\d{1,3})\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:chairs?|stools?|seating)\b/i,
    },
    {
      key: "table_furniture",
      label: "Acrylic Tables / Desks",
      pattern: /\b(?:approx(?:imately)?\s*|around\s*|about\s*)?(\d{1,3})\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:tables?|desks?|consoles?)\b/i,
    },
    {
      key: "trophy_gift",
      label: "Acrylic Trophies / Corporate Gifts",
      pattern: /\b(?:approx(?:imately)?\s*|around\s*|about\s*)?(\d{1,3})\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:trophies|trophy|mementos?|awards?|corporate\s*gifts?|gifts?)\b/i,
    },
    {
      key: "stand_display",
      label: "Acrylic Display / Menu Stands",
      pattern: /\b(?:approx(?:imately)?\s*|around\s*|about\s*)?(\d{1,3})\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:menu\s*stands?|qr\s*stands?|sign\s*holders?|tent\s*cards?|display\s*stands?)\b/i,
    },
  ];

  const lines: MultiItemProjectLine[] = [];
  const matchedProducts: MainWebsiteProduct[] = [];
  const addProductUnique = (p?: MainWebsiteProduct) => {
    if (p && !matchedProducts.some((m) => m.slug === p.slug)) {
      matchedProducts.push(p);
    }
  };

  const pricedPodiums = allItems
    .filter(
      (i) =>
        i.brand === "CLASSIC_CONCEPTS" &&
        typeof i.basePrice === "number" &&
        i.basePrice > 0 &&
        /\b(podium|pulpit|lectern)\b|^ccp\d/i.test(`${i.name} ${i.categoryName} ${i.sku || ""}`)
    )
    .sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));

  const chairsAndStools = allItems
    .filter(
      (i) =>
        i.brand === "CLASSIC_CONCEPTS" &&
        typeof i.basePrice === "number" &&
        i.basePrice > 0 &&
        /\b(chair|stool|bar\s*stool|seating)\b/i.test(`${i.name} ${i.categoryName}`)
    )
    .sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));

  const tablesList = allItems
    .filter(
      (i) =>
        i.brand === "CLASSIC_CONCEPTS" &&
        typeof i.basePrice === "number" &&
        i.basePrice > 0 &&
        /\b(table|desk|console|pedestal)\b/i.test(`${i.name} ${i.categoryName}`) &&
        !/\b(table\s*top|tent\s*card|sign\s*holder|menu)\b/i.test(i.name)
    )
    .sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));

  const signagesList = allItems
    .filter(
      (i) =>
        i.brand === "CLASSIC_CONCEPTS" &&
        /\b(signage|name\s*plate|nameplate|sign\s*holder|frame)\b/i.test(`${i.name} ${i.categoryName}`)
    )
    .sort((a, b) => (a.basePrice || 999999) - (b.basePrice || 999999));

  const trophiesList = allItems
    .filter(
      (i) =>
        i.brand === "CLASSIC_CONCEPTS" &&
        typeof i.basePrice === "number" &&
        i.basePrice > 0 &&
        /\b(trophy|memento|award|plaque)\b/i.test(`${i.name} ${i.categoryName}`)
    )
    .sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));

  const standsList = allItems
    .filter(
      (i) =>
        i.brand === "CLASSIC_CONCEPTS" &&
        typeof i.basePrice === "number" &&
        i.basePrice > 0 &&
        /\b(sign\s*holder|menu|tent\s*card|qr\s*stand|brochure)\b/i.test(`${i.name} ${i.categoryName}`)
    )
    .sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));

  for (const def of qtyRegexes) {
    const m = q.match(def.pattern);
    if (m && m[1]) {
      const qty = parseInt(m[1], 10);
      if (qty > 0 && qty <= 500) {
        if (def.key === "podium") {
          const econ = pricedPodiums[0]; // CCP057S ₹7,150
          const std = pricedPodiums.find((p) => (p.basePrice || 0) >= 13500) || pricedPodiums[1] || econ;
          addProductUnique(econ);
          addProductUnique(std);
          lines.push({
            requestedLabel: def.label,
            quantity: qty,
            categoryKey: def.key,
            economyMatch: econ,
            economyUnitPrice: econ?.basePrice || 7150,
            standardMatch: std,
            standardUnitPrice: std?.basePrice || 13750,
          });
        } else if (def.key === "signage") {
          const signMatch = signagesList.find((s) => /signage|name/i.test(s.name)) || signagesList[0];
          const signHolder = standsList[0] || signagesList.find((s) => (s.basePrice || 0) > 0);
          addProductUnique(signMatch);
          addProductUnique(signHolder);
          lines.push({
            requestedLabel: def.label,
            quantity: qty,
            categoryKey: def.key,
            economyMatch: signHolder || signMatch,
            economyUnitPrice: signHolder?.basePrice || 550,
            standardMatch: signMatch,
            standardUnitPrice: 1200, // Custom acrylic office nameplate estimate per piece
          });
        } else if (def.key === "chair_furniture") {
          const stoolMatch = chairsAndStools[0]; // Bar Stool ₹9,350
          const chairMatch =
            chairsAndStools.find((c) => /chair/i.test(c.name)) ||
            chairsAndStools[1] ||
            stoolMatch;
          addProductUnique(chairMatch);
          addProductUnique(stoolMatch);
          lines.push({
            requestedLabel: def.label,
            quantity: qty,
            categoryKey: def.key,
            economyMatch: stoolMatch,
            economyUnitPrice: stoolMatch?.basePrice || 9350,
            standardMatch: chairMatch,
            standardUnitPrice: chairMatch?.basePrice || 15950,
          });
        } else if (def.key === "table_furniture") {
          const econTable = tablesList[0];
          const stdTable = tablesList[1] || econTable;
          addProductUnique(econTable);
          addProductUnique(stdTable);
          lines.push({
            requestedLabel: def.label,
            quantity: qty,
            categoryKey: def.key,
            economyMatch: econTable,
            economyUnitPrice: econTable?.basePrice || 5500,
            standardMatch: stdTable,
            standardUnitPrice: stdTable?.basePrice || 8800,
          });
        } else if (def.key === "trophy_gift") {
          const econTrophy = trophiesList[0];
          const stdTrophy = trophiesList[Math.min(2, trophiesList.length - 1)] || econTrophy;
          addProductUnique(econTrophy);
          addProductUnique(stdTrophy);
          lines.push({
            requestedLabel: def.label,
            quantity: qty,
            categoryKey: def.key,
            economyMatch: econTrophy,
            economyUnitPrice: econTrophy?.basePrice || 950,
            standardMatch: stdTrophy,
            standardUnitPrice: stdTrophy?.basePrice || 1650,
          });
        } else if (def.key === "stand_display") {
          const econStand = standsList[0];
          const stdStand = standsList[1] || econStand;
          addProductUnique(econStand);
          addProductUnique(stdStand);
          lines.push({
            requestedLabel: def.label,
            quantity: qty,
            categoryKey: def.key,
            economyMatch: econStand,
            economyUnitPrice: econStand?.basePrice || 220,
            standardMatch: stdStand,
            standardUnitPrice: stdStand?.basePrice || 550,
          });
        }
      }
    }
  }

  // Also check single explicit SKU + quantity e.g. "5 CCP057S" or "total for 3 CCP054"
  if (lines.length === 0 && explicitCodes.length === 1) {
    const qtyMatch = q.match(/\b(\d{1,3})\s*(?:pcs?|pieces?|units?|nos?|of)?\b/i);
    const asksTotal = /\b(total|cost\s*for|price\s*for|quote\s*for|amount\s*for)\b/i.test(qLower);
    if (qtyMatch && asksTotal) {
      const qty = parseInt(qtyMatch[1], 10);
      const code = explicitCodes[0];
      const hit = allItems.find((it) => {
        const skuC = (it.sku || "").toLowerCase().replace(/[-_\s]+/g, "");
        return skuC === code || skuC.includes(code);
      });
      if (hit && hit.basePrice && qty > 1 && qty <= 500) {
        addProductUnique(hit);
        const lineTotal = hit.basePrice * qty;
        return {
          isMultiItemOrTotalling: true,
          lines: [
            {
              requestedLabel: cleanDisplayProductName(hit.name),
              quantity: qty,
              categoryKey: "podium",
              economyMatch: hit,
              economyUnitPrice: hit.basePrice,
              standardMatch: hit,
              standardUnitPrice: hit.basePrice,
            },
          ],
          budgetLimit,
          summaryText: [
            `Here is the total calculation for *${qty} units* of *${cleanDisplayProductName(hit.name)}*:`,
            `• Unit Price: *₹${hit.basePrice.toLocaleString("en-IN")}*`,
            `• Quantity: *${qty} units*`,
            `• *Estimated Total*: *₹${lineTotal.toLocaleString("en-IN")}* (${getLink(hit)})`,
            `For ${qty} units, our sales team can also offer a bulk order discount. Tell me your delivery city and I will have our sales team share the discounted final quote right here.`,
          ].join("\n"),
          matchedProducts,
          needsSalesTeamPing: qty >= 3,
        };
      }
    }
  }

  const isMultiItem = lines.length >= 2 || (lines.length === 1 && lines[0].quantity >= 2 && (budgetLimit !== null || /\b(total|budget|renovation|package|combination|options)\b/i.test(qLower)));
  if (!isMultiItem) {
    return {
      isMultiItemOrTotalling: false,
      lines: [],
      budgetLimit,
      summaryText: "",
      matchedProducts: [],
      needsSalesTeamPing: false,
    };
  }

  // Compute Option A (Economy / Catalog Standard Totals) and Option B (Within-Budget Adjusted Package if budget is tight)
  let economyGrandTotal = 0;
  let standardGrandTotal = 0;
  const breakdownBullets: string[] = [];

  for (const ln of lines) {
    const econLineTotal = ln.economyUnitPrice * ln.quantity;
    const stdLineTotal = ln.standardUnitPrice * ln.quantity;
    economyGrandTotal += econLineTotal;
    standardGrandTotal += stdLineTotal;

    if (ln.categoryKey === "signage") {
      const refLink = ln.standardMatch ? ` (${getLink(ln.standardMatch)})` : "";
      breakdownBullets.push(
        `• *${ln.quantity} × ${ln.requestedLabel}*: Standard Desk/Door Sign Holders at ₹${ln.economyUnitPrice.toLocaleString("en-IN")} each = *₹${econLineTotal.toLocaleString("en-IN")}*, or Custom Engraved Acrylic Office Name Plates (~₹1,000 to ₹1,500 each) = *₹${(ln.quantity * 1200).toLocaleString("en-IN")}*${refLink}`
      );
    } else {
      const econTitle = ln.economyMatch ? cleanDisplayProductName(ln.economyMatch.name) : ln.requestedLabel;
      const econLink = ln.economyMatch ? ` - ${getLink(ln.economyMatch)}` : "";
      const stdTitle =
        ln.standardMatch && ln.standardMatch.slug !== ln.economyMatch?.slug
          ? cleanDisplayProductName(ln.standardMatch.name)
          : null;
      const stdNote = stdTitle
        ? ` (or *${stdTitle}* at ₹${ln.standardUnitPrice.toLocaleString("en-IN")} × ${ln.quantity} = *₹${stdLineTotal.toLocaleString("en-IN")}*)`
        : "";
      breakdownBullets.push(
        `• *${ln.quantity} × ${ln.requestedLabel}*: *${econTitle}* at ₹${ln.economyUnitPrice.toLocaleString("en-IN")} × ${ln.quantity} = *₹${econLineTotal.toLocaleString("en-IN")}*${stdNote}${econLink}`
      );
    }
  }

  const summaryParts: string[] = [];
  if (budgetLimit !== null) {
    summaryParts.push(
      `Here is the itemized cost breakdown for your project against your *₹${budgetLimit.toLocaleString("en-IN")}* budget:`
    );
  } else {
    summaryParts.push(`Here is the itemized quantity and price breakdown for your requirement:`);
  }
  summaryParts.push(...breakdownBullets);
  summaryParts.push(
    `\n*Standard Catalog Total*: *₹${economyGrandTotal.toLocaleString("en-IN")}*${standardGrandTotal > economyGrandTotal ? ` (up to *₹${standardGrandTotal.toLocaleString("en-IN")}* with full-size models)` : ""}`
  );

  // If budgetLimit is set and economyGrandTotal exceeds budgetLimit, build a smart Option 1 that fits inside budgetLimit!
  if (budgetLimit !== null && economyGrandTotal > budgetLimit) {
    const chairLine = lines.find((l) => l.categoryKey === "chair_furniture");
    const podiumLine = lines.find((l) => l.categoryKey === "podium");
    const signLine = lines.find((l) => l.categoryKey === "signage");

    const fixedPodiumCost = podiumLine ? podiumLine.economyUnitPrice * podiumLine.quantity : 0;
    const fixedSignCost = signLine ? 1000 * signLine.quantity : 0;
    const remainingForChairs = Math.max(0, budgetLimit - fixedPodiumCost - fixedSignCost);

    if (chairLine && chairLine.economyUnitPrice > 0) {
      const affordableChairQty = Math.max(1, Math.floor(remainingForChairs / chairLine.economyUnitPrice));
      const adjustedChairTotal = affordableChairQty * chairLine.economyUnitPrice;
      const adjustedGrandTotal = fixedPodiumCost + fixedSignCost + adjustedChairTotal;
      summaryParts.push(
        `\n*2 Ways to Plan Within Your ₹${budgetLimit.toLocaleString("en-IN")} Budget:*`,
        `1. *Within-Budget Ready Combination (~₹${adjustedGrandTotal.toLocaleString("en-IN")})*: ${podiumLine ? `${podiumLine.quantity} × ${cleanDisplayProductName(podiumLine.economyMatch?.name || "Acrylic Podium CCP057S")} (₹${fixedPodiumCost.toLocaleString("en-IN")}) + ` : ""}${signLine ? `${signLine.quantity} × Custom Office Name Plates (₹${fixedSignCost.toLocaleString("en-IN")}) + ` : ""}${affordableChairQty} × ${cleanDisplayProductName(chairLine.economyMatch?.name || "Acrylic Bar Stool / Chair")} (₹${adjustedChairTotal.toLocaleString("en-IN")}).`,
        `2. *Full ${chairLine.quantity}-Chair Project Package (₹${economyGrandTotal.toLocaleString("en-IN")} list price)*: Take all ${lines.map((l) => `${l.quantity} ${l.requestedLabel.toLowerCase()}`).join(" + ")} and our sales team can work out a bulk corporate discount for your office renovation.`
      );
    } else {
      summaryParts.push(
        `\nSince the standard catalog total (*₹${economyGrandTotal.toLocaleString("en-IN")}*) is slightly above your *₹${budgetLimit.toLocaleString("en-IN")}* target, our sales team can offer a bulk package discount or customize sheet thickness to fit your budget.`
      );
    }
  }

  summaryParts.push(
    `\nI have also pinged our Sales Team on this chat with your item list so they can share bulk pricing. Which option works best for you, and which city is the delivery for?`
  );

  return {
    isMultiItemOrTotalling: true,
    lines,
    budgetLimit,
    summaryText: summaryParts.join("\n"),
    matchedProducts,
    needsSalesTeamPing: true,
  };
}


// ============================================================================
// COMPLETE ECOSYSTEM DATABASE DIRECTORY & LIVE OPERATIONAL CONTEXT
// ============================================================================
let cachedDirectoryKey = "";
let cachedDirectoryText = "";

export function buildCompleteEcosystemDatabaseDirectory(
  allItems: MainWebsiteProduct[]
): string {
  const key = `${allItems.length}:${allItems[0]?.id || ""}:${allItems[allItems.length - 1]?.id || ""}`;
  if (cachedDirectoryKey === key && cachedDirectoryText) {
    return cachedDirectoryText;
  }

  const ccProducts = allItems.filter((i) => i.brand === "CLASSIC_CONCEPTS");
  const ceMachines = allItems.filter(
    (i) => i.brand === "CLASSIC_EDGE_53" && i.itemType === "MACHINE"
  );
  const ceConsumables = allItems.filter(
    (i) => i.brand === "CLASSIC_EDGE_53" && i.itemType === "CONSUMABLE"
  );

  const podiums = ccProducts.filter(
    (p) =>
      /\b(podium|lectern|pulpit|rostrum)\b|^ccp\d/i.test(
        `${p.name} ${p.categoryName} ${p.sku || ""}`
      )
  );
  const otherCcProducts = ccProducts.filter((p) => !podiums.includes(p));

  const lines: string[] = [];
  lines.push(
    `COMPLETE VERIFIED ECOSYSTEM CATALOG DIRECTORY (${allItems.length} total items: ${ccProducts.length} Classic Concepts products, ${ceMachines.length} Classic Edge 53 machines, ${ceConsumables.length} consumables & acrylic hardware accessories):`
  );

  lines.push(
    `\n[A] ALL ${podiums.length} ACRYLIC & WOOD STAGE PODIUMS / PULPITS / LECTERNS (EXACT SIZES, PRICES & LINKS):`
  );
  for (const p of podiums) {
    const cleanTitle = cleanDisplayProductName(p.name);
    const skuTag = p.sku ? ` [${p.sku}]` : "";
    const hasMrp = p.regularPrice && p.basePrice && p.regularPrice > p.basePrice;
    const priceTag = p.basePrice
      ? `₹${p.basePrice.toLocaleString("en-IN")}${hasMrp ? ` (MRP ₹${p.regularPrice!.toLocaleString("en-IN")})` : ""}`
      : "Quote";
    const dimSummary =
      (p.dimensions || [])
        .map((d) => `${d.label || d.key}: ${d.value}`)
        .join(", ") || "";
    const varSummary =
      p.variants && p.variants.length > 0
        ? ` | Variants: ${p.variants
            .map((v) =>
              v.price ? `${v.name} (₹${v.price.toLocaleString("en-IN")})` : v.name
            )
            .join(", ")}`
        : "";
    lines.push(
      `- ${cleanTitle}${skuTag} | ${priceTag}${dimSummary ? ` | ${dimSummary}` : ""}${varSummary} | ${p.shortUrl || p.url}`
    );
  }

  lines.push(
    `\n[B] ALL ${ceMachines.length} CLASSIC EDGE 53 INDUSTRIAL ACRYLIC MACHINES (MODELS, SPECS & LINKS):`
  );
  for (const m of ceMachines) {
    const cleanTitle = cleanDisplayProductName(m.name);
    const priceTag = m.basePrice
      ? `from ₹${m.basePrice.toLocaleString("en-IN")}`
      : "Quote on request";
    const modelsTag = m.modelsSummary ? ` | Models: ${m.modelsSummary}` : "";
    const specsTag = (m.specifications || [])
      .slice(0, 5)
      .map((s) => `${s.label || s.key}: ${s.value}`)
      .join(", ");
    lines.push(
      `- ${cleanTitle} | ${priceTag}${modelsTag}${specsTag ? ` | ${specsTag}` : ""} | ${m.shortUrl || m.url}`
    );
  }

  const machineConsumables = ceConsumables.filter(
    (c) => !/accessories/i.test(c.categoryName)
  );
  const acrylicAccessories = ceConsumables.filter((c) =>
    /accessories/i.test(c.categoryName)
  );

  lines.push(
    `\n[C] CLASSIC EDGE 53 MACHINE CONSUMABLES & TOOLS (${machineConsumables.length} items):`
  );
  for (const c of machineConsumables) {
    const priceTag = c.basePrice
      ? `₹${c.basePrice.toLocaleString("en-IN")}`
      : "Quote";
    lines.push(
      `- ${cleanDisplayProductName(c.name)} | ${priceTag}${c.description ? ` | ${c.description.slice(0, 90)}` : ""} | ${c.shortUrl || c.url}`
    );
  }

  lines.push(
    `\n[D] PODIUM OPTIONAL ADD-ONS & ${acrylicAccessories.length} ACRYLIC HARDWARE ACCESSORIES / SPECIALTY SHEETS:`
  );
  lines.push(
    `- Standard Podium Add-Ons: Customized Acrylic Logo Plate, Warm Light Profile (LED backlit), Wireless Collar & Handheld Mics, Podium Cover, Heavy-Duty Castor Wheels, Hard Flight Case.`
  );
  for (const acc of acrylicAccessories) {
    const priceTag = acc.basePrice
      ? `₹${acc.basePrice.toLocaleString("en-IN")}`
      : "Quote";
    lines.push(
      `- ${cleanDisplayProductName(acc.name)} | ${priceTag}${acc.description ? ` | ${acc.description.slice(0, 80)}` : ""} | ${acc.shortUrl || acc.url}`
    );
  }

  lines.push(
    `\n[E] ALL OTHER CLASSIC CONCEPTS READY ACRYLIC PRODUCTS (${otherCcProducts.length} items across Awards, Hotel/Menu Stands, Boxes, Retail Risers, Furniture, Religious & Cast Sheets):`
  );
  for (const p of otherCcProducts) {
    const cleanTitle = cleanDisplayProductName(p.name);
    const skuTag = p.sku ? ` [${p.sku}]` : "";
    const priceTag = p.basePrice
      ? `₹${p.basePrice.toLocaleString("en-IN")}`
      : "Quote";
    const sizeTag =
      p.dimensions && p.dimensions.length > 0
        ? ` | ${p.dimensions.map((d) => `${d.label || d.key}: ${d.value}`).join(", ")}`
        : "";
    lines.push(
      `- [${p.categoryName}] ${cleanTitle}${skuTag} | ${priceTag}${sizeTag} | ${p.shortUrl || p.url}`
    );
  }

  cachedDirectoryKey = key;
  cachedDirectoryText = lines.join("\n");
  return cachedDirectoryText;
}

const IS_TEST_OR_DEV_CONTACT_RE =
  /\b(sakina\s*manzil|tirumalgherry|alaqmarak0810|rapidshiftlabs|ananya\s*deshmukh|rohan\s*kulkarni|priya\s*menon|karthik\s*nair|arjun\s*deshmukh|98480\s*\d{5}|93467\s*63253|96184\s*43558)\b/i;

let cachedLiveBrandTeamInfo: {
  fetchedAt: number;
  headOfficeLine: string;
  leadershipLines: string[];
} | null = null;

async function getVerifiedLiveBrandAndTeamInfo(): Promise<{
  headOfficeLine: string;
  leadershipLines: string[];
}> {
  if (
    cachedLiveBrandTeamInfo &&
    Date.now() - cachedLiveBrandTeamInfo.fetchedAt < 5 * 60 * 1000
  ) {
    return cachedLiveBrandTeamInfo;
  }

  let address =
    "1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015";
  let phone1 = "+91 79016 50662";
  let phone2 = "+91 79016 50663";
  let whatsappNumber = "+91 73372 20568";
  let email1 = "sales@classicconcepts.in";
  let email2 = "info@classicconcepts.in";
  let businessHours = "Monday - Saturday: 10:00 AM to 7:00 PM (Sunday: Closed)";
  const leadershipLines: string[] = [];
  const seenNames = new Set<string>();

  // 1. Check Classic Concepts SQLite DB (SiteSetting & TeamMember)
  const ccClient = getMainCatalogClient();
  if (ccClient) {
    const [ccSettings, ccTeam] = await Promise.all([
      ccClient.execute(`SELECT * FROM SiteSetting LIMIT 1`).catch(() => ({ rows: [] as any[] })),
      ccClient.execute(`SELECT * FROM TeamMember ORDER BY sortOrder ASC`).catch(() => ({ rows: [] as any[] })),
    ]);

    if (ccSettings.rows.length > 0) {
      const s = ccSettings.rows[0];
      if (s.address && !IS_TEST_OR_DEV_CONTACT_RE.test(String(s.address))) {
        address = String(s.address).replace(/\r?\n/g, ", ").trim();
      }
      if (s.phone1 && !IS_TEST_OR_DEV_CONTACT_RE.test(String(s.phone1))) {
        phone1 = String(s.phone1).trim();
      }
      if (s.phone2 && !IS_TEST_OR_DEV_CONTACT_RE.test(String(s.phone2))) {
        phone2 = String(s.phone2).trim();
      }
      if (s.email && !IS_TEST_OR_DEV_CONTACT_RE.test(String(s.email))) {
        email1 = String(s.email).trim();
      }
      if (s.email2 && !IS_TEST_OR_DEV_CONTACT_RE.test(String(s.email2))) {
        email2 = String(s.email2).trim();
      }
      if (s.businessHours) {
        businessHours = String(s.businessHours).replace(/\r?\n/g, " ").trim();
      }
    }

    for (const m of ccTeam.rows) {
      if (m.isActive === 0 || m.isActive === false) continue;
      const name = String(m.name || "").trim();
      if (!name || IS_TEST_OR_DEV_CONTACT_RE.test(name)) continue;
      seenNames.add(name.toLowerCase());
      const pos = String(m.position || m.role || "Team Member").trim();
      const phone =
        m.phone && !IS_TEST_OR_DEV_CONTACT_RE.test(String(m.phone))
          ? String(m.phone).trim()
          : "";
      const email =
        m.email && !IS_TEST_OR_DEV_CONTACT_RE.test(String(m.email))
          ? String(m.email).trim()
          : "";
      leadershipLines.push(
        `• ${name} (${pos})${phone ? ` | Phone: ${phone}` : ""}${email ? ` | Email: ${email}` : ""}`
      );
    }
  }

  // 2. If local DB had no TeamMember rows, verify against live Classic Concepts brand-info API
  if (leadershipLines.length === 0) {
    const urls = [
      `${resolveClassicConceptsInternalUrl()}/api/brand-info`,
      "https://classicconcepts.in/api/brand-info",
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) continue;
        const data: any = await res.json().catch(() => null);
        if (data?.contact?.address && !IS_TEST_OR_DEV_CONTACT_RE.test(String(data.contact.address))) {
          address = String(data.contact.address).replace(/\r?\n/g, ", ").trim();
        }
        if (Array.isArray(data?.team)) {
          for (const m of data.team) {
            const name = String(m.name || "").trim();
            if (!name || seenNames.has(name.toLowerCase()) || IS_TEST_OR_DEV_CONTACT_RE.test(name)) continue;
            seenNames.add(name.toLowerCase());
            const pos = String(m.position || "Team Member").trim();
            const phone =
              m.phone && !IS_TEST_OR_DEV_CONTACT_RE.test(String(m.phone))
                ? String(m.phone).trim()
                : "";
            const email =
              m.email && !IS_TEST_OR_DEV_CONTACT_RE.test(String(m.email))
                ? String(m.email).trim()
                : "";
            leadershipLines.push(
              `• ${name} (${pos})${phone ? ` | Phone: ${phone}` : ""}${email ? ` | Email: ${email}` : ""}`
            );
          }
        }
        if (leadershipLines.length > 0) break;
      } catch {
        // Ignore network errors
      }
    }
  }

  const headOfficeLine = `• Official Company & Head Office (Verified Live Database): Classic Concepts Acrylic Private Limited (https://classicconcepts.in) & Classic Edge 53 (https://classicedge53.com) | Factory & Head Office: ${address} | Phones: ${phone1}${phone2 ? `, ${phone2}` : ""} | Official WhatsApp Business API: ${whatsappNumber} | Emails: ${email1}${email2 ? `, ${email2}` : ""} | Business Hours: ${businessHours}`;

  cachedLiveBrandTeamInfo = {
    fetchedAt: Date.now(),
    headOfficeLine,
    leadershipLines,
  };
  return cachedLiveBrandTeamInfo;
}

export async function loadLiveDatabaseOperationalContext(params: {
  customerPhone?: string;
  customerName?: string;
  rawQuery?: string;
  forStaffCopilot?: boolean;
}): Promise<string> {
  const sections: string[] = [];
  const q = String(params.rawQuery || "").toLowerCase();

  try {
    const crm = getRawLibSqlClient("crm_orders");
    const ccClient = getMainCatalogClient();

    // 1. Verified Live Company Details & Leadership Team (strictly verified against live database, never local test/dev contacts!)
    const liveBrand = await getVerifiedLiveBrandAndTeamInfo();
    const asksAboutCompanyOrTeamContacts =
      Boolean(params.forStaffCopilot) ||
      /\b(contact|phone|number|call|whatsapp|email|address|location|where\s+are\s+you|factory|office|hours|timings|director|directors|chairperson|chairman|founder|ceo|owner|leadership|team|manager|sales\s+person|who\s+handles|whom\s+will\s+you\s+connect|connect\s+me|yusuf|hussain|shiva|lalitha|susheela|shilpa|chandi|priyanka|lakshmi|murtuza|suraj|harendar)\b/i.test(
        q
      );

    if (asksAboutCompanyOrTeamContacts) {
      const teamBlock = [
        liveBrand.headOfficeLine,
        ...(liveBrand.leadershipLines.length > 0
          ? [`• Verified Leadership & Sales Team (from Live Database):`, ...liveBrand.leadershipLines]
          : []),
      ].join("\n");
      sections.push(`VERIFIED LIVE COMPANY & TEAM CONTACTS:\n${teamBlock}`);
    } else {
      sections.push(`VERIFIED COMPANY SUMMARY:\n${liveBrand.headOfficeLine}`);
    }

    if (ccClient) {
      const ccRes = await ccClient
        .execute(
          `SELECT title, category, type, fileUrl FROM Resource ORDER BY createdAt DESC LIMIT 12`
        )
        .catch(() => ({ rows: [] as any[] }));
      if (ccRes.rows.length > 0 && /\b(pdf|brochure|catalogue|catalog|resource|download|spec\s*sheet)\b/i.test(q)) {
        sections.push(
          `DOWNLOADABLE CATALOGUES & RESOURCES:\n` +
            ccRes.rows
              .map(
                (r) =>
                  `• ${r.title} (${r.category || r.type || "PDF"}): ${r.fileUrl}`
              )
              .join("\n")
        );
      }
    }

    // 2. Customer-specific CRM profile, orders, trackings, and enquiries (strictly isolated to the current customer's 10-digit phone!)
    const cleanPhone = params.customerPhone
      ? normalizeWhatsAppPhone(params.customerPhone)
      : "";
    const phoneTail = cleanPhone.slice(-10);

    if (phoneTail.length >= 10) {
      await ensureEcosystemEnquiriesTable().catch(() => {});
      const custRes = await crm
        .execute({
          sql: `SELECT id, name, phone, email, company_name, organization_type, acrio_segment, total_orders_count, lifetime_value_inr, notes FROM customers WHERE phone LIKE ? LIMIT 3`,
          args: [`%${phoneTail}%`],
        })
        .catch(() => ({ rows: [] as any[] }));

      if (custRes.rows.length > 0) {
        const c = custRes.rows[0];
        if (!IS_TEST_OR_DEV_CONTACT_RE.test(String(c.name || ""))) {
          sections.push(
            `CURRENT CUSTOMER CRM RECORD: ${c.name} (${c.phone})${c.company_name ? `, Company: ${c.company_name}` : ""}${c.organization_type ? `, Segment: ${c.organization_type}` : ""}, Orders: ${c.total_orders_count ?? 0}, LTV: ₹${Number(c.lifetime_value_inr ?? 0).toLocaleString("en-IN")}${c.notes ? `, Notes: ${c.notes}` : ""}`
          );
        }
      }

      const [ordRes, trkRes, ecoEnqRes] = await Promise.all([
        crm
          .execute({
            sql: `SELECT order_number, items_summary, quantity, total_amount_inr, payment_status, fulfillment_status, ordered_at FROM customer_orders WHERE customer_phone LIKE ? ORDER BY ordered_at DESC LIMIT 5`,
            args: [`%${phoneTail}%`],
          })
          .catch(() => ({ rows: [] as any[] })),
        crm
          .execute({
            sql: `SELECT order_id, lookup_key, brand, items_summary, provider_name, awb_number, shipment_status, estimated_delivery FROM order_trackings WHERE customer_phone LIKE ? ORDER BY updated_at DESC LIMIT 5`,
            args: [`%${phoneTail}%`],
          })
          .catch(() => ({ rows: [] as any[] })),
        crm
          .execute({
            sql: `SELECT brand_label, product_name, message, status, last_reply_text, replied_by_name, created_at FROM ecosystem_enquiries WHERE customer_phone LIKE ? ORDER BY created_at DESC LIMIT 5`,
            args: [`%${phoneTail}%`],
          })
          .catch(() => ({ rows: [] as any[] })),
      ]);

      if (ordRes.rows.length > 0 || trkRes.rows.length > 0) {
        const ordLines = [
          ...ordRes.rows.map(
            (o) =>
              `• Order ${o.order_number}: ${o.items_summary} (Qty ${o.quantity ?? 1}), Amount=₹${Number(o.total_amount_inr ?? 0).toLocaleString("en-IN")}, Payment=${o.payment_status}, Fulfillment=${o.fulfillment_status}`
          ),
          ...trkRes.rows.map(
            (t) =>
              `• Shipment ${t.order_id} (${t.lookup_key}): Status=${t.shipment_status}, Courier=${t.provider_name}, AWB=${t.awb_number}, ETA=${t.estimated_delivery || "N/A"}`
          ),
        ];
        sections.push(`CUSTOMER ORDERS & DISPATCH TRACKING:\n${ordLines.join("\n")}`);
      }

      if (ecoEnqRes.rows.length > 0) {
        sections.push(
          `CUSTOMER WEBSITE ENQUIRIES & REPLIES ON FILE:\n` +
            ecoEnqRes.rows
              .map(
                (e) =>
                  `• [${e.brand_label}] (${e.status})${e.product_name ? ` Product: ${e.product_name} |` : ""} Enquiry: "${String(e.message || "").slice(0, 140)}"${e.last_reply_text ? ` | Team Reply (${e.replied_by_name || "Staff"}): "${String(e.last_reply_text).slice(0, 140)}"` : ""}`
              )
              .join("\n")
        );
      }

      if (ccClient) {
        const [ccEnq, ccCart] = await Promise.all([
          ccClient
            .execute({
              sql: `SELECT name, message, status, createdAt FROM Enquiry WHERE phone LIKE ? ORDER BY createdAt DESC LIMIT 5`,
              args: [`%${phoneTail}%`],
            })
            .catch(() => ({ rows: [] as any[] })),
          ccClient
            .execute({
              sql: `SELECT id, name, total, status, createdAt FROM CartOrder WHERE phone LIKE ? ORDER BY createdAt DESC LIMIT 5`,
              args: [`%${phoneTail}%`],
            })
            .catch(() => ({ rows: [] as any[] })),
        ]);
        if (ccEnq.rows.length > 0 && ecoEnqRes.rows.length === 0) {
          sections.push(
            `MAIN WEBSITE ENQUIRIES FOR THIS PHONE:\n` +
              ccEnq.rows
                .map(
                  (e) =>
                    `• ${e.name} [${e.status}]: "${String(e.message || "").slice(0, 120)}"`
                )
                .join("\n")
          );
        }
        if (ccCart.rows.length > 0) {
          sections.push(
            `MAIN WEBSITE CART ORDERS FOR THIS PHONE:\n` +
              ccCart.rows
                .map(
                  (o) =>
                    `• Order CC-${String(o.id).slice(-6).toUpperCase()}: ₹${Number(o.total ?? 0).toLocaleString("en-IN")} [${o.status}]`
                )
                .join("\n")
          );
        }
      }
    }

    // 3. Global recent enquiries/orders log is STRICTLY restricted to internal staff copilot turns (`forStaffCopilot === true`).
    // Customer-facing AI turns must NEVER see other customers' names, phone numbers, enquiries, or orders!
    if (
      params.forStaffCopilot === true &&
      /\b(enquir(?:y|ies)|order|orders|awb|tracking|dispatch|shipment|cc-\d+|ord[-_a-z0-9]+)\b/i.test(
        q
      )
    ) {
      await ensureEcosystemEnquiriesTable().catch(() => {});
      const [recentEnq, recentOrd] = await Promise.all([
        crm
          .execute(
            `SELECT brand_label, customer_name, customer_phone, message, status, last_reply_text, replied_by_name FROM ecosystem_enquiries ORDER BY created_at DESC LIMIT 8`
          )
          .catch(() => ({ rows: [] as any[] })),
        crm
          .execute(
            `SELECT order_number, customer_phone, items_summary, total_amount_inr, payment_status, fulfillment_status FROM customer_orders ORDER BY ordered_at DESC LIMIT 8`
          )
          .catch(() => ({ rows: [] as any[] })),
      ]);
      if (recentEnq.rows.length > 0) {
        sections.push(
          `RECENT ECOSYSTEM ENQUIRIES LOG:\n` +
            recentEnq.rows
              .map(
                (e) =>
                  `• [${e.brand_label}] ${e.customer_name} (${e.customer_phone}) [${e.status}]: "${String(e.message || "").slice(0, 100)}"${e.last_reply_text ? ` -> Replied by ${e.replied_by_name || "Staff"}: "${String(e.last_reply_text).slice(0, 80)}"` : ""}`
              )
              .join("\n")
        );
      }
      if (recentOrd.rows.length > 0) {
        sections.push(
          `RECENT ECOSYSTEM ORDERS LOG:\n` +
            recentOrd.rows
              .map(
                (o) =>
                  `• ${o.order_number} (${o.customer_phone}): ${o.items_summary} | ₹${Number(o.total_amount_inr ?? 0).toLocaleString("en-IN")} | Payment=${o.payment_status}, Status=${o.fulfillment_status}`
              )
              .join("\n")
        );
      }
    }
  } catch {
    // Non-blocking operational context lookup
  }

  return sections.join("\n\n");
}
