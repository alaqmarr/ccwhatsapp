"use client";

import { useState } from "react";

export interface UseInboxTeamAndBulkActionsParams {
  selectedId: string | null;
  currentUserId: string;
  currentUserName: string;
  staffList: { id: string; name: string }[];
  selectedThreadIds: string[];
  setSelectedThreadIds: (ids: string[]) => void;
  setBulkMode: (next: boolean | ((prev: boolean) => boolean)) => void;
  fetchAndCacheDetail: (
    convId: string,
    updateProfileInputs?: boolean
  ) => Promise<void>;
  refreshThreadsSilently: (manual?: boolean) => Promise<void>;
  showToast: (msg: string) => void;
}

export function useInboxTeamAndBulkActions(
  p: UseInboxTeamAndBulkActionsParams
) {
  const [bulkBusy, setBulkBusy] = useState(false);

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
    handleAddCollaborator,
    handleRemoveCollaborator,
    handleAddOrder,
    handleBulkResolveSelected,
    handleBulkAssignToMe,
  };
}
