export type PacingMode = "SAFE_STEADY" | "EXTRA_CAREFUL" | "WARMED_FAST";

export interface TemplateItem {
  id: string;
  name: string;
  language: string;
  category: string;
  headerType: string;
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  approvalStatus: string;
  sentCount: number;
}

export interface MarketingListItem {
  id: string;
  name: string;
  description: string;
  sourceType: string;
  acrioPrompt: string | null;
  membersCount: number;
  memberPhones: string[];
  createdByName: string;
  updatedAt: string;
}

export interface BroadcastItem {
  id: string;
  name: string;
  listName: string;
  templateName: string;
  billingCategory: string;
  status: string;
  pacingMode: string;
  delaySeconds: number;
  batchSize: number;
  batchPauseSeconds: number;
  totalRecipients: number;
  queuedCount: number;
  skippedCount: number;
  failedCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  pausedReason: string | null;
  scheduledFor: string | null;
  nextDispatchAt: string | null;
  completedAt: string | null;
  clientBilledInr: number;
  createdByName: string;
  createdAt: string;
}

export interface RecipientQueueRow {
  id: string;
  customerName: string;
  customerPhone: string;
  renderedBody: string;
  status: string;
  skipOrErrorReason: string | null;
  attempts: number;
  scheduledAt: string;
  sentAt: string | null;
}

export interface QueueSafetySettings {
  defaultPacingMode: PacingMode;
  delaySeconds: number;
  batchSize: number;
  batchPauseSeconds: number;
  skipRecentHours: number;
  dailyMarketingCap: number;
  autoPauseOnConsecutiveFailures: number;
  quietHoursEnabled: boolean;
}

export interface CustomLinkItem {
  id: string;
  code: string;
  title: string;
  targetUrl: string;
  linkType: string;
  utmCampaign: string | null;
  clicksCount: number;
  createdByName: string;
}

export interface AcrioPreview {
  suggestedName: string;
  description: string;
  filterExplanation: string;
  matchedCustomers: {
    id: string;
    name: string;
    phone: string;
    companyName: string | null;
    organizationType: string | null;
    acrioSegment: string;
    lifetimeValueInr: number;
  }[];
}

export interface MarketingInitialPayload {
  canManageTemplates: boolean;
  canSendBroadcasts: boolean;
  templates: TemplateItem[];
  lists: MarketingListItem[];
  broadcasts: BroadcastItem[];
  customLinks: CustomLinkItem[];
  queueSettings?: QueueSafetySettings;
}

export const DEFAULT_QUEUE_SAFETY_SETTINGS: QueueSafetySettings = {
  defaultPacingMode: "SAFE_STEADY",
  delaySeconds: 4,
  batchSize: 25,
  batchPauseSeconds: 20,
  skipRecentHours: 24,
  dailyMarketingCap: 250,
  autoPauseOnConsecutiveFailures: 3,
  quietHoursEnabled: false,
};

export function formatDurationLabel(totalSeconds: number): string {
  if (totalSeconds <= 0) return "Immediate";
  if (totalSeconds < 60) return `~${totalSeconds} sec`;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins < 60) {
    return secs > 0 ? `~${mins} min ${secs}s` : `~${mins} min`;
  }
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `~${hrs} hr ${remMins} min` : `~${hrs} hr`;
}

export function estimateSafeQueueDuration(
  count: number,
  mode: PacingMode
): number {
  if (count <= 0) return 0;
  const spec =
    mode === "EXTRA_CAREFUL"
      ? { delay: 8, batch: 15, pause: 30 }
      : mode === "WARMED_FAST"
      ? { delay: 2, batch: 50, pause: 15 }
      : { delay: 4, batch: 25, pause: 20 };
  const pauses = Math.floor(Math.max(0, count - 1) / spec.batch);
  return Math.max(0, count - 1) * spec.delay + pauses * spec.pause;
}

export function getStatusBadgeStyle(status: string): string {
  switch (status) {
    case "SENDING":
    case "QUEUED":
      return "bg-blue-50 text-blue-800 border-blue-200";
    case "SCHEDULED":
      return "bg-indigo-50 text-indigo-800 border-indigo-200";
    case "PAUSED":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "COMPLETED":
    case "SENT":
    case "DELIVERED":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "SKIPPED":
      return "bg-neutral-100 text-neutral-700 border-neutral-300";
    case "FAILED":
    case "CANCELLED":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-neutral-100 text-neutral-700 border-neutral-200";
  }
}
