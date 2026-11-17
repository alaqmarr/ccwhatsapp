import type React from "react";
import { redirect } from "next/navigation";
import { isSuperAdminCapable } from "@cc/rbac";
import { loadFullStaffAccountsPayload } from "@/lib/loaders/core";
import { getCurrentUser } from "@/lib/session";
import { ApprovalsClient } from "./ApprovalsClient";

export const dynamic = "force-dynamic";

export default async function StaffApprovalsPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!isSuperAdminCapable(user.role)) {
    redirect("/dashboard/inbox");
  }

  const initialData = await loadFullStaffAccountsPayload(user);
  return (
    <ApprovalsClient
      initialData={
        initialData as React.ComponentProps<typeof ApprovalsClient>["initialData"]
      }
    />
  );
}
