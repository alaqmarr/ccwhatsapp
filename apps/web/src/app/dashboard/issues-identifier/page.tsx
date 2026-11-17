import type React from "react";
import { redirect } from "next/navigation";
import { isDevRole } from "@cc/rbac";
import { loadIssuesIdentifierPayload } from "@/lib/loaders/operations";
import { getCurrentUser } from "@/lib/session";
import { IssuesIdentifierClient } from "./IssuesIdentifierClient";

export const dynamic = "force-dynamic";

export default async function DevIssuesIdentifierPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    redirect("/dashboard/inbox");
  }

  let initialData: React.ComponentProps<
    typeof IssuesIdentifierClient
  >["initialData"] = null;
  let initialError = "";
  try {
    const payload = await loadIssuesIdentifierPayload(user.name, false);
    initialData = payload.report as React.ComponentProps<
      typeof IssuesIdentifierClient
    >["initialData"];
  } catch (err: any) {
    initialError = err?.message || "Failed to run ecosystem issues audit.";
  }

  return (
    <IssuesIdentifierClient
      initialData={initialData}
      initialError={initialError}
    />
  );
}
