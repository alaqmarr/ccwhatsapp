import type React from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { loadContactsPayload } from "@/lib/loaders/crm";
import { getCurrentUser } from "@/lib/session";
import { ContactsClient } from "./ContactsClient";

export const dynamic = "force-dynamic";

export default async function ContactsDatabasePage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "contacts:view", user.status)) {
    redirect("/dashboard/inbox");
  }

  const initialData = await loadContactsPayload(user);
  return (
    <ContactsClient
      initialData={
        initialData as React.ComponentProps<typeof ContactsClient>["initialData"]
      }
    />
  );
}
