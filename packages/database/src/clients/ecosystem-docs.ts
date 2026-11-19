import { listCompanyDocuments } from "./company-docs";
import {
  resolveClassicConceptsInternalUrl,
  resolveClassicEdgeInternalUrl,
} from "./env-config";
import { getMainCatalogClient } from "./handles";

export interface VerifiedEcosystemDocument {
  id: string;
  slug: string;
  title: string;
  source: "HUB_UPLOAD" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  sourceLabel: string;
  category: string;
  docNumber?: string;
  mediaUrl: string;
  mediaType: "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO";
  mediaId?: string;
  waMediaId?: string;
  fileName: string;
  mimeType: string;
  keywords: string;
}

let cachedRemoteEcosystemDocs: {
  fetchedAt: number;
  docs: VerifiedEcosystemDocument[];
} | null = null;

function inferDocMediaMeta(url: string, title: string): {
  mediaType: "DOCUMENT" | "IMAGE";
  fileName: string;
  mimeType: string;
} {
  const cleanUrl = String(url || "").split("?")[0].toLowerCase();
  const safeBase =
    String(title || "document")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "document";
  if (/\.(png)$/i.test(cleanUrl)) {
    return { mediaType: "IMAGE", fileName: `${safeBase}.png`, mimeType: "image/png" };
  }
  if (/\.(jpg|jpeg)$/i.test(cleanUrl)) {
    return { mediaType: "IMAGE", fileName: `${safeBase}.jpg`, mimeType: "image/jpeg" };
  }
  if (/\.(webp)$/i.test(cleanUrl)) {
    return { mediaType: "IMAGE", fileName: `${safeBase}.webp`, mimeType: "image/webp" };
  }
  return { mediaType: "DOCUMENT", fileName: `${safeBase}.pdf`, mimeType: "application/pdf" };
}

function buildSmartKeywordsForTitle(title: string, extra = ""): string {
  const t = `${title} ${extra}`.toLowerCase();
  const words = new Set(t.split(/[^a-z0-9]+/).filter((w) => w.length >= 2));
  if (/gst/.test(t)) {
    words.add("gst");
    words.add("gstin");
    words.add("gst certificate");
    words.add("tax certificate");
  }
  if (/udyam|msme/.test(t)) {
    words.add("msme");
    words.add("udyam");
    words.add("ssi");
  }
  if (/iso|hym|ascb|\bga\b/.test(t)) {
    words.add("iso");
    words.add("iso certificate");
    words.add("quality certificate");
  }
  if (/incorporation/.test(t)) {
    words.add("coi");
    words.add("incorporation");
    words.add("registration certificate");
  }
  if (/importer|exporter|iec/.test(t)) {
    words.add("iec");
    words.add("importer");
    words.add("exporter");
  }
  if (/labour|labor/.test(t)) {
    words.add("labour");
    words.add("labor");
    words.add("licence");
    words.add("license");
  }
  if (/catalog|brochure|podium|furniture|momento|memento|machine/.test(t)) {
    words.add("catalogue");
    words.add("catalog");
    words.add("brochure");
    words.add("pdf");
  }
  return Array.from(words).join(", ");
}

/**
 * Fetches all verified documents, certificates, registrations, and brochures from:
 * 1) Hub uploaded `company_documents`
 * 2) Live `classicconcepts.in` (`/api/brand-info` & `/api/whatsapp-catalog` + SQLite fallback)
 * 3) Live `classicedge53.com` (`/api/whatsapp-catalog`, `/api/brand-info`, & built-in machine catalogue)
 */
export async function fetchLiveEcosystemDocuments(opts?: {
  forceRefresh?: boolean;
}): Promise<VerifiedEcosystemDocument[]> {
  const hubDocs = await listCompanyDocuments({ enabledOnly: true }).catch(() => []);
  const out: VerifiedEcosystemDocument[] = [];
  const seenUrls = new Set<string>();

  for (const d of hubDocs) {
    if (!d.mediaUrl || seenUrls.has(d.mediaUrl)) continue;
    seenUrls.add(d.mediaUrl);
    out.push({
      id: d.id,
      slug: d.slug,
      title: d.title,
      source: "HUB_UPLOAD",
      sourceLabel: "Hub Company Documents",
      category: d.category,
      docNumber: d.docNumber || undefined,
      mediaUrl: d.mediaUrl,
      mediaType: d.mediaType,
      mediaId: d.mediaId || undefined,
      waMediaId: d.waMediaId || undefined,
      fileName: d.fileName || `${d.slug}.pdf`,
      mimeType: d.mimeType || "application/pdf",
      keywords: buildSmartKeywordsForTitle(d.title, `${d.keywords} ${d.docNumber}`),
    });
  }

  let remoteDocs: VerifiedEcosystemDocument[] = [];
  if (
    !opts?.forceRefresh &&
    cachedRemoteEcosystemDocs &&
    Date.now() - cachedRemoteEcosystemDocs.fetchedAt < 5 * 60 * 1000
  ) {
    remoteDocs = cachedRemoteEcosystemDocs.docs;
  } else {
    const remoteCollected: VerifiedEcosystemDocument[] = [];
    const seenRemoteUrls = new Set<string>();

    const pushRemote = (doc: Omit<VerifiedEcosystemDocument, "mediaType" | "fileName" | "mimeType" | "keywords"> & { extraKeywords?: string }) => {
      const cleanUrl = String(doc.mediaUrl || "").trim();
      if (!cleanUrl || seenRemoteUrls.has(cleanUrl)) return;
      seenRemoteUrls.add(cleanUrl);
      const inferred = inferDocMediaMeta(cleanUrl, doc.title);
      remoteCollected.push({
        ...doc,
        mediaUrl: cleanUrl,
        mediaType: inferred.mediaType,
        fileName: inferred.fileName,
        mimeType: inferred.mimeType,
        keywords: buildSmartKeywordsForTitle(doc.title, `${doc.extraKeywords || ""} ${doc.sourceLabel}`),
      });
    };

    const ccBaseUrls = Array.from(
      new Set(["https://classicconcepts.in", resolveClassicConceptsInternalUrl()].filter(Boolean))
    );
    const ceBaseUrls = Array.from(
      new Set(["https://www.classicedge53.com", "https://classicedge53.com", resolveClassicEdgeInternalUrl()].filter(Boolean))
    );

    let ccBrandLoaded = false;
    for (const base of ccBaseUrls) {
      if (ccBrandLoaded) break;
      try {
        const res = await fetch(`${base}/api/brand-info`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) continue;
        const data: any = await res.json().catch(() => null);
        if (!data?.success) continue;
        ccBrandLoaded = true;
        const certs = data?.brand?.certifications;
        if (Array.isArray(certs?.allCertificates)) {
          for (const c of certs.allCertificates) {
            if (!c?.fileUrl || !c?.title) continue;
            const titleStr = String(c.title).trim();
            pushRemote({
              id: `cc_cert_${String(c.id || titleStr).replace(/[^a-zA-Z0-9_-]/g, "")}`,
              slug: titleStr.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              title: titleStr,
              source: "CLASSIC_CONCEPTS",
              sourceLabel: "classicconcepts.in",
              category: "CERTIFICATE",
              mediaUrl: String(c.fileUrl),
              extraKeywords: c.issuedBy ? String(c.issuedBy) : "certificate company compliance",
            });
          }
        }
        const badgeCerts: [string, unknown][] = [
          ["ISO Certificate (Badge)", certs?.iso],
          ["HYM Certificate", certs?.hym],
          ["GA Certificate", certs?.ga],
          ["ASCB Certificate", certs?.ascb],
        ];
        for (const [label, maybeUrl] of badgeCerts) {
          if (typeof maybeUrl === "string" && /^https?:\/\//i.test(maybeUrl)) {
            pushRemote({
              id: `cc_badge_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
              slug: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              title: label,
              source: "CLASSIC_CONCEPTS",
              sourceLabel: "classicconcepts.in",
              category: "CERTIFICATE",
              mediaUrl: maybeUrl,
              extraKeywords: "certificate iso quality",
            });
          }
        }
      } catch {
        // try next URL
      }
    }

    if (!ccBrandLoaded) {
      const ccClient = getMainCatalogClient();
      if (ccClient) {
        const [certRows, resRows] = await Promise.all([
          ccClient.execute(`SELECT id, title, imageUrl, issuedBy, docType FROM Certificate ORDER BY sortOrder ASC`).catch(() => ({ rows: [] as any[] })),
          ccClient.execute(`SELECT id, title, description, fileUrl, type FROM Resource ORDER BY sortOrder ASC`).catch(() => ({ rows: [] as any[] })),
        ]);
        for (const c of certRows.rows) {
          if (!c.imageUrl || !c.title) continue;
          const url = String(c.imageUrl).startsWith("http") ? String(c.imageUrl) : `https://classicconcepts.in${String(c.imageUrl).startsWith("/") ? "" : "/"}${String(c.imageUrl)}`;
          pushRemote({
            id: `cc_db_cert_${String(c.id)}`,
            slug: String(c.title).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            title: String(c.title),
            source: "CLASSIC_CONCEPTS",
            sourceLabel: "classicconcepts.in",
            category: "CERTIFICATE",
            mediaUrl: url,
            extraKeywords: `${c.issuedBy || ""} ${c.docType || ""} certificate`,
          });
        }
        for (const r of resRows.rows) {
          if (!r.fileUrl || !r.title) continue;
          const url = String(r.fileUrl).startsWith("http") ? String(r.fileUrl) : `https://classicconcepts.in${String(r.fileUrl).startsWith("/") ? "" : "/"}${String(r.fileUrl)}`;
          pushRemote({
            id: `cc_db_res_${String(r.id)}`,
            slug: String(r.title).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            title: String(r.title),
            source: "CLASSIC_CONCEPTS",
            sourceLabel: "classicconcepts.in",
            category: "CATALOGUE",
            mediaUrl: url,
            extraKeywords: `${r.description || ""} ${r.type || ""} brochure catalogue`,
          });
        }
      }
    }

    for (const base of ccBaseUrls) {
      try {
        const res = await fetch(`${base}/api/whatsapp-catalog?limit=25`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) continue;
        const data: any = await res.json().catch(() => null);
        const list = Array.isArray(data?.products) ? data.products : [];
        let foundAny = false;
        for (const p of list) {
          for (const r of p?.resources || []) {
            if (!r?.url || !r?.name) continue;
            foundAny = true;
            const titleStr = String(r.name).trim();
            pushRemote({
              id: `cc_cat_${titleStr.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
              slug: titleStr.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              title: titleStr,
              source: "CLASSIC_CONCEPTS",
              sourceLabel: "classicconcepts.in",
              category: "CATALOGUE",
              mediaUrl: String(r.url),
              extraKeywords: "classic concepts catalogue brochure pdf",
            });
          }
          if (foundAny && remoteCollected.filter((d) => d.category === "CATALOGUE").length >= 10) break;
        }
        if (foundAny) break;
      } catch {
        // try next URL
      }
    }

    for (const base of ceBaseUrls) {
      try {
        const res = await fetch(`${base}/api/whatsapp-catalog`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) continue;
        const data: any = await res.json().catch(() => null);
        if (!data?.ok) continue;
        const ceItems = [
          ...(Array.isArray(data.machines) ? data.machines : []),
          ...(Array.isArray(data.consumables) ? data.consumables : []),
        ];
        for (const m of ceItems) {
          for (const r of m?.resources || []) {
            if (!r?.url) continue;
            const rTitle = String(r.name || r.title || `${m.name} Brochure`).trim();
            pushRemote({
              id: `ce_res_${rTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 50)}`,
              slug: rTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              title: rTitle,
              source: "CLASSIC_EDGE_53",
              sourceLabel: "classicedge53.com",
              category: "MACHINE_DOCUMENT",
              mediaUrl: String(r.url),
              extraKeywords: `classic edge 53 ${m.name || ""} machine manual brochure`,
            });
          }
          for (const md of m?.models || []) {
            for (const r of md?.resources || []) {
              if (!r?.url) continue;
              const rTitle = String(r.name || r.title || `${md.modelName || m.name} Spec`).trim();
              pushRemote({
                id: `ce_md_${rTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 50)}`,
                slug: rTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
                title: rTitle,
                source: "CLASSIC_EDGE_53",
                sourceLabel: "classicedge53.com",
                category: "MACHINE_DOCUMENT",
                mediaUrl: String(r.url),
                extraKeywords: `classic edge 53 ${md.modelName || ""} ${m.name || ""} machine spec`,
              });
            }
          }
        }
        break;
      } catch {
        // try next URL
      }
    }

    pushRemote({
      id: "ce_builtin_machines_catalogue",
      slug: "classic-edge-53-machines-catalogue",
      title: "Classic Edge 53 Machines Catalogue (PDF)",
      source: "CLASSIC_EDGE_53",
      sourceLabel: "classicedge53.com",
      category: "CATALOGUE",
      mediaUrl: "/api/media/pdf_machines_catalogue",
      extraKeywords: "classic edge 53 diamond polishing bending flame machine catalogue brochure",
    });

    cachedRemoteEcosystemDocs = { fetchedAt: Date.now(), docs: remoteCollected };
    remoteDocs = remoteCollected;
  }

  for (const rd of remoteDocs) {
    if (seenUrls.has(rd.mediaUrl)) continue;
    seenUrls.add(rd.mediaUrl);
    out.push(rd);
  }
  return out;
}

export async function findMatchingEcosystemDocuments(
  queryText: string
): Promise<VerifiedEcosystemDocument[]> {
  const docs = await fetchLiveEcosystemDocuments().catch(() => []);
  const q = String(queryText || "").toLowerCase();
  if (!q.trim()) return docs;

  if (
    /\b(all\s+certificates|company\s+certificates|company\s+documents|compliance\s+docs)\b/i.test(
      q
    )
  ) {
    const certs = docs.filter(
      (d) => d.category === "CERTIFICATE" || d.category === "COMPLIANCE"
    );
    return certs.length > 0 ? certs : docs;
  }

  const aliases: [RegExp, string[]][] = [
    [/\bgst(in)?\b|\btax\b/i, ["gst", "gstin", "tax"]],
    [/\biso\b|\b9001\b/i, ["iso", "9001"]],
    [/\bmsme\b|\budyam\b|\bssi\b/i, ["msme", "udyam"]],
    [/\bincorporation\b|\bcoi\b|\bcin\b/i, ["incorporation", "coi"]],
    [/\blabour\b|\blabor\b/i, ["labour", "labor", "licence"]],
    [/\biec\b|\bimport\b|\bexport\b/i, ["iec", "importer", "exporter"]],
    [/\bclassicedge53\b|\bclassic\s*edge\b|\bmachine/i, ["classicedge53", "machine"]],
    [/\bbrochure\b|\bcatalog|\bcatalogue\b/i, ["catalogue", "catalog", "brochure"]],
    [/\bpodium|\bpulpit/i, ["podium"]],
    [/\bfurniture\b|\bchair|\btable/i, ["furniture"]],
    [/\bmemento|\bmomento|\baward|\btrophy/i, ["memento", "momento"]],
  ];

  const expandedTokens = new Set(
    q
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2)
      .filter(
        (t) =>
          ![
            "please",
            "share",
            "send",
            "with",
            "client",
            "customer",
            "acrio",
            "the",
            "our",
            "for",
            "and",
            "from",
            "can",
            "you",
            "which",
            "one",
          ].includes(t)
      )
  );
  for (const [re, extra] of aliases) {
    if (re.test(q)) {
      for (const t of extra) expandedTokens.add(t);
    }
  }

  return docs
    .map((doc) => {
      const titleLower = doc.title.toLowerCase();
      const hay = `${doc.slug} ${doc.title} ${doc.keywords} ${doc.sourceLabel} ${doc.fileName}`.toLowerCase();
      let score = 0;
      for (const t of expandedTokens) {
        if (titleLower.includes(t)) score += 6;
        else if (hay.includes(t)) score += t.length >= 4 ? 3 : 2;
      }
      if (doc.source === "HUB_UPLOAD" && score > 0) score += 1;
      return { doc, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.doc);
}
