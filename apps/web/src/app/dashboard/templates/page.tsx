import type React from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { loadTemplatesPayload } from "@/lib/loaders/crm";
import { getCurrentUser } from "@/lib/session";
import { TemplatesClient } from "./TemplatesClient";

export const dynamic = "force-dynamic";

export default async function TemplatesStudioPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "templates:manage", user.status)) {
    redirect("/dashboard/inbox");
  }

  const initialData = await loadTemplatesPayload(user);
  return (
    <TemplatesClient
      initialData={
        initialData as React.ComponentProps<typeof TemplatesClient>["initialData"]
      }
    />
  );
}
