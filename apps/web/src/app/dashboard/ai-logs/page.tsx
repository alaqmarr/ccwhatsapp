import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { isDevRole } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import AiLogsLoading from "./loading";
import { AiLogsDataBoundary } from "./AiLogsDataBoundary";

export const dynamic = "force-dynamic";

export default async function DevAiLogsPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    redirect("/dashboard/inbox");
  }

  return (
    <Suspense fallback={<AiLogsLoading />}>
      <AiLogsDataBoundary />
    </Suspense>
  );
}
