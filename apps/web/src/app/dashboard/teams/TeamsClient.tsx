"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bell,
  BellOff,
  CheckCircle2,
  Clock,
  Globe,
  KeyRound,
  Mail,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import { ElementErrorState, formatDateTimeShortIst } from "@cc/ui";

interface TeamMemberItem {
  id: string;
  teamId: string;
  staffId: string;
  staffName: string;
  staffEmail: string;
  tier: "P0" | "P1" | "P2";
  maxActiveChats: number;
  isAvailable: boolean;
  emailAlertsEnabled?: boolean;
  activeOpenChats: number;
}

interface TeamItem {
  id: string;
  name: string;
  description: string;
  brandScope: string;
  routingKeywords: string;
  priorityRank: number;
  p0WaitMinutes: number;
  p1WaitMinutes: number;
  autoAssignEnabled: boolean;
  waitingChatsCount: number;
  members: TeamMemberItem[];
}

interface StaffOption {
  id: string;
  name: string;
  email: string;
  whatsappNumber: string;
  role: string;
  department: string;
  activeOpenChats: number;
}

interface SyncInfo {
  classicConceptsCount: number;
  classicEdgeMachinesCount: number;
  classicEdgeConsumablesCount: number;
  lastSyncedAt: string | null;
  aiConnected: boolean;
  aiKeySource: string;
  aiMaskedKey: string;
}

interface SmtpSummary {
  configured: boolean;
  source: string;
  host: string;
  port: number;
  userMasked: string;
  from: string;
}

interface EmailDispatchLog {
  id: string;
  dispatchType: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  conversationId: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

interface EcosystemHealth {
  classicEdge3002: {
    online: boolean;
    url: string;
    latencyMs: number;
    dbFallbackAvailable: boolean;
    smtpConfigured?: boolean;
  };
  classicConcepts3003: {
    online: boolean;
    url: string;
    latencyMs: number;
    dbFallbackAvailable: boolean;
    smtpConfigured?: boolean;
  };
  whatsapp3007: {
    online: boolean;
    port: number;
  };
  checkedAt: string;
}

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
  const [teams, setTeams] = useState<TeamItem[]>(initialTeams);
  const [activeStaff, setActiveStaff] = useState<StaffOption[]>(initialActiveStaff);
  const [canManage, setCanManage] = useState<boolean>(initialCanManage);
  const [toast, setToast] = useState<string>("");

  const [syncInfo, setSyncInfo] = useState<SyncInfo>(initialSyncInfo);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [reloadError, setReloadError] = useState<string>("");
  const [reloading, setReloading] = useState<boolean>(false);

  // Active section view
  const [activeView, setActiveView] = useState<"TEAMS" | "EMAIL_DISPATCH" | "BRIDGES">(
    "TEAMS"
  );

  // Shared AI key panel
  const [showAiPanel, setShowAiPanel] = useState<boolean>(false);
  const [aiKeyInput, setAiKeyInput] = useState<string>("");
  const [savingAiKey, setSavingAiKey] = useState<boolean>(false);

  // SMTP & Email logs state
  const [smtpSummary, setSmtpSummary] = useState<SmtpSummary | null>(null);
  const [emailLogs, setEmailLogs] = useState<EmailDispatchLog[]>([]);
  const [ecosystemHealth, setEcosystemHealth] = useState<EcosystemHealth | null>(null);

  const [smtpHost, setSmtpHost] = useState<string>("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState<number>(587);
  const [smtpUser, setSmtpUser] = useState<string>("");
  const [smtpPass, setSmtpPass] = useState<string>("");
  const [smtpFrom, setSmtpFrom] = useState<string>("Classic Concepts WhatsApp <noreply@classicconcepts.in>");
  const [savingSmtp, setSavingSmtp] = useState<boolean>(false);
  const [testEmailTarget, setTestEmailTarget] = useState<string>("");
  const [sendingTestEmail, setSendingTestEmail] = useState<boolean>(false);
  const [runningEscalation, setRunningEscalation] = useState<boolean>(false);

  // Create team modal
  const [showNewTeamModal, setShowNewTeamModal] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");
  const [newDesc, setNewDesc] = useState<string>("");
  const [newBrand, setNewBrand] = useState<string>("ALL");
  const [newKeywords, setNewKeywords] = useState<string>("");
  const [newPriorityRank, setNewPriorityRank] = useState<number>(5);
  const [newP0Mins, setNewP0Mins] = useState<number>(5);
  const [newP1Mins, setNewP1Mins] = useState<number>(12);
  const [creatingTeam, setCreatingTeam] = useState<boolean>(false);

  const [memberDrafts, setMemberDrafts] = useState<
    Record<string, { staffId: string; tier: "P0" | "P1" | "P2" }>
  >({});

  const showNotice = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  const reloadSilently = useCallback(async () => {
    setReloading(true);
    setReloadError("");
    try {
      const [tRes, cRes] = await Promise.all([
        fetch("/api/teams", { cache: "no-store" }),
        fetch("/api/cache/sync", { cache: "no-store" }),
      ]);
      const tData = await tRes.json().catch(() => ({}));
      const cData = await cRes.json().catch(() => ({}));

      if (tRes.ok && tData.ok) {
        setTeams(tData.teams || []);
        setActiveStaff(tData.activeStaff || []);
        setCanManage(Boolean(tData.canManage));
        if (tData.smtpSummary) {
          setSmtpSummary(tData.smtpSummary);
          if (tData.smtpSummary.host && !tData.smtpSummary.host.includes("Shared Ecosystem")) {
            setSmtpHost(tData.smtpSummary.host);
            setSmtpPort(Number(tData.smtpSummary.port || 587));
          }
          if (tData.smtpSummary.from) {
            setSmtpFrom(tData.smtpSummary.from);
          }
        }
        if (Array.isArray(tData.emailLogs)) {
          setEmailLogs(tData.emailLogs);
        }
        if (tData.ecosystemHealth) {
          setEcosystemHealth(tData.ecosystemHealth);
        }
      } else {
        setReloadError(
          tData.error || "Could not refresh teams and escalation settings."
        );
      }
      if (cRes.ok && cData.ok) {
        setSyncInfo(cData);
      }
    } catch {
      setReloadError(
        "Network error while refreshing teams. Click Try Again."
      );
    } finally {
      setReloading(false);
    }
  }, []);

  useEffect(() => {
    void reloadSilently();
  }, [reloadSilently]);

  async function handleRefreshCatalog() {
    setSyncing(true);
    const res = await fetch("/api/cache/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync" }),
    });
    const data = await res.json().catch(() => ({}));
    setSyncing(false);
    if (data.ok) {
      await reloadSilently();
      showNotice(
        `Synced ${data.classicConceptsCount} Classic Concepts products and ${data.classicEdgeMachinesCount} Classic Edge 53 machines.`
      );
    }
  }

  async function handleRunEscalationCheckNow() {
    setRunningEscalation(true);
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run_escalation_now" }),
    });
    const data = await res.json().catch(() => ({}));
    setRunningEscalation(false);
    if (data.ok) {
      await reloadSilently();
      showNotice("Checked all waiting chats and updated P0/P1/P2 escalations.");
    }
  }

  async function handleSaveSharedAiKey(e: React.FormEvent) {
    e.preventDefault();
    setSavingAiKey(true);
    const res = await fetch("/api/cache/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_ai_key",
        anthropicApiKey: aiKeyInput.trim(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSavingAiKey(false);
    if (!data.ok) {
      showNotice(data.error || "Could not save AI key.");
      return;
    }
    setAiKeyInput("");
    setShowAiPanel(false);
    await reloadSilently();
    showNotice("Saved shared Claude Haiku 5.5 API key for ACRIO.");
  }

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreatingTeam(true);
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_team",
        name: newName,
        description: newDesc,
        brandScope: newBrand,
        routingKeywords: newKeywords,
        priorityRank: newPriorityRank,
        p0WaitMinutes: newP0Mins,
        p1WaitMinutes: newP1Mins,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setCreatingTeam(false);
    if (data.ok) {
      setShowNewTeamModal(false);
      setNewName("");
      setNewDesc("");
      setNewKeywords("");
      await reloadSilently();
      showNotice("New team created.");
    }
  }

  async function handleUpdateTeamTimers(
    team: TeamItem,
    patch: Partial<{
      priorityRank: number;
      p0WaitMinutes: number;
      p1WaitMinutes: number;
      routingKeywords: string;
      autoAssignEnabled: boolean;
    }>
  ) {
    await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_team",
        teamId: team.id,
        ...patch,
      }),
    });
    await reloadSilently();
    showNotice(`Updated ${team.name} settings.`);
  }

  async function handleAddMember(teamId: string) {
    const draft = memberDrafts[teamId];
    const staffId = draft?.staffId || activeStaff[0]?.id || "";
    const tier = draft?.tier || "P0";
    if (!staffId) return;

    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_member",
        teamId,
        staffId,
        tier,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      await reloadSilently();
      showNotice(`Added team member to ${tier} lane.`);
    }
  }

  async function handleToggleAvailability(member: TeamMemberItem) {
    await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "toggle_member_availability",
        memberId: member.id,
        isAvailable: !member.isAvailable,
      }),
    });
    await reloadSilently();
  }

  async function handleToggleEmailAlerts(member: TeamMemberItem) {
    const current = member.emailAlertsEnabled !== false;
    await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "toggle_member_email_alerts",
        memberId: member.id,
        emailAlertsEnabled: !current,
      }),
    });
    await reloadSilently();
    showNotice(
      !current
        ? `Turned on assignment emails for ${member.staffName}.`
        : `Paused assignment emails for ${member.staffName}.`
    );
  }

  async function handleUpdateCapacity(
    member: TeamMemberItem,
    maxActiveChats: number,
    tier?: "P0" | "P1" | "P2"
  ) {
    await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_member_capacity",
        memberId: member.id,
        maxActiveChats,
        tier,
      }),
    });
    await reloadSilently();
    showNotice(`Updated ${member.staffName} routing settings.`);
  }

  async function handleRemoveMember(memberId: string) {
    await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "remove_member",
        memberId,
      }),
    });
    await reloadSilently();
  }

  async function handleDeleteTeam(team: TeamItem) {
    if (team.id === "team_sales") {
      showNotice("Sales Team is the default handoff team and cannot be deleted.");
      return;
    }
    if (!window.confirm(`Delete "${team.name}"? Existing chats will remain safe.`)) {
      return;
    }
    await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete_team",
        teamId: team.id,
      }),
    });
    await reloadSilently();
    showNotice(`Removed ${team.name}.`);
  }

  async function handleSaveSmtpConfig(e: React.FormEvent) {
    e.preventDefault();
    setSavingSmtp(true);
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_smtp_config",
        host: smtpHost.trim(),
        port: smtpPort,
        user: smtpUser.trim(),
        pass: smtpPass.trim() || undefined,
        from: smtpFrom.trim() || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSavingSmtp(false);
    if (data.ok) {
      setSmtpPass("");
      await reloadSilently();
      showNotice(data.message || "SMTP mailer saved.");
    } else {
      showNotice(data.error || "Could not save SMTP settings.");
    }
  }

  async function handleSendTestEmail(e: React.FormEvent) {
    e.preventDefault();
    setSendingTestEmail(true);
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send_test_email",
        toEmail: testEmailTarget.trim() || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSendingTestEmail(false);
    await reloadSilently();
    showNotice(
      data.message || data.error || "Test email request completed."
    );
  }

  const totalOnlineResponders = activeStaff.length;
  const totalWaitingChats = teams.reduce(
    (acc, t) => acc + (t.waitingChatsCount || 0),
    0
  );

  function renderTierColumn(
    team: TeamItem,
    tier: "P0" | "P1" | "P2",
    title: string,
    subtitle: string,
    accentClass: string,
    headerBgClass: string
  ) {
    const tierMembers = team.members.filter((m) => m.tier === tier);
    return (
      <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 flex flex-col overflow-hidden">
        <div className={`px-3.5 py-2.5 border-b border-neutral-200/80 ${headerBgClass}`}>
          <div className="flex items-center justify-between gap-2">
            <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${accentClass}`}>
              {tier} • {title}
            </span>
            <span className="text-[11px] font-semibold text-neutral-600">
              {tierMembers.length} {tierMembers.length === 1 ? "member" : "members"}
            </span>
          </div>
          <p className="text-[11.5px] text-neutral-600 mt-1">{subtitle}</p>
        </div>

        <div className="p-3 space-y-2 flex-1">
          {tierMembers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-300 bg-white/70 p-4 text-center text-xs text-neutral-500">
              No {tier} responder assigned yet. Add someone below so escalations never stall.
            </div>
          ) : (
            tierMembers.map((m) => {
              const cap = Math.max(1, m.maxActiveChats || 15);
              const pct = Math.min(100, Math.round((m.activeOpenChats / cap) * 100));
              const emailOn = m.emailAlertsEnabled !== false;
              return (
                <div
                  key={m.id}
                  className="bg-white rounded-lg border border-neutral-200 p-2.5 space-y-2 shadow-2xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-neutral-900 truncate flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            m.isAvailable ? "bg-emerald-500" : "bg-neutral-400"
                          }`}
                        />
                        <span className="truncate">{m.staffName}</span>
                      </div>
                      <div className="text-[11px] text-neutral-500 truncate">
                        {m.staffEmail || "No email on file"}
                      </div>
                    </div>

                    {canManage && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(m.id)}
                        title="Remove from this team"
                        className="p-1 rounded text-neutral-400 hover:text-red-600 hover:bg-red-50 cursor-pointer shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Workload Capacity Bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-neutral-600 font-medium">
                        Active load:{" "}
                        <strong className="text-neutral-900">
                          {m.activeOpenChats}
                        </strong>{" "}
                        / {cap} chats
                      </span>
                      <span
                        className={`font-semibold ${
                          pct >= 85
                            ? "text-red-700"
                            : pct >= 55
                            ? "text-amber-700"
                            : "text-emerald-700"
                        }`}
                      >
                        {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          pct >= 85
                            ? "bg-red-500"
                            : pct >= 55
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                        }`}
                        style={{ width: `${Math.max(4, pct)}%` }}
                      />
                    </div>
                  </div>

                  {/* Action Controls: Online/Away + Email Alert Toggle + Tier/Cap */}
                  <div className="pt-1.5 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!canManage}
                        onClick={() => handleToggleAvailability(m)}
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold border cursor-pointer disabled:cursor-default ${
                          m.isAvailable
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                            : "bg-neutral-100 text-neutral-600 border-neutral-300"
                        }`}
                      >
                        {m.isAvailable ? "Online" : "Away"}
                      </button>

                      <button
                        type="button"
                        disabled={!canManage}
                        onClick={() => handleToggleEmailAlerts(m)}
                        title={
                          emailOn
                            ? "Instant email sent when assigned a chat (click to pause)"
                            : "Email alerts paused (click to enable)"
                        }
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer disabled:cursor-default ${
                          emailOn
                            ? "bg-blue-50 text-blue-800 border-blue-200"
                            : "bg-neutral-100 text-neutral-500 border-neutral-200"
                        }`}
                      >
                        {emailOn ? (
                          <Bell className="w-3 h-3" />
                        ) : (
                          <BellOff className="w-3 h-3" />
                        )}
                        <span>{emailOn ? "Mail On" : "Mail Off"}</span>
                      </button>
                    </div>

                    {canManage && (
                      <div className="flex items-center gap-1">
                        <select
                          value={m.tier}
                          onChange={(e) =>
                            handleUpdateCapacity(
                              m,
                              cap,
                              e.target.value as "P0" | "P1" | "P2"
                            )
                          }
                          title="Move member to another escalation lane"
                          className="px-1.5 py-0.5 rounded border border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-700"
                        >
                          <option value="P0">P0</option>
                          <option value="P1">P1</option>
                          <option value="P2">P2</option>
                        </select>
                        <select
                          value={cap}
                          onChange={(e) =>
                            handleUpdateCapacity(m, Number(e.target.value))
                          }
                          title="Max concurrent open chats"
                          className="px-1.5 py-0.5 rounded border border-neutral-200 bg-neutral-50 text-[11px] text-neutral-700"
                        >
                          {[5, 10, 15, 25, 40, 60].map((limit) => (
                            <option key={limit} value={limit}>
                              Max {limit}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full p-4 lg:p-6 space-y-5 bg-neutral-50 min-h-screen">
      {/* Command Header */}
      <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 space-y-4 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
              <Users className="w-6 h-6 text-[#00a884] shrink-0" />
              <span>Teams, Escalation Routing & Assignment Mailer</span>
            </h1>
            <p className="text-xs sm:text-[13.5px] leading-relaxed text-slate-600 mt-1 max-w-4xl">
              Manage who receives customer chats after ACRIO or website form handoff, set P0 to P1 to P2 wait-time limits, and dispatch instant email alerts whenever a chat is assigned to a person.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRunEscalationCheckNow}
              disabled={runningEscalation}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-300 text-xs font-medium cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-amber-600" />
              <span>
                {runningEscalation ? "Checking..." : "Run Escalation Check"}
              </span>
            </button>

            <button
              type="button"
              onClick={handleRefreshCatalog}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-300 text-xs font-medium cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              <span>{syncing ? "Syncing..." : "Sync Catalogs"}</span>
            </button>

            {canManage && (
              <button
                type="button"
                onClick={() => setShowAiPanel((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-300 text-xs font-medium cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5 text-indigo-600" />
                <span>
                  {syncInfo?.aiConnected ? "Claude Haiku 5.5 Ready" : "Connect AI Key"}
                </span>
              </button>
            )}

            {canManage && (
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

        {/* Summary KPI Strip + Navigation Tabs */}
        <div className="pt-3 border-t border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                {
                  key: "TEAMS",
                  label: `Routing Teams (${teams.length})`,
                  icon: Users,
                },
                {
                  key: "EMAIL_DISPATCH",
                  label: `Staff Email Alerts (${emailLogs.length})`,
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
              Active Staff: <strong className="text-neutral-900">{totalOnlineResponders}</strong>
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
                  smtpSummary?.configured ? "text-emerald-700" : "text-amber-700"
                }
              >
                {smtpSummary?.configured ? "Active" : "Needs SMTP"}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {toast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs font-medium px-4 py-2.5 rounded-lg flex items-center justify-between">
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast("")}
            className="text-emerald-700 hover:text-emerald-950 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {reloadError && (
        <ElementErrorState
          compact
          title="Could not refresh team escalation rules"
          message={reloadError}
          onRetry={() => reloadSilently()}
          retrying={reloading}
        />
      )}

      {/* Visual End-to-End Flow Strip */}
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

      {/* Shared Anthropic API Key Panel */}
      {showAiPanel && canManage && (
        <form
          onSubmit={handleSaveSharedAiKey}
          className="bg-white rounded-xl border border-neutral-200 p-4 space-y-3 shadow-2xs"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Shared Claude Haiku 5.5 API Key for ACRIO
              </h2>
              <p className="text-xs text-neutral-600 mt-0.5">
                Used for ACRIO WhatsApp replies, website form first-response evaluation, and Meta template drafting.{" "}
                {syncInfo?.aiConnected
                  ? `Active (${syncInfo.aiMaskedKey}).`
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
              disabled={savingAiKey}
              className="px-4 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold cursor-pointer"
            >
              {savingAiKey ? "Saving..." : "Save API Key"}
            </button>
          </div>
        </form>
      )}

      {/* VIEW 1: TEAMS & ESCALATION LANES */}
      {activeView === "TEAMS" && (
        <div className="space-y-5">
          {teams.map((team) => {
            const draft = memberDrafts[team.id] || {
              staffId: activeStaff[0]?.id || "",
              tier: "P0" as const,
            };

            return (
              <div
                key={team.id}
                className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 space-y-4 shadow-2xs"
              >
                {/* Team Header */}
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 border-b border-neutral-100 pb-3.5">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-neutral-900 text-white text-[11px] font-semibold">
                        Priority #{team.priorityRank}
                      </span>
                      <h2 className="text-base font-bold text-neutral-900">
                        {team.name}
                      </h2>
                      {team.id === "team_sales" && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 text-[11px] font-semibold">
                          Default Handoff Team
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-700 border border-neutral-200 text-[11px] font-medium">
                        {team.brandScope === "CLASSIC_EDGE_53"
                          ? "Classic Edge 53 (:3002)"
                          : team.brandScope === "CLASSIC_CONCEPTS"
                          ? "Classic Concepts (:3003)"
                          : "Both Websites & WhatsApp"}
                      </span>
                      {team.waitingChatsCount > 0 && (
                        <span className="px-2 py-0.5 rounded-md bg-red-100 text-red-900 text-[11px] font-semibold">
                          {team.waitingChatsCount} waiting right now
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-600">{team.description}</p>
                    <p className="text-xs text-neutral-500">
                      <strong>Topic words:</strong>{" "}
                      {team.routingKeywords || "All general enquiries"}
                    </p>
                  </div>

                  {canManage && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <label className="inline-flex items-center gap-1.5 text-xs text-neutral-700 bg-neutral-50 px-2.5 py-1.5 rounded-lg border border-neutral-200">
                        <span>Rank:</span>
                        <select
                          value={team.priorityRank}
                          onChange={(e) =>
                            handleUpdateTeamTimers(team, {
                              priorityRank: Number(e.target.value),
                            })
                          }
                          className="bg-white border border-neutral-300 rounded px-1.5 py-0.5 text-xs font-semibold"
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                            <option key={n} value={n}>
                              #{n}
                            </option>
                          ))}
                        </select>
                      </label>

                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateTeamTimers(team, {
                            autoAssignEnabled: !team.autoAssignEnabled,
                          })
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                          team.autoAssignEnabled
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                            : "bg-neutral-100 text-neutral-600 border-neutral-300"
                        }`}
                      >
                        {team.autoAssignEnabled
                          ? "Auto-Assign On"
                          : "Auto-Assign Paused"}
                      </button>

                      {team.id !== "team_sales" && (
                        <button
                          type="button"
                          onClick={() => handleDeleteTeam(team)}
                          title="Delete team"
                          className="p-1.5 rounded-lg border border-neutral-200 text-neutral-400 hover:text-red-600 hover:border-red-200 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Wait-Time SLA Escalation Bar */}
                <div className="bg-[#f8faf9] rounded-lg border border-emerald-200/80 px-3.5 py-2.5 flex flex-wrap items-center gap-2 text-xs text-neutral-800">
                  <Clock className="w-4 h-4 text-[#00a884] shrink-0" />
                  <span className="font-semibold">SLA Escalation Timer:</span>
                  <span>
                    Starts at <strong>P0</strong> (least busy online person + email alert)
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-neutral-400" />
                  <span className="inline-flex items-center gap-1">
                    after
                    {canManage ? (
                      <select
                        value={team.p0WaitMinutes}
                        onChange={(e) =>
                          handleUpdateTeamTimers(team, {
                            p0WaitMinutes: Number(e.target.value),
                          })
                        }
                        className="bg-white border border-neutral-300 rounded px-1.5 py-0.5 font-semibold"
                      >
                        {[2, 3, 4, 5, 8, 10, 15].map((m) => (
                          <option key={m} value={m}>
                            {m} min
                          </option>
                        ))}
                      </select>
                    ) : (
                      <strong>{team.p0WaitMinutes} min</strong>
                    )}
                    moves to <strong>P1</strong>
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-neutral-400" />
                  <span className="inline-flex items-center gap-1">
                    after
                    {canManage ? (
                      <select
                        value={team.p1WaitMinutes}
                        onChange={(e) =>
                          handleUpdateTeamTimers(team, {
                            p1WaitMinutes: Number(e.target.value),
                          })
                        }
                        className="bg-white border border-neutral-300 rounded px-1.5 py-0.5 font-semibold"
                      >
                        {[5, 8, 10, 12, 15, 20, 30].map((m) => (
                          <option key={m} value={m}>
                            {m} min
                          </option>
                        ))}
                      </select>
                    ) : (
                      <strong>{team.p1WaitMinutes} min</strong>
                    )}
                    alerts <strong>P2 Team Lead</strong>
                  </span>
                </div>

                {/* P0 / P1 / P2 Responder Lanes */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
                  {renderTierColumn(
                    team,
                    "P0",
                    "First Responder",
                    "Receives new handoffs first and gets an instant assignment email.",
                    "bg-emerald-600 text-white",
                    "bg-emerald-50/70"
                  )}
                  {renderTierColumn(
                    team,
                    "P1",
                    "Backup Responder",
                    `Steps in automatically if customer waits ${team.p0WaitMinutes} min.`,
                    "bg-amber-500 text-white",
                    "bg-amber-50/70"
                  )}
                  {renderTierColumn(
                    team,
                    "P2",
                    "Team Lead / Urgent",
                    `Alerted by email if customer waits ${team.p1WaitMinutes} min.`,
                    "bg-red-600 text-white",
                    "bg-red-50/70"
                  )}
                </div>

                {/* Add Staff to Team Row */}
                {canManage && activeStaff.length > 0 && (
                  <div className="pt-3 border-t border-neutral-100 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-neutral-700 flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5 text-[#00a884]" />
                      <span>Add person to {team.name}:</span>
                    </span>
                    <select
                      value={draft.staffId}
                      onChange={(e) =>
                        setMemberDrafts((prev) => ({
                          ...prev,
                          [team.id]: { ...draft, staffId: e.target.value },
                        }))
                      }
                      className="px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs text-neutral-800"
                    >
                      {activeStaff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.role}) - {s.email}
                        </option>
                      ))}
                    </select>

                    <select
                      value={draft.tier}
                      onChange={(e) =>
                        setMemberDrafts((prev) => ({
                          ...prev,
                          [team.id]: {
                            ...draft,
                            tier: e.target.value as "P0" | "P1" | "P2",
                          },
                        }))
                      }
                      className="px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-medium text-neutral-800"
                    >
                      <option value="P0">P0 (First Responder)</option>
                      <option value="P1">P1 (Backup Escalation)</option>
                      <option value="P2">P2 (Team Lead)</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => handleAddMember(team.id)}
                      className="px-3.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold cursor-pointer"
                    >
                      Add to Lane
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW 2: STAFF EMAIL DISPATCH & SMTP CONFIGURATION */}
      {activeView === "EMAIL_DISPATCH" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 space-y-4 shadow-2xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-neutral-900 flex items-center gap-1.5">
                    <Mail className="w-4 h-4 text-[#00a884]" />
                    <span>Assignment Email Mailer (SMTP)</span>
                  </h2>
                  <p className="text-xs text-neutral-600 mt-1">
                    Whenever a chat is assigned or escalated to a staff member, we send an instant email with customer details and a 1-click Inbox link. If local SMTP is blank, we automatically relay through Classic Concepts (:3003) or Classic Edge (:3002) SMTP.
                  </p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold shrink-0 ${
                    smtpSummary?.configured
                      ? "bg-emerald-100 text-emerald-900"
                      : "bg-amber-100 text-amber-900"
                  }`}
                >
                  {smtpSummary?.configured
                    ? `Active (${smtpSummary.source})`
                    : "Not Set"}
                </span>
              </div>

              {smtpSummary?.configured && (
                <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 p-3 text-xs text-emerald-950 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Connected: {smtpSummary.host}</span>
                  </div>
                  <div className="text-[11px] text-emerald-900">
                    Account: {smtpSummary.userMasked} • From: {smtpSummary.from}
                  </div>
                </div>
              )}

              {canManage && (
                <form onSubmit={handleSaveSmtpConfig} className="space-y-3 text-xs">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="block font-medium text-neutral-700 mb-1">
                        SMTP Host
                      </label>
                      <input
                        type="text"
                        required
                        value={smtpHost}
                        onChange={(e) => setSmtpHost(e.target.value)}
                        placeholder="smtp.gmail.com"
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-neutral-700 mb-1">
                        Port
                      </label>
                      <input
                        type="number"
                        required
                        value={smtpPort}
                        onChange={(e) => setSmtpPort(Number(e.target.value))}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium text-neutral-700 mb-1">
                      SMTP Username / Email
                    </label>
                    <input
                      type="text"
                      required
                      value={smtpUser}
                      onChange={(e) => setSmtpUser(e.target.value)}
                      placeholder="notifications@classicconcepts.in"
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-neutral-700 mb-1">
                      SMTP App Password (leave blank to keep existing)
                    </label>
                    <input
                      type="password"
                      value={smtpPass}
                      onChange={(e) => setSmtpPass(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-neutral-700 mb-1">
                      Sender From Header
                    </label>
                    <input
                      type="text"
                      value={smtpFrom}
                      onChange={(e) => setSmtpFrom(e.target.value)}
                      placeholder="Classic Concepts WhatsApp <noreply@classicconcepts.in>"
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={savingSmtp}
                    className="w-full py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white font-semibold cursor-pointer"
                  >
                    {savingSmtp ? "Saving..." : "Save Direct SMTP Credentials"}
                  </button>
                </form>
              )}

              <form
                onSubmit={handleSendTestEmail}
                className="pt-3 border-t border-neutral-100 space-y-2 text-xs"
              >
                <label className="block font-semibold text-neutral-800">
                  Send Live Test Assignment Email
                </label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={testEmailTarget}
                    onChange={(e) => setTestEmailTarget(e.target.value)}
                    placeholder="Staff email (blank sends to your email)"
                    className="flex-1 rounded-lg border border-neutral-300 px-3 py-2"
                  />
                  <button
                    type="submit"
                    disabled={sendingTestEmail}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white font-semibold cursor-pointer shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{sendingTestEmail ? "Sending..." : "Send Test"}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="lg:col-span-7 bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-neutral-900">
                Recent Assignment & System Email Dispatches
              </h2>
              <button
                type="button"
                onClick={() => reloadSilently()}
                className="text-xs font-medium text-[#008069] hover:underline cursor-pointer"
              >
                Refresh Log
              </button>
            </div>

            {emailLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-500 border border-dashed border-neutral-200 rounded-lg">
                No email dispatches recorded yet. Assign a chat or click Send Test on the left to verify delivery.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-neutral-200 text-neutral-500">
                      <th className="py-2 pr-3 font-semibold">Type</th>
                      <th className="py-2 pr-3 font-semibold">Recipient</th>
                      <th className="py-2 pr-3 font-semibold">Subject</th>
                      <th className="py-2 pr-3 font-semibold">Status</th>
                      <th className="py-2 font-semibold">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {emailLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2.5 pr-3 font-mono text-[11px] text-neutral-700">
                          {log.dispatchType}
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="font-medium text-neutral-900">
                            {log.recipientName || "Staff"}
                          </div>
                          <div className="text-[11px] text-neutral-500">
                            {log.recipientEmail}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 max-w-[230px]">
                          <div className="truncate text-neutral-800" title={log.subject}>
                            {log.subject}
                          </div>
                          {log.conversationId && (
                            <Link
                              href={`/dashboard/inbox?chat=${encodeURIComponent(log.conversationId)}`}
                              className="text-[11px] text-[#008069] hover:underline"
                            >
                              Open Chat →
                            </Link>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10.5px] font-semibold ${
                              log.status === "SENT"
                                ? "bg-emerald-100 text-emerald-900"
                                : log.status === "FAILED"
                                ? "bg-red-100 text-red-900"
                                : "bg-amber-100 text-amber-900"
                            }`}
                          >
                            {log.status}
                          </span>
                          {log.errorMessage && (
                            <div className="text-[10.5px] text-red-600 truncate max-w-[160px]" title={log.errorMessage}>
                              {log.errorMessage}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 text-[11px] text-neutral-500 whitespace-nowrap">
                          {formatDateTimeShortIst(log.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 3: 3-WEBSITE INTERCONNECTION BRIDGE HEALTH */}
      {activeView === "BRIDGES" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-[#00a884]" />
                <span>Classic Concepts (:3003)</span>
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                  ecosystemHealth?.classicConcepts3003.online
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-amber-100 text-amber-900"
                }`}
              >
                {ecosystemHealth?.classicConcepts3003.online
                  ? `HTTP Live (${ecosystemHealth.classicConcepts3003.latencyMs}ms)`
                  : ecosystemHealth?.classicConcepts3003.dbFallbackAvailable
                  ? "Local DB Ready"
                  : "Standby"}
              </span>
            </div>
            <p className="text-xs text-neutral-600">
              Syncs acrylic product short links (ccapl.cc), live customer orders, contact form enquiries (evaluated by Claude Haiku 5.5), and shared SMTP relay.
            </p>
            <div className="text-[11px] font-mono text-neutral-500">
              {ecosystemHealth?.classicConcepts3003.url || "http://127.0.0.1:3003"} • {syncInfo.classicConceptsCount} products cached
            </div>
          </div>

          <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-indigo-600" />
                <span>Classic Edge 53 (:3002)</span>
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                  ecosystemHealth?.classicEdge3002.online
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-amber-100 text-amber-900"
                }`}
              >
                {ecosystemHealth?.classicEdge3002.online
                  ? `HTTP Live (${ecosystemHealth.classicEdge3002.latencyMs}ms)`
                  : ecosystemHealth?.classicEdge3002.dbFallbackAvailable
                  ? "Local DB Ready"
                  : "Standby"}
              </span>
            </div>
            <p className="text-xs text-neutral-600">
              Syncs diamond polishing machines, consumables, machine order status lookups, and quote form enquiries into Sales Team Inbox.
            </p>
            <div className="text-[11px] font-mono text-neutral-500">
              {ecosystemHealth?.classicEdge3002.url || "http://127.0.0.1:3002"} • {syncInfo.classicEdgeMachinesCount} machines cached
            </div>
          </div>

          <div className="bg-white rounded-xl border border-neutral-200 p-4 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>WhatsApp Hub (:3007)</span>
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[11px] font-semibold">
                Online (:3007)
              </span>
            </div>
            <p className="text-xs text-neutral-600">
              Powers whatsapp.ccapl.cc, track.ccapl.cc/{"{id}"} live order redirects, and ultra-short ccapl.cc/{"{6-char}"} shareable links.
            </p>
            <div className="text-[11px] font-mono text-neutral-500">
              Port 3007 • Bridge endpoint: /api/internal/website-enquiry
            </div>
          </div>
        </div>
      )}

      {/* Create New Team Modal */}
      {showNewTeamModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateTeam}
            className="bg-white rounded-xl border border-neutral-200 max-w-lg w-full p-5 space-y-4 shadow-lg"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-900">
                Create New Routing Team
              </h2>
              <button
                type="button"
                onClick={() => setShowNewTeamModal(false)}
                className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Team Name
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Hospitality & Hotel Desk"
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  What this team handles
                </label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="e.g. Bulk menu holders, buffet risers, and room signage"
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Brand Focus
                  </label>
                  <select
                    value={newBrand}
                    onChange={(e) => setNewBrand(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm bg-white"
                  >
                    <option value="ALL">Both Brands</option>
                    <option value="CLASSIC_CONCEPTS">
                      Classic Concepts Products
                    </option>
                    <option value="CLASSIC_EDGE_53">
                      Classic Edge 53 Machines
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Team Priority (1 = highest)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={newPriorityRank}
                    onChange={(e) => setNewPriorityRank(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Auto-Routing Words (comma separated)
                </label>
                <input
                  type="text"
                  value={newKeywords}
                  onChange={(e) => setNewKeywords(e.target.value)}
                  placeholder="e.g. hotel, resort, menu, banquet, qr stand"
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Move P0 to P1 after (minutes)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={newP0Mins}
                    onChange={(e) => setNewP0Mins(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Move P1 to P2 after (minutes)
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={120}
                    value={newP1Mins}
                    onChange={(e) => setNewP1Mins(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewTeamModal(false)}
                className="px-3.5 py-2 rounded-lg border border-neutral-300 text-xs font-medium text-neutral-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingTeam}
                className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer"
              >
                {creatingTeam ? "Creating..." : "Create Team"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
