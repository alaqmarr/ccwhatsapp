import type React from "react";
import { redirect } from "next/navigation";
import { loadEnquiriesPayload } from "@/lib/loaders/operations";
import { getCurrentUser } from "@/lib/session";
import { EnquiriesClient } from "./EnquiriesClient";

export const dynamic = "force-dynamic";

export default async function UnifiedWebsiteEnquiriesPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (user.role === "CLIENT") {
    redirect("/dashboard/pricing");
  }

  const initialData = await loadEnquiriesPayload({ limit: 300 });
  return (
    <EnquiriesClient
      initialData={
        initialData as React.ComponentProps<typeof EnquiriesClient>["initialData"]
      }
    />
  );
}
