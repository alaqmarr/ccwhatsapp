"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  Globe,
  KeyRound,
  Mail,
  Plus,
  RefreshCw,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";
import { ElementErrorState } from "@cc/ui";
import type {
  StaffOption,
  SyncInfo,
  TeamItem,
  TeamsViewTab,
} from "./types";
import { useTeamsWorkspace } from "./hooks/useTeamsWorkspace";
import { TeamRosterPanel } from "./components/TeamRosterPanel";

const TeamMemberModal = dynamic(
  () =>
    import("./components/TeamMemberModal").then((m) => m.TeamMemberModal),
  { ssr: false }
);

const EmailDispatchPanel = dynamic(
  () =>
    import("./components/EmailDispatchPanel").then(
      (m) => m.EmailDispatchPanel
    ),
  { ssr: false }
);

const EcosystemBridgesPanel = dynamic(
  () =>
    import("./components/EmailDispatchPanel").then(
      (m) => m.EcosystemBridgesPanel
    ),
  { ssr: false }
);

export function TeamsClient({
  initialTeams,
  initialActiveStaff,
  initialCanManage,
  initialSyncInfo,
}: {
  initialTeams: TeamItem[];
  initialActiveStaff: StaffOption[];
  initialCanManage: boolean;
  initialSyncInfo: SyncInfo;
}) {
  const ws = useTeamsWorkspace({
    initialTeams,
    initialActiveStaff,
    initialCanManage,
    initialSyncInfo,
  });

  const [activeView, setActiveView] = useState<TeamsViewTab>("TEAMS");
  const [showAiPanel, setShowAiPanel] = useState<boolean>(false);
  const [aiKeyInput, setAiKeyInput] = useState<string>("");
  const [showNewTeamModal, setShowNewTeamModal] = useState<boolean>(false);

  const totalOnlineResponders = ws.activeStaff.length;
  const totalWaitingChats = ws.teams.reduce(
    (acc, t) => acc + (t.waitingChatsCount || 0),
    0
  );

  async function onSubmitAiKey(e: React.FormEvent) {
    e.preventDefault();
    const ok = await ws.handleSaveSharedAiKey(aiKeyInput);
    if (ok) {
      setAiKeyInput("");
      setShowAiPanel(false);
    }
  }

  return (
    <div className="w-full p-3.5 sm:p-4 lg:p-6 space-y-4 sm:space-y-5 bg-neutral-50 min-h-dvh">
      <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 space-y-4 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
              <Users className="w-6 h-6 text-[#00a884] shrink-0" />
              <span>Teams, Escalation Routing & Assignment Mailer</span>
            </h1>
            <p className="text-xs sm:text-[13.5px] leading-relaxed text-slate-600 mt-1">
              Manage who receives customer chats after ACRIO or website form handoff, set P0 to P1 to P2 wait-time limits, and dispatch instant email alerts whenever a chat is assigned to a person.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void ws.handleRunEscalationCheckNow()}
              disabled={ws.runningEscalation}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-300 text-xs font-medium cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-amber-600" />
              <span>
                {ws.runningEscalation ? "Checking..." : "Run Escalation Check"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void ws.handleRefreshCatalog()}
              disabled={ws.syncing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-300 text-xs font-medium cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${ws.syncing ? "animate-spin" : ""}`}
              />
              <span>{ws.syncing ? "Syncing..." : "Sync Catalogs"}</span>
            </button>

            {ws.canManage && (
              <button
                type="button"
                onClick={() => setShowAiPanel((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-300 text-xs font-medium cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5 text-indigo-600" />
                <span>
                  {ws.syncInfo?.aiConnected
                    ? "Claude Haiku 5.5 Ready"
                    : "Connect AI Key"}
                </span>
              </button>
            )}

            {ws.canManage && (
              <button
                type="button"
                onClick={() => setShowNewTeamModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create Team</span>
              </button>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                {
                  key: "TEAMS",
                  label: `Routing Teams (${ws.teams.length})`,
                  icon: Users,
                },
                {
                  key: "EMAIL_DISPATCH",
                  label: `Staff Email Alerts (${ws.emailLogs.length})`,
                  icon: Mail,
                },
                {
                  key: "BRIDGES",
                  label: "3-Site Ecosystem (:3002 / :3003 / :3007)",
                  icon: Globe,
                },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = activeView === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveView(tab.key)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                    active
                      ? "bg-neutral-900 text-white"
                      : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-600">
            <span>
              Active Staff:{" "}
              <strong className="text-neutral-900">
                {totalOnlineResponders}
              </strong>
            </span>
            <span>•</span>
            <span>
              Waiting Chats:{" "}
              <strong
                className={
                  totalWaitingChats > 0 ? "text-red-600" : "text-emerald-700"
                }
              >
                {totalWaitingChats}
              </strong>
            </span>
            <span>•</span>
            <span>
              Mailer:{" "}
              <strong
                className={
                  ws.smtpSummary?.configured
                    ? "text-emerald-700"
                    : "text-amber-700"
                }
              >
                {ws.smtpSummary?.configured ? "Active" : "Needs SMTP"}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {ws.toast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs font-medium px-4 py-2.5 rounded-lg flex items-center justify-between">
          <span>{ws.toast}</span>
          <button
            type="button"
            onClick={() => ws.setToast("")}
            className="text-emerald-700 hover:text-emerald-950 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {ws.reloadError && (
        <ElementErrorState
          compact
          title="Could not refresh team escalation rules"
          message={ws.reloadError}
          onRetry={() => ws.reloadSilently()}
          retrying={ws.reloading}
        />
      )}

      <div className="bg-white rounded-xl border border-neutral-200 p-3.5 overflow-x-auto">
        <div className="flex items-center gap-2 min-w-max text-xs">
          <span className="px-2.5 py-1 rounded-md bg-neutral-100 text-neutral-800 font-semibold">
            1. WhatsApp / Website Form
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-neutral-400" />
          <span className="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-900 border border-emerald-200 font-semibold">
            2. Button Flow & Order Lookup (0 AI Credits)
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-neutral-400" />
          <span className="px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-900 border border-indigo-200 font-semibold inline-flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            <span>3. ACRIO AI (Claude Haiku 5.5)</span>
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-neutral-400" />
          <span className="px-2.5 py-1 rounded-md bg-amber-50 text-amber-900 border border-amber-200 font-semibold">
            4. Team P0 → P1 → P2 + Instant Email Alert
          </span>
        </div>
      </div>

      {showAiPanel && ws.canManage && (
        <form
          onSubmit={onSubmitAiKey}
          className="bg-white rounded-xl border border-neutral-200 p-4 space-y-3 shadow-2xs"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Shared Claude Haiku 5.5 API Key for ACRIO
              </h2>
              <p className="text-xs text-neutral-600 mt-0.5">
                Used for ACRIO WhatsApp replies, website form first-response evaluation, and Meta template drafting.{" "}
                {ws.syncInfo?.aiConnected
                  ? `Active (${ws.syncInfo.aiMaskedKey}).`
                  : "Paste your sk-ant-... key below."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAiPanel(false)}
              className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              value={aiKeyInput}
              onChange={(e) => setAiKeyInput(e.target.value)}
              placeholder="sk-ant-api03-..."
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-neutral-300 bg-white focus:outline-none focus:border-[#00a884]"
            />
            <button
              type="submit"
              disabled={ws.savingAiKey}
              className="px-4 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold cursor-pointer"
            >
              {ws.savingAiKey ? "Saving..." : "Save API Key"}
            </button>
          </div>
        </form>
      )}

      {activeView === "TEAMS" && (
        <TeamRosterPanel
          teams={ws.teams}
          activeStaff={ws.activeStaff}
          canManage={ws.canManage}
          onUpdateTeamTimers={ws.handleUpdateTeamTimers}
          onDeleteTeam={ws.handleDeleteTeam}
          onAddMember={ws.handleAddMember}
          onQuickAddBulk={ws.handleQuickAddBulk}
          onRemoveMember={ws.handleRemoveMember}
          onToggleAvailability={ws.handleToggleAvailability}
          onToggleEmailAlerts={ws.handleToggleEmailAlerts}
          onUpdateCapacity={ws.handleUpdateCapacity}
        />
      )}

      {activeView === "EMAIL_DISPATCH" && (
        <EmailDispatchPanel
          canManage={ws.canManage}
          smtpSummary={ws.smtpSummary}
          emailLogs={ws.emailLogs}
          smtpHost={ws.smtpHost}
          setSmtpHost={ws.setSmtpHost}
          smtpPort={ws.smtpPort}
          setSmtpPort={ws.setSmtpPort}
          smtpUser={ws.smtpUser}
          setSmtpUser={ws.setSmtpUser}
          smtpPass={ws.smtpPass}
          setSmtpPass={ws.setSmtpPass}
          smtpFrom={ws.smtpFrom}
          setSmtpFrom={ws.setSmtpFrom}
          savingSmtp={ws.savingSmtp}
          testEmailTarget={ws.testEmailTarget}
          setTestEmailTarget={ws.setTestEmailTarget}
          sendingTestEmail={ws.sendingTestEmail}
          onSaveSmtpConfig={ws.handleSaveSmtpConfig}
          onSendTestEmail={ws.handleSendTestEmail}
          onReload={ws.reloadSilently}
        />
      )}

      {activeView === "BRIDGES" && (
        <EcosystemBridgesPanel
          ecosystemHealth={ws.ecosystemHealth}
          syncInfo={ws.syncInfo}
        />
      )}

      {showNewTeamModal && (
        <TeamMemberModal
          creatingTeam={ws.creatingTeam}
          onClose={() => setShowNewTeamModal(false)}
          onCreateTeam={ws.handleCreateTeam}
        />
      )}
    </div>
  );
}
