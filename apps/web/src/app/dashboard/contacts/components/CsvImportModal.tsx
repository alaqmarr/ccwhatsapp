"use client";

import React, { useMemo, useState } from "react";
import { UserCheck, X } from "lucide-react";
import type { ContactGroupItem } from "@/app/dashboard/contacts/types";
import {
  inspectCsvStaffValues,
  suggestStaffFromFileName,
} from "@/lib/contacts/csv-core";

export function CsvImportModal({
  groups,
  staffList,
  onClose,
  onBulkImport,
}: {
  groups: ContactGroupItem[];
  staffList: Array<{ id: string; name: string; role: string; email?: string }>;
  onClose: () => void;
  onBulkImport: (input: {
    csvText: string;
    groupId: string;
    defaultTag: string;
    sourceLabel: string;
    defaultPreferredStaffId?: string;
    preferredStaffMode?: "fallback" | "override";
    staffMappings?: Record<string, string>;
  }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [csvText, setCsvText] = useState<string>("");
  const [importGroupId, setImportGroupId] = useState<string>("");
  const [importDefaultTag, setImportDefaultTag] = useState<string>("");
  const [importSourceLabel, setImportSourceLabel] = useState<string>(
    "CSV / Sheet Upload"
  );
  const [preferredStaffId, setPreferredStaffId] = useState<string>("");
  const [staffSelectionManuallyChanged, setStaffSelectionManuallyChanged] =
    useState<boolean>(false);
  const [suggestedFromFile, setSuggestedFromFile] = useState<boolean>(false);
  const [preferredStaffMode, setPreferredStaffMode] = useState<
    "fallback" | "override"
  >("fallback");
  const [staffMappings, setStaffMappings] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string>("");

  const staffInspection = useMemo(
    () => inspectCsvStaffValues(csvText, staffList),
    [csvText, staffList]
  );

  function handleCsvFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportSourceLabel(`CSV File: ${file.name}`);

    if (!staffSelectionManuallyChanged) {
      const guessed = suggestStaffFromFileName(file.name, staffList);
      if (guessed) {
        setPreferredStaffId(guessed.id);
        setSuggestedFromFile(true);
      }
    }

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setImporting(true);
    setImportError("");
    try {
      const cleanedMappings: Record<string, string> = {};
      for (const [k, v] of Object.entries(staffMappings)) {
        if (k.trim() && v.trim()) cleanedMappings[k] = v.trim();
      }
      const result = await onBulkImport({
        csvText,
        groupId: importGroupId,
        defaultTag: importDefaultTag,
        sourceLabel: importSourceLabel,
        defaultPreferredStaffId: preferredStaffId || undefined,
        preferredStaffMode: preferredStaffId ? preferredStaffMode : "fallback",
        staffMappings:
          Object.keys(cleanedMappings).length > 0 ? cleanedMappings : undefined,
      });
      if (!result.ok) {
        setImportError(result.error || "Import failed.");
        return;
      }
      onClose();
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-neutral-200 w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto shadow-xl">
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-neutral-200 flex items-center justify-between gap-2 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-bold text-slate-900">
              Bulk Import Contacts (CSV or Copy-Paste from Excel)
            </h2>
            <p className="text-xs text-slate-500">
              Supports standard exports and old CRM sheets (Customer Name, Number, Manage By / Emp Name, Location, Requirment, Lead Source, Call Status, Cust Voice). Choose Preferred Staff below if staff names in the sheet are missing or incomplete.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
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

          <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <UserCheck className="w-3.5 h-3.5 text-[#00a884]" />
                <span>Preferred Staff for Imported Contacts (Sticky Routing)</span>
              </label>
              {suggestedFromFile && preferredStaffId && (
                <span className="text-[11px] font-medium text-[#008f6f] bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                  Pre-selected from file name
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <select
                  value={preferredStaffId}
                  onChange={(e) => {
                    setPreferredStaffId(e.target.value);
                    setStaffSelectionManuallyChanged(true);
                    setSuggestedFromFile(false);
                  }}
                  aria-label="Preferred Staff for Imported Contacts"
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-xs bg-white text-slate-900"
                >
                  <option value="">No default staff (match CSV column only)</option>
                  {staffList.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name} ({st.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <select
                  value={preferredStaffMode}
                  disabled={!preferredStaffId}
                  onChange={(e) =>
                    setPreferredStaffMode(
                      e.target.value === "override" ? "override" : "fallback"
                    )
                  }
                  aria-label="Preferred Staff Application Mode"
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-xs bg-white text-slate-900 disabled:bg-neutral-100 disabled:text-slate-400"
                >
                  <option value="fallback">
                    Fill blank / unmatched rows (keep matched CSV staff)
                  </option>
                  <option value="override">
                    Assign this staff to ALL rows in this CSV
                  </option>
                </select>
              </div>
            </div>

            {staffInspection.totalDataRows > 0 && (
              <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 border-t border-neutral-200/80">
                <span>
                  Checked <strong>{staffInspection.totalDataRows}</strong> rows
                </span>
                <span>
                  Matched staff in CSV: <strong>{staffInspection.matchedRows}</strong>
                </span>
                <span>
                  Missing / blank staff:{" "}
                  <strong>{staffInspection.blankStaffRows}</strong>
                </span>
                {staffInspection.unmatchedGroups.length > 0 && (
                  <span className="text-amber-700 font-medium">
                    Unrecognized staff names:{" "}
                    {staffInspection.unmatchedGroups.length}
                  </span>
                )}
              </div>
            )}

            {preferredStaffMode === "fallback" &&
              staffInspection.unmatchedGroups.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-neutral-200">
                  <div className="text-[11px] font-semibold text-slate-700">
                    Map unrecognized staff names from CSV (optional):
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {staffInspection.unmatchedGroups.slice(0, 12).map((item) => (
                      <div
                        key={item.rawName}
                        className="flex flex-wrap items-center justify-between gap-2 bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5"
                      >
                        <span className="text-xs text-slate-800 truncate max-w-[220px]">
                          <strong>{item.rawName}</strong>{" "}
                          <span className="text-slate-500">
                            ({item.rowCount}{" "}
                            {item.rowCount === 1 ? "row" : "rows"})
                          </span>
                        </span>
                        <select
                          value={staffMappings[item.rawName] || ""}
                          onChange={(e) =>
                            setStaffMappings((prev) => ({
                              ...prev,
                              [item.rawName]: e.target.value,
                            }))
                          }
                          className="px-2 py-1 rounded-md border border-neutral-300 text-xs bg-white text-slate-800 min-w-[180px]"
                        >
                          <option value="">
                            {preferredStaffId
                              ? "Use default staff above"
                              : "Leave unmatched"}
                          </option>
                          {staffList.map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.name} ({st.role})
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
                {groups.map((g) => (
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
              onClick={onClose}
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
  );
}
