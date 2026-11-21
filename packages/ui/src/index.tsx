export {
  WHATSAPP_PUBLIC_DOMAIN,
  WHATSAPP_PUBLIC_ORIGIN,
  SHORTLINK_PUBLIC_DOMAIN,
  SHORTLINK_PUBLIC_ORIGIN,
  TRACKING_PUBLIC_DOMAIN,
  TRACKING_PUBLIC_ORIGIN,
  TRACKING_SECONDARY_DOMAIN,
  type ShippingProviderOption,
  SHIPPING_PROVIDER_OPTIONS,
} from "./domain-constants";

export {
  formatShortLinkUrl,
  buildClientProviderTrackingUrl,
  type WhatsAppDeliveryStage,
  normalizeWhatsAppDeliveryStatus,
} from "./helpers";

export {
  type FriendlyWhatsAppError,
  explainMetaWhatsAppError,
} from "./whatsapp-error-help";

export {
  WhatsAppLogoIcon,
  ClassicConceptsMark,
  ClassicConceptsWordmark,
  CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE,
} from "./brand";

export {
  RoleBadge,
  AccountStatusBadge,
  MetricStatCard,
  SkeletonBlock,
  StatCardsSkeleton,
  CardListSkeleton,
  TableRowsSkeleton,
  ChatThreadListSkeleton,
  ChatMessagesSkeleton,
  RightDrawerSkeleton,
  ElementErrorState,
  WhatsAppMessageTicks,
} from "./badges";

export {
  stripWhatsAppFormatting,
  WhatsAppFormattedText,
} from "./formatting";

export * from "./dates";
