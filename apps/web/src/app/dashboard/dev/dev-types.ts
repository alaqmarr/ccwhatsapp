import type { AccountStatus } from "@cc/rbac";

export interface CategoryProfitRow {
  category: string;
  messageCount: number;
  unitRateInr: number;
  totalBilledInr: number;
  metaUnitRateInr?: number;
  metaBaseCostInr?: number;
  metaGstInr?: number;
  metaWithGstInr?: number;
  aiBaseCostInr?: number;
  aiGstInr?: number;
  aiWithGstInr?: number;
  actualMetaCostInr?: number;
  netMarginExGstInr?: number;
  netMarginInr?: number;
}

export interface ProfitLedgerEntry {
  id: string;
  customerPhone: string;
  category: string;
  clientUnitRateInr: number;
  deliveryMode?: string;
  actualMetaUnitCostInr?: number;
  actualMetaUnitWithGstInr?: number;
  marginInr?: number;
  staffName: string;
  billedAt: string;
}

export interface AiCostBucketClient {
  tracesCount: number;
  billedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalUsd: number;
  baseInr: number;
  gstInr: number;
  totalWithGstInr: number;
}

export interface DevPricingPayload {
  ok: boolean;
  viewMode: "dev_actual_and_margin";
  rates: {
    marketingRateInr: number;
    otherMessagesRateInr: number;
    actualMetaMarketingRateInr: number;
    actualMetaUtilityRateInr: number;
    actualMetaAuthRateInr: number;
    actualMetaServiceRateInr: number;
    gstRatePct?: number;
    usdToInrRate?: number;
  };
  totals: {
    totalMessages: number;
    liveMessagesCount?: number;
    liveClientBilledInr?: number;
    sandboxOrSeedMessagesCount?: number;
    sandboxOrSeedBilledInr?: number;
    totalBilledInr: number;
    clientGstInr?: number;
    clientTotalInclGstInr?: number;
    totalMetaBaseInr?: number;
    totalMetaGstInr?: number;
    totalMetaWithGstInr?: number;
    totalActualCostExGstInr?: number;
    totalActualGstInr?: number;
    totalActualMetaCostInr: number;
    totalNetMarginExGstInr?: number;
    totalNetMarginInr: number;
    totalEcosystemCostWithGstInr?: number;
    marginPercentage: number;
  };
  aiCosts?: {
    usdToInrRate: number;
    gstRatePct: number;
    whatsappHub: AiCostBucketClient;
    websitesOnly: AiCostBucketClient;
    classicConcepts: AiCostBucketClient;
    classicEdge53: AiCostBucketClient;
    allEcosystem: AiCostBucketClient;
  };
  byCategory: CategoryProfitRow[];
  recentEntries: ProfitLedgerEntry[];
}

export interface DevAnalyticsSlice {
  range: string;
  kpis: {
    totalConversations: number;
    inboundMessagesCount: number;
    outboundMessagesCount: number;
    freeStaffRepliesCount: number;
    acrioRepliesCount: number;
    templateMessagesCount: number;
    outboundDeliveryRatePct: number;
    outboundReadRatePct: number;
    aiTokensIn?: number;
    aiTokensOut?: number;
    aiTokensTotal?: number;
    aiCacheReadTokens?: number;
    aiLiveCallsCount?: number;
    clientBilledInr?: number;
    metaWholesaleBaseInr?: number;
    metaWholesaleGstInr?: number;
    metaWholesaleWithGstInr?: number;
    whatsappAiCostWithGstInr?: number;
    ecosystemAiCostWithGstInr?: number;
    actualMetaCostInr?: number;
    netMarginInr?: number;
  };
  aiTokenSummary?: {
    periodTokensIn: number;
    periodTokensOut: number;
    periodTokensTotal: number;
    periodCacheReadTokens: number;
    periodCacheWriteTokens?: number;
    periodLiveAiCalls: number;
    periodAiCosts?: {
      whatsappHub: AiCostBucketClient;
      websitesOnly: AiCostBucketClient;
      allEcosystem: AiCostBucketClient;
    };
    allTimeTokensIn: number;
    allTimeTokensOut: number;
    allTimeTokensTotal: number;
  };
}

export interface StaffMemberRecord {
  id: string;
  name: string;
  email: string;
  whatsappNumber: string;
  role: string;
  status: AccountStatus;
  createdAt: string;
}

export interface DbDiag {
  domain: string;
  fileName: string;
  description: string;
  sizeBytes: number;
  tablesCount: number;
  totalRows: number;
}

export interface BackupLog {
  id: string;
  startedAt: string;
  completedAt: string;
  triggerSource: string;
  status: string;
  databasesCount: number;
  totalBytes: number;
  localFolderPath: string;
  googleDriveFileId: string | null;
  googleDriveLink: string | null;
  detailsMessage: string;
}

export interface BackupConfigData {
  enabled: boolean;
  midnightHourIst: number;
  midnightMinuteIst: number;
  googleDriveFolderId: string;
  googleServiceAccountEmail: string;
  hasPrivateKey: boolean;
  googleClientId: string;
  hasOauthRefreshToken: boolean;
  retentionDays: number;
  includeMainWebsiteDb: boolean;
}

export interface DevClientInitialData {
  pricing: DevPricingPayload;
  analytics: DevAnalyticsSlice | null;
  devAccounts: StaffMemberRecord[];
  databases: DbDiag[];
  backupLogs: BackupLog[];
  backupConfig?: BackupConfigData;
}

export function friendlyCategoryName(cat: string): string {
  switch (cat) {
    case "MARKETING":
      return "Marketing & Offer Templates";
    case "UTILITY":
      return "Order & Delivery Templates";
    case "AUTHENTICATION":
      return "Verification Code Templates";
    case "ACRIO":
      return "ACRIO Automated Replies";
    default:
      return cat;
  }
}
