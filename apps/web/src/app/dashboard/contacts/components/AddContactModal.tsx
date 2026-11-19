"use client";

import React, { useState } from "react";
import { X } from "lucide-react";
import {
  INITIAL_ADD_CONTACT_FORM,
  ORG_TYPES,
  STAGE_OPTIONS,
  type AddContactFormState,
  type ContactGroupItem,
} from "@/app/dashboard/contacts/types";

export function AddContactModal({
  groups,
  staffList,
  onClose,
  onCreateContact,
}: {
  groups: ContactGroupItem[];
  staffList: Array<{ id: string; name: string; role: string }>;
  onClose: () => void;
  onCreateContact: (
    form: AddContactFormState
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [addForm, setAddForm] = useState<AddContactFormState>(
    INITIAL_ADD_CONTACT_FORM
  );
  const [savingContact, setSavingContact] = useState<boolean>(false);
  const [formError, setFormError] = useState<string>("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSavingContact(true);
    setFormError("");
    try {
      const result = await onCreateContact(addForm);
      if (!result.ok) {
        setFormError(result.error || "Could not save contact.");
        return;
      }
      onClose();
    } finally {
      setSavingContact(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-neutral-200 w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto shadow-xl">
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-neutral-200 flex items-center justify-between gap-2 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 truncate">
              Add New WhatsApp Contact
            </h2>
            <p className="text-xs text-slate-500">
              Saved to Contacts Database and synced automatically with Chats and Broadcast Queue.
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

          {groups.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Assign to Contact Groups
              </label>
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => {
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
              {staffList.map((st) => (
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
              Opted in to receive WhatsApp broadcast &amp; promotional templates
            </span>
          </label>

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
              disabled={savingContact}
              className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              {savingContact ? "Saving..." : "Save Contact"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
