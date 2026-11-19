import { getCachedEcosystemCatalog } from "@cc/connections";
import { cleanDisplayProductName, type MainWebsiteProduct } from "@cc/database";
import { getWhatsAppCacheSummary } from "@cc/storage";
import { computeBufferEtag } from "./etag";

export interface CachedCataloguePdf {
  buffer: Buffer;
  fileName: string;
  etag: string;
}

const MAX_PDF_CACHE_ENTRIES = 64;
const PDF_DIVIDER =
  "================================================================================";

const pdfCache = new Map<string, CachedCataloguePdf>();
let lastCatalogStamp = "";
let lastItemsRef: MainWebsiteProduct[] | null = null;

function escapePdfText(raw: string): string {
  return String(raw || "")
    .replace(/₹/g, "Rs. ")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildSimplePdfBuffer(title: string, subtitle: string, lines: string[]): Buffer {
  const safeLines = lines.slice(0, 46);
  const contentStreamLines: string[] = [
    "BT",
    "/F1 15 Tf",
    "44 795 Td",
    `(${escapePdfText(title)}) Tj`,
    "/F1 9 Tf",
    "0 -16 Td",
    `(${escapePdfText(subtitle)}) Tj`,
    "0 -18 Td",
  ];
  for (const line of safeLines) {
    contentStreamLines.push(`(${escapePdfText(line.slice(0, 102))}) Tj`);
    contentStreamLines.push("0 -14 Td");
  }
  contentStreamLines.push("ET");
  const streamBody = contentStreamLines.join("\n");

  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(streamBody, "utf8")} >>\nstream\n${streamBody}\nendstream\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

function setBoundedPdfCache(key: string, value: CachedCataloguePdf): void {
  if (pdfCache.has(key)) {
    pdfCache.delete(key);
  } else if (pdfCache.size >= MAX_PDF_CACHE_ENTRIES) {
    const oldestKey = pdfCache.keys().next().value;
    if (oldestKey !== undefined) pdfCache.delete(oldestKey);
  }
  pdfCache.set(key, value);
}

export async function renderBuiltinCataloguePdf(
  mediaId: string
): Promise<CachedCataloguePdf | null> {
  if (!mediaId.startsWith("pdf_")) return null;

  const { allItems, cacheMeta } = await getCachedEcosystemCatalog();
  const stamp = getWhatsAppCacheSummary().lastSyncedAt || "";

  if (
    cacheMeta.catalogCacheStatus === "MISS" ||
    stamp !== lastCatalogStamp ||
    (lastItemsRef !== null && lastItemsRef !== allItems)
  ) {
    pdfCache.clear();
  }
  lastCatalogStamp = stamp;
  lastItemsRef = allItems;

  const existing = pdfCache.get(mediaId);
  if (existing) {
    // Refresh recency order in bounded Map
    pdfCache.delete(mediaId);
    pdfCache.set(mediaId, existing);
    return existing;
  }

  const subtitle =
    "Classic Concepts & Classic Edge 53 | Secunderabad, Hyderabad | +91 73372 22876 | sales@classicconcepts.in";

  if (mediaId.startsWith("pdf_spec_")) {
    const slug = decodeURIComponent(mediaId.slice("pdf_spec_".length)).toLowerCase();
    const item = allItems.find((it) => (it.slug || "").toLowerCase() === slug);
    if (!item) return null;
    const cleanName = cleanDisplayProductName(item.name);
    const lines: string[] = [
      `Product: ${cleanName}${item.sku ? ` (SKU: ${item.sku})` : ""}`,
      `Category: ${item.categoryName || "Acrylic Products"}`,
      `Price: ${item.basePrice ? `Rs. ${item.basePrice.toLocaleString("en-IN")}` : "Price on Request"}`,
      `Product Page: ${item.shortUrl || item.url}`,
      PDF_DIVIDER,
    ];
    if (item.dimensions && item.dimensions.length > 0) {
      lines.push("DIMENSIONS:");
      for (const d of item.dimensions) {
        lines.push(`  * ${d.label || d.key}: ${d.value}`);
      }
    }
    if (item.specifications && item.specifications.length > 0) {
      lines.push("SPECIFICATIONS:");
      for (const s of item.specifications) {
        lines.push(`  * ${s.label || s.key}: ${s.value}`);
      }
    }
    if (item.variants && item.variants.length > 0) {
      lines.push("AVAILABLE VARIANTS / COLOURS:");
      for (const v of item.variants) {
        lines.push(
          `  * ${v.name}${v.price ? ` - Rs. ${v.price.toLocaleString("en-IN")}` : ""}`
        );
      }
    }
    if (item.features && item.features.length > 0) {
      lines.push("KEY HIGHLIGHTS:");
      for (const f of item.features.slice(0, 8)) {
        lines.push(`  * ${f}`);
      }
    }
    const buffer = buildSimplePdfBuffer(
      `${cleanName} - Specification Sheet`,
      subtitle,
      lines
    );
    const built: CachedCataloguePdf = {
      buffer,
      fileName: `${item.slug}-spec-sheet.pdf`,
      etag: computeBufferEtag(buffer),
    };
    setBoundedPdfCache(mediaId, built);
    return built;
  }

  let title = "Classic Concepts - Complete Product Catalogue";
  let fileName = "Classic-Concepts-Full-Catalogue.pdf";
  let filtered: MainWebsiteProduct[] = allItems;

  if (mediaId === "pdf_podium_catalogue") {
    title = "Classic Concepts - Acrylic Podiums & Pulpits Catalogue";
    fileName = "Classic-Concepts-Podium-Catalogue.pdf";
    filtered = allItems.filter(
      (it) =>
        it.brand === "CLASSIC_CONCEPTS" &&
        /podium|pulpit|lectern/i.test(`${it.name} ${it.categoryName}`)
    );
  } else if (mediaId === "pdf_furniture_catalogue") {
    title = "Classic Concepts - Acrylic Furniture, Chairs & Tables Catalogue";
    fileName = "Classic-Concepts-Furniture-Catalogue.pdf";
    filtered = allItems.filter(
      (it) =>
        it.brand === "CLASSIC_CONCEPTS" &&
        /furniture|chair|stool|table|desk/i.test(`${it.name} ${it.categoryName}`)
    );
  } else if (mediaId === "pdf_memento_catalogue") {
    title = "Classic Concepts - Trophies, Mementos & Corporate Gifts Catalogue";
    fileName = "Classic-Concepts-Memento-Catalogue.pdf";
    filtered = allItems.filter(
      (it) =>
        it.brand === "CLASSIC_CONCEPTS" &&
        /trophy|trophies|memento|award|gift|plaque/i.test(`${it.name} ${it.categoryName}`)
    );
  } else if (mediaId === "pdf_machines_catalogue") {
    title = "Classic Edge 53 - Industrial Acrylic Machines Catalogue";
    fileName = "Classic-Edge-53-Machines-Catalogue.pdf";
    filtered = allItems.filter((it) => it.brand === "CLASSIC_EDGE_53");
  }

  const lines: string[] = [
    `Total Listed Models in Category: ${filtered.length}`,
    PDF_DIVIDER,
  ];
  filtered.slice(0, 40).forEach((it, idx) => {
    const cleanName = cleanDisplayProductName(it.name);
    const price = it.basePrice ? `Rs. ${it.basePrice.toLocaleString("en-IN")}` : "Quote";
    const vars =
      it.variants && it.variants.length > 0
        ? ` | Variants: ${it.variants.map((v) => v.name).join(", ")}`
        : "";
    lines.push(`${idx + 1}. ${cleanName} (${price})${vars} - ${it.shortUrl || it.url}`);
  });

  const buffer = buildSimplePdfBuffer(title, subtitle, lines);
  const built: CachedCataloguePdf = {
    buffer,
    fileName,
    etag: computeBufferEtag(buffer),
  };
  setBoundedPdfCache(mediaId, built);
  return built;
}
