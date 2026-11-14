import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import { getInitialTeamsPayload } from "@/lib/inbox-server-data";
import { TeamsClient } from "./TeamsClient";

export const dynamic = "force-dynamic";

export default async function TeamsAndEscalationPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!hasPermission(user.role, "inbox:view", user.status)) {
    redirect("/onboarding");
  }

  const canManage = ["DEV", "SUPERADMIN", "ADMIN"].includes(user.role);
  const payload = await getInitialTeamsPayload(canManage);

  return (
    <TeamsClient
      initialTeams={payload.teams}
      initialActiveStaff={payload.activeStaff}
      initialCanManage={payload.canManage}
      initialSyncInfo={payload.syncInfo}
    />
  );
}
