import crypto from "node:crypto";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  computePerformanceRankedStaff,
  createCallDispatchItem,
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  normalizeWhatsAppPhone,
  resolveStaffMemberByQuery,
  upsertSyncedContact,
  type InternalStaffCallerProfile,
} from "@cc/database";
import {
  prepareInboundMediaForForward,
  sendStaffClientAssignmentTemplate,
  sendWhatsAppCloudMessage,
} from "@cc/connections";
import { socketHub } from "@cc/sockets";
import { createNotification } from "./staff-notes";

/**
 * OWNER DESK + LEAD FORWARDING OVER WHATSAPP
 *
 * 1. The owner (Hussain sir) messages the business number from his own phone, pastes or forwards an
 *    enquiry, then says "please assign to @Rahul" or just "please assign".
 * 2. The lead is saved, assigned, and sent to the staff member on WhatsApp.
 * 3. Staff keep their chat unlocked by sending "hi" each morning. If a staff chat is locked, an approved
 *    template is sent and the full lead is delivered as soon as the staff member replies.
 * 4. The owner also gets read-only commands that cover what an admin or superadmin can check.
 */

const TZ = "Asia/Kolkata";

const DEFAULT_OWNER_NUMBERS = ["919849050752", "9618443558"];

export function getOwnerWhatsAppNumbers(): string[] {
  const raw = String(process.env.OWNER_WHATSAPP_NUMBERS || "").trim();
  const list = raw
    ? raw.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean)
    : DEFAULT_OWNER_NUMBERS;
  return list.length > 0 ? list : DEFAULT_OWNER_NUMBERS;
}

function suffix10(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function isOwnerWhatsAppPhone(rawPhone: string): boolean {
  const s = suffix10(rawPhone);
  if (s.length < 10) return false;
  return getOwnerWhatsAppNumbers().some((n) => suffix10(n) === s);
}

function ownerDisplayName(): string {
  return String(process.env.OWNER_DISPLAY_NAME || "Hussain sir").trim() || "Hussain sir";
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

// ---------------------------------------------------------------------------
// Parsing the "please assign" command
// ---------------------------------------------------------------------------

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

export interface ParsedAssignCommand {
  found: boolean;
  /** Raw staff text after the word "to", without the @ sign. Empty when the owner did not name anyone. */
  targetQuery: string;
  /** True when the owner said "staff", "someone", "sales team" or named nobody. */
  generic: boolean;
  verb: string;
  /** The enquiry text that came with the command (may be empty). */
  leadText: string;
}

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

function extractCustomerHints(text: string, excludeSuffixes: string[]): { name: string; phone: string } {
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

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

interface DeskStaff {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  phone: string;
  suffix: string;
}

async function loadDeskStaff(): Promise<DeskStaff[]> {
  const auth = getRawLibSqlClient("core_auth");
  const res = await auth.execute(
    `SELECT id, name, email, role, department, whatsapp_number
     FROM users WHERE status = 'ACTIVE' AND role != 'CLIENT' ORDER BY name ASC`
  );
  return res.rows.map((r) => {
    const phone = normalizeWhatsAppPhone(String(r.whatsapp_number || "")) || "";
    return {
      id: String(r.id),
      name: String(r.name || "").trim(),
      email: String(r.email || "").trim(),
      role: String(r.role || "STAFF"),
      department: String(r.department || "Sales & Support"),
      phone,
      suffix: suffix10(phone),
    };
  });
}

interface WindowState {
  open: boolean;
  until: string | null;
  conversationId: string | null;
}

async function loadWindowStates(staff: DeskStaff[]): Promise<Map<string, WindowState>> {
  const out = new Map<string, WindowState>();
  const phones = staff.map((s) => s.phone).filter(Boolean);
  if (phones.length === 0) return out;
  const conv = getRawLibSqlClient("conversations");
  const res = await conv.execute({
    sql: `SELECT id, customer_phone, window_expires_at FROM conversations
          WHERE customer_phone IN (${phones.map(() => "?").join(",")})`,
    args: phones,
  });
  const now = Date.now();
  for (const r of res.rows) {
    const exp = r.window_expires_at ? new Date(String(r.window_expires_at)).getTime() : 0;
    out.set(suffix10(String(r.customer_phone)), {
      open: exp > now,
      until: exp > now ? new Date(exp).toISOString() : null,
      conversationId: String(r.id),
    });
  }
  return out;
}

function windowFor(map: Map<string, WindowState>, s: DeskStaff): WindowState {
  return map.get(s.suffix) || { open: false, until: null, conversationId: null };
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "n/a";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "n/a";
  return formatInTimeZone(d, TZ, "d MMM, h:mm a");
}

function todayStartIso(): string {
  const z = toZonedTime(new Date(), TZ);
  z.setHours(0, 0, 0, 0);
  return fromZonedTime(z, TZ).toISOString();
}

let leadTableReady: Promise<void> | null = null;
function ensureLeadForwardsTable(): Promise<void> {
  if (!leadTableReady) {
    leadTableReady = (async () => {
      await ensureDatabasesBootstrapped();
      const conv = getRawLibSqlClient("conversations");
      await conv.execute(`CREATE TABLE IF NOT EXISTS lead_forwards (
        id TEXT PRIMARY KEY,
        owner_phone TEXT NOT NULL DEFAULT '',
        owner_name TEXT NOT NULL DEFAULT '',
        staff_id TEXT NOT NULL,
        staff_name TEXT NOT NULL,
        staff_phone TEXT NOT NULL DEFAULT '',
        lead_text TEXT NOT NULL,
        customer_name TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        call_queue_id TEXT,
        assignment_mode TEXT NOT NULL DEFAULT 'NAMED',
        delivery_status TEXT NOT NULL DEFAULT 'PENDING_WINDOW',
        delivery_note TEXT NOT NULL DEFAULT '',
        media_json TEXT NOT NULL DEFAULT '[]',
        delivered_at TEXT,
        created_at TEXT NOT NULL
      )`);
      // Older copies of the table (created before attachments were supported) get the new column.
      await conv.execute(`ALTER TABLE lead_forwards ADD COLUMN media_json TEXT NOT NULL DEFAULT '[]'`).catch(() => {});
      await conv.execute(
        `CREATE INDEX IF NOT EXISTS idx_lead_fw_staff ON lead_forwards (staff_id, delivery_status, created_at DESC)`
      );
      await conv.execute(
        `CREATE INDEX IF NOT EXISTS idx_lead_fw_owner ON lead_forwards (owner_phone, created_at DESC)`
      );
    })().catch((err) => {
      leadTableReady = null;
      throw err;
    });
  }
  return leadTableReady;
}

/** Test helper: lets a test remove its own rows without touching other data. */
export async function deleteLeadForwardsForTest(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await ensureLeadForwardsTable();
  await getRawLibSqlClient("conversations").execute({
    sql: `DELETE FROM lead_forwards WHERE id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
}

// ---------------------------------------------------------------------------
// Lead text collection
// ---------------------------------------------------------------------------

const MEDIA_PLACEHOLDER_RE = /^\[(?:image|document|video|voice note|audio|message)[^\]]*\](?:\s+.*)?$/i;

export type LeadItemKind = "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";

/** One thing the owner sent for a lead: a written message, a voice note, a photo, a video or a file. */
export interface LeadItem {
  kind: LeadItemKind;
  /** Written words only (message text, or the caption of a file). Never a bare "[Image]" placeholder. */
  text: string;
  /** WhatsApp media id of the file the owner sent. */
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  at: number;
}

function rowToLeadItem(r: Record<string, unknown>): LeadItem | null {
  const rawKind = String(r.message_type || "TEXT").toUpperCase();
  const kind: LeadItemKind =
    rawKind === "IMAGE" || rawKind === "AUDIO" || rawKind === "VIDEO" || rawKind === "DOCUMENT" ? rawKind : "TEXT";

  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(String(r.metadata_json || "{}"));
  } catch {
    meta = {};
  }
  const media = (meta.media && typeof meta.media === "object" ? meta.media : {}) as Record<string, unknown>;
  const mediaId = String(media.mediaId || media.media_id || meta.mediaId || meta.media_id || "").trim();

  let text = String(r.body || "").trim();
  // The owner's command line ("please assign to ...") is not part of the enquiry.
  const cmd = parseAssignCommand(text);
  if (cmd.found) text = cmd.leadText.trim();
  if (kind !== "TEXT" && MEDIA_PLACEHOLDER_RE.test(text)) text = "";

  const at = new Date(String(r.created_at)).getTime() || Date.now();
  if (kind === "TEXT") {
    return text ? { kind, text, at } : null;
  }
  return {
    kind,
    text,
    mediaId: mediaId || undefined,
    mimeType: String(media.mimeType || media.mime_type || meta.mimeType || meta.mime_type || "").trim() || undefined,
    fileName: String(media.filename || meta.filename || "").trim() || undefined,
    at,
  };
}

const LEAD_ROW_SQL = `SELECT body, message_type, metadata_json, direction, created_at FROM messages`;

/**
 * Gathers everything the owner sent for ONE client: text, voice notes, photos, videos and files, in the order they were
 * sent. A swipe-reply picks exactly that one message. Otherwise everything the owner sent since the last forwarded lead
 * (within 30 minutes, with no gap longer than 10 minutes) belongs to this lead. The command message itself is included
 * when it carries a file, so "image + caption + please assign" works.
 */
async function collectLeadItems(p: {
  conversationId: string;
  ownerPhone: string;
  replyToWaMessageId?: string;
}): Promise<LeadItem[]> {
  const conv = getRawLibSqlClient("conversations");

  if (p.replyToWaMessageId) {
    const q = await conv
      .execute({ sql: `${LEAD_ROW_SQL} WHERE wa_message_id = ? LIMIT 1`, args: [p.replyToWaMessageId] })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const row = q.rows[0];
    if (row && String(row.direction) === "INBOUND") {
      const item = rowToLeadItem(row);
      if (item) return [item];
    }
  }

  const lastFwd = await conv
    .execute({
      sql: `SELECT created_at FROM lead_forwards WHERE owner_phone = ? ORDER BY created_at DESC LIMIT 1`,
      args: [normalizeWhatsAppPhone(p.ownerPhone) || p.ownerPhone],
    })
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const sinceForward = lastFwd.rows[0] ? String(lastFwd.rows[0].created_at) : "";
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const floor = sinceForward > thirtyMinAgo ? sinceForward : thirtyMinAgo;

  const recent = await conv.execute({
    sql: `${LEAD_ROW_SQL} WHERE conversation_id = ? AND direction = 'INBOUND' AND created_at > ?
          ORDER BY created_at DESC LIMIT 25`,
    args: [p.conversationId, floor],
  });

  const kept: LeadItem[] = [];
  for (const r of recent.rows) {
    const item = rowToLeadItem(r);
    if (!item) continue;
    const prev = kept[kept.length - 1];
    if (prev && prev.at - item.at > 10 * 60 * 1000) break;
    kept.push(item);
    if (kept.length >= 12) break;
  }
  return kept.reverse();
}

const KIND_LABEL: Record<LeadItemKind, [string, string]> = {
  TEXT: ["message", "messages"],
  IMAGE: ["image", "images"],
  AUDIO: ["voice note", "voice notes"],
  VIDEO: ["video", "videos"],
  DOCUMENT: ["document", "documents"],
};

function describeAttachments(items: LeadItem[]): string {
  const counts = new Map<LeadItemKind, number>();
  for (const it of items) if (it.kind !== "TEXT") counts.set(it.kind, (counts.get(it.kind) || 0) + 1);
  return [...counts.entries()]
    .map(([k, n]) => `${n} ${KIND_LABEL[k][n === 1 ? 0 : 1]}`)
    .join(", ");
}

function leadTextOf(items: LeadItem[]): string {
  return items
    .filter((i) => i.kind === "TEXT")
    .map((i) => i.text)
    .join("\n\n")
    .slice(0, 3500);
}

// ---------------------------------------------------------------------------
// Delivery to staff
// ---------------------------------------------------------------------------

export type LogAssignmentFn = (p: {
  conversationId: string;
  customerPhone?: string;
  customerName?: string;
  fromStaffId?: string | null;
  fromStaffName?: string | null;
  fromTeamName?: string | null;
  toStaffId: string | null;
  toStaffName: string;
  toTeamId?: string | null;
  toTeamName: string;
  escalationLevel?: string;
  assignmentSource: "MANUAL_ASSIGN";
  assignedByName: string;
  reason?: string;
  assignedAt?: string;
}) => Promise<unknown>;

function buildStaffLeadMessage(p: {
  staffFirstName: string;
  ownerName: string;
  leadText: string;
  attachmentSummary: string;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  hubLink?: string;
}): string {
  const lines: string[] = [];
  lines.push(`*New lead from ${p.ownerName}*`);
  lines.push("");
  lines.push(`Hi ${p.staffFirstName}, please follow up on this enquiry.`);
  lines.push("");
  lines.push("*Enquiry*");
  lines.push(
    p.leadText.trim() ||
      (p.attachmentSummary ? "(No written description. Please see the attachments below.)" : "(No text came with this lead.)")
  );
  if (p.attachmentSummary) {
    lines.push("");
    lines.push(`*Attachments:* ${p.attachmentSummary}. They follow right below, in the order ${p.ownerName} sent them.`);
  }
  if (p.customerName || p.customerPhone) {
    lines.push("");
    if (p.customerName) lines.push(`*Customer:* ${p.customerName}`);
    if (p.customerPhone) lines.push(`*Phone:* ${p.customerPhone}`);
  }
  lines.push("");
  lines.push(`Assigned by ${p.ownerName} at ${fmtTime(p.createdAt)}.`);
  if (p.hubLink) lines.push(`Open in hub: ${p.hubLink}`);
  lines.push("Reply *my leads* to see every lead forwarded to you.");
  return lines.join("\n");
}

async function recordDeskMessage(
  conversationId: string,
  body: string,
  waMessageId: string,
  status: string,
  attachment?: { kind: LeadItemKind; mediaId?: string; mimeType?: string; fileName?: string; caption?: string }
) {
  const conv = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();
  const type = attachment && attachment.kind !== "TEXT" ? attachment.kind : "TEXT";
  const meta =
    attachment && attachment.kind !== "TEXT" && attachment.mediaId
      ? {
          media: {
            mediaId: attachment.mediaId,
            media_id: attachment.mediaId,
            mimeType: attachment.mimeType || "",
            mime_type: attachment.mimeType || "",
            filename: attachment.fileName,
            caption: attachment.caption,
            downloadUrl: `/api/media/${attachment.mediaId}`,
            download_url: `/api/media/${attachment.mediaId}`,
          },
        }
      : {};
  await conv
    .execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'ACRIO', 'ACRIO • Lead Desk', ?, 'FREE_CHAT', ?, ?, ?, ?, ?)`,
      args: [
        `msg_lead_${crypto.randomUUID().slice(0, 8)}`,
        conversationId,
        type,
        body,
        JSON.stringify(meta),
        waMessageId,
        status,
        nowIso,
      ],
    })
    .catch(() => {});
  await conv
    .execute({
      sql: `UPDATE conversations SET last_message_preview = ?, last_message_at = ?, waiting_since = NULL WHERE id = ?`,
      args: [body.slice(0, 140), nowIso, conversationId],
    })
    .catch(() => {});
  socketHub.emit("message:new", { conversationId, senderName: "ACRIO • Lead Desk", text: body });
}

/** Sends the lead as normal chat text inside an open 24 hour window. */
async function sendLeadInsideWindow(staffPhone: string, conversationId: string, body: string) {
  const res = await sendWhatsAppCloudMessage({
    toPhone: staffPhone,
    bodyText: body,
    simulateAsyncDelivery: true,
  }).catch(() => ({ ok: false, waMessageId: "", deliveryStatus: "FAILED", error: "send failed" }));
  if (res.ok) {
    await recordDeskMessage(conversationId, body, res.waMessageId || "", res.deliveryStatus || "SENT");
  }
  return res;
}

/** Forwards each voice note, photo, video or file to the staff member, one by one, in the order they were sent. */
async function sendLeadAttachments(
  staffPhone: string,
  conversationId: string,
  items: LeadItem[],
  ownerName: string
): Promise<{ sent: number; failed: string[] }> {
  const media = items.filter((i): i is LeadItem & { kind: Exclude<LeadItemKind, "TEXT"> } => i.kind !== "TEXT");
  const failed: string[] = [];
  let sent = 0;
  const seen = new Map<LeadItemKind, number>();
  for (const it of media) {
    const n = (seen.get(it.kind) || 0) + 1;
    seen.set(it.kind, n);
    const label = `${KIND_LABEL[it.kind][0]} ${n}`;
    const prep = await prepareInboundMediaForForward({
      mediaId: it.mediaId || "",
      mimeType: it.mimeType,
      fileName: it.fileName,
      kind: it.kind,
    }).catch((err) => ({ ok: false as const, waMediaId: undefined, mimeType: undefined, error: String(err?.message || err) }));
    if (!prep.ok || !prep.waMediaId) {
      failed.push(`${label}${prep.error ? ` (${prep.error})` : ""}`);
      continue;
    }
    const caption = it.kind === "AUDIO" ? "" : it.text || `From ${ownerName}: ${label}`;
    const res = await sendWhatsAppCloudMessage({
      toPhone: staffPhone,
      bodyText: caption || label,
      media: {
        type: it.kind,
        waMediaId: prep.waMediaId,
        caption: caption || undefined,
        fileName: it.fileName,
        mimeType: prep.mimeType,
      },
      simulateAsyncDelivery: true,
    }).catch(() => ({ ok: false, waMessageId: "", deliveryStatus: "FAILED", error: "send failed" }));
    if (!res.ok) {
      failed.push(`${label} (${res.error || "WhatsApp would not accept it"})`);
      continue;
    }
    sent += 1;
    await recordDeskMessage(
      conversationId,
      caption || `[${KIND_LABEL[it.kind][0]}]`,
      res.waMessageId || "",
      res.deliveryStatus || "SENT",
      { kind: it.kind, mediaId: it.mediaId, mimeType: prep.mimeType, fileName: it.fileName, caption: caption || undefined }
    );
  }
  return { sent, failed };
}

/** Text first, then every attachment, then a short note if anything could not be forwarded. */
async function deliverLeadBundle(p: {
  staffPhone: string;
  conversationId: string;
  staffFirstName: string;
  ownerName: string;
  leadText: string;
  items: LeadItem[];
  customerName: string;
  customerPhone: string;
  createdAt: string;
  hubLink?: string;
}): Promise<{ ok: boolean; error?: string; attachmentsSent: number; attachmentsFailed: string[] }> {
  const body = buildStaffLeadMessage({
    staffFirstName: p.staffFirstName,
    ownerName: p.ownerName,
    leadText: p.leadText,
    attachmentSummary: describeAttachments(p.items),
    customerName: p.customerName,
    customerPhone: p.customerPhone,
    createdAt: p.createdAt,
    hubLink: p.hubLink,
  });
  const first = await sendLeadInsideWindow(p.staffPhone, p.conversationId, body);
  if (!first.ok) return { ok: false, error: first.error, attachmentsSent: 0, attachmentsFailed: [] };

  const att = await sendLeadAttachments(p.staffPhone, p.conversationId, p.items, p.ownerName);
  if (att.failed.length > 0) {
    await sendLeadInsideWindow(
      p.staffPhone,
      p.conversationId,
      `Note: I could not forward ${att.failed.length === 1 ? "one attachment" : `${att.failed.length} attachments`} (${att.failed.join(", ")}). Please ask ${p.ownerName} to send ${att.failed.length === 1 ? "it" : "them"} again${p.hubLink ? `, or open the hub: ${p.hubLink}` : ""}.`
    );
  }
  return { ok: true, attachmentsSent: att.sent, attachmentsFailed: att.failed };
}

function parseMediaJson(raw: unknown): LeadItem[] {
  try {
    const arr = JSON.parse(String(raw || "[]"));
    return Array.isArray(arr) ? (arr as LeadItem[]).filter((i) => i && typeof i.kind === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Called whenever a staff member messages the desk. Their 24 hour window is open at that moment, so any lead that
 * was waiting on a locked chat is delivered now, with all of its attachments.
 */
export async function flushPendingLeadForwards(p: {
  staffPhone: string;
  conversationId: string;
}): Promise<number> {
  await ensureLeadForwardsTable();
  const conv = getRawLibSqlClient("conversations");
  const suffix = suffix10(p.staffPhone);
  if (suffix.length < 10) return 0;
  const res = await conv.execute(
    `SELECT * FROM lead_forwards WHERE delivery_status = 'PENDING_WINDOW' ORDER BY created_at ASC LIMIT 60`
  );
  const mine = res.rows.filter((r) => suffix10(String(r.staff_phone)) === suffix).slice(0, 10);
  let delivered = 0;
  for (const r of mine) {
    const staffFirst = String(r.staff_name || "").split(/\s+/)[0] || "there";
    const items = parseMediaJson(r.media_json);
    const out = await deliverLeadBundle({
      staffPhone: p.staffPhone,
      conversationId: p.conversationId,
      staffFirstName: staffFirst,
      ownerName: String(r.owner_name || ownerDisplayName()),
      leadText: String(r.lead_text || "").replace(/^\(attachments only\)$/, ""),
      items,
      customerName: String(r.customer_name || ""),
      customerPhone: String(r.customer_phone || ""),
      createdAt: String(r.created_at),
    });
    if (!out.ok) continue; // stays pending and retries on the next message from this staff member
    await conv.execute({
      sql: `UPDATE lead_forwards
            SET delivery_status = 'DELIVERED', delivered_at = ?, delivery_note = ?
            WHERE id = ?`,
      args: [
        new Date().toISOString(),
        out.attachmentsFailed.length
          ? `Delivered when staff messaged the desk. Could not forward: ${out.attachmentsFailed.join(", ")}`
          : "Delivered when staff messaged the desk",
        String(r.id),
      ],
    });
    delivered += 1;
  }
  return delivered;
}

// ---------------------------------------------------------------------------
// Assign a lead
// ---------------------------------------------------------------------------

interface AssignLeadParams {
  conversationId: string;
  ownerPhone: string;
  ownerName: string;
  text: string;
  currentWaMessageId?: string;
  replyToWaMessageId?: string;
  hubBase: string;
  logAssignment: LogAssignmentFn;
}

async function pickGenericStaff(
  all: DeskStaff[],
  windows: Map<string, WindowState>,
  ownerSuffix: string
): Promise<{ staff: DeskStaff; why: string } | null> {
  const conv = getRawLibSqlClient("conversations");
  const [poolRes, loadRes, leadRes] = await Promise.all([
    conv
      .execute(
        `SELECT DISTINCT staff_id FROM team_members
         WHERE is_available = 1
           AND (team_id = 'team_sales' OR team_id IN (SELECT id FROM teams WHERE LOWER(name) LIKE '%sales%'))`
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    conv.execute(
      `SELECT assigned_staff_id AS sid, COUNT(*) AS c FROM conversations
       WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL AND assigned_staff_id != 'ACRIO'
       GROUP BY assigned_staff_id`
    ),
    conv
      .execute({
        sql: `SELECT staff_id AS sid, COUNT(*) AS c FROM lead_forwards WHERE created_at >= ? GROUP BY staff_id`,
        args: [todayStartIso()],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] })),
  ]);
  const salesIds = new Set(poolRes.rows.map((r) => String(r.staff_id)));
  const load = new Map<string, number>();
  for (const r of loadRes.rows) load.set(String(r.sid), Number(r.c ?? 0));
  const leadsToday = new Map<string, number>();
  for (const r of leadRes.rows) leadsToday.set(String(r.sid), Number(r.c ?? 0));

  const eligible = (s: DeskStaff) => s.role !== "DEV" && s.suffix !== ownerSuffix && Boolean(s.phone);
  let pool = all.filter((s) => eligible(s) && salesIds.has(s.id));
  let fromSales = true;
  if (pool.length === 0) {
    pool = all.filter(eligible);
    fromSales = false;
  }
  if (pool.length === 0) return null;

  const scored = pool
    .map((s) => ({
      s,
      open: windowFor(windows, s).open ? 0 : 1,
      load: (load.get(s.id) ?? 0) + (leadsToday.get(s.id) ?? 0),
      tie: Math.random(),
    }))
    .sort((a, b) => a.open - b.open || a.load - b.load || a.tie - b.tie);
  const best = scored[0];
  const openNow = best.open === 0;
  const why = `${fromSales ? "from the Sales Team" : "from the active team"}, ${
    openNow ? "chat unlocked" : "chat locked"
  }, ${best.load} current ${best.load === 1 ? "chat or lead" : "chats and leads"}`;
  return { staff: best.s, why };
}

export async function assignLeadFromOwner(
  parsed: ParsedAssignCommand,
  p: AssignLeadParams
): Promise<{ handled: boolean; reply: string }> {
  await ensureLeadForwardsTable();
  const conv = getRawLibSqlClient("conversations");
  const ownerSuffix = suffix10(p.ownerPhone);
  const ownerE164 = normalizeWhatsAppPhone(p.ownerPhone) || p.ownerPhone;

  // 1. Gather everything the owner sent for this client: text, voice notes, photos, videos, files.
  let items = await collectLeadItems({
    conversationId: p.conversationId,
    ownerPhone: p.ownerPhone,
    replyToWaMessageId: p.replyToWaMessageId,
  });
  if (items.length === 0 && parsed.leadText.trim()) {
    // Fallback for a message that is not yet in the chat log.
    const typed = parsed.leadText
      .split("\n")
      .filter((l) => !MEDIA_PLACEHOLDER_RE.test(l.trim()))
      .join("\n")
      .trim();
    if (typed) items = [{ kind: "TEXT", text: typed, at: Date.now() }];
  }
  items = items.map((i) => ({
    ...i,
    text: i.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, 3500),
  }));
  const leadText = leadTextOf(items);
  const mediaItems = items.filter((i) => i.kind !== "TEXT");
  const attachmentSummary = describeAttachments(items);
  if (!leadText && mediaItems.length === 0) {
    return {
      handled: true,
      reply:
        "Sir, I could not find an enquiry to assign. Please paste or forward the enquiry first (text, voice note, photo or file), then say *please assign to <name>* (or just *please assign*). You can also swipe-reply on the enquiry and type the command.",
    };
  }

  // 2. Find the staff member.
  const [allStaff] = await Promise.all([loadDeskStaff()]);
  const windows = await loadWindowStates(allStaff);

  let chosen: DeskStaff | null = null;
  let mode: "NAMED" | "AUTO_SALES" = "NAMED";
  let whyAuto = "";
  if (parsed.targetQuery) {
    const hit = resolveStaffMemberByQuery(parsed.targetQuery, allStaff);
    chosen = hit ? allStaff.find((s) => s.id === hit.id) || null : null;
    if (!chosen) {
      if (!/^(assign|allot)$/.test(parsed.verb)) {
        // "send this to <something that is not a staff name>" is not an assignment command.
        return { handled: false, reply: "" };
      }
      const names = allStaff
        .filter((s) => s.role !== "DEV" && s.suffix !== ownerSuffix)
        .slice(0, 12)
        .map((s) => s.name.split(/\s+/)[0])
        .join(", ");
      return {
        handled: true,
        reply: `Sir, I could not find a staff member called *${parsed.targetQuery}*. Nothing was assigned.\n\nActive staff: ${
          names || "none found"
        }.\n\nTry again with a first name, or say *please assign* and I will pick someone from the Sales Team.`,
      };
    }
  } else {
    mode = "AUTO_SALES";
    const pick = await pickGenericStaff(allStaff, windows, ownerSuffix);
    if (!pick) {
      return {
        handled: true,
        reply:
          "Sir, I could not find any active staff member with a WhatsApp number saved, so nothing was assigned. Please check the team list in the hub.",
      };
    }
    chosen = pick.staff;
    whyAuto = pick.why;
  }

  const win = windowFor(windows, chosen);
  const hints = extractCustomerHints(
    items.map((i) => i.text).filter(Boolean).join("\n"),
    [ownerSuffix, chosen.suffix]
  );
  const nowIso = new Date().toISOString();
  const leadId = `lead_${crypto.randomUUID().slice(0, 10)}`;
  const staffFirst = chosen.name.split(/\s+/)[0] || chosen.name;

  // 3. Save the lead in the Call Queue so it also shows in the hub.
  let callQueueId: string | null = null;
  let callQueueConversationId: string | null = null;
  try {
    const item = await createCallDispatchItem({
      customerPhone: hints.phone,
      customerName: hints.name,
      source: `Owner WhatsApp (${p.ownerName})`,
      productTopic: (leadText || `Attachments only (${attachmentSummary})`).replace(/\s+/g, " ").slice(0, 80),
      notes: [
        leadText,
        ...mediaItems.map((i) => i.text).filter(Boolean).map((c) => `(File caption: ${c})`),
        attachmentSummary ? `(Attachments: ${attachmentSummary}. Open the owner chat in the hub to view them.)` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      assignmentMode: "MANUAL",
      manualStaffId: chosen.id,
      priority: "HIGH",
      submittedById: p.ownerPhone,
      submittedByName: p.ownerName,
    });
    callQueueId = item.id;
    callQueueConversationId = item.conversationId || null;
  } catch (err) {
    console.warn("[owner-desk] call queue save failed:", err);
  }

  // 4. If the customer already has an open chat, move it to the chosen staff member.
  let reassignedFrom = "";
  if (hints.phone) {
    await upsertSyncedContact({
      phone: hints.phone,
      name: hints.name || undefined,
      source: "MANUAL",
      notes: `Lead from ${p.ownerName}: ${leadText.slice(0, 300)}`,
      preferredStaffId: chosen.id,
      preferredStaffName: chosen.name,
      lastContactedAt: nowIso,
    }).catch(() => {});

    const existing = await conv
      .execute({
        sql: `SELECT id, customer_name, assigned_staff_id, assigned_staff_name, assigned_team_name, status
              FROM conversations WHERE customer_phone = ? LIMIT 1`,
        args: [hints.phone],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const ex = existing.rows[0];
    if (ex && String(ex.status) !== "RESOLVED" && String(ex.assigned_staff_id || "") !== chosen.id) {
      const prevId = ex.assigned_staff_id ? String(ex.assigned_staff_id) : "";
      const prevName = ex.assigned_staff_name ? String(ex.assigned_staff_name) : "";
      await conv.execute({
        sql: `UPDATE conversations
              SET status = 'ASSIGNED', assigned_staff_id = ?, assigned_staff_name = ?,
                  assigned_team_id = COALESCE(assigned_team_id, 'team_sales'),
                  assigned_team_name = CASE
                    WHEN assigned_team_name IS NULL OR TRIM(assigned_team_name) = '' OR assigned_team_name LIKE 'System (ACRIO)%' OR assigned_team_name = 'Internal Team Desk'
                    THEN 'Sales Team' ELSE assigned_team_name END,
                  escalation_level = 'P0', waiting_since = NULL
              WHERE id = ?`,
        args: [chosen.id, chosen.name, String(ex.id)],
      });
      await p
        .logAssignment({
          conversationId: String(ex.id),
          customerPhone: hints.phone,
          customerName: String(ex.customer_name || hints.name || ""),
          fromStaffId: prevId || null,
          fromStaffName: prevName || null,
          fromTeamName: ex.assigned_team_name ? String(ex.assigned_team_name) : null,
          toStaffId: chosen.id,
          toStaffName: chosen.name,
          toTeamId: "team_sales",
          toTeamName: "Sales Team",
          escalationLevel: "P0",
          assignmentSource: "MANUAL_ASSIGN",
          assignedByName: p.ownerName,
          reason: `Assigned by ${p.ownerName} on WhatsApp (lead forwarding)`,
          assignedAt: nowIso,
        })
        .catch(() => {});
      await conv
        .execute({
          sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, delivery_status, created_at)
                VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', ?, 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
          args: [
            `msg_lead_note_${crypto.randomUUID().slice(0, 8)}`,
            String(ex.id),
            p.ownerName,
            `${p.ownerName} assigned this chat to ${chosen.name} on WhatsApp.`,
            nowIso,
          ],
        })
        .catch(() => {});
      if (prevId && prevId !== "ACRIO" && prevId !== chosen.id) {
        reassignedFrom = prevName;
        await createNotification({
          staffId: prevId,
          type: "MENTION",
          conversationId: String(ex.id),
          messageId: leadId,
          fromName: p.ownerName,
          customerName: String(ex.customer_name || hints.phone),
          text: `${p.ownerName} moved this chat to ${chosen.name}. You no longer need to follow it up.`,
        }).catch(() => {});
      }
      socketHub.emit("conversation:assigned", {
        conversationId: String(ex.id),
        staffId: chosen.id,
        staffName: chosen.name,
        teamName: "Sales Team",
        escalationLevel: "P0",
      });
    }
  }

  // 5. Deliver to the staff member.
  let deliveryStatus: "DELIVERED" | "PENDING_WINDOW" | "NO_WHATSAPP" | "FAILED" = "PENDING_WINDOW";
  let deliveryNote = "";
  const hubLink = callQueueConversationId
    ? `${p.hubBase}/dashboard/inbox?chat=${encodeURIComponent(callQueueConversationId)}`
    : `${p.hubBase}/dashboard/call-queue`;
  const storedLeadText = leadText || "(attachments only)";
  let attachmentFailures: string[] = [];

  if (!chosen.phone) {
    deliveryStatus = "NO_WHATSAPP";
    deliveryNote = "Staff member has no WhatsApp number saved";
  } else if (win.open && win.conversationId) {
    const out = await deliverLeadBundle({
      staffPhone: chosen.phone,
      conversationId: win.conversationId,
      staffFirstName: staffFirst,
      ownerName: p.ownerName,
      leadText,
      items,
      customerName: hints.name,
      customerPhone: hints.phone,
      createdAt: nowIso,
      hubLink,
    });
    if (out.ok) {
      deliveryStatus = "DELIVERED";
      attachmentFailures = out.attachmentsFailed;
      deliveryNote = attachmentFailures.length
        ? `Sent as chat text. Could not forward: ${attachmentFailures.join(", ")}`
        : "Sent as chat text (chat was unlocked)";
    } else {
      deliveryStatus = "PENDING_WINDOW";
      deliveryNote = `Chat send failed (${out.error || "unknown"}), will retry when staff messages the desk`;
    }
  } else {
    deliveryNote = "Chat was locked, template sent, full lead waits for the staff reply";
    if (String(process.env.OWNER_LEAD_TEMPLATE_FALLBACK ?? "1") !== "0") {
      const tpl = await sendStaffClientAssignmentTemplate({
        toPhone: chosen.phone,
        staffId: chosen.id,
        staffName: chosen.name,
        customerName: hints.name || "New enquiry from the owner",
        customerPhone: hints.phone || "Reply Hi to see details",
      }).catch(() => ({ ok: false as const, error: "template failed" }));
      if (!tpl.ok) deliveryNote += ` (template did not send: ${"error" in tpl && tpl.error ? tpl.error : "unknown"})`;
    }
  }

  await conv.execute({
    sql: `INSERT INTO lead_forwards (
      id, owner_phone, owner_name, staff_id, staff_name, staff_phone, lead_text, customer_name, customer_phone,
      call_queue_id, assignment_mode, delivery_status, delivery_note, delivered_at, created_at, media_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      leadId,
      ownerE164,
      p.ownerName,
      chosen.id,
      chosen.name,
      chosen.phone,
      storedLeadText,
      hints.name,
      hints.phone,
      callQueueId,
      mode,
      deliveryStatus,
      deliveryNote,
      deliveryStatus === "DELIVERED" ? nowIso : null,
      nowIso,
      JSON.stringify(mediaItems),
    ],
  });

  await createNotification({
    staffId: chosen.id,
    type: "CALLBACK",
    conversationId: callQueueConversationId || "/dashboard/call-queue",
    messageId: leadId,
    fromName: p.ownerName,
    customerName: hints.name || hints.phone || "New lead",
    text: `Lead from ${p.ownerName}: ${(leadText || `attachments only (${attachmentSummary})`).replace(/\s+/g, " ").slice(0, 160)}`,
  }).catch(() => {});
  socketHub.emit("call_queue:updated", { id: callQueueId, action: "created" });

  // 6. Confirmation back to the owner.
  const lines: string[] = [];
  lines.push(`Done, sir. Lead assigned to *${chosen.name}*${chosen.department ? ` (${chosen.department})` : ""}.`);
  if (mode === "AUTO_SALES") lines.push(`I picked ${staffFirst} ${whyAuto}.`);
  lines.push("");
  const packed = [leadText ? "the written enquiry" : "", attachmentSummary].filter(Boolean).join(" + ");
  if (deliveryStatus === "DELIVERED") {
    lines.push(`${staffFirst} has received the full enquiry on WhatsApp (${packed || "text"}).`);
    if (attachmentFailures.length > 0) {
      lines.push(
        `Heads up: ${attachmentFailures.length === 1 ? "one attachment" : `${attachmentFailures.length} attachments`} could not be forwarded (${attachmentFailures.join(", ")}). ${staffFirst} was told, and can open it in the hub.`
      );
    }
  } else if (deliveryStatus === "PENDING_WINDOW") {
    lines.push(
      `${staffFirst}'s chat is locked because there was no *hi* in the last 24 hours. I sent the alert template. The full enquiry (${packed || "text"}) will reach ${staffFirst} the moment ${staffFirst} messages this number.`
    );
  } else if (deliveryStatus === "NO_WHATSAPP") {
    lines.push(
      `${staffFirst} has no WhatsApp number saved, so I could not message them. The lead is saved in the Call Queue: ${p.hubBase}/dashboard/call-queue`
    );
  } else {
    lines.push(`I could not reach ${staffFirst} on WhatsApp. The lead is saved in the Call Queue: ${p.hubBase}/dashboard/call-queue`);
  }
  if (hints.phone) lines.push(`Customer number found in the text: ${hints.phone}.`);
  if (reassignedFrom) lines.push(`This customer's open chat was moved from ${reassignedFrom} to ${staffFirst}.`);
  return { handled: true, reply: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Staff side: greeting, unlock confirmation, "my leads"
// ---------------------------------------------------------------------------

const GREETING_RE =
  /^(?:hi+|hello+|hey+|hii+|helo|good\s*(?:morning|afternoon|evening)|gm|namaste|namaskar|salaam|salam|assalam(?:u)?\s*alaikum|start|online|present)\W*$/i;

export function isStaffGreeting(text: string): boolean {
  return GREETING_RE.test(String(text || "").trim().toLowerCase());
}

export async function countPendingLeadForwards(staffPhone: string): Promise<number> {
  await ensureLeadForwardsTable();
  const suffix = suffix10(staffPhone);
  if (suffix.length < 10) return 0;
  const res = await getRawLibSqlClient("conversations").execute(
    `SELECT staff_phone FROM lead_forwards WHERE delivery_status = 'PENDING_WINDOW' LIMIT 200`
  );
  return res.rows.filter((r) => suffix10(String(r.staff_phone)) === suffix).length;
}

function greetingWord(): string {
  const hour = Number(formatInTimeZone(new Date(), TZ, "H"));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export async function handleStaffDeskMessage(p: {
  staff: InternalStaffCallerProfile;
  text: string;
  hubBase: string;
  /** Delivers any lead that was waiting on a locked chat. Returns how many were sent. */
  flushLeads: () => Promise<number>;
  reply: (text: string) => Promise<void>;
}): Promise<boolean> {
  const lower = p.text.trim().toLowerCase();

  if (GREETING_RE.test(lower)) {
    const pending = await countPendingLeadForwards(p.staff.phone).catch(() => 0);
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const lines = [
      `${greetingWord()}, *${p.staff.firstName}*! Your desk chat is unlocked until ${fmtTime(until)}.`,
      "Leads from the owner will reach you here straight away.",
    ];
    if (pending > 0) {
      lines.push(
        `You had ${pending} lead${pending === 1 ? "" : "s"} waiting. ${pending === 1 ? "It is" : "They are"} on the way now.`
      );
    }
    lines.push("Reply *my leads* to see your forwarded leads, or *my chats* for your open chats.");
    await p.reply(lines.join("\n"));
    if (pending > 0) await p.flushLeads();
    return true;
  }

  if (/^(?:my\s*leads?|leads?|forwarded\s*leads?|my\s*forwarded\s*leads?)\W*$/i.test(lower)) {
    await ensureLeadForwardsTable();
    const conv = getRawLibSqlClient("conversations");
    const suffix = suffix10(p.staff.phone);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await conv.execute({
      sql: `SELECT staff_phone, staff_id, owner_name, lead_text, customer_name, customer_phone, delivery_status, created_at
            FROM lead_forwards WHERE created_at >= ? ORDER BY created_at DESC LIMIT 80`,
      args: [since],
    });
    const mine = res.rows
      .filter(
        (r) =>
          suffix10(String(r.staff_phone)) === suffix ||
          (p.staff.hubUserId && String(r.staff_id) === p.staff.hubUserId)
      )
      .slice(0, 8);
    if (mine.length === 0) {
      await p.reply(`Hey *${p.staff.firstName}*, no leads have been forwarded to you in the last 7 days.`);
      return true;
    }
    const items = mine
      .map((r, i) => {
        const snippet = String(r.lead_text || "").replace(/\s+/g, " ").slice(0, 110);
        const who = [String(r.customer_name || ""), String(r.customer_phone || "")].filter(Boolean).join(" ");
        return `${i + 1}. ${fmtTime(String(r.created_at))}${who ? ` | ${who}` : ""}\n   ${snippet}`;
      })
      .join("\n\n");
    await p.reply(`*Leads forwarded to you (last 7 days)*\n\n${items}`);
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Owner read-only commands
// ---------------------------------------------------------------------------

function normalizeOwnerText(raw: string): string {
  let t = String(raw || "").trim().toLowerCase();
  t = t.replace(/^@?acrio[\s,:-]+/, "");
  t = t.replace(/^(?:please|pls|plz|kindly|sir|hey|hi)[\s,]+/, "");
  t = t.replace(/^(?:show|give|send|tell|get|check|list|display|what(?:'s| is)|whats|how many|how(?:'s| is))\s+(?:me\s+)?(?:the\s+|all\s+|today'?s?\s+)?/, "");
  t = t.replace(/[?.!]+$/g, "").trim();
  return t;
}

const OWNER_HELP = [
  "*Owner commands, sir*",
  "",
  "*Leads*",
  "• Paste an enquiry, then say *please assign to <name>* or *please assign*",
  "• *leads* : leads forwarded today",
  "",
  "*Desk*",
  "• *summary* : open chats, waiting, callbacks, orders",
  "• *waiting* : customers waiting longest",
  "• *unassigned* : chats still with ACRIO",
  "• *team* : who has said hi today and who is locked",
  "• *workload* : open chats per staff",
  "• *chats of <name>* : one person's open chats",
  "• *performance* : top staff by resolved chats and speed",
  "",
  "*Business*",
  "• *callbacks* : pending callbacks and call queue",
  "• *enquiries* : website enquiries",
  "• *orders* : orders and revenue",
  "• *billing* : WhatsApp message charges",
  "• *approvals* : staff waiting for approval",
  "• *templates* : template approval status",
  "• *broadcasts* : latest campaigns",
  "• *chat <phone>* : customer details and last messages",
].join("\n");

function clip(text: string, max = 3600): string {
  return text.length > max ? `${text.slice(0, max - 20)}\n...(trimmed)` : text;
}

function inr(n: number): string {
  return `Rs ${Math.round(n).toLocaleString("en-IN")}`;
}

export async function handleOwnerReadCommand(p: {
  text: string;
  hubBase: string;
  reply: (text: string) => Promise<void>;
}): Promise<boolean> {
  const raw = p.text.trim();
  if (!raw || raw.length > 90) return false;
  const core = normalizeOwnerText(raw);
  if (!core) return false;

  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const mkt = getRawLibSqlClient("marketing");
  const bill = getRawLibSqlClient("billing_ops");
  const auth = getRawLibSqlClient("core_auth");
  const startIso = todayStartIso();
  const empty = { rows: [] as Record<string, unknown>[] };

  if (/^(?:help|commands?|menu|owner (?:help|menu)|what can you do)$/.test(core)) {
    await p.reply(OWNER_HELP);
    return true;
  }

  if (/^(?:summary|overview|status|dashboard|stats?|snapshot|today|report|(?:business|desk|today)(?: summary| stats| report)?|how(?:'s| is) (?:the )?(?:business|desk|today))$/.test(core)) {
    await ensureLeadForwardsTable();
    const [open, waiting, acrio, newToday, resolvedToday, cb, queue, leads, enq, orders, staff] = await Promise.all([
      conv.execute(`SELECT COUNT(*) AS c FROM conversations WHERE status != 'RESOLVED' AND COALESCE(smart_category,'') != 'Internal Team'`),
      conv.execute(`SELECT COUNT(*) AS c FROM conversations WHERE status != 'RESOLVED' AND waiting_since IS NOT NULL`),
      conv.execute(`SELECT COUNT(*) AS c FROM conversations WHERE status != 'RESOLVED' AND assigned_staff_id = 'ACRIO' AND COALESCE(smart_category,'') != 'Internal Team'`),
      conv.execute({ sql: `SELECT COUNT(*) AS c FROM conversations WHERE created_at >= ?`, args: [startIso] }),
      conv.execute({ sql: `SELECT COUNT(*) AS c FROM conversations WHERE status = 'RESOLVED' AND resolved_at >= ?`, args: [startIso] }),
      conv.execute(`SELECT COUNT(*) AS c FROM callback_requests WHERE status = 'PENDING'`).catch(() => empty),
      conv.execute(`SELECT COUNT(*) AS c FROM call_dispatch_queue WHERE status != 'RESOLVED'`).catch(() => empty),
      conv.execute({ sql: `SELECT COUNT(*) AS c FROM lead_forwards WHERE created_at >= ?`, args: [startIso] }),
      crm.execute(`SELECT COUNT(*) AS c FROM ecosystem_enquiries WHERE status = 'New'`).catch(() => empty),
      crm
        .execute({
          sql: `SELECT COUNT(*) AS c, COALESCE(SUM(total_amount_inr),0) AS t FROM customer_orders WHERE ordered_at >= ?`,
          args: [startIso],
        })
        .catch(() => empty),
      loadDeskStaff(),
    ]);
    const windows = await loadWindowStates(staff);
    const unlocked = staff.filter((s) => windowFor(windows, s).open).length;
    const n = (r: { rows: Record<string, unknown>[] }) => Number(r.rows[0]?.c ?? 0);
    const orderRow = orders.rows[0] || {};
    await p.reply(
      [
        `*Desk summary, ${formatInTimeZone(new Date(), TZ, "d MMM, h:mm a")}*`,
        "",
        `• Open customer chats: ${n(open)}`,
        `• Waiting for a staff reply: ${n(waiting)}`,
        `• Still with ACRIO: ${n(acrio)}`,
        `• New chats today: ${n(newToday)}`,
        `• Resolved today: ${n(resolvedToday)}`,
        `• Pending callbacks: ${n(cb)}`,
        `• Open call queue items: ${n(queue)}`,
        `• Leads you forwarded today: ${n(leads)}`,
        `• New website enquiries: ${n(enq)}`,
        `• Orders today: ${Number(orderRow.c ?? 0)} (${inr(Number(orderRow.t ?? 0))})`,
        `• Staff with chat unlocked: ${unlocked} of ${staff.length}`,
        "",
        `Dashboard: ${p.hubBase}/dashboard`,
      ].join("\n")
    );
    return true;
  }

  if (/^(?:waiting(?: chats?| customers?| list)?|who is waiting|pending (?:replies|chats|customers)|unanswered(?: chats)?)$/.test(core)) {
    const res = await conv.execute(
      `SELECT id, customer_name, customer_phone, assigned_staff_name, waiting_since, last_message_preview
       FROM conversations
       WHERE status != 'RESOLVED' AND waiting_since IS NOT NULL AND COALESCE(smart_category,'') != 'Internal Team'
       ORDER BY waiting_since ASC LIMIT 8`
    );
    if (res.rows.length === 0) {
      await p.reply("Good news, sir. No customer is waiting for a reply right now.");
      return true;
    }
    const now = Date.now();
    const items = res.rows
      .map((r, i) => {
        const mins = Math.max(0, Math.round((now - new Date(String(r.waiting_since)).getTime()) / 60000));
        const waited = mins >= 90 ? `${Math.round(mins / 60)}h` : `${mins}m`;
        return `${i + 1}. *${String(r.customer_name || r.customer_phone)}* waiting ${waited}\n   With: ${String(r.assigned_staff_name || "ACRIO")}\n   "${String(r.last_message_preview || "").slice(0, 80)}"`;
      })
      .join("\n\n");
    await p.reply(clip(`*Customers waiting longest*\n\n${items}\n\nInbox: ${p.hubBase}/dashboard/inbox`));
    return true;
  }

  if (/^(?:unassigned(?: chats?| leads?)?|acrio chats?|chats? with acrio|open pool)$/.test(core)) {
    const res = await conv.execute(
      `SELECT customer_name, customer_phone, smart_category, last_message_at, last_message_preview
       FROM conversations
       WHERE status != 'RESOLVED' AND assigned_staff_id = 'ACRIO' AND COALESCE(smart_category,'') != 'Internal Team'
       ORDER BY last_message_at DESC LIMIT 8`
    );
    if (res.rows.length === 0) {
      await p.reply("No open chat is sitting with ACRIO right now, sir.");
      return true;
    }
    const items = res.rows
      .map(
        (r, i) =>
          `${i + 1}. *${String(r.customer_name || r.customer_phone)}* (${String(r.customer_phone)})\n   ${String(r.smart_category || "Enquiry")} | ${fmtTime(String(r.last_message_at))}`
      )
      .join("\n\n");
    await p.reply(clip(`*Chats handled by ACRIO*\n\n${items}`));
    return true;
  }

  if (/^(?:team|staff|team status|staff status|who(?:'s| is) online|online(?: staff)?|who said hi|attendance|present|available staff|who(?:'s| is) available|unlocked)$/.test(core)) {
    const staff = await loadDeskStaff();
    const windows = await loadWindowStates(staff);
    const loadRes = await conv.execute(
      `SELECT assigned_staff_id AS sid, COUNT(*) AS c FROM conversations
       WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL AND assigned_staff_id != 'ACRIO' GROUP BY assigned_staff_id`
    );
    const load = new Map(loadRes.rows.map((r) => [String(r.sid), Number(r.c ?? 0)]));
    const rows = staff
      .filter((s) => s.role !== "DEV")
      .map((s) => ({ s, w: windowFor(windows, s), open: load.get(s.id) ?? 0 }));
    const on = rows.filter((r) => r.w.open);
    const off = rows.filter((r) => !r.w.open);
    const lineOn = on.map((r) => `• ${r.s.name} | ${r.open} open | unlocked until ${fmtTime(r.w.until)}`);
    const lineOff = off.map((r) => `• ${r.s.name}${r.s.phone ? "" : " (no number saved)"} | ${r.open} open`);
    await p.reply(
      clip(
        [
          `*Team status*`,
          `Unlocked (said hi in last 24h): ${on.length}   Locked: ${off.length}`,
          "",
          ...(lineOn.length ? ["*Unlocked*", ...lineOn, ""] : []),
          ...(lineOff.length ? ["*Locked (not said hi)*", ...lineOff] : []),
        ].join("\n")
      )
    );
    return true;
  }

  if (/^(?:workload|load|staff load|chats per staff|distribution)$/.test(core)) {
    const res = await conv.execute(
      `SELECT assigned_staff_name AS n, COUNT(*) AS c,
              SUM(CASE WHEN waiting_since IS NOT NULL THEN 1 ELSE 0 END) AS w
       FROM conversations
       WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL AND assigned_staff_id != 'ACRIO'
         AND COALESCE(smart_category,'') != 'Internal Team'
       GROUP BY assigned_staff_id ORDER BY c DESC LIMIT 15`
    );
    if (res.rows.length === 0) {
      await p.reply("No staff member has an open chat right now, sir.");
      return true;
    }
    await p.reply(
      clip(
        `*Open chats per staff*\n\n${res.rows
          .map((r) => `• ${String(r.n)}: ${Number(r.c)} open, ${Number(r.w ?? 0)} waiting`)
          .join("\n")}`
      )
    );
    return true;
  }

  const staffChatsMatch =
    core.match(/^(?:chats?|leads?|queue|load|workload)\s+(?:of|for|with)\s+@?([a-z][a-z .'-]{1,30})$/) ||
    core.match(/^@?([a-z][a-z .'-]{1,30}?)(?:'s)?\s+(?:chats?|leads?|queue|load|workload)$/);
  if (staffChatsMatch && !/^(?:my|the|all|open|new|pending)$/.test(staffChatsMatch[1].trim())) {
    const staff = await loadDeskStaff();
    const hit = resolveStaffMemberByQuery(staffChatsMatch[1].trim(), staff);
    if (!hit) {
      await p.reply(`Sir, I could not find a staff member called *${staffChatsMatch[1].trim()}*.`);
      return true;
    }
    const res = await conv.execute({
      sql: `SELECT id, customer_name, customer_phone, smart_category, last_message_preview, waiting_since
            FROM conversations WHERE assigned_staff_id = ? AND status != 'RESOLVED'
            ORDER BY last_message_at DESC LIMIT 8`,
      args: [hit.id],
    });
    if (res.rows.length === 0) {
      await p.reply(`${hit.name} has no open chats right now.`);
      return true;
    }
    const items = res.rows
      .map(
        (r, i) =>
          `${i + 1}. *${String(r.customer_name || r.customer_phone)}* (${String(r.customer_phone)})${r.waiting_since ? " [waiting]" : ""}\n   ${String(r.smart_category || "Enquiry")} | "${String(r.last_message_preview || "").slice(0, 70)}"`
      )
      .join("\n\n");
    await p.reply(clip(`*${hit.name}: ${res.rows.length} open chat${res.rows.length === 1 ? "" : "s"}*\n\n${items}`));
    return true;
  }

  if (/^(?:leads?(?: today| log| forwarded| history)?|forwarded leads?|lead log|assigned leads?|today'?s? leads?)$/.test(core)) {
    await ensureLeadForwardsTable();
    const res = await conv.execute({
      sql: `SELECT staff_name, lead_text, customer_name, customer_phone, delivery_status, created_at
            FROM lead_forwards WHERE created_at >= ? ORDER BY created_at DESC LIMIT 10`,
      args: [startIso],
    });
    if (res.rows.length === 0) {
      await p.reply("You have not forwarded any lead today, sir.");
      return true;
    }
    const statusWord = (s: string) =>
      s === "DELIVERED" ? "delivered" : s === "PENDING_WINDOW" ? "waiting for staff to say hi" : s === "NO_WHATSAPP" ? "no number" : "failed";
    const items = res.rows
      .map(
        (r, i) =>
          `${i + 1}. ${fmtTime(String(r.created_at))} to *${String(r.staff_name)}* (${statusWord(String(r.delivery_status))})\n   ${String(r.lead_text || "").replace(/\s+/g, " ").slice(0, 100)}`
      )
      .join("\n\n");
    await p.reply(clip(`*Leads forwarded today (${res.rows.length})*\n\n${items}`));
    return true;
  }

  if (/^(?:callbacks?|pending callbacks?|call ?backs?|call queue|calls)$/.test(core)) {
    const [cb, q] = await Promise.all([
      conv
        .execute(
          `SELECT customer_name, customer_phone, preferred_slot, topic FROM callback_requests
           WHERE status = 'PENDING' ORDER BY created_at DESC LIMIT 6`
        )
        .catch(() => empty),
      conv
        .execute(
          `SELECT customer_name, customer_phone, assigned_staff_name, status, product_topic FROM call_dispatch_queue
           WHERE status != 'RESOLVED' ORDER BY created_at DESC LIMIT 6`
        )
        .catch(() => empty),
    ]);
    const a = cb.rows.map(
      (r, i) => `${i + 1}. *${String(r.customer_name || r.customer_phone)}* | ${String(r.preferred_slot || "ASAP")} | ${String(r.topic || "General")}`
    );
    const b = q.rows.map(
      (r, i) => `${i + 1}. *${String(r.customer_name || r.customer_phone)}* | ${String(r.assigned_staff_name || "Open pool")} | ${String(r.status)}`
    );
    await p.reply(
      clip(
        [
          `*Pending callbacks (${a.length})*`,
          ...(a.length ? a : ["None"]),
          "",
          `*Open call queue (${b.length})*`,
          ...(b.length ? b : ["None"]),
          "",
          `${p.hubBase}/dashboard/call-queue`,
        ].join("\n")
      )
    );
    return true;
  }

  if (/^(?:enquiries|inquiries|website enquiries|website leads|new enquiries)$/.test(core)) {
    const [cnt, rows] = await Promise.all([
      crm
        .execute(`SELECT SUM(CASE WHEN status='New' THEN 1 ELSE 0 END) AS n, COUNT(*) AS t FROM ecosystem_enquiries`)
        .catch(() => empty),
      crm
        .execute(
          `SELECT brand_label, customer_name, customer_phone, product_name, status, created_at FROM ecosystem_enquiries
           ORDER BY created_at DESC LIMIT 6`
        )
        .catch(() => empty),
    ]);
    const items = rows.rows
      .map(
        (r, i) =>
          `${i + 1}. [${String(r.status)}] *${String(r.customer_name)}* | ${String(r.brand_label)}\n   ${String(r.product_name || "General")} | ${fmtTime(String(r.created_at))}`
      )
      .join("\n\n");
    await p.reply(
      clip(
        `*Website enquiries*\nNew: ${Number(cnt.rows[0]?.n ?? 0)} of ${Number(cnt.rows[0]?.t ?? 0)} total\n\n${items || "None yet."}\n\n${p.hubBase}/dashboard/enquiries`
      )
    );
    return true;
  }

  if (/^(?:orders?|sales|revenue|orders today|order summary)$/.test(core)) {
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const [t, m, recent] = await Promise.all([
      crm
        .execute({ sql: `SELECT COUNT(*) AS c, COALESCE(SUM(total_amount_inr),0) AS t FROM customer_orders WHERE ordered_at >= ?`, args: [startIso] })
        .catch(() => empty),
      crm
        .execute({ sql: `SELECT COUNT(*) AS c, COALESCE(SUM(total_amount_inr),0) AS t FROM customer_orders WHERE ordered_at >= ?`, args: [since30] })
        .catch(() => empty),
      crm
        .execute(`SELECT order_number, items_summary, total_amount_inr, fulfillment_status FROM customer_orders ORDER BY ordered_at DESC LIMIT 5`)
        .catch(() => empty),
    ]);
    const items = recent.rows
      .map((r, i) => `${i + 1}. ${String(r.order_number)} | ${inr(Number(r.total_amount_inr ?? 0))} | ${String(r.fulfillment_status)}\n   ${String(r.items_summary || "").slice(0, 70)}`)
      .join("\n");
    await p.reply(
      clip(
        `*Orders*\nToday: ${Number(t.rows[0]?.c ?? 0)} orders, ${inr(Number(t.rows[0]?.t ?? 0))}\nLast 30 days: ${Number(m.rows[0]?.c ?? 0)} orders, ${inr(Number(m.rows[0]?.t ?? 0))}\n\n*Latest*\n${items || "No orders yet."}`
      )
    );
    return true;
  }

  if (/^(?:billing|cost|costs|spend|message cost|message charges|whatsapp (?:cost|spend|bill)|cost breakdown)$/.test(core)) {
    const [byCat, today] = await Promise.all([
      bill
        .execute(`SELECT category, COUNT(*) AS c, COALESCE(SUM(client_unit_rate_inr),0) AS t FROM message_billing_ledger GROUP BY category`)
        .catch(() => empty),
      bill
        .execute({ sql: `SELECT COUNT(*) AS c, COALESCE(SUM(client_unit_rate_inr),0) AS t FROM message_billing_ledger WHERE billed_at >= ?`, args: [startIso] })
        .catch(() => empty),
    ]);
    const total = byCat.rows.reduce((a, r) => a + Number(r.t ?? 0), 0);
    const count = byCat.rows.reduce((a, r) => a + Number(r.c ?? 0), 0);
    await p.reply(
      clip(
        [
          "*WhatsApp message charges*",
          `Today: ${Number(today.rows[0]?.c ?? 0)} billed messages, Rs ${Number(today.rows[0]?.t ?? 0).toFixed(2)}`,
          `All time: ${count} billed messages, Rs ${total.toFixed(2)}`,
          "",
          ...byCat.rows.map((r) => `• ${String(r.category)}: ${Number(r.c)} messages, Rs ${Number(r.t ?? 0).toFixed(2)}`),
          "",
          "Normal staff replies inside 24 hours and internal notes cost nothing.",
          `${p.hubBase}/dashboard/pricing`,
        ].join("\n")
      )
    );
    return true;
  }

  if (/^(?:approvals?|pending approvals?|pending staff|staff requests?|new staff)$/.test(core)) {
    const res = await auth
      .execute(
        `SELECT name, department, created_at FROM users WHERE status = 'PENDING_APPROVAL' ORDER BY created_at DESC LIMIT 8`
      )
      .catch(() => empty);
    if (res.rows.length === 0) {
      await p.reply("No staff account is waiting for approval, sir.");
      return true;
    }
    const items = res.rows
      .map((r, i) => `${i + 1}. *${String(r.name)}* | ${String(r.department || "Sales & Support")} | ${fmtTime(String(r.created_at))}`)
      .join("\n");
    await p.reply(clip(`*Waiting for your approval (${res.rows.length})*\n\n${items}\n\nApprove here: ${p.hubBase}/dashboard/approvals`));
    return true;
  }

  if (/^(?:templates?|template status)$/.test(core)) {
    const res = await mkt
      .execute(`SELECT approval_status AS s, COUNT(*) AS c FROM templates GROUP BY approval_status`)
      .catch(() => empty);
    await p.reply(
      clip(
        `*Template status*\n${res.rows.map((r) => `• ${String(r.s)}: ${Number(r.c)}`).join("\n") || "No templates yet."}\n\n${p.hubBase}/dashboard/templates`
      )
    );
    return true;
  }

  if (/^(?:broadcasts?|campaigns?)$/.test(core)) {
    const res = await mkt
      .execute(
        `SELECT name, status, total_recipients, sent_count, delivered_count, read_count, created_at FROM broadcasts ORDER BY created_at DESC LIMIT 5`
      )
      .catch(() => empty);
    if (res.rows.length === 0) {
      await p.reply("No broadcast has been sent yet, sir.");
      return true;
    }
    const items = res.rows
      .map(
        (r, i) =>
          `${i + 1}. *${String(r.name)}* [${String(r.status)}]\n   Sent ${Number(r.sent_count)}/${Number(r.total_recipients)} | Delivered ${Number(r.delivered_count)} | Read ${Number(r.read_count)}`
      )
      .join("\n\n");
    await p.reply(clip(`*Latest broadcasts*\n\n${items}\n\n${p.hubBase}/dashboard/marketing`));
    return true;
  }

  if (/^(?:performance|leaderboard|top staff|best staff|sla|response times?|staff performance)$/.test(core)) {
    const ranked = await computePerformanceRankedStaff().catch(() => []);
    if (ranked.length === 0) {
      await p.reply("There is no staff performance data yet, sir.");
      return true;
    }
    const fmtSec = (s: number | null) => (s === null ? "no data" : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);
    const items = ranked
      .slice(0, 8)
      .map((r, i) => `${i + 1}. *${r.staffName}* | ${r.resolved30d} resolved (30d) | first reply ${fmtSec(r.avgFirstResponseSec)} | ${r.openLoad} open`)
      .join("\n");
    await p.reply(clip(`*Staff performance (last 30 days)*\n\n${items}\n\n${p.hubBase}/dashboard/analytics`));
    return true;
  }

  const chatLookup = raw.match(/^(?:chat|history|messages|conversation)\s+(?:with\s+|of\s+)?(\+?\d[\d\s-]{8,14}\d)\W*$/i);
  if (chatLookup) {
    const digits = suffix10(chatLookup[1]);
    const c = await conv.execute({
      sql: `SELECT id, customer_name, customer_phone, status, assigned_staff_name, smart_category
            FROM conversations WHERE customer_phone LIKE ? ORDER BY last_message_at DESC LIMIT 1`,
      args: [`%${digits}`],
    });
    const row = c.rows[0];
    if (!row) {
      await p.reply(`Sir, there is no chat for *${chatLookup[1].trim()}*.`);
      return true;
    }
    const msgs = await conv.execute({
      sql: `SELECT direction, sender_name, body, created_at FROM messages
            WHERE conversation_id = ? AND direction IN ('INBOUND','OUTBOUND') ORDER BY created_at DESC LIMIT 6`,
      args: [String(row.id)],
    });
    const lines = [...msgs.rows]
      .reverse()
      .map((m) => `${String(m.direction) === "INBOUND" ? "Customer" : String(m.sender_name || "Team")}: ${String(m.body || "").replace(/\s+/g, " ").slice(0, 120)}`);
    await p.reply(
      clip(
        `*${String(row.customer_name || row.customer_phone)}* (${String(row.customer_phone)})\nWith: ${String(row.assigned_staff_name || "ACRIO")} | ${String(row.status)} | ${String(row.smart_category || "Enquiry")}\n\n*Last messages*\n${lines.join("\n")}\n\nOpen chat: ${p.hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(row.id))}`
      )
    );
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Entry point used by the inbound pipeline
// ---------------------------------------------------------------------------

/**
 * Handles everything the owner can say that is not a normal AI chat. Returns true when the message was fully handled.
 */
export async function handleOwnerDeskMessage(p: {
  conversationId: string;
  ownerPhone: string;
  text: string;
  currentWaMessageId?: string;
  replyToWaMessageId?: string;
  /** True when this message (or the burst it belongs to) carries a voice note, photo, video or file. */
  hasAttachment?: boolean;
  hubBase: string;
  logAssignment: LogAssignmentFn;
  reply: (text: string) => Promise<void>;
}): Promise<boolean> {
  const text = String(p.text || "").trim();
  if (!text) return false;
  const ownerName = ownerDisplayName();

  // 1. "please assign to @staff"
  const parsed = parseAssignCommand(text);
  if (parsed.found) {
    const result = await assignLeadFromOwner(parsed, {
      conversationId: p.conversationId,
      ownerPhone: p.ownerPhone,
      ownerName,
      text,
      currentWaMessageId: p.currentWaMessageId,
      replyToWaMessageId: p.replyToWaMessageId,
      hubBase: p.hubBase,
      logAssignment: p.logAssignment,
    });
    if (result.handled) {
      await p.reply(result.reply);
      return true;
    }
  }

  // 1b. A voice note, photo, video or file (with or without a caption) is part of an enquiry that is still being
  // sent. Keep it with the lead, never run the AI on it, and only acknowledge once so a burst of 3 files is not 3 replies.
  const isMediaDrop =
    Boolean(p.hasAttachment) || /^\[(?:image|document|video|voice note|audio)[^\]]*\]/im.test(text);
  if (isMediaDrop) {
    const recent = await getRawLibSqlClient("conversations")
      .execute({
        sql: `SELECT body, created_at FROM messages WHERE conversation_id = ? AND direction = 'OUTBOUND' ORDER BY created_at DESC LIMIT 1`,
        args: [p.conversationId],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const lastOut = recent.rows[0];
    const justAcknowledged =
      Boolean(lastOut) &&
      /keeping your voice notes/.test(String(lastOut.body || "")) &&
      Date.now() - new Date(String(lastOut.created_at)).getTime() < 90 * 1000;
    if (!justAcknowledged) {
      await p.reply(
        "Got it, sir. I am keeping your voice notes, photos and text together for this client. Send the rest, then say *please assign to <name>* or just *please assign*."
      );
    }
    return true;
  }

  // 2. Read-only owner commands
  if (await handleOwnerReadCommand({ text, hubBase: p.hubBase, reply: p.reply })) return true;

  // 3. A pasted enquiry: keep it quietly until the owner says who should get it. No AI call, no long reply.
  const looksLikeEnquiry =
    !/\?\s*$/.test(text) && (/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/.test(text) || text.length >= 120);
  if (looksLikeEnquiry) {
    await p.reply(
      "Got it, sir. Say *please assign to <name>* or just *please assign* and I will send it to the right person."
    );
    return true;
  }

  return false;
}
