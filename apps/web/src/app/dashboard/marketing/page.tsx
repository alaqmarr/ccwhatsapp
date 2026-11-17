import type React from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { loadMarketingPayload } from "@/lib/loaders/crm";
import { getCurrentUser } from "@/lib/session";
import { MarketingClient } from "./MarketingClient";

export const dynamic = "force-dynamic";

export default async function MarketingAndLinksPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "inbox:view", user.status)) {
    redirect("/dashboard/inbox");
  }

  const initialData = await loadMarketingPayload(user);
  return (
    <MarketingClient
      initialData={
        initialData as React.ComponentProps<typeof MarketingClient>["initialData"]
      }
    />
  );
}
