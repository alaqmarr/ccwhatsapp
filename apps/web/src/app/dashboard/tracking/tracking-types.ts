export interface OrderTrackingRow {
  id: string;
  orderId: string;
  lookupKey: string;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  brandLabel: string;
  customerName: string;
  customerPhone: string;
  providerCode: string;
  providerName: string;
  awbNumber: string;
  providerTrackingUrl: string;
  publicTrackingUrl: string;
  shipmentStatus: string;
  itemsSummary: string;
  lookupsCount: number;
  lastLookedUpAt: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export const STATUS_OPTIONS = [
  "DISPATCHED",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "ORDER_CONFIRMED",
  "IN_PRODUCTION",
  "READY_TO_SHIP",
] as const;
