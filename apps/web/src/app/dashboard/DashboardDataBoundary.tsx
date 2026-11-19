import React from "react";
import type { AuthenticatedUser } from "@cc/auth";
import { loadDashboardPayload } from "@/lib/loaders/core";
import { DashboardClient } from "./DashboardClient";

export async function DashboardDataBoundary({
  user,
}: {
  user: AuthenticatedUser;
}) {
  const initialData = await loadDashboardPayload(user);
  return <DashboardClient initialData={initialData} />;
}
