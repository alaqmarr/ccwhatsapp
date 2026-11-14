import { redirect } from "next/navigation";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import { getInitialInboxPayload } from "@/lib/inbox-server-data";
import { InboxClient } from "./InboxClient";

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
  const initialData = await getInitialInboxPayload({
    userId: user.id,
    userName: user.name,
    selectedConversationId: sp?.chat,
  });

  return <InboxClient initialData={initialData} />;
}
