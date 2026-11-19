export type EcosystemIssueSeverity = "CRITICAL" | "WARNING" | "INFO";
export type EcosystemIssueCategory =
  | "SHORTLINKS_AND_CROSS_SITE"
  | "PRODUCT_MEDIA_AND_R2"
  | "PRICING_AND_SPECS"
  | "AI_LOGS_AND_BRIDGES"
  | "TEMPLATES_AND_CONTENT";
export type EcosystemSiteKey =
  | "CLASSIC_CONCEPTS"
  | "CLASSIC_EDGE_53"
  | "WHATSAPP_HUB"
  | "SHORTLINK_ROUTER";

export interface EcosystemDetectedIssue {
  id: string;
  severity: EcosystemIssueSeverity;
  category: EcosystemIssueCategory;
  site: EcosystemSiteKey;
  title: string;
  detail: string;
  affectedEntity: string;
  skuOrCode?: string | null;
  sourceUrl?: string | null;
  targetUrl?: string | null;
  adminEditUrl?: string | null;
  autoFixAction?: "SYNC_SHORTLINKS" | "REFRESH_CATALOG_CACHE" | null;
  suggestion: string;
}

export interface EcosystemSiteHealthSummary {
  site: EcosystemSiteKey;
  label: string;
  publicDomain: string;
  online: boolean;
  totalItemsScanned: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  statusNote: string;
}

export interface EcosystemIssuesAuditReport {
  scannedAtIso: string;
  scannedAtIst: string;
  durationMs: number;
  healthScore: number;
  totals: {
    totalIssues: number;
    critical: number;
    warning: number;
    info: number;
    classicConceptsProducts: number;
    classicEdgeItems: number;
    shortLinksCount: number;
    templatesCount: number;
    recentAiLogsScanned: number;
  };
  siteSummaries: EcosystemSiteHealthSummary[];
  issues: EcosystemDetectedIssue[];
  acrioAnalysis?: string | null;
  acrioModel?: string | null;
}

export const QUICK_DIAGNOSTIC_PROMPTS = [
  "Identify all broken or missing shortlinks and cross-site link discrepancies between classicconcepts.in, classicedge.in, and ccapl.cc",
  "List all products and colour variants missing R2 photos or sharing duplicate variant images",
  "Audit all Acrylic Podiums for missing Height/Top dimensions, missing sub-categories, or pricing discrepancies",
  "Review recent ai.logs zero-match customer queries and suggest catalog keywords or synonyms to add",
];

export function severityBadgeStyle(sev: EcosystemIssueSeverity): string {
  switch (sev) {
    case "CRITICAL":
      return "bg-red-50 text-red-700 border-red-200";
    case "WARNING":
      return "bg-amber-50 text-amber-800 border-amber-200";
    default:
      return "bg-sky-50 text-sky-800 border-sky-200";
  }
}

export function siteBadgeStyle(site: EcosystemSiteKey): string {
  switch (site) {
    case "CLASSIC_CONCEPTS":
      return "bg-blue-50 text-blue-800 border-blue-200";
    case "CLASSIC_EDGE_53":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "SHORTLINK_ROUTER":
      return "bg-purple-50 text-purple-800 border-purple-200";
    default:
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
  }
}

export function categoryLabel(cat: EcosystemIssueCategory): string {
  switch (cat) {
    case "SHORTLINKS_AND_CROSS_SITE":
      return "Links & Cross-Site";
    case "PRODUCT_MEDIA_AND_R2":
      return "Media & R2 Storage";
    case "PRICING_AND_SPECS":
      return "Pricing, SKUs & Specs";
    case "AI_LOGS_AND_BRIDGES":
      return "AI Logs & Bridges";
    case "TEMPLATES_AND_CONTENT":
      return "Templates & Content";
    default:
      return cat;
  }
}
