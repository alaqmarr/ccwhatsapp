import { resolveEnvMetaWhatsAppConfig, resolveMonorepoRoot } from "@cc/database/clients/env-config";
import { getRawLibSqlClient } from "@cc/database/clients/handles";

export interface BootstrapTimestamps {
  isoNow: string;
  oneHourAgo: string;
  threeHoursAgo: string;
  yesterday: string;
  windowOpen: string;
}

export async function seedCoreConfigurationAndTemplates(
  ts: BootstrapTimestamps,
  shouldSeedDemoData: boolean
): Promise<boolean> {
  const bill = getRawLibSqlClient("billing_ops");
  const auth = getRawLibSqlClient("core_auth");
  const mkt = getRawLibSqlClient("marketing");
  const { isoNow } = ts;

  const existingPricing = await bill.execute(`SELECT COUNT(*) as cnt FROM pricing_config`);
  if (Number(existingPricing.rows[0]?.cnt ?? 0) === 0) {
    await bill.execute({
      sql: `INSERT INTO pricing_config (
        id, client_marketing_rate_inr, client_other_rate_inr,
        actual_meta_marketing_rate_inr, actual_meta_utility_rate_inr,
        actual_meta_auth_rate_inr, actual_meta_service_rate_inr,
        gst_rate_pct, usd_to_inr_rate, currency, updated_by, updated_at
      ) VALUES ('default', 0.95, 0.30, 0.8631, 0.115, 0.115, 0.0, 18.0, 93.40, 'INR', 'System Bootstrap', ?)`,
      args: [isoNow],
    });
  } else {
    await bill.execute({
      sql: `UPDATE pricing_config
            SET actual_meta_marketing_rate_inr = CASE
                  WHEN updated_by = 'System Bootstrap' AND ABS(actual_meta_marketing_rate_inr - 0.7846) < 0.001
                  THEN 0.8631
                  ELSE actual_meta_marketing_rate_inr
                END,
                actual_meta_service_rate_inr = CASE
                  WHEN updated_by = 'System Bootstrap' AND ABS(actual_meta_service_rate_inr - 0.08) < 0.001
                  THEN 0.0
                  ELSE actual_meta_service_rate_inr
                END
            WHERE id = 'default'`,
      args: [],
    });
  }

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
          },
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

  const existingTemplates = await mkt.execute(`SELECT COUNT(*) as cnt FROM templates`);
  const hadZeroTemplates = Number(existingTemplates.rows[0]?.cnt ?? 0) === 0;
  if (hadZeroTemplates) {
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
        { index: 1, label: "Customer First Name", sourceField: "customer.firstName", sampleValue: "Customer" },
        { index: 2, label: "Order ID", sourceField: "order.latestNumber", sampleValue: "CC-2026-1089" },
        { index: 3, label: "Courier Partner", sourceField: "custom", sampleValue: "Delhivery" },
      ]),
      shouldSeedDemoData ? "APPROVED" : "DRAFT",
      isoNow,
      isoNow,
    ],
  });

  await mkt.batch(
    [
      {
        sql: `INSERT OR IGNORE INTO templates (
          id, meta_template_id, name, language, category, header_type, header_text, body_text, footer_text,
          buttons_json, variables_schema_json, approval_status, meta_quality_score, sent_count, created_at, updated_at
        ) VALUES (?, ?, ?, 'en', ?, 'TEXT', ?, ?, ?, ?, ?, 'APPROVED', 'GREEN', 0, ?, ?)`,
        args: [
          "tpl_meta_website_enquiry",
          "1520380163242586",
          "cc_website_enquiry_received",
          "MARKETING",
          "We Have Received Your Enquiry",
          "Hello {{1}},\n\nThank you for reaching out to *Classic Concepts*. We have received your enquiry, and our team is reviewing the details you shared.\n\n*What happens next:*\n• A team member will review your requirements\n• You will hear back from us within *1 business day*\n• Keep an eye on this chat for updates\n\nIn the meantime, you can browse our latest designs here:\nhttps://ccapl.cc/TD6QEo\n\nWe look forward to working with you.",
          "Classic Concepts Acrylic Private Limited",
          JSON.stringify([
            { id: "btn_we_talk", type: "QUICK_REPLY", text: "Talk to Our Team", flowAction: { actionType: "ASSIGN_TEAM", assignTeamId: "team_sales", stopFurtherAi: true } },
            { id: "btn_we_cat", type: "QUICK_REPLY", text: "View Catalog" },
          ]),
          JSON.stringify([
            { index: 1, label: "Customer First Name", sourceField: "customer.firstName", sampleValue: "Rahul" },
          ]),
          isoNow,
          isoNow,
        ],
      },
      {
        sql: `INSERT OR IGNORE INTO templates (
          id, meta_template_id, name, language, category, header_type, header_text, body_text, footer_text,
          buttons_json, variables_schema_json, approval_status, meta_quality_score, sent_count, created_at, updated_at
        ) VALUES (?, ?, ?, 'en', ?, 'TEXT', ?, ?, ?, ?, ?, 'APPROVED', 'GREEN', 0, ?, ?)`,
        args: [
          "tpl_meta_quote_alert",
          "921149787749862",
          "cc_quote_request_alert",
          "UTILITY",
          "New Quote Request Received",
          "Hello {{1}},\n\nA new *quote request* just came in from {{2}}.\n\n• Product: {{3}}\n• Quantity: {{4}}\n\nPlease reply within *1 working hour* to keep the lead warm.\n\nCatalog: https://ccapl.cc/eSzcdT",
          "Classic Concepts",
          "[]",
          JSON.stringify([
            { index: 1, label: "Staff Name", sourceField: "custom", sampleValue: "Priya" },
            { index: 2, label: "Customer Name", sourceField: "customer.fullName", sampleValue: "Rahul Sharma" },
            { index: 3, label: "Product", sourceField: "custom", sampleValue: "Acrylic Podium" },
            { index: 4, label: "Quantity", sourceField: "custom", sampleValue: "10" },
          ]),
          isoNow,
          isoNow,
        ],
      },
      {
        sql: `INSERT OR IGNORE INTO templates (
          id, meta_template_id, name, language, category, header_type, header_text, body_text, footer_text,
          buttons_json, variables_schema_json, approval_status, meta_quality_score, sent_count, created_at, updated_at
        ) VALUES (?, ?, ?, 'en', ?, 'TEXT', ?, ?, ?, ?, ?, 'APPROVED', 'GREEN', 0, ?, ?)`,
        args: [
          "tpl_meta_staff_assignment",
          "1866822621170402",
          "cc_staff_client_assignment",
          "MARKETING",
          "New Client Assigned to You",
          "Hello {{1}},\n\nA new client has been assigned to you in Classic Concepts.\n\n*Client Name:* {{2}}\n*Client Phone:* {{3}}\n\n• Review the client profile before reaching out\n• Reply within 1 working hours for the best response\n• Update the lead status once you have spoken to them\n\nReply below to confirm or get help.",
          "Classic Concepts • Reply STOP to opt out",
          JSON.stringify([
            { id: "btn_sa_view", type: "QUICK_REPLY", text: "View Client Details" },
            { id: "btn_sa_acc", type: "QUICK_REPLY", text: "Accept Assignment" },
          ]),
          JSON.stringify([
            { index: 1, label: "Staff Name", sourceField: "custom", sampleValue: "Priya" },
            { index: 2, label: "Client Name", sourceField: "customer.fullName", sampleValue: "Rahul Mehta" },
            { index: 3, label: "Client Phone", sourceField: "custom", sampleValue: "+91 98765 43210" },
          ]),
          isoNow,
          isoNow,
        ],
      },
      {
        sql: `INSERT OR IGNORE INTO templates (
          id, meta_template_id, name, language, category, header_type, header_text, body_text, footer_text,
          buttons_json, variables_schema_json, approval_status, meta_quality_score, sent_count, created_at, updated_at
        ) VALUES (?, ?, ?, 'en', ?, 'TEXT', ?, ?, ?, ?, ?, 'APPROVED', 'GREEN', 0, ?, ?)`,
        args: [
          "tpl_meta_callback_alert",
          "1859792241814272",
          "cc_callback_request_alert",
          "MARKETING",
          "New Callback Request Received",
          "Hello {{1}},\n\nA client has requested a *callback*.\n\n• Client: {{2}}\n• Phone: {{3}}\n• Preferred time: {{4}}\n\nPlease reach out within the next *30 minutes* so the client feels looked after. Log the outcome in the CRM once the call is done.",
          "CCAPL",
          JSON.stringify([
            { id: "btn_cb_acc", type: "QUICK_REPLY", text: "Accept Callback" },
            { id: "btn_cb_snz", type: "QUICK_REPLY", text: "Snooze 30 Minutes" },
          ]),
          JSON.stringify([
            { index: 1, label: "Staff Name", sourceField: "custom", sampleValue: "Ananya" },
            { index: 2, label: "Client Name", sourceField: "customer.fullName", sampleValue: "Rahul Mehta" },
            { index: 3, label: "Client Phone", sourceField: "custom", sampleValue: "+91 98765 43210" },
            { index: 4, label: "Preferred Time", sourceField: "custom", sampleValue: "Today, 4:00 PM" },
          ]),
          isoNow,
          isoNow,
        ],
      },
    ],
    "write"
  );

  if (!shouldSeedDemoData && envMeta.hasLiveCredentials) {
    await mkt.execute(`
      UPDATE templates
      SET approval_status = 'DRAFT'
      WHERE approval_status = 'APPROVED'
        AND (meta_template_id IS NULL OR TRIM(meta_template_id) = '')
    `);
  }

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
        { id: `btn_${id}_1`, type: "URL", text: ctaLabel, url: ctaUrl, urlType: "STATIC" },
        ...(category === "MARKETING"
          ? [{ id: `btn_${id}_2`, type: "QUICK_REPLY", text: "Talk to Sales Team" }]
          : []),
      ]);
    } else if ((curButtons === "[]" || !curButtons) && category === "AUTHENTICATION") {
      nextButtonsJson = JSON.stringify([
        { id: `btn_${id}_otp`, type: "COPY_CODE", text: "Copy Code", exampleCode: "482910" },
      ]);
    }

    let nextVarsJson = curVars;
    if (curVars === "[]" || !curVars) {
      const matches = Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1]));
      const uniqueNums = Array.from(new Set(matches)).sort((a, b) => a - b);
      const defaults = uniqueNums.map((n) => {
        if (category === "AUTHENTICATION" && n === 1) {
          return { index: 1, label: "Verification Code", sourceField: "custom", sampleValue: "482910" };
        }
        if (n === 1) {
          return { index: 1, label: "Customer First Name", sourceField: "customer.firstName", sampleValue: "Vikram" };
        }
        if (n === 2) {
          return { index: 2, label: "Order Number", sourceField: "order.latestNumber", sampleValue: "CC-2026-1089" };
        }
        return { index: n, label: `Detail ${n}`, sourceField: "custom", sampleValue: "ready for dispatch" };
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

  await bill.execute(
    `UPDATE message_billing_ledger
     SET delivery_mode = 'SEED'
     WHERE id IN ('ldg_1', 'ldg_2', 'ldg_3', 'ldg_4', 'ldg_5', 'ldg_6', 'ldg_7') AND delivery_mode = 'LIVE_META_CLOUD'`
  );
  await bill.execute(
    `UPDATE message_billing_ledger
     SET delivery_mode = 'SANDBOX_SIMULATOR'
     WHERE delivery_mode = 'LIVE_META_CLOUD'
       AND (
         conversation_id LIKE 'conv_test_%'
         OR conversation_id LIKE 'conv_failroute_%'
         OR conversation_id LIKE 'conv_dupwa_%'
         OR conversation_id LIKE 'conv_att_%'
         OR customer_phone LIKE '+910000%'
         OR staff_name LIKE '%Live Mode Test%'
       )`
  );
  await bill.execute(
    `DELETE FROM message_billing_ledger WHERE category = 'SERVICE'`
  );

  return hadZeroTemplates;
}
