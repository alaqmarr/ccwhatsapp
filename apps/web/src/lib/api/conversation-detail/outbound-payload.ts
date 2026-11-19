import type { getRawLibSqlClient } from "@cc/database";

export type DbClient = ReturnType<typeof getRawLibSqlClient>;

export function parseOutboundAttachment(body: Record<string, unknown>) {
  const rawAtt =
    body.attachment && typeof body.attachment === "object"
      ? (body.attachment as Record<string, unknown>)
      : null;
  if (!rawAtt || !String(rawAtt.url || "").trim()) return null;

  return {
    mediaId: rawAtt.mediaId ? String(rawAtt.mediaId).trim() : undefined,
    waMediaId: rawAtt.waMediaId ? String(rawAtt.waMediaId).trim() : undefined,
    mediaType: (["IMAGE", "VIDEO", "DOCUMENT", "AUDIO"].includes(
      String(rawAtt.mediaType || "").toUpperCase()
    )
      ? String(rawAtt.mediaType).toUpperCase()
      : "DOCUMENT") as "IMAGE" | "VIDEO" | "DOCUMENT" | "AUDIO",
    url: String(rawAtt.url).trim(),
    fileName: rawAtt.fileName ? String(rawAtt.fileName).trim() : undefined,
    mimeType: rawAtt.mimeType ? String(rawAtt.mimeType).trim() : undefined,
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
}): string {
  const { replyMeta, ctaButtonMeta, locationPin, attachment, rawText } = params;
  const metaObj: Record<string, unknown> = {};
  if (replyMeta) metaObj.replyTo = replyMeta;
  if (ctaButtonMeta) metaObj.ctaButton = ctaButtonMeta;
  if (locationPin) metaObj.locationPin = locationPin;
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

export function resolveOutboundTemplateComponents(
  body: Record<string, unknown>,
  tplRecord: Record<string, unknown> | null
): {
  templateComponents: Record<string, unknown>[] | undefined;
  languageCode: string | undefined;
} {
  let templateComponents: Record<string, unknown>[] | undefined = Array.isArray(
    body.templateComponents
  )
    ? (body.templateComponents as Record<string, unknown>[])
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
          parameters: rawVars.map((v) => ({ type: "text", text: String(v ?? "") })),
        },
      ];
    }
  }

  const headerType = String(tplRecord?.header_type || "NONE").toUpperCase();
  const headerMediaUrl = body.headerMediaUrl
    ? String(body.headerMediaUrl).trim()
    : tplRecord?.header_media_url
    ? String(tplRecord.header_media_url).trim()
    : "";
  if (
    (headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT") &&
    headerMediaUrl
  ) {
    if (!templateComponents) templateComponents = [];
    const hasHeader = templateComponents.some(
      (c) => String(c?.type || "").toLowerCase() === "header"
    );
    if (!hasHeader) {
      const mediaKey = headerType.toLowerCase();
      templateComponents.unshift({
        type: "header",
        parameters: [{ type: mediaKey, [mediaKey]: { link: headerMediaUrl } }],
      });
    }
  }

  const languageCode = body.languageCode
    ? String(body.languageCode).trim()
    : tplRecord?.language
    ? String(tplRecord.language).trim()
    : undefined;

  return { templateComponents, languageCode };
}
