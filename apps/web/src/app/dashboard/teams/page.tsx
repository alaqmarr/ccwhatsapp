import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import TeamsLoading from "./loading";
import { TeamsDataBoundary } from "./TeamsDataBoundary";

export const dynamic = "force-dynamic";

export default async function TeamsAndEscalationPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!hasPermission(user.role, "inbox:view", user.status)) {
    redirect("/onboarding");
  }

  const canManage = ["DEV", "SUPERADMIN", "ADMIN"].includes(user.role);

  return (
    <Suspense fallback={<TeamsLoading />}>
      <TeamsDataBoundary canManage={canManage} />
    </Suspense>
  );
}
