import crypto from "node:crypto";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  normalizeWhatsAppPhone,
  resolveInternalStaffCallerByPhone,
} from "@cc/database";
import { socketHub } from "@cc/sockets";
import { formatWhatsAppOutboundText } from "@cc/connections/initialise.acrio.ai";
import { buildMetaInteractivePayload, describeInteractiveAsText, loadMetaWhatsAppSetupConfig } from "./config";
import { WHATSAPP_SUPPORTED_AUDIO_MIMES } from "./media";
import type {
  AcrioInteractive,
  OutboundWhatsAppMediaSpec,
  OutboundWhatsAppSendResult,
} from "./types";

async function recordOutboundTemplateInChat(params: {
  toPhone: string;
  templateName: string;
  bodyText: string;
  waMessageId: string;
  deliveryStatus: string;
  billingCategory?: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  senderName?: string;
  recordMetadata?: Record<string, unknown>;
}): Promise<void> {
  const normalizedPhone = normalizeWhatsAppPhone(params.toPhone);
  if (!normalizedPhone) return;

  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();

  if (params.waMessageId) {
    const dup = await conv
      .execute({
        sql: `SELECT id FROM messages WHERE wa_message_id = ? LIMIT 1`,
        args: [params.waMessageId],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    if (dup.rows[0]) return;
  }

  let billingCat: "MARKETING" | "UTILITY" | "AUTHENTICATION" =
    params.billingCategory ||
    (params.templateName === "cc_quote_request_alert" ||
    params.templateName === "cc_order_tracking_dispatch"
      ? "UTILITY"
      : "MARKETING");

  if (!params.billingCategory) {
    const tplCatRes = await mkt
      .execute({
        sql: `SELECT category FROM templates WHERE name = ? LIMIT 1`,
        args: [params.templateName],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const rawCat = String(tplCatRes.rows[0]?.category || "").toUpperCase();
    if (rawCat === "UTILITY" || rawCat === "AUTHENTICATION" || rawCat === "MARKETING") {
      billingCat = rawCat;
    }
  }

  const existingConv = await conv.execute({
    sql: `SELECT id, customer_name FROM conversations WHERE customer_phone = ? LIMIT 1`,
    args: [normalizedPhone],
  });

  let convId = existingConv.rows[0]?.id ? String(existingConv.rows[0].id) : "";
  if (!convId) {
    const staffCaller = await resolveInternalStaffCallerByPhone(normalizedPhone).catch(
      () => null
    );
    convId = `conv_${crypto.randomUUID().slice(0, 8)}`;

    if (staffCaller) {
      await conv.execute({
        sql: `INSERT INTO conversations (
          id, customer_phone, customer_name, customer_id, status, priority,
          smart_category, assigned_staff_id, assigned_staff_name, assigned_team_id, assigned_team_name,
          escalation_level, waiting_since, unread_count, last_message_preview, last_message_at, created_at
        ) VALUES (?, ?, ?, NULL, 'OPEN', 'NORMAL', 'Internal Team', 'ACRIO', 'ACRIO', NULL, 'Internal Team Desk', 'P0', NULL, 0, ?, ?, ?)`,
        args: [
          convId,
          normalizedPhone,
          `${staffCaller.name} (Team)`,
          String(params.bodyText || params.templateName).slice(0, 140),
          nowIso,
          nowIso,
        ],
      });
    } else {
      const custRes = await crm.execute({
        sql: `SELECT id, name FROM customers WHERE phone = ? LIMIT 1`,
        args: [normalizedPhone],
      });
      let custId = custRes.rows[0]?.id ? String(custRes.rows[0].id) : "";
      const custName = custRes.rows[0]?.name ? String(custRes.rows[0].name) : normalizedPhone;
      if (!custId) {
        custId = `cust_${crypto.randomUUID().slice(0, 8)}`;
        await crm
          .execute({
            sql: `INSERT INTO customers (id, phone, name, acrio_segment, last_interaction_at, created_at)
                  VALUES (?, ?, ?, 'WhatsApp Template Outreach', ?, ?)`,
            args: [custId, normalizedPhone, custName, nowIso, nowIso],
          })
          .catch(() => {});
      }
      await conv.execute({
        sql: `INSERT INTO conversations (
          id, customer_phone, customer_name, customer_id, status, priority,
          smart_category, assigned_staff_id, assigned_staff_name, assigned_team_id, assigned_team_name,
          escalation_level, waiting_since, unread_count, last_message_preview, last_message_at, created_at
        ) VALUES (?, ?, ?, ?, 'OPEN', 'NORMAL', 'General Enquiry', 'ACRIO', 'ACRIO', NULL, 'System (ACRIO)', 'P0', NULL, 0, ?, ?, ?)`,
        args: [
          convId,
          normalizedPhone,
          custName,
          custId,
          String(params.bodyText || params.templateName).slice(0, 140),
          nowIso,
          nowIso,
        ],
      });
    }
  }

  const msgId = `msg_tpl_${crypto.randomUUID().slice(0, 10)}`;
  const senderLabel = params.senderName || `ACRIO • ${params.templateName}`;
  const metadataJson =
    params.recordMetadata && Object.keys(params.recordMetadata).length > 0
      ? JSON.stringify(params.recordMetadata)
      : null;
  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, wa_message_id, direction, sender_type, sender_name,
      message_type, billing_category, body, template_name, metadata_json, delivery_status, created_at
    ) VALUES (?, ?, ?, 'OUTBOUND', 'AUTOMATION', ?, 'TEMPLATE', ?, ?, ?, ?, ?, ?)`,
    args: [
      msgId,
      convId,
      params.waMessageId || null,
      senderLabel,
      billingCat,
      params.bodyText || params.templateName,
      params.templateName,
      metadataJson,
      params.deliveryStatus || "SENT",
      nowIso,
    ],
  });

  await conv.execute({
    sql: `UPDATE conversations
          SET last_message_preview = ?,
              last_message_at = ?
          WHERE id = ?`,
    args: [
      String(params.bodyText || params.templateName)
        .replace(/\s*\n+\s*/g, " ")
        .slice(0, 140),
      nowIso,
      convId,
    ],
  });

  socketHub.emit("message:new", {
    conversationId: convId,
    senderName: senderLabel,
    text: params.bodyText,
  });
}

async function postPlainTextFallback(params: {
  phoneNumberId: string;
  accessToken: string;
  recipientDigits: string;
  contextField: Record<string, unknown>;
  bodyText: string;
}): Promise<{ res: Response; data: any }> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(params.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: params.recipientDigits,
        ...params.contextField,
        type: "text",
        text: { preview_url: true, body: params.bodyText },
      }),
      signal: AbortSignal.timeout(15000),
    }
  );
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export function isWhatsAppServiceWindowOpen(
  windowExpiresAt: unknown,
  nowMs: number = Date.now()
): boolean {
  if (!windowExpiresAt) return false;
  const expMs = new Date(String(windowExpiresAt)).getTime();
  return Number.isFinite(expMs) && !Number.isNaN(expMs) && expMs > nowMs;
}

export async function sendWhatsAppCloudMessage(params: {
  toPhone: string;
  bodyText: string;
  templateName?: string;
  languageCode?: string;
  templateComponents?: Record<string, unknown>[];
  replyToWaMessageId?: string;
  interactive?: AcrioInteractive;
  image?: {
    url: string;
    caption?: string;
  };
  media?: OutboundWhatsAppMediaSpec;
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  ctaButton?: {
    label: string;
    url: string;
    footerText?: string;
  };
  simulateAsyncDelivery?: boolean;
  forceSandbox?: boolean;
  skipAutoChatRecord?: boolean;
  recordSenderName?: string;
  recordBillingCategory?: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  recordMetadata?: Record<string, unknown>;
}): Promise<OutboundWhatsAppSendResult> {
  const cfg = await loadMetaWhatsAppSetupConfig();

  const useSandbox =
    Boolean(params.forceSandbox) ||
    process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS === "1";
  const mode = useSandbox
    ? "SANDBOX_SIMULATOR"
    : String(cfg.mode || "SANDBOX_SIMULATOR");
  const phoneNumberId = String(cfg.phoneNumberId || "").trim();
  const accessToken = String(cfg.systemUserAccessToken || "").trim();
  const normalizedPhone = normalizeWhatsAppPhone(params.toPhone);
  const recipientDigits = (normalizedPhone || params.toPhone).replace(/\D/g, "");
  const formattedBody = params.templateName
    ? params.bodyText
    : formatWhatsAppOutboundText(params.bodyText);

  if (!recipientDigits || recipientDigits.length < 10) {
    return {
      ok: false,
      waMessageId: "",
      mode: mode === "LIVE_META_CLOUD" ? "LIVE_META_CLOUD" : "SANDBOX_SIMULATOR",
      deliveryStatus: "FAILED",
      error: "Invalid WhatsApp number.",
    };
  }

  // Enforce strict 24-hour customer service window check before any non-template message leaves the app.
  if (!params.templateName) {
    let windowExpiresAt: unknown = null;
    try {
      await ensureDatabasesBootstrapped();
      const conv = getRawLibSqlClient("conversations");
      const winRes = await conv.execute({
        sql: `SELECT window_expires_at FROM conversations WHERE customer_phone = ? LIMIT 1`,
        args: [normalizedPhone || params.toPhone],
      });
      windowExpiresAt = winRes.rows[0]?.window_expires_at ?? null;
    } catch {
      windowExpiresAt = null;
    }
    if (!isWhatsAppServiceWindowOpen(windowExpiresAt)) {
      return {
        ok: false,
        waMessageId: "",
        mode: mode === "LIVE_META_CLOUD" ? "LIVE_META_CLOUD" : "SANDBOX_SIMULATOR",
        deliveryStatus: "FAILED",
        metaErrorCode: 131047,
        error:
          "24-hour customer service window is closed (window_expires_at <= now). Send an approved WhatsApp template instead.",
      };
    }
  }

  if (mode === "LIVE_META_CLOUD" && phoneNumberId && accessToken) {
    try {
      const rawReplyWaId = String(params.replyToWaMessageId || "").trim();
      const validReplyWaId =
        rawReplyWaId &&
        !rawReplyWaId.startsWith("wamid.sandbox") &&
        !rawReplyWaId.startsWith("wamid.sim_") &&
        !rawReplyWaId.startsWith("sim_")
          ? rawReplyWaId
          : "";
      const contextField = validReplyWaId
        ? { context: { message_id: validReplyWaId } }
        : {};

      const ctaUrl = String(params.ctaButton?.url || "").trim();
      const ctaLabel = String(params.ctaButton?.label || "Track Order")
        .trim()
        .slice(0, 20);
      const hasInteractiveCta =
        !params.templateName && /^https?:\/\//i.test(ctaUrl) && Boolean(ctaLabel);
      const hasLocationPayload =
        !params.templateName &&
        !params.interactive &&
        Boolean(
          params.location &&
            Number.isFinite(params.location.latitude) &&
            Number.isFinite(params.location.longitude)
        );

      const resolvedMediaSpec: OutboundWhatsAppMediaSpec | null = params.media
        ? params.media
        : params.image?.url
        ? {
            type: "IMAGE",
            url: params.image.url,
            caption: params.image.caption,
          }
        : null;
      const mediaUrl = String(resolvedMediaSpec?.url || "").trim();
      const rawWaMediaId = String(resolvedMediaSpec?.waMediaId || "").trim();
      const validWaMediaId =
        rawWaMediaId &&
        !rawWaMediaId.startsWith("sim_") &&
        !rawWaMediaId.startsWith("local_")
          ? rawWaMediaId
          : "";
      const hasPublicMediaUrl = /^https?:\/\//i.test(mediaUrl) && !/localhost|127\.0\.0\.1/i.test(mediaUrl);
      const hasMediaPayload =
        !params.templateName &&
        !params.interactive &&
        Boolean(resolvedMediaSpec && (validWaMediaId || hasPublicMediaUrl));
      const rawMediaKind = String(resolvedMediaSpec?.type || "IMAGE").toLowerCase() as
        | "image"
        | "video"
        | "document"
        | "audio";
      const normalizedMediaMime = String(resolvedMediaSpec?.mimeType || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      // If an audio container (e.g. audio/webm or audio/wav) is unsupported by Meta's `audio` type, send as `document` instead.
      const mediaKind: "image" | "video" | "document" | "audio" =
        rawMediaKind === "audio" &&
        normalizedMediaMime &&
        !WHATSAPP_SUPPORTED_AUDIO_MIMES.has(normalizedMediaMime)
          ? "document"
          : rawMediaKind;
      const mediaCaption = resolvedMediaSpec?.caption
        ? formatWhatsAppOutboundText(resolvedMediaSpec.caption)
        : formattedBody;
      const mediaRefObj: Record<string, unknown> = validWaMediaId
        ? { id: validWaMediaId }
        : { link: mediaUrl };
      if (mediaKind !== "audio" && mediaCaption) {
        mediaRefObj.caption = mediaCaption.slice(0, 1024);
      }
      if (mediaKind === "document") {
        const ext = normalizedMediaMime.split("/")[1] || "ogg";
        mediaRefObj.filename = (
          resolvedMediaSpec?.fileName || `voice-note.${ext}`
        ).slice(0, 240);
      }

      const payload = params.templateName
        ? {
            messaging_product: "whatsapp",
            to: recipientDigits,
            ...contextField,
            type: "template",
            template: {
              name: params.templateName,
              language: { code: params.languageCode || "en" },
              ...(params.templateComponents && params.templateComponents.length > 0
                ? { components: params.templateComponents }
                : {}),
            },
          }
        : hasMediaPayload
        ? {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientDigits,
            ...contextField,
            type: mediaKind,
            [mediaKind]: mediaRefObj,
          }
        : params.interactive && !params.templateName
        ? {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientDigits,
            ...contextField,
            type: "interactive",
            interactive: buildMetaInteractivePayload(params.interactive, formattedBody),
          }
        : hasLocationPayload && params.location
        ? {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientDigits,
            ...contextField,
            type: "location",
            location: {
              latitude: params.location.latitude,
              longitude: params.location.longitude,
              ...(params.location.name
                ? { name: String(params.location.name).slice(0, 120) }
                : {}),
              ...(params.location.address
                ? { address: String(params.location.address).slice(0, 250) }
                : {}),
            },
          }
        : hasInteractiveCta
        ? {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientDigits,
            ...contextField,
            type: "interactive",
            interactive: {
              type: "cta_url",
              body: { text: formattedBody },
              ...(params.ctaButton?.footerText
                ? { footer: { text: params.ctaButton.footerText.slice(0, 60) } }
                : {}),
              action: {
                name: "cta_url",
                parameters: {
                  display_text: ctaLabel,
                  url: ctaUrl,
                },
              },
            },
          }
        : {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientDigits,
            ...contextField,
            type: "text",
            text: { preview_url: true, body: formattedBody },
          };

      let res = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        }
      );

      let data: any = await res.json().catch(() => ({}));
      if (!res.ok && hasMediaPayload && mediaKind === "audio" && res.status === 400) {
        const docExt = normalizedMediaMime.split("/")[1] || "ogg";
        const docRef: Record<string, unknown> = {
          ...(validWaMediaId ? { id: validWaMediaId } : { link: mediaUrl }),
          filename: (resolvedMediaSpec?.fileName || `voice-note.${docExt}`).slice(0, 240),
        };
        res = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: recipientDigits,
              ...contextField,
              type: "document",
              document: docRef,
            }),
            signal: AbortSignal.timeout(15000),
          }
        );
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok && hasMediaPayload && res.status === 400) {
        const fallbackBody =
          mediaCaption && mediaUrl
            ? `${mediaCaption}\n${mediaUrl}`
            : mediaCaption || mediaUrl || formattedBody;
        ({ res, data } = await postPlainTextFallback({
          phoneNumberId,
          accessToken,
          recipientDigits,
          contextField,
          bodyText: fallbackBody,
        }));
      }
      if (!res.ok && hasLocationPayload && params.location && res.status === 400) {
        const mapsFallbackUrl = `https://maps.google.com/?q=${params.location.latitude},${params.location.longitude}`;
        const fallbackBody =
          formattedBody ||
          `${params.location.name ? `*${params.location.name}*\n` : ""}${params.location.address ? `${params.location.address}\n` : ""}${mapsFallbackUrl}`;
        ({ res, data } = await postPlainTextFallback({
          phoneNumberId,
          accessToken,
          recipientDigits,
          contextField,
          bodyText: fallbackBody,
        }));
      }
      if (!res.ok && hasInteractiveCta && res.status === 400) {
        const fallbackBody = formattedBody.includes(ctaUrl)
          ? formattedBody
          : `${formattedBody}\n\n*${ctaLabel}:* ${ctaUrl}`;
        ({ res, data } = await postPlainTextFallback({
          phoneNumberId,
          accessToken,
          recipientDigits,
          contextField,
          bodyText: fallbackBody,
        }));
      }
      if (!res.ok && params.interactive && !params.templateName && res.status === 400) {
        console.warn(
          `[WA] Interactive send rejected (${data?.error?.code || ""}): ${data?.error?.message || ""}. Falling back to text.`
        );
        const textFallback = `${formattedBody}\n\n${describeInteractiveAsText(params.interactive)}\n\nReply with the option you prefer.`;
        ({ res, data } = await postPlainTextFallback({
          phoneNumberId,
          accessToken,
          recipientDigits,
          contextField,
          bodyText: textFallback,
        }));
      }
      if (!res.ok) {
        const metaCode = Number(data?.error?.code || 0) || undefined;
        const metaDetail = String(
          data?.error?.error_user_msg ||
            data?.error?.error_data?.details ||
            ""
        ).trim();
        const rawErr = String(data?.error?.message || `Meta HTTP ${res.status}`).trim();
        const combinedErr =
          metaDetail && !rawErr.includes(metaDetail)
            ? `${rawErr} (${metaDetail})`
            : rawErr;
        const isSpamOrRate =
          res.status === 429 ||
          [4, 368, 80007, 130429, 131048, 131049, 131056, 131031].includes(
            metaCode || 0
          );
        return {
          ok: false,
          waMessageId: "",
          mode: "LIVE_META_CLOUD",
          deliveryStatus: "FAILED",
          error: combinedErr,
          metaErrorCode: metaCode,
          isRateOrSpamBlock: isSpamOrRate,
        };
      }

      const waId =
        String(data?.messages?.[0]?.id || "") ||
        `wamid.live_${crypto.randomUUID().slice(0, 12)}`;
      if (params.templateName && !params.skipAutoChatRecord) {
        await recordOutboundTemplateInChat({
          toPhone: normalizedPhone || params.toPhone,
          templateName: params.templateName,
          bodyText: formattedBody,
          waMessageId: waId,
          deliveryStatus: "SENT",
          billingCategory: params.recordBillingCategory,
          senderName: params.recordSenderName,
          recordMetadata: params.recordMetadata,
        }).catch(() => {});
      }
      return {
        ok: true,
        waMessageId: waId,
        mode: "LIVE_META_CLOUD",
        deliveryStatus: "SENT",
      };
    } catch (err: any) {
      return {
        ok: false,
        waMessageId: "",
        mode: "LIVE_META_CLOUD",
        deliveryStatus: "FAILED",
        error: err?.message || "Meta Cloud network error",
      };
    }
  }

  const simulatedId = `wamid.sim_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const simDeliveryStatus = params.simulateAsyncDelivery ? "SENT" : "DELIVERED";
  if (params.templateName && !params.skipAutoChatRecord) {
    await recordOutboundTemplateInChat({
      toPhone: normalizedPhone || params.toPhone,
      templateName: params.templateName,
      bodyText: formattedBody,
      waMessageId: simulatedId,
      deliveryStatus: simDeliveryStatus,
      billingCategory: params.recordBillingCategory,
      senderName: params.recordSenderName,
      recordMetadata: params.recordMetadata,
    }).catch(() => {});
  }
  return {
    ok: true,
    waMessageId: simulatedId,
    mode: "SANDBOX_SIMULATOR",
    deliveryStatus: simDeliveryStatus,
  };
}
