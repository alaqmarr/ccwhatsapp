import {
  buildCompleteEcosystemDatabaseDirectory,
  buildEcosystemDeepProductContextAndAnswer,
  cleanDisplayProductName,
  loadLiveDatabaseOperationalContext,
  fetchLiveEcosystemDocuments,
  findMatchingAiTrainingGuidance,
  findMatchingEcosystemDocuments,
  resolveSharedAnthropicApiKey,
  searchEcosystemItems,
  type AiTokenUsage,
  type AiTraceStep,
  type MainWebsiteProduct,
} from "@cc/database";

type EcosystemDocumentRecord = Awaited<
  ReturnType<typeof findMatchingEcosystemDocuments>
>[number];
import {
  LOCKED_CLAUDE_MODEL,
  parseClaudeJson,
  callClaudeHaikuMessagesDetailed,
  recordAndBroadcastAiLog,
  mapProductToLogItem,
  formatWhatsAppOutboundText,
} from "@cc/connections/initialise.acrio.ai";
import { getCachedEcosystemCatalog } from "@cc/connections/helpers.acrio.ai";
import type { AcrioStaffAction, StaffNoteAttachmentInput } from "./types";

function mapDocCandidateOptions(docs: EcosystemDocumentRecord[]) {
  return docs.slice(0, 6).map((d) => ({
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

function buildDeterministicShareFallback(params: {
  question: string;
  customerName: string;
  noteAttachment?: StaffNoteAttachmentInput | null;
  matchedEcoDocs: EcosystemDocumentRecord[];
  matches: MainWebsiteProduct[];
  deterministicDeepAnswer: string | null;
  asksSpecificallyForDocument: boolean;
}): { actions: AcrioStaffAction[]; answer: string } | null {
  const {
    question,
    customerName,
    noteAttachment,
    matchedEcoDocs,
    matches,
    deterministicDeepAnswer,
    asksSpecificallyForDocument,
  } = params;

  if (noteAttachment) {
    const fileLabel = noteAttachment.fileName || "Attachment";
    const upperType = String(noteAttachment.mediaType || "").toUpperCase();
    const mediaType = (["IMAGE", "VIDEO", "DOCUMENT", "AUDIO"].includes(upperType)
      ? upperType
      : "DOCUMENT") as "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO";
    return {
      actions: [
        {
          type: "send_customer_reply",
          shareKind: "DOCUMENT",
          autoExecute: false,
          mediaUrl: noteAttachment.url,
          mediaType,
          mediaId: noteAttachment.mediaId,
          waMediaId: noteAttachment.waMediaId,
          fileName: fileLabel,
          mimeType: noteAttachment.mimeType,
          messageText: `Please find attached *${fileLabel}* for your reference. Let us know if you need anything else.`,
          confirmed: false,
        },
      ],
      answer: `Ready to share *${fileLabel}* directly with *${customerName}* on WhatsApp. Please confirm below to send it now.`,
    };
  }

  if (asksSpecificallyForDocument && matchedEcoDocs.length > 0) {
    const primary = matchedEcoDocs[0];
    const hasMultiple = matchedEcoDocs.length > 1;
    const candidateBlock = hasMultiple
      ? { candidateOptions: mapDocCandidateOptions(matchedEcoDocs) }
      : {};
    const listLines = matchedEcoDocs
      .slice(0, 6)
      .map((d, idx) => `${idx + 1}. *${d.title}* (${d.sourceLabel} • \`${d.fileName}\`)`)
      .join("\n");
    return {
      actions: [
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
          ...candidateBlock,
        },
      ],
      answer: hasMultiple
        ? `Found *${matchedEcoDocs.length} matching documents* across our websites and records:\n${listLines}\n\nConfirm below which one to send to *${customerName}* (or reply *@ACRIO 1*, *@ACRIO 2*, etc.).`
        : `Found *${primary.title}* from ${primary.sourceLabel} (\`${primary.fileName}\`). Please confirm below before I share it with *${customerName}* on WhatsApp.`,
    };
  }

  if (!asksSpecificallyForDocument && (deterministicDeepAnswer || matches.length > 0)) {
    const topItem = matches[0];
    const autoText =
      deterministicDeepAnswer ||
      (topItem
        ? `*${cleanDisplayProductName(topItem.name)}*${topItem.sku ? ` (${topItem.sku})` : ""}\n${
            topItem.basePrice ? `Price: ₹${topItem.basePrice.toLocaleString("en-IN")}` : "Custom Quote Item"
          }\n${topItem.specsSummary ? `Specs: ${topItem.specsSummary}\n` : ""}Link: ${topItem.shortUrl || topItem.url}`
        : "");
    if (autoText) {
      const canAttachMainImg =
        Boolean(topItem?.mainImage && /^https?:\/\//i.test(String(topItem.mainImage))) &&
        autoText.length <= 900;
      return {
        actions: [
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
        ],
        answer: `Shared verified product details for *${cleanDisplayProductName(topItem?.name || "requested item")}* directly with *${customerName}* on WhatsApp.`,
      };
    }
  }

  if (/\b(gst|gstin|tax\s*cert|iso|msme|udyam|pan|cheque|bank|certificate|incorporation|labour|iec)\b/i.test(question)) {
    const docTitle = /\bgst/i.test(question)
      ? "GST Certificate"
      : /\biso/i.test(question)
      ? "ISO Certificate"
      : /\bmsme|\budyam/i.test(question)
      ? "MSME Certificate"
      : /\bcheque|\bbank/i.test(question)
      ? "Cancelled Cheque / Bank Details"
      : "Company Certificate";
    const docSlug = docTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return {
      actions: [
        {
          type: "request_company_document_upload",
          requestedDocSlug: docSlug,
          requestedDocTitle: docTitle,
          messageText: `Please find attached our *${docTitle}* for your reference. Let us know if you need anything else.`,
        },
      ],
      answer: `No verified *${docTitle}* file matched in Company Documents or website certificates yet. Upload it below once to save it and confirm sharing it with *${customerName}*.`,
    };
  }

  return null;
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
  noteAttachment?: StaffNoteAttachmentInput | null;
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
1. Plain everyday layman English. Zero em-dashes, zero double-hyphens, zero buzzwords (no bespoke, elevate, delve, meticulous, seamless, utilize, etc.).
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

  const asksToShareWithClient =
    /\b(share|send|forward|give|attach)\b/i.test(question) &&
    /\b(client|customer|them|buyer|gst|certificate|brochure|catalogue|catalog|msme|udyam|iso|incorporation|labour|iec|cheque|bank|file|doc|pdf|data|details|info|price|spec|quote|link|product|machine|podium|chair|table|trophy|memento)\b/i.test(
      question
    );
  const asksSpecificallyForDocument =
    /\b(gst|gstin|tax\s*cert|iso|msme|udyam|incorporation|coi|labour|labor|iec|importer|exporter|cheque|bank|certificate|certificates|brochure|catalogue|catalog|pdf|document|documents)\b/i.test(
      question
    );

  if (asksSpecificallyForDocument && actions.length > 0 && matchedEcoDocs.length > 1) {
    for (const act of actions) {
      if (act.type === "send_customer_reply" && !act.autoExecute && (!act.candidateOptions || act.candidateOptions.length === 0)) {
        act.shareKind = "DOCUMENT";
        act.candidateOptions = mapDocCandidateOptions(matchedEcoDocs);
      }
    }
  }

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
    const fb = buildDeterministicShareFallback({
      question,
      customerName: params.customerName,
      noteAttachment: params.noteAttachment,
      matchedEcoDocs,
      matches,
      deterministicDeepAnswer: deep.deterministicDeepAnswer,
      asksSpecificallyForDocument,
    });
    if (fb) {
      actions = fb.actions;
      answer = fb.answer;
      suggestedReply = null;
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
