import type React from "react";
import { loadEnquiriesPayload } from "@/lib/loaders/operations";
import { EnquiriesClient } from "./EnquiriesClient";

export async function EnquiriesDataBoundary() {
  const initialData = await loadEnquiriesPayload({ limit: 300 });
  return (
    <EnquiriesClient
      initialData={
        initialData as React.ComponentProps<typeof EnquiriesClient>["initialData"]
      }
    />
  );
}
