import React from "react";
import { loadTrackingPayload } from "@/lib/loaders/operations";
import { TrackingClient } from "./TrackingClient";

export async function TrackingDataBoundary() {
  const initialData = await loadTrackingPayload({ limit: 300 });
  return (
    <TrackingClient
      initialData={
        initialData as React.ComponentProps<typeof TrackingClient>["initialData"]
      }
    />
  );
}
