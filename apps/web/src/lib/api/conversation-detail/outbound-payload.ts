import { resolveAudioContainerMimeAndExt } from "@cc/connections";
import type { getRawLibSqlClient } from "@cc/database";

export type DbClient = ReturnType<typeof getRawLibSqlClient>;

export function parseOutboundAttachment(body: Record<string, unknown>) {
  const rawAtt =
    body.attachment && typeof body.attachment === "object"
      ? (body.attachment as Record<string, unknown>)
      : null;
  if (!rawAtt || !String(rawAtt.url || "").trim()) return null;

  let mediaType = (["IMAGE", "VIDEO", "DOCUMENT", "AUDIO"].includes(
    String(rawAtt.mediaType || "").toUpperCase()
  )
    ? String(rawAtt.mediaType).toUpperCase()
    : "DOCUMENT") as "IMAGE" | "VIDEO" | "DOCUMENT" | "AUDIO";
  const mimeType = rawAtt.mimeType ? String(rawAtt.mimeType).trim() : undefined;
  if (mediaType === "AUDIO") {
    const audioInfo = resolveAudioContainerMimeAndExt(mimeType || "");
    if (!audioInfo.supportsWhatsAppAudioType) {
      mediaType = "DOCUMENT";
    }
  }

  return {
    mediaId: rawAtt.mediaId ? String(rawAtt.mediaId).trim() : undefined,
    waMediaId: rawAtt.waMediaId ? String(rawAtt.waMediaId).trim() : undefined,
    mediaType,
    url: String(rawAtt.url).trim(),
    fileName: rawAtt.fileName ? String(rawAtt.fileName).trim() : undefined,
    mimeType,
    sizeBytes: typeof rawAtt.sizeBytes === "number" ? rawAtt.sizeBytes : undefined,
    productName: rawAtt.productName ? String(rawAtt.productName).trim() : undefined,
    variantName: rawAtt.variantName ? String(rawAtt.variantName).trim() : undefined,
  };
}

export function parseLocationPin(body: Record<string, unknown>) {
  const rawLoc =
    body.locationPin && typeof body.locationPin === "object"
      ? (body.locationPin as Record<string, unknown>)
      : null;
  if (
    !rawLoc ||
    !Number.isFinite(Number(rawLoc.latitude)) ||
    !Number.isFinite(Number(rawLoc.longitude))
  ) {
    return null;
  }
  return {
    latitude: Number(rawLoc.latitude),
    longitude: Number(rawLoc.longitude),
    name: String(rawLoc.name || "Classic Concepts Acrylic Private Limited").trim(),
    address: String(
      rawLoc.address ||
        "1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015"
    ).trim(),
    mapsUrl: String(
      rawLoc.mapsUrl ||
        `https://maps.google.com/?q=${Number(rawLoc.latitude)},${Number(rawLoc.longitude)}`
    ).trim(),
  };
}

export function buildOutboundMetadataJson(params: {
  replyMeta: Record<string, unknown> | null;
  ctaButtonMeta: Record<string, unknown> | null;
  locationPin: ReturnType<typeof parseLocationPin>;
  attachment: ReturnType<typeof parseOutboundAttachment>;
  rawText: string;
  deliveryError?: {
    code?: number | string | null;
    message?: string | null;
    details?: string | null;
  } | null;
}): string {
  const { replyMeta, ctaButtonMeta, locationPin, attachment, rawText, deliveryError } = params;
  const metaObj: Record<string, unknown> = {};
  if (replyMeta) metaObj.replyTo = replyMeta;
  if (ctaButtonMeta) metaObj.ctaButton = ctaButtonMeta;
  if (locationPin) metaObj.locationPin = locationPin;
  if (deliveryError && (deliveryError.code || deliveryError.message || deliveryError.details)) {
    metaObj.errorCode = deliveryError.code ? String(deliveryError.code) : null;
    metaObj.errorMessage = deliveryError.message || null;
    if (deliveryError.details) metaObj.errorDetails = deliveryError.details;
  }
  if (attachment) {
    metaObj.mediaType = attachment.mediaType;
    metaObj.mediaUrl = attachment.url;
    if (attachment.mediaType === "IMAGE") metaObj.imageUrl = attachment.url;
    if (attachment.mediaId) metaObj.mediaId = attachment.mediaId;
    if (attachment.waMediaId) metaObj.waMediaId = attachment.waMediaId;
    if (attachment.fileName) {
      metaObj.fileName = attachment.fileName;
      metaObj.filename = attachment.fileName;
    }
    if (attachment.mimeType) metaObj.mimeType = attachment.mimeType;
    if (attachment.sizeBytes) metaObj.sizeBytes = attachment.sizeBytes;
    if (attachment.productName) metaObj.productName = attachment.productName;
    if (attachment.variantName) metaObj.variantName = attachment.variantName;
    metaObj.media = {
      mediaId: attachment.mediaId || attachment.waMediaId || null,
      mimeType: attachment.mimeType || null,
      filename: attachment.fileName || null,
      caption: rawText || null,
      downloadUrl: attachment.url,
    };
  }
  return JSON.stringify(metaObj);
}

function cleanTemplateParamText(v: unknown): string {
  return String(v ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {4,}/g, " ")
    .trim();
}

export function resolveOutboundTemplateComponents(
  body: Record<string, unknown>,
  tplRecord: Record<string, unknown> | null
): {
  templateComponents: Record<string, unknown>[] | undefined;
  languageCode: string | undefined;
  headerMediaError?: string;
} {
  let templateComponents: Record<string, unknown>[] | undefined = Array.isArray(
    body.templateComponents
  )
    ? (body.templateComponents as Record<string, unknown>[]).map((comp) => {
        if (!Array.isArray(comp?.parameters)) return { ...comp };
        return {
          ...comp,
          parameters: (comp.parameters as Record<string, unknown>[]).map((param) =>
            param?.type === "text"
              ? { ...param, text: cleanTemplateParamText(param.text) }
              : param
          ),
        };
      })
    : undefined;

  if (
    !templateComponents &&
    (Array.isArray(body.templateVariables) || Array.isArray(body.variables))
  ) {
    const rawVars = (body.templateVariables || body.variables) as unknown[];
    if (rawVars.length > 0) {
      templateComponents = [
        {
          type: "body",
          parameters: rawVars.map((v) => ({
            type: "text",
            text: cleanTemplateParamText(v),
          })),
        },
      ];
    }
  }

  const headerType = String(tplRecord?.header_type || "NONE").toUpperCase();
  const rawHeaderMediaUrl = body.headerMediaUrl
    ? String(body.headerMediaUrl).trim()
    : tplRecord?.header_media_url
    ? String(tplRecord.header_media_url).trim()
    : "";
  const isValidPublicMediaUrl =
    /^https?:\/\//i.test(rawHeaderMediaUrl) &&
    !/localhost|127\.0\.0\.1/i.test(rawHeaderMediaUrl);

  let headerMediaError: string | undefined;
  if (headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT") {
    const hasHeaderAlready = Boolean(
      templateComponents?.some((c) => String(c?.type || "").toLowerCase() === "header")
    );
    if (!hasHeaderAlready) {
      if (isValidPublicMediaUrl) {
        if (!templateComponents) templateComponents = [];
        const mediaKey = headerType.toLowerCase();
        templateComponents.unshift({
          type: "header",
          parameters: [{ type: mediaKey, [mediaKey]: { link: rawHeaderMediaUrl } }],
        });
      } else {
        headerMediaError = `This template requires a public HTTPS ${headerType.toLowerCase()} link in its header before WhatsApp can send it.`;
      }
    }
  } else if (headerType === "LOCATION") {
    const hasHeaderAlready = Boolean(
      templateComponents?.some((c) => String(c?.type || "").toLowerCase() === "header")
    );
    if (!hasHeaderAlready) {
      let loc: Record<string, unknown> = {};
      if (tplRecord?.header_location_json) {
        try {
          loc = JSON.parse(String(tplRecord.header_location_json)) || {};
        } catch {
          loc = {};
        }
      }
      if (!templateComponents) templateComponents = [];
      templateComponents.unshift({
        type: "header",
        parameters: [
          {
            type: "location",
            location: {
              name: String(loc.name || "Classic Concepts"),
              address: String(
                loc.address ||
                  "1-6-44/2 Muthyam Reddy Estate, Kanajiguda, Alwal, Secunderabad 500015"
              ),
              latitude: String(loc.latitude ?? 17.4947378),
              longitude: String(loc.longitude ?? 78.496725),
            },
          },
        ],
      });
    }
  }

  // Ensure templates with COPY_CODE or dynamic URL buttons pass Meta's required button parameters
  if (tplRecord?.buttons_json) {
    try {
      const parsedBtns = JSON.parse(String(tplRecord.buttons_json));
      if (Array.isArray(parsedBtns)) {
        parsedBtns.forEach((btn: Record<string, unknown>, idx: number) => {
          const btnType = String(btn?.type || "").toUpperCase();
          const hasBtnAlready = Boolean(
            templateComponents?.some(
              (c) =>
                String(c?.type || "").toLowerCase() === "button" &&
                String(c?.index ?? "") === String(idx)
            )
          );
          if (hasBtnAlready) return;
          if (btnType === "COPY_CODE") {
            if (!templateComponents) templateComponents = [];
            templateComponents.push({
              type: "button",
              sub_type: "copy_code",
              index: String(idx),
              parameters: [
                {
                  type: "coupon_code",
                  coupon_code: String(btn.exampleCode || "CLASSIC10").trim(),
                },
              ],
            });
          } else if (
            btnType === "URL" &&
            (btn.urlType === "DYNAMIC" || /\{\{1\}\}/.test(String(btn.url || "")))
          ) {
            if (!templateComponents) templateComponents = [];
            templateComponents.push({
              type: "button",
              sub_type: "url",
              index: String(idx),
              parameters: [
                {
                  type: "text",
                  text: cleanTemplateParamText(btn.exampleSuffix || "CC-2026"),
                },
              ],
            });
          }
        });
      }
    } catch {
      // ignore malformed button JSON
    }
  }

  const languageCode = body.languageCode
    ? String(body.languageCode).trim()
    : tplRecord?.language
    ? String(tplRecord.language).trim()
    : undefined;

  return { templateComponents, languageCode, headerMediaError };
}
