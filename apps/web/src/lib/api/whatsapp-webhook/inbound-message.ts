import crypto from "node:crypto";
import { downloadAndPersistMetaMediaToDisk } from "@cc/connections";
import {
  extractGoogleMapsLinksFromText,
  getRawLibSqlClient,
  resolveInternalStaffCallerByPhone,
  upsertCustomerSharedMedia,
  upsertSyncedContact,
} from "@cc/database";
import { socketHub } from "@cc/sockets";
import { invalidateWhatsAppCacheTags } from "@cc/storage";
import {
  claimInboundWaMessageId,
  isOwnerWhatsAppPhone,
  logConversationAssignment,
  processInboundAutomations,
} from "@cc/workers";
import { parseInboundMessageContent } from "./parse-inbound";

async function ensureInboundCustomerAndContact(params: {
  e164: string;
  contactName: string;
  whatsappProfileName: string;
  nowIso: string;
}): Promise<string> {
  const { e164, contactName, whatsappProfileName, nowIso } = params;
  const crm = getRawLibSqlClient("crm_orders");

  const [existingCust] = await Promise.all([
    crm.execute({
      sql: `SELECT id FROM customers WHERE phone = ? LIMIT 1`,
      args: [e164],
    }),
    upsertSyncedContact({
      phone: e164,
      name: contactName,
      whatsappName: whatsappProfileName || undefined,
      source: "WHATSAPP_INBOUND",
      lastContactedAt: nowIso,
    }).catch(() => {}),
  ]);

  let custId = existingCust.rows[0] ? String(existingCust.rows[0].id) : "";
  if (!custId) {
    custId = `cust_${crypto.randomUUID().slice(0, 8)}`;
    await crm
      .execute({
        sql: `INSERT OR IGNORE INTO customers (id, phone, name, acrio_segment, last_interaction_at, created_at)
              VALUES (?, ?, ?, 'Inbound WhatsApp Lead', ?, ?)`,
        args: [custId, e164, contactName, nowIso, nowIso],
      })
      .catch(() => {});
  }

  return custId;
}

function buildInboundMessageMeta(
  contextWaId: string,
  orig: Record<string, unknown> | undefined,
  parsed: ReturnType<typeof parseInboundMessageContent>
): Record<string, unknown> {
  const metaObj: Record<string, unknown> = {};
  if (contextWaId) {
    let origMeta: Record<string, unknown> = {};
    if (orig?.metadata_json) {
      try {
        origMeta = JSON.parse(String(orig.metadata_json));
      } catch {
        origMeta = {};
      }
    }
    metaObj.replyTo = orig
      ? {
          messageId: String(orig.id),
          waMessageId: contextWaId,
          senderName: String(orig.sender_name || "Classic Concepts"),
          senderType: String(orig.sender_type || "STAFF"),
          direction: String(orig.direction || "OUTBOUND"),
          body: String(orig.body || "").slice(0, 380),
          productSlug: origMeta.productSlug ? String(origMeta.productSlug) : null,
          productName: origMeta.productName ? String(origMeta.productName) : null,
          variantName: origMeta.variantName ? String(origMeta.variantName) : null,
        }
      : {
          messageId: null,
          waMessageId: contextWaId,
          senderName: "Earlier WhatsApp message",
          senderType: "STAFF",
          direction: "OUTBOUND",
          body: "Customer replied to an earlier message on WhatsApp",
          productSlug: null,
          productName: null,
          variantName: null,
        };
  }

  if (parsed.mediaMeta) {
    const m = parsed.mediaMeta;
    metaObj.media = {
      media_id: m.mediaId,
      mime_type: m.mimeType,
      filename: m.filename,
      caption: m.caption,
      sha256: m.sha256,
      download_url: `/api/media/${m.mediaId}`,
      mediaId: m.mediaId,
      mimeType: m.mimeType,
      downloadUrl: `/api/media/${m.mediaId}`,
      isSticker: Boolean(m.isSticker),
    };
    metaObj.media_id = m.mediaId;
    metaObj.mediaId = m.mediaId;
    metaObj.mime_type = m.mimeType;
    metaObj.mimeType = m.mimeType;
    if (m.filename) metaObj.filename = m.filename;
    if (m.caption) metaObj.caption = m.caption;
    if (m.sha256) metaObj.sha256 = m.sha256;
    if (m.isSticker) metaObj.isSticker = true;
  } else if (parsed.locationPin) {
    metaObj.locationPin = parsed.locationPin;
  } else if (parsed.isUnsupportedMessage) {
    metaObj.unsupportedAttachment = true;
    metaObj.rawWaType = parsed.rawType || "unsupported";
    if (parsed.unsupportedReason) {
      metaObj.unsupportedReason = parsed.unsupportedReason;
    }
  } else if (parsed.reactionEmoji !== undefined) {
    metaObj.reaction = {
      emoji: parsed.reactionEmoji,
      messageId: parsed.reactionTargetWaId || null,
    };
  }

  return metaObj;
}

export async function handleInboundMessage(
  msg: any,
  contacts: any[],
  nowIso: string
): Promise<void> {
  const inboundWaMessageId = String(msg?.id || "").trim();
  if (inboundWaMessageId) {
    const isFirstDelivery = await claimInboundWaMessageId(inboundWaMessageId);
    if (!isFirstDelivery) return;
  }

  const fromDigits = String(msg?.from || "").replace(/\D/g, "");
  if (!fromDigits) return;
  const e164 = `+${fromDigits}`;
  const whatsappProfileName = String(contacts[0]?.profile?.name || "").trim();
  const contactName = whatsappProfileName || e164;

  let msgTimestampIso = nowIso;
  if (msg?.timestamp) {
    const epochSec = Number(msg.timestamp);
    if (!Number.isNaN(epochSec) && epochSec > 0) {
      msgTimestampIso = new Date(epochSec * 1000).toISOString();
    }
  }
  const msgWindowExp = new Date(
    new Date(msgTimestampIso).getTime() + 24 * 60 * 60 * 1000
  ).toISOString();

  const parsed = parseInboundMessageContent(msg);
  const contextWaId = String(msg?.context?.id || parsed.reactionTargetWaId || "").trim();

  const custId = await ensureInboundCustomerAndContact({
    e164,
    contactName,
    whatsappProfileName,
    nowIso,
  });

  const conv = getRawLibSqlClient("conversations");
  const tx = await conv.transaction("write");
  let convId = "";
  let inboundMsgId = `msg_${crypto.randomUUID().slice(0, 8)}`;
  let isNew = false;
  let prevStatus = "";
  let prevStaffId: string | null = null;
  let resetToAcrio = false;
  let priorOutboundMarkedRead = 0;

  try {
    const [existingConv, origRes] = await Promise.all([
      tx.execute({
        sql: `SELECT id, status, assigned_staff_id FROM conversations WHERE customer_phone = ? LIMIT 1`,
        args: [e164],
      }),
      contextWaId
        ? tx.execute({
            sql: `SELECT id, sender_name, sender_type, direction, body, metadata_json
                  FROM messages WHERE wa_message_id = ? LIMIT 1`,
            args: [contextWaId],
          })
        : Promise.resolve(null),
    ]);

    const metaObj = buildInboundMessageMeta(
      contextWaId,
      origRes?.rows[0] as Record<string, unknown> | undefined,
      parsed
    );

    isNew = existingConv.rows.length === 0;
    prevStatus = existingConv.rows[0] ? String(existingConv.rows[0].status) : "";
    prevStaffId = existingConv.rows[0]?.assigned_staff_id
      ? String(existingConv.rows[0].assigned_staff_id)
      : null;
    convId = isNew
      ? `conv_${crypto.randomUUID().slice(0, 8)}`
      : String(existingConv.rows[0].id);

    if (isNew) {
      await tx.execute({
        sql: `INSERT INTO conversations (
          id, customer_phone, customer_name, customer_id, status, priority,
          smart_category, assigned_staff_id, assigned_staff_name, assigned_team_id, assigned_team_name,
          escalation_level, waiting_since, unread_count, last_message_preview, last_message_at,
          last_message_direction, last_message_status, window_expires_at, created_at
        ) VALUES (?, ?, ?, ?, 'OPEN', 'NORMAL', 'General Enquiry', 'ACRIO', 'ACRIO', NULL, 'System (ACRIO)', 'P0', NULL, 1, ?, ?, 'INBOUND', 'DELIVERED', ?, ?)`,
        args: [
          convId,
          e164,
          contactName,
          custId,
          String(parsed.textBody).slice(0, 140),
          msgTimestampIso,
          msgWindowExp,
          nowIso,
        ],
      });
    } else {
      resetToAcrio = prevStatus === "RESOLVED";
      const isHumanOwned = !resetToAcrio && prevStaffId !== "ACRIO";
      await tx.execute({
        sql: `UPDATE conversations
              SET status = CASE WHEN status = 'RESOLVED' THEN 'OPEN' ELSE status END,
                  assigned_staff_id = CASE WHEN ? = 1 THEN 'ACRIO' ELSE assigned_staff_id END,
                  assigned_staff_name = CASE WHEN ? = 1 THEN 'ACRIO' ELSE assigned_staff_name END,
                  assigned_team_id = CASE WHEN ? = 1 THEN NULL ELSE assigned_team_id END,
                  assigned_team_name = CASE WHEN ? = 1 THEN 'System (ACRIO)' ELSE assigned_team_name END,
                  escalation_level = CASE WHEN ? = 1 THEN 'P0' ELSE escalation_level END,
                  waiting_since = CASE WHEN ? = 1 THEN COALESCE(waiting_since, ?) ELSE waiting_since END,
                  unread_count = unread_count + 1,
                  last_message_preview = ?,
                  last_message_at = ?,
                  last_message_direction = 'INBOUND',
                  last_message_status = 'DELIVERED',
                  window_expires_at = ?
              WHERE id = ?`,
        args: [
          resetToAcrio ? 1 : 0,
          resetToAcrio ? 1 : 0,
          resetToAcrio ? 1 : 0,
          resetToAcrio ? 1 : 0,
          resetToAcrio ? 1 : 0,
          isHumanOwned ? 1 : 0,
          nowIso,
          String(parsed.textBody).slice(0, 140),
          msgTimestampIso,
          msgWindowExp,
          convId,
        ],
      });
    }

    const markReadRes = await tx.execute({
      sql: `UPDATE messages
            SET delivery_status = 'READ'
            WHERE conversation_id = ?
              AND direction = 'OUTBOUND'
              AND delivery_status IN ('SENDING', 'SENT', 'DELIVERED')`,
      args: [convId],
    });
    priorOutboundMarkedRead = Number(markReadRes.rowsAffected ?? 0);

    await tx.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'INBOUND', 'CUSTOMER', ?, ?, 'FREE_CHAT', ?, ?, ?, 'DELIVERED', ?)`,
      args: [
        inboundMsgId,
        convId,
        contactName,
        parsed.messageType,
        String(parsed.textBody),
        JSON.stringify(metaObj),
        inboundWaMessageId || null,
        msgTimestampIso,
      ],
    });

    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }

  if (isNew) {
    void invalidateWhatsAppCacheTags(["contacts-meta"]).catch(() => {});
  }

  if (isNew || resetToAcrio) {
    const assignTime = new Date(Math.max(0, Date.now() - 2)).toISOString();
    await logConversationAssignment({
      conversationId: convId,
      customerPhone: e164,
      customerName: contactName,
      toStaffId: "ACRIO",
      toStaffName: "ACRIO",
      toTeamId: null,
      toTeamName: "System (ACRIO)",
      escalationLevel: "P0",
      assignmentSource: "INITIAL_SYSTEM",
      assignedByName: "System",
      reason: isNew
        ? "Customer started a new WhatsApp chat"
        : "Customer messaged after previous resolution",
      assignedAt: assignTime,
    });
  }

  if (priorOutboundMarkedRead > 0) {
    socketHub.emit("message:status", {
      conversationId: convId,
      status: "READ",
      markAllOutboundRead: true,
    });
  }

  // Always cache inbound WhatsApp media to durable local vault storage, and tag direct client shares by customer phone
  const staffMatch = await resolveInternalStaffCallerByPhone(e164).catch(() => null);
  const isInternalCaller = isOwnerWhatsAppPhone(e164) || Boolean(staffMatch);
  if (parsed.mediaMeta?.mediaId) {
    void downloadAndPersistMetaMediaToDisk({
      mediaId: parsed.mediaMeta.mediaId,
      customerPhone: isInternalCaller ? undefined : e164,
      fileName: parsed.mediaMeta.filename,
      mimeType: parsed.mediaMeta.mimeType,
      sourceLabel: isInternalCaller ? `Owner/Staff (${staffMatch?.name || contactName})` : `Client (${contactName})`,
    }).catch(() => {});
  }
  if (!isInternalCaller) {
    if (parsed.mediaMeta?.mediaId && (parsed.messageType === "IMAGE" || parsed.messageType === "VIDEO" || parsed.messageType === "DOCUMENT" || parsed.messageType === "AUDIO")) {
      void upsertCustomerSharedMedia({
        customerPhone: e164,
        conversationId: convId,
        messageId: inboundMsgId,
        waMediaId: parsed.mediaMeta.mediaId,
        localMediaId: parsed.mediaMeta.mediaId,
        itemKind: parsed.messageType,
        title: parsed.mediaMeta.filename || parsed.messageType,
        caption: parsed.mediaMeta.caption || "",
        mimeType: parsed.mediaMeta.mimeType,
        sourceType: "CLIENT_DIRECT",
        sourceLabel: `Sent by ${contactName}`,
        receivedViaPhone: e164,
        receivedViaName: contactName,
        createdAt: msgTimestampIso,
      }).catch(() => {});
    }
    if (parsed.locationPin) {
      void upsertCustomerSharedMedia({
        customerPhone: e164,
        conversationId: convId,
        messageId: inboundMsgId,
        itemKind: "LOCATION",
        title: parsed.locationPin.name,
        caption: parsed.locationPin.address,
        latitude: parsed.locationPin.latitude,
        longitude: parsed.locationPin.longitude,
        locationAddress: parsed.locationPin.address,
        mapsUrl: parsed.locationPin.mapsUrl,
        sourceType: "CLIENT_DIRECT",
        sourceLabel: `Location sent by ${contactName}`,
        receivedViaPhone: e164,
        receivedViaName: contactName,
        createdAt: msgTimestampIso,
      }).catch(() => {});
    } else {
      for (const link of extractGoogleMapsLinksFromText(parsed.textBody)) {
        void upsertCustomerSharedMedia({
          customerPhone: e164,
          conversationId: convId,
          messageId: inboundMsgId,
          itemKind: "LOCATION",
          title: "Shared Map Link",
          caption: parsed.textBody.slice(0, 240),
          latitude: link.latitude,
          longitude: link.longitude,
          mapsUrl: link.mapsUrl,
          sourceType: "CLIENT_DIRECT",
          sourceLabel: `Map link sent by ${contactName}`,
          receivedViaPhone: e164,
          receivedViaName: contactName,
          createdAt: msgTimestampIso,
        }).catch(() => {});
      }
    }
  }

  socketHub.emit("message:new", {
    conversationId: convId,
    messageId: inboundMsgId,
    direction: "INBOUND",
    customerName: contactName,
    customerPhone: e164,
    senderName: contactName,
    messageType: parsed.messageType,
    text: String(parsed.textBody || "").slice(0, 220),
    assignedStaffId:
      !resetToAcrio && prevStaffId && prevStaffId !== "ACRIO"
        ? prevStaffId
        : undefined,
  });

  // Emoji reactions and WhatsApp system notices should stay visible in chat without triggering bot/AI replies
  if (parsed.rawType === "reaction" || parsed.rawType === "system") {
    return;
  }

  void processInboundAutomations({
    conversationId: convId,
    customerPhone: e164,
    inboundText: String(parsed.textBody),
    isNewConversation: isNew || prevStatus === "RESOLVED",
    isButtonClick: parsed.isButtonClick,
    buttonPayload: parsed.buttonPayload || undefined,
    buttonText: parsed.buttonText || undefined,
    replyToWaMessageId: contextWaId || undefined,
    waMessageId: inboundWaMessageId || undefined,
    attachment: parsed.mediaMeta
      ? {
          mediaType: parsed.messageType,
          filename: parsed.mediaMeta.filename,
          mimeType: parsed.mediaMeta.mimeType,
          caption: parsed.mediaMeta.caption,
          mediaId: parsed.mediaMeta.mediaId,
          sha256: parsed.mediaMeta.sha256,
          isSticker: Boolean(parsed.mediaMeta.isSticker),
        }
      : parsed.isUnsupportedMessage
      ? {
          mediaType: "UNSUPPORTED",
          mimeType: parsed.rawType ? `whatsapp/${parsed.rawType}` : "application/octet-stream",
        }
      : null,
  }).catch((err) => {
    console.error("[whatsapp webhook] processInboundAutomations failed:", err);
  });
}
