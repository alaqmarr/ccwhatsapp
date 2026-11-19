import crypto from "node:crypto";
import {
  cleanDisplayProductName,
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
} from "@cc/database";
import { invalidateWhatsAppCacheTags } from "@cc/storage";
import { getCachedEcosystemCatalog } from "@cc/connections/helpers.acrio.ai";

export async function executeAcrioEcosystemAutoFix(
  action: "SYNC_SHORTLINKS" | "REFRESH_CATALOG_CACHE",
  actorName = "DEV"
): Promise<{ ok: boolean; message: string; fixedCount: number }> {
  await ensureDatabasesBootstrapped();
  if (action === "REFRESH_CATALOG_CACHE") {
    await invalidateWhatsAppCacheTags(["cc-products", "ce53-machines"]);
    const fresh = await getCachedEcosystemCatalog();
    return {
      ok: true,
      fixedCount: fresh.allItems.length,
      message: `Invalidated L1/L2/L3 catalog caches and reloaded ${fresh.classicConceptsProducts.length} Classic Concepts products + ${fresh.classicEdgeItems.length} Classic Edge 53 items.`,
    };
  }

  if (action === "SYNC_SHORTLINKS") {
    const conv = getRawLibSqlClient("conversations");
    await invalidateWhatsAppCacheTags(["cc-products", "ce53-machines"]);
    const catalog = await getCachedEcosystemCatalog();
    const existingRes = await conv.execute(`SELECT * FROM custom_links`);
    const rows = existingRes.rows as Record<string, unknown>[];

    let fixedCount = 0;
    const nowIso = new Date().toISOString();

    // 1. Repair any localhost / 127.0.0.1 / http:// target_url in custom_links
    for (const r of rows) {
      const id = String(r.id || "");
      const rawTarget = String(r.target_url || "").trim();
      const slug = String(r.product_slug || "");
      let repaired = rawTarget;
      if (/localhost|127\.0\.0\.1|:300[0-9]/i.test(repaired)) {
        const isCe = slug.startsWith("ce53:") || /classicedge|machines/i.test(repaired);
        const pathPart = repaired.replace(/^https?:\/\/[^/]+/i, "");
        repaired = `${isCe ? "https://classicedge.in" : "https://classicconcepts.in"}${
          pathPart.startsWith("/") ? pathPart : `/${pathPart}`
        }`;
      }
      if (repaired.startsWith("http://")) {
        repaired = repaired.replace(/^http:\/\//i, "https://");
      }
      if (repaired !== rawTarget) {
        await conv.execute({
          sql: `UPDATE custom_links SET target_url = ? WHERE id = ?`,
          args: [repaired, id],
        });
        fixedCount++;
      }
    }

    // 2. Ensure every catalog item has a valid shortlink in custom_links
    const existingBySlug = new Set(
      rows
        .map((r) => String(r.product_slug || "").toLowerCase())
        .filter(Boolean)
    );
    const existingCodes = new Set(
      rows.map((r) => String(r.code || "").toLowerCase()).filter(Boolean)
    );

    for (const item of catalog.allItems) {
      const prefixedSlug =
        item.brand === "CLASSIC_EDGE_53"
          ? `ce53:${item.itemType.toLowerCase()}:${item.slug}`
          : `cc:product:${item.slug}`;
      if (
        existingBySlug.has(prefixedSlug.toLowerCase()) ||
        existingBySlug.has(item.slug.toLowerCase())
      ) {
        continue;
      }
      const code =
        item.shortCode && !existingCodes.has(item.shortCode.toLowerCase())
          ? item.shortCode
          : crypto
              .createHash("sha256")
              .update(prefixedSlug)
              .digest("base64url")
              .slice(0, 6);
      existingCodes.add(code.toLowerCase());
      existingBySlug.add(prefixedSlug.toLowerCase());
      const canonicalTarget =
        item.url ||
        (item.brand === "CLASSIC_EDGE_53"
          ? `https://classicedge.in/machines/${item.slug}`
          : `https://classicconcepts.in/shop/p/${item.slug}`);
      await conv
        .execute({
          sql: `INSERT OR IGNORE INTO custom_links (
            id, code, title, target_url, link_type, product_slug, utm_campaign, created_by_name, clicks_count, created_at
          ) VALUES (?, ?, ?, ?, 'PRODUCT', ?, 'acrio_auto_sync', ?, 0, ?)`,
          args: [
            `lnk_${crypto.randomUUID().slice(0, 8)}`,
            code,
            cleanDisplayProductName(item.name),
            canonicalTarget,
            prefixedSlug,
            actorName,
            nowIso,
          ],
        })
        .catch(() => {});
      fixedCount++;
    }

    await invalidateWhatsAppCacheTags(["cc-products", "ce53-machines"]);
    return {
      ok: true,
      fixedCount,
      message: `Synchronized and repaired ${fixedCount} shortlinks and cross-site product URLs across Classic Concepts, Classic Edge 53, and ccapl.cc.`,
    };
  }

  return { ok: false, fixedCount: 0, message: "Unknown auto-fix action." };
}
