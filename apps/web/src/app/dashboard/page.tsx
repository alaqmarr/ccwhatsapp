import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardRootPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.status !== "ACTIVE") {
    redirect("/onboarding");
  }
  if (user.role === "CLIENT") {
    redirect("/dashboard/pricing");
  }
  if (!hasPermission(user.role, "inbox:view", user.status)) {
    redirect("/onboarding");
  }
  return <DashboardClient />;
}
