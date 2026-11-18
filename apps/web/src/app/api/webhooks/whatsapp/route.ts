import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getSetupStatus } from "@cc/auth";
import { verifyMetaWebhookSignature } from "@cc/connections";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  upsertSyncedContact,
} from "@cc/database";
import { socketHub } from "@cc/sockets";
import {
  applyWhatsAppMessageReceipt,
  claimInboundWaMessageId,
  logConversationAssignment,
  markPriorOutboundMessagesRead,
  processInboundAutomations,
} from "@cc/workers";

export const dynamic = "force-dynamic";

// Meta Webhook Verification Handshake (`GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const setup = await getSetupStatus();
  if (
    mode === "subscribe" &&
    token &&
    token === setup.facebookConfig.webhookVerifyToken
  ) {
    return new Response(challenge || "OK", { status: 200 });
  }

  return NextResponse.json({ ok: false, error: "Invalid verify token" }, { status: 403 });
}

// Meta Inbound Messages & Delivery Receipts (`POST /api/webhooks/whatsapp`)
export async function POST(req: Request) {
  await ensureDatabasesBootstrapped();
  const rawBody = await req.text();
  const setup = await getSetupStatus();

  const sig = req.headers.get("x-hub-signature-256");
  if (
    setup.facebookConfig.metaAppSecret &&
    !verifyMetaWebhookSignature(rawBody, sig, setup.facebookConfig.metaAppSecret)
  ) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();
  const windowExp = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const val = change?.value || {};
      const contacts = val?.contacts || [];

      // 0. Live Meta Template Approval / Rejection Webhook Updates
      if (change?.field === "message_template_status_update") {
        const eventRaw = String(val?.event || "").toUpperCase();
        const metaTplId = String(val?.message_template_id || "").trim();
        const metaTplName = String(val?.message_template_name || "").trim();
        const reason = val?.reason && String(val.reason) !== "NONE" ? String(val.reason) : null;
        const mappedStatus =
          eventRaw === "APPROVED"
            ? "APPROVED"
            : eventRaw === "REJECTED" || eventRaw === "DISABLED"
            ? "REJECTED"
            : eventRaw === "PAUSED"
            ? "PAUSED"
            : "PENDING_APPROVAL";

        const cleanMetaTplId = metaTplId.trim();
        const cleanMetaTplName = metaTplName.trim();
        if (cleanMetaTplId || cleanMetaTplName) {
          const matchClauses: string[] = [];
          const matchArgs: any[] = [];
          if (cleanMetaTplId) {
            matchClauses.push(`(meta_template_id = ? AND meta_template_id != '')`);
            matchArgs.push(cleanMetaTplId);
          }
          if (cleanMetaTplName) {
            matchClauses.push(`(LOWER(name) = LOWER(?) AND name != '')`);
            matchArgs.push(cleanMetaTplName);
          }
          if (matchClauses.length > 0) {
            /* F9: Guarded template query prevents matching empty strings */
            await mkt
              .execute({
                sql: `UPDATE templates
                      SET approval_status = ?,
                          rejection_reason = ?,
                          meta_template_id = COALESCE(NULLIF(?, ''), meta_template_id),
                          updated_at = ?
                      WHERE ${matchClauses.join(" OR ")}`,
                args: [
                  mappedStatus,
                  reason,
                  cleanMetaTplId || null,
                  nowIso,
                  ...matchArgs,
                ],
              })
              .catch(() => {});
            socketHub.emit("template:updated", {
              metaTemplateId: cleanMetaTplId,
              name: cleanMetaTplName,
              status: mappedStatus,
            });
          }
        }
        continue;
      }

      // 1. Inbound customer messages (initial assignment is ALWAYS ACRIO)
      for (const msg of val?.messages || []) {
        const inboundWaMessageId = String(msg?.id || "").trim();
        if (inboundWaMessageId) {
          const isFirstDelivery = await claimInboundWaMessageId(inboundWaMessageId);
          if (!isFirstDelivery) {
            continue;
          }
        }
        const fromDigits = String(msg?.from || "").replace(/\D/g, "");
        if (!fromDigits) continue;
        const e164 = `+${fromDigits}`;
        const contactName =
          String(contacts[0]?.profile?.name || "").trim() || e164;

        /* F8: Parse Meta timestamp (epoch seconds) to UTC ISO string */
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

        /* F6: Inbound media type parsing and extraction */
        const rawType = String(msg?.type || "").toLowerCase();
        let messageType: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO" | "AUDIO" = "TEXT";
        let mediaMeta: {
          mediaId: string;
          mimeType: string;
          filename?: string;
          caption?: string;
          sha256?: string;
          isSticker?: boolean;
        } | null = null;
        let isUnsupportedMessage = false;

        if ((rawType === "image" || Boolean(msg?.image)) && msg?.image) {
          messageType = "IMAGE";
          const m = msg.image;
          mediaMeta = {
            mediaId: String(m.id || ""),
            mimeType: String(m.mime_type || "image/jpeg"),
            caption: m.caption ? String(m.caption).trim() : undefined,
            sha256: m.sha256 ? String(m.sha256) : undefined,
          };
        } else if ((rawType === "document" || Boolean(msg?.document)) && msg?.document) {
          messageType = "DOCUMENT";
          const m = msg.document;
          mediaMeta = {
            mediaId: String(m.id || ""),
            mimeType: String(m.mime_type || "application/pdf"),
            filename: m.filename ? String(m.filename).trim() : undefined,
            caption: m.caption ? String(m.caption).trim() : undefined,
            sha256: m.sha256 ? String(m.sha256) : undefined,
          };
        } else if ((rawType === "video" || Boolean(msg?.video)) && msg?.video) {
          messageType = "VIDEO";
          const m = msg.video;
          mediaMeta = {
            mediaId: String(m.id || ""),
            mimeType: String(m.mime_type || "video/mp4"),
            caption: m.caption ? String(m.caption).trim() : undefined,
            sha256: m.sha256 ? String(m.sha256) : undefined,
          };
        } else if ((rawType === "audio" || Boolean(msg?.audio)) && msg?.audio) {
          messageType = "AUDIO";
          const m = msg.audio;
          mediaMeta = {
            mediaId: String(m.id || ""),
            mimeType: String(m.mime_type || "audio/ogg"),
            sha256: m.sha256 ? String(m.sha256) : undefined,
          };
        } else if ((rawType === "sticker" || Boolean(msg?.sticker)) && msg?.sticker) {
          messageType = "IMAGE";
          const m = msg.sticker;
          mediaMeta = {
            mediaId: String(m.id || ""),
            mimeType: String(m.mime_type || "image/webp"),
            sha256: m.sha256 ? String(m.sha256) : undefined,
            isSticker: true,
          };
        } else if (
          rawType === "unsupported" ||
          rawType === "order" ||
          (rawType &&
            !["text", "button", "interactive", "contacts", "location", "reaction", "system"].includes(
              rawType
            ))
        ) {
          isUnsupportedMessage = true;
        }

        const buttonText =
          msg?.button?.text ||
          msg?.interactive?.button_reply?.title ||
          msg?.interactive?.list_reply?.title ||
          "";
        const buttonPayload =
          msg?.button?.payload ||
          msg?.interactive?.button_reply?.id ||
          msg?.interactive?.list_reply?.id ||
          "";
        const isButtonClick = Boolean(
          msg?.type === "button" ||
            msg?.type === "interactive" ||
            buttonText ||
            buttonPayload
        );

        let textBody = "";
        if (messageType === "IMAGE") {
          textBody = mediaMeta?.caption || "[Image]";
        } else if (messageType === "DOCUMENT") {
          textBody =
            mediaMeta?.caption ||
            (mediaMeta?.filename ? `[Document] ${mediaMeta.filename}` : "[Document]");
        } else if (messageType === "VIDEO") {
          textBody = mediaMeta?.caption || "[Video]";
        } else if (messageType === "AUDIO") {
          textBody = msg?.audio?.voice ? "[Voice Note]" : "[Audio]";
        } else if (rawType === "contacts" && Array.isArray(msg?.contacts) && msg.contacts.length > 0) {
          const contactLines = msg.contacts.map((c: any) => {
            const cname = String(c?.name?.formatted_name || c?.name?.first_name || "Contact").trim();
            const phones = Array.isArray(c?.phones)
              ? c.phones.map((p: any) => String(p?.phone || p?.wa_id || "")).filter(Boolean).join(", ")
              : "";
            return phones ? `${cname}: ${phones}` : cname;
          });
          textBody = `[Shared Contact]\n${contactLines.join("\n")}`;
        } else if (isUnsupportedMessage) {
          textBody = "[Unsupported Attachment]";
        } else {
          textBody = msg?.text?.body || buttonText || "[Message]";
        }

        const existingCust = await crm.execute({
          sql: `SELECT id FROM customers WHERE phone = ? LIMIT 1`,
          args: [e164],
        });
        let custId = existingCust.rows[0] ? String(existingCust.rows[0].id) : "";
        if (!custId) {
          custId = `cust_${crypto.randomUUID().slice(0, 8)}`;
          await crm.execute({
            sql: `INSERT INTO customers (id, phone, name, acrio_segment, last_interaction_at, created_at)
                  VALUES (?, ?, ?, 'Inbound WhatsApp Lead', ?, ?)`,
            args: [custId, e164, contactName, nowIso, nowIso],
          });
        }
        await upsertSyncedContact({
          phone: e164,
          name: contactName,
          whatsappName: String(contacts[0]?.profile?.name || "").trim() || undefined,
          source: "WHATSAPP_INBOUND",
          lastContactedAt: nowIso,
        }).catch(() => {});

        const existingConv = await conv.execute({
          sql: `SELECT id, status, assigned_staff_id FROM conversations WHERE customer_phone = ? LIMIT 1`,
          args: [e164],
        });
        const isNew = existingConv.rows.length === 0;
        const prevStatus = existingConv.rows[0] ? String(existingConv.rows[0].status) : "";
        const prevStaffId = existingConv.rows[0]?.assigned_staff_id
          ? String(existingConv.rows[0].assigned_staff_id)
          : null;
        const convId = isNew
          ? `conv_${crypto.randomUUID().slice(0, 8)}`
          : String(existingConv.rows[0].id);

        if (isNew) {
          await conv.execute({
            sql: `INSERT INTO conversations (
              id, customer_phone, customer_name, customer_id, status, priority,
              smart_category, assigned_staff_id, assigned_staff_name, assigned_team_id, assigned_team_name,
              escalation_level, waiting_since, unread_count, last_message_preview, last_message_at,
              last_message_direction, last_message_status, window_expires_at, created_at
            ) VALUES (?, ?, ?, ?, 'OPEN', 'NORMAL', 'General Enquiry', 'ACRIO', 'ACRIO', NULL, 'System (ACRIO)', 'P0', NULL, 1, ?, ?, 'INBOUND', 'DELIVERED', ?, ?)`,
            args: [convId, e164, contactName, custId, String(textBody).slice(0, 140), msgTimestampIso, msgWindowExp, nowIso],
          });
        } else {
          const resetToAcrio = prevStatus === "RESOLVED";
          const isHumanOwned = !resetToAcrio && prevStaffId !== "ACRIO";
          await conv.execute({
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
              String(textBody).slice(0, 140),
              msgTimestampIso,
              msgWindowExp,
              convId,
            ],
          });
        }

        const resetToAcrio = !isNew && prevStatus === "RESOLVED";
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

        // Customer replied -> any earlier outbound messages in this thread were clearly read
        await markPriorOutboundMessagesRead(convId);

        // Resolve quoted reply context if customer swiped/replied to an earlier WhatsApp message
        const contextWaId = String(msg?.context?.id || "").trim();
        const metaObj: Record<string, unknown> = {};
        if (contextWaId) {
          const origRes = await conv.execute({
            sql: `SELECT id, sender_name, sender_type, direction, body, metadata_json
                  FROM messages
                  WHERE wa_message_id = ?
                  LIMIT 1`,
            args: [contextWaId],
          });
          const orig = origRes.rows[0] as Record<string, unknown> | undefined;
          let origMeta: Record<string, unknown> = {};
          if (orig?.metadata_json) {
            try {
              origMeta = JSON.parse(String(orig.metadata_json));
            } catch {
              origMeta = {};
            }
          }
          const replyTo = orig
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
          metaObj.replyTo = replyTo;
        }

        if (mediaMeta) {
          metaObj.media = {
            media_id: mediaMeta.mediaId,
            mime_type: mediaMeta.mimeType,
            filename: mediaMeta.filename,
            caption: mediaMeta.caption,
            sha256: mediaMeta.sha256,
            download_url: `/api/media/${mediaMeta.mediaId}`,
            mediaId: mediaMeta.mediaId,
            mimeType: mediaMeta.mimeType,
            downloadUrl: `/api/media/${mediaMeta.mediaId}`,
            isSticker: Boolean(mediaMeta.isSticker),
          };
          metaObj.media_id = mediaMeta.mediaId;
          metaObj.mediaId = mediaMeta.mediaId;
          metaObj.mime_type = mediaMeta.mimeType;
          metaObj.mimeType = mediaMeta.mimeType;
          if (mediaMeta.filename) metaObj.filename = mediaMeta.filename;
          if (mediaMeta.caption) metaObj.caption = mediaMeta.caption;
          if (mediaMeta.sha256) metaObj.sha256 = mediaMeta.sha256;
          if (mediaMeta.isSticker) metaObj.isSticker = true;
        } else if (isUnsupportedMessage) {
          metaObj.unsupportedAttachment = true;
          metaObj.rawWaType = rawType || "unsupported";
        }

        const inboundMetadataJson = JSON.stringify(metaObj);

        await conv.execute({
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
          ) VALUES (?, ?, 'INBOUND', 'CUSTOMER', ?, ?, 'FREE_CHAT', ?, ?, ?, 'DELIVERED', ?)`,
          args: [
            `msg_${crypto.randomUUID().slice(0, 8)}`,
            convId,
            contactName,
            messageType,
            String(textBody),
            inboundMetadataJson,
            String(msg?.id || ""),
            msgTimestampIso,
          ],
        });

        socketHub.emit("message:new", { conversationId: convId, customerName: contactName });

        void processInboundAutomations({
          conversationId: convId,
          customerPhone: e164,
          inboundText: String(textBody),
          isNewConversation: isNew || prevStatus === "RESOLVED",
          isButtonClick,
          buttonPayload: buttonPayload ? String(buttonPayload) : undefined,
          buttonText: buttonText ? String(buttonText) : undefined,
          replyToWaMessageId: contextWaId || undefined,
          waMessageId: inboundWaMessageId || undefined,
          attachment: mediaMeta
            ? {
                mediaType: messageType,
                filename: mediaMeta.filename,
                mimeType: mediaMeta.mimeType,
                caption: mediaMeta.caption,
                mediaId: mediaMeta.mediaId,
                sha256: mediaMeta.sha256,
                isSticker: Boolean(mediaMeta.isSticker),
              }
            : isUnsupportedMessage
            ? {
                mediaType: "UNSUPPORTED",
                mimeType: rawType ? `whatsapp/${rawType}` : "application/octet-stream",
              }
            : null,
        }).catch((err) => {
          console.error("[whatsapp webhook] processInboundAutomations failed:", err);
        });
      }

      // 2. Monotonic Delivery & Read Receipts (never downgrades READ -> DELIVERED or DELIVERED -> SENT)
      for (const st of val?.statuses || []) {
        const waId = String(st?.id || "");
        const rawStatus = String(st?.status || "").toUpperCase();
        if (
          waId &&
          (rawStatus === "SENT" ||
            rawStatus === "DELIVERED" ||
            rawStatus === "READ" ||
            rawStatus === "FAILED")
        ) {
          const firstErr =
            Array.isArray(st?.errors) && st.errors.length > 0
              ? st.errors[0]
              : null;
          const errorCode =
            firstErr?.code != null ? String(firstErr.code) : null;
          const errorMessage =
            firstErr?.message ||
            firstErr?.title ||
            firstErr?.error_data?.details ||
            null;
          const errorDetails = firstErr?.error_data?.details || null;
          let stTimestampIso: string | undefined = undefined;
          if (st?.timestamp) {
            const epochSec = Number(st.timestamp);
            if (!Number.isNaN(epochSec) && epochSec > 0) {
              stTimestampIso = new Date(epochSec * 1000).toISOString();
            }
          }

          await applyWhatsAppMessageReceipt({
            waMessageId: waId,
            status: rawStatus as "SENT" | "DELIVERED" | "READ" | "FAILED",
            errorCode,
            errorMessage,
            errorDetails,
            timestampIso: stTimestampIso,
          });
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
