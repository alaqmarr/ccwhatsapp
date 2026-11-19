import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolveWhatsAppWebAppOrigin,
} from "@cc/database";
import { dispatchSystemEmail, escapeHtmlText } from "./email-dispatch";
import {
  extractQuoteRequestDetails,
  sendQuoteRequestAlertTemplate,
  sendStaffClientAssignmentTemplate,
} from "./whatsapp-templates";

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
  const latestPreview = (params.latestMessage || "Customer waiting for your reply.").slice(0, 420);

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
