"use client";

import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

const globalForQuery = globalThis as unknown as { __ccBrowserQueryClient?: QueryClient };

function getBrowserQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    return makeQueryClient();
  }
  if (!globalForQuery.__ccBrowserQueryClient) {
    globalForQuery.__ccBrowserQueryClient = makeQueryClient();
  }
  return globalForQuery.__ccBrowserQueryClient;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => getBrowserQueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
