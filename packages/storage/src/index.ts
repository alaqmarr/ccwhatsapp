import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolveMonorepoRoot,
} from "@cc/database";

export interface CustomAdminLinkItem {
  id: string;
  code: string;
  title: string;
  targetUrl: string;
  linkType: "PRODUCT" | "CATALOG" | "QUOTE_PAYMENT" | "CUSTOM_ADMIN";
  productSlug: string | null;
  utmCampaign: string | null;
  createdByName: string;
  clicksCount: number;
  lastClickedAt: string | null;
  createdAt: string;
}

function mapLinkRow(r: Record<string, unknown>): CustomAdminLinkItem {
  return {
    id: String(r.id),
    code: String(r.code),
    title: String(r.title),
    targetUrl: String(r.target_url),
    linkType: String(r.link_type || "PRODUCT") as CustomAdminLinkItem["linkType"],
    productSlug: r.product_slug ? String(r.product_slug) : null,
    utmCampaign: r.utm_campaign ? String(r.utm_campaign) : null,
    createdByName: String(r.created_by_name || "Admin"),
    clicksCount: Number(r.clicks_count ?? 0),
    lastClickedAt: r.last_clicked_at ? String(r.last_clicked_at) : null,
    createdAt: String(r.created_at),
  };
}

export async function listCustomAdminLinks(): Promise<CustomAdminLinkItem[]> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const res = await conv.execute(
    `SELECT * FROM custom_links ORDER BY clicks_count DESC, created_at DESC`
  );
  return res.rows.map((r) => mapLinkRow(r as Record<string, unknown>));
}

export async function createCustomAdminLink(params: {
  code?: string;
  title: string;
  targetUrl: string;
  linkType?: CustomAdminLinkItem["linkType"];
  productSlug?: string;
  utmCampaign?: string;
  createdByName: string;
}): Promise<{ ok: boolean; link?: CustomAdminLinkItem; error?: string }> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");

  const slugCode = (
    params.code?.trim() ||
    params.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 28) ||
    `link-${crypto.randomUUID().slice(0, 6)}`
  ).toLowerCase();

  if (!params.targetUrl.trim().startsWith("http") && !params.targetUrl.trim().startsWith("/")) {
    return {
      ok: false,
      error: "Target URL must start with https://, http://, or /.",
    };
  }

  const existing = await conv.execute({
    sql: `SELECT id FROM custom_links WHERE code = ? LIMIT 1`,
    args: [slugCode],
  });
  const finalCode =
    existing.rows.length > 0
      ? `${slugCode}-${crypto.randomUUID().slice(0, 4)}`
      : slugCode;

  const id = `lnk_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  await conv.execute({
    sql: `INSERT INTO custom_links (
      id, code, title, target_url, link_type, product_slug, utm_campaign, created_by_name, clicks_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    args: [
      id,
      finalCode,
      params.title.trim(),
      params.targetUrl.trim(),
      params.linkType || "CUSTOM_ADMIN",
      params.productSlug || null,
      params.utmCampaign || null,
      params.createdByName,
      now,
    ],
  });

  const created = await conv.execute({
    sql: `SELECT * FROM custom_links WHERE id = ? LIMIT 1`,
    args: [id],
  });

  return {
    ok: true,
    link: created.rows[0]
      ? mapLinkRow(created.rows[0] as Record<string, unknown>)
      : undefined,
  };
}

export async function resolveAndTrackCustomLink(
  code: string
): Promise<CustomAdminLinkItem | null> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const cleanCode = code.trim().toLowerCase();

  const res = await conv.execute({
    sql: `SELECT * FROM custom_links WHERE LOWER(code) = ? LIMIT 1`,
    args: [cleanCode],
  });

  if (!res.rows[0]) return null;
  const item = mapLinkRow(res.rows[0] as Record<string, unknown>);

  await conv.execute({
    sql: `UPDATE custom_links
          SET clicks_count = clicks_count + 1,
              last_clicked_at = ?
          WHERE id = ?`,
    args: [new Date().toISOString(), item.id],
  });

  return { ...item, clicksCount: item.clicksCount + 1 };
}

export function resolveUploadsDirectory(): string {
  const dir = path.join(resolveMonorepoRoot(), "uploads");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export {
  WHATSAPP_REDIS_MAX_BYTES,
  WHATSAPP_CACHE_TAGS,
  type WhatsAppCacheTag,
  rememberWhatsAppCache,
  invalidateWhatsAppCacheTags,
  getWhatsAppCacheSummary,
} from "./redis-cache";
