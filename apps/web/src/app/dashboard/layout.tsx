import { redirect } from "next/navigation";
import { countPendingStaffApprovals } from "@cc/auth";
import { isSuperAdminCapable } from "@cc/rbac";
import { AppShell } from "@/components/AppShell";
import { getAppBootContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { setup, user } = await getAppBootContext();

  if (!setup.hasDevAccount) {
    redirect("/setup");
  }

  if (!user) {
    redirect("/login");
  }

  // Unapproved staff accounts cannot enter live /dashboard/* until SUPERADMIN or DEV approves them!
  if (user.status !== "ACTIVE") {
    redirect("/onboarding");
  }

  const pendingCount = isSuperAdminCapable(user.role)
    ? await countPendingStaffApprovals()
    : 0;

  return (
    <AppShell user={user} pendingApprovalsCount={pendingCount}>
      {children}
    </AppShell>
  );
}
