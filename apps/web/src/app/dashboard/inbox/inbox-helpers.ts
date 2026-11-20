import {
  formatDateTimeShortIst,
  formatThreadTimeIst,
  TRACKING_PUBLIC_ORIGIN,
} from "@cc/ui";
import {
  extractMessageMedia,
  type NormalizedMessageMedia,
} from "@/components/MediaAttachmentTools";
import type {
  ChatMessage,
  CustomerSharedMediaRecord,
  QuotedMessageRef,
} from "@/lib/inbox-server-data";

/** Toast text after saving a note: says who was pinged and whether ACRIO is answering. */
export function describeNoteResult(data: {
  mentioned?: { id: string; name: string }[];
  askedAcrio?: boolean;
  accidentalReplyDetected?: boolean;
}): string {
  if (data?.accidentalReplyDetected) {
    return "Heads up: Saved as an Internal Note, not a WhatsApp reply! Click 'Send in Chat' on the note to send it to the customer.";
  }
  const parts = ["Internal note saved."];
  const names = (data?.mentioned || []).map((m) => m.name);
  if (names.length > 0) parts.push(`Pinged ${names.join(", ")}.`);
  if (data?.askedAcrio) parts.push("ACRIO will answer in a private note shortly.");
  return parts.join(" ");
}

/** Builds a merged corrected customer quote when a short note ("sorry 3mm thickness") corrects a quoted outbound message. */
export function buildClientMergedCorrection(noteText: string, refBody: string): string | null {
  const cleanNote = String(noteText || "").trim();
  const cleanRef = String(refBody || "").trim();
  if (!cleanNote || !cleanRef || cleanNote.toLowerCase() === cleanRef.toLowerCase()) return null;

  const noteDim = cleanNote.match(/\b(\d+(?:\.\d+)?\s*(?:mm|cm|inch|inches|in|ft))(?:\s*(thickness|thick))?\b/i);
  const refDim = cleanRef.match(/\b(\d+(?:\.\d+)?\s*(?:mm|cm|inch|inches|in|ft))(?:\s*(thickness|thick))?\b/i);
  if (
    noteDim &&
    refDim &&
    noteDim[1].replace(/\s+/g, "").toLowerCase() !== refDim[1].replace(/\s+/g, "").toLowerCase()
  ) {
    const newDim = noteDim[2]
      ? `${noteDim[1]} ${noteDim[2]}`
      : refDim[2]
      ? `${noteDim[1]} ${refDim[2]}`
      : noteDim[1];
    const replaced = cleanRef.replace(refDim[0], newDim).replace(/[,;\s]+$/, "");
    return /^sorry\b/i.test(cleanNote) && !/^sorry\b/i.test(replaced)
      ? `Sorry, ${replaced}`
      : replaced;
  }
  return null;
}

/** True when the text mentions @ACRIO or a teammate by name. */
export function hasTeamMention(text: string, people: { name: string }[]): boolean {
  const names = ["ACRIO", ...people.map((p) => p.name)];
  return names.some((name) => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[\\s(])@${esc}(?![A-Za-z0-9_])`, "i").test(text);
  });
}

/**
 * True whenever the user writes an @mention or starts an @note trigger
 * (ignores email addresses such as name@domain.com because @ must follow start/space/paren).
 */
export function shouldRouteTextAsInternalNote(
  text: string,
  people: { name: string }[]
): boolean {
  return (
    hasTeamMention(text, people) || /(^|[\s(])@[A-Za-z0-9._-]*/.test(text)
  );
}

/** Makes @ACRIO and @Teammate names bold inside note text. */
export function emphasizeMentions(text: string, people: { name: string }[]): string {
  let out = text;
  const names = ["ACRIO", ...people.map((p) => p.name)].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(`(^|[\\s(])@${esc}(?![A-Za-z0-9_])`, "gi"),
      (_m, lead) => `${lead}*@${name}*`
    );
  }
  return out;
}

export interface MessageCtaButton {
  label: string;
  url: string;
  footerText?: string | null;
  orderId?: string | null;
  providerName?: string | null;
  awbNumber?: string | null;
}

export function extractCtaButton(m: ChatMessage): MessageCtaButton | null {
  const raw = m.metadata?.ctaButton;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const label = String(obj.label || "").trim();
  const url = String(obj.url || "").trim();
  if (!label || !url) return null;
  return {
    label,
    url,
    footerText: obj.footerText ? String(obj.footerText) : null,
    orderId: obj.orderId ? String(obj.orderId) : null,
    providerName: obj.providerName ? String(obj.providerName) : null,
    awbNumber: obj.awbNumber ? String(obj.awbNumber) : null,
  };
}

export interface MessageLocationPin {
  latitude: number;
  longitude: number;
  name: string;
  address: string;
  mapsUrl: string;
}

export function extractLocationPin(m: ChatMessage): MessageLocationPin | null {
  const raw = m.metadata?.locationPin;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const lat = Number(obj.latitude);
  const lng = Number(obj.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    latitude: lat,
    longitude: lng,
    name: String(obj.name || "Classic Concepts Acrylic Private Limited").trim(),
    address: String(obj.address || "").trim(),
    mapsUrl: String(obj.mapsUrl || `https://maps.google.com/?q=${lat},${lng}`).trim(),
  };
}

export function extractQuotedReply(m: ChatMessage): QuotedMessageRef | null {
  const raw = m.metadata?.replyTo;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const body = String(obj.body || "").trim();
  if (!body) return null;
  return {
    messageId: obj.messageId ? String(obj.messageId) : null,
    waMessageId: obj.waMessageId ? String(obj.waMessageId) : null,
    senderName: String(obj.senderName || "Message"),
    senderType: obj.senderType ? String(obj.senderType) : "",
    direction: obj.direction ? String(obj.direction) : "",
    body,
  };
}

export function formatShortThreadTime(iso: string, serverNowMs?: number): string {
  return formatThreadTimeIst(iso, serverNowMs);
}

export function formatWindowCountdown(
  expiresIso: string | null,
  nowMs: number
): { open: boolean; label: string } {
  if (!expiresIso) {
    return { open: false, label: "Chat window expired" };
  }
  const diffMs = new Date(expiresIso).getTime() - nowMs;
  if (Number.isNaN(diffMs) || diffMs <= 0) {
    return { open: false, label: "Chat window expired" };
  }
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const timeText =
    hours > 0
      ? `${hours}h ${minutes}m`
      : `${Math.max(1, minutes)}m`;
  return {
    open: true,
    label: `Chat window expires in ${timeText}`,
  };
}

export function formatWaitingDuration(
  waitingSinceIso: string | null,
  nowMs: number
): { minutes: number; text: string } | null {
  if (!waitingSinceIso) return null;
  const start = new Date(waitingSinceIso).getTime();
  if (Number.isNaN(start)) return null;
  const elapsedSec = Math.max(0, Math.floor((nowMs - start) / 1000));
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return { minutes: mins, text: `${hrs}h ${remMins}m` };
  }
  if (mins > 0) {
    return { minutes: mins, text: `${mins}m ${secs}s` };
  }
  return { minutes: 0, text: `${secs}s` };
}

export function formatResponseSpeed(seconds: number | null): string | null {
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function formatDateTimeShort(iso: string | null | undefined): string {
  return formatDateTimeShortIst(iso);
}

export const CANNED_QUICK_REPLIES = [
  {
    cmd: "/welcome",
    title: "Warm Welcome",
    body: "Hello! Thank you for reaching out to Classic Concepts. Please share the product, size, and quantity you need so we can send pricing right away.",
  },
  {
    cmd: "/podiums",
    title: "Acrylic Podiums Info",
    body: "We make clear, frosted, and LED-lit acrylic podiums in standard and custom heights, with logo engraving and safe wooden crate shipping across India. How many podiums do you need?",
  },
  {
    cmd: "/awards",
    title: "Awards & Mementos",
    body: "We make custom acrylic awards, plaques, and corporate mementos with UV printing or laser engraving. Share your event date, quantity, and logo to get design options.",
  },
  {
    cmd: "/machines",
    title: "Classic Edge 53 Machines",
    body: "We supply Classic Edge 53 diamond polishing machines, flame polishers, acrylic benders, and genuine diamond tools across India. Which sheet thickness and daily volume are you working with?",
  },
  {
    cmd: "/custom",
    title: "Custom Size Quote",
    body: "Sure, we make custom sizes and thicknesses in our Hyderabad workshop. Please share the length x width x height, thickness (mm), and quantity needed.",
  },
  {
    cmd: "/track",
    title: "Order Tracking Portal",
    body: `You can check live dispatch and courier tracking anytime at ${TRACKING_PUBLIC_ORIGIN}. You can also reply here with your order number and I will pull the latest update.`,
  },
  {
    cmd: "/gst",
    title: "GST Billing & Dispatch",
    body: "Yes, we provide a full GST tax invoice on all orders. Kindly share your company GSTIN, billing address, and delivery pincode to prepare the proforma invoice.",
  },
] as const;

export function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "CC";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function vaultItemToPreviewMedia(
  item: CustomerSharedMediaRecord
): NormalizedMessageMedia | null {
  if (item.itemKind === "LOCATION" || !item.mediaUrl) return null;
  return {
    mediaType: item.itemKind,
    url: item.mediaUrl,
    downloadUrl: item.downloadUrl || item.mediaUrl,
    fileName: item.title || item.itemKind.toLowerCase(),
    mimeType: item.mimeType || "",
    sizeBytes: item.fileSizeBytes ?? null,
    productName: null,
    variantName: null,
  };
}

export function mergeChatAndVaultSharedMedia(
  messages: ChatMessage[],
  vaultItems: CustomerSharedMediaRecord[] | undefined,
  customerPhone: string
): CustomerSharedMediaRecord[] {
  const byKey = new Map<string, CustomerSharedMediaRecord>();
  const dedupKey = (rec: CustomerSharedMediaRecord) => {
    if (rec.waMediaId) return `wa:${rec.waMediaId}`;
    if (rec.localMediaId) return `loc:${rec.localMediaId}`;
    if (rec.mediaUrl && rec.mediaUrl.startsWith("/api/media/")) {
      return `url:${rec.mediaUrl.split("?")[0]}`;
    }
    if (rec.itemKind === "LOCATION" && rec.mapsUrl) return `map:${rec.mapsUrl}`;
    if (rec.messageId) return `msg:${rec.messageId}:${rec.itemKind}`;
    return `id:${rec.id}`;
  };

  for (const v of vaultItems || []) {
    byKey.set(dedupKey(v), v);
  }

  for (const m of messages) {
    if (m.messageType === "INTERNAL_NOTE") continue;
    const isOutbound = m.direction === "OUTBOUND";
    const sourceType = isOutbound ? "STAFF_SHARED" : "CLIENT_DIRECT";
    const sourceLabel = isOutbound
      ? `Sent by ${m.senderName || "Staff"}`
      : `Sent by ${m.senderName || "Client"}`;

    const med = extractMessageMedia(m);
    if (med) {
      const extractedId = med.url.startsWith("/api/media/")
        ? decodeURIComponent(med.url.replace("/api/media/", "").split("?")[0])
        : null;
      const rec: CustomerSharedMediaRecord = {
        id: `live_med_${m.id}`,
        customerPhone,
        conversationId: null,
        messageId: m.id,
        waMediaId: extractedId,
        localMediaId: extractedId,
        mediaUrl: med.url,
        downloadUrl: med.downloadUrl,
        itemKind: med.mediaType,
        title: med.fileName,
        caption: /^\[(?:image|video|document|audio|voice note)\]$/i.test(m.body.trim())
          ? ""
          : m.body.trim(),
        mimeType: med.mimeType,
        fileSizeBytes: med.sizeBytes,
        latitude: null,
        longitude: null,
        locationAddress: "",
        mapsUrl: "",
        sourceType,
        sourceLabel,
        receivedViaPhone: "",
        receivedViaName: m.senderName || "",
        assignedStaffId: null,
        assignedStaffName: null,
        leadContext: "",
        createdAt: m.createdAt,
      };
      const k = dedupKey(rec);
      if (!byKey.has(k)) byKey.set(k, rec);
    }

    const pin = extractLocationPin(m);
    if (pin) {
      const rec: CustomerSharedMediaRecord = {
        id: `live_loc_${m.id}`,
        customerPhone,
        conversationId: null,
        messageId: m.id,
        waMediaId: null,
        localMediaId: null,
        mediaUrl: null,
        downloadUrl: null,
        itemKind: "LOCATION",
        title: pin.name,
        caption: pin.address,
        mimeType: "",
        fileSizeBytes: null,
        latitude: pin.latitude,
        longitude: pin.longitude,
        locationAddress: pin.address,
        mapsUrl: pin.mapsUrl,
        sourceType,
        sourceLabel,
        receivedViaPhone: "",
        receivedViaName: m.senderName || "",
        assignedStaffId: null,
        assignedStaffName: null,
        leadContext: "",
        createdAt: m.createdAt,
      };
      const k = dedupKey(rec);
      if (!byKey.has(k)) byKey.set(k, rec);
    }
  }

  return Array.from(byKey.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}
