import React from "react";
import { loadFullStaffAccountsPayload } from "@/lib/loaders/core";
import { ApprovalsClient } from "./ApprovalsClient";

type ApprovalsUser = Parameters<typeof loadFullStaffAccountsPayload>[0];

export async function ApprovalsDataBoundary({ user }: { user: ApprovalsUser }) {
  const initialData = await loadFullStaffAccountsPayload(user);
  return (
    <ApprovalsClient
      initialData={
        initialData as React.ComponentProps<typeof ApprovalsClient>["initialData"]
      }
    />
  );
}
