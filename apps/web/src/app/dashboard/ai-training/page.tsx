import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import AiTrainingLoading from "./loading";
import { AiTrainingDataBoundary } from "./AiTrainingDataBoundary";

export const dynamic = "force-dynamic";

export default async function AiTrainingPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "inbox:view", user.status)) {
    redirect("/dashboard/inbox");
  }

  return (
    <Suspense fallback={<AiTrainingLoading />}>
      <AiTrainingDataBoundary user={user} />
    </Suspense>
  );
}
