"use client";

import React from "react";
import { ElementErrorState } from "@cc/ui";

export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="w-full p-6">
      <ElementErrorState
        title="Could not load Broadcast Queue & Short Links"
        message={
          error?.message ||
          "Could not load broadcast queue data. Click Try Again to reload."
        }
        onRetry={() => reset()}
      />
    </div>
  );
}
