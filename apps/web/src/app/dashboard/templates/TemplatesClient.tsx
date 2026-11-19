"use client";

import React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { CardListSkeleton, ElementErrorState } from "@cc/ui";
import type { TemplatesInitialData } from "./types";
import { useTemplatesWorkspace } from "./hooks/useTemplatesWorkspace";
import { TemplateStatsRow } from "./components/TemplateStatsRow";
import { TemplateLibraryTable } from "./components/TemplateLibraryTable";

const TemplateBuilderPanel = dynamic(
  () =>
    import("./components/TemplateBuilderPanel").then(
      (m) => m.TemplateBuilderPanel
    ),
  {
    ssr: false,
    loading: () => <CardListSkeleton rows={4} />,
  }
);

const TestTemplateModal = dynamic(
  () =>
    import("./components/TestTemplateModal").then((m) => m.TestTemplateModal),
  { ssr: false }
);

export function TemplatesClient({
  initialData,
}: {
  initialData?: TemplatesInitialData;
}) {
  const ws = useTemplatesWorkspace(initialData);

  return (
    <div
      ref={ws.editorTopRef}
      className="w-full px-3.5 sm:px-6 py-4 sm:py-5 space-y-5 sm:space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            WhatsApp Message Templates Studio
          </h1>
          <p className="text-[13.5px] leading-relaxed text-slate-500 mt-1">
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
          {ws.canManage && (
            <>
              <button
                type="button"
                disabled={ws.syncingMeta}
                onClick={() => void ws.handleSyncFromMeta()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-800 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    ws.syncingMeta ? "animate-spin" : ""
                  }`}
                />
                <span>
                  {ws.syncingMeta ? "Syncing..." : "Sync with Meta"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => ws.applyStarterPreset("HOSPITALITY")}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-medium cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Reset New Blank / Preset</span>
              </button>
            </>
          )}
        </div>
      </div>

      {ws.banner && (
        <div className="p-3.5 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900">
          {ws.banner}
        </div>
      )}
      {ws.actionError && (
        <ElementErrorState
          title="Action could not be completed"
          message={ws.actionError}
          onRetry={() => ws.setActionError("")}
          compact
        />
      )}

      <TemplateStatsRow
        loading={ws.loading}
        loadError={ws.loadError}
        templates={ws.templates}
        onRetry={() => void ws.loadTemplatesData()}
      />

      {!ws.loading && !ws.canManage && !ws.loadError ? (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950">
          You have view-only access to templates. Ask a Manager, Superadmin, or Dev if you need a new template created, or use any Approved template directly from Customer Chats.
        </div>
      ) : (
        ws.canManage && (
          <TemplateBuilderPanel
            isDev={ws.isDev}
            editingId={ws.editingId}
            setEditingId={ws.setEditingId}
            name={ws.name}
            setName={ws.setName}
            language={ws.language}
            setLanguage={ws.setLanguage}
            category={ws.category}
            setCategory={ws.setCategory}
            allowCategoryChange={ws.allowCategoryChange}
            setAllowCategoryChange={ws.setAllowCategoryChange}
            codeExpirationMinutes={ws.codeExpirationMinutes}
            setCodeExpirationMinutes={ws.setCodeExpirationMinutes}
            headerType={ws.headerType}
            setHeaderType={ws.setHeaderType}
            headerText={ws.headerText}
            setHeaderText={ws.setHeaderText}
            headerMediaUrl={ws.headerMediaUrl}
            setHeaderMediaUrl={ws.setHeaderMediaUrl}
            headerLocation={ws.headerLocation}
            setHeaderLocation={ws.setHeaderLocation}
            bodyText={ws.bodyText}
            setBodyText={ws.setBodyText}
            footerText={ws.footerText}
            setFooterText={ws.setFooterText}
            buttons={ws.buttons}
            setButtons={ws.setButtons}
            variablesSchema={ws.variablesSchema}
            setVariablesSchema={ws.setVariablesSchema}
            bodyRef={ws.bodyRef}
            aiGoal={ws.aiGoal}
            setAiGoal={ws.setAiGoal}
            aiBrand={ws.aiBrand}
            setAiBrand={ws.setAiBrand}
            draftingAi={ws.draftingAi}
            aiComplianceNotes={ws.aiComplianceNotes}
            savingAction={ws.savingAction}
            liveChecks={ws.liveChecks}
            previewHeaderRendered={ws.previewHeaderRendered}
            previewBodyRendered={ws.previewBodyRendered}
            liveMetaJsonPreview={ws.liveMetaJsonPreview}
            customLinks={ws.customLinks}
            catalogMedia={ws.catalogMedia}
            teams={ws.teams}
            templates={ws.templates}
            onApplyPreset={ws.applyStarterPreset}
            onDraftWithMetaAi={ws.handleDraftWithMetaAi}
            onWrapBodySelection={ws.wrapBodySelection}
            onInsertNextVariable={ws.insertNextVariable}
            onAddButton={ws.addButton}
            onMoveButton={ws.moveButton}
            onSaveButtonFlowsOnly={ws.handleSaveButtonFlowsOnly}
            onSaveOrSubmit={ws.handleSaveOrSubmit}
          />
        )
      )}

      <TemplateLibraryTable
        loading={ws.loading}
        loadError={ws.loadError}
        canManage={ws.canManage}
        filteredTemplates={ws.filteredTemplates}
        searchQuery={ws.searchQuery}
        setSearchQuery={ws.setSearchQuery}
        catFilter={ws.catFilter}
        setCatFilter={ws.setCatFilter}
        statusFilter={ws.statusFilter}
        setStatusFilter={ws.setStatusFilter}
        onRetry={() => void ws.loadTemplatesData()}
        onEditTemplate={ws.loadTemplateIntoEditor}
        onOpenTestModal={(tpl) => {
          ws.setTestModalTpl(tpl);
          ws.setTestSendError("");
        }}
        onRowAction={ws.handleRowAction}
      />

      {ws.testModalTpl && (
        <TestTemplateModal
          testModalTpl={ws.testModalTpl}
          testPhone={ws.testPhone}
          setTestPhone={ws.setTestPhone}
          sendingTest={ws.sendingTest}
          testSendError={ws.testSendError}
          onClose={() => ws.setTestModalTpl(null)}
          onSubmit={ws.handleSendTestMessage}
        />
      )}
    </div>
  );
}
