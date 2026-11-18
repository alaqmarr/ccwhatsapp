import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { canViewCostBreakdown, isDevRole } from "@cc/rbac";
import { loadPricingPayload } from "@/lib/loaders/core";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * STRICT ROLE-SEPARATED PRICING & PROFIT API:
 * - Staff / Manager / Admin NEVER see message charges here (403).
 * - Superadmin on `/dashboard/pricing` ("Cost Breakdown") sees ONLY Classic Concepts' set client charges:
 *   ₹0.95 per Marketing message and ₹0.30 per ACRIO / Utility / Auth message.
 * - DEV on `/dashboard/dev` (`?scope=dev`) sees actual Meta wholesale costs, net profit, and margin!
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !canViewCostBreakdown(user.role)) {
    return NextResponse.json(
      { ok: false, error: "Cost breakdown requires Superadmin or Dev access." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const requestedScope = searchParams.get("scope");
  if (requestedScope === "dev" && !isDevRole(user.role)) {
    return NextResponse.json(
      { ok: false, error: "Dev profit & Meta wholesale analytics are reserved strictly for DEV." },
      { status: 403 }
    );
  }

  const payload = await loadPricingPayload(user, requestedScope);
  return NextResponse.json(payload);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isDevRole(user.role)) {
    return NextResponse.json(
      { ok: false, error: "Only DEV can configure wholesale & client pricing rates." },
      { status: 403 }
    );
  }

  await ensureDatabasesBootstrapped();
  const bill = getRawLibSqlClient("billing_ops");
  const body = await req.json().catch(() => ({}));

  await bill.execute({
    sql: `UPDATE pricing_config
          SET client_marketing_rate_inr = COALESCE(?, client_marketing_rate_inr),
              client_other_rate_inr = COALESCE(?, client_other_rate_inr),
              actual_meta_marketing_rate_inr = COALESCE(?, actual_meta_marketing_rate_inr),
              actual_meta_utility_rate_inr = COALESCE(?, actual_meta_utility_rate_inr),
              actual_meta_auth_rate_inr = COALESCE(?, actual_meta_auth_rate_inr),
              actual_meta_service_rate_inr = COALESCE(?, actual_meta_service_rate_inr),
              gst_rate_pct = COALESCE(?, gst_rate_pct),
              usd_to_inr_rate = COALESCE(?, usd_to_inr_rate),
              updated_by = ?,
              updated_at = ?
          WHERE id = 'default'`,
    args: [
      body.clientMarketingRateInr !== undefined ? Number(body.clientMarketingRateInr) : null,
      body.clientOtherRateInr !== undefined ? Number(body.clientOtherRateInr) : null,
      body.actualMetaMarketingRateInr !== undefined ? Number(body.actualMetaMarketingRateInr) : null,
      body.actualMetaUtilityRateInr !== undefined ? Number(body.actualMetaUtilityRateInr) : null,
      body.actualMetaAuthRateInr !== undefined ? Number(body.actualMetaAuthRateInr) : null,
      body.actualMetaServiceRateInr !== undefined ? Number(body.actualMetaServiceRateInr) : null,
      body.gstRatePct !== undefined ? Number(body.gstRatePct) : null,
      body.usdToInrRate !== undefined ? Number(body.usdToInrRate) : null,
      user.name,
      new Date().toISOString(),
    ],
  });

  return NextResponse.json({ ok: true });
}
