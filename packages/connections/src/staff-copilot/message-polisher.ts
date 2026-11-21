import { resolveSharedAnthropicApiKey } from "@cc/database";
import {
  LOCKED_CLAUDE_MODEL,
  callClaudeHaikuMessagesDetailed,
  formatWhatsAppOutboundText,
  parseClaudeJson,
  sanitizePlainEnglish,
} from "@cc/connections/initialise.acrio.ai";

export interface StaffMessagePolishResult {
  originalText: string;
  enhancedText: string;
  changed: boolean;
  source: "LOCAL_FAST_PATH" | "MEMORY_CACHE" | "CLAUDE_CACHED" | "LOCAL_FALLBACK";
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  durationMs: number;
}

interface PolishCacheEntry {
  enhancedText: string;
  expiresAt: number;
}

const POLISH_CACHE_TTL_MS = 30 * 60 * 1000;
const POLISH_CACHE_MAX_ENTRIES = 500;
const polishMemoryCache = new Map<string, PolishCacheEntry>();

/**
 * Static >= 1,600-char system prompt so Anthropic Prompt Caching hits cleanly
 * (>= 512 tokens minimum) across all staff replies at 90% input token savings.
 */
export const STAFF_MESSAGE_POLISH_SYSTEM_PROMPT = `You are a fast WhatsApp message proofreader and formatter for Classic Concepts Acrylic Private Limited and Classic Edge 53.
Your ONLY job is to take a rough WhatsApp reply typed by a staff member and return a polite, clear, spelling-corrected, properly punctuated version ready to send to a customer.

STRICT RULES (FOLLOW EVERY RULE):
1. KEEP THE EXACT MEANING AND FACTS:
   - Never add promises, discounts, timelines, product specs, prices, phone numbers, or delivery commitments that the staff member did not write.
   - Never remove or alter any number, rupee amount (₹), quantity, size/dimension, product SKU/model code (like CCP057, CCP065, CE53), order number, or https:// link! Every single number and URL in the input MUST stay intact in the output.
2. FIX SPELLING, TEXT-SPEAK & PUNCTUATION:
   - Expand casual SMS shorthand naturally: "gud" -> "Good", "u" -> "you", "ur" -> "your", "r" -> "are", "pls"/"plz" -> "please", "thx"/"thnx" -> "thank you", "chk" -> "check", "msg" -> "message", "wtsp"/"whatup" -> "WhatsApp", "deitlas"/"detilas" -> "details", "requried"/"reqd" -> "required", "qty" -> "quantity", "qtn" -> "quotation", "delvry" -> "delivery", "catalog" -> "catalogue".
   - Fix lowercase starts, run-on sentences, missing question marks ("?"), and missing full stops (".").
   - Preserve respectful Indian business terms naturally ("sir", "ma'am", "ji") when the staff member included them.
   - If the staff member wrote in Hinglish/Hindi using Latin script, polish the spelling and grammar gently in the same language instead of translating it away unless only English shorthand was used.
3. PLAIN EVERYDAY ENGLISH & WHATSAPP STYLE:
   - Keep replies warm, polite, natural, and short (same length range as the original message, never bloated corporate fluff).
   - Zero em-dashes, zero spaced en-dashes, zero double-hyphens ("--").
   - Zero stiff AI buzzwords (never use bespoke, elevate, delve, meticulous, seamless, utilize, leverage, robust, synergy, esteemed, delighted to inform).
   - Use single asterisks *like this* only if bold emphasis genuinely helps readability; never use double **bold** or markdown headings.

FEW-SHOT EXAMPLES:
- Input: "gud afternoon sir"
  Output: {"polished":"Good afternoon, sir."}
- Input: "did u check the catalogue and finalize the podium"
  Output: {"polished":"Did you get a chance to check the catalogue and finalize the podium?"}
- Input: "pls share size qty and delivery city we will share quote"
  Output: {"polished":"Please share your required size, quantity, and delivery city so we can send you a quote."}
- Input: "ur order dispatched today track link https://ccapl.cc/Ab12Cd"
  Output: {"polished":"Your order has been dispatched today. You can track it here: https://ccapl.cc/Ab12Cd"}
- Input: "ok sir i will check with production team and update u"
  Output: {"polished":"Okay, sir. I will check with our production team and update you shortly."}
- Input: "ccp057 price 19800 + gst"
  Output: {"polished":"The CCP057 podium is priced at ₹19,800 + GST."}

Return ONLY valid JSON:
{"polished":"Clean formatted WhatsApp message ready to send"}`;

function preserveNumbersAndUrls(original: string, candidate: string): boolean {
  const origUrls = original.match(/https?:\/\/\S+/gi) || [];
  for (const url of origUrls) {
    if (!candidate.includes(url)) return false;
  }
  const origNumbers = original.match(/\b\d+(?:\.\d+)?\b/g) || [];
  for (const num of origNumbers) {
    if (!candidate.includes(num)) return false;
  }
  return true;
}

export function deterministicStaffTextPolish(rawText: string): string {
  const cleaned = String(rawText || "").trim();
  if (!cleaned) return "";

  // Preserve URLs intact while fixing shorthand/spelling on text segments
  const urlTokens: string[] = [];
  let masked = cleaned.replace(/https?:\/\/\S+/gi, (m) => {
    const idx = urlTokens.push(m) - 1;
    return `__URL_${idx}__`;
  });

  const replacements: [RegExp, string][] = [
    [/\bgud\b/gi, "good"],
    [/\bgm\b/gi, "Good morning"],
    [/\bga\b/gi, "Good afternoon"],
    [/\bge\b/gi, "Good evening"],
    [/\bgn\b/gi, "Good night"],
    [/\bmrng\b/gi, "morning"],
    [/\baftrnon\b/gi, "afternoon"],
    [/\bu\b/gi, "you"],
    [/\bur\b/gi, "your"],
    [/\br\b/gi, "are"],
    [/\bplz\b|\bpls\b/gi, "please"],
    [/\bthx\b|\bthnx\b|\btq\b/gi, "thank you"],
    [/\bchk\b/gi, "check"],
    [/\bmsg\b/gi, "message"],
    [/\bwtsp\b|\bwhatup\b|\bwhatsap\b/gi, "WhatsApp"],
    [/\bdeitlas\b|\bdetilas\b|\bdtls\b/gi, "details"],
    [/\brequried\b|\breqrd\b|\breqd\b/gi, "required"],
    [/\bqty\b/gi, "quantity"],
    [/\bqtn\b/gi, "quotation"],
    [/\bdelvry\b|\bdelvery\b/gi, "delivery"],
    [/\bcatalog\b/gi, "catalogue"],
    [/\bfinalise\b/gi, "finalize"],
    [/\bi\b/g, "I"],
    [/\bim\b|\bi'm\b/gi, "I'm"],
    [/\bok\b/gi, "Okay"],
  ];

  for (const [pattern, replacement] of replacements) {
    masked = masked.replace(pattern, replacement);
  }

  masked = masked
    .replace(/\u2014|\u2013|--+/g, ", ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  // Capitalize first letter of text
  if (/^[a-z]/.test(masked)) {
    masked = masked[0].toUpperCase() + masked.slice(1);
  }

  // Add punctuation at end if missing
  if (!/[.!?…]$/.test(masked) && !/__URL_\d+__$/.test(masked)) {
    const isQuestion =
      /^(did|do|does|are|is|will|would|can|could|shall|should|have|has|when|where|what|which|how|why)\b/i.test(
        masked
      ) || /\?/.test(cleaned);
    masked = `${masked}${isQuestion ? "?" : "."}`;
  }

  masked = masked.replace(/__URL_(\d+)__/g, (_m, i) => urlTokens[Number(i)] || "");
  return formatWhatsAppOutboundText(sanitizePlainEnglish(masked));
}

function getCachedPolish(key: string): string | null {
  const entry = polishMemoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    polishMemoryCache.delete(key);
    return null;
  }
  return entry.enhancedText;
}

function setCachedPolish(key: string, enhancedText: string): void {
  if (polishMemoryCache.size >= POLISH_CACHE_MAX_ENTRIES) {
    const firstKey = polishMemoryCache.keys().next().value;
    if (firstKey) polishMemoryCache.delete(firstKey);
  }
  polishMemoryCache.set(key, {
    enhancedText,
    expiresAt: Date.now() + POLISH_CACHE_TTL_MS,
  });
}

export function clearStaffPolishCacheForTests(): void {
  polishMemoryCache.clear();
}

export async function polishStaffOutboundMessage(params: {
  rawText: string;
  customerName?: string;
}): Promise<StaffMessagePolishResult> {
  const started = Date.now();
  const originalText = String(params.rawText || "").trim();
  if (!originalText) {
    return {
      originalText: "",
      enhancedText: "",
      changed: false,
      source: "LOCAL_FAST_PATH",
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      durationMs: 0,
    };
  }

  // URL-only messages or ultra-short already capitalized+punctuated messages need 0 AI credits
  const strippedNoUrls = originalText.replace(/https?:\/\/\S+/gi, "").trim();
  if (
    !strippedNoUrls ||
    (/^[A-Z0-9][a-zA-Z0-9\s,.'!?₹/-]{1,22}[.!?]$/.test(originalText) &&
      !/\b(gud|u|ur|r|pls|plz|thx|chk|msg|qty|wtsp|whatup)\b/i.test(originalText))
  ) {
    const clean = formatWhatsAppOutboundText(sanitizePlainEnglish(originalText));
    return {
      originalText,
      enhancedText: clean,
      changed: clean !== originalText,
      source: "LOCAL_FAST_PATH",
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      durationMs: Date.now() - started,
    };
  }

  const cacheKey = originalText.toLowerCase().replace(/\s+/g, " ");
  const memHit = getCachedPolish(cacheKey);
  if (memHit) {
    return {
      originalText,
      enhancedText: memHit,
      changed: memHit !== originalText,
      source: "MEMORY_CACHE",
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      durationMs: Date.now() - started,
    };
  }

  const keyInfo = await resolveSharedAnthropicApiKey("admin").catch(() => ({
    apiKey: "",
    source: "none",
  }));
  const apiKey =
    keyInfo.apiKey ||
    (await resolveSharedAnthropicApiKey("client").catch(() => ({ apiKey: "" })))
      .apiKey;

  if (apiKey) {
    const aiRes = await callClaudeHaikuMessagesDetailed({
      apiKey,
      system: STAFF_MESSAGE_POLISH_SYSTEM_PROMPT,
      cacheSystem: true,
      disableThinking: true,
      maxTokens: 260,
      timeoutMs: 6500,
      messages: [
        {
          role: "user",
          content: originalText,
        },
      ],
    });

    if (aiRes.ok && aiRes.text) {
      const parsed = parseClaudeJson<{ polished?: string }>(aiRes.text);
      const rawCandidate = String(parsed?.polished || aiRes.text || "").trim();
      const cleanedCandidate = formatWhatsAppOutboundText(
        sanitizePlainEnglish(rawCandidate)
      );
      if (
        cleanedCandidate &&
        cleanedCandidate.length <= Math.max(400, originalText.length * 3) &&
        preserveNumbersAndUrls(originalText, cleanedCandidate)
      ) {
        setCachedPolish(cacheKey, cleanedCandidate);
        return {
          originalText,
          enhancedText: cleanedCandidate,
          changed: cleanedCandidate !== originalText,
          source: "CLAUDE_CACHED",
          cacheReadInputTokens: aiRes.usage?.cacheReadInputTokens ?? 0,
          cacheCreationInputTokens: aiRes.usage?.cacheCreationInputTokens ?? 0,
          durationMs: Date.now() - started,
        };
      }
    }
  }

  const fallback = deterministicStaffTextPolish(originalText);
  return {
    originalText,
    enhancedText: fallback,
    changed: fallback !== originalText,
    source: "LOCAL_FALLBACK",
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    durationMs: Date.now() - started,
  };
}
