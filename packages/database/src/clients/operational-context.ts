import {
  IS_TEST_OR_DEV_CONTACT_RE,
  getVerifiedLiveBrandAndTeamInfo,
} from "./brand-team-info";
import { normalizeWhatsAppPhone } from "./contacts-sync";
import { ensureEcosystemEnquiriesTable } from "./enquiries-sync";
import { getMainCatalogClient, getRawLibSqlClient } from "./handles";

export async function loadLiveDatabaseOperationalContext(params: {
  customerPhone?: string;
  customerName?: string;
  rawQuery?: string;
  forStaffCopilot?: boolean;
}): Promise<string> {
  const sections: string[] = [];
  const q = String(params.rawQuery || "").toLowerCase();

  try {
    const crm = getRawLibSqlClient("crm_orders");
    const ccClient = getMainCatalogClient();

    const liveBrand = await getVerifiedLiveBrandAndTeamInfo();
    const asksAboutCompanyOrTeamContacts =
      Boolean(params.forStaffCopilot) ||
      /\b(contact|phone|number|call|whatsapp|email|address|location|where\s+are\s+you|factory|office|hours|timings|director|directors|chairperson|chairman|founder|ceo|owner|leadership|team|manager|sales\s+person|who\s+handles|whom\s+will\s+you\s+connect|connect\s+me|yusuf|hussain|shiva|lalitha|susheela|shilpa|chandi|priyanka|lakshmi|murtuza|suraj|harendar)\b/i.test(
        q
      );

    if (asksAboutCompanyOrTeamContacts) {
      const teamBlock = [
        liveBrand.headOfficeLine,
        ...(liveBrand.leadershipLines.length > 0
          ? [`• Verified Leadership & Sales Team (from Live Database):`, ...liveBrand.leadershipLines]
          : []),
      ].join("\n");
      sections.push(`VERIFIED LIVE COMPANY & TEAM CONTACTS:\n${teamBlock}`);
    } else {
      sections.push(`VERIFIED COMPANY SUMMARY:\n${liveBrand.headOfficeLine}`);
    }

    if (ccClient) {
      const ccRes = await ccClient
        .execute(
          `SELECT title, category, type, fileUrl FROM Resource ORDER BY createdAt DESC LIMIT 12`
        )
        .catch(() => ({ rows: [] as any[] }));
      if (ccRes.rows.length > 0 && /\b(pdf|brochure|catalogue|catalog|resource|download|spec\s*sheet)\b/i.test(q)) {
        sections.push(
          `DOWNLOADABLE CATALOGUES & RESOURCES:\n` +
            ccRes.rows
              .map(
                (r) =>
                  `• ${r.title} (${r.category || r.type || "PDF"}): ${r.fileUrl}`
              )
              .join("\n")
        );
      }
    }

    const cleanPhone = params.customerPhone
      ? normalizeWhatsAppPhone(params.customerPhone)
      : "";
    const phoneTail = cleanPhone.slice(-10);

    if (phoneTail.length >= 10) {
      await ensureEcosystemEnquiriesTable().catch(() => {});
      const custRes = await crm
        .execute({
          sql: `SELECT id, name, phone, email, company_name, organization_type, acrio_segment, total_orders_count, lifetime_value_inr, notes FROM customers WHERE phone LIKE ? LIMIT 3`,
          args: [`%${phoneTail}%`],
        })
        .catch(() => ({ rows: [] as any[] }));

      if (custRes.rows.length > 0) {
        const c = custRes.rows[0];
        if (!IS_TEST_OR_DEV_CONTACT_RE.test(String(c.name || ""))) {
          sections.push(
            `CURRENT CUSTOMER CRM RECORD: ${c.name} (${c.phone})${c.company_name ? `, Company: ${c.company_name}` : ""}${c.organization_type ? `, Segment: ${c.organization_type}` : ""}, Orders: ${c.total_orders_count ?? 0}, LTV: ₹${Number(c.lifetime_value_inr ?? 0).toLocaleString("en-IN")}${c.notes ? `, Notes: ${c.notes}` : ""}`
          );
        }
      }

      const [ordRes, trkRes, ecoEnqRes] = await Promise.all([
        crm
          .execute({
            sql: `SELECT order_number, items_summary, quantity, total_amount_inr, payment_status, fulfillment_status, ordered_at FROM customer_orders WHERE customer_phone LIKE ? ORDER BY ordered_at DESC LIMIT 5`,
            args: [`%${phoneTail}%`],
          })
          .catch(() => ({ rows: [] as any[] })),
        crm
          .execute({
            sql: `SELECT order_id, lookup_key, brand, items_summary, provider_name, awb_number, shipment_status, estimated_delivery FROM order_trackings WHERE customer_phone LIKE ? ORDER BY updated_at DESC LIMIT 5`,
            args: [`%${phoneTail}%`],
          })
          .catch(() => ({ rows: [] as any[] })),
        crm
          .execute({
            sql: `SELECT brand_label, product_name, message, status, last_reply_text, replied_by_name, created_at FROM ecosystem_enquiries WHERE customer_phone LIKE ? ORDER BY created_at DESC LIMIT 5`,
            args: [`%${phoneTail}%`],
          })
          .catch(() => ({ rows: [] as any[] })),
      ]);

      if (ordRes.rows.length > 0 || trkRes.rows.length > 0) {
        const ordLines = [
          ...ordRes.rows.map(
            (o) =>
              `• Order ${o.order_number}: ${o.items_summary} (Qty ${o.quantity ?? 1}), Amount=₹${Number(o.total_amount_inr ?? 0).toLocaleString("en-IN")}, Payment=${o.payment_status}, Fulfillment=${o.fulfillment_status}`
          ),
          ...trkRes.rows.map(
            (t) =>
              `• Shipment ${t.order_id} (${t.lookup_key}): Status=${t.shipment_status}, Courier=${t.provider_name}, AWB=${t.awb_number}, ETA=${t.estimated_delivery || "N/A"}`
          ),
        ];
        sections.push(`CUSTOMER ORDERS & DISPATCH TRACKING:\n${ordLines.join("\n")}`);
      }

      if (ecoEnqRes.rows.length > 0) {
        sections.push(
          `CUSTOMER WEBSITE ENQUIRIES & REPLIES ON FILE:\n` +
            ecoEnqRes.rows
              .map(
                (e) =>
                  `• [${e.brand_label}] (${e.status})${e.product_name ? ` Product: ${e.product_name} |` : ""} Enquiry: "${String(e.message || "").slice(0, 140)}"${e.last_reply_text ? ` | Team Reply (${e.replied_by_name || "Staff"}): "${String(e.last_reply_text).slice(0, 140)}"` : ""}`
              )
              .join("\n")
        );
      }

      if (ccClient) {
        const [ccEnq, ccCart] = await Promise.all([
          ccClient
            .execute({
              sql: `SELECT name, message, status, createdAt FROM Enquiry WHERE phone LIKE ? ORDER BY createdAt DESC LIMIT 5`,
              args: [`%${phoneTail}%`],
            })
            .catch(() => ({ rows: [] as any[] })),
          ccClient
            .execute({
              sql: `SELECT id, name, total, status, createdAt FROM CartOrder WHERE phone LIKE ? ORDER BY createdAt DESC LIMIT 5`,
              args: [`%${phoneTail}%`],
            })
            .catch(() => ({ rows: [] as any[] })),
        ]);
        if (ccEnq.rows.length > 0 && ecoEnqRes.rows.length === 0) {
          sections.push(
            `MAIN WEBSITE ENQUIRIES FOR THIS PHONE:\n` +
              ccEnq.rows
                .map(
                  (e) =>
                    `• ${e.name} [${e.status}]: "${String(e.message || "").slice(0, 120)}"`
                )
                .join("\n")
          );
        }
        if (ccCart.rows.length > 0) {
          sections.push(
            `MAIN WEBSITE CART ORDERS FOR THIS PHONE:\n` +
              ccCart.rows
                .map(
                  (o) =>
                    `• Order CC-${String(o.id).slice(-6).toUpperCase()}: ₹${Number(o.total ?? 0).toLocaleString("en-IN")} [${o.status}]`
                )
                .join("\n")
          );
        }
      }
    }

    if (
      params.forStaffCopilot === true &&
      /\b(enquir(?:y|ies)|order|orders|awb|tracking|dispatch|shipment|cc-\d+|ord[-_a-z0-9]+)\b/i.test(
        q
      )
    ) {
      await ensureEcosystemEnquiriesTable().catch(() => {});
      const [recentEnq, recentOrd] = await Promise.all([
        crm
          .execute(
            `SELECT brand_label, customer_name, customer_phone, message, status, last_reply_text, replied_by_name FROM ecosystem_enquiries ORDER BY created_at DESC LIMIT 8`
          )
          .catch(() => ({ rows: [] as any[] })),
        crm
          .execute(
            `SELECT order_number, customer_phone, items_summary, total_amount_inr, payment_status, fulfillment_status FROM customer_orders ORDER BY ordered_at DESC LIMIT 8`
          )
          .catch(() => ({ rows: [] as any[] })),
      ]);
      if (recentEnq.rows.length > 0) {
        sections.push(
          `RECENT ECOSYSTEM ENQUIRIES LOG:\n` +
            recentEnq.rows
              .map(
                (e) =>
                  `• [${e.brand_label}] ${e.customer_name} (${e.customer_phone}) [${e.status}]: "${String(e.message || "").slice(0, 100)}"${e.last_reply_text ? ` -> Replied by ${e.replied_by_name || "Staff"}: "${String(e.last_reply_text).slice(0, 80)}"` : ""}`
              )
              .join("\n")
        );
      }
      if (recentOrd.rows.length > 0) {
        sections.push(
          `RECENT ECOSYSTEM ORDERS LOG:\n` +
            recentOrd.rows
              .map(
                (o) =>
                  `• ${o.order_number} (${o.customer_phone}): ${o.items_summary} | ₹${Number(o.total_amount_inr ?? 0).toLocaleString("en-IN")} | Payment=${o.payment_status}, Status=${o.fulfillment_status}`
              )
              .join("\n")
        );
      }
    }
  } catch {
    // Non-blocking operational context lookup
  }

  return sections.join("\n\n");
}
