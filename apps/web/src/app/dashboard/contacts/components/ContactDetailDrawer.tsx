"use client";

import React from "react";
import { X } from "lucide-react";
import {
  ElementErrorState,
  RightDrawerSkeleton,
  WhatsAppLogoIcon,
} from "@cc/ui";
import {
  ORG_TYPES,
  STAGE_OPTIONS,
  formatDateShort,
  type Contact360Detail,
  type ContactGroupItem,
} from "@/app/dashboard/contacts/types";

export function ContactDetailDrawer({
  drawerContactId,
  drawerDetail,
  setDrawerDetail,
  drawerLoading,
  drawerError,
  savingDrawer,
  groups,
  staffList,
  onClose,
  onRetry,
  onOpenChat,
  onSave,
}: {
  drawerContactId: string;
  drawerDetail: Contact360Detail | null;
  setDrawerDetail: React.Dispatch<React.SetStateAction<Contact360Detail | null>>;
  drawerLoading: boolean;
  drawerError: string;
  savingDrawer: boolean;
  groups: ContactGroupItem[];
  staffList: Array<{ id: string; name: string; role: string }>;
  onClose: () => void;
  onRetry: () => void;
  onOpenChat: (c: {
    phone: string;
    name: string;
    conversationId?: string | null;
  }) => void;
  onSave: (e: React.FormEvent) => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
      <div className="w-full max-w-xl bg-white h-dvh overflow-y-auto shadow-2xl border-l border-neutral-200 flex flex-col">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-neutral-200 flex items-center justify-between gap-2 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 truncate">
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
                  onOpenChat({
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
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-5 sm:space-y-6 flex-1 min-w-0">
          {drawerLoading ? (
            <RightDrawerSkeleton />
          ) : drawerError ? (
            <ElementErrorState
              title="Could not load Contact 360"
              message={drawerError}
              onRetry={onRetry}
            />
          ) : drawerDetail ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
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

              <form onSubmit={onSave} className="space-y-4">
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
                        const st = staffList.find((s) => s.id === sid);
                        setDrawerDetail({
                          ...drawerDetail,
                          preferredStaffId: sid || null,
                          preferredStaffName: st?.name || "",
                        });
                      }}
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

                {groups.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Contact Groups
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {groups.map((g) => {
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
          ) : (
            <div className="text-xs text-slate-500">
              Select a contact ({drawerContactId}) to view details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
