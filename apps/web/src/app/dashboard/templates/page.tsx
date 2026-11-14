"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  MapPin,
  Pause,
  Phone,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Video,
  X,
} from "lucide-react";
import {
  CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE,
  ClassicConceptsMark,
  ElementErrorState,
  MetricStatCard,
  StatCardsSkeleton,
  TRACKING_PUBLIC_ORIGIN,
  TableRowsSkeleton,
  WHATSAPP_PUBLIC_ORIGIN,
  WhatsAppLogoIcon,
  WhatsAppMessageTicks,
} from "@cc/ui";

type HeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";
type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

interface TemplateButton {
  id: string;
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "OTP";
  text: string;
  url?: string;
  urlType?: "STATIC" | "DYNAMIC";
  exampleSuffix?: string;
  phoneNumber?: string;
  exampleCode?: string;
}

interface VariableSpec {
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

interface LocationHeader {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

interface TemplateRecord {
  id: string;
  name: string;
  language: string;
  category: TemplateCategory;
  headerType: HeaderType;
  headerText: string | null;
  headerMediaUrl: string | null;
  headerLocation: LocationHeader | null;
  bodyText: string;
  footerText: string | null;
  buttons: TemplateButton[];
  variablesSchema: VariableSpec[];
  allowCategoryChange: boolean;
  codeExpirationMinutes: number | null;
  approvalStatus: string;
  metaTemplateId: string | null;
  metaQualityScore: string;
  rejectionReason: string | null;
  sentCount: number;
  createdByName: string;
  updatedAt: string;
  metaPayloadPreview: Record<string, unknown>;
}

interface ShortLinkOption {
  id: string;
  code: string;
  title: string;
  targetUrl: string;
}

interface CatalogMediaOption {
  name: string;
  brandLabel: string;
  url: string;
  imageUrl: string;
}

const LANGUAGE_OPTIONS = [
  { code: "en", label: "English (en)" },
  { code: "en_IN", label: "English India (en_IN)" },
  { code: "en_US", label: "English US (en_US)" },
  { code: "hi", label: "Hindi (hi)" },
  { code: "te", label: "Telugu (te)" },
  { code: "ta", label: "Tamil (ta)" },
  { code: "kn", label: "Kannada (kn)" },
  { code: "mr", label: "Marathi (mr)" },
];

function formatWhatsAppRichText(raw: string): React.ReactNode[] {
  // Simple safe formatter for *bold*, _italic_, ~strike~, `code`
  const lines = raw.split("\n");
  return lines.map((line, lIdx) => {
    const tokens = line.split(/(\*[^*]+\*|_[^_]+_|~[^~]+~|`[^`]+`)/g);
    return (
      <React.Fragment key={lIdx}>
        {tokens.map((tok, tIdx) => {
          if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
            return <strong key={tIdx}>{tok.slice(1, -1)}</strong>;
          }
          if (tok.startsWith("_") && tok.endsWith("_") && tok.length > 2) {
            return <em key={tIdx}>{tok.slice(1, -1)}</em>;
          }
          if (tok.startsWith("~") && tok.endsWith("~") && tok.length > 2) {
            return <s key={tIdx}>{tok.slice(1, -1)}</s>;
          }
          if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
            return (
              <code
                key={tIdx}
                className="px-1 py-0.5 rounded bg-black/5 font-mono text-[12px]"
              >
                {tok.slice(1, -1)}
              </code>
            );
          }
          return <React.Fragment key={tIdx}>{tok}</React.Fragment>;
        })}
        {lIdx < lines.length - 1 && <br />}
      </React.Fragment>
    );
  });
}

function slugifyName(val: string): string {
  return val
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+/g, "")
    .slice(0, 120);
}

export default function TemplatesStudioPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [canManage, setCanManage] = useState<boolean>(false);
  const [isDev, setIsDev] = useState<boolean>(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false);
  const [rates, setRates] = useState({ marketingRateInr: 0.95, otherRateInr: 0.3 });

  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [customLinks, setCustomLinks] = useState<ShortLinkOption[]>([]);
  const [catalogMedia, setCatalogMedia] = useState<CatalogMediaOption[]>([]);

  const [banner, setBanner] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [syncingMeta, setSyncingMeta] = useState<boolean>(false);
  const [savingAction, setSavingAction] = useState<"" | "DRAFT" | "SUBMIT">("");

  // Library filters
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [catFilter, setCatFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Editor state
  const [editingId, setEditingId] = useState<string>("");
  const [name, setName] = useState<string>("new_podium_showcase_2026");
  const [language, setLanguage] = useState<string>("en");
  const [category, setCategory] = useState<TemplateCategory>("MARKETING");
  const [allowCategoryChange, setAllowCategoryChange] = useState<boolean>(true);
  const [codeExpirationMinutes, setCodeExpirationMinutes] = useState<number>(10);

  const [headerType, setHeaderType] = useState<HeaderType>("TEXT");
  const [headerText, setHeaderText] = useState<string>(
    "Clear Acrylic Podiums & Awards"
  );
  const [headerMediaUrl, setHeaderMediaUrl] = useState<string>("");
  const [headerLocation, setHeaderLocation] = useState<LocationHeader>({
    name: "Classic Concepts",
    address: "Rani Gunj, Secunderabad, Hyderabad, Telangana",
    latitude: 17.4326,
    longitude: 78.4913,
  });

  const [bodyText, setBodyText] = useState<string>(
    "Hello {{1}}, explore our crystal-clear acrylic stage podiums, mementos, and custom tabletop stands made at Classic Concepts."
  );
  const [footerText, setFooterText] = useState<string>(
    "Classic Concepts • Reply STOP to opt out"
  );
  const [buttons, setButtons] = useState<TemplateButton[]>([
    {
      id: "btn_1",
      type: "URL",
      text: "View Collection",
      url: `${WHATSAPP_PUBLIC_ORIGIN}/l/stage-podiums`,
      urlType: "STATIC",
    },
    {
      id: "btn_2",
      type: "QUICK_REPLY",
      text: "Talk to Sales Team",
    },
  ]);
  const [variablesSchema, setVariablesSchema] = useState<VariableSpec[]>([
    {
      index: 1,
      label: "Customer First Name",
      sourceField: "customer.firstName",
      sampleValue: "Vikram",
    },
  ]);

  // Right preview tab (Phone Preview vs Dev Meta Payload)
  const [previewTab, setPreviewTab] = useState<"PHONE" | "JSON">("PHONE");
  const [copiedJson, setCopiedJson] = useState<boolean>(false);

  // Test send modal
  const [testModalTpl, setTestModalTpl] = useState<TemplateRecord | null>(null);
  const [testPhone, setTestPhone] = useState<string>("+91 98480 11223");
  const [sendingTest, setSendingTest] = useState<boolean>(false);
  const [testSendError, setTestSendError] = useState<string>("");

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const editorTopRef = useRef<HTMLDivElement | null>(null);

  const loadTemplatesData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/templates", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setLoadError(
          data.error || "Could not load WhatsApp templates right now."
        );
        return;
      }
      setCanManage(Boolean(data.canManage));
      setIsDev(Boolean(data.isDev));
      setIsSuperAdmin(Boolean(data.isSuperAdmin));
      setRates(data.rates || { marketingRateInr: 0.95, otherRateInr: 0.3 });
      setTemplates(data.templates || []);
      setCustomLinks(data.customLinks || []);
      setCatalogMedia(data.catalogMediaItems || []);
    } catch {
      setLoadError("Network error while loading WhatsApp templates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplatesData();
  }, [loadTemplatesData]);

  // Keep variablesSchema synchronized whenever {{n}} placeholders in body/header change
  useEffect(() => {
    const combined = `${headerType === "TEXT" ? headerText : ""} ${bodyText}`;
    const indices = Array.from(
      new Set(
        Array.from(combined.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1]))
      )
    ).sort((a, b) => a - b);

    setVariablesSchema((prev) =>
      indices.map((idx) => {
        const existing = prev.find((p) => p.index === idx);
        if (existing) return existing;
        if (category === "AUTHENTICATION" && idx === 1) {
          return {
            index: 1,
            label: "Verification Code",
            sourceField: "custom",
            sampleValue: "482910",
          };
        }
        if (idx === 1) {
          return {
            index: 1,
            label: "Customer First Name",
            sourceField: "customer.firstName",
            sampleValue: "Vikram",
          };
        }
        if (idx === 2) {
          return {
            index: 2,
            label: "Order Number",
            sourceField: "order.latestNumber",
            sampleValue: "CC-2026-1089",
          };
        }
        return {
          index: idx,
          label: `Detail ${idx}`,
          sourceField: "custom",
          sampleValue: "ready for dispatch",
        };
      })
    );
  }, [bodyText, headerText, headerType, category]);

  function notifySuccess(msg: string) {
    setBanner(msg);
    setActionError("");
    setTimeout(() => setBanner(""), 4500);
  }

  function applyStarterPreset(
    preset:
      | "HOSPITALITY"
      | "CE53_MACHINE"
      | "ORDER_UPDATE"
      | "PAYMENT_QUOTE"
      | "OTP_CODE"
      | "SHOWROOM_MAP"
  ) {
    setEditingId("");
    setActionError("");
    if (preset === "HOSPITALITY") {
      setName("hotel_banquet_podium_offer");
      setCategory("MARKETING");
      setHeaderType("TEXT");
      setHeaderText("Clear Acrylic Podiums & Menu Stands");
      setBodyText(
        "Hello {{1}}, check out our latest crystal-clear banquet podiums and tabletop menu holders crafted at Classic Concepts for hotels and convention halls."
      );
      setFooterText("Classic Concepts • Reply STOP to opt out");
      setButtons([
        {
          id: "b1",
          type: "URL",
          text: "View Hotel Catalog",
          url: `${WHATSAPP_PUBLIC_ORIGIN}/l/stage-podiums`,
          urlType: "STATIC",
        },
        { id: "b2", type: "QUICK_REPLY", text: "Talk to Sales Team" },
        { id: "b3", type: "QUICK_REPLY", text: "STOP" },
      ]);
    } else if (preset === "CE53_MACHINE") {
      setName("ce53_acrylic_machines_quote");
      setCategory("MARKETING");
      setHeaderType("IMAGE");
      setHeaderMediaUrl(
        catalogMedia[0]?.imageUrl ||
          "https://classicedge53.com/images/machines-hero.jpg"
      );
      setBodyText(
        "Hello {{1}}, looking for diamond edge polishing machines, acrylic benders, or CNC routers? Explore *Classic Edge 53* machines ready with spares and support."
      );
      setFooterText("Classic Edge 53 • Reply STOP to opt out");
      setButtons([
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
      ]);
    } else if (preset === "ORDER_UPDATE") {
      setName("cc_order_dispatch_alert");
      setCategory("UTILITY");
      setHeaderType("TEXT");
      setHeaderText("Order Status Update");
      setBodyText(
        "Hello {{1}}, your Classic Concepts order *{{2}}* is now *{{3}}*. Reply to this message anytime if you need transport details."
      );
      setFooterText("Classic Concepts Dispatch Desk");
      setButtons([
        { id: "b1", type: "QUICK_REPLY", text: "Share LR / Tracking" },
      ]);
    } else if (preset === "PAYMENT_QUOTE") {
      setName("cc_quote_approval_link");
      setCategory("UTILITY");
      setHeaderType("DOCUMENT");
      setHeaderMediaUrl("https://www.classicconcepts.in/sample-quote.pdf");
      setBodyText(
        "Hello {{1}}, we have prepared the specification sheet and quote for *{{2}}*. Review the PDF above or click below to confirm."
      );
      setFooterText("Classic Concepts Accounts & Sales");
      setButtons([
        {
          id: "b1",
          type: "URL",
          text: "Open Quote Link",
          url: `${WHATSAPP_PUBLIC_ORIGIN}/l/pune-guard-quote`,
          urlType: "STATIC",
        },
        { id: "b2", type: "QUICK_REPLY", text: "Confirm Order" },
      ]);
    } else if (preset === "OTP_CODE") {
      setName("cc_verification_otp");
      setCategory("AUTHENTICATION");
      setHeaderType("NONE");
      setCodeExpirationMinutes(10);
      setBodyText(
        "*{{1}}* is your Classic Concepts verification code. For your security, do not share this code with anyone."
      );
      setFooterText("Expires in 10 minutes");
      setButtons([
        {
          id: "b1",
          type: "COPY_CODE",
          text: "Copy Code",
          exampleCode: "482910",
        },
      ]);
    } else if (preset === "SHOWROOM_MAP") {
      setName("cc_factory_showroom_location");
      setCategory("MARKETING");
      setHeaderType("LOCATION");
      setHeaderLocation({
        name: "Classic Concepts Showroom & Factory",
        address: "Rani Gunj, Secunderabad, Hyderabad, Telangana",
        latitude: 17.4326,
        longitude: 78.4913,
      });
      setBodyText(
        "Hello {{1}}, you are invited to inspect acrylic samples and finishes in person at our Hyderabad display desk. Tap the map above for directions."
      );
      setFooterText("Classic Concepts • Reply STOP to opt out");
      setButtons([
        {
          id: "b1",
          type: "PHONE_NUMBER",
          text: "Call Before Visiting",
          phoneNumber: "+917337222876",
        },
      ]);
    }
  }

  function loadTemplateIntoEditor(tpl: TemplateRecord) {
    setEditingId(tpl.id);
    setName(tpl.name);
    setLanguage(tpl.language || "en");
    setCategory(tpl.category);
    setAllowCategoryChange(tpl.allowCategoryChange);
    setCodeExpirationMinutes(tpl.codeExpirationMinutes || 10);
    setHeaderType(tpl.headerType || "NONE");
    setHeaderText(tpl.headerText || "");
    setHeaderMediaUrl(tpl.headerMediaUrl || "");
    if (tpl.headerLocation) setHeaderLocation(tpl.headerLocation);
    setBodyText(tpl.bodyText);
    setFooterText(tpl.footerText || "");
    setButtons(
      tpl.buttons.length > 0
        ? tpl.buttons
        : tpl.category === "AUTHENTICATION"
        ? [
            {
              id: "btn_otp",
              type: "COPY_CODE",
              text: "Copy Code",
              exampleCode: "482910",
            },
          ]
        : []
    );
    if (tpl.variablesSchema.length > 0) {
      setVariablesSchema(tpl.variablesSchema);
    }
    setActionError("");
    editorTopRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  function wrapBodySelection(marker: "*" | "_" | "~" | "`") {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? bodyText.length;
    const end = el.selectionEnd ?? bodyText.length;
    const selected = bodyText.slice(start, end) || "text";
    const next =
      bodyText.slice(0, start) +
      `${marker}${selected}${marker}` +
      bodyText.slice(end);
    setBodyText(next);
  }

  function insertNextVariable() {
    const existingNums = Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g)).map(
      (m) => Number(m[1])
    );
    const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    const token = `{{${nextNum}}}`;
    const el = bodyRef.current;
    if (!el) {
      setBodyText((p) => `${p} ${token}`);
      return;
    }
    const start = el.selectionStart ?? bodyText.length;
    const end = el.selectionEnd ?? bodyText.length;
    setBodyText(
      bodyText.slice(0, start) + token + bodyText.slice(end)
    );
  }

  function addButton(type: TemplateButton["type"]) {
    if (buttons.length >= 10) return;
    const id = `btn_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    if (type === "URL") {
      setButtons((prev) => [
        ...prev,
        {
          id,
          type: "URL",
          text: "Open Link",
          url:
            customLinks[0]
              ? `${WHATSAPP_PUBLIC_ORIGIN}/l/${customLinks[0].code}`
              : "https://www.classicconcepts.in",
          urlType: "STATIC",
        },
      ]);
    } else if (type === "PHONE_NUMBER") {
      setButtons((prev) => [
        ...prev,
        {
          id,
          type: "PHONE_NUMBER",
          text: "Call Sales Desk",
          phoneNumber: "+917337222876",
        },
      ]);
    } else if (type === "COPY_CODE") {
      setButtons((prev) => [
        ...prev,
        {
          id,
          type: "COPY_CODE",
          text: "Copy Offer Code",
          exampleCode: "CLASSIC10",
        },
      ]);
    } else {
      setButtons((prev) => [
        ...prev,
        {
          id,
          type: "QUICK_REPLY",
          text: "Talk to Sales Team",
        },
      ]);
    }
  }

  function moveButton(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= buttons.length) return;
    const copy = [...buttons];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    setButtons(copy);
  }

  // Live Pre-Check Rules (Plain Layman English)
  const liveChecks = useMemo(() => {
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
      (/^\{\{\d+\}\}/.test(trimmedBody) || /\{\{\d+\}\}$/.test(trimmedBody))
    ) {
      issues.push(
        "WhatsApp rejects messages that start or end directly with {{1}}. Add a word before or punctuation after."
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
        issues.push(`Enter a sample value for {{${v.index}}} so Meta approves it.`);
      }
    }
    if (
      (headerType === "IMAGE" ||
        headerType === "VIDEO" ||
        headerType === "DOCUMENT") &&
      !headerMediaUrl.trim()
    ) {
      issues.push(`Add a sample ${headerType.toLowerCase()} link or pick a product image.`);
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
  }, [
    name,
    bodyText,
    category,
    variablesSchema,
    headerType,
    headerMediaUrl,
    footerText,
    buttons,
  ]);

  // Live substituted body & header for phone preview
  const previewBodyRendered = useMemo(() => {
    let out = bodyText;
    for (const v of variablesSchema) {
      out = out.replace(
        new RegExp(`\\{\\{${v.index}\\}\\}`, "g"),
        v.sampleValue || `{{${v.index}}}`
      );
    }
    return out;
  }, [bodyText, variablesSchema]);

  const previewHeaderRendered = useMemo(() => {
    let out = headerText;
    for (const v of variablesSchema) {
      out = out.replace(
        new RegExp(`\\{\\{${v.index}\\}\\}`, "g"),
        v.sampleValue || `{{${v.index}}}`
      );
    }
    return out;
  }, [headerText, variablesSchema]);

  const liveMetaJsonPreview = useMemo(() => {
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
        ...(footerText.trim() ? [{ type: "FOOTER", text: footerText.trim() }] : []),
        ...(buttons.length > 0 ? [{ type: "BUTTONS", buttons }] : []),
      ],
    };
  }, [
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
  ]);

  async function handleSaveOrSubmit(mode: "save_draft" | "submit_to_meta") {
    setSavingAction(mode === "save_draft" ? "DRAFT" : "SUBMIT");
    setActionError("");
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode,
          id: editingId || undefined,
          name: slugifyName(name),
          language,
          category,
          allowCategoryChange,
          codeExpirationMinutes,
          headerType,
          headerText,
          headerMediaUrl,
          headerLocation,
          bodyText,
          footerText,
          buttons,
          variablesSchema,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setActionError(data.error || "Could not save template.");
        return;
      }
      if (data.templateId) setEditingId(data.templateId);
      notifySuccess(data.message || "Template saved.");
      await loadTemplatesData();
    } catch {
      setActionError("Network error while saving template. Please try again.");
    } finally {
      setSavingAction("");
    }
  }

  async function handleSyncFromMeta() {
    setSyncingMeta(true);
    setActionError("");
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_meta" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setActionError(data.message || data.error || "Could not sync from Meta.");
        return;
      }
      notifySuccess(data.message || "Synced templates.");
      await loadTemplatesData();
    } catch {
      setActionError("Network error while syncing with Meta.");
    } finally {
      setSyncingMeta(false);
    }
  }

  async function handleRowAction(
    action: "duplicate_template" | "toggle_pause" | "delete_template",
    tpl: TemplateRecord
  ) {
    if (
      action === "delete_template" &&
      !window.confirm(`Delete template "${tpl.name}"?`)
    ) {
      return;
    }
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, templateId: tpl.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setActionError(data.error || "Action failed.");
      return;
    }
    if (editingId === tpl.id && action === "delete_template") {
      setEditingId("");
    }
    notifySuccess(data.message || "Updated template.");
    await loadTemplatesData();
  }

  async function handleDevReviewStatus(
    tpl: TemplateRecord,
    status: "APPROVED" | "REJECTED"
  ) {
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set_review_status",
        templateId: tpl.id,
        status,
        rejectionReason:
          status === "REJECTED"
            ? "Sample variable values did not match message context."
            : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      notifySuccess(`Marked "${tpl.name}" as ${status}.`);
      await loadTemplatesData();
    }
  }

  async function handleSendTestMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!testModalTpl || !testPhone.trim()) return;
    setSendingTest(true);
    setTestSendError("");
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_test_template",
          templateId: testModalTpl.id,
          toPhone: testPhone,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setTestSendError(data.error || "Could not send test message.");
        return;
      }
      setTestModalTpl(null);
      notifySuccess(data.message || "Test template message sent.");
      await loadTemplatesData();
    } catch {
      setTestSendError("Network error while sending test message.");
    } finally {
      setSendingTest(false);
    }
  }

  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (catFilter !== "ALL" && t.category !== catFilter) return false;
      if (statusFilter !== "ALL" && t.approvalStatus !== statusFilter)
        return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${t.name} ${t.bodyText} ${t.headerText || ""} ${t.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [templates, catFilter, statusFilter, searchQuery]);

  const approvedCount = templates.filter(
    (t) => t.approvalStatus === "APPROVED"
  ).length;
  const draftOrPendingCount = templates.filter(
    (t) =>
      t.approvalStatus === "DRAFT" || t.approvalStatus === "PENDING_APPROVAL"
  ).length;
  const unitPrice =
    category === "MARKETING" ? rates.marketingRateInr : rates.otherRateInr;

  return (
    <div ref={editorTopRef} className="w-full px-6 py-5 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            WhatsApp Message Templates Studio
          </h1>
          <p className="text-[13.5px] leading-relaxed text-slate-500 mt-1 max-w-3xl">
            Design, preview, test, and submit WhatsApp templates with headers, dynamic variables, interactive buttons, and short links.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/dashboard/marketing"
            className="px-3 py-2 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-800"
          >
            Go to Broadcast Queue
          </Link>
          {canManage && (
            <>
              <button
                type="button"
                disabled={syncingMeta}
                onClick={handleSyncFromMeta}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-800 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${syncingMeta ? "animate-spin" : ""}`}
                />
                <span>{syncingMeta ? "Syncing..." : "Sync with Meta"}</span>
              </button>
              <button
                type="button"
                onClick={() => applyStarterPreset("HOSPITALITY")}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Reset New Blank / Preset</span>
              </button>
            </>
          )}
        </div>
      </div>

      {banner && (
        <div className="p-3.5 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900">
          {banner}
        </div>
      )}
      {actionError && (
        <ElementErrorState
          title="Action could not be completed"
          message={actionError}
          onRetry={() => setActionError("")}
          compact
        />
      )}

      {/* Element-Wise Loading Fallback & Retry for Top Summary Metrics */}
      {loading ? (
        <StatCardsSkeleton count={4} />
      ) : loadError ? (
        <ElementErrorState
          title="Could not load template summary"
          message={loadError}
          onRetry={loadTemplatesData}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricStatCard
            label="Total Templates"
            value={String(templates.length)}
            subtext="Across all languages & types"
          />
          <MetricStatCard
            label="Approved & Ready"
            value={String(approvedCount)}
            subtext="Available in Customer Chats & Broadcasts"
          />
          <MetricStatCard
            label="Drafts & In Review"
            value={String(draftOrPendingCount)}
            subtext="Saved drafts or awaiting Meta review"
          />
          <MetricStatCard
            label="Template Message Rates"
            value={`₹${rates.marketingRateInr.toFixed(2)} / ₹${rates.otherRateInr.toFixed(2)}`}
            subtext="Marketing ₹0.95 • Utility & OTP ₹0.30"
          />
        </div>
      )}

      {/* ===================================================================== */}
      {/* FULL VISUAL BUILDER + LIVE WHATSAPP PHONE PREVIEW (MANAGER & DEV)     */}
      {/* ===================================================================== */}
      {!loading && !canManage && !loadError ? (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950">
          You have view-only access to templates. Ask a Manager, Superadmin, or Dev if you need a new template created, or use any Approved template directly from Customer Chats.
        </div>
      ) : (
        canManage && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* LEFT 7 COLUMNS: FULL TEMPLATE COMPOSER */}
            <div className="xl:col-span-7 bg-white rounded-lg border border-neutral-200 p-5 space-y-5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">
                    {editingId
                      ? `Editing Template: ${name}`
                      : "Create WhatsApp Message Template"}
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Pick a starter preset below or customize every section from scratch.
                  </p>
                </div>
                {editingId && (
                  <button
                    type="button"
                    onClick={() => setEditingId("")}
                    className="px-2.5 py-1 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                  >
                    Exit Edit Mode (Save as New)
                  </button>
                )}
              </div>

              {/* Starter Presets */}
              <div className="space-y-1.5">
                <label className="block font-medium text-neutral-700">
                  1-Click Starter Templates
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: "HOSPITALITY", label: "Hotel & Podium Offer" },
                    { id: "CE53_MACHINE", label: "Classic Edge 53 Machines" },
                    { id: "ORDER_UPDATE", label: "Order Dispatch Update" },
                    { id: "PAYMENT_QUOTE", label: "PDF Quote & Link" },
                    { id: "OTP_CODE", label: "6-Digit OTP Code" },
                    { id: "SHOWROOM_MAP", label: "Factory Map Invite" },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        applyStarterPreset(p.id as Parameters<typeof applyStarterPreset>[0])
                      }
                      className="px-2.5 py-1.5 rounded-md bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-medium cursor-pointer"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 1: Name, Category, Language */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-neutral-700 mb-1">
                    Template Name (lowercase_with_underscores)
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(slugifyName(e.target.value))}
                    placeholder="diwali_podium_offer_2026"
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block font-medium text-neutral-700 mb-1">
                    Message Category & Rate
                  </label>
                  <select
                    value={category}
                    onChange={(e) =>
                      setCategory(e.target.value as TemplateCategory)
                    }
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
                  >
                    <option value="MARKETING">
                      Marketing / Offers (₹{rates.marketingRateInr.toFixed(2)})
                    </option>
                    <option value="UTILITY">
                      Utility / Order Updates (₹{rates.otherRateInr.toFixed(2)})
                    </option>
                    <option value="AUTHENTICATION">
                      Authentication / OTP Code (₹{rates.otherRateInr.toFixed(2)})
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-neutral-700 mb-1">
                    Language
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
                  >
                    {LANGUAGE_OPTIONS.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2">
                <label className="inline-flex items-center gap-2 cursor-pointer text-neutral-700">
                  <input
                    type="checkbox"
                    checked={allowCategoryChange}
                    onChange={(e) => setAllowCategoryChange(e.target.checked)}
                    className="rounded accent-[#00a884]"
                  />
                  <span>
                    Allow Meta to automatically switch category if needed so review is not rejected
                  </span>
                </label>

                {category === "AUTHENTICATION" && (
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-600">OTP Expiry (mins):</span>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={codeExpirationMinutes}
                      onChange={(e) =>
                        setCodeExpirationMinutes(Number(e.target.value))
                      }
                      className="w-16 rounded border border-neutral-300 bg-white px-2 py-1 text-center"
                    />
                  </div>
                )}
              </div>

              {/* Step 2: Header Builder */}
              {category !== "AUTHENTICATION" && (
                <div className="p-3.5 rounded-lg border border-neutral-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-neutral-900">
                      Header (Optional Top Banner)
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          { key: "NONE", label: "None" },
                          { key: "TEXT", label: "Text" },
                          { key: "IMAGE", label: "Image" },
                          { key: "VIDEO", label: "Video" },
                          { key: "DOCUMENT", label: "PDF / Doc" },
                          { key: "LOCATION", label: "Map Location" },
                        ] as const
                      ).map((h) => (
                        <button
                          key={h.key}
                          type="button"
                          onClick={() => setHeaderType(h.key)}
                          className={`px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer ${
                            headerType === h.key
                              ? "bg-neutral-900 text-white"
                              : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                          }`}
                        >
                          {h.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {headerType === "TEXT" && (
                    <div>
                      <div className="flex items-center justify-between mb-1 text-[11px] text-neutral-500">
                        <span>Bold title shown above the message</span>
                        <span>{headerText.length}/60</span>
                      </div>
                      <input
                        type="text"
                        maxLength={60}
                        value={headerText}
                        onChange={(e) => setHeaderText(e.target.value)}
                        placeholder="e.g. New Clear Acrylic Podiums"
                        className="w-full rounded-md border border-neutral-300 px-3 py-2"
                      />
                    </div>
                  )}

                  {(headerType === "IMAGE" ||
                    headerType === "VIDEO" ||
                    headerType === "DOCUMENT") && (
                    <div className="space-y-2">
                      <input
                        type="url"
                        value={headerMediaUrl}
                        onChange={(e) => setHeaderMediaUrl(e.target.value)}
                        placeholder={
                          headerType === "IMAGE"
                            ? "https://www.classicconcepts.in/.../product.jpg"
                            : headerType === "VIDEO"
                            ? "https://www.classicconcepts.in/.../demo.mp4"
                            : "https://www.classicconcepts.in/.../catalog.pdf"
                        }
                        className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
                      />
                      {headerType === "IMAGE" && catalogMedia.length > 0 && (
                        <div>
                          <label className="block text-[11px] text-neutral-500 mb-1">
                            Or pick a product / machine image from Classic Concepts & Classic Edge 53:
                          </label>
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) setHeaderMediaUrl(e.target.value);
                            }}
                            className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 bg-white"
                          >
                            <option value="">
                              Select a catalog photo to insert...
                            </option>
                            {catalogMedia.map((item, idx) => (
                              <option key={idx} value={item.imageUrl}>
                                [{item.brandLabel}] {item.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}

                  {headerType === "LOCATION" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        type="text"
                        value={headerLocation.name}
                        onChange={(e) =>
                          setHeaderLocation((p) => ({ ...p, name: e.target.value }))
                        }
                        placeholder="Location Name"
                        className="rounded-md border border-neutral-300 px-3 py-1.5"
                      />
                      <input
                        type="text"
                        value={headerLocation.address}
                        onChange={(e) =>
                          setHeaderLocation((p) => ({
                            ...p,
                            address: e.target.value,
                          }))
                        }
                        placeholder="Street Address & City"
                        className="rounded-md border border-neutral-300 px-3 py-1.5"
                      />
                      <input
                        type="number"
                        step="0.0001"
                        value={headerLocation.latitude}
                        onChange={(e) =>
                          setHeaderLocation((p) => ({
                            ...p,
                            latitude: Number(e.target.value),
                          }))
                        }
                        placeholder="Latitude"
                        className="rounded-md border border-neutral-300 px-3 py-1.5 font-mono"
                      />
                      <input
                        type="number"
                        step="0.0001"
                        value={headerLocation.longitude}
                        onChange={(e) =>
                          setHeaderLocation((p) => ({
                            ...p,
                            longitude: Number(e.target.value),
                          }))
                        }
                        placeholder="Longitude"
                        className="rounded-md border border-neutral-300 px-3 py-1.5 font-mono"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Body Editor + Formatting Toolbar + Dynamic Variable Mapping */}
              <div className="p-3.5 rounded-lg border border-neutral-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-neutral-900">
                    Message Body
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => wrapBodySelection("*")}
                      className="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 font-bold cursor-pointer"
                      title="Bold"
                    >
                      B
                    </button>
                    <button
                      type="button"
                      onClick={() => wrapBodySelection("_")}
                      className="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 italic cursor-pointer"
                      title="Italic"
                    >
                      I
                    </button>
                    <button
                      type="button"
                      onClick={() => wrapBodySelection("~")}
                      className="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 line-through cursor-pointer"
                      title="Strikethrough"
                    >
                      S
                    </button>
                    <button
                      type="button"
                      onClick={() => wrapBodySelection("`")}
                      className="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 font-mono cursor-pointer"
                      title="Monospace"
                    >
                      {"</>"}
                    </button>
                    <button
                      type="button"
                      onClick={insertNextVariable}
                      className="px-2.5 py-1 rounded bg-[#e7fce3] hover:bg-[#d3f8cc] text-[#008069] font-semibold cursor-pointer"
                    >
                      + Add Variable {"{{n}}"}
                    </button>
                  </div>
                </div>

                <textarea
                  ref={bodyRef}
                  rows={4}
                  maxLength={1024}
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm leading-relaxed"
                />
                <div className="flex justify-between text-[11px] text-neutral-500">
                  <span>
                    Use {"{{1}}"}, {"{{2}}"} for customer name, order number, or custom fields.
                  </span>
                  <span>{bodyText.length}/1024</span>
                </div>

                {/* Variable Mapping & Sample Values */}
                {variablesSchema.length > 0 && (
                  <div className="bg-neutral-50 rounded-md border border-neutral-200 p-3 space-y-2">
                    <div className="font-semibold text-neutral-800">
                      Variable Auto-Fill & Sample Values (Required by WhatsApp)
                    </div>
                    {variablesSchema.map((v) => (
                      <div
                        key={v.index}
                        className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                      >
                        <span className="sm:col-span-2 font-mono font-semibold text-[#008069]">
                          {`{{${v.index}}}`}
                        </span>
                        <select
                          value={v.sourceField}
                          onChange={(e) => {
                            const nextField = e.target
                              .value as VariableSpec["sourceField"];
                            setVariablesSchema((prev) =>
                              prev.map((item) =>
                                item.index === v.index
                                  ? { ...item, sourceField: nextField }
                                  : item
                              )
                            );
                          }}
                          className="sm:col-span-5 rounded border border-neutral-300 bg-white px-2.5 py-1.5"
                        >
                          <option value="customer.firstName">
                            Auto-fill: Customer First Name
                          </option>
                          <option value="customer.fullName">
                            Auto-fill: Customer Full Name
                          </option>
                          <option value="customer.companyName">
                            Auto-fill: Company / Institution
                          </option>
                          <option value="customer.city">
                            Auto-fill: Customer City
                          </option>
                          <option value="order.latestNumber">
                            Auto-fill: Latest Order Number
                          </option>
                          <option value="custom">Custom / Manual Text</option>
                        </select>
                        <input
                          type="text"
                          value={v.sampleValue}
                          onChange={(e) => {
                            const val = e.target.value;
                            setVariablesSchema((prev) =>
                              prev.map((item) =>
                                item.index === v.index
                                  ? { ...item, sampleValue: val }
                                  : item
                              )
                            );
                          }}
                          placeholder={`Sample for {{${v.index}}} (e.g. Vikram)`}
                          className="sm:col-span-5 rounded border border-neutral-300 bg-white px-2.5 py-1.5"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Step 4: Footer */}
              <div className="p-3.5 rounded-lg border border-neutral-200 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-neutral-900">
                    Footer (Optional Grey Note)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setFooterText("Classic Concepts • Reply STOP to opt out")
                    }
                    className="text-[11px] font-medium text-[#008069] hover:underline cursor-pointer"
                  >
                    + Insert &ldquo;Reply STOP to opt out&rdquo;
                  </button>
                </div>
                <input
                  type="text"
                  maxLength={60}
                  value={footerText}
                  onChange={(e) => setFooterText(e.target.value)}
                  placeholder="Classic Concepts • Reply STOP to opt out"
                  className="w-full rounded-md border border-neutral-300 px-3 py-1.5"
                />
              </div>

              {/* Step 5: Interactive Buttons Suite */}
              <div className="p-3.5 rounded-lg border border-neutral-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-neutral-900">
                      Interactive Buttons ({buttons.length}/10)
                    </span>
                    <p className="text-[11px] text-neutral-500">
                      Add clickable website/short-link buttons, phone call buttons, coupon copy buttons, or quick replies.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => addButton("QUICK_REPLY")}
                      className="px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 font-medium cursor-pointer"
                    >
                      + Quick Reply
                    </button>
                    <button
                      type="button"
                      onClick={() => addButton("URL")}
                      className="px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 font-medium cursor-pointer"
                    >
                      + Website / Short Link
                    </button>
                    <button
                      type="button"
                      onClick={() => addButton("PHONE_NUMBER")}
                      className="px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 font-medium cursor-pointer"
                    >
                      + Phone Call
                    </button>
                    <button
                      type="button"
                      onClick={() => addButton("COPY_CODE")}
                      className="px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 font-medium cursor-pointer"
                    >
                      + Copy Code
                    </button>
                  </div>
                </div>

                {buttons.length === 0 ? (
                  <p className="text-neutral-500 text-center py-2">
                    No buttons added. Click any button type above to add one.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {buttons.map((btn, idx) => (
                      <div
                        key={btn.id}
                        className="p-3 rounded-md bg-neutral-50 border border-neutral-200 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="px-2 py-0.5 rounded bg-white border border-neutral-300 text-[11px] font-semibold">
                            {btn.type === "URL"
                              ? "Visit Website"
                              : btn.type === "PHONE_NUMBER"
                              ? "Call Phone Number"
                              : btn.type === "COPY_CODE" || btn.type === "OTP"
                              ? "Copy Code"
                              : "Quick Reply"}
                          </span>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => moveButton(idx, -1)}
                              disabled={idx === 0}
                              className="p-1 text-neutral-500 hover:text-neutral-900 disabled:opacity-30 cursor-pointer"
                              title="Move up"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveButton(idx, 1)}
                              disabled={idx === buttons.length - 1}
                              className="p-1 text-neutral-500 hover:text-neutral-900 disabled:opacity-30 cursor-pointer"
                              title="Move down"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setButtons((prev) =>
                                  prev.filter((b) => b.id !== btn.id)
                                )
                              }
                              className="p-1 text-neutral-400 hover:text-red-600 cursor-pointer"
                              title="Remove button"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                          <input
                            type="text"
                            maxLength={25}
                            value={btn.text}
                            onChange={(e) => {
                              const val = e.target.value;
                              setButtons((prev) =>
                                prev.map((b) =>
                                  b.id === btn.id ? { ...b, text: val } : b
                                )
                              );
                            }}
                            placeholder="Button Label (max 25 chars)"
                            className="sm:col-span-5 rounded border border-neutral-300 bg-white px-2.5 py-1.5"
                          />

                          {btn.type === "URL" && (
                            <>
                              <input
                                type="url"
                                value={btn.url || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setButtons((prev) =>
                                    prev.map((b) =>
                                      b.id === btn.id ? { ...b, url: val } : b
                                    )
                                  );
                                }}
                                placeholder="https://whatsapp.ccapl.cc/l/stage-podiums"
                                className="sm:col-span-7 rounded border border-neutral-300 bg-white px-2.5 py-1.5 font-mono"
                              />
                              <div className="sm:col-span-12 flex flex-wrap items-center justify-between gap-2 pt-0.5">
                                <select
                                  value={btn.urlType || "STATIC"}
                                  onChange={(e) => {
                                    const nextType = e.target.value as
                                      | "STATIC"
                                      | "DYNAMIC";
                                    setButtons((prev) =>
                                      prev.map((b) =>
                                        b.id === btn.id
                                          ? { ...b, urlType: nextType }
                                          : b
                                      )
                                    );
                                  }}
                                  className="rounded border border-neutral-300 bg-white px-2 py-1 text-[11px]"
                                >
                                  <option value="STATIC">Fixed Link</option>
                                  <option value="DYNAMIC">
                                    Dynamic Link Suffix (adds {"{{1}}"} at end)
                                  </option>
                                </select>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setButtons((prev) =>
                                      prev.map((b) =>
                                        b.id === btn.id
                                          ? {
                                              ...b,
                                              text: b.text || "Track Order",
                                              urlType: "DYNAMIC",
                                              url: `${TRACKING_PUBLIC_ORIGIN}/{{1}}`,
                                            }
                                          : b
                                      )
                                    );
                                  }}
                                  className="rounded border border-[#00a884]/45 bg-[#e7fce3] hover:bg-[#d9fdd3] px-2.5 py-1 text-[11px] font-semibold text-[#008069] cursor-pointer"
                                >
                                  Use Order Track (track.ccapl.cc/{"{{1}}"})
                                </button>

                                {customLinks.length > 0 && (
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      const chosen = e.target.value;
                                      if (!chosen) return;
                                      setButtons((prev) =>
                                        prev.map((b) =>
                                          b.id === btn.id
                                            ? {
                                                ...b,
                                                url: `${WHATSAPP_PUBLIC_ORIGIN}/l/${chosen}`,
                                              }
                                            : b
                                        )
                                      );
                                    }}
                                    className="rounded border border-neutral-300 bg-white px-2 py-1 text-[11px]"
                                  >
                                    <option value="">
                                      Insert short link (/l/...)...
                                    </option>
                                    {customLinks.map((lnk) => (
                                      <option key={lnk.id} value={lnk.code}>
                                        /l/{lnk.code} ({lnk.title})
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </>
                          )}

                          {btn.type === "PHONE_NUMBER" && (
                            <input
                              type="text"
                              value={btn.phoneNumber || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setButtons((prev) =>
                                  prev.map((b) =>
                                    b.id === btn.id
                                      ? { ...b, phoneNumber: val }
                                      : b
                                  )
                                );
                              }}
                              placeholder="+917337222876"
                              className="sm:col-span-7 rounded border border-neutral-300 bg-white px-2.5 py-1.5 font-mono"
                            />
                          )}

                          {(btn.type === "COPY_CODE" || btn.type === "OTP") && (
                            <input
                              type="text"
                              maxLength={15}
                              value={btn.exampleCode || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setButtons((prev) =>
                                  prev.map((b) =>
                                    b.id === btn.id
                                      ? { ...b, exampleCode: val }
                                      : b
                                  )
                                );
                              }}
                              placeholder="Sample Code (e.g. CLASSIC10)"
                              className="sm:col-span-7 rounded border border-neutral-300 bg-white px-2.5 py-1.5 font-mono"
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pre-Submission Check Box */}
              {(liveChecks.issues.length > 0 || liveChecks.tips.length > 0) && (
                <div className="space-y-2">
                  {liveChecks.issues.length > 0 && (
                    <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-900 space-y-1">
                      <div className="font-semibold">
                        Fix before submitting to WhatsApp:
                      </div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {liveChecks.issues.map((iss, idx) => (
                          <li key={idx}>{iss}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {liveChecks.tips.map((tip, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-950"
                    >
                      {tip}
                    </div>
                  ))}
                </div>
              )}

              {/* Save Draft vs Submit for Approval */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-neutral-200">
                <span className="text-xs text-neutral-600">
                  Cost when sent: <strong>₹{unitPrice.toFixed(2)}</strong> per message
                </span>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={savingAction !== ""}
                    onClick={() => handleSaveOrSubmit("save_draft")}
                    className="px-4 py-2.5 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 font-medium text-neutral-800 cursor-pointer disabled:opacity-50"
                  >
                    {savingAction === "DRAFT" ? "Saving..." : "Save as Draft"}
                  </button>
                  <button
                    type="button"
                    disabled={
                      savingAction !== "" || liveChecks.issues.length > 0
                    }
                    onClick={() => handleSaveOrSubmit("submit_to_meta")}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white font-semibold cursor-pointer disabled:opacity-50"
                  >
                    <WhatsAppLogoIcon size={14} />
                    <span>
                      {savingAction === "SUBMIT"
                        ? "Submitting..."
                        : editingId
                        ? "Update & Submit to WhatsApp"
                        : "Submit for WhatsApp Approval"}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {/* RIGHT 5 COLUMNS: LIVE WHATSAPP PHONE PREVIEW (+ DEV META PAYLOAD) */}
            <div className="xl:col-span-5 xl:sticky xl:top-5 space-y-3">
              <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-900">
                    Live Customer Preview
                  </span>
                  {isDev && (
                    <div className="inline-flex rounded bg-neutral-200/70 p-0.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setPreviewTab("PHONE")}
                        className={`px-2.5 py-0.5 rounded font-medium cursor-pointer ${
                          previewTab === "PHONE"
                            ? "bg-white text-neutral-900 shadow-2xs"
                            : "text-neutral-600"
                        }`}
                      >
                        WhatsApp View
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewTab("JSON")}
                        className={`px-2.5 py-0.5 rounded font-medium cursor-pointer ${
                          previewTab === "JSON"
                            ? "bg-white text-neutral-900 shadow-2xs"
                            : "text-neutral-600"
                        }`}
                      >
                        Meta API JSON
                      </button>
                    </div>
                  )}
                </div>

                {previewTab === "JSON" && isDev ? (
                  <div className="p-4 space-y-2 bg-neutral-950 text-neutral-100">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-neutral-400">
                        Meta Graph API v21.0 Payload
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            JSON.stringify(liveMetaJsonPreview, null, 2)
                          );
                          setCopiedJson(true);
                          setTimeout(() => setCopiedJson(false), 1800);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-[11px] text-white cursor-pointer"
                      >
                        {copiedJson ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy JSON</span>
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono overflow-x-auto max-h-[460px] leading-relaxed">
                      {JSON.stringify(liveMetaJsonPreview, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div>
                    {/* Realistic WhatsApp Business Header */}
                    <div className="px-4 py-2.5 bg-[#075e54] text-white flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0">
                          <ClassicConceptsMark size={22} />
                        </div>
                        <div>
                          <div className="text-xs font-semibold flex items-center gap-1">
                            <span>Classic Concepts</span>
                            <span className="w-3.5 h-3.5 rounded-full bg-[#25d366] text-white inline-flex items-center justify-center text-[9px]">
                              ✓
                            </span>
                          </div>
                          <div className="text-[10px] text-emerald-100">
                            Official Business Account
                          </div>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-white/15 text-[10px]">
                        ₹{unitPrice.toFixed(2)}/msg
                      </span>
                    </div>

                    {/* Classic Concepts Chat Wallpaper + Template Bubble */}
                    <div
                      style={CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE}
                      className="p-5 min-h-[360px] flex flex-col justify-center"
                    >
                      <div className="max-w-[92%] bg-white rounded-lg shadow-xs overflow-hidden border border-black/5">
                        {/* Header Preview */}
                        {category !== "AUTHENTICATION" &&
                          headerType === "IMAGE" && (
                            <div className="h-36 bg-neutral-100 flex items-center justify-center overflow-hidden border-b border-neutral-100">
                              {headerMediaUrl ? (
                                <img
                                  src={headerMediaUrl}
                                  alt="Header preview"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="flex flex-col items-center text-neutral-400 text-xs gap-1">
                                  <ImageIcon className="w-6 h-6" />
                                  <span>Image Header Preview</span>
                                </div>
                              )}
                            </div>
                          )}

                        {category !== "AUTHENTICATION" &&
                          headerType === "VIDEO" && (
                            <div className="h-32 bg-neutral-900 text-white flex flex-col items-center justify-center gap-1 text-xs">
                              <Video className="w-6 h-6 text-emerald-400" />
                              <span>Video Header</span>
                            </div>
                          )}

                        {category !== "AUTHENTICATION" &&
                          headerType === "DOCUMENT" && (
                            <div className="p-3 bg-neutral-100 border-b border-neutral-200 flex items-center gap-2.5 text-xs text-neutral-800">
                              <FileText className="w-5 h-5 text-red-600 shrink-0" />
                              <span className="truncate font-medium">
                                {headerMediaUrl
                                  ? headerMediaUrl.split("/").pop()
                                  : "Classic-Concepts-Quote.pdf"}
                              </span>
                            </div>
                          )}

                        {category !== "AUTHENTICATION" &&
                          headerType === "LOCATION" && (
                            <div className="p-3 bg-emerald-50 border-b border-emerald-100 flex items-start gap-2 text-xs">
                              <MapPin className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                              <div>
                                <div className="font-semibold text-neutral-900">
                                  {headerLocation.name}
                                </div>
                                <div className="text-[11px] text-neutral-600">
                                  {headerLocation.address}
                                </div>
                              </div>
                            </div>
                          )}

                        {/* Body & Text Header */}
                        <div className="p-3 space-y-1.5">
                          {category !== "AUTHENTICATION" &&
                            headerType === "TEXT" &&
                            previewHeaderRendered.trim() && (
                              <div className="text-[13.5px] font-bold text-[#111b21]">
                                {previewHeaderRendered}
                              </div>
                            )}

                          <div className="text-[13px] text-[#111b21] leading-snug break-words">
                            {formatWhatsAppRichText(previewBodyRendered)}
                          </div>

                          {footerText.trim() && (
                            <div className="text-[11px] text-[#667781] pt-1">
                              {footerText}
                            </div>
                          )}

                          <div className="flex items-center justify-end gap-1.5 text-[10px] text-[#667781]">
                            <span>
                              {new Date().toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            <WhatsAppMessageTicks
                              status="READ"
                              showLabel
                              size={13}
                            />
                          </div>
                        </div>

                        {/* Interactive Buttons Preview */}
                        {buttons.length > 0 && (
                          <div className="divide-y divide-neutral-200 border-t border-neutral-200 bg-white">
                            {buttons.map((b) => (
                              <div
                                key={b.id}
                                className="py-2 px-3 text-center text-xs font-medium text-[#00a5f4] flex items-center justify-center gap-1.5"
                              >
                                {b.type === "URL" && (
                                  <ExternalLink className="w-3.5 h-3.5" />
                                )}
                                {b.type === "PHONE_NUMBER" && (
                                  <Phone className="w-3.5 h-3.5" />
                                )}
                                {(b.type === "COPY_CODE" ||
                                  b.type === "OTP") && (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                                <span>{b.text || "Button"}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      )}

      {/* ===================================================================== */}
      {/* SAVED TEMPLATES LIBRARY (WITH ELEMENT SKELETON + RETRY ON ERROR)      */}
      {/* ===================================================================== */}
      <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              All Message Templates ({filteredTemplates.length})
            </h2>
            <p className="text-xs text-neutral-500">
              Click Edit to load any template into the visual studio, Duplicate to make a new version, or Send Test to check it on WhatsApp.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search templates..."
                className="pl-8 pr-3 py-1.5 rounded-md border border-neutral-300 text-xs"
              />
            </div>

            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="rounded-md border border-neutral-300 px-2.5 py-1.5 bg-white"
            >
              <option value="ALL">All Categories</option>
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utility</option>
              <option value="AUTHENTICATION">Authentication</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-neutral-300 px-2.5 py-1.5 bg-white"
            >
              <option value="ALL">All Statuses</option>
              <option value="APPROVED">Approved</option>
              <option value="PENDING_APPROVAL">Pending Review</option>
              <option value="DRAFT">Draft</option>
              <option value="PAUSED">Paused</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
        </div>

        {loading ? (
          <TableRowsSkeleton rows={5} columns={6} />
        ) : loadError ? (
          <ElementErrorState
            title="Could not load saved templates"
            message={loadError}
            onRetry={loadTemplatesData}
          />
        ) : filteredTemplates.length === 0 ? (
          <div className="p-6 text-center text-xs text-neutral-500 bg-neutral-50 rounded-md">
            No templates match your current search or filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 text-neutral-500">
                  <th className="py-2.5 pr-3 font-medium">Template & Preview</th>
                  <th className="py-2.5 px-3 font-medium">Category & Rate</th>
                  <th className="py-2.5 px-3 font-medium">Header & Buttons</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium">Sent</th>
                  <th className="py-2.5 pl-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {filteredTemplates.map((t) => {
                  const rate =
                    t.category === "MARKETING"
                      ? rates.marketingRateInr
                      : rates.otherRateInr;
                  return (
                    <tr key={t.id} className="hover:bg-neutral-50/70">
                      <td className="py-3 pr-3 max-w-md">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-neutral-900">
                            {t.name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 text-[10px]">
                            {t.language}
                          </span>
                        </div>
                        <p className="text-neutral-600 line-clamp-2 mt-0.5">
                          {t.bodyText}
                        </p>
                        {t.rejectionReason && (
                          <p className="text-[11px] text-red-700 mt-1">
                            Reason: {t.rejectionReason}
                          </p>
                        )}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-medium text-neutral-900">
                          {t.category}
                        </div>
                        <div className="text-neutral-500 font-mono">
                          ₹{rate.toFixed(2)}/msg
                        </div>
                      </td>

                      <td className="py-3 px-3 text-neutral-600 whitespace-nowrap">
                        <div>Header: {t.headerType}</div>
                        <div className="text-[11px] text-neutral-500">
                          {t.buttons.length}{" "}
                          {t.buttons.length === 1 ? "button" : "buttons"}
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${
                            t.approvalStatus === "APPROVED"
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                              : t.approvalStatus === "PENDING_APPROVAL"
                              ? "bg-amber-50 text-amber-900 border-amber-200"
                              : t.approvalStatus === "REJECTED"
                              ? "bg-red-50 text-red-800 border-red-200"
                              : "bg-neutral-100 text-neutral-700 border-neutral-300"
                          }`}
                        >
                          {t.approvalStatus === "PENDING_APPROVAL"
                            ? "Pending Review"
                            : t.approvalStatus}
                        </span>
                      </td>

                      <td className="py-3 px-3 font-mono text-neutral-700">
                        {t.sentCount}
                      </td>

                      <td className="py-3 pl-3 text-right whitespace-nowrap">
                        {canManage && (
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => loadTemplateIntoEditor(t)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-800 font-medium cursor-pointer"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>Edit</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setTestModalTpl(t);
                                setTestSendError("");
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-medium cursor-pointer"
                            >
                              <WhatsAppLogoIcon size={11} />
                              <span>Test</span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                handleRowAction("duplicate_template", t)
                              }
                              className="px-2 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 cursor-pointer"
                              title="Duplicate template"
                            >
                              <Copy className="w-3 h-3" />
                            </button>

                            {(t.approvalStatus === "APPROVED" ||
                              t.approvalStatus === "PAUSED") && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleRowAction("toggle_pause", t)
                                }
                                className="px-2 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 cursor-pointer"
                                title={
                                  t.approvalStatus === "PAUSED"
                                    ? "Resume template"
                                    : "Pause template"
                                }
                              >
                                {t.approvalStatus === "PAUSED" ? (
                                  <Play className="w-3 h-3 text-emerald-700" />
                                ) : (
                                  <Pause className="w-3 h-3 text-amber-700" />
                                )}
                              </button>
                            )}

                            {isSuperAdmin &&
                              t.approvalStatus !== "APPROVED" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDevReviewStatus(t, "APPROVED")
                                  }
                                  className="px-2 py-1 rounded bg-neutral-900 text-white text-[11px] font-medium cursor-pointer"
                                  title="Mark Approved"
                                >
                                  Approve
                                </button>
                              )}

                            <button
                              type="button"
                              onClick={() =>
                                handleRowAction("delete_template", t)
                              }
                              className="p-1 text-neutral-400 hover:text-red-600 cursor-pointer"
                              title="Delete template"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Send Test WhatsApp Modal */}
      {testModalTpl && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSendTestMessage}
            className="w-full max-w-md bg-white rounded-lg border border-neutral-200 p-5 space-y-4 shadow-xl text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#25d366] text-white inline-flex items-center justify-center">
                  <WhatsAppLogoIcon size={13} />
                </span>
                <span>Send Test Template Message</span>
              </h3>
              <button
                type="button"
                onClick={() => setTestModalTpl(null)}
                className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-neutral-600">
              Sends <strong>{testModalTpl.name}</strong> filled with its sample values to check formatting on your phone.
            </p>

            {testSendError && (
              <ElementErrorState
                title="Test message failed"
                message={testSendError}
                onRetry={() => void handleSendTestMessage({ preventDefault() {} } as React.FormEvent)}
                retrying={sendingTest}
                compact
              />
            )}

            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Recipient WhatsApp Number
              </label>
              <input
                type="text"
                required
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="+91 98480 11223"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTestModalTpl(null)}
                className="px-3.5 py-2 rounded-md border border-neutral-300 font-medium text-neutral-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sendingTest}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                <WhatsAppLogoIcon size={13} />
                <span>{sendingTest ? "Sending..." : "Send Test Now"}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
