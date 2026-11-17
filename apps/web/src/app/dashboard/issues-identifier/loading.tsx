import React from "react";
import { CardListSkeleton, StatCardsSkeleton } from "@cc/ui";

export default function IssuesIdentifierLoading() {
  return (
    <div className="w-full px-6 py-5 space-y-5 bg-neutral-50 min-h-screen">
      <div className="h-14 w-80 rounded-lg bg-neutral-200/80 animate-pulse" />
      <StatCardsSkeleton count={4} />
      <CardListSkeleton rows={4} />
    </div>
  );
}
