export const INBOX_QUICK_FILTERS = [
  "ALL",
  "MINE",
  "ACTIVE",
  "LEAD_ASSIGNED",
  "WAITING",
  "ACRIO",
  "UNREAD",
  "RESOLVED",
] as const;

export type InboxQuickFilter = (typeof INBOX_QUICK_FILTERS)[number];

export interface FilterableConversationSummary {
  id: string;
  status: string;
  assignedStaffId: string | null;
  waitingSince: string | null;
  unreadCount: number;
  collaborators?: ReadonlyArray<{ staffId: string }>;
}

const QUICK_FILTER_SET: ReadonlySet<string> = new Set(INBOX_QUICK_FILTERS);

export function normalizeInboxQuickFilter(
  raw: string | null | undefined
): InboxQuickFilter | undefined {
  if (!raw) return undefined;
  const upper = raw.trim().toUpperCase();
  return QUICK_FILTER_SET.has(upper) ? (upper as InboxQuickFilter) : undefined;
}

export function isConversationMine(
  t: Pick<FilterableConversationSummary, "assignedStaffId" | "collaborators">,
  currentUserId: string
): boolean {
  return (
    t.assignedStaffId === currentUserId ||
    Boolean(t.collaborators?.some((c) => c.staffId === currentUserId))
  );
}

export function matchesInboxQuickFilter(
  t: FilterableConversationSummary,
  quickFilter: InboxQuickFilter,
  currentUserId: string
): boolean {
  if (quickFilter === "MINE") {
    return isConversationMine(t, currentUserId);
  }
  if (quickFilter === "ACTIVE") {
    return t.status !== "RESOLVED";
  }
  if (quickFilter === "LEAD_ASSIGNED") {
    return (
      t.status !== "RESOLVED" &&
      Boolean(t.assignedStaffId) &&
      t.assignedStaffId !== "ACRIO"
    );
  }
  if (quickFilter === "WAITING") {
    return t.status !== "RESOLVED" && Boolean(t.waitingSince);
  }
  if (quickFilter === "ACRIO") {
    return t.status !== "RESOLVED" && t.assignedStaffId === "ACRIO";
  }
  if (quickFilter === "UNREAD") {
    return t.unreadCount > 0;
  }
  if (quickFilter === "RESOLVED") {
    return t.status === "RESOLVED";
  }
  return true;
}

export function pickInitialConversationId(params: {
  threads: ReadonlyArray<FilterableConversationSummary>;
  currentUserId: string;
  selectedConversationId?: string;
  initialFilter?: InboxQuickFilter;
}): string | null {
  const { threads, currentUserId, selectedConversationId, initialFilter } =
    params;

  if (
    selectedConversationId &&
    threads.some((t) => t.id === selectedConversationId)
  ) {
    return selectedConversationId;
  }

  if (initialFilter) {
    const matched = threads.find((t) =>
      matchesInboxQuickFilter(t, initialFilter, currentUserId)
    );
    return matched?.id ?? null;
  }

  const mineFirst = threads.find((t) =>
    isConversationMine(t, currentUserId)
  );
  return mineFirst?.id || threads[0]?.id || null;
}
