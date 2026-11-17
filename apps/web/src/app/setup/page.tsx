import { redirect } from "next/navigation";
import { isDevRole } from "@cc/rbac";
import { loadSetupPayload } from "@/lib/loaders/core";
import { SetupClient } from "./SetupClient";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const initialData = await loadSetupPayload();
  if (initialData.hasDevAccount) {
    if (!initialData.currentUser) {
      redirect("/login");
    }
    if (
      !isDevRole(initialData.currentUser.role) ||
      initialData.currentUser.status !== "ACTIVE"
    ) {
      redirect("/dashboard/inbox");
    }
  }

  return <SetupClient initialData={initialData} />;
}
