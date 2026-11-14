import { redirect } from "next/navigation";
import { isSuperAdminCapable } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ApprovalsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!isSuperAdminCapable(user.role)) {
    redirect("/dashboard/inbox");
  }
  return <>{children}</>;
}
