import { formatDateTimeShortIst } from "@cc/ui";

export type AnalyticsRange = "today" | "7d" | "30d" | "90d" | "all";

export interface AnalyticsResponse {
  ok: boolean;
  range: string;
  teamFilter: string;
  pricingMode: "dev_actual_and_margin" | "client_set_pricing" | "hidden";
  canViewBilling?: boolean;
  generatedAt: string;
  teams: { id: string; name: string }[];
  kpis: {
    totalConversations: number;
    openConversations: number;
    assignedConversations: number;
    resolvedConversations: number;
    resolutionRatePct: number;
    acrioLiveChatsCount: number;
    waitingNowCount: number;
    waitingP0Count: number;
    waitingP1Count: number;
    waitingP2Count: number;
    humanAssignmentsCount: number;
    humanRespondedCount: number;
    humanResponseRatePct: number;
    avgHumanFirstResponseSeconds: number | null;
    medianHumanFirstResponseSeconds: number | null;
    fastestHumanFirstResponseSeconds: number | null;
    slowestHumanFirstResponseSeconds: number | null;
    slaUnder5MinPct: number;
    autoEscalationsCount: number;
    escalationRatePct: number;
    acrioAssignmentsCount: number;
    acrioAutonomousChats: number;
    acrioAutonomousRatePct: number;
    acrioAvgResponseSeconds: number | null;
    aiTokensIn?: number;
    aiTokensOut?: number;
    aiTokensTotal?: number;
    aiCacheReadTokens?: number;
    aiLiveCallsCount?: number;
    inboundMessagesCount: number;
    outboundMessagesCount: number;
    freeStaffRepliesCount: number;
    acrioRepliesCount: number;
    templateMessagesCount: number;
    internalNotesCount: number;
    outboundDeliveryRatePct: number;
    outboundReadRatePct: number;
    totalCustomers: number;
    optedInCustomers: number;
    optedOutCustomers: number;
    ordersCount: number;
    ordersRevenueInr: number;
    paidOrdersRevenueInr: number;
    clientBilledInr?: number;
    actualMetaCostInr?: number;
    netMarginInr?: number;
  };
  aiTokenSummary?: {
    periodTokensIn: number;
    periodTokensOut: number;
    periodTokensTotal: number;
    periodCacheReadTokens: number;
    periodLiveAiCalls: number;
    periodTotalTraces: number;
    allTimeTokensIn: number;
    allTimeTokensOut: number;
    allTimeTokensTotal: number;
    byWebsite: {
      WHATSAPP_HUB: { inputTokens: number; outputTokens: number; calls: number };
      CLASSIC_CONCEPTS: { inputTokens: number; outputTokens: number; calls: number };
      CLASSIC_EDGE_53: { inputTokens: number; outputTokens: number; calls: number };
    };
  };
  tickFunnel: {
    sending: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    totalOutbound: number;
    deliveryRatePct: number;
    readRatePct: number;
  };
  dailySeries: {
    date: string;
    label: string;
    inboundMessages: number;
    outboundMessages: number;
    newConversations: number;
    resolvedConversations: number;
    humanAssignments: number;
    avgFirstResponseSeconds: number | null;
  }[];
  hourlyIst: {
    hour: number;
    label: string;
    inboundCount: number;
    outboundCount: number;
  }[];
  agentLeaderboard: {
    staffId: string;
    staffName: string;
    role: string;
    department: string;
    isSystem: boolean;
    assignmentsCount: number;
    respondedCount: number;
    responseRatePct: number;
    avgFirstResponseSeconds: number | null;
    medianFirstResponseSeconds: number | null;
    fastestFirstResponseSeconds: number | null;
    slowestFirstResponseSeconds: number | null;
    under5MinPct: number;
    escalatedCount: number;
    reassignedCount: number;
    activeOpenChats: number;
    outboundRepliesSent: number;
    resolvedCount: number;
  }[];
  teamBreakdown: {
    teamId: string;
    teamName: string;
    brandScope: string;
    p0WaitMinutes: number;
    p1WaitMinutes: number;
    assignmentsCount: number;
    respondedCount: number;
    avgFirstResponseSeconds: number | null;
    p0Count: number;
    p1Count: number;
    p2Count: number;
    escalatedCount: number;
    openChatsCount: number;
    currentlyWaitingCount: number;
  }[];
  categories: { name: string; count: number }[];
  priorities: { name: string; count: number }[];
  segments: { name: string; count: number }[];
  billingByCategory?: Record<
    string,
    {
      count: number;
      clientBilledInr: number;
      actualMetaCostInr?: number;
      marginInr?: number;
    }
  >;
  broadcastSummary: {
    campaignsCount: number;
    totalRecipients: number;
    sent: number;
    delivered: number;
    read: number;
    skipped: number;
    failed: number;
  };
  topTemplates: {
    id: string;
    name: string;
    category: string;
    approvalStatus: string;
    qualityScore: string;
    sentCount: number;
  }[];
  topLinks: {
    id: string;
    code: string;
    title: string;
    targetUrl: string;
    linkType: string;
    clicksCount: number;
    lastClickedAt: string | null;
  }[];
  assignmentLogs: {
    id: string;
    conversationId: string;
    customerPhone: string;
    customerName: string;
    fromStaffName: string | null;
    fromTeamName: string | null;
    toStaffId: string | null;
    toStaffName: string;
    toTeamId: string | null;
    toTeamName: string;
    escalationLevel: string;
    assignmentSource: string;
    assignedByName: string;
    reason: string;
    assignedAt: string;
    firstResponseAt: string | null;
    firstResponseSeconds: number | null;
    endedAt: string | null;
    outcome: string;
  }[];
  businessInsights?: {
    templateInsights: {
      templateName: string;
      sentCount: number;
      deliveredCount: number;
      readCount: number;
      failedCount: number;
      err131049Count: number;
      repliedCount: number;
      readRatePct: number;
      replyRatePct: number;
    }[];
    leadSourceBreakdown: {
      source: string;
      label: string;
      totalContacts: number;
      optedInCount: number;
      convertedCount: number;
      conversionRatePct: number;
      lifetimeValueInr: number;
    }[];
    followUpInsights: {
      expiringWindowCount: number;
      expiringWindowChats: {
        conversationId: string;
        customerName: string;
        customerPhone: string;
        assignedStaffName: string;
        minutesRemaining: number;
        windowExpiresAt: string;
      }[];
      missingPreferredStaffCount: number;
      staleHotLeadsCount: number;
      staleHotLeads: {
        contactId: string;
        name: string;
        phone: string;
        stage: string;
        preferredStaffName: string;
        conversationId: string | null;
        lastContactedAt: string | null;
      }[];
    };
    slaBreachHoursIst: {
      hour: number;
      label: string;
      assignmentsCount: number;
      over5MinCount: number;
      breachRatePct: number;
    }[];
  };
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "None";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
  }
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function formatDateTimeIst(iso: string | null | undefined): string {
  if (!iso) return "Pending";
  const formatted = formatDateTimeShortIst(iso);
  return formatted || "Pending";
}

export function formatSourceLabel(src: string): string {
  switch (src) {
    case "INITIAL_SYSTEM":
      return "Customer Started (System)";
    case "ACRIO_HANDOFF":
      return "ACRIO Handoff";
    case "SMART_ASSIGN":
      return "Smart Team Assign";
    case "MANUAL_ASSIGN":
      return "Manual Assign";
    case "STAFF_TAKEOVER":
      return "Staff Takeover";
    case "AUTO_ESCALATION":
      return "Auto Escalated (Wait Timeout)";
    case "REOPEN":
      return "Reopened Chat";
    case "OUTBOUND_START":
      return "Staff Outbound Start";
    case "RETURN_TO_SYSTEM":
      return "Returned to System";
    default:
      return src;
  }
}

export function exportAssignmentLogsCsv(
  logs: AnalyticsResponse["assignmentLogs"],
  range: string
) {
  const rows: string[][] = [
    [
      "Assignment ID",
      "Customer Name",
      "Customer Phone",
      "Assigned To",
      "Team",
      "Tier",
      "Assignment Source",
      "Assigned By",
      "Assigned At (ISO)",
      "First Response At (ISO)",
      "First Response Seconds",
      "First Response Formatted",
      "Outcome",
    ],
    ...logs.map((l) => [
      l.id,
      l.customerName,
      l.customerPhone,
      l.toStaffId === "ACRIO" ? "System (ACRIO)" : l.toStaffName,
      l.toTeamName,
      l.escalationLevel,
      formatSourceLabel(l.assignmentSource),
      l.assignedByName,
      l.assignedAt,
      l.firstResponseAt || "",
      l.firstResponseSeconds !== null ? String(l.firstResponseSeconds) : "",
      formatDuration(l.firstResponseSeconds),
      l.outcome,
    ]),
  ];

  const csv = rows
    .map((r) =>
      r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ccwhatsapp_assignments_analytics_${range}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
