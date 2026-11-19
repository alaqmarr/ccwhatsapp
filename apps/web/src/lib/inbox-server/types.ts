import type {
  ConversationCollaborator,
  OrderTrackingRecord,
} from "@cc/database";
import type { UserRole } from "@cc/rbac";

export interface ConversationSummary {
  id: string;
  customerPhone: string;
  customerName: string;
  customerId: string | null;
  status: string;
  priority: string;
  smartCategory: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  escalationLevel: string;
  waitingSince: string | null;
  lastResponseSeconds: number | null;
  escalatedAt: string | null;
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageAt: string;
  lastMessageDirection: string | null;
  lastMessageStatus: string | null;
  windowExpiresAt: string | null;
  resolutionSummary: string | null;
  resolvedByName: string | null;
  tags: string[];
  collaborators: ConversationCollaborator[];
}

export interface QuotedMessageRef {
  messageId?: string | null;
  waMessageId?: string | null;
  senderName: string;
  senderType?: string;
  direction?: string;
  body: string;
}

export interface ChatMessage {
  id: string;
  direction: string;
  senderType: string;
  senderName: string;
  messageType: string;
  billingCategory: string;
  body: string;
  templateName: string | null;
  waMessageId?: string | null;
  deliveryStatus: string;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface ConversationAssignmentItem {
  id: string;
  conversationId: string;
  fromStaffId: string | null;
  fromStaffName: string | null;
  fromTeamName: string | null;
  toStaffId: string | null;
  toStaffName: string;
  toTeamId: string | null;
  toTeamName: string;
  escalationLevel: string;
  assignmentSource: string;
  assignedByName: string;
  reason: string;
  assignedAt: string;
  firstResponseAt: string | null;
  firstResponseSeconds: number | null;
  firstResponseMessageId: string | null;
  endedAt: string | null;
  outcome: string;
}

export interface CustomerProfile {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  companyName: string | null;
  organizationType: string;
  city: string | null;
  gstNumber: string | null;
  acrioSegment: string;
  lifetimeValueInr: number;
  totalOrdersCount: number;
  notes: string;
  preferredStaffId?: string | null;
  preferredStaffName?: string | null;
  tags?: string[];
}

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  itemsSummary: string;
  quantity: number;
  totalAmountInr: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  invoiceUrl: string | null;
  orderedAt: string;
}

export interface CustomerRelation {
  id: string;
  relationType: string;
  summary: string;
  handledBy: string;
  occurredAt: string;
}

export interface WebsiteEnquiry {
  id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  source: string;
  status: string;
  createdAt: string;
}

export interface AcrioRecommendedItem {
  name: string;
  slug: string;
  sku: string | null;
  priceInr: number | null;
  url: string;
  brand?: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  brandLabel?: string;
  itemType?: "PRODUCT" | "MACHINE" | "CONSUMABLE";
  modelsSummary?: string | null;
}

export interface AcrioCopilot {
  engineLabel: string;
  smartCategory: string;
  priority: string;
  suggestedReplies: string[];
  recommendedProducts: AcrioRecommendedItem[];
  resolutionDraft: string;
}

export interface TeamOption {
  id: string;
  name: string;
  brandScope: string;
  priorityRank: number;
  p0WaitMinutes: number;
  p1WaitMinutes: number;
}

export interface StaffOption {
  id: string;
  name: string;
  role: string;
  department: string;
  assignmentsEnabled?: boolean;
}

export interface TemplateVariableSpecOption {
  index: number;
  label: string;
  sourceField: string;
  sampleValue: string;
}

export interface ApprovedTemplateOption {
  id: string;
  name: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  headerText: string | null;
  headerType: string;
  bodyText: string;
  footerText: string | null;
  ctaUrl: string | null;
  buttons: { type: string; text: string }[];
  variablesSchema: TemplateVariableSpecOption[];
}

export interface CustomLinkItem {
  id: string;
  code: string;
  title: string;
  targetUrl: string;
  utmCampaign?: string | null;
  clicksCount: number;
}

export interface VerifiedCompanyLocation {
  placeName: string;
  address: string;
  businessHours: string;
  phone: string;
  mapsUrl: string;
  latitude: number;
  longitude: number;
}

export interface ConversationDetailBundle {
  conversation: {
    id: string;
    customerPhone: string;
    customerName: string;
    status: string;
    priority: string;
    smartCategory: string;
    assignedStaffId: string | null;
    assignedStaffName: string | null;
    assignedTeamId: string | null;
    assignedTeamName: string | null;
    escalationLevel: string;
    waitingSince: string | null;
    lastResponseSeconds: number | null;
    escalatedAt: string | null;
    resolutionSummary: string | null;
    resolvedByName: string | null;
    windowExpiresAt: string | null;
    collaborators: ConversationCollaborator[];
  };
  messages: ChatMessage[];
  hasOlderMessages?: boolean;
  oldestMessageCursor?: string | null;
  assignments?: ConversationAssignmentItem[];
  customer: CustomerProfile | null;
  orders: CustomerOrder[];
  orderTrackings?: OrderTrackingRecord[];
  relations: CustomerRelation[];
  websiteEnquiries: WebsiteEnquiry[];
  acrio: AcrioCopilot | null;
  customLinks: CustomLinkItem[];
  verifiedLocation?: VerifiedCompanyLocation;
  drawerHydrated?: boolean;
}

export interface QuickReplyItem {
  id: string;
  staffId: string;
  staffName: string;
  cmd: string;
  title: string;
  body: string;
  isShared: boolean;
  isMine: boolean;
}

export interface InitialInboxPayload {
  currentUserId: string;
  currentUserName: string;
  currentUserRole: UserRole;
  serverNowMs: number;
  threads: ConversationSummary[];
  initialSelectedId: string | null;
  initialDetail: ConversationDetailBundle | null;
  teams: TeamOption[];
  staffList: StaffOption[];
  templates: ApprovedTemplateOption[];
  quickReplies: QuickReplyItem[];
}
