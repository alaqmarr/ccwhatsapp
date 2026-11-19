import {
  cleanDisplayProductName,
  readAiTraceLogs,
  type MainWebsiteProduct,
} from "@cc/database";
import type { IssuePushFn } from "./types";

export function scanShortlinksAndCrossSite(
  linkRows: Record<string, unknown>[],
  allSlugsSet: Set<string>,
  pushIssue: IssuePushFn
): void {
  const customLinksBySlug = new Map<string, Record<string, unknown>[]>();
  const customLinksByTarget = new Map<string, Record<string, unknown>[]>();

  for (const row of linkRows) {
    const code = String(row.code || "");
    const title = String(row.title || "");
    const targetUrl = String(row.target_url || "").trim();
    const productSlug = String(row.product_slug || "").trim();
    const linkType = String(row.link_type || "PRODUCT");
    const shortUrl = `https://ccapl.cc/${code}`;

    if (productSlug) {
      const k = productSlug.toLowerCase();
      customLinksBySlug.set(k, [...(customLinksBySlug.get(k) || []), row]);
    }
    if (targetUrl) {
      const k = targetUrl.toLowerCase().replace(/\/+$/, "");
      customLinksByTarget.set(k, [...(customLinksByTarget.get(k) || []), row]);
    }

    if (/localhost|127\.0\.0\.1|:300[0-9]/i.test(targetUrl)) {
      pushIssue({
        severity: "CRITICAL",
        category: "SHORTLINKS_AND_CROSS_SITE",
        site: "SHORTLINK_ROUTER",
        title: "Shortlink points to localhost / internal port",
        detail: `Shortlink ${shortUrl} ("${title}") redirects to "${targetUrl}", which will fail for external WhatsApp customers.`,
        affectedEntity: `${code} (${title})`,
        skuOrCode: code,
        sourceUrl: shortUrl,
        targetUrl,
        autoFixAction: "SYNC_SHORTLINKS",
        suggestion:
          "Click 'Auto-Fix & Sync Shortlinks' to rewrite the target URL to the public https:// domain.",
      });
    } else if (targetUrl.startsWith("http://")) {
      pushIssue({
        severity: "WARNING",
        category: "SHORTLINKS_AND_CROSS_SITE",
        site: "SHORTLINK_ROUTER",
        title: "Shortlink uses unencrypted HTTP target URL",
        detail: `Shortlink ${shortUrl} ("${title}") points to "${targetUrl}" instead of https://.`,
        affectedEntity: `${code} (${title})`,
        skuOrCode: code,
        sourceUrl: shortUrl,
        targetUrl,
        autoFixAction: "SYNC_SHORTLINKS",
        suggestion: "Upgrade target URL to https:// via 'Auto-Fix & Sync Shortlinks'.",
      });
    }

    if (linkType === "PRODUCT" && productSlug) {
      const bareSlug = productSlug
        .replace(/^(?:cc|ce53):(?:product|machine|consumable):/i, "")
        .toLowerCase();
      if (
        bareSlug &&
        !bareSlug.startsWith("cat:") &&
        !allSlugsSet.has(bareSlug) &&
        !allSlugsSet.has(productSlug.toLowerCase())
      ) {
        pushIssue({
          severity: "WARNING",
          category: "SHORTLINKS_AND_CROSS_SITE",
          site: "SHORTLINK_ROUTER",
          title: "Orphaned product shortlink (slug not found in catalog)",
          detail: `Shortlink ${shortUrl} references product_slug="${productSlug}", which does not match any active product in Classic Concepts or Classic Edge 53.`,
          affectedEntity: `${code} -> ${productSlug}`,
          skuOrCode: code,
          sourceUrl: shortUrl,
          targetUrl,
          suggestion:
            "Verify if this product was renamed or deleted on classicconcepts.in / classicedge.in and update the shortlink target.",
        });
      }
    }
  }
}

export function scanClassicConceptsProducts(
  ccProducts: MainWebsiteProduct[],
  skuMap: Map<string, MainWebsiteProduct[]>,
  pushIssue: IssuePushFn
): void {
  for (const prod of ccProducts) {
    const displayName = cleanDisplayProductName(prod.name);
    const publicUrl = prod.url || `https://classicconcepts.in/shop/p/${prod.slug}`;
    const adminUrl = `https://classicconcepts.in/admin/products/${prod.id}`;
    const isPodium =
      (prod.podiumSubCategoryNames && prod.podiumSubCategoryNames.length > 0) ||
      /podium|lectern|pulpit/i.test(`${prod.categoryName || ""} ${prod.name}`);

    if (!prod.shortUrl || !prod.shortUrl.includes("ccapl.cc/")) {
      pushIssue({
        severity: "WARNING",
        category: "SHORTLINKS_AND_CROSS_SITE",
        site: "CLASSIC_CONCEPTS",
        title: "Product missing ccapl.cc shortlink",
        detail: `${displayName} (${prod.slug}) does not have a registered ccapl.cc shortlink for WhatsApp replies.`,
        affectedEntity: displayName,
        skuOrCode: prod.sku || prod.slug,
        sourceUrl: publicUrl,
        adminEditUrl: adminUrl,
        autoFixAction: "SYNC_SHORTLINKS",
        suggestion: "Run 'Auto-Fix & Sync Shortlinks' to generate its 6-char ccapl.cc link.",
      });
    }

    const allImgs = [
      ...(prod.mainImage ? [prod.mainImage] : []),
      ...(prod.images || []),
    ].filter(Boolean);
    if (allImgs.length === 0) {
      pushIssue({
        severity: "CRITICAL",
        category: "PRODUCT_MEDIA_AND_R2",
        site: "CLASSIC_CONCEPTS",
        title: "Product has no photos in storage",
        detail: `${displayName} has 0 images. Customers on classicconcepts.in cannot see the product and ACRIO cannot share photos on WhatsApp.`,
        affectedEntity: displayName,
        skuOrCode: prod.sku || prod.slug,
        sourceUrl: publicUrl,
        adminEditUrl: adminUrl,
        suggestion: "Upload product photos to R2 storage in the Product Editor.",
      });
    } else {
      const relativeOrHttpImgs = allImgs.filter((u) => !/^https:\/\//i.test(u.trim()));
      if (relativeOrHttpImgs.length > 0) {
        pushIssue({
          severity: "WARNING",
          category: "PRODUCT_MEDIA_AND_R2",
          site: "CLASSIC_CONCEPTS",
          title: "Product has relative or non-HTTPS image URL",
          detail: `${displayName} has ${relativeOrHttpImgs.length} image URL(s) not served over https:// (${relativeOrHttpImgs[0]}). WhatsApp Cloud API requires public https:// R2 URLs to attach images.`,
          affectedEntity: displayName,
          skuOrCode: prod.sku || prod.slug,
          sourceUrl: publicUrl,
          targetUrl: relativeOrHttpImgs[0],
          adminEditUrl: adminUrl,
          suggestion: "Ensure all product images use full https://media.classicconcepts.in/... URLs.",
        });
      }
    }

    const variants = prod.variants || [];
    if (variants.length > 0) {
      const variantsMissingImg = variants.filter((v) => !v.imageUrl);
      if (variantsMissingImg.length > 0) {
        pushIssue({
          severity: "WARNING",
          category: "PRODUCT_MEDIA_AND_R2",
          site: "CLASSIC_CONCEPTS",
          title: "Product variant(s) missing dedicated photo",
          detail: `${displayName} has ${variantsMissingImg.length} variant(s) without a dedicated photo (${variantsMissingImg.map((v) => v.name).join(", ")}). When a customer asks ACRIO for that specific colour photo, ACRIO has to fall back to the main image.`,
          affectedEntity: `${displayName} [${variantsMissingImg.map((v) => v.name).join(", ")}]`,
          skuOrCode: prod.sku || prod.slug,
          sourceUrl: publicUrl,
          adminEditUrl: adminUrl,
          suggestion: "Assign a variant-specific R2 photo to each colour variant in Manage Variants.",
        });
      }

      if (variants.length >= 2) {
        const varUrls = variants.map((v) => v.imageUrl || "").filter(Boolean);
        if (varUrls.length >= 2 && new Set(varUrls).size === 1) {
          pushIssue({
            severity: "INFO",
            category: "PRODUCT_MEDIA_AND_R2",
            site: "CLASSIC_CONCEPTS",
            title: "All colour variants point to the same image URL",
            detail: `${displayName} has ${variants.length} variants (${variants.map((v) => v.name).join(", ")}) that all use the exact same image file.`,
            affectedEntity: displayName,
            skuOrCode: prod.sku || prod.slug,
            sourceUrl: publicUrl,
            adminEditUrl: adminUrl,
            suggestion: "Upload distinct colour photos per variant so customers see the true colour finish.",
          });
        }
      }
    }

    if (prod.basePrice === null || prod.basePrice <= 0) {
      pushIssue({
        severity: "WARNING",
        category: "PRICING_AND_SPECS",
        site: "CLASSIC_CONCEPTS",
        title: "Product has no selling price (Price on Request / ₹0)",
        detail: `${displayName} has basePrice=${prod.basePrice ?? "null"}. ACRIO cannot include it in strict budget calculations or multi-item project quotes.`,
        affectedEntity: displayName,
        skuOrCode: prod.sku || prod.slug,
        sourceUrl: publicUrl,
        adminEditUrl: adminUrl,
        suggestion: "Set a verified base/selling price in the Product Editor if this is a ready-stock model.",
      });
    } else if (
      typeof prod.regularPrice === "number" &&
      prod.regularPrice > 0 &&
      prod.regularPrice < prod.basePrice
    ) {
      pushIssue({
        severity: "CRITICAL",
        category: "PRICING_AND_SPECS",
        site: "CLASSIC_CONCEPTS",
        title: "MRP is lower than selling price",
        detail: `${displayName} has selling price ₹${prod.basePrice.toLocaleString("en-IN")} > MRP ₹${prod.regularPrice.toLocaleString("en-IN")}.`,
        affectedEntity: displayName,
        skuOrCode: prod.sku || prod.slug,
        sourceUrl: publicUrl,
        adminEditUrl: adminUrl,
        suggestion: "Update Base/MRP Price and Discount Price so Selling Price <= MRP.",
      });
    }

    if (isPodium) {
      const dims = prod.dimensions || [];
      const hasHeight = dims.some((d) => /height/i.test(d.label || d.key || ""));
      const hasTop = dims.some((d) => /top|reading/i.test(d.label || d.key || ""));
      if (!hasHeight || !hasTop) {
        pushIssue({
          severity: "WARNING",
          category: "PRICING_AND_SPECS",
          site: "CLASSIC_CONCEPTS",
          title: `Podium missing ${!hasHeight && !hasTop ? "Height & Top Sheet" : !hasHeight ? "Height" : "Top Sheet"} dimensions`,
          detail: `${displayName} is a podium but is missing structured ${!hasHeight && !hasTop ? "Height and Top Sheet" : !hasHeight ? "Height" : "Top Sheet"} dimensions for ACRIO size filtering.`,
          affectedEntity: displayName,
          skuOrCode: prod.sku || prod.slug,
          sourceUrl: publicUrl,
          adminEditUrl: adminUrl,
          suggestion: "Add Height and Top Sheet dimensions on the product page.",
        });
      }
      if (!prod.podiumSubCategoryNames || prod.podiumSubCategoryNames.length === 0) {
        pushIssue({
          severity: "INFO",
          category: "PRICING_AND_SPECS",
          site: "CLASSIC_CONCEPTS",
          title: "Podium not assigned to a Podium Range (Essential / Signature / Premium)",
          detail: `${displayName} has no podiumSubCategory assigned, so it may be omitted when customers browse by podium tier.`,
          affectedEntity: displayName,
          skuOrCode: prod.sku || prod.slug,
          sourceUrl: publicUrl,
          adminEditUrl: adminUrl,
          suggestion: "Assign a Podium Sub-Category in the Admin Podium Editor.",
        });
      }
    }

    if (
      (!prod.description || prod.description.trim().length < 15) &&
      (!prod.features || prod.features.length === 0)
    ) {
      pushIssue({
        severity: "INFO",
        category: "TEMPLATES_AND_CONTENT",
        site: "CLASSIC_CONCEPTS",
        title: "Product missing bullet highlights / description",
        detail: `${displayName} has no structured bullet description or key features.`,
        affectedEntity: displayName,
        skuOrCode: prod.sku || prod.slug,
        sourceUrl: publicUrl,
        adminEditUrl: adminUrl,
        suggestion: "Use 'ACRIO Generate Bullets' on the product page to add clean highlights.",
      });
    }
  }

  for (const [sku, list] of skuMap.entries()) {
    if (list.length > 1) {
      pushIssue({
        severity: "WARNING",
        category: "PRICING_AND_SPECS",
        site: list[0].brand === "CLASSIC_EDGE_53" ? "CLASSIC_EDGE_53" : "CLASSIC_CONCEPTS",
        title: `Duplicate SKU "${sku}" shared by ${list.length} items`,
        detail: `SKU "${sku}" is assigned to multiple items: ${list.map((i) => `${cleanDisplayProductName(i.name)} (${i.slug})`).join(", ")}. This can cause ambiguity when customers ask for model code "${sku}".`,
        affectedEntity: sku,
        skuOrCode: sku,
        sourceUrl: list[0].url,
        suggestion: "Assign a unique SKU code to each distinct product.",
      });
    }
  }
}

export function scanClassicEdgeItems(
  ceItems: MainWebsiteProduct[],
  pushIssue: IssuePushFn
): void {
  for (const ce of ceItems) {
    const displayName = cleanDisplayProductName(ce.name);
    const publicUrl = ce.url || `https://classicedge.in/machines/${ce.slug}`;

    if (!ce.shortUrl || !ce.shortUrl.includes("ccapl.cc/")) {
      pushIssue({
        severity: "WARNING",
        category: "SHORTLINKS_AND_CROSS_SITE",
        site: "CLASSIC_EDGE_53",
        title: "Classic Edge 53 item missing ccapl.cc shortlink",
        detail: `${displayName} (${ce.itemType}) does not have a registered ccapl.cc shortlink.`,
        affectedEntity: displayName,
        skuOrCode: ce.sku || ce.slug,
        sourceUrl: publicUrl,
        autoFixAction: "SYNC_SHORTLINKS",
        suggestion: "Run 'Auto-Fix & Sync Shortlinks' to generate its ccapl.cc shortlink.",
      });
    }

    if (ce.itemType === "MACHINE" && !ce.mainImage && (!ce.images || ce.images.length === 0)) {
      pushIssue({
        severity: "WARNING",
        category: "PRODUCT_MEDIA_AND_R2",
        site: "CLASSIC_EDGE_53",
        title: "Machine missing primary photo",
        detail: `Classic Edge 53 machine "${displayName}" has no image URL configured.`,
        affectedEntity: displayName,
        skuOrCode: ce.sku || ce.slug,
        sourceUrl: publicUrl,
        suggestion: "Add a machine image URL in the Classic Edge 53 catalog.",
      });
    }
  }
}

export function scanTemplatesAndAiLogs(
  templateRows: Record<string, unknown>[],
  pushIssue: IssuePushFn
): number {
  for (const tpl of templateRows) {
    const name = String(tpl.name || "");
    const status = String(tpl.approval_status || "");
    const rejReason = tpl.rejection_reason ? String(tpl.rejection_reason) : null;
    const ctaUrl = tpl.cta_url ? String(tpl.cta_url) : "";

    if (status === "REJECTED" || status === "PAUSED") {
      pushIssue({
        severity: status === "REJECTED" ? "WARNING" : "INFO",
        category: "TEMPLATES_AND_CONTENT",
        site: "WHATSAPP_HUB",
        title: `WhatsApp Template "${name}" is ${status}`,
        detail: `Template "${name}" has status=${status}${rejReason && rejReason !== "NONE" ? ` (Reason: ${rejReason})` : ""}.`,
        affectedEntity: name,
        sourceUrl: "/dashboard/templates",
        suggestion: "Review template wording or variables in Templates & Button Flows.",
      });
    }

    if (ctaUrl && /localhost|127\.0\.0\.1|:300[0-9]/i.test(ctaUrl)) {
      pushIssue({
        severity: "CRITICAL",
        category: "TEMPLATES_AND_CONTENT",
        site: "WHATSAPP_HUB",
        title: `Template "${name}" button URL points to localhost`,
        detail: `Template "${name}" has cta_url="${ctaUrl}".`,
        affectedEntity: name,
        sourceUrl: "/dashboard/templates",
        targetUrl: ctaUrl,
        suggestion: "Update the template button URL to use https://classicconcepts.in or https://ccapl.cc.",
      });
    }
  }

  let recentLogsCount = 0;
  try {
    const recentEntries = readAiTraceLogs({ limit: 120 }).entries;
    recentLogsCount = recentEntries.length;

    if (recentLogsCount > 0) {
      const zeroMatchQueries = new Set<string>();
      let errorTurns = 0;

      for (const entry of recentEntries) {
        if (entry.outcomeSource === "ERROR") {
          errorTurns++;
        }
        if (
          entry.productLookupTriggered &&
          Array.isArray(entry.productsLookedUp) &&
          entry.productsLookedUp.length === 0 &&
          entry.question &&
          entry.question.length >= 3
        ) {
          zeroMatchQueries.add(entry.question.trim());
        }
      }

      if (errorTurns > 0) {
        pushIssue({
          severity: "WARNING",
          category: "AI_LOGS_AND_BRIDGES",
          site: "WHATSAPP_HUB",
          title: `${errorTurns} recent AI turn(s) recorded ERROR in ai.logs`,
          detail: `Found ${errorTurns} error trace(s) in the last ${recentLogsCount} AI log entries.`,
          affectedEntity: "ai.logs",
          sourceUrl: "/dashboard/ai-logs",
          suggestion: "Inspect AI Logs (ai.logs) filtered by Outcome = ERROR.",
        });
      }

      if (zeroMatchQueries.size > 0) {
        const sampleQueries = Array.from(zeroMatchQueries).slice(-6);
        pushIssue({
          severity: "INFO",
          category: "AI_LOGS_AND_BRIDGES",
          site: "WHATSAPP_HUB",
          title: `${zeroMatchQueries.size} recent customer product query(s) returned 0 catalog matches`,
          detail: `Recent queries with 0 matched items: ${sampleQueries.map((q) => `"${q}"`).join(", ")}.`,
          affectedEntity: sampleQueries.join(" | "),
          sourceUrl: "/dashboard/ai-logs",
          suggestion:
            "Check if these queries use new synonyms, model codes, or budget constraints not covered by current catalog products.",
        });
      }
    }
  } catch {
    // Non-blocking
  }
  return recentLogsCount;
}
