import type React from "react";
import type { AuthenticatedUser } from "@cc/auth";
import { loadAnalyticsPayload } from "@/lib/loaders/analytics";
import { AnalyticsClient } from "./AnalyticsClient";

export async function AnalyticsDataBoundary({
  user,
}: {
  user: AuthenticatedUser;
}) {
  const initialData = await loadAnalyticsPayload(user, {
    range: "30d",
    teamId: "ALL",
  });
  return (
    <AnalyticsClient
      initialData={
        initialData as React.ComponentProps<typeof AnalyticsClient>["initialData"]
      }
    />
  );
}
