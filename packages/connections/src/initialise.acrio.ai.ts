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
  messages: {
    role: "user" | "assistant";
    content: string | AnthropicContentBlock[];
  }[];
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
    const isExplicitLegacyTemp =
      includeLegacyTemp && typeof params.temperature === "number";
    const resolvedMaxTokens = overrideDisableThinking
      ? Math.min(requestedMax, 2048)
      : isExplicitLegacyTemp && typeof params.maxTokens === "number"
      ? requestedMax
      : Math.max(requestedMax, 4096);
    const bodyObj: Record<string, unknown> = {
      model: LOCKED_CLAUDE_MODEL,
      max_tokens: resolvedMaxTokens,
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
  messages: {
    role: "user" | "assistant";
    content: string | AnthropicContentBlock[];
  }[];
  maxTokens?: number;
  temperature?: number;
  effort?: "low" | "medium" | "high";
  timeoutMs?: number;
}): Promise<string | null> {
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

