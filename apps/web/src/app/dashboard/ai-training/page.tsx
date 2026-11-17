import type React from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { loadAiTrainingPayload } from "@/lib/loaders/operations";
import { getCurrentUser } from "@/lib/session";
import { AiTrainingClient } from "./AiTrainingClient";

export const dynamic = "force-dynamic";

export default async function AiTrainingPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "inbox:view", user.status)) {
    redirect("/dashboard/inbox");
  }

  const initialData = await loadAiTrainingPayload(user);
  return (
    <AiTrainingClient
      initialData={
        initialData as React.ComponentProps<typeof AiTrainingClient>["initialData"]
      }
    />
  );
}
