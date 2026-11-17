"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  Edit3,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import {
  ElementErrorState,
  MetricStatCard,
  SHIPPING_PROVIDER_OPTIONS,
  StatCardsSkeleton,
  TRACKING_PUBLIC_DOMAIN,
  TRACKING_PUBLIC_ORIGIN,
  TRACKING_SECONDARY_DOMAIN,
  TableRowsSkeleton,
  buildClientProviderTrackingUrl,
} from "@cc/ui";

interface OrderTrackingRow {
  id: string;
  orderId: string;
  lookupKey: string;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  brandLabel: string;
  customerName: string;
  customerPhone: string;
  providerCode: string;
  providerName: string;
  awbNumber: string;
  providerTrackingUrl: string;
  publicTrackingUrl: string;
  shipmentStatus: string;
  itemsSummary: string;
  lookupsCount: number;
  lastLookedUpAt: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_OPTIONS = [
  "DISPATCHED",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "ORDER_CONFIRMED",
  "IN_PRODUCTION",
  "READY_TO_SHIP",
] as const;

export function TrackingClient({
  initialData,
}: {
  initialData?: {
    trackingOrigin: string;
    trackings: OrderTrackingRow[];
  };
}) {
  const [rows, setRows] = useState<OrderTrackingRow[]>(
    initialData?.trackings ?? []
  );
  const [trackingOrigin, setTrackingOrigin] = useState<string>(
    initialData?.trackingOrigin || TRACKING_PUBLIC_ORIGIN
  );
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [toast, setToast] = useState<string>("");

  const [query, setQuery] = useState<string>("");
  const [brandFilter, setBrandFilter] = useState<
    "ALL" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53"
  >("ALL");

  // Create / Edit form state
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [orderIdInput, setOrderIdInput] = useState<string>("");
  const [brandInput, setBrandInput] = useState<
    "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53"
  >("CLASSIC_CONCEPTS");
  const [providerKeyInput, setProviderKeyInput] =
    useState<string>("DELHIVERY");
  const [awbInput, setAwbInput] = useState<string>("");
  const [providerUrlInput, setProviderUrlInput] = useState<string>("");
  const [statusInput, setStatusInput] = useState<string>("DISPATCHED");
  const [customerNameInput, setCustomerNameInput] = useState<string>("");
  const [customerPhoneInput, setCustomerPhoneInput] = useState<string>("");
  const [itemsInput, setItemsInput] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }, []);

  const fetchTrackings = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    setError("");
    try {
      const res = await fetch("/api/tracking?limit=500", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not load order tracking links.");
        return;
      }
      setRows(Array.isArray(data.trackings) ? data.trackings : []);
      if (data.trackingOrigin) setTrackingOrigin(String(data.trackingOrigin));
    } catch {
      setError("Network error while loading order tracking links.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!initialData) {
      void fetchTrackings(false);
    }
  }, [initialData, fetchTrackings]);

  function resetForm() {
    setEditingOrderId(null);
    setOrderIdInput("");
    setBrandInput("CLASSIC_CONCEPTS");
    setProviderKeyInput("DELHIVERY");
    setAwbInput("");
    setProviderUrlInput("");
    setStatusInput("DISPATCHED");
    setCustomerNameInput("");
    setCustomerPhoneInput("");
    setItemsInput("");
  }

  function startEdit(row: OrderTrackingRow) {
    setEditingOrderId(row.orderId);
    setOrderIdInput(row.orderId);
    setBrandInput(row.brand);
    setProviderKeyInput(row.providerCode || "CUSTOM");
    setAwbInput(row.awbNumber || "");
    setProviderUrlInput(row.providerTrackingUrl || "");
    setStatusInput(row.shipmentStatus || "DISPATCHED");
    setCustomerNameInput(row.customerName || "");
    setCustomerPhoneInput(row.customerPhone || "");
    setItemsInput(row.itemsSummary || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const cleanId = orderIdInput.trim();
    if (!cleanId) return;

    const finalUrl =
      providerUrlInput.trim() ||
      buildClientProviderTrackingUrl(
        providerKeyInput,
        awbInput.trim() || cleanId
      );

    setSaving(true);
    try {
      const res = await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: cleanId,
          brand: brandInput,
          customerName: customerNameInput.trim(),
          customerPhone: customerPhoneInput.trim(),
          providerCode: providerKeyInput,
          awbNumber: awbInput.trim(),
          providerTrackingUrl: finalUrl,
          shipmentStatus: statusInput,
          itemsSummary: itemsInput.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showToast(data.error || "Could not save order tracking link.");
        return;
      }
      showToast(
        `Saved ${data.tracking?.publicTrackingUrl || `${trackingOrigin}/${cleanId}`}`
      );
      resetForm();
      await fetchTrackings(false);
    } catch {
      showToast("Network error while saving tracking link.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: OrderTrackingRow) {
    if (
      !window.confirm(
        `Delete tracking link for Order ${row.orderId}?`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(
        `/api/tracking?id=${encodeURIComponent(row.id)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showToast(data.error || "Could not delete tracking record.");
        return;
      }
      showToast(`Deleted tracking record for ${row.orderId}.`);
      await fetchTrackings(false);
    } catch {
      showToast("Network error while deleting tracking record.");
    }
  }

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (brandFilter !== "ALL" && r.brand !== brandFilter) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return `${r.orderId} ${r.customerName || ""} ${r.customerPhone || ""} ${r.providerName} ${r.awbNumber || ""} ${r.itemsSummary || ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [rows, brandFilter, query]);

  const stats = useMemo(() => {
    const total = rows.length;
    const ccCount = rows.filter((r) => r.brand === "CLASSIC_CONCEPTS").length;
    const ceCount = rows.filter((r) => r.brand === "CLASSIC_EDGE_53").length;
    const lookups = rows.reduce((sum, r) => sum + (r.lookupsCount || 0), 0);
    return { total, ccCount, ceCount, lookups };
  }, [rows]);

  return (
    <div className="w-full px-4 sm:px-6 py-5 space-y-6">
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg bg-neutral-900 text-white px-4 py-2.5 text-xs font-medium shadow-lg flex items-center gap-2">
          <Check className="w-4 h-4 text-[#00a884]" />
          <span>{toast}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#008069] bg-[#e7fce3] px-2.5 py-1 rounded-full mb-2">
            <Truck className="w-3.5 h-3.5" />
            <span>
              {TRACKING_PUBLIC_DOMAIN} &amp; {TRACKING_SECONDARY_DOMAIN}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Dynamic Order Tracking Links
          </h1>
          <p className="text-sm text-neutral-600 mt-1">
            Create{" "}
            <span className="font-mono text-neutral-800">
              {TRACKING_PUBLIC_DOMAIN}/{"{order-id}"}
            </span>{" "}
            links for Classic Concepts and Classic Edge 53 orders. Customers who
            tap the WhatsApp Track Order button or enter their Order ID on{" "}
            <span className="font-mono text-neutral-800">
              {TRACKING_SECONDARY_DOMAIN}
            </span>{" "}
            are automatically redirected to the courier tracking page.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/tracking"
            target="_blank"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-800"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#008069]" />
            <span>Open Public /tracking Portal</span>
          </Link>
          <button
            type="button"
            onClick={() => void fetchTrackings(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      {loading ? (
        <StatCardsSkeleton count={4} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricStatCard
            label="Active Tracking Links"
            value={String(stats.total)}
            subtext={`${TRACKING_PUBLIC_DOMAIN}/{id}`}
          />
          <MetricStatCard
            label="Classic Concepts Orders"
            value={String(stats.ccCount)}
            subtext="Acrylic displays & podiums"
          />
          <MetricStatCard
            label="Classic Edge 53 Orders"
            value={String(stats.ceCount)}
            subtext="Machines, blades & tools"
          />
          <MetricStatCard
            label="Customer Track Clicks"
            value={String(stats.lookups)}
            subtext="WhatsApp button & portal lookups"
          />
        </div>
      )}

      {/* Create / Update Form */}
      <form
        onSubmit={handleSave}
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
                    buildClientProviderTrackingUrl(
                      providerKeyInput,
                      val.trim()
                    )
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

      {/* Search & Brand Filter + Table */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {(
              [
                { key: "ALL", label: "All Brands" },
                { key: "CLASSIC_CONCEPTS", label: "Classic Concepts" },
                { key: "CLASSIC_EDGE_53", label: "Classic Edge 53" },
              ] as const
            ).map((tb) => (
              <button
                key={tb.key}
                type="button"
                onClick={() => setBrandFilter(tb.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  brandFilter === tb.key
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                }`}
              >
                {tb.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Order ID, AWB, courier, customer..."
              className="w-full rounded-lg border border-neutral-300 pl-8 pr-3 py-1.5 text-xs"
            />
          </div>
        </div>

        {error ? (
          <div className="p-6">
            <ElementErrorState
              title="Could not load tracking links"
              message={error}
              onRetry={() => fetchTrackings(true)}
              retrying={refreshing}
            />
          </div>
        ) : loading ? (
          <div className="p-4">
            <TableRowsSkeleton rows={5} />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Truck className="w-8 h-8 text-neutral-300 mx-auto" />
            <p className="text-sm font-semibold text-neutral-800">
              No order tracking links found
            </p>
            <p className="text-xs text-neutral-500 max-w-md mx-auto">
              Add an Order ID above or click Send Track Button directly inside
              any WhatsApp conversation in Customer Chats.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 uppercase text-[11px]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Order ID &amp; Link</th>
                  <th className="px-4 py-3 font-semibold">Brand</th>
                  <th className="px-4 py-3 font-semibold">Courier &amp; AWB</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold text-right">Clicks</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filteredRows.map((row) => {
                  const publicLink = `${trackingOrigin}/${encodeURIComponent(row.orderId)}`;
                  return (
                    <tr key={row.id} className="hover:bg-neutral-50/70">
                      <td className="px-4 py-3">
                        <div className="font-mono font-bold text-neutral-900">
                          {row.orderId}
                        </div>
                        <div className="font-mono text-[11px] text-[#008069] truncate max-w-[230px]">
                          {publicLink}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                            row.brand === "CLASSIC_EDGE_53"
                              ? "bg-amber-50 text-amber-900 border border-amber-200"
                              : "bg-red-50 text-red-800 border border-red-200"
                          }`}
                        >
                          {row.brand === "CLASSIC_EDGE_53"
                            ? "Classic Edge 53"
                            : "Classic Concepts"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-neutral-900">
                          {row.providerName}
                        </div>
                        {row.awbNumber && (
                          <div className="font-mono text-[11px] text-neutral-600">
                            AWB: {row.awbNumber}
                          </div>
                        )}
                        {row.providerTrackingUrl && (
                          <a
                            href={row.providerTrackingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:underline mt-0.5"
                          >
                            <span>Open Courier URL</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[11px]">
                          {row.shipmentStatus.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-neutral-800">
                          {row.customerName || "Direct Order"}
                        </div>
                        {row.customerPhone && (
                          <div className="text-[11px] text-neutral-500">
                            {row.customerPhone}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-neutral-800">
                        {row.lookupsCount}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard?.writeText(publicLink);
                              showToast(`Copied ${publicLink}`);
                            }}
                            title="Copy track.ccapl.cc link"
                            className="p-1.5 rounded hover:bg-neutral-100 text-neutral-600 hover:text-neutral-900 cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <a
                            href={`/tracking/${encodeURIComponent(row.orderId)}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Test live redirect"
                            className="p-1.5 rounded hover:bg-neutral-100 text-[#008069]"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            title="Edit courier or AWB"
                            className="p-1.5 rounded hover:bg-neutral-100 text-neutral-600 hover:text-neutral-900 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(row)}
                            title="Delete tracking record"
                            className="p-1.5 rounded hover:bg-red-50 text-neutral-500 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
