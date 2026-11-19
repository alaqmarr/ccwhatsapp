import { SHORTLINK_PUBLIC_ORIGIN, formatShortLinkUrl } from "@cc/ui";
import {
  slugifyName,
  type CatalogMediaOption,
  type HeaderType,
  type LocationHeader,
  type ShortLinkOption,
  type TemplateButton,
  type TemplateCategory,
  type TemplatePresetKey,
  type VariableSpec,
} from "./types";

export interface StarterPresetValues {
  name: string;
  category: TemplateCategory;
  headerType: HeaderType;
  headerText?: string;
  headerMediaUrl?: string;
  headerLocation?: LocationHeader;
  codeExpirationMinutes?: number;
  bodyText: string;
  footerText: string;
  buttons: TemplateButton[];
}

export function getStarterPresetValues(
  preset: TemplatePresetKey,
  customLinks: ShortLinkOption[],
  catalogMedia: CatalogMediaOption[]
): StarterPresetValues {
  if (preset === "HOSPITALITY") {
    return {
      name: "hotel_banquet_podium_offer",
      category: "MARKETING",
      headerType: "TEXT",
      headerText: "Clear Acrylic Podiums & Menu Stands",
      bodyText:
        "Hello {{1}}, check out our latest clear banquet podiums and tabletop menu holders made at Classic Concepts for hotels and convention halls.",
      footerText: "Classic Concepts • Reply STOP to opt out",
      buttons: [
        {
          id: "b1",
          type: "URL",
          text: "View Hotel Catalog",
          url: customLinks[0]
            ? formatShortLinkUrl(customLinks[0].code)
            : `${SHORTLINK_PUBLIC_ORIGIN}/podium`,
          urlType: "STATIC",
        },
        {
          id: "b2",
          type: "QUICK_REPLY",
          text: "Talk to Sales Team",
          flowAction: {
            actionType: "ASSIGN_TEAM",
            teamId: "team_sales",
            replyText:
              "Connecting you with our *Sales Team* right away. A specialist will reply here shortly.",
          },
        },
        {
          id: "b3",
          type: "QUICK_REPLY",
          text: "STOP",
          flowAction: { actionType: "OPT_OUT_DND" },
        },
      ],
    };
  }
  if (preset === "CE53_MACHINE") {
    return {
      name: "ce53_acrylic_machines_quote",
      category: "MARKETING",
      headerType: "IMAGE",
      headerMediaUrl:
        catalogMedia[0]?.imageUrl ||
        "https://classicedge53.com/images/machines-hero.jpg",
      bodyText:
        "Hello {{1}}, looking for diamond edge polishing machines, acrylic benders, or CNC routers? Explore *Classic Edge 53* machines ready with spares and support.",
      footerText: "Classic Edge 53 • Reply STOP to opt out",
      buttons: [
        {
          id: "b1",
          type: "URL",
          text: "View Machines",
          url: "https://classicedge53.com",
          urlType: "STATIC",
        },
        {
          id: "b2",
          type: "PHONE_NUMBER",
          text: "Call Machine Desk",
          phoneNumber: "+917337222876",
        },
      ],
    };
  }
  if (preset === "ORDER_UPDATE") {
    return {
      name: "cc_order_dispatch_alert",
      category: "UTILITY",
      headerType: "TEXT",
      headerText: "Order Status Update",
      bodyText:
        "Hello {{1}}, your Classic Concepts order *{{2}}* is now *{{3}}*. Tap below for live tracking or reply anytime if you need transport details.",
      footerText: "Classic Concepts Dispatch Desk",
      buttons: [
        {
          id: "b1",
          type: "QUICK_REPLY",
          text: "Share LR / Tracking",
          flowAction: { actionType: "SEND_ORDER_TRACKING" },
        },
      ],
    };
  }
  if (preset === "PAYMENT_QUOTE") {
    return {
      name: "cc_quote_approval_link",
      category: "UTILITY",
      headerType: "DOCUMENT",
      headerMediaUrl: "https://www.classicconcepts.in/sample-quote.pdf",
      bodyText:
        "Hello {{1}}, we have prepared the specification sheet and quote for *{{2}}*. Review the PDF above or click below to confirm.",
      footerText: "Classic Concepts Accounts & Sales",
      buttons: [
        {
          id: "b1",
          type: "URL",
          text: "Open Quote Link",
          url: `${SHORTLINK_PUBLIC_ORIGIN}/quote1`,
          urlType: "STATIC",
        },
        {
          id: "b2",
          type: "QUICK_REPLY",
          text: "Confirm Order",
          flowAction: {
            actionType: "ASSIGN_TEAM",
            teamId: "team_sales",
            priority: "HIGH",
            replyText:
              "Thank you for confirming! Our *Sales & Dispatch Team* has been notified to lock in your order.",
          },
        },
      ],
    };
  }
  if (preset === "OTP_CODE") {
    return {
      name: "cc_verification_otp",
      category: "AUTHENTICATION",
      headerType: "NONE",
      codeExpirationMinutes: 10,
      bodyText:
        "*{{1}}* is your Classic Concepts verification code. For your security, do not share this code with anyone.",
      footerText: "Expires in 10 minutes",
      buttons: [
        {
          id: "b1",
          type: "COPY_CODE",
          text: "Copy Code",
          exampleCode: "482910",
        },
      ],
    };
  }
  return {
    name: "cc_factory_showroom_location",
    category: "MARKETING",
    headerType: "LOCATION",
    headerLocation: {
      name: "Classic Concepts Showroom & Factory",
      address: "Rani Gunj, Secunderabad, Hyderabad, Telangana",
      latitude: 17.4326,
      longitude: 78.4913,
    },
    bodyText:
      "Hello {{1}}, you are invited to inspect acrylic samples and finishes in person at our Hyderabad display desk. Tap the map above for directions.",
    footerText: "Classic Concepts • Reply STOP to opt out",
    buttons: [
      {
        id: "b1",
        type: "PHONE_NUMBER",
        text: "Call Before Visiting",
        phoneNumber: "+917337222876",
      },
    ],
  };
}

export function buildTemplateLiveChecks(params: {
  name: string;
  bodyText: string;
  category: TemplateCategory;
  variablesSchema: VariableSpec[];
  headerType: HeaderType;
  headerMediaUrl: string;
  footerText: string;
  buttons: TemplateButton[];
}) {
  const {
    name,
    bodyText,
    category,
    variablesSchema,
    headerType,
    headerMediaUrl,
    footerText,
    buttons,
  } = params;
  const issues: string[] = [];
  const tips: string[] = [];
  const cleanSlug = slugifyName(name);
  if (cleanSlug.length < 3) {
    issues.push("Template name must have at least 3 characters.");
  }
  const trimmedBody = bodyText.trim();
  if (!trimmedBody) {
    issues.push("Message body cannot be empty.");
  } else if (
    category !== "AUTHENTICATION" &&
    (/^[*_~`]*\{\{\d+\}\}/.test(trimmedBody) ||
      /\{\{\d+\}\}[*_~`]*$/.test(trimmedBody))
  ) {
    issues.push(
      "WhatsApp rejects messages that start or end directly with {{1}}. Add a word before or punctuation after."
    );
  }
  if (
    category === "UTILITY" &&
    buttons.some((b) => b.type === "COPY_CODE")
  ) {
    issues.push(
      "WhatsApp does not allow Copy Code buttons on Utility templates. Switch Category to Marketing for offer codes, or Authentication for OTP codes."
    );
  }

  const nums = Array.from(
    new Set(
      Array.from(trimmedBody.matchAll(/\{\{(\d+)\}\}/g)).map((m) =>
        Number(m[1])
      )
    )
  ).sort((a, b) => a - b);
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      issues.push(
        "Variable numbers must go in order ({{1}}, {{2}}, {{3}}) without skipping numbers."
      );
      break;
    }
  }
  for (const v of variablesSchema) {
    if (!v.sampleValue.trim()) {
      issues.push(
        `Enter a sample value for {{${v.index}}} so Meta approves it.`
      );
    }
  }
  if (
    (headerType === "IMAGE" ||
      headerType === "VIDEO" ||
      headerType === "DOCUMENT") &&
    !headerMediaUrl.trim()
  ) {
    issues.push(
      `Add a sample ${headerType.toLowerCase()} link or pick a product image.`
    );
  }
  if (
    category === "MARKETING" &&
    !/stop|opt\s*out|unsubscribe/i.test(
      `${footerText} ${bodyText} ${buttons.map((b) => b.text).join(" ")}`
    )
  ) {
    tips.push(
      "Recommended: Include 'Reply STOP to opt out' in the footer so customers can unsubscribe cleanly without reporting spam."
    );
  }

  return { issues, tips };
}

export function buildLiveMetaJsonPreview(params: {
  name: string;
  language: string;
  category: TemplateCategory;
  allowCategoryChange: boolean;
  headerType: HeaderType;
  headerText: string;
  headerMediaUrl: string;
  bodyText: string;
  variablesSchema: VariableSpec[];
  footerText: string;
  buttons: TemplateButton[];
}) {
  const {
    name,
    language,
    category,
    allowCategoryChange,
    headerType,
    headerText,
    headerMediaUrl,
    bodyText,
    variablesSchema,
    footerText,
    buttons,
  } = params;

  return {
    name: slugifyName(name) || "template_name",
    language,
    category,
    allow_category_change: allowCategoryChange,
    components: [
      ...(headerType !== "NONE"
        ? [
            {
              type: "HEADER",
              format: headerType,
              ...(headerType === "TEXT" ? { text: headerText } : {}),
              ...(headerType === "IMAGE" ||
              headerType === "VIDEO" ||
              headerType === "DOCUMENT"
                ? { example: { header_handle: [headerMediaUrl] } }
                : {}),
            },
          ]
        : []),
      {
        type: "BODY",
        text: bodyText,
        ...(variablesSchema.length > 0
          ? {
              example: {
                body_text: [variablesSchema.map((v) => v.sampleValue)],
              },
            }
          : {}),
      },
      ...(footerText.trim()
        ? [{ type: "FOOTER", text: footerText.trim() }]
        : []),
      ...(buttons.length > 0 ? [{ type: "BUTTONS", buttons }] : []),
    ],
  };
}
