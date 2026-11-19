import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
} from "@cc/database";
import {
  type OutboundWhatsAppSendResult,
  sendWhatsAppCloudMessage,
} from "@cc/connections/whatsapp-cloud.acrio.ai";

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
