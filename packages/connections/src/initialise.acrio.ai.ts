import {
  appendAiTraceLog,
  cleanDisplayProductName,
  type AiLookedUpProduct,
  type AiTokenUsage,
  type AiTraceLogEntry,
  type MainWebsiteProduct,
} from "@cc/database";
import { socketHub } from "@cc/sockets";
import {
  type AnthropicContentBlock,
} from "./image-intelligence";

export const LOCKED_CLAUDE_MODEL = "claude-haiku-5-5" as const;
const MIN_CACHEABLE_STATIC_CHARS = 1500;

export interface AnthropicCacheControl {
  type: "ephemeral";
  ttl?: "5m" | "1h";
}

export interface AnthropicSystemTextBlock {
  type: "text";
  text: string;
  cache_control?: AnthropicCacheControl;
}

export interface ClaudeMessageInput {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface DetailedClaudeCallResult {
  ok: boolean;
  text: string | null;
  statusCode: number;
  durationMs: number;
  effort: string;
  usage: AiTokenUsage | null;
  error: string | null;
}

/**
 * Orders system blocks according to Anthropic Prompt Caching best practices:
 * static instructions and reference data first with cache_control, followed by
 * any dynamic per-request instructions without cache_control so the cached prefix stays stable.
 */
export function buildOrderedClaudeSystemBlocks(params: {
  system: string | AnthropicSystemTextBlock[];
  dynamicSystem?: string;
  cacheSystem?: boolean;
  cacheTtl?: "5m" | "1h";
}): AnthropicSystemTextBlock[] {
  const blocks: AnthropicSystemTextBlock[] = [];
  const cacheControl: AnthropicCacheControl = params.cacheTtl
    ? { type: "ephemeral", ttl: params.cacheTtl }
    : { type: "ephemeral" };

  if (Array.isArray(params.system)) {
    for (const blk of params.system) {
      const clean = String(blk?.text || "").trim();
      if (!clean) continue;
      blocks.push(
        blk.cache_control
          ? { type: "text", text: clean, cache_control: blk.cache_control }
          : { type: "text", text: clean }
      );
    }
  } else {
    const cleanStatic = String(params.system || "").trim();
    if (cleanStatic) {
      const shouldCache =
        params.cacheSystem === true ||
        (params.cacheSystem !== false && cleanStatic.length >= MIN_CACHEABLE_STATIC_CHARS);
      blocks.push(
        shouldCache
          ? { type: "text", text: cleanStatic, cache_control: cacheControl }
          : { type: "text", text: cleanStatic }
      );
    }
  }

  const cleanDynamic = String(params.dynamicSystem || "").trim();
  if (cleanDynamic) {
    blocks.push({ type: "text", text: cleanDynamic });
  }

  return blocks;
}

/**
 * Adds a cache breakpoint on the last completed history message (before the current user turn)
 * when multi-turn RAG/retrieval context is appended to the final turn. That way earlier DB turns
 * stay byte-identical and reuse the cached prefix across customer replies.
 */
export function buildCacheAwareClaudeMessages(params: {
  messages: ClaudeMessageInput[];
  cacheLastCompletedTurn?: boolean;
  cacheTtl?: "5m" | "1h";
}): ClaudeMessageInput[] {
  const cloned: ClaudeMessageInput[] = params.messages.map((m) => ({
    role: m.role,
    content: Array.isArray(m.content) ? m.content.map((b) => ({ ...b })) : m.content,
  }));

  if (!params.cacheLastCompletedTurn || cloned.length < 3) {
    return cloned;
  }

  const targetIdx = cloned.length - 2;
  const target = cloned[targetIdx];
  if (!target) return cloned;

  const historyCharLength = cloned
    .slice(0, targetIdx + 1)
    .reduce((acc, m) => {
      if (typeof m.content === "string") return acc + m.content.length;
      if (Array.isArray(m.content)) {
        return (
          acc +
          m.content.reduce(
            (sum, b) => sum + (b.type === "text" ? String((b as any).text || "").length : 400),
            0
          )
        );
      }
      return acc;
    }, 0);

  if (historyCharLength < 400) {
    return cloned;
  }

  const cacheControl: AnthropicCacheControl = params.cacheTtl
    ? { type: "ephemeral", ttl: params.cacheTtl }
    : { type: "ephemeral" };

  if (typeof target.content === "string") {
    target.content = [
      {
        type: "text",
        text: target.content,
        cache_control: cacheControl,
      } as AnthropicContentBlock,
    ];
  } else if (Array.isArray(target.content) && target.content.length > 0) {
    const lastBlk = target.content[target.content.length - 1] as AnthropicContentBlock & {
      cache_control?: AnthropicCacheControl;
    };
    lastBlk.cache_control = cacheControl;
  }

  return cloned;
}

export function buildClaudeMessagesRequestBody(params: {
  system: string | AnthropicSystemTextBlock[];
  dynamicSystem?: string;
  cacheSystem?: boolean;
  cacheTtl?: "5m" | "1h";
  automaticCaching?: boolean;
  cacheLastCompletedTurn?: boolean;
  messages: ClaudeMessageInput[];
  maxTokens?: number;
  temperature?: number;
  effort?: "low" | "medium" | "high";
  disableThinking?: boolean;
  includeLegacyTemp?: boolean;
  overrideDisableThinking?: boolean;
}): Record<string, unknown> {
  const effort = params.effort || "medium";
  const skipThinking = Boolean(params.overrideDisableThinking || params.disableThinking);
  const requestedMax = params.maxTokens ?? 4096;
  const isExplicitLegacyTemp =
    Boolean(params.includeLegacyTemp) && typeof params.temperature === "number";
  const resolvedMaxTokens = skipThinking
    ? typeof params.maxTokens === "number"
      ? params.maxTokens
      : 2048
    : isExplicitLegacyTemp && typeof params.maxTokens === "number"
    ? requestedMax
    : Math.max(requestedMax, 4096);
  const systemBlocks = buildOrderedClaudeSystemBlocks({
    system: params.system,
    dynamicSystem: params.dynamicSystem,
    cacheSystem: params.cacheSystem,
    cacheTtl: params.cacheTtl,
  });
  const preparedMessages = buildCacheAwareClaudeMessages({
    messages: params.messages,
    cacheLastCompletedTurn: params.cacheLastCompletedTurn,
    cacheTtl: params.cacheTtl,
  });

  const bodyObj: Record<string, unknown> = {
    model: LOCKED_CLAUDE_MODEL,
    max_tokens: resolvedMaxTokens,
    system: systemBlocks,
    messages: preparedMessages,
  };

  if (params.automaticCaching) {
    bodyObj.cache_control = params.cacheTtl
      ? { type: "ephemeral", ttl: params.cacheTtl }
      : { type: "ephemeral" };
  }

  if (skipThinking) {
    // Fast non-thinking mode so short tasks avoid thinking latency and thinking tokens
  } else if (isExplicitLegacyTemp) {
    bodyObj.temperature = params.temperature;
  } else {
    bodyObj.thinking = { type: "adaptive" };
    bodyObj.output_config = { effort };
  }

  return bodyObj;
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

export interface ClaudeMessagesCallParams {
  apiKey: string;
  system: string | AnthropicSystemTextBlock[];
  dynamicSystem?: string;
  cacheSystem?: boolean;
  cacheTtl?: "5m" | "1h";
  automaticCaching?: boolean;
  cacheLastCompletedTurn?: boolean;
  messages: ClaudeMessageInput[];
  maxTokens?: number;
  temperature?: number;
  effort?: "low" | "medium" | "high";
  disableThinking?: boolean;
  timeoutMs?: number;
}

export async function callClaudeHaikuMessagesDetailed(
  params: ClaudeMessagesCallParams
): Promise<DetailedClaudeCallResult> {
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
    const bodyObj = buildClaudeMessagesRequestBody({
      system: params.system,
      dynamicSystem: params.dynamicSystem,
      cacheSystem: params.cacheSystem,
      cacheTtl: params.cacheTtl,
      automaticCaching: params.automaticCaching,
      cacheLastCompletedTurn: params.cacheLastCompletedTurn,
      messages: params.messages,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
      effort: params.effort,
      disableThinking: params.disableThinking,
      includeLegacyTemp,
      overrideDisableThinking,
    });
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
      !params.disableThinking &&
      (!res.ok ||
        !extracted ||
        json?.stop_reason === "max_tokens" ||
        (extracted.includes("{") && !extracted.trim().endsWith("}")))
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

export async function callClaudeHaikuMessages(
  params: ClaudeMessagesCallParams
): Promise<string | null> {
  const res = await callClaudeHaikuMessagesDetailed(params);
  return res.text;
}

export function recordAndBroadcastAiLog(
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

export function mapProductToLogItem(item: MainWebsiteProduct): AiLookedUpProduct {
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

export function sanitizePlainEnglish(text: string): string {
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

