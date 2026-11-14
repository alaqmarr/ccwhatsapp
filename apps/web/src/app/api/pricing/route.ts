import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { getPricingDashboardMode, hasPermission, isDevRole } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * STRICT ROLE-SEPARATED PRICING API:
 * - Client / Admin / Superadmin see ONLY Classic Concepts' set rates:
 *   ₹0.95 per Marketing message and ₹0.30 per all other messages (Utility, Authentication, Service).
 * - DEV sees BOTH the set client pricing AND actual Meta wholesale costs + net margin!
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "billing:view_client_pricing", user.status)) {
    return NextResponse.json(
      { ok: false, error: "Pricing dashboard requires Admin, Client, Superadmin, or Dev access." },
      { status: 403 }
    );
  }

  await ensureDatabasesBootstrapped();
  const bill = getRawLibSqlClient("billing_ops");
  const mode = getPricingDashboardMode(user.role);
  const isDev = mode === "dev_actual_and_margin";

  const [cfgRes, summaryRes, recentRes] = await Promise.all([
    bill.execute(`SELECT * FROM pricing_config WHERE id = 'default' LIMIT 1`),
    bill.execute(
      `SELECT
         category,
         COUNT(*) as messageCount,
         SUM(client_unit_rate_inr) as totalClientBilled,
         SUM(actual_meta_unit_cost_inr) as totalActualMetaCost,
         SUM(margin_inr) as totalMargin
       FROM message_billing_ledger
       GROUP BY category`
    ),
    bill.execute(
      `SELECT * FROM message_billing_ledger ORDER BY billed_at DESC LIMIT 25`
    ),
  ]);

  const cfg = (cfgRes.rows[0] || {}) as Record<string, unknown>;
  const clientMarketingRateInr = Number(cfg.client_marketing_rate_inr ?? 0.95);
  const clientOtherRateInr = Number(cfg.client_other_rate_inr ?? 0.3);

  const byCategory = summaryRes.rows.map((r) => {
    const base = {
      category: String(r.category),
      messageCount: Number(r.messageCount ?? 0),
      unitRateInr:
        String(r.category) === "MARKETING" ? clientMarketingRateInr : clientOtherRateInr,
      totalBilledInr: Number(Number(r.totalClientBilled ?? 0).toFixed(2)),
    };
    if (!isDev) return base;
    return {
      ...base,
      actualMetaCostInr: Number(Number(r.totalActualMetaCost ?? 0).toFixed(4)),
      netMarginInr: Number(Number(r.totalMargin ?? 0).toFixed(4)),
    };
  });

  const totalMessages = byCategory.reduce((acc, x) => acc + x.messageCount, 0);
  const totalClientBilledInr = Number(
    byCategory.reduce((acc, x) => acc + x.totalBilledInr, 0).toFixed(2)
  );

  const recentEntries = recentRes.rows.map((r) => {
    const base = {
      id: String(r.id),
      customerPhone: String(r.customer_phone),
      category: String(r.category),
      clientUnitRateInr: Number(r.client_unit_rate_inr ?? 0),
      staffName: String(r.staff_name),
      billedAt: String(r.billed_at),
    };
    if (!isDev) return base;
    return {
      ...base,
      actualMetaUnitCostInr: Number(r.actual_meta_unit_cost_inr ?? 0),
      marginInr: Number(r.margin_inr ?? 0),
    };
  });

  if (!isDev) {
    // Zero actual Meta wholesale rates or margins ever leave the server for non-DEV roles!
    return NextResponse.json({
      ok: true,
      viewMode: "client_set_pricing",
      currency: "INR",
      rates: {
        marketingRateInr: clientMarketingRateInr,
        otherMessagesRateInr: clientOtherRateInr,
      },
      totals: {
        totalMessages,
        totalBilledInr: totalClientBilledInr,
      },
      byCategory,
      recentEntries,
    });
  }

  const totalActualMetaCostInr = Number(
    summaryRes.rows
      .reduce((acc, r) => acc + Number(r.totalActualMetaCost ?? 0), 0)
      .toFixed(4)
  );
  const totalNetMarginInr = Number(
    (totalClientBilledInr - totalActualMetaCostInr).toFixed(4)
  );

  return NextResponse.json({
    ok: true,
    viewMode: "dev_actual_and_margin",
    currency: "INR",
    rates: {
      marketingRateInr: clientMarketingRateInr,
      otherMessagesRateInr: clientOtherRateInr,
      actualMetaMarketingRateInr: Number(cfg.actual_meta_marketing_rate_inr ?? 0.7846),
      actualMetaUtilityRateInr: Number(cfg.actual_meta_utility_rate_inr ?? 0.115),
      actualMetaAuthRateInr: Number(cfg.actual_meta_auth_rate_inr ?? 0.115),
      actualMetaServiceRateInr: Number(cfg.actual_meta_service_rate_inr ?? 0.08),
    },
    totals: {
      totalMessages,
      totalBilledInr: totalClientBilledInr,
      totalActualMetaCostInr,
      totalNetMarginInr,
      marginPercentage:
        totalClientBilledInr > 0
          ? Number(((totalNetMarginInr / totalClientBilledInr) * 100).toFixed(1))
          : 0,
    },
    byCategory,
    recentEntries,
  });
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
      user.name,
      new Date().toISOString(),
    ],
  });

  return NextResponse.json({ ok: true });
}
