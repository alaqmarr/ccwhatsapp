"use client";

import React from "react";
import { Trash2, Upload } from "lucide-react";
import { formatDateTimeIst } from "@cc/ui";
import type { CompanyDoc, WebsiteDoc } from "./ai-training-types";

export default function AiTrainingDocsTab({
  companyDocs,
  websiteDocs,
  docTitle,
  setDocTitle,
  docSlug,
  setDocSlug,
  docCategory,
  setDocCategory,
  docNumber,
  setDocNumber,
  docKeywords,
  setDocKeywords,
  docUploading,
  setDocUploading,
  notify,
  onReload,
}: {
  companyDocs: CompanyDoc[];
  websiteDocs: WebsiteDoc[];
  docTitle: string;
  setDocTitle: (v: string) => void;
  docSlug: string;
  setDocSlug: (v: string) => void;
  docCategory: "COMPLIANCE" | "CATALOGUE" | "BANKING" | "COMPANY_PROFILE";
  setDocCategory: (v: "COMPLIANCE" | "CATALOGUE" | "BANKING" | "COMPANY_PROFILE") => void;
  docNumber: string;
  setDocNumber: (v: string) => void;
  docKeywords: string;
  setDocKeywords: (v: string) => void;
  docUploading: boolean;
  setDocUploading: (v: boolean) => void;
  notify: (msg: string) => void;
  onReload: () => Promise<void>;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-1 rounded-xl border border-neutral-200 bg-white p-5 space-y-4 shadow-2xs h-fit">
        <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-1.5">
          <Upload className="w-4 h-4 text-[#008069]" />
          <span>Upload Verified Company Document</span>
        </h2>
        <p className="text-[11px] text-neutral-600">
          Upload official PDFs or images (GST Certificate, ISO, MSME, Brochure, Bank Details). When staff ask @ACRIO in notes to share one with a client, ACRIO prepares it for confirmation and sends it directly on WhatsApp.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: "GST Certificate", slug: "gst-certificate", cat: "COMPLIANCE" as const, kw: "gst, gstin, tax certificate, gst certificate" },
            { label: "ISO Certificate", slug: "iso-certificate", cat: "COMPLIANCE" as const, kw: "iso, quality certificate" },
            { label: "MSME / Udyam", slug: "msme-certificate", cat: "COMPLIANCE" as const, kw: "msme, udyam, ssi certificate" },
            { label: "Cancelled Cheque", slug: "cancelled-cheque", cat: "BANKING" as const, kw: "bank, cheque, neft, rtgs, account" },
            { label: "Company Brochure", slug: "company-brochure", cat: "COMPANY_PROFILE" as const, kw: "brochure, profile, catalogue" },
          ].map((p) => (
            <button
              key={p.slug}
              type="button"
              onClick={() => {
                setDocTitle(p.label);
                setDocSlug(p.slug);
                setDocCategory(p.cat);
                setDocKeywords(p.kw);
              }}
              className="px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 text-[11px] font-medium text-neutral-800 cursor-pointer"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-1">
              Document Title
            </label>
            <input
              type="text"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs"
              placeholder="e.g. GST Certificate"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-1">
              Document / Reference Number (Optional, e.g. GSTIN)
            </label>
            <input
              type="text"
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs"
              placeholder="e.g. 36AABCC1234D1Z5"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-1">
              Category
            </label>
            <select
              value={docCategory}
              onChange={(e) =>
                setDocCategory(
                  e.target.value as "COMPLIANCE" | "CATALOGUE" | "BANKING" | "COMPANY_PROFILE"
                )
              }
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs bg-white"
            >
              <option value="COMPLIANCE">Compliance (GST / ISO / MSME / PAN)</option>
              <option value="CATALOGUE">Catalogue / Price Sheet</option>
              <option value="BANKING">Banking / Cancelled Cheque</option>
              <option value="COMPANY_PROFILE">Company Profile / Brochure</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-700 mb-1">
              Match Keywords
            </label>
            <input
              type="text"
              value={docKeywords}
              onChange={(e) => setDocKeywords(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs"
              placeholder="gst, gstin, tax certificate"
            />
          </div>
          <label
            className={`w-full py-2.5 px-4 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer ${
              docUploading || !docTitle.trim() ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{docUploading ? "Uploading..." : "Choose PDF / Image & Save"}</span>
            <input
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              disabled={docUploading || !docTitle.trim()}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file || !docTitle.trim()) return;
                setDocUploading(true);
                try {
                  const fd = new FormData();
                  fd.append("file", file);
                  const upRes = await fetch("/api/media/upload", { method: "POST", body: fd });
                  const upData = await upRes.json().catch(() => ({}));
                  if (!upRes.ok || !upData.ok || !upData.attachment) {
                    notify(upData.error || "Upload failed.");
                    return;
                  }
                  const att = upData.attachment;
                  const saveRes = await fetch("/api/company-documents", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      slug: docSlug.trim() || undefined,
                      title: docTitle.trim(),
                      category: docCategory,
                      docNumber: docNumber.trim(),
                      keywords: docKeywords.trim(),
                      mediaId: att.mediaId,
                      waMediaId: att.waMediaId,
                      mediaUrl: att.url,
                      mediaType: att.mediaType,
                      fileName: att.fileName,
                      mimeType: att.mimeType,
                    }),
                  });
                  const saveData = await saveRes.json().catch(() => ({}));
                  if (saveRes.ok && saveData.ok) {
                    notify(`${docTitle.trim()} saved! ACRIO can now share it on confirmation.`);
                    setDocNumber("");
                    await onReload();
                  } else {
                    notify(saveData.error || "Could not save document.");
                  }
                } finally {
                  setDocUploading(false);
                }
              }}
            />
          </label>
        </div>
      </div>

      <div className="lg:col-span-2 rounded-xl border border-neutral-200 bg-white p-5 space-y-3 shadow-2xs">
        <h2 className="text-sm font-semibold text-neutral-900">
          Saved Company Documents ({companyDocs.length})
        </h2>
        {companyDocs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-xs text-neutral-500">
            No company documents uploaded yet. Upload your GST Certificate on the left so @ACRIO can share it directly when requested in internal notes.
          </div>
        ) : (
          <div className="space-y-2.5">
            {companyDocs.map((d) => (
              <div
                key={d.id}
                className="rounded-lg border border-neutral-200 p-3.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-neutral-900">{d.title}</span>
                    <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 text-[10px] font-medium">
                      {d.category}
                    </span>
                    {d.docNumber && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 text-[10px] font-mono font-semibold">
                        {d.docNumber}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-600 truncate">
                    File: {d.fileName} ({d.mediaType}){" "}
                    {d.keywords ? `| Keywords: ${d.keywords}` : ""}
                  </p>
                  <p className="text-[10.5px] text-neutral-400">
                    Uploaded by {d.uploadedBy || "Team"} • {formatDateTimeIst(d.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={d.mediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-[11px] font-medium text-neutral-800"
                  >
                    View
                  </a>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch(`/api/company-documents?id=${encodeURIComponent(d.id)}`, {
                        method: "DELETE",
                      });
                      notify(`Removed ${d.title}.`);
                      await onReload();
                    }}
                    className="p-1.5 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 cursor-pointer"
                    title="Delete document"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pt-4 border-t border-neutral-200 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-neutral-900">
              Live Documents Fetched from classicconcepts.in & classicedge53.com ({websiteDocs.length})
            </h3>
            <span className="text-[10.5px] text-neutral-500">Auto-synced live</span>
          </div>
          {websiteDocs.length === 0 ? (
            <p className="text-[11px] text-neutral-500">
              No external website certificates or brochures loaded right now.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {websiteDocs.map((wd) => (
                <div
                  key={wd.id}
                  className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11.5px] font-semibold text-neutral-900 truncate">
                        {wd.title}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-900 text-[9.5px] font-medium shrink-0">
                        {wd.sourceLabel}
                      </span>
                    </div>
                    <p className="text-[10.5px] text-neutral-600 truncate">
                      {wd.fileName} ({wd.mediaType})
                    </p>
                  </div>
                  <a
                    href={wd.mediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-[10.5px] font-medium text-neutral-800 shrink-0"
                  >
                    View
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
