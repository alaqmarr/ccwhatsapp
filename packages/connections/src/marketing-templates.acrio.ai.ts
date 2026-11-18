import {
  cleanDisplayProductName,
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolvePublicShortLinkOrigin,
  resolveSharedAnthropicApiKey,
  searchEcosystemItems,
  type AiLogWebsite,
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
} from "./initialise.acrio.ai";
import {
  type WhatsAppHeaderType,
  type WhatsAppTemplateCategory,
  type WhatsAppTemplateButton,
  type WhatsAppTemplateVariableSpec,
} from "./whatsapp-cloud.acrio.ai";
import {
  getCachedEcosystemCatalog,
  buildGroupedProductShortLinksSection,
} from "./helpers.acrio.ai";

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
  const rawMessage = String(params.message || "");
  const staffNoteMatch = rawMessage.match(/\[Staff Note(?:\s*\/\s*Tone)?:\s*([^\]]+)\]/i);
  const staffNote = staffNoteMatch ? staffNoteMatch[1].trim() : "";
  const cleanCustomerMessage = rawMessage
    .replace(/\[Staff Note(?:\s*\/\s*Tone)?:\s*[^\]]+\]/gi, "")
    .trim();
  const isStaffDecline = Boolean(
    staffNote &&
      /\b(we\s+don'?t\s+deal|do\s+not\s+deal|we\s+do\s+not\s+make|don'?t\s+make|don'?t\s+manufacture|do\s+not\s+manufacture|we\s+don'?t\s+(?:supply|sell|offer|provide)|not\s+in\s+our\s+range|out\s+of\s+scope)\b/i.test(
        staffNote
      )
  );
  const isTestProbe =
    /^(?:test|testing|abcd|dummy|sample|asdf)$/i.test(cleanCustomerMessage) ||
    (/^test$/i.test(cleanCustomerMessage) && !params.productName);
  const combinedQuery = `${params.productName || ""} ${cleanCustomerMessage}`.trim();
  const lower = combinedQuery.toLowerCase();
  const logWebsite: AiLogWebsite =
    params.brand === "CLASSIC_EDGE_53" ? "CLASSIC_EDGE_53" : "CLASSIC_CONCEPTS";
  const logWebsiteLabel =
    params.brand === "CLASSIC_EDGE_53"
      ? "Classic Edge 53 (classicedge53.com -> Hub)"
      : "Classic Concepts (classicconcepts.in -> Hub)";

  const { allItems, cacheMeta } = await getCachedEcosystemCatalog();
  const matches =
    isStaffDecline || isTestProbe
      ? []
      : searchEcosystemItems(allItems, combinedQuery, 4);

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
      detail: isStaffDecline
        ? `Skipped product lookup because Staff Note says we do not deal`
        : `query="${combinedQuery.slice(0, 80)}", matched=${matches.length} of ${allItems.length}`,
      durationMs: Date.now() - started,
      status: "OK",
    }
  );

  let smartCategory =
    params.brand === "CLASSIC_EDGE_53"
      ? "Acrylic Machines (CE53)"
      : "General Enquiry";
  let priority: "URGENT" | "HIGH" | "NORMAL" =
    isStaffDecline || isTestProbe ? "NORMAL" : "HIGH";

  if (!isStaffDecline && !isTestProbe) {
    if (/\b(machine|machines|laser|router|polish|polishing|diamond|bending|bender|heater|yn-|ce53|blade|cutter)\b/i.test(lower)) {
      smartCategory = "Acrylic Machines (CE53)";
      priority = "HIGH";
    } else if (/\b(podium|lectern|pulpit|stage|auditorium)\b/i.test(lower)) {
      smartCategory = "Podiums & Stage";
      priority = /urgent|tomorrow|friday|today|week/i.test(lower) ? "URGENT" : "HIGH";
    } else if (/\b(trophy|trophies|memento|mementos|award|plaque)\b/i.test(lower)) {
      smartCategory = "Awards & Trophies";
    } else if (/\b(hotel|banquet|menu|qr|resort|table\s*stand)\b/i.test(lower)) {
      smartCategory = "Hotel & Banquet";
    } else if (/\b(cover|guard|enclosure|box|custom|mm|inch|corian|solid\s*surface|cladding|sheet|block)\b/i.test(lower)) {
      smartCategory = "Custom Fabrication";
    }
  }

  const brandName =
    params.brand === "CLASSIC_EDGE_53" ? "Classic Edge 53" : "Classic Concepts";

  const matchedItems = matches.map((m) => ({
    name: cleanDisplayProductName(m.name),
    brandLabel: m.brandLabel,
    shortUrl: m.shortUrl || m.url,
    priceInr: m.basePrice,
  }));

  const groupedEnquiryBlock =
    isStaffDecline || isTestProbe
      ? ""
      : buildGroupedProductShortLinksSection({
          allItems,
          matchedItems: matches,
          smartCategory,
        });

  if (isTestProbe) {
    const testReplyWa = `Hi ${firstName}, thanks for reaching out to *${brandName}*. Please reply with the product or requirement you need help with.`;
    recordAndBroadcastAiLog({
      website: logWebsite,
      websiteLabel: logWebsiteLabel,
      feature: "Website Form Enquiry AI Evaluator",
      actor: `${params.customerName}${params.customerPhone ? ` (${params.customerPhone})` : ""}`,
      question: cleanCustomerMessage || params.message,
      model: "rule-test-enquiry-guard",
      effort: "low",
      outcomeSource: "LIVE_AI",
      responseCacheStatus: "BYPASS",
      catalogCacheStatus: cacheMeta.catalogCacheStatus,
      cacheDetails: "Detected test form submission; skipped live AI call",
      productLookupTriggered: false,
      productLookupQuery: "",
      productLookupTotalScanned: 0,
      productsLookedUp: [],
      steps,
      response: testReplyWa,
      durationMs: Date.now() - started,
    });
    return {
      smartReplyText: testReplyWa.replace(/\*/g, ""),
      whatsappSummaryText: testReplyWa,
      smartCategory: "General Enquiry",
      priority: "NORMAL",
      recommendedTeamId: "team_sales",
      matchedItems: [],
    };
  }

  const clientKey = await resolveSharedAnthropicApiKey("client");
  const adminKey = await resolveSharedAnthropicApiKey("admin");
  const apiKey = clientKey.apiKey || adminKey.apiKey;
  let lastAiError: string | null = null;
  let lastUsage: AiTokenUsage | null = null;

  if (apiKey) {
    try {
      const aiCall = await callClaudeHaikuMessagesDetailed({
        apiKey,
        maxTokens: 1200,
        effort: "low",
        timeoutMs: 24000,
        system: `You draft concise, plain-English enquiry replies for ${brandName} (Classic Concepts acrylic products & Classic Edge 53 acrylic machines).
RULES:
1. Address "${firstName}" politely in simple everyday English. Keep replies crisp and direct (3 to 6 short lines).
2. If [Staff Note / Instruction] says we do not deal in or cannot make the requested item, politely decline in 2 to 4 short lines and STOP. NEVER pitch or recommend unrelated machines or products!
3. Otherwise answer what they asked using ONLY verified https://ccapl.cc/<id> shortlinks and ₹ prices in context, and ask at most 1 to 2 practical details (quantity, delivery city, or size) so Sales can confirm.
4. Zero em-dashes ("—"), zero "--", zero robotic AI buzzwords (no bespoke, seamless, robust, utilize, leverage, meticulous, elevate).
Return ONLY valid JSON:
{
  "smartCategory": "${smartCategory}",
  "priority": "${priority}",
  "smartReplyText": "Concise email-friendly plain text reply",
  "whatsappSummaryText": "Concise WhatsApp-formatted reply (*bold* + shortlinks only if relevant)"
}`,
        messages: [
          {
            role: "user",
            content: `Brand: ${brandName}\nCustomer: ${params.customerName}\nProduct Selected: ${params.productName ? cleanDisplayProductName(params.productName) : "General"}\nCustomer Enquiry: ${cleanCustomerMessage || params.message}${staffNote ? `\nStaff Note / Instruction: ${staffNote}` : ""}\n${isStaffDecline ? "Matched Products: NONE (Staff confirmed we do not deal in this item; do NOT pitch any products or machines)." : groupedEnquiryBlock || "No direct ready catalog match; confirm whether custom fabrication applies or ask 1-2 short clarifying details."}`,
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
          const resolvedCategory = isStaffDecline
            ? "General Enquiry"
            : parsed.smartCategory || smartCategory;

          steps.push({
            stepNumber: 3,
            label: "Evaluated enquiry with Claude Haiku 5.5 (effort=low)",
            detail: `HTTP ${aiCall.statusCode} in ${aiCall.durationMs}ms -> category="${resolvedCategory}"`,
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
            effort: "low",
            outcomeSource: "LIVE_AI",
            responseCacheStatus: "BYPASS",
            catalogCacheStatus: cacheMeta.catalogCacheStatus,
            cacheDetails: cacheMeta.cacheSummary,
            productLookupTriggered: !isStaffDecline,
            productLookupQuery: isStaffDecline ? "" : combinedQuery,
            productLookupTotalScanned: isStaffDecline ? 0 : allItems.length,
            productsLookedUp: isStaffDecline ? [] : matches.map(mapProductToLogItem),
            steps,
            response: cleanWaText,
            durationMs: Date.now() - started,
            tokenUsage: aiCall.usage,
          });

          return {
            smartReplyText: cleanEmailText,
            whatsappSummaryText: cleanWaText,
            smartCategory: resolvedCategory,
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

