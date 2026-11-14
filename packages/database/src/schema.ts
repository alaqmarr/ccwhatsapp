import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ============================================================================
// 1. CORE_AUTH.DB — Staff, Roles, Email OTPs, Sessions & /setup Wizard State
// ============================================================================
export const usersTable = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  whatsappNumber: text("whatsapp_number").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("STAFF"), // DEV | SUPERADMIN | ADMIN | STAFF | CLIENT
  status: text("status").notNull().default("UNVERIFIED_EMAIL"), // UNVERIFIED_EMAIL | PENDING_APPROVAL | ACTIVE | REJECTED | SUSPENDED
  department: text("department").default("Sales & Support"),
  emailVerifiedAt: text("email_verified_at"),
  onboardingCompletedAt: text("onboarding_completed_at"),
  onboardingProgressJson: text("onboarding_progress_json").default("[]"),
  approvedById: text("approved_by_id"),
  approvedByName: text("approved_by_name"),
  approvedAt: text("approved_at"),
  rejectionReason: text("rejection_reason"),
  lastActiveAt: text("last_active_at"),
  createdAt: text("created_at").notNull(),
});

export const emailVerificationsTable = sqliteTable("email_verifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  otpCode: text("otp_code").notNull(),
  expiresAt: text("expires_at").notNull(),
  verifiedAt: text("verified_at"),
  createdAt: text("created_at").notNull(),
});

export const sessionsTable = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: text("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  userAgent: text("user_agent"),
  createdAt: text("created_at").notNull(),
});

export const setupStateTable = sqliteTable("setup_state", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ============================================================================
// 2. CONVERSATIONS.DB — Chats, Messages, Assignments, Resolutions, Automations, Links
// ============================================================================
export const conversationsTable = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  customerPhone: text("customer_phone").notNull().unique(),
  customerName: text("customer_name").notNull(),
  customerId: text("customer_id"),
  status: text("status").notNull().default("OPEN"), // OPEN | ASSIGNED | PENDING_CUSTOMER | RESOLVED
  priority: text("priority").notNull().default("NORMAL"), // URGENT | HIGH | NORMAL | LOW
  smartCategory: text("smart_category").notNull().default("General Enquiry"),
  assignedStaffId: text("assigned_staff_id"),
  assignedStaffName: text("assigned_staff_name"),
  unreadCount: integer("unread_count").notNull().default(0),
  lastMessagePreview: text("last_message_preview").default(""),
  lastMessageAt: text("last_message_at").notNull(),
  windowExpiresAt: text("window_expires_at"),
  resolutionSummary: text("resolution_summary"),
  resolvedByName: text("resolved_by_name"),
  resolvedAt: text("resolved_at"),
  tagsJson: text("tags_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const messagesTable = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  direction: text("direction").notNull(), // INBOUND | OUTBOUND
  senderType: text("sender_type").notNull(), // CUSTOMER | STAFF | ACRIO_BOT | AUTOMATION
  senderName: text("sender_name").notNull(),
  messageType: text("message_type").notNull().default("TEXT"), // TEXT | TEMPLATE | PRODUCT_CARD | CUSTOM_LINK | INTERNAL_NOTE
  billingCategory: text("billing_category").notNull().default("UTILITY"), // MARKETING | UTILITY | AUTHENTICATION | SERVICE
  body: text("body").notNull(),
  templateName: text("template_name"),
  metadataJson: text("metadata_json").default("{}"),
  waMessageId: text("wa_message_id"),
  deliveryStatus: text("delivery_status").notNull().default("DELIVERED"), // QUEUED | SENT | DELIVERED | READ | FAILED
  createdAt: text("created_at").notNull(),
});

export const automationsTable = sqliteTable("automations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  triggerType: text("trigger_type").notNull(), // KEYWORD | ACRIO_INTENT | FIRST_CONTACT | SLA_IDLE
  triggerCondition: text("trigger_condition").notNull(),
  actionType: text("action_type").notNull(), // AUTO_REPLY | AUTO_ASSIGN | SMART_TAG | ACRIO_SUGGEST
  actionPayloadJson: text("action_payload_json").notNull(),
  isEnabled: integer("is_enabled").notNull().default(1),
  runsCount: integer("runs_count").notNull().default(0),
  lastTriggeredAt: text("last_triggered_at"),
  createdAt: text("created_at").notNull(),
});

export const customLinksTable = sqliteTable("custom_links", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  targetUrl: text("target_url").notNull(),
  linkType: text("link_type").notNull().default("PRODUCT"), // PRODUCT | CATALOG | QUOTE_PAYMENT | CUSTOM_ADMIN
  productSlug: text("product_slug"),
  utmCampaign: text("utm_campaign"),
  createdByName: text("created_by_name").notNull(),
  clicksCount: integer("clicks_count").notNull().default(0),
  lastClickedAt: text("last_clicked_at"),
  createdAt: text("created_at").notNull(),
});

export const conversationAssignmentsTable = sqliteTable("conversation_assignments", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  customerPhone: text("customer_phone").notNull().default(""),
  customerName: text("customer_name").notNull().default(""),
  fromStaffId: text("from_staff_id"),
  fromStaffName: text("from_staff_name"),
  fromTeamName: text("from_team_name"),
  toStaffId: text("to_staff_id"),
  toStaffName: text("to_staff_name").notNull(),
  toTeamId: text("to_team_id"),
  toTeamName: text("to_team_name").notNull(),
  escalationLevel: text("escalation_level").notNull().default("P0"),
  assignmentSource: text("assignment_source").notNull().default("MANUAL_ASSIGN"),
  assignedByName: text("assigned_by_name").notNull().default("System"),
  reason: text("reason").default(""),
  assignedAt: text("assigned_at").notNull(),
  firstResponseAt: text("first_response_at"),
  firstResponseSeconds: integer("first_response_seconds"),
  firstResponseMessageId: text("first_response_message_id"),
  endedAt: text("ended_at"),
  outcome: text("outcome").notNull().default("ACTIVE"), // ACTIVE | RESPONDED | ESCALATED | REASSIGNED | RESOLVED
});

// ============================================================================
// 3. CRM_ORDERS.DB — Customers, Smart Categorisations, Orders & Past Relations
// ============================================================================
export const customersTable = sqliteTable("customers", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  companyName: text("company_name"),
  organizationType: text("organization_type").default("Business"),
  city: text("city"),
  gstNumber: text("gst_number"),
  acrioSegment: text("acrio_segment").notNull().default("Active Prospect"),
  tagsJson: text("tags_json").notNull().default("[]"),
  lifetimeValueInr: real("lifetime_value_inr").notNull().default(0),
  totalOrdersCount: integer("total_orders_count").notNull().default(0),
  optInMarketing: integer("opt_in_marketing").notNull().default(1),
  notes: text("notes").default(""),
  lastInteractionAt: text("last_interaction_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const customerOrdersTable = sqliteTable("customer_orders", {
  id: text("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  customerId: text("customer_id").notNull(),
  customerPhone: text("customer_phone").notNull(),
  itemsSummary: text("items_summary").notNull(),
  quantity: integer("quantity").notNull().default(1),
  totalAmountInr: real("total_amount_inr").notNull(),
  paymentStatus: text("payment_status").notNull().default("PAID"), // PAID | ADVANCE_PAID | PENDING | QUOTE_SENT
  fulfillmentStatus: text("fulfillment_status").notNull().default("IN_PRODUCTION"), // DELIVERED | DISPATCHED | IN_PRODUCTION | DESIGN_PENDING
  invoiceUrl: text("invoice_url"),
  orderedAt: text("ordered_at").notNull(),
});

export const customerRelationsTable = sqliteTable("customer_relations", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  customerPhone: text("customer_phone").notNull(),
  relationType: text("relation_type").notNull(), // PAST_ORDER | WEBSITE_ENQUIRY | CUSTOM_FABRICATION | PHONE_CALL | REPEAT_BUYER
  summary: text("summary").notNull(),
  handledBy: text("handled_by").notNull(),
  occurredAt: text("occurred_at").notNull(),
});

export const orderTrackingsTable = sqliteTable("order_trackings", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().unique(),
  lookupKey: text("lookup_key").notNull().unique(),
  brand: text("brand").notNull().default("CLASSIC_CONCEPTS"), // CLASSIC_CONCEPTS | CLASSIC_EDGE_53
  customerName: text("customer_name").notNull().default(""),
  customerPhone: text("customer_phone").notNull().default(""),
  conversationId: text("conversation_id"),
  itemsSummary: text("items_summary").notNull().default(""),
  providerCode: text("provider_code").notNull().default("DELHIVERY"),
  providerName: text("provider_name").notNull().default("Delhivery"),
  awbNumber: text("awb_number").notNull().default(""),
  providerTrackingUrl: text("provider_tracking_url").notNull().default(""),
  shipmentStatus: text("shipment_status").notNull().default("DISPATCHED"),
  estimatedDelivery: text("estimated_delivery").default(""),
  notes: text("notes").default(""),
  lookupsCount: integer("lookups_count").notNull().default(0),
  lastLookedUpAt: text("last_looked_up_at"),
  createdByName: text("created_by_name").notNull().default("System"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ============================================================================
// 4. MARKETING.DB — Templates, ACRIO Marketing Lists & Broadcast Campaigns
// ============================================================================
export const templatesTable = sqliteTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  language: text("language").notNull().default("en"),
  category: text("category").notNull(), // MARKETING | UTILITY | AUTHENTICATION
  headerText: text("header_text"),
  bodyText: text("body_text").notNull(),
  footerText: text("footer_text"),
  ctaLabel: text("cta_label"),
  ctaUrl: text("cta_url"),
  approvalStatus: text("approval_status").notNull().default("APPROVED"),
  sentCount: integer("sent_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const marketingListsTable = sqliteTable("marketing_lists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  sourceType: text("source_type").notNull().default("ACRIO_SMART"), // ACRIO_SMART | SEGMENT_FILTER | MANUAL
  acrioPrompt: text("acrio_prompt"),
  filterRulesJson: text("filter_rules_json").notNull().default("{}"),
  memberPhonesJson: text("member_phones_json").notNull().default("[]"),
  membersCount: integer("members_count").notNull().default(0),
  createdByName: text("created_by_name").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const broadcastsTable = sqliteTable("broadcasts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  listId: text("list_id").notNull(),
  listName: text("list_name").notNull(),
  templateId: text("template_id").notNull(),
  templateName: text("template_name").notNull(),
  billingCategory: text("billing_category").notNull().default("MARKETING"),
  customLinkCode: text("custom_link_code"),
  status: text("status").notNull().default("COMPLETED"), // QUEUED | RUNNING | COMPLETED
  totalRecipients: integer("total_recipients").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  deliveredCount: integer("delivered_count").notNull().default(0),
  readCount: integer("read_count").notNull().default(0),
  clientBilledInr: real("client_billed_inr").notNull().default(0),
  actualMetaCostInr: real("actual_meta_cost_inr").notNull().default(0),
  createdByName: text("created_by_name").notNull(),
  createdAt: text("created_at").notNull(),
});

// ============================================================================
// 5. BILLING_OPS.DB — Dual Pricing (0.95 / 0.30 vs Actual Meta Cost) & Midnight GDrive Backups
// ============================================================================
export const pricingConfigTable = sqliteTable("pricing_config", {
  id: text("id").primaryKey(),
  clientMarketingRateInr: real("client_marketing_rate_inr").notNull().default(0.95),
  clientOtherRateInr: real("client_other_rate_inr").notNull().default(0.3),
  actualMetaMarketingRateInr: real("actual_meta_marketing_rate_inr").notNull().default(0.7846),
  actualMetaUtilityRateInr: real("actual_meta_utility_rate_inr").notNull().default(0.115),
  actualMetaAuthRateInr: real("actual_meta_auth_rate_inr").notNull().default(0.115),
  actualMetaServiceRateInr: real("actual_meta_service_rate_inr").notNull().default(0.08),
  currency: text("currency").notNull().default("INR"),
  updatedBy: text("updated_by").default("System"),
  updatedAt: text("updated_at").notNull(),
});

export const messageBillingLedgerTable = sqliteTable("message_billing_ledger", {
  id: text("id").primaryKey(),
  messageId: text("message_id"),
  broadcastId: text("broadcast_id"),
  conversationId: text("conversation_id"),
  customerPhone: text("customer_phone").notNull(),
  category: text("category").notNull(), // MARKETING | UTILITY | AUTHENTICATION | SERVICE
  clientUnitRateInr: real("client_unit_rate_inr").notNull(),
  actualMetaUnitCostInr: real("actual_meta_unit_cost_inr").notNull(),
  marginInr: real("margin_inr").notNull(),
  staffName: text("staff_name").notNull(),
  billedAt: text("billed_at").notNull(),
});

export const backupSettingsTable = sqliteTable("backup_settings", {
  id: text("id").primaryKey(),
  enabled: integer("enabled").notNull().default(1),
  midnightHourIst: integer("midnight_hour_ist").notNull().default(0),
  midnightMinuteIst: integer("midnight_minute_ist").notNull().default(0),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  googleDriveFolderId: text("google_drive_folder_id").default(""),
  googleServiceAccountEmail: text("google_service_account_email").default(""),
  googlePrivateKey: text("google_private_key").default(""),
  googleOauthRefreshToken: text("google_oauth_refresh_token").default(""),
  googleClientId: text("google_client_id").default(""),
  googleClientSecret: text("google_client_secret").default(""),
  retentionDays: integer("retention_days").notNull().default(30),
  includeMainWebsiteDb: integer("include_main_website_db").notNull().default(1),
  lastRunAt: text("last_run_at"),
  lastRunStatus: text("last_run_status"),
  updatedBy: text("updated_by").default("System"),
  updatedAt: text("updated_at").notNull(),
});

export const backupLogsTable = sqliteTable("backup_logs", {
  id: text("id").primaryKey(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at").notNull(),
  triggerSource: text("trigger_source").notNull(), // MIDNIGHT_CRON | MANUAL_DEV
  status: text("status").notNull(), // UPLOADED_TO_GDRIVE | SAVED_LOCAL_SNAPSHOT | FAILED
  databasesCount: integer("databases_count").notNull().default(6),
  totalBytes: integer("total_bytes").notNull().default(0),
  localFolderPath: text("local_folder_path").notNull(),
  googleDriveFileId: text("google_drive_file_id"),
  googleDriveLink: text("google_drive_link"),
  detailsMessage: text("details_message").notNull(),
});

// ============================================================================
// 6. QUEUE_JOBS.DB — Durable LibSQL Micro-Queue & Worker Heartbeats
// ============================================================================
export const jobsTable = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  queueName: text("queue_name").notNull(),
  payloadJson: text("payload_json").notNull(),
  status: text("status").notNull().default("PENDING"), // PENDING | PROCESSING | COMPLETED | FAILED
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  runAfter: text("run_after").notNull(),
  errorText: text("error_text"),
  processedAt: text("processed_at"),
  createdAt: text("created_at").notNull(),
});

export const workerHeartbeatsTable = sqliteTable("worker_heartbeats", {
  workerName: text("worker_name").primaryKey(),
  status: text("status").notNull(),
  lastBeatAt: text("last_beat_at").notNull(),
  processedCount: integer("processed_count").notNull().default(0),
  infoJson: text("info_json").default("{}"),
});

// ============================================================================
// 7. CONTACTS.DB — Master Contacts Directory, Groups, Tags & Import Logs
// ============================================================================
export const contactsTable = sqliteTable("contacts", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  whatsappName: text("whatsapp_name").default(""),
  name: text("name").notNull(),
  email: text("email").default(""),
  companyName: text("company_name").default(""),
  designation: text("designation").default(""),
  organizationType: text("organization_type").notNull().default("Business"),
  city: text("city").default(""),
  state: text("state").default(""),
  country: text("country").notNull().default("India"),
  gstNumber: text("gst_number").default(""),
  source: text("source").notNull().default("MANUAL"), // WHATSAPP_INBOUND | WEBSITE_ENQUIRY | CSV_IMPORT | MANUAL | ORDER
  stage: text("stage").notNull().default("NEW_LEAD"), // NEW_LEAD | QUALIFIED | QUOTED | CUSTOMER | REPEAT_BUYER | VIP | INACTIVE
  acrioSegment: text("acrio_segment").notNull().default("Active Prospect"),
  tagsJson: text("tags_json").notNull().default("[]"),
  groupsJson: text("groups_json").notNull().default("[]"),
  optInMarketing: integer("opt_in_marketing").notNull().default(1),
  optOutReason: text("opt_out_reason").default(""),
  assignedOwnerId: text("assigned_owner_id"),
  assignedOwnerName: text("assigned_owner_name").default(""),
  lifetimeValueInr: real("lifetime_value_inr").notNull().default(0),
  totalOrdersCount: integer("total_orders_count").notNull().default(0),
  totalMessagesCount: integer("total_messages_count").notNull().default(0),
  notes: text("notes").default(""),
  lastContactedAt: text("last_contacted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const contactGroupsTable = sqliteTable("contact_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("emerald"),
  createdByName: text("created_by_name").notNull().default("System"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const contactImportLogsTable = sqliteTable("contact_import_logs", {
  id: text("id").primaryKey(),
  sourceLabel: text("source_label").notNull(),
  importedCount: integer("imported_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  importedByName: text("imported_by_name").notNull(),
  createdAt: text("created_at").notNull(),
});
