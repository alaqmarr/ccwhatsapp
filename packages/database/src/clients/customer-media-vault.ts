import crypto from "node:crypto";
import { normalizeWhatsAppPhone } from "./contacts-sync";
import { getRawLibSqlClient } from "./handles";

export type CustomerSharedMediaKind =
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT"
  | "AUDIO"
  | "LOCATION";

export type CustomerSharedMediaSource =
  | "CLIENT_DIRECT"
  | "OWNER_FORWARD"
  | "CALL_QUEUE"
  | "STAFF_SHARED"
  | "STAFF_UPLOAD";

export interface CustomerSharedMediaRecord {
  id: string;
  customerPhone: string;
  conversationId: string | null;
  messageId: string | null;
  waMediaId: string | null;
  localMediaId: string | null;
  mediaUrl: string | null;
  downloadUrl: string | null;
  itemKind: CustomerSharedMediaKind;
  title: string;
  caption: string;
  mimeType: string;
  fileSizeBytes: number | null;
  latitude: number | null;
  longitude: number | null;
  locationAddress: string;
  mapsUrl: string;
  sourceType: CustomerSharedMediaSource;
  sourceLabel: string;
  receivedViaPhone: string;
  receivedViaName: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  leadContext: string;
  createdAt: string;
}

export interface UpsertCustomerSharedMediaInput {
  customerPhone: string;
  conversationId?: string | null;
  messageId?: string | null;
  waMediaId?: string | null;
  localMediaId?: string | null;
  mediaUrl?: string | null;
  itemKind: CustomerSharedMediaKind;
  title?: string;
  caption?: string;
  mimeType?: string;
  fileSizeBytes?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  locationAddress?: string;
  mapsUrl?: string;
  sourceType?: CustomerSharedMediaSource;
  sourceLabel?: string;
  receivedViaPhone?: string;
  receivedViaName?: string;
  assignedStaffId?: string | null;
  assignedStaffName?: string | null;
  leadContext?: string;
  createdAt?: string;
}

const MAPS_URL_RE =
  /https?:\/\/(?:maps\.google\.com|www\.google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)[^\s<>)"']+/gi;

export interface ParsedMapsLink {
  mapsUrl: string;
  latitude: number | null;
  longitude: number | null;
}

export function extractGoogleMapsLinksFromText(text: string): ParsedMapsLink[] {
  const matches = String(text || "").match(MAPS_URL_RE) || [];
  const seen = new Set<string>();
  const out: ParsedMapsLink[] = [];
  for (const rawUrl of matches) {
    const cleanUrl = rawUrl.replace(/[.,;!?]+$/, "");
    if (!cleanUrl || seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);
    const coordMatch =
      cleanUrl.match(/[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i) ||
      cleanUrl.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    const lat = coordMatch ? Number(coordMatch[1]) : null;
    const lng = coordMatch ? Number(coordMatch[2]) : null;
    out.push({
      mapsUrl: cleanUrl,
      latitude: lat !== null && Number.isFinite(lat) ? lat : null,
      longitude: lng !== null && Number.isFinite(lng) ? lng : null,
    });
  }
  return out;
}

function phoneSuffix10(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function resolvePhoneMatchVariants(rawPhone: string): {
  e164: string;
  suffix10: string;
} {
  const e164 = normalizeWhatsAppPhone(rawPhone) || String(rawPhone || "").trim();
  return { e164, suffix10: phoneSuffix10(e164) };
}

function phonesReferToSameClient(a: string, b: string): boolean {
  const va = resolvePhoneMatchVariants(a);
  const vb = resolvePhoneMatchVariants(b);
  if (va.e164 && vb.e164 && va.e164 === vb.e164) return true;
  return va.suffix10.length >= 10 && va.suffix10 === vb.suffix10;
}

let vaultTableReady: Promise<void> | null = null;
export function ensureCustomerSharedMediaTable(): Promise<void> {
  if (!vaultTableReady) {
    vaultTableReady = (async () => {
      const conv = getRawLibSqlClient("conversations");
      await conv.execute(`CREATE TABLE IF NOT EXISTS customer_shared_media (
        id TEXT PRIMARY KEY,
        customer_phone TEXT NOT NULL,
        conversation_id TEXT,
        message_id TEXT,
        wa_media_id TEXT,
        local_media_id TEXT,
        item_kind TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        caption TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL DEFAULT '',
        file_size_bytes INTEGER,
        latitude REAL,
        longitude REAL,
        location_address TEXT NOT NULL DEFAULT '',
        maps_url TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT 'CLIENT_DIRECT',
        source_label TEXT NOT NULL DEFAULT '',
        received_via_phone TEXT NOT NULL DEFAULT '',
        received_via_name TEXT NOT NULL DEFAULT '',
        assigned_staff_id TEXT,
        assigned_staff_name TEXT,
        lead_context TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`);
      await conv
        .execute(
          `CREATE INDEX IF NOT EXISTS idx_csm_phone_created ON customer_shared_media (customer_phone, created_at DESC)`
        )
        .catch(() => {});
      await conv
        .execute(
          `CREATE INDEX IF NOT EXISTS idx_csm_wa_media ON customer_shared_media (wa_media_id)`
        )
        .catch(() => {});
    })().catch((err) => {
      vaultTableReady = null;
      throw err;
    });
  }
  return vaultTableReady;
}

function normalizeKind(raw: string): CustomerSharedMediaKind {
  const upper = String(raw || "DOCUMENT").toUpperCase();
  if (
    upper === "IMAGE" ||
    upper === "VIDEO" ||
    upper === "DOCUMENT" ||
    upper === "AUDIO" ||
    upper === "LOCATION"
  ) {
    return upper;
  }
  if (upper === "LOCATION_CARD") return "LOCATION";
  return "DOCUMENT";
}

function buildApiMediaUrls(mediaId: string | null, fileName?: string): {
  mediaUrl: string | null;
  downloadUrl: string | null;
} {
  if (!mediaId) return { mediaUrl: null, downloadUrl: null };
  const enc = encodeURIComponent(mediaId);
  const fn = fileName ? `&filename=${encodeURIComponent(fileName)}` : "";
  return {
    mediaUrl: `/api/media/${enc}`,
    downloadUrl: `/api/media/${enc}?download=1${fn}`,
  };
}

function mapVaultRow(r: Record<string, unknown>): CustomerSharedMediaRecord {
  const kind = normalizeKind(String(r.item_kind || "DOCUMENT"));
  const mediaId =
    (r.local_media_id ? String(r.local_media_id).trim() : "") ||
    (r.wa_media_id ? String(r.wa_media_id).trim() : "") ||
    null;
  const title = String(r.title || "").trim();
  const { mediaUrl, downloadUrl } =
    kind === "LOCATION"
      ? { mediaUrl: null, downloadUrl: null }
      : buildApiMediaUrls(mediaId, title || undefined);

  return {
    id: String(r.id),
    customerPhone: String(r.customer_phone),
    conversationId: r.conversation_id ? String(r.conversation_id) : null,
    messageId: r.message_id ? String(r.message_id) : null,
    waMediaId: r.wa_media_id ? String(r.wa_media_id) : null,
    localMediaId: r.local_media_id ? String(r.local_media_id) : null,
    mediaUrl,
    downloadUrl,
    itemKind: kind,
    title:
      title ||
      (kind === "LOCATION"
        ? "Shared Location"
        : kind === "IMAGE"
        ? "Photo"
        : kind === "VIDEO"
        ? "Video"
        : kind === "AUDIO"
        ? "Voice Note"
        : "Document"),
    caption: String(r.caption || "").trim(),
    mimeType: String(r.mime_type || "").trim(),
    fileSizeBytes:
      r.file_size_bytes !== null && r.file_size_bytes !== undefined
        ? Number(r.file_size_bytes)
        : null,
    latitude:
      r.latitude !== null && r.latitude !== undefined ? Number(r.latitude) : null,
    longitude:
      r.longitude !== null && r.longitude !== undefined ? Number(r.longitude) : null,
    locationAddress: String(r.location_address || "").trim(),
    mapsUrl: String(r.maps_url || "").trim(),
    sourceType: (String(r.source_type || "CLIENT_DIRECT") as CustomerSharedMediaSource),
    sourceLabel: String(r.source_label || "Shared on WhatsApp").trim(),
    receivedViaPhone: String(r.received_via_phone || "").trim(),
    receivedViaName: String(r.received_via_name || "").trim(),
    assignedStaffId: r.assigned_staff_id ? String(r.assigned_staff_id) : null,
    assignedStaffName: r.assigned_staff_name ? String(r.assigned_staff_name) : null,
    leadContext: String(r.lead_context || "").trim(),
    createdAt: String(r.created_at),
  };
}

export async function upsertCustomerSharedMedia(
  input: UpsertCustomerSharedMediaInput
): Promise<CustomerSharedMediaRecord | null> {
  const normalizedPhone = normalizeWhatsAppPhone(input.customerPhone);
  if (!normalizedPhone) return null;

  await ensureCustomerSharedMediaTable();
  const conv = getRawLibSqlClient("conversations");
  const nowIso = input.createdAt || new Date().toISOString();
  const kind = normalizeKind(input.itemKind);

  const waMediaId = String(input.waMediaId || "").trim() || null;
  const localMediaId = String(input.localMediaId || "").trim() || waMediaId;
  const messageId = String(input.messageId || "").trim() || null;
  const mapsUrl =
    String(input.mapsUrl || "").trim() ||
    (kind === "LOCATION" &&
    input.latitude !== null &&
    input.latitude !== undefined &&
    input.longitude !== null &&
    input.longitude !== undefined
      ? `https://maps.google.com/?q=${input.latitude},${input.longitude}`
      : "");

  const existingRes = await conv.execute({
    sql: `SELECT * FROM customer_shared_media
          WHERE customer_phone = ?
            AND (
              (? IS NOT NULL AND wa_media_id = ?)
              OR (? IS NOT NULL AND local_media_id = ?)
              OR (? IS NOT NULL AND message_id = ? AND item_kind = ?)
              OR (? = 'LOCATION' AND ? != '' AND maps_url = ?)
            )
          LIMIT 1`,
    args: [
      normalizedPhone,
      waMediaId,
      waMediaId,
      localMediaId,
      localMediaId,
      messageId,
      messageId,
      kind,
      kind,
      mapsUrl,
      mapsUrl,
    ],
  });

  if (existingRes.rows[0]) {
    const cur = existingRes.rows[0] as Record<string, unknown>;
    const existingId = String(cur.id);
    await conv.execute({
      sql: `UPDATE customer_shared_media
            SET conversation_id = COALESCE(NULLIF(conversation_id, ''), ?),
                local_media_id = COALESCE(NULLIF(local_media_id, ''), ?),
                wa_media_id = COALESCE(NULLIF(wa_media_id, ''), ?),
                title = CASE WHEN TRIM(title) = '' OR title IN ('Photo','Video','Document','Shared Location') THEN COALESCE(NULLIF(?, ''), title) ELSE title END,
                caption = CASE WHEN TRIM(caption) = '' THEN ? ELSE caption END,
                lead_context = CASE WHEN TRIM(lead_context) = '' THEN ? ELSE lead_context END,
                location_address = CASE WHEN TRIM(location_address) = '' THEN ? ELSE location_address END,
                assigned_staff_id = COALESCE(?, assigned_staff_id),
                assigned_staff_name = COALESCE(NULLIF(?, ''), assigned_staff_name)
            WHERE id = ?`,
      args: [
        input.conversationId || null,
        localMediaId,
        waMediaId,
        String(input.title || "").trim(),
        String(input.caption || "").trim(),
        String(input.leadContext || "").trim(),
        String(input.locationAddress || "").trim(),
        input.assignedStaffId || null,
        String(input.assignedStaffName || "").trim(),
        existingId,
      ],
    });
    const refreshed = await conv.execute({
      sql: `SELECT * FROM customer_shared_media WHERE id = ? LIMIT 1`,
      args: [existingId],
    });
    return refreshed.rows[0]
      ? mapVaultRow(refreshed.rows[0] as Record<string, unknown>)
      : null;
  }

  const id = `csm_${crypto.randomUUID().slice(0, 12)}`;
  await conv.execute({
    sql: `INSERT INTO customer_shared_media (
      id, customer_phone, conversation_id, message_id, wa_media_id, local_media_id,
      item_kind, title, caption, mime_type, file_size_bytes,
      latitude, longitude, location_address, maps_url,
      source_type, source_label, received_via_phone, received_via_name,
      assigned_staff_id, assigned_staff_name, lead_context, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      normalizedPhone,
      input.conversationId || null,
      messageId,
      waMediaId,
      localMediaId,
      kind,
      String(input.title || "").trim().slice(0, 200),
      String(input.caption || "").trim().slice(0, 1200),
      String(input.mimeType || "").trim(),
      input.fileSizeBytes ?? null,
      input.latitude ?? null,
      input.longitude ?? null,
      String(input.locationAddress || "").trim().slice(0, 400),
      mapsUrl.slice(0, 600),
      input.sourceType || "CLIENT_DIRECT",
      String(input.sourceLabel || "Shared on WhatsApp").trim().slice(0, 160),
      String(input.receivedViaPhone || "").trim(),
      String(input.receivedViaName || "").trim(),
      input.assignedStaffId || null,
      input.assignedStaffName || null,
      String(input.leadContext || "").trim().slice(0, 1200),
      nowIso,
    ],
  });

  const inserted = await conv.execute({
    sql: `SELECT * FROM customer_shared_media WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return inserted.rows[0]
    ? mapVaultRow(inserted.rows[0] as Record<string, unknown>)
    : null;
}

export async function recordCustomerSharedMediaBatch(
  items: UpsertCustomerSharedMediaInput[]
): Promise<CustomerSharedMediaRecord[]> {
  const saved: CustomerSharedMediaRecord[] = [];
  for (const item of items) {
    const row = await upsertCustomerSharedMedia(item).catch(() => null);
    if (row) saved.push(row);
  }
  return saved;
}

function makeDedupKey(rec: CustomerSharedMediaRecord): string {
  if (rec.waMediaId) return `wa:${rec.waMediaId}`;
  if (rec.localMediaId) return `loc:${rec.localMediaId}`;
  if (rec.itemKind === "LOCATION" && rec.mapsUrl) return `map:${rec.mapsUrl}`;
  if (
    rec.itemKind === "LOCATION" &&
    rec.latitude !== null &&
    rec.longitude !== null
  ) {
    return `geo:${rec.latitude.toFixed(5)},${rec.longitude.toFixed(5)}`;
  }
  if (rec.messageId) return `msg:${rec.messageId}:${rec.itemKind}`;
  return `id:${rec.id}`;
}

export async function listCustomerSharedMediaForCustomer(params: {
  customerPhone: string;
  conversationId?: string | null;
}): Promise<CustomerSharedMediaRecord[]> {
  const normalizedPhone = normalizeWhatsAppPhone(params.customerPhone);
  const sfx = phoneSuffix10(normalizedPhone || params.customerPhone);
  if (!normalizedPhone && sfx.length < 10) return [];

  await ensureCustomerSharedMediaTable();
  const conv = getRawLibSqlClient("conversations");

  const [vaultRes, convRowsRes, fwRes, cqRes] = await Promise.all([
    conv
      .execute({
        sql: `SELECT * FROM customer_shared_media
              WHERE customer_phone = ? OR (? != '' AND customer_phone LIKE ?)
              ORDER BY created_at DESC
              LIMIT 250`,
        args: [normalizedPhone || params.customerPhone, sfx, `%${sfx}`],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    conv
      .execute({
        sql: `SELECT id FROM conversations
              WHERE customer_phone = ? OR (? != '' AND customer_phone LIKE ?)`,
        args: [normalizedPhone || params.customerPhone, sfx, `%${sfx}`],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    conv
      .execute(
        `SELECT id, owner_phone, owner_name, staff_id, staff_name, lead_text, customer_phone, media_json, created_at
         FROM lead_forwards
         ORDER BY created_at DESC
         LIMIT 200`
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    conv
      .execute(
        `SELECT id, customer_phone, source, product_topic, notes, recording_url, recording_file_name, recording_mime_type, attachment_url, attachment_name, submitted_by_name, assigned_staff_id, assigned_staff_name, created_at
         FROM call_dispatch_queue
         ORDER BY created_at DESC
         LIMIT 120`
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] })),
  ]);

  const byKey = new Map<string, CustomerSharedMediaRecord>();
  const addUnique = (rec: CustomerSharedMediaRecord) => {
    const k = makeDedupKey(rec);
    if (!byKey.has(k)) byKey.set(k, rec);
  };

  for (const r of vaultRes.rows) {
    addUnique(mapVaultRow(r as Record<string, unknown>));
  }

  // Fallback backfill from messages across ALL conversations matching this phone (e.g. older history or multiple threads)
  const convIds = Array.from(
    new Set([
      ...(params.conversationId ? [params.conversationId] : []),
      ...convRowsRes.rows.map((r) => String(r.id)),
    ])
  ).filter(Boolean);

  if (convIds.length > 0) {
    const ph = convIds.map(() => "?").join(",");
    const msgRes = await conv
      .execute({
        sql: `SELECT id, conversation_id, direction, sender_type, sender_name, message_type, body, metadata_json, wa_message_id, created_at
              FROM messages
              WHERE conversation_id IN (${ph})
                AND message_type != 'INTERNAL_NOTE'
                AND (
                  message_type IN ('IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO', 'LOCATION', 'LOCATION_CARD')
                  OR metadata_json LIKE '%media%'
                  OR metadata_json LIKE '%locationPin%'
                  OR body LIKE '%maps.google.com%'
                  OR body LIKE '%google.com/maps%'
                  OR body LIKE '%maps.app.goo.gl%'
                )
              ORDER BY created_at DESC
              LIMIT 200`,
        args: convIds,
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));

    for (const m of msgRes.rows) {
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(String(m.metadata_json || "{}"));
      } catch {
        meta = {};
      }
      const nested =
        meta.media && typeof meta.media === "object"
          ? (meta.media as Record<string, unknown>)
          : {};
      const mediaId = String(
        meta.mediaId || meta.media_id || nested.mediaId || nested.media_id || ""
      ).trim();
      const rawUrl = String(
        meta.mediaUrl ||
          meta.imageUrl ||
          nested.downloadUrl ||
          nested.download_url ||
          ""
      ).trim();
      const createdAt = String(m.created_at);
      const bodyStr = String(m.body || "").trim();
      const isOutbound = String(m.direction) === "OUTBOUND";
      const sourceType: CustomerSharedMediaSource = isOutbound
        ? "STAFF_SHARED"
        : "CLIENT_DIRECT";
      const sourceLabel = isOutbound
        ? `Sent by ${String(m.sender_name || "Staff")}`
        : `Sent by ${String(m.sender_name || "Client")}`;

      if (mediaId || rawUrl) {
        const msgType = String(m.message_type || "DOCUMENT").toUpperCase();
        const kind: CustomerSharedMediaKind =
          msgType === "IMAGE" ||
          msgType === "VIDEO" ||
          msgType === "AUDIO" ||
          msgType === "DOCUMENT"
            ? msgType
            : "DOCUMENT";
        const title = String(
          meta.fileName ||
            meta.filename ||
            nested.filename ||
            meta.productName ||
            kind
        ).trim();
        const extractedId =
          mediaId ||
          (rawUrl.startsWith("/api/media/")
            ? decodeURIComponent(rawUrl.replace("/api/media/", "").split("?")[0])
            : "");
        const apiUrls = buildApiMediaUrls(extractedId || null, title);
        addUnique({
          id: `msg_${String(m.id)}`,
          customerPhone: normalizedPhone || params.customerPhone,
          conversationId: String(m.conversation_id),
          messageId: String(m.id),
          waMediaId: mediaId || null,
          localMediaId: extractedId || null,
          mediaUrl: apiUrls.mediaUrl || rawUrl || null,
          downloadUrl: apiUrls.downloadUrl || rawUrl || null,
          itemKind: kind,
          title,
          caption: /^\[(?:image|video|document|audio|voice note)\]$/i.test(bodyStr)
            ? ""
            : bodyStr,
          mimeType: String(
            meta.mimeType || meta.mime_type || nested.mimeType || nested.mime_type || ""
          ),
          fileSizeBytes:
            typeof meta.sizeBytes === "number" ? meta.sizeBytes : null,
          latitude: null,
          longitude: null,
          locationAddress: "",
          mapsUrl: "",
          sourceType,
          sourceLabel,
          receivedViaPhone: "",
          receivedViaName: String(m.sender_name || ""),
          assignedStaffId: null,
          assignedStaffName: null,
          leadContext: "",
          createdAt,
        });
      }

      if (meta.locationPin && typeof meta.locationPin === "object") {
        const pin = meta.locationPin as Record<string, unknown>;
        const lat = Number(pin.latitude);
        const lng = Number(pin.longitude);
        const mapsUrl = String(
          pin.mapsUrl ||
            (Number.isFinite(lat) && Number.isFinite(lng)
              ? `https://maps.google.com/?q=${lat},${lng}`
              : "")
        ).trim();
        if (mapsUrl || (Number.isFinite(lat) && Number.isFinite(lng))) {
          addUnique({
            id: `msgloc_${String(m.id)}`,
            customerPhone: normalizedPhone || params.customerPhone,
            conversationId: String(m.conversation_id),
            messageId: String(m.id),
            waMediaId: null,
            localMediaId: null,
            mediaUrl: null,
            downloadUrl: null,
            itemKind: "LOCATION",
            title: String(pin.name || "Shared Location").trim(),
            caption: bodyStr,
            mimeType: "",
            fileSizeBytes: null,
            latitude: Number.isFinite(lat) ? lat : null,
            longitude: Number.isFinite(lng) ? lng : null,
            locationAddress: String(pin.address || "").trim(),
            mapsUrl,
            sourceType,
            sourceLabel,
            receivedViaPhone: "",
            receivedViaName: String(m.sender_name || ""),
            assignedStaffId: null,
            assignedStaffName: null,
            leadContext: "",
            createdAt,
          });
        }
      } else {
        for (const [idx, link] of extractGoogleMapsLinksFromText(bodyStr).entries()) {
          addUnique({
            id: `msgmap_${String(m.id)}_${idx}`,
            customerPhone: normalizedPhone || params.customerPhone,
            conversationId: String(m.conversation_id),
            messageId: String(m.id),
            waMediaId: null,
            localMediaId: null,
            mediaUrl: null,
            downloadUrl: null,
            itemKind: "LOCATION",
            title: "Shared Map Link",
            caption: bodyStr,
            mimeType: "",
            fileSizeBytes: null,
            latitude: link.latitude,
            longitude: link.longitude,
            locationAddress: "",
            mapsUrl: link.mapsUrl,
            sourceType,
            sourceLabel,
            receivedViaPhone: "",
            receivedViaName: String(m.sender_name || ""),
            assignedStaffId: null,
            assignedStaffName: null,
            leadContext: "",
            createdAt,
          });
        }
      }
    }
  }

  // Fallback backfill from owner-desk lead_forwards matching this customer phone
  for (const fw of fwRes.rows) {
    if (!phonesReferToSameClient(String(fw.customer_phone || ""), params.customerPhone)) {
      continue;
    }
    const fwId = String(fw.id);
    const ownerName = String(fw.owner_name || "Owner");
    const staffName = String(fw.staff_name || "");
    const leadText = String(fw.lead_text || "").trim();
    const createdAt = String(fw.created_at);
    let mediaArr: Record<string, unknown>[] = [];
    try {
      const parsed = JSON.parse(String(fw.media_json || "[]"));
      if (Array.isArray(parsed)) mediaArr = parsed as Record<string, unknown>[];
    } catch {
      mediaArr = [];
    }

    for (const [idx, item] of mediaArr.entries()) {
      const kind = normalizeKind(String(item.kind || "DOCUMENT"));
      if (kind === "LOCATION") {
        const lat =
          item.latitude !== undefined && item.latitude !== null
            ? Number(item.latitude)
            : null;
        const lng =
          item.longitude !== undefined && item.longitude !== null
            ? Number(item.longitude)
            : null;
        const mapsUrl = String(
          item.mapsUrl ||
            (lat !== null && lng !== null
              ? `https://maps.google.com/?q=${lat},${lng}`
              : "")
        ).trim();
        addUnique({
          id: `fw_${fwId}_${idx}`,
          customerPhone: normalizedPhone || params.customerPhone,
          conversationId: params.conversationId || null,
          messageId: null,
          waMediaId: null,
          localMediaId: null,
          mediaUrl: null,
          downloadUrl: null,
          itemKind: "LOCATION",
          title: String(item.locationName || "Client Location").trim(),
          caption: String(item.text || "").trim(),
          mimeType: "",
          fileSizeBytes: null,
          latitude: lat !== null && Number.isFinite(lat) ? lat : null,
          longitude: lng !== null && Number.isFinite(lng) ? lng : null,
          locationAddress: String(item.locationAddress || "").trim(),
          mapsUrl,
          sourceType: "OWNER_FORWARD",
          sourceLabel: `Forwarded by ${ownerName}`,
          receivedViaPhone: String(fw.owner_phone || ""),
          receivedViaName: ownerName,
          assignedStaffId: fw.staff_id ? String(fw.staff_id) : null,
          assignedStaffName: staffName || null,
          leadContext: leadText === "(attachments only)" ? "" : leadText.slice(0, 600),
          createdAt,
        });
      } else {
        const mid = String(item.mediaId || "").trim();
        if (!mid) continue;
        const fileName = String(item.fileName || kind).trim();
        const apiUrls = buildApiMediaUrls(mid, fileName);
        addUnique({
          id: `fw_${fwId}_${idx}`,
          customerPhone: normalizedPhone || params.customerPhone,
          conversationId: params.conversationId || null,
          messageId: null,
          waMediaId: mid,
          localMediaId: mid,
          mediaUrl: apiUrls.mediaUrl,
          downloadUrl: apiUrls.downloadUrl,
          itemKind: kind,
          title: fileName,
          caption: String(item.text || "").trim(),
          mimeType: String(item.mimeType || ""),
          fileSizeBytes: null,
          latitude: null,
          longitude: null,
          locationAddress: "",
          mapsUrl: "",
          sourceType: "OWNER_FORWARD",
          sourceLabel: `Forwarded by ${ownerName}`,
          receivedViaPhone: String(fw.owner_phone || ""),
          receivedViaName: ownerName,
          assignedStaffId: fw.staff_id ? String(fw.staff_id) : null,
          assignedStaffName: staffName || null,
          leadContext: leadText === "(attachments only)" ? "" : leadText.slice(0, 600),
          createdAt,
        });
      }
    }

    for (const [idx, link] of extractGoogleMapsLinksFromText(leadText).entries()) {
      addUnique({
        id: `fwmap_${fwId}_${idx}`,
        customerPhone: normalizedPhone || params.customerPhone,
        conversationId: params.conversationId || null,
        messageId: null,
        waMediaId: null,
        localMediaId: null,
        mediaUrl: null,
        downloadUrl: null,
        itemKind: "LOCATION",
        title: "Shared Map Link",
        caption: "",
        mimeType: "",
        fileSizeBytes: null,
        latitude: link.latitude,
        longitude: link.longitude,
        locationAddress: "",
        mapsUrl: link.mapsUrl,
        sourceType: "OWNER_FORWARD",
        sourceLabel: `Forwarded by ${ownerName}`,
        receivedViaPhone: String(fw.owner_phone || ""),
        receivedViaName: ownerName,
        assignedStaffId: fw.staff_id ? String(fw.staff_id) : null,
        assignedStaffName: staffName || null,
        leadContext: leadText.slice(0, 600),
        createdAt,
      });
    }
  }

  // Fallback from call_dispatch_queue attachments or recordings
  for (const cq of cqRes.rows) {
    if (!phonesReferToSameClient(String(cq.customer_phone || ""), params.customerPhone)) {
      continue;
    }
    const cqId = String(cq.id);
    const createdAt = String(cq.created_at);
    const submitter = String(cq.submitted_by_name || cq.source || "Desk");
    const contextText = [String(cq.product_topic || "").trim(), String(cq.notes || "").trim()]
      .filter(Boolean)
      .join(": ")
      .slice(0, 600);

    const recUrl = String(cq.recording_url || "").trim();
    if (recUrl) {
      const mid = recUrl.startsWith("/api/media/")
        ? decodeURIComponent(recUrl.replace("/api/media/", "").split("?")[0])
        : null;
      addUnique({
        id: `cqrec_${cqId}`,
        customerPhone: normalizedPhone || params.customerPhone,
        conversationId: params.conversationId || null,
        messageId: null,
        waMediaId: mid,
        localMediaId: mid,
        mediaUrl: recUrl,
        downloadUrl: mid ? buildApiMediaUrls(mid, String(cq.recording_file_name || "recording")).downloadUrl : recUrl,
        itemKind: "AUDIO",
        title: String(cq.recording_file_name || "Call Recording"),
        caption: String(cq.product_topic || "").trim(),
        mimeType: String(cq.recording_mime_type || "audio/mpeg"),
        fileSizeBytes: null,
        latitude: null,
        longitude: null,
        locationAddress: "",
        mapsUrl: "",
        sourceType: "CALL_QUEUE",
        sourceLabel: `Call Queue (${submitter})`,
        receivedViaPhone: "",
        receivedViaName: submitter,
        assignedStaffId: cq.assigned_staff_id ? String(cq.assigned_staff_id) : null,
        assignedStaffName: cq.assigned_staff_name ? String(cq.assigned_staff_name) : null,
        leadContext: contextText,
        createdAt,
      });
    }

    const attUrl = String(cq.attachment_url || "").trim();
    if (attUrl) {
      const mid = attUrl.startsWith("/api/media/")
        ? decodeURIComponent(attUrl.replace("/api/media/", "").split("?")[0])
        : null;
      addUnique({
        id: `cqatt_${cqId}`,
        customerPhone: normalizedPhone || params.customerPhone,
        conversationId: params.conversationId || null,
        messageId: null,
        waMediaId: mid,
        localMediaId: mid,
        mediaUrl: attUrl,
        downloadUrl: mid ? buildApiMediaUrls(mid, String(cq.attachment_name || "attachment")).downloadUrl : attUrl,
        itemKind: "DOCUMENT",
        title: String(cq.attachment_name || "Attached File"),
        caption: String(cq.product_topic || "").trim(),
        mimeType: "",
        fileSizeBytes: null,
        latitude: null,
        longitude: null,
        locationAddress: "",
        mapsUrl: "",
        sourceType: "CALL_QUEUE",
        sourceLabel: `Call Queue (${submitter})`,
        receivedViaPhone: "",
        receivedViaName: submitter,
        assignedStaffId: cq.assigned_staff_id ? String(cq.assigned_staff_id) : null,
        assignedStaffName: cq.assigned_staff_name ? String(cq.assigned_staff_name) : null,
        leadContext: contextText,
        createdAt,
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}
