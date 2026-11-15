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
    "https://whatsapp.ccapl.cc"
  ).trim();
  return raw.replace(/\/+$/, "");
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
    process.env.INTERNAL_BRIDGE_SECRET ||
    "cc_internal_ecosystem_bridge_2026"
  ).trim();
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

/**
 * Loads the complete Classic Concepts acrylic product catalog (`classicconcepts.in`)
 * via API if configured, or directly from the local SQLite database.
 */
export async function loadAllClassicConceptsProducts(): Promise<MainWebsiteProduct[]> {
  const apiUrl = resolveClassicConceptsInternalUrl();
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
              basePrice:
                typeof p.discountPrice === "number" && p.discountPrice > 0
                  ? p.discountPrice
                  : typeof p.basePrice === "number" && p.basePrice > 0
                  ? p.basePrice
                  : null,
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
  ["trophy", "trophies", "award", "awards", "memento", "mementos", "plaque", "plaques", "shield", "shields", "medal"],
  ["menu", "menus", "tent", "qr", "standee", "holder", "holders", "brochure", "leaflet", "pamphlet", "flyer"],
  ["donation", "charity", "ballot", "suggestion", "lottery", "drop"],
  ["saree", "garment", "showcase", "riser", "risers", "turntable", "merchandise", "retail"],
  ["table", "tables", "chair", "chairs", "stool", "stools", "desk", "desks", "furniture", "bedside", "coffee", "dining"],
  ["tray", "trays", "dispenser", "dispensers", "candy", "lollipop", "beverage", "juice"],
  ["signage", "sign", "nameplate", "board", "boards", "keychain", "keychains", "badge", "badges"],
  ["polisher", "polishing", "buffing", "diamond"],
  ["bender", "bending", "heater", "heating"],
  ["router", "cnc", "laser", "cutter", "cutting", "blade", "blades"],
  ["sheet", "sheets", "mirror", "tube", "tubes", "rod", "rods"],
];

export function extractBudgetConstraintsFromQuery(rawQuery: string): {
  maxPrice: number | null;
  minPrice: number | null;
} {
  const normalized = rawQuery.replace(/,/g, "").toLowerCase();
  let maxPrice: number | null = null;
  let minPrice: number | null = null;

  const parseAmount = (numStr: string, kSuffix?: string): number | null => {
    const val = parseFloat(numStr);
    if (!Number.isFinite(val) || val <= 0) return null;
    return kSuffix ? Math.round(val * 1000) : Math.round(val);
  };

  const maxMatch = normalized.match(
    /\b(?:under|below|within|upto|up\s*to|less\s*than|max|maximum|budget(?:\s*of|\s*is)?)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k)?\b/i
  );
  if (maxMatch?.[1]) {
    maxPrice = parseAmount(maxMatch[1], maxMatch[2]);
  }

  const minMatch = normalized.match(
    /\b(?:above|over|more\s*than|min|minimum|starting(?:\s*from)?)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k)?\b/i
  );
  if (minMatch?.[1]) {
    minPrice = parseAmount(minMatch[1], minMatch[2]);
  }

  const rangeMatch = normalized.match(
    /\bbetween\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k)?\s*(?:and|to|-)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(k)?\b/i
  );
  if (rangeMatch?.[1] && rangeMatch?.[3]) {
    minPrice = parseAmount(rangeMatch[1], rangeMatch[2]);
    maxPrice = parseAmount(rangeMatch[3], rangeMatch[4]);
  }

  return { maxPrice, minPrice };
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

export function searchEcosystemItems(
  items: MainWebsiteProduct[],
  searchQuery: string,
  limit = 6
): MainWebsiteProduct[] {
  const cleanItems = items.filter((i) => !isDummyPlaceholderRow(i.id, i.name));
  const q = searchQuery.trim().toLowerCase();
  if (!q) return cleanItems.slice(0, limit);

  const { maxPrice, minPrice } = extractBudgetConstraintsFromQuery(searchQuery);

  // Strip currency amounts so price digits ("25", "000", "25000") do not match random SKUs or sizes
  const queryWithoutPrices = q
    .replace(/(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?\s*k?\b/gi, " ")
    .replace(/\b(?:under|below|within|upto|up\s*to|above|over|budget)\s*[\d,]+(?:\.\d+)?\s*k?\b/gi, " ");

  const rawTokens = tokenizeWords(queryWithoutPrices).filter(
    (t) =>
      t.length >= 2 &&
      !SEARCH_STOPWORDS.has(t) &&
      !/^\d+$/.test(t) &&
      t !== "acrylic"
  );

  // If user literally only typed "acrylic", allow "acrylic" as fallback token
  const directTokens =
    rawTokens.length > 0
      ? rawTokens
      : q.includes("acrylic")
      ? ["acrylic"]
      : [];

  if (directTokens.length === 0) {
    if (maxPrice !== null || minPrice !== null) {
      return cleanItems
        .filter((it) => {
          if (typeof it.basePrice !== "number" || it.basePrice <= 0) return false;
          if (maxPrice !== null && it.basePrice > maxPrice) return false;
          if (minPrice !== null && it.basePrice < minPrice) return false;
          return true;
        })
        .slice(0, limit);
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

  const wantsMachine =
    /\b(machine|machines|laser|cnc|router|polisher|polishing|diamond|bending|bender|heater|blade|blades|cutter|ce53|yn-)\b/i.test(
      q
    );

  const scored: { item: MainWebsiteProduct; score: number }[] = [];

  for (const item of cleanItems) {
    // Enforce budget constraints strictly on priced items
    if (typeof item.basePrice === "number" && item.basePrice > 0) {
      if (maxPrice !== null && item.basePrice > maxPrice) continue;
      if (minPrice !== null && item.basePrice < minPrice) continue;
    }

    const nameWords = tokenizeWords(item.name);
    const catWords = tokenizeWords(item.categoryName);
    const skuLower = (item.sku || "").toLowerCase();
    const modelLower = (item.modelsSummary || "").toLowerCase();
    const descWords = tokenizeWords(
      `${item.description || ""} ${item.specsSummary || ""}`
    );

    let matchScore = 0;

    for (const tok of directTokens) {
      if (skuLower && skuLower.includes(tok) && tok.length >= 3) {
        matchScore += 30;
      } else if (modelLower && modelLower.includes(tok) && tok.length >= 3) {
        matchScore += 26;
      }
      if (nameWords.some((w) => wordMatchesToken(w, tok))) {
        matchScore += 24;
      }
      if (catWords.some((w) => wordMatchesToken(w, tok))) {
        matchScore += 18;
      }
      if (descWords.some((w) => wordMatchesToken(w, tok))) {
        matchScore += 5;
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

    // Do NOT include items with zero topical match!
    if (matchScore <= 0) continue;

    if (wantsMachine && item.brand === "CLASSIC_EDGE_53") {
      matchScore += 10;
    } else if (!wantsMachine && item.brand === "CLASSIC_EDGE_53") {
      // Prevent machines/ovens from polluting product searches like "pulpits" or "stands"
      matchScore -= 16;
    }

    if (maxPrice !== null || minPrice !== null) {
      if (typeof item.basePrice === "number" && item.basePrice > 0) {
        matchScore += 12;
      } else {
        // Keep unpriced customisable models in the same category below confirmed-budget items
        matchScore -= 4;
      }
    }

    if (matchScore > 0) {
      scored.push({ item, score: matchScore });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // When customer gave a budget, prefer priced items sorted closest-to-budget / ascending
    const aP = typeof a.item.basePrice === "number" && a.item.basePrice > 0 ? a.item.basePrice : Infinity;
    const bP = typeof b.item.basePrice === "number" && b.item.basePrice > 0 ? b.item.basePrice : Infinity;
    return aP - bP;
  });

  return scored.slice(0, limit).map((s) => s.item);
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
