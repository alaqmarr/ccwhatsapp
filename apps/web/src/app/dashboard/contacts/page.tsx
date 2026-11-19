import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import ContactsLoading from "./loading";
import { ContactsDataBoundary } from "./ContactsDataBoundary";

export const dynamic = "force-dynamic";

export default async function ContactsDatabasePage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (!hasPermission(user.role, "contacts:view", user.status)) {
    redirect("/dashboard/inbox");
  }

  return (
    <Suspense fallback={<ContactsLoading />}>
      <ContactsDataBoundary user={user} />
    </Suspense>
  );
}
