export interface InboundMediaMeta {
  mediaId: string;
  mimeType: string;
  filename?: string;
  caption?: string;
  sha256?: string;
  isSticker?: boolean;
}

export interface InboundLocationPin {
  latitude: number;
  longitude: number;
  name: string;
  address: string;
  mapsUrl: string;
}

export function parseInboundMessageContent(msg: any): {
  rawType: string;
  messageType: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO" | "AUDIO" | "LOCATION";
  mediaMeta: InboundMediaMeta | null;
  locationPin: InboundLocationPin | null;
  isUnsupportedMessage: boolean;
  isButtonClick: boolean;
  buttonText: string;
  buttonPayload: string;
  textBody: string;
} {
  const rawType = String(msg?.type || "").toLowerCase();
  let messageType: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO" | "AUDIO" | "LOCATION" = "TEXT";
  let mediaMeta: InboundMediaMeta | null = null;
  let locationPin: InboundLocationPin | null = null;
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
  } else if ((rawType === "location" || Boolean(msg?.location)) && msg?.location) {
    const loc = msg.location;
    const lat = Number(loc.latitude);
    const lng = Number(loc.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      messageType = "LOCATION";
      const name = String(loc.name || "").trim() || "Shared Location";
      const address = String(loc.address || "").trim();
      const mapsUrl =
        String(loc.url || "").trim() || `https://maps.google.com/?q=${lat},${lng}`;
      locationPin = {
        latitude: lat,
        longitude: lng,
        name,
        address,
        mapsUrl,
      };
    } else {
      isUnsupportedMessage = true;
    }
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
  } else if (messageType === "LOCATION" && locationPin) {
    textBody = [
      locationPin.name !== "Shared Location" ? `[Location] ${locationPin.name}` : "[Location]",
      locationPin.address,
      locationPin.mapsUrl,
    ]
      .filter(Boolean)
      .join("\n");
  } else if (
    rawType === "contacts" &&
    Array.isArray(msg?.contacts) &&
    msg.contacts.length > 0
  ) {
    const contactLines = msg.contacts.map((c: any) => {
      const cname = String(
        c?.name?.formatted_name || c?.name?.first_name || "Contact"
      ).trim();
      const phones = Array.isArray(c?.phones)
        ? c.phones
            .map((p: any) => String(p?.phone || p?.wa_id || ""))
            .filter(Boolean)
            .join(", ")
        : "";
      return phones ? `${cname}: ${phones}` : cname;
    });
    textBody = `[Shared Contact]\n${contactLines.join("\n")}`;
  } else if (isUnsupportedMessage) {
    textBody = "[Unsupported Attachment]";
  } else {
    textBody = msg?.text?.body || buttonText || "[Message]";
  }

  return {
    rawType,
    messageType,
    mediaMeta,
    locationPin,
    isUnsupportedMessage,
    isButtonClick,
    buttonText: String(buttonText || ""),
    buttonPayload: String(buttonPayload || ""),
    textBody,
  };
}
