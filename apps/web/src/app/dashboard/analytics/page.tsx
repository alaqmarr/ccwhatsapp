import type React from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { loadAnalyticsPayload } from "@/lib/loaders/analytics";
import { getCurrentUser } from "@/lib/session";
import { AnalyticsClient } from "./AnalyticsClient";

export const dynamic = "force-dynamic";

export default async function AnalyticsDashboardPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "analytics:view", user.status)) {
    redirect("/dashboard/inbox");
  }

  const initialData = await loadAnalyticsPayload(user, {
    range: "30d",
    teamId: "ALL",
  });
  return (
    <AnalyticsClient
      initialData={
        initialData as React.ComponentProps<typeof AnalyticsClient>["initialData"]
      }
    />
  );
}
