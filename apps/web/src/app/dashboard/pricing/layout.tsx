import { redirect } from "next/navigation";
import { canViewCostBreakdown } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PricingCostBreakdownLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !canViewCostBreakdown(user.role)) {
    redirect("/dashboard/inbox");
  }
  return <>{children}</>;
}
