"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, RefreshCw, Truck } from "lucide-react";
import {
  MetricStatCard,
  StatCardsSkeleton,
  TRACKING_PUBLIC_DOMAIN,
  TRACKING_PUBLIC_ORIGIN,
  TRACKING_SECONDARY_DOMAIN,
  buildClientProviderTrackingUrl,
} from "@cc/ui";
import type { OrderTrackingRow } from "./tracking-types";
import { TrackingFormCard } from "./TrackingFormCard";
import { TrackingTableCard } from "./TrackingTableCard";

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
    if (!window.confirm(`Delete tracking link for Order ${row.orderId}?`)) {
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
        <div className="fixed bottom-4 left-3 right-3 sm:left-auto sm:right-5 sm:max-w-sm z-50 rounded-lg bg-neutral-900 text-white px-4 py-2.5 text-xs font-medium shadow-lg flex items-center justify-center sm:justify-start gap-2 [overflow-wrap:anywhere]">
          <Check className="w-4 h-4 text-[#00a884] shrink-0" />
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

      <TrackingFormCard
        editingOrderId={editingOrderId}
        resetForm={resetForm}
        orderIdInput={orderIdInput}
        setOrderIdInput={setOrderIdInput}
        brandInput={brandInput}
        setBrandInput={setBrandInput}
        providerKeyInput={providerKeyInput}
        setProviderKeyInput={setProviderKeyInput}
        awbInput={awbInput}
        setAwbInput={setAwbInput}
        providerUrlInput={providerUrlInput}
        setProviderUrlInput={setProviderUrlInput}
        statusInput={statusInput}
        setStatusInput={setStatusInput}
        customerNameInput={customerNameInput}
        setCustomerNameInput={setCustomerNameInput}
        customerPhoneInput={customerPhoneInput}
        setCustomerPhoneInput={setCustomerPhoneInput}
        itemsInput={itemsInput}
        setItemsInput={setItemsInput}
        trackingOrigin={trackingOrigin}
        saving={saving}
        onSubmit={handleSave}
      />

      <TrackingTableCard
        brandFilter={brandFilter}
        setBrandFilter={setBrandFilter}
        query={query}
        setQuery={setQuery}
        error={error}
        loading={loading}
        refreshing={refreshing}
        filteredRows={filteredRows}
        trackingOrigin={trackingOrigin}
        onRetry={() => void fetchTrackings(true)}
        onCopyLink={(publicLink) => {
          void navigator.clipboard?.writeText(publicLink);
          showToast(`Copied ${publicLink}`);
        }}
        onEdit={startEdit}
        onDelete={(row) => void handleDelete(row)}
      />
    </div>
  );
}
