export interface FriendlyWhatsAppError {
  summary: string;
  suggestion: string | null;
  code: string | null;
  isMarketingFrequencyCap: boolean;
}

/**
 * Translates Meta WhatsApp delivery and template failure codes into plain,
 * actionable everyday English for staff in the inbox and template modal.
 */
export function explainMetaWhatsAppError(
  errorCode: string | number | null | undefined,
  rawMessage?: string | null,
  rawDetails?: string | null
): FriendlyWhatsAppError {
  const codeStr =
    errorCode !== null && errorCode !== undefined && String(errorCode).trim()
      ? String(errorCode).trim()
      : "";
  const combinedRaw = [rawDetails, rawMessage].filter(Boolean).join(" ").trim();
  const inferredCodeMatch = combinedRaw.match(/\b(13[0-9]{4}|80007|368)\b/);
  const code = codeStr || (inferredCodeMatch ? inferredCodeMatch[1] : "");

  if (
    code === "131049" ||
    /healthy ecosystem engagement/i.test(combinedRaw)
  ) {
    return {
      code: "131049",
      summary:
        "WhatsApp blocked this Marketing template on the customer's phone (too many promotional messages recently).",
      suggestion: "Send a Utility template instead, or call the customer directly.",
      isMarketingFrequencyCap: true,
    };
  }
  if (code === "131048") {
    return {
      code,
      summary: "WhatsApp paused promotional templates for this customer temporarily.",
      suggestion: "Send a Utility template instead, or wait before retrying.",
      isMarketingFrequencyCap: true,
    };
  }
  if (code === "131050") {
    return {
      code,
      summary: "This customer stopped promotional WhatsApp messages on their phone.",
      suggestion: "Use a Utility update template only if needed, or contact them by phone.",
      isMarketingFrequencyCap: true,
    };
  }
  if (code === "131047") {
    return {
      code,
      summary: "The 24-hour free chat window expired before this message went out.",
      suggestion: "Choose an approved WhatsApp template to restart the chat.",
      isMarketingFrequencyCap: false,
    };
  }
  if (code === "131026") {
    return {
      code,
      summary:
        "This number could not receive the WhatsApp message (not on WhatsApp, outdated app, or blocked).",
      suggestion: "Verify the phone number or reach out via phone call.",
      isMarketingFrequencyCap: false,
    };
  }
  if (code === "131053" || /media upload error|on processing it is of type/i.test(combinedRaw)) {
    return {
      code: code || "131053",
      summary:
        "WhatsApp could not process this media file format as an inline voice note, photo, or video.",
      suggestion:
        "Send it as a regular File / Document attachment, or re-save the audio as MP3 or OGG.",
      isMarketingFrequencyCap: false,
    };
  }
  if (code === "132000") {
    return {
      code,
      summary: "Template fields did not match the approved WhatsApp template layout.",
      suggestion:
        "Check that every {{1}} variable, header image/file, or button link is filled, then re-sync templates.",
      isMarketingFrequencyCap: false,
    };
  }
  if (code === "132001") {
    return {
      code,
      summary: "This template or language is not active on Meta right now.",
      suggestion: "Open Templates and click Sync from Meta, then try another approved template.",
      isMarketingFrequencyCap: false,
    };
  }
  if (code === "132005") {
    return {
      code,
      summary: "The filled message was too long for this WhatsApp template.",
      suggestion: "Shorten the filled values and try sending again.",
      isMarketingFrequencyCap: false,
    };
  }
  if (code === "132012" || code === "132018" || code === "132007") {
    return {
      code,
      summary: "One of the filled values or header links has an invalid format for WhatsApp.",
      suggestion:
        "Remove line breaks, tabs, or 4+ spaces from filled fields and make sure any header file link is public HTTPS.",
      isMarketingFrequencyCap: false,
    };
  }
  if (code === "132015" || code === "132016") {
    return {
      code,
      summary: "Meta temporarily paused or disabled this template due to customer feedback.",
      suggestion: "Pick a different approved Utility or greeting template.",
      isMarketingFrequencyCap: false,
    };
  }
  if (code === "131008" || code === "131009") {
    return {
      code,
      summary: "A required template value or header photo/PDF link is missing or invalid.",
      suggestion: "Fill all required fields and verify the template header link before resending.",
      isMarketingFrequencyCap: false,
    };
  }
  if (code === "130429" || code === "80007" || code === "4") {
    return {
      code,
      summary: "WhatsApp messaging limit reached briefly.",
      suggestion: "Wait a few seconds and send again.",
      isMarketingFrequencyCap: false,
    };
  }

  return {
    code: code || null,
    summary: combinedRaw || "WhatsApp could not deliver this message.",
    suggestion: null,
    isMarketingFrequencyCap: false,
  };
}
