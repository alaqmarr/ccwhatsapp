import { getRawLibSqlClient } from "@cc/database/clients/handles";

export async function createCrmMarketingBillingQueueTables(): Promise<void> {
  const crm = getRawLibSqlClient("crm_orders");
  const mkt = getRawLibSqlClient("marketing");
  const bill = getRawLibSqlClient("billing_ops");
  const queue = getRawLibSqlClient("queue_jobs");

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
      `CREATE TABLE IF NOT EXISTS ecosystem_enquiries (
        id TEXT PRIMARY KEY,
        external_id TEXT NOT NULL,
        brand TEXT NOT NULL,
        brand_label TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        product_name TEXT DEFAULT '',
        source TEXT NOT NULL DEFAULT 'Website Form',
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'New',
        ai_suggested_reply TEXT DEFAULT '',
        last_reply_text TEXT DEFAULT '',
        last_reply_channel TEXT DEFAULT '',
        replied_by_name TEXT DEFAULT '',
        replied_at TEXT,
        conversation_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
    "write"
  );

  for (const ddl of [
    `ALTER TABLE customers ADD COLUMN preferred_staff_id TEXT`,
    `ALTER TABLE customers ADD COLUMN preferred_staff_name TEXT DEFAULT ''`,
  ]) {
    try {
      await crm.execute(ddl);
    } catch {
      // Column already exists
    }
  }

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
    ],
    "write"
  );

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

  await bill.batch(
    [
      `CREATE TABLE IF NOT EXISTS pricing_config (
        id TEXT PRIMARY KEY,
        client_marketing_rate_inr REAL NOT NULL DEFAULT 0.95,
        client_other_rate_inr REAL NOT NULL DEFAULT 0.30,
        actual_meta_marketing_rate_inr REAL NOT NULL DEFAULT 0.8631,
        actual_meta_utility_rate_inr REAL NOT NULL DEFAULT 0.115,
        actual_meta_auth_rate_inr REAL NOT NULL DEFAULT 0.115,
        actual_meta_service_rate_inr REAL NOT NULL DEFAULT 0.0,
        gst_rate_pct REAL NOT NULL DEFAULT 18.0,
        usd_to_inr_rate REAL NOT NULL DEFAULT 93.40,
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
        delivery_mode TEXT NOT NULL DEFAULT 'LIVE_META_CLOUD',
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
      `CREATE TABLE IF NOT EXISTS ai_trace_logs (
        id TEXT PRIMARY KEY,
        timestamp_utc TEXT NOT NULL,
        website TEXT NOT NULL,
        outcome_source TEXT NOT NULL,
        response_cache_status TEXT NOT NULL,
        catalog_cache_status TEXT NOT NULL,
        product_lookup_triggered INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        thinking_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        error_text TEXT,
        payload_json TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS ai_log_sync_state (
        file_path TEXT PRIMARY KEY,
        last_byte_offset INTEGER NOT NULL DEFAULT 0,
        last_size_bytes INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,
    ],
    "write"
  );

  for (const alterSql of [
    `ALTER TABLE pricing_config ADD COLUMN gst_rate_pct REAL NOT NULL DEFAULT 18.0`,
    `ALTER TABLE pricing_config ADD COLUMN usd_to_inr_rate REAL NOT NULL DEFAULT 93.40`,
    `ALTER TABLE message_billing_ledger ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'LIVE_META_CLOUD'`,
  ]) {
    try {
      await bill.execute(alterSql);
    } catch {
      // Column already exists
    }
  }

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
}
