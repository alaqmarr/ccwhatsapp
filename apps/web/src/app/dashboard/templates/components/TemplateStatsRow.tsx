"use client";

import React from "react";
import { ElementErrorState, MetricStatCard, StatCardsSkeleton } from "@cc/ui";
import type { TemplateRecord } from "@/app/dashboard/templates/types";

export function TemplateStatsRow({
  loading,
  loadError,
  templates,
  onRetry,
}: {
  loading: boolean;
  loadError: string;
  templates: TemplateRecord[];
  onRetry: () => void;
}) {
  if (loading) {
    return <StatCardsSkeleton count={4} />;
  }
  if (loadError) {
    return (
      <ElementErrorState
        title="Could not load template summary"
        message={loadError}
        onRetry={onRetry}
      />
    );
  }

  const approvedCount = templates.filter(
    (t) => t.approvalStatus === "APPROVED"
  ).length;
  const draftOrPendingCount = templates.filter(
    (t) =>
      t.approvalStatus === "DRAFT" || t.approvalStatus === "PENDING_APPROVAL"
  ).length;
  const totalSentCount = templates.reduce(
    (sum, t) => sum + (t.sentCount || 0),
    0
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricStatCard
        label="Total Templates"
        value={String(templates.length)}
        subtext="Across all languages & types"
      />
      <MetricStatCard
        label="Approved & Ready"
        value={String(approvedCount)}
        subtext="Available in Customer Chats & Broadcasts"
      />
      <MetricStatCard
        label="Drafts & In Review"
        value={String(draftOrPendingCount)}
        subtext="Saved drafts or awaiting Meta review"
      />
      <MetricStatCard
        label="Messages Sent via Templates"
        value={String(totalSentCount)}
        subtext="Across Customer Chats & Broadcasts"
      />
    </div>
  );
}
