export interface AcrioStaffAction {
  type:
    | "assign_staff"
    | "add_collaborator"
    | "set_priority"
    | "set_category"
    | "resolve_chat"
    | "reopen_chat"
    | "update_customer"
    | "create_callback"
    | "send_customer_reply"
    | "request_company_document_upload";
  staffQuery?: string;
  priority?: "URGENT" | "HIGH" | "NORMAL";
  category?: string;
  summary?: string;
  companyName?: string;
  city?: string;
  notes?: string;
  preferredStaffQuery?: string;
  callbackSlot?: string;
  callbackTopic?: string;
  messageText?: string;
  companyDocId?: string;
  companyDocTitle?: string;
  requestedDocSlug?: string;
  requestedDocTitle?: string;
  docNumber?: string;
  mediaUrl?: string;
  mediaType?: "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO";
  mediaId?: string;
  waMediaId?: string;
  fileName?: string;
  mimeType?: string;
  confirmed?: boolean;
  shareKind?: "DOCUMENT" | "PRODUCT_DATA" | "CUSTOM_MESSAGE";
  autoExecute?: boolean;
  sourceLabel?: string;
  candidateOptions?: Array<{
    id: string;
    title: string;
    sourceLabel: string;
    mediaUrl: string;
    mediaType: "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO";
    mediaId?: string;
    waMediaId?: string;
    fileName: string;
    mimeType: string;
    docNumber?: string;
  }>;
}

export interface StaffNoteAttachmentInput {
  mediaId?: string;
  waMediaId?: string;
  mediaType?: string;
  url: string;
  fileName?: string;
  mimeType?: string;
}
