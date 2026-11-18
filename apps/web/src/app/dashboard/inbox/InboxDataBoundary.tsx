import React from "react";
import type { UserRole } from "@cc/rbac";
import { getInitialInboxPayload } from "@/lib/inbox-server-data";
import { InboxClient } from "./InboxClient";
import { InboxEmptyStateCard } from "./InboxEmptyStateCard";

export async function InboxDataBoundary({
  userId,
  userName,
  userRole,
  selectedConversationId,
}: {
  userId: string;
  userName: string;
  userRole: UserRole;
  selectedConversationId?: string;
}) {
  const initialData = await getInitialInboxPayload({
    userId,
    userName,
    userRole,
    selectedConversationId,
  });

  return (
    <InboxClient
      initialData={initialData}
      emptyChatSlot={<InboxEmptyStateCard />}
    />
  );
}
