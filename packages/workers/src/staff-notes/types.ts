export interface MentionableStaff {
  id: string;
  name: string;
  email?: string;
  whatsappNumber?: string;
}

export interface StaffNotification {
  id: string;
  staffId: string;
  type: "MENTION" | "ACRIO_REPLY" | "CALLBACK";
  conversationId: string;
  messageId: string;
  fromName: string;
  customerName: string;
  text: string;
  isRead: boolean;
  createdAt: string;
}

export const STAFF_NOTE_QUEUE = "acrio:staff_note_answer" as const;

export interface NoteAttachmentPayload {
  mediaId?: string;
  waMediaId?: string;
  mediaType: "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO";
  url: string;
  fileName?: string;
  mimeType?: string;
}

export interface PendingAcrioCandidateOption {
  id: string;
  title: string;
  sourceLabel: string;
  mediaUrl: string;
  mediaType: "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO" | "TEXT";
  mediaId?: string;
  waMediaId?: string;
  fileName: string;
  mimeType: string;
  docNumber?: string;
  messageText?: string;
  replyTo?: Record<string, unknown> | null;
}

export interface PendingAcrioNoteAction {
  id: string;
  status: "PENDING_CONFIRMATION" | "CONFIRMED" | "CANCELLED" | "FAILED";
  type: "send_customer_reply";
  title: string;
  messageText: string;
  sourceNoteId?: string;
  replyTo?: Record<string, unknown> | null;
  companyDocId?: string;
  companyDocTitle?: string;
  sourceLabel?: string;
  docNumber?: string;
  attachment?: NoteAttachmentPayload | null;
  candidateOptions?: PendingAcrioCandidateOption[];
  requestedByStaffId: string;
  requestedByStaffName: string;
  createdAt: string;
  decidedByStaffName?: string;
  decidedAt?: string;
  sentMessageId?: string;
  error?: string;
}

export interface AccidentalCustomerReplyMetadata {
  detected: boolean;
  status: "PENDING" | "SENT" | "DISMISSED";
  reason: string;
  exactMessageText: string;
  mergedCorrectionText?: string | null;
  replyTo?: Record<string, unknown> | null;
  sentMessageId?: string;
  sentByStaffName?: string;
  sentAt?: string;
}

export interface MissingCompanyDocPrompt {
  status: "NEEDS_UPLOAD" | "RESOLVED";
  slug: string;
  title: string;
  keywords: string;
  defaultMessageText: string;
  uploadedDocId?: string;
}
