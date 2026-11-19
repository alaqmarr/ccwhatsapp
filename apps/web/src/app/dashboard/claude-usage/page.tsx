import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { isDevRole } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import ClaudeUsageLoading from "./loading";
import { ClaudeUsageDataBoundary } from "./ClaudeUsageDataBoundary";

export const dynamic = "force-dynamic";

export default async function DevClaudeUsagePage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    redirect("/dashboard/inbox");
  }

  return (
    <Suspense fallback={<ClaudeUsageLoading />}>
      <ClaudeUsageDataBoundary />
    </Suspense>
  );
}
