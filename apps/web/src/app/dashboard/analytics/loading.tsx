import React from "react";
import { CardListSkeleton, StatCardsSkeleton, TableRowsSkeleton } from "@cc/ui";

export default function AnalyticsLoading() {
  return (
    <div className="w-full px-6 py-5 space-y-6 bg-neutral-50">
      <div className="h-12 w-96 rounded-md bg-neutral-200/80 animate-pulse" />
      <StatCardsSkeleton count={4} />
      <StatCardsSkeleton count={4} />
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-7">
          <CardListSkeleton rows={4} />
        </div>
        <div className="xl:col-span-5">
          <CardListSkeleton rows={4} />
        </div>
      </div>
      <TableRowsSkeleton rows={6} cols={6} />
      <TableRowsSkeleton rows={8} cols={7} />
    </div>
  );
}
