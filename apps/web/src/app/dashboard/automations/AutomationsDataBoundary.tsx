import React from "react";
import { loadAutomationsPayload } from "@/lib/loaders/operations";
import { AutomationsClient } from "./AutomationsClient";

export async function AutomationsDataBoundary() {
  const initialData = await loadAutomationsPayload();
  return (
    <AutomationsClient
      initialData={
        initialData as React.ComponentProps<typeof AutomationsClient>["initialData"]
      }
    />
  );
}
