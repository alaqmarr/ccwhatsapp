import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import MarketingLoading from "./loading";
import { MarketingDataBoundary } from "./MarketingDataBoundary";

export const dynamic = "force-dynamic";

export default async function MarketingAndLinksPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "inbox:view", user.status)) {
    redirect("/dashboard/inbox");
  }

  return (
    <Suspense fallback={<MarketingLoading />}>
      <MarketingDataBoundary user={user} />
    </Suspense>
  );
}
