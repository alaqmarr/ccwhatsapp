import React from "react";
import { CardListSkeleton } from "@cc/ui";

export default function ProfileLoading() {
  return (
    <div className="w-full px-6 py-5 space-y-5 bg-neutral-50 min-h-screen">
      <div className="h-14 w-64 rounded-lg bg-neutral-200/80 animate-pulse" />
      <CardListSkeleton rows={3} />
    </div>
  );
}
