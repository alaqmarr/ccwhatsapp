"use client";

import React from "react";
import { ElementErrorState } from "@cc/ui";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="w-full p-6">
      <ElementErrorState
        title="Could not load this workspace page"
        message={
          error?.message ||
          "Something went wrong while loading data. Click Try Again to reload."
        }
        onRetry={() => reset()}
      />
    </div>
  );
}
