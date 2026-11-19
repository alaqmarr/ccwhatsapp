import { resolvePublicTrackingOrigin } from "./env-config";
import { getRawLibSqlClient } from "./handles";

export type OrderBrand = "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";

export type ShipmentStatus =
  | "ORDER_CONFIRMED"
  | "IN_PRODUCTION"
  | "READY_FOR_DISPATCH"
  | "DISPATCHED"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED";

export interface OrderTrackingRecord {
  id: string;
  orderId: string;
  lookupKey: string;
  brand: OrderBrand;
  brandLabel: string;
  customerName: string;
  customerPhone: string;
  conversationId: string | null;
  itemsSummary: string;
  providerCode: string;
  providerName: string;
  awbNumber: string;
  providerTrackingUrl: string;
  publicTrackingUrl: string;
  shipmentStatus: ShipmentStatus;
  estimatedDelivery: string;
  notes: string;
  lookupsCount: number;
  lastLookedUpAt: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export const SHIPPING_PROVIDERS: ReadonlyArray<{
  code: string;
  name: string;
  urlTemplate: string;
}> = [
  {
    code: "DELHIVERY",
    name: "Delhivery",
    urlTemplate: "https://www.delhivery.com/track/package/{awb}",
  },
  {
    code: "BLUEDART",
    name: "Blue Dart",
    urlTemplate: "https://www.bluedart.com/tracking?trackFor=0&trackNo={awb}",
  },
  {
    code: "SAFEEXPRESS",
    name: "Safexpress",
    urlTemplate: "https://www.safexpress.com/track?waybill={awb}",
  },
  {
    code: "DTDC",
    name: "DTDC",
    urlTemplate: "https://www.dtdc.in/trace.asp?strCnno={awb}",
  },
  {
    code: "VRL",
    name: "VRL Logistics",
    urlTemplate: "https://www.vrlgroup.in/track_consignment.aspx?lrno={awb}",
  },
  {
    code: "TCIEXPRESS",
    name: "TCI Express",
    urlTemplate: "https://www.tciexpress.in/trackingdocket.asp?docketno={awb}",
  },
  {
    code: "GATI",
    name: "Gati KWE",
    urlTemplate: "https://www.gati.com/track-by-docket/?dktno={awb}",
  },
  {
    code: "TRACKON",
    name: "Trackon",
    urlTemplate: "https://trackon.in/Tracking/TrackConsignment?awb={awb}",
  },
  {
    code: "SHIPROCKET",
    name: "Shiprocket",
    urlTemplate: "https://shiprocket.co/tracking/{awb}",
  },
  {
    code: "DHL",
    name: "DHL Express",
    urlTemplate: "https://www.dhl.com/in-en/home/tracking.html?tracking-id={awb}",
  },
  {
    code: "FEDEX",
    name: "FedEx",
    urlTemplate: "https://www.fedex.com/fedextrack/?trknbr={awb}",
  },
  {
    code: "INDIAPOST",
    name: "India Post",
    urlTemplate:
      "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx",
  },
  {
    code: "PORTER",
    name: "Porter / Local Tempo",
    urlTemplate: "",
  },
  {
    code: "CUSTOM",
    name: "Other Courier / Direct Link",
    urlTemplate: "",
  },
];

export function normalizeOrderLookupKey(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stripOrderAlnum(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function sanitizeOrderDisplayId(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "");
}

export function inferOrderBrand(
  orderId: string,
  explicitBrand?: string | null,
  itemsHint?: string | null
): OrderBrand {
  if (explicitBrand === "CLASSIC_EDGE_53") return "CLASSIC_EDGE_53";
  if (explicitBrand === "CLASSIC_CONCEPTS") return "CLASSIC_CONCEPTS";
  const combined = `${orderId} ${itemsHint || ""}`.toUpperCase();
  if (/^(CE53|CE-|YN-)|CLASSIC\s*EDGE|POLISHER|BENDER|MACHINE/.test(combined)) {
    return "CLASSIC_EDGE_53";
  }
  return "CLASSIC_CONCEPTS";
}

export function buildProviderTrackingUrl(
  providerCode: string,
  awbNumber: string,
  explicitProviderUrl?: string | null
): { providerCode: string; providerName: string; providerTrackingUrl: string } {
  const code = String(providerCode || "DELHIVERY").trim().toUpperCase();
  const matched = SHIPPING_PROVIDERS.find((p) => p.code === code);
  const providerName = matched ? matched.name : code === "CUSTOM" ? "Courier Partner" : code;
  const cleanCustom = String(explicitProviderUrl || "").trim();
  if (/^https?:\/\//i.test(cleanCustom)) {
    return {
      providerCode: matched ? matched.code : "CUSTOM",
      providerName,
      providerTrackingUrl: cleanCustom,
    };
  }
  const cleanAwb = String(awbNumber || "").trim();
  if (matched && matched.urlTemplate) {
    if (!cleanAwb && matched.urlTemplate.includes("{awb}")) {
      return {
        providerCode: matched.code,
        providerName: matched.name,
        providerTrackingUrl: "",
      };
    }
    return {
      providerCode: matched.code,
      providerName: matched.name,
      providerTrackingUrl: matched.urlTemplate.replace(
        "{awb}",
        encodeURIComponent(cleanAwb)
      ),
    };
  }
  return {
    providerCode: matched ? matched.code : "CUSTOM",
    providerName,
    providerTrackingUrl: "",
  };
}

let trackingTableReady = false;
export async function ensureOrderTrackingTableExists() {
  if (trackingTableReady) return;
  const crm = getRawLibSqlClient("crm_orders");
  await crm.execute("PRAGMA journal_mode = WAL;");
  await crm.execute("PRAGMA busy_timeout = 5000;");
  await crm.batch(
    [
      `CREATE TABLE IF NOT EXISTS order_trackings (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL UNIQUE,
        lookup_key TEXT NOT NULL UNIQUE,
        brand TEXT NOT NULL DEFAULT 'CLASSIC_CONCEPTS',
        customer_name TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        conversation_id TEXT,
        items_summary TEXT NOT NULL DEFAULT '',
        provider_code TEXT NOT NULL DEFAULT 'DELHIVERY',
        provider_name TEXT NOT NULL DEFAULT 'Delhivery',
        awb_number TEXT NOT NULL DEFAULT '',
        provider_tracking_url TEXT NOT NULL DEFAULT '',
        shipment_status TEXT NOT NULL DEFAULT 'DISPATCHED',
        estimated_delivery TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        lookups_count INTEGER NOT NULL DEFAULT 0,
        last_looked_up_at TEXT,
        created_by_name TEXT NOT NULL DEFAULT 'System',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_order_trackings_lookup ON order_trackings (lookup_key)`,
      `CREATE INDEX IF NOT EXISTS idx_order_trackings_phone ON order_trackings (customer_phone)`,
      `CREATE INDEX IF NOT EXISTS idx_order_trackings_updated ON order_trackings (updated_at DESC)`,
    ],
    "write"
  );
  trackingTableReady = true;
}

export function mapOrderTrackingRow(row: Record<string, unknown>): OrderTrackingRecord {
  const origin = resolvePublicTrackingOrigin();
  const orderId = String(row.order_id || "");
  const brand =
    String(row.brand || "") === "CLASSIC_EDGE_53"
      ? "CLASSIC_EDGE_53"
      : "CLASSIC_CONCEPTS";
  return {
    id: String(row.id),
    orderId,
    lookupKey: String(row.lookup_key || normalizeOrderLookupKey(orderId)),
    brand,
    brandLabel: brand === "CLASSIC_EDGE_53" ? "Classic Edge 53" : "Classic Concepts",
    customerName: String(row.customer_name || ""),
    customerPhone: String(row.customer_phone || ""),
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    itemsSummary: String(row.items_summary || ""),
    providerCode: String(row.provider_code || "DELHIVERY"),
    providerName: String(row.provider_name || "Courier Partner"),
    awbNumber: String(row.awb_number || ""),
    providerTrackingUrl: String(row.provider_tracking_url || ""),
    publicTrackingUrl: `${origin}/${encodeURIComponent(orderId)}`,
    shipmentStatus: String(row.shipment_status || "DISPATCHED") as ShipmentStatus,
    estimatedDelivery: String(row.estimated_delivery || ""),
    notes: String(row.notes || ""),
    lookupsCount: Number(row.lookups_count ?? 0),
    lastLookedUpAt: row.last_looked_up_at ? String(row.last_looked_up_at) : null,
    createdByName: String(row.created_by_name || "System"),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

export async function listOrderTrackings(filters?: {
  brand?: string;
  customerPhone?: string;
  query?: string;
  limit?: number;
}): Promise<OrderTrackingRecord[]> {
  await ensureOrderTrackingTableExists();
  const crm = getRawLibSqlClient("crm_orders");
  const where: string[] = [];
  const args: (string | number)[] = [];

  if (filters?.brand && filters.brand !== "ALL") {
    where.push("brand = ?");
    args.push(filters.brand);
  }
  if (filters?.customerPhone) {
    where.push("customer_phone = ?");
    args.push(filters.customerPhone.trim());
  }
  if (filters?.query?.trim()) {
    const q = `%${filters.query.trim().toLowerCase()}%`;
    where.push(
      "(LOWER(order_id) LIKE ? OR LOWER(customer_name) LIKE ? OR LOWER(customer_phone) LIKE ? OR LOWER(awb_number) LIKE ? OR LOWER(provider_name) LIKE ? OR LOWER(items_summary) LIKE ?)"
    );
    args.push(q, q, q, q, q, q);
  }

  const limit = Math.min(500, Math.max(1, filters?.limit ?? 200));
  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const res = await crm.execute({
    sql: `SELECT * FROM order_trackings ${whereClause} ORDER BY updated_at DESC LIMIT ${limit}`,
    args,
  });
  return res.rows.map((r) => mapOrderTrackingRow(r as Record<string, unknown>));
}

export async function upsertOrderTracking(params: {
  orderId: string;
  brand?: string;
  customerName?: string;
  customerPhone?: string;
  conversationId?: string | null;
  itemsSummary?: string;
  providerCode?: string;
  providerName?: string;
  awbNumber?: string;
  providerTrackingUrl?: string;
  shipmentStatus?: ShipmentStatus;
  estimatedDelivery?: string;
  notes?: string;
  createdByName?: string;
}): Promise<{ ok: boolean; tracking?: OrderTrackingRecord; error?: string }> {
  await ensureOrderTrackingTableExists();
  const crm = getRawLibSqlClient("crm_orders");

  const cleanOrderId = sanitizeOrderDisplayId(params.orderId);
  const lookupKey = normalizeOrderLookupKey(cleanOrderId);
  if (!cleanOrderId || !lookupKey) {
    return {
      ok: false,
      error: "Please enter a valid Order ID (for example CC-2026-1089 or CE53-2026-401).",
    };
  }

  const brand = inferOrderBrand(cleanOrderId, params.brand, params.itemsSummary);
  const resolvedProvider = buildProviderTrackingUrl(
    params.providerCode || "DELHIVERY",
    params.awbNumber || "",
    params.providerTrackingUrl
  );
  const finalProviderName =
    params.providerName?.trim() || resolvedProvider.providerName;

  const existingRes = await crm.execute({
    sql: `SELECT * FROM order_trackings WHERE lookup_key = ? LIMIT 1`,
    args: [lookupKey],
  });
  const nowIso = new Date().toISOString();

  if (existingRes.rows[0]) {
    const prev = existingRes.rows[0] as Record<string, unknown>;
    const id = String(prev.id);
    await crm.execute({
      sql: `UPDATE order_trackings
            SET order_id = ?,
                brand = ?,
                customer_name = ?,
                customer_phone = ?,
                conversation_id = COALESCE(?, conversation_id),
                items_summary = ?,
                provider_code = ?,
                provider_name = ?,
                awb_number = ?,
                provider_tracking_url = ?,
                shipment_status = ?,
                estimated_delivery = ?,
                notes = ?,
                updated_at = ?
            WHERE id = ?`,
      args: [
        cleanOrderId,
        brand,
        params.customerName !== undefined
          ? params.customerName.trim()
          : String(prev.customer_name || ""),
        params.customerPhone !== undefined
          ? params.customerPhone.trim()
          : String(prev.customer_phone || ""),
        params.conversationId || null,
        params.itemsSummary !== undefined
          ? params.itemsSummary.trim()
          : String(prev.items_summary || ""),
        resolvedProvider.providerCode,
        finalProviderName,
        params.awbNumber !== undefined
          ? params.awbNumber.trim()
          : String(prev.awb_number || ""),
        resolvedProvider.providerTrackingUrl,
        params.shipmentStatus ||
          (String(prev.shipment_status || "DISPATCHED") as ShipmentStatus),
        params.estimatedDelivery !== undefined
          ? params.estimatedDelivery.trim()
          : String(prev.estimated_delivery || ""),
        params.notes !== undefined
          ? params.notes.trim()
          : String(prev.notes || ""),
        nowIso,
        id,
      ],
    });
  } else {
    const id = `trk_${Math.random().toString(36).slice(2, 10)}`;
    await crm.execute({
      sql: `INSERT INTO order_trackings (
        id, order_id, lookup_key, brand, customer_name, customer_phone, conversation_id,
        items_summary, provider_code, provider_name, awb_number, provider_tracking_url,
        shipment_status, estimated_delivery, notes, lookups_count, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      args: [
        id,
        cleanOrderId,
        lookupKey,
        brand,
        (params.customerName || "").trim(),
        (params.customerPhone || "").trim(),
        params.conversationId || null,
        (params.itemsSummary || "").trim(),
        resolvedProvider.providerCode,
        finalProviderName,
        (params.awbNumber || "").trim(),
        resolvedProvider.providerTrackingUrl,
        params.shipmentStatus || "DISPATCHED",
        (params.estimatedDelivery || "").trim(),
        (params.notes || "").trim(),
        (params.createdByName || "Staff").trim(),
        nowIso,
        nowIso,
      ],
    });
  }

  const mappedFulfillment =
    params.shipmentStatus === "DELIVERED"
      ? "DELIVERED"
      : params.shipmentStatus === "IN_PRODUCTION" ||
        params.shipmentStatus === "ORDER_CONFIRMED"
      ? "IN_PRODUCTION"
      : "DISPATCHED";
  await crm
    .execute({
      sql: `UPDATE customer_orders SET fulfillment_status = ? WHERE LOWER(order_number) = ?`,
      args: [mappedFulfillment, cleanOrderId.toLowerCase()],
    })
    .catch(() => {});

  const finalRes = await crm.execute({
    sql: `SELECT * FROM order_trackings WHERE lookup_key = ? LIMIT 1`,
    args: [lookupKey],
  });
  return {
    ok: true,
    tracking: finalRes.rows[0]
      ? mapOrderTrackingRow(finalRes.rows[0] as Record<string, unknown>)
      : undefined,
  };
}

export async function deleteOrderTracking(idOrKey: string): Promise<boolean> {
  await ensureOrderTrackingTableExists();
  const crm = getRawLibSqlClient("crm_orders");
  const clean = idOrKey.trim();
  const res = await crm.execute({
    sql: `DELETE FROM order_trackings WHERE id = ? OR lookup_key = ?`,
    args: [clean, normalizeOrderLookupKey(clean)],
  });
  return Number(res.rowsAffected ?? 0) > 0;
}
