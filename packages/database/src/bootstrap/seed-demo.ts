import { getRawLibSqlClient } from "@cc/database/clients/handles";
import type { BootstrapTimestamps } from "./seed-config";
import { seedDemoMarketingAndLedger } from "./seed-demo-mkt";

export async function seedDemoOperationalData(
  ts: BootstrapTimestamps,
  hadZeroTemplates: boolean
): Promise<void> {
  const crm = getRawLibSqlClient("crm_orders");
  const conv = getRawLibSqlClient("conversations");
  const { isoNow, oneHourAgo, threeHoursAgo, yesterday, windowOpen } = ts;

  const existingCustomers = await crm.execute(`SELECT COUNT(*) as cnt FROM customers`);
  if (Number(existingCustomers.rows[0]?.cnt ?? 0) === 0) {
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

  const existingConvs = await conv.execute(`SELECT COUNT(*) as cnt FROM conversations`);
  if (Number(existingConvs.rows[0]?.cnt ?? 0) === 0) {
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

  await seedDemoMarketingAndLedger(ts, hadZeroTemplates);
}
