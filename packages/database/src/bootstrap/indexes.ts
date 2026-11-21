import type { Client } from "@libsql/client";
import { getRawLibSqlClient } from "@cc/database/clients/handles";

async function applyIndexesSafely(client: Client, statements: string[]): Promise<void> {
  for (const sql of statements) {
    try {
      await client.execute(sql);
    } catch {
      // Non-blocking idempotent index creation
    }
  }
}

export async function ensureAllDatabaseIndexes(): Promise<void> {
  const auth = getRawLibSqlClient("core_auth");
  const conv = getRawLibSqlClient("conversations");
  const contacts = getRawLibSqlClient("contacts");
  const crm = getRawLibSqlClient("crm_orders");
  const mkt = getRawLibSqlClient("marketing");
  const bill = getRawLibSqlClient("billing_ops");
  const queue = getRawLibSqlClient("queue_jobs");

  await Promise.all([
    applyIndexesSafely(auth, [
      `CREATE INDEX IF NOT EXISTS idx_email_logs_created ON email_dispatch_logs (created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions (expires_at)`,
      `CREATE INDEX IF NOT EXISTS idx_users_status ON users (status)`,
    ]),
    applyIndexesSafely(conv, [
      `CREATE INDEX IF NOT EXISTS idx_conv_assign_conv ON conversation_assignments (conversation_id, assigned_at)`,
      `CREATE INDEX IF NOT EXISTS idx_conv_assign_staff ON conversation_assignments (to_staff_id, assigned_at)`,
      `CREATE INDEX IF NOT EXISTS idx_conv_status_last_msg ON conversations (status, last_message_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_conv_last_msg ON conversations (last_message_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_conv_staff_status ON conversations (assigned_staff_id, status, last_message_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_conv_waiting ON conversations (waiting_since, assigned_staff_id)`,
      `CREATE INDEX IF NOT EXISTS idx_conv_created ON conversations (created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_conv_resolved ON conversations (status, resolved_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_msg_conv_created ON messages (conversation_id, created_at ASC)`,
      `CREATE INDEX IF NOT EXISTS idx_msg_conv_dir_created ON messages (conversation_id, direction, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_msg_conv_sender_created ON messages (conversation_id, sender_type, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_msg_tpl_name_created ON messages (template_name, created_at DESC) WHERE template_name IS NOT NULL AND template_name != ''`,
      `CREATE INDEX IF NOT EXISTS idx_conv_window_exp ON conversations (status, window_expires_at)`,
      `CREATE INDEX IF NOT EXISTS idx_msg_wa_id ON messages (wa_message_id)`,
      `CREATE INDEX IF NOT EXISTS idx_msg_created_dir ON messages (created_at DESC, direction)`,
      `CREATE INDEX IF NOT EXISTS idx_quick_replies_staff ON staff_quick_replies (staff_id, is_shared)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_train_ex_enabled ON ai_training_examples (is_enabled, category)`,
      `CREATE INDEX IF NOT EXISTS idx_call_queue_status ON call_dispatch_queue (status, assigned_staff_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_custom_links_code_nocase ON custom_links (code COLLATE NOCASE)`,
      `CREATE INDEX IF NOT EXISTS idx_custom_links_slug ON custom_links (product_slug COLLATE NOCASE)`,
      `CREATE INDEX IF NOT EXISTS idx_csm_phone_created ON customer_shared_media (customer_phone, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_csm_conv_created ON customer_shared_media (conversation_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_csm_wa_media ON customer_shared_media (wa_media_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_wa_id_unique ON messages (wa_message_id) WHERE wa_message_id IS NOT NULL AND TRIM(wa_message_id) != ''`,
    ]),
    applyIndexesSafely(contacts, [
      `CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts (stage, opt_in_marketing)`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_updated ON contacts (updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_city ON contacts (city)`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_pref_staff ON contacts (preferred_staff_id)`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_source_stage ON contacts (source, stage)`,
    ]),
    applyIndexesSafely(crm, [
      `CREATE INDEX IF NOT EXISTS idx_order_trackings_lookup ON order_trackings (lookup_key)`,
      `CREATE INDEX IF NOT EXISTS idx_order_trackings_phone ON order_trackings (customer_phone)`,
      `CREATE INDEX IF NOT EXISTS idx_order_trackings_updated ON order_trackings (updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_eco_enq_created ON ecosystem_enquiries (created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_eco_enq_phone ON ecosystem_enquiries (customer_phone)`,
      `CREATE INDEX IF NOT EXISTS idx_eco_enq_brand_status ON ecosystem_enquiries (brand, status)`,
      `CREATE INDEX IF NOT EXISTS idx_cust_orders_phone_date ON customer_orders (customer_phone, ordered_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_cust_orders_cust_id ON customer_orders (customer_id)`,
      `CREATE INDEX IF NOT EXISTS idx_cust_rel_phone_date ON customer_relations (customer_phone, occurred_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_cust_rel_cust_id ON customer_relations (customer_id)`,
      `CREATE INDEX IF NOT EXISTS idx_customers_optin ON customers (opt_in_marketing, lifetime_value_inr DESC)`,
    ]),
    applyIndexesSafely(mkt, [
      `CREATE INDEX IF NOT EXISTS idx_bc_rec_broadcast_status ON broadcast_recipients (broadcast_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_bc_rec_phone_sent ON broadcast_recipients (customer_phone, sent_at)`,
      `CREATE INDEX IF NOT EXISTS idx_broadcasts_queue ON broadcasts (status, next_dispatch_at, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_templates_approval ON templates (approval_status)`,
    ]),
    applyIndexesSafely(bill, [
      `CREATE INDEX IF NOT EXISTS idx_ledger_billed_at ON message_billing_ledger (billed_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_ledger_conv ON message_billing_ledger (conversation_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ledger_broadcast ON message_billing_ledger (broadcast_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_trace_ts ON ai_trace_logs (timestamp_utc DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_trace_web_ts ON ai_trace_logs (website, timestamp_utc DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_trace_outcome ON ai_trace_logs (outcome_source)`,
    ]),
    applyIndexesSafely(queue, [
      `CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON jobs (queue_name, status, run_after)`,
      `CREATE INDEX IF NOT EXISTS idx_jobs_cleanup ON jobs (status, created_at)`,
    ]),
  ]);
}
