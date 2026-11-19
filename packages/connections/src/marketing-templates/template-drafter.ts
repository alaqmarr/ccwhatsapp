import {
  resolvePublicShortLinkOrigin,
  resolveSharedAnthropicApiKey,
  searchEcosystemItems,
  type AiTokenUsage,
  type AiTraceStep,
} from "@cc/database";
import {
  LOCKED_CLAUDE_MODEL,
  parseClaudeJson,
  callClaudeHaikuMessagesDetailed,
  recordAndBroadcastAiLog,
  mapProductToLogItem,
  formatWhatsAppOutboundText,
  sanitizePlainEnglish,
} from "@cc/connections/initialise.acrio.ai";
import {
  type WhatsAppHeaderType,
  type WhatsAppTemplateCategory,
  type WhatsAppTemplateButton,
  type WhatsAppTemplateVariableSpec,
} from "@cc/connections/whatsapp-cloud.acrio.ai";
import { getCachedEcosystemCatalog } from "@cc/connections/helpers.acrio.ai";

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
   - Plain, warm, everyday English. Zero em-dashes, zero double-hyphens, zero robotic AI buzzwords (no bespoke, seamless, robust, utilize, leverage, meticulous, elevate).
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
