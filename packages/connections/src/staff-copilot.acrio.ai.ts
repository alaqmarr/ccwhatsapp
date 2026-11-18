import {
  buildCompleteEcosystemDatabaseDirectory,
  buildEcosystemDeepProductContextAndAnswer,
  cleanDisplayProductName,
  extractCompactDimensionPairsFromText,
  extractExplicitProductOrModelCodes,
  loadLiveDatabaseOperationalContext,
  fetchLiveEcosystemDocuments,
  findMatchingAiTrainingGuidance,
  findMatchingEcosystemDocuments,
  resolveSharedAnthropicApiKey,
  resolveWhatsAppWebAppOrigin,
  searchEcosystemItems,
  type InternalStaffCallerProfile,
  type AiTokenUsage,
  type AiTraceStep,
  type MainWebsiteProduct,
} from "@cc/database";
import {
  LOCKED_CLAUDE_MODEL,
  parseClaudeJson,
  callClaudeHaikuMessagesDetailed,
  recordAndBroadcastAiLog,
  mapProductToLogItem,
  formatWhatsAppOutboundText,
  stripRepeatedGreeting,
} from "./initialise.acrio.ai";
import {
  type AcrioRecommendedItem,
  type AcrioChatCopilotResult,
  type CatalogCacheMeta,
  getCachedEcosystemCatalog,
  buildGroupedProductShortLinksSection,
  classifyAcrioInboundIntent,
  reconstructAcrioConversationState,
  buildNormalizedSearchFromState,
} from "./helpers.acrio.ai";
import {
  runAcrioAutonomousTurn,
} from "./concierge.acrio.ai";

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
    | "send_customer_reply"
    | "request_company_document_upload";
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
  companyDocId?: string;
  companyDocTitle?: string;
  requestedDocSlug?: string;
  requestedDocTitle?: string;
  docNumber?: string;
  mediaUrl?: string;
  mediaType?: "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO";
  mediaId?: string;
  waMediaId?: string;
  fileName?: string;
  mimeType?: string;
  confirmed?: boolean;
  shareKind?: "DOCUMENT" | "PRODUCT_DATA" | "CUSTOM_MESSAGE";
  autoExecute?: boolean;
  sourceLabel?: string;
  candidateOptions?: Array<{
    id: string;
    title: string;
    sourceLabel: string;
    mediaUrl: string;
    mediaType: "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO";
    mediaId?: string;
    waMediaId?: string;
    fileName: string;
    mimeType: string;
    docNumber?: string;
  }>;
}

/**
 * ACRIO answers a teammate who asked a question or requested an action with "@ACRIO" inside an internal chat note.
 * Can execute internal CRM actions or queue customer-facing shares/replies for confirmation in internal notes.
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
  noteAttachment?: {
    mediaId?: string;
    waMediaId?: string;
    mediaType?: string;
    url: string;
    fileName?: string;
    mimeType?: string;
  } | null;
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
  const [matches, trainingGuidance, allEcoDocs, matchedEcoDocs] = await Promise.all([
    Promise.resolve(searchEcosystemItems(allItems, `${question} ${lastCustomerText}`, 6)),
    findMatchingAiTrainingGuidance({
      queryText: `${question} ${lastCustomerText}`,
      scope: "STAFF_COPILOT",
    }).catch(() => ({ promptBlock: "", examples: [], rules: [] })),
    fetchLiveEcosystemDocuments().catch(() => []),
    findMatchingEcosystemDocuments(question).catch(() => []),
  ]);
  const deep = buildEcosystemDeepProductContextAndAnswer({
    rawQuery: question,
    matchedItems: matches,
    formatItemLink: (it) => it.shortUrl || it.url,
  });
  addStep("Looked up catalog and ecosystem docs", `matched=${matches.length}, ecoDocs=${allEcoDocs.length}`);

  const liveContext = await loadLiveDatabaseOperationalContext({
    customerPhone: params.customerPhone,
    customerName: params.customerName,
    rawQuery: question,
    forStaffCopilot: true,
  }).catch(() => "");

  const companyDocsContextLines = allEcoDocs.map(
    (d) =>
      `- id="${d.id}" slug="${d.slug}" title="${d.title}" source="${d.sourceLabel}"${d.docNumber ? ` number="${d.docNumber}"` : ""} mediaType="${d.mediaType}" fileName="${d.fileName}" url="${d.mediaUrl}"${d.waMediaId ? ` waMediaId="${d.waMediaId}"` : ""}${d.mediaId ? ` mediaId="${d.mediaId}"` : ""} mimeType="${d.mimeType}" keywords="${d.keywords}"`
  );
  const noteAttachmentLine = params.noteAttachment
    ? `[FILE ATTACHED BY ${params.staffName} IN THIS NOTE]: mediaType="${params.noteAttachment.mediaType || "DOCUMENT"}" fileName="${params.noteAttachment.fileName || "attachment"}" url="${params.noteAttachment.url}"${params.noteAttachment.mediaId ? ` mediaId="${params.noteAttachment.mediaId}"` : ""}${params.noteAttachment.waMediaId ? ` waMediaId="${params.noteAttachment.waMediaId}"` : ""} mimeType="${params.noteAttachment.mimeType || "application/pdf"}"`
    : "";

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
      maxTokens: 1600,
      effort: "low",
      timeoutMs: 24000,
      system: `You are ACRIO, the assistant and action copilot for the Classic Concepts and Classic Edge 53 team. A teammate (${params.staffName}) is asking you a question OR asking you to perform an action inside a PRIVATE internal note on a customer chat.

CAPABILITIES (STAFF COPILOT ACTIONS):
You can both answer questions AND perform actions by returning structured "actions" in JSON:
- "assign_staff": transfer chat ownership to a teammate (or "ACRIO" to hand back to AI). Set "staffQuery".
- "add_collaborator": give dual access to a teammate without removing current owner. Set "staffQuery".
- "set_priority": set priority to "URGENT", "HIGH", or "NORMAL".
- "set_category": set smart category ("Podiums & Stage", "Awards & Trophies", "Hotel & Banquet", "Acrylic Machines (CE53)", "Custom Fabrication", "Order & Delivery", "General Enquiry").
- "resolve_chat": mark this chat Resolved with a short plain-English "summary".
- "reopen_chat": reopen a resolved chat.
- "update_customer": update "city", "companyName", "notes", or "preferredStaffQuery" on customer profile.
- "create_callback": log a pending callback with "callbackSlot" and "callbackTopic".
- "send_customer_reply": Use this WHENEVER the teammate asks you to share or send anything directly with the customer/client!
  There are TWO modes based on what the teammate asked to share:
  MODE A (Sharing a DOCUMENT, Certificate, Licence, or Catalogue PDF from [VERIFIED COMPANY DOCUMENTS LIBRARY] or [FILE ATTACHED BY TEAMMATE IN THIS NOTE]):
    - Set "shareKind": "DOCUMENT", "autoExecute": false, "confirmed": false, leave "suggestedReply": "" EMPTY.
    - Set "companyDocId", "companyDocTitle", "sourceLabel", "mediaUrl", "mediaType", "mediaId", "waMediaId", "fileName", "mimeType", and "messageText" (short caption for client).
    - If multiple documents match cleanly (e.g. multiple certificates or multiple catalogues across classicconcepts.in and classicedge53.com), list them concisely in "answer" and ask the teammate to confirm which one to send.
  MODE B (Sharing PRODUCT DATA, name, description, specs, price, or link, e.g. "please share CCP107 podium data with the client", "share details of acrylic diamond polisher with client"):
    - Set "shareKind": "PRODUCT_DATA", "autoExecute": true, "confirmed": true, leave "suggestedReply": "" EMPTY!
    - Compose "messageText" with complete, accurate verified product details from [Verified product details]: exact product name, SKU/model, verified ₹ price (or Price on request), key sizes/specifications/variants, and the verified https://ccapl.cc/... shortlink.
    - Only attach "mediaUrl" / "mediaType": "IMAGE" when there is a valid product mainImage URL AND "messageText" fits cleanly as a caption under 900 chars. Otherwise omit mediaUrl so the complete product data sends reliably as text!
    - The system will send this verified product data message to the customer AUTOMATICALLY right away and confirm inside internal notes!
- "request_company_document_upload": Use this ONLY if the requested company document does NOT exist anywhere in [VERIFIED COMPANY DOCUMENTS LIBRARY] (which already includes live certificates from classicconcepts.in, classicedge53.com, and Hub uploads) and is NOT attached in this note!
  CRITICAL RULE: When returning "send_customer_reply" OR "request_company_document_upload", ALWAYS leave "suggestedReply": "" EMPTY! NEVER show a "Suggested reply" text box when the teammate asked you to share a document or product data!

ACTIVE TEAM ROSTER: ${staffRosterLine || "Sales & Support Team"}
CURRENT CHAT OWNER: ${params.currentOwnerName || "System (ACRIO)"} | STATUS: ${params.conversationStatus || "OPEN"}

WRITING RULES:
1. Plain everyday layman English. Zero em-dashes, zero "--", zero buzzwords (no bespoke, elevate, delve, meticulous, seamless, utilize, etc.).
2. Use ONLY verified catalogue, company documents, and chat information below. Never invent prices, GSTIN numbers, files, sizes, specs, stock, or dates.
3. Single asterisks for *bold*. Use ₹ and https://ccapl.cc/... shortlinks from verified data.
4. Keep "answer" concise (2 to 6 short lines).
${trainingGuidance.promptBlock ? `\n${trainingGuidance.promptBlock}\n` : ""}
${buildCompleteEcosystemDatabaseDirectory(allItems)}

Return ONLY valid JSON:
{
  "answer": "Clear private reply for ${params.staffName}",
  "suggestedReply": "",
  "actions": [
    { "type": "assign_staff | add_collaborator | set_priority | set_category | resolve_chat | reopen_chat | update_customer | create_callback | send_customer_reply | request_company_document_upload", ...fields }
  ]
}`,
      messages: [
        {
          role: "user",
          content: `Customer: ${params.customerName}${params.customerPhone ? ` (${params.customerPhone})` : ""}

[VERIFIED COMPANY DOCUMENTS LIBRARY]:
${companyDocsContextLines.length > 0 ? companyDocsContextLines.join("\n") : "(No company documents uploaded yet)"}
${noteAttachmentLine ? `\n${noteAttachmentLine}\n` : ""}
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
        if (Array.isArray(parsed.actions)) {
          actions = parsed.actions.filter((a) => a && typeof a.type === "string");
        }
        const hasClientAction = actions.some(
          (a) =>
            a.type === "send_customer_reply" ||
            a.type === "request_company_document_upload"
        );
        if (!hasClientAction && parsed.suggestedReply && parsed.suggestedReply.trim()) {
          suggestedReply = formatWhatsAppOutboundText(parsed.suggestedReply).trim();
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

  // Deterministic enrich & fallback for document confirmation vs automatic product-data sharing
  const asksToShareWithClient =
    /\b(share|send|forward|give|attach)\b/i.test(question) &&
    /\b(client|customer|them|buyer|gst|certificate|brochure|catalogue|catalog|msme|udyam|iso|incorporation|labour|iec|cheque|bank|file|doc|pdf|data|details|info|price|spec|quote|link|product|machine|podium|chair|table|trophy|memento)\b/i.test(
      question
    );
  const asksSpecificallyForDocument =
    /\b(gst|gstin|tax\s*cert|iso|msme|udyam|incorporation|coi|labour|labor|iec|importer|exporter|cheque|bank|certificate|certificates|brochure|catalogue|catalog|pdf|document|documents)\b/i.test(
      question
    );

  // If Claude already picked a DOCUMENT share and multiple candidates match in ecosystem docs, attach candidateOptions so user can confirm which one!
  if (asksSpecificallyForDocument && actions.length > 0 && matchedEcoDocs.length > 1) {
    for (const act of actions) {
      if (act.type === "send_customer_reply" && !act.autoExecute && (!act.candidateOptions || act.candidateOptions.length === 0)) {
        act.shareKind = "DOCUMENT";
        act.candidateOptions = matchedEcoDocs.slice(0, 6).map((d) => ({
          id: d.id,
          title: d.title,
          sourceLabel: d.sourceLabel,
          mediaUrl: d.mediaUrl,
          mediaType: d.mediaType,
          mediaId: d.mediaId,
          waMediaId: d.waMediaId,
          fileName: d.fileName,
          mimeType: d.mimeType,
          docNumber: d.docNumber,
        }));
      }
    }
  }

  // If teammate asked to share product data ("please share <product> data with the client") and Claude put it in suggestedReply instead of auto-sending, promote to autoExecute!
  if (asksToShareWithClient && !asksSpecificallyForDocument && !params.noteAttachment && actions.length === 0 && suggestedReply) {
    actions = [
      {
        type: "send_customer_reply",
        shareKind: "PRODUCT_DATA",
        autoExecute: true,
        confirmed: true,
        messageText: suggestedReply,
      },
    ];
    suggestedReply = null;
  }

  if (asksToShareWithClient && actions.length === 0) {
    if (params.noteAttachment) {
      const fileLabel = params.noteAttachment.fileName || "Attachment";
      actions = [
        {
          type: "send_customer_reply",
          shareKind: "DOCUMENT",
          autoExecute: false,
          mediaUrl: params.noteAttachment.url,
          mediaType:
            (["IMAGE", "VIDEO", "DOCUMENT", "AUDIO"].includes(
              String(params.noteAttachment.mediaType || "").toUpperCase()
            )
              ? String(params.noteAttachment.mediaType).toUpperCase()
              : "DOCUMENT") as "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO",
          mediaId: params.noteAttachment.mediaId,
          waMediaId: params.noteAttachment.waMediaId,
          fileName: fileLabel,
          mimeType: params.noteAttachment.mimeType,
          messageText: `Please find attached *${fileLabel}* for your reference. Let us know if you need anything else.`,
          confirmed: false,
        },
      ];
      suggestedReply = null;
      answer = `Ready to share *${fileLabel}* directly with *${params.customerName}* on WhatsApp. Please confirm below to send it now.`;
      error = undefined;
    } else if (asksSpecificallyForDocument && matchedEcoDocs.length > 0) {
      const primary = matchedEcoDocs[0];
      const hasMultiple = matchedEcoDocs.length > 1;
      actions = [
        {
          type: "send_customer_reply",
          shareKind: "DOCUMENT",
          autoExecute: false,
          companyDocId: primary.id,
          companyDocTitle: primary.title,
          sourceLabel: primary.sourceLabel,
          docNumber: primary.docNumber || undefined,
          mediaUrl: primary.mediaUrl,
          mediaType: primary.mediaType,
          mediaId: primary.mediaId || undefined,
          waMediaId: primary.waMediaId || undefined,
          fileName: primary.fileName,
          mimeType: primary.mimeType,
          messageText: `Please find attached our *${primary.title}*${primary.docNumber ? ` (${primary.docNumber})` : ""} for your reference. Please let us know if you need anything else.`,
          confirmed: false,
          ...(hasMultiple
            ? {
                candidateOptions: matchedEcoDocs.slice(0, 6).map((d) => ({
                  id: d.id,
                  title: d.title,
                  sourceLabel: d.sourceLabel,
                  mediaUrl: d.mediaUrl,
                  mediaType: d.mediaType,
                  mediaId: d.mediaId,
                  waMediaId: d.waMediaId,
                  fileName: d.fileName,
                  mimeType: d.mimeType,
                  docNumber: d.docNumber,
                })),
              }
            : {}),
        },
      ];
      suggestedReply = null;
      if (hasMultiple) {
        const listLines = matchedEcoDocs
          .slice(0, 6)
          .map((d, idx) => `${idx + 1}. *${d.title}* (${d.sourceLabel} • \`${d.fileName}\`)`)
          .join("\n");
        answer = `Found *${matchedEcoDocs.length} matching documents* across our websites and records:\n${listLines}\n\nConfirm below which one to send to *${params.customerName}* (or reply *@ACRIO 1*, *@ACRIO 2*, etc.).`;
      } else {
        answer = `Found *${primary.title}* from ${primary.sourceLabel} (\`${primary.fileName}\`). Please confirm below before I share it with *${params.customerName}* on WhatsApp.`;
      }
      error = undefined;
    } else if (!asksSpecificallyForDocument && (deep.deterministicDeepAnswer || matches.length > 0)) {
      const topItem = matches[0];
      const autoText =
        deep.deterministicDeepAnswer ||
        (topItem
          ? `*${cleanDisplayProductName(topItem.name)}*${topItem.sku ? ` (${topItem.sku})` : ""}\n${
              topItem.basePrice ? `Price: ₹${topItem.basePrice.toLocaleString("en-IN")}` : "Custom Quote Item"
            }\n${topItem.specsSummary ? `Specs: ${topItem.specsSummary}\n` : ""}Link: ${topItem.shortUrl || topItem.url}`
          : "");
      if (autoText) {
        const canAttachMainImg =
          Boolean(topItem?.mainImage && /^https?:\/\//i.test(String(topItem.mainImage))) &&
          autoText.length <= 900;
        actions = [
          {
            type: "send_customer_reply",
            shareKind: "PRODUCT_DATA",
            autoExecute: true,
            confirmed: true,
            messageText: autoText,
            ...(canAttachMainImg && topItem?.mainImage
              ? {
                  mediaUrl: String(topItem.mainImage),
                  mediaType: "IMAGE",
                  fileName: `${topItem.slug || "product"}.jpg`,
                  mimeType: "image/jpeg",
                }
              : {}),
          },
        ];
        suggestedReply = null;
        answer = `Shared verified product details for *${cleanDisplayProductName(topItem?.name || "requested item")}* directly with *${params.customerName}* on WhatsApp.`;
        error = undefined;
      }
    } else if (/\b(gst|gstin|tax\s*cert|iso|msme|udyam|pan|cheque|bank|certificate|incorporation|labour|iec)\b/i.test(question)) {
      const isGst = /\bgst/i.test(question);
      const isIso = /\biso/i.test(question);
      const isMsme = /\bmsme|\budyam/i.test(question);
      const isBank = /\bcheque|\bbank/i.test(question);
      const docTitle = isGst
        ? "GST Certificate"
        : isIso
        ? "ISO Certificate"
        : isMsme
        ? "MSME Certificate"
        : isBank
        ? "Cancelled Cheque / Bank Details"
        : "Company Certificate";
      const docSlug = docTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      actions = [
        {
          type: "request_company_document_upload",
          requestedDocSlug: docSlug,
          requestedDocTitle: docTitle,
          messageText: `Please find attached our *${docTitle}* for your reference. Let us know if you need anything else.`,
        },
      ];
      suggestedReply = null;
      answer = `No verified *${docTitle}* file matched in Company Documents or website certificates yet. Upload it below once to save it and confirm sharing it with *${params.customerName}*.`;
      error = undefined;
    }
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

  const history = params.recentMessages.slice(-10).map((m) => ({
    role: (m.direction === "OUTBOUND" ? "assistant" : "user") as
      | "user"
      | "assistant",
    content: String(m.body || "").slice(0, 600),
  }));

  if (apiKey) {
    try {
      const aiRes = await callClaudeHaikuMessagesDetailed({
        apiKey,
        maxTokens: 1200,
        effort: "medium",
        timeoutMs: 18000,
        system: `You are ACRIO speaking privately on WhatsApp with an INTERNAL team member at Classic Concepts & Classic Edge 53.
Team member speaking: ${params.staff.name} (${params.staff.position} | Role: ${params.staff.role} | Dept: ${params.staff.department}).

TONE & PERSONALIZATION RULES:
- Greet and address ${params.staff.firstName} warmly like an internal colleague and personal assistant (NOT as an external customer!).
- Never pitch consumer sales prompts like "Would you like us to call you back?" or "Thank you for enquiring with Classic Concepts".
- Give exact MRP prices, product codes/SKUs, specs, and shortlinks concisely for staff quoting.
- Also remind them when relevant that they can text quick commands here: "my chats", "callbacks", "stats", or "check <customer phone>", or open the Hub: ${hubBase}/dashboard/inbox.
- Plain everyday layman English, single asterisks *bold* for WhatsApp, zero em-dashes, zero "--", zero AI buzzwords.

${trainingGuidance.promptBlock ? `[AI Training Guidance]:\n${trainingGuidance.promptBlock}\n\n` : ""}${productContext ? `[Matching Catalog Products]:\n${productContext}\n\n` : ""}${deepSpec?.promptCatalogContext ? `[Deep Product Specs]:\n${deepSpec.promptCatalogContext}\n\n` : ""}${liveContext ? `[Live Company, Team & CRM Context]:\n${liveContext}\n` : ""}`,
        messages: [
          ...history.slice(0, -1),
          { role: "user", content: cleanText },
        ],
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

