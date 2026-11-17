import type React from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { loadAutomationsPayload } from "@/lib/loaders/operations";
import { getCurrentUser } from "@/lib/session";
import { AutomationsClient } from "./AutomationsClient";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "automations:manage", user.status)) {
    redirect("/dashboard/inbox");
  }

  const initialData = await loadAutomationsPayload();
  return (
    <AutomationsClient
      initialData={
        initialData as React.ComponentProps<typeof AutomationsClient>["initialData"]
      }
    />
  );
}
