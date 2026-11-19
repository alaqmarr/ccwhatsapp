import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { isDevRole } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import DevOpsLoading from "./loading";
import { DevDataBoundary } from "./DevDataBoundary";

export const dynamic = "force-dynamic";

export default async function DevProfitAndOpsPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    redirect("/dashboard/inbox");
  }

  return (
    <Suspense fallback={<DevOpsLoading />}>
      <DevDataBoundary user={user} />
    </Suspense>
  );
}
