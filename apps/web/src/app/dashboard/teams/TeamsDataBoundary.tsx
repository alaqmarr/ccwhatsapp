import React from "react";
import { getInitialTeamsPayload } from "@/lib/inbox-server-data";
import { TeamsClient } from "./TeamsClient";

export async function TeamsDataBoundary({
  canManage,
}: {
  canManage: boolean;
}) {
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
