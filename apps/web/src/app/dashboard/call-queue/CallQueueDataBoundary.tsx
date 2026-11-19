import React from "react";
import { loadCallQueuePayload } from "@/lib/loaders/operations";
import { CallQueueClient } from "./CallQueueClient";

type CallQueueUser = Parameters<typeof loadCallQueuePayload>[0];

export async function CallQueueDataBoundary({ user }: { user: CallQueueUser }) {
  const initialData = await loadCallQueuePayload(user);
  return (
    <CallQueueClient
      initialData={
        initialData as React.ComponentProps<typeof CallQueueClient>["initialData"]
      }
    />
  );
}
