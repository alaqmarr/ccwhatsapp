import crypto from "node:crypto";
import {
  resolveClassicConceptsInternalUrl,
  resolveClassicEdgeInternalUrl,
  resolveEcosystemBridgeKey,
} from "./env-config";
import {
  getClassicEdgeClient,
  getMainCatalogClient,
  getRawLibSqlClient,
} from "./handles";

export interface EcosystemEnquiryRecord {
  id: string;
  externalId: string;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  brandLabel: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  productName: string;
  source: string;
  message: string;
  status: "New" | "Replied";
  aiSuggestedReply: string;
  lastReplyText: string;
  lastReplyChannel: string;
  repliedByName: string;
  repliedAt: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

let ecoEnqTableChecked = false;
export async function ensureEcosystemEnquiriesTable(): Promise<void> {
  if (ecoEnqTableChecked) return;
  const crm = getRawLibSqlClient("crm_orders");
  await crm.batch(
    [
      `CREATE TABLE IF NOT EXISTS ecosystem_enquiries (
        id TEXT PRIMARY KEY,
        external_id TEXT NOT NULL,
        brand TEXT NOT NULL,
        brand_label TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        product_name TEXT DEFAULT '',
        source TEXT NOT NULL DEFAULT 'Website Form',
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'New',
        ai_suggested_reply TEXT DEFAULT '',
        last_reply_text TEXT DEFAULT '',
        last_reply_channel TEXT DEFAULT '',
        replied_by_name TEXT DEFAULT '',
        replied_at TEXT,
        conversation_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_eco_enq_created ON ecosystem_enquiries (created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_eco_enq_phone ON ecosystem_enquiries (customer_phone)`,
      `CREATE INDEX IF NOT EXISTS idx_eco_enq_brand_status ON ecosystem_enquiries (brand, status)`,
    ],
    "write"
  );
  ecoEnqTableChecked = true;
}

function mapEcosystemEnquiryRow(r: Record<string, unknown>): EcosystemEnquiryRecord {
  const brand =
    String(r.brand || "") === "CLASSIC_EDGE_53"
      ? "CLASSIC_EDGE_53"
      : "CLASSIC_CONCEPTS";
  return {
    id: String(r.id),
    externalId: String(r.external_id || String(r.id).replace(/^(cc_|ce53_|ce_)/, "")),
    brand,
    brandLabel:
      String(r.brand_label || "") ||
      (brand === "CLASSIC_EDGE_53"
        ? "Classic Edge 53 (classicedge53.com)"
        : "Classic Concepts (classicconcepts.in)"),
    customerName: String(r.customer_name || "Customer"),
    customerEmail: String(r.customer_email || ""),
    customerPhone: String(r.customer_phone || ""),
    productName: String(r.product_name || ""),
    source: String(r.source || "Website Form"),
    message: String(r.message || ""),
    status: String(r.status || "New") === "Replied" ? "Replied" : "New",
    aiSuggestedReply: String(r.ai_suggested_reply || ""),
    lastReplyText: String(r.last_reply_text || ""),
    lastReplyChannel: String(r.last_reply_channel || ""),
    repliedByName: String(r.replied_by_name || ""),
    repliedAt: r.replied_at ? String(r.replied_at) : null,
    conversationId: r.conversation_id ? String(r.conversation_id) : null,
    createdAt: String(r.created_at || new Date().toISOString()),
    updatedAt: String(r.updated_at || new Date().toISOString()),
  };
}

export async function upsertEcosystemEnquiry(params: {
  externalId: string;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  productName?: string;
  source?: string;
  message: string;
  status?: "New" | "Replied" | string;
  aiSuggestedReply?: string;
  lastReplyText?: string;
  lastReplyChannel?: string;
  repliedByName?: string;
  repliedAt?: string | null;
  conversationId?: string | null;
  createdAt?: string;
}): Promise<EcosystemEnquiryRecord> {
  await ensureEcosystemEnquiriesTable();
  const crm = getRawLibSqlClient("crm_orders");
  const cleanExtId = String(params.externalId || "").replace(/^(cc_|ce53_|ce_)/, "").trim();
  const prefix = params.brand === "CLASSIC_EDGE_53" ? "ce53" : "cc";
  const id = `${prefix}_${cleanExtId || crypto.randomUUID().slice(0, 10)}`;
  const brandLabel =
    params.brand === "CLASSIC_EDGE_53"
      ? "Classic Edge 53 (classicedge53.com)"
      : "Classic Concepts (classicconcepts.in)";
  const nowIso = new Date().toISOString();

  const existingRes = await crm.execute({
    sql: `SELECT * FROM ecosystem_enquiries WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const ex = existingRes.rows[0] as Record<string, unknown> | undefined;

  const finalStatus =
    String(params.status || "").toLowerCase() === "replied" ||
    String(ex?.status || "").toLowerCase() === "replied"
      ? "Replied"
      : "New";
  const finalCreatedAt =
    params.createdAt || (ex?.created_at ? String(ex.created_at) : nowIso);
  const finalAiReply =
    params.aiSuggestedReply !== undefined && params.aiSuggestedReply.trim()
      ? params.aiSuggestedReply.trim()
      : String(ex?.ai_suggested_reply || "");
  const finalLastReply =
    params.lastReplyText !== undefined && params.lastReplyText.trim()
      ? params.lastReplyText.trim()
      : String(ex?.last_reply_text || "");
  const finalChannel =
    params.lastReplyChannel !== undefined && params.lastReplyChannel.trim()
      ? params.lastReplyChannel.trim()
      : String(ex?.last_reply_channel || "");
  const finalRepliedBy =
    params.repliedByName !== undefined && params.repliedByName.trim()
      ? params.repliedByName.trim()
      : String(ex?.replied_by_name || "");
  const finalRepliedAt =
    params.repliedAt !== undefined && params.repliedAt
      ? params.repliedAt
      : ex?.replied_at
      ? String(ex.replied_at)
      : finalStatus === "Replied"
      ? nowIso
      : null;
  const finalConvId =
    params.conversationId !== undefined && params.conversationId
      ? params.conversationId
      : ex?.conversation_id
      ? String(ex.conversation_id)
      : null;

  await crm.execute({
    sql: `INSERT INTO ecosystem_enquiries (
      id, external_id, brand, brand_label, customer_name, customer_email, customer_phone,
      product_name, source, message, status, ai_suggested_reply, last_reply_text,
      last_reply_channel, replied_by_name, replied_at, conversation_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      customer_name = COALESCE(NULLIF(excluded.customer_name, ''), ecosystem_enquiries.customer_name),
      customer_email = COALESCE(NULLIF(excluded.customer_email, ''), ecosystem_enquiries.customer_email),
      customer_phone = COALESCE(NULLIF(excluded.customer_phone, ''), ecosystem_enquiries.customer_phone),
      product_name = COALESCE(NULLIF(excluded.product_name, ''), ecosystem_enquiries.product_name),
      source = COALESCE(NULLIF(excluded.source, ''), ecosystem_enquiries.source),
      message = COALESCE(NULLIF(excluded.message, ''), ecosystem_enquiries.message),
      status = excluded.status,
      ai_suggested_reply = COALESCE(NULLIF(excluded.ai_suggested_reply, ''), ecosystem_enquiries.ai_suggested_reply),
      last_reply_text = COALESCE(NULLIF(excluded.last_reply_text, ''), ecosystem_enquiries.last_reply_text),
      last_reply_channel = COALESCE(NULLIF(excluded.last_reply_channel, ''), ecosystem_enquiries.last_reply_channel),
      replied_by_name = COALESCE(NULLIF(excluded.replied_by_name, ''), ecosystem_enquiries.replied_by_name),
      replied_at = COALESCE(excluded.replied_at, ecosystem_enquiries.replied_at),
      conversation_id = COALESCE(excluded.conversation_id, ecosystem_enquiries.conversation_id),
      updated_at = excluded.updated_at`,
    args: [
      id,
      cleanExtId,
      params.brand,
      brandLabel,
      params.customerName || "Customer",
      params.customerEmail || "",
      params.customerPhone || "",
      params.productName || "",
      params.source || (params.brand === "CLASSIC_EDGE_53" ? "Classic Edge 53 Website" : "Classic Concepts Website"),
      params.message || "",
      finalStatus,
      finalAiReply,
      finalLastReply,
      finalChannel,
      finalRepliedBy,
      finalRepliedAt,
      finalConvId,
      finalCreatedAt,
      nowIso,
    ],
  });

  const savedRes = await crm.execute({
    sql: `SELECT * FROM ecosystem_enquiries WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return mapEcosystemEnquiryRow((savedRes.rows[0] || {}) as Record<string, unknown>);
}

export async function syncWebsiteEnquiryStatusAcrossSites(params: {
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  externalId: string;
  replyMessage?: string;
  sendEmailOnSite?: boolean;
}): Promise<{ bridgeUpdated: boolean; dbUpdated: boolean; emailDeliveredBySite: boolean; emailError?: string }> {
  const cleanExtId = String(params.externalId || "").replace(/^(cc_|ce53_|ce_)/, "").trim();
  if (!cleanExtId) {
    return { bridgeUpdated: false, dbUpdated: false, emailDeliveredBySite: false };
  }

  let bridgeUpdated = false;
  let dbUpdated = false;
  let emailDeliveredBySite = false;
  let emailError: string | undefined;

  try {
    if (params.brand === "CLASSIC_CONCEPTS") {
      const ccClient = getMainCatalogClient();
      if (ccClient) {
        await ccClient.execute({
          sql: `UPDATE Enquiry SET status = 'Replied' WHERE id = ?`,
          args: [cleanExtId],
        });
        dbUpdated = true;
      }
    } else {
      const ceClient = getClassicEdgeClient();
      if (ceClient) {
        await ceClient.execute({
          sql: `UPDATE Enquiry SET repliedAt = ? WHERE id = ?`,
          args: [new Date().toISOString(), cleanExtId],
        });
        dbUpdated = true;
      }
    }
  } catch {
    // Non-blocking
  }

  const targetBaseUrl =
    params.brand === "CLASSIC_EDGE_53"
      ? resolveClassicEdgeInternalUrl()
      : resolveClassicConceptsInternalUrl();
  const key = resolveEcosystemBridgeKey();

  try {
    const res = await fetch(`${targetBaseUrl}/api/internal/bridge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cc-bridge-key": key,
      },
      body: JSON.stringify({
        action: params.sendEmailOnSite ? "reply_enquiry" : "mark_enquiry_replied",
        enquiryId: cleanExtId,
        replyMessage: params.replyMessage || "",
        sendEmail: Boolean(params.sendEmailOnSite),
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data: any = await res.json().catch(() => ({}));
      bridgeUpdated = Boolean(data?.ok);
      emailDeliveredBySite = Boolean(data?.emailDelivered);
      if (data?.emailError) emailError = String(data.emailError);
    }
  } catch {
    // Non-blocking if sibling site is offline in local dev
  }

  return { bridgeUpdated, dbUpdated, emailDeliveredBySite, emailError };
}

export async function syncAndListEcosystemEnquiries(filters?: {
  brand?: "ALL" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  status?: "ALL" | "New" | "Replied";
  search?: string;
  limit?: number;
}): Promise<EcosystemEnquiryRecord[]> {
  await ensureEcosystemEnquiriesTable();
  const crm = getRawLibSqlClient("crm_orders");
  const key = resolveEcosystemBridgeKey();

  try {
    const ccClient = getMainCatalogClient();
    if (ccClient) {
      const res = await ccClient.execute(
        `SELECT id, name, email, phone, message, source, status, createdAt FROM Enquiry ORDER BY createdAt DESC LIMIT 200`
      );
      for (const r of res.rows) {
        const createdIso =
          typeof r.createdAt === "number"
            ? new Date(r.createdAt).toISOString()
            : String(r.createdAt || new Date().toISOString());
        await upsertEcosystemEnquiry({
          externalId: String(r.id),
          brand: "CLASSIC_CONCEPTS",
          customerName: String(r.name || "Customer"),
          customerEmail: String(r.email || ""),
          customerPhone: String(r.phone || ""),
          source: String(r.source || "Classic Concepts Website"),
          message: String(r.message || ""),
          status: String(r.status || "New"),
          createdAt: createdIso,
        });
      }
    }
  } catch {
    // Non-blocking
  }

  try {
    const ceClient = getClassicEdgeClient();
    if (ceClient) {
      const res = await ceClient.execute(
        `SELECT id, name, email, phone, message, productName, repliedAt, createdAt FROM Enquiry ORDER BY createdAt DESC LIMIT 200`
      );
      for (const r of res.rows) {
        const prod = r.productName ? String(r.productName) : "";
        const createdIso =
          typeof r.createdAt === "number"
            ? new Date(r.createdAt).toISOString()
            : String(r.createdAt || new Date().toISOString());
        const repliedIso = r.repliedAt
          ? typeof r.repliedAt === "number"
            ? new Date(r.repliedAt).toISOString()
            : String(r.repliedAt)
          : null;
        await upsertEcosystemEnquiry({
          externalId: String(r.id),
          brand: "CLASSIC_EDGE_53",
          customerName: String(r.name || "Customer"),
          customerEmail: String(r.email || ""),
          customerPhone: String(r.phone || ""),
          productName: prod,
          source: prod ? `Classic Edge 53 (${prod})` : "Classic Edge 53 Website",
          message: String(r.message || ""),
          status: r.repliedAt ? "Replied" : "New",
          repliedAt: repliedIso,
          createdAt: createdIso,
        });
      }
    }
  } catch {
    // Non-blocking
  }

  const bridgeTargets: Array<{
    url: string;
    brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  }> = [
    { url: resolveClassicConceptsInternalUrl(), brand: "CLASSIC_CONCEPTS" },
    { url: resolveClassicEdgeInternalUrl(), brand: "CLASSIC_EDGE_53" },
  ];
  await Promise.all(
    bridgeTargets.map(async (bt) => {
      try {
        const res = await fetch(
          `${bt.url}/api/internal/bridge?action=enquiries&limit=100`,
          {
            headers: { "x-cc-bridge-key": key },
            signal: AbortSignal.timeout(2200),
          }
        );
        if (!res.ok) return;
        const json: any = await res.json().catch(() => ({}));
        const list: any[] = Array.isArray(json?.enquiries) ? json.enquiries : [];
        for (const e of list) {
          await upsertEcosystemEnquiry({
            externalId: String(e.id),
            brand: bt.brand,
            customerName: String(e.name || "Customer"),
            customerEmail: String(e.email || ""),
            customerPhone: String(e.phone || ""),
            productName: String(e.productName || ""),
            source:
              String(e.source || "") ||
              (bt.brand === "CLASSIC_EDGE_53"
                ? "Classic Edge 53 Website"
                : "Classic Concepts Website"),
            message: String(e.message || "").replace(/^\[Machine:\s*[^\]]+\]\s*/i, ""),
            status: String(e.status || "New"),
            createdAt: String(e.createdAt || new Date().toISOString()),
          });
        }
      } catch {
        // Non-blocking
      }
    })
  );

  try {
    const syncLogs = await crm
      .execute(
        `SELECT * FROM website_enquiry_sync_logs ORDER BY created_at DESC LIMIT 100`
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    for (const log of syncLogs.rows) {
      const extKey = String(log.external_key || "");
      const brand =
        String(log.brand || "") === "CLASSIC_EDGE_53"
          ? "CLASSIC_EDGE_53"
          : "CLASSIC_CONCEPTS";
      const extId = extKey.replace(/^(CLASSIC_CONCEPTS:|CLASSIC_EDGE_53:)/, "");
      if (!extId) continue;
      await upsertEcosystemEnquiry({
        externalId: extId,
        brand,
        customerName: String(log.customer_name || "Customer"),
        customerEmail: String(log.customer_email || ""),
        customerPhone: String(log.customer_phone || ""),
        productName: String(log.product_name || ""),
        message: String(log.message || "Customer Website Enquiry"),
        aiSuggestedReply: String(log.smart_reply_text || ""),
        conversationId: log.conversation_id ? String(log.conversation_id) : null,
        createdAt: String(log.created_at || new Date().toISOString()),
      });
    }
  } catch {
    // Non-blocking
  }

  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filters?.brand && filters.brand !== "ALL") {
    where.push("brand = ?");
    args.push(filters.brand);
  }
  if (filters?.status && filters.status !== "ALL") {
    where.push("status = ?");
    args.push(filters.status);
  }
  if (filters?.search?.trim()) {
    const q = `%${filters.search.trim().toLowerCase()}%`;
    where.push(
      "(LOWER(customer_name) LIKE ? OR LOWER(customer_email) LIKE ? OR LOWER(customer_phone) LIKE ? OR LOWER(message) LIKE ? OR LOWER(product_name) LIKE ? OR LOWER(source) LIKE ?)"
    );
    args.push(q, q, q, q, q, q);
  }

  const limit = Math.min(500, Math.max(1, filters?.limit ?? 200));
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rowsRes = await crm.execute({
    sql: `SELECT * FROM ecosystem_enquiries ${whereSql} ORDER BY created_at DESC LIMIT ${limit}`,
    args,
  });

  return rowsRes.rows.map((r) =>
    mapEcosystemEnquiryRow(r as Record<string, unknown>)
  );
}
