import type { WhatsAppTemplateDefinition } from "./types";

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

  if (tpl.footerText?.trim()) {
    components.push({
      type: "FOOTER",
      text: tpl.footerText.trim(),
    });
  }

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
