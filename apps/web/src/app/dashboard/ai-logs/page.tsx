import type React from "react";
import { redirect } from "next/navigation";
import { isDevRole } from "@cc/rbac";
import { loadAiLogsPayload } from "@/lib/loaders/operations";
import { getCurrentUser } from "@/lib/session";
import { AiLogsClient } from "./AiLogsClient";

export const dynamic = "force-dynamic";

export default async function DevAiLogsPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    redirect("/dashboard/inbox");
  }

  const initialData = await loadAiLogsPayload({ limit: 200 });
  return (
    <AiLogsClient
      initialData={initialData as React.ComponentProps<typeof AiLogsClient>["initialData"]}
    />
  );
}
