import { getRawLibSqlClient } from "@cc/database/clients/handles";

export async function createCoreAuthTables(): Promise<void> {
  const auth = getRawLibSqlClient("core_auth");

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
        assignments_enabled INTEGER NOT NULL DEFAULT 1,
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
    ],
    "write"
  );

  try {
    await auth.execute(
      `ALTER TABLE users ADD COLUMN assignments_enabled INTEGER NOT NULL DEFAULT 1`
    );
  } catch {
    // Column already exists
  }
}

export async function createConversationsAndContactsTables(): Promise<void> {
  const conv = getRawLibSqlClient("conversations");
  const contacts = getRawLibSqlClient("contacts");
  const crm = getRawLibSqlClient("crm_orders");

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
      `CREATE TABLE IF NOT EXISTS staff_quick_replies (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL,
        staff_name TEXT NOT NULL DEFAULT '',
        cmd TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        is_shared INTEGER NOT NULL DEFAULT 0,
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS ai_training_examples (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Product Knowledge',
        guidance_type TEXT NOT NULL DEFAULT 'FIXED_ANSWER',
        customer_question TEXT NOT NULL,
        ideal_answer TEXT NOT NULL,
        do_not_say TEXT DEFAULT '',
        product_slug TEXT DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'NORMAL',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_by_name TEXT NOT NULL DEFAULT 'Team',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS ai_training_rules (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        rule_text TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'BOTH',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        created_by_name TEXT NOT NULL DEFAULT 'Team',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS call_dispatch_queue (
        id TEXT PRIMARY KEY,
        customer_phone TEXT NOT NULL DEFAULT '',
        customer_name TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'Direct Call',
        product_topic TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        recording_url TEXT DEFAULT '',
        recording_file_name TEXT DEFAULT '',
        recording_mime_type TEXT DEFAULT '',
        attachment_url TEXT DEFAULT '',
        attachment_name TEXT DEFAULT '',
        assignment_mode TEXT NOT NULL DEFAULT 'AUTO_PERFORMANCE',
        assignment_reason TEXT DEFAULT '',
        assigned_staff_id TEXT,
        assigned_staff_name TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'PENDING',
        priority TEXT NOT NULL DEFAULT 'NORMAL',
        conversation_id TEXT,
        resolution_notes TEXT DEFAULT '',
        submitted_by_id TEXT,
        submitted_by_name TEXT NOT NULL DEFAULT 'Desk',
        picked_up_at TEXT,
        resolved_at TEXT,
        resolved_by_name TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
    "write"
  );

  const extraConvColumns = [
    `ALTER TABLE conversations ADD COLUMN assigned_team_id TEXT`,
    `ALTER TABLE conversations ADD COLUMN assigned_team_name TEXT`,
    `ALTER TABLE conversations ADD COLUMN escalation_level TEXT NOT NULL DEFAULT 'P0'`,
    `ALTER TABLE conversations ADD COLUMN waiting_since TEXT`,
    `ALTER TABLE conversations ADD COLUMN last_response_seconds INTEGER`,
    `ALTER TABLE conversations ADD COLUMN escalated_at TEXT`,
    `ALTER TABLE conversations ADD COLUMN resolved_by_id TEXT`,
    `ALTER TABLE conversations ADD COLUMN collaborators_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE conversations ADD COLUMN last_message_direction TEXT`,
    `ALTER TABLE conversations ADD COLUMN last_message_status TEXT`,
    `ALTER TABLE messages ADD COLUMN sender_staff_id TEXT`,
    `ALTER TABLE automations ADD COLUMN priority_order INTEGER NOT NULL DEFAULT 10`,
    `ALTER TABLE team_members ADD COLUMN email_alerts_enabled INTEGER NOT NULL DEFAULT 1`,
  ];
  await conv
    .execute(
      `CREATE TABLE IF NOT EXISTS lead_forwards (
        id TEXT PRIMARY KEY,
        owner_phone TEXT NOT NULL DEFAULT '',
        owner_name TEXT NOT NULL DEFAULT '',
        staff_id TEXT NOT NULL,
        staff_name TEXT NOT NULL,
        staff_phone TEXT NOT NULL DEFAULT '',
        lead_text TEXT NOT NULL,
        customer_name TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        call_queue_id TEXT,
        assignment_mode TEXT NOT NULL DEFAULT 'NAMED',
        delivery_status TEXT NOT NULL DEFAULT 'PENDING_WINDOW',
        delivery_note TEXT NOT NULL DEFAULT '',
        media_json TEXT NOT NULL DEFAULT '[]',
        delivered_at TEXT,
        created_at TEXT NOT NULL
      )`
    )
    .catch(() => {});
  for (const ddl of extraConvColumns) {
    try {
      await conv.execute(ddl);
    } catch {
      // Column already exists
    }
  }

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

  for (const ddl of [
    `ALTER TABLE contacts ADD COLUMN preferred_staff_id TEXT`,
    `ALTER TABLE contacts ADD COLUMN preferred_staff_name TEXT DEFAULT ''`,
  ]) {
    try {
      await contacts.execute(ddl);
    } catch {
      // Column already exists
    }
  }

  for (const ddl of [
    `ALTER TABLE customers ADD COLUMN preferred_staff_id TEXT`,
    `ALTER TABLE customers ADD COLUMN preferred_staff_name TEXT DEFAULT ''`,
  ]) {
    try {
      await crm.execute(ddl);
    } catch {
      // Table or column may already exist / be created in crm step
    }
  }
}
