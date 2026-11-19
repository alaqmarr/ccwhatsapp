"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Plus, RefreshCw, Search } from "lucide-react";
import {
  CardListSkeleton,
  ElementErrorState,
  SHORTLINK_PUBLIC_DOMAIN,
  formatShortLinkUrl,
} from "@cc/ui";
import type { CustomLinkItem } from "@/app/dashboard/marketing/types";

export function ShortLinksPanel({
  initialLoading,
  loadError,
  refreshing,
  customLinks,
  syncingCatalogLinks,
  onRetry,
  onCreateLink,
  onSyncProductLinks,
}: {
  initialLoading: boolean;
  loadError: string;
  refreshing: boolean;
  customLinks: CustomLinkItem[];
  syncingCatalogLinks: boolean;
  onRetry: () => void;
  onCreateLink: (input: {
    title: string;
    code: string;
    targetUrl: string;
    linkType: string;
  }) => Promise<boolean>;
  onSyncProductLinks: () => Promise<void>;
}) {
  const [linkTitle, setLinkTitle] = useState<string>("");
  const [linkCode, setLinkCode] = useState<string>("");
  const [linkTargetUrl, setLinkTargetUrl] = useState<string>(
    "https://www.classicconcepts.in/shop"
  );
  const [linkType, setLinkType] = useState<string>("CATALOG");
  const [copiedCode, setCopiedCode] = useState<string>("");
  const [linkSearch, setLinkSearch] = useState<string>("");
  const [linkSourceFilter, setLinkSourceFilter] = useState<
    "ALL" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | "MANUAL"
  >("ALL");

  const classifyLinkBrand = useCallback(
    (
      lnk: CustomLinkItem
    ): "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | "MANUAL" => {
      if (
        lnk.utmCampaign === "auto_classicedge53" ||
        lnk.createdByName.includes("Classic Edge 53")
      ) {
        return "CLASSIC_EDGE_53";
      }
      if (
        lnk.utmCampaign === "auto_classicconcepts" ||
        lnk.createdByName.includes("Classic Concepts")
      ) {
        return "CLASSIC_CONCEPTS";
      }
      return "MANUAL";
    },
    []
  );

  const linkCounts = useMemo(() => {
    let cc = 0;
    let ce = 0;
    let manual = 0;
    for (const l of customLinks) {
      const kind = classifyLinkBrand(l);
      if (kind === "CLASSIC_CONCEPTS") cc++;
      else if (kind === "CLASSIC_EDGE_53") ce++;
      else manual++;
    }
    return { all: customLinks.length, cc, ce, manual };
  }, [customLinks, classifyLinkBrand]);

  const filteredCustomLinks = useMemo(() => {
    const q = linkSearch.trim().toLowerCase();
    return customLinks.filter((lnk) => {
      const kind = classifyLinkBrand(lnk);
      if (linkSourceFilter !== "ALL" && kind !== linkSourceFilter) {
        return false;
      }
      if (q) {
        const hay =
          `${lnk.title} ${lnk.code} ${lnk.targetUrl} ${lnk.createdByName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [customLinks, classifyLinkBrand, linkSourceFilter, linkSearch]);

  function copyShortLink(code: string) {
    const url = formatShortLinkUrl(code);
    navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(""), 2000);
  }

  async function submitLink(e: React.FormEvent) {
    e.preventDefault();
    const ok = await onCreateLink({
      title: linkTitle,
      code: linkCode,
      targetUrl: linkTargetUrl,
      linkType,
    });
    if (ok) {
      setLinkTitle("");
      setLinkCode("");
    }
  }

  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">
            Product &amp; Custom Short Links ({SHORTLINK_PUBLIC_DOMAIN}/&lt;6-char&gt;)
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Every product and machine automatically gets a 6-character {SHORTLINK_PUBLIC_DOMAIN} short link. Leave the 6-char ID blank below to auto-generate one, or enter an exact 6-character code (letters, numbers, -, @, +, $, =).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onSyncProductLinks()}
          disabled={syncingCatalogLinks}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-800 cursor-pointer disabled:opacity-60"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${
              syncingCatalogLinks ? "animate-spin" : ""
            }`}
          />
          <span>
            {syncingCatalogLinks
              ? "Syncing Catalogs..."
              : "Sync Classic Concepts + CE53 Links"}
          </span>
        </button>
      </div>

      <form
        onSubmit={submitLink}
        className="grid grid-cols-1 md:grid-cols-5 gap-2.5 text-xs"
      >
        <input
          type="text"
          required
          value={linkTitle}
          onChange={(e) => setLinkTitle(e.target.value)}
          placeholder="Custom title (e.g. Diwali Offer)"
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
        <input
          type="text"
          maxLength={6}
          value={linkCode}
          onChange={(e) => setLinkCode(e.target.value)}
          placeholder="Optional 6-char ID (auto)"
          className="rounded-md border border-neutral-300 px-3 py-2 font-mono"
        />
        <input
          type="url"
          required
          value={linkTargetUrl}
          onChange={(e) => setLinkTargetUrl(e.target.value)}
          placeholder="Destination https://..."
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
        <select
          value={linkType}
          onChange={(e) => setLinkType(e.target.value)}
          className="rounded-md border border-neutral-300 px-3 py-2 bg-white"
        >
          <option value="CATALOG">Catalog / Product</option>
          <option value="CUSTOM_QUOTE">Custom Quote</option>
          <option value="PAYMENT">Payment Link</option>
          <option value="ORDER_TRACKING">Order Status</option>
        </select>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium px-4 py-2 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create Custom Link</span>
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-neutral-100">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(
            [
              { key: "ALL", label: `All (${linkCounts.all})` },
              {
                key: "CLASSIC_CONCEPTS",
                label: `Classic Concepts (${linkCounts.cc})`,
              },
              {
                key: "CLASSIC_EDGE_53",
                label: `Classic Edge 53 (${linkCounts.ce})`,
              },
              { key: "MANUAL", label: `Manual (${linkCounts.manual})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setLinkSourceFilter(tab.key)}
              className={`px-2.5 py-1 rounded-md border font-medium cursor-pointer transition ${
                linkSourceFilter === tab.key
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={linkSearch}
            onChange={(e) => setLinkSearch(e.target.value)}
            placeholder="Search product name, SKU, or 6-char ID..."
            className="w-full rounded-md border border-neutral-300 pl-8 pr-3 py-1.5 text-xs"
          />
        </div>
      </div>

      {initialLoading ? (
        <CardListSkeleton rows={2} />
      ) : loadError ? (
        <ElementErrorState
          compact
          title="Could not load short links"
          message={loadError}
          onRetry={onRetry}
          retrying={refreshing}
        />
      ) : filteredCustomLinks.length === 0 ? (
        <p className="text-xs text-neutral-500 text-center py-6">
          No short links matched your filter.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-h-[480px] overflow-y-auto pr-1">
          {filteredCustomLinks.map((lnk) => {
            const kind = classifyLinkBrand(lnk);
            return (
              <div
                key={lnk.id}
                className="p-3.5 rounded-md border border-neutral-200 bg-neutral-50 flex flex-col justify-between gap-2 text-xs"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-neutral-900 truncate">
                      {lnk.title}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-white border border-neutral-200 text-neutral-700 text-[11px] font-medium shrink-0">
                      {lnk.clicksCount} clicks
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        kind === "CLASSIC_EDGE_53"
                          ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                          : kind === "CLASSIC_CONCEPTS"
                          ? "bg-rose-50 text-rose-700 border border-rose-200"
                          : "bg-neutral-200/70 text-neutral-700"
                      }`}
                    >
                      {kind === "CLASSIC_EDGE_53"
                        ? "Classic Edge 53"
                        : kind === "CLASSIC_CONCEPTS"
                        ? "Classic Concepts"
                        : "Custom"}
                    </span>
                    <span className="font-mono text-xs text-blue-800 truncate">
                      {SHORTLINK_PUBLIC_DOMAIN}/{lnk.code}
                    </span>
                  </div>
                  <div className="text-[11px] text-neutral-500 truncate mt-1">
                    {lnk.targetUrl}
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => copyShortLink(lnk.code)}
                    className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded bg-white border border-neutral-300 hover:bg-neutral-100 text-xs font-medium text-neutral-800 cursor-pointer"
                  >
                    {copiedCode === lnk.code ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Link</span>
                      </>
                    )}
                  </button>
                  <a
                    href={`/${lnk.code}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1.5 rounded bg-white border border-neutral-300 hover:bg-neutral-100 text-neutral-700"
                    title="Open destination"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
