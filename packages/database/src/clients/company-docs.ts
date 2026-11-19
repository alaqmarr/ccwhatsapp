import crypto from "node:crypto";
import { getRawLibSqlClient } from "./handles";

export interface CompanyDocumentRecord {
  id: string;
  slug: string;
  title: string;
  category: "COMPLIANCE" | "CATALOGUE" | "BANKING" | "COMPANY_PROFILE";
  docNumber: string;
  description: string;
  mediaId: string;
  waMediaId: string;
  mediaUrl: string;
  mediaType: "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO";
  fileName: string;
  mimeType: string;
  keywords: string;
  isEnabled: boolean;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

let companyDocsReady = false;
export async function ensureCompanyDocumentsTable(): Promise<void> {
  if (companyDocsReady) return;
  const conv = getRawLibSqlClient("conversations");
  await conv.execute(`CREATE TABLE IF NOT EXISTS company_documents (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'COMPLIANCE',
    doc_number TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    media_id TEXT NOT NULL DEFAULT '',
    wa_media_id TEXT NOT NULL DEFAULT '',
    media_url TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'DOCUMENT',
    file_name TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT 'application/pdf',
    keywords TEXT NOT NULL DEFAULT '',
    is_enabled INTEGER NOT NULL DEFAULT 1,
    uploaded_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  companyDocsReady = true;
}

function mapCompanyDocRow(r: Record<string, unknown>): CompanyDocumentRecord {
  const mt = String(r.media_type || "DOCUMENT").toUpperCase();
  const mediaType = (["DOCUMENT", "IMAGE", "VIDEO", "AUDIO"].includes(mt) ? mt : "DOCUMENT") as CompanyDocumentRecord["mediaType"];
  const cat = String(r.category || "COMPLIANCE").toUpperCase();
  const category = (["COMPLIANCE", "CATALOGUE", "BANKING", "COMPANY_PROFILE"].includes(cat) ? cat : "COMPLIANCE") as CompanyDocumentRecord["category"];
  return {
    id: String(r.id),
    slug: String(r.slug),
    title: String(r.title || ""),
    category,
    docNumber: String(r.doc_number || ""),
    description: String(r.description || ""),
    mediaId: String(r.media_id || ""),
    waMediaId: String(r.wa_media_id || ""),
    mediaUrl: String(r.media_url || ""),
    mediaType,
    fileName: String(r.file_name || ""),
    mimeType: String(r.mime_type || "application/pdf"),
    keywords: String(r.keywords || ""),
    isEnabled: Number(r.is_enabled ?? 1) === 1,
    uploadedBy: String(r.uploaded_by || ""),
    createdAt: String(r.created_at || ""),
    updatedAt: String(r.updated_at || ""),
  };
}

export async function listCompanyDocuments(opts?: {
  enabledOnly?: boolean;
}): Promise<CompanyDocumentRecord[]> {
  await ensureCompanyDocumentsTable();
  const conv = getRawLibSqlClient("conversations");
  const sql = opts?.enabledOnly
    ? `SELECT * FROM company_documents WHERE is_enabled = 1 ORDER BY updated_at DESC`
    : `SELECT * FROM company_documents ORDER BY updated_at DESC`;
  const res = await conv.execute(sql);
  return res.rows.map((r) => mapCompanyDocRow(r as Record<string, unknown>));
}

export async function upsertCompanyDocument(input: {
  id?: string;
  slug?: string;
  title: string;
  category?: CompanyDocumentRecord["category"];
  docNumber?: string;
  description?: string;
  mediaId?: string;
  waMediaId?: string;
  mediaUrl: string;
  mediaType?: CompanyDocumentRecord["mediaType"];
  fileName?: string;
  mimeType?: string;
  keywords?: string;
  isEnabled?: boolean;
  uploadedBy?: string;
}): Promise<CompanyDocumentRecord> {
  await ensureCompanyDocumentsTable();
  const conv = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();
  const normalizedSlug = String(
    input.slug ||
      input.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") ||
      `doc-${crypto.randomUUID().slice(0, 8)}`
  ).slice(0, 80);

  const existingBySlugOrId = await conv.execute({
    sql: `SELECT id, created_at FROM company_documents WHERE id = ? OR slug = ? LIMIT 1`,
    args: [input.id || "", normalizedSlug],
  });
  const id =
    (existingBySlugOrId.rows[0]?.id ? String(existingBySlugOrId.rows[0].id) : null) ||
    input.id ||
    `cdoc_${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = existingBySlugOrId.rows[0]?.created_at
    ? String(existingBySlugOrId.rows[0].created_at)
    : nowIso;

  await conv.execute({
    sql: `INSERT INTO company_documents (
      id, slug, title, category, doc_number, description, media_id, wa_media_id,
      media_url, media_type, file_name, mime_type, keywords, is_enabled, uploaded_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      title = excluded.title,
      category = excluded.category,
      doc_number = excluded.doc_number,
      description = excluded.description,
      media_id = excluded.media_id,
      wa_media_id = excluded.wa_media_id,
      media_url = excluded.media_url,
      media_type = excluded.media_type,
      file_name = excluded.file_name,
      mime_type = excluded.mime_type,
      keywords = excluded.keywords,
      is_enabled = excluded.is_enabled,
      uploaded_by = excluded.uploaded_by,
      updated_at = excluded.updated_at`,
    args: [
      id,
      normalizedSlug,
      input.title.trim(),
      input.category || "COMPLIANCE",
      (input.docNumber || "").trim(),
      (input.description || "").trim(),
      (input.mediaId || "").trim(),
      (input.waMediaId || "").trim(),
      input.mediaUrl.trim(),
      input.mediaType || "DOCUMENT",
      (input.fileName || "").trim() || `${normalizedSlug}.pdf`,
      (input.mimeType || "application/pdf").trim(),
      (input.keywords || "").trim().toLowerCase(),
      input.isEnabled === false ? 0 : 1,
      (input.uploadedBy || "").trim(),
      createdAt,
      nowIso,
    ],
  });

  const docs = await listCompanyDocuments();
  return docs.find((d) => d.id === id)!;
}

export async function deleteCompanyDocument(id: string): Promise<void> {
  await ensureCompanyDocumentsTable();
  const conv = getRawLibSqlClient("conversations");
  await conv.execute({ sql: `DELETE FROM company_documents WHERE id = ?`, args: [id] });
}

export async function findMatchingCompanyDocuments(
  queryText: string
): Promise<CompanyDocumentRecord[]> {
  const docs = await listCompanyDocuments({ enabledOnly: true }).catch(() => []);
  const q = String(queryText || "").toLowerCase();
  if (!q.trim()) return docs;

  const aliases: [RegExp, string[]][] = [
    [/\bgst(in)?\b|\btax\s*reg/i, ["gst", "gstin", "tax", "gst certificate"]],
    [/\biso\b|\bquality\s*cert/i, ["iso", "certificate"]],
    [/\bmsme\b|\budyam\b|\bssi\b/i, ["msme", "udyam"]],
    [/\bbank\b|\bcheque\b|\bneft\b|\brtgs\b|\baccount\b/i, ["bank", "cheque", "account"]],
    [/\bpan\b/i, ["pan", "tax"]],
    [/\bbrochure\b|\bcatalog|\bprofile\b/i, ["brochure", "catalogue", "profile"]],
  ];

  const expandedTokens = new Set(
    q
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2)
  );
  for (const [re, extra] of aliases) {
    if (re.test(q)) {
      for (const t of extra) expandedTokens.add(t);
    }
  }

  return docs
    .map((doc) => {
      const hay = `${doc.slug} ${doc.title} ${doc.keywords} ${doc.description} ${doc.fileName}`.toLowerCase();
      let score = 0;
      for (const t of expandedTokens) {
        if (hay.includes(t)) score += t.length >= 4 ? 3 : 2;
      }
      return { doc, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.doc);
}
