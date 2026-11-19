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

export type IssuePushFn = (issue: Omit<EcosystemDetectedIssue, "id">) => void;
