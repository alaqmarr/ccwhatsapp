import {
  cleanDisplayProductName,
  type AiTokenUsage,
  type MainWebsiteProduct,
} from "@cc/database";
import {
  type CustomerImageAnalysis,
  type CustomerImageAttachmentInput,
  type SupportedVisionMimeType,
} from "./image-intelligence";
import {
  type AcrioInteractive,
  clip,
} from "./whatsapp-cloud.acrio.ai";
import {
  type AcrioConversationState,
  extractNormalizedColourTokens,
  isProductImageRequest,
  type AcrioMediaAttachment,
} from "./helpers.acrio.ai";

export interface AcrioLocationPin {
  latitude: number;
  longitude: number;
  name: string;
  address: string;
  mapsUrl: string;
}

export interface AcrioAutonomousTurnResult {
  needsHumanHandoff: boolean;
  handoffReason: string;
  needsSalesTeamPing?: boolean;
  salesTeamPingNote?: string;
  customerReply: string;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL";
  conversationState?: AcrioConversationState;
  /** Optional WhatsApp buttons / "View options" list to send with the reply. */
  interactive?: AcrioInteractive;
  /** Optional product / variant photos from Cloudflare R2 to send directly in the WhatsApp chat. */
  mediaAttachments?: AcrioMediaAttachment[];
  /** Optional verified factory Google Maps URL & native WhatsApp location pin for address/location queries. */
  locationPin?: AcrioLocationPin;
}

/** What the turn matched, so the wrapper can decide between plain text, a list or buttons. */
export interface AcrioUiSink {
  intent?: string;
  matches: MainWebsiteProduct[];
  focus?: MainWebsiteProduct | null;
  aggregate?: boolean;
  multiItem?: boolean;
  explicitCodes?: number;
  hidePrices?: boolean;
  budgetLabel?: string | null;
  languageMode?: string;
}

export interface AcrioReplyToMessageContext {
  waMessageId?: string;
  senderName?: string;
  direction?: string;
  body?: string;
  productSlug?: string | null;
  productName?: string | null;
  variantName?: string | null;
}

export interface AcrioTurnParams {
  conversationId?: string;
  customerName: string;
  customerPhone?: string;
  inboundText: string;
  recentMessages?: {
    direction: string;
    senderType?: string;
    body: string;
    productSlug?: string | null;
    replyTo?: AcrioReplyToMessageContext | null;
  }[];
  hasAlreadyGreeted?: boolean;
  persistedState?: AcrioConversationState | null;
  /** Set when the customer tapped a product in the "View options" list. */
  forcedFocusSlug?: string;
  /** Set when the customer swiped/quoted an earlier WhatsApp message. */
  replyToMessage?: AcrioReplyToMessageContext | null;
  /** Attachment metadata if the inbound message included a PDF, image, video, audio, or file. */
  attachment?: {
    mediaType?: "IMAGE" | "DOCUMENT" | "VIDEO" | "AUDIO" | "UNSUPPORTED" | string;
    filename?: string;
    mimeType?: string;
    caption?: string;
    mediaId?: string;
    sha256?: string;
    isSticker?: boolean;
    buffer?: Buffer;
  } | null;
  /**
   * Files the customer sent in the same burst of messages (voice notes, photos, videos, documents), plus messages
   * WhatsApp could not show. The words of those messages are not part of `inboundText`.
   */
  burstAttachments?: {
    images: number;
    documents: number;
    videos: number;
    audios: number;
    unreadable: number;
    imageItems?: CustomerImageAttachmentInput[];
    nonImageItems?: {
      mediaType: string;
      filename?: string;
      mimeType?: string;
      mediaId?: string;
      sha256?: string;
    }[];
  } | null;
  /** Set false to get plain text only (website widget, tests). Defaults to true. */
  enableInteractive?: boolean;
  uiSink?: AcrioUiSink;
  /** Optional DI hooks for deterministic Vision and media fetch verification in tests. */
  visionAnalyzerOverride?: (input: {
    imageBuffer: Buffer;
    mimeType: SupportedVisionMimeType;
    caption?: string;
    filename?: string;
  }) => Promise<{
    ok: boolean;
    analysis?: CustomerImageAnalysis;
    usage?: AiTokenUsage | null;
    error?: string;
  }>;
  mediaFetchImpl?: typeof fetch;
}

export const ACRIO_TEAM_ASK_TEXT = "How would you like to connect with our team?";

export function buildTeamConnectInteractive(): AcrioInteractive {
  return {
    kind: "buttons",
    promptText: ACRIO_TEAM_ASK_TEXT,
    buttons: [
      { id: "acrio:team:chat", title: "Chat with team" },
      { id: "acrio:team:callback", title: "Request a callback" },
      { id: "acrio:menu:keep", title: "Keep browsing" },
    ],
  };
}

export function buildCallbackSlotInteractive(): AcrioInteractive {
  return {
    kind: "buttons",
    promptText: "When should we call you?",
    buttons: [
      { id: "acrio:cb:morning", title: "Morning 10-1" },
      { id: "acrio:cb:afternoon", title: "Afternoon 2-5" },
      { id: "acrio:cb:evening", title: "Evening 5-8" },
    ],
  };
}

function productRowDescription(it: MainWebsiteProduct, hidePrices: boolean): string {
  const dims = it.dimensions || [];
  const h = dims.find((d) => /height/i.test(d.label || d.key || ""))?.value;
  const top = dims.find((d) => /top|size|working|bending/i.test(d.label || d.key || ""))?.value;
  const price =
    !hidePrices && typeof it.basePrice === "number" && it.basePrice > 0
      ? `₹${it.basePrice.toLocaleString("en-IN")}`
      : "";
  const size = [h ? `H ${h}` : "", top ? `Top ${top}` : ""].filter(Boolean).join(" | ");
  const text = [price, size].filter(Boolean).join(" | ").replace(/["”“]/g, "").replace(/\s*Inches?/gi, "");
  return clip(text || (it.specsSummary || it.categoryName || ""), 72);
}

export function buildProductListInteractive(
  items: MainWebsiteProduct[],
  hidePrices: boolean
): AcrioInteractive {
  const rows = items.slice(0, 10).map((it) => ({
    id: `acrio:prod:${it.slug}`,
    title: clip(cleanDisplayProductName(it.name), 24),
    description: productRowDescription(it, hidePrices),
  }));
  return {
    kind: "list",
    buttonLabel: "View options",
    sectionTitle: "Matching products",
    rows,
    promptText: "Tap View options to choose a product.",
  };
}

const ACRIO_KEEP_TEXT_RE =
  /\b(cheapest|costliest|most\s+expensive|cheaper|premium|best|compare|comparison|which\s+one|suggest|recommend|difference|better|vs)\b/i;

/** Decides whether a finished reply should carry buttons or a "View options" list. */
export function decorateAcrioReplyWithInteractive(
  res: AcrioAutonomousTurnResult,
  sink: AcrioUiSink,
  inboundText: string
): Partial<AcrioAutonomousTurnResult> | null {
  const hindi = /HIND/i.test(sink.languageMode || "");

  // Bulk / project quote already pinged to the team: offer the two ways to reach them.
  if (res.needsSalesTeamPing) {
    return { interactive: buildTeamConnectInteractive() };
  }

  if (
    sink.aggregate ||
    sink.multiItem ||
    (res.mediaAttachments && res.mediaAttachments.length > 0) ||
    isProductImageRequest(inboundText) ||
    extractNormalizedColourTokens(inboundText).length > 0
  ) {
    return null;
  }

  // One product under discussion: offer next steps.
  if (sink.focus) {
    return {
      interactive: {
        kind: "buttons",
        promptText: "What would you like to do next?",
        buttons: [
          { id: "acrio:team:ask", title: "Get a quote" },
          { id: "acrio:more", title: "More options" },
        ],
      },
    };
  }

  // Larger list: short intro + "View options" list the customer can open and pick from.
  const requiresLookup = sink.intent === "PRODUCT_SEARCH" || sink.intent === "FOLLOW_UP_REFINEMENT";
  if (
    requiresLookup &&
    sink.matches.length >= 4 &&
    !(sink.explicitCodes && sink.explicitCodes > 0) &&
    !ACRIO_KEEP_TEXT_RE.test(inboundText)
  ) {
    // Put products whose names match the nouns the customer used (chair, stool, table...) first.
    const stop = new Set(["have", "show", "need", "want", "some", "what", "your", "with", "that", "this", "there", "options", "please", "looking", "about", "from", "under", "below", "above"]);
    const nouns = (inboundText.toLowerCase().match(/[a-z]{4,}/g) || [])
      .filter((w) => !stop.has(w))
      .map((w) => w.replace(/(es|s)$/, ""));
    const nameMatches = (it: MainWebsiteProduct) =>
      nouns.some((n) => n.length >= 3 && (it.name || "").toLowerCase().includes(n));
    const ordered = nouns.length
      ? [...sink.matches.filter(nameMatches), ...sink.matches.filter((it) => !nameMatches(it))]
      : sink.matches;
    const interactive = buildProductListInteractive(ordered, Boolean(sink.hidePrices));
    const n = interactive.kind === "list" ? interactive.rows.length : sink.matches.length;
    const mentionsBudget = /\d|\blacs?\b|\blakhs?\b|\bcrore\b|\bk\b|budget/i.test(inboundText);
    const budget = sink.budgetLabel && !sink.hidePrices && mentionsBudget ? ` (${sink.budgetLabel})` : "";
    const intro = hindi
      ? `Aapke liye ${n} options mile hain${budget}. Neeche *View options* dabaiye aur apna pasand ka product chuniye, phir main poori detail bataunga.`
      : `I found ${n} options for you${budget}.\n\nTap *View options* below, pick one, and I will share its full details.`;
    return { customerReply: intro, interactive };
  }
  return null;
}

/**
 * Public entry point. Runs the ACRIO brain, then adds WhatsApp buttons / "View options" lists
 * where they help the customer (long lists, next steps, connecting with the team).
 */
