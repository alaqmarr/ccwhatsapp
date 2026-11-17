import { redirect } from "next/navigation";
import { canViewCostBreakdown } from "@cc/rbac";
import { loadCostBreakdownPayload } from "@/lib/loaders/core";
import { getCurrentUser } from "@/lib/session";
import { PricingClient } from "./PricingClient";

export const dynamic = "force-dynamic";

export default async function CostBreakdownPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !canViewCostBreakdown(user.role)) {
    redirect("/dashboard/inbox");
  }

  const initialData = await loadCostBreakdownPayload(user);
  return <PricingClient initialData={initialData} />;
}
