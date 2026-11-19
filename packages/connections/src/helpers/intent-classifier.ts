import type { AcrioCustomerProfileInfo, AcrioIntentClassification } from "./types";

export const ACRIO_DOMAIN_PRODUCT_NOUN_RE =
  /\b(ccpo?[-_\s]?\d{2,4}[a-z]?|yn[-_\s]?jw\d{3,4}|abm[-_\s]?\d{3,4}|ce53[-_\s]?[a-z0-9-]+|cw[-_\s]?\d{3,5}|f[-_\s]?(?:308|500)|sd[-_\s]?\d{3,4}|jw[-_\s]?\d{3,4}|zd[-_\s]?\d{3,4}|d30|ce[-_\s]?(?:lc|cnc|fp|to)\d{2,4}|c[-\s]*podium|podium|podiums|pulpit|pulpits|lectern|lecterns|rostrum|rostrums|trophy|trophies|memento|mementos|award|awards|plaque|plaques|medal|medals|gift|gifts|gifting|corporate\s*gift|corporate\s*clients?|souvenir|souvenirs|paper\s*weight|paperweight|pen\s*stand|stand|stands|holder|holders|riser|risers|menu|qr|tent\s*card|brochure|leaflet|pamphlet|tray|trays|coaster|coasters|tissue|napkin|box|boxes|case|cases|cover|covers|enclosure|enclosures|guard|guards|display|displays|cabinet|cabinets|locker|lockers|mobile\s*locker|phone\s*locker|cell\s*phone|mobile|mobiles|phone|phones|tablet|tablets|compartment|compartments|pigeon\s*hole|rack|racks|shelf|shelves|caddy|counter|counters|partition|partitions|shield|shields|sneeze\s*guard|key\s*box|key\s*cabinet|medicine\s*box|first\s*aid\s*box|showcase|vitrine|frame|frames|easel|signage|signages|sign|signs|name\s*plate|name\s*plates|nameplate|nameplates|name\s*board|board|sheet|sheets|rod|rods|tube|tubes|pipe|pipes|ball|balls|sphere|turntable|rotating\s*disc|machine|machines|polisher|polishing|bender|bending|heater|laser|router|cnc|cutter|blade|consumable|consumables|carbide|collet|chiller|compressor|solvent|chloroform|glue|adhesive|buffing|flame|oven|thermoforming|accessor(?:y|ies)|add[-\s]?ons?|hinge|hinges|camlock|camlocks|standoff|standoffs|spacer|spacers|knob|knobs|handle|handles|latch|latches|catch|catches|hasp|staple|screw|screws|bolt|nut|washer|bracket|brackets|photo\s*magnet|radeon|glitter|mirror|metallic|keychain|keychains|keyring|bookmark|globe|hanger|organizer|organiser|dispenser|glove|mask|shoe|table|tables|stool|stools|chair|chairs|desk|desks|furniture|interior|interiors|interiora|decor|furnishing|seating|sit|sitting|donation|suggestion\s*box|ballot|cake\s*stand|cupcake|cosmetic|makeup|lipstick|jewelry|jewellery|watch\s*stand|eyewear|sunglass|mobile\s*stand|laptop\s*stand|book\s*stand|quran|rehal|bible|photo\s*frame|poster|wall\s*mount|keyway|lockable|custom\s*size|fabrication|cast\s*acrylic|extruded\s*acrylic|acrylic\s*sheet)\b/i;

const ACRIO_FOLLOW_UP_REFINEMENT_RE =
  /\b(under|below|above|over|between|within|around|budget|price|cost|rate|mrp|how\s*much|kitna|kitne|cheaper|cheapest|lowest\s*price|costliest|most\s*expensive|smaller\s*top|save\s*more|lower\s*price|higher\s*budget|increase\s*(?:the\s*)?budget|raise\s*(?:the\s*)?budget|stretch\s*(?:the\s*)?budget|extend\s*(?:the\s*)?budget|without\s*(?:mentioning\s*)?prices?|no\s*prices?|hide\s*prices?|premium|most\s*premium|high\s*end|flagship|best\s*one|best\s*ones|first\s*two|top\s*two|both\s*of\s*them|all\s*(?:three|two|four|five|of\s*them)|rs\.?|inr|₹|\d+\s*(?:k|lac|lacs|lakh|lakhs|cr|crore)\b|\d{4,7}\b|\d+\s*(?:pcs?|pieces?|nos?|units?|qty|quantity|sets?)\b|single\s*piece|just\s*one|transparent|clear|frost|frosted|black|white|gold|golden|silver|stainless|colored|coloured|color|colors|colour|colours|variant|variants|finish|finishes|imag[a-z]*|phot[a-z]*|phto[a-z]*|pics?|pictures?|snaps?|visuals?|videos?|pdf|brochure|catalogue|catalog|dikha[a-z]*|photo\s*bhejo|bhejo\s*photo|close[-\s]*up|how\s+does\s+(?:it|this|that)\s+look|look\s+like|dimension|dimensions|size|sizes|height|width|depth|reading\s*top|top\s*sheet|bottom\s*sheet|front\s*panel|shelf\s*size|logo\s*panel|spec|specs|specification|specifications|feature|features|details?|pillar|pillars|warranty|wheel|wheels|weight|assembly|diy|thick|thickness|available|availability|in\s*stock|stock|delivery|shipping|dispatch|gst|tax|invoice|how\s+to\s+(?:order|buy|book)|order\s+this|buy\s+this|book\s+this|i\s+want\s+this|this\s+one|that\s+one|same\s+one|\d+\s*(?:mm|cm|inch|inches|in|ft)\b|bigger|biggest|larger|largest|smaller|wider|widest|taller|tallest|compact|portable|foldable|wheeled|castor|led|light|backlit|logo|branding|print|engraving|uv\s*print|without\s*logo|no\s*logo|with\s*logo|show\s*more|more\s*options|any\s*more|other\s*options|any\s*other|another\s*model|different\s*size|different\s*model|which\s*one|which\s*of\s*these|alternative|alternatives)\b/i;

export const ACRIO_SHORT_CITY_OR_REPLY_RE =
  /\b(hyderabad|secunderabad|mumbai|bangalore|bengaluru|delhi|new\s*delhi|noida|gurgaon|gurugram|chennai|pune|kolkata|ahmedabad|surat|vadodara|jaipur|lucknow|kanpur|nagpur|indore|bhopal|visakhapatnam|vizag|vijayawada|guntur|warangal|tirupati|coimbatore|madurai|kochi|ernakulam|trivandrum|patna|ranchi|bhubaneswar|guwahati|chandigarh|ludhiana|amritsar|dehradun|raipur|mysore|mangalore|hubli|belgaum|nashik|aurangabad|thane|navi\s*mumbai|faridabad|ghaziabad|\d{6})\b/i;

export function detectAcrioCustomerProfile(
  rawText: string,
  recentInboundText = ""
): AcrioCustomerProfileInfo {
  const combined = `${recentInboundText} ${rawText}`.trim();
  const lower = combined.toLowerCase();

  const hasDevanagari = /[\u0900-\u097F]/.test(rawText);
  const hasOtherIndianScript = /[\u0980-\u0DFF]/.test(rawText);
  const hasHinglishTokens =
    /\b(kya|hai|hain|chahiye|kitna|kitne|ka\s+hai|milega|batao|bataiye|dikhao|sasta|mehenga|aur\s+dikhao|humko|mujhe|dukaan|bhaiya|rate\s+kya|kaisa)\b/i.test(
      rawText
    );

  const languageMode: AcrioCustomerProfileInfo["languageMode"] = hasOtherIndianScript
    ? "OTHER_FALLBACK"
    : hasDevanagari || hasHinglishTokens
    ? "HINDI_HINGLISH"
    : "ENGLISH";

  const isStudent = /\b(i\s+am\s+a\s+student|for\s+my\s+college\s+project|school\s+project|just\s+learning|student\s+here)\b/i.test(lower);
  const isBusinessInstitutional =
    /\b(renovation|office|corporate\s*clients?|bulk|gst|invoice|quotation|proforma|company|hospital|hotel|church|school|college|university|auditorium|\d+\s*(?:podiums?|signages?|chairs?|tables?|trophies))\b/i.test(
      lower
    );
  const isTechnical =
    /\b(ccp\d{2,4}|yn[-_\s]?jw|abm[-_\s]?\d|ce53|\d+\s*[x×]\s*\d+|mm\b|thickness|cast\s*acrylic|extruded|rpm|wattage)\b/i.test(
      lower
    );
  const isBrokenOrShortLayman =
    /\b(do\s+your\s+hand|interiora|they\s+sit)\b/i.test(lower) ||
    (rawText.split(/\s+/).length <= 5 && !isTechnical);

  const customerProfile: AcrioCustomerProfileInfo["customerProfile"] = isStudent
    ? "STUDENT_EXPLORER"
    : isBusinessInstitutional
    ? "BUSINESS_INSTITUTIONAL"
    : isTechnical
    ? "TECHNICAL_GRADUATE"
    : isBrokenOrShortLayman
    ? "SIMPLE_LAYMAN"
    : "EVERYDAY_BUYER";

  const langRule =
    languageMode === "HINDI_HINGLISH"
      ? "Reply in simple, natural Hindi/Hinglish (or clear English with Hindi terms) so the customer understands effortlessly."
      : languageMode === "OTHER_FALLBACK"
      ? "The customer does not appear comfortable in English or Hindi; reply in their language alongside simple English."
      : "Reply in clear, simple everyday English (never use other languages unless the customer asks or does not understand English/Hindi).";

  const personaRule =
    customerProfile === "SIMPLE_LAYMAN"
      ? "Customer writes in short or broken phrases: infer their real meaning charitably (e.g. 'they sit, do your hand Acrylic chair' = asking if we have Acrylic Chairs for sitting), use very simple words, and show 2-3 clear options."
      : customerProfile === "STUDENT_EXPLORER"
      ? "Customer is a student: be warm, helpful, and educational without pressuring them for a delivery city or bulk order."
      : customerProfile === "BUSINESS_INSTITUTIONAL"
      ? "Customer is a business/institutional buyer: provide structured itemized numbers, unit price × quantity totals, and practical package options."
      : "Provide a concise, scannable gist with exact specs and prices.";

  return {
    customerProfile,
    languageMode,
    instructionNote: `${langRule} ${personaRule}`,
  };
}

export function normalizeCustomerProductTypos(text: string): string {
  return String(text || "")
    .replace(/\b(?:acylirc|acyrlic|acrilic|acrlic|acrylc|ackrylic|acraylic|acrylik|acralic)\b/gi, "acrylic")
    .replace(/\b(?:poduim|podiym|podiam|podiumn)\b/gi, "podium")
    .replace(/\b(?:pulpet|pulpitt)\b/gi, "pulpit")
    .replace(/\b(?:lectren|lecturn)\b/gi, "lectern")
    .replace(/\b(?:lockr|lokcer|locekr)\b/gi, "locker")
    .replace(/\b(?:trophie|trofy|tropy)\b/gi, "trophy")
    .replace(/\b(?:momento|momentos|momemto|momemtos|mementoes)\b/gi, "memento")
    .replace(/\b(?:locking)\s+for\b/gi, "looking for")
    .replace(/\b(?:enquery|enqury|inquiery)\b/gi, "enquiry")
    .replace(/\b(?:flourocent|fluroscent)\b/gi, "fluorescent")
    .replace(/\b(?:brocher|brochur|brocure)\b/gi, "brochure")
    .replace(/\b(?:catlog|catalouge|catelogue)\b/gi, "catalogue");
}

export function stripBurstMediaPlaceholders(rawText: string): {
  cleanText: string;
  images: number;
  documents: number;
  videos: number;
  audios: number;
  unreadable: number;
  totalMediaPlaceholders: number;
} {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let images = 0;
  let documents = 0;
  let videos = 0;
  let audios = 0;
  let unreadable = 0;
  const textLines: string[] = [];

  for (const line of lines) {
    if (/^\[(?:image|photo|picture|sticker)\b[^\]]*\]$/i.test(line)) {
      images++;
    } else if (/^\[(?:document|pdf|file)\b[^\]]*\]$/i.test(line)) {
      documents++;
    } else if (/^\[(?:video)\b[^\]]*\]$/i.test(line)) {
      videos++;
    } else if (/^\[(?:audio|voice\s*note)\b[^\]]*\]$/i.test(line)) {
      audios++;
    } else if (/^\[(?:message|media|attachment|unsupported)\b[^\]]*\]$/i.test(line)) {
      unreadable++;
    } else {
      const strippedInline = line
        .replace(/\[(?:image|photo|video|document|pdf|file|audio|voice\s*note|sticker|message)\]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (strippedInline) {
        textLines.push(strippedInline);
      }
    }
  }

  return {
    cleanText: textLines.join("\n").trim(),
    images,
    documents,
    videos,
    audios,
    unreadable,
    totalMediaPlaceholders: images + documents + videos + audios + unreadable,
  };
}

export function classifyAcrioInboundIntent(
  rawText: string,
  hasConversationHistory = false
): AcrioIntentClassification {
  const strippedBurst = stripBurstMediaPlaceholders(rawText);
  const effectiveText = normalizeCustomerProductTypos(
    strippedBurst.cleanText || String(rawText || "")
  ).trim();
  const trimmed = effectiveText;
  const lower = trimmed.toLowerCase();

  if (!trimmed) {
    return {
      intent: "GREETING",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Empty or whitespace message",
    };
  }

  const hasDomainProductNoun = ACRIO_DOMAIN_PRODUCT_NOUN_RE.test(lower);

  if (
    /\b(chairperson|chairman|chairwoman|director|directors|founder|ceo|owner|proprietor|managing\s*director|president|marketing\s*(?:head|person|team|manager|contact|department|number|email|executive)|sales\s*(?:head|manager|person|contact|number|email|department)|department\s*(?:wise|contact|contacts|head|heads|people|number|numbers|email|emails|list)|(?:staff|team)\s*(?:details|contacts?|numbers?|emails?|list)|(?:share|send|give)\s*(?:me\s*)?(?:your\s*)?(?:staff|team)\s*(?:details|contacts?|info|numbers?)|contact\s*(?:person|details|number|email)\s*(?:for|of)\s*(?:marketing|sales|machines|dispatch|fabrication|management|chairperson|director)|who\s+(?:is|are)\s+(?:the|your)\s+(?:chairperson|chairman|director|founder|ceo|owner|marketing\s*head|sales\s*head|department\s*heads?))\b/i.test(
      lower
    )
  ) {
    return {
      intent: "LEADERSHIP_CONTACT_INFO",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer asked for chairperson, leadership, marketing, or staff/team contact details",
    };
  }

  if (
    /\b(?:who|whom|which\s*(?:team|person|department|member|specialist)|what\s*(?:team|department))\s+(?:will|would|do|can|are)\s+you\s+(?:connect|transfer|assign|hand\s*over|forward)\b|\b(?:to\s+whom|with\s+whom)\s+(?:will|would|do|can)\s+you\s+connect\b|\b(?:who|whom)\s+(?:handles|takes\s*care\s*of|manages|looks\s*after|is\s+in|is\s+your)\s+(?:this|my\s*chat|custom|orders|sales|support|enquiries|inquiries|team|manager|executive)\b|\b(?:can\s+i\s+know|tell\s+me)\s+(?:who|whom)\s+(?:you\s+will\s+connect|i\s+will\s+(?:talk|speak)\s+(?:to|with))\b|\bhow\s+does\s+(?:the\s+)?(?:handoff|human\s*support|sales\s*team)\s+work\b/i.test(
      lower
    )
  ) {
    return {
      intent: "HUMAN_HANDOFF_INFO",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer asked an informational question about who handles handoffs",
    };
  }

  if (
    !/^(?:who|whom|which\s+team|what\s+team|how\s+does)\b/i.test(lower) &&
    /\b(talk\s*to\s*(?:a\s*|the\s*|your\s*|some\s*)?(?:team|human|person|agent|staff|sales|someone|manager|executive)|speak\s*(?:to|with)\s*(?:a\s*|the\s*|your\s*|some\s*)?(?:team|human|person|agent|staff|sales|someone|manager|executive)|connect\s*(?:me\s*)?(?:now|right\s*away|please)?(?:\s*(?:to|with)\s*(?:a\s*|the\s*|your\s*|some\s*)?(?:team|human|person|agent|staff|sales|someone|manager|executive))?|connect\s*me|yes\s*,?\s*(?:please\s*)?connect\s*me|human\s*agent|real\s*person|call\s*me|can\s+someone\s+call|please\s*call|need\s*a\s*call|want\s*a\s*call|transfer\s*(?:me|chat)\s*to\s*(?:human|sales|team|person)|assign\s*(?:to\s*)?(?:human|sales|team))\b/i.test(
      lower
    ) &&
    !/\bconnect\b/i.test(lower.replace(/\bconnect\s*(?:me|to|with)\b/gi, ""))
  ) {
    return {
      intent: "HUMAN_HANDOFF_REQUEST",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: true,
      reason: "Customer explicitly requested to speak with human sales/support staff",
    };
  }

  if (
    /\b(complaint|damaged|cracked\s*on\s*delivery|broken\s*item|wrong\s*item|refund|cancel\s*my\s*order|dispute|drawing\s*attached|cad\s*file|dxf\s*file|gst\s*mismatch|payment\s*stuck|payment\s*failed)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "SUPPORT_ISSUE",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: true,
      reason: "Customer reported a support, delivery, payment, or CAD file issue requiring human attention",
    };
  }

  if (
    /\b(?:order\s*(?:id|no|number|#)?\s*[:#-]?\s*[a-z0-9-]*\d{3,}|cc-\d+|ce-\d+|track\s+my\s+order|where\s+is\s+my\s+order|order\s+status|status\s+(?:on|of)\s+my\s+order|check\s+my\s+order|update\s+on\s+my\s+order|dispatch\s+status)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "ORDER_STATUS",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: true,
      reason: "Customer asked for order tracking or dispatch status",
    };
  }

  if (
    /\b(chat\s*history|my\s*history|our\s*chat|what\s+did\s+i\s+(?:ask|say)|what\s+have\s+we\s+discussed|summary\s+of\s+(?:our|my)\s+(?:chat|conversation)|you\s+lost\s+(?:the\s*)?context|lost\s+context|forgot\s+(?:the\s*)?context|keep\s+asking\s+(?:the\s*)?same|same\s+city\s+question|asking\s+the\s+same\s+question|excellent\s+reply\s+fool|you\s+are\s+a\s+fool|bad\s+reply|useless\s+bot|i\s+am\s+a\s+student|i'm\s+a\s+student)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "CHAT_HISTORY_META",
      requiresProductLookup: false,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer asked about conversation history, context continuity, repeated questions, or shared persona context",
    };
  }

  if (
    hasConversationHistory &&
    (/^[\s*#]*(?:option\s*|category\s*|number\s*|no\.?\s*)?([1-5])[\s.)*]*$/i.test(trimmed) ||
      /^(?:the\s+)?(first|second|third|fourth|1st|2nd|3rd|4th)\s*(?:one|option|category|model)?[\s.!]*$/i.test(
        trimmed
      ))
  ) {
    return {
      intent: "MENU_SELECTION",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer selected a numbered menu/category/product option from the previous turn",
    };
  }

  if (
    /\b(what\s+(?:all\s+)?(?:sub[-\s]*)?categories|which\s+(?:sub[-\s]*)?categories|all\s+categories\s+under|categories\s+(?:under|in|of)\s+(?:the\s+)?podiums?|types\s+of\s+podiums?\s+categories|podium\s+sub[-\s]*categories)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "CATEGORY_OVERVIEW",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer asked for the sub-categories/types under a product category",
    };
  }

  const qtyMatches = lower.match(/\b\d{1,3}\s*(?:pcs?|pieces?|units?|nos?)?\s*(?:of\s*)?(?:acrylic\s*)?(?:podiums?|pulpits?|lecterns?|signages?|signs?|name\s*plates?|nameplates?|chairs?|stools?|tables?|trophies|awards?|stands?)\b/gi);
  if (
    (qtyMatches && qtyMatches.length >= 2) ||
    (/\b(renovation|office\s+project|complete\s+package|total\s+cost|total\s+price)\b/i.test(lower) &&
      Boolean(qtyMatches && qtyMatches.length >= 1))
  ) {
    return {
      intent: "MULTI_ITEM_PROJECT",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer requested multi-item quantities or project budget totalling",
    };
  }

  if (
    !hasDomainProductNoun &&
    /\b(different\s*(?:query|question|requirement|topic|thing|enquiry|inquiry)|another\s*(?:query|question|requirement|topic|enquiry|inquiry)|something\s*else|forget\s*(?:that|it|previous|the\s*last)|start\s*over|start\s*afresh|change\s*(?:of\s*)?(?:topic|subject)|leave\s*(?:that|it)|never\s*mind(?:\s*(?:that|it))?|new\s*(?:query|question|topic|requirement|enquiry|inquiry))\b/i.test(
      lower
    )
  ) {
    return {
      intent: "TOPIC_RESET",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer explicitly signalled a topic reset or new unspecified query",
    };
  }

  if (
    !hasDomainProductNoun &&
    /\b(who\s+are\s+you|what\s+are\s+you|what\s+is\s+your\s+name|your\s+name|are\s+you\s+(?:a\s+)?(?:bot|ai|human|real\s+person|robot|assistant|automated)|which\s+(?:ai|model|llm)|what\s+(?:ai|model|llm)|what\s+can\s+you\s+(?:do|help\s*(?:me\s*)?with)|how\s+can\s+you\s+help(?:\s+me)?|tell\s+me\s+about\s+yourself|what\s+is\s+acrio|who\s+is\s+acrio)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "IDENTITY_META",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer asked about ACRIO's identity, AI model, or capabilities",
    };
  }

  if (
    /\b(where\s+(?:are\s+you|is\s+your)\s*(?:located|based|factory|office|workshop|shop|company|plant|unit|showroom|from)?|(?:what\s+is|share|send|give|need|want|drop|ping)\s*(?:me\s*|us\s*)?(?:your\s*|the\s*)?(?:location|map\s*location|google\s*map|maps\s*(?:link|url)?|directions?|pin|address|factory\s*address|office\s*address|office\s*location|factory\s*location|company\s*details)|how\s+(?:to|do\s+i)\s+(?:reach|visit|come\s+to)\s+(?:your\s+)?(?:factory|office|shop|unit|showroom)|^\s*(?:map\s*location|location|your\s*location|address|office\s*address|google\s*maps?|directions)\s*\??$|your\s+(?:factory\s+location|office\s+location|company\s+address|working\s+hours|opening\s+hours)|what\s+(?:does|is)\s+classic\s+(?:concepts|edge(?:\s*53)?)(?:\s+do)?|difference\s+between\s+classic\s+concepts\s+and\s+classic\s+edge|tell\s+me\s+about\s+(?:your\s+company|classic\s+concepts|classic\s+edge(?:\s*53)?)|do\s+you\s+(?:ship|deliver)\s+(?:across|all\s+over|pan)\s+india|do\s+you\s+provide\s+gst(?:\s+invoice|\s+bill)?)\b/i.test(
      lower
    ) &&
    !/\b(under|below|above|price\s+of|cost\s+of|buy|order\s+a|looking\s+for\s+a)\b/i.test(lower)
  ) {
    return {
      intent: "COMPANY_INFO",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Customer asked about company, location, timings, shipping, or brand overview",
    };
  }

  if (
    /\b(tried\s+reaching\s+you|rate\s*card|drop\s+samples|turnkey\s+contractors|we\s+are\s+supporting|factory[- ]direct\s+b2b\s+rates|estimation\s+team|when\s+would\s+be\s+a\s+good\s+time\s+to\s+connect|looking\s+to\s+empanel|vendor\s+registration)\b/i.test(
      lower
    ) &&
    !/\b(price\s+of|quote\s+for|looking\s+for\s+(?:a|an|your)|buy|order|podium|pulpit|trophy|memento|polishing\s+machine|bending\s+machine)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "OFF_TOPIC",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Inbound supplier or B2B sales outreach; acknowledge politely without marketing products",
    };
  }

  const looksLikeIntroduction =
    /^(?:hi+|hello+|hey+|hii+|good\s*(?:morning|afternoon|evening))[\s,!.]*(?:sir|madam|mam|there|team)?[\s,!.\n]*(?:this\s+is\b|i\s+am\b|i'?m\b|myself\b|we\s+are\b|classic\s+concepts\s+acrylic)/i.test(
      trimmed
    ) ||
    (/\b(whatsapp\.com\/channel|follow\s+the\s+classic\s+concepts|manufacturers?\s+of\s+acrylic\s+products\s+based\s+in)\b/i.test(
      lower
    ) &&
      trimmed.split(/\s+/).length <= 55);
  const asksBuyingOrProductQuestion =
    /\b(looking\s+for|need\s+(?:a|an|some|\d+)|want\s+(?:to\s+(?:buy|order|enquire|get)|a|an|some)|price|cost|rate|quote|quotation|how\s+much|share\s+(?:options|details|photos|catalogue|catalog)|can\s+you\s+(?:make|supply|provide|share)|ccp\d{2,4}|yn[-_\s]?jw\d{3,4})\b/i.test(
      lower
    );
  if (looksLikeIntroduction && !asksBuyingOrProductQuestion) {
    return {
      intent: "GREETING",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Self-introduction or intro blurb without an active buying enquiry; reply politely without pushing products",
    };
  }

  if (
    /^\s*\+?\d[\d\s()-]{8,16}\s*$/.test(trimmed) ||
    /^\s*check\s+\+?\d[\d\s-]{6,16}\s*$/i.test(trimmed) ||
    /^\s*(?:wrong\s*answer|incorrect\s*answer|that'?s\s*wrong|not\s*correct)\s*[.!]?\s*$/i.test(
      trimmed
    )
  ) {
    return {
      intent: "CONVERSATIONAL_FOLLOWUP",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Phone number callback, lookup guard, or correction note; handle concisely without catalog dump",
    };
  }

  if (
    /^[\s\W]*(hi+|hello+|hey+|hii+|heyy+|good\s*(?:morning|afternoon|evening|day)|namaste|greetings|hi\s+there|hello\s+there|hey\s+there|hi\s+acrio|hello\s+acrio|thanks|thank\s+you|thank\s+you\s+so\s+much|many\s+thanks|ok\s+thanks|okay\s+thanks|can\s+you\s+help(?:\s+me)?)[\s\W]*$/i.test(
      trimmed
    )
  ) {
    return {
      intent: "GREETING",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Greeting or conversational pleasantry",
    };
  }

  if (
    !hasDomainProductNoun &&
    /\b(weather|forecast|cricket|ipl|football|soccer|movie|film|song|lyrics|recipe|biryani|pizza|burger|bitcoin|crypto|stock\s*market|nifty|sensex|python\s*code|javascript|leetcode|math\s*homework|election|minister|politics|tell\s*me\s*a\s*joke|write\s*a\s*poem|horoscope|astrology)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "OFF_TOPIC",
      requiresProductLookup: false,
      allowRollingContextFallback: false,
      needsImmediateHandoff: false,
      reason: "Off-topic message outside acrylic products and fabrication machines",
    };
  }

  if (
    /\b(\d+\s*(?:mm|cm|inch|in|ft)?\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?)\b/i.test(
      lower
    ) ||
    /\b(custom\s*(?:size|dimension|fabrication|box|cover|enclosure)|made\s*to\s*order|as\s*per\s*(?:my\s*)?(?:drawing|size|sketch))\b/i.test(
      lower
    )
  ) {
    return {
      intent: "CUSTOM_QUOTE",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer requested custom fabrication or shared specific dimensions",
    };
  }

  if (
    /\b(compare|comparison|vs\.?|versus|difference\s+between|differ\s+between|which\s+(?:one|of\s+these|of\s+them|model|podium|pulpit|machine)\s+(?:is|has)\s+(?:better|wider|widest|larger|largest|bigger|biggest|taller|tallest|more))\b/i.test(
      lower
    )
  ) {
    return {
      intent: "PRODUCT_COMPARISON",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer asked to compare products or models",
    };
  }

  if (!hasDomainProductNoun && ACRIO_FOLLOW_UP_REFINEMENT_RE.test(lower)) {
    return {
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer refined budget, size, finish, quantity, or pricing on prior product context",
    };
  }

  if (
    hasDomainProductNoun ||
    /\b(stage|auditorium|church|school|classroom|college|university|conference|seminar|hotel|restaurant|cafe|banquet|hospital|clinic|retail|shop|showroom|exhibition|event|ceremony|convocation|wedding|office|reception|counter|cloudy|rough\s*edge|white\s*edge|bubble|crack|warping|scratch|yellow)\b/i.test(
      lower
    )
  ) {
    return {
      intent: "PRODUCT_SEARCH",
      requiresProductLookup: true,
      allowRollingContextFallback: hasConversationHistory && !hasDomainProductNoun,
      needsImmediateHandoff: false,
      reason: "Customer searched for a product, fabrication machine, or venue/application use case",
    };
  }

  if (
    hasConversationHistory &&
    (/\b(yes|yeah|yep|yup|no|nope|sure|ok|okay|fine|go\s*ahead|please\s*share|send\s*(?:links|details|options|photos|images|catalogue|catalog|quote)|show\s*(?:me|them|options|details)|tell\s*me(?:\s*more|\s*about\s*(?:this|it|that))?|what\s+about\s+(?:this|that|it)|is\s+(?:it|this)\s+available|can\s+(?:you|we)\s+(?:customize|customise|print|deliver|ship))\b/i.test(
      lower
    ) ||
      ACRIO_SHORT_CITY_OR_REPLY_RE.test(lower) ||
      /^\s*\d{1,3}\s*(?:pcs?|pieces?|nos?|units?|sets?)?\s*$/i.test(trimmed))
  ) {
    return {
      intent: "FOLLOW_UP_REFINEMENT",
      requiresProductLookup: true,
      allowRollingContextFallback: true,
      needsImmediateHandoff: false,
      reason: "Customer sent a short confirmation, quantity, city, or follow-up reply in the active conversation",
    };
  }

  return {
    intent: hasConversationHistory ? "CONVERSATIONAL_FOLLOWUP" : "GREETING",
    requiresProductLookup: false,
    allowRollingContextFallback: hasConversationHistory,
    needsImmediateHandoff: false,
    reason: "Conversational follow-up or general turn; preserving conversation memory without dumping unrelated products",
  };
}
