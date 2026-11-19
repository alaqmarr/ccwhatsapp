export type WhatsAppHeaderType =
  | "NONE"
  | "TEXT"
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT"
  | "LOCATION";

export type WhatsAppTemplateCategory =
  | "MARKETING"
  | "UTILITY"
  | "AUTHENTICATION";

export interface WhatsAppTemplateLocation {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

export type TemplateButtonFlowActionType =
  | "NONE"
  | "AUTO_REPLY"
  | "ASSIGN_TEAM"
  | "SEND_ORDER_TRACKING"
  | "SEND_APPROVED_TEMPLATE"
  | "OPT_OUT_DND"
  | "SMART_AI_WITH_GUARD";

export interface WhatsAppTemplateButtonFlowAction {
  actionType: TemplateButtonFlowActionType;
  replyText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  teamId?: string;
  templateName?: string;
  smartCategory?: string;
  priority?: "URGENT" | "HIGH" | "NORMAL";
  aiInstruction?: string;
}

export interface WhatsAppTemplateButton {
  id: string;
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "OTP";
  text: string;
  url?: string;
  urlType?: "STATIC" | "DYNAMIC";
  exampleSuffix?: string;
  phoneNumber?: string;
  exampleCode?: string;
  otpType?: "COPY_CODE" | "ONE_TAP";
  flowAction?: WhatsAppTemplateButtonFlowAction;
}

export interface WhatsAppTemplateVariableSpec {
  index: number;
  label: string;
  sourceField:
    | "customer.firstName"
    | "customer.fullName"
    | "customer.companyName"
    | "customer.city"
    | "order.latestNumber"
    | "custom";
  sampleValue: string;
}

export interface WhatsAppTemplateDefinition {
  id?: string;
  name: string;
  language: string;
  category: WhatsAppTemplateCategory;
  headerType: WhatsAppHeaderType;
  headerText?: string | null;
  headerMediaUrl?: string | null;
  headerLocation?: WhatsAppTemplateLocation | null;
  bodyText: string;
  footerText?: string | null;
  buttons: WhatsAppTemplateButton[];
  variablesSchema: WhatsAppTemplateVariableSpec[];
  allowCategoryChange?: boolean;
  codeExpirationMinutes?: number | null;
}

export interface OutboundWhatsAppSendResult {
  ok: boolean;
  waMessageId: string;
  mode: "LIVE_META_CLOUD" | "SANDBOX_SIMULATOR";
  deliveryStatus: "SENT" | "DELIVERED" | "FAILED";
  error?: string;
  metaErrorCode?: number;
  isRateOrSpamBlock?: boolean;
}

export type AcrioInteractive =
  | {
      kind: "buttons";
      buttons: { id: string; title: string }[];
      /** Short question shown with the buttons when the main reply is too long to share one message. */
      promptText?: string;
      footer?: string;
    }
  | {
      kind: "list";
      buttonLabel: string;
      rows: { id: string; title: string; description?: string }[];
      sectionTitle?: string;
      promptText?: string;
      footer?: string;
    };

export type WhatsAppMediaAttachmentType =
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT"
  | "AUDIO";

export interface OutboundWhatsAppMediaSpec {
  type: WhatsAppMediaAttachmentType;
  url?: string;
  waMediaId?: string;
  caption?: string;
  fileName?: string;
  mimeType?: string;
}
