import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import InboxLoading from "./loading";
import { InboxDataBoundary } from "./InboxDataBoundary";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!hasPermission(user.role, "inbox:view", user.status)) {
    redirect("/onboarding");
  }

  const sp = await searchParams;

  return (
    <Suspense fallback={<InboxLoading />}>
      <InboxDataBoundary
        userId={user.id}
        userName={user.name}
        userRole={user.role}
        selectedConversationId={sp?.chat}
      />
    </Suspense>
  );
}
