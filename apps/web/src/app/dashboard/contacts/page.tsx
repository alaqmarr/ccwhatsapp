"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  CheckCircle2,
  Contact2,
  Copy,
  Download,
  FolderPlus,
  IndianRupee,
  Megaphone,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  UserPlus,
  X,
  XCircle,
} from "lucide-react";
import {
  ElementErrorState,
  RightDrawerSkeleton,
  StatCardsSkeleton,
  TableRowsSkeleton,
  WhatsAppLogoIcon,
  formatDateIst,
} from "@cc/ui";

interface ContactGroupItem {
  id: string;
  name: string;
  description: string;
  color: string;
  membersCount: number;
}

interface ContactItem {
  id: string;
  phone: string;
  whatsappName: string;
  name: string;
  email: string;
  companyName: string;
  designation: string;
  organizationType: string;
  city: string;
  state: string;
  country: string;
  gstNumber: string;
  source: string;
  stage: string;
  acrioSegment: string;
  tags: string[];
  groups: string[];
  optInMarketing: boolean;
  optOutReason: string;
  assignedOwnerName: string;
  preferredStaffId?: string | null;
  preferredStaffName?: string;
  lifetimeValueInr: number;
  totalOrdersCount: number;
  totalMessagesCount: number;
  notes: string;
  lastContactedAt: string;
  createdAt: string;
  updatedAt: string;
  conversationId: string | null;
  chatStatus: string | null;
  unreadCount: number;
  windowOpen: boolean;
}

interface Contact360Detail extends Omit<ContactItem, "conversationId" | "chatStatus" | "unreadCount" | "windowOpen" | "totalMessagesCount"> {
  conversation: {
    id: string;
    status: string;
    assignedTo: string;
    unreadCount: number;
    lastMessagePreview: string;
    lastMessageAt: string;
    windowExpiresAt: string | null;
  } | null;
  orders: Array<{
    id: string;
    orderNumber: string;
    itemsSummary: string;
    quantity: number;
    totalAmountInr: number;
    paymentStatus: string;
    fulfillmentStatus: string;
    orderedAt: string;
  }>;
  relations: Array<{
    id: string;
    relationType: string;
    summary: string;
    handledBy: string;
    occurredAt: string;
  }>;
  websiteEnquiries: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    message: string;
    source: string;
    status: string;
    createdAt: string;
  }>;
}

interface ContactsPayload {
  permissions: {
    canManage: boolean;
    canDelete: boolean;
    canManageLists: boolean;
  };
  kpis: {
    totalContacts: number;
    optedInCount: number;
    optedOutCount: number;
    optInRatePct: number;
    customersCount: number;
    repeatAndVipCount: number;
    totalLifetimeValueInr: number;
    withActiveChatCount: number;
  };
  groups: ContactGroupItem[];
  allTags: Array<{ tag: string; count: number }>;
  marketingLists: Array<{ id: string; name: string; membersCount: number }>;
  importLogs: Array<{
    id: string;
    sourceLabel: string;
    importedCount: number;
    updatedCount: number;
    skippedCount: number;
    importedByName: string;
    createdAt: string;
  }>;
  staffList?: Array<{ id: string; name: string; role: string }>;
  contacts: ContactItem[];
}

const STAGE_OPTIONS = [
  { value: "NEW_LEAD", label: "New Lead", badge: "bg-sky-50 text-sky-800 border-sky-200" },
  { value: "QUALIFIED", label: "Qualified", badge: "bg-indigo-50 text-indigo-800 border-indigo-200" },
  { value: "QUOTED", label: "Quote Sent", badge: "bg-amber-50 text-amber-900 border-amber-200" },
  { value: "CUSTOMER", label: "Customer", badge: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  { value: "REPEAT_BUYER", label: "Repeat Buyer", badge: "bg-teal-50 text-teal-900 border-teal-200" },
  { value: "VIP", label: "VIP Account", badge: "bg-purple-50 text-purple-900 border-purple-200" },
  { value: "INACTIVE", label: "Inactive", badge: "bg-slate-100 text-slate-600 border-slate-300" },
] as const;

const ORG_TYPES = [
  "Business",
  "Corporate",
  "Educational",
  "Hospitality",
  "Government",
  "Retail",
  "Dealer / Fabricator",
  "Individual",
];

function stageMeta(stage: string) {
  return (
    STAGE_OPTIONS.find((s) => s.value === stage) || {
      value: stage,
      label: stage.replace(/_/g, " "),
      badge: "bg-slate-100 text-slate-700 border-slate-300",
    }
  );
}

function sourceLabel(src: string): string {
  switch (src) {
    case "WHATSAPP_INBOUND":
      return "WhatsApp Chat";
    case "WEBSITE_ENQUIRY":
      return "Website Enquiry";
    case "CSV_IMPORT":
      return "CSV Import";
    case "ORDER":
      return "Past Order";
    default:
      return "Manual";
  }
}

function formatDateShort(iso?: string | null): string {
  if (!iso) return "Never";
  const formatted = formatDateIst(iso);
  return formatted || "Never";
}

export default function ContactsDatabasePage() {
  const router = useRouter();

  const [data, setData] = useState<ContactsPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [syncingSources, setSyncingSources] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [toast, setToast] = useState<string>("");

  // Filters & Sorting
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [stageFilter, setStageFilter] = useState<string>("ALL");
  const [optInFilter, setOptInFilter] = useState<string>("ALL");
  const [orgFilter, setOrgFilter] = useState<string>("ALL");
  const [sourceFilter, setSourceFilter] = useState<string>("ALL");
  const [groupFilter, setGroupFilter] = useState<string>("ALL");
  const [tagFilter, setTagFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<string>("recent");

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copiedPhone, setCopiedPhone] = useState<string>("");
  const [openingChatPhone, setOpeningChatPhone] = useState<string>("");

  // Group creation
  const [showNewGroupForm, setShowNewGroupForm] = useState<boolean>(false);
  const [newGroupName, setNewGroupName] = useState<string>("");
  const [newGroupDesc, setNewGroupDesc] = useState<string>("");
  const [savingGroup, setSavingGroup] = useState<boolean>(false);

  // Add Contact Modal
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [savingContact, setSavingContact] = useState<boolean>(false);
  const [formError, setFormError] = useState<string>("");
  const [addForm, setAddForm] = useState({
    name: "",
    phone: "+91 ",
    companyName: "",
    designation: "",
    email: "",
    organizationType: "Corporate",
    city: "",
    state: "",
    gstNumber: "",
    stage: "NEW_LEAD",
    tagsText: "",
    groups: [] as string[],
    optInMarketing: true,
    preferredStaffId: "",
    notes: "",
  });

  // CSV / Paste Import Modal
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [csvText, setCsvText] = useState<string>("");
  const [importGroupId, setImportGroupId] = useState<string>("");
  const [importDefaultTag, setImportDefaultTag] = useState<string>("");
  const [importSourceLabel, setImportSourceLabel] = useState<string>("CSV / Sheet Upload");
  const [importing, setImporting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string>("");

  // Push to Broadcast List Modal
  const [showBroadcastListModal, setShowBroadcastListModal] = useState<boolean>(false);
  const [targetListId, setTargetListId] = useState<string>("NEW");
  const [newBroadcastListName, setNewBroadcastListName] = useState<string>("");
  const [pushingToList, setPushingToList] = useState<boolean>(false);

  // Bulk Tag Input
  const [bulkTagDraft, setBulkTagDraft] = useState<string>("");
  const [showBulkTagInput, setShowBulkTagInput] = useState<boolean>(false);

  // Contact 360 Slide-Over Drawer
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
    const timer = setTimeout(() => {
      loadContacts(Boolean(data));
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

  const loadContact360 = useCallback(async (id: string) => {
    setDrawerContactId(id);
    setDrawerLoading(true);
    setDrawerError("");
    try {
      const res = await fetch(`/api/contacts?contactId=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
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

  async function handleOpenChat(contact: {
    phone: string;
    name: string;
    conversationId?: string | null;
  }) {
    if (contact.conversationId) {
      router.push(`/dashboard/inbox?chat=${encodeURIComponent(contact.conversationId)}`);
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
        router.push(`/dashboard/inbox?chat=${encodeURIComponent(json.conversationId)}`);
      } else {
        showNotice(json.error || "Could not open WhatsApp chat.");
      }
    } finally {
      setOpeningChatPhone("");
    }
  }

  async function handleSyncSources() {
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
  }

  async function handleCreateContact(e: React.FormEvent) {
    e.preventDefault();
    setSavingContact(true);
    setFormError("");
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_contact",
          name: addForm.name,
          phone: addForm.phone,
          companyName: addForm.companyName,
          designation: addForm.designation,
          email: addForm.email,
          organizationType: addForm.organizationType,
          city: addForm.city,
          state: addForm.state,
          gstNumber: addForm.gstNumber,
          stage: addForm.stage,
          tags: addForm.tagsText
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          groups: addForm.groups,
          optInMarketing: addForm.optInMarketing,
          preferredStaffId: addForm.preferredStaffId || undefined,
          notes: addForm.notes,
          source: "MANUAL",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setFormError(json.error || "Could not save contact.");
        return;
      }
      setShowAddModal(false);
      setAddForm({
        name: "",
        phone: "+91 ",
        companyName: "",
        designation: "",
        email: "",
        organizationType: "Corporate",
        city: "",
        state: "",
        gstNumber: "",
        stage: "NEW_LEAD",
        tagsText: "",
        groups: [],
        optInMarketing: true,
        preferredStaffId: "",
        notes: "",
      });
      showNotice(json.isNew ? "New contact added to database." : "Existing contact updated.");
      await loadContacts(true);
    } finally {
      setSavingContact(false);
    }
  }

  async function handleSaveDrawer(e: React.FormEvent) {
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
  }

  async function handleQuickToggleOptIn(c: ContactItem) {
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
  }

  async function handleBulkImport(e: React.FormEvent) {
    e.preventDefault();
    setImporting(true);
    setImportError("");
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_import",
          csvText,
          groupId: importGroupId,
          defaultTag: importDefaultTag,
          sourceLabel: importSourceLabel,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setImportError(json.error || "Import failed.");
        return;
      }
      setShowImportModal(false);
      setCsvText("");
      showNotice(
        `Import complete: ${json.importedCount} added, ${json.updatedCount} updated, ${json.skippedCount} skipped.`
      );
      await loadContacts(true);
    } finally {
      setImporting(false);
    }
  }

  function handleCsvFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportSourceLabel(`CSV File: ${file.name}`);
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ""));
    };
    reader.readAsText(file);
  }

  function handleDownloadSampleCsv() {
    const sample = [
      "Name,Phone,Company,Email,City,State,GST,Organization Type,Stage,Preferred Staff,Tags,Notes",
      '"Rajesh Sharma","+919849011223","Taj Deccan Banquets","rajesh@tajbanquets.in","Hyderabad","Telangana","36AABCT1234F1Z5","Hospitality","QUALIFIED","Priya","Podiums|Banquet","Needs 4 clear acrylic podiums"',
      '"Dr. Meenakshi Rao","9848122334","Osmania Auditorium","registrar@uni.edu.in","Secunderabad","Telangana","","Educational","NEW_LEAD","Rahul","Auditorium|Mementos","Enquired about motorized lectern"',
    ].join("\n");
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "classic_concepts_contacts_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportCsv() {
    if (!data) return;
    const rowsToExport =
      selectedIds.length > 0
        ? data.contacts.filter((c) => selectedIds.includes(c.id))
        : data.contacts;

    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      [
        "Name",
        "Phone",
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

    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runBulkAction(payload: Record<string, unknown>, successMsg: string) {
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
  }

  async function handlePushToBroadcastList(e: React.FormEvent) {
    e.preventDefault();
    setPushingToList(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_action",
          subAction: "push_to_marketing_list",
          contactIds: selectedIds,
          listId: targetListId,
          newListName: newBroadcastListName,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setShowBroadcastListModal(false);
        setNewBroadcastListName("");
        showNotice(`Added opted-in contacts (${json.membersCount} total in broadcast list).`);
        await loadContacts(true);
      } else {
        showNotice(json.error || "Could not add contacts to broadcast list.");
      }
    } finally {
      setPushingToList(false);
    }
  }

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setSavingGroup(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_group",
          name: newGroupName,
          description: newGroupDesc,
        }),
      });
      if (res.ok) {
        setNewGroupName("");
        setNewGroupDesc("");
        setShowNewGroupForm(false);
        showNotice("Contact group created.");
        await loadContacts(true);
      }
    } finally {
      setSavingGroup(false);
    }
  }

  async function handleDeleteGroup(groupId: string) {
    await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_group", groupId }),
    });
    if (groupFilter === groupId) setGroupFilter("ALL");
    await loadContacts(true);
  }

  const allVisibleIds = useMemo(
    () => (data?.contacts || []).map((c) => c.id),
    [data?.contacts]
  );
  const allSelected =
    allVisibleIds.length > 0 &&
    allVisibleIds.every((id) => selectedIds.includes(id));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allVisibleIds);
    }
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const groupMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of data?.groups || []) m.set(g.id, g.name);
    return m;
  }, [data?.groups]);

  return (
    <div className="w-full px-6 py-5 space-y-5 bg-neutral-50 text-slate-900">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            <Contact2 className="w-6 h-6 text-[#00a884] shrink-0" />
            <span>Contacts Database</span>
          </h1>
          <p className="text-[13.5px] leading-relaxed text-slate-500 mt-1">
            Central WhatsApp customer directory synced across Customer Chats, Broadcast Queue, CRM Orders, and Website Enquiries.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {toast && (
            <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
              {toast}
            </div>
          )}

          <button
            type="button"
            onClick={handleSyncSources}
            disabled={syncingSources}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-slate-50 border border-neutral-300 text-xs font-semibold text-slate-700 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-[#00a884] ${
                syncingSources ? "animate-spin" : ""
              }`}
            />
            <span>
              {syncingSources ? "Syncing..." : "Sync Chats & Website"}
            </span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!data || data.contacts.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-slate-50 border border-neutral-300 text-xs font-semibold text-slate-700 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {selectedIds.length > 0
                ? `Export (${selectedIds.length})`
                : "Export CSV"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-slate-50 border border-neutral-300 text-xs font-semibold text-slate-800 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-indigo-600" />
            <span>Import CSV / Paste</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold shadow-2xs cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add Contact</span>
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <ElementErrorState
          title="Could not load Contacts Database"
          message={error}
          onRetry={() => loadContacts(false)}
          retrying={loading || refreshing}
        />
      )}

      {/* KPI Row */}
      {loading && !data ? (
        <StatCardsSkeleton count={4} />
      ) : data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-1.5 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
              <span>Total Contacts</span>
              <Contact2 className="w-4 h-4 text-[#00a884]" />
            </div>
            <div className="metric-value text-[28px] font-bold text-slate-900">
              {data.kpis.totalContacts}
            </div>
            <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
              <span>{data.kpis.withActiveChatCount} with chat thread</span>
              <span className="text-slate-600 font-medium">
                Showing {data.contacts.length}
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-1.5 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
              <span>Broadcast Opted-In</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="metric-value text-[28px] font-bold text-slate-900">
              {data.kpis.optedInCount}{" "}
              <span className="font-sans text-xs font-semibold tracking-normal text-emerald-700">
                ({data.kpis.optInRatePct}%)
              </span>
            </div>
            <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
              <span>Safe for WhatsApp templates</span>
              <span className="text-red-700 font-medium">
                {data.kpis.optedOutCount} opted out
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-1.5 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
              <span>Buyers & Repeat Accounts</span>
              <Sparkles className="w-4 h-4 text-purple-600" />
            </div>
            <div className="metric-value text-[28px] font-bold text-slate-900">
              {data.kpis.customersCount}
            </div>
            <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
              <span>Ordering customers</span>
              <span className="text-purple-700 font-semibold">
                {data.kpis.repeatAndVipCount} Repeat / VIP
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-neutral-200/90 p-4 space-y-1.5 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
              <span>Recorded Order Value</span>
              <IndianRupee className="w-4 h-4 text-emerald-700" />
            </div>
            <div className="metric-value text-[28px] font-bold text-slate-900">
              ₹{data.kpis.totalLifetimeValueInr.toLocaleString("en-IN")}
            </div>
            <div className="text-xs text-slate-500 flex items-center justify-between tabular-nums">
              <span>Synced with CRM Orders</span>
              <span className="text-emerald-700 font-medium">
                {data.groups.length} groups
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Main 2-Pane Directory */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Sidebar: Quick Segments, Contact Groups, Popular Tags & Import History */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white rounded-xl border border-neutral-200/90 p-3.5 space-y-3 shadow-2xs">
            <div className="eyebrow-label text-slate-400 px-1">Quick Views</div>
            <div className="space-y-0.5 text-[13px]">
              {[
                {
                  id: "ALL",
                  label: "All Contacts",
                  count: data?.kpis.totalContacts ?? 0,
                  active:
                    optInFilter === "ALL" &&
                    stageFilter === "ALL" &&
                    groupFilter === "ALL" &&
                    tagFilter === "ALL",
                  onClick: () => {
                    setOptInFilter("ALL");
                    setStageFilter("ALL");
                    setGroupFilter("ALL");
                    setTagFilter("ALL");
                  },
                },
                {
                  id: "OPTED_IN",
                  label: "Broadcast Opted-In",
                  count: data?.kpis.optedInCount ?? 0,
                  active: optInFilter === "OPTED_IN",
                  onClick: () => {
                    setOptInFilter("OPTED_IN");
                    setStageFilter("ALL");
                  },
                },
                {
                  id: "OPTED_OUT",
                  label: "Opted-Out (DND)",
                  count: data?.kpis.optedOutCount ?? 0,
                  active: optInFilter === "OPTED_OUT",
                  onClick: () => {
                    setOptInFilter("OPTED_OUT");
                    setStageFilter("ALL");
                  },
                },
                {
                  id: "BUYERS",
                  label: "Customers & VIPs",
                  count: data?.kpis.customersCount ?? 0,
                  active: stageFilter === "BUYERS_ALL",
                  onClick: () => {
                    setStageFilter("BUYERS_ALL");
                    setOptInFilter("ALL");
                  },
                },
              ].map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={v.onClick}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                    v.active
                      ? "bg-[#e7fce3] text-[#008069] font-semibold"
                      : "text-slate-700 hover:bg-slate-100 font-medium"
                  }`}
                >
                  <span>{v.label}</span>
                  <span className="text-xs tabular-nums opacity-80">{v.count}</span>
                </button>
              ))}
            </div>

            <div className="pt-2 border-t border-neutral-200 space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="eyebrow-label text-slate-400">Contact Groups</span>
                <button
                  type="button"
                  onClick={() => setShowNewGroupForm((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#008069] hover:underline cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>New</span>
                </button>
              </div>

              {showNewGroupForm && (
                <form
                  onSubmit={handleCreateGroup}
                  className="p-2.5 rounded-lg bg-slate-50 border border-neutral-200 space-y-2"
                >
                  <input
                    type="text"
                    required
                    placeholder="Group name (e.g. Architects)"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-md border border-neutral-300 bg-white text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Short note (optional)"
                    value={newGroupDesc}
                    onChange={(e) => setNewGroupDesc(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-md border border-neutral-300 bg-white text-xs"
                  />
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowNewGroupForm(false)}
                      className="px-2 py-1 text-xs text-slate-600 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingGroup}
                      className="px-2.5 py-1 rounded-md bg-[#00a884] text-white text-xs font-semibold cursor-pointer"
                    >
                      Save Group
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-0.5 text-[13px]">
                {(data?.groups || []).map((g) => {
                  const active = groupFilter === g.id;
                  const isSystem = ["grp_vip", "grp_edu", "grp_corp", "grp_machines"].includes(
                    g.id
                  );
                  return (
                    <div
                      key={g.id}
                      className={`group flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg transition-colors ${
                        active
                          ? "bg-[#00a884] text-white font-semibold"
                          : "text-slate-700 hover:bg-slate-100 font-medium"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setGroupFilter(active ? "ALL" : g.id)
                        }
                        className="flex-1 text-left truncate cursor-pointer"
                        title={g.description || g.name}
                      >
                        {g.name}
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs tabular-nums opacity-80">
                          {g.membersCount}
                        </span>
                        {!isSystem && (
                          <button
                            type="button"
                            onClick={() => handleDeleteGroup(g.id)}
                            title="Remove group"
                            className={`opacity-0 group-hover:opacity-100 p-0.5 rounded cursor-pointer ${
                              active ? "hover:bg-white/20" : "hover:bg-red-50 text-red-600"
                            }`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {data && data.allTags.length > 0 && (
              <div className="pt-2 border-t border-neutral-200 space-y-2">
                <div className="eyebrow-label text-slate-400 px-1">Tags</div>
                <div className="flex flex-wrap gap-1.5 px-0.5">
                  {data.allTags.slice(0, 18).map((t) => {
                    const active = tagFilter === t.tag;
                    return (
                      <button
                        key={t.tag}
                        type="button"
                        onClick={() => setTagFilter(active ? "ALL" : t.tag)}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border cursor-pointer transition-colors ${
                          active
                            ? "bg-slate-900 text-white border-slate-900"
                            : "bg-slate-50 text-slate-700 border-neutral-200 hover:bg-slate-100"
                        }`}
                      >
                        #{t.tag} ({t.count})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {data && data.importLogs.length > 0 && (
            <div className="bg-white rounded-xl border border-neutral-200/90 p-3.5 space-y-2.5 shadow-2xs">
              <div className="eyebrow-label text-slate-400">Recent Imports & Syncs</div>
              <div className="space-y-2">
                {data.importLogs.slice(0, 4).map((log) => (
                  <div
                    key={log.id}
                    className="p-2 rounded-lg bg-slate-50 border border-neutral-200/80 text-xs space-y-0.5"
                  >
                    <div className="font-semibold text-slate-800 truncate">
                      {log.sourceLabel}
                    </div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      +{log.importedCount} new • {log.updatedCount} updated
                    </div>
                    <div className="text-[10.5px] text-slate-400">
                      {log.importedByName} • {formatDateShort(log.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Main Table Area */}
        <div className="lg:col-span-9 bg-white rounded-xl border border-neutral-200/90 shadow-2xs overflow-hidden">
          {/* Search & Filter Toolbar */}
          <div className="p-3.5 border-b border-neutral-200 flex flex-wrap items-center gap-2.5 bg-white">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, +91 phone, company, GST, city, email, or tag..."
                className="w-full pl-9 pr-8 py-2 rounded-lg border border-neutral-300 text-[13px] bg-neutral-50/60 focus:bg-white focus:outline-none focus:border-[#00a884]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="px-2.5 py-2 rounded-lg border border-neutral-300 bg-white text-xs font-medium text-slate-700"
            >
              <option value="ALL">All Stages</option>
              <option value="BUYERS_ALL">All Paying Customers</option>
              {STAGE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>

            <select
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              className="px-2.5 py-2 rounded-lg border border-neutral-300 bg-white text-xs font-medium text-slate-700"
            >
              <option value="ALL">All Org Types</option>
              {ORG_TYPES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>

            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="px-2.5 py-2 rounded-lg border border-neutral-300 bg-white text-xs font-medium text-slate-700"
            >
              <option value="ALL">All Sources</option>
              <option value="WHATSAPP_INBOUND">WhatsApp Chat</option>
              <option value="WEBSITE_ENQUIRY">Website Enquiry</option>
              <option value="CSV_IMPORT">CSV Import</option>
              <option value="ORDER">Past Order</option>
              <option value="MANUAL">Manual</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-2.5 py-2 rounded-lg border border-neutral-300 bg-white text-xs font-medium text-slate-700"
            >
              <option value="recent">Sort: Recent Activity</option>
              <option value="name">Sort: Name (A to Z)</option>
              <option value="ltv">Sort: Highest Order Value</option>
              <option value="orders">Sort: Most Orders</option>
              <option value="created">Sort: Newest Added</option>
            </select>
          </div>

          {/* Multi-Select Bulk Action Bar */}
          {selectedIds.length > 0 && data && (
            <div className="px-4 py-2.5 bg-emerald-50/90 border-b border-emerald-200 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-950">
                <span className="px-2 py-0.5 rounded-md bg-[#00a884] text-white tabular-nums">
                  {selectedIds.length}
                </span>
                <span>selected</span>
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="text-emerald-800 underline ml-1 cursor-pointer"
                >
                  Clear
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {showBulkTagInput ? (
                  <div className="inline-flex items-center gap-1 bg-white rounded-md border border-emerald-300 px-2 py-1">
                    <input
                      type="text"
                      placeholder="Tag name..."
                      value={bulkTagDraft}
                      onChange={(e) => setBulkTagDraft(e.target.value)}
                      className="text-xs w-28 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (bulkTagDraft.trim()) {
                          runBulkAction(
                            { subAction: "add_tag", tag: bulkTagDraft.trim() },
                            `Added tag #${bulkTagDraft.trim()} to ${selectedIds.length} contacts.`
                          );
                          setBulkTagDraft("");
                          setShowBulkTagInput(false);
                        }
                      }}
                      className="text-xs font-semibold text-[#008069] cursor-pointer"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBulkTagInput(false)}
                      className="text-slate-400 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowBulkTagInput(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white border border-neutral-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <Tag className="w-3 h-3" />
                    <span>Add Tag</span>
                  </button>
                )}

                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      runBulkAction(
                        { subAction: "set_stage", stage: e.target.value },
                        `Updated stage for ${selectedIds.length} contacts.`
                      );
                      e.target.value = "";
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-md bg-white border border-neutral-300 text-xs font-semibold text-slate-700"
                >
                  <option value="">Set Stage...</option>
                  {STAGE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>

                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      runBulkAction(
                        { subAction: "add_to_group", groupId: e.target.value },
                        `Added ${selectedIds.length} contacts to group.`
                      );
                      e.target.value = "";
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-md bg-white border border-neutral-300 text-xs font-semibold text-slate-700"
                >
                  <option value="">Add to Group...</option>
                  {data.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>

                {data.permissions.canManageLists && (
                  <button
                    type="button"
                    onClick={() => setShowBroadcastListModal(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer"
                  >
                    <Megaphone className="w-3.5 h-3.5" />
                    <span>Add to Broadcast List</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    runBulkAction(
                      { subAction: "set_opt_in", optIn: true },
                      `Marked ${selectedIds.length} contacts opted-in.`
                    )
                  }
                  className="px-2.5 py-1.5 rounded-md bg-white border border-neutral-300 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 cursor-pointer"
                >
                  Opt In
                </button>

                <button
                  type="button"
                  onClick={() =>
                    runBulkAction(
                      { subAction: "set_opt_in", optIn: false },
                      `Marked ${selectedIds.length} contacts opted-out.`
                    )
                  }
                  className="px-2.5 py-1.5 rounded-md bg-white border border-neutral-300 text-xs font-semibold text-amber-800 hover:bg-amber-50 cursor-pointer"
                >
                  Opt Out
                </button>

                {data.permissions.canDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete ${selectedIds.length} selected contact(s) from the Contacts Database?`
                        )
                      ) {
                        runBulkAction(
                          { subAction: "delete" },
                          `Deleted ${selectedIds.length} contact(s).`
                        );
                      }
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white border border-red-300 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Delete</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Contacts Table */}
          {loading && !data ? (
            <div className="p-4">
              <TableRowsSkeleton rows={8} columns={6} />
            </div>
          ) : data && data.contacts.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 text-[#00a884] flex items-center justify-center">
                <Contact2 className="w-6 h-6" />
              </div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                No matching contacts found
              </h2>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Try clearing a filter, add a contact manually, upload a CSV sheet, or sync existing chats and website enquiries.
              </p>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setStageFilter("ALL");
                    setOptInFilter("ALL");
                    setOrgFilter("ALL");
                    setSourceFilter("ALL");
                    setGroupFilter("ALL");
                    setTagFilter("ALL");
                  }}
                  className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Reset Filters
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(true)}
                  className="px-3.5 py-1.5 rounded-lg bg-[#00a884] text-white text-xs font-semibold cursor-pointer"
                >
                  Add First Contact
                </button>
              </div>
            </div>
          ) : data ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-neutral-200 text-slate-500">
                    <th className="py-3 pl-4 pr-2 w-9">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-neutral-300 accent-[#00a884] cursor-pointer"
                      />
                    </th>
                    <th className="py-3 px-3">Contact & Stage</th>
                    <th className="py-3 px-3">WhatsApp Number</th>
                    <th className="py-3 px-3">Company & City</th>
                    <th className="py-3 px-3">Broadcast Status</th>
                    <th className="py-3 px-3 text-right">Orders & Value</th>
                    <th className="py-3 px-3">Source & Activity</th>
                    <th className="py-3 pl-3 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200/80 text-[13px]">
                  {data.contacts.map((c) => {
                    const st = stageMeta(c.stage);
                    const checked = selectedIds.includes(c.id);
                    return (
                      <tr
                        key={c.id}
                        className={`transition-colors ${
                          checked ? "bg-emerald-50/40" : "hover:bg-slate-50/80"
                        }`}
                      >
                        <td className="py-3 pl-4 pr-2 align-top pt-4">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleRow(c.id)}
                            className="rounded border-neutral-300 accent-[#00a884] cursor-pointer"
                          />
                        </td>

                        <td className="py-3 px-3 align-top">
                          <button
                            type="button"
                            onClick={() => loadContact360(c.id)}
                            className="text-left group cursor-pointer"
                          >
                            <div className="font-semibold text-slate-900 group-hover:text-[#008069] flex items-center gap-1.5">
                              <span>{c.name}</span>
                              {c.unreadCount > 0 && (
                                <span className="px-1.5 py-0.2 rounded-full bg-[#25d366] text-white text-[10px] font-bold">
                                  {c.unreadCount} new
                                </span>
                              )}
                            </div>
                          </button>

                          <div className="flex flex-wrap items-center gap-1 mt-1">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-[0.04em] border ${st.badge}`}
                            >
                              {st.label}
                            </span>
                            {c.groups.slice(0, 2).map((gid) =>
                              groupMap.get(gid) ? (
                                <span
                                  key={gid}
                                  className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium"
                                >
                                  {groupMap.get(gid)}
                                </span>
                              ) : null
                            )}
                            {c.tags.slice(0, 3).map((t) => (
                              <span
                                key={t}
                                className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 text-[10px] font-medium"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top">
                          <div className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-slate-800">
                            <span>{c.phone}</span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(c.phone);
                                setCopiedPhone(c.phone);
                                setTimeout(() => setCopiedPhone(""), 1500);
                              }}
                              title="Copy phone number"
                              className="p-1 rounded hover:bg-slate-200/70 text-slate-400 hover:text-slate-700 cursor-pointer"
                            >
                              {copiedPhone === c.phone ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                          {c.email && (
                            <div className="text-[11.5px] text-slate-500 truncate max-w-[190px] mt-0.5">
                              {c.email}
                            </div>
                          )}
                          {c.windowOpen && (
                            <div className="text-[10.5px] font-semibold text-[#008069] mt-0.5">
                              24h Chat Window Open
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 align-top">
                          <div className="font-medium text-slate-800">
                            {c.companyName || (
                              <span className="text-slate-400 font-normal">
                                Individual / Unspecified
                              </span>
                            )}
                          </div>
                          <div className="text-[11.5px] text-slate-500 flex flex-wrap items-center gap-1 mt-0.5">
                            <span>{c.organizationType}</span>
                            {c.city && <span>• {c.city}</span>}
                          </div>
                          {c.gstNumber && (
                            <div className="font-mono text-[10.5px] text-slate-500 mt-0.5">
                              GST: {c.gstNumber}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 align-top">
                          <button
                            type="button"
                            onClick={() => handleQuickToggleOptIn(c)}
                            title="Click to toggle broadcast opt-in"
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border cursor-pointer transition-colors ${
                              c.optInMarketing
                                ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                                : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                            }`}
                          >
                            {c.optInMarketing ? (
                              <>
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Opted In</span>
                              </>
                            ) : (
                              <>
                                <XCircle className="w-3 h-3" />
                                <span>Opted Out</span>
                              </>
                            )}
                          </button>
                        </td>

                        <td className="py-3 px-3 align-top text-right">
                          <div className="font-semibold text-slate-900">
                            ₹{c.lifetimeValueInr.toLocaleString("en-IN")}
                          </div>
                          <div className="text-[11.5px] text-slate-500">
                            {c.totalOrdersCount} orders • {c.totalMessagesCount} msgs
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top">
                          <div className="text-xs font-medium text-slate-700">
                            {sourceLabel(c.source)}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {formatDateShort(c.lastContactedAt)}
                          </div>
                        </td>

                        <td className="py-3 pl-3 pr-4 align-top text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={openingChatPhone === c.phone}
                              onClick={() => handleOpenChat(c)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#e7fce3] hover:bg-[#d3f8cc] text-[#008069] text-xs font-semibold cursor-pointer disabled:opacity-60"
                            >
                              <WhatsAppLogoIcon size={13} />
                              <span>Chat</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => loadContact360(c.id)}
                              className="px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                            >
                              360 / Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* ADD CONTACT MODAL                                                     */}
      {/* ===================================================================== */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-neutral-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Add New WhatsApp Contact
                </h2>
                <p className="text-xs text-slate-500">
                  Saved to Contacts Database and synced automatically with Chats and Broadcast Queue.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateContact} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={addForm.name}
                    onChange={(e) =>
                      setAddForm({ ...addForm, name: e.target.value })
                    }
                    placeholder="e.g. Anand Vardhan"
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    WhatsApp Phone Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={addForm.phone}
                    onChange={(e) =>
                      setAddForm({ ...addForm, phone: e.target.value })
                    }
                    placeholder="+91 98490 12345"
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Company / Institution
                  </label>
                  <input
                    type="text"
                    value={addForm.companyName}
                    onChange={(e) =>
                      setAddForm({ ...addForm, companyName: e.target.value })
                    }
                    placeholder="e.g. Novotel Convention Centre"
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Role / Designation
                  </label>
                  <input
                    type="text"
                    value={addForm.designation}
                    onChange={(e) =>
                      setAddForm({ ...addForm, designation: e.target.value })
                    }
                    placeholder="e.g. Procurement Head"
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={addForm.email}
                    onChange={(e) =>
                      setAddForm({ ...addForm, email: e.target.value })
                    }
                    placeholder="buyer@company.com"
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    GST Number (Optional)
                  </label>
                  <input
                    type="text"
                    value={addForm.gstNumber}
                    onChange={(e) =>
                      setAddForm({ ...addForm, gstNumber: e.target.value })
                    }
                    placeholder="36AAAAA0000A1Z5"
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 font-mono text-sm uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Organization Type
                  </label>
                  <select
                    value={addForm.organizationType}
                    onChange={(e) =>
                      setAddForm({ ...addForm, organizationType: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm bg-white"
                  >
                    {ORG_TYPES.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Lead / Customer Stage
                  </label>
                  <select
                    value={addForm.stage}
                    onChange={(e) =>
                      setAddForm({ ...addForm, stage: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm bg-white"
                  >
                    {STAGE_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    value={addForm.city}
                    onChange={(e) =>
                      setAddForm({ ...addForm, city: e.target.value })
                    }
                    placeholder="Hyderabad"
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    State
                  </label>
                  <input
                    type="text"
                    value={addForm.state}
                    onChange={(e) =>
                      setAddForm({ ...addForm, state: e.target.value })
                    }
                    placeholder="Telangana"
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  value={addForm.tagsText}
                  onChange={(e) =>
                    setAddForm({ ...addForm, tagsText: e.target.value })
                  }
                  placeholder="Podiums, Bulk Enquiry, Hyderabad"
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                />
              </div>

              {data && data.groups.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Assign to Contact Groups
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {data.groups.map((g) => {
                      const active = addForm.groups.includes(g.id);
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() =>
                            setAddForm((prev) => ({
                              ...prev,
                              groups: active
                                ? prev.groups.filter((x) => x !== g.id)
                                : [...prev.groups, g.id],
                            }))
                          }
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${
                            active
                              ? "bg-[#00a884] text-white border-[#00a884]"
                              : "bg-slate-50 text-slate-700 border-neutral-300"
                          }`}
                        >
                          {g.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Preferred Staff Member (Sticky Auto-Assignment)
                </label>
                <select
                  value={addForm.preferredStaffId}
                  onChange={(e) =>
                    setAddForm({ ...addForm, preferredStaffId: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm bg-white"
                >
                  <option value="">No preference (use normal routing)</option>
                  {(data?.staffList || []).map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name} ({st.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Internal Notes
                </label>
                <textarea
                  rows={2}
                  value={addForm.notes}
                  onChange={(e) =>
                    setAddForm({ ...addForm, notes: e.target.value })
                  }
                  placeholder="Product preferences, custom sizes, or delivery notes..."
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addForm.optInMarketing}
                  onChange={(e) =>
                    setAddForm({ ...addForm, optInMarketing: e.target.checked })
                  }
                  className="rounded accent-[#00a884]"
                />
                <span>
                  Opted in to receive WhatsApp broadcast & promotional templates
                </span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg border border-neutral-300 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingContact}
                  className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  {savingContact ? "Saving..." : "Save Contact"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* CSV / EXCEL PASTE IMPORT MODAL                                        */}
      {/* ===================================================================== */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-neutral-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Bulk Import Contacts (CSV or Copy-Paste from Excel)
                </h2>
                <p className="text-xs text-slate-500">
                  10-digit Indian mobile numbers are formatted to +91 automatically, and duplicate phone numbers are merged cleanly.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleBulkImport} className="p-6 space-y-4">
              {importError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                  {importError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-neutral-200">
                <div className="text-xs text-slate-600">
                  Upload a <code>.csv</code> file or download the sample sheet format first.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadSampleCsv}
                    className="px-2.5 py-1.5 rounded-lg bg-white border border-neutral-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    Download Sample CSV
                  </button>
                  <label className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer">
                    Choose CSV File
                    <input
                      type="file"
                      accept=".csv,.txt,.tsv"
                      onChange={handleCsvFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Paste CSV or Excel Rows (Name, Phone, Company, Email, City, Preferred Staff, Tags...)
                </label>
                <textarea
                  rows={7}
                  required
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={`Name,Phone,Company,Email,City,Preferred Staff,Tags\nRajesh Sharma,9849011223,Taj Banquets,rajesh@taj.in,Hyderabad,Priya,Podiums`}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 font-mono text-xs leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Add Imported Contacts to Group (Optional)
                  </label>
                  <select
                    value={importGroupId}
                    onChange={(e) => setImportGroupId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-xs bg-white"
                  >
                    <option value="">No specific group</option>
                    {(data?.groups || []).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Apply Tag to All Imported Rows (Optional)
                  </label>
                  <input
                    type="text"
                    value={importDefaultTag}
                    onChange={(e) => setImportDefaultTag(e.target.value)}
                    placeholder="e.g. Expo2026"
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-200">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 rounded-lg border border-neutral-300 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={importing}
                  className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  {importing ? "Importing Contacts..." : "Import Contacts"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* PUSH SELECTION TO BROADCAST LIST MODAL                                */}
      {/* ===================================================================== */}
      {showBroadcastListModal && data && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-neutral-200 w-full max-w-md shadow-xl">
            <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900">
                Send {selectedIds.length} Selected Contacts to Broadcast List
              </h2>
              <button
                type="button"
                onClick={() => setShowBroadcastListModal(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handlePushToBroadcastList} className="p-5 space-y-4">
              <p className="text-xs text-slate-500">
                Only contacts marked <strong>Opted In</strong> are added so your WhatsApp number stays protected.
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Destination Broadcast List
                </label>
                <select
                  value={targetListId}
                  onChange={(e) => setTargetListId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm bg-white"
                >
                  <option value="NEW">+ Create a New Broadcast List</option>
                  {data.marketingLists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.membersCount} contacts)
                    </option>
                  ))}
                </select>
              </div>

              {targetListId === "NEW" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    New Broadcast List Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newBroadcastListName}
                    onChange={(e) => setNewBroadcastListName(e.target.value)}
                    placeholder="e.g. Hyderabad Banquet Buyers"
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBroadcastListModal(false)}
                  className="px-3.5 py-2 rounded-lg border border-neutral-300 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pushingToList}
                  className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer"
                >
                  {pushingToList ? "Saving..." : "Save to Broadcast List"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* CONTACT 360 & EDIT SLIDE-OVER DRAWER                                  */}
      {/* ===================================================================== */}
      {drawerContactId && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl border-l border-neutral-200 flex flex-col">
            <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  {drawerDetail ? drawerDetail.name : "Contact 360 Profile"}
                </h2>
                {drawerDetail && (
                  <p className="font-mono text-xs text-slate-500">
                    {drawerDetail.phone}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {drawerDetail && (
                  <button
                    type="button"
                    onClick={() =>
                      handleOpenChat({
                        phone: drawerDetail.phone,
                        name: drawerDetail.name,
                        conversationId: drawerDetail.conversation?.id,
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#25d366] hover:bg-[#1ebe5d] text-white text-xs font-semibold cursor-pointer"
                  >
                    <WhatsAppLogoIcon size={13} />
                    <span>Open Chat</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setDrawerContactId(null);
                    setDrawerDetail(null);
                  }}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-6 flex-1">
              {drawerLoading ? (
                <RightDrawerSkeleton />
              ) : drawerError ? (
                <ElementErrorState
                  title="Could not load Contact 360"
                  message={drawerError}
                  onRetry={() => loadContact360(drawerContactId)}
                />
              ) : drawerDetail ? (
                <>
                  {/* Quick Summary Strip */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl bg-slate-50 border border-neutral-200">
                      <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-500">
                        Total Orders
                      </div>
                      <div className="metric-value text-xl font-bold text-slate-900 mt-1">
                        {drawerDetail.totalOrdersCount}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-neutral-200">
                      <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-500">
                        Order Value
                      </div>
                      <div className="metric-value text-xl font-bold text-slate-900 mt-1">
                        ₹{drawerDetail.lifetimeValueInr.toLocaleString("en-IN")}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-neutral-200">
                      <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-500">
                        Chat Status
                      </div>
                      <div className="text-xs font-bold text-slate-800 mt-1.5 truncate">
                        {drawerDetail.conversation
                          ? `${drawerDetail.conversation.status} (${drawerDetail.conversation.assignedTo})`
                          : "No thread yet"}
                      </div>
                    </div>
                  </div>

                  {/* Editable Contact Form */}
                  <form onSubmit={handleSaveDrawer} className="space-y-4">
                    <div className="eyebrow-label text-slate-400">
                      Contact Details
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Full Name
                        </label>
                        <input
                          type="text"
                          required
                          value={drawerDetail.name}
                          onChange={(e) =>
                            setDrawerDetail({
                              ...drawerDetail,
                              name: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Email
                        </label>
                        <input
                          type="email"
                          value={drawerDetail.email}
                          onChange={(e) =>
                            setDrawerDetail({
                              ...drawerDetail,
                              email: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Company / Organization
                        </label>
                        <input
                          type="text"
                          value={drawerDetail.companyName}
                          onChange={(e) =>
                            setDrawerDetail({
                              ...drawerDetail,
                              companyName: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Designation
                        </label>
                        <input
                          type="text"
                          value={drawerDetail.designation}
                          onChange={(e) =>
                            setDrawerDetail({
                              ...drawerDetail,
                              designation: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Organization Type
                        </label>
                        <select
                          value={drawerDetail.organizationType}
                          onChange={(e) =>
                            setDrawerDetail({
                              ...drawerDetail,
                              organizationType: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm bg-white"
                        >
                          {ORG_TYPES.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Stage
                        </label>
                        <select
                          value={drawerDetail.stage}
                          onChange={(e) =>
                            setDrawerDetail({
                              ...drawerDetail,
                              stage: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm bg-white"
                        >
                          {STAGE_OPTIONS.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          City
                        </label>
                        <input
                          type="text"
                          value={drawerDetail.city}
                          onChange={(e) =>
                            setDrawerDetail({
                              ...drawerDetail,
                              city: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          State
                        </label>
                        <input
                          type="text"
                          value={drawerDetail.state}
                          onChange={(e) =>
                            setDrawerDetail({
                              ...drawerDetail,
                              state: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          GST Number
                        </label>
                        <input
                          type="text"
                          value={drawerDetail.gstNumber}
                          onChange={(e) =>
                            setDrawerDetail({
                              ...drawerDetail,
                              gstNumber: e.target.value.toUpperCase(),
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-neutral-300 font-mono text-sm uppercase"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Preferred Staff Member (Sticky Auto-Assignment)
                        </label>
                        <select
                          value={drawerDetail.preferredStaffId || ""}
                          onChange={(e) => {
                            const sid = e.target.value;
                            const st = (data?.staffList || []).find((s) => s.id === sid);
                            setDrawerDetail({
                              ...drawerDetail,
                              preferredStaffId: sid || null,
                              preferredStaffName: st?.name || "",
                            });
                          }}
                          className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm bg-white"
                        >
                          <option value="">No preference (use normal routing)</option>
                          {(data?.staffList || []).map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.name} ({st.role})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Tags (comma separated)
                      </label>
                      <input
                        type="text"
                        value={drawerDetail.tags.join(", ")}
                        onChange={(e) =>
                          setDrawerDetail({
                            ...drawerDetail,
                            tags: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                      />
                    </div>

                    {data && data.groups.length > 0 && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Contact Groups
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {data.groups.map((g) => {
                            const active = drawerDetail.groups.includes(g.id);
                            return (
                              <button
                                key={g.id}
                                type="button"
                                onClick={() =>
                                  setDrawerDetail({
                                    ...drawerDetail,
                                    groups: active
                                      ? drawerDetail.groups.filter((x) => x !== g.id)
                                      : [...drawerDetail.groups, g.id],
                                  })
                                }
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${
                                  active
                                    ? "bg-[#00a884] text-white border-[#00a884]"
                                    : "bg-slate-50 text-slate-700 border-neutral-300"
                                }`}
                              >
                                {g.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Notes
                      </label>
                      <textarea
                        rows={3}
                        value={drawerDetail.notes}
                        onChange={(e) =>
                          setDrawerDetail({
                            ...drawerDetail,
                            notes: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm"
                      />
                    </div>

                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={drawerDetail.optInMarketing}
                        onChange={(e) =>
                          setDrawerDetail({
                            ...drawerDetail,
                            optInMarketing: e.target.checked,
                          })
                        }
                        className="rounded accent-[#00a884]"
                      />
                      <span>Subscribed to WhatsApp broadcast templates</span>
                    </label>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={savingDrawer}
                        className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                      >
                        {savingDrawer ? "Saving..." : "Save Changes"}
                      </button>
                    </div>
                  </form>

                  {/* Past Orders */}
                  <div className="pt-4 border-t border-neutral-200 space-y-2.5">
                    <div className="eyebrow-label text-slate-400">
                      Orders ({drawerDetail.orders.length})
                    </div>
                    {drawerDetail.orders.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        No orders recorded for this contact yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {drawerDetail.orders.map((o) => (
                          <div
                            key={o.id}
                            className="p-3 rounded-xl bg-slate-50 border border-neutral-200 flex items-center justify-between gap-3 text-xs"
                          >
                            <div>
                              <div className="font-mono font-semibold text-slate-900">
                                {o.orderNumber}
                              </div>
                              <div className="text-slate-600 mt-0.5">
                                {o.itemsSummary} (Qty: {o.quantity})
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                {formatDateShort(o.orderedAt)} • {o.fulfillmentStatus}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-display text-sm font-bold text-slate-900 tabular-nums">
                                ₹{o.totalAmountInr.toLocaleString("en-IN")}
                              </div>
                              <div className="text-[10.5px] font-semibold text-emerald-700">
                                {o.paymentStatus}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Website Enquiries */}
                  {drawerDetail.websiteEnquiries.length > 0 && (
                    <div className="pt-4 border-t border-neutral-200 space-y-2.5">
                      <div className="eyebrow-label text-slate-400">
                        Website Enquiries ({drawerDetail.websiteEnquiries.length})
                      </div>
                      <div className="space-y-2">
                        {drawerDetail.websiteEnquiries.map((eq) => (
                          <div
                            key={eq.id}
                            className="p-3 rounded-xl bg-amber-50/50 border border-amber-200 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between font-semibold text-amber-950">
                              <span>{eq.source}</span>
                              <span>{formatDateShort(eq.createdAt)}</span>
                            </div>
                            <p className="text-slate-700 leading-relaxed">
                              {eq.message}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
