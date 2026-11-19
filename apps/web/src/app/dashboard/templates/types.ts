export type HeaderType =
  | "NONE"
  | "TEXT"
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT"
  | "LOCATION";

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export type ButtonFlowActionType =
  | "NONE"
  | "AUTO_REPLY"
  | "ASSIGN_TEAM"
  | "SEND_ORDER_TRACKING"
  | "SEND_APPROVED_TEMPLATE"
  | "OPT_OUT_DND"
  | "SMART_AI_WITH_GUARD";

export type TemplatePresetKey =
  | "HOSPITALITY"
  | "CE53_MACHINE"
  | "ORDER_UPDATE"
  | "PAYMENT_QUOTE"
  | "OTP_CODE"
  | "SHOWROOM_MAP";

export interface ButtonFlowAction {
  actionType: ButtonFlowActionType;
  replyText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  teamId?: string;
  templateName?: string;
  smartCategory?: string;
  priority?: "URGENT" | "HIGH" | "NORMAL";
  aiInstruction?: string;
}

export interface TemplateButton {
  id: string;
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "OTP";
  text: string;
  url?: string;
  urlType?: "STATIC" | "DYNAMIC";
  exampleSuffix?: string;
  phoneNumber?: string;
  exampleCode?: string;
  flowAction?: ButtonFlowAction;
}

export interface VariableSpec {
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

export interface LocationHeader {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

export interface TemplateRecord {
  id: string;
  name: string;
  language: string;
  category: TemplateCategory;
  headerType: HeaderType;
  headerText: string | null;
  headerMediaUrl: string | null;
  headerLocation: LocationHeader | null;
  bodyText: string;
  footerText: string | null;
  buttons: TemplateButton[];
  variablesSchema: VariableSpec[];
  allowCategoryChange: boolean;
  codeExpirationMinutes: number | null;
  approvalStatus: string;
  metaTemplateId: string | null;
  metaQualityScore: string;
  rejectionReason: string | null;
  sentCount: number;
  createdByName: string;
  updatedAt: string;
  metaPayloadPreview: Record<string, unknown>;
}

export interface ShortLinkOption {
  id: string;
  code: string;
  title: string;
  targetUrl: string;
}

export interface CatalogMediaOption {
  name: string;
  brandLabel: string;
  url: string;
  imageUrl: string;
}

export interface TemplatesInitialData {
  canManage: boolean;
  isDev: boolean;
  templates: TemplateRecord[];
  customLinks: ShortLinkOption[];
  catalogMediaItems: CatalogMediaOption[];
  teams: { id: string; name: string }[];
}

export const LANGUAGE_OPTIONS = [
  { code: "en", label: "English (en)" },
  { code: "en_IN", label: "English India (en_IN)" },
  { code: "en_US", label: "English US (en_US)" },
  { code: "hi", label: "Hindi (hi)" },
  { code: "te", label: "Telugu (te)" },
  { code: "ta", label: "Tamil (ta)" },
  { code: "kn", label: "Kannada (kn)" },
  { code: "mr", label: "Marathi (mr)" },
];

export function slugifyName(val: string): string {
  return val
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+/g, "")
    .slice(0, 120);
}
