import type { AuthenticatedUser } from "@cc/auth";
import {
  computeClaudeAiCostBreakdown,
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  readAiTraceLogs,
} from "@cc/database";
import { isDevRole } from "@cc/rbac";

export async function loadPricingPayload(
  user: AuthenticatedUser,
  requestedScope?: string | null
) {
  if (isDevRole(user.role) && requestedScope === "dev") {
    return loadDevPricingPayload();
  }
  return loadCostBreakdownPayload(user);
}

export async function loadCostBreakdownPayload(user: AuthenticatedUser) {
  await ensureDatabasesBootstrapped();
  const bill = getRawLibSqlClient("billing_ops");

  const [cfgRes, summaryRes, recentRes] = await Promise.all([
    bill.execute(`SELECT * FROM pricing_config WHERE id = 'default' LIMIT 1`),
    bill.execute(
      `SELECT
         category,
         COUNT(*) as messageCount,
         SUM(client_unit_rate_inr) as totalClientBilled
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

  const byCategory = summaryRes.rows.map((r) => ({
    category: String(r.category),
    messageCount: Number(r.messageCount ?? 0),
    unitRateInr:
      String(r.category) === "MARKETING" ? clientMarketingRateInr : clientOtherRateInr,
    totalBilledInr: Number(Number(r.totalClientBilled ?? 0).toFixed(2)),
  }));

  const totalMessages = byCategory.reduce((acc, x) => acc + x.messageCount, 0);
  const totalClientBilledInr = Number(
    byCategory.reduce((acc, x) => acc + x.totalBilledInr, 0).toFixed(2)
  );

  const recentEntries = recentRes.rows.map((r) => ({
    id: String(r.id),
    customerPhone: String(r.customer_phone),
    category: String(r.category),
    clientUnitRateInr: Number(r.client_unit_rate_inr ?? 0),
    staffName: String(r.staff_name),
    billedAt: String(r.billed_at),
  }));

  return {
    ok: true as const,
    viewMode: "client_set_pricing" as const,
    viewerIsDev: isDevRole(user.role),
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
  };
}

export async function loadDevPricingPayload() {
  await ensureDatabasesBootstrapped();
  const bill = getRawLibSqlClient("billing_ops");

  const [cfgRes, summaryRes, modeSummaryRes, recentRes] = await Promise.all([
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
      `SELECT
         COALESCE(delivery_mode, 'LIVE_META_CLOUD') as deliveryMode,
         COUNT(*) as cnt,
         SUM(client_unit_rate_inr) as billed
       FROM message_billing_ledger
       GROUP BY COALESCE(delivery_mode, 'LIVE_META_CLOUD')`
    ),
    bill.execute(
      `SELECT * FROM message_billing_ledger ORDER BY billed_at DESC LIMIT 25`
    ),
  ]);

  const cfg = (cfgRes.rows[0] || {}) as Record<string, unknown>;
  const clientMarketingRateInr = Number(cfg.client_marketing_rate_inr ?? 0.95);
  const clientOtherRateInr = Number(cfg.client_other_rate_inr ?? 0.3);
  const actualMetaMarketingRateInr = Number(cfg.actual_meta_marketing_rate_inr ?? 0.8631);
  const actualMetaUtilityRateInr = Number(cfg.actual_meta_utility_rate_inr ?? 0.115);
  const actualMetaAuthRateInr = Number(cfg.actual_meta_auth_rate_inr ?? 0.115);
  const actualMetaServiceRateInr = Number(cfg.actual_meta_service_rate_inr ?? 0.0);
  const gstRatePct = Number(cfg.gst_rate_pct ?? 18.0);
  const usdToInrRate = Number(cfg.usd_to_inr_rate ?? 93.4);
  const gstMultiplier = 1 + gstRatePct / 100;

  const aiReport = readAiTraceLogs({ limit: 5000 });
  const aiCosts = computeClaudeAiCostBreakdown(aiReport.entries, {
    usdToInrRate,
    gstRatePct,
  });

  const metaRateForCategory = (cat: string): number => {
    switch (String(cat || "").toUpperCase()) {
      case "MARKETING":
        return actualMetaMarketingRateInr;
      case "UTILITY":
        return actualMetaUtilityRateInr;
      case "AUTHENTICATION":
        return actualMetaAuthRateInr;
      case "ACRIO":
      case "SERVICE":
        return actualMetaServiceRateInr;
      default:
        return actualMetaUtilityRateInr;
    }
  };

  let metaBaseTotal = 0;
  let metaGstTotal = 0;

  const byCategory = summaryRes.rows.map((r) => {
    const category = String(r.category);
    const messageCount = Number(r.messageCount ?? 0);
    const clientRate =
      category === "MARKETING" ? clientMarketingRateInr : clientOtherRateInr;
    const totalBilledInr = Number(Number(r.totalClientBilled ?? 0).toFixed(2));
    const metaUnitBase = metaRateForCategory(category);
    const metaBaseInr = Number((messageCount * metaUnitBase).toFixed(4));
    const metaGstInr = Number((metaBaseInr * (gstRatePct / 100)).toFixed(4));
    const metaWithGstInr = Number((metaBaseInr + metaGstInr).toFixed(4));

    metaBaseTotal += metaBaseInr;
    metaGstTotal += metaGstInr;

    const aiBaseInr = category === "ACRIO" ? aiCosts.whatsappHub.baseInr : 0;
    const aiGstInr = category === "ACRIO" ? aiCosts.whatsappHub.gstInr : 0;
    const aiWithGstInr = category === "ACRIO" ? aiCosts.whatsappHub.totalWithGstInr : 0;

    const actualCombinedBaseInr = Number((metaBaseInr + aiBaseInr).toFixed(2));
    const actualCombinedWithGstInr = Number((metaWithGstInr + aiWithGstInr).toFixed(2));
    const netMarginExGstInr = Number((totalBilledInr - actualCombinedBaseInr).toFixed(2));
    const netMarginWithGstInr = Number((totalBilledInr - actualCombinedWithGstInr).toFixed(2));

    return {
      category,
      messageCount,
      unitRateInr: clientRate,
      totalBilledInr,
      metaUnitRateInr: metaUnitBase,
      metaBaseCostInr: metaBaseInr,
      metaGstInr,
      metaWithGstInr,
      aiBaseCostInr: aiBaseInr,
      aiGstInr,
      aiWithGstInr,
      actualMetaCostInr: actualCombinedWithGstInr,
      netMarginExGstInr,
      netMarginInr: netMarginWithGstInr,
    };
  });

  const totalMessages = byCategory.reduce((acc, x) => acc + x.messageCount, 0);
  const totalClientBilledInr = Number(
    byCategory.reduce((acc, x) => acc + x.totalBilledInr, 0).toFixed(2)
  );
  const clientGstInr = Number((totalClientBilledInr * (gstRatePct / 100)).toFixed(2));
  const clientTotalInclGstInr = Number((totalClientBilledInr + clientGstInr).toFixed(2));

  let liveMessagesCount = 0;
  let liveClientBilledInr = 0;
  let sandboxOrSeedMessagesCount = 0;
  let sandboxOrSeedBilledInr = 0;
  for (const mr of modeSummaryRes.rows) {
    const mode = String(mr.deliveryMode || "LIVE_META_CLOUD");
    const cnt = Number(mr.cnt ?? 0);
    const billed = Number(mr.billed ?? 0);
    if (mode === "LIVE_META_CLOUD") {
      liveMessagesCount += cnt;
      liveClientBilledInr += billed;
    } else {
      sandboxOrSeedMessagesCount += cnt;
      sandboxOrSeedBilledInr += billed;
    }
  }

  const recentEntries = recentRes.rows.map((r) => {
    const category = String(r.category);
    const clientRate = Number(r.client_unit_rate_inr ?? 0);
    const unitMetaBase = metaRateForCategory(category);
    const unitMetaWithGst = Number((unitMetaBase * gstMultiplier).toFixed(4));
    return {
      id: String(r.id),
      customerPhone: String(r.customer_phone),
      category,
      clientUnitRateInr: clientRate,
      staffName: String(r.staff_name),
      billedAt: String(r.billed_at),
      deliveryMode: String(r.delivery_mode || "LIVE_META_CLOUD"),
      actualMetaUnitCostInr: unitMetaBase,
      actualMetaUnitWithGstInr: unitMetaWithGst,
      marginInr: Number((clientRate - unitMetaWithGst).toFixed(4)),
    };
  });

  const totalMetaBaseInr = Number(metaBaseTotal.toFixed(2));
  const totalMetaGstInr = Number(metaGstTotal.toFixed(2));
  const totalMetaWithGstInr = Number((totalMetaBaseInr + totalMetaGstInr).toFixed(2));

  const totalActualCostExGstInr = Number(
    (totalMetaBaseInr + aiCosts.whatsappHub.baseInr).toFixed(2)
  );
  const totalActualGstInr = Number(
    (totalMetaGstInr + aiCosts.whatsappHub.gstInr).toFixed(2)
  );
  const totalActualMetaCostInr = Number(
    (totalMetaWithGstInr + aiCosts.whatsappHub.totalWithGstInr).toFixed(2)
  );
  const totalNetMarginExGstInr = Number(
    (totalClientBilledInr - totalActualCostExGstInr).toFixed(2)
  );
  const totalNetMarginInr = Number(
    (totalClientBilledInr - totalActualMetaCostInr).toFixed(2)
  );
  const totalEcosystemCostWithGstInr = Number(
    (totalMetaWithGstInr + aiCosts.allEcosystem.totalWithGstInr).toFixed(2)
  );

  return {
    ok: true as const,
    viewMode: "dev_actual_and_margin" as const,
    currency: "INR",
    rates: {
      marketingRateInr: clientMarketingRateInr,
      otherMessagesRateInr: clientOtherRateInr,
      actualMetaMarketingRateInr,
      actualMetaUtilityRateInr,
      actualMetaAuthRateInr,
      actualMetaServiceRateInr,
      gstRatePct,
      usdToInrRate,
    },
    totals: {
      totalMessages,
      liveMessagesCount,
      liveClientBilledInr: Number(liveClientBilledInr.toFixed(2)),
      sandboxOrSeedMessagesCount,
      sandboxOrSeedBilledInr: Number(sandboxOrSeedBilledInr.toFixed(2)),
      totalBilledInr: totalClientBilledInr,
      clientGstInr,
      clientTotalInclGstInr,
      totalMetaBaseInr,
      totalMetaGstInr,
      totalMetaWithGstInr,
      totalActualCostExGstInr,
      totalActualGstInr,
      totalActualMetaCostInr,
      totalNetMarginExGstInr,
      totalNetMarginInr,
      totalEcosystemCostWithGstInr,
      marginPercentage:
        totalClientBilledInr > 0
          ? Number(((totalNetMarginInr / totalClientBilledInr) * 100).toFixed(1))
          : 0,
    },
    aiCosts,
    byCategory,
    recentEntries,
  };
}
