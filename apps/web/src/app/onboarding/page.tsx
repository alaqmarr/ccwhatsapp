import { redirect } from "next/navigation";
import { listAllStaffAccounts } from "@cc/auth";
import { isSuperAdminCapable } from "@cc/rbac";
import { AppShell } from "@/components/AppShell";
import { getAppBootContext } from "@/lib/session";
import { OnboardingClient } from "./OnboardingClient";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { setup, user } = await getAppBootContext();

  if (!setup.hasDevAccount) {
    redirect("/setup");
  }

  if (!user) {
    redirect("/login");
  }

  let pendingCount = 0;
  if (isSuperAdminCapable(user.role)) {
    const all = await listAllStaffAccounts();
    pendingCount = all.filter((a) => a.status === "PENDING_APPROVAL").length;
  }

  return (
    <AppShell user={user} pendingApprovalsCount={pendingCount}>
      <OnboardingClient initialUser={user} />
    </AppShell>
  );
}
