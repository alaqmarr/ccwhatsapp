"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { FileText, RefreshCw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import type { MarketingInitialPayload } from "./types";
import { useMarketingWorkspace } from "./hooks/useMarketingWorkspace";
import { CampaignStats } from "./components/CampaignStats";
import { BroadcastComposer } from "./components/BroadcastComposer";
import { CampaignList } from "./components/CampaignList";
import { MarketingListsTab } from "./components/MarketingListsTab";
import { ShortLinksPanel } from "./components/ShortLinksPanel";

const BroadcastQueueSettingsPanel = dynamic(
  () =>
    import("./components/BroadcastQueueSettingsPanel").then(
      (m) => m.BroadcastQueueSettingsPanel
    ),
  { ssr: false }
);

const RecipientQueueModal = dynamic(
  () =>
    import("./components/RecipientQueueModal").then(
      (m) => m.RecipientQueueModal
    ),
  { ssr: false }
);

export function MarketingClient({
  initialData,
}: {
  initialData?: MarketingInitialPayload;
}) {
  const ws = useMarketingWorkspace(initialData);
  const [showSafetyPanel, setShowSafetyPanel] = useState<boolean>(false);

  async function onSubmitSafety(e: React.FormEvent) {
    const ok = await ws.handleSaveSafetySettings(e);
    if (ok) {
      setShowSafetyPanel(false);
    }
  }

  return (
    <div className="w-full px-3.5 sm:px-6 py-4 sm:py-5 space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-[#00a884] shrink-0" />
            <span>Safe Broadcast Queue, ACRIO Lists & Short Links</span>
          </h1>
          <p className="text-[13.5px] leading-relaxed text-slate-500 mt-1">
            Queue WhatsApp broadcasts one recipient at a time with safe anti-spam spacing, opt-out filtering, and Meta rate-limit protection.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {ws.canManageTemplates && (
            <Link
              href="/dashboard/templates"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white hover:bg-neutral-50 border border-neutral-300 text-xs font-medium text-neutral-800"
            >
              <FileText className="w-3.5 h-3.5 text-[#00a884]" />
              <span>Open Templates Studio</span>
            </Link>
          )}
          {ws.canSendBroadcasts && (
            <button
              type="button"
              onClick={() => setShowSafetyPanel((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white hover:bg-neutral-50 border border-neutral-300 text-xs font-medium text-neutral-800 cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Anti-Spam Safety Limits</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void ws.refreshAll()}
            disabled={ws.refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white hover:bg-neutral-50 border border-neutral-300 text-xs font-medium text-neutral-700 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${ws.refreshing ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {ws.feedback && (
        <div className="px-3.5 py-2.5 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
          {ws.feedback}
        </div>
      )}
      {ws.errorMsg && (
        <div className="px-3.5 py-2.5 rounded-md bg-red-50 border border-red-200 text-xs font-medium text-red-700">
          {ws.errorMsg}
        </div>
      )}

      <CampaignStats
        initialLoading={ws.initialLoading}
        loadError={ws.loadError}
        refreshing={ws.refreshing}
        broadcasts={ws.broadcasts}
        approvedTemplates={ws.approvedTemplates}
        lists={ws.lists}
        customLinks={ws.customLinks}
        safetySettings={ws.queueSettings}
        onRetry={() => void ws.refreshAll()}
      />

      {showSafetyPanel && ws.canSendBroadcasts && (
        <BroadcastQueueSettingsPanel
          safetySettings={ws.safetyDraft}
          setSafetySettings={ws.setSafetyDraft}
          savingSafety={ws.savingSafety}
          onClose={() => setShowSafetyPanel(false)}
          onSubmit={onSubmitSafety}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <BroadcastComposer
          initialLoading={ws.initialLoading}
          loadError={ws.loadError}
          refreshing={ws.refreshing}
          canManageTemplates={ws.canManageTemplates}
          canSendBroadcasts={ws.canSendBroadcasts}
          lists={ws.lists}
          templates={ws.templates}
          approvedTemplates={ws.approvedTemplates}
          bcName={ws.bcName}
          setBcName={ws.setBcName}
          bcListId={ws.bcListId}
          setBcListId={ws.setBcListId}
          bcTemplateId={ws.bcTemplateId}
          setBcTemplateId={ws.setBcTemplateId}
          bcPacingMode={ws.bcPacingMode}
          setBcPacingMode={ws.setBcPacingMode}
          bcSkipRecentHours={ws.bcSkipRecentHours}
          setBcSkipRecentHours={ws.setBcSkipRecentHours}
          bcScheduledFor={ws.bcScheduledFor}
          setBcScheduledFor={ws.setBcScheduledFor}
          launching={ws.launching}
          onRetry={() => void ws.refreshAll()}
          onSubmit={ws.handleLaunchBroadcast}
        />

        <CampaignList
          initialLoading={ws.initialLoading}
          loadError={ws.loadError}
          refreshing={ws.refreshing}
          hasActiveQueue={ws.hasActiveQueue}
          broadcasts={ws.broadcasts}
          canSendBroadcasts={ws.canSendBroadcasts}
          busyCampaignId={ws.busyCampaignId}
          onRetry={() => void ws.refreshAll()}
          onInspect={(b) => ws.setInspectBroadcast(b)}
          onCampaignControl={ws.handleCampaignControl}
        />
      </div>

      <MarketingListsTab
        initialLoading={ws.initialLoading}
        loadError={ws.loadError}
        refreshing={ws.refreshing}
        canSendBroadcasts={ws.canSendBroadcasts}
        lists={ws.lists}
        acrioPrompt={ws.acrioPrompt}
        setAcrioPrompt={ws.setAcrioPrompt}
        acrioPreview={ws.acrioPreview}
        listNameDraft={ws.listNameDraft}
        setListNameDraft={ws.setListNameDraft}
        previewLoading={ws.previewLoading}
        previewError={ws.previewError}
        savingList={ws.savingList}
        onRetry={() => void ws.refreshAll()}
        onAcrioPreview={ws.handleAcrioPreview}
        onSaveAcrioList={ws.handleSaveAcrioList}
        onDeleteList={ws.handleDeleteList}
      />

      <ShortLinksPanel
        initialLoading={ws.initialLoading}
        loadError={ws.loadError}
        refreshing={ws.refreshing}
        customLinks={ws.customLinks}
        syncingCatalogLinks={ws.syncingCatalogLinks}
        onRetry={() => void ws.refreshAll()}
        onCreateLink={ws.handleCreateLink}
        onSyncProductLinks={ws.handleSyncProductLinks}
      />

      {ws.inspectBroadcast && (
        <RecipientQueueModal
          inspectBroadcast={ws.inspectBroadcast}
          recipientRows={ws.recipientRows}
          recipientsLoading={ws.recipientsLoading}
          recipientsError={ws.recipientsError}
          onRefresh={() => void ws.refetchRecipients()}
          onClose={() => ws.setInspectBroadcast(null)}
        />
      )}
    </div>
  );
}
