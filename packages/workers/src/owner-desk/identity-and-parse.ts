import { normalizeWhatsAppPhone, type InternalStaffCallerProfile } from "@cc/database";
import { ownerDisplayName, suffix10, type LeadItemKind, type ParsedAssignCommand } from "./types";

const DEFAULT_OWNER_NUMBERS = ["919849050752", "9618443558"];

export function getOwnerWhatsAppNumbers(): string[] {
  const raw = String(process.env.OWNER_WHATSAPP_NUMBERS || "").trim();
  const list = raw
    ? raw.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean)
    : DEFAULT_OWNER_NUMBERS;
  return list.length > 0 ? list : DEFAULT_OWNER_NUMBERS;
}

export function isOwnerWhatsAppPhone(rawPhone: string): boolean {
  const s = suffix10(rawPhone);
  if (s.length < 10) return false;
  return getOwnerWhatsAppNumbers().some((n) => suffix10(n) === s);
}

/** Profile used when the owner's number is not linked to a hub login. */
export function buildOwnerStaffProfile(rawPhone: string): InternalStaffCallerProfile {
  const name = ownerDisplayName();
  return {
    isInternalStaff: true,
    hubUserId: null,
    name,
    firstName: name.split(/\s+/)[0] || name,
    role: "SUPERADMIN",
    position: "Owner",
    department: "Management",
    phone: normalizeWhatsAppPhone(rawPhone) || rawPhone,
    email: null,
    matchedFrom: "CC_OFFICIAL_TEAM",
  };
}

const GENERIC_TARGETS = new Set([
  "staff",
  "someone",
  "somebody",
  "anyone",
  "anybody",
  "any",
  "any one",
  "any staff",
  "any sales",
  "team",
  "sales",
  "sales team",
  "sales staff",
  "available",
  "free",
  "free staff",
  "anyone from sales",
  "anyone from the sales team",
  "someone from sales",
  "all",
]);

const NAME = String(String.raw`@?[A-Za-z][A-Za-z.'-]{1,24}(?:\s+[A-Za-z][A-Za-z.'-]{1,24})?`);
const GENERIC_PHRASE = String.raw`(?:any|some)(?:one|body)\s+(?:from|in)\s+(?:the\s+)?sales(?:\s+(?:team|staff))?`;
const FILLER = String.raw`(?:kar|kardo|karo|kr|kijiye|karna|ji|sir|mam|madam|bhai|please|pls|plz)\b`;

const ASSIGN_SEGMENT_RE = new RegExp(
  String.raw`^\s*(?:(?:please|pls|plz|kindly|hey|hi|sir)[\s,]+)*` +
    String.raw`(?:(${NAME})\s+ko\s+)?` +
    String.raw`(assign|allot|forward|fwd|send|pass|give)` +
    String.raw`(?:\s+(?:this|it|that|the|a|my))?` +
    String.raw`(?:\s+(?:new\s+)?(?:lead|enquiry|inquiry|query|customer|client|message|msg))?` +
    String.raw`(?:\s+(?:to|2|ko))?` +
    String.raw`(?:\s+(?!${FILLER})(${GENERIC_PHRASE}|${NAME}))?` +
    String.raw`(?:\s+(?:ji|sir|mam|madam|bhai|please|pls|plz))*` +
    String.raw`(?:\s+(?:kar\s*do|kardo|karo|kr\s*do|kijiye|karna))?` +
    String.raw`\s*[.!]*\s*$`,
  "i"
);

function cleanTarget(raw: string | undefined): string {
  return String(raw || "")
    .replace(/^@+/, "")
    .replace(/\b(?:ji|sir|mam|madam|bhai|please|pls|plz)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function matchSegment(segment: string): { target: string; verb: string } | null {
  const m = ASSIGN_SEGMENT_RE.exec(segment);
  if (!m) return null;
  const verb = String(m[2] || "").toLowerCase();
  const target = cleanTarget(m[1] || m[3]);
  // Only "assign" and "allot" may be used without naming someone. "send it" or "give me" are too common.
  if (!/^(assign|allot)$/.test(verb)) {
    if (!target) return null;
    // "send this to @Rahul" needs a clear pointer to a person. "give me details" must never match.
    if (!/\b(?:to|2|ko)\b|@/i.test(segment)) return null;
  }
  return { target, verb };
}

export function parseAssignCommand(rawText: string): ParsedAssignCommand {
  const text = String(rawText || "").replace(/\r/g, "").trim();
  const none: ParsedAssignCommand = { found: false, targetQuery: "", generic: false, verb: "", leadText: text };
  if (!text) return none;

  const lines = text.split("\n");
  const attempts: Array<{ index: number; sentence?: { before: string; command: string } }> = [];

  // 1. A whole line is the command: check the last line, then the first line.
  const lastIdx = lines.length - 1;
  attempts.push({ index: lastIdx });
  if (lastIdx > 0) attempts.push({ index: 0 });

  for (const attempt of attempts) {
    const line = lines[attempt.index].trim();
    const hit = line.length <= 90 ? matchSegment(line) : null;
    if (hit) {
      const rest = lines.filter((_, i) => i !== attempt.index).join("\n").trim();
      return finish(hit, rest);
    }
  }

  // 2. The command is the closing sentence of the last line: "Need 5 podiums. Please assign to @Rahul"
  const last = lines[lastIdx].trim();
  const parts = last.split(/(?<=[.!?])\s+/);
  if (parts.length > 1) {
    const closing = parts[parts.length - 1];
    const hit = closing.length <= 90 ? matchSegment(closing) : null;
    if (hit) {
      const before = [...lines.slice(0, lastIdx), parts.slice(0, -1).join(" ")].join("\n").trim();
      return finish(hit, before);
    }
  }

  // 3. The command is the opening sentence of the first line: "Please assign to @Rahul. Need 5 podiums"
  const first = lines[0].trim();
  const firstParts = first.split(/(?<=[.!?])\s+/);
  if (firstParts.length > 1) {
    const opening = firstParts[0];
    const hit = opening.length <= 90 ? matchSegment(opening) : null;
    if (hit) {
      const after = [firstParts.slice(1).join(" "), ...lines.slice(1)].join("\n").trim();
      return finish(hit, after);
    }
  }

  return none;

  function finish(hit: { target: string; verb: string }, rest: string): ParsedAssignCommand {
    const lowerTarget = hit.target.toLowerCase();
    const generic =
      !hit.target ||
      GENERIC_TARGETS.has(lowerTarget) ||
      /^(?:any|some)(?:one|body)\s+(?:from|in)\s+(?:the\s+)?sales(?:\s+(?:team|staff))?$/.test(lowerTarget);
    return {
      found: true,
      targetQuery: generic ? "" : hit.target,
      generic,
      verb: hit.verb,
      leadText: rest,
    };
  }
}

export function extractCustomerHints(text: string, excludeSuffixes: string[]): { name: string; phone: string } {
  let phone = "";
  const phoneRe = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/g;
  for (const m of text.matchAll(phoneRe)) {
    const s = suffix10(m[0]);
    if (s.length === 10 && !excludeSuffixes.includes(s)) {
      phone = `+91${s}`;
      break;
    }
  }
  let name = "";
  const nameMatch = text.match(
    /(?:customer\s*name|client\s*name|name|customer|client|contact|party|from)\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{1,40})/i
  );
  if (nameMatch) {
    name = nameMatch[1].split(/\n|,|\bph(?:one)?\b|\bmob/i)[0].trim().slice(0, 40);
  }
  return { name, phone };
}

export const MEDIA_PLACEHOLDER_RE = /^\[(?:image|document|video|voice note|audio|message)[^\]]*\](?:\s+.*)?$/i;

export const KIND_LABEL: Record<LeadItemKind, [string, string]> = {
  TEXT: ["message", "messages"],
  IMAGE: ["image", "images"],
  AUDIO: ["voice note", "voice notes"],
  VIDEO: ["video", "videos"],
  DOCUMENT: ["document", "documents"],
};
