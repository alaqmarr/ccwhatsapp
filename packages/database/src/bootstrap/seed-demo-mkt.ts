import { getRawLibSqlClient } from "@cc/database/clients/handles";
import type { BootstrapTimestamps } from "./seed-config";

export async function seedDemoMarketingAndLedger(
  ts: BootstrapTimestamps,
  hadZeroTemplates: boolean
): Promise<void> {
  const mkt = getRawLibSqlClient("marketing");
  const bill = getRawLibSqlClient("billing_ops");
  const { isoNow, oneHourAgo, threeHoursAgo, yesterday } = ts;

  if (hadZeroTemplates) {
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

  const existingLedger = await bill.execute(`SELECT COUNT(*) as cnt FROM message_billing_ledger`);
  if (Number(existingLedger.rows[0]?.cnt ?? 0) === 0) {
    const sampleRows: {
      id: string;
      cat: "MARKETING" | "UTILITY" | "AUTHENTICATION" | "ACRIO";
      phone: string;
      clientRate: number;
      metaCost: number;
      staff: string;
      at: string;
    }[] = [
      { id: "ldg_1", cat: "MARKETING", phone: "+919848011223", clientRate: 0.95, metaCost: 0.8631, staff: "Campaign Broadcast", at: yesterday },
      { id: "ldg_2", cat: "MARKETING", phone: "+919900145678", clientRate: 0.95, metaCost: 0.8631, staff: "Campaign Broadcast", at: yesterday },
      { id: "ldg_3", cat: "MARKETING", phone: "+919848099112", clientRate: 0.95, metaCost: 0.8631, staff: "Campaign Broadcast", at: threeHoursAgo },
      { id: "ldg_4", cat: "UTILITY", phone: "+919701234500", clientRate: 0.30, metaCost: 0.115, staff: "Order Template", at: yesterday },
      { id: "ldg_5", cat: "UTILITY", phone: "+919848011223", clientRate: 0.30, metaCost: 0.115, staff: "Dispatch Template", at: threeHoursAgo },
      { id: "ldg_6", cat: "AUTHENTICATION", phone: "+919000112233", clientRate: 0.30, metaCost: 0.115, staff: "OTP Template", at: oneHourAgo },
      { id: "ldg_7", cat: "ACRIO", phone: "+919900145678", clientRate: 0.30, metaCost: 0.0, staff: "ACRIO Auto-Handler", at: oneHourAgo },
    ];

    for (const r of sampleRows) {
      await bill.execute({
        sql: `INSERT INTO message_billing_ledger (
          id, customer_phone, category, client_unit_rate_inr, actual_meta_unit_cost_inr, margin_inr, delivery_mode, staff_name, billed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'SEED', ?, ?)`,
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
}
