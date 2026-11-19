import crypto from "node:crypto";
import { getRawLibSqlClient, normalizeWhatsAppPhone } from "@cc/database";
import { prepareInboundMediaForForward, sendWhatsAppCloudMessage } from "@cc/connections";
import { socketHub } from "@cc/sockets";
import { ensureLeadForwardsTable } from "./desk-data";
import { KIND_LABEL, MEDIA_PLACEHOLDER_RE, parseAssignCommand } from "./identity-and-parse";
import { fmtTime, ownerDisplayName, suffix10, type LeadItem, type LeadItemKind } from "./types";

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
export async function collectLeadItems(p: {
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

export function describeAttachments(items: LeadItem[]): string {
  const counts = new Map<LeadItemKind, number>();
  for (const it of items) if (it.kind !== "TEXT") counts.set(it.kind, (counts.get(it.kind) || 0) + 1);
  return [...counts.entries()]
    .map(([k, n]) => `${n} ${KIND_LABEL[k][n === 1 ? 0 : 1]}`)
    .join(", ");
}

export function leadTextOf(items: LeadItem[]): string {
  return items
    .filter((i) => i.kind === "TEXT")
    .map((i) => i.text)
    .join("\n\n")
    .slice(0, 3500);
}

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
export async function deliverLeadBundle(p: {
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
