import type React from "react";
import { redirect } from "next/navigation";
import { isDevRole } from "@cc/rbac";
import { loadAnalyticsPayload } from "@/lib/loaders/analytics";
import {
  loadDevPricingPayload,
  loadFullStaffAccountsPayload,
} from "@/lib/loaders/core";
import { loadDevBackupsPayload } from "@/lib/loaders/crm";
import { getCurrentUser } from "@/lib/session";
import { DevClient } from "./DevClient";

export const dynamic = "force-dynamic";

export default async function DevProfitAndOpsPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    redirect("/dashboard/inbox");
  }

  const [pricing, analytics, staffDir, backups] = await Promise.all([
    loadDevPricingPayload(),
    loadAnalyticsPayload(user, { range: "30d", scope: "dev" }),
    loadFullStaffAccountsPayload(user),
    loadDevBackupsPayload(),
  ]);

  const devAccounts = staffDir.staff.filter((s) => s.role === "DEV");

  return (
    <DevClient
      initialData={
        {
          pricing,
          analytics,
          devAccounts,
          databases: backups.databases,
          backupLogs: backups.backupLogs,
          backupConfig: backups.backupConfig,
        } as unknown as React.ComponentProps<typeof DevClient>["initialData"]
      }
    />
  );
}
