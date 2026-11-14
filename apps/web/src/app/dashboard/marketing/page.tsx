"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Plus } from "lucide-react";
import {
  MetricStatCard,
  WHATSAPP_PUBLIC_DOMAIN,
  WHATSAPP_PUBLIC_ORIGIN,
} from "@cc/ui";

interface TemplateItem {
  id: string;
  name: string;
  category: string;
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  approvalStatus: string;
  sentCount: number;
}

interface MarketingListItem {
  id: string;
  name: string;
  description: string;
  sourceType: string;
  acrioPrompt: string | null;
  membersCount: number;
  memberPhones: string[];
  createdByName: string;
  updatedAt: string;
}

interface BroadcastItem {
  id: string;
  name: string;
  listName: string;
  templateName: string;
  billingCategory: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  clientBilledInr: number;
  createdByName: string;
  createdAt: string;
}

interface CustomLinkItem {
  id: string;
  code: string;
  title: string;
  targetUrl: string;
  linkType: string;
  utmCampaign: string | null;
  clicksCount: number;
  createdByName: string;
}

interface AcrioPreview {
  suggestedName: string;
  description: string;
  filterExplanation: string;
  matchedCustomers: {
    id: string;
    name: string;
    phone: string;
    companyName: string | null;
    organizationType: string | null;
    acrioSegment: string;
    lifetimeValueInr: number;
  }[];
}

export default function MarketingAndLinksPage() {
  const [rates, setRates] = useState({ marketingRateInr: 0.95, otherRateInr: 0.3 });
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [lists, setLists] = useState<MarketingListItem[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastItem[]>([]);
  const [customLinks, setCustomLinks] = useState<CustomLinkItem[]>([]);
  const [feedback, setFeedback] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // ACRIO List Builder
  const [acrioPrompt, setAcrioPrompt] = useState<string>(
    "Hotels, banquets, and repeat buyers with orders over Rs 20000"
  );
  const [acrioPreview, setAcrioPreview] = useState<AcrioPreview | null>(null);
  const [listNameDraft, setListNameDraft] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [savingList, setSavingList] = useState<boolean>(false);

  // Short-Link Creator
  const [linkTitle, setLinkTitle] = useState<string>("");
  const [linkCode, setLinkCode] = useState<string>("");
  const [linkTargetUrl, setLinkTargetUrl] = useState<string>(
    "https://www.classicconcepts.in/shop"
  );
  const [linkType, setLinkType] = useState<string>("CATALOG");
  const [copiedCode, setCopiedCode] = useState<string>("");

  // Template Creator
  const [tplName, setTplName] = useState<string>("");
  const [tplCategory, setTplCategory] = useState<string>("MARKETING");
  const [tplHeader, setTplHeader] = useState<string>("");
  const [tplBody, setTplBody] = useState<string>(
    "Hello {{1}}, check out our new clear acrylic podiums and awards at Classic Concepts!"
  );
  const [tplCtaLabel, setTplCtaLabel] = useState<string>("View Collection");
  const [tplCtaUrl, setTplCtaUrl] = useState<string>(
    `${WHATSAPP_PUBLIC_ORIGIN}/l/stage-podiums`
  );

  // Broadcast Launcher
  const [bcName, setBcName] = useState<string>("");
  const [bcListId, setBcListId] = useState<string>("");
  const [bcTemplateId, setBcTemplateId] = useState<string>("");
  const [launching, setLaunching] = useState<boolean>(false);

  const loadMarketingData = useCallback(async () => {
    const res = await fetch("/api/marketing", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setRates(data.rates || { marketingRateInr: 0.95, otherRateInr: 0.3 });
      setTemplates(data.templates || []);
      setLists(data.lists || []);
      setBroadcasts(data.broadcasts || []);
      setCustomLinks(data.customLinks || []);
      if (!bcListId && data.lists?.[0]) setBcListId(data.lists[0].id);
      if (!bcTemplateId && data.templates?.[0]) setBcTemplateId(data.templates[0].id);
    }
  }, [bcListId, bcTemplateId]);

  useEffect(() => {
    loadMarketingData();
  }, [loadMarketingData]);

  function flashMessage(msg: string, isError = false) {
    if (isError) {
      setErrorMsg(msg);
      setFeedback("");
    } else {
      setFeedback(msg);
      setErrorMsg("");
    }
    setTimeout(() => {
      setFeedback("");
      setErrorMsg("");
    }, 4000);
  }

  async function handleAcrioPreview(e: React.FormEvent) {
    e.preventDefault();
    if (!acrioPrompt.trim()) return;
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "acrio_preview_segment",
          prompt: acrioPrompt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.preview) {
        setAcrioPreview(data.preview);
        setListNameDraft(data.preview.suggestedName);
      } else {
        flashMessage(data.error || "Could not match contacts.", true);
      }
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSaveAcrioList() {
    if (!acrioPreview || savingList) return;
    setSavingList(true);
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_acrio_list",
          name: listNameDraft || acrioPreview.suggestedName,
          description: acrioPreview.description,
          acrioPrompt,
          memberPhones: acrioPreview.matchedCustomers.map((c) => c.phone),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        flashMessage("Customer list saved.");
        setAcrioPreview(null);
        await loadMarketingData();
      } else {
        flashMessage(data.error || "Admin access required to save lists.", true);
      }
    } finally {
      setSavingList(false);
    }
  }

  async function handleCreateLink(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/marketing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_custom_link",
        title: linkTitle,
        code: linkCode || undefined,
        targetUrl: linkTargetUrl,
        linkType,
        utmCampaign: "whatsapp_share",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setLinkTitle("");
      setLinkCode("");
      flashMessage(`Created ${WHATSAPP_PUBLIC_DOMAIN}/l/${data.link.code}`);
      await loadMarketingData();
    } else {
      flashMessage(data.error || "Could not create short link.", true);
    }
  }

  async function handleCreateTemplate(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/marketing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_template",
        name: tplName,
        category: tplCategory,
        headerText: tplHeader,
        bodyText: tplBody,
        ctaLabel: tplCtaLabel,
        ctaUrl: tplCtaUrl,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setTplName("");
      setTplHeader("");
      flashMessage("Template saved.");
      await loadMarketingData();
    } else {
      flashMessage(data.error || "Could not save template.", true);
    }
  }

  async function handleLaunchBroadcast(e: React.FormEvent) {
    e.preventDefault();
    if (!bcListId || !bcTemplateId || launching) return;
    setLaunching(true);
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "launch_broadcast",
          name: bcName,
          listId: bcListId,
          templateId: bcTemplateId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setBcName("");
        flashMessage("Broadcast sent.");
        await loadMarketingData();
      } else {
        flashMessage(data.error || "Could not send broadcast.", true);
      }
    } finally {
      setLaunching(false);
    }
  }

  function copyShortLink(code: string) {
    const url = `${WHATSAPP_PUBLIC_ORIGIN}/l/${code}`;
    navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(""), 2000);
  }

  const selectedList = lists.find((l) => l.id === bcListId);
  const selectedTpl = templates.find((t) => t.id === bcTemplateId);
  const estUnitRate =
    selectedTpl?.category === "MARKETING" ? rates.marketingRateInr : rates.otherRateInr;
  const estTotalCost = ((selectedList?.membersCount || 0) * estUnitRate).toFixed(2);

  return (
    <div className="w-full px-6 py-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">
            Broadcasts, ACRIO Lists & Short Links
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Group customers using ACRIO, create {WHATSAPP_PUBLIC_DOMAIN}/l/... short
            links, and send WhatsApp broadcasts.
          </p>
        </div>
        {feedback && (
          <div className="px-3.5 py-2 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
            {feedback}
          </div>
        )}
        {errorMsg && (
          <div className="px-3.5 py-2 rounded-md bg-red-50 border border-red-200 text-xs font-medium text-red-700">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricStatCard
          label="Customer Lists"
          value={String(lists.length)}
          subtext="Saved ACRIO groups"
        />
        <MetricStatCard
          label="Short Links"
          value={String(customLinks.length)}
          subtext={`${customLinks.reduce((a, b) => a + b.clicksCount, 0)} total clicks`}
        />
        <MetricStatCard
          label="Message Templates"
          value={String(templates.length)}
          subtext={`Marketing ₹${rates.marketingRateInr.toFixed(2)} • Other ₹${rates.otherRateInr.toFixed(2)}`}
        />
        <MetricStatCard
          label="Broadcasts Sent"
          value={String(broadcasts.length)}
          subtext={`${broadcasts.reduce((a, b) => a + b.sentCount, 0)} messages delivered`}
        />
      </div>

      {/* SECTION 1: ACRIO Customer List Builder + Saved Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Build a Customer List with ACRIO
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Describe who you want to message in simple words and preview the matching contacts.
            </p>
          </div>

          <form onSubmit={handleAcrioPreview} className="space-y-3 text-xs">
            <textarea
              rows={2}
              value={acrioPrompt}
              onChange={(e) => setAcrioPrompt(e.target.value)}
              placeholder="e.g. Schools and colleges looking for student awards"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-neutral-900"
            />
            <div className="flex flex-wrap gap-1.5">
              {[
                "Hotels and banquet buyers",
                "Schools, colleges & student award leads",
                "Industrial & custom fabrication clients",
                "Repeat buyers over Rs 30000",
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAcrioPrompt(preset)}
                  className="px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs cursor-pointer"
                >
                  {preset}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={previewLoading}
              className="px-4 py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium cursor-pointer"
            >
              {previewLoading ? "Finding contacts..." : "Find Matching Contacts"}
            </button>
          </form>

          {acrioPreview && (
            <div className="p-4 rounded-md bg-neutral-50 border border-neutral-200 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  List Name
                </label>
                <input
                  type="text"
                  value={listNameDraft}
                  onChange={(e) => setListNameDraft(e.target.value)}
                  className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-900"
                />
              </div>
              <p className="text-neutral-600">{acrioPreview.filterExplanation}</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {acrioPreview.matchedCustomers.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between bg-white px-3 py-1.5 rounded border border-neutral-200"
                  >
                    <div>
                      <span className="font-medium text-neutral-900">{c.name}</span>{" "}
                      <span className="text-neutral-500">({c.phone})</span>
                    </div>
                    <span className="text-neutral-600">
                      Spent ₹{c.lifetimeValueInr.toLocaleString("en-IN")}
                    </span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleSaveAcrioList}
                disabled={savingList}
                className="w-full py-2 rounded-md bg-[#1da851] hover:bg-[#178c43] text-white font-medium cursor-pointer"
              >
                {savingList ? "Saving..." : "Save List"}
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-6 bg-white rounded-lg border border-neutral-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-900">
            Saved Customer Lists
          </h2>
          <div className="space-y-2.5 max-h-80 overflow-y-auto">
            {lists.map((l) => (
              <div
                key={l.id}
                className="p-3.5 rounded-md border border-neutral-200 bg-neutral-50/60 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-neutral-900">
                    {l.name}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-white border border-neutral-200 text-neutral-700 text-[11px] font-medium">
                    {l.membersCount} contacts
                  </span>
                </div>
                <p className="text-xs text-neutral-600">{l.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION 2: Custom Admin Short-Links on whatsapp.ccapl.cc */}
      <div className="bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Custom Short Links ({WHATSAPP_PUBLIC_DOMAIN}/l/...)
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Create clean short links for products, catalogs, or custom quotes and see how many times customers click them.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleCreateLink}
          className="grid grid-cols-1 md:grid-cols-5 gap-2.5 text-xs"
        >
          <input
            type="text"
            required
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            placeholder="Title (e.g. Stage Podiums)"
            className="rounded-md border border-neutral-300 px-3 py-2"
          />
          <input
            type="text"
            value={linkCode}
            onChange={(e) => setLinkCode(e.target.value)}
            placeholder="Short name (e.g. podiums)"
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
            <span>Create Link</span>
          </button>
        </form>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {customLinks.map((lnk) => (
            <div
              key={lnk.id}
              className="p-3.5 rounded-md border border-neutral-200 bg-neutral-50 flex flex-col justify-between gap-2 text-xs"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-neutral-900 truncate">
                    {lnk.title}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-white border border-neutral-200 text-neutral-700 text-[11px] font-medium">
                    {lnk.clicksCount} clicks
                  </span>
                </div>
                <div className="font-mono text-xs text-blue-800 mt-1 truncate">
                  {WHATSAPP_PUBLIC_DOMAIN}/l/{lnk.code}
                </div>
                <div className="text-[11px] text-neutral-500 truncate mt-0.5">
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
                  href={`/l/${lnk.code}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1.5 rounded bg-white border border-neutral-300 hover:bg-neutral-100 text-neutral-700"
                  title="Open destination"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 3: Send Broadcast + Save Template */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-neutral-900">
            Send WhatsApp Broadcast
          </h2>

          <form onSubmit={handleLaunchBroadcast} className="space-y-3 text-xs">
            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Campaign Name
              </label>
              <input
                type="text"
                value={bcName}
                onChange={(e) => setBcName(e.target.value)}
                placeholder="e.g. Auditorium Podium Update"
                className="w-full rounded-md border border-neutral-300 px-3 py-2"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Customer List
                </label>
                <select
                  value={bcListId}
                  onChange={(e) => setBcListId(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
                >
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.membersCount})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Message Template
                </label>
                <select
                  value={bcTemplateId}
                  onChange={(e) => setBcTemplateId(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.category})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedTpl && (
              <div className="p-3 rounded-md bg-neutral-50 border border-neutral-200 space-y-1">
                <div className="text-[11px] font-medium text-neutral-500">
                  Message Preview
                </div>
                {selectedTpl.headerText && (
                  <div className="font-semibold text-neutral-900">
                    {selectedTpl.headerText}
                  </div>
                )}
                <p className="text-neutral-700">{selectedTpl.bodyText}</p>
              </div>
            )}

            <div className="flex items-center justify-between p-3 rounded-md bg-neutral-50 border border-neutral-200">
              <span className="text-neutral-700">
                Estimated charge ({selectedList?.membersCount || 0} contacts × ₹
                {estUnitRate.toFixed(2)})
              </span>
              <span className="text-sm font-semibold text-neutral-900">
                ₹{estTotalCost}
              </span>
            </div>

            <button
              type="submit"
              disabled={launching}
              className="w-full py-2.5 rounded-md bg-[#1da851] hover:bg-[#178c43] text-white font-medium cursor-pointer"
            >
              {launching ? "Sending..." : "Send Broadcast"}
            </button>
          </form>

          <div className="pt-2 space-y-2">
            <h3 className="text-xs font-semibold text-neutral-700">
              Past Broadcasts
            </h3>
            {broadcasts.map((b) => (
              <div
                key={b.id}
                className="p-3 rounded-md border border-neutral-200 bg-neutral-50 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-medium text-neutral-900">{b.name}</div>
                  <div className="text-[11px] text-neutral-500">
                    {b.listName} • {b.sentCount}/{b.totalRecipients} sent
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[11px] font-medium text-emerald-700">
                    {b.status}
                  </span>
                  <div className="text-xs font-semibold text-neutral-900">
                    ₹{b.clientBilledInr.toFixed(2)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-6 bg-white rounded-lg border border-neutral-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-neutral-900">
            Create Message Template
          </h2>

          <form onSubmit={handleCreateTemplate} className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Template Name
                </label>
                <input
                  type="text"
                  required
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  placeholder="festive_awards_update"
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Type & Rate
                </label>
                <select
                  value={tplCategory}
                  onChange={(e) => setTplCategory(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 bg-white"
                >
                  <option value="MARKETING">
                    Marketing (₹{rates.marketingRateInr.toFixed(2)} / msg)
                  </option>
                  <option value="UTILITY">
                    Order Update (₹{rates.otherRateInr.toFixed(2)} / msg)
                  </option>
                  <option value="AUTHENTICATION">
                    Verification Code (₹{rates.otherRateInr.toFixed(2)} / msg)
                  </option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Heading (optional)
              </label>
              <input
                type="text"
                value={tplHeader}
                onChange={(e) => setTplHeader(e.target.value)}
                placeholder="New Podiums & Awards at Classic Concepts"
                className="w-full rounded-md border border-neutral-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="block font-medium text-neutral-700 mb-1">
                Message Text (use {"{{1}}"} for customer name)
              </label>
              <textarea
                rows={3}
                required
                value={tplBody}
                onChange={(e) => setTplBody(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Button Text
                </label>
                <input
                  type="text"
                  value={tplCtaLabel}
                  onChange={(e) => setTplCtaLabel(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Button Link
                </label>
                <input
                  type="text"
                  value={tplCtaUrl}
                  onChange={(e) => setTplCtaUrl(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white font-medium cursor-pointer"
            >
              Save Template
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
