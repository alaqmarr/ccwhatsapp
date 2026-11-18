"use client";

import React, { useState } from "react";
import { Loader2, MapPin, Search, Truck, X } from "lucide-react";
import {
  SHIPPING_PROVIDER_OPTIONS,
  SHORTLINK_PUBLIC_DOMAIN,
  TRACKING_PUBLIC_ORIGIN,
  buildClientProviderTrackingUrl,
  formatShortLinkUrl,
} from "@cc/ui";
import type { ConversationDetailBundle } from "@/lib/inbox-server-data";

export interface VerifiedLocationInfo {
  placeName: string;
  address: string;
  businessHours: string;
  phone: string;
  mapsUrl: string;
  latitude: number;
  longitude: number;
}

export function TrackOrderPopover({
  detail,
  trackOrderId,
  setTrackOrderId,
  trackBrand,
  setTrackBrand,
  trackProviderKey,
  setTrackProviderKey,
  trackAwbNumber,
  setTrackAwbNumber,
  trackProviderUrl,
  setTrackProviderUrl,
  trackButtonLabel,
  setTrackButtonLabel,
  trackMessageText,
  setTrackMessageText,
  sendingTrackBtn,
  onSelectOrder,
  onSubmit,
  onInsertLinkOnly,
  onClose,
}: {
  detail: ConversationDetailBundle;
  trackOrderId: string;
  setTrackOrderId: (v: string) => void;
  trackBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  setTrackBrand: (v: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53") => void;
  trackProviderKey: string;
  setTrackProviderKey: (v: string) => void;
  trackAwbNumber: string;
  setTrackAwbNumber: (v: string) => void;
  trackProviderUrl: string;
  setTrackProviderUrl: (v: string) => void;
  trackButtonLabel: string;
  setTrackButtonLabel: (v: string) => void;
  trackMessageText: string;
  setTrackMessageText: (v: string) => void;
  sendingTrackBtn: boolean;
  onSelectOrder: (prefill: { orderId: string; itemsSummary: string }) => void;
  onSubmit: (e: React.FormEvent) => void;
  onInsertLinkOnly: (url: string) => void;
  onClose: () => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="absolute bottom-full left-2 right-2 sm:left-4 sm:right-4 mb-1.5 z-30 rounded-xl bg-white border border-[#d1d7db] shadow-2xl p-3 sm:p-3.5 space-y-2.5 max-w-2xl max-h-[68dvh] overflow-y-auto"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#111b21]">
          <Truck className="w-4 h-4 text-[#00a884]" />
          <span>
            Create &amp; Send Dynamic Order Track Button (track.ccapl.cc/{"{id}"})
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-neutral-100 text-[#667781] cursor-pointer"
          aria-label="Close tracking button creator"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {detail.orders.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[#54656f]">Pick customer order:</span>
          {detail.orders.slice(0, 5).map((ord) => (
            <button
              key={ord.id}
              type="button"
              onClick={() =>
                onSelectOrder({
                  orderId: ord.orderNumber,
                  itemsSummary: ord.itemsSummary,
                })
              }
              className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer border ${
                trackOrderId.trim().toUpperCase() === ord.orderNumber.toUpperCase()
                  ? "bg-[#00a884] text-white border-[#00a884]"
                  : "bg-[#f0f2f5] text-[#111b21] border-[#d1d7db]"
              }`}
            >
              {ord.orderNumber}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="block text-[11px] font-medium text-[#54656f] mb-0.5">
            Order ID *
          </label>
          <input
            type="text"
            required
            value={trackOrderId}
            onChange={(e) => {
              const val = e.target.value;
              setTrackOrderId(val);
              if (val.trim().toUpperCase().startsWith("CE")) {
                setTrackBrand("CLASSIC_EDGE_53");
              }
              if (trackProviderKey !== "CUSTOM" && !trackAwbNumber.trim()) {
                setTrackProviderUrl(
                  buildClientProviderTrackingUrl(trackProviderKey, val.trim())
                );
              }
            }}
            placeholder="CC-2609 or CE53-1042"
            className="w-full rounded border border-[#d1d7db] px-2.5 py-1.5 text-xs font-mono text-[#111b21]"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-[#54656f] mb-0.5">
            Store / Brand
          </label>
          <select
            value={trackBrand}
            onChange={(e) =>
              setTrackBrand(
                e.target.value as "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53"
              )
            }
            className="w-full rounded border border-[#d1d7db] bg-white px-2 py-1.5 text-xs text-[#111b21]"
          >
            <option value="CLASSIC_CONCEPTS">Classic Concepts</option>
            <option value="CLASSIC_EDGE_53">Classic Edge 53</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-[#54656f] mb-0.5">
            Courier Partner
          </label>
          <select
            value={trackProviderKey}
            onChange={(e) => {
              const nextProv = e.target.value;
              setTrackProviderKey(nextProv);
              if (nextProv !== "CUSTOM") {
                setTrackProviderUrl(
                  buildClientProviderTrackingUrl(
                    nextProv,
                    trackAwbNumber.trim() || trackOrderId.trim()
                  )
                );
              }
            }}
            className="w-full rounded border border-[#d1d7db] bg-white px-2 py-1.5 text-xs text-[#111b21]"
          >
            {SHIPPING_PROVIDER_OPTIONS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="block text-[11px] font-medium text-[#54656f] mb-0.5">
            AWB / LR Number
          </label>
          <input
            type="text"
            value={trackAwbNumber}
            onChange={(e) => {
              const awb = e.target.value;
              setTrackAwbNumber(awb);
              if (trackProviderKey !== "CUSTOM") {
                setTrackProviderUrl(
                  buildClientProviderTrackingUrl(
                    trackProviderKey,
                    awb.trim() || trackOrderId.trim()
                  )
                );
              }
            }}
            placeholder="Courier AWB or LR #"
            className="w-full rounded border border-[#d1d7db] px-2.5 py-1.5 text-xs font-mono text-[#111b21]"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[11px] font-medium text-[#54656f] mb-0.5">
            Courier Redirect URL (customer lands here)
          </label>
          <input
            type="url"
            value={trackProviderUrl}
            onChange={(e) => setTrackProviderUrl(e.target.value)}
            placeholder="https://www.delhivery.com/track/package/..."
            className="w-full rounded border border-[#d1d7db] px-2.5 py-1.5 text-xs font-mono text-[#111b21]"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="block text-[11px] font-medium text-[#54656f] mb-0.5">
            WhatsApp Button Text
          </label>
          <input
            type="text"
            maxLength={20}
            value={trackButtonLabel}
            onChange={(e) => setTrackButtonLabel(e.target.value)}
            placeholder="Track Order"
            className="w-full rounded border border-[#d1d7db] px-2.5 py-1.5 text-xs text-[#111b21]"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[11px] font-medium text-[#54656f] mb-0.5">
            Optional Custom Message (blank uses clean default)
          </label>
          <input
            type="text"
            value={trackMessageText}
            onChange={(e) => setTrackMessageText(e.target.value)}
            placeholder="Your order has been dispatched. Tap Track Order below for live status."
            className="w-full rounded border border-[#d1d7db] px-2.5 py-1.5 text-xs text-[#111b21]"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#f0f2f5]">
        <span className="text-[11px] font-mono text-[#008069] truncate">
          Button URL: {TRACKING_PUBLIC_ORIGIN}/
          {encodeURIComponent(trackOrderId.trim() || "{order-id}")}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const idSlug = encodeURIComponent(trackOrderId.trim());
              if (!idSlug) return;
              onInsertLinkOnly(`${TRACKING_PUBLIC_ORIGIN}/${idSlug}`);
            }}
            className="px-2.5 py-1.5 rounded border border-[#d1d7db] bg-[#f8f9fa] hover:bg-neutral-100 text-[11px] font-medium text-[#3b4a54] cursor-pointer"
          >
            Insert Link Only
          </button>
          <button
            type="submit"
            disabled={sendingTrackBtn || !trackOrderId.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {sendingTrackBtn ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Truck className="w-3.5 h-3.5" />
            )}
            <span>
              {sendingTrackBtn ? "Sending..." : "Send Track Button in Chat"}
            </span>
          </button>
        </div>
      </div>
    </form>
  );
}

export function LocationPinPopover({
  location,
  sendingLocationPin,
  onInsertText,
  onSendNow,
  onClose,
}: {
  location: VerifiedLocationInfo;
  sendingLocationPin: boolean;
  onInsertText: () => void;
  onSendNow: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-full left-2 right-2 sm:left-4 sm:right-4 mb-1.5 z-30 rounded-lg bg-white border border-[#d1d7db] shadow-lg p-3 space-y-2.5 max-h-[68dvh] overflow-y-auto">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-full bg-emerald-100 text-[#008069] flex items-center justify-center shrink-0">
            <MapPin className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#111b21]">
              Share Verified Factory Location &amp; Google Maps Link
            </div>
            <div className="text-[11px] text-[#54656f] truncate">
              {location.placeName}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-neutral-100 text-[#667781] cursor-pointer shrink-0"
          aria-label="Close location sharing"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="rounded-md bg-[#f0f2f5] border border-[#e2e8f0] p-2.5 text-[11.5px] text-[#111b21] space-y-1">
        <div>{location.address}</div>
        <div className="text-[#54656f]">
          Hours: {location.businessHours} | Phone: {location.phone}
        </div>
        <div className="font-mono text-[11px] text-[#008069] break-all">
          {location.mapsUrl}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onInsertText}
          className="px-3 py-1.5 rounded-md border border-[#d1d7db] bg-white hover:bg-[#f0f2f5] text-[#111b21] text-xs font-medium cursor-pointer"
        >
          Insert Address + Maps Link
        </button>
        <button
          type="button"
          disabled={sendingLocationPin}
          onClick={onSendNow}
          className="px-3.5 py-1.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          {sendingLocationPin ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <MapPin className="w-3.5 h-3.5" />
          )}
          <span>
            {sendingLocationPin ? "Sending Pin & Link..." : "Send Pin + Maps Link Now"}
          </span>
        </button>
      </div>
    </div>
  );
}

export function ShortLinksPopover({
  links,
  onSelectLink,
  onClose,
}: {
  links: ConversationDetailBundle["customLinks"];
  onSelectLink: (formattedUrl: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState<"ALL" | "CC" | "CE53">("ALL");

  return (
    <div className="absolute bottom-full left-2 right-2 sm:left-4 sm:right-4 mb-1.5 z-30 rounded-lg bg-white border border-[#d1d7db] shadow-lg p-3 space-y-2 max-h-[68dvh] overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[11px]">
          {(
            [
              { key: "ALL", label: "All Links" },
              { key: "CC", label: "Classic Concepts" },
              { key: "CE53", label: "Classic Edge 53" },
            ] as const
          ).map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => setBrandFilter(tb.key)}
              className={`px-2 py-0.5 rounded font-medium cursor-pointer ${
                brandFilter === tb.key
                  ? "bg-[#00a884] text-white"
                  : "bg-[#f0f2f5] text-[#54656f] hover:text-[#111b21]"
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-neutral-100 text-[#667781] cursor-pointer"
          aria-label="Close short links picker"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-[#667781] absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Classic Concepts or Classic Edge 53 product, SKU, or ccapl.cc code..."
          className="w-full rounded-md border border-[#d1d7db] pl-8 pr-3 py-1.5 text-xs text-[#111b21] focus:outline-none focus:border-[#00a884]"
        />
      </div>
      <div className="max-h-48 overflow-y-auto divide-y divide-[#f0f2f5]">
        {links
          .filter((lnk) => {
            const isCe =
              lnk.utmCampaign === "auto_classicedge53" ||
              lnk.code.startsWith("ce53-");
            const isCc =
              lnk.utmCampaign === "auto_classicconcepts" ||
              lnk.code.startsWith("cc-");
            if (brandFilter === "CE53" && !isCe) return false;
            if (brandFilter === "CC" && !isCc) return false;
            const q = query.trim().toLowerCase();
            if (!q) return true;
            return `${lnk.title} ${lnk.code} ${lnk.targetUrl}`
              .toLowerCase()
              .includes(q);
          })
          .slice(0, 60)
          .map((lnk) => (
            <button
              key={lnk.id}
              type="button"
              onClick={() => onSelectLink(formatShortLinkUrl(lnk.code))}
              className="w-full text-left py-1.5 px-2 hover:bg-[#f0f2f5] rounded flex items-center justify-between gap-2 text-xs cursor-pointer"
            >
              <span className="font-medium text-[#111b21] truncate">
                {lnk.title}
              </span>
              <span className="font-mono text-[11px] text-[#008069] shrink-0">
                {SHORTLINK_PUBLIC_DOMAIN}/{lnk.code}
              </span>
            </button>
          ))}
      </div>
    </div>
  );
}
