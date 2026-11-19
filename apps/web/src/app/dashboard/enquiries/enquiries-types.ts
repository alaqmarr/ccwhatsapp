export interface EcosystemEnquiry {
  id: string;
  externalId: string;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  brandLabel: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  productName: string;
  source: string;
  message: string;
  status: "New" | "Replied";
  aiSuggestedReply: string;
  lastReplyText: string;
  lastReplyChannel: string;
  repliedByName: string;
  repliedAt: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnquiriesStats {
  total: number;
  newCount: number;
  repliedCount: number;
  ccCount: number;
  ce53Count: number;
}

export interface EnquiriesInitialData {
  enquiries: EcosystemEnquiry[];
  stats: EnquiriesStats;
  bridgeHealth?: {
    classicConcepts3003?: { online?: boolean; dbFallbackAvailable?: boolean };
    classicEdge3002?: { online?: boolean; dbFallbackAvailable?: boolean };
  } | null;
}

export function buildDirectWaMeLink(
  enq: EcosystemEnquiry,
  replyText: string
): string {
  const digits = (enq.customerPhone || "").replace(/\D/g, "");
  const normalized = digits.length === 10 ? `91${digits}` : digits;
  const text =
    replyText.trim() ||
    `Hello ${enq.customerName},\n\nGreetings from ${
      enq.brand === "CLASSIC_EDGE_53" ? "Classic Edge 53" : "Classic Concepts"
    }! We received your website enquiry${
      enq.productName ? ` regarding ${enq.productName}` : ""
    }:\n"${enq.message.slice(0, 140)}"\n\nHow can we help you with this?`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}
