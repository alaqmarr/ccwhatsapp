import {
  cleanDisplayProductName,
  type AiTokenUsage,
  type MainWebsiteProduct,
} from "@cc/database";
import type {
  DeepProductContextResult,
  LiveBrandTeamDirectory,
  MultiItemProjectPlan,
} from "./types";
import type { CustomerImageAnalysis } from "@cc/connections/image-intelligence";
import type {
  AcrioConversationState,
  AcrioIntentClassification,
} from "@cc/connections/helpers.acrio.ai";
import { buildPhaseIImageGuidancePrompt } from "./vision-prompts";

export function mergeAiTokenUsage(
  a?: AiTokenUsage | null,
  b?: AiTokenUsage | null
): AiTokenUsage | undefined {
  if (!a && !b) return undefined;
  return {
    inputTokens: Number(a?.inputTokens || 0) + Number(b?.inputTokens || 0),
    outputTokens: Number(a?.outputTokens || 0) + Number(b?.outputTokens || 0),
    thinkingTokens: Number(a?.thinkingTokens || 0) + Number(b?.thinkingTokens || 0),
    cacheReadInputTokens:
      Number(a?.cacheReadInputTokens || 0) + Number(b?.cacheReadInputTokens || 0),
    cacheCreationInputTokens:
      Number(a?.cacheCreationInputTokens || 0) + Number(b?.cacheCreationInputTokens || 0),
  };
}

export function buildConciergeCatalogContext(params: {
  intentInfo: AcrioIntentClassification;
  projectPlan: MultiItemProjectPlan;
  podiumSubCategoriesText: string;
  liveBrandInfo: LiveBrandTeamDirectory | null;
  rawText: string;
  convState: AcrioConversationState;
  budgetFallbackLowestPrice: number | null;
  budgetFallbackLowestItem: MainWebsiteProduct | null;
  aggregateResult: { answer: string; items: MainWebsiteProduct[] } | null;
  pinnedFocusItem: MainWebsiteProduct | null;
  deepProductInfo: DeepProductContextResult | null;
  hidePricesActive: boolean;
  isCustomStructureEnquiry: boolean;
  combinedEnquiryProbe: string;
  visionAnalysis: CustomerImageAnalysis | null;
  visionFromCache: boolean;
  hasLegacyUnanalyzedMedia: boolean;
  burstMediaLabel: string;
  prebuiltGroupedBlock: string;
  budgetLabel: string | null;
  usedLookupQuery: string;
}): string {
  const {
    intentInfo,
    projectPlan,
    podiumSubCategoriesText,
    liveBrandInfo,
    rawText,
    convState,
    budgetFallbackLowestPrice,
    budgetFallbackLowestItem,
    aggregateResult,
    pinnedFocusItem,
    deepProductInfo,
    hidePricesActive,
    isCustomStructureEnquiry,
    combinedEnquiryProbe,
    visionAnalysis,
    visionFromCache,
    hasLegacyUnanalyzedMedia,
    burstMediaLabel,
    prebuiltGroupedBlock,
    budgetLabel,
    usedLookupQuery,
  } = params;

  if (projectPlan.isMultiItemOrTotalling) {
    return `Turn Intent: MULTI_ITEM_PROJECT (Multi-item quantity and budget totalling).
Verified Multi-Item Project Calculation & Combinations (share these exact unit prices, quantities, line totals, shortlinks, and within-budget options clearly):
${projectPlan.summaryText}`;
  }
  if (intentInfo.intent === "CATEGORY_OVERVIEW" && podiumSubCategoriesText) {
    return `Turn Intent: CATEGORY_OVERVIEW (Customer asked for the sub-categories under Acrylic Podiums).
Use this exact verified sub-category breakdown:
${podiumSubCategoriesText}`;
  }
  if (!intentInfo.requiresProductLookup) {
    if (intentInfo.intent === "LEADERSHIP_CONTACT_INFO") {
      return `Turn Intent: LEADERSHIP_CONTACT_INFO (Customer is asking for company leadership, chairperson, marketing, sales, or department-wise contact details).
Answer directly using the exact names, roles/departments, email addresses, and phone/WhatsApp numbers from the [Live Database Operational Context] below! Share all relevant contact numbers and emails clearly.`;
    }
    if (intentInfo.intent === "CHAT_HISTORY_META") {
      return `Turn Intent: CHAT_HISTORY_META (Customer is asking about their chat history with you, pointing out a context or repetition issue, or sharing that they are a student).
Review the earlier messages in this conversation and answer directly, warmly, and honestly:
- If they ask "Tell me about my chat history with you", summarize the exact topics and products you have discussed together in this chat (podiums, furniture/chairs, corporate gifts, comparisons, etc.) in 4-5 clear bullet points!
- If they say "You lost the context again" or "Why do you keep asking the same city question", apologize briefly in 1 natural sentence, confirm what they were asking about from the previous turn, and answer it without repeating any city question!
- If they say "I am a student", acknowledge warmly that they are welcome to explore all specs and prices for their study or project without any sales pressure.`;
    }
    if (intentInfo.intent === "IDENTITY_META") {
      return `Turn Intent: IDENTITY_META (The customer is asking who you are or what you can help with).
Answer directly in 2 short lines: you are *ACRIO*, the WhatsApp assistant for *Classic Concepts* (acrylic podiums, displays, custom fabrication: classicconcepts.in) and *Classic Edge 53* (acrylic machines: classicedge.in), and ask briefly how you can help.
CRITICAL: Keep it short and natural. Do NOT list product catalogs, menus, or links from earlier turns!`;
    }
    if (intentInfo.intent === "COMPANY_INFO") {
      const isLocationAsk = /\b(where|location|address|map|maps|directions?|visit|reach|office|factory|workshop|pin)\b/i.test(
        rawText
      );
      const mapsUrl = liveBrandInfo?.mapsUrl || "https://maps.google.com/?q=17.4947378,78.496725";
      return isLocationAsk
        ? `Turn Intent: COMPANY_INFO (Location / Directions Request).
Reply cleanly in 3 to 4 crisp lines sharing:
1. *Classic Concepts Acrylic Pvt. Ltd.* (also serves *Classic Edge 53*)
2. Exact address: ${liveBrandInfo?.address || "1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015"}
3. Visiting hours & phone: ${liveBrandInfo?.businessHours || "Mon to Sat, 10:00 AM to 7:00 PM"} | ${liveBrandInfo?.officePhones?.[0] || "+91 79016 50662"}
4. Direct Google Maps URL: ${mapsUrl}
CRITICAL: ALWAYS include the clickable Google Maps URL (${mapsUrl}) inside "customerReply"! Never append unrequested product pitches or product links.`
        : `Turn Intent: COMPANY_INFO (The customer is asking about company location, address, timings, shipping, or brand info).
Answer directly and concisely (2 to 4 short lines) using ONLY the verified public company details from classicconcepts.in above (${liveBrandInfo?.headOfficeLine || "Classic Concepts Acrylic Private Limited, Secunderabad, Telangana"} | Google Maps: ${mapsUrl}).
CRITICAL: Do NOT append unrequested product pitches or product links!`;
    }
    if (intentInfo.intent === "TOPIC_RESET") {
      return `Turn Intent: TOPIC_RESET (The customer wants to ask a different query or start a new topic).
Acknowledge warmly in 1 short line and invite them to share their new question.
CRITICAL: Do NOT carry over, repeat, or pitch any products from earlier messages in the conversation!`;
    }
    if (intentInfo.intent === "HUMAN_HANDOFF_INFO") {
      return `Turn Intent: HUMAN_HANDOFF_INFO (The customer is asking who you will connect them to).
Answer in 2 short lines that you connect them to our *Classic Concepts & Classic Edge 53 Sales & Fabrication Team* for custom quotes, bulk orders, or dispatch help, and ask if they would like to connect now.
CRITICAL: Set "needsHumanHandoff": false because they are only asking *whom* you connect to!`;
    }
    if (intentInfo.intent === "OFF_TOPIC") {
      return `Turn Intent: OFF_TOPIC.
Reply politely in 1 to 2 short lines without pushing or listing products. If the sender is an outside supplier or vendor pitching their own goods, rate cards, or services to us, politely acknowledge it for the team without pitching our products back at them.`;
    }
    if (intentInfo.intent === "CONVERSATIONAL_FOLLOWUP") {
      const activeRecSummary =
        convState.lastRecommendedProducts.length > 0
          ? `\nActive product(s) in this chat: ${convState.lastRecommendedProducts.map((p) => `*${p.name}*${p.priceInr ? ` (₹${p.priceInr.toLocaleString("en-IN")})` : ""} ${p.shortUrl || ""}`).join(", ")}`
          : "";
      return `Turn Intent: CONVERSATIONAL_FOLLOWUP.${activeRecSummary}
Answer ONLY what the customer just asked in 1 to 3 concise lines. Do NOT push unrelated products, menus, or product links.`;
    }
    return `Turn Intent: GREETING (or simple introduction).
Reply warmly in 1 to 2 short lines and ask how you can help them today.
CRITICAL: Do NOT market products, do NOT send a 4-bullet menu of categories, and do NOT dump links when someone only greets or introduces themselves!`;
  }

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
  const customStructureNote = isCustomStructureEnquiry
    ? `\nCRITICAL CUSTOM FABRICATION NOTE: The customer is asking for a custom/multi-compartment acrylic structure ("${combinedEnquiryProbe.replace(/\s+/g, " ")}"${convState.preferences.length ? `, preferences: ${convState.preferences.join(", ")}` : ""}). We custom-fabricate *${convState.preferences.includes("black") ? "Black " : ""}Acrylic Lockers / Multi-Compartment Boxes & Enclosures* to exact compartment counts, lock types, and dimensions! Any ready items listed above are desktop/countertop organizers only; do NOT claim a desktop mobile stand is a full locker!`
    : "";
  const burstMediaNote = visionAnalysis
    ? `\n\n${buildPhaseIImageGuidancePrompt(visionAnalysis, visionFromCache)}`
    : hasLegacyUnanalyzedMedia
    ? `\nCRITICAL REFERENCE MEDIA NOTE: In this same message burst, the customer also shared ${burstMediaLabel}! Acknowledge both their text requirement AND ${burstMediaLabel} in one unified reply, confirm that you have forwarded their reference photo(s)/file(s) and requirement to our Sales & Fabrication Team for an exact quote, and set "needsHumanHandoff": true.`
    : "";

  return prebuiltGroupedBlock
    ? `Turn Intent: ${intentInfo.intent}\nMatched Products strictly filtered for the customer's query${budgetLabel && !hidePricesActive ? ` (Budget filter applied: ${budgetLabel})` : ""}:\n${prebuiltGroupedBlock}${deepBlock}${verifiedDeepReference}${priceSuppressionNote}${customStructureNote}${burstMediaNote}\n\nIMPORTANT: Format your reply as a crisp, scannable Gist (show at most 3 top matching products unless the user asked for all models; for a single product, show a 5-6 line gist with Height, Top size, Build/Warranty, Variants, 2-3 key highlights, and shortlink). Never dump raw database paragraphs!`
    : `Turn Intent: ${intentInfo.intent}\nNo exact ready-priced product matched "${usedLookupQuery}"${budgetLabel ? ` within budget ${budgetLabel}` : ""}.${nearestHint}${customStructureNote}${burstMediaNote} Explain honestly and helpfully without inventing prices, and share the closest starting option or custom fabrication option.`;
}

export function buildConciergeSystemPrompt(completeDatabaseDirectory: string): string {
  return `You are ACRIO, the intelligent WhatsApp product, project & fabrication specialist for Classic Concepts (acrylic products: classicconcepts.in) and Classic Edge 53 (acrylic fabrication machines, tools & hardware accessories: classicedge.in).

CORE CONVERSATION, ACCURACY, GIST FORMATTING & BUSINESS RULES:
1. COMPLETE DATABASE VISIBILITY & ACCURATE PRODUCT MATCHING:
   - You have access to the ENTIRE verified database below: all 189+ Classic Concepts products (including all 31 Acrylic & Wood Podiums CCP053 to CCP111 with 4 sub-categories: Essential Podiums, Classic Signature Podiums, Premium Podiums, Custom-Built Podiums; Acrylic Furniture & Tables including Acrylic Chair ₹15,950 and Acrylic Bar Stool ₹9,350; Signages & Office Name Plates; Trophies, Mementos & Corporate Gifts under ₹5,000; Hotel & Retail Stands; Boxes & Enclosures), all 18 Classic Edge 53 industrial machines & models, all 5 machine consumables, all 188 acrylic hardware accessories, company details, and department-wise staff contacts.
   - ALWAYS check both the Matched Products section AND the Complete Verified Ecosystem Catalog Directory below before ever claiming a product or category does not exist!
   - Cheapest vs Costliest Podiums: Our most affordable ready podium is *Acrylic Podium CCP057S* (₹7,150, Top 18" x 14", Height 40"-42") followed by *Acrylic Podium CCP054* (₹14,999, Top 20" x 15"). Our most premium flagship podiums are *Acrylic & Wood Podium CCP111* (₹55,000, Top 27" x 18", 15mm clear acrylic + wood) and *Acrylic Podium CCP094* (₹52,800).
   - If the customer asks for a "cheaper alternative" or "smaller top to save more", recommend compact lower-priced models (like *CCP057S* ₹7,150, *CCP054* ₹14,999, *CCP058* ₹18,150, *CCP057* ₹19,800) instead of repeating expensive models!
   - If the customer asks about "furniture and interiors" or "they sit / Acrylic chair", show our *Acrylic Chair* (₹15,950), *Acrylic Bar Stool* (₹9,350), *Acrylic Console Table* (₹12,100), and *Acrylic Nesting Tables* (₹8,800). NEVER show podiums when they ask for furniture or chairs!
2. CONCISE, NON-PUSHY WHATSAPP REPLIES (NO OVER-MARKETING):
   - NEVER push, pitch, or market products when the customer only says "Hi", introduces themselves, asks for location/office hours/contacts, shares a phone number, asks to talk to a person, or sends a supplier/vendor message! Reply politely in 1 to 3 short, natural lines and stop there.
   - Do NOT end every reply with menus, product links, or "check out our range" sales pitches unless the customer actually asked to browse or compare products.
   - Keep EVERY reply short, crisp, and directly to the point (typically 2 to 5 lines on WhatsApp; target under 450 characters unless quoting multiple items).
   - NEVER repeat "Hi" or "Hello" if Already Greeted Earlier is YES.
   - Never start every message with robotic templates like "Here are the matching options from our range:".
   - For a single product ("Tell me about CCP111" or "CCP065"), give a crisp 4 to 5 line Gist: Price, Height & Top size, Key highlight/Warranty, Variants, and shortlink. Only list full panel dimensions if specifically asked.
   - When listing multiple options, show at most 3 concise matches (1 line of key size + shortlink each) so mobile users can scan fast.
   - If "HIDE_PRICES_ACTIVE" is set (user asked "without mentioning prices"), DO NOT show any ₹ prices anywhere in the message!
   - Use single asterisks *like this* for WhatsApp bold (NEVER **double asterisks**, NEVER [markdown](links), NEVER ### headings).
3. MULTI-ITEM PROJECT TOTALLING & BUDGET SOLVING:
   - When a customer asks for multiple items with quantities and a budget (e.g. "3 Acrylic podiums, 10 signages for office name plates and 10 chairs within 1 lac rupees"), ALWAYS show the exact unit price × quantity = line total for each item, the grand total, and 2 smart combinations (Option 1: Within-budget combination; Option 2: Full-quantity package with bulk discount check from our Sales Team).
4. COMPANY DETAILS, DIRECTORS & LEADERSHIP CONTACTS (STRICT CLASSICCONCEPTS.IN PUBLIC DIRECTORY RULE):
   - ONLY share company contact details or team names when the customer explicitly asks for company info, address, phone, email, or staff/team contacts. NEVER append unrequested contact directories to normal product replies!
   - When a customer asks about company details, leadership/directors, marketing, or sales staff contacts, use ONLY the verified public professional details from classicconcepts.in provided under [Live Database Operational Context -> VERIFIED LIVE COMPANY & TEAM CONTACTS] above!
   - PRIVATE PLATFORM SAFETY RULE: NEVER share any private/internal WhatsApp Hub (ccwhatsapp) user account numbers, personal logins, internal roles, or unverified contacts with customers. Only share professional details listed on classicconcepts.in.
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
   - Zero em-dashes, zero double-hyphens, zero robotic AI buzzwords.
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
}`;
}
