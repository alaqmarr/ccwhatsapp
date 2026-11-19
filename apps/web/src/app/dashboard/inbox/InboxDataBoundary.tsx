import React from "react";
import type { UserRole } from "@cc/rbac";
import type { InboxQuickFilter } from "@/lib/inbox-filter-helpers";
import { getInitialInboxPayload } from "@/lib/inbox-server-data";
import { InboxClient } from "./InboxClient";
import { InboxEmptyStateCard } from "./InboxEmptyStateCard";

export async function InboxDataBoundary({
  userId,
  userName,
  userRole,
  selectedConversationId,
  initialFilter,
}: {
  userId: string;
  userName: string;
  userRole: UserRole;
  selectedConversationId?: string;
  initialFilter?: InboxQuickFilter;
}) {
  const initialData = await getInitialInboxPayload({
    userId,
    userName,
    userRole,
    selectedConversationId,
    initialFilter,
  });

  return (
    <InboxClient
      initialData={initialData}
      emptyChatSlot={<InboxEmptyStateCard />}
    />
  );
}
