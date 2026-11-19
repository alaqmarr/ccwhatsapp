export interface TrainingExample {
  id: string;
  title: string;
  category: string;
  guidanceType: "INSTRUCTION" | "FIXED_ANSWER";
  customerQuestion: string;
  idealAnswer: string;
  doNotSay: string;
  productSlug: string;
  priority: "HIGH" | "NORMAL";
  isEnabled: boolean;
  createdByName: string;
  updatedAt: string;
}

export interface TrainingRule {
  id: string;
  title: string;
  ruleText: string;
  scope: "BOTH" | "CUSTOMER_CHAT" | "STAFF_COPILOT";
  isEnabled: boolean;
  createdByName: string;
  updatedAt: string;
}

export interface CatalogProductOption {
  slug: string;
  name: string;
  sku: string | null;
  brandLabel: string;
  priceInr: number | null;
}

export interface RecentQuestionItem {
  id: string;
  conversationId: string;
  customerName: string;
  question: string;
  createdAt: string;
}

export interface SimTurn {
  role: "customer" | "assistant";
  text: string;
  meta?: {
    needsHumanHandoff?: boolean;
    smartCategory?: string;
    activeProduct?: string | null;
    productHistory?: string[];
  };
}

export interface CompanyDoc {
  id: string;
  slug: string;
  title: string;
  category: "COMPLIANCE" | "CATALOGUE" | "BANKING" | "COMPANY_PROFILE";
  docNumber: string;
  mediaId: string;
  waMediaId: string;
  mediaUrl: string;
  mediaType: string;
  fileName: string;
  mimeType: string;
  keywords: string;
  uploadedBy: string;
  updatedAt: string;
}

export interface WebsiteDoc {
  id: string;
  slug: string;
  title: string;
  source: string;
  sourceLabel: string;
  category: string;
  mediaUrl: string;
  mediaType: string;
  fileName: string;
}

export interface AiTrainingInitialData {
  examples: TrainingExample[];
  rules: TrainingRule[];
  products: CatalogProductOption[];
  recentCustomerQuestions: RecentQuestionItem[];
  documents: CompanyDoc[];
  websiteDocuments: WebsiteDoc[];
}
