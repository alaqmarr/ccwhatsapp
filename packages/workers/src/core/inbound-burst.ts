import { getRawLibSqlClient } from "@cc/database";
import type { CustomerImageAttachmentInput } from "@cc/connections";

export async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PendingBurstAttachments {
  images: number;
  documents: number;
  videos: number;
  audios: number;
  unreadable: number;
  imageItems: CustomerImageAttachmentInput[];
  nonImageItems: {
    mediaType: string;
    filename?: string;
    mimeType?: string;
    mediaId?: string;
    sha256?: string;
  }[];
}

/**
 * Loads all consecutive un-replied CUSTOMER inbound messages since the last OUTBOUND reply
 * so rapid multi-message bursts are coalesced into one clean turn.
 */
export async function loadPendingInboundBurst(
  conversationId: string,
  fallbackText: string
): Promise<{
  coalescedText: string;
  latestInboundId: string | null;
  latestInboundCreatedAt: string | null;
  count: number;
  burstAttachments: PendingBurstAttachments;
}> {
  const emptyAttachments: PendingBurstAttachments = {
    images: 0,
    documents: 0,
    videos: 0,
    audios: 0,
    unreadable: 0,
    imageItems: [],
    nonImageItems: [],
  };
  const conv = getRawLibSqlClient("conversations");
  const lastOutRes = await conv
    .execute({
      sql: `SELECT body, created_at FROM messages
            WHERE conversation_id = ? AND direction = 'OUTBOUND'
            ORDER BY created_at DESC LIMIT 2`,
      args: [conversationId],
    })
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));

  let lastOutIso = lastOutRes.rows[0]?.created_at
    ? String(lastOutRes.rows[0].created_at)
    : "";
  const lastOutBody = String(lastOutRes.rows[0]?.body || "");
  if (
    lastOutIso &&
    /^Noted\s+\*/i.test(lastOutBody.trim()) &&
    Date.now() - new Date(lastOutIso).getTime() <= 90_000
  ) {
    lastOutIso = lastOutRes.rows[1]?.created_at
      ? String(lastOutRes.rows[1].created_at)
      : "";
  }

  const pendingRes = await conv
    .execute({
      sql: lastOutIso
        ? `SELECT id, body, message_type, metadata_json, created_at FROM messages
           WHERE conversation_id = ? AND direction = 'INBOUND' AND sender_type = 'CUSTOMER' AND created_at > ?
           ORDER BY created_at ASC LIMIT 16`
        : `SELECT id, body, message_type, metadata_json, created_at FROM messages
           WHERE conversation_id = ? AND direction = 'INBOUND' AND sender_type = 'CUSTOMER'
           ORDER BY created_at ASC LIMIT 16`,
      args: lastOutIso ? [conversationId, lastOutIso] : [conversationId],
    })
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));

  if (pendingRes.rows.length === 0) {
    return {
      coalescedText: fallbackText,
      latestInboundId: null,
      latestInboundCreatedAt: null,
      count: 0,
      burstAttachments: emptyAttachments,
    };
  }

  const textLines: string[] = [];
  const allLines: string[] = [];
  const burstAttachments: PendingBurstAttachments = {
    images: 0,
    documents: 0,
    videos: 0,
    audios: 0,
    unreadable: 0,
    imageItems: [],
    nonImageItems: [],
  };

  for (const r of pendingRes.rows) {
    const t = String(r.body || "").trim();
    const mType = String(r.message_type || "").toUpperCase();
    let rowMeta: Record<string, any> = {};
    if (r.metadata_json) {
      try {
        rowMeta = JSON.parse(String(r.metadata_json));
      } catch {
        rowMeta = {};
      }
    }
    const mediaObj =
      rowMeta.media && typeof rowMeta.media === "object"
        ? (rowMeta.media as Record<string, any>)
        : {};
    const mediaId = String(
      mediaObj.mediaId || mediaObj.media_id || rowMeta.mediaId || rowMeta.media_id || ""
    ).trim();
    const mimeType = String(
      mediaObj.mimeType || mediaObj.mime_type || rowMeta.mimeType || rowMeta.mime_type || ""
    ).trim();
    const filename = String(mediaObj.filename || rowMeta.filename || "").trim();
    const caption = String(mediaObj.caption || rowMeta.caption || "").trim();
    const sha256 = String(mediaObj.sha256 || rowMeta.sha256 || "").trim();
    const isSticker = Boolean(mediaObj.isSticker || rowMeta.isSticker || /^\[sticker\b/i.test(t));

    if (mType === "IMAGE" || /^\[(?:image|photo|picture|sticker)\b[^\]]*\]$/i.test(t)) {
      if (!isSticker) {
        burstAttachments.images++;
        if (mediaId || mimeType || filename || sha256) {
          burstAttachments.imageItems.push({
            mediaId: mediaId || undefined,
            mimeType: mimeType || undefined,
            filename: filename || undefined,
            caption: caption || undefined,
            sha256: sha256 || undefined,
            isSticker: false,
          });
        }
      }
    } else if (mType === "DOCUMENT" || /^\[(?:document|pdf|file)\b[^\]]*\]$/i.test(t)) {
      burstAttachments.documents++;
      burstAttachments.nonImageItems.push({
        mediaType: "DOCUMENT",
        filename: filename || undefined,
        mimeType: mimeType || undefined,
        mediaId: mediaId || undefined,
        sha256: sha256 || undefined,
      });
    } else if (mType === "VIDEO" || /^\[(?:video)\b[^\]]*\]$/i.test(t)) {
      burstAttachments.videos++;
      burstAttachments.nonImageItems.push({
        mediaType: "VIDEO",
        filename: filename || undefined,
        mimeType: mimeType || undefined,
        mediaId: mediaId || undefined,
        sha256: sha256 || undefined,
      });
    } else if (mType === "AUDIO" || /^\[(?:audio|voice\s*note)\b[^\]]*\]$/i.test(t)) {
      burstAttachments.audios++;
      burstAttachments.nonImageItems.push({
        mediaType: "AUDIO",
        filename: filename || undefined,
        mimeType: mimeType || undefined,
        mediaId: mediaId || undefined,
        sha256: sha256 || undefined,
      });
    } else if (
      rowMeta.unsupportedAttachment ||
      /^\[unsupported\b[^\]]*\]$/i.test(t)
    ) {
      burstAttachments.unreadable++;
      burstAttachments.nonImageItems.push({
        mediaType: "UNSUPPORTED",
        filename: filename || undefined,
        mimeType: mimeType || (rowMeta.rawWaType ? `whatsapp/${String(rowMeta.rawWaType)}` : undefined),
        mediaId: mediaId || undefined,
        sha256: sha256 || undefined,
      });
    } else if (/^\[(?:message|media|attachment)\b[^\]]*\]$/i.test(t)) {
      burstAttachments.unreadable++;
    }

    if (!t) continue;
    if (allLines[allLines.length - 1] !== t) {
      allLines.push(t);
    }
    const isBarePlaceholder =
      /^\[(?:image|photo|picture|sticker|document|pdf|file|video|audio|voice\s*note|message|media|attachment|unsupported(?:\s+attachment)?)\b[^\]]*\]$/i.test(
        t
      );
    if (!isBarePlaceholder && textLines[textLines.length - 1] !== t) {
      textLines.push(t);
    }
  }
  const latest = pendingRes.rows[pendingRes.rows.length - 1];
  const coalescedText =
    (textLines.length > 0 ? textLines.join("\n").trim() : allLines.join("\n").trim()) ||
    fallbackText;
  return {
    coalescedText,
    latestInboundId: latest?.id ? String(latest.id) : null,
    latestInboundCreatedAt: latest?.created_at ? String(latest.created_at) : null,
    count: pendingRes.rows.length,
    burstAttachments,
  };
}
