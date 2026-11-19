"use client";

import React from "react";
import { Plus, Truck, X } from "lucide-react";
import {
  SHIPPING_PROVIDER_OPTIONS,
  buildClientProviderTrackingUrl,
} from "@cc/ui";
import { STATUS_OPTIONS } from "./tracking-types";

export function TrackingFormCard({
  editingOrderId,
  resetForm,
  orderIdInput,
  setOrderIdInput,
  brandInput,
  setBrandInput,
  providerKeyInput,
  setProviderKeyInput,
  awbInput,
  setAwbInput,
  providerUrlInput,
  setProviderUrlInput,
  statusInput,
  setStatusInput,
  customerNameInput,
  setCustomerNameInput,
  customerPhoneInput,
  setCustomerPhoneInput,
  itemsInput,
  setItemsInput,
  trackingOrigin,
  saving,
  onSubmit,
}: {
  editingOrderId: string | null;
  resetForm: () => void;
  orderIdInput: string;
  setOrderIdInput: (v: string) => void;
  brandInput: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  setBrandInput: (v: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53") => void;
  providerKeyInput: string;
  setProviderKeyInput: (v: string) => void;
  awbInput: string;
  setAwbInput: (v: string) => void;
  providerUrlInput: string;
  setProviderUrlInput: (v: string) => void;
  statusInput: string;
  setStatusInput: (v: string) => void;
  customerNameInput: string;
  setCustomerNameInput: (v: string) => void;
  customerPhoneInput: string;
  setCustomerPhoneInput: (v: string) => void;
  itemsInput: string;
  setItemsInput: (v: string) => void;
  trackingOrigin: string;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs space-y-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-[#00a884]" />
          <h2 className="text-sm font-bold text-neutral-900">
            {editingOrderId
              ? `Update Order Tracking: ${editingOrderId}`
              : "Create or Update Dynamic Order Tracking Link"}
          </h2>
        </div>
        {editingOrderId && (
          <button
            type="button"
            onClick={resetForm}
            className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 hover:text-neutral-900 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Cancel Edit</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Order ID *
          </label>
          <input
            type="text"
            required
            value={orderIdInput}
            onChange={(e) => {
              const val = e.target.value;
              setOrderIdInput(val);
              if (val.trim().toUpperCase().startsWith("CE")) {
                setBrandInput("CLASSIC_EDGE_53");
              }
              if (providerKeyInput !== "CUSTOM" && !awbInput.trim()) {
                setProviderUrlInput(
                  buildClientProviderTrackingUrl(providerKeyInput, val.trim())
                );
              }
            }}
            placeholder="CC-2609 or CE53-1042"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Brand / Store
          </label>
          <select
            value={brandInput}
            onChange={(e) =>
              setBrandInput(
                e.target.value as "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53"
              )
            }
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs"
          >
            <option value="CLASSIC_CONCEPTS">Classic Concepts</option>
            <option value="CLASSIC_EDGE_53">Classic Edge 53</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Shipping Provider
          </label>
          <select
            value={providerKeyInput}
            onChange={(e) => {
              const prov = e.target.value;
              setProviderKeyInput(prov);
              if (prov !== "CUSTOM") {
                setProviderUrlInput(
                  buildClientProviderTrackingUrl(
                    prov,
                    awbInput.trim() || orderIdInput.trim()
                  )
                );
              }
            }}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs"
          >
            {SHIPPING_PROVIDER_OPTIONS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            AWB / LR Number
          </label>
          <input
            type="text"
            value={awbInput}
            onChange={(e) => {
              const awb = e.target.value;
              setAwbInput(awb);
              if (providerKeyInput !== "CUSTOM") {
                setProviderUrlInput(
                  buildClientProviderTrackingUrl(
                    providerKeyInput,
                    awb.trim() || orderIdInput.trim()
                  )
                );
              }
            }}
            placeholder="Courier AWB or LR #"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs font-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Courier Tracking Redirect URL (customer is sent here)
          </label>
          <input
            type="url"
            value={providerUrlInput}
            onChange={(e) => setProviderUrlInput(e.target.value)}
            placeholder="https://www.delhivery.com/track/package/..."
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Shipment Status
          </label>
          <select
            value={statusInput}
            onChange={(e) => setStatusInput(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs"
          >
            {STATUS_OPTIONS.map((st) => (
              <option key={st} value={st}>
                {st.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Customer Name (optional)
          </label>
          <input
            type="text"
            value={customerNameInput}
            onChange={(e) => setCustomerNameInput(e.target.value)}
            placeholder="Customer or company"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Customer WhatsApp Phone (optional)
          </label>
          <input
            type="text"
            value={customerPhoneInput}
            onChange={(e) => setCustomerPhoneInput(e.target.value)}
            placeholder="+91 98480 00000"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-neutral-700 mb-1">
            Items Summary (optional, shown if courier AWB is not yet assigned)
          </label>
          <input
            type="text"
            value={itemsInput}
            onChange={(e) => setItemsInput(e.target.value)}
            placeholder="Clear Acrylic Podiums x4 or YN-JW1200 Flame Polisher"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-neutral-100">
        <div className="text-xs text-neutral-600">
          Short link preview:{" "}
          <span className="font-mono font-semibold text-[#008069]">
            {trackingOrigin}/
            {encodeURIComponent(orderIdInput.trim() || "{order-id}")}
          </span>
        </div>
        <button
          type="submit"
          disabled={saving || !orderIdInput.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
        >
          <Truck className="w-3.5 h-3.5" />
          <span>
            {saving
              ? "Saving..."
              : editingOrderId
              ? "Save Tracking Changes"
              : "Save Tracking Link"}
          </span>
        </button>
      </div>
    </form>
  );
}
