import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import nodemailer from "nodemailer";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  loadAllClassicConceptsProducts,
  loadAllClassicEdgeItems,
  resolveBackupDirectory,
  resolveSharedAnthropicApiKey,
  searchEcosystemItems,
  snapshotAllDatabasesToFolder,
  type MainWebsiteProduct,
} from "@cc/database";
import { socketHub } from "@cc/sockets";
import {
  invalidateWhatsAppCacheTags,
  rememberWhatsAppCache,
} from "@cc/storage";

const LOCKED_CLAUDE_MODEL = "claude-haiku-5-5" as const;

function sanitizePlainEnglish(text: string): string {
  return text
    .replace(/\u2014/g, ", ")
    .replace(/\s+\u2013\s+/g, ", ")
    .replace(/--+/g, ", ")
    .replace(/\bbespoke\b/gi, "custom-made")
    .replace(/\bmeticulous(?:ly)?\b/gi, "careful")
    .replace(/\bseamless(?:ly)?\b/gi, "smooth")
    .replace(/\butilize\b/gi, "use")
    .replace(/\bleverage\b/gi, "use")
    .replace(/\bstate-of-the-art\b/gi, "modern")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ============================================================================
// 1. META WHATSAPP CLOUD API CONNECTOR + SANDBOX SIMULATOR
// ============================================================================
export interface OutboundWhatsAppSendResult {
  ok: boolean;
  waMessageId: string;
  mode: "LIVE_META_CLOUD" | "SANDBOX_SIMULATOR";
  deliveryStatus: "SENT" | "DELIVERED" | "FAILED";
  error?: string;
}

export async function sendWhatsAppCloudMessage(params: {
  toPhone: string;
  bodyText: string;
  templateName?: string;
  languageCode?: string;
}): Promise<OutboundWhatsAppSendResult> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const cfgRes = await auth.execute(
    `SELECT value_json FROM setup_state WHERE key = 'facebook_whatsapp_config' LIMIT 1`
  );

  let cfg: Record<string, unknown> = {};
  if (cfgRes.rows[0]?.value_json) {
    try {
      cfg = JSON.parse(String(cfgRes.rows[0].value_json));
    } catch {
      cfg = {};
    }
  }

  const mode = String(cfg.mode || "SANDBOX_SIMULATOR");
  const phoneNumberId = String(cfg.phoneNumberId || "").trim();
  const accessToken = String(cfg.systemUserAccessToken || "").trim();
  const recipientDigits = params.toPhone.replace(/\D/g, "");

  if (mode === "LIVE_META_CLOUD" && phoneNumberId && accessToken) {
    try {
      const payload = params.templateName
        ? {
            messaging_product: "whatsapp",
            to: recipientDigits,
            type: "template",
            template: {
              name: params.templateName,
              language: { code: params.languageCode || "en" },
            },
          }
        : {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientDigits,
            type: "text",
            text: { preview_url: true, body: params.bodyText },
          };

      const res = await fetch(
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

      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          waMessageId: "",
          mode: "LIVE_META_CLOUD",
          deliveryStatus: "FAILED",
          error: data?.error?.message || `Meta Graph HTTP ${res.status}`,
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

  // Sandbox Simulator Mode: generates authentic wamid and simulates DELIVERED status
  const simulatedId = `wamid.sim_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  return {
    ok: true,
    waMessageId: simulatedId,
    mode: "SANDBOX_SIMULATOR",
    deliveryStatus: "DELIVERED",
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

export async function getCachedEcosystemCatalog(): Promise<{
  classicConceptsProducts: MainWebsiteProduct[];
  classicEdgeItems: MainWebsiteProduct[];
  allItems: MainWebsiteProduct[];
}> {
  const [classicConceptsProducts, classicEdgeItems] = await Promise.all([
    rememberWhatsAppCache(
      "ecosystem:cc-products:v1",
      ["cc-products"],
      3600,
      () => loadAllClassicConceptsProducts()
    ),
    rememberWhatsAppCache(
      "ecosystem:ce53-items:v1",
      ["ce53-machines"],
      3600,
      () => loadAllClassicEdgeItems()
    ),
  ]);

  return {
    classicConceptsProducts,
    classicEdgeItems,
    allItems: [...classicConceptsProducts, ...classicEdgeItems],
  };
}

export async function syncEcosystemRedisCache(): Promise<{
  classicConceptsCount: number;
  classicEdgeMachinesCount: number;
  classicEdgeConsumablesCount: number;
  syncedAt: string;
}> {
  await invalidateWhatsAppCacheTags(["cc-products", "ce53-machines", "acrio-replies"]);
  const { classicConceptsProducts, classicEdgeItems } = await getCachedEcosystemCatalog();
  return {
    classicConceptsCount: classicConceptsProducts.length,
    classicEdgeMachinesCount: classicEdgeItems.filter((i) => i.itemType === "MACHINE").length,
    classicEdgeConsumablesCount: classicEdgeItems.filter((i) => i.itemType === "CONSUMABLE").length,
    syncedAt: new Date().toISOString(),
  };
}

export async function runAcrioChatCopilot(params: {
  customerName: string;
  organizationType?: string;
  recentMessages: { direction: string; body: string }[];
  ordersSummary?: string[];
}): Promise<AcrioChatCopilotResult> {
  // Exclude internal team notes when suggesting customer replies
  const customerMessages = params.recentMessages.filter(
    (m) => m.direction === "INBOUND" || m.direction === "OUTBOUND"
  );
  const lastInbound =
    [...customerMessages]
      .reverse()
      .find((m) => m.direction === "INBOUND")?.body ||
    customerMessages[customerMessages.length - 1]?.body ||
    "";

  const lower = lastInbound.toLowerCase();
  const { allItems } = await getCachedEcosystemCatalog();
  const catalog = searchEcosystemItems(allItems, lastInbound, 4);

  // Smart intent & category classification across Classic Concepts + Classic Edge 53
  let smartCategory = "General Enquiry";
  let priority: AcrioChatCopilotResult["priority"] = "NORMAL";

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
  } else if (/order|dispatch|delivery|invoice|advance|payment/i.test(lower)) {
    smartCategory = "Order & Delivery";
  }

  const firstName = params.customerName.split(/[\s(]/)[0] || "there";
  const topProduct = catalog[0];

  const mappedRecommendations: AcrioRecommendedItem[] = catalog.map((c) => ({
    name: c.name,
    slug: c.slug,
    sku: c.sku,
    priceInr: c.basePrice,
    url: c.url,
    brand: c.brand,
    brandLabel: c.brandLabel,
    itemType: c.itemType,
    modelsSummary: c.modelsSummary || null,
  }));

  // Zero Anthropic AI calls here to save AI credits — AI is strictly reserved for
  // runAcrioAutonomousTurn when a chat is assigned to System (ACRIO)!
  const localReplies: string[] = [];
  if (smartCategory === "Acrylic Machines (CE53)") {
    localReplies.push(
      topProduct
        ? `Hello ${firstName}! For acrylic fabrication, check our ${topProduct.name}${topProduct.sku ? ` (${topProduct.sku})` : ""} from Classic Edge 53: ${topProduct.url}`
        : `Hello ${firstName}! Tell us the sheet thickness and working width you need and our Classic Edge 53 machine specialist will share the right model and brochure.`,
      `Hi ${firstName}, would you like the specification sheet, live demo video, and landed quotation for this machine?`,
      `Hello ${firstName}, we also stock genuine diamond cutters, heaters, and machine consumables ready for dispatch. Let us know your city for delivery details.`
    );
  } else if (smartCategory === "Podiums & Stage") {
    localReplies.push(
      `Hi ${firstName}! Yes, we have wide-top clear stage podiums ready and can add your front logo before dispatch. Shall I share our ready models and sizes?`,
      `Hello ${firstName}, here is our podium collection link: https://whatsapp.ccapl.cc/l/stage-podiums. Let us know your preferred height or logo file and we will confirm delivery.`,
      `Hi ${firstName}, our team checked stock availability. Share your event date and delivery city so we can reserve it right away.`
    );
  } else if (smartCategory === "Awards & Trophies") {
    localReplies.push(
      `Hello ${firstName}! For student and event awards, we have clear acrylic mementos and plaques within your budget, including logo printing: https://whatsapp.ccapl.cc/l/student-awards`,
      `Hi ${firstName}, please share the total quantity and event date, plus your logo file, so we can send 3 matching trophy designs with bulk pricing.`,
      topProduct
        ? `Hello ${firstName}, our ${topProduct.name}${topProduct.basePrice ? ` (Rs ${topProduct.basePrice})` : ""} is very popular for ceremonies. Would you like a sample layout with your logo?`
        : `Hello ${firstName}, we can print your institution logo and student names on clear acrylic awards. What quantity do you need?`
    );
  } else if (smartCategory === "Custom Fabrication") {
    localReplies.push(
      `Hello ${firstName}! Please share the exact length, width, height, and thickness in mm (or a rough sketch) and our production desk will send a quote.`,
      `Hi ${firstName}, thank you for confirming! Once the advance is received, we will share the final size sheet for your approval before making it.`,
      `Hello ${firstName}, we make clear acrylic covers and boxes to exact measurements. Let us know how many pieces you need.`
    );
  } else {
    localReplies.push(
      `Hello ${firstName}! Thank you for messaging Classic Concepts. Tell us the product, machine, size, or quantity you need and I will share the closest options right away.`,
      topProduct
        ? `Hi ${firstName}, based on your message, take a look at ${topProduct.name}: ${topProduct.url}`
        : `Hi ${firstName}, here is our main catalog link: https://whatsapp.ccapl.cc/l/stage-podiums. Let me know if you need acrylic products or Classic Edge 53 machines!`,
      `Hi ${firstName}, I am checking this with our team and will update you shortly.`
    );
  }

  return {
    engineLabel: "ACRIO",
    smartCategory,
    priority,
    suggestedReplies: localReplies.map(sanitizePlainEnglish),
    recommendedProducts: mappedRecommendations,
    resolutionDraft: sanitizePlainEnglish(
      `Shared ${smartCategory.toLowerCase()} options and pricing details with ${params.customerName}, and updated customer follow-up notes.`
    ),
  };
}

export interface AcrioAutonomousTurnResult {
  needsHumanHandoff: boolean;
  handoffReason: string;
  customerReply: string;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL";
}

/**
 * Autonomous ACRIO Backend Handler:
 * Every new/reopened customer chat is initially assigned to ACRIO.
 * - Answers product & machine queries automatically from the Redis-cached
 *   Classic Concepts (`classicconcepts.in`) & Classic Edge 53 (`classicedge53.com`) catalogs.
 * - If the customer asks to speak to support/staff OR ACRIO cannot resolve the query on its own,
 *   flags `needsHumanHandoff = true` so the worker connects the chat to our Sales Team (P0 -> P1 -> P2).
 */
export async function runAcrioAutonomousTurn(params: {
  customerName: string;
  inboundText: string;
  recentMessages?: { direction: string; body: string }[];
}): Promise<AcrioAutonomousTurnResult> {
  const rawText = params.inboundText.trim();
  const lower = rawText.toLowerCase();
  const firstName = params.customerName.split(/[\s(]/)[0] || "there";

  // 1. Explicit request to talk to human support / sales staff
  const explicitSupportRequest =
    /\b(support|human|agent|staff|person|representative|executive|manager|sales\s*team|talk\s*to|speak\s*to|speak\s*with|connect\s*me|call\s*me|real\s*person|someone)\b/i.test(
      lower
    );

  // 2. Complex / sensitive cases where ACRIO should hand off directly to Sales Team
  const unresolvableByBot =
    /\b(complaint|damaged|broken|wrong\s*item|refund|cancel|dispute|negotiate|final\s*discount|drawing\s*attached|cad|dxf|urgent\s*callback|gst\s*mismatch|payment\s*stuck)\b/i.test(
      lower
    );

  const { allItems } = await getCachedEcosystemCatalog();
  const matches = searchEcosystemItems(allItems, rawText, 3);
  const top = matches[0];

  let smartCategory = "General Enquiry";
  let priority: "URGENT" | "HIGH" | "NORMAL" = "NORMAL";

  if (/machine|laser|router|polish|diamond|bending|bender|heater|yn-|ce53|classic edge|consumable|blade|cutter/i.test(lower)) {
    smartCategory = "Acrylic Machines (CE53)";
    priority = "HIGH";
  } else if (/podium|lectern|pulpit|stage|auditorium|conference/i.test(lower)) {
    smartCategory = "Podiums & Stage";
    priority = /friday|urgent|tomorrow|today/i.test(lower) ? "URGENT" : "HIGH";
  } else if (/trophy|trophies|memento|award|student|convocation|plaque/i.test(lower)) {
    smartCategory = "Awards & Trophies";
  } else if (/hotel|banquet|menu|qr|resort|hospitality/i.test(lower)) {
    smartCategory = "Hotel & Banquet";
    priority = "HIGH";
  } else if (/cover|guard|enclosure|custom|mm|inch/i.test(lower)) {
    smartCategory = "Custom Fabrication";
    priority = "HIGH";
  } else if (/order|dispatch|delivery|invoice|advance|payment/i.test(lower)) {
    smartCategory = "Order & Delivery";
  }

  if (explicitSupportRequest) {
    return {
      needsHumanHandoff: true,
      handoffReason: `Customer asked to speak with our team ("${rawText.slice(0, 120)}").`,
      customerReply: sanitizePlainEnglish(
        `Hi ${firstName}! Connecting you to our Sales Team right away. A team member will reply to you here shortly.`
      ),
      smartCategory,
      priority: "HIGH",
    };
  }

  if (unresolvableByBot) {
    return {
      needsHumanHandoff: true,
      handoffReason: `Query needs personal assistance from Sales Team ("${rawText.slice(0, 120)}").`,
      customerReply: sanitizePlainEnglish(
        `Hi ${firstName}, I am connecting your chat directly to our Sales Team so they can check this personally and help you right away.`
      ),
      smartCategory,
      priority: "URGENT",
    };
  }

  // 3. Try Claude Haiku 5.5 when shared Anthropic API key is configured
  const { apiKey } = await resolveSharedAnthropicApiKey();
  if (apiKey) {
    try {
      const historyLines = (params.recentMessages || [])
        .filter((m) => m.direction === "INBOUND" || m.direction === "OUTBOUND")
        .slice(-5)
        .map((m) => `${m.direction}: ${m.body}`)
        .join("\n");

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: LOCKED_CLAUDE_MODEL,
          max_tokens: 380,
          temperature: 0.2,
          system: `You are ACRIO, the automated WhatsApp assistant for Classic Concepts (acrylic products: classicconcepts.in) and Classic Edge 53 (acrylic machines & consumables: classicedge53.com).
Rules:
1. Write in simple, warm, everyday layman English. Zero em-dashes ("—"), zero "--", zero robotic buzzwords. Never mention 16,000 sq ft boilerplate unless asked.
2. Answer directly using the matching products/machines provided. Share the exact product/machine link when relevant.
3. Set "needsHumanHandoff": true ONLY if the customer asks to talk to a human/support/salesperson, OR if the question cannot be answered from our catalog/machines (for example custom quote approval, order tracking check, complaint, or unclear special request).
4. If "needsHumanHandoff" is false, end briefly by letting them know they can reply "talk to team" anytime if they want a team member.
Return ONLY valid JSON:
{
  "needsHumanHandoff": false,
  "handoffReason": "",
  "smartCategory": "Podiums & Stage | Awards & Trophies | Hotel & Banquet | Acrylic Machines (CE53) | Custom Fabrication | Order & Delivery | General Enquiry",
  "priority": "URGENT | HIGH | NORMAL",
  "customerReply": "Your short WhatsApp reply"
}`,
          messages: [
            {
              role: "user",
              content: `Customer: ${params.customerName}
Matching catalog & machine items:
${matches.map((c) => `- [${c.brandLabel} ${c.itemType}] ${c.name}${c.sku ? ` (${c.sku})` : ""}${c.basePrice ? ` Rs ${c.basePrice}` : ""} -> ${c.url}`).join("\n")}
Recent chat:
${historyLines}
Latest customer message: ${rawText}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(9000),
      });

      if (response.ok) {
        const json: any = await response.json();
        const text = json?.content?.[0]?.text || "";
        const s = text.indexOf("{");
        const e = text.lastIndexOf("}");
        if (s !== -1 && e > s) {
          const parsed = JSON.parse(text.slice(s, e + 1));
          if (typeof parsed.customerReply === "string" && parsed.customerReply.trim()) {
            const handoff = Boolean(parsed.needsHumanHandoff);
            return {
              needsHumanHandoff: handoff,
              handoffReason:
                parsed.handoffReason ||
                (handoff
                  ? `ACRIO could not resolve fully and connected customer to Sales Team.`
                  : ""),
              customerReply: sanitizePlainEnglish(parsed.customerReply),
              smartCategory: parsed.smartCategory || smartCategory,
              priority: parsed.priority || priority,
            };
          }
        }
      }
    } catch {
      // Fall back to deterministic catalog/machine answer engine below
    }
  }

  // 4. Deterministic Backend ACRIO Resolution Engine (when offline or no API key yet)
  if (/^(hi|hello|hey|good\s*morning|good\s*afternoon|good\s*evening|namaste)\W*$/i.test(rawText)) {
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      customerReply: sanitizePlainEnglish(
        `Hello ${firstName}! Welcome to Classic Concepts (ACRIO Assistant). Are you looking for acrylic podiums, awards, stands, custom boxes, or Classic Edge 53 machines? Tell me what you need, or reply "talk to team" anytime to speak with our Sales Team.`
      ),
      smartCategory,
      priority: "NORMAL",
    };
  }

  // Order tracking or custom dimension pricing requires human Sales Team verification
  if (smartCategory === "Order & Delivery" || /\b(\d+\s*(?:mm|cm|inch|ft)\s*x\s*\d+)\b/i.test(lower)) {
    return {
      needsHumanHandoff: true,
      handoffReason: `ACRIO needs human verification for ${smartCategory.toLowerCase()} ("${rawText.slice(0, 110)}").`,
      customerReply: sanitizePlainEnglish(
        `Hi ${firstName}! I have noted your details and connected your chat to our Sales Team so they can check exact pricing and schedule for you right away.`
      ),
      smartCategory,
      priority: "HIGH",
    };
  }

  if (smartCategory === "Acrylic Machines (CE53)" && top) {
    return {
      needsHumanHandoff: false,
      handoffReason: "",
      customerReply: sanitizePlainEnglish(
        `Hi ${firstName}! Here is our matching Classic Edge 53 machine: ${top.name}${top.sku ? ` (${top.sku})` : ""} - ${top.url}. Share your sheet thickness or city for a quote, or reply "talk to team" to connect with our Sales Team.`
      ),
      smartCategory,
      priority,
    };
  }

  if (top && (smartCategory !== "General Enquiry" || matches.length > 0)) {
    // Check if the query actually matched any meaningful keyword in our catalog; if completely unrelated/unclear, hand off to Sales Team!
    const hasCatalogMatch = matches.some((item) => {
      const words = lower.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
      const hay = `${item.name} ${item.categoryName} ${item.sku || ""} ${item.description || ""}`.toLowerCase();
      return words.some((w) => hay.includes(w));
    });

    if (hasCatalogMatch) {
      return {
        needsHumanHandoff: false,
        handoffReason: "",
        customerReply: sanitizePlainEnglish(
          `Hi ${firstName}! Take a look at our ${top.name}${top.basePrice ? ` (Rs ${top.basePrice})` : ""}: ${top.url}. Let me know the quantity or size you need, or reply "talk to team" anytime to speak with our Sales Team.`
        ),
        smartCategory,
        priority,
      };
    }
  }

  // If ACRIO cannot match the query confidently -> connect to Sales Team automatically!
  return {
    needsHumanHandoff: true,
    handoffReason: `ACRIO could not match a standard catalog answer for "${rawText.slice(0, 110)}". Connected to Sales Team.`,
    customerReply: sanitizePlainEnglish(
      `Hi ${firstName}! Thank you for your message. I am connecting you to our Sales Team right now so a team member can help you with this.`
    ),
    smartCategory,
    priority: "NORMAL",
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
    filterExplanation: sanitizePlainEnglish(
      `Matched ${filtered.length} opted-in contacts based on organization category, past order history, and ACRIO conversation tags.`
    ),
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
  const runFolder = path.join(backupRoot, `snapshot_${stamp}`);

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
        fileName: path.basename(f.filePath),
        sizeBytes: f.sizeBytes,
        base64: fs.readFileSync(f.filePath).toString("base64"),
      })),
    };
    const compressedArchive = zlib.gzipSync(
      Buffer.from(JSON.stringify(bundlePayload), "utf8")
    );
    const archiveName = `ccwhatsapp_libsql_backup_${stamp}.json.gz`;
    const archivePath = path.join(runFolder, archiveName);
    fs.writeFileSync(archivePath, compressedArchive);

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
    for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("snapshot_")) {
        const full = path.join(backupRoot, entry.name);
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoffMs) {
          fs.rmSync(full, { recursive: true, force: true });
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
// 4. STAFF EMAIL OTP DELIVERY CONNECTOR
// ============================================================================
export async function sendStaffVerificationEmail(params: {
  email: string;
  staffName: string;
  otpCode: string;
}): Promise<{ deliveredViaSmtp: boolean; devPreviewCode?: string }> {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();

  if (host && user && pass) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT || 587) === 465,
        auth: { user, pass },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || `"Classic Concepts WhatsApp Hub" <${user}>`,
        to: params.email,
        subject: `${params.otpCode} is your Classic Concepts Staff Verification Code`,
        text: `Hello ${params.staffName},\n\nYour 6-digit email verification code for Classic Concepts WhatsApp Staff Hub is: ${params.otpCode}\n\nThis code is valid for 15 minutes. Once verified, your account will be sent to a Superadmin/Dev for final activation.\n`,
      });
      return { deliveredViaSmtp: true };
    } catch {
      return { deliveredViaSmtp: false, devPreviewCode: params.otpCode };
    }
  }

  return { deliveredViaSmtp: false, devPreviewCode: params.otpCode };
}
