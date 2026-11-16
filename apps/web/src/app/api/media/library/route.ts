import { NextResponse } from "next/server";
import { cleanDisplayProductName } from "@cc/database";
import { getCachedEcosystemCatalog } from "@cc/connections";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().toLowerCase();

  const { allItems } = await getCachedEcosystemCatalog();

  const seenResourceUrls = new Set<string>();
  const resources: {
    title: string;
    url: string;
    fileName: string;
    brandLabel: string;
  }[] = [];

  for (const it of allItems) {
    for (const r of it.resources || []) {
      const title = String(r.title || r.name || "").trim();
      const url = String(r.url || "").trim();
      if (!title || !url || !/^https?:\/\//i.test(url) || seenResourceUrls.has(url)) {
        continue;
      }
      seenResourceUrls.add(url);
      const safeSlug = title.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
      resources.push({
        title,
        url,
        fileName: /\.pdf$/i.test(safeSlug) ? safeSlug : `${safeSlug || "Catalogue"}.pdf`,
        brandLabel: it.brandLabel || "Classic Concepts",
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
      resources.push(b);
    }
  }

  const filteredProducts = allItems
    .filter((it) => {
      const hasMedia =
        Boolean(it.mainImage) ||
        Boolean(it.images && it.images.length > 0) ||
        Boolean(it.variants && it.variants.some((v) => v.imageUrl)) ||
        Boolean(it.videoUrl);
      if (!hasMedia) return false;
      if (!q) return true;
      const hay = `${it.name} ${it.sku || ""} ${it.slug} ${it.categoryName || ""} ${(it.variants || [])
        .map((v) => v.name)
        .join(" ")}`.toLowerCase();
      return hay.includes(q);
    })
    .slice(0, 40)
    .map((it) => {
      const cleanName = cleanDisplayProductName(it.name);
      const gallery = Array.from(
        new Set(
          [it.mainImage, ...(it.images || [])]
            .map((u) => String(u || "").trim())
            .filter((u) => /^https?:\/\//i.test(u))
        )
      );
      return {
        id: it.id,
        name: cleanName,
        slug: it.slug,
        sku: it.sku || null,
        brandLabel: it.brandLabel,
        categoryName: it.categoryName,
        basePrice: it.basePrice,
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
      };
    });

  const filteredResources = q
    ? resources.filter((r) => `${r.title} ${r.brandLabel}`.toLowerCase().includes(q))
    : resources;

  return NextResponse.json({
    ok: true,
    resources: filteredResources,
    products: filteredProducts,
  });
}
