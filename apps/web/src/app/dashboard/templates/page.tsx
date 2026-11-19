import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import TemplatesLoading from "./loading";
import { TemplatesDataBoundary } from "./TemplatesDataBoundary";

export const dynamic = "force-dynamic";

export default async function TemplatesStudioPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "templates:manage", user.status)) {
    redirect("/dashboard/inbox");
  }

  return (
    <Suspense fallback={<TemplatesLoading />}>
      <TemplatesDataBoundary user={user} />
    </Suspense>
  );
}
