import type { ApprovedTemplateOption } from "./inbox-server-data";

export interface TemplateCustomerContext {
  name: string;
  phone: string;
  companyName: string | null;
  city: string | null;
  latestOrderNumber: string | null;
}

export interface SmartFilledTemplateResult {
  headerValues: Record<number, string>;
  bodyValues: Record<number, string>;
  orderedHeaderValues: string[];
  orderedBodyValues: string[];
  sources: Record<string, string>;
  renderedHeader: string;
  renderedBody: string;
  renderedFooter: string;
  renderedText: string;
  missingVars: string[];
}

const GENERIC_PLACEHOLDER_NAMES = new Set([
  "unknown",
  "customer",
  "client",
  "guest",
  "new lead",
  "lead",
  "whatsapp user",
  "user",
  "there",
  "hey there",
  "na",
  "n/a",
  "none",
  "-",
]);

const INTERNAL_STAFF_TEMPLATE_NAMES = new Set([
  "cc_quote_request_alert",
  "cc_staff_client_assignment",
  "cc_callback_request_alert",
  "cc_staff_login_otp",
]);

function looksLikePhone(s: string): boolean {
  return /^\+?\d[\d\s()-]{5,}$/.test(s.trim());
}

/** Strips line breaks, tabs, and long runs of spaces rejected by Meta template checks. */
export function cleanTemplateVarValue(raw: string | null | undefined, maxLen = 200): string {
  return String(raw || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {4,}/g, " ")
    .trim()
    .slice(0, maxLen);
}

/** True when the saved customer name looks like a real person or contact name rather than a phone number or placeholder. */
export function isCustomerNameAvailable(rawName: string | null | undefined): boolean {
  const cleaned = String(rawName || "")
    .replace(/\s*\((?:Team|WhatsApp|Lead)\)\s*$/i, "")
    .trim();
  if (!cleaned || looksLikePhone(cleaned)) return false;
  if (GENERIC_PLACEHOLDER_NAMES.has(cleaned.toLowerCase())) return false;
  return /[a-zA-Z\u0900-\u097F]/.test(cleaned);
}

export function extractCustomerFullName(rawName: string | null | undefined): string {
  if (!isCustomerNameAvailable(rawName)) return "";
  return cleanTemplateVarValue(
    String(rawName || "").replace(/\s*\((?:Team|WhatsApp|Lead)\)\s*$/i, ""),
    80
  );
}

export function extractCustomerFirstName(rawName: string | null | undefined): string {
  const full = extractCustomerFullName(rawName);
  if (!full) return "";
  const first = full.split(/[\s,(]+/)[0] || "";
  return cleanTemplateVarValue(first, 60);
}

export function varIndices(text: string | null | undefined): number[] {
  if (!text) return [];
  const found = Array.from(text.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1]));
  return Array.from(new Set(found)).sort((a, b) => a - b);
}

export function fillTemplateText(
  text: string,
  values: Record<number, string>
): string {
  return text.replace(/\{\{(\d+)\}\}/g, (_m, n) => {
    const v = cleanTemplateVarValue(values[Number(n)] || "");
    return v || `{{${n}}}`;
  });
}

function contextSnippetBeforeVar(text: string | null | undefined, index: number): string {
  if (!text) return "";
  const token = `{{${index}}}`;
  const pos = text.indexOf(token);
  if (pos < 0) return "";
  const start = Math.max(0, pos - 48);
  return text.slice(start, pos).toLowerCase();
}

export function guessTemplateVariableValue(
  tpl: ApprovedTemplateOption,
  part: "HEADER" | "BODY",
  index: number,
  ctx: TemplateCustomerContext
): { value: string; source: string } {
  const first = extractCustomerFirstName(ctx.name);
  const full = extractCustomerFullName(ctx.name);
  const fallbackName = "Hey there";

  const spec =
    part === "BODY"
      ? tpl.variablesSchema.find((v) => v.index === index)
      : index === 1 && tpl.variablesSchema[0]?.sourceField === "customer.firstName"
      ? tpl.variablesSchema[0]
      : undefined;

  const src = spec?.sourceField || "";
  const labelLower = String(spec?.label || "").toLowerCase();
  const snippetBefore = contextSnippetBeforeVar(
    part === "HEADER" ? tpl.headerText : tpl.bodyText,
    index
  );

  if (src === "customer.firstName") {
    return first
      ? { value: first, source: "customer's first name" }
      : { value: fallbackName, source: "greeting fallback (name unavailable)" };
  }
  if (src === "customer.fullName") {
    return full
      ? { value: full, source: "customer's name" }
      : { value: fallbackName, source: "greeting fallback (name unavailable)" };
  }
  if (src === "customer.companyName") {
    return ctx.companyName?.trim()
      ? { value: cleanTemplateVarValue(ctx.companyName), source: "customer's company" }
      : { value: "", source: "" };
  }
  if (src === "customer.city") {
    return ctx.city?.trim()
      ? { value: cleanTemplateVarValue(ctx.city), source: "customer's city" }
      : { value: "", source: "" };
  }
  if (src === "order.latestNumber") {
    return ctx.latestOrderNumber?.trim()
      ? { value: cleanTemplateVarValue(ctx.latestOrderNumber), source: "latest order" }
      : { value: "", source: "" };
  }

  // Infer from label or surrounding wording for synced Meta templates without sourceField metadata
  const isStaffField = /\bstaff\b|\bagent\b|\bteam\s*member\b/.test(labelLower);
  const isAuthOtp = tpl.category === "AUTHENTICATION" || /\b(?:otp|code|pin)\b/.test(labelLower);
  const looksLikeGreetingOrName =
    !isStaffField &&
    !isAuthOtp &&
    (/\b(name|customer|client|recipient|person)\b/.test(labelLower) ||
      /(?:^|[\s\n])(?:hello|hi|hey|dear|namaste|greetings|welcome)[,\s]*$/.test(snippetBefore) ||
      (index === 1 && !spec));

  if (looksLikeGreetingOrName) {
    return first
      ? { value: first, source: "customer's first name" }
      : { value: fallbackName, source: "greeting fallback (name unavailable)" };
  }
  if (/\b(?:company|organization|business|firm|hotel|college|institute)\b/.test(labelLower) ||
      /\b(?:from|at|company|organization)\s*[:\-]?\s*$/.test(snippetBefore)) {
    return ctx.companyName?.trim()
      ? { value: cleanTemplateVarValue(ctx.companyName), source: "customer's company" }
      : { value: "", source: "" };
  }
  if (/\b(?:city|town|location|address)\b/.test(labelLower) ||
      /\b(?:in|city|location)\s*[:\-]?\s*$/.test(snippetBefore)) {
    return ctx.city?.trim()
      ? { value: cleanTemplateVarValue(ctx.city), source: "customer's city" }
      : { value: "", source: "" };
  }
  if (/\border\b/.test(labelLower) || /\border(?:\s*(?:id|no|number|#))?\s*[:\-]?\s*$/.test(snippetBefore)) {
    return ctx.latestOrderNumber?.trim()
      ? { value: cleanTemplateVarValue(ctx.latestOrderNumber), source: "latest order" }
      : { value: "", source: "" };
  }
  if (/\b(?:phone|mobile|whatsapp|contact)\b/.test(labelLower) && ctx.phone?.trim()) {
    return { value: cleanTemplateVarValue(ctx.phone), source: "customer's phone" };
  }

  return { value: "", source: "" };
}

/** Smartly pre-fills all variables for a template and renders its live WhatsApp text preview. */
export function smartFillTemplateForCustomer(
  tpl: ApprovedTemplateOption,
  ctx: TemplateCustomerContext,
  overrides?: { headerValues?: Record<number, string>; bodyValues?: Record<number, string> }
): SmartFilledTemplateResult {
  const headerIdx = varIndices(tpl.headerText);
  const bodyIdx = varIndices(tpl.bodyText);
  const headerValues: Record<number, string> = {};
  const bodyValues: Record<number, string> = {};
  const sources: Record<string, string> = {};
  const missingVars: string[] = [];

  for (const idx of headerIdx) {
    const g = guessTemplateVariableValue(tpl, "HEADER", idx, ctx);
    const val =
      overrides?.headerValues && overrides.headerValues[idx] !== undefined
        ? overrides.headerValues[idx]
        : g.value;
    headerValues[idx] = val;
    if (g.value && val === g.value && g.source) sources[`h${idx}`] = g.source;
    if (!cleanTemplateVarValue(val)) missingVars.push(`Header {{${idx}}}`);
  }

  for (const idx of bodyIdx) {
    const g = guessTemplateVariableValue(tpl, "BODY", idx, ctx);
    const val =
      overrides?.bodyValues && overrides.bodyValues[idx] !== undefined
        ? overrides.bodyValues[idx]
        : g.value;
    bodyValues[idx] = val;
    if (g.value && val === g.value && g.source) sources[`b${idx}`] = g.source;
    if (!cleanTemplateVarValue(val)) missingVars.push(`Body {{${idx}}}`);
  }

  const orderedHeaderValues = headerIdx.map((i) => cleanTemplateVarValue(headerValues[i]));
  const orderedBodyValues = bodyIdx.map((i) => cleanTemplateVarValue(bodyValues[i]));

  const renderedHeader = tpl.headerText ? fillTemplateText(tpl.headerText, headerValues) : "";
  const renderedBody = fillTemplateText(tpl.bodyText, bodyValues);
  const renderedFooter = tpl.footerText || "";
  const renderedText = [renderedHeader, renderedBody, renderedFooter]
    .filter(Boolean)
    .join("\n\n");

  return {
    headerValues,
    bodyValues,
    orderedHeaderValues,
    orderedBodyValues,
    sources,
    renderedHeader,
    renderedBody,
    renderedFooter,
    renderedText,
    missingVars,
  };
}

/** True for internal staff-notification or OTP templates that should not initiate a client conversation. */
export function isInternalStaffAlertTemplate(tpl: ApprovedTemplateOption): boolean {
  const lowerName = tpl.name.trim().toLowerCase();
  if (INTERNAL_STAFF_TEMPLATE_NAMES.has(lowerName)) return true;
  if (tpl.category === "AUTHENTICATION") return true;
  if (tpl.variablesSchema.some((v) => /\bstaff\b|\bagent\b/i.test(v.label))) return true;
  const hay = `${tpl.headerText || ""} ${tpl.bodyText}`.toLowerCase();
  return (
    hay.includes("new client has been assigned to you") ||
    hay.includes("client has requested a *callback*") ||
    hay.includes("client has requested a callback") ||
    hay.includes("quote request* just came in") ||
    hay.includes("verification code")
  );
}

function scoreClientInitiationTemplate(tpl: ApprovedTemplateOption): number {
  const name = tpl.name.trim().toLowerCase();
  const hay = `${name} ${tpl.headerText || ""} ${tpl.bodyText}`.toLowerCase();
  const varCount = varIndices(tpl.bodyText).length + varIndices(tpl.headerText).length;
  let score = 0;

  if (name === "cc_website_enquiry_received") score += 100;
  if (name === "hello_world") score += 90;
  if (/\b(?:enquiry|welcome|intro|greet|connect|initiate|follow_up|followup|reach_out|classic)\b/.test(name)) {
    score += 65;
  }
  if (/\b(?:thank you for reaching out|welcome|reaching out|enquiry|connect with you|assist you|help you)\b/.test(hay)) {
    score += 40;
  }
  if (varCount <= 1) score += 25;
  else if (varCount === 2) score += 10;
  else score -= varCount * 10;

  if (/\b(?:order_status|order_tracking|dispatch|tracking)\b/.test(name)) {
    score -= 35;
  }
  return score;
}

/**
 * Selects our ready client-facing WhatsApp templates (up to `limit`, default 2)
 * for starting a new conversation in an empty chat window.
 */
export function selectClientInitiationTemplates(
  templates: ApprovedTemplateOption[],
  limit = 2
): ApprovedTemplateOption[] {
  const customerFacing = templates.filter((tpl) => !isInternalStaffAlertTemplate(tpl));
  const pool = customerFacing.length > 0 ? customerFacing : templates.filter((t) => t.category !== "AUTHENTICATION");
  return [...pool]
    .sort((a, b) => scoreClientInitiationTemplate(b) - scoreClientInitiationTemplate(a))
    .slice(0, limit);
}
