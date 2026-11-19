import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { isSuperAdminCapable } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import ApprovalsLoading from "./loading";
import { ApprovalsDataBoundary } from "./ApprovalsDataBoundary";

export const dynamic = "force-dynamic";

export default async function StaffApprovalsPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!isSuperAdminCapable(user.role)) {
    redirect("/dashboard/inbox");
  }

  return (
    <Suspense fallback={<ApprovalsLoading />}>
      <ApprovalsDataBoundary user={user} />
    </Suspense>
  );
}
