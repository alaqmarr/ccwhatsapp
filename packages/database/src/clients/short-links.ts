import crypto from "node:crypto";
import { resolveShortLinkDomainOrigin } from "./env-config";
import { getRawLibSqlClient } from "./handles";
import {
  cleanDisplayProductName,
  normalizePublicEcosystemUrl,
  type MainWebsiteProduct,
} from "./catalog-types";

const SHORT_OUTER_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const SHORT_INNER_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789_-";

/**
 * Generates an exact 6-character URL-safe short ID for `https://ccapl.cc/<6-char-id>`.
 * Strictly uses URL-safe alphanumeric + `_`/`-` characters so WhatsApp, SMS, iOS, and Android link detectors never break URLs.
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

function buildPreferredProductShortCode(item: MainWebsiteProduct, salt = 0): string {
  const brandPrefix = item.brand === "CLASSIC_EDGE_53" ? "ce53" : "cc";
  const seed = `${brandPrefix}:${item.itemType.toLowerCase()}:${item.slug || item.id}`;
  return generateSixCharShortCode(seed, salt);
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
