import crypto from "node:crypto";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  normalizeWhatsAppPhone,
  resolveEnvMetaWhatsAppConfig,
  resolveInternalStaffCallerByPhone,
} from "@cc/database";
import { socketHub } from "@cc/sockets";
import {
  formatWhatsAppOutboundText,
} from "./initialise.acrio.ai";

// ============================================================================
// 1. META WHATSAPP CLOUD API CONNECTOR + TEMPLATE STUDIO + SANDBOX SIMULATOR
// ============================================================================
export type WhatsAppHeaderType =
  | "NONE"
  | "TEXT"
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT"
  | "LOCATION";

export type WhatsAppTemplateCategory =
  | "MARKETING"
  | "UTILITY"
  | "AUTHENTICATION";

export interface WhatsAppTemplateLocation {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

export type TemplateButtonFlowActionType =
  | "NONE"
  | "AUTO_REPLY"
  | "ASSIGN_TEAM"
  | "SEND_ORDER_TRACKING"
  | "SEND_APPROVED_TEMPLATE"
  | "OPT_OUT_DND"
  | "SMART_AI_WITH_GUARD";

export interface WhatsAppTemplateButtonFlowAction {
  actionType: TemplateButtonFlowActionType;
  replyText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  teamId?: string;
  templateName?: string;
  smartCategory?: string;
  priority?: "URGENT" | "HIGH" | "NORMAL";
  aiInstruction?: string;
}

export interface WhatsAppTemplateButton {
  id: string;
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "OTP";
  text: string;
  url?: string;
  urlType?: "STATIC" | "DYNAMIC";
  exampleSuffix?: string;
  phoneNumber?: string;
  exampleCode?: string;
  otpType?: "COPY_CODE" | "ONE_TAP";
  flowAction?: WhatsAppTemplateButtonFlowAction;
}

export interface WhatsAppTemplateVariableSpec {
  index: number;
  label: string;
  sourceField:
    | "customer.firstName"
    | "customer.fullName"
    | "customer.companyName"
    | "customer.city"
    | "order.latestNumber"
    | "custom";
  sampleValue: string;
}

export interface WhatsAppTemplateDefinition {
  id?: string;
  name: string;
  language: string;
  category: WhatsAppTemplateCategory;
  headerType: WhatsAppHeaderType;
  headerText?: string | null;
  headerMediaUrl?: string | null;
  headerLocation?: WhatsAppTemplateLocation | null;
  bodyText: string;
  footerText?: string | null;
  buttons: WhatsAppTemplateButton[];
  variablesSchema: WhatsAppTemplateVariableSpec[];
  allowCategoryChange?: boolean;
  codeExpirationMinutes?: number | null;
}

export interface OutboundWhatsAppSendResult {
  ok: boolean;
  waMessageId: string;
  mode: "LIVE_META_CLOUD" | "SANDBOX_SIMULATOR";
  deliveryStatus: "SENT" | "DELIVERED" | "FAILED";
  error?: string;
  metaErrorCode?: number;
  isRateOrSpamBlock?: boolean;
}

function isLikelyValidMetaNumericId(val: string): boolean {
  return /^\d{8,25}$/.test(val);
}

function isLikelyValidMetaToken(val: string): boolean {
  return val.length >= 40 && !/(stress|dummy|mock|_test|placeholder)/i.test(val);
}

function pickMetaConfigValue(
  dbVal: unknown,
  envVal: string,
  envHasLive: boolean,
  validator?: (v: string) => boolean
): string {
  const d = String(dbVal || "").trim();
  const e = String(envVal || "").trim();
  if (d && (!envHasLive || !validator || validator(d))) {
    return d;
  }
  return e || d;
}

let metaSetupConfigCache: {
  expiresAt: number;
  value: Record<string, unknown>;
} | null = null;

export function invalidateMetaWhatsAppSetupConfigCache(): void {
  metaSetupConfigCache = null;
}

export async function loadMetaWhatsAppSetupConfig(): Promise<Record<string, unknown>> {
  const bypassCache =
    process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS === "1" ||
    process.env.NODE_ENV === "test";
  if (!bypassCache && metaSetupConfigCache && metaSetupConfigCache.expiresAt > Date.now()) {
    return metaSetupConfigCache.value;
  }

  await ensureDatabasesBootstrapped();
  const envMeta = resolveEnvMetaWhatsAppConfig();
  const auth = getRawLibSqlClient("core_auth");
  const cfgRes = await auth.execute(
    `SELECT value_json FROM setup_state WHERE key = 'facebook_whatsapp_config' LIMIT 1`
  );
  let dbCfg: Record<string, unknown> = {};
  if (cfgRes.rows[0]?.value_json) {
    try {
      dbCfg = JSON.parse(String(cfgRes.rows[0].value_json));
    } catch {
      dbCfg = {};
    }
  }

  const resolvedWabaId = pickMetaConfigValue(
    dbCfg.wabaId,
    envMeta.wabaId,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaNumericId
  );
  const resolvedPhoneNumberId = pickMetaConfigValue(
    dbCfg.phoneNumberId,
    envMeta.phoneNumberId,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaNumericId
  );
  const resolvedToken = pickMetaConfigValue(
    dbCfg.systemUserAccessToken,
    envMeta.systemUserAccessToken,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaToken
  );
  const resolvedAppId = pickMetaConfigValue(
    dbCfg.metaAppId,
    envMeta.metaAppId,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaNumericId
  );
  const resolvedPortfolioId = pickMetaConfigValue(
    dbCfg.businessPortfolioId,
    envMeta.businessPortfolioId,
    envMeta.hasLiveCredentials,
    isLikelyValidMetaNumericId
  );

  const dbHasValidLivePair =
    isLikelyValidMetaNumericId(String(dbCfg.phoneNumberId || "").trim()) &&
    isLikelyValidMetaToken(String(dbCfg.systemUserAccessToken || "").trim());

  const resolved = {
    ...dbCfg,
    mode:
      envMeta.hasLiveCredentials && (!dbHasValidLivePair || dbCfg.mode === "LIVE_META_CLOUD")
        ? "LIVE_META_CLOUD"
        : dbCfg.mode || envMeta.mode,
    businessPortfolioId: resolvedPortfolioId,
    verifiedName: dbCfg.verifiedName || envMeta.verifiedName,
    wabaId: resolvedWabaId,
    phoneNumberId: resolvedPhoneNumberId,
    businessDisplayPhone: dbCfg.businessDisplayPhone || envMeta.businessDisplayPhone,
    systemUserAccessToken: resolvedToken,
    webhookVerifyToken: dbCfg.webhookVerifyToken || envMeta.webhookVerifyToken,
    metaAppId: resolvedAppId,
    metaAppSecret: dbCfg.metaAppSecret || envMeta.metaAppSecret,
  };
  if (!bypassCache) {
    metaSetupConfigCache = { expiresAt: Date.now() + 15_000, value: resolved };
  }
  return resolved;
}

export type AcrioInteractive =
  | {
      kind: "buttons";
      buttons: { id: string; title: string }[];
      /** Short question shown with the buttons when the main reply is too long to share one message. */
      promptText?: string;
      footer?: string;
    }
  | {
      kind: "list";
      buttonLabel: string;
      rows: { id: string; title: string; description?: string }[];
      sectionTitle?: string;
      promptText?: string;
      footer?: string;
    };

export const clip = (s: string, n: number) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, Math.max(1, n - 1)).trimEnd()}…`;
};

/** Text version of interactive options, used when Meta rejects the interactive payload or in the inbox view. */
export function describeInteractiveAsText(interactive: AcrioInteractive): string {
  if (interactive.kind === "buttons") {
    return interactive.buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
  }
  return interactive.rows.map((r, i) => `${i + 1}. ${r.title}${r.description ? ` (${r.description})` : ""}`).join("\n");
}

function buildMetaInteractivePayload(
  interactive: AcrioInteractive,
  bodyText: string
): Record<string, unknown> {
  const trimmedBody = String(bodyText || "").trim();
  const body = {
    text:
      trimmedBody.length > 1024
        ? `${trimmedBody.slice(0, 1020).trimEnd()}…`
        : trimmedBody || "Please choose an option",
  };
  const footer = interactive.footer ? { footer: { text: clip(interactive.footer, 60) } } : {};
  if (interactive.kind === "buttons") {
    return {
      type: "button",
      body,
      ...footer,
      action: {
        buttons: interactive.buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id.slice(0, 256), title: clip(b.title, 20) },
        })),
      },
    };
  }
  return {
    type: "list",
    body,
    ...footer,
    action: {
      button: clip(interactive.buttonLabel || "View options", 20),
      sections: [
        {
          title: clip(interactive.sectionTitle || "Options", 24),
          rows: interactive.rows.slice(0, 10).map((r) => ({
            id: r.id.slice(0, 200),
            title: clip(r.title, 24),
            ...(r.description ? { description: clip(r.description, 72) } : {}),
          })),
        },
      ],
    },
  };
}

export type WhatsAppMediaAttachmentType =
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT"
  | "AUDIO";

export interface OutboundWhatsAppMediaSpec {
  type: WhatsAppMediaAttachmentType;
  url?: string;
  waMediaId?: string;
  caption?: string;
  fileName?: string;
  mimeType?: string;
}

/**
 * Uploads a binary file (image, video, PDF, or document) to Meta's WhatsApp Cloud API
 * `/v21.0/{phoneNumberId}/media` endpoint so it can be delivered via `id` even when
 * the local server is not publicly reachable.
 */
export async function uploadMediaToMetaCloud(params: {
  buffer: Buffer | Uint8Array;
  mimeType: string;
  fileName: string;
  forceSandbox?: boolean;
}): Promise<{ ok: boolean; waMediaId?: string; mode: string; error?: string }> {
  const cfg = await loadMetaWhatsAppSetupConfig();
  const useSandbox =
    Boolean(params.forceSandbox) ||
    process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS === "1";
  const mode = useSandbox
    ? "SANDBOX_SIMULATOR"
    : String(cfg.mode || "SANDBOX_SIMULATOR");
  const phoneNumberId = String(cfg.phoneNumberId || "").trim();
  const accessToken = String(cfg.systemUserAccessToken || "").trim();

  if (mode !== "LIVE_META_CLOUD" || !phoneNumberId || !accessToken) {
    return {
      ok: true,
      waMediaId: `sim_media_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
      mode: "SANDBOX_SIMULATOR",
    };
  }

  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", params.mimeType || "application/octet-stream");
    const blob = new Blob([new Uint8Array(params.buffer)], {
      type: params.mimeType || "application/octet-stream",
    });
    form.append("file", blob, params.fileName || "attachment");

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/media`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
        signal: AbortSignal.timeout(30000),
      }
    );
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data?.id) {
      return {
        ok: false,
        mode: "LIVE_META_CLOUD",
        error: data?.error?.message || `Meta media upload HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      waMediaId: String(data.id),
      mode: "LIVE_META_CLOUD",
    };
  } catch (err: any) {
    return {
      ok: false,
      mode: "LIVE_META_CLOUD",
      error: err?.message || "Meta media upload network error",
    };
  }
}

/**
 * Takes a media file that someone SENT to the business number (identified by the inbound media id), downloads it from
 * Meta, and uploads it again under the business number so it can be forwarded to a teammate.
 * In sandbox mode no network call is made and a simulated id is returned.
 */
export async function prepareInboundMediaForForward(params: {
  mediaId: string;
  mimeType?: string;
  fileName?: string;
  kind?: WhatsAppMediaAttachmentType;
}): Promise<{ ok: boolean; waMediaId?: string; mimeType?: string; error?: string }> {
  const mediaId = String(params.mediaId || "").trim();
  if (!mediaId) return { ok: false, error: "No media id was saved for this attachment." };
  const baseMime = String(params.mimeType || "").split(";")[0].trim() || "application/octet-stream";

  const cfg = await loadMetaWhatsAppSetupConfig();
  const useSandbox = process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS === "1";
  const live = !useSandbox && String(cfg.mode || "") === "LIVE_META_CLOUD";
  const accessToken = String(cfg.systemUserAccessToken || "").trim();
  if (!live || !accessToken) {
    const sim = await uploadMediaToMetaCloud({
      buffer: new Uint8Array(0),
      mimeType: baseMime,
      fileName: params.fileName || "attachment",
      forceSandbox: true,
    });
    return { ok: sim.ok, waMediaId: sim.waMediaId, mimeType: baseMime, error: sim.error };
  }

  try {
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    const meta: any = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok || !meta?.url) {
      return { ok: false, error: `Could not find the attachment on WhatsApp (HTTP ${metaRes.status}). It may be older than 30 days.` };
    }
    const cdn = await fetch(String(meta.url), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!cdn.ok) return { ok: false, error: `Could not download the attachment (HTTP ${cdn.status}).` };
    const buffer = new Uint8Array(await cdn.arrayBuffer());
    const maxBytes = params.kind === "DOCUMENT" ? 100 * 1024 * 1024 : 16 * 1024 * 1024;
    if (buffer.byteLength > maxBytes) {
      return { ok: false, error: "The attachment is too large to forward on WhatsApp." };
    }
    const mime = String(meta.mime_type || baseMime).split(";")[0].trim() || baseMime;
    const up = await uploadMediaToMetaCloud({
      buffer,
      mimeType: mime,
      fileName: params.fileName || `attachment.${mime.split("/")[1] || "bin"}`,
    });
    return { ok: up.ok, waMediaId: up.waMediaId, mimeType: mime, error: up.error };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Attachment transfer failed." };
  }
}

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
      let custName = custRes.rows[0]?.name ? String(custRes.rows[0].name) : normalizedPhone;
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
      const mediaKind = String(resolvedMediaSpec?.type || "IMAGE").toLowerCase() as
        | "image"
        | "video"
        | "document"
        | "audio";
      const mediaCaption = resolvedMediaSpec?.caption
        ? formatWhatsAppOutboundText(resolvedMediaSpec.caption)
        : formattedBody;
      const mediaRefObj: Record<string, unknown> = validWaMediaId
        ? { id: validWaMediaId }
        : { link: mediaUrl };
      if (mediaKind !== "audio" && mediaCaption) {
        mediaRefObj.caption = mediaCaption.slice(0, 1024);
      }
      if (mediaKind === "document" && resolvedMediaSpec?.fileName) {
        mediaRefObj.filename = resolvedMediaSpec.fileName.slice(0, 240);
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
      if (!res.ok && hasMediaPayload && res.status === 400) {
        const fallbackBody =
          mediaCaption && mediaUrl
            ? `${mediaCaption}\n${mediaUrl}`
            : mediaCaption || mediaUrl || formattedBody;
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
              type: "text",
              text: { preview_url: true, body: fallbackBody },
            }),
            signal: AbortSignal.timeout(15000),
          }
        );
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok && hasLocationPayload && params.location && res.status === 400) {
        const mapsFallbackUrl = `https://maps.google.com/?q=${params.location.latitude},${params.location.longitude}`;
        const fallbackBody =
          formattedBody ||
          `${params.location.name ? `*${params.location.name}*\n` : ""}${params.location.address ? `${params.location.address}\n` : ""}${mapsFallbackUrl}`;
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
              type: "text",
              text: { preview_url: true, body: fallbackBody },
            }),
            signal: AbortSignal.timeout(15000),
          }
        );
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok && hasInteractiveCta && res.status === 400) {
        const fallbackBody = formattedBody.includes(ctaUrl)
          ? formattedBody
          : `${formattedBody}\n\n*${ctaLabel}:* ${ctaUrl}`;
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
              type: "text",
              text: { preview_url: true, body: fallbackBody },
            }),
            signal: AbortSignal.timeout(15000),
          }
        );
        data = await res.json().catch(() => ({}));
      }
      // If Meta rejects a buttons/list payload (for example, a title rule), fall back to a plain text version.
      if (!res.ok && params.interactive && !params.templateName && res.status === 400) {
        console.warn(
          `[WA] Interactive send rejected (${data?.error?.code || ""}): ${data?.error?.message || ""}. Falling back to text.`
        );
        const textFallback = `${formattedBody}\n\n${describeInteractiveAsText(params.interactive)}\n\nReply with the option you prefer.`;
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
              type: "text",
              text: { preview_url: true, body: textFallback },
            }),
            signal: AbortSignal.timeout(15000),
          }
        );
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok) {
        const metaCode = Number(data?.error?.code || 0) || undefined;
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
          error: data?.error?.message || `Meta HTTP ${res.status}`,
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

  // Sandbox Simulator Mode: generates authentic wamid; interactive chat replies start as SENT and transition to DELIVERED
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

export function validateWhatsAppTemplateRules(
  tpl: WhatsAppTemplateDefinition
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const cleanName = tpl.name.trim();
  if (!cleanName || !/^[a-z0-9_]{3,512}$/.test(cleanName)) {
    errors.push(
      "Template name must be at least 3 characters and use only lowercase letters, numbers, and underscores (for example: podium_offer_2026)."
    );
  }

  const body = tpl.bodyText.trim();
  if (!body) {
    errors.push("Message body cannot be empty.");
  } else if (body.length > 1024) {
    errors.push("Message body must be 1,024 characters or shorter.");
  }

  // Extract variable indices from body
  const bodyVarNums = Array.from(body.matchAll(/\{\{(\d+)\}\}/g)).map((m) =>
    Number(m[1])
  );
  const uniqueBodyVars = Array.from(new Set(bodyVarNums)).sort((a, b) => a - b);
  for (let i = 0; i < uniqueBodyVars.length; i++) {
    if (uniqueBodyVars[i] !== i + 1) {
      errors.push(
        `Variables must be numbered in order starting from {{1}} with no skipped numbers (found {{${uniqueBodyVars.join(
          "}}, {{"
        )}}}).`
      );
      break;
    }
  }

  if (tpl.category !== "AUTHENTICATION" && body) {
    if (
      /^[*_~`]*\{\{\d+\}\}/.test(body) ||
      /\{\{\d+\}\}[*_~`]*$/.test(body)
    ) {
      errors.push(
        "Meta rejects templates that start or end directly with a {{variable}}. Add a greeting word before {{1}} or punctuation/words at the end."
      );
    }
    if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)) {
      warnings.push(
        "Avoid placing two variables side by side ({{1}} {{2}}). Add a word between them so Meta approves the template smoothly."
      );
    }
  }

  for (const num of uniqueBodyVars) {
    const spec = tpl.variablesSchema.find((v) => v.index === num);
    if (!spec || !spec.sampleValue.trim()) {
      errors.push(
        `Please enter a sample value for {{${num}}} so Meta reviewers can see an example message.`
      );
    }
  }

  if (tpl.headerType === "TEXT") {
    const h = (tpl.headerText || "").trim();
    if (!h) {
      errors.push("Enter header text or switch Header to None.");
    } else if (h.length > 60) {
      errors.push("Header text must be 60 characters or shorter.");
    }
  } else if (
    tpl.headerType === "IMAGE" ||
    tpl.headerType === "VIDEO" ||
    tpl.headerType === "DOCUMENT"
  ) {
    if (!(tpl.headerMediaUrl || "").trim()) {
      errors.push(
        `Provide a sample ${tpl.headerType.toLowerCase()} link or pick an item from the catalog.`
      );
    }
  } else if (tpl.headerType === "LOCATION") {
    if (!tpl.headerLocation?.name || !tpl.headerLocation?.address) {
      errors.push("Enter location name and address for the map header.");
    }
  }

  if ((tpl.footerText || "").length > 60) {
    errors.push("Footer text must be 60 characters or shorter.");
  }

  if (tpl.buttons.length > 10) {
    errors.push("WhatsApp allows at most 10 buttons per template.");
  }
  const urlButtons = tpl.buttons.filter((b) => b.type === "URL");
  const phoneButtons = tpl.buttons.filter((b) => b.type === "PHONE_NUMBER");
  const copyButtons = tpl.buttons.filter((b) => b.type === "COPY_CODE");

  if (urlButtons.length > 2) {
    errors.push("WhatsApp allows at most 2 website link buttons per template.");
  }
  if (phoneButtons.length > 1) {
    errors.push("WhatsApp allows at most 1 phone call button per template.");
  }
  if (copyButtons.length > 1) {
    errors.push("WhatsApp allows at most 1 copy-code button per template.");
  }
  if (tpl.category === "UTILITY" && copyButtons.length > 0) {
    errors.push(
      "WhatsApp does not allow Copy Code buttons on Utility templates. Switch Category to Marketing for offer codes, or Authentication for OTP codes."
    );
  }

  for (const btn of tpl.buttons) {
    if (!btn.text.trim() && btn.type !== "OTP") {
      errors.push("Every button must have a button label.");
    }
    if (btn.text.trim().length > 25) {
      errors.push(
        `Button label "${btn.text}" must be 25 characters or shorter.`
      );
    }
    if (btn.type === "URL") {
      if (!btn.url || !/^https?:\/\//i.test(btn.url.trim())) {
        errors.push(
          `Website button "${btn.text}" needs a full https:// link.`
        );
      }
      if (btn.url && /\b(bit\.ly|tinyurl\.com|t\.co)\b/i.test(btn.url)) {
        warnings.push(
          "Meta often rejects public URL shorteners like bit.ly. Use https://ccapl.cc/... short links instead."
        );
      }
    }
    if (btn.type === "PHONE_NUMBER" && !(btn.phoneNumber || "").trim()) {
      errors.push(`Phone button "${btn.text}" needs a phone number.`);
    }
    if (btn.type === "COPY_CODE" && !(btn.exampleCode || "").trim()) {
      errors.push(`Copy-code button "${btn.text}" needs a sample code.`);
    }
  }

  if (
    tpl.category === "MARKETING" &&
    !/stop|opt\s*out|unsubscribe/i.test(
      `${tpl.footerText || ""} ${tpl.bodyText} ${tpl.buttons
        .map((b) => b.text)
        .join(" ")}`
    )
  ) {
    warnings.push(
      "Tip: Adding 'Reply STOP to opt out' in the footer or a quick reply button lowers spam reports and keeps your WhatsApp quality rating green."
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function buildMinimalPdfBuffer(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n168\n%%EOF\n",
    "utf8"
  );
}

function buildMinimalMp4Buffer(): Buffer {
  // Minimal valid ISO-BMFF ftyp + empty moov header accepted as MP4 sample
  return Buffer.from(
    "00000018667479706d703432000000006d70343269736f6d000000086d646174",
    "hex"
  );
}

async function resolveMetaAppIdForUpload(
  configuredAppId: string,
  accessToken: string
): Promise<string> {
  if (/^\d{8,25}$/.test(configuredAppId)) {
    return configuredAppId;
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(
        accessToken
      )}&access_token=${encodeURIComponent(accessToken)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return "";
    const json: any = await res.json().catch(() => null);
    const appId = String(json?.data?.app_id || "").trim();
    return /^\d{8,25}$/.test(appId) ? appId : "";
  } catch {
    return "";
  }
}

async function uploadSampleMediaForTemplateHeader(params: {
  mediaUrl: string;
  headerType: "IMAGE" | "VIDEO" | "DOCUMENT";
  accessToken: string;
  metaAppId?: string;
}): Promise<string> {
  const raw = params.mediaUrl.trim();
  if (!raw || raw.startsWith("4:")) {
    return raw;
  }

  const appId = await resolveMetaAppIdForUpload(
    String(params.metaAppId || "").trim(),
    params.accessToken
  );
  if (!appId) {
    return raw;
  }

  let fileBuf: Buffer | null = null;
  let fileType =
    params.headerType === "IMAGE"
      ? "image/png"
      : params.headerType === "DOCUMENT"
      ? "application/pdf"
      : "video/mp4";
  let fileName =
    params.headerType === "IMAGE"
      ? "sample.png"
      : params.headerType === "DOCUMENT"
      ? "sample.pdf"
      : "sample.mp4";

  if (/^https?:\/\//i.test(raw)) {
    try {
      const dl = await fetch(raw, { signal: AbortSignal.timeout(8000) });
      if (dl.ok) {
        const arr = await dl.arrayBuffer();
        if (arr.byteLength > 0 && arr.byteLength <= 15 * 1024 * 1024) {
          fileBuf = Buffer.from(arr);
          const ct = String(dl.headers.get("content-type") || "")
            .split(";")[0]
            .trim()
            .toLowerCase();
          if (params.headerType === "IMAGE") {
            if (ct === "image/jpeg" || ct === "image/jpg" || /\.jpe?g(\?|$)/i.test(raw)) {
              fileType = "image/jpeg";
              fileName = "sample.jpg";
            } else {
              fileType = "image/png";
              fileName = "sample.png";
            }
          } else if (params.headerType === "DOCUMENT") {
            fileType = "application/pdf";
            fileName = "sample.pdf";
          } else if (params.headerType === "VIDEO") {
            fileType = "video/mp4";
            fileName = "sample.mp4";
          }
        }
      }
    } catch {
      fileBuf = null;
    }
  }

  if (!fileBuf || fileBuf.length === 0) {
    if (params.headerType === "IMAGE") {
      fileBuf = Buffer.from(SAMPLE_PNG_BASE64, "base64");
      fileType = "image/png";
      fileName = "sample.png";
    } else if (params.headerType === "DOCUMENT") {
      fileBuf = buildMinimalPdfBuffer();
      fileType = "application/pdf";
      fileName = "sample.pdf";
    } else {
      fileBuf = buildMinimalMp4Buffer();
      fileType = "video/mp4";
      fileName = "sample.mp4";
    }
  }

  try {
    const sessionRes = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(
        appId
      )}/uploads?file_name=${encodeURIComponent(
        fileName
      )}&file_length=${fileBuf.length}&file_type=${encodeURIComponent(fileType)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
        },
        signal: AbortSignal.timeout(12000),
      }
    );
    const sessionJson: any = await sessionRes.json().catch(() => null);
    const sessionId = String(sessionJson?.id || "").trim();
    if (!sessionRes.ok || !sessionId) {
      return raw;
    }

    const uploadRes = await fetch(
      `https://graph.facebook.com/v21.0/${sessionId}`,
      {
        method: "POST",
        headers: {
          Authorization: `OAuth ${params.accessToken}`,
          file_offset: "0",
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(fileBuf),
        signal: AbortSignal.timeout(20000),
      }
    );
    const uploadJson: any = await uploadRes.json().catch(() => null);
    const handle = String(uploadJson?.h || "").trim();
    return uploadRes.ok && handle ? handle : raw;
  } catch {
    return raw;
  }
}

export function buildMetaGraphTemplatePayload(
  tpl: WhatsAppTemplateDefinition,
  resolvedHeaderHandle?: string
): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];

  if (tpl.category === "AUTHENTICATION") {
    components.push({
      type: "BODY",
      add_security_recommendation: true,
    });
    if (tpl.codeExpirationMinutes && tpl.codeExpirationMinutes > 0) {
      components.push({
        type: "FOOTER",
        code_expiration_minutes: Math.min(90, Math.max(1, tpl.codeExpirationMinutes)),
      });
    }
    components.push({
      type: "BUTTONS",
      buttons: [
        {
          type: "OTP",
          otp_type: "COPY_CODE",
        },
      ],
    });
    return {
      name: tpl.name,
      language: tpl.language || "en",
      category: "AUTHENTICATION",
      components,
    };
  }

  // Header component
  if (tpl.headerType === "TEXT" && tpl.headerText?.trim()) {
    const hText = tpl.headerText.trim();
    const hasVar = /\{\{1\}\}/.test(hText);
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: hText,
      ...(hasVar
        ? {
            example: {
              header_text: [
                tpl.variablesSchema.find((v) => v.index === 1)?.sampleValue ||
                  "Customer",
              ],
            },
          }
        : {}),
    });
  } else if (
    (tpl.headerType === "IMAGE" ||
      tpl.headerType === "VIDEO" ||
      tpl.headerType === "DOCUMENT") &&
    tpl.headerMediaUrl?.trim()
  ) {
    components.push({
      type: "HEADER",
      format: tpl.headerType,
      example: {
        header_handle: [resolvedHeaderHandle || tpl.headerMediaUrl.trim()],
      },
    });
  } else if (tpl.headerType === "LOCATION") {
    components.push({
      type: "HEADER",
      format: "LOCATION",
    });
  }

  // Body component with sample values
  const body = tpl.bodyText.trim();
  const varMatches = Array.from(
    new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1])))
  ).sort((a, b) => a - b);

  components.push({
    type: "BODY",
    text: body,
    ...(varMatches.length > 0
      ? {
          example: {
            body_text: [
              varMatches.map(
                (idx) =>
                  tpl.variablesSchema.find((v) => v.index === idx)
                    ?.sampleValue || `Sample${idx}`
              ),
            ],
          },
        }
      : {}),
  });

  // Footer component
  if (tpl.footerText?.trim()) {
    components.push({
      type: "FOOTER",
      text: tpl.footerText.trim(),
    });
  }

  // Interactive Buttons component
  if (tpl.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: tpl.buttons.map((b) => {
        if (b.type === "URL") {
          const isDynamic =
            b.urlType === "DYNAMIC" || /\{\{1\}\}/.test(b.url || "");
          const baseUrl = (b.url || "").trim();
          const finalUrl =
            isDynamic && !/\{\{1\}\}$/.test(baseUrl)
              ? `${baseUrl.replace(/\/?$/, "/")}{{1}}`
              : baseUrl;
          return {
            type: "URL",
            text: b.text.trim(),
            url: finalUrl,
            ...(isDynamic
              ? { example: [b.exampleSuffix || "CC-2026"] }
              : {}),
          };
        }
        if (b.type === "PHONE_NUMBER") {
          return {
            type: "PHONE_NUMBER",
            text: b.text.trim(),
            phone_number: (b.phoneNumber || "").trim(),
          };
        }
        if (b.type === "COPY_CODE") {
          return {
            type: "COPY_CODE",
            example: b.exampleCode || "CLASSIC10",
          };
        }
        return {
          type: "QUICK_REPLY",
          text: b.text.trim(),
        };
      }),
    });
  }

  return {
    name: tpl.name,
    language: tpl.language || "en",
    category: tpl.category,
    allow_category_change: tpl.allowCategoryChange ?? true,
    components,
  };
}

export async function submitTemplateToMetaCloud(
  tpl: WhatsAppTemplateDefinition
): Promise<{
  ok: boolean;
  mode: "LIVE_META_CLOUD" | "SANDBOX_SIMULATOR";
  metaTemplateId: string;
  approvalStatus: "APPROVED" | "PENDING_APPROVAL" | "REJECTED" | "DRAFT";
  message: string;
  error?: string;
  effectiveCategory?: WhatsAppTemplateCategory;
  effectiveBodyText?: string;
  effectiveFooterText?: string | null;
  effectiveButtons?: WhatsAppTemplateButton[];
}> {
  const validation = validateWhatsAppTemplateRules(tpl);
  if (!validation.valid) {
    return {
      ok: false,
      mode: "SANDBOX_SIMULATOR",
      metaTemplateId: "",
      approvalStatus: "REJECTED",
      message: validation.errors[0],
      error: validation.errors.join(" "),
    };
  }

  const cfg = await loadMetaWhatsAppSetupConfig();
  const mode = String(cfg.mode || "SANDBOX_SIMULATOR");
  const wabaId = String(cfg.wabaId || "").trim();
  const accessToken = String(cfg.systemUserAccessToken || "").trim();
  const metaAppId = String(cfg.metaAppId || "").trim();

  if (mode === "LIVE_META_CLOUD" && wabaId && accessToken) {
    try {
      let resolvedHeaderHandle: string | undefined;
      if (
        (tpl.headerType === "IMAGE" ||
          tpl.headerType === "VIDEO" ||
          tpl.headerType === "DOCUMENT") &&
        tpl.headerMediaUrl?.trim()
      ) {
        resolvedHeaderHandle = await uploadSampleMediaForTemplateHeader({
          mediaUrl: tpl.headerMediaUrl.trim(),
          headerType: tpl.headerType,
          accessToken,
          metaAppId,
        });
      }

      const metaPayload = buildMetaGraphTemplatePayload(
        tpl,
        resolvedHeaderHandle
      );

      const postToMeta = async (payload: Record<string, unknown>) => {
        const response = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(
            wabaId
          )}/message_templates`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(20000),
          }
        );
        const bodyJson: any = await response.json().catch(() => ({}));
        return { response, bodyJson };
      };

      const { response: res, bodyJson: data } = await postToMeta(metaPayload);

      if (!res.ok) {
        const subcode = Number(data?.error?.error_subcode || 0);
        const rawErrMsg = String(
          data?.error?.error_user_msg ||
            data?.error?.message ||
            `Meta Graph HTTP ${res.status}`
        );

        // Meta temporarily restricts AUTHENTICATION template creation via API on
        // Tier-250 WABAs until display-name review completes (subcode 2388185).
        // Do NOT disguise OTP wording as UTILITY (Meta auto-rejects OTP copy under
        // UTILITY and penalizes WABA quality); instead save cleanly as DRAFT so it
        // can be submitted as soon as Meta unlocks Authentication.
        if (
          tpl.category === "AUTHENTICATION" &&
          (subcode === 2388185 ||
            /permission to create message template/i.test(rawErrMsg))
        ) {
          return {
            ok: true,
            mode: "LIVE_META_CLOUD",
            metaTemplateId: "",
            approvalStatus: "DRAFT",
            message:
              "Saved as Draft: Meta has temporarily paused Authentication (OTP) template creation on this WhatsApp Business Account until display name approval completes. Marketing and Utility templates submit normally right now.",
          };
        }

        const friendlyError =
          subcode === 2388185
            ? `${rawErrMsg}. Check in Meta Business Settings that your System User token has Full Control on WhatsApp Business Account ${wabaId}.`
            : rawErrMsg;

        return {
          ok: false,
          mode: "LIVE_META_CLOUD",
          metaTemplateId: "",
          approvalStatus: "REJECTED",
          message: friendlyError,
          error: friendlyError,
        };
      }

      const rawStatus = String(data?.status || "PENDING").toUpperCase();
      const mappedStatus: "APPROVED" | "PENDING_APPROVAL" | "REJECTED" =
        rawStatus === "APPROVED"
          ? "APPROVED"
          : rawStatus === "REJECTED"
          ? "REJECTED"
          : "PENDING_APPROVAL";

      return {
        ok: true,
        mode: "LIVE_META_CLOUD",
        metaTemplateId: String(data?.id || `meta_${Date.now()}`),
        approvalStatus: mappedStatus,
        message:
          mappedStatus === "APPROVED"
            ? "Template approved immediately by Meta!"
            : "Submitted to Meta for review. Only Meta-approved templates can be sent.",
      };
    } catch (err: any) {
      return {
        ok: false,
        mode: "LIVE_META_CLOUD",
        metaTemplateId: "",
        approvalStatus: "REJECTED",
        message: err?.message || "Could not connect to Meta Graph API.",
        error: err?.message || "Could not connect to Meta Graph API.",
      };
    }
  }

  // Strict Meta-Approved Enforcement: never fake local "APPROVED" unless explicit test/demo flag is enabled
  const allowDemoApproval =
    process.env.SEED_DEMO_DATA === "1" ||
    process.env.WHATSAPP_ALLOW_SANDBOX_TEMPLATE_APPROVAL === "1";

  return {
    ok: true,
    mode: "SANDBOX_SIMULATOR",
    metaTemplateId: allowDemoApproval
      ? `sim_tpl_${crypto.randomBytes(5).toString("hex")}`
      : "",
    approvalStatus: allowDemoApproval ? "APPROVED" : "DRAFT",
    message: allowDemoApproval
      ? "Validated template rules in demo sandbox."
      : "Template saved as a verified Draft (with button flows). Connect your live Meta WABA ID & System Access Token in Facebook Setup to submit for official Meta approval before sending.",
  };
}

export async function syncTemplatesFromMetaCloud(): Promise<{
  ok: boolean;
  mode: "LIVE_META_CLOUD" | "SANDBOX_SIMULATOR";
  syncedCount: number;
  message: string;
}> {
  const cfg = await loadMetaWhatsAppSetupConfig();
  const mode = String(cfg.mode || "SANDBOX_SIMULATOR");
  const wabaId = String(cfg.wabaId || "").trim();
  const accessToken = String(cfg.systemUserAccessToken || "").trim();
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();

  if (mode === "LIVE_META_CLOUD" && wabaId && accessToken) {
    try {
      let nextUrl: string | null = `https://graph.facebook.com/v21.0/${encodeURIComponent(
        wabaId
      )}/message_templates?fields=id,name,language,category,status,quality_score,rejected_reason,components&limit=100`;
      const allItems: any[] = [];
      let pageCount = 0;
      const MAX_PAGES = 10;

      while (nextUrl && pageCount < MAX_PAGES) {
        pageCount++;
        const res = await fetch(nextUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(20000),
        });
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (pageCount === 1) {
            return {
              ok: false,
              mode: "LIVE_META_CLOUD",
              syncedCount: 0,
              message:
                json?.error?.message || `Meta template sync failed (HTTP ${res.status}).`,
            };
          }
          break;
        }
        const pageItems: any[] = Array.isArray(json?.data) ? json.data : [];
        allItems.push(...pageItems);
        if (json?.paging?.next && typeof json.paging.next === "string") {
          nextUrl = json.paging.next;
        } else if (json?.paging?.cursors?.after && pageItems.length >= 100) {
          nextUrl = `https://graph.facebook.com/v21.0/${encodeURIComponent(
            wabaId
          )}/message_templates?fields=id,name,language,category,status,quality_score,rejected_reason,components&limit=100&after=${encodeURIComponent(
            json.paging.cursors.after
          )}`;
        } else {
          nextUrl = null;
        }
      }

      const items: any[] = allItems;
      let synced = 0;

      for (const item of items) {
        const name = String(item.name || "").trim();
        if (!name) continue;
        const metaId = String(item.id || "");
        const rawStatus = String(item.status || "APPROVED").toUpperCase();
        const approvalStatus =
          rawStatus === "APPROVED"
            ? "APPROVED"
            : rawStatus === "REJECTED"
            ? "REJECTED"
            : rawStatus === "PAUSED"
            ? "PAUSED"
            : "PENDING_APPROVAL";
        const quality = String(
          item?.quality_score?.score || "GREEN"
        ).toUpperCase();
        const rejReason =
          item.rejected_reason && item.rejected_reason !== "NONE"
            ? String(item.rejected_reason)
            : null;

        const comps: any[] = Array.isArray(item.components)
          ? item.components
          : [];
        const headerComp = comps.find((c) => c.type === "HEADER");
        const bodyComp = comps.find((c) => c.type === "BODY");
        const footerComp = comps.find((c) => c.type === "FOOTER");
        const btnComp = comps.find((c) => c.type === "BUTTONS");

        const bodyText = String(bodyComp?.text || name);
        const bodyMatches = Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g)).map((m) =>
          Number(m[1])
        );
        const uniqueVarNums = Array.from(new Set(bodyMatches)).sort((a, b) => a - b);
        const varSpecs = uniqueVarNums.map((num) => {
          if (item.category === "AUTHENTICATION" && num === 1) {
            return {
              index: 1,
              label: "Verification Code",
              sourceField: "custom" as const,
              sampleValue: "482910",
            };
          }
          if (num === 1) {
            return {
              index: 1,
              label: "Customer First Name",
              sourceField: "customer.firstName" as const,
              sampleValue: "Rahul",
            };
          }
          if (num === 2) {
            return {
              index: 2,
              label: "Order Number",
              sourceField: "order.latestNumber" as const,
              sampleValue: "CC-2026-1089",
            };
          }
          return {
            index: num,
            label: `Detail ${num}`,
            sourceField: "custom" as const,
            sampleValue: "ready for dispatch",
          };
        });
        const variablesSchemaJson = JSON.stringify(varSpecs);

        const headerType = headerComp?.format ? String(headerComp.format).toUpperCase() : "NONE";
        const headerText = headerComp?.text ? String(headerComp.text) : null;
        const headerMediaUrl = headerComp?.example?.header_handle?.[0]
          ? String(headerComp.example.header_handle[0])
          : null;
        const footerText = footerComp?.text ? String(footerComp.text) : null;
        const category = String(item.category || "MARKETING").toUpperCase();
        const language = String(item.language || "en");

        const existing = await mkt.execute({
          sql: `SELECT id, buttons_json, variables_schema_json FROM templates WHERE name = ? LIMIT 1`,
          args: [name],
        });

        let prevButtons: WhatsAppTemplateButton[] = [];
        if (existing.rows[0]?.buttons_json) {
          try {
            const parsed = JSON.parse(String(existing.rows[0].buttons_json));
            if (Array.isArray(parsed)) prevButtons = parsed;
          } catch {
            prevButtons = [];
          }
        }

        const buttons: WhatsAppTemplateButton[] = Array.isArray(
          btnComp?.buttons
        )
          ? btnComp.buttons.map((b: any, idx: number) => {
              const btnText = String(b.text || "Open");
              const prevMatch = prevButtons.find(
                (pb) =>
                  pb.text.trim().toLowerCase() === btnText.trim().toLowerCase()
              );
              return {
                id: prevMatch?.id || `btn_meta_${idx}`,
                type:
                  b.type === "URL"
                    ? "URL"
                    : b.type === "PHONE_NUMBER"
                    ? "PHONE_NUMBER"
                    : b.type === "COPY_CODE"
                    ? "COPY_CODE"
                    : "QUICK_REPLY",
                text: btnText,
                url: b.url ? String(b.url) : prevMatch?.url,
                phoneNumber: b.phone_number
                  ? String(b.phone_number)
                  : prevMatch?.phoneNumber,
                flowAction: prevMatch?.flowAction,
              };
            })
          : prevButtons;

        const firstUrlBtn = buttons.find((b) => b.type === "URL");

        if (existing.rows[0]) {
          await mkt.execute({
            sql: `UPDATE templates
                  SET meta_template_id = ?,
                      language = ?,
                      category = ?,
                      approval_status = ?,
                      meta_quality_score = ?,
                      rejection_reason = ?,
                      header_type = ?,
                      header_text = COALESCE(?, header_text),
                      header_media_url = COALESCE(?, header_media_url),
                      body_text = COALESCE(?, body_text),
                      footer_text = COALESCE(?, footer_text),
                      cta_label = COALESCE(?, cta_label),
                      cta_url = COALESCE(?, cta_url),
                      buttons_json = ?,
                      variables_schema_json = ?,
                      updated_at = ?
                  WHERE id = ?`,
            args: [
              metaId,
              language,
              category,
              approvalStatus,
              quality,
              rejReason,
              headerType,
              headerText,
              headerMediaUrl,
              bodyComp?.text ? String(bodyComp.text) : null,
              footerText,
              firstUrlBtn?.text || null,
              firstUrlBtn?.url || null,
              JSON.stringify(buttons),
              variablesSchemaJson,
              nowIso,
              String(existing.rows[0].id),
            ],
          });
          synced++;
        } else {
          await mkt.execute({
            sql: `INSERT INTO templates (
              id, name, language, category, header_type, header_text, body_text,
              header_media_url, footer_text, cta_label, cta_url, buttons_json,
              variables_schema_json, meta_template_id,
              meta_quality_score, approval_status, rejection_reason, created_by_name,
              updated_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Meta Sync', ?, ?)`,
            args: [
              `tpl_${crypto.randomUUID().slice(0, 8)}`,
              name,
              language,
              category,
              headerType,
              headerText,
              bodyText,
              headerMediaUrl,
              footerText,
              firstUrlBtn?.text || null,
              firstUrlBtn?.url || null,
              JSON.stringify(buttons),
              variablesSchemaJson,
              metaId,
              quality,
              approvalStatus,
              rejReason,
              nowIso,
              nowIso,
            ],
          });
          synced++;
        }
      }

      return {
        ok: true,
        mode: "LIVE_META_CLOUD",
        syncedCount: synced,
        message: `Synced ${synced} official WhatsApp templates from Meta (preserving button flow mappings).`,
      };
    } catch (err: any) {
      return {
        ok: false,
        mode: "LIVE_META_CLOUD",
        syncedCount: 0,
        message: err?.message || "Network error while syncing from Meta.",
      };
    }
  }

  const countRes = await mkt.execute(`SELECT COUNT(*) as cnt FROM templates`);
  return {
    ok: true,
    mode: "SANDBOX_SIMULATOR",
    syncedCount: Number(countRes.rows[0]?.cnt ?? 0),
    message:
      "Checked local templates (Sandbox mode active. Connect live WABA ID in Facebook Setup to pull templates from Meta).",
  };
}

export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!appSecret) return true;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

