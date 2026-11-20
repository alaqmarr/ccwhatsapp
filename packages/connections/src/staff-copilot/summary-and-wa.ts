import {
  buildEcosystemDeepProductContextAndAnswer,
  cleanDisplayProductName,
  loadLiveDatabaseOperationalContext,
  findMatchingAiTrainingGuidance,
  resolveSharedAnthropicApiKey,
  resolveWhatsAppWebAppOrigin,
  searchEcosystemItems,
  type InternalStaffCallerProfile,
  type MainWebsiteProduct,
} from "@cc/database";
import {
  LOCKED_CLAUDE_MODEL,
  callClaudeHaikuMessagesDetailed,
  formatWhatsAppOutboundText,
} from "@cc/connections/initialise.acrio.ai";
import { getCachedEcosystemCatalog } from "@cc/connections/helpers.acrio.ai";

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
- Zero em-dashes, zero double-hyphens, zero robotic AI buzzwords (no bespoke, elevate, delve, meticulous, seamless, utilize, robust).
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

/**
 * Personalized WhatsApp assistant specifically for internal Classic Concepts team members
 * messaging our business WhatsApp number from their registered staff phone number.
 */
export async function runAcrioStaffWhatsAppAssistant(params: {
  staff: InternalStaffCallerProfile;
  inboundText: string;
  recentMessages: { direction: string; body: string }[];
}): Promise<{ replyText: string; model: string }> {
  const { apiKey } = await resolveSharedAnthropicApiKey("admin");
  const cleanText = String(params.inboundText || "").trim();
  const hubBase = resolveWhatsAppWebAppOrigin();

  const [catalog, liveContext, trainingGuidance] = await Promise.all([
    getCachedEcosystemCatalog().catch(() => ({ allItems: [] as MainWebsiteProduct[] })),
    loadLiveDatabaseOperationalContext({
      rawQuery: cleanText,
      forStaffCopilot: true,
    }).catch(() => ""),
    findMatchingAiTrainingGuidance({
      queryText: cleanText,
      scope: "STAFF_COPILOT",
    }).catch(() => ({ rules: [], examples: [], promptBlock: "" })),
  ]);

  const items = catalog.allItems || [];
  const matches = cleanText ? searchEcosystemItems(items, cleanText, 6) : [];
  const deepSpec =
    matches.length > 0
      ? buildEcosystemDeepProductContextAndAnswer({
          rawQuery: cleanText,
          matchedItems: matches,
          formatItemLink: (it) => it.shortUrl || it.url,
        })
      : null;

  const productContext = matches.length
    ? matches
        .map(
          (p) =>
            `• ${cleanDisplayProductName(p.name)} (${p.brandLabel}${
              p.sku ? `, SKU ${p.sku}` : ""
            }) | ₹${p.basePrice ?? "Custom Quote"} | ${p.shortUrl || p.url}`
        )
        .join("\n")
    : "";

  const rawHistory = params.recentMessages.slice(-10).map((m) => ({
    role: (m.direction === "OUTBOUND" ? "assistant" : "user") as
      | "user"
      | "assistant",
    content: String(m.body || "").slice(0, 600),
  }));
  const trimmedHistory =
    rawHistory.length > 0 &&
    rawHistory[rawHistory.length - 1].role === "user" &&
    rawHistory[rawHistory.length - 1].content.trim() === cleanText
      ? rawHistory.slice(0, -1)
      : rawHistory;
  const normalizedHistory: { role: "user" | "assistant"; content: string }[] = [];
  for (const msg of trimmedHistory) {
    const body = msg.content.trim();
    if (!body) continue;
    const prev = normalizedHistory[normalizedHistory.length - 1];
    if (prev && prev.role === msg.role) {
      prev.content = `${prev.content}\n${body}`;
    } else {
      normalizedHistory.push({ role: msg.role, content: body });
    }
  }
  while (normalizedHistory.length > 0 && normalizedHistory[0].role !== "user") {
    normalizedHistory.shift();
  }
  const staffDynamicContext = [
    `Internal Colleague: ${params.staff.name} (First Name: ${params.staff.firstName} | Position: ${params.staff.position} | Role: ${params.staff.role} | Dept: ${params.staff.department})`,
    `Hub Inbox URL: ${hubBase}/dashboard/inbox`,
    trainingGuidance.promptBlock ? `[AI Training Guidance]:\n${trainingGuidance.promptBlock}` : "",
    productContext ? `[Matching Catalog Products]:\n${productContext}` : "",
    deepSpec?.promptCatalogContext ? `[Deep Product Specs]:\n${deepSpec.promptCatalogContext}` : "",
    liveContext ? `[Live Company, Team & CRM Context]:\n${liveContext}` : "",
    `Staff Question:\n${cleanText}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const staffMessages: { role: "user" | "assistant"; content: string }[] =
    normalizedHistory.length > 0 &&
    normalizedHistory[normalizedHistory.length - 1].role === "user"
      ? [
          ...normalizedHistory.slice(0, -1),
          {
            role: "user",
            content: `${normalizedHistory[normalizedHistory.length - 1].content}\n\n${staffDynamicContext}`,
          },
        ]
      : [...normalizedHistory, { role: "user", content: staffDynamicContext }];

  if (apiKey) {
    try {
      const aiRes = await callClaudeHaikuMessagesDetailed({
        apiKey,
        maxTokens: 1200,
        effort: "medium",
        timeoutMs: 18000,
        cacheLastCompletedTurn: staffMessages.length >= 3,
        system: `You are ACRIO speaking privately on WhatsApp with an INTERNAL team member at Classic Concepts & Classic Edge 53.

TONE & PERSONALIZATION RULES:
- Greet and address the internal teammate by first name warmly like an internal colleague and personal assistant (NOT as an external customer!).
- Never pitch consumer sales prompts like "Would you like us to call you back?" or "Thank you for enquiring with Classic Concepts".
- Give exact MRP prices, product codes/SKUs, specs, and shortlinks concisely for staff quoting.
- Also remind them when relevant that they can text quick commands here: "my chats", "callbacks", "stats", or "check <customer phone>", or open the Hub Inbox URL provided in context.
- Plain everyday layman English, single asterisks *bold* for WhatsApp, zero em-dashes, zero double-hyphens, zero AI buzzwords.`,
        messages: staffMessages,
      });
      if (aiRes.ok && aiRes.text?.trim()) {
        return {
          replyText: formatWhatsAppOutboundText(aiRes.text.trim()),
          model: "claude-haiku-5-5-staff-wa",
        };
      }
    } catch {
      // fall back cleanly below
    }
  }

  const lines = [
    `Hey *${params.staff.firstName}* (${params.staff.position})! Here with your internal assistant view:`,
    productContext
      ? `\n*Matching Catalog Items:*\n${productContext}`
      : `\nYou can ask me about any podium/machine specs & prices, or text:\n• *my chats* to see your open assigned leads\n• *callbacks* to view pending customer callbacks\n• *check <phone>* to look up a customer\n• *stats* for today's live summary`,
    `\nHub Inbox: ${hubBase}/dashboard/inbox`,
  ];
  return {
    replyText: formatWhatsAppOutboundText(lines.join("\n")),
    model: "staff-wa-fallback",
  };
}
