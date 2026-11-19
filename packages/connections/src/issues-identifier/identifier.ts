import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolveSharedAnthropicApiKey,
  type MainWebsiteProduct,
} from "@cc/database";
import { invalidateWhatsAppCacheTags } from "@cc/storage";
import {
  LOCKED_CLAUDE_MODEL,
  callClaudeHaikuMessagesDetailed,
  recordAndBroadcastAiLog,
  formatWhatsAppOutboundText,
} from "@cc/connections/initialise.acrio.ai";
import { getCachedEcosystemCatalog } from "@cc/connections/helpers.acrio.ai";
import {
  scanClassicConceptsProducts,
  scanClassicEdgeItems,
  scanShortlinksAndCrossSite,
  scanTemplatesAndAiLogs,
} from "./scanners";
import type {
  EcosystemDetectedIssue,
  EcosystemIssuesAuditReport,
  EcosystemIssueSeverity,
  EcosystemSiteHealthSummary,
  EcosystemSiteKey,
} from "./types";

export async function runAcrioEcosystemIssuesIdentifier(options?: {
  askPrompt?: string;
  forceFreshCatalog?: boolean;
  actorName?: string;
}): Promise<EcosystemIssuesAuditReport> {
  const started = Date.now();
  await ensureDatabasesBootstrapped();

  if (options?.forceFreshCatalog) {
    await invalidateWhatsAppCacheTags(["cc-products", "ce53-machines"]);
  }

  const conv = getRawLibSqlClient("conversations");
  const mkt = getRawLibSqlClient("marketing");

  const [catalog, linksRes, templatesRes] = await Promise.all([
    getCachedEcosystemCatalog(),
    conv.execute(
      `SELECT code, title, target_url, product_slug, link_type FROM custom_links ORDER BY created_at DESC`
    ),
    mkt.execute(
      `SELECT name, approval_status, rejection_reason, cta_url FROM templates ORDER BY created_at DESC`
    ),
  ]);

  const ccProducts = catalog.classicConceptsProducts;
  const ceItems = catalog.classicEdgeItems;
  const allItems = catalog.allItems;
  const linkRows = linksRes.rows as Record<string, unknown>[];
  const templateRows = templatesRes.rows as Record<string, unknown>[];

  const issues: EcosystemDetectedIssue[] = [];
  let seq = 1;
  const pushIssue = (issue: Omit<EcosystemDetectedIssue, "id">): void => {
    issues.push({ id: `iss_${seq++}`, ...issue });
  };

  const allSlugsSet = new Set<string>();
  const skuMap = new Map<string, MainWebsiteProduct[]>();
  for (const it of allItems) {
    const sl = (it.slug || "").toLowerCase();
    if (sl) {
      allSlugsSet.add(sl);
      allSlugsSet.add(`cc:product:${sl}`);
      allSlugsSet.add(`ce53:machine:${sl}`);
      allSlugsSet.add(`ce53:consumable:${sl}`);
      allSlugsSet.add(`ce53:product:${sl}`);
    }
    if (it.sku) {
      const k = it.sku.trim().toUpperCase();
      const arr = skuMap.get(k) || [];
      arr.push(it);
      skuMap.set(k, arr);
    }
  }

  scanShortlinksAndCrossSite(linkRows, allSlugsSet, pushIssue);
  scanClassicConceptsProducts(ccProducts, skuMap, pushIssue);
  scanClassicEdgeItems(ceItems, pushIssue);
  const recentLogsCount = scanTemplatesAndAiLogs(templateRows, pushIssue);

  const sevRank: Record<EcosystemIssueSeverity, number> = {
    CRITICAL: 0,
    WARNING: 1,
    INFO: 2,
  };
  issues.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

  const criticalCount = issues.filter((i) => i.severity === "CRITICAL").length;
  const warningCount = issues.filter((i) => i.severity === "WARNING").length;
  const infoCount = issues.filter((i) => i.severity === "INFO").length;

  const healthScore = Math.max(
    0,
    Math.min(100, Math.round(100 - criticalCount * 8 - warningCount * 1.5 - infoCount * 0.25))
  );

  const buildSiteSummary = (
    site: EcosystemSiteKey,
    label: string,
    publicDomain: string,
    totalItemsScanned: number,
    online: boolean
  ): EcosystemSiteHealthSummary => {
    const siteIssues = issues.filter((i) => i.site === site);
    const crit = siteIssues.filter((i) => i.severity === "CRITICAL").length;
    const warn = siteIssues.filter((i) => i.severity === "WARNING").length;
    const inf = siteIssues.filter((i) => i.severity === "INFO").length;
    return {
      site,
      label,
      publicDomain,
      online,
      totalItemsScanned,
      criticalCount: crit,
      warningCount: warn,
      infoCount: inf,
      statusNote:
        crit > 0
          ? `${crit} critical issue(s) need attention`
          : warn > 0
          ? `${warn} warning(s) detected`
          : "All checks healthy",
    };
  };

  const siteSummaries: EcosystemSiteHealthSummary[] = [
    buildSiteSummary(
      "CLASSIC_CONCEPTS",
      "Classic Concepts Main Site",
      "classicconcepts.in",
      ccProducts.length,
      ccProducts.length > 0
    ),
    buildSiteSummary(
      "CLASSIC_EDGE_53",
      "Classic Edge 53 Machines & Tools",
      "classicedge.in",
      ceItems.length,
      ceItems.length > 0
    ),
    buildSiteSummary(
      "SHORTLINK_ROUTER",
      "Shortlink & Cross-Site Router",
      "ccapl.cc",
      linkRows.length,
      true
    ),
    buildSiteSummary(
      "WHATSAPP_HUB",
      "WhatsApp Hub & ACRIO Concierge",
      "chat.ccapl.cc",
      templateRows.length + recentLogsCount,
      true
    ),
  ];

  let acrioAnalysis: string | null = null;
  let acrioModel: string | null = null;
  if (options?.askPrompt && options.askPrompt.trim()) {
    const { apiKey } = await resolveSharedAnthropicApiKey("admin");
    if (apiKey) {
      const topIssuesDigest = issues
        .slice(0, 60)
        .map(
          (i, idx) =>
            `${idx + 1}. [${i.severity} | ${i.site} | ${i.category}] ${i.title} - ${i.detail} (Entity: ${i.affectedEntity})`
        )
        .join("\n");

      const aiRes = await callClaudeHaikuMessagesDetailed({
        apiKey,
        effort: "medium",
        maxTokens: 2500,
        timeoutMs: 22000,
        system: `You are ACRIO Issues Identifier (Dev Mode), the ecosystem diagnostics and quality-assurance assistant for Classic Concepts (classicconcepts.in), Classic Edge 53 (classicedge.in), WhatsApp Hub (chat.ccapl.cc), and the ccapl.cc shortlink router.
Follow all Classic Concepts plain-language rules: write in clear, direct everyday English with zero em-dashes and zero robotic filler.
Group your findings clearly with bullet points, exact SKU/slug/shortlink names, and concrete steps to fix each discrepancy.`,
        messages: [
          {
            role: "user",
            content: `Live Ecosystem Audit Summary:
- Health Score: ${healthScore}/100
- Classic Concepts Products Scanned: ${ccProducts.length}
- Classic Edge 53 Items Scanned: ${ceItems.length}
- ccapl.cc Shortlinks Scanned: ${linkRows.length}
- WhatsApp Templates Scanned: ${templateRows.length}
- Total Issues Found: ${issues.length} (Critical: ${criticalCount}, Warning: ${warningCount}, Info: ${infoCount})

Detected Discrepancies & Issues (Top ${Math.min(60, issues.length)}):
${topIssuesDigest || "None"}

Developer Question / Audit Focus:
${options.askPrompt.trim()}`,
          },
        ],
      });

      if (aiRes.ok && aiRes.text) {
        acrioAnalysis = formatWhatsAppOutboundText(aiRes.text);
        acrioModel = LOCKED_CLAUDE_MODEL;
        recordAndBroadcastAiLog({
          website: "WHATSAPP_HUB",
          websiteLabel: "Classic Concepts WhatsApp Hub",
          feature: "ACRIO Dev Issues Identifier",
          actor: options.actorName || "DEV",
          question: options.askPrompt.trim(),
          model: LOCKED_CLAUDE_MODEL,
          effort: "medium",
          outcomeSource: "LIVE_AI",
          responseCacheStatus: "BYPASS",
          catalogCacheStatus: catalog.cacheMeta.catalogCacheStatus,
          cacheDetails: `Ecosystem Audit (${issues.length} issues detected across ${allItems.length} items)`,
          productLookupTriggered: true,
          productLookupQuery: options.askPrompt.trim(),
          productLookupBudget: null,
          productLookupTotalScanned: allItems.length,
          productsLookedUp: [],
          steps: [
            {
              stepNumber: 1,
              label: "Scanned ecosystem databases, R2 media, and ccapl.cc shortlinks",
              detail: `cc=${ccProducts.length}, ce53=${ceItems.length}, links=${linkRows.length}, issues=${issues.length}`,
              durationMs: Date.now() - started,
              status: "OK",
            },
          ],
          response: acrioAnalysis,
          durationMs: Date.now() - started,
          tokenUsage: aiRes.usage,
        });
      }
    }
  }

  return {
    scannedAtIso: new Date().toISOString(),
    scannedAtIst: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST",
    durationMs: Date.now() - started,
    healthScore,
    totals: {
      totalIssues: issues.length,
      critical: criticalCount,
      warning: warningCount,
      info: infoCount,
      classicConceptsProducts: ccProducts.length,
      classicEdgeItems: ceItems.length,
      shortLinksCount: linkRows.length,
      templatesCount: templateRows.length,
      recentAiLogsScanned: recentLogsCount,
    },
    siteSummaries,
    issues,
    acrioAnalysis,
    acrioModel,
  };
}
