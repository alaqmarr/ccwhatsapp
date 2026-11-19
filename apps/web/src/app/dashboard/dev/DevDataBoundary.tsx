import type React from "react";
import type { AuthenticatedUser } from "@cc/auth";
import { loadAnalyticsPayload } from "@/lib/loaders/analytics";
import {
  loadDevPricingPayload,
  loadFullStaffAccountsPayload,
} from "@/lib/loaders/core";
import { loadDevBackupsPayload } from "@/lib/loaders/crm";
import { DevClient } from "./DevClient";

export async function DevDataBoundary({ user }: { user: AuthenticatedUser }) {
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
