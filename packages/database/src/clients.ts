export * from "./clients/env-config";
export * from "./clients/contacts-sync";
export * from "./clients/short-links";
export * from "./clients/catalog-loader-cc";
export * from "./clients/catalog-loader-ce";
export * from "./clients/catalog-search";
export * from "./clients/ecosystem-bridge";
export * from "./clients/website-enquiries-fetch";
export * from "./clients/enquiries-sync";
export * from "./clients/ai-keys-and-backups";
export * from "./clients/product-context";
export * from "./clients/project-planner";
export * from "./clients/catalog-directory";
export * from "./clients/operational-context";
export * from "./clients/staff-routing";
export * from "./clients/ai-training";
export * from "./clients/company-docs";
export * from "./clients/ecosystem-docs";
export * from "./clients/call-dispatch";

export {
  authDb,
  billingDb,
  contactsDb,
  conversationsDb,
  crmDb,
  getDrizzleDb,
  getNativeSqliteDb,
  getRawLibSqlClient,
  marketingDb,
  queueDb,
  runImmediateTransaction,
} from "./clients/handles";

export {
  cleanDisplayProductName,
  normalizeCatalogHtmlToText,
  normalizePublicEcosystemUrl,
  type EcosystemModelItem,
  type EcosystemSearchOptions,
  type EcosystemSpecItem,
  type EcosystemVariantItem,
  type MainWebsiteEnquiry,
  type MainWebsiteProduct,
} from "./clients/catalog-types";

export {
  countCoreNounMatches,
  extractBudgetConstraintsFromQuery,
  extractCompactDimensionPairsFromText,
  extractCustomerCoreNouns,
  extractExplicitProductOrModelCodes,
  rankItemsByCustomerCoreNouns,
} from "./clients/catalog-search-helpers";

export {
  SHIPPING_PROVIDERS,
  buildProviderTrackingUrl,
  deleteOrderTracking,
  inferOrderBrand,
  listOrderTrackings,
  normalizeOrderLookupKey,
  sanitizeOrderDisplayId,
  upsertOrderTracking,
  type OrderBrand,
  type OrderTrackingRecord,
  type ShipmentStatus,
} from "./clients/orders-tracking";

export {
  getVerifiedLiveBrandAndTeamInfo,
  type ClassicConceptsTeamMemberInfo,
  type VerifiedGoogleMapsDetails,
} from "./clients/brand-team-info";
