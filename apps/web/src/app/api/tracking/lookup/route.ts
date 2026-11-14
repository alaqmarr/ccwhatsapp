import { NextResponse } from "next/server";
import {
  ensureDatabasesBootstrapped,
  lookupOrderTracking,
  type OrderTrackingRecord,
} from "@cc/database";

export const dynamic = "force-dynamic";

function toPublicTrackingPayload(t: OrderTrackingRecord) {
  return {
    orderId: t.orderId,
    brand: t.brand,
    brandLabel: t.brandLabel,
    itemsSummary: t.itemsSummary,
    providerCode: t.providerCode,
    providerName: t.providerName,
    awbNumber: t.awbNumber,
    providerTrackingUrl: t.providerTrackingUrl || null,
    publicTrackingUrl: t.publicTrackingUrl,
    shipmentStatus: t.shipmentStatus,
    estimatedDelivery: t.estimatedDelivery || null,
    updatedAt: t.updatedAt,
  };
}

export async function GET(req: Request) {
  await ensureDatabasesBootstrapped();
  const url = new URL(req.url);
  const orderId = (url.searchParams.get("orderId") || url.searchParams.get("order") || "").trim();
  const brand = (url.searchParams.get("brand") || "").trim();
  const shouldRedirect = url.searchParams.get("redirect") === "1";

  if (!orderId) {
    return NextResponse.json(
      { ok: false, error: "Please enter your Classic Concepts or Classic Edge 53 Order ID." },
      { status: 400 }
    );
  }

  const tracking = await lookupOrderTracking({
    orderInput: orderId,
    preferredBrand: brand || undefined,
    incrementCounter: true,
  });

  if (shouldRedirect && tracking?.providerTrackingUrl) {
    return NextResponse.redirect(tracking.providerTrackingUrl, 307);
  }

  if (!tracking) {
    return NextResponse.json({
      ok: true,
      found: false,
      action: "NOT_FOUND",
      redirectUrl: null,
      tracking: null,
    });
  }

  const hasRedirect = /^https?:\/\//i.test(tracking.providerTrackingUrl);
  return NextResponse.json({
    ok: true,
    found: true,
    action: hasRedirect ? "REDIRECT" : "STATUS_ONLY",
    redirectUrl: hasRedirect ? tracking.providerTrackingUrl : null,
    tracking: toPublicTrackingPayload(tracking),
  });
}

export async function POST(req: Request) {
  await ensureDatabasesBootstrapped();
  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId || body.order || "").trim();
  const brand = String(body.brand || "").trim();

  if (!orderId) {
    return NextResponse.json(
      { ok: false, error: "Please enter your Classic Concepts or Classic Edge 53 Order ID." },
      { status: 400 }
    );
  }

  const tracking = await lookupOrderTracking({
    orderInput: orderId,
    preferredBrand: brand && brand !== "AUTO" ? brand : undefined,
    incrementCounter: true,
  });

  if (!tracking) {
    return NextResponse.json({
      ok: true,
      found: false,
      action: "NOT_FOUND",
      redirectUrl: null,
      tracking: null,
    });
  }

  const hasRedirect = /^https?:\/\//i.test(tracking.providerTrackingUrl);
  return NextResponse.json({
    ok: true,
    found: true,
    action: hasRedirect ? "REDIRECT" : "STATUS_ONLY",
    redirectUrl: hasRedirect ? tracking.providerTrackingUrl : null,
    tracking: toPublicTrackingPayload(tracking),
  });
}
