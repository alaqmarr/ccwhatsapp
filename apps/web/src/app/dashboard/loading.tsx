import React from "react";
import { CardListSkeleton, StatCardsSkeleton, TableRowsSkeleton } from "@cc/ui";

export default function DashboardLoading() {
  return (
    <div className="w-full px-6 py-5 space-y-6 bg-neutral-50">
      <div className="h-12 w-72 rounded-md bg-neutral-200/80 animate-pulse" />
      <StatCardsSkeleton count={4} />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6">
          <CardListSkeleton rows={3} />
        </div>
        <div className="lg:col-span-6">
          <TableRowsSkeleton rows={5} cols={4} />
        </div>
      </div>
    </div>
  );
}
