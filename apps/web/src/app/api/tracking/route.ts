import { NextResponse } from "next/server";
import {
  deleteOrderTracking,
  ensureDatabasesBootstrapped,
  listOrderTrackings,
  resolvePublicTrackingOrigin,
  SHIPPING_PROVIDERS,
  upsertOrderTracking,
  type ShipmentStatus,
} from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "crm:view_customer_360", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const url = new URL(req.url);
  const brand = url.searchParams.get("brand") || "ALL";
  const customerPhone = url.searchParams.get("customerPhone") || "";
  const query = url.searchParams.get("q") || "";

  const trackings = await listOrderTrackings({
    brand,
    customerPhone: customerPhone || undefined,
    query: query || undefined,
    limit: 300,
  });

  return NextResponse.json({
    ok: true,
    trackingOrigin: resolvePublicTrackingOrigin(),
    providers: SHIPPING_PROVIDERS,
    trackings,
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "crm:manage_orders_notes", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const body = await req.json().catch(() => ({}));

  const res = await upsertOrderTracking({
    orderId: String(body.orderId || ""),
    brand: body.brand ? String(body.brand) : undefined,
    customerName: body.customerName !== undefined ? String(body.customerName) : undefined,
    customerPhone: body.customerPhone !== undefined ? String(body.customerPhone) : undefined,
    conversationId: body.conversationId ? String(body.conversationId) : undefined,
    itemsSummary: body.itemsSummary !== undefined ? String(body.itemsSummary) : undefined,
    providerCode: body.providerCode ? String(body.providerCode) : undefined,
    providerName: body.providerName ? String(body.providerName) : undefined,
    awbNumber: body.awbNumber !== undefined ? String(body.awbNumber) : undefined,
    providerTrackingUrl:
      body.providerTrackingUrl !== undefined ? String(body.providerTrackingUrl) : undefined,
    shipmentStatus: body.shipmentStatus
      ? (String(body.shipmentStatus) as ShipmentStatus)
      : undefined,
    estimatedDelivery:
      body.estimatedDelivery !== undefined ? String(body.estimatedDelivery) : undefined,
    notes: body.notes !== undefined ? String(body.notes) : undefined,
    createdByName: user.name,
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, tracking: res.tracking });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "crm:manage_orders_notes", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "Missing tracking ID." }, { status: 400 });
  }

  const deleted = await deleteOrderTracking(id);
  return NextResponse.json({ ok: true, deleted });
}
