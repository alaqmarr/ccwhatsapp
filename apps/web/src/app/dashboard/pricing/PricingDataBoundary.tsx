import React from "react";
import { loadCostBreakdownPayload } from "@/lib/loaders/core";
import { PricingClient } from "./PricingClient";

type PricingUser = Parameters<typeof loadCostBreakdownPayload>[0];

export async function PricingDataBoundary({ user }: { user: PricingUser }) {
  const initialData = await loadCostBreakdownPayload(user);
  return <PricingClient initialData={initialData} />;
}
