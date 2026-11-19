"use client";

import React from "react";
import { ElementErrorState, MetricStatCard, StatCardsSkeleton } from "@cc/ui";
import type {
  BroadcastItem,
  CustomLinkItem,
  MarketingListItem,
  QueueSafetySettings,
  TemplateItem,
} from "@/app/dashboard/marketing/types";

export function CampaignStats({
  initialLoading,
  loadError,
  refreshing,
  broadcasts,
  approvedTemplates,
  lists,
  customLinks,
  safetySettings,
  onRetry,
}: {
  initialLoading: boolean;
  loadError: string;
  refreshing: boolean;
  broadcasts: BroadcastItem[];
  approvedTemplates: TemplateItem[];
  lists: MarketingListItem[];
  customLinks: CustomLinkItem[];
  safetySettings: QueueSafetySettings;
  onRetry: () => void;
}) {
  if (initialLoading) {
    return <StatCardsSkeleton count={4} />;
  }
  if (loadError) {
    return (
      <ElementErrorState
        title="Could not load broadcast summary"
        message={loadError}
        onRetry={onRetry}
        retrying={refreshing}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricStatCard
        label="Active Queued Messages"
        value={String(
          broadcasts.reduce((sum, b) => sum + (b.queuedCount || 0), 0)
        )}
        subtext={`Daily cap: ${safetySettings.dailyMarketingCap} marketing msgs/day`}
      />
      <MetricStatCard
        label="Approved Templates"
        value={String(approvedTemplates.length)}
        subtext="Ready for broadcasts & customer chats"
      />
      <MetricStatCard
        label="Saved Customer Lists"
        value={String(lists.length)}
        subtext="Opted-out contacts skipped automatically"
      />
      <MetricStatCard
        label="Short Links"
        value={String(customLinks.length)}
        subtext={`${customLinks.reduce((a, b) => a + b.clicksCount, 0)} tracked clicks`}
      />
    </div>
  );
}
