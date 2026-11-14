import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

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
  redirect("/dashboard/inbox");
}
