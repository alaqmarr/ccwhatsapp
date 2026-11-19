import type { CustomerImageAnalysis } from "@cc/connections/image-intelligence";

export interface AcrioRecommendedItem {
  name: string;
  slug: string;
  sku: string | null;
  priceInr: number | null;
  url: string;
  shortCode?: string | null;
  shortUrl?: string | null;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  brandLabel: string;
  itemType: "PRODUCT" | "MACHINE" | "CONSUMABLE";
  modelsSummary?: string | null;
}

export interface AcrioChatCopilotResult {
  engineLabel: string;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL" | "LOW";
  suggestedReplies: string[];
  recommendedProducts: AcrioRecommendedItem[];
  resolutionDraft: string;
}

export interface CatalogCacheMeta {
  ccCacheTier: string;
  ce53CacheTier: string;
  catalogCacheStatus: "HIT" | "MISS" | "BYPASS";
  cacheSummary: string;
}

export type AcrioTurnIntent =
  | "GREETING"
  | "IDENTITY_META"
  | "COMPANY_INFO"
  | "LEADERSHIP_CONTACT_INFO"
  | "CHAT_HISTORY_META"
  | "MENU_SELECTION"
  | "CATEGORY_OVERVIEW"
  | "MULTI_ITEM_PROJECT"
  | "CONVERSATIONAL_FOLLOWUP"
  | "TOPIC_RESET"
  | "HUMAN_HANDOFF_INFO"
  | "HUMAN_HANDOFF_REQUEST"
  | "SUPPORT_ISSUE"
  | "ORDER_STATUS"
  | "OFF_TOPIC"
  | "PRODUCT_SEARCH"
  | "FOLLOW_UP_REFINEMENT"
  | "PRODUCT_COMPARISON"
  | "CUSTOM_QUOTE";

export interface AcrioIntentClassification {
  intent: AcrioTurnIntent;
  requiresProductLookup: boolean;
  allowRollingContextFallback: boolean;
  needsImmediateHandoff: boolean;
  reason: string;
}

export interface AcrioCustomerProfileInfo {
  customerProfile:
    | "SIMPLE_LAYMAN"
    | "STUDENT_EXPLORER"
    | "EVERYDAY_BUYER"
    | "BUSINESS_INSTITUTIONAL"
    | "TECHNICAL_GRADUATE";
  languageMode: "ENGLISH" | "HINDI_HINGLISH" | "OTHER_FALLBACK";
  instructionNote: string;
}

export interface AcrioConversationState {
  activeBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | "BOTH" | null;
  activeCategory: string | null;
  productFamily: string | null;
  primaryProductQuery: string | null;
  itemTypeFilter: "PRODUCT" | "MACHINE" | "CONSUMABLE" | null;
  excludedItemTypes: ("PRODUCT" | "MACHINE" | "CONSUMABLE")[];
  minPrice: number | null;
  maxPrice: number | null;
  hidePrices?: boolean;
  preferCheapest?: boolean;
  preferences: string[];
  applicationContext: string | null;
  dimensionsOrThickness: string | null;
  quantity: string | null;
  shownProductSlugs?: string[];
  lastMenuOptions?: string[];
  /** Slug of the single product the customer is currently talking about ("this model", "it", "the white one"). */
  focusProductSlug?: string | null;
  /** Slugs shown in the last "View options" list, in order, so "the second one" still works after it. */
  lastListedSlugs?: string[];
  askedQuestionsLog?: string[];
  customerProfile?: string;
  languageMode?: string;
  lastRecommendedProducts: {
    id: string;
    name: string;
    slug: string;
    priceInr: number | null;
    shortUrl: string | null;
    itemType?: "PRODUCT" | "MACHINE" | "CONSUMABLE";
  }[];
  /** Chronological history of distinct products/topics discussed earlier in this chat (prevents A->B->C leaks while keeping comparison context). */
  productHistory?: {
    label: string;
    slug?: string | null;
    family?: string | null;
    turnNumber: number;
  }[];
  /** Most recent image-understanding summary from an uploaded customer photo in this conversation (scoped strictly to this chat). */
  lastImageAnalysis?: CustomerImageAnalysis | null;
  /** Per-conversation cache of already-analyzed images keyed by SHA-256 to prevent duplicate Vision calls. */
  analyzedImagesBySha?: Record<string, CustomerImageAnalysis>;
  /** Rolling 1-hour counter for Vision analysis rate limiting inside this conversation. */
  imageAnalysisCountWindow?: {
    windowStartIso: string;
    count: number;
  };
  switchedThisTurn?: boolean;
  turnCount: number;
  updatedAt: string;
}

export interface AcrioMediaAttachment {
  mediaType?: "IMAGE" | "VIDEO" | "DOCUMENT";
  imageUrl: string;
  caption: string;
  fileName?: string | null;
  mimeType?: string | null;
  productName: string;
  productSlug: string;
  variantName?: string | null;
}
