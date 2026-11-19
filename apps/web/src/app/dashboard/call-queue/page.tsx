import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import CallQueueLoading from "./loading";
import { CallQueueDataBoundary } from "./CallQueueDataBoundary";

export const dynamic = "force-dynamic";

export default async function CallQueuePage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "call_queue:view", user.status)) {
    redirect("/dashboard/inbox");
  }

  return (
    <Suspense fallback={<CallQueueLoading />}>
      <CallQueueDataBoundary user={user} />
    </Suspense>
  );
}
