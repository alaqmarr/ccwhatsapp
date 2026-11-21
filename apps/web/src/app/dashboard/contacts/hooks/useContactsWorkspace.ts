"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AddContactFormState,
  Contact360Detail,
  ContactItem,
  ContactsPayload,
} from "@/app/dashboard/contacts/types";

export function useContactsWorkspace(initialData?: ContactsPayload) {
  const router = useRouter();

  const [data, setData] = useState<ContactsPayload | null>(initialData ?? null);
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [syncingSources, setSyncingSources] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [toast, setToast] = useState<string>("");
  const skippedInitialFetchRef = useRef<boolean>(Boolean(initialData));

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [stageFilter, setStageFilter] = useState<string>("ALL");
  const [optInFilter, setOptInFilter] = useState<string>("ALL");
  const [orgFilter, setOrgFilter] = useState<string>("ALL");
  const [sourceFilter, setSourceFilter] = useState<string>("ALL");
  const [groupFilter, setGroupFilter] = useState<string>("ALL");
  const [tagFilter, setTagFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<string>("recent");

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openingChatPhone, setOpeningChatPhone] = useState<string>("");

  const [drawerContactId, setDrawerContactId] = useState<string | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<Contact360Detail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState<boolean>(false);
  const [drawerError, setDrawerError] = useState<string>("");
  const [savingDrawer, setSavingDrawer] = useState<boolean>(false);

  const showNotice = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }, []);

  const loadContacts = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams();
        if (searchQuery.trim()) params.set("q", searchQuery.trim());
        if (stageFilter !== "ALL") params.set("stage", stageFilter);
        if (optInFilter !== "ALL") params.set("optIn", optInFilter);
        if (orgFilter !== "ALL") params.set("orgType", orgFilter);
        if (sourceFilter !== "ALL") params.set("source", sourceFilter);
        if (groupFilter !== "ALL") params.set("groupId", groupFilter);
        if (tagFilter !== "ALL") params.set("tag", tagFilter);
        if (sortBy !== "recent") params.set("sort", sortBy);

        const res = await fetch(`/api/contacts?${params.toString()}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          setError(json.error || "Could not load Contacts Database.");
          return;
        }
        setData(json);
      } catch {
        setError("Network error while loading Contacts Database.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      searchQuery,
      stageFilter,
      optInFilter,
      orgFilter,
      sourceFilter,
      groupFilter,
      tagFilter,
      sortBy,
    ]
  );

  useEffect(() => {
    if (skippedInitialFetchRef.current) {
      skippedInitialFetchRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void loadContacts(Boolean(data));
    }, 160);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchQuery,
    stageFilter,
    optInFilter,
    orgFilter,
    sourceFilter,
    groupFilter,
    tagFilter,
    sortBy,
  ]);

  const resetFilters = useCallback(() => {
    setSearchQuery("");
    setStageFilter("ALL");
    setOptInFilter("ALL");
    setOrgFilter("ALL");
    setSourceFilter("ALL");
    setGroupFilter("ALL");
    setTagFilter("ALL");
  }, []);

  const loadContact360 = useCallback(async (id: string) => {
    setDrawerContactId(id);
    setDrawerLoading(true);
    setDrawerError("");
    try {
      const res = await fetch(
        `/api/contacts?contactId=${encodeURIComponent(id)}`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok || !json.detail) {
        setDrawerError(json.error || "Could not load contact details.");
        return;
      }
      setDrawerDetail(json.detail);
    } catch {
      setDrawerError("Network error while loading contact details.");
    } finally {
      setDrawerLoading(false);
    }
  }, []);

  const handleOpenChat = useCallback(
    async (contact: {
      phone: string;
      name: string;
      conversationId?: string | null;
    }) => {
      if (contact.conversationId) {
        router.push(
          `/dashboard/inbox?chat=${encodeURIComponent(contact.conversationId)}`
        );
        return;
      }
      setOpeningChatPhone(contact.phone);
      try {
        const res = await fetch("/api/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "open_or_create_chat",
            phone: contact.phone,
            name: contact.name,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok && json.conversationId) {
          router.push(
            `/dashboard/inbox?chat=${encodeURIComponent(json.conversationId)}`
          );
        } else {
          showNotice(json.error || "Could not open WhatsApp chat.");
        }
      } finally {
        setOpeningChatPhone("");
      }
    },
    [router, showNotice]
  );

  const handleSyncSources = useCallback(async () => {
    setSyncingSources(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_sources" }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        showNotice(
          `Synced contacts: ${json.importedCount} new added, ${json.updatedCount} updated.`
        );
        await loadContacts(true);
      } else {
        showNotice(json.error || "Could not sync contacts.");
      }
    } finally {
      setSyncingSources(false);
    }
  }, [loadContacts, showNotice]);

  const handleCreateContact = useCallback(
    async (form: AddContactFormState): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_contact",
          name: form.name,
          phone: form.phone,
          companyName: form.companyName,
          designation: form.designation,
          email: form.email,
          organizationType: form.organizationType,
          city: form.city,
          state: form.state,
          gstNumber: form.gstNumber,
          stage: form.stage,
          tags: form.tagsText
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          groups: form.groups,
          optInMarketing: form.optInMarketing,
          preferredStaffId: form.preferredStaffId || undefined,
          notes: form.notes,
          source: "MANUAL",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        return { ok: false, error: json.error || "Could not save contact." };
      }
      showNotice(
        json.isNew
          ? "New contact added to database."
          : "Existing contact updated."
      );
      await loadContacts(true);
      return { ok: true };
    },
    [loadContacts, showNotice]
  );

  const handleSaveDrawer = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!drawerDetail) return;
      setSavingDrawer(true);
      try {
        const res = await fetch("/api/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "upsert_contact",
            phone: drawerDetail.phone,
            name: drawerDetail.name,
            email: drawerDetail.email,
            companyName: drawerDetail.companyName,
            designation: drawerDetail.designation,
            organizationType: drawerDetail.organizationType,
            city: drawerDetail.city,
            state: drawerDetail.state,
            country: drawerDetail.country,
            gstNumber: drawerDetail.gstNumber,
            stage: drawerDetail.stage,
            acrioSegment: drawerDetail.acrioSegment,
            tags: drawerDetail.tags,
            groups: drawerDetail.groups,
            optInMarketing: drawerDetail.optInMarketing,
            optOutReason: drawerDetail.optOutReason,
            preferredStaffId: drawerDetail.preferredStaffId || "",
            preferredStaffName: drawerDetail.preferredStaffName || "",
            notes: drawerDetail.notes,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok) {
          showNotice("Saved contact profile.");
          await loadContacts(true);
        } else {
          showNotice(json.error || "Could not update contact.");
        }
      } finally {
        setSavingDrawer(false);
      }
    },
    [drawerDetail, loadContacts, showNotice]
  );

  const handleQuickToggleOptIn = useCallback(
    async (c: ContactItem) => {
      const nextVal = !c.optInMarketing;
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_contact",
          phone: c.phone,
          optInMarketing: nextVal,
          optOutReason: nextVal ? "" : "Opted out in Contacts Database",
        }),
      });
      if (res.ok) {
        showNotice(
          nextVal
            ? `${c.name} marked opted-in for broadcasts.`
            : `${c.name} marked opted-out (Do Not Disturb).`
        );
        await loadContacts(true);
      }
    },
    [loadContacts, showNotice]
  );

  const handleBulkImport = useCallback(
    async (input: {
      csvText: string;
      groupId: string;
      defaultTag: string;
      sourceLabel: string;
      defaultPreferredStaffId?: string;
      preferredStaffMode?: "fallback" | "override";
      staffMappings?: Record<string, string>;
    }): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_import",
          ...input,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        return { ok: false, error: json.error || "Import failed." };
      }
      const multiMsg =
        Number(json.multiNumberRowCount || 0) > 0
          ? `, ${json.multiNumberRowCount} multi-number contacts linked`
          : "";
      const staffMsg =
        Number(json.preferredStaffAssignedCount || 0) > 0
          ? `, ${json.preferredStaffAssignedCount} tagged to preferred staff`
          : "";
      showNotice(
        `Import complete: ${json.importedCount} added, ${json.updatedCount} updated, ${json.skippedCount} skipped${multiMsg}${staffMsg}.`
      );
      await loadContacts(true);
      return { ok: true };
    },
    [loadContacts, showNotice]
  );

  const handleExportCsv = useCallback(() => {
    if (!data) return;
    const rowsToExport =
      selectedIds.length > 0
        ? data.contacts.filter((c) => selectedIds.includes(c.id))
        : data.contacts;

    const cleanCell = (v: unknown) =>
      String(v ?? "")
        .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\uFFFD]/g, "")
        .replace(/\r?\n/g, " | ")
        .trim();
    const esc = (v: unknown) => {
      const s = cleanCell(v);
      const safe =
        s && (/^[=@\t\r]/.test(s) || (/^[+\-]/.test(s) && !/^\+\d[\d\s()-]{6,}$/.test(s)))
          ? `'${s}`
          : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const extractAltPhones = (notes: string, ownPhone: string) => {
      const found = Array.from(
        notes.matchAll(/(?:Alternate number\(s\)[^:]*:|Linked to primary number)\s*([^\n|]+)/gi)
      )
        .flatMap((m) => m[1].match(/\+?\d[\d]{9,14}/g) || [])
        .filter((p) => p !== ownPhone);
      return Array.from(new Set(found)).join(" | ");
    };
    const lines = [
      [
        "Name",
        "Phone",
        "Alternate Phones",
        "Company",
        "Designation",
        "Organization Type",
        "Email",
        "City",
        "State",
        "GST Number",
        "Stage",
        "Preferred Staff",
        "Broadcast Opt-In",
        "Tags",
        "Orders Count",
        "Lifetime Value INR",
        "Source",
        "Last Contacted",
        "Notes",
      ].join(","),
      ...rowsToExport.map((c) =>
        [
          esc(c.name),
          esc(c.phone),
          esc(extractAltPhones(c.notes || "", c.phone)),
          esc(c.companyName),
          esc(c.designation),
          esc(c.organizationType),
          esc(c.email),
          esc(c.city),
          esc(c.state),
          esc(c.gstNumber),
          esc(c.stage),
          esc(c.preferredStaffName || c.assignedOwnerName || ""),
          esc(c.optInMarketing ? "Yes" : "No"),
          esc(c.tags.join(" | ")),
          c.totalOrdersCount,
          c.lifetimeValueInr.toFixed(2),
          esc(c.source),
          esc(c.lastContactedAt),
          esc(c.notes),
        ].join(",")
      ),
    ];

    const blob = new Blob([`\uFEFF${lines.join("\n")}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, selectedIds]);

  const runBulkAction = useCallback(
    async (payload: Record<string, unknown>, successMsg: string) => {
      if (selectedIds.length === 0) return;
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_action",
          contactIds: selectedIds,
          ...payload,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        showNotice(successMsg);
        if (payload.subAction === "delete") {
          setSelectedIds([]);
        }
        await loadContacts(true);
      } else {
        showNotice(json.error || "Could not complete bulk action.");
      }
    },
    [selectedIds, loadContacts, showNotice]
  );

  const handlePushToBroadcastList = useCallback(
    async (listId: string, newListName: string): Promise<boolean> => {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_action",
          subAction: "push_to_marketing_list",
          contactIds: selectedIds,
          listId,
          newListName,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        showNotice(
          `Added opted-in contacts (${json.membersCount} total in broadcast list).`
        );
        await loadContacts(true);
        return true;
      }
      showNotice(json.error || "Could not add contacts to broadcast list.");
      return false;
    },
    [selectedIds, loadContacts, showNotice]
  );

  const handleCreateGroup = useCallback(
    async (name: string, description: string): Promise<boolean> => {
      if (!name.trim()) return false;
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_group",
          name,
          description,
        }),
      });
      if (res.ok) {
        showNotice("Contact group created.");
        await loadContacts(true);
        return true;
      }
      return false;
    },
    [loadContacts, showNotice]
  );

  const handleDeleteGroup = useCallback(
    async (groupId: string) => {
      await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_group", groupId }),
      });
      if (groupFilter === groupId) setGroupFilter("ALL");
      await loadContacts(true);
    },
    [groupFilter, loadContacts]
  );

  const allVisibleIds = useMemo(
    () => (data?.contacts || []).map((c) => c.id),
    [data?.contacts]
  );
  const allSelected =
    allVisibleIds.length > 0 &&
    allVisibleIds.every((id) => selectedIds.includes(id));

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      allVisibleIds.length > 0 && allVisibleIds.every((id) => prev.includes(id))
        ? []
        : allVisibleIds
    );
  }, [allVisibleIds]);

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const groupMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of data?.groups || []) m.set(g.id, g.name);
    return m;
  }, [data?.groups]);

  return {
    data,
    loading,
    refreshing,
    syncingSources,
    error,
    toast,
    searchQuery,
    setSearchQuery,
    stageFilter,
    setStageFilter,
    optInFilter,
    setOptInFilter,
    orgFilter,
    setOrgFilter,
    sourceFilter,
    setSourceFilter,
    groupFilter,
    setGroupFilter,
    tagFilter,
    setTagFilter,
    sortBy,
    setSortBy,
    selectedIds,
    setSelectedIds,
    allSelected,
    toggleSelectAll,
    toggleRow,
    groupMap,
    openingChatPhone,
    drawerContactId,
    setDrawerContactId,
    drawerDetail,
    setDrawerDetail,
    drawerLoading,
    drawerError,
    savingDrawer,
    loadContacts,
    resetFilters,
    loadContact360,
    handleOpenChat,
    handleSyncSources,
    handleCreateContact,
    handleSaveDrawer,
    handleQuickToggleOptIn,
    handleBulkImport,
    handleExportCsv,
    runBulkAction,
    handlePushToBroadcastList,
    handleCreateGroup,
    handleDeleteGroup,
  };
}
