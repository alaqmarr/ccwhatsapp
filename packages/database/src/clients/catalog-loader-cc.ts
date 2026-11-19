import { resolveClassicConceptsInternalUrl } from "./env-config";
import { getMainCatalogClient } from "./handles";
import { ensureEcosystemProductShortLinks } from "./short-links";
import { FALLBACK_CLASSIC_CATALOG } from "./fallback-catalogs";
import {
  buildEcosystemItemSearchBlob,
  isDummyPlaceholderRow,
  isEcosystemDimensionSpec,
  normalizeCatalogHtmlToText,
  type EcosystemSpecItem,
  type EcosystemVariantItem,
  type MainWebsiteProduct,
} from "./catalog-types";

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
      // Fallback to direct SQLite read below
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
