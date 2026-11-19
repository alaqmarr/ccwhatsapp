import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { isDevRole } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import IssuesIdentifierLoading from "./loading";
import { IssuesIdentifierDataBoundary } from "./IssuesIdentifierDataBoundary";

export const dynamic = "force-dynamic";

export default async function DevIssuesIdentifierPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    redirect("/dashboard/inbox");
  }

  return (
    <Suspense fallback={<IssuesIdentifierLoading />}>
      <IssuesIdentifierDataBoundary userName={user.name} />
    </Suspense>
  );
}
