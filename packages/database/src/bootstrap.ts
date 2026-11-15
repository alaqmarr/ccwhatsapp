import {
  getRawLibSqlClient,
  resolveEnvMetaWhatsAppConfig,
  resolveMonorepoRoot,
} from "./clients";

let bootstrapPromise: Promise<void> | null = null;

export function resetBootstrapCache(): void {
  bootstrapPromise = null;
}

export async function ensureDatabasesBootstrapped(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrapInternal().catch((err) => {
      bootstrapPromise = null;
      throw err;
    });
  }
  return bootstrapPromise;
}

async function runBootstrapInternal(): Promise<void> {
  const auth = getRawLibSqlClient("core_auth");
  const conv = getRawLibSqlClient("conversations");
  const contacts = getRawLibSqlClient("contacts");
  const crm = getRawLibSqlClient("crm_orders");
  const mkt = getRawLibSqlClient("marketing");
  const bill = getRawLibSqlClient("billing_ops");
  const queue = getRawLibSqlClient("queue_jobs");

  // Enable WAL mode across all 7 LibSQL databases for fast concurrent reads & writes
  await Promise.all([
    auth.execute("PRAGMA journal_mode = WAL;"),
    conv.execute("PRAGMA journal_mode = WAL;"),
    contacts.execute("PRAGMA journal_mode = WAL;"),
    crm.execute("PRAGMA journal_mode = WAL;"),
    mkt.execute("PRAGMA journal_mode = WAL;"),
    bill.execute("PRAGMA journal_mode = WAL;"),
    queue.execute("PRAGMA journal_mode = WAL;"),
  ]);

  // 1. core_auth.db
  await auth.batch(
    [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        whatsapp_number TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'STAFF',
        status TEXT NOT NULL DEFAULT 'UNVERIFIED_EMAIL',
        department TEXT DEFAULT 'Sales & Support',
        email_verified_at TEXT,
        onboarding_completed_at TEXT,
        onboarding_progress_json TEXT DEFAULT '[]',
        approved_by_id TEXT,
        approved_by_name TEXT,
        approved_at TEXT,
        rejection_reason TEXT,
        last_active_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS email_verifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        otp_code TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        verified_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        user_agent TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS setup_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
    "write"
  );

  // 2. conversations.db
  await conv.batch(
    [
      `CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        customer_phone TEXT NOT NULL UNIQUE,
        customer_name TEXT NOT NULL,
        customer_id TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN',
        priority TEXT NOT NULL DEFAULT 'NORMAL',
        smart_category TEXT NOT NULL DEFAULT 'General Enquiry',
        assigned_staff_id TEXT,
        assigned_staff_name TEXT,
        unread_count INTEGER NOT NULL DEFAULT 0,
        last_message_preview TEXT DEFAULT '',
        last_message_at TEXT NOT NULL,
        window_expires_at TEXT,
        resolution_summary TEXT,
        resolved_by_name TEXT,
        resolved_at TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        sender_type TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'TEXT',
        billing_category TEXT NOT NULL DEFAULT 'UTILITY',
        body TEXT NOT NULL,
        template_name TEXT,
        metadata_json TEXT DEFAULT '{}',
        wa_message_id TEXT,
        delivery_status TEXT NOT NULL DEFAULT 'DELIVERED',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        trigger_condition TEXT NOT NULL,
        action_type TEXT NOT NULL,
        action_payload_json TEXT NOT NULL,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        runs_count INTEGER NOT NULL DEFAULT 0,
        last_triggered_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS custom_links (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        target_url TEXT NOT NULL,
        link_type TEXT NOT NULL DEFAULT 'PRODUCT',
        product_slug TEXT,
        utm_campaign TEXT,
        created_by_name TEXT NOT NULL,
        clicks_count INTEGER NOT NULL DEFAULT 0,
        last_clicked_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        brand_scope TEXT NOT NULL DEFAULT 'ALL',
        routing_keywords TEXT NOT NULL DEFAULT '',
        priority_rank INTEGER NOT NULL DEFAULT 10,
        p0_wait_minutes INTEGER NOT NULL DEFAULT 5,
        p1_wait_minutes INTEGER NOT NULL DEFAULT 12,
        auto_assign_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS team_members (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        staff_id TEXT NOT NULL,
        staff_name TEXT NOT NULL,
        staff_email TEXT NOT NULL DEFAULT '',
        tier TEXT NOT NULL DEFAULT 'P0',
        max_active_chats INTEGER NOT NULL DEFAULT 15,
        is_available INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS conversation_assignments (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        customer_phone TEXT NOT NULL DEFAULT '',
        customer_name TEXT NOT NULL DEFAULT '',
        from_staff_id TEXT,
        from_staff_name TEXT,
        from_team_name TEXT,
        to_staff_id TEXT,
        to_staff_name TEXT NOT NULL,
        to_team_id TEXT,
        to_team_name TEXT NOT NULL,
        escalation_level TEXT NOT NULL DEFAULT 'P0',
        assignment_source TEXT NOT NULL DEFAULT 'MANUAL_ASSIGN',
        assigned_by_name TEXT NOT NULL DEFAULT 'System',
        reason TEXT DEFAULT '',
        assigned_at TEXT NOT NULL,
        first_response_at TEXT,
        first_response_seconds INTEGER,
        first_response_message_id TEXT,
        ended_at TEXT,
        outcome TEXT NOT NULL DEFAULT 'ACTIVE'
      )`,
      `CREATE INDEX IF NOT EXISTS idx_conv_assign_conv ON conversation_assignments (conversation_id, assigned_at)`,
      `CREATE INDEX IF NOT EXISTS idx_conv_assign_staff ON conversation_assignments (to_staff_id, assigned_at)`,
    ],
    "write"
  );

  // Non-destructive column upgrades for existing conversations.db & core_auth.db
  const extraAuthTables = [
    `CREATE TABLE IF NOT EXISTS email_dispatch_logs (
      id TEXT PRIMARY KEY,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT NOT NULL DEFAULT '',
      dispatch_type TEXT NOT NULL DEFAULT 'STAFF_ASSIGNMENT',
      conversation_id TEXT,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SENT',
      transport_source TEXT NOT NULL DEFAULT 'SMTP',
      error_message TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_email_logs_created ON email_dispatch_logs (created_at DESC)`,
  ];
  for (const ddl of extraAuthTables) {
    try {
      await auth.execute(ddl);
    } catch {
      // Exists
    }
  }

  const extraConvColumns = [
    `ALTER TABLE conversations ADD COLUMN assigned_team_id TEXT`,
    `ALTER TABLE conversations ADD COLUMN assigned_team_name TEXT`,
    `ALTER TABLE conversations ADD COLUMN escalation_level TEXT NOT NULL DEFAULT 'P0'`,
    `ALTER TABLE conversations ADD COLUMN waiting_since TEXT`,
    `ALTER TABLE conversations ADD COLUMN last_response_seconds INTEGER`,
    `ALTER TABLE conversations ADD COLUMN escalated_at TEXT`,
    `ALTER TABLE conversations ADD COLUMN resolved_by_id TEXT`,
    `ALTER TABLE messages ADD COLUMN sender_staff_id TEXT`,
    `ALTER TABLE automations ADD COLUMN priority_order INTEGER NOT NULL DEFAULT 10`,
    `ALTER TABLE team_members ADD COLUMN email_alerts_enabled INTEGER NOT NULL DEFAULT 1`,
  ];
  for (const ddl of extraConvColumns) {
    try {
      await conv.execute(ddl);
    } catch {
      // Column already exists
    }
  }

  // 2b. contacts.db - Master WhatsApp Contacts Directory, Groups & Import History
  await contacts.batch(
    [
      `CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        phone TEXT NOT NULL UNIQUE,
        whatsapp_name TEXT DEFAULT '',
        name TEXT NOT NULL,
        email TEXT DEFAULT '',
        company_name TEXT DEFAULT '',
        designation TEXT DEFAULT '',
        organization_type TEXT NOT NULL DEFAULT 'Business',
        city TEXT DEFAULT '',
        state TEXT DEFAULT '',
        country TEXT NOT NULL DEFAULT 'India',
        gst_number TEXT DEFAULT '',
        source TEXT NOT NULL DEFAULT 'MANUAL',
        stage TEXT NOT NULL DEFAULT 'NEW_LEAD',
        acrio_segment TEXT NOT NULL DEFAULT 'Active Prospect',
        tags_json TEXT NOT NULL DEFAULT '[]',
        groups_json TEXT NOT NULL DEFAULT '[]',
        opt_in_marketing INTEGER NOT NULL DEFAULT 1,
        opt_out_reason TEXT DEFAULT '',
        assigned_owner_id TEXT,
        assigned_owner_name TEXT DEFAULT '',
        lifetime_value_inr REAL NOT NULL DEFAULT 0,
        total_orders_count INTEGER NOT NULL DEFAULT 0,
        total_messages_count INTEGER NOT NULL DEFAULT 0,
        notes TEXT DEFAULT '',
        last_contacted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts (stage, opt_in_marketing)`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_updated ON contacts (updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_city ON contacts (city)`,
      `CREATE TABLE IF NOT EXISTS contact_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT 'emerald',
        created_by_name TEXT NOT NULL DEFAULT 'System',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS contact_import_logs (
        id TEXT PRIMARY KEY,
        source_label TEXT NOT NULL,
        imported_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        imported_by_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    ],
    "write"
  );

  // 3. crm_orders.db
  await crm.batch(
    [
      `CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        phone TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        email TEXT,
        company_name TEXT,
        organization_type TEXT DEFAULT 'Business',
        city TEXT,
        gst_number TEXT,
        acrio_segment TEXT NOT NULL DEFAULT 'Active Prospect',
        tags_json TEXT NOT NULL DEFAULT '[]',
        lifetime_value_inr REAL NOT NULL DEFAULT 0,
        total_orders_count INTEGER NOT NULL DEFAULT 0,
        opt_in_marketing INTEGER NOT NULL DEFAULT 1,
        notes TEXT DEFAULT '',
        last_interaction_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS customer_orders (
        id TEXT PRIMARY KEY,
        order_number TEXT NOT NULL UNIQUE,
        customer_id TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        items_summary TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        total_amount_inr REAL NOT NULL,
        payment_status TEXT NOT NULL DEFAULT 'PAID',
        fulfillment_status TEXT NOT NULL DEFAULT 'IN_PRODUCTION',
        invoice_url TEXT,
        ordered_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS customer_relations (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        handled_by TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS order_trackings (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL UNIQUE,
        lookup_key TEXT NOT NULL UNIQUE,
        brand TEXT NOT NULL DEFAULT 'CLASSIC_CONCEPTS',
        customer_name TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        conversation_id TEXT,
        items_summary TEXT NOT NULL DEFAULT '',
        provider_code TEXT NOT NULL DEFAULT 'DELHIVERY',
        provider_name TEXT NOT NULL DEFAULT 'Delhivery',
        awb_number TEXT NOT NULL DEFAULT '',
        provider_tracking_url TEXT NOT NULL DEFAULT '',
        shipment_status TEXT NOT NULL DEFAULT 'DISPATCHED',
        estimated_delivery TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        lookups_count INTEGER NOT NULL DEFAULT 0,
        last_looked_up_at TEXT,
        created_by_name TEXT NOT NULL DEFAULT 'System',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_order_trackings_lookup ON order_trackings (lookup_key)`,
      `CREATE INDEX IF NOT EXISTS idx_order_trackings_phone ON order_trackings (customer_phone)`,
      `CREATE INDEX IF NOT EXISTS idx_order_trackings_updated ON order_trackings (updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS website_enquiry_sync_logs (
        id TEXT PRIMARY KEY,
        external_key TEXT NOT NULL UNIQUE,
        brand TEXT NOT NULL,
        customer_phone TEXT NOT NULL DEFAULT '',
        customer_email TEXT NOT NULL DEFAULT '',
        customer_name TEXT NOT NULL DEFAULT '',
        conversation_id TEXT,
        smart_reply_text TEXT DEFAULT '',
        assigned_staff_name TEXT DEFAULT '',
        whatsapp_dispatched INTEGER NOT NULL DEFAULT 0,
        email_dispatched INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
    ],
    "write"
  );

  // 4. marketing.db
  await mkt.batch(
    [
      `CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        language TEXT NOT NULL DEFAULT 'en',
        category TEXT NOT NULL,
        header_text TEXT,
        body_text TEXT NOT NULL,
        footer_text TEXT,
        cta_label TEXT,
        cta_url TEXT,
        approval_status TEXT NOT NULL DEFAULT 'APPROVED',
        sent_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS marketing_lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'ACRIO_SMART',
        acrio_prompt TEXT,
        filter_rules_json TEXT NOT NULL DEFAULT '{}',
        member_phones_json TEXT NOT NULL DEFAULT '[]',
        members_count INTEGER NOT NULL DEFAULT 0,
        created_by_name TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS broadcasts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        list_id TEXT NOT NULL,
        list_name TEXT NOT NULL,
        template_id TEXT NOT NULL,
        template_name TEXT NOT NULL,
        billing_category TEXT NOT NULL DEFAULT 'MARKETING',
        custom_link_code TEXT,
        status TEXT NOT NULL DEFAULT 'COMPLETED',
        total_recipients INTEGER NOT NULL DEFAULT 0,
        sent_count INTEGER NOT NULL DEFAULT 0,
        delivered_count INTEGER NOT NULL DEFAULT 0,
        read_count INTEGER NOT NULL DEFAULT 0,
        client_billed_inr REAL NOT NULL DEFAULT 0,
        actual_meta_cost_inr REAL NOT NULL DEFAULT 0,
        created_by_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS broadcast_queue_settings (
        id TEXT PRIMARY KEY,
        default_pacing_mode TEXT NOT NULL DEFAULT 'SAFE_STEADY',
        delay_seconds INTEGER NOT NULL DEFAULT 4,
        batch_size INTEGER NOT NULL DEFAULT 25,
        batch_pause_seconds INTEGER NOT NULL DEFAULT 20,
        skip_recent_hours INTEGER NOT NULL DEFAULT 24,
        daily_marketing_cap INTEGER NOT NULL DEFAULT 250,
        auto_pause_on_consecutive_failures INTEGER NOT NULL DEFAULT 3,
        quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
        updated_by TEXT NOT NULL DEFAULT 'System',
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS broadcast_recipients (
        id TEXT PRIMARY KEY,
        broadcast_id TEXT NOT NULL,
        customer_name TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL,
        variables_json TEXT NOT NULL DEFAULT '[]',
        rendered_body TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'QUEUED',
        skip_or_error_reason TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        scheduled_at TEXT NOT NULL,
        sent_at TEXT,
        wa_message_id TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_bc_rec_broadcast_status ON broadcast_recipients (broadcast_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_bc_rec_phone_sent ON broadcast_recipients (customer_phone, sent_at)`,
    ],
    "write"
  );

  // Non-destructive column upgrades for marketing.db (Templates Studio + Safe Broadcast Queue)
  const extraMarketingColumns = [
    `ALTER TABLE templates ADD COLUMN header_type TEXT NOT NULL DEFAULT 'NONE'`,
    `ALTER TABLE templates ADD COLUMN header_media_url TEXT`,
    `ALTER TABLE templates ADD COLUMN header_location_json TEXT`,
    `ALTER TABLE templates ADD COLUMN buttons_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE templates ADD COLUMN variables_schema_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE templates ADD COLUMN meta_template_id TEXT`,
    `ALTER TABLE templates ADD COLUMN meta_quality_score TEXT NOT NULL DEFAULT 'GREEN'`,
    `ALTER TABLE templates ADD COLUMN rejection_reason TEXT`,
    `ALTER TABLE templates ADD COLUMN allow_category_change INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE templates ADD COLUMN code_expiration_minutes INTEGER`,
    `ALTER TABLE templates ADD COLUMN created_by_name TEXT DEFAULT 'System'`,
    `ALTER TABLE templates ADD COLUMN updated_at TEXT`,
    `ALTER TABLE templates ADD COLUMN flow_config_json TEXT NOT NULL DEFAULT '{}'`,
    `ALTER TABLE broadcasts ADD COLUMN pacing_mode TEXT NOT NULL DEFAULT 'SAFE_STEADY'`,
    `ALTER TABLE broadcasts ADD COLUMN delay_seconds INTEGER NOT NULL DEFAULT 4`,
    `ALTER TABLE broadcasts ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 25`,
    `ALTER TABLE broadcasts ADD COLUMN batch_pause_seconds INTEGER NOT NULL DEFAULT 20`,
    `ALTER TABLE broadcasts ADD COLUMN skip_recent_hours INTEGER NOT NULL DEFAULT 24`,
    `ALTER TABLE broadcasts ADD COLUMN queued_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE broadcasts ADD COLUMN skipped_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE broadcasts ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE broadcasts ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE broadcasts ADD COLUMN paused_reason TEXT`,
    `ALTER TABLE broadcasts ADD COLUMN scheduled_for TEXT`,
    `ALTER TABLE broadcasts ADD COLUMN next_dispatch_at TEXT`,
    `ALTER TABLE broadcasts ADD COLUMN started_at TEXT`,
    `ALTER TABLE broadcasts ADD COLUMN completed_at TEXT`,
  ];
  for (const ddl of extraMarketingColumns) {
    try {
      await mkt.execute(ddl);
    } catch {
      // Column already exists
    }
  }

  // 5. billing_ops.db
  await bill.batch(
    [
      `CREATE TABLE IF NOT EXISTS pricing_config (
        id TEXT PRIMARY KEY,
        client_marketing_rate_inr REAL NOT NULL DEFAULT 0.95,
        client_other_rate_inr REAL NOT NULL DEFAULT 0.30,
        actual_meta_marketing_rate_inr REAL NOT NULL DEFAULT 0.7846,
        actual_meta_utility_rate_inr REAL NOT NULL DEFAULT 0.115,
        actual_meta_auth_rate_inr REAL NOT NULL DEFAULT 0.115,
        actual_meta_service_rate_inr REAL NOT NULL DEFAULT 0.08,
        currency TEXT NOT NULL DEFAULT 'INR',
        updated_by TEXT DEFAULT 'System',
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS message_billing_ledger (
        id TEXT PRIMARY KEY,
        message_id TEXT,
        broadcast_id TEXT,
        conversation_id TEXT,
        customer_phone TEXT NOT NULL,
        category TEXT NOT NULL,
        client_unit_rate_inr REAL NOT NULL,
        actual_meta_unit_cost_inr REAL NOT NULL,
        margin_inr REAL NOT NULL,
        staff_name TEXT NOT NULL,
        billed_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS backup_settings (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        midnight_hour_ist INTEGER NOT NULL DEFAULT 0,
        midnight_minute_ist INTEGER NOT NULL DEFAULT 0,
        timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
        google_drive_folder_id TEXT DEFAULT '',
        google_service_account_email TEXT DEFAULT '',
        google_private_key TEXT DEFAULT '',
        google_oauth_refresh_token TEXT DEFAULT '',
        google_client_id TEXT DEFAULT '',
        google_client_secret TEXT DEFAULT '',
        retention_days INTEGER NOT NULL DEFAULT 30,
        include_main_website_db INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        last_run_status TEXT,
        updated_by TEXT DEFAULT 'System',
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS backup_logs (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        trigger_source TEXT NOT NULL,
        status TEXT NOT NULL,
        databases_count INTEGER NOT NULL DEFAULT 6,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        local_folder_path TEXT NOT NULL,
        google_drive_file_id TEXT,
        google_drive_link TEXT,
        details_message TEXT NOT NULL
      )`,
    ],
    "write"
  );

  // 6. queue_jobs.db
  await queue.batch(
    [
      `CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        queue_name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        run_after TEXT NOT NULL,
        error_text TEXT,
        processed_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS worker_heartbeats (
        worker_name TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        last_beat_at TEXT NOT NULL,
        processed_count INTEGER NOT NULL DEFAULT 0,
        info_json TEXT DEFAULT '{}'
      )`,
    ],
    "write"
  );

  await seedInitialOperationalData();
}

async function seedInitialOperationalData(): Promise<void> {
  const bill = getRawLibSqlClient("billing_ops");
  const crm = getRawLibSqlClient("crm_orders");
  const conv = getRawLibSqlClient("conversations");
  const mkt = getRawLibSqlClient("marketing");
  const auth = getRawLibSqlClient("core_auth");

  const now = new Date();
  const isoNow = now.toISOString();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
  const yesterday = new Date(now.getTime() - 22 * 60 * 60 * 1000).toISOString();
  const windowOpen = new Date(now.getTime() + 20 * 60 * 60 * 1000).toISOString();

  // Default Pricing Config (0.95 Marketing, 0.30 Other/Auth/Utility for Admins & Client; Actual Meta Cost for Dev)
  const existingPricing = await bill.execute(`SELECT COUNT(*) as cnt FROM pricing_config`);
  if (Number(existingPricing.rows[0]?.cnt ?? 0) === 0) {
    await bill.execute({
      sql: `INSERT INTO pricing_config (
        id, client_marketing_rate_inr, client_other_rate_inr,
        actual_meta_marketing_rate_inr, actual_meta_utility_rate_inr,
        actual_meta_auth_rate_inr, actual_meta_service_rate_inr, currency, updated_by, updated_at
      ) VALUES ('default', 0.95, 0.30, 0.7846, 0.115, 0.115, 0.08, 'INR', 'System Bootstrap', ?)`,
      args: [isoNow],
    });
  }

  // Default Midnight Google Drive Backup Config
  const existingBackup = await bill.execute(`SELECT COUNT(*) as cnt FROM backup_settings`);
  if (Number(existingBackup.rows[0]?.cnt ?? 0) === 0) {
    await bill.execute({
      sql: `INSERT INTO backup_settings (
        id, enabled, midnight_hour_ist, midnight_minute_ist, timezone,
        retention_days, include_main_website_db, updated_by, updated_at
      ) VALUES ('default', 1, 0, 0, 'Asia/Kolkata', 30, 1, 'System Bootstrap', ?)`,
      args: [isoNow],
    });
  }

  // Seed & sync Facebook/Meta WhatsApp setup + Dual Anthropic keys from .env
  resolveMonorepoRoot();
  const envMeta = resolveEnvMetaWhatsAppConfig();
  const existingMetaSetup = await auth.execute(
    `SELECT value_json FROM setup_state WHERE key = 'facebook_whatsapp_config' LIMIT 1`
  );
  if (!existingMetaSetup.rows[0]?.value_json) {
    await auth.execute({
      sql: `INSERT INTO setup_state (key, value_json, updated_at) VALUES (?, ?, ?)`,
      args: [
        "facebook_whatsapp_config",
        JSON.stringify({
          mode: envMeta.mode,
          businessPortfolioId: envMeta.businessPortfolioId,
          metaAppId: envMeta.metaAppId,
          metaAppSecret: envMeta.metaAppSecret,
          wabaId: envMeta.wabaId,
          phoneNumberId: envMeta.phoneNumberId,
          businessDisplayPhone: envMeta.businessDisplayPhone,
          verifiedName: envMeta.verifiedName,
          systemUserAccessToken: envMeta.systemUserAccessToken,
          webhookVerifyToken: envMeta.webhookVerifyToken,
          stepsCompleted: {
            metaBusinessVerified: Boolean(envMeta.businessPortfolioId || envMeta.wabaId),
            whatsappAppCreated: envMeta.hasLiveCredentials,
            phoneRegistered: Boolean(envMeta.phoneNumberId),
            webhookSubscribed: envMeta.hasLiveCredentials,
            systemTokenSaved: Boolean(envMeta.systemUserAccessToken),
          },
        }),
        isoNow,
      ],
    });
  } else if (envMeta.hasLiveCredentials) {
    try {
      const cur = JSON.parse(String(existingMetaSetup.rows[0].value_json));
      const needsSeed =
        !cur.phoneNumberId ||
        !cur.systemUserAccessToken ||
        !cur.wabaId ||
        !cur.businessPortfolioId ||
        cur.businessDisplayPhone === "+91 73372 22876";
      if (needsSeed) {
        const merged = {
          ...cur,
          mode: envMeta.mode,
          businessPortfolioId: cur.businessPortfolioId || envMeta.businessPortfolioId,
          metaAppId: cur.metaAppId || envMeta.metaAppId,
          metaAppSecret: cur.metaAppSecret || envMeta.metaAppSecret,
          wabaId: cur.wabaId || envMeta.wabaId,
          phoneNumberId: cur.phoneNumberId || envMeta.phoneNumberId,
          businessDisplayPhone:
            !cur.businessDisplayPhone || cur.businessDisplayPhone === "+91 73372 22876"
              ? envMeta.businessDisplayPhone
              : cur.businessDisplayPhone,
          verifiedName: cur.verifiedName || envMeta.verifiedName,
          systemUserAccessToken:
            cur.systemUserAccessToken || envMeta.systemUserAccessToken,
          webhookVerifyToken: cur.webhookVerifyToken || envMeta.webhookVerifyToken,
          stepsCompleted: {
            metaBusinessVerified: true,
            whatsappAppCreated: true,
            phoneRegistered: true,
            webhookSubscribed: true,
            systemTokenSaved: true,
            ...(cur.stepsCompleted || {}),
          },
        };
        merged.stepsCompleted = {
          metaBusinessVerified: true,
          whatsappAppCreated: true,
          phoneRegistered: true,
          webhookSubscribed: true,
          systemTokenSaved: true,
        };
        await auth.execute({
          sql: `UPDATE setup_state SET value_json = ?, updated_at = ? WHERE key = 'facebook_whatsapp_config'`,
          args: [JSON.stringify(merged), isoNow],
        });
      }
    } catch {
      // Keep existing
    }
  }

  // Seed dual ACRIO Anthropic keys (client_key & admin_key) from .env into setup_state
  const envClientKey = (process.env.ANTHROPIC_CLIENT_API_KEY || "").trim();
  const envAdminKey = (process.env.ANTHROPIC_ADMIN_API_KEY || "").trim();
  if (envClientKey || envAdminKey) {
    const existingAi = await auth.execute(
      `SELECT value_json FROM setup_state WHERE key = 'ai_config' LIMIT 1`
    );
    let parsedAi: Record<string, unknown> = {};
    if (existingAi.rows[0]?.value_json) {
      try {
        parsedAi = JSON.parse(String(existingAi.rows[0].value_json));
      } catch {
        parsedAi = {};
      }
    }
    if (!parsedAi.clientApiKey || !parsedAi.adminApiKey) {
      const nextAi = {
        ...parsedAi,
        anthropicApiKey: String(parsedAi.anthropicApiKey || envClientKey || envAdminKey),
        clientApiKey: String(parsedAi.clientApiKey || envClientKey || envAdminKey),
        adminApiKey: String(parsedAi.adminApiKey || envAdminKey || envClientKey),
        model: "claude-haiku-5-5",
      };
      await auth.execute({
        sql: `INSERT INTO setup_state (key, value_json, updated_at)
              VALUES ('ai_config', ?, ?)
              ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        args: [JSON.stringify(nextAi), isoNow],
      });
    }
  }

  const shouldSeedDemoData = process.env.SEED_DEMO_DATA === "1";

  // Seed realistic CRM customers, orders & past relations ONLY when SEED_DEMO_DATA=1
  const existingCustomers = await crm.execute(`SELECT COUNT(*) as cnt FROM customers`);
  if (shouldSeedDemoData && Number(existingCustomers.rows[0]?.cnt ?? 0) === 0) {
    await crm.batch(
      [
        {
          sql: `INSERT INTO customers (
            id, phone, name, email, company_name, organization_type, city, gst_number,
            acrio_segment, tags_json, lifetime_value_inr, total_orders_count, opt_in_marketing, notes, last_interaction_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "cust_taj_hyd",
            "+919848011223",
            "Vikram Reddy",
            "procurement@deccanbanquets.in",
            "Deccan Grand Hotel & Banquets",
            "Hotel/Hospitality",
            "Hyderabad",
            "36AABCU9603R1ZM",
            "Repeat Hospitality Buyer",
            JSON.stringify(["VIP", "Hotel Chain", "Logo Engraving"]),
            84500,
            3,
            1,
            "Prefers 12mm thick imported cast acrylic with warm LED base and gold front hotel crest.",
            oneHourAgo,
            yesterday,
          ],
        },
        {
          sql: `INSERT INTO customers (
            id, phone, name, email, company_name, organization_type, city, gst_number,
            acrio_segment, tags_json, lifetime_value_inr, total_orders_count, opt_in_marketing, notes, last_interaction_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "cust_st_joseph",
            "+919900145678",
            "Dr. Meenakshi Iyer",
            "principal@stjosephscollege.edu.in",
            "St. Joseph's Autonomous College",
            "School/College",
            "Bengaluru",
            "29AAATS4421P1Z8",
            "Education Bulk Awards",
            JSON.stringify(["Convocation", "Student Awards", "Auditorium"]),
            46200,
            2,
            1,
            "Orders annual convocation mementos + auditorium podium accessories every semester.",
            threeHoursAgo,
            yesterday,
          ],
        },
        {
          sql: `INSERT INTO customers (
            id, phone, name, email, company_name, organization_type, city, gst_number,
            acrio_segment, tags_json, lifetime_value_inr, total_orders_count, opt_in_marketing, notes, last_interaction_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "cust_arjun_eng",
            "+919701234500",
            "Arjun Deshmukh",
            "arjun.d@precisionautomation.co.in",
            "Precision Automation Systems",
            "Engineering/Industrial",
            "Pune",
            "27AAACP8891K1Z2",
            "Custom Industrial Enclosures",
            JSON.stringify(["Machine Guard", "Cut-to-Size", "Drawing Shared"]),
            19800,
            1,
            1,
            "Requires clear protective machine covers with CNC cutouts as per CAD dimensions.",
            yesterday,
            yesterday,
          ],
        },
      ],
      "write"
    );

    // Seed Customer Orders
    await crm.batch(
      [
        {
          sql: `INSERT INTO customer_orders (
            id, order_number, customer_id, customer_phone, items_summary, quantity,
            total_amount_inr, payment_status, fulfillment_status, invoice_url, ordered_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "ord_1001",
            "CC-2026-1042",
            "cust_taj_hyd",
            "+919848011223",
            "2x Clear LED Banquet Podium CCP-053 + 40x A5 Acrylic Menu Tent Holders",
            42,
            62500,
            "PAID",
            "DELIVERED",
            "/shop/p/acrylic-podium-ccp053",
            "2026-09-18T11:20:00.000Z",
          ],
        },
        {
          sql: `INSERT INTO customer_orders (
            id, order_number, customer_id, customer_phone, items_summary, quantity,
            total_amount_inr, payment_status, fulfillment_status, invoice_url, ordered_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "ord_1002",
            "CC-2026-1089",
            "cust_taj_hyd",
            "+919848011223",
            "25x Reception QR & Sign Stands with Hotel Crest Print",
            25,
            22000,
            "ADVANCE_PAID",
            "IN_PRODUCTION",
            "/shop/p/a4-t-stand-1",
            yesterday,
          ],
        },
        {
          sql: `INSERT INTO customer_orders (
            id, order_number, customer_id, customer_phone, items_summary, quantity,
            total_amount_inr, payment_status, fulfillment_status, invoice_url, ordered_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "ord_1003",
            "CC-2026-1064",
            "cust_st_joseph",
            "+919900145678",
            "35x Crystal Flame Student Appreciation Mementos",
            35,
            46200,
            "PAID",
            "DELIVERED",
            "/shop",
            "2026-10-05T09:30:00.000Z",
          ],
        },
        {
          sql: `INSERT INTO customer_orders (
            id, order_number, customer_id, customer_phone, items_summary, quantity,
            total_amount_inr, payment_status, fulfillment_status, invoice_url, ordered_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "ord_1004",
            "CC-2026-1095",
            "cust_arjun_eng",
            "+919701234500",
            "4x Custom 8mm Clear Acrylic CNC Machine Safety Covers",
            4,
            19800,
            "QUOTE_SENT",
            "DESIGN_PENDING",
            "/contact",
            yesterday,
          ],
        },
      ],
      "write"
    );

    // Seed Previous Relations History
    await crm.batch(
      [
        {
          sql: `INSERT INTO customer_relations (
            id, customer_id, customer_phone, relation_type, summary, handled_by, occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "rel_1",
            "cust_taj_hyd",
            "+919848011223",
            "REPEAT_BUYER",
            "Delivered 2 custom banquet podiums in Secunderabad; client rated finish 5/5 and asked for matching menu holders.",
            "Factory Dispatch Desk",
            "2026-09-22T15:00:00.000Z",
          ],
        },
        {
          sql: `INSERT INTO customer_relations (
            id, customer_id, customer_phone, relation_type, summary, handled_by, occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "rel_2",
            "cust_st_joseph",
            "+919900145678",
            "WEBSITE_ENQUIRY",
            "Submitted enquiry via ACRIO search for 60 student graduation mementos + 1 auditorium lectern.",
            "ACRIO Web Concierge",
            threeHoursAgo,
          ],
        },
        {
          sql: `INSERT INTO customer_relations (
            id, customer_id, customer_phone, relation_type, summary, handled_by, occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "rel_3",
            "cust_arjun_eng",
            "+919701234500",
            "CUSTOM_FABRICATION",
            "Shared PDF drawing for 600x450x300mm clear polycarbonate/acrylic guard cover with hinge slot.",
            "Custom Engineering Team",
            yesterday,
          ],
        },
      ],
      "write"
    );
  }

  // Seed demo Conversations, Messages, Automations & Custom Admin Links ONLY when SEED_DEMO_DATA=1
  const existingConvs = await conv.execute(`SELECT COUNT(*) as cnt FROM conversations`);
  if (shouldSeedDemoData && Number(existingConvs.rows[0]?.cnt ?? 0) === 0) {
    await conv.batch(
      [
        {
          sql: `INSERT INTO conversations (
            id, customer_phone, customer_name, customer_id, status, priority, smart_category,
            unread_count, last_message_preview, last_message_at, window_expires_at, tags_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "conv_taj",
            "+919848011223",
            "Vikram Reddy (Deccan Grand Hotel)",
            "cust_taj_hyd",
            "OPEN",
            "HIGH",
            "Hotel & Banquet",
            2,
            "Can we add 1 more wide-top acrylic podium with our hotel logo before Friday's conference?",
            oneHourAgo,
            windowOpen,
            JSON.stringify(["Hotel", "Urgent Friday", "Repeat Client"]),
            yesterday,
          ],
        },
        {
          sql: `INSERT INTO conversations (
            id, customer_phone, customer_name, customer_id, status, priority, smart_category,
            unread_count, last_message_preview, last_message_at, window_expires_at, tags_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "conv_college",
            "+919900145678",
            "Dr. Meenakshi Iyer (St. Joseph's)",
            "cust_st_joseph",
            "OPEN",
            "NORMAL",
            "Awards & Trophies",
            1,
            "Please share options for 60 student merit awards under Rs 1,400 each with college crest.",
            threeHoursAgo,
            windowOpen,
            JSON.stringify(["Student Awards", "Bulk 60 pcs"]),
            yesterday,
          ],
        },
        {
          sql: `INSERT INTO conversations (
            id, customer_phone, customer_name, customer_id, status, priority, smart_category,
            unread_count, last_message_preview, last_message_at, window_expires_at, resolution_summary, resolved_by_name, resolved_at, tags_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "conv_engineer",
            "+919701234500",
            "Arjun Deshmukh (Precision Automation)",
            "cust_arjun_eng",
            "RESOLVED",
            "NORMAL",
            "Custom Fabrication",
            0,
            "Received the custom quote link, our accounts team is processing the 50% advance today.",
            yesterday,
            yesterday,
            "Confirmed 8mm cast acrylic CNC cover specs and shared custom quote link https://chat.ccapl.cc/l/pune-guard-quote. Client confirmed 50% advance.",
            "ACRIO Smart Resolution",
            yesterday,
            JSON.stringify(["Engineering", "Quote Sent"]),
            yesterday,
          ],
        },
      ],
      "write"
    );

    await conv.batch(
      [
        {
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, delivery_status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "msg_1",
            "conv_taj",
            "INBOUND",
            "CUSTOMER",
            "Vikram Reddy",
            "TEXT",
            "SERVICE",
            "Hi Classic Concepts team! Our 25 QR sign stands order CC-2026-1089 is in production right?",
            "READ",
            threeHoursAgo,
          ],
        },
        {
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, delivery_status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "msg_2",
            "conv_taj",
            "INBOUND",
            "CUSTOMER",
            "Vikram Reddy",
            "TEXT",
            "SERVICE",
            "Can we add 1 more wide-top acrylic podium with our hotel logo before Friday's conference?",
            "DELIVERED",
            oneHourAgo,
          ],
        },
        {
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, delivery_status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "msg_3",
            "conv_college",
            "INBOUND",
            "CUSTOMER",
            "Dr. Meenakshi Iyer",
            "TEXT",
            "SERVICE",
            "Hello! Please share options for 60 student merit awards under Rs 1,400 each with our college crest printed.",
            "DELIVERED",
            threeHoursAgo,
          ],
        },
        {
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, delivery_status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "msg_4",
            "conv_engineer",
            "OUTBOUND",
            "STAFF",
            "Sales Desk",
            "CUSTOM_LINK",
            "UTILITY",
            "Hello Arjun! Here is your custom 8mm CNC safety cover specification & quote link: https://chat.ccapl.cc/l/pune-guard-quote",
            "READ",
            yesterday,
          ],
        },
        {
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, delivery_status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "msg_5",
            "conv_engineer",
            "INBOUND",
            "CUSTOMER",
            "Arjun Deshmukh",
            "TEXT",
            "SERVICE",
            "Received the custom quote link, our accounts team is processing the 50% advance today.",
            "READ",
            yesterday,
          ],
        },
      ],
      "write"
    );

    // Automations
    await conv.batch(
      [
        {
          sql: `INSERT INTO automations (
            id, name, description, trigger_type, trigger_condition, action_type, action_payload_json, is_enabled, runs_count, last_triggered_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "auto_podium_tag",
            "ACRIO Podium & Stage Categoriser",
            "Automatically tags conversations mentioning podium, lectern, pulpit, or auditorium as 'Podiums & Stage' and raises priority.",
            "KEYWORD",
            "podium,lectern,pulpit,auditorium,stage",
            "SMART_TAG",
            JSON.stringify({ smartCategory: "Podiums & Stage", priority: "HIGH" }),
            1,
            18,
            oneHourAgo,
            isoNow,
          ],
        },
        {
          sql: `INSERT INTO automations (
            id, name, description, trigger_type, trigger_condition, action_type, action_payload_json, is_enabled, runs_count, last_triggered_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "auto_bulk_award",
            "Bulk Trophy & College Enquiry Router",
            "Detects bulk student awards or trophy enquiries and prepares ACRIO plain-English catalog draft.",
            "KEYWORD",
            "trophy,trophies,memento,awards,students,convocation",
            "SMART_TAG",
            JSON.stringify({ smartCategory: "Awards & Trophies", priority: "HIGH" }),
            1,
            11,
            threeHoursAgo,
            isoNow,
          ],
        },
        {
          sql: `INSERT INTO automations (
            id, name, description, trigger_type, trigger_condition, action_type, action_payload_json, is_enabled, runs_count, last_triggered_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "auto_welcome_first",
            "Instant First-Contact Greeting",
            "Sends a warm plain-English welcome when a new WhatsApp number messages outside business hours.",
            "FIRST_CONTACT",
            "new_conversation",
            "AUTO_REPLY",
            JSON.stringify({
              replyText:
                "Hello from Classic Concepts! Thank you for messaging us. A team member is reviewing your requirement and will share options shortly.",
            }),
            1,
            29,
            yesterday,
            isoNow,
          ],
        },
      ],
      "write"
    );

    // Custom Admin Links
    await conv.batch(
      [
        {
          sql: `INSERT INTO custom_links (
            id, code, title, target_url, link_type, product_slug, utm_campaign, created_by_name, clicks_count, last_clicked_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "lnk_1",
            "stage-podiums",
            "Flagship Clear Stage Podiums Collection",
            "https://www.classicconcepts.in/podiums?utm_source=whatsapp&utm_medium=staff_link",
            "CATALOG",
            "acrylic-podium-ccp053",
            "wa_podium_showcase",
            "Admin Team",
            34,
            oneHourAgo,
            isoNow,
          ],
        },
        {
          sql: `INSERT INTO custom_links (
            id, code, title, target_url, link_type, product_slug, utm_campaign, created_by_name, clicks_count, last_clicked_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "lnk_2",
            "student-awards",
            "Student Trophies & Mementos Catalog",
            "https://www.classicconcepts.in/shop?q=memento&utm_source=whatsapp",
            "PRODUCT",
            "acrylic-ganesha-flame-memento",
            "wa_education_awards",
            "Admin Team",
            21,
            threeHoursAgo,
            isoNow,
          ],
        },
        {
          sql: `INSERT INTO custom_links (
            id, code, title, target_url, link_type, product_slug, utm_campaign, created_by_name, clicks_count, last_clicked_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "lnk_3",
            "pune-guard-quote",
            "Custom 8mm CNC Machine Safety Cover Quote",
            "https://www.classicconcepts.in/contact?ref=CC-2026-1095",
            "QUOTE_PAYMENT",
            null,
            "wa_custom_quote",
            "Admin Team",
            6,
            yesterday,
            isoNow,
          ],
        },
      ],
      "write"
    );
  }

  // Ensure starter Utility/Auth templates exist (0 fake sent_count in production; demo lists/broadcasts/ledger only when SEED_DEMO_DATA=1)
  const existingTemplates = await mkt.execute(`SELECT COUNT(*) as cnt FROM templates`);
  if (Number(existingTemplates.rows[0]?.cnt ?? 0) === 0) {
    await mkt.batch(
      [
        ...(shouldSeedDemoData
          ? [
              {
                sql: `INSERT INTO templates (
                  id, name, language, category, header_text, body_text, footer_text, cta_label, cta_url, approval_status, sent_count, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                  "tpl_hospitality_showcase",
                  "hospitality_podium_menu_2026",
                  "en",
                  "MARKETING",
                  "New Clear Podiums & Menu Stands for Hotels",
                  "Hello {{1}}, explore our latest crystal-clear banquet podiums and tabletop menu holders crafted for hotels and convention halls.",
                  "Classic Concepts • Reply STOP to opt out",
                  "View Hotel Collection",
                  "https://ccapl.cc/stage-podiums",
                  "APPROVED",
                  120,
                  isoNow,
                ],
              },
              {
                sql: `INSERT INTO templates (
                  id, name, language, category, header_text, body_text, footer_text, cta_label, cta_url, approval_status, sent_count, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                  "tpl_college_awards",
                  "convocation_awards_season",
                  "en",
                  "MARKETING",
                  "Student Trophies & Auditorium Podiums",
                  "Hello {{1}}, planning an upcoming college event or convocation? Check our ready-to-print acrylic trophies, plaques, and stage podiums.",
                  "Classic Concepts • Since 2008",
                  "See Award Options",
                  "https://ccapl.cc/student-awards",
                  "APPROVED",
                  85,
                  isoNow,
                ],
              },
            ]
          : []),
        {
          sql: `INSERT INTO templates (
            id, name, language, category, header_text, body_text, footer_text, cta_label, cta_url, approval_status, sent_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "tpl_order_dispatch",
            "cc_order_status_update",
            "en",
            "UTILITY",
            "Order Update from Classic Concepts",
            "Hello {{1}}, your order {{2}} is now {{3}}. Reply here anytime if you need delivery assistance.",
            "Classic Concepts Support Desk",
            null,
            null,
            shouldSeedDemoData ? "APPROVED" : "DRAFT",
            shouldSeedDemoData ? 64 : 0,
            isoNow,
          ],
        },
        {
          sql: `INSERT INTO templates (
            id, name, language, category, header_text, body_text, footer_text, cta_label, cta_url, approval_status, sent_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "tpl_staff_verify_otp",
            "cc_staff_login_otp",
            "en",
            "AUTHENTICATION",
            null,
            "{{1}} is your Classic Concepts verification code. Valid for 10 minutes.",
            null,
            null,
            null,
            shouldSeedDemoData ? "APPROVED" : "DRAFT",
            shouldSeedDemoData ? 19 : 0,
            isoNow,
          ],
        },
      ],
      "write"
    );
  }

  // Always ensure the dynamic Order Tracking button Utility template draft is available to submit to Meta
  await mkt.execute({
    sql: `INSERT OR IGNORE INTO templates (
      id, name, language, category, header_type, header_text, body_text, footer_text,
      cta_label, cta_url, buttons_json, variables_schema_json, approval_status, sent_count, created_at, updated_at
    ) VALUES (?, ?, 'en', 'UTILITY', 'TEXT', ?, ?, ?, 'Track Order', 'https://track.ccapl.cc/{{1}}', ?, ?, ?, 0, ?, ?)`,
    args: [
      "tpl_order_tracking_btn",
      "cc_order_tracking_dispatch",
      "Order Dispatched",
      "Hello {{1}}, your order {{2}} has been dispatched via {{3}}. Tap Track Order below to check live delivery status.",
      "Classic Concepts & Classic Edge 53",
      JSON.stringify([
        {
          id: "btn_track_dyn_1",
          type: "URL",
          text: "Track Order",
          url: "https://track.ccapl.cc/{{1}}",
          urlType: "DYNAMIC",
          exampleSuffix: "CC-2026-1089",
        },
      ]),
      JSON.stringify([
        {
          index: 1,
          label: "Customer First Name",
          sourceField: "customer.firstName",
          sampleValue: "Customer",
        },
        {
          index: 2,
          label: "Order ID",
          sourceField: "order.latestNumber",
          sampleValue: "CC-2026-1089",
        },
        {
          index: 3,
          label: "Courier Partner",
          sourceField: "custom",
          sampleValue: "Delhivery",
        },
      ]),
      shouldSeedDemoData ? "APPROVED" : "DRAFT",
      isoNow,
      isoNow,
    ],
  });

  // Strict Meta Template Policy: in live production (without demo seed), any local template that has NOT been synced/approved by Meta (no meta_template_id) must stay DRAFT until submitted & approved on Meta!
  if (!shouldSeedDemoData && envMeta.hasLiveCredentials) {
    await mkt.execute(`
      UPDATE templates
      SET approval_status = 'DRAFT'
      WHERE approval_status = 'APPROVED'
        AND (meta_template_id IS NULL OR TRIM(meta_template_id) = '')
    `);
  }

  if (shouldSeedDemoData && Number(existingTemplates.rows[0]?.cnt ?? 0) === 0) {
    await mkt.batch(
      [
        {
          sql: `INSERT INTO marketing_lists (
            id, name, description, source_type, acrio_prompt, filter_rules_json, member_phones_json, members_count, created_by_name, updated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "lst_hotels",
            "ACRIO: Repeat Hotel & Banquet Buyers",
            "Hotels, resorts, and convention halls with past podium or menu holder orders.",
            "ACRIO_SMART",
            "Find all hotel and banquet customers who opted in to updates or bought podiums/stands",
            JSON.stringify({ organizationType: "Hotel/Hospitality", optIn: true }),
            JSON.stringify(["+919848011223"]),
            1,
            "ACRIO Segment Engine",
            isoNow,
            isoNow,
          ],
        },
        {
          sql: `INSERT INTO marketing_lists (
            id, name, description, source_type, acrio_prompt, filter_rules_json, member_phones_json, members_count, created_by_name, updated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "lst_colleges",
            "ACRIO: Schools, Colleges & Award Buyers",
            "Educational institutions interested in student trophies, mementos, and auditorium podiums.",
            "ACRIO_SMART",
            "Schools, colleges, and principals looking for student awards or stage podiums",
            JSON.stringify({ organizationType: "School/College", optIn: true }),
            JSON.stringify(["+919900145678"]),
            1,
            "ACRIO Segment Engine",
            isoNow,
            isoNow,
          ],
        },
      ],
      "write"
    );

    await mkt.execute({
      sql: `INSERT INTO broadcasts (
        id, name, list_id, list_name, template_id, template_name, billing_category,
        custom_link_code, status, total_recipients, sent_count, delivered_count, read_count,
        client_billed_inr, actual_meta_cost_inr, created_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "bc_sample_1",
        "Autumn Hospitality Podium Showcase",
        "lst_hotels",
        "ACRIO: Repeat Hotel & Banquet Buyers",
        "tpl_hospitality_showcase",
        "hospitality_podium_menu_2026",
        "MARKETING",
        "stage-podiums",
        "COMPLETED",
        120,
        120,
        117,
        89,
        Number((120 * 0.95).toFixed(2)),
        Number((120 * 0.7846).toFixed(2)),
        "Operations Admin",
        yesterday,
      ],
    });
  }

  // Seed representative Message Billing Ledger rows ONLY when SEED_DEMO_DATA=1
  const existingLedger = await bill.execute(`SELECT COUNT(*) as cnt FROM message_billing_ledger`);
  if (shouldSeedDemoData && Number(existingLedger.rows[0]?.cnt ?? 0) === 0) {
    const sampleRows: {
      id: string;
      cat: "MARKETING" | "UTILITY" | "AUTHENTICATION" | "ACRIO";
      phone: string;
      clientRate: number;
      metaCost: number;
      staff: string;
      at: string;
    }[] = [
      { id: "ldg_1", cat: "MARKETING", phone: "+919848011223", clientRate: 0.95, metaCost: 0.7846, staff: "Campaign Broadcast", at: yesterday },
      { id: "ldg_2", cat: "MARKETING", phone: "+919900145678", clientRate: 0.95, metaCost: 0.7846, staff: "Campaign Broadcast", at: yesterday },
      { id: "ldg_3", cat: "MARKETING", phone: "+919848099112", clientRate: 0.95, metaCost: 0.7846, staff: "Campaign Broadcast", at: threeHoursAgo },
      { id: "ldg_4", cat: "UTILITY", phone: "+919701234500", clientRate: 0.30, metaCost: 0.115, staff: "Order Template", at: yesterday },
      { id: "ldg_5", cat: "UTILITY", phone: "+919848011223", clientRate: 0.30, metaCost: 0.115, staff: "Dispatch Template", at: threeHoursAgo },
      { id: "ldg_6", cat: "AUTHENTICATION", phone: "+919000112233", clientRate: 0.30, metaCost: 0.115, staff: "OTP Template", at: oneHourAgo },
      { id: "ldg_7", cat: "ACRIO", phone: "+919900145678", clientRate: 0.30, metaCost: 0.04, staff: "ACRIO Auto-Handler", at: oneHourAgo },
    ];

    for (const r of sampleRows) {
      await bill.execute({
        sql: `INSERT INTO message_billing_ledger (
          id, customer_phone, category, client_unit_rate_inr, actual_meta_unit_cost_inr, margin_inr, staff_name, billed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          r.id,
          r.phone,
          r.cat,
          r.clientRate,
          r.metaCost,
          Number((r.clientRate - r.metaCost).toFixed(4)),
          r.staff,
          r.at,
        ],
      });
    }
  }

  // Seed default Teams structure if none exist yet (demo staff accounts ONLY when SEED_DEMO_DATA=1)
  const existingTeams = await conv.execute(`SELECT COUNT(*) as cnt FROM teams`);
  if (Number(existingTeams.rows[0]?.cnt ?? 0) === 0) {
    await conv.batch(
      [
        {
          sql: `INSERT INTO teams (
            id, name, description, brand_scope, routing_keywords, priority_rank, p0_wait_minutes, p1_wait_minutes, auto_assign_enabled, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "team_sales",
            "Sales Team",
            "Default handoff team from ACRIO. Handles acrylic podiums, trophies, awards, hotel stands, signage, and quotes.",
            "ALL",
            "podium, lectern, trophy, memento, award, hotel, banquet, stand, holder, box, price, quote, bulk",
            1,
            5,
            12,
            1,
            isoNow,
          ],
        },
        {
          sql: `INSERT INTO teams (
            id, name, description, brand_scope, routing_keywords, priority_rank, p0_wait_minutes, p1_wait_minutes, auto_assign_enabled, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "team_ce53_machines",
            "Classic Edge 53 Machines Team",
            "Handles CNC, diamond edge polishers, acrylic benders, heaters, and machine consumables.",
            "CLASSIC_EDGE_53",
            "machine, polisher, diamond, laser, router, bender, bending, heater, yn-jw, consumable, blade, classic edge",
            2,
            4,
            10,
            1,
            isoNow,
          ],
        },
        {
          sql: `INSERT INTO teams (
            id, name, description, brand_scope, routing_keywords, priority_rank, p0_wait_minutes, p1_wait_minutes, auto_assign_enabled, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "team_custom_fab",
            "Custom Fabrication Team",
            "Handles custom sizes, drawings, industrial safety guards, and special acrylic builds.",
            "CLASSIC_CONCEPTS",
            "custom, drawing, mm, inch, thickness, enclosure, guard, cover, fabrication",
            3,
            6,
            15,
            1,
            isoNow,
          ],
        },
        {
          sql: `INSERT INTO teams (
            id, name, description, brand_scope, routing_keywords, priority_rank, p0_wait_minutes, p1_wait_minutes, auto_assign_enabled, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "team_support",
            "Orders & Dispatch Team",
            "Handles payment confirmation, GST invoices, courier tracking, and dispatch updates.",
            "ALL",
            "order, dispatch, courier, tracking, invoice, gst, payment, delivery",
            4,
            5,
            12,
            1,
            isoNow,
          ],
        },
      ],
      "write"
    );

    if (shouldSeedDemoData) {
      const activeUsersRes = await auth.execute(
        `SELECT id, name, email, role FROM users WHERE status = 'ACTIVE' ORDER BY created_at ASC`
      );
      const ensureDemoStaff = [
        {
          id: "usr_sales_p0",
          name: "Rohan Kulkarni",
          email: "rohan.kulkarni@classiconcepts.in",
          phone: "+919848022101",
          role: "STAFF",
          dept: "Sales Team",
        },
        {
          id: "usr_sales_p1",
          name: "Ananya Deshmukh",
          email: "ananya.deshmukh@classiconcepts.in",
          phone: "+919848022102",
          role: "ADMIN",
          dept: "Senior Sales & Hospitality",
        },
        {
          id: "usr_ce53_p0",
          name: "Karthik Nair",
          email: "karthik.nair@classiconcepts.in",
          phone: "+919848022103",
          role: "STAFF",
          dept: "Classic Edge 53 Machines",
        },
      ];
      for (const st of ensureDemoStaff) {
        const check = await auth.execute({
          sql: `SELECT id FROM users WHERE email = ? LIMIT 1`,
          args: [st.email],
        });
        if (check.rows.length === 0) {
          await auth.execute({
            sql: `INSERT INTO users (
              id, name, email, whatsapp_number, password_hash, role, status,
              department, email_verified_at, onboarding_completed_at, approved_by_name, approved_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 'System', ?, ?)`,
            args: [
              st.id,
              st.name,
              st.email,
              st.phone,
              "$2b$10$CwTycUXWue0Thq9StjUM0uJ8h0R6V5G7y1p2zK6X8n4vZ1Q8m9W2a",
              st.role,
              st.dept,
              isoNow,
              isoNow,
              isoNow,
              isoNow,
            ],
          });
        }
      }

      const refreshedUsers = await auth.execute(
        `SELECT id, name, email, role FROM users WHERE status = 'ACTIVE' ORDER BY created_at ASC`
      );
      const activePool =
        refreshedUsers.rows.length > 0 ? refreshedUsers.rows : activeUsersRes.rows;
      const findByEmail = (em: string) =>
        activePool.find((u) => String(u.email) === em) || activePool[0];
      const leadUser =
        activePool.find(
          (u) => String(u.role) === "DEV" || String(u.role) === "SUPERADMIN"
        ) || activePool[0];

      const p0Sales = findByEmail("rohan.kulkarni@classiconcepts.in");
      const p1Sales = findByEmail("ananya.deshmukh@classiconcepts.in");
      const p0Machines = findByEmail("karthik.nair@classiconcepts.in");

      const memberSeeds: {
        id: string;
        teamId: string;
        user: Record<string, unknown> | undefined;
        tier: "P0" | "P1" | "P2";
      }[] = [
        { id: "tm_sales_p0", teamId: "team_sales", user: p0Sales, tier: "P0" },
        { id: "tm_sales_p1", teamId: "team_sales", user: p1Sales, tier: "P1" },
        { id: "tm_sales_p2", teamId: "team_sales", user: leadUser, tier: "P2" },
        { id: "tm_ce53_p0", teamId: "team_ce53_machines", user: p0Machines, tier: "P0" },
        { id: "tm_ce53_p1", teamId: "team_ce53_machines", user: p1Sales, tier: "P1" },
        { id: "tm_ce53_p2", teamId: "team_ce53_machines", user: leadUser, tier: "P2" },
        { id: "tm_fab_p0", teamId: "team_custom_fab", user: p1Sales, tier: "P0" },
        { id: "tm_fab_p1", teamId: "team_custom_fab", user: p0Sales, tier: "P1" },
        { id: "tm_fab_p2", teamId: "team_custom_fab", user: leadUser, tier: "P2" },
        { id: "tm_sup_p0", teamId: "team_support", user: p0Sales, tier: "P0" },
        { id: "tm_sup_p1", teamId: "team_support", user: p1Sales, tier: "P1" },
      ];

      for (const ms of memberSeeds) {
        if (!ms.user) continue;
        await conv.execute({
          sql: `INSERT INTO team_members (
            id, team_id, staff_id, staff_name, staff_email, tier, max_active_chats, is_available, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 15, 1, ?)`,
          args: [
            ms.id,
            ms.teamId,
            String(ms.user.id),
            String(ms.user.name),
            String(ms.user.email || ""),
            ms.tier,
            isoNow,
          ],
        });
      }
    }
  }

  // Ensure any unassigned open chats always start with System (ACRIO)
  await conv.execute(
    `UPDATE conversations
     SET assigned_staff_id = 'ACRIO',
         assigned_staff_name = 'ACRIO',
         assigned_team_name = 'System (ACRIO)'
     WHERE status != 'RESOLVED' AND (assigned_staff_id IS NULL OR assigned_staff_id = 'ACRIO')`
  );
  // Keep Sales Team as #1 default priority rank
  await conv.execute(
    `UPDATE teams SET priority_rank = 1 WHERE id = 'team_sales' AND priority_rank > 1`
  );

  // Auto-enroll any ACTIVE non-DEV staff user who is not yet assigned to any team into Sales Team (P0)
  // so individual person assignment and individual analytics work out of the box!
  const activeNonDevUsers = await auth.execute(
    `SELECT id, name, email, department, role FROM users
     WHERE status = 'ACTIVE' AND role NOT IN ('DEV', 'CLIENT')`
  );
  for (const u of activeNonDevUsers.rows) {
    const uid = String(u.id);
    const existingMembership = await conv.execute({
      sql: `SELECT id FROM team_members WHERE staff_id = ? LIMIT 1`,
      args: [uid],
    });
    if (existingMembership.rows.length === 0) {
      const deptLower = String(u.department || "").toLowerCase();
      const targetTeamId =
        deptLower.includes("machine") || deptLower.includes("edge")
          ? "team_ce53_machines"
          : deptLower.includes("custom") || deptLower.includes("fab")
          ? "team_custom_fab"
          : deptLower.includes("dispatch") || deptLower.includes("order")
          ? "team_support"
          : "team_sales";
      const tier = String(u.role) === "SUPERADMIN" ? "P2" : String(u.role) === "MANAGER" || String(u.role) === "ADMIN" ? "P1" : "P0";
      await conv.execute({
        sql: `INSERT OR IGNORE INTO team_members (
          id, team_id, staff_id, staff_name, staff_email, tier, max_active_chats, is_available, email_alerts_enabled, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 15, 1, 1, ?)`,
        args: [
          `tm_auto_${uid}`,
          targetTeamId,
          uid,
          String(u.name || ""),
          String(u.email || ""),
          tier,
          isoNow,
        ],
      });
    }
  }

  // Enforce billing rule: migrate ACRIO rows to 'ACRIO' and purge any legacy 'SERVICE' charges from normal free chat
  await bill.execute(
    `UPDATE message_billing_ledger
     SET category = 'ACRIO',
         staff_name = 'ACRIO Auto-Handler',
         actual_meta_unit_cost_inr = 0.04,
         margin_inr = ROUND(client_unit_rate_inr - 0.04, 4)
     WHERE category = 'SERVICE' AND (staff_name LIKE '%ACRIO%' OR id = 'ldg_7')`
  );
  await bill.execute(
    `DELETE FROM message_billing_ledger WHERE category = 'SERVICE'`
  );

  // Seed default anti-spam broadcast queue settings
  const qSet = await mkt.execute(
    `SELECT id FROM broadcast_queue_settings WHERE id = 'default' LIMIT 1`
  );
  if (!qSet.rows[0]) {
    await mkt.execute({
      sql: `INSERT INTO broadcast_queue_settings (
        id, default_pacing_mode, delay_seconds, batch_size, batch_pause_seconds,
        skip_recent_hours, daily_marketing_cap, auto_pause_on_consecutive_failures,
        quiet_hours_enabled, updated_by, updated_at
      ) VALUES ('default', 'SAFE_STEADY', 4, 25, 20, 24, 250, 3, 0, 'System', ?)`,
      args: [isoNow],
    });
  }

  // Backfill rich template fields for existing seeded templates
  const tplRows = await mkt.execute(`SELECT * FROM templates`);
  for (const r of tplRows.rows) {
    const id = String(r.id);
    const curHeaderType = String(r.header_type || "NONE");
    const headerText = r.header_text ? String(r.header_text) : "";
    const ctaLabel = r.cta_label ? String(r.cta_label) : "";
    const ctaUrl = r.cta_url ? String(r.cta_url) : "";
    const curButtons = String(r.buttons_json || "[]");
    const curVars = String(r.variables_schema_json || "[]");
    const bodyText = String(r.body_text || "");
    const category = String(r.category || "MARKETING");

    const nextHeaderType =
      curHeaderType === "NONE" && headerText ? "TEXT" : curHeaderType;

    let nextButtonsJson = curButtons;
    if ((curButtons === "[]" || !curButtons) && ctaLabel && ctaUrl) {
      nextButtonsJson = JSON.stringify([
        {
          id: `btn_${id}_1`,
          type: "URL",
          text: ctaLabel,
          url: ctaUrl,
          urlType: "STATIC",
        },
        ...(category === "MARKETING"
          ? [
              {
                id: `btn_${id}_2`,
                type: "QUICK_REPLY",
                text: "Talk to Sales Team",
              },
            ]
          : []),
      ]);
    } else if (
      (curButtons === "[]" || !curButtons) &&
      category === "AUTHENTICATION"
    ) {
      nextButtonsJson = JSON.stringify([
        {
          id: `btn_${id}_otp`,
          type: "COPY_CODE",
          text: "Copy Code",
          exampleCode: "482910",
        },
      ]);
    }

    let nextVarsJson = curVars;
    if (curVars === "[]" || !curVars) {
      const matches = Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g)).map((m) =>
        Number(m[1])
      );
      const uniqueNums = Array.from(new Set(matches)).sort((a, b) => a - b);
      const defaults = uniqueNums.map((n) => {
        if (category === "AUTHENTICATION" && n === 1) {
          return {
            index: 1,
            label: "Verification Code",
            sourceField: "custom",
            sampleValue: "482910",
          };
        }
        if (n === 1) {
          return {
            index: 1,
            label: "Customer First Name",
            sourceField: "customer.firstName",
            sampleValue: "Vikram",
          };
        }
        if (n === 2) {
          return {
            index: 2,
            label: "Order Number",
            sourceField: "order.latestNumber",
            sampleValue: "CC-2026-1089",
          };
        }
        return {
          index: n,
          label: `Detail ${n}`,
          sourceField: "custom",
          sampleValue: "ready for dispatch",
        };
      });
      nextVarsJson = JSON.stringify(defaults);
    }

    if (
      nextHeaderType !== curHeaderType ||
      nextButtonsJson !== curButtons ||
      nextVarsJson !== curVars
    ) {
      await mkt.execute({
        sql: `UPDATE templates
              SET header_type = ?,
                  buttons_json = ?,
                  variables_schema_json = ?,
                  code_expiration_minutes = COALESCE(code_expiration_minutes, ?),
                  updated_at = COALESCE(updated_at, created_at)
              WHERE id = ?`,
        args: [
          nextHeaderType,
          nextButtonsJson,
          nextVarsJson,
          category === "AUTHENTICATION" ? 10 : null,
          id,
        ],
      });
    }
  }

  // Backfill read receipts: any outbound message followed by a newer inbound customer reply in the same chat was already read
  await conv.execute(`
    UPDATE messages
    SET delivery_status = 'READ'
    WHERE direction = 'OUTBOUND'
      AND delivery_status IN ('SENDING', 'SENT', 'DELIVERED')
      AND EXISTS (
        SELECT 1
        FROM messages m2
        WHERE m2.conversation_id = messages.conversation_id
          AND m2.direction = 'INBOUND'
          AND m2.created_at > messages.created_at
      )
  `);

  // Backfill structured assignment + first-response records & chat timeline events for existing conversations
  const missingAssignConvs = await conv.execute(`
    SELECT *
    FROM conversations c
    WHERE NOT EXISTS (
      SELECT 1 FROM conversation_assignments ca WHERE ca.conversation_id = c.id
    )
  `);

  for (const c of missingAssignConvs.rows) {
    const cid = String(c.id);
    const custPhone = String(c.customer_phone || "");
    const custName = String(c.customer_name || "");
    const convStatus = String(c.status || "OPEN");
    const createdAt = String(c.created_at || new Date().toISOString());
    const toStaffId = c.assigned_staff_id ? String(c.assigned_staff_id) : "ACRIO";
    const toStaffName = c.assigned_staff_name
      ? String(c.assigned_staff_name)
      : toStaffId === "ACRIO"
      ? "ACRIO"
      : "Sales Desk";
    const toTeamId = c.assigned_team_id
      ? String(c.assigned_team_id)
      : toStaffId === "ACRIO"
      ? null
      : "team_sales";
    const toTeamName = c.assigned_team_name
      ? String(c.assigned_team_name)
      : toStaffId === "ACRIO"
      ? "System (ACRIO)"
      : "Sales Team";
    const tier = String(c.escalation_level || "P0");

    const firstOutRes = await conv.execute({
      sql: `SELECT id, sender_name, created_at
            FROM messages
            WHERE conversation_id = ? AND direction = 'OUTBOUND'
            ORDER BY created_at ASC
            LIMIT 1`,
      args: [cid],
    });
    const firstOut = firstOutRes.rows[0];
    const firstRespAt = firstOut ? String(firstOut.created_at) : null;
    const firstRespMsgId = firstOut ? String(firstOut.id) : null;

    let firstRespSec: number | null =
      c.last_response_seconds !== null && c.last_response_seconds !== undefined
        ? Number(c.last_response_seconds)
        : null;
    if (firstRespSec === null && firstRespAt) {
      const diff = Math.round(
        (new Date(firstRespAt).getTime() - new Date(createdAt).getTime()) / 1000
      );
      firstRespSec = Number.isNaN(diff) ? 45 : Math.max(8, diff);
    }

    const assignId = `asg_init_${cid}`;
    const outcome = firstRespAt
      ? "RESPONDED"
      : convStatus === "RESOLVED"
      ? "RESOLVED"
      : "ACTIVE";
    const endedAt =
      convStatus === "RESOLVED"
        ? String(c.resolved_at || c.last_message_at || createdAt)
        : null;
    const source =
      toStaffId === "ACRIO" ? "INITIAL_SYSTEM" : "SMART_ASSIGN";

    await conv.execute({
      sql: `INSERT OR IGNORE INTO conversation_assignments (
        id, conversation_id, customer_phone, customer_name,
        from_staff_id, from_staff_name, from_team_name,
        to_staff_id, to_staff_name, to_team_id, to_team_name,
        escalation_level, assignment_source, assigned_by_name, reason,
        assigned_at, first_response_at, first_response_seconds, first_response_message_id,
        ended_at, outcome
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, 'System', 'Initial chat assignment', ?, ?, ?, ?, ?, ?)`,
      args: [
        assignId,
        cid,
        custPhone,
        custName,
        toStaffId,
        toStaffName,
        toTeamId,
        toTeamName,
        tier,
        source,
        createdAt,
        firstRespAt,
        firstRespSec,
        firstRespMsgId,
        endedAt,
        outcome,
      ],
    });

    const existingEventMsg = await conv.execute({
      sql: `SELECT id FROM messages WHERE conversation_id = ? AND message_type = 'ASSIGNMENT_EVENT' LIMIT 1`,
      args: [cid],
    });
    if (existingEventMsg.rows.length === 0) {
      const summaryText =
        toStaffId === "ACRIO"
          ? "Chat assigned to System (ACRIO) for automatic backend handling."
          : `Chat assigned to ${toTeamName} (${tier}: ${toStaffName}).`;
      const meta = {
        assignmentId: assignId,
        toStaffId,
        toStaffName,
        toTeamId,
        toTeamName,
        escalationLevel: tier,
        assignmentSource: source,
        assignedByName: "System",
        assignedAt: createdAt,
        firstResponseAt: firstRespAt,
        firstResponseSeconds: firstRespSec,
        firstResponderName: firstOut ? String(firstOut.sender_name) : null,
        outcome,
      };
      await conv.execute({
        sql: `INSERT OR IGNORE INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, metadata_json, delivery_status, created_at
        ) VALUES (?, ?, 'INTERNAL', 'SYSTEM_EVENT', 'Assignment Tracker', 'ASSIGNMENT_EVENT', 'INTERNAL', ?, ?, 'SAVED', ?)`,
        args: [
          `msg_asg_${cid}`,
          cid,
          summaryText,
          JSON.stringify(meta),
          createdAt,
        ],
      });
    }
  }

  // ==========================================================================
  // SEED STARTER CONTACT GROUPS & BACKFILL CONTACTS.DB FROM CRM + CONVERSATIONS
  // ==========================================================================
  const contacts = getRawLibSqlClient("contacts");
  const bootNowIso = new Date().toISOString();
  const starterGroups = [
    {
      id: "grp_vip",
      name: "VIP & Repeat Buyers",
      description: "High-value repeat corporate, hotel, and institutional buyers",
      color: "amber",
    },
    {
      id: "grp_edu",
      name: "Schools & Universities",
      description: "Colleges, universities, and auditorium podium buyers",
      color: "blue",
    },
    {
      id: "grp_corp",
      name: "Corporate & Hospitality",
      description: "Hotels, event halls, offices, and retail signage buyers",
      color: "emerald",
    },
    {
      id: "grp_machines",
      name: "Classic Edge 53 Machine Leads",
      description: "Fabricators & signage shops interested in diamond polishers & benders",
      color: "purple",
    },
  ];
  for (const g of starterGroups) {
    await contacts.execute({
      sql: `INSERT OR IGNORE INTO contact_groups (id, name, description, color, created_by_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'System', ?, ?)`,
      args: [g.id, g.name, g.description, g.color, bootNowIso, bootNowIso],
    });
  }

  const [allCrmCusts, allConvRows, msgCountRows] = await Promise.all([
    crm.execute(`SELECT * FROM customers`),
    conv.execute(`SELECT * FROM conversations`),
    conv.execute(
      `SELECT c.customer_phone as phone, COUNT(m.id) as cnt
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id AND m.direction IN ('INBOUND', 'OUTBOUND')
       GROUP BY c.customer_phone`
    ),
  ]);

  const msgCountByPhone = new Map<string, number>();
  for (const r of msgCountRows.rows) {
    msgCountByPhone.set(String(r.phone || ""), Number(r.cnt ?? 0));
  }

  const convByPhone = new Map<string, Record<string, unknown>>();
  for (const r of allConvRows.rows) {
    convByPhone.set(String(r.customer_phone || ""), r as Record<string, unknown>);
  }

  for (const c of allCrmCusts.rows) {
    const phone = String(c.phone || "").trim();
    if (!phone) continue;
    const convRow = convByPhone.get(phone);
    const ltv = Number(c.lifetime_value_inr ?? 0);
    const orders = Number(c.total_orders_count ?? 0);
    const orgType = String(c.organization_type || "Business");
    const inferredStage =
      ltv >= 50000 || orders >= 3
        ? "VIP"
        : orders >= 2
        ? "REPEAT_BUYER"
        : orders >= 1
        ? "CUSTOMER"
        : convRow
        ? "QUALIFIED"
        : "NEW_LEAD";

    const autoGroups: string[] = [];
    if (inferredStage === "VIP" || inferredStage === "REPEAT_BUYER") {
      autoGroups.push("grp_vip");
    }
    if (/school|college|univ|educat|instit/i.test(orgType + " " + String(c.company_name || ""))) {
      autoGroups.push("grp_edu");
    } else if (/hotel|corp|hospitality|business|event/i.test(orgType)) {
      autoGroups.push("grp_corp");
    }
    if (/machine|polisher|bender|edge/i.test(String(c.tags_json || "") + " " + String(c.notes || ""))) {
      autoGroups.push("grp_machines");
    }

    await contacts.execute({
      sql: `INSERT OR IGNORE INTO contacts (
        id, phone, whatsapp_name, name, email, company_name, designation,
        organization_type, city, state, country, gst_number, source, stage,
        acrio_segment, tags_json, groups_json, opt_in_marketing, opt_out_reason,
        assigned_owner_id, assigned_owner_name, lifetime_value_inr, total_orders_count,
        total_messages_count, notes, last_contacted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, '', 'India', ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `cnt_${String(c.id).replace(/^cust_/, "")}`,
        phone,
        convRow ? String(convRow.customer_name || "") : "",
        String(c.name || phone),
        String(c.email || ""),
        String(c.company_name || ""),
        orgType,
        String(c.city || ""),
        String(c.gst_number || ""),
        orders > 0 ? "ORDER" : convRow ? "WHATSAPP_INBOUND" : "MANUAL",
        inferredStage,
        String(c.acrio_segment || "Active Prospect"),
        String(c.tags_json || "[]"),
        JSON.stringify(autoGroups),
        Number(c.opt_in_marketing ?? 1),
        convRow?.assigned_staff_id && String(convRow.assigned_staff_id) !== "ACRIO"
          ? String(convRow.assigned_staff_id)
          : null,
        convRow?.assigned_staff_name && String(convRow.assigned_staff_name) !== "ACRIO"
          ? String(convRow.assigned_staff_name)
          : "",
        ltv,
        orders,
        msgCountByPhone.get(phone) ?? 0,
        String(c.notes || ""),
        String(c.last_interaction_at || bootNowIso),
        String(c.created_at || bootNowIso),
        String(c.last_interaction_at || bootNowIso),
      ],
    });
  }

  for (const r of allConvRows.rows) {
    const phone = String(r.customer_phone || "").trim();
    if (!phone) continue;
    await contacts.execute({
      sql: `INSERT OR IGNORE INTO contacts (
        id, phone, whatsapp_name, name, organization_type, source, stage,
        acrio_segment, tags_json, opt_in_marketing, total_messages_count,
        last_contacted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'Business', 'WHATSAPP_INBOUND', 'NEW_LEAD', ?, ?, 1, ?, ?, ?, ?)`,
      args: [
        `cnt_${String(r.id).replace(/^conv_/, "")}`,
        phone,
        String(r.customer_name || phone),
        String(r.customer_name || phone),
        String(r.smart_category || "Active Prospect"),
        String(r.tags_json || "[]"),
        msgCountByPhone.get(phone) ?? 0,
        String(r.last_message_at || bootNowIso),
        String(r.created_at || bootNowIso),
        String(r.last_message_at || bootNowIso),
      ],
    });
  }
}
