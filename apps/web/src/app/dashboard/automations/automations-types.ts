import { TRACKING_PUBLIC_ORIGIN } from "@cc/ui";

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  triggerType: string;
  triggerCondition: string;
  actionType: string;
  actionPayload: Record<string, unknown>;
  priorityOrder?: number;
  isEnabled: boolean;
  runsCount: number;
  lastTriggeredAt: string | null;
}

export interface TeamOption {
  id: string;
  name: string;
}

export interface TemplateOption {
  id: string;
  name: string;
  category: string;
  languageCode?: string;
}

export interface DryRunResult {
  orderLookupDetected: {
    explicitOrderId: string | null;
    asksAboutOrder: boolean;
  };
  matchedRules: {
    id: string;
    name: string;
    triggerType: string;
    actionType: string;
    stopFurtherAi: boolean;
    simulatedReply?: string;
  }[];
  wouldRunAcrioAi?: boolean;
}

export const TRIGGER_LABELS: Record<string, string> = {
  KEYWORD: "Contains Any Word",
  EXACT: "Exact Phrase Match",
  STARTS_WITH: "Starts With",
  REGEX: "Regex Pattern",
  FIRST_CONTACT: "New First-Time Customer",
  OUT_OF_HOURS_IST: "Outside Working Hours (IST)",
  BUTTON_PAYLOAD: "Quick-Reply Button Payload",
  ORDER_INQUIRY: "Order / Tracking Question",
};

export const ACTION_LABELS: Record<string, string> = {
  AUTO_REPLY: "Send Instant Auto-Reply",
  COMBO: "Combo (Reply + Tag + Assign Team)",
  ASSIGN_TEAM: "Assign Directly to Team",
  SEND_ORDER_STATUS: "Lookup & Send Order Track Link",
  SEND_APPROVED_TEMPLATE: "Send Meta-Approved Template",
  SMART_TAG: "Tag Topic & Urgency Only",
};

export const STARTER_PRESETS = [
  {
    label: "GST / Invoice Info",
    name: "GST Invoice & Billing Auto-Answer",
    description:
      "Answers GST billing questions without spending ACRIO AI credits",
    triggerType: "KEYWORD",
    triggerCondition: "gst, gstin, proforma, tax invoice",
    actionType: "AUTO_REPLY",
    replyText:
      "Yes, we issue a full 18% GST tax invoice on all Classic Concepts and Classic Edge 53 orders. Share your company GSTIN, billing address, and pincode whenever ready.",
    smartCategory: "Order & Delivery",
    priority: "NORMAL",
    stopFurtherAi: true,
  },
  {
    label: "Bulk Hotel / Event Handoff",
    name: "Urgent Bulk Hotel & Event Routing",
    description: "Sends a quick acknowledgment and connects Sales Team P0",
    triggerType: "KEYWORD",
    triggerCondition:
      "bulk order, 50 pieces, 100 pieces, hotel tender, urgent quote",
    actionType: "COMBO",
    replyText:
      "Thank you! I am connecting your bulk requirement directly to our Sales Team so they can share volume pricing right away.",
    smartCategory: "Hotel & Banquet",
    priority: "URGENT",
    stopFurtherAi: true,
  },
  {
    label: "After-Hours Greeting",
    name: "After-Hours Instant Reply (IST)",
    description:
      "Lets late-evening customers know when our Hyderabad workshop opens",
    triggerType: "OUT_OF_HOURS_IST",
    triggerCondition: "19:30-09:30",
    actionType: "AUTO_REPLY",
    replyText: `Hello! Thank you for messaging Classic Concepts. Our workshop team is live Mon to Sat, 9:30 AM to 7:30 PM IST. You can track existing orders anytime at ${TRACKING_PUBLIC_ORIGIN} or share your requirement here for first-priority morning follow-up.`,
    smartCategory: "General Enquiry",
    priority: "NORMAL",
    stopFurtherAi: false,
  },
] as const;
