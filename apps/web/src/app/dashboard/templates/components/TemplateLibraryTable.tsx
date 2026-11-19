"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Copy, Edit3, Pause, Play, Search, Trash2 } from "lucide-react";
import {
  ElementErrorState,
  TableRowsSkeleton,
  WhatsAppLogoIcon,
  stripWhatsAppFormatting,
} from "@cc/ui";
import type { TemplateRecord } from "@/app/dashboard/templates/types";

const TEMPLATE_PAGE_SIZE = 40;

export function TemplateLibraryTable({
  loading,
  loadError,
  canManage,
  filteredTemplates,
  searchQuery,
  setSearchQuery,
  catFilter,
  setCatFilter,
  statusFilter,
  setStatusFilter,
  onRetry,
  onEditTemplate,
  onOpenTestModal,
  onRowAction,
}: {
  loading: boolean;
  loadError: string;
  canManage: boolean;
  filteredTemplates: TemplateRecord[];
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  catFilter: string;
  setCatFilter: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  onRetry: () => void;
  onEditTemplate: (tpl: TemplateRecord) => void;
  onOpenTestModal: (tpl: TemplateRecord) => void;
  onRowAction: (
    action: "duplicate_template" | "toggle_pause" | "delete_template",
    tpl: TemplateRecord
  ) => Promise<void>;
}) {
  const [visibleCount, setVisibleCount] = useState(TEMPLATE_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(TEMPLATE_PAGE_SIZE);
  }, [searchQuery, catFilter, statusFilter]);

  const visibleTemplates = useMemo(
    () => filteredTemplates.slice(0, visibleCount),
    [filteredTemplates, visibleCount]
  );
  const remainingCount = Math.max(0, filteredTemplates.length - visibleTemplates.length);

  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">
            All Message Templates ({filteredTemplates.length})
          </h2>
          <p className="text-xs text-neutral-500">
            Click Edit to load any template into the visual studio, Duplicate to make a new version, or Send Test to check it on WhatsApp.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className="pl-8 pr-3 py-1.5 rounded-md border border-neutral-300 text-xs"
            />
          </div>

          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="rounded-md border border-neutral-300 px-2.5 py-1.5 bg-white"
          >
            <option value="ALL">All Categories</option>
            <option value="MARKETING">Marketing</option>
            <option value="UTILITY">Utility</option>
            <option value="AUTHENTICATION">Authentication</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-neutral-300 px-2.5 py-1.5 bg-white"
          >
            <option value="ALL">All Statuses</option>
            <option value="APPROVED">Approved</option>
            <option value="PENDING_APPROVAL">Pending Review</option>
            <option value="DRAFT">Draft</option>
            <option value="PAUSED">Paused</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      </div>

      {loading ? (
        <TableRowsSkeleton rows={5} columns={6} />
      ) : loadError ? (
        <ElementErrorState
          title="Could not load saved templates"
          message={loadError}
          onRetry={onRetry}
        />
      ) : filteredTemplates.length === 0 ? (
        <div className="p-6 text-center text-xs text-neutral-500 bg-neutral-50 rounded-md">
          No templates match your current search or filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[680px]">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500">
                <th className="py-2.5 pr-3 font-medium">
                  Template &amp; Preview
                </th>
                <th className="py-2.5 px-3 font-medium">Category</th>
                <th className="py-2.5 px-3 font-medium">
                  Header &amp; Buttons
                </th>
                <th className="py-2.5 px-3 font-medium">Status</th>
                <th className="py-2.5 px-3 font-medium">Sent</th>
                <th className="py-2.5 pl-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {visibleTemplates.map((t) => (
                <tr key={t.id} className="hover:bg-neutral-50/70">
                  <td className="py-3 pr-3 max-w-md">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-neutral-900">
                        {t.name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 text-[10px]">
                        {t.language}
                      </span>
                    </div>
                    <p className="text-neutral-600 line-clamp-2 mt-0.5">
                      {stripWhatsAppFormatting(t.bodyText)}
                    </p>
                    {t.rejectionReason && (
                      <p className="text-[11px] text-red-700 mt-1">
                        Reason: {t.rejectionReason}
                      </p>
                    )}
                  </td>

                  <td className="py-3 px-3 whitespace-nowrap">
                    <div className="font-medium text-neutral-900">
                      {t.category}
                    </div>
                  </td>

                  <td className="py-3 px-3 text-neutral-600 whitespace-nowrap">
                    <div>Header: {t.headerType}</div>
                    <div className="text-[11px] text-neutral-500">
                      {t.buttons.length}{" "}
                      {t.buttons.length === 1 ? "button" : "buttons"}
                    </div>
                    {t.buttons.some(
                      (b) =>
                        b.type === "QUICK_REPLY" &&
                        b.flowAction &&
                        b.flowAction.actionType !== "NONE"
                    ) && (
                      <div className="text-[10.5px] font-semibold text-[#008069] mt-0.5">
                        {
                          t.buttons.filter(
                            (b) =>
                              b.type === "QUICK_REPLY" &&
                              b.flowAction &&
                              b.flowAction.actionType !== "NONE"
                          ).length
                        }{" "}
                        button flow mapped
                      </div>
                    )}
                  </td>

                  <td className="py-3 px-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${
                        t.approvalStatus === "APPROVED"
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                          : t.approvalStatus === "PENDING_APPROVAL"
                          ? "bg-amber-50 text-amber-900 border-amber-200"
                          : t.approvalStatus === "REJECTED"
                          ? "bg-red-50 text-red-800 border-red-200"
                          : "bg-neutral-100 text-neutral-700 border-neutral-300"
                      }`}
                    >
                      {t.approvalStatus === "PENDING_APPROVAL"
                        ? "Pending Meta Review"
                        : t.approvalStatus}
                    </span>
                  </td>

                  <td className="py-3 px-3 font-mono text-neutral-700">
                    {t.sentCount}
                  </td>

                  <td className="py-3 pl-3 text-right whitespace-nowrap">
                    {canManage && (
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onEditTemplate(t)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-800 font-medium cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit / Map Flows</span>
                        </button>

                        <button
                          type="button"
                          disabled={t.approvalStatus !== "APPROVED"}
                          title={
                            t.approvalStatus === "APPROVED"
                              ? "Send live test using Meta-approved template"
                              : "Submit to Meta & sync approval before sending"
                          }
                          onClick={() => onOpenTestModal(t)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <WhatsAppLogoIcon size={11} />
                          <span>Test</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            void onRowAction("duplicate_template", t)
                          }
                          className="px-2 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 cursor-pointer"
                          title="Duplicate template"
                        >
                          <Copy className="w-3 h-3" />
                        </button>

                        {(t.approvalStatus === "APPROVED" ||
                          t.approvalStatus === "PAUSED") && (
                          <button
                            type="button"
                            onClick={() => void onRowAction("toggle_pause", t)}
                            className="px-2 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 cursor-pointer"
                            title={
                              t.approvalStatus === "PAUSED"
                                ? "Resume template"
                                : "Pause template"
                            }
                          >
                            {t.approvalStatus === "PAUSED" ? (
                              <Play className="w-3 h-3 text-emerald-700" />
                            ) : (
                              <Pause className="w-3 h-3 text-amber-700" />
                            )}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => void onRowAction("delete_template", t)}
                          className="p-1 text-neutral-400 hover:text-red-600 cursor-pointer"
                          title="Delete template"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {remainingCount > 0 && (
            <div className="mt-3 pt-3 border-t border-neutral-200 flex items-center justify-between gap-3 text-xs text-neutral-600">
              <span>
                Showing {visibleTemplates.length} of {filteredTemplates.length} templates
              </span>
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + TEMPLATE_PAGE_SIZE)}
                className="px-3 py-1.5 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 font-medium text-neutral-800 cursor-pointer"
              >
                Load {Math.min(TEMPLATE_PAGE_SIZE, remainingCount)} More ({remainingCount} remaining)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
