import { redirect } from "next/navigation";
import { listAllStaffAccounts } from "@cc/auth";
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

  let pendingCount = 0;
  if (isSuperAdminCapable(user.role)) {
    const all = await listAllStaffAccounts();
    pendingCount = all.filter((a) => a.status === "PENDING_APPROVAL").length;
  }

  return (
    <AppShell user={user} pendingApprovalsCount={pendingCount}>
      {children}
    </AppShell>
  );
}
