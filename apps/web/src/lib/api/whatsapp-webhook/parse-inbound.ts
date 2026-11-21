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

function buildUnsupportedReasonAndLabel(msg: any, rawType: string): {
  textBody: string;
  unsupportedReason: string;
} {
  const subType = String(
    msg?.unsupported?.type || msg?.errors?.[0]?.error_data?.type || ""
  )
    .trim()
    .toLowerCase();
  const errObj = Array.isArray(msg?.errors) && msg.errors.length > 0 ? msg.errors[0] : null;
  const errDetail = String(
    errObj?.error_data?.details || errObj?.details || errObj?.message || errObj?.title || ""
  ).trim();
  const hintBlob = `${rawType} ${subType} ${errDetail}`.toLowerCase();

  if (subType === "edit" || /\bedit(?:ed)?\b/.test(hintBlob)) {
    return {
      textBody: "[Edited message on WhatsApp]",
      unsupportedReason:
        "Customer edited an earlier message on WhatsApp. WhatsApp Business accounts do not receive the edited text.",
    };
  }
  if (/view[-_\s]?once/.test(hintBlob)) {
    return {
      textBody: "[View-Once photo or video]",
      unsupportedReason:
        "Customer sent a View-Once photo or video. WhatsApp blocks opening View-Once media on Business accounts. Please ask them to send it as a regular photo or video.",
    };
  }
  if (subType === "poll" || /\bpoll\b/.test(hintBlob)) {
    return {
      textBody: "[WhatsApp Poll]",
      unsupportedReason:
        "Customer sent a WhatsApp poll or vote, which WhatsApp does not deliver to Business accounts.",
    };
  }
  if (/\bcall\b/.test(hintBlob)) {
    return {
      textBody: "[WhatsApp Call]",
      unsupportedReason:
        "Customer started or missed a WhatsApp call.",
    };
  }
  if (subType === "ephemeral" || /\bdisappearing|ephemeral\b/.test(hintBlob)) {
    return {
      textBody: "[Disappearing message]",
      unsupportedReason:
        "WhatsApp did not deliver the content of this disappearing/ephemeral item.",
    };
  }

  const labelType = subType || (rawType && rawType !== "unsupported" ? rawType : "");
  const cleanDetail =
    errDetail && !/^message type is currently not supported$/i.test(errDetail)
      ? errDetail
      : "";
  return {
    textBody: labelType
      ? `[Unsupported attachment: ${labelType}]`
      : "[Unsupported attachment]",
    unsupportedReason: cleanDetail
      ? `WhatsApp did not deliver this item (${cleanDetail}). Ask the customer to resend it as a regular photo, video, PDF, or text message.`
      : "WhatsApp did not deliver this item format (for example view-once media, a poll, an edited message, or an album). Ask the customer to resend it as a regular photo, video, PDF, or text.",
  };
}

function formatInteractiveReplyBody(msg: any): string {
  const inter = msg?.interactive;
  if (!inter || typeof inter !== "object") return "";
  if (inter.button_reply?.title) return String(inter.button_reply.title).trim();
  if (inter.list_reply?.title) {
    const desc = inter.list_reply.description
      ? ` (${String(inter.list_reply.description).trim()})`
      : "";
    return `${String(inter.list_reply.title).trim()}${desc}`;
  }
  if (inter.nfm_reply) {
    const body = String(inter.nfm_reply.body || "").trim();
    let formSummary = "";
    if (inter.nfm_reply.response_json) {
      try {
        const parsed = JSON.parse(String(inter.nfm_reply.response_json));
        if (parsed && typeof parsed === "object") {
          const pairs = Object.entries(parsed)
            .filter(([k, v]) => k !== "flow_token" && v !== null && v !== undefined && String(v).trim())
            .slice(0, 6)
            .map(([k, v]) => `${k}: ${String(v).trim()}`);
          if (pairs.length > 0) formSummary = pairs.join(", ");
        }
      } catch {
        formSummary = "";
      }
    }
    return [body || "[WhatsApp Form Reply]", formSummary].filter(Boolean).join("\n");
  }
  return String(inter.title || inter.body || "").trim();
}

export function parseInboundMessageContent(msg: any): {
  rawType: string;
  messageType: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO" | "AUDIO" | "LOCATION";
  mediaMeta: InboundMediaMeta | null;
  locationPin: InboundLocationPin | null;
  isUnsupportedMessage: boolean;
  unsupportedReason: string | null;
  reactionEmoji?: string;
  reactionTargetWaId?: string;
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
  let unsupportedReason: string | null = null;
  let reactionEmoji: string | undefined;
  let reactionTargetWaId: string | undefined;

  if ((rawType === "image" || Boolean(msg?.image)) && msg?.image) {
    const m = msg.image;
    const mid = String(m.id || "").trim();
    if (mid) {
      messageType = "IMAGE";
      mediaMeta = {
        mediaId: mid,
        mimeType: String(m.mime_type || "image/jpeg"),
        caption: m.caption ? String(m.caption).trim() : undefined,
        sha256: m.sha256 ? String(m.sha256) : undefined,
      };
    } else {
      isUnsupportedMessage = true;
      unsupportedReason =
        "WhatsApp did not include a downloadable photo file (for example view-once or expired media). Ask the customer to resend as a regular photo.";
    }
  } else if ((rawType === "document" || Boolean(msg?.document)) && msg?.document) {
    const m = msg.document;
    const mid = String(m.id || "").trim();
    if (mid) {
      messageType = "DOCUMENT";
      mediaMeta = {
        mediaId: mid,
        mimeType: String(m.mime_type || "application/pdf"),
        filename: m.filename ? String(m.filename).trim() : undefined,
        caption: m.caption ? String(m.caption).trim() : undefined,
        sha256: m.sha256 ? String(m.sha256) : undefined,
      };
    } else {
      isUnsupportedMessage = true;
      unsupportedReason =
        "WhatsApp did not include a downloadable document file. Ask the customer to resend the file as a PDF or photo.";
    }
  } else if ((rawType === "video" || Boolean(msg?.video)) && msg?.video) {
    const m = msg.video;
    const mid = String(m.id || "").trim();
    if (mid) {
      messageType = "VIDEO";
      mediaMeta = {
        mediaId: mid,
        mimeType: String(m.mime_type || "video/mp4"),
        caption: m.caption ? String(m.caption).trim() : undefined,
        sha256: m.sha256 ? String(m.sha256) : undefined,
      };
    } else {
      isUnsupportedMessage = true;
      unsupportedReason =
        "WhatsApp did not include a downloadable video file (for example view-once video). Ask the customer to resend a regular video or photo.";
    }
  } else if ((rawType === "audio" || Boolean(msg?.audio)) && msg?.audio) {
    const m = msg.audio;
    const mid = String(m.id || "").trim();
    if (mid) {
      messageType = "AUDIO";
      mediaMeta = {
        mediaId: mid,
        mimeType: String(m.mime_type || "audio/ogg"),
        sha256: m.sha256 ? String(m.sha256) : undefined,
      };
    } else {
      isUnsupportedMessage = true;
      unsupportedReason =
        "WhatsApp did not include a downloadable audio clip. Ask the customer to type or resend their voice note.";
    }
  } else if ((rawType === "sticker" || Boolean(msg?.sticker)) && msg?.sticker) {
    const m = msg.sticker;
    const mid = String(m.id || "").trim();
    if (mid) {
      messageType = "IMAGE";
      mediaMeta = {
        mediaId: mid,
        mimeType: String(m.mime_type || "image/webp"),
        sha256: m.sha256 ? String(m.sha256) : undefined,
        isSticker: true,
      };
    } else {
      isUnsupportedMessage = true;
      unsupportedReason = "WhatsApp sticker could not be downloaded.";
    }
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
      unsupportedReason = "Shared location coordinates were missing.";
    }
  } else if (rawType === "reaction" || Boolean(msg?.reaction)) {
    reactionEmoji = String(msg?.reaction?.emoji || "").trim();
    reactionTargetWaId = String(msg?.reaction?.message_id || "").trim() || undefined;
  } else if (
    rawType === "unsupported" ||
    (rawType &&
      ![
        "text",
        "button",
        "interactive",
        "contacts",
        "location",
        "reaction",
        "system",
        "order",
        "request_welcome",
      ].includes(rawType))
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
    textBody = mediaMeta?.caption || (mediaMeta?.isSticker ? "[Sticker]" : "[Image]");
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
  } else if (rawType === "reaction" || Boolean(msg?.reaction)) {
    textBody = reactionEmoji ? `[Reaction] ${reactionEmoji}` : "[Reaction removed]";
  } else if (rawType === "order" && msg?.order) {
    const items: any[] = Array.isArray(msg.order.product_items)
      ? msg.order.product_items
      : [];
    const lines = items.map((it) => {
      const sku = String(it?.product_retailer_id || "Item").trim();
      const qty = Number(it?.quantity || 1);
      const price =
        it?.item_price !== undefined && it?.item_price !== null
          ? ` (${it?.currency || "INR"} ${it.item_price})`
          : "";
      return `• ${sku} x ${qty}${price}`;
    });
    const orderNote = String(msg.order.text || "").trim();
    textBody = ["[WhatsApp Cart Order]", ...lines, orderNote].filter(Boolean).join("\n");
  } else if (rawType === "system" && msg?.system) {
    const sysText = String(msg.system.body || msg.system.new_wa_id || "").trim();
    textBody = sysText ? `[WhatsApp Notice] ${sysText}` : "[WhatsApp System Notice]";
  } else if (rawType === "request_welcome") {
    textBody = "[Customer opened WhatsApp chat]";
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
    const built = buildUnsupportedReasonAndLabel(msg, rawType);
    textBody = built.textBody;
    unsupportedReason = unsupportedReason || built.unsupportedReason;
  } else {
    const interactiveBody = formatInteractiveReplyBody(msg);
    const referralHeadline = String(
      msg?.referral?.headline || msg?.referral?.body || ""
    ).trim();
    const referralUrl = String(msg?.referral?.source_url || "").trim();
    const textContent = String(msg?.text?.body || "").trim();
    const fallbackBtn = String(buttonText || msg?.button?.payload || "").trim();
    if (textContent) {
      textBody = textContent;
    } else if (interactiveBody) {
      textBody = interactiveBody;
    } else if (fallbackBtn) {
      textBody = fallbackBtn;
    } else if (referralHeadline || referralUrl) {
      textBody = `[Ad Referral] ${[referralHeadline, referralUrl].filter(Boolean).join(" ")}`.trim();
    } else {
      isUnsupportedMessage = true;
      unsupportedReason =
        "WhatsApp delivered an empty or unsupported message item. Ask the customer to resend their text or photo.";
      textBody = "[Empty WhatsApp Message]";
    }
  }

  return {
    rawType,
    messageType,
    mediaMeta,
    locationPin,
    isUnsupportedMessage,
    unsupportedReason,
    reactionEmoji,
    reactionTargetWaId,
    isButtonClick,
    buttonText: String(buttonText || ""),
    buttonPayload: String(buttonPayload || ""),
    textBody,
  };
}
