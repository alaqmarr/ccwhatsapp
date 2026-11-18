import crypto from "node:crypto";
import fs from "node:fs";
import nodemailer from "nodemailer";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolveClassicConceptsInternalUrl,
  resolveClassicEdgeInternalUrl,
  resolveEcosystemBridgeKey,
  resolveMainWebsiteDbPath,
  resolveWhatsAppWebAppOrigin,
} from "@cc/database";
import {
  type OutboundWhatsAppSendResult,
  sendWhatsAppCloudMessage,
} from "./whatsapp-cloud.acrio.ai";

// ============================================================================
// 5. UNIVERSAL ECOSYSTEM SMTP & STAFF ASSIGNMENT EMAIL DISPATCHER
// ============================================================================
export interface SmtpResolvedConfig {
  configured: boolean;
  source:
    | "whatsapp_db"
    | "whatsapp_env"
    | "classicconcepts_db"
    | "bridge_3003"
    | "bridge_3002"
    | "none";
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

async function resolveDirectSmtpCredentials(): Promise<SmtpResolvedConfig> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");

  // 1. Check WhatsApp setup_state ('smtp_config')
  try {
    const cfgRes = await auth.execute(
      `SELECT value_json FROM setup_state WHERE key = 'smtp_config' LIMIT 1`
    );
    if (cfgRes.rows[0]?.value_json) {
      const parsed = JSON.parse(String(cfgRes.rows[0].value_json));
      if (parsed?.host && parsed?.user && parsed?.pass) {
        return {
          configured: true,
          source: "whatsapp_db",
          host: String(parsed.host).trim(),
          port: Number(parsed.port || 587),
          user: String(parsed.user).trim(),
          pass: String(parsed.pass).trim(),
          from:
            String(parsed.from || "").trim() ||
            `"Classic Concepts WhatsApp Desk" <${String(parsed.user).trim()}>`,
        };
      }
    }
  } catch {
    // Non-blocking
  }

  // 2. Check ccwhatsapp environment variables
  const envHost = (process.env.SMTP_HOST || "").trim();
  const envUser = (process.env.SMTP_USER || "").trim();
  const envPass = (process.env.SMTP_PASS || "").trim();
  if (envHost && envUser && envPass) {
    return {
      configured: true,
      source: "whatsapp_env",
      host: envHost,
      port: Number(process.env.SMTP_PORT || 587),
      user: envUser,
      pass: envPass,
      from:
        (process.env.SMTP_FROM || "").trim() ||
        `"Classic Concepts WhatsApp Desk" <${envUser}>`,
    };
  }

  // 3. Check sibling classicconcepts/dev.db SiteSetting SMTP credentials
  try {
    const mainDbPath = resolveMainWebsiteDbPath();
    if (mainDbPath && fs.existsSync(/*turbopackIgnore: true*/ mainDbPath)) {
      const { createClient } = await import("@libsql/client");
      const normalized = mainDbPath.replace(/\\/g, "/");
      const url = normalized.startsWith("/")
        ? `file:${normalized}`
        : `file:///${normalized}`;
      const ccClient = createClient({ url });
      const sRes = await ccClient.execute(
        `SELECT smtpHost, smtpPort, smtpUser, smtpPass, email FROM SiteSetting LIMIT 1`
      );
      const r = sRes.rows[0];
      if (r?.smtpUser && r?.smtpPass) {
        const resolvedHost = String(r.smtpHost || "smtp.gmail.com").trim() || "smtp.gmail.com";
        const rawPass = String(r.smtpPass).trim();
        const cleanPass = resolvedHost.toLowerCase().includes("gmail")
          ? rawPass.replace(/\s+/g, "")
          : rawPass;
        return {
          configured: true,
          source: "classicconcepts_db",
          host: resolvedHost,
          port: Number(r.smtpPort || 587),
          user: String(r.smtpUser).trim(),
          pass: cleanPass,
          from: `"Classic Concepts" <${String(r.smtpUser).trim()}>`,
        };
      }
    }
  } catch {
    // Non-blocking
  }

  return {
    configured: false,
    source: "none",
    host: "",
    port: 587,
    user: "",
    pass: "",
    from: "",
  };
}

export async function getSmtpConfigSummary(): Promise<{
  configured: boolean;
  source: string;
  host: string;
  port: number;
  userMasked: string;
  from: string;
}> {
  const direct = await resolveDirectSmtpCredentials();
  if (direct.configured) {
    const u = direct.user;
    const masked =
      u.length > 5 ? `${u.slice(0, 3)}***${u.slice(u.indexOf("@"))}` : u;
    return {
      configured: true,
      source: direct.source,
      host: direct.host,
      port: direct.port,
      userMasked: masked,
      from: direct.from,
    };
  }

  // Probe :3003 / :3002 bridges to see if relay SMTP is active
  const key = resolveEcosystemBridgeKey();
  for (const candidate of [
    { url: resolveClassicConceptsInternalUrl(), label: "bridge_3003" },
    { url: resolveClassicEdgeInternalUrl(), label: "bridge_3002" },
  ]) {
    try {
      const res = await fetch(`${candidate.url}/api/internal/bridge?action=health`, {
        headers: { "x-cc-bridge-key": key },
        signal: AbortSignal.timeout(1800),
      });
      if (res.ok) {
        const json: any = await res.json().catch(() => ({}));
        if (json?.smtpConfigured) {
          return {
            configured: true,
            source: candidate.label,
            host: `${candidate.url} (Shared Ecosystem SMTP Relay)`,
            port: 587,
            userMasked: "Connected via Website SMTP",
            from: "Classic Concepts Ecosystem Mailer",
          };
        }
      }
    } catch {
      // Ignore offline bridge
    }
  }

  return {
    configured: false,
    source: "none",
    host: "",
    port: 587,
    userMasked: "",
    from: "",
  };
}

export async function saveSmtpConfig(params: {
  host: string;
  port: number;
  user: string;
  pass?: string;
  from?: string;
}): Promise<void> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const prevRes = await auth.execute(
    `SELECT value_json FROM setup_state WHERE key = 'smtp_config' LIMIT 1`
  );
  let prevPass = "";
  if (prevRes.rows[0]?.value_json) {
    try {
      prevPass = String(
        JSON.parse(String(prevRes.rows[0].value_json))?.pass || ""
      );
    } catch {
      prevPass = "";
    }
  }
  const finalPass = params.pass?.trim() ? params.pass.trim() : prevPass;
  const nowIso = new Date().toISOString();
  await auth.execute({
    sql: `INSERT INTO setup_state (key, value_json, updated_at)
          VALUES ('smtp_config', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    args: [
      JSON.stringify({
        host: params.host.trim(),
        port: Number(params.port || 587),
        user: params.user.trim(),
        pass: finalPass,
        from: (params.from || "").trim(),
      }),
      nowIso,
    ],
  });
}

export async function dispatchSystemEmail(params: {
  to: string;
  recipientName?: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  dispatchType:
    | "STAFF_ASSIGNMENT"
    | "STAFF_ESCALATION"
    | "STAFF_OTP"
    | "STAFF_MENTION"
    | "STAFF_CALLBACK"
    | "EMAIL_CHANGE_OTP"
    | "EMAIL_CHANGED_NOTICE"
    | "WEBSITE_ENQUIRY_REPLY"
    | "SMTP_TEST";
  conversationId?: string | null;
}): Promise<{ ok: boolean; via: string; error?: string }> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const cleanTo = String(params.to || "").trim();
  const nowIso = new Date().toISOString();

  const logAttempt = async (
    status: "SENT" | "QUEUED_NO_SMTP" | "FAILED",
    via: string,
    errText?: string
  ) => {
    await auth
      .execute({
        sql: `INSERT INTO email_dispatch_logs (
          id, dispatch_type, recipient_email, recipient_name, subject, conversation_id, status, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          `emlog_${crypto.randomUUID().slice(0, 10)}`,
          params.dispatchType,
          cleanTo || "unknown",
          params.recipientName || null,
          `${params.subject} [${via}]`.slice(0, 200),
          params.conversationId || null,
          status,
          errText || null,
          nowIso,
        ],
      })
      .catch(() => {});
  };

  if (!cleanTo || !cleanTo.includes("@")) {
    await logAttempt("FAILED", "validation", "Missing valid recipient email.");
    return { ok: false, via: "none", error: "Missing valid recipient email." };
  }

  // 1. Direct Nodemailer transport if credentials available
  const direct = await resolveDirectSmtpCredentials();
  if (direct.configured) {
    try {
      const transporter = nodemailer.createTransport({
        host: direct.host,
        port: direct.port,
        secure: direct.port === 465,
        auth: { user: direct.user, pass: direct.pass },
      });
      await transporter.sendMail({
        from: direct.from,
        to: cleanTo,
        ...(params.replyTo ? { replyTo: params.replyTo } : {}),
        subject: params.subject,
        text: params.text,
        ...(params.html ? { html: params.html } : {}),
      });
      await logAttempt("SENT", direct.source);
      return { ok: true, via: direct.source };
    } catch (err: any) {
      // Fall through to HTTP bridge relays before giving up
      const directErr = err?.message || "Direct SMTP failed";
      // Try bridge relays next
      const bridgeRes = await relayEmailViaEcosystemBridges(params);
      if (bridgeRes.ok) {
        await logAttempt("SENT", bridgeRes.via);
        return bridgeRes;
      }
      await logAttempt("FAILED", direct.source, directErr);
      return { ok: false, via: direct.source, error: directErr };
    }
  }

  // 2. Relay via Classic Concepts (:3003) or Classic Edge (:3002) internal SMTP bridge
  const bridgeRes = await relayEmailViaEcosystemBridges(params);
  if (bridgeRes.ok) {
    await logAttempt("SENT", bridgeRes.via);
    return bridgeRes;
  }

  await logAttempt(
    "QUEUED_NO_SMTP",
    "none",
    bridgeRes.error || "SMTP credentials not configured yet."
  );
  return {
    ok: false,
    via: "none",
    error:
      bridgeRes.error ||
      "SMTP is not configured yet. Add SMTP credentials in Teams -> Email Notifications or .env.production.",
  };
}

async function relayEmailViaEcosystemBridges(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}): Promise<{ ok: boolean; via: string; error?: string }> {
  const key = resolveEcosystemBridgeKey();
  const targets = [
    { url: resolveClassicConceptsInternalUrl(), via: "bridge_3003" },
    { url: resolveClassicEdgeInternalUrl(), via: "bridge_3002" },
  ];

  for (const t of targets) {
    try {
      const res = await fetch(`${t.url}/api/internal/bridge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cc-bridge-key": key,
        },
        body: JSON.stringify({
          action: "send_smtp_mail",
          to: params.to,
          subject: params.subject,
          text: params.text,
          html: params.html,
          replyTo: params.replyTo,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const json: any = await res.json().catch(() => ({}));
        if (json?.ok) {
          return { ok: true, via: t.via };
        }
      }
    } catch {
      // Try next bridge
    }
  }
  return { ok: false, via: "none", error: "No active SMTP relay found on :3003 or :3002." };
}

export async function listRecentEmailDispatchLogs(limit = 30): Promise<
  {
    id: string;
    dispatchType: string;
    recipientEmail: string;
    recipientName: string;
    subject: string;
    conversationId: string | null;
    status: string;
    errorMessage: string | null;
    createdAt: string;
  }[]
> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const safeLimit = Math.min(100, Math.max(1, limit));
  const res = await auth
    .execute(
      `SELECT * FROM email_dispatch_logs ORDER BY created_at DESC LIMIT ${safeLimit}`
    )
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));
  return res.rows.map((r) => ({
    id: String(r.id),
    dispatchType: String(r.dispatch_type || ""),
    recipientEmail: String(r.recipient_email || ""),
    recipientName: String(r.recipient_name || ""),
    subject: String(r.subject || ""),
    conversationId: r.conversation_id ? String(r.conversation_id) : null,
    status: String(r.status || ""),
    errorMessage: r.error_message ? String(r.error_message) : null,
    createdAt: String(r.created_at || ""),
  }));
}

export async function sendStaffAssignmentEmailNotification(params: {
  staffId?: string | null;
  staffEmail?: string | null;
  staffWhatsapp?: string | null;
  staffName: string;
  customerName: string;
  customerPhone: string;
  smartCategory?: string;
  priority?: string;
  escalationLevel?: string;
  teamName?: string;
  reason?: string;
  latestMessage?: string;
  quoteProduct?: string;
  quoteQuantity?: string;
  sendWhatsApp?: boolean;
  conversationId: string;
  isEscalation?: boolean;
}): Promise<{ ok: boolean; via: string; whatsappSent?: boolean; error?: string }> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const conv = getRawLibSqlClient("conversations");

  let targetEmail = (params.staffEmail || "").trim();
  let targetWhatsapp = (params.staffWhatsapp || "").trim();
  let alertsDisabled = false;

  if (params.staffId && params.staffId !== "ACRIO") {
    const uRes = await auth.execute({
      sql: `SELECT email, whatsapp_number, status FROM users WHERE id = ? LIMIT 1`,
      args: [params.staffId],
    });
    const uRow = uRes.rows[0];
    if (!uRow || String(uRow.status) !== "ACTIVE") {
      return { ok: false, via: "none", error: "Staff member is not active." };
    }
    if (!targetEmail) targetEmail = String(uRow.email || "").trim();
    if (!targetWhatsapp) targetWhatsapp = String(uRow.whatsapp_number || "").trim();

    // Respect per-member email_alerts_enabled flag if present
    const tmRes = await conv
      .execute({
        sql: `SELECT email_alerts_enabled FROM team_members WHERE staff_id = ? LIMIT 1`,
        args: [params.staffId],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    if (
      tmRes.rows[0] &&
      tmRes.rows[0].email_alerts_enabled !== undefined &&
      Number(tmRes.rows[0].email_alerts_enabled) === 0
    ) {
      alertsDisabled = true;
    }
  }

  let whatsappSent = false;
  if (params.sendWhatsApp !== false && targetWhatsapp && !alertsDisabled) {
    const quoteInfo = extractQuoteRequestDetails({
      text: `${params.latestMessage || ""} ${params.reason || ""}`,
      smartCategory: params.smartCategory,
      productName: params.quoteProduct,
      explicitQuantity: params.quoteQuantity,
    });
    if (quoteInfo.isQuoteRequest) {
      const waQuoteRes = await sendQuoteRequestAlertTemplate({
        toPhone: targetWhatsapp,
        staffName: params.staffName,
        customerName: params.customerName,
        customerPhone: params.customerPhone,
        productName: quoteInfo.product,
        quantity: quoteInfo.quantity,
      }).catch(() => ({ ok: false }));
      whatsappSent = waQuoteRes.ok;
    } else {
      const waAssignRes = await sendStaffClientAssignmentTemplate({
        toPhone: targetWhatsapp,
        staffName: params.staffName,
        customerName: params.customerName,
        customerPhone: params.customerPhone,
      }).catch(() => ({ ok: false }));
      whatsappSent = waAssignRes.ok;
    }
  }

  if (alertsDisabled) {
    return { ok: whatsappSent, via: "disabled_by_preference", whatsappSent };
  }

  if (!targetEmail) {
    return {
      ok: whatsappSent,
      via: whatsappSent ? "whatsapp_only" : "none",
      whatsappSent,
      error: whatsappSent ? undefined : "No staff email found.",
    };
  }

  const appOrigin = resolveWhatsAppWebAppOrigin();
  const openChatUrl = `${appOrigin}/dashboard/inbox?chat=${encodeURIComponent(
    params.conversationId
  )}`;
  const badge = params.isEscalation
    ? `[ESCALATED ${params.escalationLevel || "P1"}]`
    : `[${params.priority || "NEW"} CHAT ASSIGNED]`;

  const subject = `${badge} ${params.customerName} (${params.customerPhone}) - Classic Concepts WhatsApp`;
  const latestPreview = (params.latestMessage || "Customer waiting for your reply.")
    .slice(0, 420);

  const text = [
    `Hello ${params.staffName},`,
    ``,
    params.isEscalation
      ? `A WhatsApp customer chat has been escalated to you (${params.escalationLevel || "P1"} in ${params.teamName || "Sales Team"}).`
      : `A WhatsApp customer chat has been assigned to you (${params.teamName || "Sales Team"} - ${params.escalationLevel || "P0"}).`,
    ``,
    `Customer: ${params.customerName} (${params.customerPhone})`,
    `Category: ${params.smartCategory || "General Enquiry"} | Priority: ${params.priority || "NORMAL"}`,
    params.reason ? `Assignment Note: ${params.reason}` : "",
    ``,
    `Latest Customer Message:`,
    `"${latestPreview}"`,
    ``,
    `Open Chat Directly:`,
    openChatUrl,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #ffffff;">
      <div style="background: ${params.isEscalation ? "#b45309" : "#075e54"}; color: #ffffff; padding: 16px 20px;">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.9;">
          ${params.isEscalation ? `Wait-Time Escalation (${params.escalationLevel || "P1"})` : `WhatsApp Chat Assigned (${params.teamName || "Sales Team"})`}
        </div>
        <div style="font-size: 18px; font-weight: 700; margin-top: 4px;">
          ${params.customerName} <span style="font-weight: 400; font-size: 14px;">(${params.customerPhone})</span>
        </div>
      </div>
      <div style="padding: 20px; color: #1e293b; font-size: 14px; line-height: 1.55;">
        <p style="margin: 0 0 12px;">Hello <strong>${params.staffName}</strong>,</p>
        <p style="margin: 0 0 14px;">
          ${params.reason || "This customer conversation is now assigned to you and waiting for a response."}
        </p>
        <div style="background: #f8fafc; border-left: 4px solid #10b981; padding: 12px 14px; border-radius: 6px; margin-bottom: 16px;">
          <div style="font-size: 11px; color: #64748b; font-weight: 600; margin-bottom: 4px;">
            ${params.smartCategory || "General Enquiry"} • Priority: ${params.priority || "NORMAL"}
          </div>
          <div style="white-space: pre-wrap; color: #0f172a;">${latestPreview.replace(/</g, "&lt;")}</div>
        </div>
        <a href="${openChatUrl}" style="display: inline-block; background: #10b981; color: #ffffff; font-weight: 600; text-decoration: none; padding: 11px 20px; border-radius: 8px;">
          Open Chat in WhatsApp Inbox
        </a>
      </div>
    </div>
  `;

  const emailRes = await dispatchSystemEmail({
    to: targetEmail,
    recipientName: params.staffName,
    subject,
    text,
    html,
    dispatchType: params.isEscalation ? "STAFF_ESCALATION" : "STAFF_ASSIGNMENT",
    conversationId: params.conversationId,
  });
  return { ...emailRes, whatsappSent };
}

export async function sendStaffVerificationEmail(params: {
  email: string;
  staffName: string;
  otpCode: string;
}): Promise<{ deliveredViaSmtp: boolean; devPreviewCode?: string }> {
  const res = await dispatchSystemEmail({
    to: params.email,
    recipientName: params.staffName,
    subject: `${params.otpCode} is your Classic Concepts Staff Verification Code`,
    text: `Hello ${params.staffName},\n\nYour 6-digit email verification code for Classic Concepts WhatsApp Staff Hub is: ${params.otpCode}\n\nThis code is valid for 15 minutes. Once verified, your account will be sent to a Superadmin/Dev for final activation.\n`,
    dispatchType: "STAFF_OTP",
  });

  if (res.ok) {
    return { deliveredViaSmtp: true };
  }
  return { deliveredViaSmtp: false, devPreviewCode: params.otpCode };
}

function escapeHtmlText(s: string): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Emails a teammate about something that needs them (a mention, a callback request).
 * Respects the per-member "email alerts" switch on the team_members table.
 */
export async function sendStaffAlertEmail(params: {
  staffId?: string | null;
  staffEmail?: string | null;
  staffName: string;
  subject: string;
  headline: string;
  detail: string;
  conversationId?: string | null;
  ctaLabel?: string;
  dispatchType: "STAFF_MENTION" | "STAFF_CALLBACK";
}): Promise<{ ok: boolean; via: string; error?: string }> {
  if (process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS === "1") {
    return { ok: true, via: "sandbox_test_skip" };
  }
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const to = String(params.staffEmail || "").trim();
  if (!to) return { ok: false, via: "none", error: "No staff email found." };

  if (params.staffId) {
    const pref = await conv
      .execute({
        sql: `SELECT email_alerts_enabled FROM team_members WHERE staff_id = ? LIMIT 1`,
        args: [params.staffId],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    if (pref.rows[0] && pref.rows[0].email_alerts_enabled !== undefined && Number(pref.rows[0].email_alerts_enabled) === 0) {
      return { ok: false, via: "disabled_by_preference" };
    }
  }

  const origin = resolveWhatsAppWebAppOrigin();
  const link = params.conversationId
    ? `${origin}/dashboard/inbox?chat=${encodeURIComponent(params.conversationId)}`
    : `${origin}/dashboard`;
  const text = [`Hello ${params.staffName},`, "", params.headline, "", params.detail, "", `${params.ctaLabel || "Open chat"}: ${link}`].join("\n");
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#fff;">
      <div style="background:#075e54;color:#fff;padding:16px 20px;font-size:16px;font-weight:700;">${escapeHtmlText(params.headline)}</div>
      <div style="padding:20px;color:#1e293b;font-size:14px;line-height:1.55;">
        <p style="margin:0 0 12px;">Hello <strong>${escapeHtmlText(params.staffName)}</strong>,</p>
        <div style="background:#f8fafc;border-left:4px solid #10b981;padding:12px 14px;border-radius:6px;margin-bottom:16px;white-space:pre-wrap;">${escapeHtmlText(params.detail)}</div>
        <a href="${link}" style="display:inline-block;background:#10b981;color:#fff;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:8px;">${escapeHtmlText(params.ctaLabel || "Open chat")}</a>
      </div>
    </div>`;
  return dispatchSystemEmail({
    to,
    recipientName: params.staffName,
    subject: params.subject,
    text,
    html,
    dispatchType: params.dispatchType,
    conversationId: params.conversationId || null,
  });
}

function cleanMetaTemplateParam(raw: string | null | undefined, maxLen = 200): string {
  const cleaned = String(raw || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLen);
  return cleaned || "-";
}

async function resolveStaffWhatsappPhone(params: {
  toPhone?: string | null;
  staffId?: string | null;
}): Promise<string> {
  const direct = String(params.toPhone || "").trim();
  if (direct) return direct;
  if (!params.staffId || params.staffId === "ACRIO") return "";
  try {
    await ensureDatabasesBootstrapped();
    const auth = getRawLibSqlClient("core_auth");
    const u = await auth.execute({
      sql: `SELECT whatsapp_number, status FROM users WHERE id = ? LIMIT 1`,
      args: [params.staffId],
    });
    if (u.rows[0] && String(u.rows[0].status) === "ACTIVE") {
      return String(u.rows[0].whatsapp_number || "").trim();
    }
  } catch {
    // ignore lookup failure
  }
  return "";
}

export function extractQuoteRequestDetails(params: {
  text: string;
  smartCategory?: string;
  productName?: string;
  explicitQuantity?: string;
}): { isQuoteRequest: boolean; product: string; quantity: string } {
  const raw = String(params.text || "").trim();
  const explicitProd = String(params.productName || "").trim();
  const isQuoteRequest =
    Boolean(explicitProd) ||
    /\b(quote|quotation|price|pricing|cost|rate|rates|estimate|bulk|qty|quantity|proforma|rfq|requirements?|how\s+much|give\s+me\s+(?:the\s+)?best)\b/i.test(
      raw
    ) ||
    /\b\d+\s*(?:nos|pcs|pieces|units|podiums?|machines?|chairs?|tables?|sheets?|awards?|trophies?|boxes?|sets?)\b/i.test(
      raw
    );

  const qtyMatch =
    raw.match(/\b(?:qty|quantity)\s*[:=-]?\s*(\d{1,5}(?:\s*(?:nos|pcs|pieces|units|sets?))?)\b/i) ||
    raw.match(/\b(\d{1,5}\s*(?:nos|pcs|pieces|units|podiums?|machines?|chairs?|tables?|sheets?|awards?|trophies?|boxes?|sets?))\b/i);
  const quantity =
    String(params.explicitQuantity || "").trim() ||
    (qtyMatch?.[1] ? qtyMatch[1].trim() : "As requested");

  const skuMatch = raw.match(/\b(CCP\d{2,4}[A-Z]?|YN-[A-Z0-9-]+|JW-?\d+[A-Z]?|ZD-?\d+)\b/i);
  const product =
    explicitProd ||
    (skuMatch?.[1] ? skuMatch[1].toUpperCase() : "") ||
    (params.smartCategory && params.smartCategory !== "General Enquiry"
      ? params.smartCategory
      : raw.slice(0, 80) || "Acrylic / Machine Requirement");

  return { isQuoteRequest, product, quantity };
}

/** Sends `cc_website_enquiry_received` (Meta-approved MARKETING template, body {{1}}=customerName). */
export async function sendWebsiteEnquiryReceivedTemplate(params: {
  toPhone: string;
  customerName: string;
}): Promise<
  OutboundWhatsAppSendResult & {
    bodyText: string;
    templateName: "cc_website_enquiry_received";
    billingCategory: "MARKETING";
  }
> {
  const firstOrFull = cleanMetaTemplateParam(
    params.customerName && !/^\+?\d/.test(params.customerName.trim())
      ? params.customerName
      : "there",
    80
  );
  const renderedBody = [
    "We Have Received Your Enquiry",
    "",
    `Hello ${firstOrFull},`,
    "",
    "Thank you for reaching out to *Classic Concepts*. We have received your enquiry, and our team is reviewing the details you shared.",
    "",
    "*What happens next:*",
    "• A team member will review your requirements",
    "• You will hear back from us within *1 business day*",
    "• Keep an eye on this chat for updates",
    "",
    "In the meantime, you can browse our latest designs here:",
    "https://ccapl.cc/TD6QEo",
    "",
    "We look forward to working with you.",
  ].join("\n");

  const res = await sendWhatsAppCloudMessage({
    toPhone: params.toPhone,
    bodyText: renderedBody,
    templateName: "cc_website_enquiry_received",
    languageCode: "en",
    skipAutoChatRecord: true,
    templateComponents: [
      {
        type: "body",
        parameters: [{ type: "text", text: firstOrFull }],
      },
    ],
  });

  return {
    ...res,
    bodyText: renderedBody,
    templateName: "cc_website_enquiry_received",
    billingCategory: "MARKETING",
  };
}

/** Sends `cc_quote_request_alert` (Meta-approved UTILITY template: {{1}}=staffName, {{2}}=customer, {{3}}=product, {{4}}=quantity). */
export async function sendQuoteRequestAlertTemplate(params: {
  toPhone?: string | null;
  staffId?: string | null;
  staffName: string;
  customerName: string;
  customerPhone?: string;
  productName: string;
  quantity?: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const toPhone = await resolveStaffWhatsappPhone(params);
  if (!toPhone) return { ok: false, skipped: true };

  const staffVar = cleanMetaTemplateParam(params.staffName, 80);
  const custVar = cleanMetaTemplateParam(
    params.customerPhone
      ? `${params.customerName || params.customerPhone} (${params.customerPhone})`
      : params.customerName,
    120
  );
  const prodVar = cleanMetaTemplateParam(params.productName, 140);
  const qtyVar = cleanMetaTemplateParam(params.quantity || "As requested", 80);

  const renderedBody = [
    "New Quote Request Received",
    "",
    `Hello ${staffVar},`,
    "",
    `A new *quote request* just came in from ${custVar}.`,
    "",
    `• Product: ${prodVar}`,
    `• Quantity: ${qtyVar}`,
    "",
    "Please reply within *1 working hour* to keep the lead warm.",
    "",
    "Catalog: https://ccapl.cc/eSzcdT",
  ].join("\n");

  const res = await sendWhatsAppCloudMessage({
    toPhone,
    bodyText: renderedBody,
    templateName: "cc_quote_request_alert",
    languageCode: "en",
    recordBillingCategory: "UTILITY",
    recordSenderName: "ACRIO • Quote Alert",
    recordMetadata: {
      alertType: "QUOTE_REQUEST",
      alertCustomerPhone: params.customerPhone || "",
      alertCustomerName: params.customerName || "",
      alertProductName: params.productName || "",
    },
    templateComponents: [
      {
        type: "body",
        parameters: [staffVar, custVar, prodVar, qtyVar].map((text) => ({
          type: "text",
          text,
        })),
      },
    ],
  });
  if (!res.ok) console.warn("[WA] cc_quote_request_alert failed:", res.error);
  return { ok: res.ok, error: res.error };
}

/** Sends `cc_staff_client_assignment` (Meta-approved MARKETING template: {{1}}=staffName, {{2}}=clientName, {{3}}=clientPhone). */
export async function sendStaffClientAssignmentTemplate(params: {
  toPhone?: string | null;
  staffId?: string | null;
  staffName: string;
  customerName: string;
  customerPhone: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const toPhone = await resolveStaffWhatsappPhone(params);
  if (!toPhone) return { ok: false, skipped: true };

  const staffVar = cleanMetaTemplateParam(params.staffName, 80);
  const clientVar = cleanMetaTemplateParam(params.customerName || params.customerPhone, 100);
  const phoneVar = cleanMetaTemplateParam(params.customerPhone || "Not provided", 40);

  const renderedBody = [
    "New Client Assigned to You",
    "",
    `Hello ${staffVar},`,
    "",
    "A new client has been assigned to you in Classic Concepts.",
    "",
    `*Client Name:* ${clientVar}`,
    `*Client Phone:* ${phoneVar}`,
    "",
    "• Review the client profile before reaching out",
    "• Reply within 1 working hours for the best response",
    "• Update the lead status once you have spoken to them",
    "",
    "Reply below to confirm or get help.",
  ].join("\n");

  const res = await sendWhatsAppCloudMessage({
    toPhone,
    bodyText: renderedBody,
    templateName: "cc_staff_client_assignment",
    languageCode: "en",
    recordBillingCategory: "MARKETING",
    recordSenderName: "ACRIO • Assignment Alert",
    recordMetadata: {
      alertType: "STAFF_ASSIGNMENT",
      alertCustomerPhone: params.customerPhone || "",
      alertCustomerName: params.customerName || "",
    },
    templateComponents: [
      {
        type: "body",
        parameters: [staffVar, clientVar, phoneVar].map((text) => ({
          type: "text",
          text,
        })),
      },
    ],
  });
  if (!res.ok) console.warn("[WA] cc_staff_client_assignment failed:", res.error);
  return { ok: res.ok, error: res.error };
}

/** Sends `cc_callback_request_alert` (Meta-approved MARKETING template: {{1}}=staffName, {{2}}=clientName, {{3}}=clientPhone, {{4}}=preferredTime). */
export async function sendCallbackRequestAlertTemplate(params: {
  toPhone?: string | null;
  staffId?: string | null;
  staffName: string;
  customerName: string;
  customerPhone: string;
  preferredTime?: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const toPhone = await resolveStaffWhatsappPhone(params);
  if (!toPhone) return { ok: false, skipped: true };

  const staffVar = cleanMetaTemplateParam(params.staffName, 80);
  const clientVar = cleanMetaTemplateParam(params.customerName || params.customerPhone, 100);
  const phoneVar = cleanMetaTemplateParam(params.customerPhone || "Not provided", 40);
  const slotVar = cleanMetaTemplateParam(params.preferredTime || "As soon as possible", 100);

  const renderedBody = [
    "New Callback Request Received",
    "",
    `Hello ${staffVar},`,
    "",
    "A client has requested a *callback*.",
    "",
    `• Client: ${clientVar}`,
    `• Phone: ${phoneVar}`,
    `• Preferred time: ${slotVar}`,
    "",
    "Please reach out within the next *30 minutes* so the client feels looked after. Log the outcome in the CRM once the call is done.",
  ].join("\n");

  const res = await sendWhatsAppCloudMessage({
    toPhone,
    bodyText: renderedBody,
    templateName: "cc_callback_request_alert",
    languageCode: "en",
    recordBillingCategory: "MARKETING",
    recordSenderName: "ACRIO • Callback Alert",
    recordMetadata: {
      alertType: "CALLBACK_REQUEST",
      alertCustomerPhone: params.customerPhone || "",
      alertCustomerName: params.customerName || "",
    },
    templateComponents: [
      {
        type: "body",
        parameters: [staffVar, clientVar, phoneVar, slotVar].map((text) => ({
          type: "text",
          text,
        })),
      },
    ],
  });
  if (!res.ok) console.warn("[WA] cc_callback_request_alert failed:", res.error);
  return { ok: res.ok, error: res.error };
}

/**
 * Optional WhatsApp ping to a teammate's own number. WhatsApp only allows free text inside a 24 hour
 * window, so this uses WHATSAPP_STAFF_ALERT_TEMPLATE or falls back to cc_staff_client_assignment.
 */
export async function sendStaffWhatsAppAlert(params: {
  toPhone: string;
  staffName: string;
  headline: string;
  detail: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const templateName = String(process.env.WHATSAPP_STAFF_ALERT_TEMPLATE || "").trim();
  if (!params.toPhone) return { ok: false, skipped: true };
  if (!templateName) {
    return sendStaffClientAssignmentTemplate({
      toPhone: params.toPhone,
      staffName: params.staffName,
      customerName: params.headline,
      customerPhone: params.detail.slice(0, 40),
    });
  }
  const clean = (s: string) => cleanMetaTemplateParam(s, 300);
  const res = await sendWhatsAppCloudMessage({
    toPhone: params.toPhone,
    bodyText: `${params.headline} ${params.detail}`,
    templateName,
    languageCode: String(process.env.WHATSAPP_STAFF_ALERT_TEMPLATE_LANG || "en"),
    templateComponents: [
      {
        type: "body",
        parameters: [params.staffName, params.headline, params.detail].map((t) => ({ type: "text", text: clean(t) })),
      },
    ],
  });
  if (!res.ok) console.warn("[WA] Staff WhatsApp alert failed:", res.error);
  return { ok: res.ok, error: res.error };
}

/** Sends the 6 digit code for changing a login email, to either the old or the new address. */
export async function sendEmailChangeOtpEmail(params: {
  to: string;
  staffName: string;
  otpCode: string;
  which: "OLD" | "NEW";
  oldEmail: string;
  newEmail: string;
}): Promise<{ ok: boolean; devPreviewCode?: string }> {
  const intro =
    params.which === "OLD"
      ? `Someone (hopefully you) asked to change the login email on your Classic Concepts WhatsApp Hub account from ${params.oldEmail} to ${params.newEmail}.`
      : `This address (${params.newEmail}) was entered as the new login email for the Classic Concepts WhatsApp Hub account of ${params.staffName}.`;
  const res = await dispatchSystemEmail({
    to: params.to,
    recipientName: params.staffName,
    subject: `${params.otpCode} is your email change code (${params.which === "OLD" ? "current email" : "new email"})`,
    text: `Hello ${params.staffName},\n\n${intro}\n\nYour 6-digit code is: ${params.otpCode}\n\nIt is valid for 10 minutes. You need the codes from BOTH the old and the new email to finish. If you did not ask for this, ignore this email and your login email stays the same.\n`,
    dispatchType: "EMAIL_CHANGE_OTP",
  });
  return { ok: res.ok, devPreviewCode: res.ok ? undefined : params.otpCode };
}

export async function sendEmailChangedNoticeEmail(params: {
  to: string;
  staffName: string;
  oldEmail: string;
  newEmail: string;
}): Promise<void> {
  await dispatchSystemEmail({
    to: params.to,
    recipientName: params.staffName,
    subject: "Your Classic Concepts login email was changed",
    text: `Hello ${params.staffName},\n\nThe login email on your Classic Concepts WhatsApp Hub account was changed from ${params.oldEmail} to ${params.newEmail}.\n\nIf this was not you, contact a Superadmin right away.\n`,
    dispatchType: "EMAIL_CHANGED_NOTICE",
  }).catch(() => {});
}

