import React from "react";
import { CardListSkeleton } from "@cc/ui";

export default function TeamsLoading() {
  return (
    <div className="w-full p-4 lg:p-6 space-y-5 bg-neutral-50 min-h-screen">
      <div className="bg-white rounded-lg border border-neutral-200 p-4 h-20 animate-pulse" />
      <CardListSkeleton rows={4} />
    </div>
  );
}
