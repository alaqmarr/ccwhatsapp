import React from "react";
import { loadIssuesIdentifierPayload } from "@/lib/loaders/operations";
import { IssuesIdentifierClient } from "./IssuesIdentifierClient";

export async function IssuesIdentifierDataBoundary({
  userName,
}: {
  userName: string;
}) {
  let initialData: React.ComponentProps<
    typeof IssuesIdentifierClient
  >["initialData"] = null;
  let initialError = "";
  try {
    const payload = await loadIssuesIdentifierPayload(userName, false);
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
