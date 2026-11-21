import { formatDateIst } from "@cc/ui";

export interface ContactGroupItem {
  id: string;
  name: string;
  description: string;
  color: string;
  membersCount: number;
}

export interface ContactItem {
  id: string;
  phone: string;
  whatsappName: string;
  name: string;
  email: string;
  companyName: string;
  designation: string;
  organizationType: string;
  city: string;
  state: string;
  country: string;
  gstNumber: string;
  source: string;
  stage: string;
  acrioSegment: string;
  tags: string[];
  groups: string[];
  optInMarketing: boolean;
  optOutReason: string;
  assignedOwnerName: string;
  preferredStaffId?: string | null;
  preferredStaffName?: string;
  lifetimeValueInr: number;
  totalOrdersCount: number;
  totalMessagesCount: number;
  notes: string;
  lastContactedAt: string;
  createdAt: string;
  updatedAt: string;
  conversationId: string | null;
  chatStatus: string | null;
  unreadCount: number;
  windowOpen: boolean;
}

export interface Contact360Detail
  extends Omit<
    ContactItem,
    "conversationId" | "chatStatus" | "unreadCount" | "windowOpen" | "totalMessagesCount"
  > {
  conversation: {
    id: string;
    status: string;
    assignedTo: string;
    unreadCount: number;
    lastMessagePreview: string;
    lastMessageAt: string;
    windowExpiresAt: string | null;
  } | null;
  orders: Array<{
    id: string;
    orderNumber: string;
    itemsSummary: string;
    quantity: number;
    totalAmountInr: number;
    paymentStatus: string;
    fulfillmentStatus: string;
    orderedAt: string;
  }>;
  relations: Array<{
    id: string;
    relationType: string;
    summary: string;
    handledBy: string;
    occurredAt: string;
  }>;
  websiteEnquiries: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    message: string;
    source: string;
    status: string;
    createdAt: string;
  }>;
}

export interface ContactsPayload {
  permissions: {
    canManage: boolean;
    canDelete: boolean;
    canManageLists: boolean;
  };
  kpis: {
    totalContacts: number;
    optedInCount: number;
    optedOutCount: number;
    optInRatePct: number;
    customersCount: number;
    repeatAndVipCount: number;
    totalLifetimeValueInr: number;
    withActiveChatCount: number;
  };
  groups: ContactGroupItem[];
  allTags: Array<{ tag: string; count: number }>;
  marketingLists: Array<{ id: string; name: string; membersCount: number }>;
  importLogs: Array<{
    id: string;
    sourceLabel: string;
    importedCount: number;
    updatedCount: number;
    skippedCount: number;
    importedByName: string;
    createdAt: string;
  }>;
  staffList?: Array<{ id: string; name: string; role: string; email?: string }>;
  contacts: ContactItem[];
}

export interface AddContactFormState {
  name: string;
  phone: string;
  companyName: string;
  designation: string;
  email: string;
  organizationType: string;
  city: string;
  state: string;
  gstNumber: string;
  stage: string;
  tagsText: string;
  groups: string[];
  optInMarketing: boolean;
  preferredStaffId: string;
  notes: string;
}

export const INITIAL_ADD_CONTACT_FORM: AddContactFormState = {
  name: "",
  phone: "+91 ",
  companyName: "",
  designation: "",
  email: "",
  organizationType: "Corporate",
  city: "",
  state: "",
  gstNumber: "",
  stage: "NEW_LEAD",
  tagsText: "",
  groups: [],
  optInMarketing: true,
  preferredStaffId: "",
  notes: "",
};

export const STAGE_OPTIONS = [
  { value: "NEW_LEAD", label: "New Lead", badge: "bg-sky-50 text-sky-800 border-sky-200" },
  { value: "QUALIFIED", label: "Qualified", badge: "bg-indigo-50 text-indigo-800 border-indigo-200" },
  { value: "QUOTED", label: "Quote Sent", badge: "bg-amber-50 text-amber-900 border-amber-200" },
  { value: "CUSTOMER", label: "Customer", badge: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  { value: "REPEAT_BUYER", label: "Repeat Buyer", badge: "bg-teal-50 text-teal-900 border-teal-200" },
  { value: "VIP", label: "VIP Account", badge: "bg-purple-50 text-purple-900 border-purple-200" },
  { value: "INACTIVE", label: "Inactive", badge: "bg-slate-100 text-slate-600 border-slate-300" },
] as const;

export const ORG_TYPES = [
  "Business",
  "Corporate",
  "Educational",
  "Hospitality",
  "Government",
  "Retail",
  "Dealer / Fabricator",
  "Individual",
];

export function stageMeta(stage: string) {
  return (
    STAGE_OPTIONS.find((s) => s.value === stage) || {
      value: stage,
      label: stage.replace(/_/g, " "),
      badge: "bg-slate-100 text-slate-700 border-slate-300",
    }
  );
}

export function sourceLabel(src: string): string {
  switch (src) {
    case "WHATSAPP_INBOUND":
      return "WhatsApp Chat";
    case "WEBSITE_ENQUIRY":
      return "Website Enquiry";
    case "CSV_IMPORT":
      return "CSV Import";
    case "ORDER":
      return "Past Order";
    default:
      return "Manual";
  }
}

export function formatDateShort(iso?: string | null): string {
  if (!iso) return "Never";
  const formatted = formatDateIst(iso);
  return formatted || "Never";
}
