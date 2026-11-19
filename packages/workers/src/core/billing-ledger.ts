import crypto from "node:crypto";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";

export type BillingMessageCategory =
  | "MARKETING"
  | "UTILITY"
  | "AUTHENTICATION"
  | "ACRIO";

/**
 * Dual-Ledger Billing Engine:
 * - Regular 24h staff chat messages are FREE (₹0.00) and never recorded here!
 * - Charged ONLY on:
 *   1. ACRIO automated replies (`ACRIO` -> ₹0.30)
 *   2. Templated messages (`MARKETING` -> ₹0.95; `UTILITY` / `AUTHENTICATION` -> ₹0.30)
 * - DEV sees actual Meta / AI cost + exact net margin per message!
 */
export async function recordDualPricingLedgerEntry(params: {
  messageId?: string;
  broadcastId?: string;
  conversationId?: string;
  customerPhone: string;
  category: BillingMessageCategory;
  staffName: string;
  deliveryMode?: "LIVE_META_CLOUD" | "SANDBOX_SIMULATOR" | "SEED";
}): Promise<{
  clientUnitRateInr: number;
  actualMetaUnitCostInr: number;
  marginInr: number;
}> {
  await ensureDatabasesBootstrapped();
  const bill = getRawLibSqlClient("billing_ops");

  const cfgRes = await bill.execute(
    `SELECT * FROM pricing_config WHERE id = 'default' LIMIT 1`
  );
  const cfg = (cfgRes.rows[0] || {}) as Record<string, unknown>;

  const clientMarketing = Number(cfg.client_marketing_rate_inr ?? 0.95);
  const clientOther = Number(cfg.client_other_rate_inr ?? 0.3);

  const metaMarketing = Number(cfg.actual_meta_marketing_rate_inr ?? 0.8631);
  const metaUtility = Number(cfg.actual_meta_utility_rate_inr ?? 0.115);
  const metaAuth = Number(cfg.actual_meta_auth_rate_inr ?? 0.115);
  const metaAcrio = Number(cfg.actual_meta_service_rate_inr ?? 0.0);

  const clientUnitRateInr =
    params.category === "MARKETING" ? clientMarketing : clientOther;

  let actualMetaUnitCostInr = metaUtility;
  if (params.category === "MARKETING") actualMetaUnitCostInr = metaMarketing;
  else if (params.category === "AUTHENTICATION") actualMetaUnitCostInr = metaAuth;
  else if (params.category === "ACRIO") actualMetaUnitCostInr = metaAcrio;

  const marginInr = Number(
    (clientUnitRateInr - actualMetaUnitCostInr).toFixed(4)
  );
  const deliveryMode = params.deliveryMode || "LIVE_META_CLOUD";

  await bill.execute({
    sql: `INSERT INTO message_billing_ledger (
      id, message_id, broadcast_id, conversation_id, customer_phone,
      category, client_unit_rate_inr, actual_meta_unit_cost_inr, margin_inr, delivery_mode, staff_name, billed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `ldg_${crypto.randomUUID().slice(0, 10)}`,
      params.messageId || null,
      params.broadcastId || null,
      params.conversationId || null,
      params.customerPhone,
      params.category,
      clientUnitRateInr,
      actualMetaUnitCostInr,
      marginInr,
      deliveryMode,
      params.staffName,
      new Date().toISOString(),
    ],
  });

  return { clientUnitRateInr, actualMetaUnitCostInr, marginInr };
}
