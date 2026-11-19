import React from "react";
import { loadAiLogsPayload } from "@/lib/loaders/operations";
import { AiLogsClient } from "./AiLogsClient";

export async function AiLogsDataBoundary() {
  const initialData = await loadAiLogsPayload({ limit: 200 });
  return (
    <AiLogsClient
      initialData={initialData as React.ComponentProps<typeof AiLogsClient>["initialData"]}
    />
  );
}
