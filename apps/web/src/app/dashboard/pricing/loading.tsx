import React from "react";
import { StatCardsSkeleton, TableRowsSkeleton } from "@cc/ui";

export default function PricingLoading() {
  return (
    <div className="w-full px-6 py-5 space-y-6 bg-neutral-50 min-h-screen">
      <div className="h-14 w-72 rounded-lg bg-neutral-200/80 animate-pulse" />
      <StatCardsSkeleton count={3} />
      <StatCardsSkeleton count={2} />
      <TableRowsSkeleton rows={4} cols={4} />
      <TableRowsSkeleton rows={5} cols={5} />
    </div>
  );
}
