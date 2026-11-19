"use client";

import { useCallback, useState } from "react";
import {
  slugifyName,
  type ButtonFlowAction,
  type HeaderType,
  type LocationHeader,
  type TemplateButton,
  type TemplateCategory,
  type TemplateRecord,
  type VariableSpec,
} from "@/app/dashboard/templates/types";

export function useTemplateMutations(params: {
  editingId: string;
  setEditingId: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  language: string;
  category: TemplateCategory;
  setCategory: (v: TemplateCategory) => void;
  allowCategoryChange: boolean;
  codeExpirationMinutes: number;
  headerType: HeaderType;
  setHeaderType: (v: HeaderType) => void;
  headerText: string;
  setHeaderText: (v: string) => void;
  headerMediaUrl: string;
  headerLocation: LocationHeader;
  bodyText: string;
  setBodyText: (v: string) => void;
  footerText: string;
  setFooterText: (v: string) => void;
  buttons: TemplateButton[];
  setButtons: React.Dispatch<React.SetStateAction<TemplateButton[]>>;
  variablesSchema: VariableSpec[];
  setVariablesSchema: React.Dispatch<React.SetStateAction<VariableSpec[]>>;
  aiGoal: string;
  aiBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  testModalTpl: TemplateRecord | null;
  setTestModalTpl: (tpl: TemplateRecord | null) => void;
  testPhone: string;
  setActionError: (v: string) => void;
  notifySuccess: (msg: string) => void;
  loadTemplatesData: () => Promise<void>;
}) {
  const {
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
  } = params;

  const [syncingMeta, setSyncingMeta] = useState<boolean>(false);
  const [savingAction, setSavingAction] = useState<
    "" | "DRAFT" | "SUBMIT" | "FLOWS"
  >("");
  const [draftingAi, setDraftingAi] = useState<boolean>(false);
  const [aiComplianceNotes, setAiComplianceNotes] = useState<string[]>([]);
  const [sendingTest, setSendingTest] = useState<boolean>(false);
  const [testSendError, setTestSendError] = useState<string>("");

  const handleSaveOrSubmit = useCallback(
    async (mode: "save_draft" | "submit_to_meta") => {
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
        if (data.effectiveCategory) setCategory(data.effectiveCategory);
        if (
          typeof data.effectiveBodyText === "string" &&
          data.effectiveBodyText
        ) {
          setBodyText(data.effectiveBodyText);
        }
        if (data.effectiveFooterText !== undefined) {
          setFooterText(data.effectiveFooterText || "");
        }
        if (Array.isArray(data.effectiveButtons)) {
          setButtons(data.effectiveButtons);
        }
        notifySuccess(data.message || "Template saved.");
        await loadTemplatesData();
      } catch {
        setActionError("Network error while saving template. Please try again.");
      } finally {
        setSavingAction("");
      }
    },
    [
      editingId,
      name,
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
      setActionError,
      setEditingId,
      setCategory,
      setBodyText,
      setFooterText,
      setButtons,
      notifySuccess,
      loadTemplatesData,
    ]
  );

  const handleSyncFromMeta = useCallback(async () => {
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
        setActionError(
          data.message || data.error || "Could not sync from Meta."
        );
        return;
      }
      notifySuccess(data.message || "Synced templates.");
      await loadTemplatesData();
    } catch {
      setActionError("Network error while syncing with Meta.");
    } finally {
      setSyncingMeta(false);
    }
  }, [setActionError, notifySuccess, loadTemplatesData]);

  const handleRowAction = useCallback(
    async (
      action: "duplicate_template" | "toggle_pause" | "delete_template",
      tpl: TemplateRecord
    ) => {
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
    },
    [editingId, setEditingId, setActionError, notifySuccess, loadTemplatesData]
  );

  const handleDraftWithMetaAi = useCallback(async () => {
    if (!aiGoal.trim()) {
      setActionError("Describe what you want this template to say first.");
      return;
    }
    setDraftingAi(true);
    setActionError("");
    setAiComplianceNotes([]);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ai_draft_template",
          goal: aiGoal.trim(),
          category,
          brand: aiBrand,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.draft) {
        setActionError(data.error || "Could not draft template right now.");
        return;
      }
      const d = data.draft;
      setEditingId("");
      setName(slugifyName(d.name || "cc_template_draft"));
      if (d.category) setCategory(d.category);
      setHeaderType(d.headerType || "TEXT");
      setHeaderText(d.headerText || "");
      setBodyText(d.bodyText || "");
      setFooterText(d.footerText || "");
      if (Array.isArray(d.buttons) && d.buttons.length > 0) {
        setButtons(d.buttons);
      }
      if (Array.isArray(d.variablesSchema) && d.variablesSchema.length > 0) {
        setVariablesSchema(d.variablesSchema);
      }
      if (Array.isArray(d.complianceNotes)) {
        setAiComplianceNotes(d.complianceNotes);
      }
      notifySuccess(
        "Drafted Meta-compliant template with Quick Reply button flows pre-mapped. Review and submit to Meta when ready."
      );
    } catch {
      setActionError("Network error while drafting template.");
    } finally {
      setDraftingAi(false);
    }
  }, [
    aiGoal,
    category,
    aiBrand,
    setActionError,
    setEditingId,
    setName,
    setCategory,
    setHeaderType,
    setHeaderText,
    setBodyText,
    setFooterText,
    setButtons,
    setVariablesSchema,
    notifySuccess,
  ]);

  const handleSaveButtonFlowsOnly = useCallback(async () => {
    if (!editingId) return;
    setSavingAction("FLOWS");
    setActionError("");
    try {
      const flowsByButtonId: Record<string, ButtonFlowAction | undefined> = {};
      for (const b of buttons) {
        if (b.type === "QUICK_REPLY") {
          flowsByButtonId[b.id] = b.flowAction || { actionType: "NONE" };
        }
      }
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_button_flows",
          templateId: editingId,
          flowsByButtonId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setActionError(
          data.error || "Could not save button flow mappings."
        );
        return;
      }
      notifySuccess(
        data.message ||
          "Quick-reply button flows saved without altering Meta approval status."
      );
      await loadTemplatesData();
    } catch {
      setActionError("Network error while saving button flow mappings.");
    } finally {
      setSavingAction("");
    }
  }, [editingId, buttons, setActionError, notifySuccess, loadTemplatesData]);

  const handleSendTestMessage = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
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
    },
    [testModalTpl, testPhone, setTestModalTpl, notifySuccess, loadTemplatesData]
  );

  return {
    syncingMeta,
    savingAction,
    draftingAi,
    aiComplianceNotes,
    sendingTest,
    testSendError,
    setTestSendError,
    handleSaveOrSubmit,
    handleSyncFromMeta,
    handleRowAction,
    handleDraftWithMetaAi,
    handleSaveButtonFlowsOnly,
    handleSendTestMessage,
  };
}
