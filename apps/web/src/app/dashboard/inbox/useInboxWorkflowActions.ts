"use client";

import { useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  ChatMessage,
  ConversationDetailBundle,
  ConversationSummary,
  StaffOption,
  TeamOption,
} from "@/lib/inbox-server-data";
import { inboxKeys } from "@/lib/inbox-queries";
import type { SaveCustomerProfilePayload } from "./RightDrawerProfileTab";
import { describeNoteResult } from "./inbox-helpers";

export interface UseInboxWorkflowActionsParams {
  queryClient: QueryClient;
  selectedId: string | null;
  detail: ConversationDetailBundle | null;
  currentUserId: string;
  currentUserName: string;
  teams: TeamOption[];
  staffList: StaffOption[];
  selectedThreadIds: string[];
  setSelectedThreadIds: (ids: string[]) => void;
  setBulkMode: (next: boolean | ((prev: boolean) => boolean)) => void;
  assignTeamId: string;
  assignStaffId: string;
  assignTier: "P0" | "P1" | "P2";
  resolveSummary: string;
  setShowAssignModal: (open: boolean) => void;
  setShowResolveModal: (open: boolean) => void;
  setShowNoteForNonOwner: (open: boolean) => void;
  optimisticSeqRef: React.MutableRefObject<number>;
  appendOptimisticMessage: (
    convId: string,
    msg: ChatMessage,
    threadPreviewText?: string
  ) => void;
  patchOptimisticMessage: (
    convId: string,
    tempId: string,
    patch: {
      id?: string;
      deliveryStatus?: string;
      waMessageId?: string | null;
      metadata?: Record<string, unknown> | null;
      body?: string;
    }
  ) => void;
  fetchAndCacheDetail: (
    convId: string,
    updateProfileInputs?: boolean
  ) => Promise<void>;
  refreshThreadsSilently: (manual?: boolean) => Promise<void>;
  showToast: (msg: string) => void;
}

export function useInboxWorkflowActions(p: UseInboxWorkflowActionsParams) {
  const [bulkBusy, setBulkBusy] = useState(false);
  const [summarizingChat, setSummarizingChat] = useState(false);
  const [takingOver, setTakingOver] = useState(false);

  const activeConv = p.detail?.conversation || null;

  async function handleQuickNoteSave(noteText: string) {
    if (!p.selectedId || !noteText.trim()) return;
    const convId = p.selectedId;
    const text = noteText.trim();
    const tempId = `optimistic_${Date.now()}_${++p.optimisticSeqRef.current}`;
    p.appendOptimisticMessage(convId, {
      id: tempId,
      direction: "INTERNAL",
      senderType: "STAFF_NOTE",
      senderName: p.currentUserName,
      messageType: "INTERNAL_NOTE",
      billingCategory: "INTERNAL",
      body: text,
      templateName: null,
      deliveryStatus: "SAVED",
      createdAt: new Date().toISOString(),
      metadata: null,
    });
    const noteRes = await fetch(`/api/conversations/${convId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_internal_note",
        noteText: text,
      }),
    });
    const noteData = await noteRes.json().catch(() => ({}));
    if (noteData.noteId) {
      p.patchOptimisticMessage(convId, tempId, {
        id: String(noteData.noteId),
        deliveryStatus: "SAVED",
      });
    }
    p.showToast(describeNoteResult(noteData));
    if (noteData.askedAcrio || noteData.accidentalReplyDetected) {
      void p.fetchAndCacheDetail(convId, false);
    }
  }

  async function handleReturnToAcrio() {
    if (!p.selectedId) return;
    await fetch(`/api/conversations/${p.selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "return_to_acrio" }),
    });
    p.showToast("Assigned chat to System (ACRIO).");
    await Promise.all([
      p.fetchAndCacheDetail(p.selectedId, false),
      p.refreshThreadsSilently(),
    ]);
  }

  async function handleSmartAssignSalesP0() {
    if (!p.selectedId) return;
    const res = await fetch(`/api/conversations/${p.selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "smart_assign", teamId: "team_sales" }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok && data.assignment) {
      p.showToast(
        `Connected to ${data.assignment.teamName} (${data.assignment.escalationLevel}: ${data.assignment.staffName})`
      );
    } else {
      p.showToast("Connected to Sales Team P0.");
    }
    await Promise.all([
      p.fetchAndCacheDetail(p.selectedId, false),
      p.refreshThreadsSilently(),
    ]);
  }

  async function handleManualAssignSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!p.selectedId) return;
    const chosenTeam = p.teams.find((t) => t.id === p.assignTeamId);
    const chosenStaff = p.staffList.find((s) => s.id === p.assignStaffId);

    if (p.assignStaffId === "ACRIO") {
      await fetch(`/api/conversations/${p.selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "return_to_acrio" }),
      });
      p.showToast("Assigned chat to System (ACRIO).");
    } else if (!p.assignStaffId) {
      await fetch(`/api/conversations/${p.selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "smart_assign",
          teamId: p.assignTeamId || "team_sales",
          tier: p.assignTier,
        }),
      });
      p.showToast(
        `Assigned to available ${p.assignTier} member in ${
          chosenTeam?.name || "Sales Team"
        }`
      );
    } else {
      const res = await fetch(`/api/conversations/${p.selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign_staff",
          teamId: chosenTeam?.id || "team_sales",
          teamName: chosenTeam?.name || "Sales Team",
          staffId: chosenStaff?.id,
          staffName: chosenStaff?.name,
          escalationLevel: p.assignTier,
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) {
        p.showToast(out.error || "Could not assign chat.");
        return;
      }
      p.showToast(
        `Assigned to ${chosenStaff?.name || "teammate"} (${p.assignTier})`
      );
    }

    p.setShowAssignModal(false);
    await Promise.all([
      p.fetchAndCacheDetail(p.selectedId, false),
      p.refreshThreadsSilently(),
    ]);
  }

  async function handleSmartResolve() {
    if (!p.selectedId) return;
    await fetch(`/api/conversations/${p.selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "smart_resolve",
        resolutionSummary: p.resolveSummary,
        smartCategory: p.detail?.acrio?.smartCategory,
      }),
    });
    p.setShowResolveModal(false);
    p.showToast("Chat marked resolved.");
    await Promise.all([
      p.fetchAndCacheDetail(p.selectedId, false),
      p.refreshThreadsSilently(),
    ]);
  }

  async function handleReopen() {
    if (!p.selectedId) return;
    await fetch(`/api/conversations/${p.selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen" }),
    });
    await Promise.all([
      p.fetchAndCacheDetail(p.selectedId, false),
      p.refreshThreadsSilently(),
    ]);
  }

  async function handleSaveCustomerProfile(payload: SaveCustomerProfilePayload) {
    if (!p.selectedId) return;
    const res = await fetch(`/api/conversations/${p.selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_customer_profile",
        ...payload,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) {
      p.showToast(out.error || "Could not save customer details.");
      return;
    }
    p.showToast("Customer details saved.");
    await Promise.all([
      p.fetchAndCacheDetail(p.selectedId, false),
      p.refreshThreadsSilently(false),
    ]);
  }

  async function handleTakeOverChat() {
    const targetId = p.selectedId;
    if (!targetId || takingOver) return;
    setTakingOver(true);
    try {
      const expectedCurrentStaffId =
        (p.detail?.conversation.id === targetId
          ? p.detail.conversation.assignedStaffId
          : activeConv?.assignedStaffId) || "ACRIO";
      const res = await fetch(`/api/conversations/${targetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "take_over_chat",
          expectedCurrentStaffId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        p.showToast(data.error || "Could not take over this chat.");
        if (res.status === 409) {
          await Promise.all([
            p.fetchAndCacheDetail(targetId, false),
            p.refreshThreadsSilently(false),
          ]);
        }
        return;
      }

      const baseBundle =
        p.queryClient.getQueryData<ConversationDetailBundle>(
          inboxKeys.detail(targetId)
        ) || (p.detail?.conversation.id === targetId ? p.detail : null);
      const nextStaffId = String(
        data.conversation?.assignedStaffId || p.currentUserId
      );
      const nextStaffName = String(
        data.conversation?.assignedStaffName || p.currentUserName
      );
      const fallbackTeamName =
        baseBundle?.conversation.assignedTeamName &&
        !baseBundle.conversation.assignedTeamName.startsWith("System (ACRIO)") &&
        baseBundle.conversation.assignedTeamName !== "ACRIO Assistant" &&
        baseBundle.conversation.assignedTeamName !== "Internal Team Desk"
          ? baseBundle.conversation.assignedTeamName
          : "Sales Team";
      const nextTeamId =
        data.conversation?.assignedTeamId ??
        (baseBundle?.conversation.assignedTeamId || "team_sales");
      const nextTeamName =
        data.conversation?.assignedTeamName ?? fallbackTeamName;

      if (baseBundle) {
        p.queryClient.setQueryData<ConversationDetailBundle>(
          inboxKeys.detail(targetId),
          {
            ...baseBundle,
            conversation: {
              ...baseBundle.conversation,
              ...(data.conversation && typeof data.conversation === "object"
                ? data.conversation
                : {}),
              assignedStaffId: nextStaffId,
              assignedStaffName: nextStaffName,
              assignedTeamId: nextTeamId,
              assignedTeamName: nextTeamName,
            },
          }
        );
      }

      p.queryClient.setQueryData<ConversationSummary[]>(
        inboxKeys.threads,
        (prev) =>
          prev
            ? prev.map((t) =>
                t.id === targetId
                  ? {
                      ...t,
                      assignedStaffId: nextStaffId,
                      assignedStaffName: nextStaffName,
                      assignedTeamId: nextTeamId,
                      assignedTeamName: nextTeamName,
                    }
                  : t
              )
            : prev
      );

      p.showToast("You took over this chat and can now reply directly.");
      p.setShowNoteForNonOwner(false);
      await Promise.all([
        p.fetchAndCacheDetail(targetId, false),
        p.refreshThreadsSilently(false),
      ]);
    } catch (err) {
      p.showToast(
        err instanceof Error
          ? err.message
          : "Network error while taking over chat."
      );
    } finally {
      setTakingOver(false);
    }
  }

  async function handleGenerateSummary() {
    if (!p.selectedId || summarizingChat) return;
    setSummarizingChat(true);
    try {
      const res = await fetch(`/api/conversations/${p.selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_summary" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        p.showToast(data.error || "Could not generate chat summary.");
        return;
      }
      p.showToast("ACRIO generated a private summary note.");
      await p.fetchAndCacheDetail(p.selectedId, false);
    } finally {
      setSummarizingChat(false);
    }
  }

  async function handleAddCollaborator(staffId: string) {
    if (!p.selectedId || !staffId) return;
    const chosen = p.staffList.find((s) => s.id === staffId);
    const res = await fetch(`/api/conversations/${p.selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_collaborator",
        staffId,
        staffName: chosen?.name || "",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      p.showToast(data.error || "Could not add teammate access.");
      return;
    }
    p.showToast(`Added ${chosen?.name || "teammate"} to this chat.`);
    await Promise.all([
      p.fetchAndCacheDetail(p.selectedId, false),
      p.refreshThreadsSilently(false),
    ]);
  }

  async function handleRemoveCollaborator(staffId: string) {
    if (!p.selectedId || !staffId) return;
    const res = await fetch(`/api/conversations/${p.selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "remove_collaborator",
        staffId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      p.showToast("Removed teammate access.");
      await Promise.all([
        p.fetchAndCacheDetail(p.selectedId, false),
        p.refreshThreadsSilently(false),
      ]);
    }
  }

  async function handleAddOrder(order: {
    itemsSummary: string;
    quantity: number;
    totalAmountInr: number;
  }) {
    if (!p.selectedId || !order.itemsSummary.trim()) return;
    await fetch(`/api/conversations/${p.selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_order",
        itemsSummary: order.itemsSummary,
        quantity: order.quantity,
        totalAmountInr: Number(order.totalAmountInr || 0),
      }),
    });
    p.showToast("Order recorded.");
    await p.fetchAndCacheDetail(p.selectedId, false);
  }

  async function handleBulkResolveSelected() {
    if (p.selectedThreadIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_resolve",
          conversationIds: p.selectedThreadIds,
          resolutionSummary: "Resolved via bulk inbox action.",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        p.showToast(`Resolved ${p.selectedThreadIds.length} chat(s).`);
        p.setSelectedThreadIds([]);
        p.setBulkMode(false);
        await p.refreshThreadsSilently(false);
        if (p.selectedId) await p.fetchAndCacheDetail(p.selectedId, false);
      } else {
        p.showToast(data.error || "Could not bulk resolve chats.");
      }
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkAssignToMe() {
    if (p.selectedThreadIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_assign",
          conversationIds: p.selectedThreadIds,
          staffId: p.currentUserId,
          staffName: p.currentUserName,
          teamId: "team_sales",
          teamName: "Sales Team",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        p.showToast(`Assigned ${p.selectedThreadIds.length} chat(s) to you.`);
        p.setSelectedThreadIds([]);
        p.setBulkMode(false);
        await p.refreshThreadsSilently(false);
        if (p.selectedId) await p.fetchAndCacheDetail(p.selectedId, false);
      } else {
        p.showToast(data.error || "Could not bulk assign chats.");
      }
    } finally {
      setBulkBusy(false);
    }
  }

  return {
    bulkBusy,
    summarizingChat,
    takingOver,
    handleQuickNoteSave,
    handleReturnToAcrio,
    handleSmartAssignSalesP0,
    handleManualAssignSubmit,
    handleSmartResolve,
    handleReopen,
    handleSaveCustomerProfile,
    handleTakeOverChat,
    handleGenerateSummary,
    handleAddCollaborator,
    handleRemoveCollaborator,
    handleAddOrder,
    handleBulkResolveSelected,
    handleBulkAssignToMe,
  };
}
