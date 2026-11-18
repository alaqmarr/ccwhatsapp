"use client";

import React, { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";
import type { ConversationDetailBundle, StaffOption } from "@/lib/inbox-server-data";

export interface SaveCustomerProfilePayload {
  name: string;
  email: string;
  gstNumber: string;
  companyName: string;
  organizationType: string;
  city: string;
  acrioSegment: string;
  preferredStaffId: string;
  preferredStaffName: string;
  tags: string[];
  notes: string;
}

const PRESET_CUSTOMER_TAGS = [
  "VIP",
  "Bulk Buyer",
  "Podiums",
  "Machines",
  "Custom Acrylic",
  "GST Invoice",
  "Follow Up",
] as const;

export function RightDrawerProfileTab({
  detail,
  staffList,
  onSaveProfile,
  onAddCollaborator,
  onRemoveCollaborator,
}: {
  detail: ConversationDetailBundle;
  staffList: StaffOption[];
  onSaveProfile: (payload: SaveCustomerProfilePayload) => Promise<void>;
  onAddCollaborator: (staffId: string) => Promise<void>;
  onRemoveCollaborator: (staffId: string) => Promise<void>;
}) {
  const activeConv = detail.conversation;
  const activeCollaborators = activeConv.collaborators || [];
  const cust = detail.customer;

  const [collabToAdd, setCollabToAdd] = useState("");
  const [editName, setEditName] = useState(
    cust?.name || activeConv.customerName || ""
  );
  const [editEmail, setEditEmail] = useState(cust?.email || "");
  const [editGstNumber, setEditGstNumber] = useState(cust?.gstNumber || "");
  const [editCompany, setEditCompany] = useState(cust?.companyName || "");
  const [editOrgType, setEditOrgType] = useState(
    cust?.organizationType || "Business"
  );
  const [editCity, setEditCity] = useState(cust?.city || "");
  const [editSegment, setEditSegment] = useState(
    cust?.acrioSegment || "New WhatsApp Lead"
  );
  const [editPreferredStaffId, setEditPreferredStaffId] = useState(
    cust?.preferredStaffId || ""
  );
  const [editTags, setEditTags] = useState<string[]>(cust?.tags || []);
  const [newTagInput, setNewTagInput] = useState("");
  const [editNotes, setEditNotes] = useState(cust?.notes || "");
  const [saving, setSaving] = useState(false);

  // Sync form defaults only when switching chats or initial customer hydration completes
  useEffect(() => {
    setCollabToAdd("");
    setEditName(cust?.name || activeConv.customerName || "");
    setEditEmail(cust?.email || "");
    setEditGstNumber(cust?.gstNumber || "");
    setEditCompany(cust?.companyName || "");
    setEditOrgType(cust?.organizationType || "Business");
    setEditCity(cust?.city || "");
    setEditSegment(cust?.acrioSegment || "New WhatsApp Lead");
    setEditPreferredStaffId(cust?.preferredStaffId || "");
    setEditTags(cust?.tags || []);
    setNewTagInput("");
    setEditNotes(cust?.notes || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv.id, cust?.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const prefStaff = staffList.find((s) => s.id === editPreferredStaffId);
      await onSaveProfile({
        name: editName.trim(),
        email: editEmail.trim(),
        gstNumber: editGstNumber.trim(),
        companyName: editCompany,
        organizationType: editOrgType,
        city: editCity,
        acrioSegment: editSegment,
        preferredStaffId: editPreferredStaffId || "",
        preferredStaffName: prefStaff?.name || "",
        tags: editTags,
        notes: editNotes,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="p-2.5 rounded-lg bg-violet-50/70 border border-violet-200 space-y-2">
        <div className="flex items-center justify-between text-[11px] font-semibold text-violet-950">
          <span className="inline-flex items-center gap-1">
            <UserPlus className="w-3.5 h-3.5 text-violet-700" />
            <span>Shared Access (Co-handlers)</span>
          </span>
          <span className="text-[10px] font-normal text-violet-700">
            Owner: {activeConv.assignedStaffName || "ACRIO"}
          </span>
        </div>
        {activeCollaborators.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {activeCollaborators.map((c) => (
              <span
                key={c.staffId}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-violet-200 text-[11px] font-medium text-violet-900"
              >
                <span>{c.staffName}</span>
                <button
                  type="button"
                  onClick={() => void onRemoveCollaborator(c.staffId)}
                  title="Remove co-handler access"
                  className="text-violet-500 hover:text-red-600 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5 min-w-0">
          <select
            value={collabToAdd}
            onChange={(e) => setCollabToAdd(e.target.value)}
            className="flex-1 min-w-0 w-full rounded border border-violet-200 bg-white px-2 py-1 text-[11px]"
          >
            <option value="">Tag teammate for access...</option>
            {staffList
              .filter(
                (s) =>
                  s.id !== activeConv.assignedStaffId &&
                  !activeCollaborators.some((c) => c.staffId === s.id)
              )
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.role})
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={!collabToAdd}
            onClick={() => {
              const sid = collabToAdd;
              if (!sid) return;
              void onAddCollaborator(sid).then(() => setCollabToAdd(""));
            }}
            className="px-2.5 py-1 rounded bg-violet-700 hover:bg-violet-800 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-2.5">
          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
              Contact Name
            </label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Customer full name"
              className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
              Email
            </label>
            <input
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              placeholder="buyer@company.com"
              className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
              Company / Org
            </label>
            <input
              type="text"
              value={editCompany}
              onChange={(e) => setEditCompany(e.target.value)}
              placeholder="Taj Deccan / St. Ann's"
              className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
              City
            </label>
            <input
              type="text"
              value={editCity}
              onChange={(e) => setEditCity(e.target.value)}
              placeholder="Hyderabad"
              className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
              Business Type
            </label>
            <select
              value={editOrgType}
              onChange={(e) => setEditOrgType(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs bg-white"
            >
              <option value="Hotel/Hospitality">Hotel / Banquet</option>
              <option value="School/College">School / College</option>
              <option value="Corporate">Corporate Office</option>
              <option value="Signage Fabricator">Fabricator / CNC</option>
              <option value="Retail/Showroom">Retail / Showroom</option>
              <option value="Event Agency">Event Agency</option>
              <option value="Business">Other Business</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
              GST Number
            </label>
            <input
              type="text"
              value={editGstNumber}
              onChange={(e) => setEditGstNumber(e.target.value.toUpperCase())}
              placeholder="36AAACC1234F1Z5"
              className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-mono uppercase"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
              Lead Stage
            </label>
            <select
              value={editSegment}
              onChange={(e) => setEditSegment(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs bg-white"
            >
              <option value="New WhatsApp Lead">New Lead</option>
              <option value="Quoted / Interested">Quoted / Interested</option>
              <option value="Hot Prospect">Hot Prospect</option>
              <option value="Repeat Buyer">Repeat Buyer</option>
              <option value="Distributor / Dealer">Distributor / Dealer</option>
              <option value="Institutional Buyer">Institutional Buyer</option>
              <option value="Won / Customer">Won / Customer</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
              Preferred Staff
            </label>
            <select
              value={editPreferredStaffId}
              onChange={(e) => setEditPreferredStaffId(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs bg-white"
            >
              <option value="">No preference</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[11px] font-medium text-neutral-700">
            Customer Tags
          </label>
          <div className="flex flex-wrap gap-1">
            {PRESET_CUSTOMER_TAGS.map((preset) => {
              const on = editTags.includes(preset);
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() =>
                    setEditTags((prev) =>
                      prev.includes(preset)
                        ? prev.filter((x) => x !== preset)
                        : [...prev, preset]
                    )
                  }
                  className={`px-2 py-0.5 rounded-full text-[10.5px] font-medium border cursor-pointer ${
                    on
                      ? "bg-[#e7fce3] border-[#00a884] text-[#008069]"
                      : "bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {preset}
                </button>
              );
            })}
            {editTags
              .filter(
                (t) =>
                  !(PRESET_CUSTOMER_TAGS as readonly string[]).includes(t)
              )
              .map((custom) => (
                <span
                  key={custom}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-300 text-[10.5px] text-slate-800"
                >
                  <span>{custom}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setEditTags((p) => p.filter((x) => x !== custom))
                    }
                    className="cursor-pointer hover:text-red-600"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const t = newTagInput.trim();
                  if (t && !editTags.includes(t)) {
                    setEditTags((p) => [...p, t]);
                  }
                  setNewTagInput("");
                }
              }}
              placeholder="Add custom tag + Enter"
              className="flex-1 rounded border border-neutral-300 px-2 py-1 text-[11px]"
            />
            <button
              type="button"
              onClick={() => {
                const t = newTagInput.trim();
                if (t && !editTags.includes(t)) {
                  setEditTags((p) => [...p, t]);
                }
                setNewTagInput("");
              }}
              className="px-2 py-1 rounded border border-neutral-300 bg-neutral-50 text-[11px] font-medium cursor-pointer"
            >
              Add
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-neutral-700 mb-0.5">
            Permanent Customer Notes
          </label>
          <textarea
            rows={3}
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            placeholder="Preferred thickness, delivery site, machine models owned..."
            className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Customer Details"}
        </button>
      </form>
    </div>
  );
}
