import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { canViewCostBreakdown } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import PricingLoading from "./loading";
import { PricingDataBoundary } from "./PricingDataBoundary";

export const dynamic = "force-dynamic";

export default async function CostBreakdownPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !canViewCostBreakdown(user.role)) {
    redirect("/dashboard/inbox");
  }

  return (
    <Suspense fallback={<PricingLoading />}>
      <PricingDataBoundary user={user} />
    </Suspense>
  );
}
