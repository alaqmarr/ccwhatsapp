"use client";

import React, { useCallback, useState } from "react";
import {
  ArrowRight,
  Clock,
  KeyRound,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";

interface TeamMemberItem {
  id: string;
  teamId: string;
  staffId: string;
  staffName: string;
  staffEmail: string;
  tier: "P0" | "P1" | "P2";
  maxActiveChats: number;
  isAvailable: boolean;
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
  const [showAiPanel, setShowAiPanel] = useState<boolean>(false);
  const [aiKeyInput, setAiKeyInput] = useState<string>("");
  const [savingAiKey, setSavingAiKey] = useState<boolean>(false);

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
    setTimeout(() => setToast(""), 3200);
  };

  const reloadSilently = useCallback(async () => {
    const [tRes, cRes] = await Promise.all([
      fetch("/api/teams", { cache: "no-store" }),
      fetch("/api/cache/sync", { cache: "no-store" }),
    ]);
    const tData = await tRes.json().catch(() => ({}));
    const cData = await cRes.json().catch(() => ({}));

    if (tData.ok) {
      setTeams(tData.teams || []);
      setActiveStaff(tData.activeStaff || []);
      setCanManage(Boolean(tData.canManage));
    }
    if (cData.ok) {
      setSyncInfo(cData);
    }
  }, []);

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
    showNotice("Saved shared Anthropic API key for ACRIO.");
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
    showNotice(`Updated ${team.name} rules.`);
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
      showNotice(`Assigned team member as ${tier}.`);
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

  function renderTierColumn(
    team: TeamItem,
    tier: "P0" | "P1" | "P2",
    title: string,
    subtitle: string,
    badgeClass: string
  ) {
    const tierMembers = team.members.filter((m) => m.tier === tier);
    return (
      <div className="bg-neutral-50 rounded-lg border border-neutral-200 p-3 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${badgeClass}`}>
              {tier} • {title}
            </span>
            <span className="text-[11px] text-neutral-500">
              {tierMembers.length} {tierMembers.length === 1 ? "person" : "people"}
            </span>
          </div>
          <p className="text-xs text-neutral-500 mb-2.5">{subtitle}</p>

          {tierMembers.length === 0 ? (
            <p className="text-xs text-neutral-400 italic py-2">
              No {tier} person assigned yet
            </p>
          ) : (
            <div className="space-y-1.5">
              {tierMembers.map((m) => (
                <div
                  key={m.id}
                  className="bg-white rounded border border-neutral-200 px-2.5 py-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-neutral-900 truncate">
                      {m.staffName}
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      {m.activeOpenChats} active{" "}
                      {m.activeOpenChats === 1 ? "chat" : "chats"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => handleToggleAvailability(m)}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer ${
                          m.isAvailable
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-neutral-100 text-neutral-500 border-neutral-300"
                        }`}
                      >
                        {m.isAvailable ? "Online" : "Away"}
                      </button>
                    ) : (
                      <span className="text-[11px] text-neutral-500">
                        {m.isAvailable ? "Online" : "Away"}
                      </span>
                    )}
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(m.id)}
                        title="Remove from team"
                        className="p-1 text-neutral-400 hover:text-red-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full p-4 lg:p-6 space-y-5 bg-neutral-50 min-h-screen">
      {/* Top Header */}
      <div className="bg-white rounded-lg border border-neutral-200 p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-[#00a884]" />
            <span>Teams, ACRIO Handoff & Wait-Time Escalation</span>
          </h1>
          <p className="text-sm text-neutral-600 mt-0.5">
            Every new customer chat starts with ACRIO automatically. When a customer asks for support or needs a custom quote, ACRIO connects the chat to Sales Team (P0) by default and escalates P0 to P1 to P2 if unanswered.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRefreshCatalog}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-300 text-xs font-medium cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            <span>
              {syncing ? "Syncing..." : "Refresh Products & Machines"}
            </span>
          </button>

          {canManage && (
            <button
              type="button"
              onClick={() => setShowAiPanel((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-300 text-xs font-medium cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5 text-neutral-600" />
              <span>
                {syncInfo?.aiConnected ? "AI Key Connected" : "Connect Shared AI Key"}
              </span>
            </button>
          )}

          {canManage && (
            <button
              type="button"
              onClick={() => setShowNewTeamModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Team</span>
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-medium px-4 py-2.5 rounded-md">
          {toast}
        </div>
      )}

      {/* ACRIO Initial Handling + Synced Catalog Banner */}
      <div className="bg-white rounded-lg border border-neutral-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-700">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-50 text-indigo-900 border border-indigo-200 font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Step 1: ACRIO Auto-Handler → Step 2: Sales Team (Default)</span>
          </span>
          <span>
            <strong>Classic Concepts Products:</strong> {syncInfo.classicConceptsCount} loaded
          </span>
          <span>
            <strong>Classic Edge 53 Machines:</strong> {syncInfo.classicEdgeMachinesCount} loaded
          </span>
          <span>
            <strong>Machine Consumables:</strong> {syncInfo.classicEdgeConsumablesCount} loaded
          </span>
        </div>
      </div>

      {/* Shared Anthropic API Key Panel */}
      {showAiPanel && canManage && (
        <form
          onSubmit={handleSaveSharedAiKey}
          className="bg-white rounded-lg border border-neutral-200 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Shared Anthropic API Key for ACRIO
              </h2>
              <p className="text-xs text-neutral-600 mt-0.5">
                One Anthropic API key works across Classic Concepts, Classic Edge 53, and WhatsApp.{" "}
                {syncInfo?.aiConnected
                  ? `Currently active (${syncInfo.aiMaskedKey}).`
                  : "Paste your sk-ant-... key below to turn on live AI replies."}
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
              className="flex-1 px-3 py-2 text-sm rounded-md border border-neutral-300 bg-white focus:outline-none focus:border-[#00a884]"
            />
            <button
              type="submit"
              disabled={savingAiKey}
              className="px-4 py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-medium cursor-pointer"
            >
              {savingAiKey ? "Saving..." : "Save Key"}
            </button>
          </div>
        </form>
      )}

      {/* Teams List (Server-Side Hydrated: Zero Flash!) */}
      <div className="space-y-4">
        {teams.map((team) => {
          const draft = memberDrafts[team.id] || {
            staffId: activeStaff[0]?.id || "",
            tier: "P0" as const,
          };

          return (
            <div
              key={team.id}
              className="bg-white rounded-lg border border-neutral-200 p-4 space-y-4"
            >
              {/* Team Top Row */}
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 border-b border-neutral-100 pb-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-neutral-900 text-white text-[11px] font-semibold">
                      Priority #{team.priorityRank}
                    </span>
                    <h2 className="text-base font-semibold text-neutral-900">
                      {team.name}
                    </h2>
                    {team.id === "team_sales" && (
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 text-[11px] font-semibold">
                        Default ACRIO Handoff Team
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 border border-neutral-200 text-[11px] font-medium">
                      {team.brandScope === "CLASSIC_EDGE_53"
                        ? "Classic Edge 53 Machines"
                        : team.brandScope === "CLASSIC_CONCEPTS"
                        ? "Classic Concepts Products"
                        : "All Products & Machines"}
                    </span>
                    {team.waitingChatsCount > 0 && (
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[11px] font-semibold">
                        {team.waitingChatsCount} customer
                        {team.waitingChatsCount === 1 ? "" : "s"} waiting
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-600">{team.description}</p>
                  <p className="text-xs text-neutral-500">
                    <strong>Matching words:</strong>{" "}
                    {team.routingKeywords || "General enquiries"}
                  </p>
                </div>

                {canManage && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <label className="inline-flex items-center gap-1.5 text-xs text-neutral-700 bg-neutral-50 px-2.5 py-1.5 rounded border border-neutral-200">
                      <span>Team Priority:</span>
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
                      className={`px-2.5 py-1.5 rounded text-xs font-medium border cursor-pointer ${
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
                        className="p-1.5 rounded border border-neutral-200 text-neutral-400 hover:text-red-600 hover:border-red-200 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Escalation Timing Strip */}
              <div className="bg-[#f8faf9] rounded-md border border-emerald-100 px-3.5 py-2.5 flex flex-wrap items-center gap-2 text-xs text-neutral-800">
                <Clock className="w-4 h-4 text-[#00a884] shrink-0" />
                <span className="font-semibold">Automatic Wait-Time Flow:</span>
                <span>
                  Assign to <strong>P0</strong> on handoff
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-neutral-400" />
                <span className="inline-flex items-center gap-1">
                  if unanswered for
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
                  move to <strong>P1</strong>
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-neutral-400" />
                <span className="inline-flex items-center gap-1">
                  if still unanswered at
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
                  escalate to <strong>P2 Lead</strong>
                </span>
              </div>

              {/* P0 / P1 / P2 Responder Columns */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {renderTierColumn(
                  team,
                  "P0",
                  "First Responder",
                  "Gets handed-off chats first (picks least busy online person).",
                  "bg-emerald-100 text-emerald-900"
                )}
                {renderTierColumn(
                  team,
                  "P1",
                  "Backup Escalation",
                  `Steps in if customer waits ${team.p0WaitMinutes} min without a reply.`,
                  "bg-amber-100 text-amber-900"
                )}
                {renderTierColumn(
                  team,
                  "P2",
                  "Team Lead / Urgent",
                  `Alerted if customer waits ${team.p1WaitMinutes} min without a reply.`,
                  "bg-red-100 text-red-900"
                )}
              </div>

              {/* Add Staff to Team Row */}
              {canManage && activeStaff.length > 0 && (
                <div className="pt-2 border-t border-neutral-100 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-neutral-600 flex items-center gap-1">
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Assign staff to {team.name}:</span>
                  </span>
                  <select
                    value={draft.staffId}
                    onChange={(e) =>
                      setMemberDrafts((prev) => ({
                        ...prev,
                        [team.id]: { ...draft, staffId: e.target.value },
                      }))
                    }
                    className="px-2.5 py-1.5 rounded border border-neutral-300 bg-white text-xs text-neutral-800"
                  >
                    {activeStaff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.role}) - {s.activeOpenChats} open
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
                    className="px-2.5 py-1.5 rounded border border-neutral-300 bg-white text-xs font-medium text-neutral-800"
                  >
                    <option value="P0">Assign as P0 (First Responder)</option>
                    <option value="P1">Assign as P1 (Backup)</option>
                    <option value="P2">Assign as P2 (Team Lead)</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => handleAddMember(team.id)}
                    className="px-3 py-1.5 rounded bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-medium cursor-pointer"
                  >
                    Save Assignment
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create New Team Modal */}
      {showNewTeamModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateTeam}
            className="bg-white rounded-lg border border-neutral-200 max-w-lg w-full p-5 space-y-4 shadow-lg"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-900">
                Create New Team
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
                  className="w-full px-3 py-2 rounded border border-neutral-300 text-sm"
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
                  className="w-full px-3 py-2 rounded border border-neutral-300 text-sm"
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
                    className="w-full px-3 py-2 rounded border border-neutral-300 text-sm bg-white"
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
                    className="w-full px-3 py-2 rounded border border-neutral-300 text-sm"
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
                  className="w-full px-3 py-2 rounded border border-neutral-300 text-sm"
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
                    className="w-full px-3 py-2 rounded border border-neutral-300 text-sm"
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
                    className="w-full px-3 py-2 rounded border border-neutral-300 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewTeamModal(false)}
                className="px-3.5 py-2 rounded border border-neutral-300 text-xs font-medium text-neutral-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingTeam}
                className="px-4 py-2 rounded bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer"
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
