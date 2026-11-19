import crypto from "node:crypto";
import { getRawLibSqlClient } from "@cc/database";
import {
  describeInteractiveAsText,
  sendWhatsAppCloudMessage,
  type AcrioInteractive,
  type AcrioLocationPin,
  type AcrioMediaAttachment,
} from "@cc/connections";
import { recordDualPricingLedgerEntry } from "./billing-ledger";
import { scheduleSandboxDeliveryReceipt } from "./message-receipts";

/**
 * Sends one ACRIO reply (plain text, or text with WhatsApp buttons / "View options" list),
 * saves it in the chat, schedules the sandbox receipt and records the billing entry.
 */
export async function sendAcrioChatMessage(params: {
  conversationId: string;
  customerPhone: string;
  text: string;
  interactive?: AcrioInteractive;
  mediaAttachments?: AcrioMediaAttachment[];
  locationPin?: AcrioLocationPin;
}): Promise<{
  acrioMsgId: string;
  replyIso: string;
  sendRes: Awaited<ReturnType<typeof sendWhatsAppCloudMessage>>;
}> {
  const conv = getRawLibSqlClient("conversations");
  const interactive = params.interactive;
  const mediaAttachments = params.mediaAttachments || [];

  // Send each product / variant image, video, or PDF catalogue directly as a WhatsApp media message first
  for (const att of mediaAttachments) {
    if (!att.imageUrl || !/^https?:\/\//i.test(att.imageUrl)) continue;
    const mType: "IMAGE" | "VIDEO" | "DOCUMENT" = att.mediaType || "IMAGE";
    const imgSendRes = await sendWhatsAppCloudMessage({
      toPhone: params.customerPhone,
      bodyText: att.caption,
      media: {
        type: mType,
        url: att.imageUrl,
        caption: att.caption,
        fileName: att.fileName || undefined,
        mimeType: att.mimeType || undefined,
      },
      simulateAsyncDelivery: true,
    });
    const imgMsgId = `msg_acrio_med_${crypto.randomUUID().slice(0, 8)}`;
    const imgIso = new Date().toISOString();
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'ACRIO', 'ACRIO', ?, 'ACRIO', ?, ?, ?, ?, ?)`,
      args: [
        imgMsgId,
        params.conversationId,
        mType,
        att.caption,
        JSON.stringify({
          mediaType: mType,
          mediaUrl: att.imageUrl,
          ...(mType === "IMAGE" ? { imageUrl: att.imageUrl } : {}),
          fileName: att.fileName || null,
          filename: att.fileName || null,
          mimeType:
            att.mimeType ||
            (mType === "DOCUMENT"
              ? "application/pdf"
              : mType === "VIDEO"
              ? "video/mp4"
              : "image/jpeg"),
          caption: att.caption,
          productName: att.productName,
          productSlug: att.productSlug,
          variantName: att.variantName || null,
        }),
        imgSendRes.waMessageId,
        imgSendRes.deliveryStatus,
        imgIso,
      ],
    });
    if (imgSendRes.ok && imgSendRes.mode === "SANDBOX_SIMULATOR") {
      scheduleSandboxDeliveryReceipt({
        conversationId: params.conversationId,
        messageId: imgMsgId,
        waMessageId: imgSendRes.waMessageId,
      });
    }
  }

  // Send native WhatsApp Location Pin when the customer asked for location/directions
  if (params.locationPin) {
    const loc = params.locationPin;
    const locSendRes = await sendWhatsAppCloudMessage({
      toPhone: params.customerPhone,
      bodyText: `${loc.name}\n${loc.address}\n${loc.mapsUrl}`,
      location: {
        latitude: loc.latitude,
        longitude: loc.longitude,
        name: loc.name,
        address: loc.address,
      },
      simulateAsyncDelivery: true,
    });
    const locMsgId = `msg_acrio_loc_${crypto.randomUUID().slice(0, 8)}`;
    const locIso = new Date().toISOString();
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'ACRIO', 'ACRIO', 'LOCATION', 'ACRIO', ?, ?, ?, ?, ?)`,
      args: [
        locMsgId,
        params.conversationId,
        `Location: ${loc.name} (${loc.mapsUrl})`,
        JSON.stringify({ locationPin: loc }),
        locSendRes.waMessageId,
        locSendRes.deliveryStatus,
        locIso,
      ],
    });
    if (locSendRes.ok && locSendRes.mode === "SANDBOX_SIMULATOR") {
      scheduleSandboxDeliveryReceipt({
        conversationId: params.conversationId,
        messageId: locMsgId,
        waMessageId: locSendRes.waMessageId,
      });
    }
  }

  let sendRes: Awaited<ReturnType<typeof sendWhatsAppCloudMessage>>;

  if (interactive) {
    if (params.text.length <= 1000) {
      sendRes = await sendWhatsAppCloudMessage({
        toPhone: params.customerPhone,
        bodyText: params.text,
        interactive,
        simulateAsyncDelivery: true,
      });
    } else {
      // Buttons and lists only allow ~1000 characters of body text, so send the long text first.
      const first = await sendWhatsAppCloudMessage({
        toPhone: params.customerPhone,
        bodyText: params.text,
        simulateAsyncDelivery: true,
      });
      sendRes = first.ok
        ? await sendWhatsAppCloudMessage({
            toPhone: params.customerPhone,
            bodyText: interactive.promptText || "Please choose an option",
            interactive,
            simulateAsyncDelivery: true,
          })
        : first;
    }
  } else {
    sendRes = await sendWhatsAppCloudMessage({
      toPhone: params.customerPhone,
      bodyText: params.text,
      simulateAsyncDelivery: true,
    });
  }

  const acrioMsgId = `msg_acrio_${crypto.randomUUID().slice(0, 8)}`;
  const replyIso = new Date().toISOString();
  const storedBody = interactive
    ? `${params.text}\n\n[${interactive.kind === "list" ? `List: ${interactive.buttonLabel}` : "Buttons"}]\n${describeInteractiveAsText(interactive)}`
    : params.text;

  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, direction, sender_type, sender_name, message_type,
      billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
    ) VALUES (?, ?, 'OUTBOUND', 'ACRIO', 'ACRIO', 'TEXT', 'ACRIO', ?, ?, ?, ?, ?)`,
    args: [
      acrioMsgId,
      params.conversationId,
      storedBody,
      JSON.stringify(interactive ? { interactive } : {}),
      sendRes.waMessageId,
      sendRes.deliveryStatus,
      replyIso,
    ],
  });

  if (sendRes.ok && sendRes.mode === "SANDBOX_SIMULATOR") {
    scheduleSandboxDeliveryReceipt({
      conversationId: params.conversationId,
      messageId: acrioMsgId,
      waMessageId: sendRes.waMessageId,
    });
  }

  if (sendRes.ok) {
    await recordDualPricingLedgerEntry({
      messageId: acrioMsgId,
      conversationId: params.conversationId,
      customerPhone: params.customerPhone,
      category: "ACRIO",
      staffName: "ACRIO Auto-Handler",
      deliveryMode: sendRes.mode,
    });
  }

  return { acrioMsgId, replyIso, sendRes };
}
