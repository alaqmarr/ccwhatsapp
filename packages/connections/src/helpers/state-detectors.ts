import {
  ACRIO_DOMAIN_PRODUCT_NOUN_RE,
  normalizeCustomerProductTypos,
  stripBurstMediaPlaceholders,
} from "./intent-classifier";

export function detectProductFamilyAndQuery(rawText: string): {
  productFamily: string | null;
  primaryProductQuery: string | null;
  activeCategory: string | null;
  activeBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | null;
  itemTypeFilter: "PRODUCT" | "MACHINE" | "CONSUMABLE" | null;
  excludedItemTypes: ("PRODUCT" | "MACHINE" | "CONSUMABLE")[];
  isCorrectionOnly: boolean;
} {
  const cleanedRaw = normalizeCustomerProductTypos(
    stripBurstMediaPlaceholders(rawText).cleanText || String(rawText || "")
  ).trim();
  const lower = cleanedRaw.toLowerCase();

  const excludesConsumables =
    /\b(?:not\s+looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|exclude|excluding|skip)\s+(?:any\s+)?(?:tools?|consumables?|blades?|cutters?|solvents?|accessories)\b|\b(?:just|only)\s+machines?\b/i.test(
      lower
    );
  const excludesMachines =
    /\b(?:not\s+looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|exclude)\s+(?:any\s+)?machines?\b|\b(?:just|only)\s+(?:tools?|consumables?|blades?|cutters?)\b/i.test(
      lower
    );

  const strippedForCheck = lower
    .replace(
      /\b(actually|i\s+said|i\s+am|i'm|im|we\s+are|not\s+looking\s+for|looking\s+for|don'?t\s+want|do\s+not\s+want|no|without|just|only|tools?|consumables?|machines?|please|show\s+me|need|want)\b/gi,
      " "
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const isCorrectionOnly =
    (excludesConsumables || excludesMachines) && strippedForCheck.length === 0;

  if (
    /\b(furniture|interior|interiors|interiora|decor|furnishing|chair|chairs|stool|stools|bar\s*stool|table|tables|desk|desks|console|bench|seating|they\s+sit|for\s+sitting)\b/i.test(
      lower
    ) &&
    !/\b(table\s*top\s*podium|table\s*stand|tent\s*card)\b/i.test(lower)
  ) {
    const wantsChairSpecifically = /\b(chair|chairs|stool|stools|seating|sit|sitting)\b/i.test(lower);
    return {
      productFamily: "furniture",
      primaryProductQuery: wantsChairSpecifically
        ? "acrylic chair bar stool furniture seating"
        : "acrylic furniture table chair stool console interior",
      activeCategory: "Custom Fabrication",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (
    /\b(signage|signages|name\s*plate|name\s*plates|nameplate|nameplates|name\s*board|door\s*sign|directional\s*sign)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "signage",
      primaryProductQuery: `${rawText.trim()} acrylic signage name plate sign holder`,
      activeCategory: "Custom Fabrication",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (
    /\b(gift|gifts|gifting|corporate\s*gift|corporate\s*clients?|souvenir|souvenirs|paper\s*weight|paperweight|pen\s*stand|keychain|keychains)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "corporate_gift",
      primaryProductQuery: `${rawText.trim()} acrylic memento trophy paperweight pen stand keychain coaster tray`,
      activeCategory: "Awards & Trophies",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (
    /\b(pulpit|pulpits|podium|podiums|lectern|lecterns|rostrum|rostrums|ccpo?[-_\s]?\d{2,4}|small\s+classroom|classroom|auditorium|church)\b/i.test(
      lower
    )
  ) {
    const isClassroom = /\b(classroom|school|teacher|compact)\b/i.test(lower);
    return {
      productFamily: "podium",
      primaryProductQuery: isClassroom
        ? "compact essential acrylic podium CCP057S CCP054 classroom"
        : `${rawText.trim()} pulpit podium`,
      activeCategory: "Podiums & Stage",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (/\b(trophy|trophies|memento|mementos|award|awards|plaque|plaques|medal|medals)\b/i.test(lower)) {
    return {
      productFamily: "trophy",
      primaryProductQuery: `${rawText.trim()} acrylic trophy award memento`,
      activeCategory: "Awards & Trophies",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (
    /\b(diamond\s*(?:edge\s*)?polish(?:er|ing)?|edge\s*polish(?:er|ing)?|cloudy\s*edge|rough\s*edge|white\s*edge)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "polishing_machine",
      primaryProductQuery: `${rawText.trim()} diamond edge polishing machine`,
      activeCategory: "Acrylic Machines (CE53)",
      activeBrand: "CLASSIC_EDGE_53",
      itemTypeFilter: excludesMachines ? "CONSUMABLE" : "MACHINE",
      excludedItemTypes: excludesConsumables ? ["CONSUMABLE"] : [],
      isCorrectionOnly: false,
    };
  }

  if (/\b(bender|bending\s*(?:machine|heater)?|strip\s*heater|line\s*bending)\b/i.test(lower)) {
    return {
      productFamily: "bending_machine",
      primaryProductQuery: `${rawText.trim()} acrylic bending machine heater`,
      activeCategory: "Acrylic Machines (CE53)",
      activeBrand: "CLASSIC_EDGE_53",
      itemTypeFilter: excludesMachines ? "CONSUMABLE" : "MACHINE",
      excludedItemTypes: excludesConsumables ? ["CONSUMABLE"] : [],
      isCorrectionOnly: false,
    };
  }

  if (
    !excludesConsumables &&
    !/\b(machine|machines)\b/i.test(lower) &&
    /\b(blade|blades|cutter|cutters|router\s*bit|router\s*bits|carbide|collet|collect|consumable|consumables|solvent|chloroform|glue|adhesive|buffing|accessor(?:y|ies)|add[-\s]?ons?|hinge|hinges|camlock|camlocks|standoff|standoffs|spacer|spacers|knob|knobs|handle|handles|latch|latches|catch|catches|hasp|staple|screw|screws|bolt|nut|washer|bracket|brackets|ball|balls|sphere|turntable|rotating\s*disc|photo\s*magnet|radeon|glitter\s*sheet|mirror\s*sheet|metallic\s*sheet)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "consumable",
      primaryProductQuery: rawText.trim(),
      activeCategory: "Acrylic Machines (CE53)",
      activeBrand: "CLASSIC_EDGE_53",
      itemTypeFilter: "CONSUMABLE",
      excludedItemTypes: excludesMachines ? ["MACHINE"] : [],
      isCorrectionOnly: false,
    };
  }

  if (
    /\b(machine|machines|laser|router|cnc|polisher|polishing|thermoforming|oven|chiller|compressor|yn-|ce53|cw[-_\s]?\d{3,5}|f[-_\s]?(?:308|500)|sd[-_\s]?\d{3,4}|jw[-_\s]?\d{3,4}|zd[-_\s]?\d{3,4}|classic\s*edge)\b/i.test(
      lower
    )
  ) {
    return {
      productFamily: "machine",
      primaryProductQuery: isCorrectionOnly ? null : rawText.trim(),
      activeCategory: "Acrylic Machines (CE53)",
      activeBrand: "CLASSIC_EDGE_53",
      itemTypeFilter: excludesMachines ? "CONSUMABLE" : "MACHINE",
      excludedItemTypes: excludesConsumables ? ["CONSUMABLE"] : [],
      isCorrectionOnly,
    };
  }

  if (/\b(menu|qr\s*stand|tent\s*card|table\s*stand|sign\s*holder|brochure|leaflet|pamphlet)\b/i.test(lower)) {
    return {
      productFamily: "stand",
      primaryProductQuery: rawText.trim(),
      activeCategory: "Hotel & Banquet",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (/\b(tray|trays|coaster|coasters|tissue|napkin)\b/i.test(lower)) {
    return {
      productFamily: "tray_hospitality",
      primaryProductQuery: rawText.trim(),
      activeCategory: "Hotel & Banquet",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  if (
    /\b(box|boxes|case|cases|cover|covers|enclosure|enclosures|guard|guards|display\s*stand|riser|risers|cabinet|cabinets|locker|lockers|mobile\s*locker|phone\s*locker|cell\s*phone|mobile|mobiles|phone|phones|tablet|tablets|compartment|compartments|pigeon\s*hole|organizer|organiser|rack|racks|shelf|shelves|caddy|counter|counters|partition|partitions|shield|shields|sneeze\s*guard|key\s*box|key\s*cabinet|medicine\s*box|first\s*aid\s*box|showcase|frame|frames|sheet|rod|tube|donation|suggestion\s*box|ballot|cake\s*stand|cosmetic|makeup|jewelry|jewellery|watch\s*stand|eyewear|mobile\s*stand|laptop\s*stand|book\s*stand|quran|rehal|bible)\b/i.test(
      lower
    )
  ) {
    const nounMatch = lower.match(ACRIO_DOMAIN_PRODUCT_NOUN_RE);
    return {
      productFamily: nounMatch ? nounMatch[1].toLowerCase() : "custom_display",
      primaryProductQuery: cleanedRaw || rawText.trim(),
      activeCategory: "Custom Fabrication",
      activeBrand: "CLASSIC_CONCEPTS",
      itemTypeFilter: "PRODUCT",
      excludedItemTypes: [],
      isCorrectionOnly: false,
    };
  }

  return {
    productFamily: null,
    primaryProductQuery: null,
    activeCategory: null,
    activeBrand: null,
    itemTypeFilter: excludesConsumables ? "MACHINE" : excludesMachines ? "CONSUMABLE" : null,
    excludedItemTypes: excludesConsumables
      ? ["CONSUMABLE"]
      : excludesMachines
      ? ["MACHINE"]
      : [],
    isCorrectionOnly,
  };
}

export function extractPreferencesFromTurn(rawText: string): string[] {
  const lower = String(rawText || "").toLowerCase();
  const prefs: string[] = [];
  if (/\b(most\s*premium|premium|high\s*end|flagship|top\s*end|best|luxury|heavy\s*duty|costliest|most\s*expensive)\b/i.test(lower)) {
    prefs.push("premium");
  }
  if (/\b(cheapest|lowest\s*price|least\s*expensive|cheaper|smaller\s*top|save\s*more|sasta|sabse\s*sasta)\b/i.test(lower)) {
    prefs.push("cheapest");
  }
  if (/\b(transparent|clear|crystal\s*clear|see\s*through)\b/i.test(lower)) {
    prefs.push("transparent");
  }
  if (/\b(frosted|matte|satin)\b/i.test(lower)) {
    prefs.push("frosted");
  }
  if (/\b(black|white|gold|silver|colored|coloured|tinted)\b/i.test(lower)) {
    const m = lower.match(/\b(black|white|gold|silver|colored|coloured|tinted)\b/i);
    if (m) prefs.push(m[1].toLowerCase());
  }
  if (/\b(led|light|backlit|illuminated)\b/i.test(lower)) {
    prefs.push("led");
  }
  if (/\b(logo|branding|print|engraving|uv\s*print)\b/i.test(lower)) {
    prefs.push("logo");
  }
  if (/\b(wheel|wheeled|castor|portable|foldable|compact|wide|tall)\b/i.test(lower)) {
    const m = lower.match(/\b(wheel|wheeled|castor|portable|foldable|compact|wide|tall)\b/i);
    if (m) prefs.push(m[1].toLowerCase());
  }
  return prefs;
}

export function extractMetadataFromTurn(rawText: string): {
  applicationContext: string | null;
  dimensionsOrThickness: string | null;
  quantity: string | null;
} {
  const lower = String(rawText || "").toLowerCase();
  const appMatch = lower.match(
    /\b(church|school|classroom|college|university|auditorium|conference|seminar|hotel|restaurant|cafe|banquet|hospital|clinic|retail|showroom|exhibition|event|ceremony|convocation|wedding|office|reception)\b/i
  );
  const dimMatch =
    rawText.match(
      /\b(\d+\s*(?:mm|cm|inch|in|ft)?\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?(?:\s*x\s*\d+\s*(?:mm|cm|inch|in|ft)?)?)\b/i
    ) || rawText.match(/\b(\d+(?:\.\d+)?\s*(?:mm|cm|inch|in|ft))\b/i);
  const qtyMatch = rawText.match(/\b(\d+\s*(?:pcs|pieces|nos|units|sets|qty))\b/i);

  return {
    applicationContext: appMatch ? appMatch[1].toLowerCase() : null,
    dimensionsOrThickness: dimMatch ? dimMatch[1].trim() : null,
    quantity: qtyMatch ? qtyMatch[1].trim() : null,
  };
}
