"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { RefreshCw, X } from "lucide-react";
import {
  parseRealtimeEventPayload,
  subscribeRealtimeEvent,
} from "@/lib/realtime-client";

const POLL_INTERVAL_MS = 45_000;

export function AppUpdateBanner() {
  const pathname = usePathname();
  const baselineBuildRef = useRef<string | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [minimized, setMinimized] = useState<boolean>(false);
  const [reloading, setReloading] = useState<boolean>(false);

  const observeBuildId = useCallback((observed: unknown) => {
    const clean = typeof observed === "string" ? observed.trim() : "";
    if (!clean) return;
    if (!baselineBuildRef.current) {
      baselineBuildRef.current = clean;
      return;
    }
    if (baselineBuildRef.current !== clean) {
      setUpdateAvailable(true);
    }
  }, []);

  const checkServerVersion = useCallback(async () => {
    if (typeof window === "undefined" || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch(`/api/version?t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (!res.ok) return;
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        buildId?: string;
      } | null;
      if (json?.ok && json.buildId) {
        observeBuildId(json.buildId);
      }
    } catch {
      // Ignore transient network errors while server is restarting
    } finally {
      inFlightRef.current = false;
    }
  }, [observeBuildId]);

  useEffect(() => {
    void checkServerVersion();

    const timer = window.setInterval(() => {
      void checkServerVersion();
    }, POLL_INTERVAL_MS);

    const onWake = () => {
      if (document.visibilityState === "hidden") return;
      void checkServerVersion();
    };
    const onChunkOrDeployError = (event: ErrorEvent | PromiseRejectionEvent) => {
      const text =
        event instanceof ErrorEvent
          ? String(event.message || "")
          : String(event.reason?.message || event.reason || "");
      if (
        /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module/i.test(
          text
        )
      ) {
        void checkServerVersion();
      }
    };

    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("error", onChunkOrDeployError);
    window.addEventListener("unhandledrejection", onChunkOrDeployError);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("error", onChunkOrDeployError);
      window.removeEventListener("unhandledrejection", onChunkOrDeployError);
    };
  }, [checkServerVersion]);

  useEffect(() => {
    if (!pathname || !pathname.startsWith("/dashboard")) return;
    const unsubConnected = subscribeRealtimeEvent("connected", (ev) => {
      const payload = parseRealtimeEventPayload(ev);
      if (payload.buildId) {
        observeBuildId(payload.buildId);
      }
    });
    return () => {
      unsubConnected();
    };
  }, [pathname, observeBuildId]);

  function handleRefreshPage() {
    setReloading(true);
    window.location.reload();
  }

  if (!updateAvailable) return null;

  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-[1200]">
        <button
          type="button"
          onClick={handleRefreshPage}
          disabled={reloading}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold shadow-lg cursor-pointer disabled:opacity-70"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${reloading ? "animate-spin" : ""}`} />
          <span>{reloading ? "Refreshing..." : "New update released · Refresh Page"}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[1200] w-[calc(100%-1.5rem)] max-w-2xl"
    >
      <div className="bg-white border-2 border-[#00a884] rounded-xl shadow-xl px-4 py-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-200 text-[#008f6f] flex items-center justify-center shrink-0">
            <RefreshCw className={`w-4 h-4 ${reloading ? "animate-spin" : ""}`} />
          </div>
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-bold text-slate-900">
              New update released
            </div>
            <p className="text-xs text-slate-600 leading-snug">
              A new update has been released. Please refresh the page to load the latest changes.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <button
            type="button"
            onClick={handleRefreshPage}
            disabled={reloading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold shadow-2xs cursor-pointer disabled:opacity-70 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reloading ? "animate-spin" : ""}`} />
            <span>{reloading ? "Refreshing..." : "Refresh Page"}</span>
          </button>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            aria-label="Minimize update alert"
            title="Minimize for a moment"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
