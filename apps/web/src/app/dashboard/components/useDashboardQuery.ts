"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { subscribeRealtimeEvent } from "@/lib/realtime-client";
import type { DashboardData } from "./types";

const DASHBOARD_QUERY_KEY = ["dashboard", "overview"] as const;

const REALTIME_DASHBOARD_EVENTS = [
  "message:new",
  "note:new",
  "conversation:assigned",
  "conversation:resolved",
  "conversation:updated",
  "callback:new",
  "staff:mention",
  "enquiry:new",
  "enquiry:updated",
] as const;

async function fetchDashboardData(): Promise<DashboardData> {
  const res = await fetch("/api/dashboard", { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || "Could not load dashboard");
  }
  return json as DashboardData;
}

export function useDashboardQuery(initialData?: DashboardData) {
  const queryClient = useQueryClient();

  const query = useQuery<DashboardData, Error>({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: fetchDashboardData,
    initialData,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleInvalidate = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY });
      }, 1500);
    };

    const unsubs = REALTIME_DASHBOARD_EVENTS.map((eventName) =>
      subscribeRealtimeEvent(eventName, scheduleInvalidate)
    );

    return () => {
      if (debounce) {
        clearTimeout(debounce);
        debounce = null;
      }
      unsubs.forEach((fn) => fn());
    };
  }, [queryClient]);

  const invalidateDashboard = () =>
    queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY });

  return {
    data: query.data ?? null,
    error: query.error?.message ?? "",
    isFetching: query.isFetching,
    refetch: query.refetch,
    invalidateDashboard,
  };
}
