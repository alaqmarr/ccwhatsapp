"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { Contact2, Download, RefreshCw, Upload, UserPlus } from "lucide-react";
import { ElementErrorState } from "@cc/ui";
import type { ContactsPayload } from "./types";
import { useContactsWorkspace } from "./hooks/useContactsWorkspace";
import { ContactsKpiRow } from "./components/ContactsKpiRow";
import { ContactFiltersBar } from "./components/ContactFiltersBar";
import { VirtualizedContactList } from "./components/VirtualizedContactList";
import { ContactGroupsSidebar } from "./components/GroupsModal";

const AddContactModal = dynamic(
  () =>
    import("./components/AddContactModal").then((m) => m.AddContactModal),
  { ssr: false }
);

const CsvImportModal = dynamic(
  () => import("./components/CsvImportModal").then((m) => m.CsvImportModal),
  { ssr: false }
);

const GroupsModal = dynamic(
  () => import("./components/GroupsModal").then((m) => m.GroupsModal),
  { ssr: false }
);

const ContactDetailDrawer = dynamic(
  () =>
    import("./components/ContactDetailDrawer").then(
      (m) => m.ContactDetailDrawer
    ),
  { ssr: false }
);

export function ContactsClient({
  initialData,
}: {
  initialData?: ContactsPayload;
}) {
  const ws = useContactsWorkspace(initialData);

  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [showBroadcastListModal, setShowBroadcastListModal] =
    useState<boolean>(false);

  return (
    <div className="w-full px-3.5 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-5 bg-neutral-50 text-slate-900">
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
          {ws.toast && (
            <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
              {ws.toast}
            </div>
          )}

          <button
            type="button"
            onClick={() => void ws.handleSyncSources()}
            disabled={ws.syncingSources}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-slate-50 border border-neutral-300 text-xs font-semibold text-slate-700 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-[#00a884] ${
                ws.syncingSources ? "animate-spin" : ""
              }`}
            />
            <span>
              {ws.syncingSources ? "Syncing..." : "Sync Chats & Website"}
            </span>
          </button>

          <button
            type="button"
            onClick={ws.handleExportCsv}
            disabled={!ws.data || ws.data.contacts.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white hover:bg-slate-50 border border-neutral-300 text-xs font-semibold text-slate-700 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {ws.selectedIds.length > 0
                ? `Export (${ws.selectedIds.length})`
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

      {ws.error && (
        <ElementErrorState
          title="Could not load Contacts Database"
          message={ws.error}
          onRetry={() => void ws.loadContacts(false)}
          retrying={ws.loading || ws.refreshing}
        />
      )}

      <ContactsKpiRow loading={ws.loading} data={ws.data} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <ContactGroupsSidebar
          data={ws.data}
          optInFilter={ws.optInFilter}
          setOptInFilter={ws.setOptInFilter}
          stageFilter={ws.stageFilter}
          setStageFilter={ws.setStageFilter}
          groupFilter={ws.groupFilter}
          setGroupFilter={ws.setGroupFilter}
          tagFilter={ws.tagFilter}
          setTagFilter={ws.setTagFilter}
          onCreateGroup={ws.handleCreateGroup}
          onDeleteGroup={ws.handleDeleteGroup}
        />

        <div className="lg:col-span-9 bg-white rounded-xl border border-neutral-200/90 shadow-2xs overflow-hidden">
          <ContactFiltersBar
            searchQuery={ws.searchQuery}
            setSearchQuery={ws.setSearchQuery}
            stageFilter={ws.stageFilter}
            setStageFilter={ws.setStageFilter}
            orgFilter={ws.orgFilter}
            setOrgFilter={ws.setOrgFilter}
            sourceFilter={ws.sourceFilter}
            setSourceFilter={ws.setSourceFilter}
            sortBy={ws.sortBy}
            setSortBy={ws.setSortBy}
            selectedIds={ws.selectedIds}
            setSelectedIds={ws.setSelectedIds}
            data={ws.data}
            onRunBulkAction={ws.runBulkAction}
            onOpenBroadcastListModal={() => setShowBroadcastListModal(true)}
          />

          <VirtualizedContactList
            loading={ws.loading}
            contacts={ws.data?.contacts ?? null}
            selectedIds={ws.selectedIds}
            allSelected={ws.allSelected}
            groupMap={ws.groupMap}
            openingChatPhone={ws.openingChatPhone}
            onToggleSelectAll={ws.toggleSelectAll}
            onToggleRow={ws.toggleRow}
            onOpenContact360={(id) => void ws.loadContact360(id)}
            onOpenChat={(c) => void ws.handleOpenChat(c)}
            onQuickToggleOptIn={(c) => void ws.handleQuickToggleOptIn(c)}
            onResetFilters={ws.resetFilters}
            onOpenAddModal={() => setShowAddModal(true)}
          />
        </div>
      </div>

      {showAddModal && (
        <AddContactModal
          groups={ws.data?.groups ?? []}
          staffList={ws.data?.staffList ?? []}
          onClose={() => setShowAddModal(false)}
          onCreateContact={ws.handleCreateContact}
        />
      )}

      {showImportModal && (
        <CsvImportModal
          groups={ws.data?.groups ?? []}
          onClose={() => setShowImportModal(false)}
          onBulkImport={ws.handleBulkImport}
        />
      )}

      {showBroadcastListModal && ws.data && (
        <GroupsModal
          selectedCount={ws.selectedIds.length}
          marketingLists={ws.data.marketingLists}
          onClose={() => setShowBroadcastListModal(false)}
          onPushToBroadcastList={ws.handlePushToBroadcastList}
        />
      )}

      {ws.drawerContactId && (
        <ContactDetailDrawer
          drawerContactId={ws.drawerContactId}
          drawerDetail={ws.drawerDetail}
          setDrawerDetail={ws.setDrawerDetail}
          drawerLoading={ws.drawerLoading}
          drawerError={ws.drawerError}
          savingDrawer={ws.savingDrawer}
          groups={ws.data?.groups ?? []}
          staffList={ws.data?.staffList ?? []}
          onClose={() => {
            ws.setDrawerContactId(null);
            ws.setDrawerDetail(null);
          }}
          onRetry={() => void ws.loadContact360(ws.drawerContactId!)}
          onOpenChat={(c) => void ws.handleOpenChat(c)}
          onSave={ws.handleSaveDrawer}
        />
      )}
    </div>
  );
}
