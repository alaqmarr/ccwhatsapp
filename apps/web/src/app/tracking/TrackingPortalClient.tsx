"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Package,
  Search,
  ShieldCheck,
  Truck,
  AlertCircle,
} from "lucide-react";
import {
  ClassicConceptsWordmark,
  WhatsAppLogoIcon,
} from "@cc/ui";

interface PublicTrackingData {
  orderId: string;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  brandLabel: string;
  itemsSummary: string;
  providerCode: string;
  providerName: string;
  awbNumber: string;
  providerTrackingUrl: string | null;
  publicTrackingUrl: string;
  shipmentStatus: string;
  estimatedDelivery: string | null;
  updatedAt: string;
}

const STATUS_STEPS = [
  { key: "ORDER_CONFIRMED", label: "Order Confirmed" },
  { key: "IN_PRODUCTION", label: "In Workshop" },
  { key: "DISPATCHED", label: "Dispatched" },
  { key: "DELIVERED", label: "Delivered" },
] as const;

function getStepIndex(status: string): number {
  if (status === "DELIVERED") return 3;
  if (
    status === "DISPATCHED" ||
    status === "IN_TRANSIT" ||
    status === "OUT_FOR_DELIVERY"
  ) {
    return 2;
  }
  if (status === "IN_PRODUCTION" || status === "READY_FOR_DISPATCH") {
    return 1;
  }
  return 0;
}

function formatStatusLabel(status: string): string {
  switch (status) {
    case "ORDER_CONFIRMED":
      return "Order Confirmed";
    case "IN_PRODUCTION":
      return "In Workshop Production";
    case "READY_FOR_DISPATCH":
      return "Packed & Ready for Dispatch";
    case "DISPATCHED":
      return "Dispatched with Courier";
    case "IN_TRANSIT":
      return "In Transit";
    case "OUT_FOR_DELIVERY":
      return "Out for Delivery";
    case "DELIVERED":
      return "Delivered";
    default:
      return status;
  }
}

export function TrackingPortalClient({
  initialOrderId = "",
  initialNotFound = false,
  initialTracking = null,
}: {
  initialOrderId?: string;
  initialNotFound?: boolean;
  initialTracking?: PublicTrackingData | null;
}) {
  const [orderInput, setOrderInput] = useState(initialOrderId);
  const [brandFilter, setBrandFilter] = useState<
    "AUTO" | "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53"
  >("AUTO");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notFoundId, setNotFoundId] = useState<string | null>(
    initialNotFound && initialOrderId ? initialOrderId : null
  );
  const [tracking, setTracking] = useState<PublicTrackingData | null>(
    initialTracking
  );
  const [redirectingTo, setRedirectingTo] = useState<string | null>(null);

  useEffect(() => {
    if (
      initialTracking?.providerTrackingUrl &&
      /^https?:\/\//i.test(initialTracking.providerTrackingUrl)
    ) {
      setRedirectingTo(initialTracking.providerTrackingUrl);
      const timer = setTimeout(() => {
        window.location.assign(initialTracking.providerTrackingUrl!);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [initialTracking]);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = orderInput.trim();
    if (!trimmed) {
      setErrorMsg("Please enter your Classic Concepts or Classic Edge 53 Order ID.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setNotFoundId(null);
    setRedirectingTo(null);

    try {
      const res = await fetch("/api/tracking/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: trimmed,
          brand: brandFilter,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Could not look up your order right now.");
        setTracking(null);
        return;
      }

      if (!data.found || !data.tracking) {
        setTracking(null);
        setNotFoundId(trimmed);
        return;
      }

      setTracking(data.tracking);
      if (data.action === "REDIRECT" && data.redirectUrl) {
        setRedirectingTo(data.redirectUrl);
        setTimeout(() => {
          window.location.assign(data.redirectUrl);
        }, 450);
      }
    } catch {
      setErrorMsg("Network error while checking order status. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const activeStep = tracking ? getStepIndex(tracking.shipmentStatus) : 0;
  const waSupportUrl = `https://wa.me/917337220568?text=${encodeURIComponent(
    orderInput.trim()
      ? `Hello Classic Concepts team, please share the tracking status for my order ${orderInput.trim()}.`
      : "Hello Classic Concepts team, I need help tracking my order."
  )}`;

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 flex flex-col justify-between">
      {/* Top Brand Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="w-full px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ClassicConceptsWordmark height={40} variant="light" />
            <span className="hidden sm:inline-block h-5 w-px bg-slate-200" />
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-900 text-white tracking-tight">
              + Classic Edge 53
            </span>
          </div>
          <a
            href={waSupportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#25d366]/12 hover:bg-[#25d366]/20 text-[#008069] text-xs font-semibold transition-colors"
          >
            <WhatsAppLogoIcon size={14} />
            <span>WhatsApp Support</span>
          </a>
        </div>
      </header>

      {/* Main Order Lookup Card */}
      <main className="flex-1 flex items-center justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-xl space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 sm:p-8 space-y-6">
            <div className="space-y-2 text-center">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-[#00a884]/10 text-[#008069] flex items-center justify-center">
                <Truck className="w-6 h-6" />
              </div>
              <h1 className="font-display text-2xl sm:text-[28px] font-bold tracking-tight text-slate-900">
                Track Your Order
              </h1>
              <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
                Enter your <strong>Classic Concepts</strong> or{" "}
                <strong>Classic Edge 53</strong> Order ID below. We will look up
                your shipment and take you straight to your courier partner.
              </p>
            </div>

            <form onSubmit={handleLookup} className="space-y-4">
              {/* Brand Selector Pills */}
              <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 border border-slate-200/80 text-xs font-semibold">
                {(
                  [
                    { key: "AUTO", label: "All Orders" },
                    { key: "CLASSIC_CONCEPTS", label: "Classic Concepts" },
                    { key: "CLASSIC_EDGE_53", label: "Classic Edge 53" },
                  ] as const
                ).map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => setBrandFilter(b.key)}
                    className={`py-2 px-2 rounded-lg transition-all cursor-pointer truncate ${
                      brandFilter === b.key
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              {/* Order ID Input */}
              <div className="space-y-1.5">
                <label
                  htmlFor="order-id-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Order ID or AWB Number
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="order-id-input"
                    type="text"
                    value={orderInput}
                    onChange={(e) => setOrderInput(e.target.value)}
                    placeholder="Example: CC-2026-1089 or CE53-2026-401"
                    autoFocus
                    className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 py-3 text-sm font-mono font-medium text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:border-[#00a884] focus:ring-2 focus:ring-[#00a884]/15"
                  />
                </div>
              </div>

              {errorMsg && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-xl bg-[#00a884] hover:bg-[#008f6f] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer disabled:opacity-60"
              >
                <span>{loading ? "Looking up your shipment..." : "Track Order Now"}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            {/* Redirecting Banner */}
            {redirectingTo && tracking && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                      Shipment Found • {tracking.providerName}
                    </div>
                    <p className="text-sm font-medium text-emerald-950">
                      Opening live tracking for Order{" "}
                      <span className="font-mono font-bold">{tracking.orderId}</span>...
                    </p>
                    {tracking.awbNumber && (
                      <p className="text-xs text-emerald-800 font-mono">
                        Tracking / AWB: {tracking.awbNumber}
                      </p>
                    )}
                  </div>
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                </div>
                <a
                  href={redirectingTo}
                  className="w-full py-2.5 px-3.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <span>Continue to {tracking.providerName}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}

            {/* Workshop / Live Status Card (when order exists in CRM/Website before courier link) */}
            {tracking && !redirectingTo && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-[11px] font-semibold">
                      {tracking.brandLabel}
                    </span>
                    <span className="font-mono text-sm font-bold text-slate-900">
                      {tracking.orderId}
                    </span>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-900 text-xs font-semibold">
                    {formatStatusLabel(tracking.shipmentStatus)}
                  </span>
                </div>

                {/* Progress Steps */}
                <div className="grid grid-cols-4 gap-2 pt-1">
                  {STATUS_STEPS.map((st, idx) => {
                    const done = idx <= activeStep;
                    return (
                      <div key={st.key} className="space-y-1.5">
                        <div
                          className={`h-1.5 rounded-full ${
                            done ? "bg-[#00a884]" : "bg-slate-200"
                          }`}
                        />
                        <div
                          className={`text-[11px] font-medium leading-tight ${
                            done ? "text-slate-900 font-semibold" : "text-slate-400"
                          }`}
                        >
                          {st.label}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {tracking.itemsSummary && (
                  <div className="flex items-start gap-2 text-xs text-slate-700 bg-white p-3 rounded-lg border border-slate-200/80">
                    <Package className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                    <span>{tracking.itemsSummary}</span>
                  </div>
                )}

                {tracking.providerTrackingUrl ? (
                  <a
                    href={tracking.providerTrackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    <span>Open {tracking.providerName} Live Tracking</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <div className="flex items-start gap-2 text-xs text-slate-600">
                    <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      Your order is currently being prepared by our workshop team.
                      As soon as the courier picks it up, this same link will take
                      you directly to live courier tracking.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Not Found Help Card */}
            {notFoundId && !tracking && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-amber-950 font-semibold text-xs">
                  <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>
                    No shipment found for Order ID{" "}
                    <code className="font-mono font-bold">{notFoundId}</code>
                  </span>
                </div>
                <p className="text-xs text-amber-900 leading-relaxed">
                  Please check the Order ID shared on your invoice or WhatsApp
                  confirmation, or tap below to message our dispatch desk directly.
                </p>
                <a
                  href={waSupportUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold"
                >
                  <WhatsAppLogoIcon size={13} />
                  <span>Ask Dispatch Desk on WhatsApp</span>
                </a>
              </div>
            )}
          </div>

          {/* Trust Footer Note */}
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#00a884]" />
              <span>Official Shipment Portal for Classic Concepts & Classic Edge 53</span>
            </span>
          </div>
        </div>
      </main>

      <footer className="py-4 text-center text-xs text-slate-400 border-t border-slate-200/70 bg-white">
        Classic Concepts Acrylic Private Limited • Hyderabad, India
      </footer>
    </div>
  );
}
