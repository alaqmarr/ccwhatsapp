import type React from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { loadTrackingPayload } from "@/lib/loaders/operations";
import { getCurrentUser } from "@/lib/session";
import { TrackingClient } from "./TrackingClient";

export const dynamic = "force-dynamic";

export default async function OrderTrackingDashboardPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "crm:view_customer_360", user.status)) {
    redirect("/dashboard/inbox");
  }

  const initialData = await loadTrackingPayload({ limit: 300 });
  return (
    <TrackingClient
      initialData={
        initialData as React.ComponentProps<typeof TrackingClient>["initialData"]
      }
    />
  );
}
