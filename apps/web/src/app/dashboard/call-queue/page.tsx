import type React from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { loadCallQueuePayload } from "@/lib/loaders/operations";
import { getCurrentUser } from "@/lib/session";
import { CallQueueClient } from "./CallQueueClient";

export const dynamic = "force-dynamic";

export default async function CallQueuePage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "call_queue:view", user.status)) {
    redirect("/dashboard/inbox");
  }

  const initialData = await loadCallQueuePayload(user);
  return (
    <CallQueueClient
      initialData={
        initialData as React.ComponentProps<typeof CallQueueClient>["initialData"]
      }
    />
  );
}
