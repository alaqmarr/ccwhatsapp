import { resolveClassicEdgeInternalUrl } from "./env-config";
import { getClassicEdgeClient } from "./handles";
import { ensureEcosystemProductShortLinks } from "./short-links";
import { FALLBACK_CLASSIC_EDGE_MACHINES } from "./fallback-catalogs";
import {
  buildEcosystemItemSearchBlob,
  isDummyPlaceholderRow,
  type EcosystemModelItem,
  type EcosystemSpecItem,
  type MainWebsiteProduct,
} from "./catalog-types";

function parseClassicEdgeApiPayload(data: any): MainWebsiteProduct[] {
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
  return combined;
}

/**
 * Loads all Classic Edge 53 machines, models (`YN-JW1200`, `YN-JW1600`, `ABM-1250`, `ABM-2400`, CNC, laser, polishing, bending),
 * product-level and model-specific specifications, features, resources, and consumables (`classicedge53.com`) via API or direct SQLite read.
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
        const combined = parseClassicEdgeApiPayload(data);
        if (combined.length > 0) {
          return ensureEcosystemProductShortLinks(combined);
        }
      }
    } catch {
      // Fallback to direct SQLite read below
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
      const combined = parseClassicEdgeApiPayload(data);
      if (combined.length > 0) {
        return ensureEcosystemProductShortLinks(combined);
      }
    }
  } catch {
    // Ignore remote fallback error
  }

  return ensureEcosystemProductShortLinks(FALLBACK_CLASSIC_EDGE_MACHINES);
}
