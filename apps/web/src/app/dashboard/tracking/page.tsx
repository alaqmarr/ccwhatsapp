import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import TrackingLoading from "./loading";
import { TrackingDataBoundary } from "./TrackingDataBoundary";

export const dynamic = "force-dynamic";

export default async function OrderTrackingDashboardPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "crm:view_customer_360", user.status)) {
    redirect("/dashboard/inbox");
  }

  return (
    <Suspense fallback={<TrackingLoading />}>
      <TrackingDataBoundary />
    </Suspense>
  );
}
