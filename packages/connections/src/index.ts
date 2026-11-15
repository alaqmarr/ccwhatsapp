import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import nodemailer from "nodemailer";
import {
  appendAiTraceLog,
  cleanDisplayProductName,
  ensureDatabasesBootstrapped,
  extractBudgetConstraintsFromQuery,
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
  searchEcosystemItems,
  snapshotAllDatabasesToFolder,
  type AiLogWebsite,
  type AiLookedUpProduct,
  type AiTokenUsage,
  type AiTraceLogEntry,
  type AiTraceStep,
  type MainWebsiteProduct,
} from "@cc/database";
import { socketHub } from "@cc/sockets";
import {
  invalidateWhatsAppCacheTags,
  rememberWhatsAppCache,
  rememberWhatsAppCacheWithMeta,
} from "@cc/storage";

const LOCKED_CLAUDE_MODEL = "claude-haiku-5-5" as const;

export interface DetailedClaudeCallResult {
  ok: boolean;
  text: string | null;
  statusCode: number;
  durationMs: number;
  effort: string;
  usage: AiTokenUsage | null;
  error: string | null;
}

export function parseClaudeJson<T = any>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const tryParse = (candidate: string): T | null => {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Repair literal unescaped newlines/tabs inside JSON string literals
      let repaired = "";
      let inStr = false;
      let escaped = false;
      for (let i = 0; i < candidate.length; i++) {
        const ch = candidate[i];
        if (escaped) {
          repaired += ch;
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          repaired += ch;
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inStr = !inStr;
          repaired += ch;
          continue;
        }
        if (inStr && ch === "\n") {
          repaired += "\\n";
          continue;
        }
        if (inStr && ch === "\r") {
          continue;
        }
        if (inStr && ch === "\t") {
          repaired += " ";
          continue;
        }
        repaired += ch;
      }
      try {
        return JSON.parse(repaired) as T;
      } catch {
        return null;
      }
    }
  };

  const direct = tryParse(unfenced);
  if (direct !== null) return direct;

  const s = unfenced.indexOf("{");
  const e = unfenced.lastIndexOf("}");
  if (s !== -1 && e > s) {
    return tryParse(unfenced.slice(s, e + 1));
  }
  return null;
}

export async function callClaudeHaikuMessagesDetailed(params: {
  apiKey: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  temperature?: number;
  effort?: "low" | "medium" | "high";
  timeoutMs?: number;
}): Promise<DetailedClaudeCallResult> {
  const started = Date.now();
  const effort = params.effort || "medium";
  if (!params.apiKey) {
    return {
      ok: false,
      text: null,
      statusCode: 0,
      durationMs: 0,
      effort,
      usage: null,
      error: "Anthropic API key is missing.",
    };
  }

  const sendPayload = async (includeLegacyTemp: boolean) => {
    const bodyObj: Record<string, unknown> = {
      model: LOCKED_CLAUDE_MODEL,
      max_tokens: params.maxTokens ?? 2048,
      system: params.system,
      messages: params.messages,
    };
    if (includeLegacyTemp && typeof params.temperature === "number") {
      bodyObj.temperature = params.temperature;
    } else {
      bodyObj.thinking = { type: "adaptive" };
      bodyObj.output_config = { effort };
    }
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(bodyObj),
      signal: AbortSignal.timeout(params.timeoutMs ?? 24000),
    });
  };

  try {
    const useTempFirst = typeof params.temperature === "number";
    let res = await sendPayload(useTempFirst);
    let json: any = await res.json().catch(() => null);

    // claude-haiku-5-5 deprecates `temperature` in favor of adaptive thinking + effort
    if (
      !res.ok &&
      useTempFirst &&
      res.status === 400 &&
      /temperature/i.test(String(json?.error?.message || ""))
    ) {
      res = await sendPayload(false);
      json = await res.json().catch(() => null);
    }

    const durationMs = Date.now() - started;
    if (!res.ok) {
      return {
        ok: false,
        text: null,
        statusCode: res.status,
        durationMs,
        effort,
        usage: null,
        error:
          String(json?.error?.message || `Anthropic HTTP ${res.status}`),
      };
    }

    const blocks: any[] = Array.isArray(json?.content) ? json.content : [];
    const textBlocks = blocks
      .filter((b) => b?.type === "text" && typeof b?.text === "string")
      .map((b) => String(b.text));
    const extracted =
      textBlocks.length > 0
        ? textBlocks.join("\n").trim()
        : typeof json?.content?.[0]?.text === "string"
        ? json.content[0].text.trim()
        : "";

    const thinkingChars = blocks
      .filter((b) => b?.type === "thinking" && typeof b?.thinking === "string")
      .reduce((acc, b) => acc + String(b.thinking).length, 0);

    const usage: AiTokenUsage = {
      inputTokens: Number(json?.usage?.input_tokens ?? 0),
      outputTokens: Number(json?.usage?.output_tokens ?? 0),
      thinkingTokens:
        Number(json?.usage?.thinking_tokens ?? 0) ||
        (thinkingChars > 0 ? Math.ceil(thinkingChars / 4) : 0),
      cacheReadInputTokens: Number(json?.usage?.cache_read_input_tokens ?? 0),
      cacheCreationInputTokens: Number(
        json?.usage?.cache_creation_input_tokens ?? 0
      ),
    };

    return {
      ok: Boolean(extracted),
      text: extracted || null,
      statusCode: res.status,
      durationMs,
      effort,
      usage,
      error: extracted ? null : "Anthropic response contained empty text block.",
    };
  } catch (err: any) {
    return {
      ok: false,
      text: null,
      statusCode: 0,
      durationMs: Date.now() - started,
      effort,
      usage: null,
      error: err?.message || "Network or timeout error calling Anthropic.",
    };
  }
}

export async function callClaudeHaikuMessages(params: {
  apiKey: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  temperature?: number;
  effort?: "low" | "medium" | "high";
  timeoutMs?: number;
}): Promise<string | null> {
  const res = await callClaudeHaikuMessagesDetailed(params);
  return res.text;
}

function recordAndBroadcastAiLog(
  input: Omit<AiTraceLogEntry, "id" | "timestampUtc" | "timestampIst"> & {
    id?: string;
    timestampUtc?: string;
  }
): AiTraceLogEntry {
  const entry = appendAiTraceLog(input);
  try {
    socketHub.emit("ai:log", entry);
  } catch {
    // Non-blocking
  }
  return entry;
}

function mapProductToLogItem(item: MainWebsiteProduct): AiLookedUpProduct {
  return {
    name: cleanDisplayProductName(item.name),
    slug: item.slug,
    sku: item.sku || null,
    brand: item.brandLabel || item.brand,
    itemType: item.itemType,
    priceInr: item.basePrice,
    url: item.shortUrl || item.url,
  };
}

export function formatWhatsAppOutboundText(text: string): string {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "*$1* - $2")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/^[ \t]*[-*][ \t]+(?![*])/gm, "• ")
    .replace(/\b(?:Rs\.?|INR)\s*(\d[\d,]*)/gi, "₹$1")
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

function isLikelyValidMetaNumericId(val: string): boolean {
  return /^\d{8,25}$/.test(val);
}

function isLikelyValidMetaToken(val: string): boolean {
  return val.length >= 40 && !/(stress|dummy|mock|_test|placeholder)/i.test(val);
}

function pickMetaConfigValue(
  dbVal: unknown,
  envVal: string,
  envHasLive: boolean,
  validator?: (v: string) => boolean
): string {
  const d = String(dbVal || "").trim();
  const e = String(envVal || "").trim();
  if (d && (!envHasLive || !validator || validator(d))) {
    return d;
  }
  return e || d;
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

  const resolvedWabaId = pickMetaConfigValue(
    dbCfg.wabaId,
    envMeta.wabaId,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaNumericId
  );
  const resolvedPhoneNumberId = pickMetaConfigValue(
    dbCfg.phoneNumberId,
    envMeta.phoneNumberId,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaNumericId
  );
  const resolvedToken = pickMetaConfigValue(
    dbCfg.systemUserAccessToken,
    envMeta.systemUserAccessToken,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaToken
  );
  const resolvedAppId = pickMetaConfigValue(
    dbCfg.metaAppId,
    envMeta.metaAppId,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaNumericId
  );
  const resolvedPortfolioId = pickMetaConfigValue(
    dbCfg.businessPortfolioId,
    envMeta.businessPortfolioId,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaNumericId
  );

  const dbHasValidLivePair =
    isLikelyValidMetaNumericId(String(dbCfg.phoneNumberId || "").trim()) &&
    isLikelyValidMetaToken(String(dbCfg.systemUserAccessToken || "").trim());

  return {
    ...dbCfg,
    mode:
      envMeta.hasLiveCredentials && (!dbHasValidLivePair || dbCfg.mode === "LIVE_META_CLOUD")
        ? "LIVE_META_CLOUD"
        : dbCfg.mode || envMeta.mode,
    businessPortfolioId: resolvedPortfolioId,
    verifiedName: dbCfg.verifiedName || envMeta.verifiedName,
    wabaId: resolvedWabaId,
    phoneNumberId: resolvedPhoneNumberId,
    businessDisplayPhone: dbCfg.businessDisplayPhone || envMeta.businessDisplayPhone,
    systemUserAccessToken: resolvedToken,
    webhookVerifyToken: dbCfg.webhookVerifyToken || envMeta.webhookVerifyToken,
    metaAppId: resolvedAppId,
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
    if (
      /^[*_~`]*\{\{\d+\}\}/.test(body) ||
      /\{\{\d+\}\}[*_~`]*$/.test(body)
    ) {
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
  if (tpl.category === "UTILITY" && copyButtons.length > 0) {
    errors.push(
      "WhatsApp does not allow Copy Code buttons on Utility templates. Switch Category to Marketing for offer codes, or Authentication for OTP codes."
    );
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
          "Meta often rejects public URL shorteners like bit.ly. Use https://ccapl.cc/... short links instead."
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

const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function buildMinimalPdfBuffer(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n168\n%%EOF\n",
    "utf8"
  );
}

function buildMinimalMp4Buffer(): Buffer {
  // Minimal valid ISO-BMFF ftyp + empty moov header accepted as MP4 sample
  return Buffer.from(
    "00000018667479706d703432000000006d70343269736f6d000000086d646174",
    "hex"
  );
}

async function resolveMetaAppIdForUpload(
  configuredAppId: string,
  accessToken: string
): Promise<string> {
  if (/^\d{8,25}$/.test(configuredAppId)) {
    return configuredAppId;
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(
        accessToken
      )}&access_token=${encodeURIComponent(accessToken)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return "";
    const json: any = await res.json().catch(() => null);
    const appId = String(json?.data?.app_id || "").trim();
    return /^\d{8,25}$/.test(appId) ? appId : "";
  } catch {
    return "";
  }
}

async function uploadSampleMediaForTemplateHeader(params: {
  mediaUrl: string;
  headerType: "IMAGE" | "VIDEO" | "DOCUMENT";
  accessToken: string;
  metaAppId?: string;
}): Promise<string> {
  const raw = params.mediaUrl.trim();
  if (!raw || raw.startsWith("4:")) {
    return raw;
  }

  const appId = await resolveMetaAppIdForUpload(
    String(params.metaAppId || "").trim(),
    params.accessToken
  );
  if (!appId) {
    return raw;
  }

  let fileBuf: Buffer | null = null;
  let fileType =
    params.headerType === "IMAGE"
      ? "image/png"
      : params.headerType === "DOCUMENT"
      ? "application/pdf"
      : "video/mp4";
  let fileName =
    params.headerType === "IMAGE"
      ? "sample.png"
      : params.headerType === "DOCUMENT"
      ? "sample.pdf"
      : "sample.mp4";

  if (/^https?:\/\//i.test(raw)) {
    try {
      const dl = await fetch(raw, { signal: AbortSignal.timeout(8000) });
      if (dl.ok) {
        const arr = await dl.arrayBuffer();
        if (arr.byteLength > 0 && arr.byteLength <= 15 * 1024 * 1024) {
          fileBuf = Buffer.from(arr);
          const ct = String(dl.headers.get("content-type") || "")
            .split(";")[0]
            .trim()
            .toLowerCase();
          if (params.headerType === "IMAGE") {
            if (ct === "image/jpeg" || ct === "image/jpg" || /\.jpe?g(\?|$)/i.test(raw)) {
              fileType = "image/jpeg";
              fileName = "sample.jpg";
            } else {
              fileType = "image/png";
              fileName = "sample.png";
            }
          } else if (params.headerType === "DOCUMENT") {
            fileType = "application/pdf";
            fileName = "sample.pdf";
          } else if (params.headerType === "VIDEO") {
            fileType = "video/mp4";
            fileName = "sample.mp4";
          }
        }
      }
    } catch {
      fileBuf = null;
    }
  }

  if (!fileBuf || fileBuf.length === 0) {
    if (params.headerType === "IMAGE") {
      fileBuf = Buffer.from(SAMPLE_PNG_BASE64, "base64");
      fileType = "image/png";
      fileName = "sample.png";
    } else if (params.headerType === "DOCUMENT") {
      fileBuf = buildMinimalPdfBuffer();
      fileType = "application/pdf";
      fileName = "sample.pdf";
    } else {
      fileBuf = buildMinimalMp4Buffer();
      fileType = "video/mp4";
      fileName = "sample.mp4";
    }
  }

  try {
    const sessionRes = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(
        appId
      )}/uploads?file_name=${encodeURIComponent(
        fileName
      )}&file_length=${fileBuf.length}&file_type=${encodeURIComponent(fileType)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
        },
        signal: AbortSignal.timeout(12000),
      }
    );
    const sessionJson: any = await sessionRes.json().catch(() => null);
    const sessionId = String(sessionJson?.id || "").trim();
    if (!sessionRes.ok || !sessionId) {
      return raw;
    }

    const uploadRes = await fetch(
      `https://graph.facebook.com/v21.0/${sessionId}`,
      {
        method: "POST",
        headers: {
          Authorization: `OAuth ${params.accessToken}`,
          file_offset: "0",
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(fileBuf),
        signal: AbortSignal.timeout(20000),
      }
    );
    const uploadJson: any = await uploadRes.json().catch(() => null);
    const handle = String(uploadJson?.h || "").trim();
    return uploadRes.ok && handle ? handle : raw;
  } catch {
    return raw;
  }
}

export function buildMetaGraphTemplatePayload(
  tpl: WhatsAppTemplateDefinition,
  resolvedHeaderHandle?: string
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
        header_handle: [resolvedHeaderHandle || tpl.headerMediaUrl.trim()],
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
  effectiveCategory?: WhatsAppTemplateCategory;
  effectiveBodyText?: string;
  effectiveFooterText?: string | null;
  effectiveButtons?: WhatsAppTemplateButton[];
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
  const metaAppId = String(cfg.metaAppId || "").trim();

  if (mode === "LIVE_META_CLOUD" && wabaId && accessToken) {
    try {
      let resolvedHeaderHandle: string | undefined;
      if (
        (tpl.headerType === "IMAGE" ||
          tpl.headerType === "VIDEO" ||
          tpl.headerType === "DOCUMENT") &&
        tpl.headerMediaUrl?.trim()
      ) {
        resolvedHeaderHandle = await uploadSampleMediaForTemplateHeader({
          mediaUrl: tpl.headerMediaUrl.trim(),
          headerType: tpl.headerType,
          accessToken,
          metaAppId,
        });
      }

      const metaPayload = buildMetaGraphTemplatePayload(
        tpl,
        resolvedHeaderHandle
      );

      const postToMeta = async (payload: Record<string, unknown>) => {
        const response = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(
            wabaId
          )}/message_templates`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(20000),
          }
        );
        const bodyJson: any = await response.json().catch(() => ({}));
        return { response, bodyJson };
      };

      const { response: res, bodyJson: data } = await postToMeta(metaPayload);

      if (!res.ok) {
        const subcode = Number(data?.error?.error_subcode || 0);
        const rawErrMsg = String(
          data?.error?.error_user_msg ||
            data?.error?.message ||
            `Meta Graph HTTP ${res.status}`
        );

        // Meta temporarily restricts AUTHENTICATION template creation via API on
        // Tier-250 WABAs until display-name review completes (subcode 2388185).
        // Do NOT disguise OTP wording as UTILITY (Meta auto-rejects OTP copy under
        // UTILITY and penalizes WABA quality); instead save cleanly as DRAFT so it
        // can be submitted as soon as Meta unlocks Authentication.
        if (
          tpl.category === "AUTHENTICATION" &&
          (subcode === 2388185 ||
            /permission to create message template/i.test(rawErrMsg))
        ) {
          return {
            ok: true,
            mode: "LIVE_META_CLOUD",
            metaTemplateId: "",
            approvalStatus: "DRAFT",
            message:
              "Saved as Draft: Meta has temporarily paused Authentication (OTP) template creation on this WhatsApp Business Account until display name approval completes. Marketing and Utility templates submit normally right now.",
          };
        }

        const friendlyError =
          subcode === 2388185
            ? `${rawErrMsg}. Check in Meta Business Settings that your System User token has Full Control on WhatsApp Business Account ${wabaId}.`
            : rawErrMsg;

        return {
          ok: false,
          mode: "LIVE_META_CLOUD",
          metaTemplateId: "",
          approvalStatus: "REJECTED",
          message: friendlyError,
          error: friendlyError,
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

export interface CatalogCacheMeta {
  ccCacheTier: string;
  ce53CacheTier: string;
  catalogCacheStatus: "HIT" | "MISS" | "BYPASS";
  cacheSummary: string;
}

export async function getCachedEcosystemCatalog(): Promise<{
  classicConceptsProducts: MainWebsiteProduct[];
  classicEdgeItems: MainWebsiteProduct[];
  allItems: MainWebsiteProduct[];
  cacheMeta: CatalogCacheMeta;
}> {
  const [ccRes, ceRes] = await Promise.all([
    rememberWhatsAppCacheWithMeta(
      "ecosystem:cc-products:v6",
      ["cc-products"],
      3600,
      () => loadAllClassicConceptsProducts()
    ),
    rememberWhatsAppCacheWithMeta(
      "ecosystem:ce53-items:v5",
      ["ce53-machines"],
      3600,
      () => loadAllClassicEdgeItems()
    ),
  ]);

  const classicConceptsProducts = ccRes.value;
  const classicEdgeItems = ceRes.value;
  const bothHit = ccRes.cacheStatus !== "MISS" && ceRes.cacheStatus !== "MISS";

  return {
    classicConceptsProducts,
    classicEdgeItems,
    allItems: [...classicConceptsProducts, ...classicEdgeItems],
    cacheMeta: {
      ccCacheTier: ccRes.cacheStatus,
      ce53CacheTier: ceRes.cacheStatus,
      catalogCacheStatus: bothHit ? "HIT" : "MISS",
      cacheSummary: `CC Catalog=${ccRes.cacheStatus} (${classicConceptsProducts.length} items) • CE53 Catalog=${ceRes.cacheStatus} (${classicEdgeItems.length} items)`,
    },
  };
}

/**
 * Formats ONLY genuinely matched products/machines into a clean, WhatsApp-ready grouped list
 * using ultra-short `https://ccapl.cc/<6-char-id>` links and `₹` Indian Rupee formatting.
 * Never pads with unrelated catalog items!
 */
export function buildGroupedProductShortLinksSection(params: {
  allItems: MainWebsiteProduct[];
  matchedItems: MainWebsiteProduct[];
  smartCategory: string;
}): string {
  const { matchedItems, smartCategory } = params;
  if (matchedItems.length === 0) return "";

  const usedKeys = new Set<string>();
  const keyOf = (it: MainWebsiteProduct) => `${it.brand}:${it.slug || it.id}`;

  const uniqueMatches: MainWebsiteProduct[] = [];
  for (const item of matchedItems) {
    const k = keyOf(item);
    if (!usedKeys.has(k)) {
      usedKeys.add(k);
      uniqueMatches.push(item);
    }
  }
  if (uniqueMatches.length === 0) return "";

  const primaryLabel =
    smartCategory === "Podiums & Stage"
      ? "Acrylic Podiums & Pulpits"
      : smartCategory === "Awards & Trophies"
      ? "Acrylic Awards & Trophies"
      : smartCategory === "Hotel & Banquet"
      ? "Hotel & Display Stands"
      : smartCategory === "Acrylic Machines (CE53)"
      ? "Classic Edge 53 Machines"
      : smartCategory === "Custom Fabrication"
      ? "Matching Acrylic Options"
      : uniqueMatches[0]?.categoryName
      ? cleanDisplayProductName(uniqueMatches[0].categoryName)
      : "Matching Products";

  let primaryGroup: MainWebsiteProduct[] = [];
  let secondaryGroup: MainWebsiteProduct[] = [];
  let secondaryLabel = "Customisable Options";

  if (smartCategory === "Acrylic Machines (CE53)") {
    secondaryLabel = "Tools & Consumables";
    primaryGroup = uniqueMatches
      .filter((it) => it.itemType !== "CONSUMABLE")
      .slice(0, 4);
    secondaryGroup = uniqueMatches
      .filter((it) => it.itemType === "CONSUMABLE")
      .slice(0, 3);
    if (primaryGroup.length === 0) {
      primaryGroup = uniqueMatches.slice(0, 4);
      secondaryGroup = [];
    }
  } else {
    const pricedReady = uniqueMatches.filter(
      (it) => typeof it.basePrice === "number" && it.basePrice > 0
    );
    const customQuoteOnly = uniqueMatches.filter(
      (it) => !(typeof it.basePrice === "number" && it.basePrice > 0)
    );

    if (pricedReady.length > 0) {
      primaryGroup = pricedReady.slice(0, 5);
      secondaryGroup = customQuoteOnly.slice(0, 3);
    } else {
      primaryGroup = uniqueMatches.slice(0, 5);
      secondaryGroup = [];
    }
  }

  const formatLine = (it: MainWebsiteProduct, idx: number) => {
    const cleanTitle = cleanDisplayProductName(it.name);
    const priceTag =
      typeof it.basePrice === "number" && it.basePrice > 0
        ? ` (₹${it.basePrice.toLocaleString("en-IN")})`
        : " (Custom Quote)";
    const link = it.shortUrl || it.url;
    return `${idx + 1}. *${cleanTitle}*${priceTag}\n   ${link}`;
  };

  const blocks: string[] = [
    "Here are the matching options from our range:",
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

export type AcrioTurnIntent =
  | "GREETING"
  | "IDENTITY_META"
  | "COMPANY_INFO"
  | "TOPIC_RESET"
  | "HUMAN_HANDOFF_INFO"
  | "HUMAN_HANDOFF_REQUEST"
  | "SUPPORT_ISSUE"
  | "ORDER_STATUS"
  | "OFF_TOPIC"
  | "PRODUCT_SEARCH"
  | "FOLLOW_UP_REFINEMENT"
  | "PRODUCT_COMPARISON"
  | "CUSTOM_QUOTE";

export interface AcrioIntentClassification {
  intent: AcrioTurnIntent;
  requiresProductLookup: boolean;
  allowRollingContextFallback: boolean;
  needsImmediateHandoff: boolean;
  reason: string;
}

const ACRIO_DOMAIN_PRODUCT_NOUN_RE =
  /\b(podium|podiums|pulpit|pulpits|lectern|lecterns|rostrum|rostrums|trophy|trophies|memento|mementos|award|awards|plaque|plaques|medal|medals|stand|stands|holder|holders|riser|risers|menu|qr|tent\s*card|brochure|leaflet|pamphlet|tray|trays|coaster|coasters|tissue|napkin|box|boxes|case|cases|cover|covers|enclosure|enclosures|guard|guards|display|displays|cabinet|cabinets|showcase|vitrine|frame|frames|easel|signage|sign|nameplate|board|sheet|sheets|rod|rods|tube|tubes|pipe|pipes|machine|machines|polisher|polishing|bender|bending|heater|laser|router|cnc|cutter|blade|consumable|solvent|chloroform|glue|adhesive|buffing|flame|oven|thermoforming|keychain|keyring|bookmark|globe|hanger|organizer|organiser|dispenser|glove|mask|shoe|table|stool|chair|furniture|donation|suggestion\s*box|ballot|cake\s*stand|cupcake|cosmetic|makeup|lipstick|jewelry|jewellery|watch\s*stand|eyewear|sunglass|mobile\s*stand|laptop\s*stand|book\s*stand|quran|rehal|bible|photo\s*frame|poster|wall\s*mount|keyway|lockable|custom\s*size|fabrication|acrylic|perspex|pmma|polycarbonate|lexan)\b/i;

const ACRIO_FOLLOW_UP_REFINEMENT_RE =
  /\b(under|below|above|over|between|within|around|budget|price|cost|rate|how\s*much|cheaper|lower\s*price|higher\s*budget|increase\s*(?:the\s*)?budget|extend\s*(?:the\s*)?budget|rs\.?|inr|₹|\d+\s*k\b|\d{4,6}\b|\d+\s*(?:pcs|pieces|nos|units|qty|quantity)|transparent|clear|frosted|black|white|gold|silver|colored|coloured|thick|thickness|\d+\s*(?:mm|cm|inch|in|ft)\b|bigger|smaller|wider|taller|compact|portable|foldable|wheeled|castor|led|light|backlit|logo|branding|print|engraving|uv\s*print|show\s*more|other\s*options|any\s*other|another\s*model|different\s*size|different\s*model|which\s*one)\b/i;

/**
 * Deterministic Turn-Level Intent Classifier (Phase A).
 * Runs BEFORE any catalog fetch or product lookup so non-product turns
 * (greetings, "Who are you?", "Where is your factory?", "I have a different query",
 * "Whom will you connect me to?", human handoffs, order lookups, and off-topic turns)
 * never trigger unnecessary product retrieval or leak prior-turn products.
 */
export function classifyAcrioInboundIntent(
  rawText: string,
  hasConversationHistory = false
): AcrioIntentClassification {
  const trimmed = String(rawText || "").trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed) {
    return {
      intent: "GREETING",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Empty or whitespace message",
    };
  }

  const hasDomainProductNoun = ACRIO_DOMAIN_PRODUCT_NOUN_RE.test(lower);

  // 1. Informational question about human handoff ("Whom will you connect me to?", "Who handles custom quotes?")
  // Must be checked BEFORE HUMAN_HANDOFF_REQUEST so it does NOT falsely trigger handoff.
  if (
    /\b(?:who|whom|which\s*(?:team|person|department|member|specialist))\s+(?:will|would|do|can|are)\s+you\s+(?:connect|transfer|assign|hand\s*over|forward)\b|\b(?:to\s+whom|with\s+whom)\s+(?:will|would|do|can)\s+you\s+connect\b|\b(?:who|whom)\s+(?:handles|takes\s*care\s*of|manages|looks\s*after)\s+(?:this|my\s*chat|custom|orders|sales|support|enquiries|inquiries)\b|\bhow\s+does\s+(?:the\s+)?(?:handoff|human\s*support|sales\s*team)\s+work\b/i.test(
      lower
    )
  ) {
    return {
      intent: "HUMAN_HANDOFF_INFO",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer asked an informational question about who handles handoffs",
    };
  }

  // 2. Explicit request to be connected to a human / sales person right now
  if (
    !/^(?:who|whom|what|which|how|why)\b/i.test(lower) &&
    /\b(talk\s*to\s*(?:a\s*|the\s*|your\s*)?(?:team|human|person|agent|staff|sales|someone|manager|executive)|speak\s*(?:to|with)\s*(?:a\s*|the\s*|your\s*)?(?:team|human|person|agent|staff|sales|someone|manager|executive)|connect\s*me(?:\s*(?:to|with)\s*(?:a\s*|the\s*|your\s*)?(?:team|human|person|agent|staff|sales|someone|manager|executive))?|human\s*agent|real\s*person|call\s*me|please\s*call|need\s*a\s*call|want\s*a\s*call|transfer\s*(?:me|chat)\s*to\s*(?:human|sales|team)|assign\s*(?:to\s*)?(?:human|sales|team))\b/i.test(
      lower
    )
  ) {
    return {
      intent: "HUMAN_HANDOFF_REQUEST",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: true,
      reason: "Customer explicitly requested to speak with human sales/support staff",
    };
  }

  // 3. Support / complaint / damaged delivery / refund / CAD file
  if (
    /\b(complaint|damaged|cracked\s*on\s*delivery|broken\s*item|wrong\s*item|refund|cancel\s*my\s*order|dispute|drawing\s*attached|cad\s*file|dxf\s*file|gst\s*mismatch|payment\s*stuck|payment\s*failed)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "SUPPORT_ISSUE",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: true,
      reason: "Customer reported a support, delivery, payment, or CAD file issue requiring human attention",
    };
  }

  // 4. Specific order status / tracking lookup
  if (
    /\b(?:order\s*(?:id|no|number|#)?\s*[:#-]?\s*[a-z0-9-]*\d{3,}|cc-\d+|ce-\d+|track\s+my\s+order|where\s+is\s+my\s+order|order\s+status|dispatch\s+status)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "ORDER_STATUS",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: true,
      reason: "Customer asked for order tracking or dispatch status",
    };
  }

  // 5. Topic reset / switching query ("I have a different query", "Forget that, let's start over")
  if (
    !hasDomainProductNoun &&
    /\b(different\s*(?:query|question|requirement|topic|thing|enquiry|inquiry)|another\s*(?:query|question|requirement|topic|enquiry|inquiry)|something\s*else|forget\s*(?:that|it|previous|the\s*last)|start\s*over|start\s*afresh|change\s*(?:of\s*)?(?:topic|subject)|leave\s*(?:that|it)|never\s*mind(?:\s*(?:that|it))?|new\s*(?:query|question|topic|requirement|enquiry|inquiry)|i\s+have\s+a\s+(?:query|question|doubt))\b/i.test(
      lower
    )
  ) {
    return {
      intent: "TOPIC_RESET",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer signalled a topic reset or new unspecified query",
    };
  }

  // 6. Identity / AI / Bot capability questions ("Who are you?", "What can you help me with?", "Are you a bot?")
  if (
    !hasDomainProductNoun &&
    /\b(who\s+are\s+you|what\s+are\s+you|what\s+is\s+your\s+name|your\s+name|are\s+you\s+(?:a\s+)?(?:bot|ai|human|real\s+person|robot|assistant|automated)|which\s+(?:ai|model|llm)|what\s+(?:ai|model|llm)|what\s+can\s+you\s+(?:do|help\s*(?:me\s*)?with)|how\s+can\s+you\s+help(?:\s+me)?|tell\s+me\s+about\s+yourself|what\s+is\s+acrio|who\s+is\s+acrio)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "IDENTITY_META",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer asked about ACRIO's identity, AI model, or capabilities",
    };
  }

  // 7. Company / Factory / Location / Brand info questions ("Where is your factory?", "What does Classic Concepts do?")
  if (
    /\b(where\s+(?:are\s+you|is\s+your)\s*(?:located|based|factory|office|workshop|shop|company|plant|unit|from)?|what\s+is\s+your\s+(?:location|address|factory\s+address|office\s+address|working\s+hours|timings)|your\s+(?:factory\s+location|office\s+location|company\s+address|working\s+hours|opening\s+hours)|what\s+(?:does|is)\s+classic\s+(?:concepts|edge(?:\s*53)?)(?:\s+do)?|difference\s+between\s+classic\s+concepts\s+and\s+classic\s+edge|tell\s+me\s+about\s+(?:your\s+company|classic\s+concepts|classic\s+edge(?:\s*53)?)|do\s+you\s+(?:ship|deliver)\s+(?:across|all\s+over|pan)\s+india|do\s+you\s+provide\s+gst(?:\s+invoice|\s+bill)?)\b/i.test(
      lower
    ) &&
    !/\b(under|below|above|price\s+of|cost\s+of|buy|order\s+a|looking\s+for\s+a)\b/i.test(lower)
  ) {
    return {
      intent: "COMPANY_INFO",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer asked about company, factory location, timings, shipping, or brand overview",
    };
  }

  // 8. Pure greeting / pleasantry / thanks
  if (
    /^[\s\W]*(hi+|hello+|hey+|hii+|heyy+|good\s*(?:morning|afternoon|evening|day)|namaste|greetings|hi\s+there|hello\s+there|hey\s+there|hi\s+acrio|hello\s+acrio|thanks|thank\s+you|thank\s+you\s+so\s+much|many\s+thanks|ok\s+thanks|okay\s+thanks|can\s+you\s+help(?:\s+me)?)[\s\W]*$/i.test(
      trimmed
    )
  ) {
    return {
      intent: "GREETING",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Greeting or conversational pleasantry",
    };
  }

  // 9. Obvious off-topic queries with zero domain nouns
  if (
    !hasDomainProductNoun &&
    /\b(weather|forecast|cricket|ipl|football|soccer|movie|film|song|lyrics|recipe|biryani|pizza|burger|bitcoin|crypto|stock\s*market|nifty|sensex|python\s*code|javascript|leetcode|math\s*homework|election|minister|politics|tell\s*me\s*a\s*joke|write\s*a\s*poem|horoscope|astrology)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "OFF_TOPIC",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Off-topic message outside acrylic products and fabrication machines",
    };
  }

  // 10. Custom fabrication quote with explicit 3D dimensions or custom fabrication phrasing
  if (
    /\b(\d+\s*(?:mm|cm|inch|in|ft)?\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?)\b/i.test(
      lower
    ) ||
    /\b(custom\s*(?:size|dimension|fabrication|box|cover|enclosure)|made\s*to\s*order|as\s*per\s*(?:my\s*)?(?:drawing|size|sketch))\b/i.test(
      lower
    )
  ) {
    return {
      intent: "CUSTOM_QUOTE",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer requested custom fabrication or shared specific dimensions",
    };
  }

  // 11. Product comparison
  if (
    /\b(compare|comparison|vs\.?|versus|difference\s+between|which\s+(?:one|model|podium|machine)\s+is\s+better)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "PRODUCT_COMPARISON",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer asked to compare products or models",
    };
  }

  // 12. Follow-up refinement (budget change, color/material/size filter, "show me more", "price?")
  if (!hasDomainProductNoun && ACRIO_FOLLOW_UP_REFINEMENT_RE.test(lower)) {
    return {
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer refined budget, size, finish, quantity, or pricing on prior product context",
    };
  }

  // 13. Direct product search or problem/use-case description (e.g. "pulpits under 25000", "cloudy edges", "for school event")
  if (
    hasDomainProductNoun ||
    /\b(stage|auditorium|church|school|college|university|conference|seminar|hotel|restaurant|cafe|banquet|hospital|clinic|retail|shop|showroom|exhibition|event|ceremony|convocation|wedding|office|reception|counter|cloudy|rough\s*edge|white\s*edge|bubble|crack|warping|scratch|yellow)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "PRODUCT_SEARCH",
      requiresProductLookup: true,
      allowRollingContextFallback: hasConversationHistory && !hasDomainProductNoun,
      needsImmediateHandoff: false,
      reason: "Customer searched for a product, fabrication machine, or venue/application use case",
    };
  }

  // 14. Short or ambiguous message without domain nouns or refinement tokens:
  // Do NOT blindly pull old products if it's a meta/conversational turn; only use rolling context if history exists and it looks like a short reply ("yes", "okay show me", "send links")
  if (
    hasConversationHistory &&
    /\b(yes|yeah|yep|sure|ok|okay|please\s*share|send\s*(?:links|details|options|photos|catalogue|catalog)|show\s*(?:me|them|options)|tell\s*me\s*more)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer confirmed or asked to see options from the active conversation",
    };
  }

  return {
    intent: "TOPIC_RESET",
    requiresProductLookup: false,
    allowRollingContextFallback: false,
    needsImmediateHandoff: false,
    reason: "General or ambiguous message with no product or refinement terms; clarifying without dumping unrelated products",
  };
}

export async function runAcrioChatCopilot(params: {
  customerName: string;
  organizationType?: string;
  recentMessages: { direction: string; body: string }[];
  ordersSummary?: string[];
}): Promise<AcrioChatCopilotResult> {
  const started = Date.now();
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

  const intentInfo = classifyAcrioInboundIntent(
    lastInbound,
    customerMessages.length > 1
  );
  const lower = intentInfo.allowRollingContextFallback
    ? `${recentInboundContext} ${lastInbound}`.toLowerCase()
    : lastInbound.toLowerCase();

  let allItems: MainWebsiteProduct[] = [];
  let cacheMeta: CatalogCacheMeta = {
    ccCacheTier: "BYPASS",
    ce53CacheTier: "BYPASS",
    catalogCacheStatus: "BYPASS",
    cacheSummary: `Skipped catalog fetch for intent=${intentInfo.intent}`,
  };
  let catalog: MainWebsiteProduct[] = [];
  let usedQuery = "";

  if (intentInfo.requiresProductLookup) {
    const fetched = await getCachedEcosystemCatalog();
    allItems = fetched.allItems;
    cacheMeta = fetched.cacheMeta;
    const primaryMatches = searchEcosystemItems(allItems, lastInbound, 4);
    usedQuery =
      primaryMatches.length > 0 || !intentInfo.allowRollingContextFallback
        ? lastInbound
        : recentInboundContext;
    catalog =
      primaryMatches.length > 0
        ? primaryMatches
        : intentInfo.allowRollingContextFallback
        ? searchEcosystemItems(allItems, recentInboundContext, 4)
        : [];
  }

  // Smart intent & category classification across Classic Concepts + Classic Edge 53
  let smartCategory = "General Enquiry";
  let priority: AcrioChatCopilotResult["priority"] = "NORMAL";

  if (intentInfo.requiresProductLookup) {
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
    }
  } else if (intentInfo.intent === "ORDER_STATUS") {
    smartCategory = "Order & Delivery";
  } else if (intentInfo.intent === "SUPPORT_ISSUE" || intentInfo.intent === "HUMAN_HANDOFF_REQUEST") {
    priority = "HIGH";
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
  const groupedPreview = intentInfo.requiresProductLookup
    ? buildGroupedProductShortLinksSection({
        allItems,
        matchedItems: catalog,
        smartCategory,
      })
    : "";

  const localReplies: string[] = [];
  if (intentInfo.intent === "IDENTITY_META") {
    localReplies.push(
      `${greetPrefix}I am *ACRIO*, the WhatsApp product & fabrication assistant for *Classic Concepts* (ready & custom acrylic products) and *Classic Edge 53* (acrylic fabrication machines & tools).\n\nTell me what you want to display, build, or fabricate and I will share matching options right away.`,
      `${greetPrefix}I help you compare ready *acrylic podiums, awards, stands, custom boxes*, and *Classic Edge 53 machines*, and I can connect you to our Sales Team anytime for formal quotes.`
    );
  } else if (intentInfo.intent === "COMPANY_INFO") {
    localReplies.push(
      `${greetPrefix}*Classic Concepts* manufactures clear acrylic podiums, awards, hotel/retail stands, and custom acrylic fabrication, while *Classic Edge 53* supplies industrial acrylic bending, diamond edge polishing, and cutting machines from our Mumbai facility with pan-India dispatch.`,
      `${greetPrefix}We dispatch pan-India with full GST billing. Let us know which product or machine you are looking for and your delivery city.`
    );
  } else if (intentInfo.intent === "TOPIC_RESET") {
    localReplies.push(
      `${greetPrefix}Sure, let's start fresh! Tell me what you need help with and I will guide you right away.`,
      `${greetPrefix}Of course! Share your new question or requirement whenever you are ready.`
    );
  } else if (intentInfo.intent === "HUMAN_HANDOFF_INFO") {
    localReplies.push(
      `${greetPrefix}When you ask for a team member, I connect your chat directly to our *Classic Concepts & Classic Edge 53 Sales & Fabrication Team* right here on WhatsApp so a specialist can help with custom quotes, bulk pricing, or order updates.`,
      `${greetPrefix}Would you like me to connect our *Sales Team* to this chat now, or would you like to check any product options first?`
    );
  } else if (smartCategory === "Acrylic Machines (CE53)") {
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
        ? `${greetPrefix}Our *${cleanDisplayProductName(topProduct.name)}*${topProduct.basePrice ? ` (*₹${topProduct.basePrice.toLocaleString("en-IN")}*)` : ""} is a popular choice:\n${topProduct.shortUrl || topProduct.url}\n\nWould you like a sample layout with your logo?`
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

  const formattedSuggestions = localReplies.map((r) =>
    stripRepeatedGreeting(formatWhatsAppOutboundText(r), alreadyGreeted, params.customerName)
  );

  if (lastInbound.trim()) {
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Staff Inbox Co-Pilot (0-Credit Local)",
      actor: params.customerName,
      question: lastInbound,
      model: "local-catalog",
      outcomeSource: "LOCAL_FALLBACK",
      responseCacheStatus: "LOCAL_ONLY",
      catalogCacheStatus: cacheMeta.catalogCacheStatus,
      cacheDetails: `${cacheMeta.cacheSummary} • intent=${intentInfo.intent} • Zero AI credits used for staff suggestions`,
      productLookupTriggered: intentInfo.requiresProductLookup,
      productLookupQuery: usedQuery,
      productLookupTotalScanned: intentInfo.requiresProductLookup ? allItems.length : 0,
      productsLookedUp: catalog.map(mapProductToLogItem),
      steps: [
        {
          stepNumber: 1,
          label: "Loaded customer chat context",
          detail: `${customerMessages.length} turns, alreadyGreeted=${alreadyGreeted}`,
        },
        {
          stepNumber: 2,
          label: "Classified inbound turn intent",
          detail: `intent=${intentInfo.intent}, requiresProductLookup=${intentInfo.requiresProductLookup} (${intentInfo.reason})`,
        },
        ...(intentInfo.requiresProductLookup
          ? [
              {
                stepNumber: 3,
                label: "Fetched ecosystem catalog & matched products",
                detail: `${cacheMeta.cacheSummary}, matched=${catalog.length} products`,
              },
            ]
          : []),
      ],
      response: formattedSuggestions[0] || "",
      durationMs: Date.now() - started,
    });
  }

  return {
    engineLabel: "ACRIO",
    smartCategory,
    priority,
    suggestedReplies: formattedSuggestions,
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
 * - Powered by Claude Haiku 5.5 with Medium adaptive effort (`claude-haiku-5-5`).
 * - Maintains natural multi-turn continuity across messages without repeating "Hi {Name}".
 * - Understands synonyms (`pulpits` -> `podiums`, etc.) and strict budget constraints (`under ₹25,000`).
 * - Formats replies cleanly for WhatsApp (*bold* headers, ₹ prices, numbered shortlinks, bullet points).
 * - Logs every step, cache check, product lookup, and response to `ai.logs`.
 */
export async function runAcrioAutonomousTurn(params: {
  customerName: string;
  inboundText: string;
  recentMessages?: { direction: string; senderType?: string; body: string }[];
  hasAlreadyGreeted?: boolean;
}): Promise<AcrioAutonomousTurnResult> {
  const started = Date.now();
  const steps: AiTraceStep[] = [];
  const addStep = (
    label: string,
    detail?: string,
    status: AiTraceStep["status"] = "OK"
  ) => {
    steps.push({
      stepNumber: steps.length + 1,
      label,
      detail,
      durationMs: Date.now() - started,
      status,
    });
  };

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

  // Build rolling context from recent inbound messages so short follow-ups ("price?", "need 5", "under 20k?") keep full context
  const recentInboundWindow = [
    ...history
      .filter((m) => m.direction === "INBOUND")
      .slice(-4)
      .map((m) => m.body),
    rawText,
  ].join(" ");
  const contextLower = recentInboundWindow.toLowerCase();

  addStep(
    "Loaded conversation context",
    `historyTurns=${history.length}, alreadyGreeted=${alreadyGreeted}`
  );

  // 1. Classify turn intent BEFORE any catalog fetch or product lookup (Phase A)
  const intentInfo = classifyAcrioInboundIntent(rawText, history.length > 0);
  addStep(
    "Classified inbound turn intent",
    `intent=${intentInfo.intent}, requiresProductLookup=${intentInfo.requiresProductLookup}, allowRollingFallback=${intentInfo.allowRollingContextFallback} (${intentInfo.reason})`
  );

  // 2. Immediate deterministic handoff for explicit human requests, support issues, or order tracking
  if (intentInfo.needsImmediateHandoff) {
    let reply = "";
    let reason = "";
    let outPri: "URGENT" | "HIGH" | "NORMAL" = "HIGH";
    let outCat = "General Enquiry";

    if (intentInfo.intent === "HUMAN_HANDOFF_REQUEST") {
      reply = alreadyGreeted
        ? `Sure, I am connecting you to our *Sales Team* right away.\n\nA team member will pick up this chat from here and help you shortly.`
        : `Hi ${firstName}! Connecting you to our *Sales Team* right away.\n\nA team member will reply to you here shortly.`;
      reason = `Customer asked to speak with our team ("${rawText.slice(0, 120)}").`;
    } else if (intentInfo.intent === "SUPPORT_ISSUE") {
      reply = alreadyGreeted
        ? `I have flagged this directly for our *Sales & Support Team* so a senior team member can check it personally and resolve it for you right away.`
        : `Hi ${firstName}, I am connecting your chat directly to our *Sales & Support Team* so they can check this personally and help you right away.`;
      reason = `Query needs personal assistance from Sales Team ("${rawText.slice(0, 120)}").`;
      outPri = "URGENT";
    } else {
      const trackOrigin = resolvePublicTrackingOrigin();
      reply = alreadyGreeted
        ? `You can check live courier status anytime on our tracking portal:\n${trackOrigin}\n\nI am also connecting our *Sales Team* here so they can verify your dispatch details personally.`
        : `Hi ${firstName}, you can check live courier status anytime here:\n${trackOrigin}\n\nI am also connecting our *Sales Team* so they can check your order status personally.`;
      reason = `Customer asked about a specific order ("${rawText.slice(0, 120)}").`;
      outCat = "Order & Delivery";
    }

    const formatted = formatWhatsAppOutboundText(reply);
    addStep("Triggered immediate human handoff", reason);
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: rawText,
      model: "rule-handoff-guard",
      outcomeSource: "HUMAN_HANDOFF",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: "BYPASS",
      cacheDetails: `Intent=${intentInfo.intent} • Direct human handoff rule matched (skipped catalog lookup)`,
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupBudget: null,
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: formatted,
      durationMs: Date.now() - started,
    });

    return {
      needsHumanHandoff: true,
      handoffReason: reason,
      customerReply: formatted,
      smartCategory: outCat,
      priority: outPri,
    };
  }

  // 3. Conditional Catalog & Product Retrieval (ONLY when intent requires product lookup)
  let allItems: MainWebsiteProduct[] = [];
  let cacheMeta: CatalogCacheMeta = {
    ccCacheTier: "BYPASS",
    ce53CacheTier: "BYPASS",
    catalogCacheStatus: "BYPASS",
    cacheSummary: `Skipped catalog lookup for non-product intent=${intentInfo.intent}`,
  };
  let budgetLabel: string | null = null;
  let usedLookupQuery = "";
  let contextMatches: MainWebsiteProduct[] = [];
  let top: MainWebsiteProduct | undefined;

  if (intentInfo.requiresProductLookup) {
    const fetched = await getCachedEcosystemCatalog();
    allItems = fetched.allItems;
    cacheMeta = fetched.cacheMeta;
    addStep("Checked ecosystem catalog cache", cacheMeta.cacheSummary);

    const directBudget = extractBudgetConstraintsFromQuery(rawText);
    const windowBudget = intentInfo.allowRollingContextFallback
      ? extractBudgetConstraintsFromQuery(recentInboundWindow)
      : { minPrice: null, maxPrice: null };
    const activeBudget =
      directBudget.maxPrice !== null || directBudget.minPrice !== null
        ? directBudget
        : windowBudget;
    budgetLabel =
      activeBudget.maxPrice !== null && activeBudget.minPrice !== null
        ? `₹${activeBudget.minPrice.toLocaleString("en-IN")} to ₹${activeBudget.maxPrice.toLocaleString("en-IN")}`
        : activeBudget.maxPrice !== null
        ? `<= ₹${activeBudget.maxPrice.toLocaleString("en-IN")}`
        : activeBudget.minPrice !== null
        ? `>= ₹${activeBudget.minPrice.toLocaleString("en-IN")}`
        : null;

    const directMatches = searchEcosystemItems(allItems, rawText, 8);
    usedLookupQuery =
      directMatches.length > 0 || !intentInfo.allowRollingContextFallback
        ? rawText
        : recentInboundWindow;
    contextMatches =
      directMatches.length > 0
        ? directMatches
        : intentInfo.allowRollingContextFallback
        ? searchEcosystemItems(allItems, recentInboundWindow, 8)
        : [];
    top = contextMatches[0];

    addStep(
      "Executed catalog product lookup",
      `query="${usedLookupQuery.slice(0, 90)}"${budgetLabel ? `, budget="${budgetLabel}"` : ""}, matched=${contextMatches.length} of ${allItems.length} items`
    );
  } else {
    addStep(
      "Skipped catalog product lookup",
      `Non-product turn (${intentInfo.intent})`
    );
  }

  let smartCategory = "General Enquiry";
  let priority: "URGENT" | "HIGH" | "NORMAL" = "NORMAL";

  if (intentInfo.requiresProductLookup) {
    const classificationProbe = intentInfo.allowRollingContextFallback ? contextLower : lower;
    if (/machine|laser|router|polish|diamond|bending|bender|heater|yn-|ce53|classic edge|consumable|blade|cutter|flame|buffing|cloudy\s*edge|rough\s*edge/i.test(classificationProbe)) {
      smartCategory = "Acrylic Machines (CE53)";
      priority = "HIGH";
    } else if (/podium|podiums|lectern|lecterns|pulpit|pulpits|rostrum|stage|auditorium|conference/i.test(classificationProbe)) {
      smartCategory = "Podiums & Stage";
      priority = /friday|urgent|tomorrow|today/i.test(lower) ? "URGENT" : "HIGH";
    } else if (/trophy|trophies|memento|award|student|convocation|plaque/i.test(classificationProbe)) {
      smartCategory = "Awards & Trophies";
    } else if (/hotel|banquet|menu|qr|resort|hospitality|tent\s*card|table\s*stand|sign\s*holder/i.test(classificationProbe)) {
      smartCategory = "Hotel & Banquet";
      priority = "HIGH";
    } else if (/cover|guard|enclosure|box|case|display\s*stand|riser|custom|mm|inch/i.test(classificationProbe)) {
      smartCategory = "Custom Fabrication";
      priority = "HIGH";
    } else if (/order|dispatch|delivery|tracking|courier|invoice|advance|payment/i.test(classificationProbe)) {
      smartCategory = "Order & Delivery";
    }
  }

  const prebuiltGroupedBlock = intentInfo.requiresProductLookup
    ? buildGroupedProductShortLinksSection({
        allItems,
        matchedItems: contextMatches,
        smartCategory,
      })
    : "";

  // 4. Multi-turn Claude Haiku 5.5 (Medium Effort) Diagnostic & Conversational Assistant
  const { apiKey, source: keySource } = await resolveSharedAnthropicApiKey("client");
  let lastAiError: string | null = null;
  let lastUsage: AiTokenUsage | null = null;

  if (apiKey) {
    try {
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

      while (claudeMessages.length > 0 && claudeMessages[0].role !== "user") {
        claudeMessages.shift();
      }

      let catalogContext = "";
      if (!intentInfo.requiresProductLookup) {
        if (intentInfo.intent === "IDENTITY_META") {
          catalogContext = `Turn Intent: IDENTITY_META (The customer is asking who you are or what you can help with).
Answer directly in 2-3 short lines: you are *ACRIO*, the WhatsApp product & fabrication assistant for *Classic Concepts* (ready & custom acrylic podiums, awards, stands, boxes: classicconcepts.in) and *Classic Edge 53* (acrylic bending, diamond edge polishing & cutting machines: classicedge53.com).
CRITICAL: Do NOT list or repeat specific products or links from earlier turns in this reply!`;
        } else if (intentInfo.intent === "COMPANY_INFO") {
          catalogContext = `Turn Intent: COMPANY_INFO (The customer is asking about our company, factory location, or what we do).
Answer directly: *Classic Concepts* manufactures ready and custom cast-acrylic products (stage podiums/pulpits, trophies, hotel/retail stands, custom boxes & covers) and *Classic Edge 53* supplies industrial acrylic fabrication machines (diamond edge polishers, bending heaters, cutters) from our 16,000+ sq. ft. facility in Mumbai with pan-India delivery and GST billing.
CRITICAL: Do NOT dump unrelated product links unless asked.`;
        } else if (intentInfo.intent === "TOPIC_RESET") {
          catalogContext = `Turn Intent: TOPIC_RESET (The customer wants to ask a different query or start a new topic).
Acknowledge warmly in 1-2 short lines and invite them to share their new question or requirement.
CRITICAL: Do NOT carry over, repeat, or pitch any products from earlier messages in the conversation!`;
        } else if (intentInfo.intent === "HUMAN_HANDOFF_INFO") {
          catalogContext = `Turn Intent: HUMAN_HANDOFF_INFO (The customer is asking an informational question about who you will connect them to).
Explain clearly that when they want human assistance, you connect their WhatsApp chat directly to our *Classic Concepts & Classic Edge 53 Sales & Fabrication Team* (who handle custom size quotes, bulk orders, and dispatch checks), and ask if they would like to be connected now or keep exploring.
CRITICAL: Set "needsHumanHandoff": false because they are only asking *whom* you connect to, not asking to be transferred yet!`;
        } else if (intentInfo.intent === "OFF_TOPIC") {
          catalogContext = `Turn Intent: OFF_TOPIC.
Politely state in 1-2 lines that you only assist with *Classic Concepts* acrylic products and *Classic Edge 53* fabrication machines, and ask if they need any display, podium, custom box, or machine.`;
        } else {
          catalogContext = `Turn Intent: GREETING.
Welcome the customer briefly and ask what they are looking to display, build, or fabricate today (stage podiums/pulpits, awards, custom acrylic boxes, or Classic Edge 53 machines). Do NOT dump specific product links yet.`;
        }
      } else {
        catalogContext = prebuiltGroupedBlock
          ? `Turn Intent: ${intentInfo.intent}\nMatched Products strictly filtered for the customer's query${budgetLabel ? ` (Budget filter applied: ${budgetLabel})` : ""}:\n${prebuiltGroupedBlock}\n\nIMPORTANT: ONLY share products from the list above. Do NOT invent or mention any product outside this list.`
          : `Turn Intent: ${intentInfo.intent}\nNo exact ready-priced product matched "${usedLookupQuery}"${budgetLabel ? ` within budget ${budgetLabel}` : ""}. Explain honestly and helpfully what we do make (stage podiums/pulpits from ₹7,150 upwards, awards & trophies, hotel QR/menu stands, custom clear acrylic boxes/covers on classicconcepts.in, plus acrylic bending, diamond polishing & cutting machines on classicedge53.com) and ask 1 short clarifying question.`;
      }

      const latestPromptPayload = `[Internal Context for ACRIO - never echo raw labels]
Customer Name: ${params.customerName}
Already Greeted Earlier In This Chat: ${alreadyGreeted ? "YES (DO NOT say Hi/Hello or customer's name again! Start directly with the helpful answer.)" : `NO (First reply: greet "${firstName}" warmly once in 1 short line.)`}
Detected Category: ${smartCategory}
${catalogContext}

Customer's latest WhatsApp message:
${rawText}`;

      const lastTurn = claudeMessages[claudeMessages.length - 1];
      if (lastTurn && lastTurn.role === "user") {
        lastTurn.content = `${lastTurn.content}\n\n${latestPromptPayload}`;
      } else {
        claudeMessages.push({ role: "user", content: latestPromptPayload });
      }

      const aiCall = await callClaudeHaikuMessagesDetailed({
        apiKey,
        maxTokens: 2048,
        effort: "medium",
        timeoutMs: 24000,
        system: `You are ACRIO, the WhatsApp product & fabrication specialist for Classic Concepts (acrylic products: classicconcepts.in) and Classic Edge 53 (acrylic fabrication machines & tools: classicedge53.com).

CORE CONVERSATION, ACCURACY & WHATSAPP FORMATTING RULES:
1. UNDERSTAND CUSTOMER INTENT ACCURATELY:
   - If Turn Intent is IDENTITY_META, COMPANY_INFO, TOPIC_RESET, HUMAN_HANDOFF_INFO, GREETING, or OFF_TOPIC, answer that question directly in 2-4 lines and NEVER list or repeat products from earlier turns!
   - Know common terms: "pulpit" / "lectern" / "rostrum" = Acrylic Stage Podiums.
   - Respect price budgets strictly (e.g. "under ₹25,000" -> ONLY show podiums priced at or below ₹25,000 from the Matched Products list, with their exact ₹ price!).
   - NEVER include unrelated products (never suggest trays, ovens, machines, or tubes when someone asks for pulpits/podiums!).
   - If the customer repeats or clarifies an earlier message (like "I said I am looking for pulpits"), apologize briefly in 5-6 words if needed and immediately show the exact pulpit/podium options!
2. CLEAN, PROFESSIONAL WHATSAPP FORMATTING (CRITICAL):
   - NEVER repeat "Hi ${firstName}" or "Hello" if Already Greeted Earlier is YES.
   - When sharing Matched Products, structure the reply with clean visual spacing so it reads beautifully on a mobile WhatsApp screen:
     Short 1-sentence direct opening answer.

     *<Category Heading>:*
     1. *<Clean Product Name>* (₹<Price>)
        https://ccapl.cc/<6-char-id>
     2. *<Clean Product Name>* (₹<Price>)
        https://ccapl.cc/<6-char-id>

     Short 1-sentence practical follow-up question (e.g. event city, logo printing on front, or quantity needed).
   - Use single asterisks *like this* for WhatsApp bold (NEVER **double asterisks**, NEVER [markdown](links), NEVER ### headings).
   - Use ₹ for Indian Rupees (e.g. ₹14,999).
3. PLAIN EVERYDAY ENGLISH:
   - Zero em-dashes ("—"), zero "--", zero robotic AI buzzwords (no bespoke, seamless, robust, utilize, leverage, meticulous, elevate).
   - NEVER add a robotic footer like "reply talk to team anytime".
4. HUMAN HANDOFF RULE:
   - Set "needsHumanHandoff": true ONLY if the customer explicitly asks for a human/call right now, reports a damaged order/refund issue, or has ALREADY confirmed final custom dimensions + quantity and wants a formal Sales proforma invoice.
   - If the customer is only asking "Whom will you connect me to?" (HUMAN_HANDOFF_INFO), set "needsHumanHandoff": false!

Return ONLY valid JSON:
{
  "needsHumanHandoff": false,
  "handoffReason": "",
  "smartCategory": "Podiums & Stage | Awards & Trophies | Hotel & Banquet | Acrylic Machines (CE53) | Custom Fabrication | Order & Delivery | General Enquiry",
  "priority": "URGENT | HIGH | NORMAL",
  "customerReply": "Cleanly formatted WhatsApp message using \\n line breaks, *bold* titles, ₹ prices, and https://ccapl.cc/... shortlinks"
}`,
        messages: claudeMessages,
      });

      lastUsage = aiCall.usage;
      if (aiCall.ok && aiCall.text) {
        addStep(
          "Called Anthropic claude-haiku-5-5 (effort=medium)",
          `HTTP ${aiCall.statusCode} in ${aiCall.durationMs}ms (keySource=${keySource}, in=${aiCall.usage?.inputTokens ?? 0}, think=${aiCall.usage?.thinkingTokens ?? 0}, out=${aiCall.usage?.outputTokens ?? 0})`
        );
        const parsed = parseClaudeJson<any>(aiCall.text);
        if (parsed && typeof parsed.customerReply === "string" && parsed.customerReply.trim()) {
          const handoff =
            intentInfo.intent === "HUMAN_HANDOFF_INFO" ||
            intentInfo.intent === "IDENTITY_META" ||
            intentInfo.intent === "COMPANY_INFO" ||
            intentInfo.intent === "TOPIC_RESET" ||
            intentInfo.intent === "GREETING" ||
            intentInfo.intent === "OFF_TOPIC"
              ? false
              : Boolean(parsed.needsHumanHandoff);
          const cleanedReply = stripRepeatedGreeting(
            formatWhatsAppOutboundText(parsed.customerReply),
            alreadyGreeted,
            params.customerName
          );
          addStep(
            "Parsed JSON & formatted WhatsApp outbound message",
            `intent=${intentInfo.intent}, smartCategory="${parsed.smartCategory || smartCategory}", handoff=${handoff}, chars=${cleanedReply.length}`
          );

          recordAndBroadcastAiLog({
            website: "WHATSAPP_HUB",
            websiteLabel: "Classic Concepts WhatsApp Hub",
            feature: "Autonomous WhatsApp Concierge (ACRIO)",
            actor: params.customerName,
            question: rawText,
            model: LOCKED_CLAUDE_MODEL,
            effort: "medium",
            outcomeSource: handoff ? "HUMAN_HANDOFF" : "LIVE_AI",
            responseCacheStatus: "BYPASS",
            catalogCacheStatus: cacheMeta.catalogCacheStatus,
            cacheDetails: `${cacheMeta.cacheSummary} • intent=${intentInfo.intent} • Multi-turn live Claude Haiku 5.5 Medium`,
            productLookupTriggered: intentInfo.requiresProductLookup,
            productLookupQuery: usedLookupQuery,
            productLookupBudget: budgetLabel,
            productLookupTotalScanned: intentInfo.requiresProductLookup ? allItems.length : 0,
            productsLookedUp: contextMatches.map(mapProductToLogItem),
            steps,
            response: cleanedReply,
            durationMs: Date.now() - started,
            tokenUsage: aiCall.usage,
          });

          return {
            needsHumanHandoff: handoff,
            handoffReason: handoff
              ? parsed.handoffReason ||
                `Customer ready for Sales Team follow-up ("${rawText.slice(0, 100)}").`
              : "",
            customerReply: cleanedReply,
            smartCategory: parsed.smartCategory || smartCategory,
            priority: parsed.priority || priority,
          };
        } else {
          lastAiError = "Claude returned text that could not be parsed as JSON.";
          addStep("JSON parse warning", lastAiError, "WARN");
        }
      } else {
        lastAiError = aiCall.error || "Anthropic call failed";
        addStep(
          "Anthropic claude-haiku-5-5 call failed",
          `HTTP ${aiCall.statusCode}: ${lastAiError}`,
          "ERROR"
        );
      }
    } catch (err: any) {
      lastAiError = err?.message || "Unexpected error in AI turn";
      addStep("Exception during AI turn", lastAiError || undefined, "ERROR");
    }
  } else {
    lastAiError = "Client Anthropic API key is not configured.";
    addStep("Skipped live AI call", lastAiError, "SKIP");
  }

  // 5. Conversational & Diagnostic Fallback Engine (when offline or API error)
  const greetOnce = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
  let fallbackReply = "";
  let fallbackHandoff = false;
  let fallbackReason = "";

  if (intentInfo.intent === "GREETING") {
    fallbackReply = alreadyGreeted
      ? `Tell me what you are looking to display, make, or solve today:\n\n• *Acrylic Podiums, Pulpits & Display Stands*\n• *Awards, Trophies & Hotel QR Stands*\n• *Custom-Size Acrylic Boxes & Covers*\n• *Classic Edge 53 Acrylic Machines & Tools*\n\nShare a few details and I will suggest the best options!`
      : `Hello ${firstName}! Welcome to *Classic Concepts* & *Classic Edge 53*.\n\nHow can I help you today?\n• *Stage Podiums, Pulpits & Trophies*\n• *Custom-Size Acrylic Boxes & Machine Covers*\n• *Acrylic Bending, Polishing & Cutting Machines*\n\nTell me what you have in mind!`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "IDENTITY_META") {
    fallbackReply = `${greetOnce}I am *ACRIO*, the WhatsApp product & fabrication assistant for *Classic Concepts* (ready & custom acrylic podiums, awards, stands, and boxes) and *Classic Edge 53* (industrial acrylic bending, diamond edge polishing, and cutting machines).\n\nTell me what you want to display, build, or fabricate and I will share matching options and prices right away.`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "COMPANY_INFO") {
    fallbackReply = `${greetOnce}*Classic Concepts* manufactures cast-acrylic stage podiums, trophies, hotel/retail stands, and custom acrylic boxes, while *Classic Edge 53* supplies industrial acrylic bending, diamond edge polishing, and cutting machines from our 16,000+ sq. ft. facility in Mumbai.\n\nWe ship pan-India with full GST billing. What product or machine can I help you check today?`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "TOPIC_RESET") {
    fallbackReply = `${greetOnce}Sure, let's start fresh! Tell me what you are looking for or what question you have, and I will help you right away.`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "HUMAN_HANDOFF_INFO") {
    fallbackReply = `${greetOnce}When you ask to speak with someone, I connect this WhatsApp chat directly to our *Classic Concepts & Classic Edge 53 Sales & Fabrication Team* so a specialist can help you with custom quotes, bulk pricing, or order dispatch.\n\nWould you like me to connect our *Sales Team* now, or would you like to check a product first?`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "OFF_TOPIC") {
    fallbackReply = `${greetOnce}I only help with *Classic Concepts* acrylic products (podiums, awards, stands, custom boxes) and *Classic Edge 53* acrylic fabrication machines.\n\nLet me know if you need options or pricing for any acrylic product or machine!`;
    priority = "NORMAL";
  } else if (/\b(cloudy|white\s*edge|rough\s*edge|dull\s*edge|polish\s*problem|flame|burn|bubble|crack|bend\s*issue|warping|scratch|yellow)\b/i.test(lower)) {
    const issueSolutions: string[] = [];
    if (/cloudy|white|rough|dull|polish/i.test(lower)) {
      issueSolutions.push(
        `• *Cloudy or rough cut edges:* A *Diamond Edge Polishing Machine* gives a crystal-clear flat edge in one pass without flame stress marks.`
      );
    }
    if (/crack|bubble|bend|warp/i.test(lower)) {
      issueSolutions.push(
        `• *Bubbles or cracking while bending:* Using a temperature-controlled *Acrylic Bending Heater* with even heating solves this cleanly.`
      );
    }
    if (issueSolutions.length === 0) {
      issueSolutions.push(
        `• Using *cast clear acrylic* instead of extruded sheet prevents yellowing, burrs, and hairline cracks during fabrication.`
      );
    }
    const machineBlock = prebuiltGroupedBlock
      ? `\n\n${prebuiltGroupedBlock}`
      : top
      ? `\n\n*Matching Machine:*\n1. *${cleanDisplayProductName(top.name)}*\n   ${top.shortUrl || top.url}`
      : "";
    fallbackReply = `${greetOnce}Here is what usually causes that and how to fix it:\n\n${issueSolutions.join("\n\n")}${machineBlock}\n\nWhat *sheet thickness* are you working with, and are you cutting by laser or router?`;
    smartCategory = "Acrylic Machines (CE53)";
    priority = "HIGH";
  } else if (
    /\b(\d+\s*(?:mm|cm|inch|in|ft)\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?\s*x\s*\d+)\b/i.test(lower) &&
    /\b(\d+\s*(?:pcs|pieces|nos|units|qty)|quote|price)\b/i.test(contextLower)
  ) {
    fallbackReply = `${greetOnce}Got your custom size details! I am connecting our *Sales Team* right now so they can calculate sheet thickness, exact fabrication cost, and dispatch time for you.`;
    fallbackHandoff = true;
    fallbackReason = `Customer shared custom dimensions for Sales quotation ("${rawText.slice(0, 110)}").`;
    smartCategory = "Custom Fabrication";
    priority = "HIGH";
  } else if (top && prebuiltGroupedBlock) {
    const followUpPrompt =
      smartCategory === "Acrylic Machines (CE53)"
        ? `What *maximum sheet thickness* and *working width* do you handle most often?`
        : smartCategory === "Podiums & Stage"
        ? `Do you want *custom front logo printing* on the podium, and which *city* do we need to dispatch to?`
        : `Roughly *how many pieces* do you need, and do you want *custom logo printing* or a specific size?`;
    fallbackReply = `${greetOnce}${prebuiltGroupedBlock}\n\n${followUpPrompt}`;
  } else {
    fallbackReply = `${greetOnce}I would love to help find the right option for you.\n\nCould you share a little more about what you need?\n• *Stage & Events:* acrylic podiums/pulpits, awards, or plaques\n• *Hotels & Retail:* menu/QR stands, risers, or display boxes\n• *Custom Size Job:* share what goes inside and rough size\n• *Acrylic Machines:* cutting, bending, or diamond polishing`;
    priority = "NORMAL";
  }

  const finalFallback = stripRepeatedGreeting(
    formatWhatsAppOutboundText(fallbackReply),
    alreadyGreeted,
    params.customerName
  );
  addStep(
    "Generated deterministic fallback WhatsApp reply",
    `intent=${intentInfo.intent}, matchedProducts=${contextMatches.length}, smartCategory="${smartCategory}"`
  );

  recordAndBroadcastAiLog({
    website: "WHATSAPP_HUB",
    websiteLabel: "Classic Concepts WhatsApp Hub",
    feature: "Autonomous WhatsApp Concierge (ACRIO)",
    actor: params.customerName,
    question: rawText,
    model: lastAiError ? `${LOCKED_CLAUDE_MODEL} -> local-fallback` : "local-catalog",
    effort: "medium",
    outcomeSource: fallbackHandoff ? "HUMAN_HANDOFF" : "LOCAL_FALLBACK",
    responseCacheStatus: "BYPASS",
    catalogCacheStatus: cacheMeta.catalogCacheStatus,
    cacheDetails: `${cacheMeta.cacheSummary} • intent=${intentInfo.intent}`,
    productLookupTriggered: intentInfo.requiresProductLookup,
    productLookupQuery: usedLookupQuery,
    productLookupBudget: budgetLabel,
    productLookupTotalScanned: intentInfo.requiresProductLookup ? allItems.length : 0,
    productsLookedUp: contextMatches.map(mapProductToLogItem),
    steps,
    response: finalFallback,
    durationMs: Date.now() - started,
    tokenUsage: lastUsage,
    error: lastAiError,
  });

  return {
    needsHumanHandoff: fallbackHandoff,
    handoffReason: fallbackReason,
    customerReply: finalFallback,
    smartCategory,
    priority,
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
  const started = Date.now();
  const steps: AiTraceStep[] = [];
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

  steps.push({
    stepNumber: 1,
    label: "Loaded opted-in CRM contacts",
    detail: `${all.length} opted-in contacts scanned`,
    durationMs: Date.now() - started,
    status: "OK",
  });

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
  let usedLiveAi = false;
  let usage: AiTokenUsage | null = null;
  let aiErr: string | null = null;

  const { apiKey: adminApiKey } = await resolveSharedAnthropicApiKey("admin");
  if (adminApiKey && prompt.trim().length > 6 && all.length > 0) {
    const aiCall = await callClaudeHaikuMessagesDetailed({
      apiKey: adminApiKey,
      maxTokens: 1600,
      effort: "medium",
      timeoutMs: 20000,
      system: `You are ACRIO Admin Assistant for Classic Concepts. Write in plain everyday English (zero em-dashes, zero buzzwords). Given a marketing list prompt and CRM contacts, pick matching contact IDs and return ONLY valid JSON: {"suggestedName": "Short Clear List Name", "matchedIds": ["id1"], "explanation": "Short plain explanation"}`,
      messages: [
        {
          role: "user",
          content: `Prompt: ${prompt.trim()}\nOpted-in contacts:\n${all
            .slice(0, 40)
            .map(
              (c) =>
                `${c.id} | ${c.name} | ${c.organizationType || ""} | ${c.acrioSegment} | ₹${c.lifetimeValueInr}`
            )
            .join("\n")}`,
        },
      ],
    });
    usage = aiCall.usage;
    if (aiCall.ok && aiCall.text) {
      const parsed = parseClaudeJson<any>(aiCall.text);
      if (parsed) {
        usedLiveAi = true;
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
        steps.push({
          stepNumber: 2,
          label: "Refined segment with Claude Haiku 5.5 (effort=medium)",
          detail: `Selected ${filtered.length} contacts ("${suggestedName}")`,
          durationMs: Date.now() - started,
          status: "OK",
        });
      }
    } else {
      aiErr = aiCall.error;
      steps.push({
        stepNumber: 2,
        label: "Claude segment refinement fallback",
        detail: aiErr || "Used deterministic CRM filter",
        durationMs: Date.now() - started,
        status: "WARN",
      });
    }
  }

  recordAndBroadcastAiLog({
    website: "WHATSAPP_HUB",
    websiteLabel: "Classic Concepts WhatsApp Hub",
    feature: "ACRIO Smart Audience Segmenter",
    actor: "Marketing Admin",
    question: prompt.trim(),
    model: usedLiveAi ? LOCKED_CLAUDE_MODEL : "local-crm-filter",
    effort: usedLiveAi ? "medium" : undefined,
    outcomeSource: usedLiveAi ? "LIVE_AI" : "LOCAL_FALLBACK",
    responseCacheStatus: "BYPASS",
    catalogCacheStatus: "BYPASS",
    cacheDetails: `Scanned ${all.length} opted-in CRM contacts directly`,
    productLookupTriggered: false,
    productLookupQuery: "",
    productLookupTotalScanned: 0,
    productsLookedUp: [],
    steps,
    response: `${suggestedName} (${filtered.length} contacts): ${filterExplanation}`,
    durationMs: Date.now() - started,
    tokenUsage: usage,
    error: aiErr,
  });

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
  const runFolder = path.join(/*turbopackIgnore: true*/ backupRoot, `snapshot_${stamp}`);

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
        fileName: path.basename(/*turbopackIgnore: true*/ f.filePath),
        sizeBytes: f.sizeBytes,
        base64: fs.readFileSync(/*turbopackIgnore: true*/ f.filePath).toString("base64"),
      })),
    };
    const compressedArchive = zlib.gzipSync(
      Buffer.from(JSON.stringify(bundlePayload), "utf8")
    );
    const archiveName = `ccwhatsapp_libsql_backup_${stamp}.json.gz`;
    const archivePath = path.join(/*turbopackIgnore: true*/ runFolder, archiveName);
    fs.writeFileSync(/*turbopackIgnore: true*/ archivePath, compressedArchive);

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
    for (const entry of fs.readdirSync(/*turbopackIgnore: true*/ backupRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("snapshot_")) {
        const full = path.join(/*turbopackIgnore: true*/ backupRoot, entry.name);
        const st = fs.statSync(/*turbopackIgnore: true*/ full);
        if (st.mtimeMs < cutoffMs) {
          fs.rmSync(/*turbopackIgnore: true*/ full, { recursive: true, force: true });
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
const TEMPLATE_SLUG_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "create", "customers",
  "customer", "draft", "for", "from", "future", "generate", "in", "into", "is",
  "it", "make", "message", "messages", "of", "on", "or", "our", "please", "send",
  "sending", "template", "that", "the", "their", "them", "this", "to", "use",
  "usecase", "usecases", "we", "which", "with", "write",
]);

function buildCleanTemplateSlug(rawInput: string, brandPrefix: "cc" | "ce53"): string {
  const cleaned = String(rawInput || "")
    .toLowerCase()
    .replace(new RegExp(`^${brandPrefix}_+`), "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const words = cleaned
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !TEMPLATE_SLUG_STOPWORDS.has(w));

  const chosen = (words.length > 0 ? words : ["official", "update"]).slice(0, 4);
  return `${brandPrefix}_${chosen.join("_")}`.slice(0, 42);
}

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
  const started = Date.now();
  const steps: AiTraceStep[] = [];
  const category: WhatsAppTemplateCategory =
    params.category === "UTILITY" || params.category === "AUTHENTICATION"
      ? params.category
      : "MARKETING";
  const brand =
    params.brand === "CLASSIC_EDGE_53" ? "CLASSIC_EDGE_53" : "CLASSIC_CONCEPTS";
  const brandPrefix = brand === "CLASSIC_EDGE_53" ? "ce53" : "cc";
  const brandName =
    brand === "CLASSIC_EDGE_53" ? "Classic Edge 53" : "Classic Concepts";
  const shortOrigin = resolvePublicShortLinkOrigin();
  const cleanPrompt = params.prompt.trim();

  const { allItems, cacheMeta } = await getCachedEcosystemCatalog();
  steps.push({
    stepNumber: 1,
    label: "Checked ecosystem catalog cache",
    detail: cacheMeta.cacheSummary,
    durationMs: Date.now() - started,
    status: "OK",
  });

  const isGeneralAnnouncementPrompt =
    /\b(new\s+whatsapp|new\s+number|official\s+number|save\s+this\s+number|introduce\s+our|future\s+use|contact\s+number|helpline|office\s+hours|holiday|address\s+change)\b/i.test(
      cleanPrompt
    ) &&
    !/\b(podium|pulpit|lectern|trophy|award|machine|polisher|bender|router|tray|stand|box|price\s+list)\b/i.test(
      cleanPrompt
    );

  const matches = isGeneralAnnouncementPrompt
    ? []
    : searchEcosystemItems(allItems, cleanPrompt, 3);
  const topLink = matches[0]?.shortUrl || "";

  steps.push({
    stepNumber: 2,
    label: isGeneralAnnouncementPrompt
      ? "Skipped product catalog injection (general announcement/update prompt)"
      : "Ran catalog lookup for template context",
    detail: isGeneralAnnouncementPrompt
      ? "Prompt is an announcement/number introduction; keeping copy strictly focused on the prompt."
      : `Matched ${matches.length} catalog items${topLink ? ` (topLink=${topLink})` : ""}`,
    durationMs: Date.now() - started,
    status: "OK",
  });

  const adminKeyInfo = await resolveSharedAnthropicApiKey("admin");
  const clientKeyInfo = await resolveSharedAnthropicApiKey("client");
  const apiKey = adminKeyInfo.apiKey || clientKeyInfo.apiKey;
  let lastAiError: string | null = null;
  let lastUsage: AiTokenUsage | null = null;

  if (apiKey) {
    try {
      const aiCall = await callClaudeHaikuMessagesDetailed({
        apiKey,
        maxTokens: 2048,
        effort: "medium",
        timeoutMs: 24000,
        system: `You design executive, high-converting, Meta WhatsApp Cloud API compliant templates for ${brandName}.

STRICT TEMPLATE DESIGN & META APPROVAL RULES:
1. TAILOR DIRECTLY TO THE ADMIN'S GOAL:
   - Write the exact message the admin asked for! Never fall back to generic "Explore our product range" copy if the admin asked for something specific (such as introducing our new official WhatsApp number, an event invite, dispatch update, etc.).
2. SHORT, MEANINGFUL TEMPLATE NAME (CRITICAL):
   - "name" MUST be a short 2 to 4 word descriptive identifier in lowercase_snake_case prefixed with "${brandPrefix}_" (for example: "${brandPrefix}_official_whatsapp_intro" or "${brandPrefix}_podium_festival_offer").
   - NEVER copy the admin's prompt sentence into "name" (NEVER output "${brandPrefix}_create_a_message...").
3. EXECUTIVE WHATSAPP FORMATTING & META VARIABLE RULES:
   - Body text MUST NOT start or end with a {{variable}} and MUST NOT place {{1}} {{2}} side by side.
   - Number variables sequentially starting at {{1}} (usually {{1}} = Customer First Name).
   - Format the body cleanly for WhatsApp mobile screens using *single-asterisk bold* for key highlights, clean paragraph breaks, and bullet points (•) where helpful. Keep body under 480 characters.
   - Plain, warm, everyday English. Zero em-dashes ("—"), zero "--", zero robotic AI buzzwords (no bespoke, seamless, robust, utilize, leverage, meticulous, elevate).
4. FOOTER & QUICK REPLY BUTTONS:
   - For MARKETING: footerText MUST include opt-out ("${brandName} • Reply STOP to opt out"). For UTILITY: "${brandName}".
   - Include 2 or 3 relevant QUICK_REPLY buttons (<= 22 chars each) that match the message topic, each mapped to a deterministic flowAction ("AUTO_REPLY", "ASSIGN_TEAM", "SEND_ORDER_TRACKING", or "OPT_OUT_DND").

Return ONLY valid JSON:
{
  "name": "${brandPrefix}_short_topic_slug",
  "category": "${category}",
  "headerText": "Clean Title <= 55 chars (no variables, no emojis)",
  "bodyText": "Hello {{1}},\\n\\nClean WhatsApp-formatted body tailored to the prompt...",
  "footerText": "${category === "MARKETING" ? `${brandName} • Reply STOP to opt out` : brandName}",
  "variablesSchema": [
    { "index": 1, "label": "Customer First Name", "sourceField": "customer.firstName", "sampleValue": "Rahul" }
  ],
  "buttons": [
    {
      "type": "QUICK_REPLY",
      "text": "Relevant Button <=22c",
      "flowAction": {
        "actionType": "AUTO_REPLY",
        "replyText": "Helpful instant reply matching this button"
      }
    },
    {
      "type": "QUICK_REPLY",
      "text": "Talk to Our Team",
      "flowAction": {
        "actionType": "ASSIGN_TEAM",
        "teamId": "team_sales",
        "replyText": "Connecting you with our *Sales Team* right away. A team member will assist you shortly."
      }
    }
  ]
}`,
        messages: [
          {
            role: "user",
            content: `Admin Prompt: ${cleanPrompt}\nCategory: ${category}\nBrand: ${brandName}${
              topLink ? `\nOptional catalog shortlink (include ONLY if relevant to the prompt): ${topLink}` : "\nDo NOT insert random product catalog links unless requested."
            }`,
          },
        ],
      });

      lastUsage = aiCall.usage;
      if (aiCall.ok && aiCall.text) {
        steps.push({
          stepNumber: 3,
          label: "Called Anthropic claude-haiku-5-5 (effort=medium)",
          detail: `HTTP ${aiCall.statusCode} in ${aiCall.durationMs}ms (in=${aiCall.usage?.inputTokens ?? 0}, think=${aiCall.usage?.thinkingTokens ?? 0}, out=${aiCall.usage?.outputTokens ?? 0})`,
          durationMs: Date.now() - started,
          status: "OK",
        });

        const parsed = parseClaudeJson<any>(aiCall.text);
        if (parsed && parsed.bodyText) {
          let rawName = String(parsed.name || "")
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, "_")
            .replace(/^_+|_+$/g, "");
          const nameWords = rawName.split("_").filter(Boolean);
          if (
            !rawName ||
            nameWords.length > 6 ||
            /create_a_message|write_a_message|send_to_our/.test(rawName)
          ) {
            rawName = buildCleanTemplateSlug(rawName || cleanPrompt, brandPrefix);
          } else if (!rawName.startsWith(`${brandPrefix}_`)) {
            rawName = `${brandPrefix}_${rawName}`.slice(0, 48);
          }

          let cleanBody = formatWhatsAppOutboundText(String(parsed.bodyText || ""));
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

          const fallbackUrl =
            topLink ||
            (brand === "CLASSIC_EDGE_53"
              ? `${shortOrigin}/ce53mc`
              : `${shortOrigin}/podium`);

          const rawBtns: any[] = Array.isArray(parsed.buttons)
            ? parsed.buttons
            : [];
          const buttons: WhatsAppTemplateButton[] = rawBtns
            .slice(0, 4)
            .map((b, i) => ({
              id: `btn_ai_${i}_${Date.now().toString(36)}`,
              type: b.type === "URL" ? "URL" : "QUICK_REPLY",
              text: sanitizePlainEnglish(String(b.text || "Learn More"))
                .replace(/\*/g, "")
                .slice(0, 24),
              url: b.type === "URL" ? String(b.url || fallbackUrl) : undefined,
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

          const headerText = sanitizePlainEnglish(
            String(parsed.headerText || "")
          )
            .replace(/\*/g, "")
            .slice(0, 58);

          steps.push({
            stepNumber: 4,
            label: "Validated Meta template schema & button flows",
            detail: `name="${rawName}", vars=${variablesSchema.length}, buttons=${buttons.length}`,
            durationMs: Date.now() - started,
            status: "OK",
          });

          recordAndBroadcastAiLog({
            website: "WHATSAPP_HUB",
            websiteLabel: "Classic Concepts WhatsApp Hub",
            feature: "Meta Template AI Drafter",
            actor: "Templates Studio Admin",
            question: cleanPrompt,
            model: LOCKED_CLAUDE_MODEL,
            effort: "medium",
            outcomeSource: "LIVE_AI",
            responseCacheStatus: "BYPASS",
            catalogCacheStatus: cacheMeta.catalogCacheStatus,
            cacheDetails: cacheMeta.cacheSummary,
            productLookupTriggered: !isGeneralAnnouncementPrompt,
            productLookupQuery: isGeneralAnnouncementPrompt ? "" : cleanPrompt,
            productLookupTotalScanned: isGeneralAnnouncementPrompt ? 0 : allItems.length,
            productsLookedUp: matches.map(mapProductToLogItem),
            steps,
            response: `[${rawName}] Header: ${headerText}\n\n${cleanBody}`,
            durationMs: Date.now() - started,
            tokenUsage: aiCall.usage,
          });

          return {
            name: rawName,
            category,
            headerType: headerText ? "TEXT" : "NONE",
            headerText,
            bodyText: cleanBody,
            footerText: sanitizePlainEnglish(
              String(
                parsed.footerText ||
                  (category === "MARKETING"
                    ? `${brandName} • Reply STOP to opt out`
                    : brandName)
              )
            )
              .replace(/\*/g, "")
              .slice(0, 58),
            variablesSchema,
            buttons,
            complianceNotes: [
              "Drafted by Claude Haiku 5.5 (Medium effort) with sequential Meta variables.",
              "Quick Reply buttons pre-mapped to deterministic Flow Actions so AI credits are protected.",
            ],
          };
        }
        lastAiError = "Claude output could not be parsed as template JSON.";
      } else {
        lastAiError = aiCall.error || "Anthropic template call failed";
      }
    } catch (err: any) {
      lastAiError = err?.message || "Template AI exception";
    }
  } else {
    lastAiError = "Anthropic API key is not configured.";
  }

  steps.push({
    stepNumber: steps.length + 1,
    label: "Used smart deterministic template fallback",
    detail: lastAiError || "Fallback template generated",
    durationMs: Date.now() - started,
    status: "WARN",
  });

  const cleanSlug = buildCleanTemplateSlug(cleanPrompt, brandPrefix);
  const isUtility = category === "UTILITY";
  const fallbackLink =
    topLink ||
    (brand === "CLASSIC_EDGE_53"
      ? `${shortOrigin}/ce53mc`
      : `${shortOrigin}/podium`);

  const fallbackHeader = isGeneralAnnouncementPrompt
    ? `Official ${brandName} WhatsApp`
    : isUtility
    ? `${brandName} Service Update`
    : `${brandName} Updates`;

  const fallbackBody = isGeneralAnnouncementPrompt
    ? `Hello {{1}},\n\nPlease save this number as our *official ${brandName} WhatsApp desk* for all future enquiries, custom quotes, and live order updates.\n\nTap an option below anytime you need assistance from our team.`
    : isUtility
    ? `Hello {{1}}, we have reviewed your request with *${brandName}* (Ref {{2}}). Tap an option below to check status or connect directly with our team.`
    : `Hello {{1}}, thank you for connecting with *${brandName}*.${
        topLink ? ` Explore matching options here:\n${fallbackLink}\n\n` : "\n\n"
      }Tap a button below for pricing details or to speak directly with our Sales Team.`;

  recordAndBroadcastAiLog({
    website: "WHATSAPP_HUB",
    websiteLabel: "Classic Concepts WhatsApp Hub",
    feature: "Meta Template AI Drafter",
    actor: "Templates Studio Admin",
    question: cleanPrompt,
    model: `${LOCKED_CLAUDE_MODEL} -> local-fallback`,
    effort: "medium",
    outcomeSource: "LOCAL_FALLBACK",
    responseCacheStatus: "BYPASS",
    catalogCacheStatus: cacheMeta.catalogCacheStatus,
    cacheDetails: cacheMeta.cacheSummary,
    productLookupTriggered: !isGeneralAnnouncementPrompt,
    productLookupQuery: isGeneralAnnouncementPrompt ? "" : cleanPrompt,
    productLookupTotalScanned: isGeneralAnnouncementPrompt ? 0 : allItems.length,
    productsLookedUp: matches.map(mapProductToLogItem),
    steps,
    response: `[${cleanSlug}] Header: ${fallbackHeader}\n\n${fallbackBody}`,
    durationMs: Date.now() - started,
    tokenUsage: lastUsage,
    error: lastAiError,
  });

  return {
    name: cleanSlug,
    category,
    headerType: "TEXT",
    headerText: fallbackHeader,
    bodyText: fallbackBody,
    footerText: isUtility
      ? brandName
      : `${brandName} • Reply STOP to opt out`,
    variablesSchema: isUtility && !isGeneralAnnouncementPrompt
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
        text: isGeneralAnnouncementPrompt
          ? "Save & Say Hi"
          : isUtility
          ? "Track Order"
          : "Get Price List",
        flowAction: isUtility && !isGeneralAnnouncementPrompt
          ? { actionType: "SEND_ORDER_TRACKING" }
          : {
              actionType: "AUTO_REPLY",
              replyText: isGeneralAnnouncementPrompt
                ? `Thank you for saving our new *${brandName}* WhatsApp number! Let us know anytime you need product options, custom sizes, or order updates.`
                : `Here is the direct link to view models and specifications:\n${fallbackLink}\n\nLet us know the quantity you need!`,
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
              text: "Stop Updates",
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
  const started = Date.now();
  const firstName = params.customerName.split(/[\s(]/)[0] || "there";
  const { allItems, cacheMeta } = await getCachedEcosystemCatalog();
  const lookupQuery = `${params.buttonText} ${params.aiInstruction}`.trim();
  const matches = searchEcosystemItems(allItems, lookupQuery, 3);
  const catalogLines = matches
    .map(
      (m) =>
        `• *${cleanDisplayProductName(m.name)}*${m.basePrice ? ` (₹${m.basePrice.toLocaleString("en-IN")})` : ""}: ${m.shortUrl || m.url}`
    )
    .join("\n");

  const { apiKey } = await resolveSharedAnthropicApiKey("client");
  if (apiKey) {
    const aiCall = await callClaudeHaikuMessagesDetailed({
      apiKey,
      maxTokens: 1600,
      effort: "medium",
      timeoutMs: 18000,
      system: `You are ACRIO for Classic Concepts & Classic Edge 53. Reply strictly to the button action below in under 75 words using simple everyday English, clean WhatsApp *bold* formatting, ₹ prices, and zero em-dashes or buzzwords.`,
      messages: [
        {
          role: "user",
          content: `Customer: ${firstName}\nClicked Template Button: "${params.buttonText}"\nButton Action Instruction: ${params.aiInstruction}\nCatalog links:\n${catalogLines || "(none)"}`,
        },
      ],
    });
    if (aiCall.ok && aiCall.text) {
      const formatted = formatWhatsAppOutboundText(aiCall.text);
      recordAndBroadcastAiLog({
        website: "WHATSAPP_HUB",
        websiteLabel: "Classic Concepts WhatsApp Hub",
        feature: "Guarded Template Button AI Reply",
        actor: params.customerName,
        question: `[Button: ${params.buttonText}] ${params.aiInstruction}`,
        model: LOCKED_CLAUDE_MODEL,
        effort: "medium",
        outcomeSource: "LIVE_AI",
        responseCacheStatus: "BYPASS",
        catalogCacheStatus: cacheMeta.catalogCacheStatus,
        cacheDetails: cacheMeta.cacheSummary,
        productLookupTriggered: true,
        productLookupQuery: lookupQuery,
        productLookupTotalScanned: allItems.length,
        productsLookedUp: matches.map(mapProductToLogItem),
        steps: [
          { stepNumber: 1, label: "Matched products for button context", detail: `${matches.length} items` },
          { stepNumber: 2, label: "Generated reply with Claude Haiku 5.5 (effort=medium)", detail: `${aiCall.durationMs}ms` },
        ],
        response: formatted,
        durationMs: Date.now() - started,
        tokenUsage: aiCall.usage,
      });
      return formatted;
    }
  }

  const top = matches[0];
  const fallback = formatWhatsAppOutboundText(
    `Thanks for selecting *${params.buttonText}*!${top ? `\n\nTake a look at *${cleanDisplayProductName(top.name)}*:\n${top.shortUrl || top.url}` : ""}\n\nShare your required quantity or size and we will help right away.`
  );
  recordAndBroadcastAiLog({
    website: "WHATSAPP_HUB",
    websiteLabel: "Classic Concepts WhatsApp Hub",
    feature: "Guarded Template Button AI Reply",
    actor: params.customerName,
    question: `[Button: ${params.buttonText}] ${params.aiInstruction}`,
    model: "local-fallback",
    outcomeSource: "LOCAL_FALLBACK",
    responseCacheStatus: "BYPASS",
    catalogCacheStatus: cacheMeta.catalogCacheStatus,
    cacheDetails: cacheMeta.cacheSummary,
    productLookupTriggered: true,
    productLookupQuery: lookupQuery,
    productLookupTotalScanned: allItems.length,
    productsLookedUp: matches.map(mapProductToLogItem),
    steps: [{ stepNumber: 1, label: "Returned deterministic button reply", detail: `${matches.length} items` }],
    response: fallback,
    durationMs: Date.now() - started,
  });
  return fallback;
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
  const started = Date.now();
  const steps: AiTraceStep[] = [];
  const firstName = params.customerName.split(/[\s(]/)[0] || "there";
  const combinedQuery = `${params.productName || ""} ${params.message || ""}`.trim();
  const lower = combinedQuery.toLowerCase();
  const logWebsite: AiLogWebsite =
    params.brand === "CLASSIC_EDGE_53" ? "CLASSIC_EDGE_53" : "CLASSIC_CONCEPTS";
  const logWebsiteLabel =
    params.brand === "CLASSIC_EDGE_53"
      ? "Classic Edge 53 (classicedge53.com -> Hub)"
      : "Classic Concepts (classicconcepts.in -> Hub)";

  const { allItems, cacheMeta } = await getCachedEcosystemCatalog();
  const matches = searchEcosystemItems(allItems, combinedQuery, 4);

  steps.push(
    {
      stepNumber: 1,
      label: "Checked ecosystem catalog cache",
      detail: cacheMeta.cacheSummary,
      durationMs: Date.now() - started,
      status: "OK",
    },
    {
      stepNumber: 2,
      label: "Looked up matching products for website enquiry",
      detail: `query="${combinedQuery.slice(0, 80)}", matched=${matches.length} of ${allItems.length}`,
      durationMs: Date.now() - started,
      status: "OK",
    }
  );

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
  let lastAiError: string | null = null;
  let lastUsage: AiTokenUsage | null = null;

  if (apiKey) {
    try {
      const aiCall = await callClaudeHaikuMessagesDetailed({
        apiKey,
        maxTokens: 2048,
        effort: "medium",
        timeoutMs: 24000,
        system: `You handle new website form enquiries for ${brandName} (Classic Concepts acrylic products & Classic Edge 53 acrylic machines).
Your job is to give the customer a genuinely helpful, specific first answer right away before our Sales Team follows up!
RULES:
1. Address "${firstName}" warmly in simple, clear, everyday English.
2. Directly answer what they asked about, and when sharing matching products, ONLY use the exact https://ccapl.cc/<id> shortlinks and ₹ prices provided in context (never invent links or unrelated items).
3. Ask 1-2 practical details (like required quantity, delivery city, sheet thickness, or custom size) so our Sales Team can send the final quote immediately.
4. Zero em-dashes ("—"), zero "--", zero robotic AI buzzwords (no bespoke, seamless, robust, utilize, leverage, meticulous, elevate).
Return ONLY valid JSON:
{
  "smartCategory": "${smartCategory}",
  "priority": "${priority}",
  "smartReplyText": "Email-friendly plain text reply with clear paragraphs and numbered product links",
  "whatsappSummaryText": "Clean WhatsApp-formatted (*bold* + ₹ prices + grouped numbered shortlinks) version of the same helpful reply"
}`,
        messages: [
          {
            role: "user",
            content: `Brand: ${brandName}\nCustomer: ${params.customerName}\nProduct Selected: ${params.productName ? cleanDisplayProductName(params.productName) : "General"}\nCustomer Enquiry: ${params.message}\n${groupedEnquiryBlock || "No direct ready catalog match; standard custom fabrication & machine range"}`,
          },
        ],
      });

      lastUsage = aiCall.usage;
      if (aiCall.ok && aiCall.text) {
        const parsed = parseClaudeJson<any>(aiCall.text);
        if (parsed && parsed.smartReplyText) {
          const cleanEmailText = sanitizePlainEnglish(
            String(parsed.smartReplyText)
          ).replace(/\*/g, "");
          const cleanWaText = formatWhatsAppOutboundText(
            String(parsed.whatsappSummaryText || parsed.smartReplyText)
          );

          steps.push({
            stepNumber: 3,
            label: "Evaluated enquiry with Claude Haiku 5.5 (effort=medium)",
            detail: `HTTP ${aiCall.statusCode} in ${aiCall.durationMs}ms -> category="${parsed.smartCategory || smartCategory}"`,
            durationMs: Date.now() - started,
            status: "OK",
          });

          recordAndBroadcastAiLog({
            website: logWebsite,
            websiteLabel: logWebsiteLabel,
            feature: "Website Form Enquiry AI Evaluator",
            actor: `${params.customerName}${params.customerPhone ? ` (${params.customerPhone})` : ""}`,
            question: params.productName
              ? `[Product: ${params.productName}] ${params.message}`
              : params.message,
            model: LOCKED_CLAUDE_MODEL,
            effort: "medium",
            outcomeSource: "LIVE_AI",
            responseCacheStatus: "BYPASS",
            catalogCacheStatus: cacheMeta.catalogCacheStatus,
            cacheDetails: cacheMeta.cacheSummary,
            productLookupTriggered: true,
            productLookupQuery: combinedQuery,
            productLookupTotalScanned: allItems.length,
            productsLookedUp: matches.map(mapProductToLogItem),
            steps,
            response: cleanWaText,
            durationMs: Date.now() - started,
            tokenUsage: aiCall.usage,
          });

          return {
            smartReplyText: cleanEmailText,
            whatsappSummaryText: cleanWaText,
            smartCategory: parsed.smartCategory || smartCategory,
            priority: parsed.priority || priority,
            recommendedTeamId: "team_sales",
            matchedItems,
          };
        }
        lastAiError = "Claude website enquiry JSON parse failed.";
      } else {
        lastAiError = aiCall.error || "Anthropic enquiry evaluation failed.";
      }
    } catch (err: any) {
      lastAiError = err?.message || "Enquiry AI exception";
    }
  } else {
    lastAiError = "Anthropic API key not configured.";
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

  steps.push({
    stepNumber: steps.length + 1,
    label: "Generated deterministic website enquiry reply",
    detail: lastAiError || "Fallback used",
    durationMs: Date.now() - started,
    status: "WARN",
  });

  recordAndBroadcastAiLog({
    website: logWebsite,
    websiteLabel: logWebsiteLabel,
    feature: "Website Form Enquiry AI Evaluator",
    actor: `${params.customerName}${params.customerPhone ? ` (${params.customerPhone})` : ""}`,
    question: params.productName
      ? `[Product: ${params.productName}] ${params.message}`
      : params.message,
    model: `${LOCKED_CLAUDE_MODEL} -> local-fallback`,
    effort: "medium",
    outcomeSource: "LOCAL_FALLBACK",
    responseCacheStatus: "BYPASS",
    catalogCacheStatus: cacheMeta.catalogCacheStatus,
    cacheDetails: cacheMeta.cacheSummary,
    productLookupTriggered: true,
    productLookupQuery: combinedQuery,
    productLookupTotalScanned: allItems.length,
    productsLookedUp: matches.map(mapProductToLogItem),
    steps,
    response: fallbackWa,
    durationMs: Date.now() - started,
    tokenUsage: lastUsage,
    error: lastAiError,
  });

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
    if (mainDbPath && fs.existsSync(/*turbopackIgnore: true*/ mainDbPath)) {
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
