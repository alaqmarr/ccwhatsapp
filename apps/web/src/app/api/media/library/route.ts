import { NextResponse } from "next/server";
import {
  cleanDisplayProductName,
  fetchLiveEcosystemDocuments,
  listCompanyDocuments,
} from "@cc/database";
import { getCachedEcosystemCatalog } from "@cc/connections";
import { hasPermission } from "@cc/rbac";
import { rememberWhatsAppCache } from "@cc/storage";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

interface CachedMediaResource {
  title: string;
  url: string;
  fileName: string;
  brandLabel: string;
  searchHaystack: string;
}

interface CachedMediaProduct {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  brandLabel: string;
  categoryName: string;
  basePrice: number | null;
  shortUrl: string;
  mainImage: string | null;
  images: string[];
  variants: {
    id: string;
    name: string;
    price: number | null;
    imageUrl: string | null;
  }[];
  videoUrl: string | null;
  searchHaystack: string;
}

async function getCachedMediaLibraryBundle(): Promise<{
  resources: CachedMediaResource[];
  products: CachedMediaProduct[];
}> {
  return rememberWhatsAppCache(
    "media-library:v1",
    ["cc-products", "ce53-machines", "company-docs"],
    300,
    async () => {
      const [{ allItems }, companyDocs, ecoDocs] = await Promise.all([
        getCachedEcosystemCatalog(),
        listCompanyDocuments({ enabledOnly: true }).catch(() => []),
        fetchLiveEcosystemDocuments().catch(() => []),
      ]);

      const seenResourceUrls = new Set<string>();
      const resources: CachedMediaResource[] = [];

      for (const it of allItems) {
        for (const r of it.resources || []) {
          const title = String(r.title || r.name || "").trim();
          const url = String(r.url || "").trim();
          if (!title || !url || !/^https?:\/\//i.test(url) || seenResourceUrls.has(url)) {
            continue;
          }
          seenResourceUrls.add(url);
          const safeSlug = title.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
          const brandLabel = it.brandLabel || "Classic Concepts";
          resources.push({
            title,
            url,
            fileName: /\.pdf$/i.test(safeSlug) ? safeSlug : `${safeSlug || "Catalogue"}.pdf`,
            brandLabel,
            searchHaystack: `${title} ${brandLabel}`.toLowerCase(),
          });
        }
      }

      const builtinCatalogues = [
        {
          title: "Acrylic Podiums & Pulpits Catalogue (PDF)",
          url: "/api/media/pdf_podium_catalogue",
          fileName: "Classic-Concepts-Podium-Catalogue.pdf",
          brandLabel: "Classic Concepts",
        },
        {
          title: "Acrylic Furniture, Chairs & Tables Catalogue (PDF)",
          url: "/api/media/pdf_furniture_catalogue",
          fileName: "Classic-Concepts-Furniture-Catalogue.pdf",
          brandLabel: "Classic Concepts",
        },
        {
          title: "Acrylic Trophies, Mementos & Corporate Gifts Catalogue (PDF)",
          url: "/api/media/pdf_memento_catalogue",
          fileName: "Classic-Concepts-Memento-Catalogue.pdf",
          brandLabel: "Classic Concepts",
        },
        {
          title: "Classic Edge 53 Industrial Acrylic Machines Catalogue (PDF)",
          url: "/api/media/pdf_machines_catalogue",
          fileName: "Classic-Edge-53-Machines-Catalogue.pdf",
          brandLabel: "Classic Edge 53",
        },
        {
          title: "Complete Product & Fabrication Catalogue (PDF)",
          url: "/api/media/pdf_full_catalogue",
          fileName: "Classic-Concepts-Full-Catalogue.pdf",
          brandLabel: "Classic Concepts",
        },
      ];
      for (const b of builtinCatalogues) {
        if (!seenResourceUrls.has(b.url)) {
          seenResourceUrls.add(b.url);
          resources.push({
            ...b,
            searchHaystack: `${b.title} ${b.brandLabel}`.toLowerCase(),
          });
        }
      }

      for (const ed of ecoDocs) {
        if (ed.source === "HUB_UPLOAD" || !ed.mediaUrl || seenResourceUrls.has(ed.mediaUrl)) {
          continue;
        }
        seenResourceUrls.add(ed.mediaUrl);
        const title = `${ed.title} (${ed.sourceLabel})`;
        resources.unshift({
          title,
          url: ed.mediaUrl,
          fileName: ed.fileName,
          brandLabel: ed.sourceLabel,
          searchHaystack: `${title} ${ed.sourceLabel}`.toLowerCase(),
        });
      }

      for (const d of companyDocs) {
        if (d.mediaUrl && !seenResourceUrls.has(d.mediaUrl)) {
          seenResourceUrls.add(d.mediaUrl);
          const title = d.docNumber ? `${d.title} (${d.docNumber})` : d.title;
          resources.unshift({
            title,
            url: d.mediaUrl,
            fileName: d.fileName || `${d.slug}.pdf`,
            brandLabel: "Company Document",
            searchHaystack: `${title} Company Document`.toLowerCase(),
          });
        }
      }

      const products: CachedMediaProduct[] = [];
      for (const it of allItems) {
        const hasMedia =
          Boolean(it.mainImage) ||
          Boolean(it.images && it.images.length > 0) ||
          Boolean(it.variants && it.variants.some((v) => v.imageUrl)) ||
          Boolean(it.videoUrl);
        if (!hasMedia) continue;

        const cleanName = cleanDisplayProductName(it.name);
        const gallery = Array.from(
          new Set(
            [it.mainImage, ...(it.images || [])]
              .map((u) => String(u || "").trim())
              .filter((u) => /^https?:\/\//i.test(u))
          )
        );
        products.push({
          id: it.id,
          name: cleanName,
          slug: it.slug,
          sku: it.sku || null,
          brandLabel: it.brandLabel,
          categoryName: it.categoryName,
          basePrice: it.basePrice ?? null,
          shortUrl: it.shortUrl || it.url,
          mainImage: gallery[0] || null,
          images: gallery,
          variants: (it.variants || [])
            .filter((v) => Boolean(v.imageUrl || gallery[0]))
            .map((v) => ({
              id: v.id || v.name,
              name: v.name,
              price: v.price ?? it.basePrice ?? null,
              imageUrl: v.imageUrl || gallery[0] || null,
            })),
          videoUrl: it.videoUrl || null,
          searchHaystack: `${it.name} ${it.sku || ""} ${it.slug} ${it.categoryName || ""} ${(
            it.variants || []
          )
            .map((v) => v.name)
            .join(" ")}`.toLowerCase(),
        });
      }

      return { resources, products };
    },
    { skipClone: true }
  );
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().toLowerCase();

  const cached = await getCachedMediaLibraryBundle();

  const filteredProducts = (
    q ? cached.products.filter((p) => p.searchHaystack.includes(q)) : cached.products
  )
    .slice(0, 40)
    .map(({ searchHaystack: _hay, ...rest }) => rest);

  const filteredResources = (
    q ? cached.resources.filter((r) => r.searchHaystack.includes(q)) : cached.resources
  ).map(({ searchHaystack: _hay, ...rest }) => rest);

  return NextResponse.json({
    ok: true,
    resources: filteredResources,
    products: filteredProducts,
  });
}
