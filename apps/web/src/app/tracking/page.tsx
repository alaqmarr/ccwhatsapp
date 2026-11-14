import type { Metadata } from "next";
import {
  ensureDatabasesBootstrapped,
  lookupOrderTracking,
} from "@cc/database";
import { TrackingPortalClient } from "./TrackingPortalClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Track Your Order | Classic Concepts & Classic Edge 53",
  description:
    "Enter your Classic Concepts or Classic Edge 53 Order ID to check live courier delivery status.",
};

export default async function PublicOrderTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; notfound?: string }>;
}) {
  await ensureDatabasesBootstrapped();
  const sp = await searchParams;
  const rawOrder = String(sp?.order || "").trim();
  const notFoundFlag = sp?.notfound === "1";

  let initialTracking = null;
  if (rawOrder && !notFoundFlag) {
    const found = await lookupOrderTracking({
      orderInput: rawOrder,
      incrementCounter: false,
    });
    if (found) {
      initialTracking = {
        orderId: found.orderId,
        brand: found.brand,
        brandLabel: found.brandLabel,
        itemsSummary: found.itemsSummary,
        providerCode: found.providerCode,
        providerName: found.providerName,
        awbNumber: found.awbNumber,
        providerTrackingUrl: found.providerTrackingUrl || null,
        publicTrackingUrl: found.publicTrackingUrl,
        shipmentStatus: found.shipmentStatus,
        estimatedDelivery: found.estimatedDelivery || null,
        updatedAt: found.updatedAt,
      };
    }
  }

  return (
    <TrackingPortalClient
      initialOrderId={rawOrder}
      initialNotFound={notFoundFlag || (Boolean(rawOrder) && !initialTracking)}
      initialTracking={initialTracking}
    />
  );
}
