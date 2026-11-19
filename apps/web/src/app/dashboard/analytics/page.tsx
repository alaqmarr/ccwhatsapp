import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import AnalyticsLoading from "./loading";
import { AnalyticsDataBoundary } from "./AnalyticsDataBoundary";

export const dynamic = "force-dynamic";

export default async function AnalyticsDashboardPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "analytics:view", user.status)) {
    redirect("/dashboard/inbox");
  }

  return (
    <Suspense fallback={<AnalyticsLoading />}>
      <AnalyticsDataBoundary user={user} />
    </Suspense>
  );
}
