import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import nodemailer from "nodemailer";
import {
  appendAiTraceLog,
  buildCompleteEcosystemDatabaseDirectory,
  buildEcosystemDeepProductContextAndAnswer,
  buildMultiItemProjectPlan,
  cleanDisplayProductName,
  extractCompactDimensionPairsFromText,
  extractExplicitProductOrModelCodes,
  loadLiveDatabaseOperationalContext,
  ensureDatabasesBootstrapped,
  extractBudgetConstraintsFromQuery,
  findMatchingAiTrainingGuidance,
  getEcosystemBudgetFallbackInfo,
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
  type EcosystemSearchOptions,
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
    const sliced = tryParse(unfenced.slice(s, e + 1));
    if (sliced !== null) return sliced;
  }

  // Salvage: Claude often leaves inch marks (22" x 16") unescaped inside "customerReply", which breaks JSON.parse.
  // Pull the fields out manually so we NEVER fall back to the bulky deterministic dump for a valid answer.
  const replyKey = unfenced.match(/"customerReply"\s*:\s*"/);
  if (replyKey && replyKey.index !== undefined) {
    const start = replyKey.index + replyKey[0].length;
    const tail = unfenced.slice(start);
    const endMatch = tail.match(/"\s*\n?\s*\}\s*$/);
    const rawReply = endMatch && endMatch.index !== undefined ? tail.slice(0, endMatch.index) : tail.replace(/"?\s*\}?\s*$/, "");
    const customerReply = rawReply
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, " ")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .trim();
    if (customerReply) {
      const boolOf = (key: string) =>
        new RegExp(`"${key}"\\s*:\\s*true`, "i").test(unfenced.slice(0, replyKey.index));
      const strOf = (key: string) =>
        unfenced.slice(0, replyKey.index).match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`))?.[1] || "";
      return {
        needsHumanHandoff: boolOf("needsHumanHandoff"),
        handoffReason: strOf("handoffReason"),
        needsSalesTeamPing: boolOf("needsSalesTeamPing"),
        salesTeamPingNote: strOf("salesTeamPingNote"),
        smartCategory: strOf("smartCategory"),
        priority: strOf("priority"),
        customerReply,
      } as unknown as T;
    }
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

  const sendPayload = async (
    includeLegacyTemp: boolean,
    overrideDisableThinking = false
  ) => {
    const requestedMax = params.maxTokens ?? 4096;
    const bodyObj: Record<string, unknown> = {
      model: LOCKED_CLAUDE_MODEL,
      max_tokens: overrideDisableThinking
        ? Math.min(requestedMax, 2048)
        : Math.max(requestedMax, 4096),
      system: [
        {
          type: "text",
          text: params.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: params.messages,
    };
    if (overrideDisableThinking) {
      // Fast non-thinking fallback so thinking token budget never truncates JSON output
    } else if (includeLegacyTemp && typeof params.temperature === "number") {
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
      signal: AbortSignal.timeout(params.timeoutMs ?? 26000),
    });
  };

  try {
    const useTempFirst = typeof params.temperature === "number";
    let res = await sendPayload(useTempFirst, false);
    let json: any = await res.json().catch(() => null);

    // claude-haiku-5-5 deprecates `temperature` in favor of adaptive thinking + effort
    if (
      !res.ok &&
      useTempFirst &&
      res.status === 400 &&
      /temperature/i.test(String(json?.error?.message || ""))
    ) {
      res = await sendPayload(false, false);
      json = await res.json().catch(() => null);
    }

    // If adaptive thinking fails or hits stop_reason max_tokens with empty/truncated text, retry once without thinking
    const extractTextFromJson = (payload: any): string => {
      const blks: any[] = Array.isArray(payload?.content) ? payload.content : [];
      const tBlocks = blks
        .filter((b) => b?.type === "text" && typeof b?.text === "string")
        .map((b) => String(b.text));
      return tBlocks.length > 0
        ? tBlocks.join("\n").trim()
        : typeof payload?.content?.[0]?.text === "string"
        ? payload.content[0].text.trim()
        : "";
    };

    let extracted = res.ok ? extractTextFromJson(json) : "";
    if (
      !res.ok ||
      !extracted ||
      json?.stop_reason === "max_tokens" ||
      (extracted.includes("{") && !extracted.trim().endsWith("}"))
    ) {
      const retryRes = await sendPayload(false, true).catch(() => null);
      if (retryRes && retryRes.ok) {
        const retryJson = await retryRes.json().catch(() => null);
        const retryText = extractTextFromJson(retryJson);
        if (retryText) {
          res = retryRes;
          json = retryJson;
          extracted = retryText;
        }
      }
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
    .replace(/(?:\+?91[\s-]*)?73372[\s-]*22876\s*[/,]\s*(?:\+?91[\s-]*)?93467[\s-]*63253/g, "+91 79016 50662")
    .replace(/(?:\+?91[\s-]*)?93467[\s-]*63253/g, "+91 79016 50662")
    .replace(/111\/1\s*,?\s*Sakina\s*Manzil\s*,?\s*R\.?T\.?C\s*Colony\s*,?\s*Tirumalgherry/gi, "1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal")
    .replace(/(?:\+?91[\s-]*)?98480[\s-]*2210[123]/g, "+91 79016 50662")
    .replace(/(?:\+?91[\s-]*)?98480[\s-]*55110/g, "+91 79016 50662")
    .replace(/(?:ananya\.deshmukh|rohan\.kulkarni|priya\.menon|karthik\.nair)@classiconcepts\.in/gi, "sales@classicconcepts.in")
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

export type AcrioInteractive =
  | {
      kind: "buttons";
      buttons: { id: string; title: string }[];
      /** Short question shown with the buttons when the main reply is too long to share one message. */
      promptText?: string;
      footer?: string;
    }
  | {
      kind: "list";
      buttonLabel: string;
      rows: { id: string; title: string; description?: string }[];
      sectionTitle?: string;
      promptText?: string;
      footer?: string;
    };

const clip = (s: string, n: number) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, Math.max(1, n - 1)).trimEnd()}…`;
};

/** Text version of interactive options, used when Meta rejects the interactive payload or in the inbox view. */
export function describeInteractiveAsText(interactive: AcrioInteractive): string {
  if (interactive.kind === "buttons") {
    return interactive.buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
  }
  return interactive.rows.map((r, i) => `${i + 1}. ${r.title}${r.description ? ` (${r.description})` : ""}`).join("\n");
}

function buildMetaInteractivePayload(
  interactive: AcrioInteractive,
  bodyText: string
): Record<string, unknown> {
  const trimmedBody = String(bodyText || "").trim();
  const body = {
    text:
      trimmedBody.length > 1024
        ? `${trimmedBody.slice(0, 1020).trimEnd()}…`
        : trimmedBody || "Please choose an option",
  };
  const footer = interactive.footer ? { footer: { text: clip(interactive.footer, 60) } } : {};
  if (interactive.kind === "buttons") {
    return {
      type: "button",
      body,
      ...footer,
      action: {
        buttons: interactive.buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id.slice(0, 256), title: clip(b.title, 20) },
        })),
      },
    };
  }
  return {
    type: "list",
    body,
    ...footer,
    action: {
      button: clip(interactive.buttonLabel || "View options", 20),
      sections: [
        {
          title: clip(interactive.sectionTitle || "Options", 24),
          rows: interactive.rows.slice(0, 10).map((r) => ({
            id: r.id.slice(0, 200),
            title: clip(r.title, 24),
            ...(r.description ? { description: clip(r.description, 72) } : {}),
          })),
        },
      ],
    },
  };
}

export type WhatsAppMediaAttachmentType =
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT"
  | "AUDIO";

export interface OutboundWhatsAppMediaSpec {
  type: WhatsAppMediaAttachmentType;
  url?: string;
  waMediaId?: string;
  caption?: string;
  fileName?: string;
  mimeType?: string;
}

/**
 * Uploads a binary file (image, video, PDF, or document) to Meta's WhatsApp Cloud API
 * `/v21.0/{phoneNumberId}/media` endpoint so it can be delivered via `id` even when
 * the local server is not publicly reachable.
 */
export async function uploadMediaToMetaCloud(params: {
  buffer: Buffer | Uint8Array;
  mimeType: string;
  fileName: string;
  forceSandbox?: boolean;
}): Promise<{ ok: boolean; waMediaId?: string; mode: string; error?: string }> {
  const cfg = await loadMetaWhatsAppSetupConfig();
  const useSandbox =
    Boolean(params.forceSandbox) ||
    process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS === "1";
  const mode = useSandbox
    ? "SANDBOX_SIMULATOR"
    : String(cfg.mode || "SANDBOX_SIMULATOR");
  const phoneNumberId = String(cfg.phoneNumberId || "").trim();
  const accessToken = String(cfg.systemUserAccessToken || "").trim();

  if (mode !== "LIVE_META_CLOUD" || !phoneNumberId || !accessToken) {
    return {
      ok: true,
      waMediaId: `sim_media_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
      mode: "SANDBOX_SIMULATOR",
    };
  }

  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", params.mimeType || "application/octet-stream");
    const blob = new Blob([new Uint8Array(params.buffer)], {
      type: params.mimeType || "application/octet-stream",
    });
    form.append("file", blob, params.fileName || "attachment");

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/media`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
        signal: AbortSignal.timeout(30000),
      }
    );
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data?.id) {
      return {
        ok: false,
        mode: "LIVE_META_CLOUD",
        error: data?.error?.message || `Meta media upload HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      waMediaId: String(data.id),
      mode: "LIVE_META_CLOUD",
    };
  } catch (err: any) {
    return {
      ok: false,
      mode: "LIVE_META_CLOUD",
      error: err?.message || "Meta media upload network error",
    };
  }
}

export async function sendWhatsAppCloudMessage(params: {
  toPhone: string;
  bodyText: string;
  templateName?: string;
  languageCode?: string;
  templateComponents?: Record<string, unknown>[];
  replyToWaMessageId?: string;
  interactive?: AcrioInteractive;
  image?: {
    url: string;
    caption?: string;
  };
  media?: OutboundWhatsAppMediaSpec;
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

      const resolvedMediaSpec: OutboundWhatsAppMediaSpec | null = params.media
        ? params.media
        : params.image?.url
        ? {
            type: "IMAGE",
            url: params.image.url,
            caption: params.image.caption,
          }
        : null;
      const mediaUrl = String(resolvedMediaSpec?.url || "").trim();
      const rawWaMediaId = String(resolvedMediaSpec?.waMediaId || "").trim();
      const validWaMediaId =
        rawWaMediaId &&
        !rawWaMediaId.startsWith("sim_") &&
        !rawWaMediaId.startsWith("local_")
          ? rawWaMediaId
          : "";
      const hasPublicMediaUrl = /^https?:\/\//i.test(mediaUrl) && !/localhost|127\.0\.0\.1/i.test(mediaUrl);
      const hasMediaPayload =
        !params.templateName &&
        !params.interactive &&
        Boolean(resolvedMediaSpec && (validWaMediaId || hasPublicMediaUrl));
      const mediaKind = String(resolvedMediaSpec?.type || "IMAGE").toLowerCase() as
        | "image"
        | "video"
        | "document"
        | "audio";
      const mediaCaption = resolvedMediaSpec?.caption
        ? formatWhatsAppOutboundText(resolvedMediaSpec.caption)
        : formattedBody;
      const mediaRefObj: Record<string, unknown> = validWaMediaId
        ? { id: validWaMediaId }
        : { link: mediaUrl };
      if (mediaKind !== "audio" && mediaCaption) {
        mediaRefObj.caption = mediaCaption.slice(0, 1024);
      }
      if (mediaKind === "document" && resolvedMediaSpec?.fileName) {
        mediaRefObj.filename = resolvedMediaSpec.fileName.slice(0, 240);
      }

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
        : hasMediaPayload
        ? {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientDigits,
            ...contextField,
            type: mediaKind,
            [mediaKind]: mediaRefObj,
          }
        : params.interactive && !params.templateName
        ? {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientDigits,
            ...contextField,
            type: "interactive",
            interactive: buildMetaInteractivePayload(params.interactive, formattedBody),
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
      if (!res.ok && hasMediaPayload && res.status === 400) {
        const fallbackBody =
          mediaCaption && mediaUrl
            ? `${mediaCaption}\n${mediaUrl}`
            : mediaCaption || mediaUrl || formattedBody;
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
      // If Meta rejects a buttons/list payload (for example, a title rule), fall back to a plain text version.
      if (!res.ok && params.interactive && !params.templateName && res.status === 400) {
        console.warn(
          `[WA] Interactive send rejected (${data?.error?.code || ""}): ${data?.error?.message || ""}. Falling back to text.`
        );
        const textFallback = `${formattedBody}\n\n${describeInteractiveAsText(params.interactive)}\n\nReply with the option you prefer.`;
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
              text: { preview_url: true, body: textFallback },
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
      "ecosystem:cc-products:v9",
      ["cc-products"],
      3600,
      () => loadAllClassicConceptsProducts()
    ),
    rememberWhatsAppCacheWithMeta(
      "ecosystem:ce53-items:v9",
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
  excludeConsumables?: boolean;
  hasStrictBudget?: boolean;
  hidePrices?: boolean;
  maxItems?: number;
}): string {
  const {
    matchedItems,
    smartCategory,
    excludeConsumables,
    hasStrictBudget,
    hidePrices = false,
    maxItems = 3,
  } = params;
  if (matchedItems.length === 0) return "";

  const usedKeys = new Set<string>();
  const keyOf = (it: MainWebsiteProduct) => `${it.brand}:${it.slug || it.id}`;

  const uniqueMatches: MainWebsiteProduct[] = [];
  for (const item of matchedItems) {
    if (excludeConsumables && item.itemType === "CONSUMABLE") continue;
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
      ? "Acrylic Awards & Corporate Gifts"
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
      .slice(0, maxItems);
    secondaryGroup = excludeConsumables
      ? []
      : uniqueMatches
          .filter((it) => it.itemType === "CONSUMABLE")
          .slice(0, 2);
    if (primaryGroup.length === 0) {
      primaryGroup = uniqueMatches.slice(0, maxItems);
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
      primaryGroup = pricedReady.slice(0, maxItems);
      secondaryGroup = hasStrictBudget || primaryGroup.length >= maxItems ? [] : customQuoteOnly.slice(0, 2);
    } else {
      primaryGroup = uniqueMatches.slice(0, maxItems);
      secondaryGroup = [];
    }
  }

  const formatLine = (it: MainWebsiteProduct, idx: number) => {
    const cleanTitle = cleanDisplayProductName(it.name);
    const hasMrp = it.regularPrice && it.basePrice && it.regularPrice > it.basePrice;
    const priceTag = hidePrices
      ? ""
      : typeof it.basePrice === "number" && it.basePrice > 0
      ? ` (₹${it.basePrice.toLocaleString("en-IN")}${hasMrp ? `, MRP ₹${it.regularPrice!.toLocaleString("en-IN")}` : ""})`
      : " (Custom Quote)";
    const heightDim = (it.dimensions || []).find((d) => /height/i.test(d.label || d.key || ""));
    const topDim = (it.dimensions || []).find((d) => /top\s*sheet|reading\s*top|top\s*surface|size/i.test(d.label || d.key || ""));
    const gistDims: string[] = [];
    if (heightDim) gistDims.push(`Height: ${heightDim.value}`);
    if (topDim && topDim !== heightDim) gistDims.push(`Top: ${topDim.value}`);
    if (gistDims.length === 0 && it.dimensions && it.dimensions.length > 0) {
      for (const d of it.dimensions.slice(0, 2)) {
        gistDims.push(`${d.label || d.key}: ${d.value}`);
      }
    }
    const dimTag = gistDims.length > 0 ? `\n   ${gistDims.join(" | ")}` : "";
    const link = it.shortUrl || it.url;
    return `${idx + 1}. *${cleanTitle}*${priceTag}${dimTag}\n   ${link}`;
  };

  const blocks: string[] = [
    `*${primaryLabel}:*\n${primaryGroup.map(formatLine).join("\n")}`,
  ];

  if (secondaryGroup.length > 0) {
    blocks.push(
      `*${secondaryLabel}:*\n${secondaryGroup.map(formatLine).join("\n")}`
    );
  }

  return blocks.join("\n\n");
}

export async function syncEcosystemRedisCache(options?: {
  brand?: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | "ALL";
}): Promise<{
  invalidatedBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | "ALL";
  classicConceptsCount: number;
  classicEdgeMachinesCount: number;
  classicEdgeConsumablesCount: number;
  autoShortLinksCount: number;
  syncedAt: string;
}> {
  const brand =
    options?.brand === "CLASSIC_CONCEPTS" || options?.brand === "CLASSIC_EDGE_53"
      ? options.brand
      : "ALL";

  const tagsToInvalidate: (
    | "cc-products"
    | "ce53-machines"
    | "customer-history"
    | "acrio-replies"
  )[] =
    brand === "CLASSIC_CONCEPTS"
      ? ["cc-products", "acrio-replies"]
      : brand === "CLASSIC_EDGE_53"
      ? ["ce53-machines", "acrio-replies"]
      : ["cc-products", "ce53-machines", "acrio-replies"];

  await invalidateWhatsAppCacheTags(tagsToInvalidate);
  const { classicConceptsProducts, classicEdgeItems, allItems } = await getCachedEcosystemCatalog();
  return {
    invalidatedBrand: brand,
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
  | "LEADERSHIP_CONTACT_INFO"
  | "CHAT_HISTORY_META"
  | "MENU_SELECTION"
  | "CATEGORY_OVERVIEW"
  | "MULTI_ITEM_PROJECT"
  | "CONVERSATIONAL_FOLLOWUP"
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

export interface AcrioCustomerProfileInfo {
  customerProfile: "SIMPLE_LAYMAN" | "STUDENT_EXPLORER" | "EVERYDAY_BUYER" | "BUSINESS_INSTITUTIONAL" | "TECHNICAL_GRADUATE";
  languageMode: "ENGLISH" | "HINDI_HINGLISH" | "OTHER_FALLBACK";
  instructionNote: string;
}

/**
 * Adaptive Customer Persona & Language Detector (Decision #1 + Universal Buyer Support):
 * - Primary languages: English and Hindi/Hinglish. Uses another regional language ONLY if the customer writes in that script or clearly does not understand English/Hindi.
 * - Adapts tone from simple layman/broken-English buyers ("they sit, do your hand Acrylic chair", "interiora") to students, corporate/institutional buyers, and technical graduates.
 */
export function detectAcrioCustomerProfile(
  rawText: string,
  recentInboundText = ""
): AcrioCustomerProfileInfo {
  const combined = `${recentInboundText} ${rawText}`.trim();
  const lower = combined.toLowerCase();

  // Language detection: Devanagari or Romanized Hindi/Hinglish vs non-Hindi regional scripts
  const hasDevanagari = /[\u0900-\u097F]/.test(rawText);
  const hasOtherIndianScript = /[\u0980-\u0DFF]/.test(rawText);
  const hasHinglishTokens =
    /\b(kya|hai|hain|chahiye|kitna|kitne|ka\s+hai|milega|batao|bataiye|dikhao|sasta|mehenga|aur\s+dikhao|humko|mujhe|dukaan|bhaiya|rate\s+kya|kaisa)\b/i.test(
      rawText
    );

  const languageMode: AcrioCustomerProfileInfo["languageMode"] = hasOtherIndianScript
    ? "OTHER_FALLBACK"
    : hasDevanagari || hasHinglishTokens
    ? "HINDI_HINGLISH"
    : "ENGLISH";

  // Persona detection
  const isStudent = /\b(i\s+am\s+a\s+student|for\s+my\s+college\s+project|school\s+project|just\s+learning|student\s+here)\b/i.test(lower);
  const isBusinessInstitutional =
    /\b(renovation|office|corporate\s*clients?|bulk|gst|invoice|quotation|proforma|company|hospital|hotel|church|school|college|university|auditorium|\d+\s*(?:podiums?|signages?|chairs?|tables?|trophies))\b/i.test(
      lower
    );
  const isTechnical =
    /\b(ccp\d{2,4}|yn[-_\s]?jw|abm[-_\s]?\d|ce53|\d+\s*[x×]\s*\d+|mm\b|thickness|cast\s*acrylic|extruded|rpm|wattage)\b/i.test(
      lower
    );
  const isBrokenOrShortLayman =
    /\b(do\s+your\s+hand|interiora|they\s+sit)\b/i.test(lower) ||
    (rawText.split(/\s+/).length <= 5 && !isTechnical);

  const customerProfile: AcrioCustomerProfileInfo["customerProfile"] = isStudent
    ? "STUDENT_EXPLORER"
    : isBusinessInstitutional
    ? "BUSINESS_INSTITUTIONAL"
    : isTechnical
    ? "TECHNICAL_GRADUATE"
    : isBrokenOrShortLayman
    ? "SIMPLE_LAYMAN"
    : "EVERYDAY_BUYER";

  const langRule =
    languageMode === "HINDI_HINGLISH"
      ? "Reply in simple, natural Hindi/Hinglish (or clear English with Hindi terms) so the customer understands effortlessly."
      : languageMode === "OTHER_FALLBACK"
      ? "The customer does not appear comfortable in English or Hindi; reply in their language alongside simple English."
      : "Reply in clear, simple everyday English (never use other languages unless the customer asks or does not understand English/Hindi).";

  const personaRule =
    customerProfile === "SIMPLE_LAYMAN"
      ? "Customer writes in short or broken phrases: infer their real meaning charitably (e.g. 'they sit, do your hand Acrylic chair' = asking if we have Acrylic Chairs for sitting), use very simple words, and show 2-3 clear options."
      : customerProfile === "STUDENT_EXPLORER"
      ? "Customer is a student: be warm, helpful, and educational without pressuring them for a delivery city or bulk order."
      : customerProfile === "BUSINESS_INSTITUTIONAL"
      ? "Customer is a business/institutional buyer: provide structured itemized numbers, unit price × quantity totals, and practical组合/package options."
      : "Provide a concise, scannable gist with exact specs and prices.";

  return {
    customerProfile,
    languageMode,
    instructionNote: `${langRule} ${personaRule}`,
  };
}

const ACRIO_DOMAIN_PRODUCT_NOUN_RE =
  /\b(ccpo?[-_\s]?\d{2,4}[a-z]?|yn[-_\s]?jw\d{3,4}|abm[-_\s]?\d{3,4}|ce53[-_\s]?[a-z0-9-]+|cw[-_\s]?\d{3,5}|f[-_\s]?(?:308|500)|sd[-_\s]?\d{3,4}|jw[-_\s]?\d{3,4}|zd[-_\s]?\d{3,4}|d30|ce[-_\s]?(?:lc|cnc|fp|to)\d{2,4}|c[-\s]*podium|podium|podiums|pulpit|pulpits|lectern|lecterns|rostrum|rostrums|trophy|trophies|memento|mementos|award|awards|plaque|plaques|medal|medals|gift|gifts|gifting|corporate\s*gift|corporate\s*clients?|souvenir|souvenirs|paper\s*weight|paperweight|pen\s*stand|stand|stands|holder|holders|riser|risers|menu|qr|tent\s*card|brochure|leaflet|pamphlet|tray|trays|coaster|coasters|tissue|napkin|box|boxes|case|cases|cover|covers|enclosure|enclosures|guard|guards|display|displays|cabinet|cabinets|showcase|vitrine|frame|frames|easel|signage|signages|sign|signs|name\s*plate|name\s*plates|nameplate|nameplates|name\s*board|board|sheet|sheets|rod|rods|tube|tubes|pipe|pipes|ball|balls|sphere|turntable|rotating\s*disc|machine|machines|polisher|polishing|bender|bending|heater|laser|router|cnc|cutter|blade|consumable|consumables|carbide|collet|chiller|compressor|solvent|chloroform|glue|adhesive|buffing|flame|oven|thermoforming|accessor(?:y|ies)|add[-\s]?ons?|hinge|hinges|camlock|camlocks|standoff|standoffs|spacer|spacers|knob|knobs|handle|handles|latch|latches|catch|catches|hasp|staple|screw|screws|bolt|nut|washer|bracket|brackets|photo\s*magnet|radeon|glitter|mirror|metallic|keychain|keychains|keyring|bookmark|globe|hanger|organizer|organiser|dispenser|glove|mask|shoe|table|tables|stool|stools|chair|chairs|desk|desks|furniture|interior|interiors|interiora|decor|furnishing|seating|sit|sitting|donation|suggestion\s*box|ballot|cake\s*stand|cupcake|cosmetic|makeup|lipstick|jewelry|jewellery|watch\s*stand|eyewear|sunglass|mobile\s*stand|laptop\s*stand|book\s*stand|quran|rehal|bible|photo\s*frame|poster|wall\s*mount|keyway|lockable|custom\s*size|fabrication|acrylic|perspex|pmma|polycarbonate|lexan)\b/i;

const ACRIO_FOLLOW_UP_REFINEMENT_RE =
  /\b(under|below|above|over|between|within|around|budget|price|cost|rate|mrp|how\s*much|kitna|kitne|cheaper|cheapest|lowest\s*price|costliest|most\s*expensive|smaller\s*top|save\s*more|lower\s*price|higher\s*budget|increase\s*(?:the\s*)?budget|raise\s*(?:the\s*)?budget|stretch\s*(?:the\s*)?budget|extend\s*(?:the\s*)?budget|without\s*(?:mentioning\s*)?prices?|no\s*prices?|hide\s*prices?|premium|most\s*premium|high\s*end|flagship|best\s*one|best\s*ones|first\s*two|top\s*two|both\s*of\s*them|all\s*(?:three|two|four|five|of\s*them)|rs\.?|inr|₹|\d+\s*(?:k|lac|lacs|lakh|lakhs|cr|crore)\b|\d{4,7}\b|\d+\s*(?:pcs?|pieces?|nos?|units?|qty|quantity|sets?)\b|single\s*piece|just\s*one|transparent|clear|frost|frosted|black|white|gold|golden|silver|stainless|colored|coloured|color|colors|colour|colours|variant|variants|finish|finishes|imag[a-z]*|phot[a-z]*|phto[a-z]*|pics?|pictures?|snaps?|visuals?|videos?|pdf|brochure|catalogue|catalog|dikha[a-z]*|photo\s*bhejo|bhejo\s*photo|close[-\s]*up|how\s+does\s+(?:it|this|that)\s+look|look\s+like|dimension|dimensions|size|sizes|height|width|depth|reading\s*top|top\s*sheet|bottom\s*sheet|front\s*panel|shelf\s*size|logo\s*panel|spec|specs|specification|specifications|feature|features|details?|pillar|pillars|warranty|wheel|wheels|weight|assembly|diy|thick|thickness|available|availability|in\s*stock|stock|delivery|shipping|dispatch|gst|tax|invoice|how\s+to\s+(?:order|buy|book)|order\s+this|buy\s+this|book\s+this|i\s+want\s+this|this\s+one|that\s+one|same\s+one|\d+\s*(?:mm|cm|inch|inches|in|ft)\b|bigger|biggest|larger|largest|smaller|wider|widest|taller|tallest|compact|portable|foldable|wheeled|castor|led|light|backlit|logo|branding|print|engraving|uv\s*print|without\s*logo|no\s*logo|with\s*logo|show\s*more|more\s*options|any\s*more|other\s*options|any\s*other|another\s*model|different\s*size|different\s*model|which\s*one|which\s*of\s*these|alternative|alternatives)\b/i;

const ACRIO_SHORT_CITY_OR_REPLY_RE =
  /\b(hyderabad|secunderabad|mumbai|bangalore|bengaluru|delhi|new\s*delhi|noida|gurgaon|gurugram|chennai|pune|kolkata|ahmedabad|surat|vadodara|jaipur|lucknow|kanpur|nagpur|indore|bhopal|visakhapatnam|vizag|vijayawada|guntur|warangal|tirupati|coimbatore|madurai|kochi|ernakulam|trivandrum|patna|ranchi|bhubaneswar|guwahati|chandigarh|ludhiana|amritsar|dehradun|raipur|mysore|mangalore|hubli|belgaum|nashik|aurangabad|thane|navi\s*mumbai|faridabad|ghaziabad|\d{6})\b/i;

/**
 * Deterministic Turn-Level Intent Classifier (Phase A).
 * Runs BEFORE any catalog fetch or product lookup so non-product turns
 * never trigger unnecessary product retrieval or leak prior-turn products,
 * while NEVER wiping conversation history on numbered replies ("1") or follow-ups!
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

  // 1. Leadership / Chairperson / Marketing / Department-wise staff contact lookup (Decision #7)
  if (
    /\b(chairperson|chairman|chairwoman|director|directors|founder|ceo|owner|proprietor|managing\s*director|president|marketing\s*(?:head|person|team|manager|contact|department|number|email|executive)|sales\s*(?:head|manager|person|contact|number|email|department)|department\s*(?:wise|contact|contacts|head|heads|people|number|numbers|email|emails|list)|contact\s*(?:person|details|number|email)\s*(?:for|of)\s*(?:marketing|sales|machines|dispatch|fabrication|management|chairperson|director)|who\s+(?:is|are)\s+(?:the|your)\s+(?:chairperson|chairman|director|founder|ceo|owner|marketing\s*head|sales\s*head|department\s*heads?))\b/i.test(
      lower
    )
  ) {
    return {
      intent: "LEADERSHIP_CONTACT_INFO",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer asked for chairperson, leadership, marketing, or department-wise contact details",
    };
  }

  // 2. Informational question about human handoff ("Whom will you connect me to?", "Who handles custom quotes?")
  if (
    /\b(?:who|whom|which\s*(?:team|person|department|member|specialist)|what\s*(?:team|department))\s+(?:will|would|do|can|are)\s+you\s+(?:connect|transfer|assign|hand\s*over|forward)\b|\b(?:to\s+whom|with\s+whom)\s+(?:will|would|do|can)\s+you\s+connect\b|\b(?:who|whom)\s+(?:handles|takes\s*care\s*of|manages|looks\s*after|is\s+in|is\s+your)\s+(?:this|my\s*chat|custom|orders|sales|support|enquiries|inquiries|team|manager|executive)\b|\b(?:can\s+i\s+know|tell\s+me)\s+(?:who|whom)\s+(?:you\s+will\s+connect|i\s+will\s+(?:talk|speak)\s+(?:to|with))\b|\bhow\s+does\s+(?:the\s+)?(?:handoff|human\s*support|sales\s*team)\s+work\b/i.test(
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

  // 3. Explicit request to be connected to a human / sales person right now
  if (
    !/^(?:who|whom|which\s+team|what\s+team|how\s+does)\b/i.test(lower) &&
    /\b(talk\s*to\s*(?:a\s*|the\s*|your\s*)?(?:team|human|person|agent|staff|sales|someone|manager|executive)|speak\s*(?:to|with)\s*(?:a\s*|the\s*|your\s*)?(?:team|human|person|agent|staff|sales|someone|manager|executive)|connect\s*me(?:\s*(?:now|right\s*away|please)|\s*(?:to|with)\s*(?:a\s*|the\s*|your\s*)?(?:team|human|person|agent|staff|sales|someone|manager|executive))?|yes\s*,?\s*(?:please\s*)?connect\s*me|human\s*agent|real\s*person|call\s*me|can\s+someone\s+call|please\s*call|need\s*a\s*call|want\s*a\s*call|transfer\s*(?:me|chat)\s*to\s*(?:human|sales|team)|assign\s*(?:to\s*)?(?:human|sales|team))\b/i.test(
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

  // 4. Support / complaint / damaged delivery / refund / CAD file
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

  // 5. Specific order status / tracking lookup
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

  // 6. Chat history / Meta / Feedback / Student declaration ("Tell me about my chat history with you", "You lost the context again", "Why do you keep asking the same city question", "I am a student")
  if (
    /\b(chat\s*history|my\s*history|our\s*chat|what\s+did\s+i\s+(?:ask|say)|what\s+have\s+we\s+discussed|summary\s+of\s+(?:our|my)\s+(?:chat|conversation)|you\s+lost\s+(?:the\s*)?context|lost\s+context|forgot\s+(?:the\s*)?context|keep\s+asking\s+(?:the\s*)?same|same\s+city\s+question|asking\s+the\s+same\s+question|excellent\s+reply\s+fool|you\s+are\s+a\s+fool|bad\s+reply|useless\s+bot|i\s+am\s+a\s+student|i'm\s+a\s+student)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "CHAT_HISTORY_META",
      requiresProductLookup: false,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer asked about conversation history, context continuity, repeated questions, or shared persona context",
    };
  }

  // 7. Numbered menu / option selection ("1", "2", "Option 1", "the first one")
  if (
    hasConversationHistory &&
    (/^[\s*#]*(?:option\s*|category\s*|number\s*|no\.?\s*)?([1-5])[\s.)*]*$/i.test(trimmed) ||
      /^(?:the\s+)?(first|second|third|fourth|1st|2nd|3rd|4th)\s*(?:one|option|category|model)?[\s.!]*$/i.test(
        trimmed
      ))
  ) {
    return {
      intent: "MENU_SELECTION",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer selected a numbered menu/category/product option from the previous turn",
    };
  }

  // 8. Category / Sub-category overview ("What all categories do you have under the podiums category?")
  if (
    /\b(what\s+(?:all\s+)?(?:sub[-\s]*)?categories|which\s+(?:sub[-\s]*)?categories|all\s+categories\s+under|categories\s+(?:under|in|of)\s+(?:the\s+)?podiums?|types\s+of\s+podiums?\s+categories|podium\s+sub[-\s]*categories)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "CATEGORY_OVERVIEW",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer asked for the sub-categories/types under a product category",
    };
  }

  // 9. Multi-item project or bulk quantity + budget totalling ("3 Acrylic podiums, 10 signages ... and 10 chairs ... budget 1 lac")
  const qtyMatches = lower.match(/\b\d{1,3}\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:podiums?|pulpits?|lecterns?|signages?|signs?|name\s*plates?|nameplates?|chairs?|stools?|tables?|trophies|awards?|stands?)\b/gi);
  if (
    (qtyMatches && qtyMatches.length >= 2) ||
    (/\b(renovation|office\s+project|complete\s+package|total\s+cost|total\s+price)\b/i.test(lower) &&
      Boolean(qtyMatches && qtyMatches.length >= 1))
  ) {
    return {
      intent: "MULTI_ITEM_PROJECT",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer requested multi-item quantities or project budget totalling",
    };
  }

  // 10. Explicit Topic Reset / switching query ("I have a different query", "Forget that, let's start over")
  if (
    !hasDomainProductNoun &&
    /\b(different\s*(?:query|question|requirement|topic|thing|enquiry|inquiry)|another\s*(?:query|question|requirement|topic|enquiry|inquiry)|something\s*else|forget\s*(?:that|it|previous|the\s*last)|start\s*over|start\s*afresh|change\s*(?:of\s*)?(?:topic|subject)|leave\s*(?:that|it)|never\s*mind(?:\s*(?:that|it))?|new\s*(?:query|question|topic|requirement|enquiry|inquiry))\b/i.test(
      lower
    )
  ) {
    return {
      intent: "TOPIC_RESET",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer explicitly signalled a topic reset or new unspecified query",
    };
  }

  // 11. Identity / AI / Bot capability questions ("Who are you?", "What can you help me with?", "Are you a bot?")
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

  // 12. Company / Factory / Location / Brand info questions ("Where is your factory?", "What does Classic Concepts do?")
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

  // 13. Pure greeting / pleasantry / thanks
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

  // 14. Obvious off-topic queries with zero domain nouns
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

  // 15. Custom fabrication quote with explicit 3D dimensions or custom fabrication phrasing
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

  // 16. Product comparison
  if (
    /\b(compare|comparison|vs\.?|versus|difference\s+between|differ\s+between|which\s+(?:one|of\s+these|of\s+them|model|podium|pulpit|machine)\s+(?:is|has)\s+(?:better|wider|widest|larger|largest|bigger|biggest|taller|tallest|more))\b/i.test(
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

  // 17. Follow-up refinement (budget change, color/material/size filter, "show me more", "without mentioning prices", "cheaper alternative")
  if (!hasDomainProductNoun && ACRIO_FOLLOW_UP_REFINEMENT_RE.test(lower)) {
    return {
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer refined budget, size, finish, quantity, or pricing on prior product context",
    };
  }

  // 18. Direct product search or problem/use-case description (e.g. "pulpits under 25000", "furniture and interiora", "small classroom", "corporate clients")
  if (
    hasDomainProductNoun ||
    /\b(stage|auditorium|church|school|classroom|college|university|conference|seminar|hotel|restaurant|cafe|banquet|hospital|clinic|retail|shop|showroom|exhibition|event|ceremony|convocation|wedding|office|reception|counter|cloudy|rough\s*edge|white\s*edge|bubble|crack|warping|scratch|yellow)\b/i.test(
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

  // 19. Short confirmation, city/quantity/preference answer, or quoted-message reply in active conversation
  if (
    hasConversationHistory &&
    (/\b(yes|yeah|yep|yup|no|nope|sure|ok|okay|fine|go\s*ahead|please\s*share|send\s*(?:links|details|options|photos|images|catalogue|catalog|quote)|show\s*(?:me|them|options|details)|tell\s*me(?:\s*more|\s*about\s*(?:this|it|that))?|what\s+about\s+(?:this|that|it)|is\s+(?:it|this)\s+available|can\s+(?:you|we)\s+(?:customize|customise|print|deliver|ship))\b/i.test(
      lower
    ) ||
      ACRIO_SHORT_CITY_OR_REPLY_RE.test(lower) ||
      /^\s*\d{1,3}\s*(?:pcs?|pieces?|nos?|units?|sets?)?\s*$/i.test(trimmed))
  ) {
    return {
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer sent a short confirmation, quantity, city, or follow-up reply in the active conversation",
    };
  }

  // 20. Preserve context on any other conversational turn instead of wiping convState!
  return {
    intent: hasConversationHistory ? "CONVERSATIONAL_FOLLOWUP" : "GREETING",
    requiresProductLookup: false,
    allowRollingContextFallback: hasConversationHistory,
    needsImmediateHandoff: false,
    reason: "Conversational follow-up or general turn; preserving conversation memory without dumping unrelated products",
  };
}

/**
 * Phase B: Structured Per-Conversation State Object (`AcrioConversationState`).
 */
export interface AcrioConversationState {
  activeBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | "BOTH" | null;
  activeCategory: string | null;
  productFamily: string | null;
  primaryProductQuery: string | null;
  itemTypeFilter: "PRODUCT" | "MACHINE" | "CONSUMABLE" | null;
  excludedItemTypes: ("PRODUCT" | "MACHINE" | "CONSUMABLE")[];
  minPrice: number | null;
  maxPrice: number | null;
  hidePrices?: boolean;
  preferCheapest?: boolean;
  preferences: string[];
  applicationContext: string | null;
  dimensionsOrThickness: string | null;
  quantity: string | null;
  shownProductSlugs?: string[];
  lastMenuOptions?: string[];
  /** Slug of the single product the customer is currently talking about ("this model", "it", "the white one"). */
  focusProductSlug?: string | null;
  /** Slugs shown in the last "View options" list, in order, so "the second one" still works after it. */
  lastListedSlugs?: string[];
  askedQuestionsLog?: string[];
  customerProfile?: string;
  languageMode?: string;
  lastRecommendedProducts: {
    id: string;
    name: string;
    slug: string;
    priceInr: number | null;
    shortUrl: string | null;
    itemType?: "PRODUCT" | "MACHINE" | "CONSUMABLE";
  }[];
  /** Chronological history of distinct products/topics discussed earlier in this chat (prevents A->B->C leaks while keeping comparison context). */
  productHistory?: {
    label: string;
    slug?: string | null;
    family?: string | null;
    turnNumber: number;
  }[];
  switchedThisTurn?: boolean;
  turnCount: number;
  updatedAt: string;
}

export function createEmptyAcrioConversationState(): AcrioConversationState {
  return {
    activeBrand: null,
    activeCategory: null,
    productFamily: null,
    primaryProductQuery: null,
    itemTypeFilter: null,
    excludedItemTypes: [],
    minPrice: null,
    maxPrice: null,
    hidePrices: false,
    preferCheapest: false,
    preferences: [],
    applicationContext: null,
    dimensionsOrThickness: null,
    quantity: null,
    shownProductSlugs: [],
    lastMenuOptions: [],
    askedQuestionsLog: [],
    customerProfile: "EVERYDAY_BUYER",
    languageMode: "ENGLISH",
    lastRecommendedProducts: [],
    productHistory: [],
    switchedThisTurn: false,
    turnCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

function detectProductFamilyAndQuery(rawText: string): {
  productFamily: string | null;
  primaryProductQuery: string | null;
  activeCategory: string | null;
  activeBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | null;
  itemTypeFilter: "PRODUCT" | "MACHINE" | "CONSUMABLE" | null;
  excludedItemTypes: ("PRODUCT" | "MACHINE" | "CONSUMABLE")[];
  isCorrectionOnly: boolean;
} {
  const lower = String(rawText || "").toLowerCase();

  const excludesConsumables =
    /\b(?:not\s+looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|exclude|excluding|skip)\s+(?:any\s+)?(?:tools?|consumables?|blades?|cutters?|solvents?|accessories)\b|\b(?:just|only)\s+machines?\b/i.test(
      lower
    );
  const excludesMachines =
    /\b(?:not\s+looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|exclude)\s+(?:any\s+)?machines?\b|\b(?:just|only)\s+(?:tools?|consumables?|blades?|cutters?)\b/i.test(
      lower
    );

  const strippedForCheck = lower
    .replace(
      /\b(actually|i\s+said|i\s+am|i'm|im|we\s+are|not\s+looking\s+for|looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|just|only|tools?|consumables?|machines?|please|show\s+me|need|want)\b/gi,
      " "
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const isCorrectionOnly =
    (excludesConsumables || excludesMachines) && strippedForCheck.length === 0;

  // Furniture / Interiors / Chairs / Tables / Stools ("furniture and interiora", "they sit, do your hand Acrylic chair")
  if (
    /\b(furniture|interior|interiors|interiora|decor|furnishing|chair|chairs|stool|stools|bar\s*stool|table|tables|desk|desks|console|bench|seating|they\s+sit|for\s+sitting)\b/i.test(
      lower
    ) &&
    !/\b(table\s*top\s*podium|table\s*stand|tent\s*card)\b/i.test(lower)
  ) {
    const wantsChairSpecifically = /\b(chair|chairs|stool|stools|seating|sit|sitting)\b/i.test(lower);
    return {
      productFamily: "furniture",
      primaryProductQuery: wantsChairSpecifically
        ? "acrylic chair bar stool furniture seating"
        : "acrylic furniture table chair stool console interior",
      activeCategory: "Custom Fabrication",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  // Signage / Name plates / Name boards
  if (
    /\b(signage|signages|name\s*plate|name\s*plates|nameplate|nameplates|name\s*board|door\s*sign|directional\s*sign)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "signage",
      primaryProductQuery: `${rawText.trim()} acrylic signage name plate sign holder`,
      activeCategory: "Custom Fabrication",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  // Corporate Gifts / Souvenirs / Paperweights / Pen Stands / Keychains
  if (
    /\b(gift|gifts|gifting|corporate\s*gift|corporate\s*clients?|souvenir|souvenirs|paper\s*weight|paperweight|pen\s*stand|keychain|keychains)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "corporate_gift",
      primaryProductQuery: `${rawText.trim()} acrylic memento trophy paperweight pen stand keychain coaster tray`,
      activeCategory: "Awards & Trophies",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  // Podiums / Pulpits / Lecterns / Classroom Podium
  if (
    /\b(pulpit|pulpits|podium|podiums|lectern|lecterns|rostrum|rostrums|ccpo?[-_\s]?\d{2,4}|small\s+classroom|classroom|auditorium|church)\b/i.test(
      lower
    )
  ) {
    const isClassroom = /\b(classroom|school|teacher|compact)\b/i.test(lower);
    return {
      productFamily: "podium",
      primaryProductQuery: isClassroom
        ? "compact essential acrylic podium CCP057S CCP054 classroom"
        : `${rawText.trim()} pulpit podium`,
      activeCategory: "Podiums & Stage",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (/\b(trophy|trophies|memento|mementos|award|awards|plaque|plaques|medal|medals)\b/i.test(lower)) {
    return {
      productFamily: "trophy",
      primaryProductQuery: `${rawText.trim()} acrylic trophy award memento`,
      activeCategory: "Awards & Trophies",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (
    /\b(diamond\s*(?:edge\s*)?polish(?:er|ing)?|edge\s*polish(?:er|ing)?|cloudy\s*edge|rough\s*edge|white\s*edge)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "polishing_machine",
      primaryProductQuery: `${rawText.trim()} diamond edge polishing machine`,
      activeCategory: "Acrylic Machines (CE53)",
      activeBrand: "CLASSIC_EDGE_53",
      itemTypeFilter: excludesMachines ? "CONSUMABLE" : "MACHINE",
      excludedItemTypes: excludesConsumables ? ["CONSUMABLE"] : [],
      isCorrectionOnly: false,
    };
  }

  if (/\b(bender|bending\s*(?:machine|heater)?|strip\s*heater|line\s*bending)\b/i.test(lower)) {
    return {
      productFamily: "bending_machine",
      primaryProductQuery: `${rawText.trim()} acrylic bending machine heater`,
      activeCategory: "Acrylic Machines (CE53)",
      activeBrand: "CLASSIC_EDGE_53",
      itemTypeFilter: excludesMachines ? "CONSUMABLE" : "MACHINE",
      excludedItemTypes: excludesConsumables ? ["CONSUMABLE"] : [],
      isCorrectionOnly: false,
    };
  }

  if (
    !excludesConsumables &&
    !/\b(machine|machines)\b/i.test(lower) &&
    /\b(blade|blades|cutter|cutters|router\s*bit|router\s*bits|carbide|collet|collect|consumable|consumables|solvent|chloroform|glue|adhesive|buffing|accessor(?:y|ies)|add[-\s]?ons?|hinge|hinges|camlock|camlocks|standoff|standoffs|spacer|spacers|knob|knobs|handle|handles|latch|latches|catch|catches|hasp|staple|screw|screws|bolt|nut|washer|bracket|brackets|ball|balls|sphere|turntable|rotating\s*disc|photo\s*magnet|radeon|glitter\s*sheet|mirror\s*sheet|metallic\s*sheet)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "consumable",
      primaryProductQuery: rawText.trim(),
      activeCategory: "Acrylic Machines (CE53)",
      activeBrand: "CLASSIC_EDGE_53",
      itemTypeFilter: "CONSUMABLE",
      excludedItemTypes: excludesMachines ? ["MACHINE"] : [],
      isCorrectionOnly: false,
    };
  }

  if (
    /\b(machine|machines|laser|router|cnc|polisher|polishing|thermoforming|oven|chiller|compressor|yn-|ce53|cw[-_\s]?\d{3,5}|f[-_\s]?(?:308|500)|sd[-_\s]?\d{3,4}|jw[-_\s]?\d{3,4}|zd[-_\s]?\d{3,4}|classic\s*edge)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "machine",
      primaryProductQuery: isCorrectionOnly ? null : rawText.trim(),
      activeCategory: "Acrylic Machines (CE53)",
      activeBrand: "CLASSIC_EDGE_53",
      itemTypeFilter: excludesMachines ? "CONSUMABLE" : "MACHINE",
      excludedItemTypes: excludesConsumables ? ["CONSUMABLE"] : [],
      isCorrectionOnly,
    };
  }

  if (/\b(menu|qr\s*stand|tent\s*card|table\s*stand|sign\s*holder|brochure|leaflet|pamphlet)\b/i.test(lower)) {
    return {
      productFamily: "stand",
      primaryProductQuery: rawText.trim(),
      activeCategory: "Hotel & Banquet",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (/\b(tray|trays|coaster|coasters|tissue|napkin)\b/i.test(lower)) {
    return {
      productFamily: "tray_hospitality",
      primaryProductQuery: rawText.trim(),
      activeCategory: "Hotel & Banquet",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (
    /\b(box|boxes|case|cases|cover|covers|enclosure|enclosures|guard|guards|display\s*stand|riser|risers|cabinet|showcase|frame|frames|sheet|rod|tube|donation|suggestion\s*box|ballot|cake\s*stand|cosmetic|makeup|jewelry|jewellery|watch\s*stand|eyewear|mobile\s*stand|laptop\s*stand|book\s*stand|quran|rehal|bible)\b/i.test(
      lower
    )
  ) {
    const nounMatch = lower.match(ACRIO_DOMAIN_PRODUCT_NOUN_RE);
    return {
      productFamily: nounMatch ? nounMatch[1].toLowerCase() : "custom_display",
      primaryProductQuery: rawText.trim(),
      activeCategory: "Custom Fabrication",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  return {
    productFamily: null,
    primaryProductQuery: null,
    activeCategory: null,
    activeBrand: null,
    itemTypeFilter: excludesConsumables ? "MACHINE" : excludesMachines ? "CONSUMABLE" : null,
    excludedItemTypes: excludesConsumables
      ? ["CONSUMABLE"]
      : excludesMachines
      ? ["MACHINE"]
      : [],
    isCorrectionOnly,
  };
}

function extractPreferencesFromTurn(rawText: string): string[] {
  const lower = String(rawText || "").toLowerCase();
  const prefs: string[] = [];
  if (/\b(most\s*premium|premium|high\s*end|flagship|top\s*end|best|luxury|heavy\s*duty|costliest|most\s*expensive)\b/i.test(lower)) {
    prefs.push("premium");
  }
  if (/\b(cheapest|lowest\s*price|least\s*expensive|cheaper|smaller\s*top|save\s*more|sasta|sabse\s*sasta)\b/i.test(lower)) {
    prefs.push("cheapest");
  }
  if (/\b(transparent|clear|crystal\s*clear|see\s*through)\b/i.test(lower)) {
    prefs.push("transparent");
  }
  if (/\b(frosted|matte|satin)\b/i.test(lower)) {
    prefs.push("frosted");
  }
  if (/\b(black|white|gold|silver|colored|coloured|tinted)\b/i.test(lower)) {
    const m = lower.match(/\b(black|white|gold|silver|colored|coloured|tinted)\b/i);
    if (m) prefs.push(m[1].toLowerCase());
  }
  if (/\b(led|light|backlit|illuminated)\b/i.test(lower)) {
    prefs.push("led");
  }
  if (/\b(logo|branding|print|engraving|uv\s*print)\b/i.test(lower)) {
    prefs.push("logo");
  }
  if (/\b(wheel|wheeled|castor|portable|foldable|compact|wide|tall)\b/i.test(lower)) {
    const m = lower.match(/\b(wheel|wheeled|castor|portable|foldable|compact|wide|tall)\b/i);
    if (m) prefs.push(m[1].toLowerCase());
  }
  return prefs;
}

function extractMetadataFromTurn(rawText: string): {
  applicationContext: string | null;
  dimensionsOrThickness: string | null;
  quantity: string | null;
} {
  const lower = String(rawText || "").toLowerCase();
  const appMatch = lower.match(
    /\b(church|school|classroom|college|university|auditorium|conference|seminar|hotel|restaurant|cafe|banquet|hospital|clinic|retail|showroom|exhibition|event|ceremony|convocation|wedding|office|reception)\b/i
  );
  const dimMatch =
    rawText.match(
      /\b(\d+\s*(?:mm|cm|inch|in|ft)?\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?(?:\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?)?)\b/i
    ) || rawText.match(/\b(\d+(?:\.\d+)?\s*(?:mm|cm|inch|in|ft))\b/i);
  const qtyMatch = rawText.match(/\b(\d+\s*(?:pcs|pieces|nos|units|sets|qty))\b/i);

  return {
    applicationContext: appMatch ? appMatch[1].toLowerCase() : null,
    dimensionsOrThickness: dimMatch ? dimMatch[1].trim() : null,
    quantity: qtyMatch ? qtyMatch[1].trim() : null,
  };
}

const ACRIO_COLOUR_WORDS = [
  "black", "white", "clear", "transparent", "gold", "golden", "silver", "blue", "yellow",
  "red", "green", "grey", "gray", "orange", "pink", "frost", "frosted", "wood", "wooden", "brown",
];

function normalizeColourToken(word: string): string {
  const w = word.toLowerCase().trim();
  if (w === "frost" || w === "frosted") return "frosted";
  if (w === "golden" || w === "gold") return "gold";
  if (w === "transparent" || w === "clear") return "clear";
  if (w === "wooden" || w === "wood") return "wood";
  if (w === "gray" || w === "grey") return "grey";
  return w;
}

/**
 * Extracts normalized colour/finish tokens from any text ("frost white" -> ["frosted", "white"],
 * "White Frosted" -> ["white", "frosted"]) so variant matching is 100% word-order independent!
 */
export function extractNormalizedColourTokens(text: string): string[] {
  const lower = String(text || "").toLowerCase();
  const found: string[] = [];
  for (const cw of ACRIO_COLOUR_WORDS) {
    if (new RegExp(`\\b${cw}\\b`, "i").test(lower)) {
      const norm = normalizeColourToken(cw);
      if (!found.includes(norm)) found.push(norm);
    }
  }
  return found;
}

/**
 * Word-order-independent variant matcher:
 * - For "frost white" / "frosted white" (tokens=["frosted","white"]), matches ONLY variants
 *   that contain BOTH "white" and "frosted" (e.g. "White Frosted"), and NEVER matches plain "White"!
 * - For single-token "black" (tokens=["black"]), prefers exact single-token variant "Black" over "Black Clear" / "Black Frosted".
 */
export function matchProductVariantsByColourTokens(
  variants: { id?: string; name: string; price: number | null; imageUrl?: string | null }[],
  queryText: string
): { id?: string; name: string; price: number | null; imageUrl?: string | null }[] {
  const queryTokens = extractNormalizedColourTokens(queryText);
  if (queryTokens.length === 0 || !variants || variants.length === 0) return [];

  // 1. Variants that contain EVERY requested colour/finish token (word-order independent!)
  const fullMatches = variants.filter((v) => {
    const vTokens = extractNormalizedColourTokens(v.name);
    return queryTokens.every((qt) => vTokens.includes(qt));
  });

  if (fullMatches.length === 0) return [];

  // 2. Prefer exact token-set match (e.g. if user asked for ["black"], prefer "Black" ["black"] over "Black Frosted" ["black","frosted"])
  const exactTokenCountMatches = fullMatches.filter(
    (v) => extractNormalizedColourTokens(v.name).length === queryTokens.length
  );
  return exactTokenCountMatches.length > 0 ? exactTokenCountMatches : fullMatches;
}

/**
 * Finds all products in the catalog (optionally filtered by family like "podium") that have a variant
 * matching ALL colour/finish tokens in `rawText` (e.g. "podiums with frost white color" -> CCP053, CCP060, CCP055).
 */
export function findCatalogProductsByVariantTokens(
  allItems: MainWebsiteProduct[],
  rawText: string,
  productFamily?: string | null
): { item: MainWebsiteProduct; matchedVariant: { name: string; price: number | null; imageUrl?: string | null } }[] {
  const queryTokens = extractNormalizedColourTokens(rawText);
  if (queryTokens.length === 0) return [];
  const lower = rawText.toLowerCase();
  const wantsPodium =
    productFamily === "podium" ||
    /\b(podiums?|pulpits?|lecterns?|rostrums?)\b/i.test(lower);

  const results: {
    item: MainWebsiteProduct;
    matchedVariant: { name: string; price: number | null; imageUrl?: string | null };
  }[] = [];

  for (const it of allItems) {
    if (it.brand !== "CLASSIC_CONCEPTS" || it.itemType !== "PRODUCT") continue;
    if (
      wantsPodium &&
      !/podium|pulpit|lectern/i.test(`${it.name} ${it.categoryName || ""}`)
    ) {
      continue;
    }
    const matchedVars = matchProductVariantsByColourTokens(it.variants || [], rawText);
    if (matchedVars.length > 0) {
      results.push({ item: it, matchedVariant: matchedVars[0] });
    }
  }
  return results.sort((a, b) => (a.item.basePrice || 999999) - (b.item.basePrice || 999999));
}

/** True when the customer refers to multiple products from the previous reply ("all three", "both", "these three", "all of them"). */
export function isMultiProductReference(rawText: string): boolean {
  return /\b(all\s+(?:three|two|four|five|\d+|of\s+them)|both(?:\s+of\s+them)?|(?:these|those|the)\s+(?:two|three|four|five|\d+)|each\s+of\s+them|their\s+(?:imag[a-z]*|phot[a-z]*|pics?|pictures?))\b/i.test(
    String(rawText || "")
  );
}

/** Resolves all products whose `ccapl.cc` shortlinks appeared in an outbound message, in order. */
export function resolveProductsFromOutboundText(
  outboundText: string,
  allItems: MainWebsiteProduct[]
): MainWebsiteProduct[] {
  if (!outboundText) return [];
  const links = Array.from(
    outboundText.matchAll(/https?:\/\/ccapl\.cc\/[^\s)*>,]+/gi)
  ).map((m) => m[0].replace(/[.,;!?]+$/, ""));
  const seen = new Set<string>();
  const resolved: MainWebsiteProduct[] = [];
  for (const link of links) {
    if (seen.has(link)) continue;
    seen.add(link);
    const found = allItems.find(
      (it) => (it.shortUrl || "").replace(/[.,;!?]+$/, "") === link
    );
    if (found) resolved.push(found);
  }
  return resolved;
}

/** "how many products have a black variant?" style questions need a catalogue-wide count, not a single product. */
export function isCatalogAggregateQuestion(rawText: string): boolean {
  return /\b(how\s+many|number\s+of|count\s+of|total\s+(?:number|products|models)|kitne|kitni|list\s+all|all\s+the\s+products|all\s+products)\b/i.test(
    rawText
  );
}

/** True when the customer is asking for product or variant photos/images/pictures (including common typos like "imagea", "imags", "phto"). */
export function isProductImageRequest(rawText: string): boolean {
  return /\b(imag[a-z]*|phot[a-z]*|phto[a-z]*|pics?|pictures?|snaps?|visuals?|videos?|dikha[a-z]*|photo\s*bhejo|bhejo\s*photo|how\s+does\s+(?:it|this|that)\s+look|look\s+like|close[-\s]*up)\b/i.test(
    String(rawText || "")
  );
}

export function isCatalogPdfRequest(rawText: string): boolean {
  return /\b(pdf|brochures?|catalogues?|catalogs?)\b/i.test(String(rawText || ""));
}

export interface AcrioMediaAttachment {
  mediaType?: "IMAGE" | "VIDEO" | "DOCUMENT";
  imageUrl: string;
  caption: string;
  fileName?: string | null;
  mimeType?: string | null;
  productName: string;
  productSlug: string;
  variantName?: string | null;
}

/**
 * Resolves official PDF brochures / catalogues (or a single product's PDF spec sheet) from the
 * ecosystem catalog when a customer asks for a PDF, brochure, catalogue, or spec sheet.
 */
export function resolveCatalogPdfAttachments(
  allItems: MainWebsiteProduct[],
  rawText: string,
  focusItem?: MainWebsiteProduct | null
): { attachments: AcrioMediaAttachment[]; replyText: string } | null {
  if (!isCatalogPdfRequest(rawText)) return null;
  const lower = String(rawText || "").toLowerCase();
  const appOrigin = resolveWhatsAppWebAppOrigin();

  // If the customer is asking for the PDF / brochure of a specific focus product
  if (
    focusItem &&
    /\b(this|it|its|model|podium|machine|spec\s*sheet|datasheet|ccpo?\d{2,4})\b/i.test(lower)
  ) {
    const cleanName = cleanDisplayProductName(focusItem.name);
    const link = focusItem.shortUrl || focusItem.url;
    const prodRes = (focusItem.resources || []).find(
      (r) => r.url && /^https?:\/\//i.test(r.url)
    );
    const pdfUrl =
      prodRes?.url ||
      `${appOrigin}/api/media/pdf_spec_${encodeURIComponent(focusItem.slug)}`;
    const safeFile = `${focusItem.slug || "product"}-spec-sheet.pdf`;
    return {
      attachments: [
        {
          mediaType: "DOCUMENT",
          imageUrl: pdfUrl,
          caption: `*${cleanName}* - Official Specification Sheet (PDF)\n${link}`,
          fileName: safeFile,
          mimeType: "application/pdf",
          productName: cleanName,
          productSlug: focusItem.slug,
          variantName: null,
        },
      ],
      replyText: `Here is the *PDF Specification Sheet* for *${cleanName}*.\n• *Product page:* ${link}`,
    };
  }

  const seenUrls = new Set<string>();
  const allResources: { name: string; url: string }[] = [];

  for (const it of allItems) {
    const itemResList = [
      ...(it.resources || []),
      ...(it.models || []).flatMap((m) => m.resources || []),
    ];
    for (const r of itemResList) {
      const name = String(r.title || r.name || "").trim();
      const url = String(r.url || "").trim();
      if (!name || !url || !/^https?:\/\//i.test(url) || seenUrls.has(url)) continue;
      seenUrls.add(url);
      allResources.push({ name, url });
    }
  }

  // Always include the built-in live-generated PDF catalogues so PDF requests never fail when DB Resource table is empty
  const builtinCatalogues = [
    {
      name: "Classic Concepts - Acrylic Podiums & Pulpits Catalogue",
      url: `${appOrigin}/api/media/pdf_podium_catalogue`,
    },
    {
      name: "Classic Concepts - Acrylic Furniture, Chairs & Tables Catalogue",
      url: `${appOrigin}/api/media/pdf_furniture_catalogue`,
    },
    {
      name: "Classic Concepts - Acrylic Trophies, Mementos & Corporate Gifts Catalogue",
      url: `${appOrigin}/api/media/pdf_memento_catalogue`,
    },
    {
      name: "Classic Edge 53 - Industrial Acrylic Machines & Tools Catalogue",
      url: `${appOrigin}/api/media/pdf_machines_catalogue`,
    },
    {
      name: "Classic Concepts - Complete Product & Display Catalogue",
      url: `${appOrigin}/api/media/pdf_full_catalogue`,
    },
  ];
  for (const b of builtinCatalogues) {
    if (!seenUrls.has(b.url)) {
      seenUrls.add(b.url);
      allResources.push(b);
    }
  }

  const matched = allResources.filter((r) => {
    const rn = r.name.toLowerCase();
    if (/podium|pulpit|lectern/.test(lower) && /podium/.test(rn)) return true;
    if (/furniture|chair|table|stool/.test(lower) && /furniture/.test(rn)) return true;
    if (/trophy|trophies|memento|award|gift/.test(lower) && /memento|award|trophy/.test(rn)) return true;
    if (/machine|polisher|bender|ce53/.test(lower) && /machine|edge|polish|bend/.test(rn)) return true;
    return false;
  });

  const chosen = (matched.length > 0 ? matched : [builtinCatalogues[4], builtinCatalogues[0]]).slice(0, 3);
  const attachments: AcrioMediaAttachment[] = chosen.map((r) => {
    const safeName = r.name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    const fileName = /\.pdf$/i.test(safeName) ? safeName : `${safeName || "Catalogue"}.pdf`;
    return {
      mediaType: "DOCUMENT",
      imageUrl: r.url,
      caption: `*${r.name}* (PDF)`,
      fileName,
      mimeType: "application/pdf",
      productName: r.name,
      productSlug: safeName.toLowerCase(),
      variantName: null,
    };
  });

  const listLines = chosen.map((r) => `• *${r.name}*`).join("\n");
  return {
    attachments,
    replyText: `Here ${attachments.length === 1 ? "is our official PDF catalogue" : "are our official PDF catalogues"}:\n${listLines}\n\nLet me know if you would like details, photos, or pricing for any specific model inside!`,
  };
}

/**
 * Resolves the exact product or variant R2 image URLs (or product video) + WhatsApp captions
 * when a customer asks for images/videos of a product or a photo of a specific colour/variant.
 */
export function resolveProductMediaAttachments(
  item: MainWebsiteProduct,
  rawText: string,
  hidePrices = false
): { attachments: AcrioMediaAttachment[]; replyText: string; matchedVariant: boolean } {
  const name = cleanDisplayProductName(item.name);
  const link = item.shortUrl || item.url;
  const basePriceStr =
    !hidePrices && typeof item.basePrice === "number" && item.basePrice > 0
      ? `₹${item.basePrice.toLocaleString("en-IN")}`
      : "";
  const variants = item.variants || [];
  const galleryUrls = Array.from(
    new Set(
      [item.mainImage, ...(item.images || [])]
        .map((u) => String(u || "").trim())
        .filter((u) => /^https?:\/\//i.test(u))
    )
  );

  const lower = String(rawText || "").toLowerCase();

  // Case 0: Customer asked specifically for a video of this product
  if (/\bvideos?\b/i.test(lower) && !/\b(images?|photos?|pics?|pictures?)\b/i.test(lower)) {
    const vidUrl = String(item.videoUrl || "").trim();
    if (vidUrl && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(vidUrl)) {
      return {
        attachments: [
          {
            mediaType: "VIDEO",
            imageUrl: vidUrl,
            caption: `*${name}* - Product Video${basePriceStr ? ` (${basePriceStr})` : ""}\n${link}`,
            fileName: `${item.slug || "product"}.mp4`,
            mimeType: "video/mp4",
            productName: name,
            productSlug: item.slug,
            variantName: null,
          },
        ],
        replyText: `Here is the video of *${name}*${basePriceStr ? ` (*${basePriceStr}*)` : ""}.\n• *Product page:* ${link}`,
        matchedVariant: false,
      };
    }
    if (vidUrl && /^https?:\/\//i.test(vidUrl)) {
      const previewAttachments: AcrioMediaAttachment[] = galleryUrls[0]
        ? [
            {
              mediaType: "IMAGE",
              imageUrl: galleryUrls[0],
              caption: `*${name}*${basePriceStr ? ` (${basePriceStr})` : ""}\nVideo: ${vidUrl}\n${link}`,
              productName: name,
              productSlug: item.slug,
              variantName: null,
            },
          ]
        : [];
      return {
        attachments: previewAttachments,
        replyText: `Here is the video link and photo for *${name}*${basePriceStr ? ` (*${basePriceStr}*)` : ""}:\n• *Watch video:* ${vidUrl}\n• *Product page:* ${link}`,
        matchedVariant: false,
      };
    }
  }
  const queryColourTokens = extractNormalizedColourTokens(rawText);
  const matchedVariants = matchProductVariantsByColourTokens(variants, rawText);
  const requestedColourLabel = queryColourTokens.join(" ");

  // Case 1: Customer asked for a specific variant/colour that exists on this product
  if (matchedVariants.length > 0) {
    const attachments: AcrioMediaAttachment[] = [];
    const seenKeys = new Set<string>();
    for (const v of matchedVariants.slice(0, 4)) {
      const imgUrl =
        (v.imageUrl && /^https?:\/\//i.test(v.imageUrl)
          ? v.imageUrl.trim()
          : galleryUrls[0]) || "";
      if (!imgUrl) continue;
      const key = `${imgUrl}#${v.name.toLowerCase()}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const effPrice = !hidePrices
        ? typeof v.price === "number" && v.price > 0
          ? v.price
          : item.basePrice
        : null;
      const pricePart =
        typeof effPrice === "number" && effPrice > 0
          ? ` (₹${effPrice.toLocaleString("en-IN")})`
          : "";
      attachments.push({
        mediaType: "IMAGE",
        imageUrl: imgUrl,
        caption: `*${name}* - *${v.name}* variant${pricePart}\n${link}`,
        productName: name,
        productSlug: item.slug,
        variantName: v.name,
      });
    }

    const allVarNames = variants.map((v) => v.name).join(", ");
    const firstV = matchedVariants[0];
    const firstPrice = !hidePrices
      ? typeof firstV.price === "number" && firstV.price > 0
        ? firstV.price
        : item.basePrice
      : null;
    const priceNote =
      typeof firstPrice === "number" && firstPrice > 0
        ? ` (*₹${firstPrice.toLocaleString("en-IN")}*)`
        : "";
    const replyText =
      matchedVariants.length === 1
        ? `Here is the photo of *${name}* in the *${firstV.name}* variant${priceNote}.\n• *All available variants:* ${allVarNames}\n• *Product page:* ${link}`
        : `Here are the photos of the ${matchedVariants
            .map((v) => `*${v.name}*`)
            .join(", ")} variants of *${name}*.\n• *All available variants:* ${allVarNames}\n• *Product page:* ${link}`;

    return { attachments, replyText, matchedVariant: true };
  }

  // Case 2: Customer asked for a colour/finish combination (e.g. "frost white") that is NOT listed on this product
  if (queryColourTokens.length > 0) {
    const attachments: AcrioMediaAttachment[] = galleryUrls[0]
      ? [
          {
            mediaType: "IMAGE",
            imageUrl: galleryUrls[0],
            caption: `*${name}*${basePriceStr ? ` (${basePriceStr})` : ""}\n${link}`,
            productName: name,
            productSlug: item.slug,
            variantName: null,
          },
        ]
      : [];
    const availLine =
      variants.length > 0
        ? `Available variants for *${name}* are: *${variants.map((v) => v.name).join(", ")}*.`
        : `*${name}* comes in one standard finish.`;
    return {
      attachments,
      replyText: `*${name}* does not come in *${requestedColourLabel}*. ${availLine}\n\nI have shared the standard product photo here, and our Sales Team can also check custom colour fabrication if needed.\n${link}`,
      matchedVariant: false,
    };
  }

  // Case 3: General product images request ("send me its images", "show photos of CCP054")
  const attachments: AcrioMediaAttachment[] = [];
  const usedUrls = new Set<string>();

  if (galleryUrls[0]) {
    usedUrls.add(galleryUrls[0]);
    attachments.push({
      imageUrl: galleryUrls[0],
      caption: `*${name}*${basePriceStr ? ` (${basePriceStr})` : ""}\n${link}`,
      productName: name,
      productSlug: item.slug,
      variantName: null,
    });
  }

  // Include distinct variant photos with their variant labels
  for (const v of variants) {
    if (attachments.length >= 4) break;
    const vUrl = String(v.imageUrl || "").trim();
    if (!vUrl || !/^https?:\/\//i.test(vUrl) || usedUrls.has(vUrl)) continue;
    usedUrls.add(vUrl);
    const vPrice = !hidePrices
      ? typeof v.price === "number" && v.price > 0
        ? v.price
        : item.basePrice
      : null;
    const vPricePart =
      typeof vPrice === "number" && vPrice > 0
        ? ` (₹${vPrice.toLocaleString("en-IN")})`
        : "";
    attachments.push({
      imageUrl: vUrl,
      caption: `*${name}* - *${v.name}* variant${vPricePart}\n${link}`,
      productName: name,
      productSlug: item.slug,
      variantName: v.name,
    });
  }

  // Fill remaining slots (up to 4 total) from gallery images
  for (const gUrl of galleryUrls.slice(1)) {
    if (attachments.length >= 4) break;
    if (usedUrls.has(gUrl)) continue;
    usedUrls.add(gUrl);
    attachments.push({
      imageUrl: gUrl,
      caption: `*${name}* (Photo ${attachments.length + 1})\n${link}`,
      productName: name,
      productSlug: item.slug,
      variantName: null,
    });
  }

  const allVarNames = variants.map((v) => v.name).join(", ");
  const replyText =
    variants.length > 0
      ? `Here ${attachments.length === 1 ? "is the photo" : `are the photos`} of *${name}*${basePriceStr ? ` (*${basePriceStr}*)` : ""}.\n• *Available variants:* ${allVarNames}\n• *Product page:* ${link}\n\nTell me if you want a photo of a specific variant (such as *${variants[0].name}*)!`
      : `Here ${attachments.length === 1 ? "is the photo" : `are the photos`} of *${name}*${basePriceStr ? ` (*${basePriceStr}*)` : ""}.\n• *Product page:* ${link}`;

  return { attachments, replyText, matchedVariant: false };
}

/**
 * Builds media attachments for a list of multiple products (e.g. when the customer says
 * "Please share images of all three" or "Can you share images of podiums with frost white color?").
 */
export function resolveMultiProductMediaAttachments(
  items: MainWebsiteProduct[],
  colourContextText: string,
  hidePrices = false
): { attachments: AcrioMediaAttachment[]; replyText: string } {
  const attachments: AcrioMediaAttachment[] = [];
  const lineSummaries: string[] = [];

  for (const it of items.slice(0, 4)) {
    const cleanName = cleanDisplayProductName(it.name);
    const link = it.shortUrl || it.url;
    const matchedVars = matchProductVariantsByColourTokens(
      it.variants || [],
      colourContextText
    );
    const chosenVar = matchedVars[0] || null;
    const effPrice = !hidePrices
      ? chosenVar && typeof chosenVar.price === "number" && chosenVar.price > 0
        ? chosenVar.price
        : it.basePrice
      : null;
    const priceTag =
      typeof effPrice === "number" && effPrice > 0
        ? ` (₹${effPrice.toLocaleString("en-IN")})`
        : "";
    const imgUrl =
      (chosenVar?.imageUrl && /^https?:\/\//i.test(chosenVar.imageUrl)
        ? chosenVar.imageUrl.trim()
        : it.mainImage || it.images?.[0] || "") || "";
    if (!imgUrl) continue;

    const varLabel = chosenVar ? ` - *${chosenVar.name}* variant` : "";
    attachments.push({
      mediaType: "IMAGE",
      imageUrl: imgUrl,
      caption: `*${cleanName}*${varLabel}${priceTag}\n${link}`,
      productName: cleanName,
      productSlug: it.slug,
      variantName: chosenVar?.name || null,
    });
    lineSummaries.push(
      `${attachments.length}. *${cleanName}*${varLabel}${priceTag}\n   ${link}`
    );
  }

  const replyText =
    attachments.length > 0
      ? `Here are the photos for the *${attachments.length} matching models*:\n\n${lineSummaries.join(
          "\n\n"
        )}\n\nLet me know which one you would like to check in detail!`
      : "";

  return { attachments, replyText };
}

/**
 * Does this turn refer back to the SINGLE product we were already discussing?
 * ("in this model", "its warranty", "the white one", "send me its images", "Black please")
 * NEVER returns true when the customer asks for plural/category-wide items ("podiums with frost white",
 * "podiums that have...", "all three", "both").
 */
export function isFocusedProductFollowUp(
  rawText: string,
  focusItem?: MainWebsiteProduct | null,
  hasQuotedFocusProduct = false
): boolean {
  const t = rawText.toLowerCase().trim();
  if (isCatalogAggregateQuestion(t)) return false;
  if (extractExplicitProductOrModelCodes(rawText).length > 0) return false;
  if (isMultiProductReference(t)) return false;

  // Plural product nouns ("podiums with frost white", "I want podiums that have...") ask for a catalog search across models!
  const hasPluralFamilyNoun =
    /\b(podiums|pulpits|lecterns|rostrums|chairs|stools|tables|desks|machines|polishers|benders|trophies|mementos|awards|plaques|signages|signs|nameplates|boxes|cases|covers|stands|holders|risers|models|options|products)\b/i.test(
      t
    );
  const hasExplicitSingularPointer =
    /\b(this\s+(?:model|podium|pulpit|product|one|item|piece|machine)|that\s+(?:model|podium|pulpit|product|one|item|piece|machine)|in\s+this|of\s+this|for\s+this|its)\b/i.test(
      t
    );
  if (hasPluralFamilyNoun && !hasExplicitSingularPointer) {
    return false;
  }

  // If the customer directly swiped/quoted a message for this specific product, keep focus on it unless they asked for cheaper/other options!
  const asksForImages = isProductImageRequest(rawText);
  if (
    !asksForImages &&
    /\b(cheaper|alternative|other\s+options?|more\s+options?|any\s+more|similar|something\s+else|different|another|compare|comparison|suggest|recommend|budget|under\s+(?:rs|inr|₹|\d))\b/i.test(
      t
    )
  ) {
    return false;
  }

  if (hasQuotedFocusProduct) {
    return true;
  }

  // If the user specifies a colour/finish (e.g. "frosted white") alongside a general noun ("podium") without "this/its",
  // and the current focusItem does NOT have that variant, do not stay locked on focusItem!
  const colourTokens = extractNormalizedColourTokens(t);
  const hasAnyFamilyNoun =
    /\b(podiums?|pulpits?|lecterns?|chairs?|stools?|tables?|machines?|trophy|trophies|signages?|boxes|stands?)\b/i.test(
      t
    );
  if (
    focusItem &&
    colourTokens.length > 0 &&
    hasAnyFamilyNoun &&
    !hasExplicitSingularPointer &&
    matchProductVariantsByColourTokens(focusItem.variants || [], t).length === 0
  ) {
    return false;
  }

  // True singular anaphora (NOTE: bare "that" in "podiums that have..." is a relative pronoun, NOT anaphora!)
  const anaphora =
    /\b(this|it|its|same|above|(?:this|that|the)\s+(?:one|model|product|podium|pulpit|item|piece|variant|colou?r)|(?:of|for|about|in|on)\s+that\b|(?:black|white|clear|gold|silver|blue|yellow|red|green|frosted|frost|led)\s+(?:one|variant|colou?r|photo|image|pic|picture))\b/i.test(
      t
    );
  const attribute =
    /\b(variants?|colou?rs?|imag[a-z]*|phot[a-z]*|phto[a-z]*|pics?|pictures?|warranty|price|cost|rate|mrp|how\s*much|kitna|size|dimensions?|height|width|weight|logo|led|delivery|shipping|dispatch|gst|invoice|order|buy|book|material|pillars?|shelf|wheels?|assembly|available|stock|details?|specs?|in\s+(?:black|white|clear|gold|silver|frost|frosted))\b/i.test(
      t
    );
  // Short variant reply (e.g. "Black please", "White", "Black Clear", "White Frosted")
  const isShortVariantReply =
    colourTokens.length > 0 &&
    !hasAnyFamilyNoun &&
    t.split(/\s+/).length <= 5 &&
    (!focusItem ||
      matchProductVariantsByColourTokens(focusItem.variants || [], t).length > 0);

  // Short city, quantity, or yes/no continuation when a single product is already in focus (e.g. "Hyderabad", "2 pieces", "Yes with logo")
  const isShortContextualContinuation =
    Boolean(focusItem) &&
    !hasAnyFamilyNoun &&
    t.split(/\s+/).length <= 7 &&
    (ACRIO_SHORT_CITY_OR_REPLY_RE.test(t) ||
      /^\s*\d{1,3}\s*(?:pcs?|pieces?|nos?|units?|sets?)?\s*$/i.test(t) ||
      /\b(yes|yeah|yep|no|nope|ok|okay|sure|with\s+logo|without\s+logo|no\s+logo|with\s+led|no\s+led|with\s+wheels)\b/i.test(t));

  return (
    anaphora ||
    isShortVariantReply ||
    isShortContextualContinuation ||
    (asksForImages && !hasAnyFamilyNoun) ||
    (attribute && !hasAnyFamilyNoun && t.split(/\s+/).length <= 12)
  );
}

/** Catalogue-wide count for questions like "how many products do you have with black variant?" */
export function buildCatalogAggregateAnswer(
  allItems: MainWebsiteProduct[],
  rawText: string
): { answer: string; items: MainWebsiteProduct[] } | null {
  if (!isCatalogAggregateQuestion(rawText)) return null;
  const lower = rawText.toLowerCase();
  const colour = ACRIO_COLOUR_WORDS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(lower));
  if (!colour) return null;
  const re = new RegExp(`\\b${colour}\\b`, "i");
  const hits = allItems.filter(
    (it) =>
      it.brand === "CLASSIC_CONCEPTS" &&
      it.itemType === "PRODUCT" &&
      ((it.variants || []).some((v) => re.test(v.name || "")) || re.test(it.name || ""))
  );
  if (hits.length === 0) {
    return {
      answer: `I checked our full Classic Concepts catalogue and found no products listed in ${colour}. We can still make custom colours, so I can check that with our Sales Team if you like.`,
      items: [],
    };
  }
  const byCat = new Map<string, number>();
  for (const it of hits) {
    const cat = it.categoryName || "Other";
    byCat.set(cat, (byCat.get(cat) || 0) + 1);
  }
  const catLines = Array.from(byCat.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([c, n]) => `• ${c}: ${n}`);
  const sample = hits.slice(0, 3);
  const sampleLines = sample.map(
    (it) => `• *${cleanDisplayProductName(it.name)}* ${it.shortUrl || it.url}`
  );
  return {
    answer: `*${hits.length} products* in our Classic Concepts catalogue come in *${colour}*:\n${catLines.join("\n")}\n\nA few examples:\n${sampleLines.join("\n")}\n\nTell me which type you want (podium, chair, signage, etc.) and I will narrow it down.`,
    items: sample,
  };
}

/** Short, direct answer about ONE product (variant, warranty, price, size) instead of a full spec dump. */
export function buildFocusedAttributeAnswer(item: MainWebsiteProduct, rawText: string): string | null {
  const t = rawText.toLowerCase();
  const name = cleanDisplayProductName(item.name);
  const link = item.shortUrl || item.url;
  const priceText =
    typeof item.basePrice === "number" && item.basePrice > 0
      ? `₹${item.basePrice.toLocaleString("en-IN")}`
      : "price on request";
  const variants = item.variants || [];
  const colourAsked = ACRIO_COLOUR_WORDS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(t));

  if (/\b(variants?|colou?rs?|finish|available\s+in)\b/i.test(t) || colourAsked) {
    if (variants.length === 0) {
      return `*${name}* is sold in one standard finish. ${link}`;
    }
    const names = variants.map((v) => v.name).join(", ");
    if (colourAsked) {
      const re = new RegExp(`\\b${colourAsked}\\b`, "i");
      const match = variants.filter((v) => re.test(v.name || ""));
      if (match.length > 0) {
        const m = match[0];
        const price =
          typeof m.price === "number" && m.price > 0 ? ` at ₹${m.price.toLocaleString("en-IN")}` : "";
        return `Yes, *${name}* comes in *${match.map((v) => v.name).join(", ")}*${price}.\n\nAll options: ${names}.\n${link}`;
      }
      return `*${name}* is not listed in ${colourAsked}. Available options: ${names}.\n${link}`;
    }
    return `*${name}* is available in: ${names}.\n${link}`;
  }
  if (/\bwarranty\b/i.test(t)) {
    const w = (item.specifications || []).find((s) => /warranty/i.test(s.label || s.key || ""));
    if (w) return `*${name}* comes with a *${w.value}* warranty.\n${link}`;
  }
  if (/\b(price|cost|rate|mrp)\b/i.test(t)) {
    const mrp =
      item.regularPrice && item.basePrice && item.regularPrice > item.basePrice
        ? ` (MRP ₹${item.regularPrice.toLocaleString("en-IN")})`
        : "";
    return `*${name}* is *${priceText}*${mrp}.\n${link}`;
  }
  return null;
}

const ACRIO_ORDINALS: Record<string, number> = {
  first: 0, "1st": 0, one: 0, second: 1, "2nd": 1, two: 1, third: 2, "3rd": 2, three: 2,
  fourth: 3, "4th": 3, four: 3, fifth: 4, "5th": 4, five: 4, last: -1,
};

/** True when the text looks like picking from a list we sent ("the first one", "option 2", "the cheaper one"). */
export function isListPickText(rawText: string): boolean {
  const t = rawText.toLowerCase().trim();
  if (t.split(/\s+/).length > 10) return false;
  if (extractExplicitProductOrModelCodes(rawText).length > 0) return false;
  if (/\b(first\s*two|top\s*two|both|these\s*two|those\s*two|all\s*of\s*them)\b/.test(t)) return false;
  return (
    /\b(?:the\s+)?(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\s*(?:one|option|model|product|podium|item|choice)?\b/.test(t) ||
    /\b(?:option|number|no\.?|#)\s*[1-5]\b/.test(t) ||
    /\b(?:the\s+)?(cheaper|cheapest|costlier|costliest|pricier|more\s+expensive|bigger|biggest|larger|largest|smaller|smallest|taller|tallest)\s+one\b/.test(t) ||
    /^\s*[1-5][\s.)!]*$/.test(t)
  );
}

/** Resolve which product from the last outbound list the customer means. Uses the order of links we actually sent. */
export function resolveListPickFromLastReply(
  rawText: string,
  lastOutboundBody: string,
  allItems: MainWebsiteProduct[]
): MainWebsiteProduct | null {
  if (!isListPickText(rawText)) return null;
  const links = Array.from(lastOutboundBody.matchAll(/https?:\/\/ccapl\.cc\/[^\s)*>]+/gi)).map((m) =>
    m[0].replace(/[.,;!?]+$/, "")
  );
  const seen = new Set<string>();
  const listed: MainWebsiteProduct[] = [];
  for (const link of links) {
    if (seen.has(link)) continue;
    seen.add(link);
    const item = allItems.find((it) => (it.shortUrl || "").replace(/[.,;!?]+$/, "") === link);
    if (item) listed.push(item);
  }
  if (listed.length === 0) return null;
  if (listed.length === 1) return listed[0];

  const t = rawText.toLowerCase();
  const price = (it: MainWebsiteProduct) => (typeof it.basePrice === "number" && it.basePrice > 0 ? it.basePrice : null);
  const priced = listed.filter((it) => price(it) !== null);
  if (/\b(cheaper|cheapest|smaller|smallest)\s+one\b/.test(t) && priced.length > 0) {
    return [...priced].sort((a, b) => price(a)! - price(b)!)[0];
  }
  if (/\b(costlier|costliest|pricier|more\s+expensive|bigger|biggest|larger|largest|taller|tallest)\s+one\b/.test(t) && priced.length > 0) {
    return [...priced].sort((a, b) => price(b)! - price(a)!)[0];
  }
  const word = t.match(/\b(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\b/)?.[1];
  const num = t.match(/(?:option|number|no\.?|#)\s*([1-5])\b/)?.[1] || t.match(/^\s*([1-5])[\s.)!]*$/)?.[1];
  let idx = -2;
  if (word) idx = ACRIO_ORDINALS[word];
  else if (num) idx = parseInt(num, 10) - 1;
  if (idx === -1) return listed[listed.length - 1];
  if (idx >= 0 && idx < listed.length) return listed[idx];
  return null;
}

/**
 * Deterministically updates `AcrioConversationState` for a single customer inbound turn.
 */
export function applyTurnToAcrioConversationState(
  prevState: AcrioConversationState | null | undefined,
  rawText: string,
  intentInfo: AcrioIntentClassification
): AcrioConversationState {
  const base = prevState
    ? {
        ...createEmptyAcrioConversationState(),
        ...prevState,
        excludedItemTypes: [...(prevState.excludedItemTypes || [])],
        preferences: [...(prevState.preferences || [])],
        shownProductSlugs: [...(prevState.shownProductSlugs || [])],
        lastMenuOptions: [...(prevState.lastMenuOptions || [])],
        askedQuestionsLog: [...(prevState.askedQuestionsLog || [])],
        lastRecommendedProducts: [...(prevState.lastRecommendedProducts || [])],
        productHistory: [...(prevState.productHistory || [])],
      }
    : createEmptyAcrioConversationState();

  base.turnCount = (base.turnCount || 0) + 1;
  base.updatedAt = new Date().toISOString();
  base.switchedThisTurn = false;

  const lower = String(rawText || "").toLowerCase();
  const profileInfo = detectAcrioCustomerProfile(rawText);
  base.customerProfile = profileInfo.customerProfile;
  base.languageMode = profileInfo.languageMode;

  const archivePreviousFocus = () => {
    const label =
      (base.focusProductSlug ? base.focusProductSlug.replace(/-/g, " ") : "") ||
      base.lastRecommendedProducts[0]?.name ||
      base.primaryProductQuery ||
      "";
    if (!label) return;
    const prevHist = base.productHistory || [];
    const lastEntry = prevHist[prevHist.length - 1];
    if (
      !lastEntry ||
      lastEntry.slug !== (base.focusProductSlug || base.lastRecommendedProducts[0]?.slug || null) ||
      lastEntry.label.toLowerCase() !== label.toLowerCase()
    ) {
      prevHist.push({
        label: label.slice(0, 80),
        slug: base.focusProductSlug || base.lastRecommendedProducts[0]?.slug || null,
        family: base.productFamily || null,
        turnNumber: Math.max(1, base.turnCount - 1),
      });
      base.productHistory = prevHist.slice(-10);
    }
  };

  // Track "without mentioning prices" / "hide prices" preference on the current turn and its immediate MENU_SELECTION follow-up
  if (/\b(without\s*(?:mentioning\s*)?prices?|no\s*prices?|hide\s*prices?|don'?t\s*(?:mention|show)\s*prices?)\b/i.test(lower)) {
    base.hidePrices = true;
  } else if (intentInfo.intent !== "MENU_SELECTION" && intentInfo.intent !== "CATEGORY_OVERVIEW") {
    base.hidePrices = false;
  }

  // Track cheapest / smaller top preference
  if (/\b(cheapest|lowest\s*price|least\s*expensive|cheaper\s*alternative|cheaper\s*option|smaller\s*top\s*to\s*save|save\s*more|sasta|sabse\s*sasta)\b/i.test(lower)) {
    base.preferCheapest = true;
    base.preferences = base.preferences.filter((p) => p !== "premium");
    // If customer had a high podium price or is asking for a cheaper alternative to a specific model, clear minPrice
    base.minPrice = null;
  } else if (/\b(costliest|most\s*expensive|most\s*premium|premium|flagship|luxury)\b/i.test(lower)) {
    base.preferCheapest = false;
  } else if (!/\b(any\s*more|more\s*options|other\s*options)\b/i.test(lower)) {
    base.preferCheapest = false;
  }

  // Explicit topic reset clears active product/budget state while keeping archived productHistory
  if (intentInfo.intent === "TOPIC_RESET") {
    archivePreviousFocus();
    return {
      ...createEmptyAcrioConversationState(),
      productHistory: [...(base.productHistory || [])],
      switchedThisTurn: true,
      turnCount: base.turnCount,
      updatedAt: base.updatedAt,
    };
  }

  // Handle CATEGORY_OVERVIEW (e.g. "What all categories do you have under the podiums category?")
  if (intentInfo.intent === "CATEGORY_OVERVIEW") {
    archivePreviousFocus();
    base.activeBrand = "CLASSIC_CONCEPTS";
    base.activeCategory = "Podiums & Stage";
    base.productFamily = "podium";
    base.primaryProductQuery = "acrylic podium categories";
    base.focusProductSlug = null;
    base.lastMenuOptions = [
      "Essential Podiums",
      "Classic Signature Podiums",
      "Premium Podiums",
      "Custom-Built Podiums",
    ];
    return base;
  }

  // Handle MENU_SELECTION ("1", "2", "Option 1")
  if (intentInfo.intent === "MENU_SELECTION") {
    const numMatch = rawText.trim().match(/^[\s*#]*(?:option\s*|category\s*|number\s*|no\.?\s*)?([1-5])[\s.)*]*$/i);
    const wordMatch = rawText.trim().match(/^(?:the\s+)?(first|second|third|fourth|1st|2nd|3rd|4th)\b/i);
    let idx = 0;
    if (numMatch) {
      idx = parseInt(numMatch[1], 10) - 1;
    } else if (wordMatch) {
      const w = wordMatch[1].toLowerCase();
      idx = w === "second" || w === "2nd" ? 1 : w === "third" || w === "3rd" ? 2 : w === "fourth" || w === "4th" ? 3 : 0;
    }
    if (base.lastMenuOptions && base.lastMenuOptions[idx]) {
      const chosenOption = base.lastMenuOptions[idx];
      base.primaryProductQuery = `${chosenOption} acrylic podium`;
      base.productFamily = "podium";
      base.activeCategory = "Podiums & Stage";
      base.activeBrand = "CLASSIC_CONCEPTS";
      return base;
    } else if (base.lastRecommendedProducts && base.lastRecommendedProducts[idx]) {
      const chosenProd = base.lastRecommendedProducts[idx];
      base.primaryProductQuery = chosenProd.name;
      base.focusProductSlug = chosenProd.slug;
      return base;
    }
  }

  // Non-product informational/greeting turns do not mutate active product state
  if (!intentInfo.requiresProductLookup) {
    return base;
  }

  const detected = detectProductFamilyAndQuery(rawText);
  const budget = extractBudgetConstraintsFromQuery(rawText);
  const turnPrefs = extractPreferencesFromTurn(rawText);
  const meta = extractMetadataFromTurn(rawText);
  const explicitCodesInTurn = extractExplicitProductOrModelCodes(rawText);
  const isComparisonTurn =
    intentInfo.intent === "PRODUCT_COMPARISON" ||
    /\b(compare|comparison|vs\.?|versus|difference\s+between|both|all\s+three|earlier|previous)\b/i.test(lower);

  // Detect product switch even within the same family (e.g. CCP054 -> CCP065 -> CCP094) OR from a product to any new distinct item/noun!
  const focusCodeNorm = (base.focusProductSlug || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const explicitSwitchedCode =
    !isComparisonTurn &&
    explicitCodesInTurn.length >= 1 &&
    Boolean(base.focusProductSlug || base.primaryProductQuery) &&
    !explicitCodesInTurn.some((c) => focusCodeNorm.includes(c.toLowerCase().replace(/[^a-z0-9]/g, "")));

  const newNounMatch = lower.match(ACRIO_DOMAIN_PRODUCT_NOUN_RE);
  const distinctNounInTurn = newNounMatch ? newNounMatch[1].toLowerCase().replace(/s$/, "") : "";
  const prevQueryLower = `${base.primaryProductQuery || ""} ${base.focusProductSlug || ""} ${base.productFamily || ""}`.toLowerCase();
  const switchedToUnseenNoun =
    !isComparisonTurn &&
    !detected.isCorrectionOnly &&
    Boolean(distinctNounInTurn) &&
    Boolean(base.primaryProductQuery || base.focusProductSlug) &&
    !prevQueryLower.includes(distinctNounInTurn) &&
    !/^(acrylic|perspex|pmma|model|option|product|custom\s*size|fabrication)$/i.test(distinctNounInTurn);

  const familyChanged =
    !isComparisonTurn &&
    !detected.isCorrectionOnly &&
    Boolean(detected.productFamily) &&
    Boolean(base.productFamily) &&
    detected.productFamily !== base.productFamily &&
    !(
      (detected.productFamily === "machine" &&
        (base.productFamily === "polishing_machine" ||
          base.productFamily === "bending_machine")) ||
      ((detected.productFamily === "polishing_machine" ||
        detected.productFamily === "bending_machine") &&
        base.productFamily === "machine")
    );

  const hasExplicitSwitchPhrase =
    !isComparisonTurn &&
    (Boolean(detected.primaryProductQuery) || explicitCodesInTurn.length > 0 || Boolean(distinctNounInTurn)) &&
    /\b(now\s+(?:tell|show|what\s+about|check)|what\s+about|how\s+about|instead(?:\s+of)?|switch\s+to|other\s+than\s+that|also\s+(?:show|need|check)|next\s+item|another\s+product)\b/i.test(lower);

  const isTopicSwitch =
    familyChanged || explicitSwitchedCode || switchedToUnseenNoun || hasExplicitSwitchPhrase;

  if (isTopicSwitch) {
    archivePreviousFocus();
    base.switchedThisTurn = true;
    base.activeBrand = detected.activeBrand;
    base.activeCategory = detected.activeCategory;
    base.productFamily = detected.productFamily;
    base.primaryProductQuery = detected.primaryProductQuery || rawText.trim();
    base.itemTypeFilter = detected.itemTypeFilter;
    base.excludedItemTypes = [...detected.excludedItemTypes];
    base.minPrice = budget.minPrice;
    base.maxPrice = budget.maxPrice;
    base.preferences = turnPrefs;
    base.applicationContext = meta.applicationContext;
    base.dimensionsOrThickness = meta.dimensionsOrThickness;
    base.quantity = meta.quantity;
    base.lastRecommendedProducts = [];
    base.shownProductSlugs = [];
    base.focusProductSlug = null;
    return base;
  }

  // If customer explicitly names SKU codes (e.g. "CCP057S and CCP054" or "Tell me about CCP111") without a budget in this turn, clear any stale budget from an earlier turn!
  if (explicitCodesInTurn.length > 0 && budget.maxPrice === null && budget.minPrice === null) {
    base.maxPrice = null;
    base.minPrice = null;
  }

  // If customer asks for a cheaper alternative after looking at a high-end product, set maxPrice below the last recommended product's price!
  if (
    /\b(cheaper\s*alternative|cheaper\s*option|smaller\s*top\s*to\s*save|save\s*more|lower\s*price\s*option)\b/i.test(
      lower
    ) &&
    budget.maxPrice === null
  ) {
    const lastPrice = base.lastRecommendedProducts[0]?.priceInr;
    if (typeof lastPrice === "number" && lastPrice > 8000) {
      base.maxPrice = lastPrice - 1;
    } else {
      base.maxPrice = null;
    }
  }

  // Merge product family & query if not already set or if this turn specifies a family
  if (detected.activeBrand) base.activeBrand = detected.activeBrand;
  if (detected.activeCategory) base.activeCategory = detected.activeCategory;
  if (detected.productFamily && (!base.productFamily || base.productFamily === "machine" || detected.productFamily !== base.productFamily)) {
    base.productFamily = detected.productFamily;
  }
  if (detected.primaryProductQuery && (!base.primaryProductQuery || !detected.isCorrectionOnly)) {
    if (
      !base.primaryProductQuery ||
      detected.productFamily === "podium" ||
      detected.productFamily === "furniture" ||
      detected.productFamily === "signage" ||
      detected.productFamily === "corporate_gift" ||
      detected.productFamily === "trophy" ||
      detected.productFamily === "polishing_machine" ||
      detected.productFamily === "bending_machine"
    ) {
      base.primaryProductQuery = detected.primaryProductQuery;
    }
  } else if (!base.primaryProductQuery && detected.isCorrectionOnly && detected.activeBrand === "CLASSIC_EDGE_53") {
    base.primaryProductQuery = "acrylic machine";
  } else if (
    !base.primaryProductQuery &&
    intentInfo.intent === "PRODUCT_SEARCH" &&
    rawText.trim()
  ) {
    base.primaryProductQuery = rawText.trim();
  }

  if (detected.itemTypeFilter) {
    base.itemTypeFilter = detected.itemTypeFilter;
  }
  if (detected.excludedItemTypes.length > 0) {
    const mergedExcl = new Set([...base.excludedItemTypes, ...detected.excludedItemTypes]);
    base.excludedItemTypes = Array.from(mergedExcl);
  }

  // Budget updates: preserve product category & requirements while updating price ceiling/floor!
  if (budget.maxPrice !== null || budget.minPrice !== null) {
    base.maxPrice = budget.maxPrice;
    base.minPrice = budget.minPrice;
  } else if (/\b(no\s*budget|any\s*budget|without\s*budget|ignore\s*budget|no\s*price\s*limit|cheapest|costliest|most\s*expensive)\b/i.test(rawText)) {
    base.maxPrice = null;
    base.minPrice = null;
  }

  // Preferences merge
  if (turnPrefs.length > 0) {
    const mergedPrefs = new Set([...base.preferences, ...turnPrefs]);
    base.preferences = Array.from(mergedPrefs);
  }

  if (meta.applicationContext) base.applicationContext = meta.applicationContext;
  if (meta.dimensionsOrThickness) base.dimensionsOrThickness = meta.dimensionsOrThickness;
  if (meta.quantity) base.quantity = meta.quantity;

  return base;
}

/**
 * Reconstructs `AcrioConversationState` across an inbound/outbound history array
 * combined with an optional persisted `ai_state_json` snapshot.
 */
export function reconstructAcrioConversationState(params: {
  persistedState?: AcrioConversationState | null;
  recentMessages?: { direction: string; body: string }[];
  currentInboundText: string;
}): AcrioConversationState {
  const { persistedState, recentMessages = [], currentInboundText } = params;
  const trimmedCurrent = String(currentInboundText || "").trim();

  // Extract inbound history excluding duplicate trailing currentInboundText
  const inboundTurns = recentMessages
    .filter((m) => m.direction === "INBOUND" && Boolean(String(m.body || "").trim()))
    .map((m) => String(m.body).trim());

  if (
    inboundTurns.length > 0 &&
    inboundTurns[inboundTurns.length - 1] === trimmedCurrent
  ) {
    inboundTurns.pop();
  }

  let state = persistedState
    ? {
        ...createEmptyAcrioConversationState(),
        ...persistedState,
        excludedItemTypes: [...(persistedState.excludedItemTypes || [])],
        preferences: [...(persistedState.preferences || [])],
        lastRecommendedProducts: [...(persistedState.lastRecommendedProducts || [])],
      }
    : createEmptyAcrioConversationState();

  // If no persisted state had an active query (or turnCount === 0), replay prior inbound turns
  if (!persistedState || (state.turnCount === 0 && inboundTurns.length > 0)) {
    state = createEmptyAcrioConversationState();
    for (let i = 0; i < inboundTurns.length; i++) {
      const turnText = inboundTurns[i];
      const turnIntent = classifyAcrioInboundIntent(turnText, i > 0);
      state = applyTurnToAcrioConversationState(state, turnText, turnIntent);
    }
  }

  const currentIntent = classifyAcrioInboundIntent(
    trimmedCurrent,
    inboundTurns.length > 0 || state.turnCount > 0
  );
  return applyTurnToAcrioConversationState(state, trimmedCurrent, currentIntent);
}

/**
 * Builds the clean, normalized catalog search query and structured `EcosystemSearchOptions`
 * from `AcrioConversationState` so follow-up turns ("We can increase the budget to ₹30,000",
 * "Show me the most premium transparent ones", "Actually I am not looking for tools, just machines")
 * never feed noisy multi-turn chat sentences into `searchEcosystemItems`.
 */
export function buildNormalizedSearchFromState(
  state: AcrioConversationState,
  fallbackRawText: string
): {
  searchQuery: string;
  searchOptions: EcosystemSearchOptions;
  budgetLabel: string | null;
} {
  const parts: string[] = [];
  const rawTrimmed = fallbackRawText.trim();
  const hasExplicitInRaw =
    extractExplicitProductOrModelCodes(rawTrimmed).length > 0 ||
    extractCompactDimensionPairsFromText(rawTrimmed).pairs.length > 0 ||
    extractCompactDimensionPairsFromText(rawTrimmed).ranges.length > 0;

  if (hasExplicitInRaw && rawTrimmed) {
    parts.push(rawTrimmed);
  }
  if (state.primaryProductQuery) {
    if (!parts.some((p) => p.toLowerCase().includes(state.primaryProductQuery!.toLowerCase()))) {
      parts.push(state.primaryProductQuery);
    }
  }
  if (
    rawTrimmed &&
    !parts.some((p) => p.toLowerCase().includes(rawTrimmed.toLowerCase())) &&
    !/\b(not\s+looking\s+for|don'?t\s+want|do\s+not\s+want|just\s+machines|only\s+machines|increase\s+(?:the\s+)?budget|raise\s+(?:the\s+)?budget|stretch\s+(?:the\s+)?budget)\b/i.test(
      rawTrimmed
    )
  ) {
    parts.push(rawTrimmed);
  }

  const nonGenericPrefs = (state.preferences || []).filter(
    (p) => p !== "premium" && p !== "cheapest"
  );
  if (nonGenericPrefs.length > 0) {
    parts.push(nonGenericPrefs.join(" "));
  }
  if (state.applicationContext && !parts.join(" ").toLowerCase().includes(state.applicationContext)) {
    parts.push(state.applicationContext);
  }

  const searchQuery = parts.join(" ").trim() || fallbackRawText.trim();
  const preferCheapest =
    Boolean(state.preferCheapest) ||
    (state.preferences || []).includes("cheapest") ||
    /\b(cheapest|lowest\s*price|cheaper\s*alternative|smaller\s*top\s*to\s*save|save\s*more)\b/i.test(
      rawTrimmed
    );
  const preferPremium =
    !preferCheapest && (state.preferences || []).includes("premium");
  const asksMoreOrAlternative =
    /\b(any\s*more|more\s*options|other\s*options|any\s*other|another\s*model|cheaper\s*alternative|smaller\s*top\s*to\s*save|save\s*more)\b/i.test(
      rawTrimmed
    );

  const searchOptions: EcosystemSearchOptions = {
    minPrice: state.minPrice,
    maxPrice: state.maxPrice,
    brand:
      state.activeBrand === "CLASSIC_CONCEPTS" ||
      state.activeBrand === "CLASSIC_EDGE_53"
        ? state.activeBrand
        : undefined,
    itemType: state.itemTypeFilter,
    excludedItemTypes: state.excludedItemTypes,
    productFamily: state.productFamily,
    preferPremium,
    preferCheapest,
    excludeSlugs: asksMoreOrAlternative ? state.shownProductSlugs || [] : undefined,
  };

  const budgetLabel =
    state.maxPrice !== null && state.minPrice !== null
      ? `₹${state.minPrice.toLocaleString("en-IN")} to ₹${state.maxPrice.toLocaleString("en-IN")}`
      : state.maxPrice !== null
      ? `<= ₹${state.maxPrice.toLocaleString("en-IN")}`
      : state.minPrice !== null
      ? `>= ₹${state.minPrice.toLocaleString("en-IN")}`
      : null;

  return { searchQuery, searchOptions, budgetLabel };
}

let aiStateColumnChecked = false;
async function ensureConversationsAiStateColumn(): Promise<void> {
  if (aiStateColumnChecked) return;
  try {
    await ensureDatabasesBootstrapped();
    const conv = getRawLibSqlClient("conversations");
    await conv
      .execute(`ALTER TABLE conversations ADD COLUMN ai_state_json TEXT`)
      .catch(() => {});
    aiStateColumnChecked = true;
  } catch {
    // Non-fatal
  }
}

export async function loadConversationAiState(
  conversationId?: string
): Promise<AcrioConversationState | null> {
  if (!conversationId) return null;
  try {
    await ensureConversationsAiStateColumn();
    const conv = getRawLibSqlClient("conversations");
    const res = await conv.execute({
      sql: `SELECT ai_state_json FROM conversations WHERE id = ? LIMIT 1`,
      args: [conversationId],
    });
    const raw = res.rows[0]?.ai_state_json;
    if (!raw || typeof raw !== "string") return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        ...createEmptyAcrioConversationState(),
        ...parsed,
      };
    }
  } catch {
    // Ignore parse/DB errors
  }
  return null;
}

export async function saveConversationAiState(
  conversationId: string | undefined,
  state: AcrioConversationState
): Promise<void> {
  if (!conversationId) return;
  try {
    await ensureConversationsAiStateColumn();
    const conv = getRawLibSqlClient("conversations");
    await conv.execute({
      sql: `UPDATE conversations SET ai_state_json = ? WHERE id = ?`,
      args: [JSON.stringify(state), conversationId],
    });
  } catch {
    // Non-fatal
  }
}

export interface AcrioStaffAction {
  type:
    | "assign_staff"
    | "add_collaborator"
    | "set_priority"
    | "set_category"
    | "resolve_chat"
    | "reopen_chat"
    | "update_customer"
    | "create_callback"
    | "send_customer_reply";
  staffQuery?: string;
  priority?: "URGENT" | "HIGH" | "NORMAL";
  category?: string;
  summary?: string;
  companyName?: string;
  city?: string;
  notes?: string;
  preferredStaffQuery?: string;
  callbackSlot?: string;
  callbackTopic?: string;
  messageText?: string;
}

/**
 * ACRIO answers a teammate who asked a question or requested an action with "@ACRIO" inside an internal chat note.
 * Can execute real chat & CRM actions (assign, add collaborator, update customer details, resolve, set priority, send explicit reply)
 * while posting a clear confirmation & answer back into the private notes.
 */
export async function runAcrioStaffQuestion(params: {
  question: string;
  staffName: string;
  customerName: string;
  customerPhone?: string;
  chatMessages: { direction: string; senderName?: string; body: string; isNote?: boolean }[];
  availableStaff?: { id: string; name: string; role: string; department?: string }[];
  currentOwnerName?: string | null;
  conversationStatus?: string;
}): Promise<{
  ok: boolean;
  answer: string;
  suggestedReply?: string | null;
  actions?: AcrioStaffAction[];
  error?: string;
}> {
  const started = Date.now();
  const steps: AiTraceStep[] = [];
  const addStep = (label: string, detail?: string, status: AiTraceStep["status"] = "OK") =>
    steps.push({ stepNumber: steps.length + 1, label, detail, durationMs: Date.now() - started, status });

  const question = params.question.trim();
  const fetchedCatalog = await getCachedEcosystemCatalog();
  const allItems = fetchedCatalog.allItems;

  const lastCustomerText = params.chatMessages
    .filter((m) => m.direction === "INBOUND")
    .slice(-3)
    .map((m) => m.body)
    .join(" ");
  const [matches, trainingGuidance] = await Promise.all([
    Promise.resolve(searchEcosystemItems(allItems, `${question} ${lastCustomerText}`, 6)),
    findMatchingAiTrainingGuidance({
      queryText: `${question} ${lastCustomerText}`,
      scope: "STAFF_COPILOT",
    }).catch(() => ({ promptBlock: "", examples: [], rules: [] })),
  ]);
  const deep = buildEcosystemDeepProductContextAndAnswer({
    rawQuery: question,
    matchedItems: matches,
    formatItemLink: (it) => it.shortUrl || it.url,
  });
  addStep("Looked up catalog for the question", `matched=${matches.length} of ${allItems.length}`);

  const liveContext = await loadLiveDatabaseOperationalContext({
    customerPhone: params.customerPhone,
    customerName: params.customerName,
    rawQuery: question,
    forStaffCopilot: true,
  }).catch(() => "");

  const transcript = params.chatMessages
    .slice(-30)
    .map((m) => {
      const who = m.isNote
        ? `[Private team note by ${m.senderName || "team"}]`
        : m.direction === "INBOUND"
        ? `[Customer ${params.customerName}]`
        : `[${m.senderName || "Reply"} to customer]`;
      return `${who} ${String(m.body).replace(/\s+/g, " ").slice(0, 500)}`;
    })
    .join("\n");

  const staffRosterLine = (params.availableStaff || [])
    .map((s) => `${s.name} (${s.role}${s.department ? ` - ${s.department}` : ""})`)
    .join(", ");

  const { apiKey } = await resolveSharedAnthropicApiKey("admin");
  let answer = "";
  let suggestedReply: string | null = null;
  let actions: AcrioStaffAction[] = [];
  let usage: AiTokenUsage | null = null;
  let error: string | undefined;

  if (apiKey) {
    const aiCall = await callClaudeHaikuMessagesDetailed({
      apiKey,
      maxTokens: 2048,
      effort: "medium",
      timeoutMs: 30000,
      system: `You are ACRIO, the assistant and action copilot for the Classic Concepts and Classic Edge 53 team. A teammate (${params.staffName}) is asking you a question OR asking you to perform an action inside a PRIVATE internal note on a customer chat.

CAPABILITIES (STAFF COPILOT ACTIONS):
You can both answer questions AND perform actions inside the chat by returning structured "actions" in JSON:
- "assign_staff": transfer chat ownership to a teammate (or "ACRIO" to hand back to AI). Set "staffQuery".
- "add_collaborator": give dual access to a teammate without removing current owner. Set "staffQuery".
- "set_priority": set priority to "URGENT", "HIGH", or "NORMAL".
- "set_category": set smart category ("Podiums & Stage", "Awards & Trophies", "Hotel & Banquet", "Acrylic Machines (CE53)", "Custom Fabrication", "Order & Delivery", "General Enquiry").
- "resolve_chat": mark this chat Resolved with a short plain-English "summary".
- "reopen_chat": reopen a resolved chat.
- "update_customer": update "city", "companyName", "notes", or "preferredStaffQuery" on customer profile.
- "create_callback": log a pending callback with "callbackSlot" and "callbackTopic".
- "send_customer_reply": ONLY use this if the teammate explicitly commands you to send a WhatsApp message directly to the customer (e.g. "send this to customer", "reply to the customer saying...", "message the client now"). Otherwise put any draft inside "suggestedReply" ONLY so staff can review and click Insert!

ACTIVE TEAM ROSTER: ${staffRosterLine || "Sales & Support Team"}
CURRENT CHAT OWNER: ${params.currentOwnerName || "System (ACRIO)"} | STATUS: ${params.conversationStatus || "OPEN"}

WRITING RULES:
1. Plain everyday layman English. Zero em-dashes, zero "--", zero buzzwords (no bespoke, elevate, delve, meticulous, seamless, utilize, etc.).
2. Use ONLY verified catalogue, company, and chat information below. Never invent prices, sizes, specs, stock, or dates.
3. Single asterisks for *bold*. Use ₹ and https://ccapl.cc/... shortlinks from verified data.
4. Keep "answer" concise (2 to 8 short lines).
${trainingGuidance.promptBlock ? `\n${trainingGuidance.promptBlock}\n` : ""}
${buildCompleteEcosystemDatabaseDirectory(allItems)}

Return ONLY valid JSON:
{
  "answer": "Clear private reply for ${params.staffName}",
  "suggestedReply": "Optional short ready-to-send customer WhatsApp message (or empty string)",
  "actions": [
    { "type": "assign_staff | add_collaborator | set_priority | set_category | resolve_chat | reopen_chat | update_customer | create_callback | send_customer_reply", ...fields }
  ]
}`,
      messages: [
        {
          role: "user",
          content: `Customer: ${params.customerName}${params.customerPhone ? ` (${params.customerPhone})` : ""}

Recent chat (oldest first):
${transcript || "(no messages yet)"}

${deep.promptCatalogContext ? `Verified product details that may be relevant:\n${deep.promptCatalogContext}\n` : ""}${liveContext ? `Company and database context:\n${liveContext}\n` : ""}
Teammate note / command:
${question}`,
        },
      ],
    });
    usage = aiCall.usage;
    if (aiCall.ok && aiCall.text) {
      const parsed = parseClaudeJson<{
        answer?: string;
        suggestedReply?: string;
        actions?: AcrioStaffAction[];
      }>(aiCall.text);
      if (parsed && typeof parsed.answer === "string" && parsed.answer.trim()) {
        answer = formatWhatsAppOutboundText(parsed.answer).trim();
        if (parsed.suggestedReply && parsed.suggestedReply.trim()) {
          suggestedReply = formatWhatsAppOutboundText(parsed.suggestedReply).trim();
        }
        if (Array.isArray(parsed.actions)) {
          actions = parsed.actions.filter((a) => a && typeof a.type === "string");
        }
      } else {
        answer = formatWhatsAppOutboundText(aiCall.text).trim();
      }
      addStep("Claude processed staff note/command", `HTTP ${aiCall.statusCode} in ${aiCall.durationMs}ms, actions=${actions.length}`);
    } else {
      error = aiCall.error || "Claude call failed";
      addStep("Claude call failed", error, "ERROR");
    }
  } else {
    error = "No Anthropic admin API key is configured.";
    addStep("No admin API key", error, "WARN");
  }

  if (!answer) {
    answer = deep.deterministicDeepAnswer
      ? `I could not reach my AI engine just now, but here are the verified details from our catalogue:\n\n${deep.deterministicDeepAnswer}`
      : "I could not reach my AI engine just now, so I cannot answer this one. Please try again in a minute.";
  }

  recordAndBroadcastAiLog({
    website: "WHATSAPP_HUB",
    websiteLabel: "Classic Concepts WhatsApp Hub",
    feature: "ACRIO Staff Copilot (@ACRIO Actions & Q&A)",
    actor: params.staffName,
    question,
    model: apiKey && !error ? LOCKED_CLAUDE_MODEL : "local-fallback",
    effort: apiKey && !error ? "medium" : undefined,
    outcomeSource: apiKey && !error ? "LIVE_AI" : "LOCAL_FALLBACK",
    responseCacheStatus: "BYPASS",
    catalogCacheStatus: "BYPASS",
    cacheDetails: `${fetchedCatalog.cacheMeta?.cacheSummary || ""}${actions.length > 0 ? ` • actions=[${actions.map((a) => a.type).join(",")}]` : ""}`,
    productLookupTriggered: true,
    productLookupQuery: question,
    productLookupTotalScanned: allItems.length,
    productsLookedUp: matches.map(mapProductToLogItem),
    steps,
    response: answer,
    durationMs: Date.now() - started,
    tokenUsage: usage,
    error: error || null,
  });

  return { ok: !error, answer, suggestedReply, actions, error };
}

/**
 * Generates a quick plain-English chat summary for staff to save & share via ACRIO internal notes.
 */
export async function runAcrioConversationSummary(params: {
  customerName: string;
  customerPhone: string;
  requestedByName: string;
  chatMessages: { direction: string; senderName?: string; body: string; isNote?: boolean; createdAt?: string }[];
}): Promise<{ ok: boolean; summaryText: string; model: string }> {
  const { apiKey } = await resolveSharedAnthropicApiKey("admin");
  const visibleMsgs = params.chatMessages.slice(-40);
  const transcript = visibleMsgs
    .map((m) => {
      const who = m.isNote
        ? `[Internal Note by ${m.senderName || "Team"}]`
        : m.direction === "INBOUND"
        ? `[Customer ${params.customerName}]`
        : `[${m.senderName || "Team"}]`;
      return `${who}: ${String(m.body || "").replace(/\s+/g, " ").slice(0, 420)}`;
    })
    .join("\n");

  if (apiKey && visibleMsgs.length > 0) {
    const aiRes = await callClaudeHaikuMessagesDetailed({
      apiKey,
      maxTokens: 900,
      effort: "low",
      timeoutMs: 20000,
      system: `You write quick, clear WhatsApp chat summaries for the Classic Concepts and Classic Edge 53 sales team.
RULES:
- Simple everyday layman English so any teammate catches up in 10 seconds.
- Zero em-dashes ("—"), zero "--", zero robotic AI buzzwords (no bespoke, elevate, delve, meticulous, seamless, utilize, robust).
- Use 4 short bullet points with single *bold* labels:
  * *Customer need:* what they are looking for (products, codes, size, qty)
  * *Key details shared:* city, budget, custom requirements, prices quoted, or files sent
  * *Current status:* who answered last and where things stand
  * *Next step:* what our team should do next`,
      messages: [
        {
          role: "user",
          content: `Customer: ${params.customerName} (${params.customerPhone})
Conversation transcript (oldest first):
${transcript}`,
        },
      ],
    });
    if (aiRes.ok && aiRes.text) {
      return {
        ok: true,
        summaryText: formatWhatsAppOutboundText(aiRes.text).trim(),
        model: LOCKED_CLAUDE_MODEL,
      };
    }
  }

  const inbound = visibleMsgs.filter((m) => m.direction === "INBOUND");
  const lastInbound = inbound[inbound.length - 1]?.body || "No customer message yet.";
  const lastMsg = visibleMsgs[visibleMsgs.length - 1];
  const topics = inbound
    .slice(-4)
    .map((m) => String(m.body || "").replace(/\s+/g, " ").slice(0, 90))
    .join(" | ");

  const fallback = [
    `*Chat Summary* (requested by ${params.requestedByName})`,
    `• *Customer need:* ${topics || "General enquiry"}`,
    `• *Latest customer message:* ${lastInbound.slice(0, 140)}`,
    `• *Total messages:* ${visibleMsgs.length} (${inbound.length} from customer)`,
    `• *Last activity:* ${lastMsg?.senderName || "Customer"}: ${String(lastMsg?.body || "").slice(0, 100)}`,
  ].join("\n");

  return {
    ok: true,
    summaryText: formatWhatsAppOutboundText(fallback),
    model: "local-summary-fallback",
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
  const convState = reconstructAcrioConversationState({
    recentMessages: customerMessages,
    currentInboundText: lastInbound,
  });
  const lower = intentInfo.allowRollingContextFallback
    ? `${convState.primaryProductQuery || recentInboundContext} ${lastInbound}`.toLowerCase()
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
    const { searchQuery, searchOptions } = buildNormalizedSearchFromState(
      convState,
      lastInbound
    );
    usedQuery = searchQuery;
    catalog = searchEcosystemItems(allItems, searchQuery, 8, searchOptions);
    if (searchQuery !== lastInbound) {
      const directMatches = searchEcosystemItems(allItems, lastInbound, 8, searchOptions);
      if (catalog.length === 0) {
        catalog = directMatches;
      } else if (
        directMatches.length > 0 &&
        (extractExplicitProductOrModelCodes(lastInbound).length > 0 ||
          extractCompactDimensionPairsFromText(lastInbound).pairs.length > 0)
      ) {
        const seen = new Set<string>();
        catalog = [...directMatches, ...catalog].filter((it) => {
          const k = `${it.brand}:${it.slug || it.id}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }).slice(0, 8);
      }
    }
  }

  // Smart intent & category classification across Classic Concepts + Classic Edge 53
  let smartCategory = convState.activeCategory || "General Enquiry";
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
        excludeConsumables: convState.excludedItemTypes.includes("CONSUMABLE"),
        hasStrictBudget: convState.maxPrice !== null || convState.minPrice !== null,
      })
    : "";

  const deepCopilotInfo = intentInfo.requiresProductLookup
    ? buildEcosystemDeepProductContextAndAnswer({
        rawQuery: lastInbound,
        matchedItems: catalog,
        formatItemLink: (it) => it.shortUrl || it.url,
      })
    : null;

  const localReplies: string[] = [];
  if (deepCopilotInfo?.deterministicDeepAnswer) {
    localReplies.push(`${greetPrefix}${deepCopilotInfo.deterministicDeepAnswer}`);
  }
  if (intentInfo.intent === "IDENTITY_META") {
    localReplies.push(
      `${greetPrefix}I am *ACRIO*, the WhatsApp product & fabrication assistant for *Classic Concepts* (ready & custom acrylic products) and *Classic Edge 53* (acrylic fabrication machines & tools).\n\nTell me what you want to display, build, or fabricate and I will share matching options right away.`,
      `${greetPrefix}I help you compare ready *acrylic podiums, awards, stands, custom boxes*, and *Classic Edge 53 machines*, and I can connect you to our Sales Team anytime for formal quotes.`
    );
  } else if (intentInfo.intent === "COMPANY_INFO") {
    localReplies.push(
      `${greetPrefix}*Classic Concepts* manufactures clear acrylic podiums, awards, hotel/retail stands, and custom acrylic fabrication, while *Classic Edge 53* supplies industrial acrylic bending, diamond edge polishing, and cutting machines from our Secunderabad / Hyderabad facility with pan-India dispatch.`,
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
  needsSalesTeamPing?: boolean;
  salesTeamPingNote?: string;
  customerReply: string;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL";
  conversationState?: AcrioConversationState;
  /** Optional WhatsApp buttons / "View options" list to send with the reply. */
  interactive?: AcrioInteractive;
  /** Optional product / variant photos from Cloudflare R2 to send directly in the WhatsApp chat. */
  mediaAttachments?: AcrioMediaAttachment[];
}

/** What the turn matched, so the wrapper can decide between plain text, a list or buttons. */
export interface AcrioUiSink {
  intent?: string;
  matches: MainWebsiteProduct[];
  focus?: MainWebsiteProduct | null;
  aggregate?: boolean;
  multiItem?: boolean;
  explicitCodes?: number;
  hidePrices?: boolean;
  budgetLabel?: string | null;
  languageMode?: string;
}

export interface AcrioReplyToMessageContext {
  waMessageId?: string;
  senderName?: string;
  direction?: string;
  body?: string;
  productSlug?: string | null;
  productName?: string | null;
  variantName?: string | null;
}

export interface AcrioTurnParams {
  conversationId?: string;
  customerName: string;
  customerPhone?: string;
  inboundText: string;
  recentMessages?: {
    direction: string;
    senderType?: string;
    body: string;
    productSlug?: string | null;
    replyTo?: AcrioReplyToMessageContext | null;
  }[];
  hasAlreadyGreeted?: boolean;
  persistedState?: AcrioConversationState | null;
  /** Set when the customer tapped a product in the "View options" list. */
  forcedFocusSlug?: string;
  /** Set when the customer swiped/quoted an earlier WhatsApp message. */
  replyToMessage?: AcrioReplyToMessageContext | null;
  /** Attachment metadata if the inbound message included a PDF, image, video, audio, or file. */
  attachment?: {
    mediaType?: "IMAGE" | "DOCUMENT" | "VIDEO" | "AUDIO" | string;
    filename?: string;
    mimeType?: string;
    caption?: string;
  } | null;
  /** Set false to get plain text only (website widget, tests). Defaults to true. */
  enableInteractive?: boolean;
  uiSink?: AcrioUiSink;
}

export const ACRIO_TEAM_ASK_TEXT = "How would you like to connect with our team?";

export function buildTeamConnectInteractive(): AcrioInteractive {
  return {
    kind: "buttons",
    promptText: ACRIO_TEAM_ASK_TEXT,
    buttons: [
      { id: "acrio:team:chat", title: "Chat with team" },
      { id: "acrio:team:callback", title: "Request a callback" },
      { id: "acrio:menu:keep", title: "Keep browsing" },
    ],
  };
}

export function buildCallbackSlotInteractive(): AcrioInteractive {
  return {
    kind: "buttons",
    promptText: "When should we call you?",
    buttons: [
      { id: "acrio:cb:morning", title: "Morning 10-1" },
      { id: "acrio:cb:afternoon", title: "Afternoon 2-5" },
      { id: "acrio:cb:evening", title: "Evening 5-8" },
    ],
  };
}

function productRowDescription(it: MainWebsiteProduct, hidePrices: boolean): string {
  const dims = it.dimensions || [];
  const h = dims.find((d) => /height/i.test(d.label || d.key || ""))?.value;
  const top = dims.find((d) => /top|size|working|bending/i.test(d.label || d.key || ""))?.value;
  const price =
    !hidePrices && typeof it.basePrice === "number" && it.basePrice > 0
      ? `₹${it.basePrice.toLocaleString("en-IN")}`
      : "";
  const size = [h ? `H ${h}` : "", top ? `Top ${top}` : ""].filter(Boolean).join(" | ");
  const text = [price, size].filter(Boolean).join(" | ").replace(/["”“]/g, "").replace(/\s*Inches?/gi, "");
  return clip(text || (it.specsSummary || it.categoryName || ""), 72);
}

export function buildProductListInteractive(
  items: MainWebsiteProduct[],
  hidePrices: boolean
): AcrioInteractive {
  const rows = items.slice(0, 10).map((it) => ({
    id: `acrio:prod:${it.slug}`,
    title: clip(cleanDisplayProductName(it.name), 24),
    description: productRowDescription(it, hidePrices),
  }));
  return {
    kind: "list",
    buttonLabel: "View options",
    sectionTitle: "Matching products",
    rows,
    promptText: "Tap View options to choose a product.",
  };
}

const ACRIO_KEEP_TEXT_RE =
  /\b(cheapest|costliest|most\s+expensive|cheaper|premium|best|compare|comparison|which\s+one|suggest|recommend|difference|better|vs)\b/i;

/** Decides whether a finished reply should carry buttons or a "View options" list. */
function decorateAcrioReplyWithInteractive(
  res: AcrioAutonomousTurnResult,
  sink: AcrioUiSink,
  inboundText: string
): Partial<AcrioAutonomousTurnResult> | null {
  const hindi = /HIND/i.test(sink.languageMode || "");

  // Bulk / project quote already pinged to the team: offer the two ways to reach them.
  if (res.needsSalesTeamPing) {
    return { interactive: buildTeamConnectInteractive() };
  }

  if (
    sink.aggregate ||
    sink.multiItem ||
    (res.mediaAttachments && res.mediaAttachments.length > 0) ||
    isProductImageRequest(inboundText) ||
    extractNormalizedColourTokens(inboundText).length > 0
  ) {
    return null;
  }

  // One product under discussion: offer next steps.
  if (sink.focus) {
    return {
      interactive: {
        kind: "buttons",
        promptText: "What would you like to do next?",
        buttons: [
          { id: "acrio:team:ask", title: "Get a quote" },
          { id: "acrio:more", title: "More options" },
        ],
      },
    };
  }

  // Larger list: short intro + "View options" list the customer can open and pick from.
  const requiresLookup = sink.intent === "PRODUCT_SEARCH" || sink.intent === "FOLLOW_UP_REFINEMENT";
  if (
    requiresLookup &&
    sink.matches.length >= 4 &&
    !(sink.explicitCodes && sink.explicitCodes > 0) &&
    !ACRIO_KEEP_TEXT_RE.test(inboundText)
  ) {
    // Put products whose names match the nouns the customer used (chair, stool, table...) first.
    const stop = new Set(["have", "show", "need", "want", "some", "what", "your", "with", "that", "this", "there", "options", "please", "looking", "about", "from", "under", "below", "above"]);
    const nouns = (inboundText.toLowerCase().match(/[a-z]{4,}/g) || [])
      .filter((w) => !stop.has(w))
      .map((w) => w.replace(/(es|s)$/, ""));
    const nameMatches = (it: MainWebsiteProduct) =>
      nouns.some((n) => n.length >= 3 && (it.name || "").toLowerCase().includes(n));
    const ordered = nouns.length
      ? [...sink.matches.filter(nameMatches), ...sink.matches.filter((it) => !nameMatches(it))]
      : sink.matches;
    const interactive = buildProductListInteractive(ordered, Boolean(sink.hidePrices));
    const n = interactive.kind === "list" ? interactive.rows.length : sink.matches.length;
    const mentionsBudget = /\d|\blacs?\b|\blakhs?\b|\bcrore\b|\bk\b|budget/i.test(inboundText);
    const budget = sink.budgetLabel && !sink.hidePrices && mentionsBudget ? ` (${sink.budgetLabel})` : "";
    const intro = hindi
      ? `Aapke liye ${n} options mile hain${budget}. Neeche *View options* dabaiye aur apna pasand ka product chuniye, phir main poori detail bataunga.`
      : `I found ${n} options for you${budget}.\n\nTap *View options* below, pick one, and I will share its full details.`;
    return { customerReply: intro, interactive };
  }
  return null;
}

/**
 * Public entry point. Runs the ACRIO brain, then adds WhatsApp buttons / "View options" lists
 * where they help the customer (long lists, next steps, connecting with the team).
 */
export async function runAcrioAutonomousTurn(
  params: AcrioTurnParams
): Promise<AcrioAutonomousTurnResult> {
  const sink: AcrioUiSink = params.uiSink || { matches: [] };
  const res = await runAcrioAutonomousTurnCore({ ...params, uiSink: sink });
  if (params.enableInteractive === false || res.needsHumanHandoff || res.interactive) return res;
  try {
    const extra = decorateAcrioReplyWithInteractive(res, sink, params.inboundText);
    if (extra?.interactive?.kind === "list" && res.conversationState) {
      res.conversationState.lastListedSlugs = extra.interactive.rows.map((r) => r.id.replace(/^acrio:prod:/, ""));
      await saveConversationAiState(params.conversationId, res.conversationState);
    }
    return extra ? { ...res, ...extra } : res;
  } catch {
    return res;
  }
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
async function runAcrioAutonomousTurnCore(
  params: AcrioTurnParams
): Promise<AcrioAutonomousTurnResult> {
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
  const rawFirstToken = (params.customerName || "").split(/[\s(]/)[0] || "";
  const firstName =
    !rawFirstToken || /^[\d+\s()+.-]+$/.test(rawFirstToken) ? "there" : rawFirstToken;

  const history = (params.recentMessages || []).filter(
    (m) =>
      (m.direction === "INBOUND" || m.direction === "OUTBOUND") &&
      Boolean(String(m.body || "").trim())
  );

  const alreadyGreeted =
    Boolean(params.hasAlreadyGreeted) ||
    history.some((m) => m.direction === "OUTBOUND");

  const storedState =
    params.persistedState !== undefined
      ? params.persistedState
      : await loadConversationAiState(params.conversationId);

  // 0. Route PDFs, Documents, Audio, Video, or unclear Images/Attachments directly to the human team
  const attType = String(params.attachment?.mediaType || "").toUpperCase();
  const attName = String(params.attachment?.filename || "").trim();
  const isMediaPlaceholder = /^\[(?:image|photo|video|document|pdf|file|audio|voice\s*note|sticker)\b/i.test(rawText);
  const hasExplicitProductCodeWithImage =
    attType === "IMAGE" &&
    !isMediaPlaceholder &&
    (extractExplicitProductOrModelCodes(rawText).length > 0 ||
      Boolean(params.forcedFocusSlug));
  const shouldRouteAttachmentToTeam =
    (Boolean(params.attachment) &&
      (attType === "DOCUMENT" ||
        attType === "VIDEO" ||
        attType === "AUDIO" ||
        (attType === "IMAGE" && !hasExplicitProductCodeWithImage))) ||
    isMediaPlaceholder;

  if (shouldRouteAttachmentToTeam) {
    const fileLabel = attName
      ? `*${attName}*`
      : attType === "DOCUMENT"
      ? "your PDF / document"
      : attType === "VIDEO"
      ? "your video"
      : attType === "AUDIO"
      ? "your voice note / audio"
      : "your attachment";
    const greetLine = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
    const routeReply = formatWhatsAppOutboundText(
      `${greetLine}Thank you for sharing ${fileLabel}. I have forwarded this directly to our team so a specialist can review it and reply to you right away.`
    );
    const phState = reconstructAcrioConversationState({
      persistedState: storedState,
      recentMessages: history,
      currentInboundText: rawText,
    });
    await saveConversationAiState(params.conversationId, phState);
    const handoffReason = `Customer shared ${attName || attType || "an attachment"} (${rawText.slice(0, 100)}) which needs team review.`;
    addStep("Routed attachment directly to team", handoffReason);
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: rawText,
      model: "rule-attachment-team-handoff",
      outcomeSource: "HUMAN_HANDOFF",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: "BYPASS",
      cacheDetails: `Attachment (${attType || "FILE"}) routed directly to human team`,
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupBudget: null,
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: routeReply,
      durationMs: Date.now() - started,
    });
    return {
      needsHumanHandoff: true,
      handoffReason,
      customerReply: routeReply,
      smartCategory: phState.activeCategory || "Custom Fabrication",
      priority: "HIGH",
      conversationState: phState,
    };
  }

  // Handle non-text "[Message]" fallback deterministically
  if (/^\[message\]$/i.test(rawText)) {
    const greetLine = alreadyGreeted ? "" : `Hi ${firstName}, welcome to *Classic Concepts*!\n\n`;
    const placeholderReply = `${greetLine}What are you looking to explore today?\n1. *Acrylic Podiums & Pulpits* for stages, auditoriums, or classrooms\n2. *Acrylic Furniture, Chairs & Tables* for interiors or events\n3. *Signages, Trophies & Custom Boxes*\n4. *Classic Edge 53 Machines* for acrylic bending and polishing\n\nReply with *1*, *2*, *3*, *4*, or a model code to get started!`;
    const formattedPlaceholder = formatWhatsAppOutboundText(placeholderReply);
    const phState = reconstructAcrioConversationState({
      persistedState: storedState,
      recentMessages: history,
      currentInboundText: rawText,
    });
    await saveConversationAiState(params.conversationId, phState);
    addStep("Handled non-text webhook placeholder", `placeholder="${rawText}"`);
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: rawText,
      model: "rule-webhook-placeholder",
      outcomeSource: "LIVE_AI",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: "BYPASS",
      cacheDetails: `Deterministic reply for webhook placeholder ${rawText}`,
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupBudget: null,
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: formattedPlaceholder,
      durationMs: Date.now() - started,
    });
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      customerReply: formattedPlaceholder,
      smartCategory: phState.activeCategory || "General Enquiry",
      priority: "NORMAL",
      conversationState: phState,
    };
  }

  const recentInboundWindow = [
    ...history
      .filter((m) => m.direction === "INBOUND")
      .slice(-4)
      .map((m) => m.body),
    rawText,
  ].join(" ");
  const contextLower = recentInboundWindow.toLowerCase();

  // Resolve any quoted / replied-to message from params.replyToMessage or the latest inbound message in history
  const latestInboundInHistory = [...history].reverse().find((m) => m.direction === "INBOUND");
  const quotedReplyContext: AcrioReplyToMessageContext | null =
    params.replyToMessage ||
    (latestInboundInHistory && latestInboundInHistory.body.trim() === rawText
      ? latestInboundInHistory.replyTo || null
      : null);
  const quotedBody = String(quotedReplyContext?.body || "").trim();

  // 1. Classify turn intent BEFORE any catalog fetch or product lookup (Phase A)
  let intentInfo = classifyAcrioInboundIntent(
    rawText,
    history.length > 0 || Boolean(storedState?.turnCount) || Boolean(quotedReplyContext)
  );

  // 1a. "the first one" / "option 2" / "the cheaper one": the customer is picking from the list we just sent (or a quoted list).
  // Resolve it from the links in the quoted message or our last outbound message, and make sure it is treated as a product follow-up.
  const outboundBodies = history
    .filter((m) => m.direction === "OUTBOUND")
    .map((m) => String(m.body || ""))
    .reverse();
  const countAcrioLinks = (b: string) =>
    new Set(b.match(/https?:\/\/ccapl\.cc\/[^\s)*>]+/gi) || []).size;
  // If customer quoted a specific message with links, prefer that message; otherwise use latest multi-link outbound message.
  const lastOutboundBody =
    quotedBody && countAcrioLinks(quotedBody) >= 1
      ? quotedBody
      : countAcrioLinks(outboundBodies[0] || "") >= 2
      ? outboundBodies[0]
      : outboundBodies.slice(1, 4).find((b) => countAcrioLinks(b) >= 2) || outboundBodies[0] || "";
  const hasListPickWording = isListPickText(rawText);
  if (
    hasListPickWording &&
    (/https?:\/\/ccapl\.cc\//i.test(lastOutboundBody) || /View options/i.test(outboundBodies[0] || "") || Boolean(quotedBody)) &&
    !intentInfo.needsImmediateHandoff &&
    intentInfo.intent !== "TOPIC_RESET" &&
    intentInfo.intent !== "HUMAN_HANDOFF_REQUEST"
  ) {
    intentInfo = {
      ...intentInfo,
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      reason: "Customer picked an item from the list we sent",
    };
  }
  if (params.forcedFocusSlug) {
    intentInfo = {
      ...intentInfo,
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      needsImmediateHandoff: false,
      reason: "Customer tapped a product in the View options list",
    };
  }
  // If customer quoted/replied to an earlier message OR sent a short follow-up while an active product is in memory,
  // upgrade CONVERSATIONAL_FOLLOWUP to FOLLOW_UP_REFINEMENT so product context is never dropped!
  const hasActiveProductMemory = Boolean(
    storedState?.focusProductSlug ||
      (storedState?.lastRecommendedProducts && storedState.lastRecommendedProducts.length > 0) ||
      storedState?.primaryProductQuery ||
      quotedReplyContext?.productSlug ||
      (quotedBody && (/https?:\/\/ccapl\.cc\//i.test(quotedBody) || extractExplicitProductOrModelCodes(quotedBody).length > 0))
  );
  if (
    intentInfo.intent === "CONVERSATIONAL_FOLLOWUP" &&
    (Boolean(quotedReplyContext) || (hasActiveProductMemory && rawText.split(/\s+/).length <= 12))
  ) {
    intentInfo = {
      ...intentInfo,
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      reason: quotedReplyContext
        ? "Customer quoted/replied directly to an earlier message"
        : "Short follow-up continuation on active product context",
    };
  }

  // 1a-2. "Talk to a person": offer Chat / Callback buttons first (unless we just asked, then hand off directly).
  if (
    intentInfo.intent === "HUMAN_HANDOFF_REQUEST" &&
    params.enableInteractive !== false &&
    !String(outboundBodies[0] || "").includes(ACRIO_TEAM_ASK_TEXT) &&
    !String(lastOutboundBody || "").includes(ACRIO_TEAM_ASK_TEXT)
  ) {
    const firstNameForAsk = firstName;
    const askReply = `Sure ${firstNameForAsk}, happy to connect you with our team.\n\n${ACRIO_TEAM_ASK_TEXT}`;
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: rawText,
      model: "rule-team-connect-choice",
      outcomeSource: "LIVE_AI",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: "BYPASS",
      cacheDetails: "Offered Chat with team / Request a callback buttons",
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupBudget: null,
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: askReply,
      durationMs: Date.now() - started,
    });
    const askState = reconstructAcrioConversationState({
      persistedState: params.persistedState !== undefined ? params.persistedState : await loadConversationAiState(params.conversationId),
      recentMessages: history,
      currentInboundText: rawText,
    });
    await saveConversationAiState(params.conversationId, askState);
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      customerReply: askReply,
      smartCategory: "General Enquiry",
      priority: "HIGH",
      conversationState: askState,
      interactive: buildTeamConnectInteractive(),
    };
  }

  // 1b. Reconstruct & update structured per-conversation state (Phase B)
  const convState = reconstructAcrioConversationState({
    persistedState: storedState,
    recentMessages: history,
    currentInboundText: rawText,
  });

  if (intentInfo.intent === "TOPIC_RESET") {
    await saveConversationAiState(params.conversationId, convState);
  }

  addStep(
    "Loaded conversation context & state",
    `historyTurns=${history.length}, alreadyGreeted=${alreadyGreeted}, activeProduct="${convState.primaryProductQuery || "none"}", maxPrice=${convState.maxPrice ?? "none"}, prefs=[${convState.preferences.join(",")}]`
  );

  addStep(
    "Classified inbound turn intent",
    `intent=${intentInfo.intent}, requiresProductLookup=${intentInfo.requiresProductLookup}, allowRollingFallback=${intentInfo.allowRollingContextFallback} (${intentInfo.reason})`
  );

  // 2. Immediate deterministic handoff for explicit human requests, support issues, or order tracking
  if (intentInfo.needsImmediateHandoff) {
    let reply = "";
    let reason = "";
    let outPri: "URGENT" | "HIGH" | "NORMAL" = "HIGH";
    let outCat = convState.activeCategory || "General Enquiry";

    const stateParts: string[] = [];
    if (convState.primaryProductQuery) {
      stateParts.push(`product: ${convState.primaryProductQuery}`);
    }
    if (convState.maxPrice !== null && convState.minPrice !== null) {
      stateParts.push(
        `budget: ₹${convState.minPrice.toLocaleString("en-IN")} to ₹${convState.maxPrice.toLocaleString("en-IN")}`
      );
    } else if (convState.maxPrice !== null) {
      stateParts.push(`budget: up to ₹${convState.maxPrice.toLocaleString("en-IN")}`);
    } else if (convState.minPrice !== null) {
      stateParts.push(`budget: from ₹${convState.minPrice.toLocaleString("en-IN")}`);
    }
    if (convState.preferences.length > 0) {
      stateParts.push(`preferences: ${convState.preferences.join(", ")}`);
    }
    if (convState.dimensionsOrThickness) {
      stateParts.push(`size/thickness: ${convState.dimensionsOrThickness}`);
    }
    if (convState.quantity) {
      stateParts.push(`qty: ${convState.quantity}`);
    }
    const stateContextNote =
      stateParts.length > 0 ? ` • Context: ${stateParts.join(", ")}` : "";

    if (intentInfo.intent === "HUMAN_HANDOFF_REQUEST") {
      reply = alreadyGreeted
        ? `Sure, I am connecting you to our *Sales Team* right away.\n\nA team member will pick up this chat from here and help you shortly.`
        : `Hi ${firstName}! Connecting you to our *Sales Team* right away.\n\nA team member will reply to you here shortly.`;
      reason = `Customer asked to speak with our team ("${rawText.slice(0, 120)}")${stateContextNote}.`;
    } else if (intentInfo.intent === "SUPPORT_ISSUE") {
      reply = alreadyGreeted
        ? `I have flagged this directly for our *Sales & Support Team* so a senior team member can check it personally and resolve it for you right away.`
        : `Hi ${firstName}, I am connecting your chat directly to our *Sales & Support Team* so they can check this personally and help you right away.`;
      reason = `Query needs personal assistance from Sales Team ("${rawText.slice(0, 120)}")${stateContextNote}.`;
      outPri = "URGENT";
    } else {
      const trackOrigin = resolvePublicTrackingOrigin();
      reply = alreadyGreeted
        ? `You can check live courier status anytime on our tracking portal:\n${trackOrigin}\n\nI am also connecting our *Sales Team* here so they can verify your dispatch details personally.`
        : `Hi ${firstName}, you can check live courier status anytime here:\n${trackOrigin}\n\nI am also connecting our *Sales Team* so they can check your order status personally.`;
      reason = `Customer asked about a specific order ("${rawText.slice(0, 120)}")${stateContextNote}.`;
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
      conversationState: convState,
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
  let pinnedFocusItem: MainWebsiteProduct | null = null;
  let aggregateResult: { answer: string; items: MainWebsiteProduct[] } | null = null;
  let top: MainWebsiteProduct | undefined;
  let budgetFallbackLowestPrice: number | null = null;
  let budgetFallbackLowestItem: MainWebsiteProduct | null = null;

  const fetchedCatalog = await getCachedEcosystemCatalog();
  allItems = fetchedCatalog.allItems;
  const [liveOperationalContext, trainingGuidance] = await Promise.all([
    loadLiveDatabaseOperationalContext({
      customerPhone: params.customerPhone,
      customerName: params.customerName,
      rawQuery: rawText,
      forStaffCopilot: false,
    }),
    findMatchingAiTrainingGuidance({
      queryText: rawText,
      scope: "CUSTOMER_CHAT",
      activeProductSlug: convState.focusProductSlug,
    }).catch(() => ({ rules: [], examples: [], promptBlock: "" })),
  ]);

  // Build shortlink map for multi-item project planner
  const shortLinkMap: Record<string, string> = {};
  for (const it of allItems) {
    const u = it.shortUrl || it.url;
    if (u) {
      shortLinkMap[`product:${it.slug}`.toLowerCase()] = u;
      shortLinkMap[`product:${it.id}`.toLowerCase()] = u;
    }
  }
  const projectPlan = buildMultiItemProjectPlan(allItems, rawText, shortLinkMap);
  const customerProfileInfo = detectAcrioCustomerProfile(rawText, recentInboundWindow);

  // If MENU_SELECTION ("1", "2") and lastMenuOptions wasn't populated, inspect last outbound message for numbered list items!
  if (intentInfo.intent === "MENU_SELECTION") {
    const lastOutbound = [...history].reverse().find((m) => m.direction === "OUTBOUND")?.body || "";
    const numMatch = rawText.trim().match(/^[\s*#]*(?:option\s*|category\s*|number\s*|no\.?\s*)?([1-5])[\s.)*]*$/i);
    const chosenNum = numMatch ? parseInt(numMatch[1], 10) : 1;
    const lineRegex = new RegExp(`(?:^|\\n)\\s*${chosenNum}[.)]\\s*\\*?([^\\n(*:]+)\\*?`, "i");
    const mLine = lastOutbound.match(lineRegex);
    if (mLine && mLine[1]) {
      const extractedOptionTitle = mLine[1].trim();
      convState.primaryProductQuery = extractedOptionTitle;
      if (/essential|signature|premium|custom[-\s]*built|podium/i.test(extractedOptionTitle)) {
        convState.productFamily = "podium";
        convState.activeCategory = "Podiums & Stage";
        convState.activeBrand = "CLASSIC_CONCEPTS";
      }
    }
  }

  if (intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling) {
    cacheMeta = fetchedCatalog.cacheMeta;
    addStep("Checked ecosystem catalog cache", cacheMeta.cacheSummary);

    const normalizedSearch = buildNormalizedSearchFromState(convState, rawText);
    usedLookupQuery = normalizedSearch.searchQuery;
    budgetLabel = normalizedSearch.budgetLabel;

    const prevMaxPrice = storedState?.maxPrice ?? null;
    const explicitCodesInTurn = extractExplicitProductOrModelCodes(rawText);
    const dimsInTurn = extractCompactDimensionPairsFromText(rawText);
    const hasExplicitCodeOrDimInTurn =
      explicitCodesInTurn.length > 0 ||
      dimsInTurn.pairs.length > 0 ||
      dimsInTurn.ranges.length > 0;
    const budgetChangedInTurn = prevMaxPrice !== convState.maxPrice;

    // Resolve the product the customer is currently talking about (survives across turns, and prioritizes quoted/replied-to messages!).
    const findItemBySlug = (slug?: string | null) =>
      slug ? allItems.find((it) => (it.slug || "").toLowerCase() === slug.toLowerCase()) : undefined;

    let quotedFocusItem: MainWebsiteProduct | undefined;
    let quotedMultipleItems: MainWebsiteProduct[] = [];
    if (quotedReplyContext) {
      if (quotedReplyContext.productSlug) {
        quotedFocusItem = findItemBySlug(quotedReplyContext.productSlug);
      }
      if (!quotedFocusItem && quotedBody) {
        const fromLinks = resolveProductsFromOutboundText(quotedBody, allItems);
        if (fromLinks.length === 1) {
          quotedFocusItem = fromLinks[0];
        } else if (fromLinks.length >= 2) {
          quotedMultipleItems = fromLinks;
        } else {
          const qCodes = extractExplicitProductOrModelCodes(quotedBody);
          if (qCodes.length === 1) {
            quotedFocusItem = allItems.find((it) =>
              `${it.sku || ""} ${it.slug}`
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "")
                .includes(qCodes[0].toLowerCase().replace(/[^a-z0-9]/g, ""))
            );
          }
        }
      }
    }

    let focusItem = quotedFocusItem || findItemBySlug(convState.focusProductSlug);
    if (
      !focusItem &&
      !convState.switchedThisTurn &&
      !hasExplicitCodeOrDimInTurn &&
      !isMultiProductReference(rawText) &&
      !ACRIO_DOMAIN_PRODUCT_NOUN_RE.test(lower)
    ) {
      // Derive from earlier customer turns ONLY when this turn did NOT introduce a new product or SKU!
      const priorInbound = history.filter((m) => m.direction === "INBOUND").map((m) => m.body);
      for (let i = priorInbound.length - 1; i >= 0 && !focusItem; i--) {
        const codes = extractExplicitProductOrModelCodes(priorInbound[i]);
        if (codes.length === 1) {
          focusItem = allItems.find((it) =>
            `${it.sku || ""} ${it.slug}`.toLowerCase().replace(/[^a-z0-9]/g, "").includes(codes[0].toLowerCase().replace(/[^a-z0-9]/g, ""))
          );
        }
      }
      // Or if the previous turn recommended a single product, use it when the customer asks for "its images" / "this model" / short continuation.
      if (
        !focusItem &&
        convState.lastRecommendedProducts.length === 1 &&
        (isProductImageRequest(rawText) || rawText.split(/\s+/).length <= 8)
      ) {
        focusItem = findItemBySlug(convState.lastRecommendedProducts[0].slug);
      }
    }

    aggregateResult = buildCatalogAggregateAnswer(allItems, rawText);
    const listPickItem =
      (quotedBody ? resolveListPickFromLastReply(rawText, quotedBody, allItems) : null) ||
      resolveListPickFromLastReply(rawText, lastOutboundBody, allItems) ||
      (isListPickText(rawText) && (storedState?.lastListedSlugs || []).length > 0 && /View options/i.test(outboundBodies[0] || "")
        ? (() => {
            const slugs = storedState!.lastListedSlugs!;
            const t = rawText.toLowerCase();
            const word = t.match(/\b(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\b/)?.[1];
            const num = t.match(/(?:option|number|no\.?|#)\s*([1-9])\b/)?.[1] || t.match(/^\s*([1-9])[\s.)!]*$/)?.[1];
            let idx = -2;
            if (word) idx = ACRIO_ORDINALS[word];
            else if (num) idx = parseInt(num, 10) - 1;
            const slug = idx === -1 ? slugs[slugs.length - 1] : idx >= 0 ? slugs[idx] : undefined;
            return slug ? findItemBySlug(slug) || null : null;
          })()
        : null);
    const forcedItem = findItemBySlug(params.forcedFocusSlug);
    if (forcedItem) {
      pinnedFocusItem = forcedItem;
      contextMatches = [forcedItem];
      addStep("Opened product from list", `Customer tapped "${forcedItem.name}" in View options`);
    } else if (aggregateResult && !projectPlan.isMultiItemOrTotalling) {
      contextMatches = aggregateResult.items;
    } else if (listPickItem && !projectPlan.isMultiItemOrTotalling) {
      pinnedFocusItem = listPickItem;
      contextMatches = [listPickItem];
      addStep("Resolved list pick", `Customer picked "${listPickItem.name}" from the list we just sent`);
    } else if (
      focusItem &&
      !projectPlan.isMultiItemOrTotalling &&
      isFocusedProductFollowUp(rawText, focusItem, Boolean(quotedFocusItem))
    ) {
      pinnedFocusItem = focusItem;
      contextMatches = [focusItem];
      addStep(
        "Pinned focus product",
        quotedFocusItem
          ? `Customer quoted/replied directly to "${focusItem.name}"`
          : `Follow-up refers to "${focusItem.name}" (kept from earlier in the chat)`
      );
    } else if (quotedMultipleItems.length >= 2 && !hasExplicitCodeOrDimInTurn) {
      contextMatches = quotedMultipleItems;
      addStep("Resolved products from quoted message", `matched=${quotedMultipleItems.length} products from quoted reply`);
    } else if (projectPlan.isMultiItemOrTotalling && projectPlan.matchedProducts.length > 0) {
      contextMatches = projectPlan.matchedProducts;
    } else if (intentInfo.intent === "MENU_SELECTION" && /essential\s*podium/i.test(convState.primaryProductQuery || "")) {
      contextMatches = allItems
        .filter(
          (it) =>
            it.brand === "CLASSIC_CONCEPTS" &&
            ((it.podiumSubCategoryNames || []).some((s) => /essential/i.test(s)) ||
              /\b(ccp057s|ccp054|ccp057|ccp058|ccp060)\b/i.test(it.sku || it.name))
        )
        .sort((a, b) => (a.basePrice || 999999) - (b.basePrice || 999999))
        .slice(0, 6);
    } else if (intentInfo.intent === "MENU_SELECTION" && /signature\s*podium/i.test(convState.primaryProductQuery || "")) {
      contextMatches = allItems
        .filter(
          (it) =>
            it.brand === "CLASSIC_CONCEPTS" &&
            (it.podiumSubCategoryNames || []).some((s) => /signature/i.test(s))
        )
        .sort((a, b) => (a.basePrice || 999999) - (b.basePrice || 999999))
        .slice(0, 6);
    } else if (intentInfo.intent === "MENU_SELECTION" && /premium\s*podium/i.test(convState.primaryProductQuery || "")) {
      contextMatches = allItems
        .filter(
          (it) =>
            it.brand === "CLASSIC_CONCEPTS" &&
            (it.podiumSubCategoryNames || []).some((s) => /premium/i.test(s))
        )
        .sort((a, b) => (b.basePrice || 0) - (a.basePrice || 0))
        .slice(0, 6);
    } else if (
      !hasExplicitCodeOrDimInTurn &&
      !budgetChangedInTurn &&
      convState.lastRecommendedProducts.length > 0 &&
      (intentInfo.intent === "PRODUCT_COMPARISON" ||
        intentInfo.intent === "FOLLOW_UP_REFINEMENT") &&
      (isMultiProductReference(rawText) ||
        /\b(first\s*two|top\s*two|both|these|those|them|which\s+one|which\s+of\s+these|wider|widest|larger|largest|bigger|biggest|taller|tallest|reading\s*top|top\s*sheet|dimension|dimensions|spec|specs|specification|specifications|variant|variants|color|colors|colour|colours|feature|features|pillar|pillars|warranty)\b/i.test(
          rawText
        )) &&
      !(
        extractNormalizedColourTokens(rawText).length > 0 &&
        /\b(podiums|pulpits|lecterns|chairs|tables|stands|trophies|awards|boxes|models|options|products|have|with)\b/i.test(
          rawText
        )
      ) &&
      !/\b(any\s*more|more\s*options|other\s*options|cheaper\s*alternative|smaller\s*top|save\s*more)\b/i.test(rawText)
    ) {
      // First check if the last outbound message explicitly listed products (e.g. CCP053, CCP060, CCP055)
      const outboundListed = resolveProductsFromOutboundText(
        outboundBodies[0] || lastOutboundBody,
        allItems
      );
      if (isMultiProductReference(rawText) && outboundListed.length >= 2) {
        const sliceCount = /\b(first\s*two|top\s*two|both|these\s*two|those\s*two)\b/i.test(
          rawText
        )
          ? 2
          : /\b(all\s*three|these\s*three|those\s*three|three)\b/i.test(rawText)
          ? 3
          : outboundListed.length;
        contextMatches = outboundListed.slice(0, sliceCount);
      } else {
        const sliceCount = /\b(first\s*two|top\s*two|both|these\s*two|those\s*two)\b/i.test(
          rawText
        )
          ? 2
          : convState.lastRecommendedProducts.length;
        const targetSlugs = new Set(
          convState.lastRecommendedProducts
            .slice(0, sliceCount)
            .map((p) => p.slug || p.id)
        );
        contextMatches = allItems.filter((it) =>
          targetSlugs.has(it.slug || it.id)
        );
      }
    }

    // If the customer is searching across a category for a specific colour/variant (e.g. "podiums with frost white color" or "podiums that have frosted white variant"), prioritize products that actually have that variant!
    if (
      !pinnedFocusItem &&
      !hasExplicitCodeOrDimInTurn &&
      extractNormalizedColourTokens(rawText).length > 0
    ) {
      const variantCatalogHits = findCatalogProductsByVariantTokens(
        allItems,
        rawText,
        convState.productFamily
      );
      if (variantCatalogHits.length > 0) {
        contextMatches = variantCatalogHits.map((h) => h.item).slice(0, 8);
        addStep(
          "Filtered catalog by variant colour tokens",
          `tokens=[${extractNormalizedColourTokens(rawText).join(",")}], matched=${variantCatalogHits.length} (${contextMatches.slice(0, 4).map((m) => m.sku || m.slug).join(", ")})`
        );
      }
    }

    if (contextMatches.length === 0) {
      const budgetRaised =
        prevMaxPrice !== null &&
        convState.maxPrice !== null &&
        convState.maxPrice > prevMaxPrice;
      const rawMatches = searchEcosystemItems(
        allItems,
        usedLookupQuery,
        budgetRaised ? 16 : 12,
        normalizedSearch.searchOptions
      );
      if (budgetRaised) {
        const newlyUnlocked = rawMatches.filter(
          (it) => typeof it.basePrice === "number" && it.basePrice > prevMaxPrice
        );
        const existingTier = rawMatches.filter(
          (it) => !(typeof it.basePrice === "number" && it.basePrice > prevMaxPrice)
        );
        contextMatches = [...newlyUnlocked, ...existingTier].slice(0, 12);
      } else {
        contextMatches = rawMatches;
      }
    }

    if (usedLookupQuery !== rawText) {
      const directFallback = searchEcosystemItems(
        allItems,
        rawText,
        12,
        normalizedSearch.searchOptions
      );
      if (contextMatches.length === 0 && directFallback.length > 0) {
        contextMatches = directFallback;
        usedLookupQuery = rawText;
      } else if (hasExplicitCodeOrDimInTurn && directFallback.length > 0) {
        const seen = new Set<string>();
        contextMatches = [...directFallback, ...contextMatches]
          .filter((it) => {
            const k = `${it.brand}:${it.slug || it.id}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .slice(0, 12);
      }
    }

    if (
      contextMatches.length === 0 &&
      (convState.maxPrice !== null || convState.minPrice !== null)
    ) {
      const fbInfo = getEcosystemBudgetFallbackInfo(
        allItems,
        usedLookupQuery,
        normalizedSearch.searchOptions
      );
      budgetFallbackLowestPrice = fbInfo.lowestAvailablePrice;
      budgetFallbackLowestItem = fbInfo.lowestAvailableItem;
    }

    top = contextMatches[0];

    // Remember the single product under discussion so the next message ("this model", "its price") stays on it.
    if (pinnedFocusItem) {
      convState.focusProductSlug = pinnedFocusItem.slug;
    } else if (explicitCodesInTurn.length === 1 && contextMatches.length > 0) {
      const codeKey = explicitCodesInTurn[0].toLowerCase().replace(/[^a-z0-9]/g, "");
      const exact = contextMatches.find((it) =>
        `${it.sku || ""} ${it.slug}`.toLowerCase().replace(/[^a-z0-9]/g, "").includes(codeKey)
      );
      convState.focusProductSlug = (exact || contextMatches[0]).slug;
      top = exact || top;
    } else if (contextMatches.length === 1) {
      convState.focusProductSlug = contextMatches[0].slug;
    } else if (explicitCodesInTurn.length >= 2 || (contextMatches.length > 1 && !aggregateResult)) {
      convState.focusProductSlug = null;
    }

    if (params.uiSink) {
      const focusForUi = convState.focusProductSlug
        ? allItems.find((it) => (it.slug || "").toLowerCase() === String(convState.focusProductSlug).toLowerCase()) || null
        : null;
      Object.assign(params.uiSink, {
        intent: intentInfo.intent,
        matches: contextMatches,
        focus: focusForUi,
        aggregate: Boolean(aggregateResult),
        multiItem: Boolean(projectPlan.isMultiItemOrTotalling),
        explicitCodes: explicitCodesInTurn.length,
        budgetLabel,
        languageMode: convState.languageMode,
      });
    }

    if (contextMatches.length > 0) {
      convState.lastRecommendedProducts = contextMatches.slice(0, 5).map((it) => ({
        id: it.id,
        name: cleanDisplayProductName(it.name),
        slug: it.slug,
        priceInr: it.basePrice,
        shortUrl: it.shortUrl || it.url,
        itemType: it.itemType,
      }));
      const mergedShown = new Set([
        ...(convState.shownProductSlugs || []),
        ...contextMatches.slice(0, 3).map((it) => (it.slug || "").toLowerCase()).filter(Boolean),
      ]);
      convState.shownProductSlugs = Array.from(mergedShown).slice(-18);
    }
    await saveConversationAiState(params.conversationId, convState);

    addStep(
      "Executed catalog product lookup",
      `query="${usedLookupQuery.slice(0, 90)}"${budgetLabel ? `, budget="${budgetLabel}"` : ""}${convState.excludedItemTypes.length ? `, excluded=[${convState.excludedItemTypes.join(",")}]` : ""}, matched=${contextMatches.length} of ${allItems.length} items`
    );
  } else {
    await saveConversationAiState(params.conversationId, convState);
    addStep(
      "Skipped catalog product lookup",
      `Non-product turn (${intentInfo.intent})`
    );
  }

  let smartCategory = convState.activeCategory || "General Enquiry";
  let priority: "URGENT" | "HIGH" | "NORMAL" = "NORMAL";

  if (intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling) {
    const classificationProbe = `${convState.primaryProductQuery || ""} ${rawText}`.toLowerCase();
    if (
      convState.activeCategory === "Acrylic Machines (CE53)" ||
      /machine|laser|router|polish|diamond|bending|bender|heater|yn-|ce53|classic edge|consumable|blade|cutter|flame|buffing|cloudy\s*edge|rough\s*edge/i.test(
        classificationProbe
      )
    ) {
      smartCategory = "Acrylic Machines (CE53)";
      priority = "HIGH";
    } else if (
      convState.activeCategory === "Podiums & Stage" ||
      /podium|podiums|lectern|lecterns|pulpit|pulpits|rostrum|stage|auditorium|conference/i.test(
        classificationProbe
      )
    ) {
      smartCategory = "Podiums & Stage";
      priority = /friday|urgent|tomorrow|today/i.test(lower) ? "URGENT" : "HIGH";
    } else if (
      convState.activeCategory === "Awards & Trophies" ||
      /trophy|trophies|memento|award|student|convocation|plaque|gift|corporate\s*clients?/i.test(classificationProbe)
    ) {
      smartCategory = "Awards & Trophies";
    } else if (
      convState.activeCategory === "Hotel & Banquet" ||
      /hotel|banquet|menu|qr|resort|hospitality|tent\s*card|table\s*stand|sign\s*holder/i.test(
        classificationProbe
      )
    ) {
      smartCategory = "Hotel & Banquet";
      priority = "HIGH";
    } else if (
      convState.activeCategory === "Custom Fabrication" ||
      /cover|guard|enclosure|box|case|display\s*stand|riser|custom|mm|inch|furniture|interior|chair|stool|table|signage|name\s*plate/i.test(
        classificationProbe
      )
    ) {
      smartCategory = "Custom Fabrication";
      priority = "HIGH";
    } else if (/order|dispatch|delivery|tracking|courier|invoice|advance|payment/i.test(classificationProbe)) {
      smartCategory = "Order & Delivery";
    }
  }

  const hidePricesActive = Boolean(convState.hidePrices);

  // 3b. Direct Product & Variant Image / Video / PDF Brochure Sharing from Storage
  const focusForPdf =
    pinnedFocusItem ||
    (convState.focusProductSlug
      ? allItems.find(
          (it) =>
            (it.slug || "").toLowerCase() ===
            String(convState.focusProductSlug).toLowerCase()
        ) || null
      : null);
  const pdfResolved = resolveCatalogPdfAttachments(allItems, rawText, focusForPdf);
  if (pdfResolved && pdfResolved.attachments.length > 0 && !projectPlan.isMultiItemOrTotalling) {
    const greetPrefix = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
    const pdfReply = stripRepeatedGreeting(
      formatWhatsAppOutboundText(`${greetPrefix}${pdfResolved.replyText}`),
      alreadyGreeted,
      params.customerName
    );
    addStep(
      "Resolved official PDF catalogue attachments",
      `attachments=${pdfResolved.attachments.length}`
    );
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: rawText,
      model: "r2-pdf-catalogue-resolver",
      outcomeSource: "LIVE_AI",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: cacheMeta.catalogCacheStatus,
      cacheDetails: `Shared ${pdfResolved.attachments.length} PDF catalogue(s)`,
      productLookupTriggered: true,
      productLookupQuery: rawText,
      productLookupBudget: budgetLabel,
      productLookupTotalScanned: allItems.length,
      productsLookedUp: [],
      steps,
      response: pdfReply,
      durationMs: Date.now() - started,
    });
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      needsSalesTeamPing: false,
      salesTeamPingNote: "",
      customerReply: pdfReply,
      smartCategory,
      priority,
      conversationState: convState,
      mediaAttachments: pdfResolved.attachments,
    };
  }

  const isShortVariantFollowUp =
    Boolean(pinnedFocusItem) &&
    extractNormalizedColourTokens(rawText).length > 0 &&
    rawText.trim().split(/\s+/).length <= 6 &&
    matchProductVariantsByColourTokens(pinnedFocusItem?.variants || [], rawText).length > 0 &&
    (/\b(photos?|images?|pictures?|variant|colour|color)\b/i.test(outboundBodies[0] || "") ||
      !/\b(price|cost|height|size|dimension|warranty)\b/i.test(rawText));

  const asksForImages = isProductImageRequest(rawText) || isShortVariantFollowUp;
  const explicitCodesForImg = extractExplicitProductOrModelCodes(rawText);
  const isMultiImageTurn =
    asksForImages &&
    !projectPlan.isMultiItemOrTotalling &&
    (isMultiProductReference(rawText) ||
      explicitCodesForImg.length >= 2 ||
      (!pinnedFocusItem &&
        explicitCodesForImg.length === 0 &&
        contextMatches.length >= 2 &&
        /\b(podiums|pulpits|lecterns|chairs|tables|stands|trophies|awards|boxes|models|options|products)\b/i.test(
          rawText
        )));

  if (isMultiImageTurn) {
    const outboundListed = resolveProductsFromOutboundText(
      outboundBodies[0] || lastOutboundBody,
      allItems
    );
    let multiTargetItems: MainWebsiteProduct[] = [];
    if (isMultiProductReference(rawText) && outboundListed.length >= 2) {
      const sliceCount = /\b(first\s*two|top\s*two|both|these\s*two|those\s*two)\b/i.test(rawText)
        ? 2
        : /\b(all\s*three|these\s*three|those\s*three|three)\b/i.test(rawText)
        ? 3
        : outboundListed.length;
      multiTargetItems = outboundListed.slice(0, sliceCount);
    } else if (contextMatches.length >= 2) {
      multiTargetItems = contextMatches.slice(0, 3);
    } else if (convState.lastRecommendedProducts.length >= 2) {
      const recSlugs = new Set(convState.lastRecommendedProducts.slice(0, 3).map((p) => p.slug || p.id));
      multiTargetItems = allItems.filter((it) => recSlugs.has(it.slug || it.id)).slice(0, 3);
    }

    if (multiTargetItems.length >= 2) {
      const colourQuerySource =
        extractNormalizedColourTokens(rawText).length > 0
          ? rawText
          : extractNormalizedColourTokens(outboundBodies[0] || "").length > 0
          ? outboundBodies[0] || ""
          : recentInboundWindow;
      const multiMedia = resolveMultiProductMediaAttachments(
        multiTargetItems,
        colourQuerySource,
        hidePricesActive
      );
      if (multiMedia.attachments.length > 0) {
        convState.focusProductSlug = null;
        convState.lastRecommendedProducts = multiTargetItems.map((it) => ({
          id: it.id,
          name: cleanDisplayProductName(it.name),
          slug: it.slug,
          priceInr: it.basePrice,
          shortUrl: it.shortUrl || it.url,
          itemType: it.itemType,
        }));
        await saveConversationAiState(params.conversationId, convState);
        const greetPrefix = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
        const multiReply = stripRepeatedGreeting(
          formatWhatsAppOutboundText(`${greetPrefix}${multiMedia.replyText}`),
          alreadyGreeted,
          params.customerName
        );
        addStep(
          "Resolved multi-product & variant images from R2 storage",
          `products=[${multiTargetItems.map((p) => p.sku || p.slug).join(", ")}], attachments=${multiMedia.attachments.length}`
        );
        recordAndBroadcastAiLog({
          website: "WHATSAPP_HUB",
          websiteLabel: "Classic Concepts WhatsApp Hub",
          feature: "Autonomous WhatsApp Concierge (ACRIO)",
          actor: params.customerName,
          question: rawText,
          model: "r2-multi-product-media-resolver",
          outcomeSource: "LIVE_AI",
          responseCacheStatus: "BYPASS",
          catalogCacheStatus: cacheMeta.catalogCacheStatus,
          cacheDetails: `Shared ${multiMedia.attachments.length} R2 product/variant image(s) across ${multiTargetItems.length} products`,
          productLookupTriggered: true,
          productLookupQuery: usedLookupQuery || rawText,
          productLookupBudget: budgetLabel,
          productLookupTotalScanned: allItems.length,
          productsLookedUp: multiTargetItems.map(mapProductToLogItem),
          steps,
          response: multiReply,
          durationMs: Date.now() - started,
        });
        return {
          needsHumanHandoff: false,
          handoffReason: "",
          needsSalesTeamPing: false,
          salesTeamPingNote: "",
          customerReply: multiReply,
          smartCategory,
          priority,
          conversationState: convState,
          mediaAttachments: multiMedia.attachments,
        };
      }
    }
  }

  const imageTargetItem = asksForImages
    ? pinnedFocusItem ||
      (convState.focusProductSlug
        ? allItems.find(
            (it) =>
              (it.slug || "").toLowerCase() ===
              String(convState.focusProductSlug).toLowerCase()
          ) || null
        : null) ||
      top ||
      (convState.lastRecommendedProducts[0]
        ? allItems.find(
            (it) =>
              (it.slug || "").toLowerCase() ===
              String(convState.lastRecommendedProducts[0].slug).toLowerCase()
          ) || null
        : null)
    : null;
  const resolvedMedia =
    asksForImages && imageTargetItem
      ? resolveProductMediaAttachments(imageTargetItem, rawText, hidePricesActive)
      : null;

  if (
    resolvedMedia &&
    resolvedMedia.attachments.length > 0 &&
    imageTargetItem &&
    !projectPlan.isMultiItemOrTotalling &&
    intentInfo.intent !== "PRODUCT_COMPARISON"
  ) {
    convState.focusProductSlug = imageTargetItem.slug;
    if (params.uiSink) {
      params.uiSink.focus = imageTargetItem;
    }
    await saveConversationAiState(params.conversationId, convState);
    const greetPrefix = alreadyGreeted ? "" : `Hi ${firstName}!\n\n`;
    const mediaReply = stripRepeatedGreeting(
      formatWhatsAppOutboundText(`${greetPrefix}${resolvedMedia.replyText}`),
      alreadyGreeted,
      params.customerName
    );
    addStep(
      "Resolved product & variant images from R2 storage",
      `product="${cleanDisplayProductName(imageTargetItem.name)}", attachments=${resolvedMedia.attachments.length}, matchedVariant=${resolvedMedia.matchedVariant}`
    );
    recordAndBroadcastAiLog({
      website: "WHATSAPP_HUB",
      websiteLabel: "Classic Concepts WhatsApp Hub",
      feature: "Autonomous WhatsApp Concierge (ACRIO)",
      actor: params.customerName,
      question: rawText,
      model: "r2-product-media-resolver",
      outcomeSource: "LIVE_AI",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: cacheMeta.catalogCacheStatus,
      cacheDetails: `Shared ${resolvedMedia.attachments.length} R2 product/variant image(s) for ${imageTargetItem.slug}`,
      productLookupTriggered: true,
      productLookupQuery: usedLookupQuery || rawText,
      productLookupBudget: budgetLabel,
      productLookupTotalScanned: allItems.length,
      productsLookedUp: [mapProductToLogItem(imageTargetItem)],
      steps,
      response: mediaReply,
      durationMs: Date.now() - started,
    });
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      needsSalesTeamPing: false,
      salesTeamPingNote: "",
      customerReply: mediaReply,
      smartCategory,
      priority,
      conversationState: convState,
      mediaAttachments: resolvedMedia.attachments,
    };
  }

  const prebuiltGroupedBlock =
    intentInfo.requiresProductLookup && !projectPlan.isMultiItemOrTotalling
      ? buildGroupedProductShortLinksSection({
          allItems,
          matchedItems: contextMatches,
          smartCategory,
          excludeConsumables: convState.excludedItemTypes.includes("CONSUMABLE"),
          hasStrictBudget: convState.maxPrice !== null || convState.minPrice !== null,
          hidePrices: hidePricesActive,
          maxItems: 3,
        })
      : "";

  const deepProductInfo =
    intentInfo.requiresProductLookup && !projectPlan.isMultiItemOrTotalling && !aggregateResult
      ? buildEcosystemDeepProductContextAndAnswer({
          rawQuery: rawText,
          matchedItems: contextMatches,
          formatItemLink: (it) => it.shortUrl || it.url,
        })
      : null;

  // Build Podium Sub-Categories Overview when CATEGORY_OVERVIEW is requested
  const podiumSubCategoriesText =
    intentInfo.intent === "CATEGORY_OVERVIEW"
      ? [
          `Here are the *4 sub-categories* under our *Acrylic Podiums & Pulpits* range:`,
          `1. *Essential Podiums*${hidePricesActive ? "" : " (₹7,150 to ₹23,650)"}: Compact, lightweight single and double pillar podiums ideal for classrooms, offices, and daily seminars (such as *CCP057S*, *CCP054*, *CCP057*, *CCP060*).`,
          `2. *Classic Signature Podiums*${hidePricesActive ? "" : " (₹19,250 to ₹28,600)"}: Wide-stage auditoria and church pulpits with generous reading tops and front logo panels (such as *CCP065*, *CCP055*, *CCP061*, *CCP064*).`,
          `3. *Premium Podiums*${hidePricesActive ? "" : " (₹28,600 to ₹55,000)"}: Heavy-duty executive, motorized/height-adjustable, LED-lit, and acrylic-plus-wood flagship lecterns (such as *CCP074*, *CCP084*, *CCP094*, *CCP111*).`,
          `4. *Custom-Built Podiums*: Made-to-order stage lecterns crafted to your exact dimensions, tint, LED backlighting, and institution crest.`,
          `\nReply with *1*, *2*, *3*, or *4* (or tell me your venue type) to see the top models in that category!`,
        ].join("\n")
      : "";

  // Determine if Consultative Sales Team Ping (without transferring chat away from ACRIO) is appropriate (Decision #4)
  let needsSalesTeamPing = Boolean(projectPlan.needsSalesTeamPing);
  let salesTeamPingNote = projectPlan.needsSalesTeamPing
    ? `ACRIO Consultative Ping: Customer requested multi-item/bulk project pricing ("${rawText.slice(0, 140)}"). ACRIO shared itemized math and remains active on the chat; a single Sales Team reply with bulk discount can resolve this.`
    : "";
  if (
    !needsSalesTeamPing &&
    /\b(bulk\s*discount|discount|negotiate|best\s*rate|final\s*price|custom\s*quote|renovation|proforma|gst\s*quote|\d{2,}\s*(?:pcs|pieces|units|chairs|podiums|signages))\b/i.test(
      rawText
    )
  ) {
    needsSalesTeamPing = true;
    salesTeamPingNote = `ACRIO Consultative Ping: Customer asked about bulk/custom pricing or discount ("${rawText.slice(0, 140)}"). ACRIO stays assigned; drop a single reply if special pricing applies.`;
  }

  // 4. Multi-turn Claude Haiku 5.5 (Medium Effort) Diagnostic & Conversational Assistant
  const { apiKey, source: keySource } = await resolveSharedAnthropicApiKey("client");
  let lastAiError: string | null = null;
  let lastUsage: AiTokenUsage | null = null;

  if (apiKey) {
    try {
      const trimmedHistory = history.slice(-16);
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
        const body = String(msg.body || "")
          .replace(/93467\s*63253/g, "73372 22876")
          .trim();
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

      // Check which closing questions were already asked in the last 2 outbound messages so ACRIO never nags!
      const recentOutboundText = historyWithoutDuplicateCurrent
        .filter((m) => m.direction === "OUTBOUND")
        .slice(-2)
        .map((m) => m.body)
        .join(" ")
        .toLowerCase();
      const alreadyAskedCityRecently = /\b(which\s+city|delivery\s+city|dispatch\s+to|event\s+in)\b/i.test(
        recentOutboundText
      );
      const alreadyAskedLogoRecently = /\b(logo\s+printing|custom\s+front\s+logo|institution\s+logo)\b/i.test(
        recentOutboundText
      );
      const antiRepeatRule =
        alreadyAskedCityRecently || alreadyAskedLogoRecently || customerProfileInfo.customerProfile === "STUDENT_EXPLORER"
          ? `CRITICAL ANTI-REPETITION RULE: You ALREADY asked about ${alreadyAskedCityRecently ? "delivery city" : ""}${alreadyAskedCityRecently && alreadyAskedLogoRecently ? " and " : ""}${alreadyAskedLogoRecently ? "logo printing" : ""} in recent messages (or customer is a student). DO NOT ask "which city" or "do you want logo printing" again in this reply! Instead, end with a fresh, helpful product-specific question or no question at all.`
          : "";

      let catalogContext = "";
      if (projectPlan.isMultiItemOrTotalling) {
        catalogContext = `Turn Intent: MULTI_ITEM_PROJECT (Multi-item quantity and budget totalling).
Verified Multi-Item Project Calculation & Combinations (share these exact unit prices, quantities, line totals, shortlinks, and within-budget options clearly):
${projectPlan.summaryText}`;
      } else if (intentInfo.intent === "CATEGORY_OVERVIEW" && podiumSubCategoriesText) {
        catalogContext = `Turn Intent: CATEGORY_OVERVIEW (Customer asked for the sub-categories under Acrylic Podiums).
Use this exact verified sub-category breakdown:
${podiumSubCategoriesText}`;
      } else if (!intentInfo.requiresProductLookup) {
        if (intentInfo.intent === "LEADERSHIP_CONTACT_INFO") {
          catalogContext = `Turn Intent: LEADERSHIP_CONTACT_INFO (Customer is asking for company leadership, chairperson, marketing, sales, or department-wise contact details).
Answer directly using the exact names, roles/departments, email addresses, and phone/WhatsApp numbers from the [Live Database Operational Context] below! Share all relevant contact numbers and emails clearly.`;
        } else if (intentInfo.intent === "CHAT_HISTORY_META") {
          catalogContext = `Turn Intent: CHAT_HISTORY_META (Customer is asking about their chat history with you, pointing out a context or repetition issue, or sharing that they are a student).
Review the earlier messages in this conversation and answer directly, warmly, and honestly:
- If they ask "Tell me about my chat history with you", summarize the exact topics and products you have discussed together in this chat (podiums, furniture/chairs, corporate gifts, comparisons, etc.) in 4-5 clear bullet points!
- If they say "You lost the context again" or "Why do you keep asking the same city question", apologize briefly in 1 natural sentence, confirm what they were asking about from the previous turn, and answer it without repeating any city question!
- If they say "I am a student", acknowledge warmly that they are welcome to explore all specs and prices for their study or project without any sales pressure.`;
        } else if (intentInfo.intent === "IDENTITY_META") {
          catalogContext = `Turn Intent: IDENTITY_META (The customer is asking who you are or what you can help with).
Answer directly in 2-3 short lines: you are *ACRIO*, the WhatsApp product & fabrication assistant for *Classic Concepts* (ready & custom acrylic podiums, furniture, signage, awards, stands, boxes: classicconcepts.in) and *Classic Edge 53* (acrylic bending, diamond edge polishing & cutting machines: classicedge.in).
CRITICAL: Do NOT list or repeat specific products or links from earlier turns in this reply!`;
        } else if (intentInfo.intent === "COMPANY_INFO") {
          catalogContext = `Turn Intent: COMPANY_INFO (The customer is asking about our company, factory location, contact details, or what we do).
Answer directly using ONLY the verified live company details: *Classic Concepts* manufactures ready and custom cast-acrylic products (stage podiums/pulpits, acrylic furniture & chairs, office signages, trophies, hotel/retail stands, custom boxes) and *Classic Edge 53* supplies industrial acrylic fabrication machines (diamond edge polishers, bending heaters, cutters) from our 16,000+ sq. ft. facility at 1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015 (Phones: +91 79016 50662, +91 79016 50663 | Official WhatsApp: +91 73372 20568 | Emails: sales@classicconcepts.in, info@classicconcepts.in) with pan-India delivery and GST billing.`;
        } else if (intentInfo.intent === "TOPIC_RESET") {
          catalogContext = `Turn Intent: TOPIC_RESET (The customer wants to ask a different query or start a new topic).
Acknowledge warmly in 1-2 short lines and invite them to share their new question or requirement.
CRITICAL: Do NOT carry over, repeat, or pitch any products from earlier messages in the conversation!`;
        } else if (intentInfo.intent === "HUMAN_HANDOFF_INFO") {
          catalogContext = `Turn Intent: HUMAN_HANDOFF_INFO (The customer is asking an informational question about who you will connect them to).
Explain clearly that when they want human assistance, you can ping or connect our *Classic Concepts & Classic Edge 53 Sales & Fabrication Team* (led by Director - Sales Hussain Earanpurwala, Director - Production Yusuf Zakir, Corporate Sales Manager Shiva Kumar Chernapally, and our Sales & Relationship Managers), and ask if they would like to be connected now or keep exploring.
CRITICAL: Set "needsHumanHandoff": false because they are only asking *whom* you connect to!`;
        } else if (intentInfo.intent === "OFF_TOPIC") {
          catalogContext = `Turn Intent: OFF_TOPIC.
Politely state in 1-2 lines that you only assist with *Classic Concepts* acrylic products and *Classic Edge 53* fabrication machines, and ask if they need any display, podium, furniture, signage, or machine.`;
        } else if (intentInfo.intent === "CONVERSATIONAL_FOLLOWUP") {
          const activeRecSummary =
            convState.lastRecommendedProducts.length > 0
              ? `\nActive product(s) in this chat: ${convState.lastRecommendedProducts.map((p) => `*${p.name}*${p.priceInr ? ` (₹${p.priceInr.toLocaleString("en-IN")})` : ""} ${p.shortUrl || ""}`).join(", ")}`
              : "";
          catalogContext = `Turn Intent: CONVERSATIONAL_FOLLOWUP.${activeRecSummary}
Respond naturally and directly to the customer's message using the conversation history and active product context above. Keep it concise (2-4 lines) and do NOT dump a 5-product template list unless they asked for product options.`;
        } else {
          catalogContext = `Turn Intent: GREETING.
Welcome the customer briefly and ask what they are looking to display, build, or fabricate today (stage podiums/pulpits, acrylic furniture & chairs, office signages, awards, custom acrylic boxes, or Classic Edge 53 machines). Do NOT dump specific product links yet.`;
        }
      } else {
        const nearestHint =
          budgetFallbackLowestPrice && budgetFallbackLowestItem
            ? ` The lowest verified price in this category is ₹${budgetFallbackLowestPrice.toLocaleString("en-IN")} (*${cleanDisplayProductName(budgetFallbackLowestItem.name)}* - ${budgetFallbackLowestItem.shortUrl || budgetFallbackLowestItem.url}).`
            : "";
        const deepBlock = aggregateResult
          ? `\n\nVerified Catalogue-Wide Count (the customer asked HOW MANY; answer with this exact count and breakdown, do not describe one single product):\n${aggregateResult.answer}`
          : pinnedFocusItem
          ? `\n\nFOCUS PRODUCT (the customer's words like "this model", "it", "the white one" refer to THIS product from earlier in the chat; answer ONLY about it. If they asked one specific thing (colour, price, warranty, size, quantity) answer just that in 2-4 short lines. If they only picked it from a list or asked for more details, give the crisp 5-6 line gist for this one product:\n${cleanDisplayProductName(pinnedFocusItem.name)} | ${pinnedFocusItem.shortUrl || pinnedFocusItem.url}\n${deepProductInfo?.promptCatalogContext || ""}`
          : deepProductInfo?.promptCatalogContext
          ? `\n\nVerified Deep Product Specifications, Dimensions, Variants & Machine Models:\n${deepProductInfo.promptCatalogContext}`
          : "";
        const verifiedDeepReference = deepProductInfo?.deterministicDeepAnswer
          ? `\n\nVerified Concise Gist Reference (use these exact measurements, variant prices, model codes, and links without dumping unrequested panel sizes):\n${deepProductInfo.deterministicDeepAnswer}`
          : "";
        const priceSuppressionNote = hidePricesActive
          ? `\nCRITICAL PRICE SUPPRESSION RULE: The customer explicitly asked NOT to mention prices ("without mentioning prices"). DO NOT include any ₹ prices, MRP, or rupee numbers anywhere in your reply!`
          : "";
        catalogContext = prebuiltGroupedBlock
          ? `Turn Intent: ${intentInfo.intent}\nMatched Products strictly filtered for the customer's query${budgetLabel && !hidePricesActive ? ` (Budget filter applied: ${budgetLabel})` : ""}:\n${prebuiltGroupedBlock}${deepBlock}${verifiedDeepReference}${priceSuppressionNote}\n\nIMPORTANT: Format your reply as a crisp, scannable Gist (show at most 3 top matching products unless the user asked for all models; for a single product, show a 5-6 line gist with Height, Top size, Build/Warranty, Variants, 2-3 key highlights, and shortlink). Never dump raw database paragraphs!`
          : `Turn Intent: ${intentInfo.intent}\nNo exact ready-priced product matched "${usedLookupQuery}"${budgetLabel ? ` within budget ${budgetLabel}` : ""}.${nearestHint} Explain honestly and helpfully without inventing prices, and share the closest starting option or custom fabrication option.`;
      }

      const stateSummaryLine = `Active Conversation Memory: product="${convState.primaryProductQuery || "unspecified"}", family="${convState.productFamily || "open"}", category="${smartCategory}", budget="${hidePricesActive ? "HIDE_PRICES_ACTIVE" : budgetLabel || "open"}", preferCheapest=${Boolean(convState.preferCheapest)}, switchedProductThisTurn=${Boolean(convState.switchedThisTurn)}, customerProfile="${customerProfileInfo.customerProfile}", languageMode="${customerProfileInfo.languageMode}"`;
      const productHistoryLine =
        (convState.productHistory || []).length > 0
          ? `Previously Discussed Products In Earlier Turns (for comparison/history ONLY. Do NOT mix their prices, sizes, or specs into the CURRENT active product unless asked to compare!): ${(convState.productHistory || []).map((h) => h.label).join(" -> ")}\n`
          : "";

      const completeDatabaseDirectory = buildCompleteEcosystemDatabaseDirectory(allItems);
      const safePromptCustomerName =
        firstName === "there"
          ? "Valued Customer (do NOT greet with a phone number; say 'Hi there' if greeting)"
          : params.customerName;
      const quotedMessagePromptLine = quotedReplyContext
        ? `Customer Swiped / Replied Directly To This Earlier WhatsApp Message (${quotedReplyContext.senderName || "Earlier message"}): "${quotedBody.slice(0, 320)}"${quotedReplyContext.productName ? ` [Referenced Product: ${quotedReplyContext.productName}${quotedReplyContext.variantName ? `, Variant: ${quotedReplyContext.variantName}` : ""}]` : ""}\nCRITICAL QUOTED-REPLY RULE: Interpret the customer's short message below directly as a response to or question about that quoted message!\n`
        : "";
      const latestPromptPayload = `[Internal Context for ACRIO - never echo raw labels]
Customer Name: ${safePromptCustomerName}
Already Greeted Earlier In This Chat: ${alreadyGreeted ? "YES (DO NOT say Hi/Hello or customer's name again! Start directly with the helpful answer.)" : `NO (First reply: greet "${firstName}" warmly once in 1 short line.)`}
Customer Persona & Language Instruction: ${customerProfileInfo.instructionNote}
${quotedMessagePromptLine}${antiRepeatRule ? `${antiRepeatRule}\n` : ""}${stateSummaryLine}
${productHistoryLine}${trainingGuidance.promptBlock ? `\n[AI Training Studio Rules & Q&A Guidance]:\n${trainingGuidance.promptBlock}\n` : ""}${catalogContext}${liveOperationalContext ? `\n\n[Live Database Operational Context - Verified Company Summary, Enquiries & Orders]:\n${liveOperationalContext}` : ""}

Customer's latest WhatsApp message:
${rawText}`;

      // NEVER wipe claudeMessages! Preserving multi-turn chat history is essential for "1", "Tell me about my chat history", and natural follow-ups.
      const lastTurn = claudeMessages[claudeMessages.length - 1];
      if (lastTurn && lastTurn.role === "user") {
        lastTurn.content = `${lastTurn.content}\n\n${latestPromptPayload}`;
      } else {
        claudeMessages.push({ role: "user", content: latestPromptPayload });
      }

      const aiCall = await callClaudeHaikuMessagesDetailed({
        apiKey,
        maxTokens: 4096,
        effort: "medium",
        timeoutMs: 26000,
        system: `You are ACRIO, the intelligent WhatsApp product, project & fabrication specialist for Classic Concepts (acrylic products: classicconcepts.in) and Classic Edge 53 (acrylic fabrication machines, tools & hardware accessories: classicedge.in).

CORE CONVERSATION, ACCURACY, GIST FORMATTING & BUSINESS RULES:
1. COMPLETE DATABASE VISIBILITY & ACCURATE PRODUCT MATCHING:
   - You have access to the ENTIRE verified database below: all 189+ Classic Concepts products (including all 31 Acrylic & Wood Podiums CCP053 to CCP111 with 4 sub-categories: Essential Podiums, Classic Signature Podiums, Premium Podiums, Custom-Built Podiums; Acrylic Furniture & Tables including Acrylic Chair ₹15,950 and Acrylic Bar Stool ₹9,350; Signages & Office Name Plates; Trophies, Mementos & Corporate Gifts under ₹5,000; Hotel & Retail Stands; Boxes & Enclosures), all 18 Classic Edge 53 industrial machines & models, all 5 machine consumables, all 188 acrylic hardware accessories, company details, and department-wise staff contacts.
   - ALWAYS check both the Matched Products section AND the Complete Verified Ecosystem Catalog Directory below before ever claiming a product or category does not exist!
   -Cheapest vs Costliest Podiums: Our most affordable ready podium is *Acrylic Podium CCP057S* (₹7,150, Top 18" x 14", Height 40"-42") followed by *Acrylic Podium CCP054* (₹14,999, Top 20" x 15"). Our most premium flagship podiums are *Acrylic & Wood Podium CCP111* (₹55,000, Top 27" x 18", 15mm clear acrylic + wood) and *Acrylic Podium CCP094* (₹52,800).
   - If the customer asks for a "cheaper alternative" or "smaller top to save more", recommend compact lower-priced models (like *CCP057S* ₹7,150, *CCP054* ₹14,999, *CCP058* ₹18,150, *CCP057* ₹19,800) instead of repeating expensive models!
   - If the customer asks about "furniture and interiors" or "they sit / Acrylic chair", show our *Acrylic Chair* (₹15,950), *Acrylic Bar Stool* (₹9,350), *Acrylic Console Table* (₹12,100), and *Acrylic Nesting Tables* (₹8,800). NEVER show podiums when they ask for furniture or chairs!
2. SCANNABLE GIST FORMATTING (NEVER DUMP RAW DATABASE WALLS):
   - NEVER repeat "Hi" or "Hello" if Already Greeted Earlier is YES.
   - Never start every message with the robotic phrase "Here are the matching options from our range:". Vary your opening naturally based on what the user asked!
   - For a single product ("Tell me about CCP111" or "CCP065"), give a crisp 5-6 line Gist: Price, Height & Top size, Build/Pillars/Warranty, Variants/Colours, 2-3 key highlights, and the https://ccapl.cc/... shortlink. Only list Bottom Sheet, Front Panel, Shelf, or Logo Panel sizes if the user specifically asks for full/panel dimensions.
   - When listing multiple options, show at most 3 best matches (with 1-line key size + shortlink each) so the message is effortless to read on mobile.
   - If "HIDE_PRICES_ACTIVE" is set (user asked "without mentioning prices"), DO NOT show any ₹ prices anywhere in the message!
   - Use single asterisks *like this* for WhatsApp bold (NEVER **double asterisks**, NEVER [markdown](links), NEVER ### headings).
3. MULTI-ITEM PROJECT TOTALLING & BUDGET SOLVING:
   - When a customer asks for multiple items with quantities and a budget (e.g. "3 Acrylic podiums, 10 signages for office name plates and 10 chairs within 1 lac rupees"), ALWAYS show the exact unit price × quantity = line total for each item, the grand total, and 2 smart combinations (Option 1: Within-budget combination; Option 2: Full-quantity package with bulk discount check from our Sales Team).
4. COMPANY DETAILS, DIRECTORS & LEADERSHIP CONTACTS (STRICT LIVE DATABASE VERIFICATION):
   - ONLY share company contact details or leadership names when the customer explicitly asks for company info, address, phone, email, or leadership/team contacts. NEVER append unrequested contact directories to normal product replies!
   - When asked about company details, leadership/directors, marketing, or sales contacts, use ONLY the verified live database records from the Live Database Operational Context (Head Office: 1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015 | Phones: +91 79016 50662, +91 79016 50663 | Official WhatsApp: +91 73372 20568 | Emails: sales@classicconcepts.in, info@classicconcepts.in | Directors: Yusuf Zakir - Director Production +91 9959362437, Hussain Earanpurwala - Director Sales +91 9849050752 hussain@classicconcepts.in | Corporate Sales Manager: Shiva Kumar Chernapally +91 7337222878 | Sales & Relationship Managers: Lalitha Barma +91 7337222875, Susheela Kunchala +91 7337222879, Shilpa Parikh +91 8977765662, M Chandi Priyanka +91 733 722 2169 | Corporate Sales: Lakshmi Nossam +91 8977641665 | Client Relationship: Syed Murtuza +91 8977765661 | E-Commerce & Digital Growth: B Suraj Goud +91 8977765660, Harendar Kumar +91 8977765664).
   - NEVER use any unverified or placeholder names or addresses.
   - PRIVACY RULE: NEVER share any other customer's phone number, email, enquiry, or order details.
   - IMAGE SHARING CAPABILITY: Our system automatically attaches and sends product and variant photos from our Cloudflare R2 storage whenever a customer asks for images/photos. NEVER say "I cannot send images directly here".
5. CONSULTATIVE SALES TEAM PING vs FULL HANDOFF (CRITICAL):
   - You make the best decision possible autonomously and keep handling the conversation ("needsHumanHandoff": false).
   - When a customer needs bulk discount confirmation, multi-item renovation pricing, or custom quote verification, set "needsSalesTeamPing": true and "needsHumanHandoff": false so our Sales Team gets pinged internally to drop a single reply while you remain active on the chat!
   - Set "needsHumanHandoff": true ONLY if the customer explicitly asks to speak to a human/person right now or reports a damaged delivery/dispute.
6. PLAIN EVERYDAY LANGUAGE & ANTI-REPETITION:
   - FOLLOW-UP MEMORY: When the customer says "this model", "it", "its price", "the white one" or asks a short question about colour, warranty, price or size, they mean the FOCUS PRODUCT from earlier in this chat. Answer ONLY that question about THAT product in 2-4 short lines. NEVER switch to a different product and NEVER repeat the full product description again.
   - COUNT QUESTIONS: When asked "how many products ...", use the Verified Catalogue-Wide Count if provided and answer with the number first.
   - NEVER state a technical figure (power, kW, weight, speed, thickness, voltage) unless it appears in the verified product data above. If it is missing, say you do not have it verified and share the right team contact instead.
   - JSON SAFETY: Write inches as the word "inch" or "in" (for example 22 x 16 inch), NEVER with a double quote character inside customerReply, so the JSON stays valid.
   - Primary languages: English and Hindi/Hinglish. Use other languages only if the user clearly does not understand English or Hindi.
   - Zero em-dashes ("—"), zero "--", zero robotic AI buzzwords.
   - Do NOT repeat "which city is the event/delivery in?" or "do you need logo printing?" if it was already asked in recent turns or if the user is a student/exploring.

${completeDatabaseDirectory}

Return ONLY valid JSON:
{
  "needsHumanHandoff": false,
  "handoffReason": "",
  "needsSalesTeamPing": false,
  "salesTeamPingNote": "",
  "smartCategory": "Podiums & Stage | Awards & Trophies | Hotel & Banquet | Acrylic Machines (CE53) | Custom Fabrication | Order & Delivery | General Enquiry",
  "priority": "URGENT | HIGH | NORMAL",
  "customerReply": "Cleanly formatted WhatsApp gist using \\n line breaks, *bold* titles, ₹ prices (unless hidden), and https://ccapl.cc/... shortlinks"
}`,
        messages: claudeMessages,
      });

      lastUsage = aiCall.usage;
      if (aiCall.ok && aiCall.text) {
        addStep(
          "Called Anthropic claude-haiku-5-5 (effort=medium)",
          `HTTP ${aiCall.statusCode} in ${aiCall.durationMs}ms (keySource=${keySource}, in=${aiCall.usage?.inputTokens ?? 0}, think=${aiCall.usage?.thinkingTokens ?? 0}, out=${aiCall.usage?.outputTokens ?? 0})`
        );
        const parsed =
          parseClaudeJson<any>(aiCall.text) ??
          (!/[{}]/.test(String(aiCall.text)) && String(aiCall.text).trim().length > 5
            ? { customerReply: String(aiCall.text).trim() }
            : null);
        if (parsed && typeof parsed.customerReply === "string" && parsed.customerReply.trim()) {
          const handoff =
            intentInfo.intent === "HUMAN_HANDOFF_INFO" ||
            intentInfo.intent === "LEADERSHIP_CONTACT_INFO" ||
            intentInfo.intent === "CHAT_HISTORY_META" ||
            intentInfo.intent === "MENU_SELECTION" ||
            intentInfo.intent === "CATEGORY_OVERVIEW" ||
            intentInfo.intent === "MULTI_ITEM_PROJECT" ||
            intentInfo.intent === "CONVERSATIONAL_FOLLOWUP" ||
            intentInfo.intent === "IDENTITY_META" ||
            intentInfo.intent === "COMPANY_INFO" ||
            intentInfo.intent === "TOPIC_RESET" ||
            intentInfo.intent === "GREETING" ||
            intentInfo.intent === "OFF_TOPIC"
              ? false
              : Boolean(parsed.needsHumanHandoff);

          const pingSales =
            !handoff && (needsSalesTeamPing || Boolean(parsed.needsSalesTeamPing));
          const finalPingNote =
            parsed.salesTeamPingNote ||
            salesTeamPingNote ||
            (pingSales
              ? `ACRIO Consultative Ping: Customer enquiry ("${rawText.slice(0, 120)}") may benefit from a single Sales Team reply.`
              : "");

          let rawFormatted = stripRepeatedGreeting(
            formatWhatsAppOutboundText(parsed.customerReply),
            alreadyGreeted,
            params.customerName
          );
          if (hidePricesActive) {
            rawFormatted = rawFormatted
              .replace(/\s*\((?:₹|Rs\.?|INR)\s*[\d,]+(?:\s*,\s*MRP\s*₹[\d,]+)?\)/gi, "")
              .replace(/\b(?:₹|Rs\.?)\s*[\d,]+(?:\s*to\s*(?:₹|Rs\.?)\s*[\d,]+)?/gi, "available on request");
          }
          const cleanedReply =
            !intentInfo.requiresProductLookup && !projectPlan.isMultiItemOrTotalling
              ? rawFormatted
                  .split("\n")
                  .filter((line) => !/https?:\/\/ccapl\.cc\/\S+/i.test(line))
                  .join("\n")
                  .replace(/\n{3,}/g, "\n\n")
                  .trim()
              : rawFormatted;

          // Sync conversation state with the exact products Claude actually listed in cleanedReply
          // so follow-up turns ("Please share images of all three", "the second one") know the exact products shown!
          const linkedInReply = resolveProductsFromOutboundText(cleanedReply, allItems);
          if (linkedInReply.length === 1) {
            convState.focusProductSlug = linkedInReply[0].slug;
            convState.lastRecommendedProducts = [
              {
                id: linkedInReply[0].id,
                name: cleanDisplayProductName(linkedInReply[0].name),
                slug: linkedInReply[0].slug,
                priceInr: linkedInReply[0].basePrice,
                shortUrl: linkedInReply[0].shortUrl || linkedInReply[0].url,
                itemType: linkedInReply[0].itemType,
              },
            ];
            await saveConversationAiState(params.conversationId, convState);
          } else if (linkedInReply.length >= 2) {
            convState.focusProductSlug = null;
            convState.lastRecommendedProducts = linkedInReply.slice(0, 5).map((it) => ({
              id: it.id,
              name: cleanDisplayProductName(it.name),
              slug: it.slug,
              priceInr: it.basePrice,
              shortUrl: it.shortUrl || it.url,
              itemType: it.itemType,
            }));
            await saveConversationAiState(params.conversationId, convState);
          }

          let finalMediaAttachments =
            resolvedMedia && resolvedMedia.attachments.length > 0
              ? resolvedMedia.attachments
              : [];
          if (
            finalMediaAttachments.length === 0 &&
            linkedInReply.length > 0 &&
            (asksForImages ||
              /\b(photos?|images?|pictures?)\b[^.!?\n]{0,60}\b(coming|attached|shared|here|with\s+this\s+message)\b/i.test(
                cleanedReply
              ))
          ) {
            const autoMulti =
              linkedInReply.length === 1
                ? resolveProductMediaAttachments(linkedInReply[0], rawText, hidePricesActive)
                : resolveMultiProductMediaAttachments(
                    linkedInReply.slice(0, 3),
                    rawText,
                    hidePricesActive
                  );
            if (autoMulti.attachments.length > 0) {
              finalMediaAttachments = autoMulti.attachments;
              addStep(
                "Auto-attached R2 images for products referenced in reply",
                `products=[${linkedInReply.slice(0, 3).map((p) => p.sku || p.slug).join(", ")}], attachments=${finalMediaAttachments.length}`
              );
            }
          }

          addStep(
            "Parsed JSON & formatted WhatsApp outbound message",
            `intent=${intentInfo.intent}, smartCategory="${parsed.smartCategory || smartCategory}", handoff=${handoff}, salesPing=${pingSales}, chars=${cleanedReply.length}`
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
            productLookupTriggered: intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling,
            productLookupQuery: usedLookupQuery,
            productLookupBudget: budgetLabel,
            productLookupTotalScanned:
              intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling
                ? allItems.length
                : 0,
            productsLookedUp: (linkedInReply.length > 0 ? linkedInReply : contextMatches).map(
              mapProductToLogItem
            ),
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
            needsSalesTeamPing: pingSales,
            salesTeamPingNote: finalPingNote,
            customerReply: cleanedReply,
            smartCategory: parsed.smartCategory || smartCategory,
            priority: parsed.priority || priority,
            conversationState: convState,
            ...(finalMediaAttachments.length > 0
              ? { mediaAttachments: finalMediaAttachments }
              : {}),
          };
        } else {
          lastAiError = "Claude returned text that could not be parsed as JSON.";
          console.warn(`[ACRIO] JSON parse failure. intent=${intentInfo.intent} raw=${String(aiCall.text).slice(0, 400)}`);
          addStep("JSON parse warning", lastAiError, "WARN");
        }
      } else {
        lastAiError = aiCall.error || "Anthropic call failed";
        console.warn(`[ACRIO] Claude call failed. intent=${intentInfo.intent} http=${aiCall.statusCode} err=${lastAiError} ms=${aiCall.durationMs}`);
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

  if (projectPlan.isMultiItemOrTotalling && projectPlan.summaryText) {
    fallbackReply = `${greetOnce}${projectPlan.summaryText}`;
    priority = "HIGH";
  } else if (intentInfo.intent === "CATEGORY_OVERVIEW" && podiumSubCategoriesText) {
    fallbackReply = `${greetOnce}${podiumSubCategoriesText}`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "LEADERSHIP_CONTACT_INFO") {
    fallbackReply = `${greetOnce}Here are the verified leadership and sales contact details for *Classic Concepts* & *Classic Edge 53*:\n\n• *Director - Production:* Yusuf Zakir (+91 99593 62437)\n• *Director - Sales:* Hussain Earanpurwala (+91 98490 50752, hussain@classicconcepts.in)\n• *Corporate Sales Manager:* Shiva Kumar Chernapally (+91 73372 22878, info@classicconcepts.in)\n• *Sales & Relationship Managers:* Lalitha Barma (+91 73372 22875), Susheela Kunchala (+91 73372 22879), Shilpa Parikh (+91 89777 65662), M Chandi Priyanka (+91 73372 22169)\n• *E-Commerce & Digital Sales:* B Suraj Goud (+91 89777 65660, marketing@classicconcepts.in)\n• *Head Office & Factory (Secunderabad, Telangana):* +91 79016 50662 / +91 79016 50663 | WhatsApp: +91 73372 20568 | sales@classicconcepts.in`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "CHAT_HISTORY_META") {
    const prevUserTopics = history
      .filter((m) => m.direction === "INBOUND")
      .slice(-6)
      .map((m) => `• "${m.body.slice(0, 80)}"`)
      .join("\n");
    fallbackReply = /student/i.test(lower)
      ? `${greetOnce}Welcome! Since you are a student exploring our range, feel free to ask about any acrylic product dimensions, manufacturing methods, or prices anytime with zero obligation.`
      : `${greetOnce}Here is a quick summary of what we have discussed in this chat:\n${prevUserTopics || "• Exploring Classic Concepts acrylic products and pricing"}\n\nActive focus: *${convState.primaryProductQuery || smartCategory}*. Tell me how you would like to proceed and I will help right away!`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "GREETING") {
    fallbackReply = alreadyGreeted
      ? `Tell me what you are looking to display, make, or solve today:\n\n• *Acrylic Podiums, Pulpits & Display Stands*\n• *Acrylic Furniture, Chairs & Office Signages*\n• *Awards, Trophies & Corporate Gifts*\n• *Classic Edge 53 Acrylic Machines & Tools*\n\nShare a few details and I will suggest the best options!`
      : `Hello ${firstName}! Welcome to *Classic Concepts* & *Classic Edge 53*.\n\nHow can I help you today?\n• *Stage Podiums, Pulpits & Trophies*\n• *Acrylic Furniture, Chairs & Office Signages*\n• *Custom-Size Acrylic Boxes & Machine Covers*\n• *Acrylic Bending, Polishing & Cutting Machines*\n\nTell me what you have in mind!`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "IDENTITY_META") {
    fallbackReply = `${greetOnce}I am *ACRIO*, the WhatsApp product & fabrication assistant for *Classic Concepts* (ready & custom acrylic podiums, furniture, signages, awards, stands, and boxes) and *Classic Edge 53* (industrial acrylic bending, diamond edge polishing, and cutting machines).\n\nTell me what you want to display, build, or fabricate and I will share matching options and prices right away.`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "COMPANY_INFO") {
    fallbackReply = `${greetOnce}*Classic Concepts* manufactures cast-acrylic stage podiums, furniture, signages, trophies, hotel/retail stands, and custom acrylic boxes, while *Classic Edge 53* supplies industrial acrylic bending, diamond edge polishing, and cutting machines from our 16,000+ sq. ft. facility at 1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015 (Phones: +91 79016 50662, +91 79016 50663 | WhatsApp: +91 73372 20568 | sales@classicconcepts.in).\n\nWe ship pan-India with full GST billing. What product or machine can I help you check today?`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "TOPIC_RESET") {
    fallbackReply = `${greetOnce}Sure, let's start fresh! Tell me what you are looking for or what question you have, and I will help you right away.`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "HUMAN_HANDOFF_INFO") {
    fallbackReply = `${greetOnce}When you ask to speak with someone, I can ping or connect our *Classic Concepts & Classic Edge 53 Sales & Fabrication Team* (led by Director - Sales Hussain Earanpurwala, Director - Production Yusuf Zakir, and Corporate Sales Manager Shiva Kumar Chernapally) so a specialist can help you with custom quotes, bulk pricing, or order dispatch.\n\nWould you like me to connect our *Sales Team* now, or would you like to check a product first?`;
    priority = "NORMAL";
  } else if (intentInfo.intent === "OFF_TOPIC") {
    fallbackReply = `${greetOnce}I only help with *Classic Concepts* acrylic products (podiums, furniture, signages, awards, stands, custom boxes) and *Classic Edge 53* acrylic fabrication machines.\n\nLet me know if you need options or pricing for any acrylic product or machine!`;
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
    fallbackReply = `${greetOnce}Got your custom size details! I have pinged our *Sales Team* on this chat with your dimensions so they can share exact sheet thickness, fabrication cost, and dispatch time.`;
    needsSalesTeamPing = true;
    salesTeamPingNote = `ACRIO Consultative Ping: Customer shared 3D custom dimensions for quote ("${rawText.slice(0, 120)}").`;
    smartCategory = "Custom Fabrication";
    priority = "HIGH";
  } else if (aggregateResult) {
    fallbackReply = `${greetOnce}${aggregateResult.answer}`;
  } else if (pinnedFocusItem && buildFocusedAttributeAnswer(pinnedFocusItem, rawText)) {
    fallbackReply = `${greetOnce}${buildFocusedAttributeAnswer(pinnedFocusItem, rawText)}`;
  } else if (deepProductInfo?.deterministicDeepAnswer) {
    fallbackReply = `${greetOnce}${deepProductInfo.deterministicDeepAnswer}`;
  } else if (top && prebuiltGroupedBlock) {
    fallbackReply = `${greetOnce}${prebuiltGroupedBlock}\n\nLet me know which option fits your requirement best, or if you would like to compare sizes!`;
  } else if (budgetLabel && budgetFallbackLowestPrice && budgetFallbackLowestItem) {
    const cleanTitle = cleanDisplayProductName(budgetFallbackLowestItem.name);
    const link = budgetFallbackLowestItem.shortUrl || budgetFallbackLowestItem.url;
    fallbackReply = `${greetOnce}Our starting ready model in this category is:\n\n1. *${cleanTitle}* (₹${budgetFallbackLowestPrice.toLocaleString("en-IN")})\n   ${link}\n\nWould you like to check this model or explore a custom-built option for your budget?`;
  } else {
    fallbackReply = `${greetOnce}I would love to help find the right option for you.\n\nCould you share a little more about what you need?\n• *Stage & Events:* acrylic podiums/pulpits, awards, or plaques\n• *Furniture & Offices:* acrylic chairs, bar stools, tables, or office name plates\n• *Hotels & Retail:* menu/QR stands, risers, or display boxes\n• *Acrylic Machines:* cutting, bending, or diamond polishing`;
    priority = "NORMAL";
  }

  let finalFallback = stripRepeatedGreeting(
    formatWhatsAppOutboundText(fallbackReply),
    alreadyGreeted,
    params.customerName
  );
  if (hidePricesActive) {
    finalFallback = finalFallback
      .replace(/\s*\((?:₹|Rs\.?|INR)\s*[\d,]+(?:\s*,\s*MRP\s*₹[\d,]+)?\)/gi, "")
      .replace(/\b(?:₹|Rs\.?)\s*[\d,]+(?:\s*to\s*(?:₹|Rs\.?)\s*[\d,]+)?/gi, "available on request");
  }
  addStep(
    "Generated deterministic fallback WhatsApp reply",
    `intent=${intentInfo.intent}, matchedProducts=${contextMatches.length}, smartCategory="${smartCategory}", salesPing=${needsSalesTeamPing}`
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
    productLookupTriggered: intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling,
    productLookupQuery: usedLookupQuery,
    productLookupBudget: budgetLabel,
    productLookupTotalScanned:
      intentInfo.requiresProductLookup || projectPlan.isMultiItemOrTotalling
        ? allItems.length
        : 0,
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
    needsSalesTeamPing,
    salesTeamPingNote,
    customerReply: finalFallback,
    smartCategory,
    priority,
    conversationState: convState,
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

  const res = await sendWhatsAppCloudMessage({
    toPhone,
    bodyText: `New Quote Request Received: ${custVar} - Product: ${prodVar} (Qty: ${qtyVar})`,
    templateName: "cc_quote_request_alert",
    languageCode: "en",
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

  const res = await sendWhatsAppCloudMessage({
    toPhone,
    bodyText: `New Client Assigned to You: ${clientVar} (${phoneVar})`,
    templateName: "cc_staff_client_assignment",
    languageCode: "en",
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

  const res = await sendWhatsAppCloudMessage({
    toPhone,
    bodyText: `New Callback Request Received: ${clientVar} (${phoneVar}) - Preferred time: ${slotVar}`,
    templateName: "cc_callback_request_alert",
    languageCode: "en",
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

// ============================================================================
// 5. DEV MODE: ACRIO ECOSYSTEM ISSUES IDENTIFIER & AUTO-REPAIR ENGINE
// ============================================================================
export type EcosystemIssueSeverity = "CRITICAL" | "WARNING" | "INFO";
export type EcosystemIssueCategory =
  | "SHORTLINKS_AND_CROSS_SITE"
  | "PRODUCT_MEDIA_AND_R2"
  | "PRICING_AND_SPECS"
  | "AI_LOGS_AND_BRIDGES"
  | "TEMPLATES_AND_CONTENT";
export type EcosystemSiteKey =
  | "CLASSIC_CONCEPTS"
  | "CLASSIC_EDGE_53"
  | "WHATSAPP_HUB"
  | "SHORTLINK_ROUTER";

export interface EcosystemDetectedIssue {
  id: string;
  severity: EcosystemIssueSeverity;
  category: EcosystemIssueCategory;
  site: EcosystemSiteKey;
  title: string;
  detail: string;
  affectedEntity: string;
  skuOrCode?: string | null;
  sourceUrl?: string | null;
  targetUrl?: string | null;
  adminEditUrl?: string | null;
  autoFixAction?: "SYNC_SHORTLINKS" | "REFRESH_CATALOG_CACHE" | null;
  suggestion: string;
}

export interface EcosystemSiteHealthSummary {
  site: EcosystemSiteKey;
  label: string;
  publicDomain: string;
  online: boolean;
  totalItemsScanned: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  statusNote: string;
}

export interface EcosystemIssuesAuditReport {
  scannedAtIso: string;
  scannedAtIst: string;
  durationMs: number;
  healthScore: number;
  totals: {
    totalIssues: number;
    critical: number;
    warning: number;
    info: number;
    classicConceptsProducts: number;
    classicEdgeItems: number;
    shortLinksCount: number;
    templatesCount: number;
    recentAiLogsScanned: number;
  };
  siteSummaries: EcosystemSiteHealthSummary[];
  issues: EcosystemDetectedIssue[];
  acrioAnalysis?: string | null;
  acrioModel?: string | null;
}

export async function executeAcrioEcosystemAutoFix(
  action: "SYNC_SHORTLINKS" | "REFRESH_CATALOG_CACHE",
  actorName = "DEV"
): Promise<{ ok: boolean; message: string; fixedCount: number }> {
  await ensureDatabasesBootstrapped();
  if (action === "REFRESH_CATALOG_CACHE") {
    await invalidateWhatsAppCacheTags(["cc-products", "ce53-machines"]);
    const fresh = await getCachedEcosystemCatalog();
    return {
      ok: true,
      fixedCount: fresh.allItems.length,
      message: `Invalidated L1/L2/L3 catalog caches and reloaded ${fresh.classicConceptsProducts.length} Classic Concepts products + ${fresh.classicEdgeItems.length} Classic Edge 53 items.`,
    };
  }

  if (action === "SYNC_SHORTLINKS") {
    const conv = getRawLibSqlClient("conversations");
    await invalidateWhatsAppCacheTags(["cc-products", "ce53-machines"]);
    const catalog = await getCachedEcosystemCatalog();
    const existingRes = await conv.execute(`SELECT * FROM custom_links`);
    const rows = existingRes.rows as Record<string, unknown>[];

    let fixedCount = 0;
    const nowIso = new Date().toISOString();

    // 1. Repair any localhost / 127.0.0.1 / http:// target_url in custom_links
    for (const r of rows) {
      const id = String(r.id || "");
      const rawTarget = String(r.target_url || "").trim();
      const slug = String(r.product_slug || "");
      let repaired = rawTarget;
      if (/localhost|127\.0\.0\.1|:300[0-9]/i.test(repaired)) {
        const isCe = slug.startsWith("ce53:") || /classicedge|machines/i.test(repaired);
        const pathPart = repaired.replace(/^https?:\/\/[^/]+/i, "");
        repaired = `${isCe ? "https://classicedge.in" : "https://classicconcepts.in"}${
          pathPart.startsWith("/") ? pathPart : `/${pathPart}`
        }`;
      }
      if (repaired.startsWith("http://")) {
        repaired = repaired.replace(/^http:\/\//i, "https://");
      }
      if (repaired !== rawTarget) {
        await conv.execute({
          sql: `UPDATE custom_links SET target_url = ? WHERE id = ?`,
          args: [repaired, id],
        });
        fixedCount++;
      }
    }

    // 2. Ensure every catalog item has a valid shortlink in custom_links
    const existingBySlug = new Set(
      rows
        .map((r) => String(r.product_slug || "").toLowerCase())
        .filter(Boolean)
    );
    const existingCodes = new Set(
      rows.map((r) => String(r.code || "").toLowerCase()).filter(Boolean)
    );

    for (const item of catalog.allItems) {
      const prefixedSlug =
        item.brand === "CLASSIC_EDGE_53"
          ? `ce53:${item.itemType.toLowerCase()}:${item.slug}`
          : `cc:product:${item.slug}`;
      if (
        existingBySlug.has(prefixedSlug.toLowerCase()) ||
        existingBySlug.has(item.slug.toLowerCase())
      ) {
        continue;
      }
      const code =
        item.shortCode && !existingCodes.has(item.shortCode.toLowerCase())
          ? item.shortCode
          : crypto
              .createHash("sha256")
              .update(prefixedSlug)
              .digest("base64url")
              .slice(0, 6);
      existingCodes.add(code.toLowerCase());
      existingBySlug.add(prefixedSlug.toLowerCase());
      const canonicalTarget =
        item.url ||
        (item.brand === "CLASSIC_EDGE_53"
          ? `https://classicedge.in/machines/${item.slug}`
          : `https://classicconcepts.in/shop/p/${item.slug}`);
      await conv
        .execute({
          sql: `INSERT OR IGNORE INTO custom_links (
            id, code, title, target_url, link_type, product_slug, utm_campaign, created_by_name, clicks_count, created_at
          ) VALUES (?, ?, ?, ?, 'PRODUCT', ?, 'acrio_auto_sync', ?, 0, ?)`,
          args: [
            `lnk_${crypto.randomUUID().slice(0, 8)}`,
            code,
            cleanDisplayProductName(item.name),
            canonicalTarget,
            prefixedSlug,
            actorName,
            nowIso,
          ],
        })
        .catch(() => {});
      fixedCount++;
    }

    await invalidateWhatsAppCacheTags(["cc-products", "ce53-machines"]);
    return {
      ok: true,
      fixedCount,
      message: `Synchronized and repaired ${fixedCount} shortlinks and cross-site product URLs across Classic Concepts, Classic Edge 53, and ccapl.cc.`,
    };
  }

  return { ok: false, fixedCount: 0, message: "Unknown auto-fix action." };
}

export async function runAcrioEcosystemIssuesIdentifier(options?: {
  askPrompt?: string;
  forceFreshCatalog?: boolean;
  actorName?: string;
}): Promise<EcosystemIssuesAuditReport> {
  const started = Date.now();
  await ensureDatabasesBootstrapped();

  if (options?.forceFreshCatalog) {
    await invalidateWhatsAppCacheTags(["cc-products", "ce53-machines"]);
  }

  const conv = getRawLibSqlClient("conversations");
  const mkt = getRawLibSqlClient("marketing");

  const [catalog, linksRes, templatesRes] = await Promise.all([
    getCachedEcosystemCatalog(),
    conv.execute(`SELECT * FROM custom_links ORDER BY created_at DESC`),
    mkt.execute(`SELECT * FROM templates ORDER BY created_at DESC`),
  ]);

  const ccProducts = catalog.classicConceptsProducts;
  const ceItems = catalog.classicEdgeItems;
  const allItems = catalog.allItems;
  const linkRows = linksRes.rows as Record<string, unknown>[];
  const templateRows = templatesRes.rows as Record<string, unknown>[];

  const issues: EcosystemDetectedIssue[] = [];
  let seq = 1;
  const pushIssue = (
    issue: Omit<EcosystemDetectedIssue, "id">
  ): void => {
    issues.push({
      id: `iss_${seq++}`,
      ...issue,
    });
  };

  // Build lookup maps
  const allSlugsSet = new Set<string>();
  const skuMap = new Map<string, MainWebsiteProduct[]>();
  for (const it of allItems) {
    const sl = (it.slug || "").toLowerCase();
    if (sl) {
      allSlugsSet.add(sl);
      allSlugsSet.add(`cc:product:${sl}`);
      allSlugsSet.add(`ce53:machine:${sl}`);
      allSlugsSet.add(`ce53:consumable:${sl}`);
      allSlugsSet.add(`ce53:product:${sl}`);
    }
    if (it.sku) {
      const k = it.sku.trim().toUpperCase();
      const arr = skuMap.get(k) || [];
      arr.push(it);
      skuMap.set(k, arr);
    }
  }

  // --------------------------------------------------------------------------
  // 1. SHORTLINKS (ccapl.cc) & CROSS-SITE LINK AUDIT
  // --------------------------------------------------------------------------
  const customLinksBySlug = new Map<string, Record<string, unknown>[]>();
  const customLinksByTarget = new Map<string, Record<string, unknown>[]>();

  for (const row of linkRows) {
    const code = String(row.code || "");
    const title = String(row.title || "");
    const targetUrl = String(row.target_url || "").trim();
    const productSlug = String(row.product_slug || "").trim();
    const linkType = String(row.link_type || "PRODUCT");
    const shortUrl = `https://ccapl.cc/${code}`;

    if (productSlug) {
      const k = productSlug.toLowerCase();
      customLinksBySlug.set(k, [...(customLinksBySlug.get(k) || []), row]);
    }
    if (targetUrl) {
      const k = targetUrl.toLowerCase().replace(/\/+$/, "");
      customLinksByTarget.set(k, [...(customLinksByTarget.get(k) || []), row]);
    }

    // 1a. Localhost / internal port leak in shortlink target
    if (/localhost|127\.0\.0\.1|:300[0-9]/i.test(targetUrl)) {
      pushIssue({
        severity: "CRITICAL",
        category: "SHORTLINKS_AND_CROSS_SITE",
        site: "SHORTLINK_ROUTER",
        title: "Shortlink points to localhost / internal port",
        detail: `Shortlink ${shortUrl} ("${title}") redirects to "${targetUrl}", which will fail for external WhatsApp customers.`,
        affectedEntity: `${code} (${title})`,
        skuOrCode: code,
        sourceUrl: shortUrl,
        targetUrl,
        autoFixAction: "SYNC_SHORTLINKS",
        suggestion:
          "Click 'Auto-Fix & Sync Shortlinks' to rewrite the target URL to the public https:// domain.",
      });
    } else if (targetUrl.startsWith("http://")) {
      pushIssue({
        severity: "WARNING",
        category: "SHORTLINKS_AND_CROSS_SITE",
        site: "SHORTLINK_ROUTER",
        title: "Shortlink uses unencrypted HTTP target URL",
        detail: `Shortlink ${shortUrl} ("${title}") points to "${targetUrl}" instead of https://.`,
        affectedEntity: `${code} (${title})`,
        skuOrCode: code,
        sourceUrl: shortUrl,
        targetUrl,
        autoFixAction: "SYNC_SHORTLINKS",
        suggestion: "Upgrade target URL to https:// via 'Auto-Fix & Sync Shortlinks'.",
      });
    }

    // 1b. Orphaned product shortlink (points to a product slug not in the live catalog)
    if (linkType === "PRODUCT" && productSlug) {
      const bareSlug = productSlug
        .replace(/^(?:cc|ce53):(?:product|machine|consumable):/i, "")
        .toLowerCase();
      if (
        bareSlug &&
        !bareSlug.startsWith("cat:") &&
        !allSlugsSet.has(bareSlug) &&
        !allSlugsSet.has(productSlug.toLowerCase())
      ) {
        pushIssue({
          severity: "WARNING",
          category: "SHORTLINKS_AND_CROSS_SITE",
          site: "SHORTLINK_ROUTER",
          title: "Orphaned product shortlink (slug not found in catalog)",
          detail: `Shortlink ${shortUrl} references product_slug="${productSlug}", which does not match any active product in Classic Concepts or Classic Edge 53.`,
          affectedEntity: `${code} -> ${productSlug}`,
          skuOrCode: code,
          sourceUrl: shortUrl,
          targetUrl,
          suggestion:
            "Verify if this product was renamed or deleted on classicconcepts.in / classicedge.in and update the shortlink target.",
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // 2. CLASSIC CONCEPTS (classicconcepts.in) PRODUCT, MEDIA & SPEC AUDIT
  // --------------------------------------------------------------------------
  for (const prod of ccProducts) {
    const displayName = cleanDisplayProductName(prod.name);
    const publicUrl = prod.url || `https://classicconcepts.in/shop/p/${prod.slug}`;
    const adminUrl = `https://classicconcepts.in/admin/products/${prod.id}`;
    const isPodium =
      (prod.podiumSubCategoryNames && prod.podiumSubCategoryNames.length > 0) ||
      /podium|lectern|pulpit/i.test(`${prod.categoryName || ""} ${prod.name}`);

    // 2a. Missing shortlink
    if (!prod.shortUrl || !prod.shortUrl.includes("ccapl.cc/")) {
      pushIssue({
        severity: "WARNING",
        category: "SHORTLINKS_AND_CROSS_SITE",
        site: "CLASSIC_CONCEPTS",
        title: "Product missing ccapl.cc shortlink",
        detail: `${displayName} (${prod.slug}) does not have a registered ccapl.cc shortlink for WhatsApp replies.`,
        affectedEntity: displayName,
        skuOrCode: prod.sku || prod.slug,
        sourceUrl: publicUrl,
        adminEditUrl: adminUrl,
        autoFixAction: "SYNC_SHORTLINKS",
        suggestion: "Run 'Auto-Fix & Sync Shortlinks' to generate its 6-char ccapl.cc link.",
      });
    }

    // 2b. Missing primary product image or non-HTTPS / non-R2 image URL
    const allImgs = [
      ...(prod.mainImage ? [prod.mainImage] : []),
      ...(prod.images || []),
    ].filter(Boolean);
    if (allImgs.length === 0) {
      pushIssue({
        severity: "CRITICAL",
        category: "PRODUCT_MEDIA_AND_R2",
        site: "CLASSIC_CONCEPTS",
        title: "Product has no photos in storage",
        detail: `${displayName} has 0 images. Customers on classicconcepts.in cannot see the product and ACRIO cannot share photos on WhatsApp.`,
        affectedEntity: displayName,
        skuOrCode: prod.sku || prod.slug,
        sourceUrl: publicUrl,
        adminEditUrl: adminUrl,
        suggestion: "Upload product photos to R2 storage in the Product Editor.",
      });
    } else {
      const relativeOrHttpImgs = allImgs.filter(
        (u) => !/^https:\/\//i.test(u.trim())
      );
      if (relativeOrHttpImgs.length > 0) {
        pushIssue({
          severity: "WARNING",
          category: "PRODUCT_MEDIA_AND_R2",
          site: "CLASSIC_CONCEPTS",
          title: "Product has relative or non-HTTPS image URL",
          detail: `${displayName} has ${relativeOrHttpImgs.length} image URL(s) not served over https:// (${relativeOrHttpImgs[0]}). WhatsApp Cloud API requires public https:// R2 URLs to attach images.`,
          affectedEntity: displayName,
          skuOrCode: prod.sku || prod.slug,
          sourceUrl: publicUrl,
          targetUrl: relativeOrHttpImgs[0],
          adminEditUrl: adminUrl,
          suggestion: "Ensure all product images use full https://media.classicconcepts.in/... URLs.",
        });
      }
    }

    // 2c. Variant image & price checks
    const variants = prod.variants || [];
    if (variants.length > 0) {
      const variantsMissingImg = variants.filter((v) => !v.imageUrl);
      if (variantsMissingImg.length > 0) {
        pushIssue({
          severity: "WARNING",
          category: "PRODUCT_MEDIA_AND_R2",
          site: "CLASSIC_CONCEPTS",
          title: "Product variant(s) missing dedicated photo",
          detail: `${displayName} has ${variantsMissingImg.length} variant(s) without a dedicated photo (${variantsMissingImg.map((v) => v.name).join(", ")}). When a customer asks ACRIO for that specific colour photo, ACRIO has to fall back to the main image.`,
          affectedEntity: `${displayName} [${variantsMissingImg.map((v) => v.name).join(", ")}]`,
          skuOrCode: prod.sku || prod.slug,
          sourceUrl: publicUrl,
          adminEditUrl: adminUrl,
          suggestion: "Assign a variant-specific R2 photo to each colour variant in Manage Variants.",
        });
      }

      // Check if multiple distinct variants share the exact same image URL
      if (variants.length >= 2) {
        const varUrls = variants
          .map((v) => v.imageUrl || "")
          .filter(Boolean);
        if (varUrls.length >= 2 && new Set(varUrls).size === 1) {
          pushIssue({
            severity: "INFO",
            category: "PRODUCT_MEDIA_AND_R2",
            site: "CLASSIC_CONCEPTS",
            title: "All colour variants point to the same image URL",
            detail: `${displayName} has ${variants.length} variants (${variants.map((v) => v.name).join(", ")}) that all use the exact same image file.`,
            affectedEntity: displayName,
            skuOrCode: prod.sku || prod.slug,
            sourceUrl: publicUrl,
            adminEditUrl: adminUrl,
            suggestion: "Upload distinct colour photos per variant so customers see the true colour finish.",
          });
        }
      }
    }

    // 2d. Pricing & MRP discrepancies
    if (prod.basePrice === null || prod.basePrice <= 0) {
      pushIssue({
        severity: "WARNING",
        category: "PRICING_AND_SPECS",
        site: "CLASSIC_CONCEPTS",
        title: "Product has no selling price (Price on Request / ₹0)",
        detail: `${displayName} has basePrice=${prod.basePrice ?? "null"}. ACRIO cannot include it in strict budget calculations or multi-item project quotes.`,
        affectedEntity: displayName,
        skuOrCode: prod.sku || prod.slug,
        sourceUrl: publicUrl,
        adminEditUrl: adminUrl,
        suggestion: "Set a verified base/selling price in the Product Editor if this is a ready-stock model.",
      });
    } else if (
      typeof prod.regularPrice === "number" &&
      prod.regularPrice > 0 &&
      prod.regularPrice < prod.basePrice
    ) {
      pushIssue({
        severity: "CRITICAL",
        category: "PRICING_AND_SPECS",
        site: "CLASSIC_CONCEPTS",
        title: "MRP is lower than selling price",
        detail: `${displayName} has selling price ₹${prod.basePrice.toLocaleString("en-IN")} > MRP ₹${prod.regularPrice.toLocaleString("en-IN")}.`,
        affectedEntity: displayName,
        skuOrCode: prod.sku || prod.slug,
        sourceUrl: publicUrl,
        adminEditUrl: adminUrl,
        suggestion: "Update Base/MRP Price and Discount Price so Selling Price <= MRP.",
      });
    }

    // 2e. Podium-specific specification & taxonomy checks
    if (isPodium) {
      const dims = prod.dimensions || [];
      const hasHeight = dims.some((d) => /height/i.test(d.label || d.key || ""));
      const hasTop = dims.some((d) => /top|reading/i.test(d.label || d.key || ""));
      if (!hasHeight || !hasTop) {
        pushIssue({
          severity: "WARNING",
          category: "PRICING_AND_SPECS",
          site: "CLASSIC_CONCEPTS",
          title: `Podium missing ${!hasHeight && !hasTop ? "Height & Top Sheet" : !hasHeight ? "Height" : "Top Sheet"} dimensions`,
          detail: `${displayName} is a podium but is missing structured ${!hasHeight && !hasTop ? "Height and Top Sheet" : !hasHeight ? "Height" : "Top Sheet"} dimensions for ACRIO size filtering.`,
          affectedEntity: displayName,
          skuOrCode: prod.sku || prod.slug,
          sourceUrl: publicUrl,
          adminEditUrl: adminUrl,
          suggestion: "Add Height and Top Sheet dimensions on the product page.",
        });
      }
      if (!prod.podiumSubCategoryNames || prod.podiumSubCategoryNames.length === 0) {
        pushIssue({
          severity: "INFO",
          category: "PRICING_AND_SPECS",
          site: "CLASSIC_CONCEPTS",
          title: "Podium not assigned to a Podium Range (Essential / Signature / Premium)",
          detail: `${displayName} has no podiumSubCategory assigned, so it may be omitted when customers browse by podium tier.`,
          affectedEntity: displayName,
          skuOrCode: prod.sku || prod.slug,
          sourceUrl: publicUrl,
          adminEditUrl: adminUrl,
          suggestion: "Assign a Podium Sub-Category in the Admin Podium Editor.",
        });
      }
    }

    // 2f. Missing description / highlights
    if (
      (!prod.description || prod.description.trim().length < 15) &&
      (!prod.features || prod.features.length === 0)
    ) {
      pushIssue({
        severity: "INFO",
        category: "TEMPLATES_AND_CONTENT",
        site: "CLASSIC_CONCEPTS",
        title: "Product missing bullet highlights / description",
        detail: `${displayName} has no structured bullet description or key features.`,
        affectedEntity: displayName,
        skuOrCode: prod.sku || prod.slug,
        sourceUrl: publicUrl,
        adminEditUrl: adminUrl,
        suggestion: "Use 'ACRIO Generate Bullets' on the product page to add clean highlights.",
      });
    }
  }

  // 2g. Duplicate SKUs across products
  for (const [sku, list] of skuMap.entries()) {
    if (list.length > 1) {
      pushIssue({
        severity: "WARNING",
        category: "PRICING_AND_SPECS",
        site: list[0].brand === "CLASSIC_EDGE_53" ? "CLASSIC_EDGE_53" : "CLASSIC_CONCEPTS",
        title: `Duplicate SKU "${sku}" shared by ${list.length} items`,
        detail: `SKU "${sku}" is assigned to multiple items: ${list.map((i) => `${cleanDisplayProductName(i.name)} (${i.slug})`).join(", ")}. This can cause ambiguity when customers ask for model code "${sku}".`,
        affectedEntity: sku,
        skuOrCode: sku,
        sourceUrl: list[0].url,
        suggestion: "Assign a unique SKU code to each distinct product.",
      });
    }
  }

  // --------------------------------------------------------------------------
  // 3. CLASSIC EDGE 53 (classicedge.in) MACHINES, CONSUMABLES & ACCESSORIES AUDIT
  // --------------------------------------------------------------------------
  for (const ce of ceItems) {
    const displayName = cleanDisplayProductName(ce.name);
    const publicUrl = ce.url || `https://classicedge.in/machines/${ce.slug}`;

    if (!ce.shortUrl || !ce.shortUrl.includes("ccapl.cc/")) {
      pushIssue({
        severity: "WARNING",
        category: "SHORTLINKS_AND_CROSS_SITE",
        site: "CLASSIC_EDGE_53",
        title: "Classic Edge 53 item missing ccapl.cc shortlink",
        detail: `${displayName} (${ce.itemType}) does not have a registered ccapl.cc shortlink.`,
        affectedEntity: displayName,
        skuOrCode: ce.sku || ce.slug,
        sourceUrl: publicUrl,
        autoFixAction: "SYNC_SHORTLINKS",
        suggestion: "Run 'Auto-Fix & Sync Shortlinks' to generate its ccapl.cc shortlink.",
      });
    }

    if (ce.itemType === "MACHINE" && !ce.mainImage && (!ce.images || ce.images.length === 0)) {
      pushIssue({
        severity: "WARNING",
        category: "PRODUCT_MEDIA_AND_R2",
        site: "CLASSIC_EDGE_53",
        title: "Machine missing primary photo",
        detail: `Classic Edge 53 machine "${displayName}" has no image URL configured.`,
        affectedEntity: displayName,
        skuOrCode: ce.sku || ce.slug,
        sourceUrl: publicUrl,
        suggestion: "Add a machine image URL in the Classic Edge 53 catalog.",
      });
    }
  }

  // --------------------------------------------------------------------------
  // 4. WHATSAPP TEMPLATES & AI.LOGS DIAGNOSTIC AUDIT
  // --------------------------------------------------------------------------
  for (const tpl of templateRows) {
    const name = String(tpl.name || "");
    const status = String(tpl.approval_status || "");
    const rejReason = tpl.rejection_reason ? String(tpl.rejection_reason) : null;
    const ctaUrl = tpl.cta_url ? String(tpl.cta_url) : "";

    if (status === "REJECTED" || status === "PAUSED") {
      pushIssue({
        severity: status === "REJECTED" ? "WARNING" : "INFO",
        category: "TEMPLATES_AND_CONTENT",
        site: "WHATSAPP_HUB",
        title: `WhatsApp Template "${name}" is ${status}`,
        detail: `Template "${name}" has status=${status}${rejReason && rejReason !== "NONE" ? ` (Reason: ${rejReason})` : ""}.`,
        affectedEntity: name,
        sourceUrl: "/dashboard/templates",
        suggestion: "Review template wording or variables in Templates & Button Flows.",
      });
    }

    if (ctaUrl && /localhost|127\.0\.0\.1|:300[0-9]/i.test(ctaUrl)) {
      pushIssue({
        severity: "CRITICAL",
        category: "TEMPLATES_AND_CONTENT",
        site: "WHATSAPP_HUB",
        title: `Template "${name}" button URL points to localhost`,
        detail: `Template "${name}" has cta_url="${ctaUrl}".`,
        affectedEntity: name,
        sourceUrl: "/dashboard/templates",
        targetUrl: ctaUrl,
        suggestion: "Update the template button URL to use https://classicconcepts.in or https://ccapl.cc.",
      });
    }
  }

  // Check recent ai.logs for errors, zero-match product queries, or fallbacks
  let recentLogsCount = 0;
  try {
    const logPath = path.join(/*turbopackIgnore: true*/ path.resolve(process.cwd(), "..", ".."), "ai.logs");
    const altPath = path.join(/*turbopackIgnore: true*/ process.cwd(), "ai.logs");
    const activeLogPath = fs.existsSync(/*turbopackIgnore: true*/ logPath)
      ? logPath
      : fs.existsSync(/*turbopackIgnore: true*/ altPath)
      ? altPath
      : null;

    if (activeLogPath) {
      const rawLog = fs.readFileSync(/*turbopackIgnore: true*/ activeLogPath, "utf8");
      const metaLines = rawLog
        .split(/\r?\n/)
        .filter((l) => l.startsWith("META_JSON: "))
        .slice(-120);
      recentLogsCount = metaLines.length;

      const zeroMatchQueries = new Set<string>();
      let errorTurns = 0;

      for (const line of metaLines) {
        try {
          const entry = JSON.parse(line.slice("META_JSON: ".length)) as AiTraceLogEntry;
          if (entry.outcomeSource === "ERROR") {
            errorTurns++;
          }
          if (
            entry.productLookupTriggered &&
            Array.isArray(entry.productsLookedUp) &&
            entry.productsLookedUp.length === 0 &&
            entry.question &&
            entry.question.length >= 3
          ) {
            zeroMatchQueries.add(entry.question.trim());
          }
        } catch {
          // Ignore malformed log line
        }
      }

      if (errorTurns > 0) {
        pushIssue({
          severity: "WARNING",
          category: "AI_LOGS_AND_BRIDGES",
          site: "WHATSAPP_HUB",
          title: `${errorTurns} recent AI turn(s) recorded ERROR in ai.logs`,
          detail: `Found ${errorTurns} error trace(s) in the last ${recentLogsCount} AI log entries.`,
          affectedEntity: "ai.logs",
          sourceUrl: "/dashboard/ai-logs",
          suggestion: "Inspect AI Logs (ai.logs) filtered by Outcome = ERROR.",
        });
      }

      if (zeroMatchQueries.size > 0) {
        const sampleQueries = Array.from(zeroMatchQueries).slice(-6);
        pushIssue({
          severity: "INFO",
          category: "AI_LOGS_AND_BRIDGES",
          site: "WHATSAPP_HUB",
          title: `${zeroMatchQueries.size} recent customer product query(s) returned 0 catalog matches`,
          detail: `Recent queries with 0 matched items: ${sampleQueries.map((q) => `"${q}"`).join(", ")}.`,
          affectedEntity: sampleQueries.join(" | "),
          sourceUrl: "/dashboard/ai-logs",
          suggestion:
            "Check if these queries use new synonyms, model codes, or budget constraints not covered by current catalog products.",
        });
      }
    }
  } catch {
    // Non-blocking
  }

  // Sort issues: CRITICAL first, then WARNING, then INFO
  const sevRank: Record<EcosystemIssueSeverity, number> = {
    CRITICAL: 0,
    WARNING: 1,
    INFO: 2,
  };
  issues.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

  const criticalCount = issues.filter((i) => i.severity === "CRITICAL").length;
  const warningCount = issues.filter((i) => i.severity === "WARNING").length;
  const infoCount = issues.filter((i) => i.severity === "INFO").length;

  const healthScore = Math.max(
    0,
    Math.min(100, Math.round(100 - criticalCount * 8 - warningCount * 1.5 - infoCount * 0.25))
  );

  const buildSiteSummary = (
    site: EcosystemSiteKey,
    label: string,
    publicDomain: string,
    totalItemsScanned: number,
    online: boolean
  ): EcosystemSiteHealthSummary => {
    const siteIssues = issues.filter((i) => i.site === site);
    const crit = siteIssues.filter((i) => i.severity === "CRITICAL").length;
    const warn = siteIssues.filter((i) => i.severity === "WARNING").length;
    const inf = siteIssues.filter((i) => i.severity === "INFO").length;
    return {
      site,
      label,
      publicDomain,
      online,
      totalItemsScanned,
      criticalCount: crit,
      warningCount: warn,
      infoCount: inf,
      statusNote:
        crit > 0
          ? `${crit} critical issue(s) need attention`
          : warn > 0
          ? `${warn} warning(s) detected`
          : "All checks healthy",
    };
  };

  const siteSummaries: EcosystemSiteHealthSummary[] = [
    buildSiteSummary(
      "CLASSIC_CONCEPTS",
      "Classic Concepts Main Site",
      "classicconcepts.in",
      ccProducts.length,
      ccProducts.length > 0
    ),
    buildSiteSummary(
      "CLASSIC_EDGE_53",
      "Classic Edge 53 Machines & Tools",
      "classicedge.in",
      ceItems.length,
      ceItems.length > 0
    ),
    buildSiteSummary(
      "SHORTLINK_ROUTER",
      "Shortlink & Cross-Site Router",
      "ccapl.cc",
      linkRows.length,
      true
    ),
    buildSiteSummary(
      "WHATSAPP_HUB",
      "WhatsApp Hub & ACRIO Concierge",
      "chat.ccapl.cc",
      templateRows.length + recentLogsCount,
      true
    ),
  ];

  // Optional: Interactive ACRIO AI Diagnostic Analysis when Dev asks a question or requests AI synthesis
  let acrioAnalysis: string | null = null;
  let acrioModel: string | null = null;
  if (options?.askPrompt && options.askPrompt.trim()) {
    const { apiKey } = await resolveSharedAnthropicApiKey("admin");
    if (apiKey) {
      const topIssuesDigest = issues
        .slice(0, 60)
        .map(
          (i, idx) =>
            `${idx + 1}. [${i.severity} | ${i.site} | ${i.category}] ${i.title} - ${i.detail} (Entity: ${i.affectedEntity})`
        )
        .join("\n");

      const aiRes = await callClaudeHaikuMessagesDetailed({
        apiKey,
        effort: "medium",
        maxTokens: 2500,
        timeoutMs: 22000,
        system: `You are ACRIO Issues Identifier (Dev Mode), the ecosystem diagnostics and quality-assurance assistant for Classic Concepts (classicconcepts.in), Classic Edge 53 (classicedge.in), WhatsApp Hub (chat.ccapl.cc), and the ccapl.cc shortlink router.
Follow all Classic Concepts plain-language rules: write in clear, direct everyday English with zero em-dashes ("—") and zero robotic filler.
Group your findings clearly with bullet points, exact SKU/slug/shortlink names, and concrete steps to fix each discrepancy.`,
        messages: [
          {
            role: "user",
            content: `Live Ecosystem Audit Summary:
- Health Score: ${healthScore}/100
- Classic Concepts Products Scanned: ${ccProducts.length}
- Classic Edge 53 Items Scanned: ${ceItems.length}
- ccapl.cc Shortlinks Scanned: ${linkRows.length}
- WhatsApp Templates Scanned: ${templateRows.length}
- Total Issues Found: ${issues.length} (Critical: ${criticalCount}, Warning: ${warningCount}, Info: ${infoCount})

Detected Discrepancies & Issues (Top ${Math.min(60, issues.length)}):
${topIssuesDigest || "None"}

Developer Question / Audit Focus:
${options.askPrompt.trim()}`,
          },
        ],
      });

      if (aiRes.ok && aiRes.text) {
        acrioAnalysis = formatWhatsAppOutboundText(aiRes.text);
        acrioModel = LOCKED_CLAUDE_MODEL;
        recordAndBroadcastAiLog({
          website: "WHATSAPP_HUB",
          websiteLabel: "Classic Concepts WhatsApp Hub",
          feature: "ACRIO Dev Issues Identifier",
          actor: options.actorName || "DEV",
          question: options.askPrompt.trim(),
          model: LOCKED_CLAUDE_MODEL,
          effort: "medium",
          outcomeSource: "LIVE_AI",
          responseCacheStatus: "BYPASS",
          catalogCacheStatus: catalog.cacheMeta.catalogCacheStatus,
          cacheDetails: `Ecosystem Audit (${issues.length} issues detected across ${allItems.length} items)`,
          productLookupTriggered: true,
          productLookupQuery: options.askPrompt.trim(),
          productLookupBudget: null,
          productLookupTotalScanned: allItems.length,
          productsLookedUp: [],
          steps: [
            {
              stepNumber: 1,
              label: "Scanned ecosystem databases, R2 media, and ccapl.cc shortlinks",
              detail: `cc=${ccProducts.length}, ce53=${ceItems.length}, links=${linkRows.length}, issues=${issues.length}`,
              durationMs: Date.now() - started,
              status: "OK",
            },
          ],
          response: acrioAnalysis,
          durationMs: Date.now() - started,
          tokenUsage: aiRes.usage,
        });
      }
    }
  }

  return {
    scannedAtIso: new Date().toISOString(),
    scannedAtIst: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST",
    durationMs: Date.now() - started,
    healthScore,
    totals: {
      totalIssues: issues.length,
      critical: criticalCount,
      warning: warningCount,
      info: infoCount,
      classicConceptsProducts: ccProducts.length,
      classicEdgeItems: ceItems.length,
      shortLinksCount: linkRows.length,
      templatesCount: templateRows.length,
      recentAiLogsScanned: recentLogsCount,
    },
    siteSummaries,
    issues,
    acrioAnalysis,
    acrioModel,
  };
}

export * from "./anthropic-usage-spend";

