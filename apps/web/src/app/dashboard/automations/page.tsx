import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import AutomationsLoading from "./loading";
import { AutomationsDataBoundary } from "./AutomationsDataBoundary";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "automations:manage", user.status)) {
    redirect("/dashboard/inbox");
  }

  return (
    <Suspense fallback={<AutomationsLoading />}>
      <AutomationsDataBoundary />
    </Suspense>
  );
}
