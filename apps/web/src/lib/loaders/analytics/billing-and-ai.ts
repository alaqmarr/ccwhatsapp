import { computeClaudeAiCostBreakdown, readAiTraceLogs } from "@cc/database";

type DbRow = Record<string, unknown>;

export function buildBillingAndAiSummary(params: {
  ledgerAggRows: DbRow[];
  pricingCfg: DbRow;
  freeStaffRepliesCount: number;
  isDevPricing: boolean;
  cutoffIso: string;
}) {
  const {
    ledgerAggRows,
    pricingCfg,
    freeStaffRepliesCount,
    isDevPricing,
    cutoffIso,
  } = params;

  let totalClientBilledInr = 0;
  let totalActualMetaCostInr = 0;
  let totalPeriodMetaBaseInr = 0;

  const billingByCategory: Record<
    string,
    {
      count: number;
      clientBilledInr: number;
      actualMetaCostInr?: number;
      marginInr?: number;
    }
  > = {
    FREE_CHAT: {
      count: freeStaffRepliesCount,
      clientBilledInr: 0,
      ...(isDevPricing ? { actualMetaCostInr: 0, marginInr: 0 } : {}),
    },
    ACRIO: {
      count: 0,
      clientBilledInr: 0,
      ...(isDevPricing ? { actualMetaCostInr: 0, marginInr: 0 } : {}),
    },
    MARKETING: {
      count: 0,
      clientBilledInr: 0,
      ...(isDevPricing ? { actualMetaCostInr: 0, marginInr: 0 } : {}),
    },
    UTILITY: {
      count: 0,
      clientBilledInr: 0,
      ...(isDevPricing ? { actualMetaCostInr: 0, marginInr: 0 } : {}),
    },
    AUTHENTICATION: {
      count: 0,
      clientBilledInr: 0,
      ...(isDevPricing ? { actualMetaCostInr: 0, marginInr: 0 } : {}),
    },
  };

  const cfgMetaMarketing = Number(pricingCfg.actual_meta_marketing_rate_inr ?? 0.8631);
  const cfgMetaUtility = Number(pricingCfg.actual_meta_utility_rate_inr ?? 0.115);
  const cfgMetaAuth = Number(pricingCfg.actual_meta_auth_rate_inr ?? 0.115);
  const cfgMetaService = Number(pricingCfg.actual_meta_service_rate_inr ?? 0.0);
  const gstRatePct = Number(pricingCfg.gst_rate_pct ?? 18.0);
  const usdToInrRate = Number(pricingCfg.usd_to_inr_rate ?? 93.4);

  const metaRateForPeriodCat = (cat: string): number => {
    switch (cat.toUpperCase()) {
      case "MARKETING":
        return cfgMetaMarketing;
      case "UTILITY":
        return cfgMetaUtility;
      case "AUTHENTICATION":
        return cfgMetaAuth;
      case "ACRIO":
      case "SERVICE":
        return cfgMetaService;
      default:
        return cfgMetaUtility;
    }
  };

  for (const l of ledgerAggRows) {
    const cat = String(l.category || "UTILITY").toUpperCase();
    const rowCount = Number(l.row_count ?? 0);
    const clientAmt = Number(l.client_billed_sum ?? 0);
    const metaAmt = metaRateForPeriodCat(cat) * rowCount;
    const metaWithGstAmt = metaAmt * (1 + gstRatePct / 100);
    const marginAmt = clientAmt - metaWithGstAmt;

    totalClientBilledInr += clientAmt;
    totalPeriodMetaBaseInr += metaAmt;
    totalActualMetaCostInr += metaWithGstAmt;

    const bucket =
      billingByCategory[cat] ||
      (billingByCategory[cat] = {
        count: 0,
        clientBilledInr: 0,
        ...(isDevPricing ? { actualMetaCostInr: 0, marginInr: 0 } : {}),
      });
    bucket.count += rowCount;
    bucket.clientBilledInr = Number((bucket.clientBilledInr + clientAmt).toFixed(2));
    if (isDevPricing) {
      bucket.actualMetaCostInr = Number(
        ((bucket.actualMetaCostInr || 0) + metaWithGstAmt).toFixed(4)
      );
      bucket.marginInr = Number(((bucket.marginInr || 0) + marginAmt).toFixed(4));
    }
  }

  // Single AI trace log read for the selected period
  const aiLogsReport = readAiTraceLogs({
    sinceUtc: cutoffIso,
    limit: 5000,
  });
  const periodAiCosts = computeClaudeAiCostBreakdown(aiLogsReport.entries, {
    usdToInrRate,
    gstRatePct,
  });
  const aiTokensIn = periodAiCosts.allEcosystem.inputTokens;
  const aiTokensOut = periodAiCosts.allEcosystem.outputTokens;
  const aiCacheReadTokens = periodAiCosts.allEcosystem.cacheReadTokens;
  const aiCacheWriteTokens = periodAiCosts.allEcosystem.cacheWriteTokens;
  const aiLiveCallsCount = aiLogsReport.entries.filter(
    (e) => e.outcomeSource === "LIVE_AI"
  ).length;
  const aiTokensByWebsite = {
    WHATSAPP_HUB: {
      inputTokens: periodAiCosts.whatsappHub.inputTokens,
      outputTokens: periodAiCosts.whatsappHub.outputTokens,
      calls: periodAiCosts.whatsappHub.billedCalls,
    },
    CLASSIC_CONCEPTS: {
      inputTokens: periodAiCosts.classicConcepts.inputTokens,
      outputTokens: periodAiCosts.classicConcepts.outputTokens,
      calls: periodAiCosts.classicConcepts.billedCalls,
    },
    CLASSIC_EDGE_53: {
      inputTokens: periodAiCosts.classicEdge53.inputTokens,
      outputTokens: periodAiCosts.classicEdge53.outputTokens,
      calls: periodAiCosts.classicEdge53.billedCalls,
    },
  };
  const aiTokensTotal = aiTokensIn + aiTokensOut;
  const periodMetaWithGstInr = Number(totalActualMetaCostInr.toFixed(2));
  const periodMetaGstInr = Number(
    (totalPeriodMetaBaseInr * (gstRatePct / 100)).toFixed(2)
  );
  const periodCombinedCostWithGstInr = Number(
    (periodMetaWithGstInr + periodAiCosts.whatsappHub.totalWithGstInr).toFixed(2)
  );
  const periodNetProfitWithGstInr = Number(
    (totalClientBilledInr - periodCombinedCostWithGstInr).toFixed(2)
  );

  if (isDevPricing && billingByCategory.ACRIO) {
    billingByCategory.ACRIO.actualMetaCostInr = Number(
      (
        (billingByCategory.ACRIO.actualMetaCostInr || 0) +
        periodAiCosts.whatsappHub.totalWithGstInr
      ).toFixed(2)
    );
    billingByCategory.ACRIO.marginInr = Number(
      (
        billingByCategory.ACRIO.clientBilledInr -
        billingByCategory.ACRIO.actualMetaCostInr
      ).toFixed(2)
    );
  }

  return {
    billingByCategory,
    totalClientBilledInr,
    totalPeriodMetaBaseInr,
    periodMetaGstInr,
    periodMetaWithGstInr,
    periodCombinedCostWithGstInr,
    periodNetProfitWithGstInr,
    periodAiCosts,
    aiTokensIn,
    aiTokensOut,
    aiTokensTotal,
    aiCacheReadTokens,
    aiCacheWriteTokens,
    aiLiveCallsCount,
    aiLogsReport,
    aiTokensByWebsite,
  };
}
