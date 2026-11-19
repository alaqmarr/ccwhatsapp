"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SHORTLINK_PUBLIC_ORIGIN, formatShortLinkUrl } from "@cc/ui";
import {
  buildLiveMetaJsonPreview,
  buildTemplateLiveChecks,
  getStarterPresetValues,
} from "@/app/dashboard/templates/presets";
import type {
  CatalogMediaOption,
  HeaderType,
  LocationHeader,
  ShortLinkOption,
  TemplateButton,
  TemplateCategory,
  TemplatePresetKey,
  TemplateRecord,
  TemplatesInitialData,
  VariableSpec,
} from "@/app/dashboard/templates/types";
import { useTemplateMutations } from "./useTemplateMutations";

export function useTemplatesWorkspace(initialData?: TemplatesInitialData) {
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [loadError, setLoadError] = useState<string>("");
  const [canManage, setCanManage] = useState<boolean>(
    Boolean(initialData?.canManage)
  );
  const [isDev, setIsDev] = useState<boolean>(Boolean(initialData?.isDev));

  const [templates, setTemplates] = useState<TemplateRecord[]>(
    initialData?.templates ?? []
  );
  const [customLinks, setCustomLinks] = useState<ShortLinkOption[]>(
    initialData?.customLinks ?? []
  );
  const [catalogMedia, setCatalogMedia] = useState<CatalogMediaOption[]>(
    initialData?.catalogMediaItems ?? []
  );
  const [teams, setTeams] = useState<{ id: string; name: string }[]>(
    initialData?.teams && initialData.teams.length > 0
      ? initialData.teams
      : [{ id: "team_sales", name: "Sales Team" }]
  );

  const [banner, setBanner] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");

  const [aiGoal, setAiGoal] = useState<string>(
    "Follow up with hotel buyers on acrylic stage podiums with quick buttons for price list and talking to sales"
  );
  const [aiBrand, setAiBrand] = useState<
    "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53"
  >("CLASSIC_CONCEPTS");

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [catFilter, setCatFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const [editingId, setEditingId] = useState<string>("");
  const [name, setName] = useState<string>("new_podium_showcase_2026");
  const [language, setLanguage] = useState<string>("en");
  const [category, setCategory] = useState<TemplateCategory>("MARKETING");
  const [allowCategoryChange, setAllowCategoryChange] = useState<boolean>(true);
  const [codeExpirationMinutes, setCodeExpirationMinutes] =
    useState<number>(10);

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
    "Hello {{1}}, explore our clear acrylic stage podiums, mementos, and custom tabletop stands made at Classic Concepts."
  );
  const [footerText, setFooterText] = useState<string>(
    "Classic Concepts • Reply STOP to opt out"
  );
  const [buttons, setButtons] = useState<TemplateButton[]>([
    {
      id: "btn_1",
      type: "URL",
      text: "View Collection",
      url: `${SHORTLINK_PUBLIC_ORIGIN}/podium`,
      urlType: "STATIC",
    },
    {
      id: "btn_2",
      type: "QUICK_REPLY",
      text: "Talk to Sales Team",
      flowAction: {
        actionType: "ASSIGN_TEAM",
        teamId: "team_sales",
        replyText:
          "Connecting you with our *Sales Team* right away. A specialist will reply here shortly.",
      },
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

  const [testModalTpl, setTestModalTpl] = useState<TemplateRecord | null>(null);
  const [testPhone, setTestPhone] = useState<string>("+91 98480 11223");

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
      setTemplates(data.templates || []);
      setCustomLinks(data.customLinks || []);
      setCatalogMedia(data.catalogMediaItems || []);
      setTeams(
        Array.isArray(data.teams) && data.teams.length > 0
          ? data.teams
          : [{ id: "team_sales", name: "Sales Team" }]
      );
    } catch {
      setLoadError("Network error while loading WhatsApp templates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialData) {
      void loadTemplatesData();
    }
  }, [initialData, loadTemplatesData]);

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

  const notifySuccess = useCallback((msg: string) => {
    setBanner(msg);
    setActionError("");
    setTimeout(() => setBanner(""), 4500);
  }, []);

  const mutations = useTemplateMutations({
    editingId,
    setEditingId,
    name,
    setName,
    language,
    category,
    setCategory,
    allowCategoryChange,
    codeExpirationMinutes,
    headerType,
    setHeaderType,
    headerText,
    setHeaderText,
    headerMediaUrl,
    headerLocation,
    bodyText,
    setBodyText,
    footerText,
    setFooterText,
    buttons,
    setButtons,
    variablesSchema,
    setVariablesSchema,
    aiGoal,
    aiBrand,
    testModalTpl,
    setTestModalTpl,
    testPhone,
    setActionError,
    notifySuccess,
    loadTemplatesData,
  });

  const applyStarterPreset = useCallback(
    (preset: TemplatePresetKey) => {
      setEditingId("");
      setActionError("");
      const p = getStarterPresetValues(preset, customLinks, catalogMedia);
      setName(p.name);
      setCategory(p.category);
      setHeaderType(p.headerType);
      if (p.headerText !== undefined) setHeaderText(p.headerText);
      if (p.headerMediaUrl !== undefined) setHeaderMediaUrl(p.headerMediaUrl);
      if (p.headerLocation) setHeaderLocation(p.headerLocation);
      if (p.codeExpirationMinutes !== undefined) {
        setCodeExpirationMinutes(p.codeExpirationMinutes);
      }
      setBodyText(p.bodyText);
      setFooterText(p.footerText);
      setButtons(p.buttons);
    },
    [catalogMedia, customLinks]
  );

  const loadTemplateIntoEditor = useCallback((tpl: TemplateRecord) => {
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
  }, []);

  const wrapBodySelection = useCallback(
    (marker: "*" | "_" | "~" | "`") => {
      const el = bodyRef.current;
      if (!el) return;
      const start = el.selectionStart ?? bodyText.length;
      const end = el.selectionEnd ?? bodyText.length;
      const selected = bodyText.slice(start, end) || "text";
      setBodyText(
        bodyText.slice(0, start) +
          `${marker}${selected}${marker}` +
          bodyText.slice(end)
      );
    },
    [bodyText]
  );

  const insertNextVariable = useCallback(() => {
    const existingNums = Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g)).map(
      (m) => Number(m[1])
    );
    const nextNum =
      existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    const token = `{{${nextNum}}}`;
    const el = bodyRef.current;
    if (!el) {
      setBodyText((p) => `${p} ${token}`);
      return;
    }
    const start = el.selectionStart ?? bodyText.length;
    const end = el.selectionEnd ?? bodyText.length;
    setBodyText(bodyText.slice(0, start) + token + bodyText.slice(end));
  }, [bodyText]);

  const addButton = useCallback(
    (type: TemplateButton["type"]) => {
      if (buttons.length >= 10) return;
      const id = `btn_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      if (type === "URL") {
        setButtons((prev) => [
          ...prev,
          {
            id,
            type: "URL",
            text: "Open Link",
            url: customLinks[0]
              ? formatShortLinkUrl(customLinks[0].code)
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
            flowAction: {
              actionType: "ASSIGN_TEAM",
              teamId: teams[0]?.id || "team_sales",
              replyText:
                "Connecting you with our *Sales Team* right away. A specialist will reply here shortly.",
            },
          },
        ]);
      }
    },
    [buttons.length, customLinks, teams]
  );

  const moveButton = useCallback(
    (index: number, dir: -1 | 1) => {
      const target = index + dir;
      if (target < 0 || target >= buttons.length) return;
      const copy = [...buttons];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      setButtons(copy);
    },
    [buttons]
  );

  const liveChecks = useMemo(
    () =>
      buildTemplateLiveChecks({
        name,
        bodyText,
        category,
        variablesSchema,
        headerType,
        headerMediaUrl,
        footerText,
        buttons,
      }),
    [
      name,
      bodyText,
      category,
      variablesSchema,
      headerType,
      headerMediaUrl,
      footerText,
      buttons,
    ]
  );

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

  const liveMetaJsonPreview = useMemo(
    () =>
      buildLiveMetaJsonPreview({
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
      }),
    [
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
    ]
  );

  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (catFilter !== "ALL" && t.category !== catFilter) return false;
      if (statusFilter !== "ALL" && t.approvalStatus !== statusFilter)
        return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay =
          `${t.name} ${t.bodyText} ${t.headerText || ""} ${t.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [templates, catFilter, statusFilter, searchQuery]);

  return {
    loading,
    loadError,
    canManage,
    isDev,
    templates,
    filteredTemplates,
    customLinks,
    catalogMedia,
    teams,
    banner,
    actionError,
    setActionError,
    aiGoal,
    setAiGoal,
    aiBrand,
    setAiBrand,
    searchQuery,
    setSearchQuery,
    catFilter,
    setCatFilter,
    statusFilter,
    setStatusFilter,
    editingId,
    setEditingId,
    name,
    setName,
    language,
    setLanguage,
    category,
    setCategory,
    allowCategoryChange,
    setAllowCategoryChange,
    codeExpirationMinutes,
    setCodeExpirationMinutes,
    headerType,
    setHeaderType,
    headerText,
    setHeaderText,
    headerMediaUrl,
    setHeaderMediaUrl,
    headerLocation,
    setHeaderLocation,
    bodyText,
    setBodyText,
    footerText,
    setFooterText,
    buttons,
    setButtons,
    variablesSchema,
    setVariablesSchema,
    testModalTpl,
    setTestModalTpl,
    testPhone,
    setTestPhone,
    bodyRef,
    editorTopRef,
    liveChecks,
    previewBodyRendered,
    previewHeaderRendered,
    liveMetaJsonPreview,
    loadTemplatesData,
    applyStarterPreset,
    loadTemplateIntoEditor,
    wrapBodySelection,
    insertNextVariable,
    addButton,
    moveButton,
    ...mutations,
  };
}
