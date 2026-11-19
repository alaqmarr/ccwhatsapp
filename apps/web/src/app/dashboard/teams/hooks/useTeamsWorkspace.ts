"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  EcosystemHealth,
  EmailDispatchLog,
  SmtpSummary,
  StaffOption,
  SyncInfo,
  TeamCreateInput,
  TeamItem,
  TeamMemberItem,
  TeamTimerPatch,
} from "@/app/dashboard/teams/types";

export function useTeamsWorkspace({
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

  const [smtpSummary, setSmtpSummary] = useState<SmtpSummary | null>(null);
  const [emailLogs, setEmailLogs] = useState<EmailDispatchLog[]>([]);
  const [ecosystemHealth, setEcosystemHealth] = useState<EcosystemHealth | null>(null);

  const [smtpHost, setSmtpHost] = useState<string>("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState<number>(587);
  const [smtpUser, setSmtpUser] = useState<string>("");
  const [smtpPass, setSmtpPass] = useState<string>("");
  const [smtpFrom, setSmtpFrom] = useState<string>(
    "Classic Concepts WhatsApp <noreply@classicconcepts.in>"
  );
  const [savingSmtp, setSavingSmtp] = useState<boolean>(false);
  const [testEmailTarget, setTestEmailTarget] = useState<string>("");
  const [sendingTestEmail, setSendingTestEmail] = useState<boolean>(false);
  const [runningEscalation, setRunningEscalation] = useState<boolean>(false);
  const [savingAiKey, setSavingAiKey] = useState<boolean>(false);
  const [creatingTeam, setCreatingTeam] = useState<boolean>(false);

  const showNotice = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }, []);

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
          if (
            tData.smtpSummary.host &&
            !String(tData.smtpSummary.host).includes("Shared Ecosystem")
          ) {
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

  const handleRefreshCatalog = useCallback(async () => {
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
  }, [reloadSilently, showNotice]);

  const handleRunEscalationCheckNow = useCallback(async () => {
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
  }, [reloadSilently, showNotice]);

  const handleSaveSharedAiKey = useCallback(
    async (apiKey: string): Promise<boolean> => {
      setSavingAiKey(true);
      const res = await fetch("/api/cache/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_ai_key",
          anthropicApiKey: apiKey.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      setSavingAiKey(false);
      if (!data.ok) {
        showNotice(data.error || "Could not save AI key.");
        return false;
      }
      await reloadSilently();
      showNotice("Saved shared Claude Haiku 5.5 API key for ACRIO.");
      return true;
    },
    [reloadSilently, showNotice]
  );

  const handleCreateTeam = useCallback(
    async (input: TeamCreateInput): Promise<boolean> => {
      if (!input.name.trim()) return false;
      setCreatingTeam(true);
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_team",
          name: input.name,
          description: input.description,
          brandScope: input.brandScope,
          routingKeywords: input.routingKeywords,
          priorityRank: input.priorityRank,
          p0WaitMinutes: input.p0WaitMinutes,
          p1WaitMinutes: input.p1WaitMinutes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setCreatingTeam(false);
      if (data.ok) {
        await reloadSilently();
        showNotice("New team created.");
        return true;
      }
      showNotice(data.error || "Could not create team.");
      return false;
    },
    [reloadSilently, showNotice]
  );

  const handleUpdateTeamTimers = useCallback(
    async (team: TeamItem, patch: TeamTimerPatch) => {
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
    },
    [reloadSilently, showNotice]
  );

  const handleAddMember = useCallback(
    async (teamId: string, staffId: string, tier: "P0" | "P1" | "P2") => {
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
    },
    [reloadSilently, showNotice]
  );

  const handleQuickAddBulk = useCallback(
    async (
      teamId: string,
      tier: "P0" | "P1" | "P2",
      staffIds: string[],
      maxActiveChats: number
    ): Promise<boolean> => {
      if (staffIds.length === 0) return false;
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_members_bulk",
          teamId,
          tier,
          staffIds,
          maxActiveChats,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        const count = data.addedCount || staffIds.length;
        await reloadSilently();
        showNotice(
          `Added ${count} ${count === 1 ? "member" : "members"} to ${tier} lane.`
        );
        return true;
      }
      showNotice(data.error || "Could not add selected members.");
      return false;
    },
    [reloadSilently, showNotice]
  );

  const handleToggleAvailability = useCallback(
    async (member: TeamMemberItem) => {
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
    },
    [reloadSilently]
  );

  const handleToggleEmailAlerts = useCallback(
    async (member: TeamMemberItem) => {
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
    },
    [reloadSilently, showNotice]
  );

  const handleUpdateCapacity = useCallback(
    async (
      member: TeamMemberItem,
      maxActiveChats: number,
      tier?: "P0" | "P1" | "P2"
    ) => {
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
    },
    [reloadSilently, showNotice]
  );

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_member",
          memberId,
        }),
      });
      await reloadSilently();
    },
    [reloadSilently]
  );

  const handleDeleteTeam = useCallback(
    async (team: TeamItem) => {
      if (team.id === "team_sales") {
        showNotice("Sales Team is the default handoff team and cannot be deleted.");
        return;
      }
      if (
        !window.confirm(`Delete "${team.name}"? Existing chats will remain safe.`)
      ) {
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
    },
    [reloadSilently, showNotice]
  );

  const handleSaveSmtpConfig = useCallback(
    async (e: React.FormEvent) => {
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
    },
    [smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, reloadSilently, showNotice]
  );

  const handleSendTestEmail = useCallback(
    async (e: React.FormEvent) => {
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
    },
    [testEmailTarget, reloadSilently, showNotice]
  );

  return {
    teams,
    activeStaff,
    canManage,
    toast,
    setToast,
    syncInfo,
    syncing,
    reloadError,
    reloading,
    smtpSummary,
    emailLogs,
    ecosystemHealth,
    smtpHost,
    setSmtpHost,
    smtpPort,
    setSmtpPort,
    smtpUser,
    setSmtpUser,
    smtpPass,
    setSmtpPass,
    smtpFrom,
    setSmtpFrom,
    savingSmtp,
    testEmailTarget,
    setTestEmailTarget,
    sendingTestEmail,
    runningEscalation,
    savingAiKey,
    creatingTeam,
    reloadSilently,
    handleRefreshCatalog,
    handleRunEscalationCheckNow,
    handleSaveSharedAiKey,
    handleCreateTeam,
    handleUpdateTeamTimers,
    handleAddMember,
    handleQuickAddBulk,
    handleToggleAvailability,
    handleToggleEmailAlerts,
    handleUpdateCapacity,
    handleRemoveMember,
    handleDeleteTeam,
    handleSaveSmtpConfig,
    handleSendTestEmail,
  };
}
