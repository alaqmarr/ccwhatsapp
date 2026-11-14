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
  conversations: "Customer WhatsApp chats, internal notes, team escalations, auto-replies, and short links",
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
export const crmDb = () => getDrizzleDb("crm_orders");
export const marketingDb = () => getDrizzleDb("marketing");
export const billingDb = () => getDrizzleDb("billing_ops");
export const queueDb = () => getDrizzleDb("queue_jobs");

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
  modelsSummary?: string | null;
  specsSummary?: string | null;
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
          return data.products.map((p: any) => ({
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
        }
      }
    } catch {
      // Fallback to direct LibSQL read below
    }
  }

  try {
    const client = getMainCatalogClient();
    if (!client) return FALLBACK_CLASSIC_CATALOG;

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

    if (res.rows.length === 0) return FALLBACK_CLASSIC_CATALOG;

    return res.rows.map((r) => {
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
  } catch {
    return FALLBACK_CLASSIC_CATALOG;
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
        if (combined.length > 0) return combined;
      }
    } catch {
      // Fallback to direct LibSQL read below
    }
  }

  try {
    const client = getClassicEdgeClient();
    if (!client) return FALLBACK_CLASSIC_EDGE_MACHINES;

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

    return items.length > 0 ? items : FALLBACK_CLASSIC_EDGE_MACHINES;
  } catch {
    return FALLBACK_CLASSIC_EDGE_MACHINES;
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

/**
 * Resolves a single shared Anthropic API key across:
 * 1. `core_auth.db` (`setup_state` key `ai_config`)
 * 2. Environment variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_ADMIN_API_KEY`, `ANTHROPIC_CLIENT_API_KEY`)
 * 3. `classicconcepts/dev.db` (`SiteSetting.anthropicApiKey || anthropicAdminApiKey || anthropicClientApiKey`)
 * 4. `.env` / `.env.local` in `classicconcepts`
 */
export async function resolveSharedAnthropicApiKey(): Promise<{
  apiKey: string;
  source: "whatsapp_settings" | "env" | "classicconcepts_db" | "classicconcepts_env" | "none";
}> {
  // 1. Check WhatsApp setup_state
  try {
    const auth = getRawLibSqlClient("core_auth");
    const row = await auth.execute(
      `SELECT value_json FROM setup_state WHERE key = 'ai_config' LIMIT 1`
    );
    if (row.rows[0]?.value_json) {
      const parsed = JSON.parse(String(row.rows[0].value_json));
      const key = String(parsed?.anthropicApiKey || "").trim();
      if (key.startsWith("sk-ant-")) {
        return { apiKey: key, source: "whatsapp_settings" };
      }
    }
  } catch {
    // Table may not be initialized yet
  }

  // 2. Check process.env
  const envKey = (
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_ADMIN_API_KEY ||
    process.env.ANTHROPIC_CLIENT_API_KEY ||
    ""
  ).trim();
  if (envKey.startsWith("sk-ant-")) {
    return { apiKey: envKey, source: "env" };
  }

  // 3. Check classicconcepts SiteSetting table so one key works everywhere automatically
  try {
    const ccClient = getMainCatalogClient();
    if (ccClient) {
      const sRes = await ccClient.execute(
        `SELECT anthropicApiKey, anthropicAdminApiKey, anthropicClientApiKey FROM SiteSetting LIMIT 1`
      );
      const r = sRes.rows[0];
      if (r) {
        const dbKey = String(
          r.anthropicApiKey || r.anthropicAdminApiKey || r.anthropicClientApiKey || ""
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
    for (const p of ccEnvPaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf8");
        const match = content.match(
          /ANTHROPIC(?:_ADMIN|_CLIENT)?_API_KEY\s*=\s*["']?(sk-ant-[A-Za-z0-9_-]+)["']?/
        );
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

export async function saveSharedAnthropicApiKey(apiKey: string): Promise<void> {
  const auth = getRawLibSqlClient("core_auth");
  const clean = apiKey.trim();
  const now = new Date().toISOString();
  await auth.execute({
    sql: `INSERT INTO setup_state (key, value_json, updated_at)
          VALUES ('ai_config', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    args: [JSON.stringify({ anthropicApiKey: clean, model: "claude-haiku-5-5" }), now],
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
