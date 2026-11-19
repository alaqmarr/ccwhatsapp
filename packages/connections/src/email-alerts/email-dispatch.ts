import crypto from "node:crypto";
import nodemailer from "nodemailer";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolveClassicConceptsInternalUrl,
  resolveClassicEdgeInternalUrl,
  resolveEcosystemBridgeKey,
} from "@cc/database";
import { resolveDirectSmtpCredentials } from "./smtp-config";

export function escapeHtmlText(s: string): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
        signal: AbortSignal.timeout(6000),
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
      const directErr = err?.message || "Direct SMTP failed";
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
      `SELECT id, dispatch_type, recipient_email, recipient_name, subject, conversation_id, status, error_message, created_at
       FROM email_dispatch_logs
       ORDER BY created_at DESC
       LIMIT ${safeLimit}`
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
