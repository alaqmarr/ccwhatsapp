import React from "react";
import { CardListSkeleton, StatCardsSkeleton, TableRowsSkeleton } from "@cc/ui";

export default function DevOpsLoading() {
  return (
    <div className="w-full px-6 py-5 space-y-6 bg-neutral-50 min-h-screen">
      <div className="h-14 w-80 rounded-lg bg-neutral-200/80 animate-pulse" />
      <StatCardsSkeleton count={4} />
      <TableRowsSkeleton rows={5} cols={4} />
      <CardListSkeleton rows={3} />
    </div>
  );
}
