import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

export type DatabaseDomain =
  | "core_auth"
  | "conversations"
  | "crm_orders"
  | "marketing"
  | "billing_ops"
  | "queue_jobs";

export const DATABASE_FILES: Record<DatabaseDomain, string> = {
  core_auth: "core_auth.db",
  conversations: "conversations.db",
  crm_orders: "crm_orders.db",
  marketing: "marketing.db",
  billing_ops: "billing_ops.db",
  queue_jobs: "queue_jobs.db",
};

export const DATABASE_DESCRIPTIONS: Record<DatabaseDomain, string> = {
  core_auth: "Team accounts, email verification codes, approvals, and Facebook connection settings",
  conversations: "Customer WhatsApp chats, messages, staff assignments, auto-replies, and short links",
  crm_orders: "Customer contact details, orders, and past enquiry history",
  marketing: "Message templates, ACRIO customer lists, and broadcast campaigns",
  billing_ops: "Message charges, rates, and daily Google Drive backup history",
  queue_jobs: "Scheduled background tasks and broadcast queue",
};

export function resolveMonorepoRoot(): string {
  if (process.env.CCWHATSAPP_ROOT) {
    return path.resolve(process.env.CCWHATSAPP_ROOT);
  }
  const cwd = process.cwd();
  if (cwd.endsWith(path.join("apps", "web"))) {
    return path.resolve(cwd, "..", "..");
  }
  if (fs.existsSync(path.join(cwd, "ccwhatsapp"))) {
    return path.join(cwd, "ccwhatsapp");
  }
  return cwd;
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
export const crmDb = () => getDrizzleDb("crm_orders");
export const marketingDb = () => getDrizzleDb("marketing");
export const billingDb = () => getDrizzleDb("billing_ops");
export const queueDb = () => getDrizzleDb("queue_jobs");

/**
 * Optional read-only LibSQL bridge to the main Classic Concepts website SQLite DB (`../dev.db`)
 * so ACRIO inside WhatsApp can suggest real products, prices, SKUs, and surface past website enquiries!
 */
export interface MainWebsiteProduct {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  categoryName: string;
  basePrice: number | null;
  mainImage: string | null;
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
    path.resolve(root, "..", "dev.db"),
    path.resolve(root, "..", "classicconcepts", "dev.db"),
    "C:/Users/DELL/Desktop/classicconcepts/dev.db",
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

export async function fetchClassicCatalogProducts(
  searchQuery = "",
  limit = 12
): Promise<MainWebsiteProduct[]> {
  try {
    const client = getMainCatalogClient();
    if (!client) return FALLBACK_CLASSIC_CATALOG.slice(0, limit);

    const q = searchQuery.trim().toLowerCase();
    const res = await client.execute({
      sql: `
        SELECT p.id, p.name, p.slug, p.sku, p.basePrice, p.images, c.name as categoryName
        FROM Product p
        LEFT JOIN Category c ON p.categoryId = c.id
        WHERE p.isActive = 1
        ORDER BY p.isFeatured DESC, p.updatedAt DESC
        LIMIT 60
      `,
      args: [],
    });

    const mapped: MainWebsiteProduct[] = res.rows.map((r) => {
      let mainImage: string | null = null;
      try {
        const imgs = JSON.parse(String(r.images || "[]"));
        if (Array.isArray(imgs) && imgs.length > 0) mainImage = String(imgs[0]);
      } catch {
        mainImage = null;
      }
      return {
        id: String(r.id),
        name: String(r.name),
        slug: String(r.slug),
        sku: r.sku ? String(r.sku) : null,
        categoryName: r.categoryName ? String(r.categoryName) : "Acrylic Products",
        basePrice: typeof r.basePrice === "number" ? r.basePrice : Number(r.basePrice) || null,
        mainImage,
      };
    });

    if (mapped.length === 0) return FALLBACK_CLASSIC_CATALOG.slice(0, limit);
    if (!q) return mapped.slice(0, limit);

    const filtered = mapped.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.sku || "").toLowerCase().includes(q) ||
        item.categoryName.toLowerCase().includes(q)
    );
    return (filtered.length > 0 ? filtered : mapped).slice(0, limit);
  } catch {
    return FALLBACK_CLASSIC_CATALOG.slice(0, limit);
  }
}

export async function fetchWebsiteEnquiriesForCustomer(
  phoneDigitsOrEmail: string
): Promise<MainWebsiteEnquiry[]> {
  try {
    const client = getMainCatalogClient();
    if (!client || !phoneDigitsOrEmail) return [];
    const last10 = phoneDigitsOrEmail.replace(/\D/g, "").slice(-10);
    if (last10.length < 7 && !phoneDigitsOrEmail.includes("@")) return [];

    const res = await client.execute({
      sql: `
        SELECT id, name, email, phone, message, source, status, createdAt
        FROM Enquiry
        WHERE (? != '' AND phone LIKE ?) OR (? != '' AND LOWER(email) = LOWER(?))
        ORDER BY createdAt DESC
        LIMIT 5
      `,
      args: [
        last10,
        `%${last10}%`,
        phoneDigitsOrEmail.includes("@") ? phoneDigitsOrEmail : "",
        phoneDigitsOrEmail,
      ],
    });

    return res.rows.map((r) => ({
      id: String(r.id),
      name: String(r.name || ""),
      email: String(r.email || ""),
      phone: String(r.phone || ""),
      message: String(r.message || ""),
      source: String(r.source || "Website"),
      status: String(r.status || "New"),
      createdAt: String(r.createdAt || ""),
    }));
  } catch {
    return [];
  }
}

/**
 * Hot atomic LibSQL snapshot export using `VACUUM INTO` so live databases are never corrupted
 * during the Midnight Google Drive Backup Worker run!
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
    name: "Full Clear Auditorium Acrylic Podium CCP-053",
    slug: "acrylic-podium-ccp053",
    sku: "CCP-053",
    categoryName: "Acrylic Podiums",
    basePrice: 24500,
    mainImage: null,
  },
  {
    id: "cat_tstand_a4",
    name: "Crystal Clear A4 Table Menu & Sign Stand",
    slug: "a4-t-stand-1",
    sku: "CC-TS-A4",
    categoryName: "Signage & Holders",
    basePrice: 450,
    mainImage: null,
  },
  {
    id: "cat_memento_01",
    name: "Acrylic Flame Excellence Memento & Trophy",
    slug: "acrylic-ganesha-flame-memento",
    sku: "CC-AWD-01",
    categoryName: "Awards & Mementos",
    basePrice: 1250,
    mainImage: null,
  },
  {
    id: "cat_box_don",
    name: "Lockable Clear Acrylic Suggestion & Donation Box",
    slug: "acrylic-donation-box",
    sku: "CC-BOX-12",
    categoryName: "Boxes & Enclosures",
    basePrice: 1850,
    mainImage: null,
  },
];
