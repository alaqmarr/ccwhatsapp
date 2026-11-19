import { normalizeWhatsAppPhone } from "./contacts-sync";
import {
  resolveClassicConceptsInternalUrl,
  resolveClassicEdgeDbPath,
  resolveClassicEdgeInternalUrl,
  resolveEcosystemBridgeKey,
  resolveMainWebsiteDbPath,
} from "./env-config";
import {
  getClassicEdgeClient,
  getMainCatalogClient,
  getRawLibSqlClient,
} from "./handles";
import {
  ensureOrderTrackingTableExists,
  inferOrderBrand,
  mapOrderTrackingRow,
  normalizeOrderLookupKey,
  sanitizeOrderDisplayId,
  stripOrderAlnum,
  upsertOrderTracking,
  type OrderTrackingRecord,
  type ShipmentStatus,
} from "./orders-tracking";

export interface EcosystemBridgeStatus {
  classicEdge3002: {
    online: boolean;
    url: string;
    latencyMs: number;
    dbFallbackAvailable: boolean;
    smtpConfigured?: boolean;
  };
  classicConcepts3003: {
    online: boolean;
    url: string;
    latencyMs: number;
    dbFallbackAvailable: boolean;
    smtpConfigured?: boolean;
  };
  whatsapp3007: {
    online: boolean;
    port: number;
  };
  checkedAt: string;
}

export async function checkEcosystemBridgesHealth(): Promise<EcosystemBridgeStatus> {
  const key = resolveEcosystemBridgeKey();
  const ceUrl = resolveClassicEdgeInternalUrl();
  const ccUrl = resolveClassicConceptsInternalUrl();

  const probe = async (baseUrl: string) => {
    const t0 = Date.now();
    try {
      const res = await fetch(`${baseUrl}/api/internal/bridge?action=health`, {
        headers: { "x-cc-bridge-key": key },
        signal: AbortSignal.timeout(2200),
      });
      if (!res.ok) {
        return { online: false, latencyMs: Date.now() - t0, smtpConfigured: false };
      }
      const data: any = await res.json().catch(() => ({}));
      return {
        online: Boolean(data?.ok),
        latencyMs: Date.now() - t0,
        smtpConfigured: Boolean(data?.smtpConfigured),
      };
    } catch {
      return { online: false, latencyMs: Date.now() - t0, smtpConfigured: false };
    }
  };

  const [ceProbe, ccProbe] = await Promise.all([probe(ceUrl), probe(ccUrl)]);

  return {
    classicEdge3002: {
      online: ceProbe.online,
      url: ceUrl,
      latencyMs: ceProbe.latencyMs,
      dbFallbackAvailable: Boolean(resolveClassicEdgeDbPath()),
      smtpConfigured: ceProbe.smtpConfigured,
    },
    classicConcepts3003: {
      online: ccProbe.online,
      url: ccUrl,
      latencyMs: ccProbe.latencyMs,
      dbFallbackAvailable: Boolean(resolveMainWebsiteDbPath()),
      smtpConfigured: ccProbe.smtpConfigured,
    },
    whatsapp3007: {
      online: true,
      port: Number(process.env.PORT || 3007),
    },
    checkedAt: new Date().toISOString(),
  };
}

function mapWebsiteBridgeStatusToShipment(raw: string): ShipmentStatus {
  const s = String(raw || "").trim().toUpperCase();
  if (/DELIVER|COMPLETE/.test(s)) return "DELIVERED";
  if (/OUT_FOR_DELIVERY/.test(s)) return "OUT_FOR_DELIVERY";
  if (/IN_TRANSIT/.test(s)) return "IN_TRANSIT";
  if (/DISPATCH|SHIP/.test(s)) return "DISPATCHED";
  if (/READY/.test(s)) return "READY_FOR_DISPATCH";
  if (/PROCESS|PRODUCTION|PAID/.test(s)) return "IN_PRODUCTION";
  return "ORDER_CONFIRMED";
}

async function fetchWebsiteBridgeOrders(params: {
  orderId?: string;
  phone?: string;
  email?: string;
}): Promise<OrderTrackingRecord[]> {
  const key = resolveEcosystemBridgeKey();
  const qs = new URLSearchParams({ action: "orders" });
  if (params.orderId) qs.set("orderId", params.orderId);
  if (params.phone) qs.set("phone", params.phone);
  if (params.email) qs.set("email", params.email);

  const endpoints = [
    { url: resolveClassicConceptsInternalUrl(), defaultBrand: "CLASSIC_CONCEPTS" as const },
    { url: resolveClassicEdgeInternalUrl(), defaultBrand: "CLASSIC_EDGE_53" as const },
  ];

  const found: OrderTrackingRecord[] = [];

  await Promise.all(
    endpoints.map(async (ep) => {
      try {
        const res = await fetch(`${ep.url}/api/internal/bridge?${qs.toString()}`, {
          headers: { "x-cc-bridge-key": key },
          signal: AbortSignal.timeout(2500),
        });
        if (!res.ok) return;
        const json: any = await res.json().catch(() => ({}));
        const orders: any[] = Array.isArray(json?.orders) ? json.orders : [];
        for (const o of orders) {
          const displayOrderId = sanitizeOrderDisplayId(
            String(o.orderNumber || o.orderId || o.id || "")
          );
          if (!displayOrderId) continue;
          const shipmentStatus = mapWebsiteBridgeStatusToShipment(
            String(o.shipmentStatus || o.status || "ORDER_CONFIRMED")
          );
          const upserted = await upsertOrderTracking({
            orderId: displayOrderId,
            brand: o.brand || ep.defaultBrand,
            customerName: String(o.customerName || o.name || ""),
            customerPhone:
              normalizeWhatsAppPhone(String(o.customerPhone || o.phone || "")) ||
              String(o.customerPhone || o.phone || ""),
            itemsSummary: String(o.itemsSummary || "Website Order"),
            providerCode: String(o.providerCode || "WORKSHOP"),
            providerName: String(
              o.providerName ||
                (ep.defaultBrand === "CLASSIC_EDGE_53"
                  ? "Classic Edge 53 Dispatch"
                  : "Classic Concepts Dispatch")
            ),
            awbNumber: String(o.awbNumber || ""),
            providerTrackingUrl: String(o.providerTrackingUrl || ""),
            shipmentStatus,
            createdByName:
              ep.defaultBrand === "CLASSIC_EDGE_53"
                ? "Classic Edge 53 (:3002)"
                : "Classic Concepts (:3003)",
          });
          if (upserted.ok && upserted.tracking) {
            found.push(upserted.tracking);
          }
        }
      } catch {
        // Non-blocking: falls back to local SQLite below
      }
    })
  );

  return found;
}

export async function lookupOrderTracking(params: {
  orderInput: string;
  preferredBrand?: string;
  incrementCounter?: boolean;
}): Promise<OrderTrackingRecord | null> {
  await ensureOrderTrackingTableExists();
  const crm = getRawLibSqlClient("crm_orders");

  let decoded = String(params.orderInput || "").trim();
  try {
    decoded = decodeURIComponent(decoded).trim();
  } catch {
    // Keep raw
  }
  const lookupKey = normalizeOrderLookupKey(decoded);
  const alnumKey = stripOrderAlnum(decoded);
  if (!lookupKey && !alnumKey) return null;

  const exactRes = await crm.execute({
    sql: `SELECT * FROM order_trackings WHERE lookup_key = ? OR LOWER(awb_number) = ? LIMIT 5`,
    args: [lookupKey, decoded.toLowerCase()],
  });

  let matchedRow = exactRes.rows[0] as Record<string, unknown> | undefined;
  if (!matchedRow && alnumKey.length >= 4) {
    const allRes = await crm.execute(
      `SELECT * FROM order_trackings ORDER BY updated_at DESC LIMIT 500`
    );
    matchedRow = allRes.rows.find((r) => {
      const rAlnum = stripOrderAlnum(String(r.order_id || ""));
      const rAwb = stripOrderAlnum(String(r.awb_number || ""));
      return (
        rAlnum === alnumKey ||
        `cc${rAlnum}` === alnumKey ||
        `ce53${rAlnum}` === alnumKey ||
        rAlnum === `cc${alnumKey}` ||
        rAlnum === `ce53${alnumKey}` ||
        (rAwb.length >= 5 && rAwb === alnumKey)
      );
    }) as Record<string, unknown> | undefined;
  }

  if (matchedRow) {
    if (params.incrementCounter !== false) {
      const nowIso = new Date().toISOString();
      await crm
        .execute({
          sql: `UPDATE order_trackings
                SET lookups_count = lookups_count + 1,
                    last_looked_up_at = ?
                WHERE id = ?`,
          args: [nowIso, String(matchedRow.id)],
        })
        .catch(() => {});
      matchedRow = {
        ...matchedRow,
        lookups_count: Number(matchedRow.lookups_count ?? 0) + 1,
        last_looked_up_at: nowIso,
      };
    }
    return mapOrderTrackingRow(matchedRow);
  }

  const bridgeOrders = await fetchWebsiteBridgeOrders({ orderId: decoded });
  if (bridgeOrders.length > 0) {
    return bridgeOrders[0];
  }

  const crmOrdersRes = await crm.execute(
    `SELECT o.*, c.name as customer_name
     FROM customer_orders o
     LEFT JOIN customers c ON c.id = o.customer_id
     ORDER BY o.ordered_at DESC
     LIMIT 300`
  );
  const matchedCrmOrder = crmOrdersRes.rows.find((r) => {
    const oNum = String(r.order_number || "");
    return (
      normalizeOrderLookupKey(oNum) === lookupKey ||
      stripOrderAlnum(oNum) === alnumKey ||
      String(r.id || "").toLowerCase() === decoded.toLowerCase()
    );
  }) as Record<string, unknown> | undefined;

  if (matchedCrmOrder) {
    const orderNum = String(matchedCrmOrder.order_number || decoded);
    const items = String(matchedCrmOrder.items_summary || "");
    const brand = inferOrderBrand(orderNum, params.preferredBrand, items);
    const fStatus = String(matchedCrmOrder.fulfillment_status || "IN_PRODUCTION");
    const shipmentStatus: ShipmentStatus =
      fStatus === "DELIVERED"
        ? "DELIVERED"
        : fStatus === "DISPATCHED"
        ? "DISPATCHED"
        : fStatus === "DESIGN_PENDING"
        ? "ORDER_CONFIRMED"
        : "IN_PRODUCTION";
    const maybeUrl = String(matchedCrmOrder.invoice_url || "").trim();
    const isExternalProviderUrl =
      /^https?:\/\//i.test(maybeUrl) &&
      !/classicconcepts\.in|classicedge53\.com/i.test(maybeUrl);

    const upserted = await upsertOrderTracking({
      orderId: orderNum,
      brand,
      customerName: String(matchedCrmOrder.customer_name || ""),
      customerPhone: String(matchedCrmOrder.customer_phone || ""),
      itemsSummary: items,
      providerCode: "WORKSHOP",
      providerName: isExternalProviderUrl ? "Courier Partner" : "Workshop Fulfillment",
      providerTrackingUrl: isExternalProviderUrl ? maybeUrl : "",
      shipmentStatus,
      createdByName: "CRM Sync",
    });
    if (upserted.ok && upserted.tracking) {
      return upserted.tracking;
    }
  }

  const siteClient = getMainCatalogClient();
  if (siteClient) {
    try {
      const cartRes = await siteClient.execute(
        `SELECT id, name, phone, status, createdAt FROM CartOrder ORDER BY createdAt DESC LIMIT 200`
      );
      const foundCart = cartRes.rows.find((r: Record<string, unknown>) => {
        const cid = String(r.id || "");
        const short6 = cid.slice(-6).toLowerCase();
        return (
          cid.toLowerCase() === decoded.toLowerCase() ||
          short6 === alnumKey ||
          `cc${short6}` === alnumKey
        );
      });
      if (foundCart) {
        const cid = String(foundCart.id);
        const itemsRes = await siteClient
          .execute({
            sql: `SELECT productName, quantity FROM CartOrderItem WHERE orderId = ?`,
            args: [cid],
          })
          .catch(() => ({ rows: [] as Record<string, unknown>[] }));
        const summary = itemsRes.rows
          .map(
            (it: Record<string, unknown>) =>
              `${Number(it.quantity ?? 1)}x ${String(it.productName || "Item")}`
          )
          .join(", ");
        const st = String(foundCart.status || "Pending");
        const shipmentStatus = mapWebsiteBridgeStatusToShipment(st);
        const displayId = `CC-${cid.slice(-6).toUpperCase()}`;
        const upserted = await upsertOrderTracking({
          orderId: displayId,
          brand: "CLASSIC_CONCEPTS",
          customerName: String(foundCart.name || ""),
          customerPhone:
            normalizeWhatsAppPhone(String(foundCart.phone || "")) ||
            String(foundCart.phone || ""),
          itemsSummary: summary || "Classic Concepts Website Order",
          providerCode: "WORKSHOP",
          providerName: "Classic Concepts Dispatch",
          shipmentStatus,
          createdByName: "Classic Concepts DB",
        });
        if (upserted.ok && upserted.tracking) {
          return upserted.tracking;
        }
      }
    } catch {
      // Ignore if CartOrder table doesn't exist
    }
  }

  const ceClient = getClassicEdgeClient();
  if (ceClient) {
    try {
      const ceOrdersRes = await ceClient.execute(
        `SELECT id, customerName, customerPhone, status, items, createdAt FROM "Order" ORDER BY createdAt DESC LIMIT 200`
      );
      const foundCe = ceOrdersRes.rows.find((r: Record<string, unknown>) => {
        const cid = String(r.id || "");
        const short6 = cid.slice(-6).toLowerCase();
        return (
          cid.toLowerCase() === decoded.toLowerCase() ||
          short6 === alnumKey ||
          `ce53${short6}` === alnumKey ||
          `ce${short6}` === alnumKey
        );
      });
      if (foundCe) {
        const cid = String(foundCe.id);
        let summary = "Classic Edge 53 Machine / Consumable Order";
        try {
          const parsedItems = JSON.parse(String(foundCe.items || "[]"));
          if (Array.isArray(parsedItems) && parsedItems.length > 0) {
            summary = parsedItems
              .map((it: any) => `${Number(it.quantity || 1)}x ${String(it.name || it.productName || "Item")}`)
              .join(", ");
          }
        } catch {
          // Keep default summary
        }
        const displayId = `CE53-${cid.slice(-6).toUpperCase()}`;
        const upserted = await upsertOrderTracking({
          orderId: displayId,
          brand: "CLASSIC_EDGE_53",
          customerName: String(foundCe.customerName || ""),
          customerPhone:
            normalizeWhatsAppPhone(String(foundCe.customerPhone || "")) ||
            String(foundCe.customerPhone || ""),
          itemsSummary: summary,
          providerCode: "WORKSHOP",
          providerName: "Classic Edge 53 Dispatch",
          shipmentStatus: mapWebsiteBridgeStatusToShipment(String(foundCe.status || "Pending")),
          createdByName: "Classic Edge 53 DB",
        });
        if (upserted.ok && upserted.tracking) {
          return upserted.tracking;
        }
      }
    } catch {
      // Ignore if Order table doesn't exist
    }
  }

  return null;
}

export async function lookupCustomerOrdersAcrossEcosystem(params: {
  orderInput?: string;
  customerPhone?: string;
  customerEmail?: string;
}): Promise<{
  exactMatch: OrderTrackingRecord | null;
  phoneOrders: OrderTrackingRecord[];
}> {
  await ensureOrderTrackingTableExists();
  const crm = getRawLibSqlClient("crm_orders");

  let exactMatch: OrderTrackingRecord | null = null;
  if (params.orderInput?.trim()) {
    exactMatch = await lookupOrderTracking({
      orderInput: params.orderInput.trim(),
      incrementCounter: true,
    });
  }

  const last10 = String(params.customerPhone || "")
    .replace(/\D/g, "")
    .slice(-10);

  const byOrderKey = new Map<string, OrderTrackingRecord>();
  if (exactMatch) {
    byOrderKey.set(exactMatch.lookupKey, exactMatch);
  }

  if (last10.length >= 10 || params.customerEmail?.trim()) {
    const bridgeFound = await fetchWebsiteBridgeOrders({
      phone: last10 || undefined,
      email: params.customerEmail?.trim() || undefined,
    });
    for (const b of bridgeFound) {
      byOrderKey.set(b.lookupKey, b);
    }

    if (last10.length >= 10) {
      const trkRes = await crm.execute({
        sql: `SELECT * FROM order_trackings WHERE customer_phone LIKE ? ORDER BY updated_at DESC LIMIT 8`,
        args: [`%${last10}%`],
      });
      for (const r of trkRes.rows) {
        const mapped = mapOrderTrackingRow(r as Record<string, unknown>);
        if (!byOrderKey.has(mapped.lookupKey)) {
          byOrderKey.set(mapped.lookupKey, mapped);
        }
      }

      const crmRes = await crm.execute({
        sql: `SELECT o.*, c.name as customer_name
              FROM customer_orders o
              LEFT JOIN customers c ON c.id = o.customer_id
              WHERE o.customer_phone LIKE ?
              ORDER BY o.ordered_at DESC
              LIMIT 5`,
        args: [`%${last10}%`],
      });
      for (const r of crmRes.rows) {
        const orderNum = String(r.order_number || "");
        const key = normalizeOrderLookupKey(orderNum);
        if (key && !byOrderKey.has(key)) {
          const up = await upsertOrderTracking({
            orderId: orderNum,
            brand: inferOrderBrand(orderNum, null, String(r.items_summary || "")),
            customerName: String(r.customer_name || ""),
            customerPhone: String(r.customer_phone || ""),
            itemsSummary: String(r.items_summary || ""),
            providerCode: "WORKSHOP",
            providerName: "Workshop Fulfillment",
            shipmentStatus: mapWebsiteBridgeStatusToShipment(String(r.fulfillment_status || "IN_PRODUCTION")),
            createdByName: "CRM Sync",
          });
          if (up.ok && up.tracking) {
            byOrderKey.set(up.tracking.lookupKey, up.tracking);
          }
        }
      }
    }
  }

  return {
    exactMatch,
    phoneOrders: Array.from(byOrderKey.values()).slice(0, 6),
  };
}
