import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import nodemailer from "nodemailer";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  loadAllClassicConceptsProducts,
  loadAllClassicEdgeItems,
  normalizeWhatsAppPhone,
  resolveBackupDirectory,
  resolveClassicConceptsInternalUrl,
  resolveClassicEdgeInternalUrl,
  resolveEcosystemBridgeKey,
  resolveEnvMetaWhatsAppConfig,
  resolveMainWebsiteDbPath,
  resolvePublicShortLinkOrigin,
  resolvePublicTrackingOrigin,
  resolveSharedAnthropicApiKey,
  resolveWhatsAppWebAppOrigin,
  cleanDisplayProductName,
  searchEcosystemItems,
  snapshotAllDatabasesToFolder,
  type MainWebsiteProduct,
} from "@cc/database";
import { socketHub } from "@cc/sockets";
import {
  invalidateWhatsAppCacheTags,
  rememberWhatsAppCache,
} from "@cc/storage";

const LOCKED_CLAUDE_MODEL = "claude-haiku-5-5" as const;

export async function callClaudeHaikuMessages(params: {
  apiKey: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<string | null> {
  if (!params.apiKey) return null;
  const sendWithModel = async (modelId: string) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: params.maxTokens ?? 480,
        temperature: params.temperature ?? 0.25,
        system: params.system,
        messages: params.messages,
      }),
      signal: AbortSignal.timeout(params.timeoutMs ?? 11000),
    });

  const res = await sendWithModel(LOCKED_CLAUDE_MODEL);
  if (!res.ok) return null;
  const json: any = await res.json().catch(() => null);
  const text = json?.content?.[0]?.text;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

export function formatWhatsAppOutboundText(text: string): string {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1: $2")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/__([^_\n]+)__/g, "_$1_")
    .replace(/~~([^~\n]+)~~/g, "~$1~")
    .replace(/\u2014/g, ", ")
    .replace(/\s+\u2013\s+/g, ", ")
    .replace(/--+/g, ", ")
    .replace(/\bbespoke\b/gi, "custom-made")
    .replace(/\bmeticulously\b/gi, "carefully")
    .replace(/\bmeticulous\b/gi, "careful")
    .replace(/\bseamlessly\b/gi, "smoothly")
    .replace(/\bseamless\b/gi, "smooth")
    .replace(/\bunparalleled\b/gi, "top")
    .replace(/\bstate[- ]of[- ]the[- ]art\b/gi, "modern")
    .replace(/\bcutting[- ]edge\b/gi, "modern")
    .replace(/\boptical[- ]grade\b/gi, "crystal-clear")
    .replace(/\bconsultative\b/gi, "helpful")
    .replace(/\bdelving\b/gi, "checking")
    .replace(/\bdelved\b/gi, "checked")
    .replace(/\bdelves\b/gi, "checks")
    .replace(/\bdelve\b/gi, "check")
    .replace(/\belevating\b/gi, "improving")
    .replace(/\belevated\b/gi, "improved")
    .replace(/\belevates\b/gi, "improves")
    .replace(/\belevate\b/gi, "improve")
    .replace(/\brobustly\b/gi, "strongly")
    .replace(/\brobust\b/gi, "strong")
    .replace(/\butiliz(ing|ation)\b/gi, "using")
    .replace(/\butilis(ing|ation)\b/gi, "using")
    .replace(/\butilized\b/gi, "used")
    .replace(/\butilised\b/gi, "used")
    .replace(/\butilizes\b/gi, "uses")
    .replace(/\butilises\b/gi, "uses")
    .replace(/\butilize\b/gi, "use")
    .replace(/\butilise\b/gi, "use")
    .replace(/\bleveraging\b/gi, "using")
    .replace(/\bleveraged\b/gi, "used")
    .replace(/\bleverages\b/gi, "uses")
    .replace(/\bleverage\b/gi, "use")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizePlainEnglish(text: string): string {
  return formatWhatsAppOutboundText(text);
}

export function stripRepeatedGreeting(
  reply: string,
  alreadyGreeted: boolean,
  customerName?: string
): string {
  let out = reply.trim();
  if (!alreadyGreeted || !out) return out;

  const rawFirst = (customerName || "")
    .split(/[\s(]/)[0]
    ?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const greetingPatterns: RegExp[] = [
    new RegExp(
      `^(?:\\*?_?)?(?:hi|hello|hey|dear|namaste|good\\s+(?:morning|afternoon|evening))(?:\\s+${rawFirst || "[a-z]+"})?(?:\\s+(?:ji|sir|ma'am|madam|there))?(?:\\*?_?)?[!,.\\s]*\\n*`,
      "i"
    ),
    /^(?:hi|hello|hey|namaste)\s+[a-z]+(?:\s+(?:ji|sir|ma'am|madam))?[!,.:\s]+\n*/i,
    /^(?:hi|hello|hey)[!,.:\s]+\n*/i,
  ];

  for (const rx of greetingPatterns) {
    if (rx.test(out)) {
      const stripped = out.replace(rx, "").trim();
      if (stripped.length >= 12) {
        out = stripped.charAt(0).toUpperCase() + stripped.slice(1);
      }
      break;
    }
  }
  return out;
}

// ============================================================================
// 1. META WHATSAPP CLOUD API CONNECTOR + TEMPLATE STUDIO + SANDBOX SIMULATOR
// ============================================================================
export type WhatsAppHeaderType =
  | "NONE"
  | "TEXT"
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT"
  | "LOCATION";

export type WhatsAppTemplateCategory =
  | "MARKETING"
  | "UTILITY"
  | "AUTHENTICATION";

export interface WhatsAppTemplateLocation {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

export type TemplateButtonFlowActionType =
  | "NONE"
  | "AUTO_REPLY"
  | "ASSIGN_TEAM"
  | "SEND_ORDER_TRACKING"
  | "SEND_APPROVED_TEMPLATE"
  | "OPT_OUT_DND"
  | "SMART_AI_WITH_GUARD";

export interface WhatsAppTemplateButtonFlowAction {
  actionType: TemplateButtonFlowActionType;
  replyText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  teamId?: string;
  templateName?: string;
  smartCategory?: string;
  priority?: "URGENT" | "HIGH" | "NORMAL";
  aiInstruction?: string;
}

export interface WhatsAppTemplateButton {
  id: string;
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "OTP";
  text: string;
  url?: string;
  urlType?: "STATIC" | "DYNAMIC";
  exampleSuffix?: string;
  phoneNumber?: string;
  exampleCode?: string;
  otpType?: "COPY_CODE" | "ONE_TAP";
  flowAction?: WhatsAppTemplateButtonFlowAction;
}

export interface WhatsAppTemplateVariableSpec {
  index: number;
  label: string;
  sourceField:
    | "customer.firstName"
    | "customer.fullName"
    | "customer.companyName"
    | "customer.city"
    | "order.latestNumber"
    | "custom";
  sampleValue: string;
}

export interface WhatsAppTemplateDefinition {
  id?: string;
  name: string;
  language: string;
  category: WhatsAppTemplateCategory;
  headerType: WhatsAppHeaderType;
  headerText?: string | null;
  headerMediaUrl?: string | null;
  headerLocation?: WhatsAppTemplateLocation | null;
  bodyText: string;
  footerText?: string | null;
  buttons: WhatsAppTemplateButton[];
  variablesSchema: WhatsAppTemplateVariableSpec[];
  allowCategoryChange?: boolean;
  codeExpirationMinutes?: number | null;
}

export interface OutboundWhatsAppSendResult {
  ok: boolean;
  waMessageId: string;
  mode: "LIVE_META_CLOUD" | "SANDBOX_SIMULATOR";
  deliveryStatus: "SENT" | "DELIVERED" | "FAILED";
  error?: string;
  metaErrorCode?: number;
  isRateOrSpamBlock?: boolean;
}

async function loadMetaWhatsAppSetupConfig(): Promise<Record<string, unknown>> {
  await ensureDatabasesBootstrapped();
  const envMeta = resolveEnvMetaWhatsAppConfig();
  const auth = getRawLibSqlClient("core_auth");
  const cfgRes = await auth.execute(
    `SELECT value_json FROM setup_state WHERE key = 'facebook_whatsapp_config' LIMIT 1`
  );
  let dbCfg: Record<string, unknown> = {};
  if (cfgRes.rows[0]?.value_json) {
    try {
      dbCfg = JSON.parse(String(cfgRes.rows[0].value_json));
    } catch {
      dbCfg = {};
    }
  }
  return {
    ...dbCfg,
    mode:
      envMeta.hasLiveCredentials && (!dbCfg.phoneNumberId || dbCfg.mode === "LIVE_META_CLOUD")
        ? "LIVE_META_CLOUD"
        : dbCfg.mode || envMeta.mode,
    businessPortfolioId: dbCfg.businessPortfolioId || envMeta.businessPortfolioId,
    verifiedName: dbCfg.verifiedName || envMeta.verifiedName,
    wabaId: dbCfg.wabaId || envMeta.wabaId,
    phoneNumberId: dbCfg.phoneNumberId || envMeta.phoneNumberId,
    businessDisplayPhone: dbCfg.businessDisplayPhone || envMeta.businessDisplayPhone,
    systemUserAccessToken:
      dbCfg.systemUserAccessToken || envMeta.systemUserAccessToken,
    webhookVerifyToken: dbCfg.webhookVerifyToken || envMeta.webhookVerifyToken,
    metaAppId: dbCfg.metaAppId || envMeta.metaAppId,
    metaAppSecret: dbCfg.metaAppSecret || envMeta.metaAppSecret,
  };
}

export async function sendWhatsAppCloudMessage(params: {
  toPhone: string;
  bodyText: string;
  templateName?: string;
  languageCode?: string;
  templateComponents?: Record<string, unknown>[];
  replyToWaMessageId?: string;
  ctaButton?: {
    label: string;
    url: string;
    footerText?: string;
  };
  simulateAsyncDelivery?: boolean;
  forceSandbox?: boolean;
}): Promise<OutboundWhatsAppSendResult> {
  const cfg = await loadMetaWhatsAppSetupConfig();

  const useSandbox =
    Boolean(params.forceSandbox) ||
    process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS === "1";
  const mode = useSandbox
    ? "SANDBOX_SIMULATOR"
    : String(cfg.mode || "SANDBOX_SIMULATOR");
  const phoneNumberId = String(cfg.phoneNumberId || "").trim();
  const accessToken = String(cfg.systemUserAccessToken || "").trim();
  const normalizedPhone = normalizeWhatsAppPhone(params.toPhone);
  const recipientDigits = (normalizedPhone || params.toPhone).replace(/\D/g, "");
  const formattedBody = params.templateName
    ? params.bodyText
    : formatWhatsAppOutboundText(params.bodyText);

  if (!recipientDigits || recipientDigits.length < 10) {
    return {
      ok: false,
      waMessageId: "",
      mode: mode === "LIVE_META_CLOUD" ? "LIVE_META_CLOUD" : "SANDBOX_SIMULATOR",
      deliveryStatus: "FAILED",
      error: "Invalid WhatsApp number.",
    };
  }

  if (mode === "LIVE_META_CLOUD" && phoneNumberId && accessToken) {
    try {
      const rawReplyWaId = String(params.replyToWaMessageId || "").trim();
      const validReplyWaId =
        rawReplyWaId &&
        !rawReplyWaId.startsWith("wamid.sandbox") &&
        !rawReplyWaId.startsWith("wamid.sim_") &&
        !rawReplyWaId.startsWith("sim_")
          ? rawReplyWaId
          : "";
      const contextField = validReplyWaId
        ? { context: { message_id: validReplyWaId } }
        : {};

      const ctaUrl = String(params.ctaButton?.url || "").trim();
      const ctaLabel = String(params.ctaButton?.label || "Track Order")
        .trim()
        .slice(0, 20);
      const hasInteractiveCta =
        !params.templateName && /^https?:\/\//i.test(ctaUrl) && Boolean(ctaLabel);

      const payload = params.templateName
        ? {
            messaging_product: "whatsapp",
            to: recipientDigits,
            ...contextField,
            type: "template",
            template: {
              name: params.templateName,
              language: { code: params.languageCode || "en" },
              ...(params.templateComponents && params.templateComponents.length > 0
                ? { components: params.templateComponents }
                : {}),
            },
          }
        : hasInteractiveCta
        ? {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientDigits,
            ...contextField,
            type: "interactive",
            interactive: {
              type: "cta_url",
              body: { text: formattedBody },
              ...(params.ctaButton?.footerText
                ? { footer: { text: params.ctaButton.footerText.slice(0, 60) } }
                : {}),
              action: {
                name: "cta_url",
                parameters: {
                  display_text: ctaLabel,
                  url: ctaUrl,
                },
              },
            },
          }
        : {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientDigits,
            ...contextField,
            type: "text",
            text: { preview_url: true, body: formattedBody },
          };

      let res = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        }
      );

      let data: any = await res.json().catch(() => ({}));
      if (!res.ok && hasInteractiveCta && res.status === 400) {
        const fallbackBody = formattedBody.includes(ctaUrl)
          ? formattedBody
          : `${formattedBody}\n\n*${ctaLabel}:* ${ctaUrl}`;
        res = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: recipientDigits,
              ...contextField,
              type: "text",
              text: { preview_url: true, body: fallbackBody },
            }),
            signal: AbortSignal.timeout(15000),
          }
        );
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok) {
        const metaCode = Number(data?.error?.code || 0) || undefined;
        const isSpamOrRate =
          res.status === 429 ||
          [4, 368, 80007, 130429, 131048, 131049, 131056, 131031].includes(
            metaCode || 0
          );
        return {
          ok: false,
          waMessageId: "",
          mode: "LIVE_META_CLOUD",
          deliveryStatus: "FAILED",
          error: data?.error?.message || `Meta HTTP ${res.status}`,
          metaErrorCode: metaCode,
          isRateOrSpamBlock: isSpamOrRate,
        };
      }

      const waId =
        String(data?.messages?.[0]?.id || "") ||
        `wamid.live_${crypto.randomUUID().slice(0, 12)}`;
      return {
        ok: true,
        waMessageId: waId,
        mode: "LIVE_META_CLOUD",
        deliveryStatus: "SENT",
      };
    } catch (err: any) {
      return {
        ok: false,
        waMessageId: "",
        mode: "LIVE_META_CLOUD",
        deliveryStatus: "FAILED",
        error: err?.message || "Meta Cloud network error",
      };
    }
  }

  // Sandbox Simulator Mode: generates authentic wamid; interactive chat replies start as SENT and transition to DELIVERED
  const simulatedId = `wamid.sim_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  return {
    ok: true,
    waMessageId: simulatedId,
    mode: "SANDBOX_SIMULATOR",
    deliveryStatus: params.simulateAsyncDelivery ? "SENT" : "DELIVERED",
  };
}

export function validateWhatsAppTemplateRules(
  tpl: WhatsAppTemplateDefinition
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const cleanName = tpl.name.trim();
  if (!cleanName || !/^[a-z0-9_]{3,512}$/.test(cleanName)) {
    errors.push(
      "Template name must be at least 3 characters and use only lowercase letters, numbers, and underscores (for example: podium_offer_2026)."
    );
  }

  const body = tpl.bodyText.trim();
  if (!body) {
    errors.push("Message body cannot be empty.");
  } else if (body.length > 1024) {
    errors.push("Message body must be 1,024 characters or shorter.");
  }

  // Extract variable indices from body
  const bodyVarNums = Array.from(body.matchAll(/\{\{(\d+)\}\}/g)).map((m) =>
    Number(m[1])
  );
  const uniqueBodyVars = Array.from(new Set(bodyVarNums)).sort((a, b) => a - b);
  for (let i = 0; i < uniqueBodyVars.length; i++) {
    if (uniqueBodyVars[i] !== i + 1) {
      errors.push(
        `Variables must be numbered in order starting from {{1}} with no skipped numbers (found {{${uniqueBodyVars.join(
          "}}, {{"
        )}}}).`
      );
      break;
    }
  }

  if (tpl.category !== "AUTHENTICATION" && body) {
    if (/^\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}$/.test(body)) {
      errors.push(
        "Meta rejects templates that start or end directly with a {{variable}}. Add a greeting word before {{1}} or punctuation/words at the end."
      );
    }
    if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)) {
      warnings.push(
        "Avoid placing two variables side by side ({{1}} {{2}}). Add a word between them so Meta approves the template smoothly."
      );
    }
  }

  for (const num of uniqueBodyVars) {
    const spec = tpl.variablesSchema.find((v) => v.index === num);
    if (!spec || !spec.sampleValue.trim()) {
      errors.push(
        `Please enter a sample value for {{${num}}} so Meta reviewers can see an example message.`
      );
    }
  }

  if (tpl.headerType === "TEXT") {
    const h = (tpl.headerText || "").trim();
    if (!h) {
      errors.push("Enter header text or switch Header to None.");
    } else if (h.length > 60) {
      errors.push("Header text must be 60 characters or shorter.");
    }
  } else if (
    tpl.headerType === "IMAGE" ||
    tpl.headerType === "VIDEO" ||
    tpl.headerType === "DOCUMENT"
  ) {
    if (!(tpl.headerMediaUrl || "").trim()) {
      errors.push(
        `Provide a sample ${tpl.headerType.toLowerCase()} link or pick an item from the catalog.`
      );
    }
  } else if (tpl.headerType === "LOCATION") {
    if (!tpl.headerLocation?.name || !tpl.headerLocation?.address) {
      errors.push("Enter location name and address for the map header.");
    }
  }

  if ((tpl.footerText || "").length > 60) {
    errors.push("Footer text must be 60 characters or shorter.");
  }

  if (tpl.buttons.length > 10) {
    errors.push("WhatsApp allows at most 10 buttons per template.");
  }
  const urlButtons = tpl.buttons.filter((b) => b.type === "URL");
  const phoneButtons = tpl.buttons.filter((b) => b.type === "PHONE_NUMBER");
  const copyButtons = tpl.buttons.filter((b) => b.type === "COPY_CODE");

  if (urlButtons.length > 2) {
    errors.push("WhatsApp allows at most 2 website link buttons per template.");
  }
  if (phoneButtons.length > 1) {
    errors.push("WhatsApp allows at most 1 phone call button per template.");
  }
  if (copyButtons.length > 1) {
    errors.push("WhatsApp allows at most 1 copy-code button per template.");
  }

  for (const btn of tpl.buttons) {
    if (!btn.text.trim() && btn.type !== "OTP") {
      errors.push("Every button must have a button label.");
    }
    if (btn.text.trim().length > 25) {
      errors.push(
        `Button label "${btn.text}" must be 25 characters or shorter.`
      );
    }
    if (btn.type === "URL") {
      if (!btn.url || !/^https?:\/\//i.test(btn.url.trim())) {
        errors.push(
          `Website button "${btn.text}" needs a full https:// link.`
        );
      }
      if (btn.url && /\b(bit\.ly|tinyurl\.com|t\.co)\b/i.test(btn.url)) {
        warnings.push(
          "Meta often rejects public URL shorteners like bit.ly. Use https://whatsapp.ccapl.cc/l/... short links instead."
        );
      }
    }
    if (btn.type === "PHONE_NUMBER" && !(btn.phoneNumber || "").trim()) {
      errors.push(`Phone button "${btn.text}" needs a phone number.`);
    }
    if (btn.type === "COPY_CODE" && !(btn.exampleCode || "").trim()) {
      errors.push(`Copy-code button "${btn.text}" needs a sample code.`);
    }
  }

  if (
    tpl.category === "MARKETING" &&
    !/stop|opt\s*out|unsubscribe/i.test(
      `${tpl.footerText || ""} ${tpl.bodyText} ${tpl.buttons
        .map((b) => b.text)
        .join(" ")}`
    )
  ) {
    warnings.push(
      "Tip: Adding 'Reply STOP to opt out' in the footer or a quick reply button lowers spam reports and keeps your WhatsApp quality rating green."
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function buildMetaGraphTemplatePayload(
  tpl: WhatsAppTemplateDefinition
): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];

  if (tpl.category === "AUTHENTICATION") {
    components.push({
      type: "BODY",
      add_security_recommendation: true,
    });
    if (tpl.codeExpirationMinutes && tpl.codeExpirationMinutes > 0) {
      components.push({
        type: "FOOTER",
        code_expiration_minutes: Math.min(90, Math.max(1, tpl.codeExpirationMinutes)),
      });
    }
    components.push({
      type: "BUTTONS",
      buttons: [
        {
          type: "OTP",
          otp_type: "COPY_CODE",
          text: tpl.buttons[0]?.text || "Copy Code",
        },
      ],
    });
    return {
      name: tpl.name,
      language: tpl.language || "en",
      category: "AUTHENTICATION",
      components,
    };
  }

  // Header component
  if (tpl.headerType === "TEXT" && tpl.headerText?.trim()) {
    const hText = tpl.headerText.trim();
    const hasVar = /\{\{1\}\}/.test(hText);
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: hText,
      ...(hasVar
        ? {
            example: {
              header_text: [
                tpl.variablesSchema.find((v) => v.index === 1)?.sampleValue ||
                  "Customer",
              ],
            },
          }
        : {}),
    });
  } else if (
    (tpl.headerType === "IMAGE" ||
      tpl.headerType === "VIDEO" ||
      tpl.headerType === "DOCUMENT") &&
    tpl.headerMediaUrl?.trim()
  ) {
    components.push({
      type: "HEADER",
      format: tpl.headerType,
      example: {
        header_handle: [tpl.headerMediaUrl.trim()],
      },
    });
  } else if (tpl.headerType === "LOCATION") {
    components.push({
      type: "HEADER",
      format: "LOCATION",
    });
  }

  // Body component with sample values
  const body = tpl.bodyText.trim();
  const varMatches = Array.from(
    new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1])))
  ).sort((a, b) => a - b);

  components.push({
    type: "BODY",
    text: body,
    ...(varMatches.length > 0
      ? {
          example: {
            body_text: [
              varMatches.map(
                (idx) =>
                  tpl.variablesSchema.find((v) => v.index === idx)
                    ?.sampleValue || `Sample${idx}`
              ),
            ],
          },
        }
      : {}),
  });

  // Footer component
  if (tpl.footerText?.trim()) {
    components.push({
      type: "FOOTER",
      text: tpl.footerText.trim(),
    });
  }

  // Interactive Buttons component
  if (tpl.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: tpl.buttons.map((b) => {
        if (b.type === "URL") {
          const isDynamic =
            b.urlType === "DYNAMIC" || /\{\{1\}\}/.test(b.url || "");
          const baseUrl = (b.url || "").trim();
          const finalUrl =
            isDynamic && !/\{\{1\}\}$/.test(baseUrl)
              ? `${baseUrl.replace(/\/?$/, "/")}{{1}}`
              : baseUrl;
          return {
            type: "URL",
            text: b.text.trim(),
            url: finalUrl,
            ...(isDynamic
              ? { example: [b.exampleSuffix || "CC-2026"] }
              : {}),
          };
        }
        if (b.type === "PHONE_NUMBER") {
          return {
            type: "PHONE_NUMBER",
            text: b.text.trim(),
            phone_number: (b.phoneNumber || "").trim(),
          };
        }
        if (b.type === "COPY_CODE") {
          return {
            type: "COPY_CODE",
            example: b.exampleCode || "CLASSIC10",
          };
        }
        return {
          type: "QUICK_REPLY",
          text: b.text.trim(),
        };
      }),
    });
  }

  return {
    name: tpl.name,
    language: tpl.language || "en",
    category: tpl.category,
    allow_category_change: tpl.allowCategoryChange ?? true,
    components,
  };
}

export async function submitTemplateToMetaCloud(
  tpl: WhatsAppTemplateDefinition
): Promise<{
  ok: boolean;
  mode: "LIVE_META_CLOUD" | "SANDBOX_SIMULATOR";
  metaTemplateId: string;
  approvalStatus: "APPROVED" | "PENDING_APPROVAL" | "REJECTED" | "DRAFT";
  message: string;
  error?: string;
}> {
  const validation = validateWhatsAppTemplateRules(tpl);
  if (!validation.valid) {
    return {
      ok: false,
      mode: "SANDBOX_SIMULATOR",
      metaTemplateId: "",
      approvalStatus: "REJECTED",
      message: validation.errors[0],
      error: validation.errors.join(" "),
    };
  }

  const cfg = await loadMetaWhatsAppSetupConfig();
  const mode = String(cfg.mode || "SANDBOX_SIMULATOR");
  const wabaId = String(cfg.wabaId || "").trim();
  const accessToken = String(cfg.systemUserAccessToken || "").trim();
  const metaPayload = buildMetaGraphTemplatePayload(tpl);

  if (mode === "LIVE_META_CLOUD" && wabaId && accessToken) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(
          wabaId
        )}/message_templates`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(metaPayload),
          signal: AbortSignal.timeout(20000),
        }
      );
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          mode: "LIVE_META_CLOUD",
          metaTemplateId: "",
          approvalStatus: "REJECTED",
          message:
            data?.error?.error_user_msg ||
            data?.error?.message ||
            `Meta Graph HTTP ${res.status}`,
          error:
            data?.error?.error_user_msg ||
            data?.error?.message ||
            `Meta Graph HTTP ${res.status}`,
        };
      }

      const rawStatus = String(data?.status || "PENDING").toUpperCase();
      const mappedStatus: "APPROVED" | "PENDING_APPROVAL" | "REJECTED" =
        rawStatus === "APPROVED"
          ? "APPROVED"
          : rawStatus === "REJECTED"
          ? "REJECTED"
          : "PENDING_APPROVAL";

      return {
        ok: true,
        mode: "LIVE_META_CLOUD",
        metaTemplateId: String(data?.id || `meta_${Date.now()}`),
        approvalStatus: mappedStatus,
        message:
          mappedStatus === "APPROVED"
            ? "Template approved immediately by Meta!"
            : "Submitted to Meta for review. Only Meta-approved templates can be sent.",
      };
    } catch (err: any) {
      return {
        ok: false,
        mode: "LIVE_META_CLOUD",
        metaTemplateId: "",
        approvalStatus: "REJECTED",
        message: err?.message || "Could not connect to Meta Graph API.",
        error: err?.message || "Could not connect to Meta Graph API.",
      };
    }
  }

  // Strict Meta-Approved Enforcement: never fake local "APPROVED" unless explicit test/demo flag is enabled
  const allowDemoApproval =
    process.env.SEED_DEMO_DATA === "1" ||
    process.env.WHATSAPP_ALLOW_SANDBOX_TEMPLATE_APPROVAL === "1";

  return {
    ok: true,
    mode: "SANDBOX_SIMULATOR",
    metaTemplateId: allowDemoApproval
      ? `sim_tpl_${crypto.randomBytes(5).toString("hex")}`
      : "",
    approvalStatus: allowDemoApproval ? "APPROVED" : "DRAFT",
    message: allowDemoApproval
      ? "Validated template rules in demo sandbox."
      : "Template saved as a verified Draft (with button flows). Connect your live Meta WABA ID & System Access Token in Facebook Setup to submit for official Meta approval before sending.",
  };
}

export async function syncTemplatesFromMetaCloud(): Promise<{
  ok: boolean;
  mode: "LIVE_META_CLOUD" | "SANDBOX_SIMULATOR";
  syncedCount: number;
  message: string;
}> {
  const cfg = await loadMetaWhatsAppSetupConfig();
  const mode = String(cfg.mode || "SANDBOX_SIMULATOR");
  const wabaId = String(cfg.wabaId || "").trim();
  const accessToken = String(cfg.systemUserAccessToken || "").trim();
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();

  if (mode === "LIVE_META_CLOUD" && wabaId && accessToken) {
    try {
      let nextUrl: string | null = `https://graph.facebook.com/v21.0/${encodeURIComponent(
        wabaId
      )}/message_templates?fields=id,name,language,category,status,quality_score,rejected_reason,components&limit=100`;
      const allItems: any[] = [];
      let pageCount = 0;
      const MAX_PAGES = 10;

      while (nextUrl && pageCount < MAX_PAGES) {
        pageCount++;
        const res = await fetch(nextUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(20000),
        });
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (pageCount === 1) {
            return {
              ok: false,
              mode: "LIVE_META_CLOUD",
              syncedCount: 0,
              message:
                json?.error?.message || `Meta template sync failed (HTTP ${res.status}).`,
            };
          }
          break;
        }
        const pageItems: any[] = Array.isArray(json?.data) ? json.data : [];
        allItems.push(...pageItems);
        if (json?.paging?.next && typeof json.paging.next === "string") {
          nextUrl = json.paging.next;
        } else if (json?.paging?.cursors?.after && pageItems.length >= 100) {
          nextUrl = `https://graph.facebook.com/v21.0/${encodeURIComponent(
            wabaId
          )}/message_templates?fields=id,name,language,category,status,quality_score,rejected_reason,components&limit=100&after=${encodeURIComponent(
            json.paging.cursors.after
          )}`;
        } else {
          nextUrl = null;
        }
      }

      const items: any[] = allItems;
      let synced = 0;

      for (const item of items) {
        const name = String(item.name || "").trim();
        if (!name) continue;
        const metaId = String(item.id || "");
        const rawStatus = String(item.status || "APPROVED").toUpperCase();
        const approvalStatus =
          rawStatus === "APPROVED"
            ? "APPROVED"
            : rawStatus === "REJECTED"
            ? "REJECTED"
            : rawStatus === "PAUSED"
            ? "PAUSED"
            : "PENDING_APPROVAL";
        const quality = String(
          item?.quality_score?.score || "GREEN"
        ).toUpperCase();
        const rejReason =
          item.rejected_reason && item.rejected_reason !== "NONE"
            ? String(item.rejected_reason)
            : null;

        const comps: any[] = Array.isArray(item.components)
          ? item.components
          : [];
        const headerComp = comps.find((c) => c.type === "HEADER");
        const bodyComp = comps.find((c) => c.type === "BODY");
        const footerComp = comps.find((c) => c.type === "FOOTER");
        const btnComp = comps.find((c) => c.type === "BUTTONS");

        const bodyText = String(bodyComp?.text || name);
        const bodyMatches = Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g)).map((m) =>
          Number(m[1])
        );
        const uniqueVarNums = Array.from(new Set(bodyMatches)).sort((a, b) => a - b);
        const varSpecs = uniqueVarNums.map((num) => {
          if (item.category === "AUTHENTICATION" && num === 1) {
            return {
              index: 1,
              label: "Verification Code",
              sourceField: "custom" as const,
              sampleValue: "482910",
            };
          }
          if (num === 1) {
            return {
              index: 1,
              label: "Customer First Name",
              sourceField: "customer.firstName" as const,
              sampleValue: "Rahul",
            };
          }
          if (num === 2) {
            return {
              index: 2,
              label: "Order Number",
              sourceField: "order.latestNumber" as const,
              sampleValue: "CC-2026-1089",
            };
          }
          return {
            index: num,
            label: `Detail ${num}`,
            sourceField: "custom" as const,
            sampleValue: "ready for dispatch",
          };
        });
        const variablesSchemaJson = JSON.stringify(varSpecs);

        const headerType = headerComp?.format ? String(headerComp.format).toUpperCase() : "NONE";
        const headerText = headerComp?.text ? String(headerComp.text) : null;
        const headerMediaUrl = headerComp?.example?.header_handle?.[0]
          ? String(headerComp.example.header_handle[0])
          : null;
        const footerText = footerComp?.text ? String(footerComp.text) : null;
        const category = String(item.category || "MARKETING").toUpperCase();
        const language = String(item.language || "en");

        const existing = await mkt.execute({
          sql: `SELECT id, buttons_json, variables_schema_json FROM templates WHERE name = ? LIMIT 1`,
          args: [name],
        });

        let prevButtons: WhatsAppTemplateButton[] = [];
        if (existing.rows[0]?.buttons_json) {
          try {
            const parsed = JSON.parse(String(existing.rows[0].buttons_json));
            if (Array.isArray(parsed)) prevButtons = parsed;
          } catch {
            prevButtons = [];
          }
        }

        const buttons: WhatsAppTemplateButton[] = Array.isArray(
          btnComp?.buttons
        )
          ? btnComp.buttons.map((b: any, idx: number) => {
              const btnText = String(b.text || "Open");
              const prevMatch = prevButtons.find(
                (pb) =>
                  pb.text.trim().toLowerCase() === btnText.trim().toLowerCase()
              );
              return {
                id: prevMatch?.id || `btn_meta_${idx}`,
                type:
                  b.type === "URL"
                    ? "URL"
                    : b.type === "PHONE_NUMBER"
                    ? "PHONE_NUMBER"
                    : b.type === "COPY_CODE"
                    ? "COPY_CODE"
                    : "QUICK_REPLY",
                text: btnText,
                url: b.url ? String(b.url) : prevMatch?.url,
                phoneNumber: b.phone_number
                  ? String(b.phone_number)
                  : prevMatch?.phoneNumber,
                flowAction: prevMatch?.flowAction,
              };
            })
          : prevButtons;

        const firstUrlBtn = buttons.find((b) => b.type === "URL");

        if (existing.rows[0]) {
          await mkt.execute({
            sql: `UPDATE templates
                  SET meta_template_id = ?,
                      language = ?,
                      category = ?,
                      approval_status = ?,
                      meta_quality_score = ?,
                      rejection_reason = ?,
                      header_type = ?,
                      header_text = COALESCE(?, header_text),
                      header_media_url = COALESCE(?, header_media_url),
                      body_text = COALESCE(?, body_text),
                      footer_text = COALESCE(?, footer_text),
                      cta_label = COALESCE(?, cta_label),
                      cta_url = COALESCE(?, cta_url),
                      buttons_json = ?,
                      variables_schema_json = ?,
                      updated_at = ?
                  WHERE id = ?`,
            args: [
              metaId,
              language,
              category,
              approvalStatus,
              quality,
              rejReason,
              headerType,
              headerText,
              headerMediaUrl,
              bodyComp?.text ? String(bodyComp.text) : null,
              footerText,
              firstUrlBtn?.text || null,
              firstUrlBtn?.url || null,
              JSON.stringify(buttons),
              variablesSchemaJson,
              nowIso,
              String(existing.rows[0].id),
            ],
          });
          synced++;
        } else {
          await mkt.execute({
            sql: `INSERT INTO templates (
              id, name, language, category, header_type, header_text, body_text,
              header_media_url, footer_text, cta_label, cta_url, buttons_json,
              variables_schema_json, meta_template_id,
              meta_quality_score, approval_status, rejection_reason, created_by_name,
              updated_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Meta Sync', ?, ?)`,
            args: [
              `tpl_${crypto.randomUUID().slice(0, 8)}`,
              name,
              language,
              category,
              headerType,
              headerText,
              bodyText,
              headerMediaUrl,
              footerText,
              firstUrlBtn?.text || null,
              firstUrlBtn?.url || null,
              JSON.stringify(buttons),
              variablesSchemaJson,
              metaId,
              quality,
              approvalStatus,
              rejReason,
              nowIso,
              nowIso,
            ],
          });
          synced++;
        }
      }

      return {
        ok: true,
        mode: "LIVE_META_CLOUD",
        syncedCount: synced,
        message: `Synced ${synced} official WhatsApp templates from Meta (preserving button flow mappings).`,
      };
    } catch (err: any) {
      return {
        ok: false,
        mode: "LIVE_META_CLOUD",
        syncedCount: 0,
        message: err?.message || "Network error while syncing from Meta.",
      };
    }
  }

  const countRes = await mkt.execute(`SELECT COUNT(*) as cnt FROM templates`);
  return {
    ok: true,
    mode: "SANDBOX_SIMULATOR",
    syncedCount: Number(countRes.rows[0]?.cnt ?? 0),
    message:
      "Checked local templates (Sandbox mode active. Connect live WABA ID in Facebook Setup to pull templates from Meta).",
  };
}

export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!appSecret) return true;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

// ============================================================================
// 2. ACRIO WHATSAPP AI CO-PILOT (Redis-Cached Classic Concepts + Classic Edge 53)
// ============================================================================
export interface AcrioRecommendedItem {
  name: string;
  slug: string;
  sku: string | null;
  priceInr: number | null;
  url: string;
  shortCode?: string | null;
  shortUrl?: string | null;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  brandLabel: string;
  itemType: "PRODUCT" | "MACHINE" | "CONSUMABLE";
  modelsSummary?: string | null;
}

export interface AcrioChatCopilotResult {
  engineLabel: string;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL" | "LOW";
  suggestedReplies: string[];
  recommendedProducts: AcrioRecommendedItem[];
  resolutionDraft: string;
}

export async function getCachedEcosystemCatalog(): Promise<{
  classicConceptsProducts: MainWebsiteProduct[];
  classicEdgeItems: MainWebsiteProduct[];
  allItems: MainWebsiteProduct[];
}> {
  const [classicConceptsProducts, classicEdgeItems] = await Promise.all([
    rememberWhatsAppCache(
      "ecosystem:cc-products:v3",
      ["cc-products"],
      3600,
      () => loadAllClassicConceptsProducts()
    ),
    rememberWhatsAppCache(
      "ecosystem:ce53-items:v3",
      ["ce53-machines"],
      3600,
      () => loadAllClassicEdgeItems()
    ),
  ]);

  return {
    classicConceptsProducts,
    classicEdgeItems,
    allItems: [...classicConceptsProducts, ...classicEdgeItems],
  };
}

/**
 * Formats matched products/machines into a clean, grouped, numbered list using ultra-short
 * `https://ccapl.cc/<6-char-id>` links - never stuffing raw SEO titles into sentences.
 */
export function buildGroupedProductShortLinksSection(params: {
  allItems: MainWebsiteProduct[];
  matchedItems: MainWebsiteProduct[];
  smartCategory: string;
}): string {
  const { allItems, matchedItems, smartCategory } = params;
  if (matchedItems.length === 0) return "";

  const usedKeys = new Set<string>();
  const keyOf = (it: MainWebsiteProduct) => `${it.brand}:${it.slug || it.id}`;

  const isCustomisableItem = (it: MainWebsiteProduct) =>
    /custom|sheet|box|cover|frame|stand|award|memento|plaque|logo|cut/i.test(
      `${it.name} ${it.categoryName} ${it.description || ""}`
    );

  const primaryLabel =
    smartCategory === "Podiums & Stage"
      ? "Premium Products (Podiums & Stage)"
      : smartCategory === "Awards & Trophies"
      ? "Ready Awards & Trophies"
      : smartCategory === "Hotel & Banquet"
      ? "Hotel & Display Stands"
      : smartCategory === "Acrylic Machines (CE53)"
      ? "Classic Edge 53 Machines"
      : smartCategory === "Custom Fabrication"
      ? "Matching Acrylic Options"
      : matchedItems[0]?.categoryName
      ? cleanDisplayProductName(matchedItems[0].categoryName)
      : "Matching Products";

  const primaryGroup: MainWebsiteProduct[] = [];
  for (const item of matchedItems) {
    if (primaryGroup.length >= 3) break;
    const k = keyOf(item);
    if (!usedKeys.has(k)) {
      usedKeys.add(k);
      primaryGroup.push(item);
    }
  }

  const secondaryLabel =
    smartCategory === "Acrylic Machines (CE53)"
      ? "Machine Tools & Consumables"
      : "Customisable Products";

  const secondaryCandidates = [
    ...matchedItems.slice(primaryGroup.length),
    ...allItems.filter((it) => {
      if (usedKeys.has(keyOf(it))) return false;
      if (smartCategory === "Acrylic Machines (CE53)") {
        return it.brand === "CLASSIC_EDGE_53";
      }
      return it.brand === "CLASSIC_CONCEPTS" && isCustomisableItem(it);
    }),
  ];

  const secondaryGroup: MainWebsiteProduct[] = [];
  for (const item of secondaryCandidates) {
    if (secondaryGroup.length >= 3) break;
    const k = keyOf(item);
    if (!usedKeys.has(k)) {
      usedKeys.add(k);
      secondaryGroup.push(item);
    }
  }

  const formatLine = (it: MainWebsiteProduct, idx: number) => {
    const cleanTitle = cleanDisplayProductName(it.name);
    const priceTag =
      typeof it.basePrice === "number" && it.basePrice > 0
        ? ` (Rs ${it.basePrice.toLocaleString("en-IN")})`
        : "";
    const link = it.shortUrl || it.url;
    return `${idx + 1}. ${cleanTitle}${priceTag} - ${link}`;
  };

  const blocks: string[] = [
    "I found a few products that match your description:",
    `*${primaryLabel}:*\n${primaryGroup.map(formatLine).join("\n")}`,
  ];

  if (secondaryGroup.length > 0) {
    blocks.push(
      `*${secondaryLabel}:*\n${secondaryGroup.map(formatLine).join("\n")}`
    );
  }

  return blocks.join("\n\n");
}

export async function syncEcosystemRedisCache(): Promise<{
  classicConceptsCount: number;
  classicEdgeMachinesCount: number;
  classicEdgeConsumablesCount: number;
  autoShortLinksCount: number;
  syncedAt: string;
}> {
  await invalidateWhatsAppCacheTags(["cc-products", "ce53-machines", "acrio-replies"]);
  const { classicConceptsProducts, classicEdgeItems, allItems } = await getCachedEcosystemCatalog();
  return {
    classicConceptsCount: classicConceptsProducts.length,
    classicEdgeMachinesCount: classicEdgeItems.filter((i) => i.itemType === "MACHINE").length,
    classicEdgeConsumablesCount: classicEdgeItems.filter((i) => i.itemType === "CONSUMABLE").length,
    autoShortLinksCount: allItems.filter((i) => Boolean(i.shortCode)).length,
    syncedAt: new Date().toISOString(),
  };
}

export async function runAcrioChatCopilot(params: {
  customerName: string;
  organizationType?: string;
  recentMessages: { direction: string; body: string }[];
  ordersSummary?: string[];
}): Promise<AcrioChatCopilotResult> {
  // Exclude internal team notes when suggesting customer replies
  const customerMessages = params.recentMessages.filter(
    (m) => m.direction === "INBOUND" || m.direction === "OUTBOUND"
  );
  const alreadyGreeted = customerMessages.some(
    (m) => m.direction === "OUTBOUND"
  );
  const lastInbound =
    [...customerMessages]
      .reverse()
      .find((m) => m.direction === "INBOUND")?.body ||
    customerMessages[customerMessages.length - 1]?.body ||
    "";

  const recentInboundContext = customerMessages
    .filter((m) => m.direction === "INBOUND")
    .slice(-3)
    .map((m) => m.body)
    .join(" ");

  const lower = `${recentInboundContext} ${lastInbound}`.toLowerCase();
  const { allItems } = await getCachedEcosystemCatalog();
  const primaryMatches = searchEcosystemItems(allItems, lastInbound, 4);
  const catalog =
    primaryMatches.length > 0
      ? primaryMatches
      : searchEcosystemItems(allItems, recentInboundContext, 4);

  // Smart intent & category classification across Classic Concepts + Classic Edge 53
  let smartCategory = "General Enquiry";
  let priority: AcrioChatCopilotResult["priority"] = "NORMAL";

  if (/machine|laser|router|polish|diamond|bending|bender|heater|yn-|ce53|classic edge|consumable|blade|cutter/i.test(lower)) {
    smartCategory = "Acrylic Machines (CE53)";
    priority = "HIGH";
  } else if (/podium|lectern|pulpit|stage|auditorium|conference/i.test(lower)) {
    smartCategory = "Podiums & Stage";
    priority = /friday|urgent|tomorrow|week/i.test(lower) ? "URGENT" : "HIGH";
  } else if (/trophy|trophies|memento|award|student|convocation|plaque/i.test(lower)) {
    smartCategory = "Awards & Trophies";
    priority = /\b\d{2,4}\b|bulk/i.test(lower) ? "HIGH" : "NORMAL";
  } else if (/hotel|banquet|menu|qr|resort|hospitality/i.test(lower)) {
    smartCategory = "Hotel & Banquet";
    priority = "HIGH";
  } else if (/cover|guard|enclosure|cnc|drawing|custom|mm|inch/i.test(lower)) {
    smartCategory = "Custom Fabrication";
    priority = "HIGH";
  } else if (/order|dispatch|delivery|invoice|advance|payment/i.test(lower)) {
    smartCategory = "Order & Delivery";
  }

  const firstName = params.customerName.split(/[\s(]/)[0] || "there";
  const greetPrefix = alreadyGreeted ? "" : `Hi ${firstName},\n\n`;
  const topProduct = catalog[0];

  const mappedRecommendations: AcrioRecommendedItem[] = catalog.map((c) => ({
    name: c.name,
    slug: c.slug,
    sku: c.sku,
    priceInr: c.basePrice,
    url: c.url,
    shortCode: c.shortCode || null,
    shortUrl: c.shortUrl || null,
    brand: c.brand,
    brandLabel: c.brandLabel,
    itemType: c.itemType,
    modelsSummary: c.modelsSummary || null,
  }));

  // Zero Anthropic AI calls here to save AI credits - AI is strictly reserved for
  // runAcrioAutonomousTurn when a chat is assigned to System (ACRIO)!
  const groupedPreview = buildGroupedProductShortLinksSection({
    allItems,
    matchedItems: catalog,
    smartCategory,
  });

  const localReplies: string[] = [];
  if (smartCategory === "Acrylic Machines (CE53)") {
    localReplies.push(
      groupedPreview
        ? `${greetPrefix}${groupedPreview}\n\nWhat *sheet thickness* and *working width* are you working with?`
        : `${greetPrefix}Please share the *sheet thickness* and *working width* you need, and I will suggest the right Classic Edge 53 machine models and brochure.`,
      `${greetPrefix}Would you like me to share the *spec sheet*, *demo video*, and *landed price* for your city?`,
      `${greetPrefix}We also keep genuine *diamond cutters*, *heaters*, and machine consumables ready in stock. Share your city and required size so we can check dispatch.`
    );
  } else if (smartCategory === "Podiums & Stage") {
    localReplies.push(
      groupedPreview
        ? `${greetPrefix}${groupedPreview}\n\nLet us know your *event date*, *preferred height*, or if you want your *front logo* added before dispatch.`
        : `${greetPrefix}Yes, we have wide-top clear *stage podiums* ready and can add your front logo before dispatch.\n\nShall I share our ready models and sizes?`,
      `${greetPrefix}Share your *event date* and *delivery city* so we can check ready stock and dispatch timing right away.`,
      topProduct
        ? `${greetPrefix}Our *${cleanDisplayProductName(topProduct.name)}* is ready for logo customization:\n${topProduct.shortUrl || topProduct.url}\n\nWould you like a layout preview with your logo?`
        : `${greetPrefix}Please share your logo file and delivery pincode so we can confirm total cost and timeline.`
    );
  } else if (smartCategory === "Awards & Trophies") {
    localReplies.push(
      groupedPreview
        ? `${greetPrefix}${groupedPreview}\n\nRoughly *how many pieces* do you need, and what is your *event date*?`
        : `${greetPrefix}For ceremonies and events, we make clear *acrylic awards and plaques* with custom logo and recipient name printing.`,
      `${greetPrefix}Please share:\n• *Quantity needed*\n• *Event date*\n• *Your logo file*\n\nWe will send matching trophy options with bulk pricing.`,
      topProduct
        ? `${greetPrefix}Our *${cleanDisplayProductName(topProduct.name)}*${topProduct.basePrice ? ` (*Rs ${topProduct.basePrice}*)` : ""} is a popular choice:\n${topProduct.shortUrl || topProduct.url}\n\nWould you like a sample layout with your logo?`
        : `${greetPrefix}We can print your logo and recipient names cleanly on clear acrylic awards. Roughly how many pieces do you need?`
    );
  } else if (smartCategory === "Custom Fabrication") {
    localReplies.push(
      groupedPreview
        ? `${greetPrefix}${groupedPreview}\n\nFor custom sizes, share your *length x width x height*, *thickness in mm*, and *quantity* so we can calculate the exact quote.`
        : `${greetPrefix}Please share the approximate *length x width x height*, *thickness in mm*, and *quantity* (or even a quick photo/sketch), and we will work out the exact quote.`,
      `${greetPrefix}Once confirmed, we share a clear size layout for your approval before cutting and bending begins.`,
      `${greetPrefix}We custom-make clear acrylic covers, boxes, stands, and displays to exact sizes. What will you be placing inside or displaying on it?`
    );
  } else {
    localReplies.push(
      groupedPreview
        ? `${greetPrefix}${groupedPreview}\n\nLet me know which option fits best, or share the size and quantity you have in mind.`
        : `${greetPrefix}Tell us a little about what you want to display, build, or solve, and I will suggest the best acrylic product or Classic Edge 53 machine options right away.`,
      `${greetPrefix}Do you need *ready acrylic products* (podiums, stands, awards, custom boxes) or *Classic Edge 53 machines & tools*? Share a few details and we will help you pick the right option.`,
      `${greetPrefix}I am checking this for you now and will share the exact details shortly.`
    );
  }

  return {
    engineLabel: "ACRIO",
    smartCategory,
    priority,
    suggestedReplies: localReplies.map((r) =>
      stripRepeatedGreeting(formatWhatsAppOutboundText(r), alreadyGreeted, params.customerName)
    ),
    recommendedProducts: mappedRecommendations,
    resolutionDraft: formatWhatsAppOutboundText(
      `Shared ${smartCategory.toLowerCase()} options and pricing details with ${params.customerName}, and updated customer follow-up notes.`
    ),
  };
}

export interface AcrioAutonomousTurnResult {
  needsHumanHandoff: boolean;
  handoffReason: string;
  customerReply: string;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL";
}

/**
 * Autonomous ACRIO Backend Handler:
 * Every new/reopened customer chat is initially assigned to ACRIO.
 * - Maintains natural multi-turn continuity across messages without repeating "Hi {Name}".
 * - Diagnoses vague customer problems, suggests practical acrylic or machine solutions,
 *   and asks natural clarifying questions instead of abruptly ending the chat.
 * - Formats replies cleanly for WhatsApp (*bold*, _italic_, bullet points, line breaks).
 * - Hands off to Sales Team ONLY when requested by customer, for complaints/order disputes/specific order checks,
 *   or when final custom specs/bulk quote approval is ready for a human salesperson.
 */
export async function runAcrioAutonomousTurn(params: {
  customerName: string;
  inboundText: string;
  recentMessages?: { direction: string; senderType?: string; body: string }[];
  hasAlreadyGreeted?: boolean;
}): Promise<AcrioAutonomousTurnResult> {
  const rawText = params.inboundText.trim();
  const lower = rawText.toLowerCase();
  const firstName = params.customerName.split(/[\s(]/)[0] || "there";

  const history = (params.recentMessages || []).filter(
    (m) =>
      (m.direction === "INBOUND" || m.direction === "OUTBOUND") &&
      Boolean(String(m.body || "").trim())
  );

  const alreadyGreeted =
    Boolean(params.hasAlreadyGreeted) ||
    history.some((m) => m.direction === "OUTBOUND");

  // Build rolling context from recent inbound messages so short follow-ups ("price?", "need 5", "what about thicker?") keep full context
  const recentInboundWindow = [
    ...history
      .filter((m) => m.direction === "INBOUND")
      .slice(-4)
      .map((m) => m.body),
    rawText,
  ].join(" ");
  const contextLower = recentInboundWindow.toLowerCase();

  // 1. Explicit request to talk to human support / sales staff
  const explicitSupportRequest =
    /\b(talk\s*to\s*(?:team|human|person|agent|staff|sales|someone)|speak\s*(?:to|with)\s*(?:team|human|person|agent|staff|sales|someone)|connect\s*me|human\s*agent|real\s*person|sales\s*executive|call\s*me|please\s*call|need\s*a\s*call|manager)\b/i.test(
      lower
    );

  // 2. Sensitive / complaint / CAD file / refund cases where immediate human help is genuinely best
  const unresolvableByBot =
    /\b(complaint|damaged|cracked\s*on\s*delivery|broken\s*item|wrong\s*item|refund|cancel\s*my\s*order|dispute|drawing\s*attached|cad\s*file|dxf\s*file|gst\s*mismatch|payment\s*stuck|payment\s*failed)\b/i.test(
      lower
    );

  // Specific existing order ID lookup (e.g. CC-1042, CE-209, #4512)
  const mentionsSpecificOrderNumber =
    /\b(?:order\s*(?:id|no|number|#)?\s*[:#-]?\s*[a-z0-9-]*\d{3,}|cc-\d+|ce-\d+|track\s+my\s+order)\b/i.test(
      lower
    );

  const { allItems } = await getCachedEcosystemCatalog();
  const directMatches = searchEcosystemItems(allItems, rawText, 8);
  const contextMatches =
    directMatches.length >= 6
      ? directMatches
      : [
          ...directMatches,
          ...searchEcosystemItems(allItems, recentInboundWindow, 8).filter(
            (item) => !directMatches.some((d) => d.slug === item.slug && d.brand === item.brand)
          ),
        ].slice(0, 8);
  const top = contextMatches[0];

  let smartCategory = "General Enquiry";
  let priority: "URGENT" | "HIGH" | "NORMAL" = "NORMAL";

  if (/machine|laser|router|polish|diamond|bending|bender|heater|yn-|ce53|classic edge|consumable|blade|cutter|flame|buffing|cloudy\s*edge|rough\s*edge/i.test(contextLower)) {
    smartCategory = "Acrylic Machines (CE53)";
    priority = "HIGH";
  } else if (/podium|lectern|pulpit|stage|auditorium|conference/i.test(contextLower)) {
    smartCategory = "Podiums & Stage";
    priority = /friday|urgent|tomorrow|today/i.test(lower) ? "URGENT" : "HIGH";
  } else if (/trophy|trophies|memento|award|student|convocation|plaque/i.test(contextLower)) {
    smartCategory = "Awards & Trophies";
  } else if (/hotel|banquet|menu|qr|resort|hospitality|tent\s*card|table\s*stand|sign\s*holder/i.test(contextLower)) {
    smartCategory = "Hotel & Banquet";
    priority = "HIGH";
  } else if (/cover|guard|enclosure|box|case|display\s*stand|riser|custom|mm|inch/i.test(contextLower)) {
    smartCategory = "Custom Fabrication";
    priority = "HIGH";
  } else if (/order|dispatch|delivery|tracking|courier|invoice|advance|payment/i.test(contextLower)) {
    smartCategory = "Order & Delivery";
  }

  if (explicitSupportRequest) {
    const reply = alreadyGreeted
      ? `Sure, I am connecting you to our *Sales Team* right away. A team member will pick up this chat from here and help you shortly.`
      : `Hi ${firstName}! Connecting you to our *Sales Team* right away. A team member will reply to you here shortly.`;
    return {
      needsHumanHandoff: true,
      handoffReason: `Customer asked to speak with our team ("${rawText.slice(0, 120)}").`,
      customerReply: formatWhatsAppOutboundText(reply),
      smartCategory,
      priority: "HIGH",
    };
  }

  if (unresolvableByBot) {
    const reply = alreadyGreeted
      ? `I have flagged this directly for our *Sales & Support Team* so a senior team member can check it personally and resolve it for you right away.`
      : `Hi ${firstName}, I am connecting your chat directly to our *Sales & Support Team* so they can check this personally and help you right away.`;
    return {
      needsHumanHandoff: true,
      handoffReason: `Query needs personal assistance from Sales Team ("${rawText.slice(0, 120)}").`,
      customerReply: formatWhatsAppOutboundText(reply),
      smartCategory,
      priority: "URGENT",
    };
  }

  if (mentionsSpecificOrderNumber) {
    const trackOrigin = resolvePublicTrackingOrigin();
    const reply = alreadyGreeted
      ? `You can check live courier status anytime on our tracking portal:\n${trackOrigin}\n\nI am also connecting our *Sales Team* here so they can verify your dispatch details personally.`
      : `Hi ${firstName}, you can check live courier status anytime here:\n${trackOrigin}\n\nI am also connecting our *Sales Team* so they can check your order status personally.`;
    return {
      needsHumanHandoff: true,
      handoffReason: `Customer asked about a specific order ("${rawText.slice(0, 120)}").`,
      customerReply: formatWhatsAppOutboundText(reply),
      smartCategory: "Order & Delivery",
      priority: "HIGH",
    };
  }

  const prebuiltGroupedBlock = buildGroupedProductShortLinksSection({
    allItems,
    matchedItems: contextMatches,
    smartCategory,
  });

  // 3. Multi-turn Claude Haiku 5.5 Diagnostic & Conversational Assistant
  const { apiKey } = await resolveSharedAnthropicApiKey("client");
  if (apiKey) {
    try {
      // Build true alternating user/assistant turns from history so Claude maintains real conversation memory
      const trimmedHistory = history.slice(-14);
      const lastInHistory = trimmedHistory[trimmedHistory.length - 1];
      const historyWithoutDuplicateCurrent =
        lastInHistory &&
        lastInHistory.direction === "INBOUND" &&
        lastInHistory.body.trim() === rawText
          ? trimmedHistory.slice(0, -1)
          : trimmedHistory;

      const claudeMessages: { role: "user" | "assistant"; content: string }[] = [];
      for (const msg of historyWithoutDuplicateCurrent) {
        const role: "user" | "assistant" =
          msg.direction === "INBOUND" ? "user" : "assistant";
        const body = String(msg.body || "").trim();
        if (!body) continue;
        const prev = claudeMessages[claudeMessages.length - 1];
        if (prev && prev.role === role) {
          prev.content = `${prev.content}\n${body}`;
        } else {
          claudeMessages.push({ role, content: body });
        }
      }

      // Anthropic requires the first message to be role === "user"
      while (claudeMessages.length > 0 && claudeMessages[0].role !== "user") {
        claudeMessages.shift();
      }

      const catalogContext = prebuiltGroupedBlock
        ? `Ready-Formatted Grouped Short-Link List (use these exact clean short titles & https://ccapl.cc/... shortlinks when sharing products!):\n${prebuiltGroupedBlock}`
        : "- Ready catalog covers: acrylic stage podiums, awards & trophies, hotel/restaurant QR & menu stands, retail display risers, custom clear acrylic boxes/covers (classicconcepts.in), plus acrylic bending heaters, diamond edge polishers, routers, laser machines & blades/consumables (classicedge53.com).";

      const latestPromptPayload = `[Context for ACRIO - do not repeat raw labels to customer]
Customer Name: ${params.customerName}
Already Greeted Earlier In This Chat: ${alreadyGreeted ? "YES (DO NOT say Hi/Hello or customer's name again! Continue naturally from the conversation above.)" : `NO (First reply: you may greet "${firstName}" warmly once, briefly.)`}
${catalogContext}

Customer's new message:
${rawText}`;

      const lastTurn = claudeMessages[claudeMessages.length - 1];
      if (lastTurn && lastTurn.role === "user") {
        lastTurn.content = `${lastTurn.content}\n\n${latestPromptPayload}`;
      } else {
        claudeMessages.push({ role: "user", content: latestPromptPayload });
      }

      const text = await callClaudeHaikuMessages({
        apiKey,
        maxTokens: 540,
        temperature: 0.3,
        timeoutMs: 11000,
        system: `You are ACRIO, the helpful WhatsApp product & fabrication specialist for Classic Concepts (acrylic products: classicconcepts.in) and Classic Edge 53 (acrylic fabrication machines & tools: classicedge53.com).

CORE CONVERSATION & PRODUCT SHARING RULES:
1. NEVER repeat "Hi ${firstName}", "Hello", or any greeting if Already Greeted Earlier is YES. Talk like a real, attentive human continuing the same WhatsApp chat naturally.
2. NEVER dump a long raw SEO product title mid-sentence, and NEVER share just 1 single lonely link!
   When recommending products or machines, ALWAYS present a clean, grouped, numbered short-link list using the exact https://ccapl.cc/<6-char-id> links provided in context, formatted like:

   I found a few products that match your description:

   *<Relevant Category Name>:*
   1. <Short Clean Product Name> - https://ccapl.cc/<id>
   2. <Short Clean Product Name> - https://ccapl.cc/<id>
   3. <Short Clean Product Name> - https://ccapl.cc/<id>

   *Customisable Products:*
   1. <Short Clean Product Name> - https://ccapl.cc/<id>
   2. <Short Clean Product Name> - https://ccapl.cc/<id>

   Then ask 1-2 short, natural follow-up questions (such as size, thickness, or quantity needed).
3. DO NOT end the chat or hand off to a human just because the customer's message is short, vague, or describes a problem!
   - If they describe a fabrication issue (cloudy/white cut edges -> diamond edge polishing; cracking/bubbles when bending -> controlled strip heaters; yellowing/scratches -> cast clear acrylic), explain the practical solution in plain everyday English and include the grouped matching options.
4. Set "needsHumanHandoff": true ONLY when:
   - The customer explicitly asks to speak to a person/team/call, OR
   - They have a damaged delivery, refund/payment issue, or specific existing order check, OR
   - They have ALREADY shared final custom dimensions + quantity (or confirmed a bulk order) and now need a formal Sales quotation/proforma invoice.
5. WHATSAPP FORMATTING & PLAIN LANGUAGE RULES:
   - Use single asterisks *like this* for bold category headers or key points (NEVER double **asterisks**, NEVER [markdown](links)).
   - Simple, warm, everyday layman English. Zero em-dashes ("—"), zero "--", zero robotic AI buzzwords (no bespoke, seamless, robust, utilize, leverage, meticulous, elevate).
   - NEVER add a robotic "or reply talk to team anytime" footer!

Return ONLY valid JSON:
{
  "needsHumanHandoff": false,
  "handoffReason": "",
  "smartCategory": "Podiums & Stage | Awards & Trophies | Hotel & Banquet | Acrylic Machines (CE53) | Custom Fabrication | Order & Delivery | General Enquiry",
  "priority": "URGENT | HIGH | NORMAL",
  "customerReply": "Your WhatsApp-formatted reply with \\n line breaks, grouped numbered shortlinks, and *bold* headers"
}`,
        messages: claudeMessages,
      });

      if (text) {
        const s = text.indexOf("{");
        const e = text.lastIndexOf("}");
        if (s !== -1 && e > s) {
          const parsed = JSON.parse(text.slice(s, e + 1));
          if (typeof parsed.customerReply === "string" && parsed.customerReply.trim()) {
            const handoff = Boolean(parsed.needsHumanHandoff);
            const cleanedReply = stripRepeatedGreeting(
              formatWhatsAppOutboundText(parsed.customerReply),
              alreadyGreeted,
              params.customerName
            );
            return {
              needsHumanHandoff: handoff,
              handoffReason:
                parsed.handoffReason ||
                (handoff
                  ? `Customer ready for Sales Team follow-up ("${rawText.slice(0, 100)}").`
                  : ""),
              customerReply: cleanedReply,
              smartCategory: parsed.smartCategory || smartCategory,
              priority: parsed.priority || priority,
            };
          }
        }
      }
    } catch {
      // Fall back to conversational diagnostic engine below
    }
  }

  // 4. Conversational & Diagnostic Fallback Engine (when offline or no API key)
  const greetOnce = alreadyGreeted ? "" : `Hi ${firstName}! `;

  if (/^(hi|hello|hey|good\s*morning|good\s*afternoon|good\s*evening|namaste)\W*$/i.test(rawText)) {
    const reply = alreadyGreeted
      ? `Tell me what you are looking to display, make, or solve today:\n• *Acrylic Podiums, Awards & Display Stands*\n• *Custom-Size Acrylic Boxes & Covers*\n• *Classic Edge 53 Acrylic Machines & Tools*\n\nShare a few details and I will suggest the best options!`
      : `Hello ${firstName}! Welcome to *Classic Concepts* & *Classic Edge 53*.\n\nHow can I help you today?\n• *Stage Podiums, Trophies & Display Stands*\n• *Custom-Size Acrylic Boxes & Machine Covers*\n• *Acrylic Bending, Polishing & Cutting Machines*\n\nTell me what you have in mind!`;
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      customerReply: formatWhatsAppOutboundText(reply),
      smartCategory,
      priority: "NORMAL",
    };
  }

  // Common acrylic / fabrication problem diagnosis (cloudy edges, bending cracks, glue marks, etc.)
  if (/\b(cloudy|white\s*edge|rough\s*edge|dull\s*edge|polish\s*problem|flame|burn|bubble|crack|bend\s*issue|warping|scratch|yellow)\b/i.test(lower)) {
    const issueSolutions: string[] = [];
    if (/cloudy|white|rough|dull|polish/i.test(lower)) {
      issueSolutions.push(
        `• *Cloudy or rough cut edges:* A *Diamond Edge Polishing Machine* gives a crystal-clear flat edge in one pass without flame stress marks (which often cause micro-cracks when solvent glue is applied later).`
      );
    }
    if (/crack|bubble|bend|warp/i.test(lower)) {
      issueSolutions.push(
        `• *Bubbles or cracking while bending:* Usually caused by heating too fast or too close. Using a temperature-controlled *Acrylic Bending Heater* with even top-and-bottom heating for sheets 5mm and thicker solves this cleanly.`
      );
    }
    if (issueSolutions.length === 0) {
      issueSolutions.push(
        `• Using *cast clear acrylic* instead of extruded sheet prevents yellowing, melting burrs, and hairline cracks during fabrication.`
      );
    }
    const machineBlock = prebuiltGroupedBlock
      ? `\n\n${prebuiltGroupedBlock}`
      : top
      ? `\n\nMatching option:\n1. ${cleanDisplayProductName(top.name)} - ${top.shortUrl || top.url}`
      : "";
    const reply = `${greetOnce}Here is what usually causes that and how to fix it:\n\n${issueSolutions.join("\n\n")}${machineBlock}\n\nWhat *sheet thickness* are you working with, and are you cutting by laser or router?`;
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      customerReply: stripRepeatedGreeting(
        formatWhatsAppOutboundText(reply),
        alreadyGreeted,
        params.customerName
      ),
      smartCategory: "Acrylic Machines (CE53)",
      priority: "HIGH",
    };
  }

  // Confirmed exact 3D measurements + quantity -> connect to Sales Team for exact custom fabrication quote
  if (
    /\b(\d+\s*(?:mm|cm|inch|in|ft)\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?\s*x\s*\d+)\b/i.test(lower) &&
    /\b(\d+\s*(?:pcs|pieces|nos|units|qty)|quote|price)\b/i.test(contextLower)
  ) {
    const reply = `${greetOnce}Got your custom size details! I am connecting our *Sales Team* right now so they can calculate sheet thickness, exact fabrication cost, and dispatch time for you.`;
    return {
      needsHumanHandoff: true,
      handoffReason: `Customer shared custom dimensions for Sales quotation ("${rawText.slice(0, 110)}").`,
      customerReply: stripRepeatedGreeting(
        formatWhatsAppOutboundText(reply),
        alreadyGreeted,
        params.customerName
      ),
      smartCategory: "Custom Fabrication",
      priority: "HIGH",
    };
  }

  if (smartCategory === "Acrylic Machines (CE53)" && top && prebuiltGroupedBlock) {
    const reply = `${greetOnce}${prebuiltGroupedBlock}\n\nWhat *maximum sheet thickness* and *working width* do you handle most often? I can help narrow down the right model.`;
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      customerReply: stripRepeatedGreeting(
        formatWhatsAppOutboundText(reply),
        alreadyGreeted,
        params.customerName
      ),
      smartCategory,
      priority,
    };
  }

  if (top && prebuiltGroupedBlock) {
    const words = contextLower.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const hasCatalogMatch = contextMatches.some((item) => {
      const hay = `${item.name} ${item.categoryName} ${item.sku || ""} ${item.description || ""}`.toLowerCase();
      return words.some((w) => hay.includes(w));
    });

    if (hasCatalogMatch) {
      const reply = `${greetOnce}${prebuiltGroupedBlock}\n\nRoughly *how many pieces* do you need, and do you want *custom logo printing* or a specific size?`;
      return {
        needsHumanHandoff: false,
        handoffReason: "",
        customerReply: stripRepeatedGreeting(
          formatWhatsAppOutboundText(reply),
          alreadyGreeted,
          params.customerName
        ),
        smartCategory,
        priority,
      };
    }
  }

  // Vague / open-ended message -> DO NOT end chat! Ask helpful clarifying questions to understand their problem or goal.
  const exploratoryReply = `${greetOnce}I would love to help figure out the best option for you.\n\nCould you share a little more about what you need?\n• *Display or Event Product:* podium, trophy/award, menu/QR stand, retail riser, or protective acrylic box\n• *Custom Size Job:* share what item goes inside and rough size\n• *Fabrication Machine / Issue:* cutting, bending, diamond polishing, or edge finishing\n\nEven a short description of your use case works!`;

  return {
    needsHumanHandoff: false,
    handoffReason: "",
    customerReply: stripRepeatedGreeting(
      formatWhatsAppOutboundText(exploratoryReply),
      alreadyGreeted,
      params.customerName
    ),
    smartCategory,
    priority: "NORMAL",
  };
}

export async function buildAcrioSmartMarketingSegment(prompt: string): Promise<{
  suggestedName: string;
  description: string;
  matchedCustomers: {
    id: string;
    name: string;
    phone: string;
    companyName: string | null;
    organizationType: string | null;
    acrioSegment: string;
    lifetimeValueInr: number;
  }[];
  filterExplanation: string;
}> {
  await ensureDatabasesBootstrapped();
  const crm = getRawLibSqlClient("crm_orders");
  const res = await crm.execute(
    `SELECT * FROM customers WHERE opt_in_marketing = 1 ORDER BY lifetime_value_inr DESC`
  );

  const p = prompt.trim().toLowerCase();
  const all = res.rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    phone: String(r.phone),
    companyName: r.company_name ? String(r.company_name) : null,
    organizationType: r.organization_type ? String(r.organization_type) : null,
    acrioSegment: String(r.acrio_segment || ""),
    tagsJson: String(r.tags_json || "[]"),
    notes: String(r.notes || ""),
    lifetimeValueInr: Number(r.lifetime_value_inr ?? 0),
  }));

  const minLtvMatch = p.match(/(?:over|above|more than)\s*(?:rs\.?|inr|₹)?\s*(\d{3,7})/i);
  const minLtv = minLtvMatch ? Number(minLtvMatch[1]) : 0;

  let filtered = all.filter((c) => {
    if (minLtv > 0 && c.lifetimeValueInr < minLtv) return false;
    const blob =
      `${c.name} ${c.companyName || ""} ${c.organizationType || ""} ${c.acrioSegment} ${c.tagsJson} ${c.notes}`.toLowerCase();

    if (/hotel|banquet|hospitality|resort|menu/.test(p)) {
      return /hotel|banquet|hospitality|resort|menu/.test(blob);
    }
    if (/school|college|student|education|award|trophy|memento|convocation/.test(p)) {
      return /school|college|student|education|award|trophy|convocation/.test(blob);
    }
    if (/engineer|industrial|machine|cnc|custom|enclosure|cover/.test(p)) {
      return /engineer|industrial|machine|cnc|custom|enclosure|guard/.test(blob);
    }
    if (/vip|repeat|high value/.test(p)) {
      return c.lifetimeValueInr >= 30000 || /vip|repeat/.test(blob);
    }
    return true;
  });

  if (filtered.length === 0) {
    filtered = all;
  }

  let suggestedName = "ACRIO Targeted Segment";
  if (/hotel|banquet/.test(p)) suggestedName = "ACRIO: Hotels & Banquet Buyers";
  else if (/school|college|student|award/.test(p))
    suggestedName = "ACRIO: Schools, Colleges & Award Leads";
  else if (/engineer|custom|cnc/.test(p))
    suggestedName = "ACRIO: Industrial & Custom Fabrication Clients";
  else if (/vip|repeat/.test(p)) suggestedName = "ACRIO: High-Value Repeat Clients";

  let filterExplanation = `Matched ${filtered.length} opted-in contacts based on organization category, past order history, and ACRIO conversation tags.`;

  // Optional Admin-key Claude Haiku 5.5 refinement for internal marketing segmentation
  const { apiKey: adminApiKey } = await resolveSharedAnthropicApiKey("admin");
  if (adminApiKey && prompt.trim().length > 6 && all.length > 0) {
    try {
      const text = await callClaudeHaikuMessages({
        apiKey: adminApiKey,
        maxTokens: 220,
        temperature: 0.1,
        timeoutMs: 6500,
        system: `You are ACRIO Admin Assistant for Classic Concepts. Write in plain everyday English (zero em-dashes, zero buzzwords). Given a marketing list prompt and CRM contacts, pick matching contact IDs and return ONLY valid JSON: {"suggestedName": "Short Clear List Name", "matchedIds": ["id1"], "explanation": "Short plain explanation"}`,
        messages: [
          {
            role: "user",
            content: `Prompt: ${prompt.trim()}\nOpted-in contacts:\n${all
              .slice(0, 40)
              .map(
                (c) =>
                  `${c.id} | ${c.name} | ${c.organizationType || ""} | ${c.acrioSegment} | Rs ${c.lifetimeValueInr}`
              )
              .join("\n")}`,
          },
        ],
      });
      if (text) {
        const s = text.indexOf("{");
        const e = text.lastIndexOf("}");
        if (s !== -1 && e > s) {
          const parsed = JSON.parse(text.slice(s, e + 1));
          if (Array.isArray(parsed.matchedIds) && parsed.matchedIds.length > 0) {
            const idSet = new Set(parsed.matchedIds.map(String));
            const aiMatched = all.filter((c) => idSet.has(c.id));
            if (aiMatched.length > 0) {
              filtered = aiMatched;
            }
          }
          if (typeof parsed.suggestedName === "string" && parsed.suggestedName.trim()) {
            suggestedName = sanitizePlainEnglish(parsed.suggestedName.trim());
          }
          if (typeof parsed.explanation === "string" && parsed.explanation.trim()) {
            filterExplanation = sanitizePlainEnglish(parsed.explanation.trim());
          }
        }
      }
    } catch {
      // Keep deterministic segment fallback
    }
  }

  return {
    suggestedName,
    description: sanitizePlainEnglish(
      `Built by ACRIO from prompt "${prompt.trim()}" (${filtered.length} opted-in WhatsApp contacts matched).`
    ),
    matchedCustomers: filtered.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      companyName: c.companyName,
      organizationType: c.organizationType,
      acrioSegment: c.acrioSegment,
      lifetimeValueInr: c.lifetimeValueInr,
    })),
    filterExplanation: sanitizePlainEnglish(filterExplanation),
  };
}

// ============================================================================
// 3. GOOGLE DRIVE MIDNIGHT MULTI-DB BACKUP CONNECTOR
// ============================================================================
async function getGoogleDriveAccessToken(cfg: {
  serviceAccountEmail: string;
  privateKey: string;
  oauthRefreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<string | null> {
  // Option A: OAuth2 Refresh Token
  if (cfg.oauthRefreshToken && cfg.clientId && cfg.clientSecret) {
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.oauthRefreshToken,
      grant_type: "refresh_token",
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (res.ok) {
      const json: any = await res.json();
      if (json.access_token) return String(json.access_token);
    }
  }

  // Option B: Google Service Account JWT (RS256)
  if (cfg.serviceAccountEmail && cfg.privateKey) {
    const nowSec = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT" })
    ).toString("base64url");
    const claim = Buffer.from(
      JSON.stringify({
        iss: cfg.serviceAccountEmail,
        scope: "https://www.googleapis.com/auth/drive.file",
        aud: "https://oauth2.googleapis.com/token",
        exp: nowSec + 3600,
        iat: nowSec,
      })
    ).toString("base64url");
    const normalizedKey = cfg.privateKey.replace(/\\n/g, "\n");
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(`${header}.${claim}`);
    const signature = signer.sign(normalizedKey, "base64url");
    const assertion = `${header}.${claim}.${signature}`;

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (res.ok) {
      const json: any = await res.json();
      if (json.access_token) return String(json.access_token);
    }
  }

  return null;
}

export async function executeMultiDatabaseBackup(
  triggerSource: "MIDNIGHT_CRON" | "MANUAL_DEV"
): Promise<{
  ok: boolean;
  status: "UPLOADED_TO_GDRIVE" | "SAVED_LOCAL_SNAPSHOT" | "FAILED";
  databasesCount: number;
  totalBytes: number;
  localFolderPath: string;
  googleDriveFileId?: string;
  googleDriveLink?: string;
  detailsMessage: string;
}> {
  await ensureDatabasesBootstrapped();
  const bill = getRawLibSqlClient("billing_ops");
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, "-");
  const backupRoot = resolveBackupDirectory();
  const runFolder = path.join(backupRoot, `snapshot_${stamp}`);

  try {
    const cfgRes = await bill.execute(
      `SELECT * FROM backup_settings WHERE id = 'default' LIMIT 1`
    );
    const cfg = (cfgRes.rows[0] || {}) as Record<string, unknown>;
    const includeMain = Number(cfg.include_main_website_db ?? 1) === 1;
    const retentionDays = Math.max(1, Number(cfg.retention_days ?? 30));

    const snap = await snapshotAllDatabasesToFolder(runFolder, includeMain);

    // Bundle all SQLite snapshots into a compressed .json.gz archive ready for Google Drive upload
    const bundlePayload = {
      createdAt: startedAt,
      triggerSource,
      databases: snap.files.map((f) => ({
        domain: f.domain,
        fileName: path.basename(f.filePath),
        sizeBytes: f.sizeBytes,
        base64: fs.readFileSync(f.filePath).toString("base64"),
      })),
    };
    const compressedArchive = zlib.gzipSync(
      Buffer.from(JSON.stringify(bundlePayload), "utf8")
    );
    const archiveName = `ccwhatsapp_libsql_backup_${stamp}.json.gz`;
    const archivePath = path.join(runFolder, archiveName);
    fs.writeFileSync(archivePath, compressedArchive);

    let status: "UPLOADED_TO_GDRIVE" | "SAVED_LOCAL_SNAPSHOT" =
      "SAVED_LOCAL_SNAPSHOT";
    let gdriveFileId: string | undefined;
    let gdriveLink: string | undefined;
    let detailsMessage = `Saved backup of ${snap.files.length} databases (${(
      snap.totalBytes / 1024
    ).toFixed(1)} KB) on server. Add Google Drive settings below to upload automatically every midnight.`;

    const token = await getGoogleDriveAccessToken({
      serviceAccountEmail: String(cfg.google_service_account_email || "").trim(),
      privateKey: String(cfg.google_private_key || "").trim(),
      oauthRefreshToken: String(cfg.google_oauth_refresh_token || "").trim(),
      clientId: String(cfg.google_client_id || "").trim(),
      clientSecret: String(cfg.google_client_secret || "").trim(),
    }).catch(() => null);

    if (token) {
      const folderId = String(cfg.google_drive_folder_id || "").trim();
      const metadata = {
        name: archiveName,
        mimeType: "application/gzip",
        ...(folderId ? { parents: [folderId] } : {}),
      };
      const boundary = `ccbackup_${crypto.randomBytes(8).toString("hex")}`;
      const multipartBody = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
            metadata
          )}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`,
          "utf8"
        ),
        compressedArchive,
        Buffer.from(`\r\n--${boundary}--`, "utf8"),
      ]);

      const upRes = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
          signal: AbortSignal.timeout(30000),
        }
      );

      if (upRes.ok) {
        const upJson: any = await upRes.json();
        gdriveFileId = String(upJson.id || "");
        gdriveLink = upJson.webViewLink ? String(upJson.webViewLink) : undefined;
        status = "UPLOADED_TO_GDRIVE";
        detailsMessage = `Uploaded ${snap.files.length} databases (${(
          compressedArchive.length / 1024
        ).toFixed(1)} KB) to Google Drive.`;
      } else {
        const errTxt = await upRes.text().catch(() => "");
        detailsMessage = `Saved local backup (${snap.files.length} databases), but Google Drive upload returned HTTP ${upRes.status}: ${errTxt.slice(0, 140)}`;
      }
    }

    // Prune local snapshots older than retentionDays
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("snapshot_")) {
        const full = path.join(backupRoot, entry.name);
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoffMs) {
          fs.rmSync(full, { recursive: true, force: true });
        }
      }
    }

    const completedAt = new Date().toISOString();
    await bill.batch(
      [
        {
          sql: `INSERT INTO backup_logs (
            id, started_at, completed_at, trigger_source, status, databases_count,
            total_bytes, local_folder_path, google_drive_file_id, google_drive_link, details_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            `bkp_${crypto.randomUUID().slice(0, 8)}`,
            startedAt,
            completedAt,
            triggerSource,
            status,
            snap.files.length,
            snap.totalBytes,
            runFolder,
            gdriveFileId || null,
            gdriveLink || null,
            detailsMessage,
          ],
        },
        {
          sql: `UPDATE backup_settings SET last_run_at = ?, last_run_status = ?, updated_at = ? WHERE id = 'default'`,
          args: [completedAt, status, completedAt],
        },
      ],
      "write"
    );

    socketHub.emit("backup:completed", {
      status,
      databasesCount: snap.files.length,
      totalBytes: snap.totalBytes,
      completedAt,
    });

    return {
      ok: true,
      status,
      databasesCount: snap.files.length,
      totalBytes: snap.totalBytes,
      localFolderPath: runFolder,
      googleDriveFileId: gdriveFileId,
      googleDriveLink: gdriveLink,
      detailsMessage,
    };
  } catch (err: any) {
    const completedAt = new Date().toISOString();
    const msg = err?.message || "Backup error";
    await bill.execute({
      sql: `INSERT INTO backup_logs (
        id, started_at, completed_at, trigger_source, status, databases_count,
        total_bytes, local_folder_path, details_message
      ) VALUES (?, ?, ?, ?, 'FAILED', 0, 0, ?, ?)`,
      args: [
        `bkp_${crypto.randomUUID().slice(0, 8)}`,
        startedAt,
        completedAt,
        triggerSource,
        runFolder,
        msg,
      ],
    });
    return {
      ok: false,
      status: "FAILED",
      databasesCount: 0,
      totalBytes: 0,
      localFolderPath: runFolder,
      detailsMessage: msg,
    };
  }
}

// ============================================================================
// 4. META-COMPLIANT AI TEMPLATE DRAFTER + GUARDED BUTTON AI + WEBSITE ENQUIRY AI
// ============================================================================
export async function draftMetaCompliantTemplateWithAi(params: {
  prompt: string;
  category?: WhatsAppTemplateCategory;
  brand?: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
}): Promise<{
  name: string;
  category: WhatsAppTemplateCategory;
  headerType: WhatsAppHeaderType;
  headerText: string;
  bodyText: string;
  footerText: string;
  variablesSchema: WhatsAppTemplateVariableSpec[];
  buttons: WhatsAppTemplateButton[];
  complianceNotes: string[];
}> {
  const category: WhatsAppTemplateCategory =
    params.category === "UTILITY" || params.category === "AUTHENTICATION"
      ? params.category
      : "MARKETING";
  const brand =
    params.brand === "CLASSIC_EDGE_53" ? "CLASSIC_EDGE_53" : "CLASSIC_CONCEPTS";
  const brandName =
    brand === "CLASSIC_EDGE_53" ? "Classic Edge 53" : "Classic Concepts";
  const shortOrigin = resolvePublicShortLinkOrigin();

  const { allItems } = await getCachedEcosystemCatalog();
  const matches = searchEcosystemItems(allItems, params.prompt || brandName, 3);
  const topLink =
    matches[0]?.shortUrl ||
    (brand === "CLASSIC_EDGE_53"
      ? `${shortOrigin}/ce53mc`
      : `${shortOrigin}/podium`);

  const adminKeyInfo = await resolveSharedAnthropicApiKey("admin");
  const clientKeyInfo = await resolveSharedAnthropicApiKey("client");
  const apiKey = adminKeyInfo.apiKey || clientKeyInfo.apiKey;

  if (apiKey) {
    try {
      const text = await callClaudeHaikuMessages({
        apiKey,
        maxTokens: 520,
        temperature: 0.2,
        timeoutMs: 9500,
        system: `You design Meta WhatsApp Cloud API compliant templates for ${brandName}.
STRICT META APPROVAL RULES:
1. Template name: lowercase letters, numbers, underscores only (e.g. podium_quote_followup_2026).
2. Body text MUST NOT start or end with a {{variable}} and MUST NOT place {{1}} {{2}} side by side.
3. Number variables sequentially starting at {{1}}. Keep body concise (under 420 chars), plain everyday English, zero em-dashes ("—"), zero "--", zero AI buzzwords.
4. For MARKETING: include polite opt-out footer ("Reply STOP to opt out"). For UTILITY: strictly transactional/service wording with zero promotional hype so Meta approves it as Utility.
5. Include 2 or 3 useful QUICK_REPLY buttons (<= 22 chars each) and map each button to a deterministic flowAction ("AUTO_REPLY", "ASSIGN_TEAM", "SEND_ORDER_TRACKING", or "OPT_OUT_DND") so AI never hijacks button clicks!

Return ONLY valid JSON:
{
  "name": "snake_case_template_name",
  "category": "${category}",
  "headerText": "Short Header <= 55 chars",
  "bodyText": "Hello {{1}}, ... thank you.",
  "footerText": "${category === "MARKETING" ? `${brandName} • Reply STOP to opt out` : brandName}",
  "variablesSchema": [
    { "index": 1, "label": "Customer First Name", "sourceField": "customer.firstName", "sampleValue": "Rahul" }
  ],
  "buttons": [
    {
      "type": "QUICK_REPLY",
      "text": "Get Price List",
      "flowAction": {
        "actionType": "AUTO_REPLY",
        "replyText": "Here is the catalog & price guide: ${topLink}\\n\\nShare your required quantity if you need bulk pricing!"
      }
    },
    {
      "type": "QUICK_REPLY",
      "text": "Talk to Sales",
      "flowAction": {
        "actionType": "ASSIGN_TEAM",
        "teamId": "team_sales",
        "replyText": "Connecting you with our *Sales Team* right away. A specialist will reply here shortly."
      }
    }
  ]
}`,
        messages: [
          {
            role: "user",
            content: `Goal: ${params.prompt.trim()}\nCategory: ${category}\nBrand: ${brandName}\nRelevant link if needed: ${topLink}`,
          },
        ],
      });

      if (text) {
        const s = text.indexOf("{");
        const e = text.lastIndexOf("}");
        if (s !== -1 && e > s) {
          const parsed = JSON.parse(text.slice(s, e + 1));
          const rawName = String(parsed.name || "cc_template_2026")
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 64);
          let cleanBody = formatWhatsAppOutboundText(
            String(parsed.bodyText || "")
          );
          if (/^\{\{\d+\}\}/.test(cleanBody)) cleanBody = `Hello ${cleanBody}`;
          if (/\{\{\d+\}\}$/.test(cleanBody)) cleanBody = `${cleanBody}.`;

          const varNums = Array.from(
            new Set(
              Array.from(cleanBody.matchAll(/\{\{(\d+)\}\}/g)).map((m) =>
                Number(m[1])
              )
            )
          ).sort((a, b) => a - b);

          const rawVars: any[] = Array.isArray(parsed.variablesSchema)
            ? parsed.variablesSchema
            : [];
          const variablesSchema: WhatsAppTemplateVariableSpec[] = varNums.map(
            (num) => {
              const found = rawVars.find((v) => Number(v.index) === num);
              return {
                index: num,
                label: String(found?.label || `Variable ${num}`),
                sourceField: (found?.sourceField || "customer.firstName") as any,
                sampleValue: String(
                  found?.sampleValue || (num === 1 ? "Rahul" : "CC-2026")
                ),
              };
            }
          );

          const rawBtns: any[] = Array.isArray(parsed.buttons)
            ? parsed.buttons
            : [];
          const buttons: WhatsAppTemplateButton[] = rawBtns
            .slice(0, 4)
            .map((b, i) => ({
              id: `btn_ai_${i}_${Date.now().toString(36)}`,
              type: b.type === "URL" ? "URL" : "QUICK_REPLY",
              text: sanitizePlainEnglish(String(b.text || "Learn More")).slice(
                0,
                24
              ),
              url: b.type === "URL" ? String(b.url || topLink) : undefined,
              flowAction:
                b.type !== "URL" && b.flowAction
                  ? {
                      actionType: b.flowAction.actionType || "AUTO_REPLY",
                      replyText: b.flowAction.replyText
                        ? formatWhatsAppOutboundText(
                            String(b.flowAction.replyText)
                          )
                        : undefined,
                      teamId: b.flowAction.teamId || "team_sales",
                      smartCategory: b.flowAction.smartCategory || undefined,
                      priority: b.flowAction.priority || "HIGH",
                    }
                  : undefined,
            }));

          return {
            name: rawName || `cc_${category.toLowerCase()}_draft`,
            category,
            headerType: parsed.headerText ? "TEXT" : "NONE",
            headerText: sanitizePlainEnglish(
              String(parsed.headerText || "")
            ).slice(0, 58),
            bodyText: cleanBody,
            footerText: sanitizePlainEnglish(
              String(
                parsed.footerText ||
                  (category === "MARKETING"
                    ? `${brandName} • Reply STOP to opt out`
                    : brandName)
              )
            ).slice(0, 58),
            variablesSchema,
            buttons,
            complianceNotes: [
              "Variables verified sequential with sample values for Meta review.",
              "Quick Reply buttons pre-mapped to deterministic Flow Actions so AI credits are protected.",
            ],
          };
        }
      }
    } catch {
      // Fall back to deterministic compliant draft below
    }
  }

  const slugBase =
    params.prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36) || "customer_update";

  const isUtility = category === "UTILITY";
  return {
    name: `${brand === "CLASSIC_EDGE_53" ? "ce53" : "cc"}_${slugBase}`,
    category,
    headerType: "TEXT",
    headerText: isUtility
      ? `${brandName} Enquiry Update`
      : `${brandName} Product Options`,
    bodyText: isUtility
      ? `Hello {{1}}, we have reviewed your request with ${brandName} (Ref {{2}}). Tap an option below to view details or connect directly with our team.`
      : `Hello {{1}}, thank you for checking ${brandName}. Explore our ready range here: ${topLink}\n\nTap a button below for pricing or to speak with our Sales Team.`,
    footerText: isUtility
      ? brandName
      : `${brandName} • Reply STOP to opt out`,
    variablesSchema: isUtility
      ? [
          {
            index: 1,
            label: "Customer First Name",
            sourceField: "customer.firstName",
            sampleValue: "Rahul",
          },
          {
            index: 2,
            label: "Order or Reference ID",
            sourceField: "order.latestNumber",
            sampleValue: "CC-2026",
          },
        ]
      : [
          {
            index: 1,
            label: "Customer First Name",
            sourceField: "customer.firstName",
            sampleValue: "Rahul",
          },
        ],
    buttons: [
      {
        id: "btn_qr_1",
        type: "QUICK_REPLY",
        text: isUtility ? "Track Order" : "Share Price List",
        flowAction: isUtility
          ? { actionType: "SEND_ORDER_TRACKING" }
          : {
              actionType: "AUTO_REPLY",
              replyText: `Here is the direct link to view models and specifications:\n${topLink}\n\nLet us know the quantity you need!`,
            },
      },
      {
        id: "btn_qr_2",
        type: "QUICK_REPLY",
        text: "Talk to Sales",
        flowAction: {
          actionType: "ASSIGN_TEAM",
          teamId: "team_sales",
          replyText:
            "Connecting you to our *Sales Team* right away. A specialist will reply here shortly.",
        },
      },
      ...(isUtility
        ? []
        : ([
            {
              id: "btn_qr_3",
              type: "QUICK_REPLY",
              text: "Stop Offers",
              flowAction: { actionType: "OPT_OUT_DND" },
            },
          ] as WhatsAppTemplateButton[])),
    ],
    complianceNotes: [
      "Follows strict Meta Utility/Marketing rules (no leading/trailing variables, sequential placeholders).",
      "Quick Reply buttons pre-mapped to Flow Manager actions.",
    ],
  };
}

export async function runGuardedButtonFlowAiReply(params: {
  customerName: string;
  buttonText: string;
  aiInstruction: string;
}): Promise<string> {
  const firstName = params.customerName.split(/[\s(]/)[0] || "there";
  const { allItems } = await getCachedEcosystemCatalog();
  const matches = searchEcosystemItems(
    allItems,
    `${params.buttonText} ${params.aiInstruction}`,
    3
  );
  const catalogLines = matches
    .map(
      (m) =>
        `- ${m.name}${m.basePrice ? ` (Rs ${m.basePrice})` : ""}: ${m.shortUrl || m.url}`
    )
    .join("\n");

  const { apiKey } = await resolveSharedAnthropicApiKey("client");
  if (apiKey) {
    const out = await callClaudeHaikuMessages({
      apiKey,
      maxTokens: 200,
      temperature: 0.2,
      timeoutMs: 7000,
      system: `You are ACRIO for Classic Concepts & Classic Edge 53. Reply strictly to the button action below in under 75 words using simple everyday English, WhatsApp *bold* formatting, and zero em-dashes or buzzwords.`,
      messages: [
        {
          role: "user",
          content: `Customer: ${firstName}\nClicked Template Button: "${params.buttonText}"\nButton Action Instruction: ${params.aiInstruction}\nCatalog links:\n${catalogLines}`,
        },
      ],
    });
    if (out) return formatWhatsAppOutboundText(out);
  }

  const top = matches[0];
  return formatWhatsAppOutboundText(
    `Thanks for selecting *${params.buttonText}*!${top ? `\n\nTake a look at *${top.name}*:\n${top.shortUrl || top.url}` : ""}\n\nShare your required quantity or size and we will help right away.`
  );
}

export interface EvaluatedWebsiteEnquiryResult {
  smartReplyText: string;
  whatsappSummaryText: string;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL";
  recommendedTeamId: string;
  matchedItems: {
    name: string;
    brandLabel: string;
    shortUrl: string;
    priceInr: number | null;
  }[];
}

export async function evaluateWebsiteEnquiryWithAi(params: {
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  message: string;
  productName?: string;
  sourcePage?: string;
}): Promise<EvaluatedWebsiteEnquiryResult> {
  const firstName = params.customerName.split(/[\s(]/)[0] || "there";
  const combinedQuery = `${params.productName || ""} ${params.message || ""}`.trim();
  const lower = combinedQuery.toLowerCase();

  const { allItems } = await getCachedEcosystemCatalog();
  const matches = searchEcosystemItems(allItems, combinedQuery, 3);

  let smartCategory =
    params.brand === "CLASSIC_EDGE_53"
      ? "Acrylic Machines (CE53)"
      : "General Enquiry";
  let priority: "URGENT" | "HIGH" | "NORMAL" = "HIGH";

  if (/machine|laser|router|polish|diamond|bending|bender|heater|yn-|ce53|blade|cutter/i.test(lower)) {
    smartCategory = "Acrylic Machines (CE53)";
    priority = "HIGH";
  } else if (/podium|lectern|pulpit|stage|auditorium/i.test(lower)) {
    smartCategory = "Podiums & Stage";
    priority = /urgent|tomorrow|friday|today|week/i.test(lower) ? "URGENT" : "HIGH";
  } else if (/trophy|trophies|memento|award|plaque/i.test(lower)) {
    smartCategory = "Awards & Trophies";
  } else if (/hotel|banquet|menu|qr|resort|table\s*stand/i.test(lower)) {
    smartCategory = "Hotel & Banquet";
  } else if (/cover|guard|enclosure|box|custom|mm|inch/i.test(lower)) {
    smartCategory = "Custom Fabrication";
  }

  const brandName =
    params.brand === "CLASSIC_EDGE_53" ? "Classic Edge 53" : "Classic Concepts";

  const matchedItems = matches.map((m) => ({
    name: cleanDisplayProductName(m.name),
    brandLabel: m.brandLabel,
    shortUrl: m.shortUrl || m.url,
    priceInr: m.basePrice,
  }));

  const groupedEnquiryBlock = buildGroupedProductShortLinksSection({
    allItems,
    matchedItems: matches,
    smartCategory,
  });

  const clientKey = await resolveSharedAnthropicApiKey("client");
  const adminKey = await resolveSharedAnthropicApiKey("admin");
  const apiKey = clientKey.apiKey || adminKey.apiKey;

  if (apiKey) {
    try {
      const text = await callClaudeHaikuMessages({
        apiKey,
        maxTokens: 480,
        temperature: 0.25,
        timeoutMs: 9000,
        system: `You handle new website form enquiries for ${brandName} (Classic Concepts acrylic products & Classic Edge 53 acrylic machines).
Your job is to give the customer a genuinely helpful, specific first answer right away before our Sales Team follows up!
RULES:
1. Address "${firstName}" warmly in simple, clear, everyday English.
2. Directly answer what they asked about, and when sharing matching products, format them cleanly as a grouped numbered list using the exact https://ccapl.cc/<id> shortlinks provided (never dump raw long titles mid-sentence).
3. Ask 1-2 practical details (like required quantity, delivery city, sheet thickness, or custom size) so our Sales Team can send the final quote immediately.
4. Zero em-dashes ("—"), zero "--", zero robotic AI buzzwords (no bespoke, seamless, robust, utilize, leverage, meticulous, elevate).
Return ONLY valid JSON:
{
  "smartCategory": "${smartCategory}",
  "priority": "${priority}",
  "smartReplyText": "Email-friendly plain text reply with clear paragraphs and numbered product links",
  "whatsappSummaryText": "Concise WhatsApp-formatted (*bold* + grouped numbered shortlinks) version of the same helpful reply"
}`,
        messages: [
          {
            role: "user",
            content: `Brand: ${brandName}\nCustomer: ${params.customerName}\nProduct Selected: ${params.productName ? cleanDisplayProductName(params.productName) : "General"}\nCustomer Enquiry: ${params.message}\n${groupedEnquiryBlock || "Standard custom fabrication & machine range"}`,
          },
        ],
      });

      if (text) {
        const s = text.indexOf("{");
        const e = text.lastIndexOf("}");
        if (s !== -1 && e > s) {
          const parsed = JSON.parse(text.slice(s, e + 1));
          if (parsed.smartReplyText) {
            const cleanEmailText = sanitizePlainEnglish(
              String(parsed.smartReplyText)
            ).replace(/\*/g, "");
            const cleanWaText = formatWhatsAppOutboundText(
              String(parsed.whatsappSummaryText || parsed.smartReplyText)
            );
            return {
              smartReplyText: cleanEmailText,
              whatsappSummaryText: cleanWaText,
              smartCategory: parsed.smartCategory || smartCategory,
              priority: parsed.priority || priority,
              recommendedTeamId: "team_sales",
              matchedItems,
            };
          }
        }
      }
    } catch {
      // Fallback below
    }
  }

  const cleanSelectedProd = params.productName
    ? cleanDisplayProductName(params.productName)
    : "";
  const fallbackWa = formatWhatsAppOutboundText(
    `Hi ${firstName}! Thank you for your enquiry on *${brandName}*${cleanSelectedProd ? ` regarding *${cleanSelectedProd}*` : ""}.\n\n${
      groupedEnquiryBlock ? `${groupedEnquiryBlock}\n\n` : ""
    }To prepare your exact quotation and dispatch timeline, please share:\n• *Quantity needed*\n• *Delivery city / pincode*${
      params.brand === "CLASSIC_EDGE_53"
        ? "\n• *Max acrylic sheet thickness you work with*"
        : "\n• *Any custom size or logo printing needed*"
    }\n\nOur *Sales Team* has also received your enquiry and is ready to assist you.`
  );

  return {
    smartReplyText: fallbackWa.replace(/\*/g, ""),
    whatsappSummaryText: fallbackWa,
    smartCategory,
    priority,
    recommendedTeamId: "team_sales",
    matchedItems,
  };
}

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
    if (mainDbPath && fs.existsSync(mainDbPath)) {
      const { createClient } = await import("@libsql/client");
      const normalized = mainDbPath.replace(/\\/g, "/");
      const url = normalized.startsWith("/")
        ? `file:${normalized}`
        : `file:///${normalized}`;
      const ccClient = createClient({ url });
      const sRes = await ccClient.execute(
        `SELECT smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom FROM SiteSetting LIMIT 1`
      );
      const r = sRes.rows[0];
      if (r?.smtpHost && r?.smtpUser && r?.smtpPass) {
        return {
          configured: true,
          source: "classicconcepts_db",
          host: String(r.smtpHost).trim(),
          port: Number(r.smtpPort || 587),
          user: String(r.smtpUser).trim(),
          pass: String(r.smtpPass).trim(),
          from:
            String(r.smtpFrom || "").trim() ||
            `"Classic Concepts WhatsApp Desk" <${String(r.smtpUser).trim()}>`,
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
  staffName: string;
  customerName: string;
  customerPhone: string;
  smartCategory?: string;
  priority?: string;
  escalationLevel?: string;
  teamName?: string;
  reason?: string;
  latestMessage?: string;
  conversationId: string;
  isEscalation?: boolean;
}): Promise<{ ok: boolean; via: string; error?: string }> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const conv = getRawLibSqlClient("conversations");

  let targetEmail = (params.staffEmail || "").trim();
  if (!targetEmail && params.staffId && params.staffId !== "ACRIO") {
    const uRes = await auth.execute({
      sql: `SELECT email, status FROM users WHERE id = ? LIMIT 1`,
      args: [params.staffId],
    });
    const uRow = uRes.rows[0];
    if (!uRow || String(uRow.status) !== "ACTIVE") {
      return { ok: false, via: "none", error: "Staff member is not active." };
    }
    targetEmail = String(uRow.email || "").trim();

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
      return { ok: false, via: "disabled_by_preference" };
    }
  }

  if (!targetEmail) {
    return { ok: false, via: "none", error: "No staff email found." };
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

  return dispatchSystemEmail({
    to: targetEmail,
    recipientName: params.staffName,
    subject,
    text,
    html,
    dispatchType: params.isEscalation ? "STAFF_ESCALATION" : "STAFF_ASSIGNMENT",
    conversationId: params.conversationId,
  });
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
